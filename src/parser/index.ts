import type { DatabaseAttribution, MetricDistribution, WorkloadProfile } from "../contracts/types.js";
import { parseCsv, type CsvRow } from "./csv.js";
import { distribution, numberFrom, zeroDistribution } from "./stats.js";

export interface ExistingCollectorCsvSet {
  cpuCsv: string;
  memoryCsv?: string;
  ioCsv: string;
  storageCsv?: string;
}

interface IoSample {
  databaseName: string;
  sampleId: string;
  iops: number;
  throughputMbps: number;
}

export function normalizeExistingCollectorCsvs(csvs: ExistingCollectorCsvSet): WorkloadProfile {
  const cpuRows = parseCsv(csvs.cpuCsv);
  const memoryRows = csvs.memoryCsv ? parseCsv(csvs.memoryCsv) : [];
  const ioRows = parseCsv(csvs.ioCsv);
  const storageRows = csvs.storageCsv ? parseCsv(csvs.storageCsv) : [];

  const ioSamples = ioRows.map(toIoSample);
  const serverSamples = aggregateServerIoSamples(ioSamples);
  const databaseAttribution = aggregateDatabaseAttribution(ioSamples, storageRows);

  return {
    collectionHours: estimateCollectionHours(cpuRows, memoryRows, ioRows),
    cpuPct: distribution(cpuRows.map((row) => numberFrom(row.SqlSerCpuUT ?? row.sqlsercpuut ?? row.CPU ?? row.cpu))),
    memoryPressurePct: memoryRows.length > 0 ? distribution(memoryRows.map(memoryPressureFromRow)) : undefined,
    pageLifeExpectancySeconds: memoryRows.length > 0 ? distribution(memoryRows.map((row) => numberFrom(row.PLE ?? row.ple))) : undefined,
    iops: distribution(serverSamples.map((sample) => sample.iops)),
    throughputMbps: distribution(serverSamples.map((sample) => sample.throughputMbps)),
    totalDatabaseSizeGb: totalDatabaseSize(storageRows),
    databases: databaseAttribution
  };
}

export function normalizeCollectorOutput(): WorkloadProfile {
  throw new Error("normalizeCollectorOutput requires ZIP/file loading, which is not implemented yet. Use normalizeExistingCollectorCsvs for parsed CSV text.");
}

function toIoSample(row: CsvRow): IoSample {
  const bRead = numberFrom(row.BRead ?? row.bread);
  const bWritten = numberFrom(row.BWritten ?? row.bwritten);
  const explicitThroughput = numberFrom(row.Throuput ?? row.Throughput ?? row.throughput);
  const throughputMbps = explicitThroughput > 0 ? explicitThroughput : (bRead + bWritten) / 60 / 1048576;
  const rawIops = numberFrom(row.TotalIOPs ?? row.TotalIOPS ?? row.totaliops);

  return {
    databaseName: row.DBName || row.DatabaseName || row.databaseName || "unknown",
    sampleId: row.Sample_ID || row.SampleId || row.sampleId || row.CollectionTime || row.collectionTime || "single",
    iops: rawIops / 60,
    throughputMbps
  };
}

function aggregateServerIoSamples(samples: IoSample[]): Array<{ sampleId: string; iops: number; throughputMbps: number }> {
  const bySample = new Map<string, { sampleId: string; iops: number; throughputMbps: number }>();

  for (const sample of samples) {
    const current = bySample.get(sample.sampleId) ?? { sampleId: sample.sampleId, iops: 0, throughputMbps: 0 };
    current.iops += sample.iops;
    current.throughputMbps += sample.throughputMbps;
    bySample.set(sample.sampleId, current);
  }

  return [...bySample.values()];
}

function aggregateDatabaseAttribution(samples: IoSample[], storageRows: CsvRow[]): DatabaseAttribution[] {
  const byDatabase = new Map<string, { iops: number[]; throughputMbps: number[] }>();

  for (const sample of samples) {
    const current = byDatabase.get(sample.databaseName) ?? { iops: [], throughputMbps: [] };
    current.iops.push(sample.iops);
    current.throughputMbps.push(sample.throughputMbps);
    byDatabase.set(sample.databaseName, current);
  }

  const sizes = databaseSizes(storageRows);
  const databases: DatabaseAttribution[] = [...byDatabase.entries()].map(([databaseName, values]) => {
    const iops = distribution(values.iops);
    const throughputMbps = distribution(values.throughputMbps);
    return {
      databaseName,
      iops,
      throughputMbps,
      sizeGb: sizes.get(databaseName)
    } satisfies DatabaseAttribution;
  });

  const totalIopsP95 = databases.reduce((sum, database) => sum + (database.iops?.p95 ?? 0), 0);
  for (const database of databases) {
    if (database.databaseName.toLowerCase() === "tempdb" && totalIopsP95 > 0) {
      database.tempdbSharePct = Math.round(((database.iops?.p95 ?? 0) / totalIopsP95) * 10000) / 100;
    }
  }

  return databases.sort((left, right) => scoreDatabase(right) - scoreDatabase(left));
}

function memoryPressureFromRow(row: CsvRow): number {
  const current = numberFrom(row.SQLCurrMemUsageMB ?? row.sqlcurrmemusagemb);
  const target = numberFrom(row.SQLMaxMemTargetMB ?? row.sqlmaxmemtargetmb);
  if (target <= 0) return 0;
  return Math.min(100, (current / target) * 100);
}

function totalDatabaseSize(rows: CsvRow[]): number | undefined {
  if (rows.length === 0) return undefined;
  const explicitTotal = rows.map((row) => numberFrom(row.TotalDBSizeGB ?? row.totaldbsizegb)).find((value) => value > 0);
  if (explicitTotal !== undefined) return explicitTotal;
  const sizes = [...databaseSizes(rows).values()];
  if (sizes.length === 0) return undefined;
  return Math.round(sizes.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

function databaseSizes(rows: CsvRow[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const row of rows) {
    const databaseName = row.DBName || row.DatabaseName || row.databaseName;
    const size = numberFrom(row.SizeGB ?? row.DatabaseSizeGB ?? row.TotalSizeGB ?? row.sizegb);
    if (databaseName && size > 0) sizes.set(databaseName, size);
  }
  return sizes;
}

function scoreDatabase(database: DatabaseAttribution): number {
  return p95(database.iops) + p95(database.throughputMbps) + (database.sizeGb ?? 0) / 100;
}

function p95(distributionValue: MetricDistribution | undefined): number {
  return distributionValue?.p95 ?? zeroDistribution.p95;
}

function estimateCollectionHours(...rowSets: CsvRow[][]): number {
  const timestamps = rowSets.flatMap((rows) => rows.flatMap((row) => Object.values(row).filter(looksLikeDate)));
  const parsed = timestamps.map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value));
  if (parsed.length < 2) return 0;
  return Math.round(((Math.max(...parsed) - Math.min(...parsed)) / 3600000) * 100) / 100;
}

function looksLikeDate(value: string): boolean {
  return /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(value);
}