import type {
  CpuPressureEvidence,
  DatabaseAttribution,
  EditionDatabaseEvidence,
  EditionWorkloadEvidence,
  FileLatencyEvidence,
  MemoryWorkloadSample,
  MetricDistribution,
  PhysicalIoEvidence,
  TempdbUsageEvidence,
  WaitStatEvidence,
  WorkloadEvidence,
  WorkloadProfile
} from "../contracts/types.js";
import { parseCsv, type CsvRow } from "./csv.js";
import { distribution, numberFrom, zeroDistribution } from "./stats.js";
import { buildCanonicalWorkloadSampleSeries } from "./synchronized-samples.js";
import { assessEvidenceWindow } from "../evidence-window/index.js";
import { buildMemoryEvidenceFromSamples } from "../memory/index.js";
import { buildPhysicalIoEvidence } from "../io/index.js";

export interface ExistingCollectorCsvSet {
  cpuCsv: string;
  cpuInfoCsv?: string;
  memoryCsv?: string;
  workloadSamplesCsv?: string;
  memorySamplesCsv?: string;
  memoryDiagnosticsCsv?: string;
  ioCsv?: string;
  storageCsv?: string;
  dbCpuRequestCsv?: string;
  waitStatsCsv?: string;
  fileIoCsv?: string;
  fileIoSamplesCsv?: string;
  tempdbUsageCsv?: string;
  tempdbSamplesCsv?: string;
  editionCompatibilityCsv?: string;
}

interface IoSample {
  databaseName: string;
  sampleId: string;
  iops: number;
  throughputMbps: number;
}

export function normalizeExistingCollectorCsvs(csvs: ExistingCollectorCsvSet): WorkloadProfile {
  const cpuRows = parseCsv(csvs.cpuCsv);
  const cpuSamples = cpuRows.map((row) => numberFrom(row.SqlSerCpuUT ?? row.sqlsercpuut ?? row.CPU ?? row.cpu));
  const legacyMemoryRows = csvs.memoryCsv ? parseCsv(csvs.memoryCsv) : [];
  const workloadSampleRows = csvs.workloadSamplesCsv ? parseCsv(csvs.workloadSamplesCsv) : [];
  const consolidatedMemoryRows = workloadSampleRows.filter(isMemoryWorkloadSampleRow);
  const consolidatedFileIoRows = workloadSampleRows.filter(isFileIoWorkloadSampleRow);
  const consolidatedTempdbRows = workloadSampleRows.filter(isTempdbWorkloadSampleRow);
  const splitMemoryRows = csvs.memorySamplesCsv ? parseCsv(csvs.memorySamplesCsv) : [];
  const costOptimizationMemoryRows = consolidatedMemoryRows.length > 0
    ? consolidatedMemoryRows
    : splitMemoryRows;
  const ioRows = csvs.ioCsv ? parseCsv(csvs.ioCsv) : [];
  const storageRows = csvs.storageCsv ? parseCsv(csvs.storageCsv) : [];
  const dbCpuRows = csvs.dbCpuRequestCsv ? parseCsv(csvs.dbCpuRequestCsv) : [];
  const memoryDiagnosticsRows = csvs.memoryDiagnosticsCsv ? parseCsv(csvs.memoryDiagnosticsCsv) : [];
  const memoryRows = mergeMemoryRows(legacyMemoryRows, costOptimizationMemoryRows, memoryDiagnosticsRows);
  const waitRows = csvs.waitStatsCsv ? parseCsv(csvs.waitStatsCsv) : [];
  const fileIoRows = csvs.fileIoCsv ? parseCsv(csvs.fileIoCsv) : [];
  const splitFileIoSampleRows = csvs.fileIoSamplesCsv ? parseCsv(csvs.fileIoSamplesCsv) : [];
  const fileIoSampleRows = consolidatedFileIoRows.length > 0
    ? consolidatedFileIoRows
    : splitFileIoSampleRows;
  const tempdbUsageRows = csvs.tempdbUsageCsv ? parseCsv(csvs.tempdbUsageCsv) : [];
  const splitTempdbSampleRows = csvs.tempdbSamplesCsv ? parseCsv(csvs.tempdbSamplesCsv) : [];
  const tempdbSampleRows = consolidatedTempdbRows.length > 0
    ? consolidatedTempdbRows
    : splitTempdbSampleRows;
  const editionCompatibilityRows = csvs.editionCompatibilityCsv
    ? parseCsv(csvs.editionCompatibilityCsv)
    : [];

  const ioSamples = ioRows.map(toIoSample);
  const serverSamples = aggregateServerIoSamples(ioSamples);
  const sampleSeries = buildCanonicalWorkloadSampleSeries(
    cpuRows,
    memoryRows,
    fileIoSampleRows.length > 0 ? fileIoSampleRows : ioRows
  );
  const physicalIo = fileIoSampleRows.length > 0
    ? buildPhysicalIoEvidence(sampleSeries.databaseIo)
    : undefined;
  const databaseAttribution = physicalIo?.databaseSamples?.length
    ? aggregatePhysicalDatabaseAttribution(physicalIo, storageRows, dbCpuRows)
    : aggregateDatabaseAttribution(ioSamples, storageRows, dbCpuRows);
  const evidence = buildWorkloadEvidence(
    databaseAttribution,
    sampleSeries.memory,
    waitRows,
    fileIoRows.length > 0 ? fileIoRows : latestFileIoRows(fileIoSampleRows),
    tempdbUsageRows,
    tempdbSampleRows,
    editionCompatibilityRows
  );
  const evidenceWindow = assessEvidenceWindow(sampleSeries);

  return {
    collectionHours: evidenceWindow.durationHours,
    evidenceWindow,
    cpuPct: distribution(cpuSamples),
    cpuPressure: buildCpuPressureEvidence(cpuSamples),
    memoryPressurePct: memoryRows.length > 0 ? distribution(memoryRows.map(memoryPressureFromRow)) : undefined,
    pageLifeExpectancySeconds: memoryRows.length > 0
      ? distribution(memoryRows.map((row) => numberFrom(row.OverallPleSeconds ?? row.PLE ?? row.ple)))
      : undefined,
    iops: physicalIo && physicalIo.samples.length > 0
      ? physicalIo.totalIops
      : distribution(serverSamples.map((sample) => sample.iops)),
    throughputMbps: physicalIo && physicalIo.samples.length > 0
      ? physicalIo.totalMibPerSec
      : distribution(serverSamples.map((sample) => sample.throughputMbps)),
    totalDatabaseSizeGb: totalDatabaseSize(storageRows),
    databases: databaseAttribution,
    evidence,
    sampleSeries,
    physicalIo
  };
}

export { buildCanonicalWorkloadSampleSeries } from "./synchronized-samples.js";

function isMemoryWorkloadSampleRow(row: CsvRow): boolean {
  return normalizedSampleType(row) === "memory";
}

function isFileIoWorkloadSampleRow(row: CsvRow): boolean {
  return normalizedSampleType(row) === "file_io";
}

function isTempdbWorkloadSampleRow(row: CsvRow): boolean {
  return normalizedSampleType(row) === "tempdb";
}

function normalizedSampleType(row: CsvRow): string {
  return (row.SampleType ?? row.sampleType ?? row.sample_type ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

function mergeMemoryRows(
  legacyRows: CsvRow[],
  costOptimizationRows: CsvRow[],
  diagnosticsRows: CsvRow[]
): CsvRow[] {
  const merged = new Map<string, CsvRow>();

  for (const [sourceIndex, rows] of [legacyRows, costOptimizationRows].entries()) {
    for (const [rowIndex, row] of rows.entries()) {
      const key = memoryRowKey(row, `source-${sourceIndex}-${rowIndex}`);
      merged.set(key, { ...(merged.get(key) ?? {}), ...row });
    }
  }

  for (const [rowIndex, row] of diagnosticsRows.entries()) {
    const key = memoryRowKey(row, `diagnostic-${rowIndex}`);
    const pivoted = merged.get(key) ?? {
      CollectionTime: row.CollectionTime ?? row.collectionTime ?? row.SQL_CollectionTime ?? ""
    };
    applyDiagnosticCounter(pivoted, row);
    merged.set(key, pivoted);
  }

  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row);
}

function memoryRowKey(row: CsvRow, fallback: string): string {
  const timestamp = row.CollectionTime ?? row.collectionTime ?? row.SQL_CollectionTime;
  if (!timestamp) return fallback;
  const timestampMs = parseCollectorTimestampMs(timestamp);
  if (!Number.isFinite(timestampMs)) return `${timestamp}|${fallback}`;
  return new Date(Math.floor(timestampMs / 60_000) * 60_000).toISOString();
}

function parseCollectorTimestampMs(timestamp: string): number {
  const direct = Date.parse(timestamp);
  if (Number.isFinite(direct)) return direct;
  return Date.parse(timestamp.replace(" ", "T"));
}

function applyDiagnosticCounter(target: CsvRow, row: CsvRow): void {
  const counterName = normalizeCounterName(row.counter_name ?? row.CounterName ?? row.counterName);
  const rawValue = numberFrom(row.cntr_value ?? row.CounterValue ?? row.counterValue);
  const mappings: Record<string, [string, number]> = {
    "memory grants pending": ["MemoryGrantsPending", rawValue],
    "memory grants outstanding": ["MemoryGrantsOutstanding", rawValue],
    "granted workspace memory (kb)": ["GrantedWorkspaceMemoryKb", rawValue],
    "total server memory (kb)": ["SqlCommittedMemoryMb", rawValue / 1024],
    "target server memory (kb)": ["SqlTargetMemoryMb", rawValue / 1024],
    "page life expectancy": ["OverallPleSeconds", rawValue],
    "buffer cache hit ratio": ["BufferCacheHitRatio", rawValue],
    "buffer cache hit ratio base": ["BufferCacheHitRatioBase", rawValue],
    "page reads/sec": ["PageReadsPerSec", rawValue],
    "page writes/sec": ["PageWritesPerSec", rawValue],
    "lazy writes/sec": ["LazyWritesPerSec", rawValue],
    "batch requests/sec": ["BatchRequestsPerSec", rawValue]
  };
  const mapped = mappings[counterName];
  if (mapped) target[mapped[0]] = String(mapped[1]);
}

function buildCpuPressureEvidence(samples: number[]): CpuPressureEvidence {
  const highCpuThresholdPct = 70;
  let highCpuSamples = 0;
  let currentStreak = 0;
  let longestHighCpuStreakSamples = 0;

  for (const sample of samples) {
    if (sample >= highCpuThresholdPct) {
      highCpuSamples += 1;
      currentStreak += 1;
      longestHighCpuStreakSamples = Math.max(longestHighCpuStreakSamples, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return {
    sampleCount: samples.length,
    highCpuThresholdPct,
    highCpuSamplePct: samples.length > 0 ? round2((highCpuSamples / samples.length) * 100) : 0,
    longestHighCpuStreakSamples,
    sustainedPressure: distribution(samples).p95 > highCpuThresholdPct
  };
}

export function normalizeCollectorOutput(): WorkloadProfile {
  throw new Error("normalizeCollectorOutput requires ZIP/file loading, which is not implemented yet. Use normalizeExistingCollectorCsvs for parsed CSV text.");
}

function toIoSample(row: CsvRow): IoSample {
  const bRead = numberFrom(row.BRead ?? row.bread);
  const bWritten = numberFrom(row.BWritten ?? row.bwritten);
  const explicitThroughput = numberFrom(
    row.Throuput
      ?? row.Throughput
      ?? row.throughput
      ?? row.ThroughputMbps
      ?? row.ThroughputMBps
      ?? row.ThroughputMiBps
      ?? row.throughputMbps
      ?? row.throughputMBps
      ?? row.throughputMiBps
  );
  const throughputMbps = explicitThroughput > 0 ? explicitThroughput : (bRead + bWritten) / 60 / 1048576;
  const explicitIops = numberFrom(
    row.IOPS
      ?? row.Iops
      ?? row.iops
      ?? row.TotalIopsPerSecond
      ?? row.TotalIOPsPerSecond
      ?? row.TotalIOPSPerSecond
      ?? row.totalIopsPerSecond
  );
  const readWriteIops = numberFrom(row.ReadIOPS ?? row.ReadIops ?? row.readIops ?? row.read_iops)
    + numberFrom(row.WriteIOPS ?? row.WriteIops ?? row.writeIops ?? row.write_iops);
  const rawIops = numberFrom(row.TotalIOPs ?? row.TotalIOPS ?? row.totaliops);
  const databaseName = row.DBName || row.DatabaseName || row.databaseName || "unknown";
  const isServerLevelSample = databaseName === "unknown";
  const iops = explicitIops > 0
    ? explicitIops
    : readWriteIops > 0
      ? readWriteIops
      : isServerLevelSample
        ? rawIops
        : rawIops / 60;

  return {
    databaseName,
    sampleId: row.Sample_ID || row.SampleId || row.sampleId || row.CollectionTime || row.collectionTime || "single",
    iops,
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

function aggregateDatabaseAttribution(samples: IoSample[], storageRows: CsvRow[], dbCpuRows: CsvRow[]): DatabaseAttribution[] {
  const byDatabase = new Map<string, { iops: number[]; throughputMbps: number[] }>();

  for (const sample of samples) {
    const current = byDatabase.get(sample.databaseName) ?? { iops: [], throughputMbps: [] };
    current.iops.push(sample.iops);
    current.throughputMbps.push(sample.throughputMbps);
    byDatabase.set(sample.databaseName, current);
  }

  const sizes = databaseSizes(storageRows);
  const cpuShares = advisoryCpuShares(dbCpuRows);
  const databases: DatabaseAttribution[] = [...byDatabase.entries()].map(([databaseName, values]) => {
    const iops = distribution(values.iops);
    const throughputMbps = distribution(values.throughputMbps);
    return {
      databaseName,
      iops,
      throughputMbps,
      sizeGb: sizes.get(databaseName),
      advisoryCpuSharePct: cpuShares.get(databaseName)
    } satisfies DatabaseAttribution;
  });

  return databases.sort((left, right) => scoreDatabase(right) - scoreDatabase(left));
}

function aggregatePhysicalDatabaseAttribution(
  physicalIo: PhysicalIoEvidence,
  storageRows: CsvRow[],
  dbCpuRows: CsvRow[]
): DatabaseAttribution[] {
  const byDatabase = new Map<string, {
    iops: number[];
    throughputMibPerSec: number[];
    weightedOperations: number;
    weightedMib: number;
  }>();

  for (const sample of physicalIo.databaseSamples ?? []) {
    const current = byDatabase.get(sample.databaseName) ?? {
      iops: [],
      throughputMibPerSec: [],
      weightedOperations: 0,
      weightedMib: 0
    };
    current.iops.push(sample.totalIops);
    current.throughputMibPerSec.push(sample.totalMibPerSec);
    current.weightedOperations += sample.totalIops * sample.elapsedSeconds;
    current.weightedMib += sample.totalMibPerSec * sample.elapsedSeconds;
    byDatabase.set(sample.databaseName, current);
  }

  const sizes = databaseSizes(storageRows);
  const cpuShares = advisoryCpuShares(dbCpuRows);
  const totalOperations = [...byDatabase.values()]
    .reduce((sum, database) => sum + database.weightedOperations, 0);
  const totalMib = [...byDatabase.values()]
    .reduce((sum, database) => sum + database.weightedMib, 0);

  return [...byDatabase.entries()].map(([databaseName, values]) => ({
    databaseName,
    iops: distribution(values.iops),
    throughputMbps: distribution(values.throughputMibPerSec),
    iopsSharePct: totalOperations > 0
      ? round2(values.weightedOperations / totalOperations * 100)
      : undefined,
    throughputSharePct: totalMib > 0
      ? round2(values.weightedMib / totalMib * 100)
      : undefined,
    sizeGb: sizes.get(databaseName),
    tempdbSharePct: databaseName.toLowerCase() === "tempdb" && totalOperations > 0
      ? round2(values.weightedOperations / totalOperations * 100)
      : undefined,
    advisoryCpuSharePct: cpuShares.get(databaseName)
  } satisfies DatabaseAttribution))
    .sort(comparePhysicalDatabaseAttribution);
}

function memoryPressureFromRow(row: CsvRow): number {
  const current = numberFrom(row.SqlCommittedMemoryMb ?? row.SQLCurrMemUsageMB ?? row.sqlcurrmemusagemb);
  const target = numberFrom(row.SqlTargetMemoryMb ?? row.SQLMaxMemTargetMB ?? row.sqlmaxmemtargetmb);
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

function advisoryCpuShares(rows: CsvRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const databaseName = row.DBName || row.DatabaseName || row.databaseName;
    const cpu = numberFrom(row.CpuTimeMs ?? row.cpu_time_ms ?? row.CPUTimeMs ?? row.cputimems);
    if (databaseName && cpu > 0) {
      totals.set(databaseName, (totals.get(databaseName) ?? 0) + cpu);
    }
  }

  const totalCpu = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const shares = new Map<string, number>();
  if (totalCpu <= 0) return shares;

  for (const [databaseName, cpu] of totals.entries()) {
    shares.set(databaseName, Math.round((cpu / totalCpu) * 10000) / 100);
  }
  return shares;
}

function buildWorkloadEvidence(
  databases: DatabaseAttribution[],
  memorySamples: MemoryWorkloadSample[],
  waitRows: CsvRow[],
  fileIoRows: CsvRow[],
  tempdbUsageRows: CsvRow[],
  tempdbSampleRows: CsvRow[],
  editionCompatibilityRows: CsvRow[]
): WorkloadEvidence {
  return {
    memory: buildMemoryEvidenceFromSamples(memorySamples),
    edition: buildEditionWorkloadEvidence(editionCompatibilityRows),
    topDatabasesByIops: topDatabasesBy(databases, "iops"),
    topDatabasesByThroughput: topDatabasesBy(databases, "throughput"),
    tempdbIoSharePct: databases.find((database) => database.databaseName.toLowerCase() === "tempdb")?.tempdbSharePct,
    fileLatency: buildFileLatencyEvidence(fileIoRows),
    tempdbUsage: buildTempdbUsageEvidence(tempdbUsageRows, tempdbSampleRows),
    waitStats: buildWaitStatEvidence(waitRows)
  };
}

function buildEditionWorkloadEvidence(rows: CsvRow[]): EditionWorkloadEvidence | undefined {
  if (rows.length === 0) return undefined;
  const byDatabase = new Map<string, CsvRow[]>();

  for (const row of rows) {
    const databaseName = row.DatabaseName ?? row.DBName ?? row.databaseName;
    if (!databaseName) continue;
    const databaseRows = byDatabase.get(databaseName) ?? [];
    databaseRows.push(row);
    byDatabase.set(databaseName, databaseRows);
  }

  const databases: EditionDatabaseEvidence[] = [...byDatabase.entries()]
    .map(([databaseName, databaseRows]) => {
      const auditRow = databaseRows.find((row) =>
        normalizeEvidenceType(row.EvidenceType) === "database_audit"
      );
      const auditStatus: EditionDatabaseEvidence["auditStatus"] =
        auditRow?.AuditStatus?.trim().toLowerCase() === "complete"
        ? "complete"
        : "failed";
      const enterpriseFeatures = databaseRows
        .filter((row) => normalizeEvidenceType(row.EvidenceType) === "persisted_sku_feature")
        .map((row) => row.FeatureName?.trim())
        .filter((feature): feature is string => Boolean(feature));

      return {
        databaseName,
        auditStatus,
        enterpriseFeatures: [...new Set(enterpriseFeatures)].sort(),
        columnstoreSegmentCacheMb: editionMetric(
          databaseRows,
          "columnstore_segment_cache"
        ),
        memoryOptimizedAllocatedMb: editionMetric(
          databaseRows,
          "memory_optimized_allocated"
        ),
        memoryOptimizedUsedMb: editionMetric(
          databaseRows,
          "memory_optimized_used"
        )
      };
    })
    .sort((left, right) => left.databaseName.localeCompare(right.databaseName));

  return {
    source: "collector",
    databases,
    auditComplete: databases.length > 0
      && databases.every((database) => database.auditStatus === "complete")
  };
}

function editionMetric(rows: CsvRow[], evidenceType: string): number | undefined {
  const value = rows.find((row) =>
    normalizeEvidenceType(row.EvidenceType) === evidenceType
  )?.ValueMb;
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeEvidenceType(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function buildFileLatencyEvidence(rows: CsvRow[]): FileLatencyEvidence[] {
  return rows.map((row) => {
    const reads = numberFrom(row.num_of_reads ?? row.NumReads ?? row.Reads);
    const writes = numberFrom(row.num_of_writes ?? row.NumWrites ?? row.Writes);
    const readStall = numberFrom(row.io_stall_read_ms ?? row.IoStallReadMs);
    const writeStall = numberFrom(row.io_stall_write_ms ?? row.IoStallWriteMs);
    const totalStall = numberFrom(row.io_stall ?? row.IoStallMs);
    const readLatencyMs = reads > 0 ? round2(readStall / reads) : undefined;
    const writeLatencyMs = writes > 0 ? round2(writeStall / writes) : undefined;
    const totalLatencyMs = reads + writes > 0 ? round2((totalStall || readStall + writeStall) / (reads + writes)) : undefined;
    const fileType = row.type_desc ?? row.file_type ?? row.FileType;
    const advisory = [
      readLatencyMs !== undefined ? `Observed average read latency: ${readLatencyMs} ms.` : undefined,
      writeLatencyMs !== undefined ? `Observed average write latency: ${writeLatencyMs} ms.` : undefined,
      totalLatencyMs !== undefined ? `Observed average total latency: ${totalLatencyMs} ms.` : undefined
    ].filter((value): value is string => Boolean(value));

    return {
      databaseName: row.DBName || row.DatabaseName || row.databaseName || "unknown",
      fileType,
      readLatencyMs,
      writeLatencyMs,
      totalLatencyMs,
      advisory
    };
  }).filter((item) => item.readLatencyMs !== undefined || item.writeLatencyMs !== undefined || item.totalLatencyMs !== undefined)
    .sort((left, right) => (right.totalLatencyMs ?? 0) - (left.totalLatencyMs ?? 0))
    .slice(0, 10);
}

function latestFileIoRows(rows: CsvRow[]): CsvRow[] {
  const latest = new Map<string, { timestampMs: number; row: CsvRow }>();
  for (const row of rows) {
    const timestamp = row.CollectionTime ?? row.collectionTime;
    const timestampMs = timestamp ? parseCollectorTimestampMs(timestamp) : Number.NaN;
    if (!Number.isFinite(timestampMs)) continue;
    const key = [
      row.database_id ?? row.Database_ID ?? row.DatabaseId ?? row.DBName ?? row.DatabaseName ?? row.databaseName ?? "unknown",
      row.file_id ?? row.FileId ?? "database"
    ].join("|");
    const existing = latest.get(key);
    if (!existing || timestampMs >= existing.timestampMs) {
      latest.set(key, { timestampMs, row });
    }
  }
  return [...latest.values()]
    .sort((left, right) => left.timestampMs - right.timestampMs)
    .map((entry) => entry.row);
}

function buildTempdbUsageEvidence(
  representativeRows: CsvRow[],
  sampleRows: CsvRow[]
): TempdbUsageEvidence | undefined {
  if (representativeRows.length === 0 && sampleRows.length === 0) return undefined;
  const representativeAllocatedMb = representativeRows.length > 0
    ? round2(sumNumbers(representativeRows, (row) => numberFrom(row.AllocatedMB ?? row.AllocatedMb ?? row.allocated_mb)))
    : undefined;
  const peakAllocatedMb = sampleRows.length > 0
    ? round2(maxNumber(sampleRows, (row) => numberFrom(row.AllocatedMB ?? row.AllocatedMb ?? row.allocated_mb)))
    : undefined;

  return {
    totalMb: representativeRows.length > 0
      ? round2(sumNumbers(representativeRows, (row) => numberFrom(row.TotalMB ?? row.TotalMb ?? row.total_mb)))
      : undefined,
    allocatedMb: representativeAllocatedMb,
    representativeAllocatedMb,
    peakAllocatedMb,
    userObjectMb: representativeRows.length > 0
      ? round2(sumNumbers(representativeRows, (row) => numberFrom(row.UserObjectMB ?? row.UserObjectMb ?? row.user_objects_MB ?? row.user_object_mb)))
      : undefined,
    internalObjectMb: representativeRows.length > 0
      ? round2(sumNumbers(representativeRows, (row) => numberFrom(row.InternalObjectMB ?? row.InternalObjectMb ?? row.internal_objects_MB ?? row.internal_object_mb)))
      : undefined,
    versionStoreMb: representativeRows.length > 0
      ? round2(sumNumbers(representativeRows, (row) => numberFrom(row.VersionStoreMB ?? row.VersionStoreMb ?? row.version_store_MB ?? row.version_store_mb)))
      : undefined
  };
}

function buildWaitStatEvidence(rows: CsvRow[]): WaitStatEvidence[] {
  return rows.map((row) => ({
    waitType: row.wait_type ?? row.WaitType ?? "unknown",
    waitTimeMs: numberFrom(row.wait_time_ms ?? row.WaitTimeMs),
    signalWaitTimeMs: numberFrom(row.signal_wait_time_ms ?? row.SignalWaitTimeMs)
  })).filter((row) => row.waitTimeMs > 0)
    .sort((left, right) => right.waitTimeMs - left.waitTimeMs)
    .slice(0, 10);
}

function topDatabasesBy(databases: DatabaseAttribution[], metric: "iops" | "throughput"): string[] {
  return [...databases]
    .sort((left, right) => databaseShare(right, metric) - databaseShare(left, metric))
    .filter((database) => databaseShare(database, metric) > 0)
    .slice(0, 5)
    .map((database) => database.databaseName);
}

function comparePhysicalDatabaseAttribution(left: DatabaseAttribution, right: DatabaseAttribution): number {
  const iopsDifference = databaseShare(right, "iops") - databaseShare(left, "iops");
  if (iopsDifference !== 0) return iopsDifference;
  const throughputDifference = databaseShare(right, "throughput") - databaseShare(left, "throughput");
  if (throughputDifference !== 0) return throughputDifference;
  return left.databaseName.localeCompare(right.databaseName);
}

function databaseShare(database: DatabaseAttribution, metric: "iops" | "throughput"): number {
  return metric === "iops"
    ? database.iopsSharePct ?? 0
    : database.throughputSharePct ?? 0;
}

function maxNumber(rows: CsvRow[], valueOf: (row: CsvRow) => number): number {
  return rows.reduce((max, row) => Math.max(max, valueOf(row)), 0);
}

function minPositiveNumber(rows: CsvRow[], valueOf: (row: CsvRow) => number): number {
  const values = rows.map(valueOf).filter((value) => value > 0);
  return values.length > 0 ? Math.min(...values) : 0;
}

function maxCounterValue(rows: CsvRow[], counterName: string): number {
  const wanted = normalizeCounterName(counterName);
  return maxNumber(rows, (row) => normalizeCounterName(row.counter_name ?? row.CounterName ?? row.counterName) === wanted
    ? numberFrom(row.cntr_value ?? row.CounterValue ?? row.counterValue)
    : 0);
}

function minPositiveCounterValue(rows: CsvRow[], counterName: string): number {
  const wanted = normalizeCounterName(counterName);
  return minPositiveNumber(rows, (row) => normalizeCounterName(row.counter_name ?? row.CounterName ?? row.counterName) === wanted
    ? numberFrom(row.cntr_value ?? row.CounterValue ?? row.counterValue)
    : 0);
}

function normalizeCounterName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sumNumbers(rows: CsvRow[], valueOf: (row: CsvRow) => number): number {
  return rows.reduce((sum, row) => sum + valueOf(row), 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
function scoreDatabase(database: DatabaseAttribution): number {
  return p95(database.iops) + p95(database.throughputMbps) + (database.sizeGb ?? 0) / 100;
}

function p95(distributionValue: MetricDistribution | undefined): number {
  return distributionValue?.p95 ?? zeroDistribution.p95;
}
