import type {
  CanonicalWorkloadSampleSeries,
  CpuWorkloadSample,
  DatabaseIoWorkloadSample,
  MemoryWorkloadSample,
  SynchronizedWorkloadSample,
  WorkloadSampleIssue,
  WorkloadSampleSource
} from "../contracts/types.js";
import type { CsvRow } from "./csv.js";

const ALIGNMENT_INTERVAL_MS = 60_000;

export function buildCanonicalWorkloadSampleSeries(
  cpuRows: CsvRow[],
  memoryRows: CsvRow[],
  ioRows: CsvRow[]
): CanonicalWorkloadSampleSeries {
  const issues: WorkloadSampleIssue[] = [];
  const cpu = parseCpuSamples(cpuRows, issues);
  const memory = parseMemorySamples(memoryRows, issues);
  const databaseIo = parseDatabaseIoSamples(ioRows, issues);

  detectSourceContinuity("cpu", cpu, issues);
  detectSourceContinuity("memory", memory, issues);
  detectSourceContinuity("database_io", databaseIo, issues);
  attachIoElapsedTime(databaseIo, issues);
  detectIoFileCompleteness(databaseIo, issues);

  return {
    alignmentIntervalSeconds: 60,
    cpu,
    memory,
    databaseIo,
    synchronized: synchronizeSamples(cpu, memory, databaseIo, issues),
    issues
  };
}

function parseCpuSamples(rows: CsvRow[], issues: WorkloadSampleIssue[]): CpuWorkloadSample[] {
  const samples: CpuWorkloadSample[] = [];
  let previousTimestampMs: number | undefined;

  for (const row of rows) {
    const parsedTime = parseTimestamp(row.Collectiontime ?? row.CollectionTime ?? row.collectionTime);
    if (!parsedTime) {
      issues.push({
        code: "invalid_sample",
        source: "cpu",
        message: "CPU sample has a missing or invalid collection timestamp."
      });
      continue;
    }

    if (previousTimestampMs !== undefined && parsedTime.timestampMs < previousTimestampMs) {
      issues.push({
        code: "out_of_order",
        source: "cpu",
        timestamp: parsedTime.timestamp,
        sampleKey: parsedTime.sampleKey,
        message: "CPU sample timestamp is earlier than the preceding CPU row."
      });
    }
    previousTimestampMs = parsedTime.timestampMs;

    const sqlCpuPct = requiredNumber(row.SqlSerCpuUT ?? row.sqlsercpuut ?? row.CPU ?? row.cpu);
    const otherCpuPct = requiredNumber(row.OtherProCpuUT ?? row.otherprocpuut);
    const systemIdlePct = requiredNumber(row.SystemIdle ?? row.systemidle);
    if (
      sqlCpuPct === undefined
      || otherCpuPct === undefined
      || systemIdlePct === undefined
      || !isPercent(sqlCpuPct)
      || !isPercent(otherCpuPct)
      || !isPercent(systemIdlePct)
    ) {
      issues.push({
        code: "invalid_sample",
        source: "cpu",
        timestamp: parsedTime.timestamp,
        sampleKey: parsedTime.sampleKey,
        message: "CPU sample must contain SQL CPU, Other CPU, and system idle values between 0 and 100."
      });
      continue;
    }

    samples.push({
      ...parsedTime,
      sqlCpuPct,
      otherCpuPct,
      systemIdlePct
    });
  }

  detectDuplicateKeys("cpu", samples, (sample) => sample.sampleKey, issues);
  return samples;
}

function parseMemorySamples(rows: CsvRow[], issues: WorkloadSampleIssue[]): MemoryWorkloadSample[] {
  const samples: MemoryWorkloadSample[] = [];
  let previousTimestampMs: number | undefined;

  for (const row of rows) {
    const parsedTime = parseTimestamp(row.SQL_CollectionTime ?? row.CollectionTime ?? row.collectionTime);
    if (!parsedTime) {
      issues.push({
        code: "invalid_sample",
        source: "memory",
        message: "Memory sample has a missing or invalid collection timestamp."
      });
      continue;
    }

    if (previousTimestampMs !== undefined && parsedTime.timestampMs < previousTimestampMs) {
      issues.push({
        code: "out_of_order",
        source: "memory",
        timestamp: parsedTime.timestamp,
        sampleKey: parsedTime.sampleKey,
        message: "Memory sample timestamp is earlier than the preceding memory row."
      });
    }
    previousTimestampMs = parsedTime.timestampMs;

    const sample: MemoryWorkloadSample = {
      ...parsedTime,
      sqlCommittedMemoryMb: optionalNonNegativeNumber(
        row.SqlCommittedMemoryMb ?? row.SQLCurrMemUsageMB ?? row.sqlcurrmemusagemb
      ),
      sqlTargetMemoryMb: optionalNonNegativeNumber(
        row.SqlTargetMemoryMb ?? row.SQLMaxMemTargetMB ?? row.sqlmaxmemtargetmb
      ),
      osTotalMemoryMb: optionalNonNegativeNumber(
        row.OsTotalMemoryMb ?? row.OSTotalMemoryMB ?? row.ostotalmemorymb
      ),
      osAvailableMemoryMb: optionalNonNegativeNumber(
        row.OsAvailableMemoryMb ?? row.OSAVAMemoryMB ?? row.OSAvailableMemoryMB ?? row.osavamemorymb
      ),
      pageLifeExpectancySeconds: optionalNonNegativeNumber(
        row.OverallPleSeconds ?? row.PLE ?? row.ple
      ),
      stolenServerMemoryMb: optionalNonNegativeNumber(row.StolenServerMem ?? row.stolenservermem),
      memoryClerksJson: row.MemoryClerksData ?? row.memoryclerksdata,
      memoryGrantsPending: optionalNonNegativeNumber(row.MemoryGrantsPending),
      memoryGrantsOutstanding: optionalNonNegativeNumber(row.MemoryGrantsOutstanding),
      grantedWorkspaceMemoryKb: optionalNonNegativeNumber(row.GrantedWorkspaceMemoryKb),
      physicalMemoryInUseKb: optionalNonNegativeNumber(row.PhysicalMemoryInUseKb),
      processPhysicalMemoryLow: optionalBoolean(row.ProcessPhysicalMemoryLow),
      processVirtualMemoryLow: optionalBoolean(row.ProcessVirtualMemoryLow),
      systemLowMemorySignalState: optionalBoolean(row.SystemLowMemorySignalState),
      systemHighMemorySignalState: optionalBoolean(row.SystemHighMemorySignalState),
      systemMemoryStateDescription: nonEmpty(row.SystemMemoryStateDesc),
      overallPageLifeExpectancySeconds: optionalNonNegativeNumber(row.OverallPleSeconds),
      numaPleJson: row.NumaPleJson,
      bufferCacheHitRatio: optionalNonNegativeNumber(row.BufferCacheHitRatio),
      bufferCacheHitRatioBase: optionalNonNegativeNumber(row.BufferCacheHitRatioBase),
      bufferCacheHitRatioPct: bufferCacheHitRatioPct(row),
      pageReadsCounter: optionalNonNegativeNumber(row.PageReadsPerSec),
      pageWritesCounter: optionalNonNegativeNumber(row.PageWritesPerSec),
      lazyWritesCounter: optionalNonNegativeNumber(row.LazyWritesPerSec),
      batchRequestsCounter: optionalNonNegativeNumber(
        row.BatchRequestsCounter ?? row.BatchRequestsPerSec
      ),
      batchRequestsPerSec: optionalNonNegativeNumber(row.BatchRequestsActualPerSec),
      columnstoreSegmentCacheMb: optionalNonNegativeNumber(row.ColumnstoreSegmentCacheMb)
    };

    if (hasInvalidPresentNumber(row, [
      "SqlCommittedMemoryMb",
      "SQLCurrMemUsageMB",
      "sqlcurrmemusagemb",
      "SqlTargetMemoryMb",
      "SQLMaxMemTargetMB",
      "sqlmaxmemtargetmb",
      "OsTotalMemoryMb",
      "OSTotalMemoryMB",
      "ostotalmemorymb",
      "OsAvailableMemoryMb",
      "OSAVAMemoryMB",
      "OSAvailableMemoryMB",
      "osavamemorymb",
      "OverallPleSeconds",
      "PLE",
      "ple",
      "StolenServerMem",
      "stolenservermem",
      "MemoryGrantsPending",
      "MemoryGrantsOutstanding",
      "GrantedWorkspaceMemoryKb",
      "PhysicalMemoryInUseKb",
      "BufferCacheHitRatio",
      "BufferCacheHitRatioBase",
      "PageReadsPerSec",
      "PageWritesPerSec",
      "LazyWritesPerSec",
      "BatchRequestsCounter",
      "BatchRequestsPerSec",
      "BatchRequestsActualPerSec",
      "ColumnstoreSegmentCacheMb"
    ])) {
      issues.push({
        code: "invalid_sample",
        source: "memory",
        timestamp: parsedTime.timestamp,
        sampleKey: parsedTime.sampleKey,
        message: "Memory sample contains a non-numeric or negative counter value."
      });
    }

    samples.push(sample);
  }

  detectDuplicateKeys("memory", samples, (sample) => sample.sampleKey, issues);
  return samples;
}

function parseDatabaseIoSamples(rows: CsvRow[], issues: WorkloadSampleIssue[]): DatabaseIoWorkloadSample[] {
  const samples: DatabaseIoWorkloadSample[] = [];
  let previousTimestampMs: number | undefined;

  for (const row of rows) {
    const parsedTime = parseTimestamp(row.CollectionTime ?? row.collectionTime);
    if (!parsedTime) {
      issues.push({
        code: "invalid_sample",
        source: "database_io",
        databaseName: databaseNameFrom(row),
        message: "Database I/O sample has a missing or invalid collection timestamp."
      });
      continue;
    }

    if (previousTimestampMs !== undefined && parsedTime.timestampMs < previousTimestampMs) {
      issues.push({
        code: "out_of_order",
        source: "database_io",
        timestamp: parsedTime.timestamp,
        sampleKey: parsedTime.sampleKey,
        databaseName: databaseNameFrom(row),
        message: "Database I/O sample timestamp is earlier than the preceding I/O row."
      });
    }
    previousTimestampMs = parsedTime.timestampMs;

    const databaseName = databaseNameFrom(row);
    const readOperations = requiredNumber(row.Read ?? row.read ?? row.num_of_reads);
    const writeOperations = requiredNumber(row.Written ?? row.written ?? row.num_of_writes);
    const bytesRead = requiredNumber(row.BRead ?? row.bread ?? row.num_of_bytes_read);
    const bytesWritten = requiredNumber(row.BWritten ?? row.bwritten ?? row.num_of_bytes_written);
    if (
      readOperations === undefined
      || writeOperations === undefined
      || bytesRead === undefined
      || bytesWritten === undefined
    ) {
      issues.push({
        code: "invalid_sample",
        source: "database_io",
        timestamp: parsedTime.timestamp,
        sampleKey: parsedTime.sampleKey,
        databaseName,
        message: "Database I/O sample must contain read, write, bytes-read, and bytes-written counters."
      });
      continue;
    }

    const sample: DatabaseIoWorkloadSample = {
      ...parsedTime,
      sampleId: nonEmpty(row.Sample_ID ?? row.SampleId ?? row.sampleId),
      databaseId: optionalInteger(row.Database_ID ?? row.database_id ?? row.DatabaseId),
      databaseName,
      fileId: optionalInteger(row.file_id ?? row.FileId),
      fileType: nonEmpty(row.file_type ?? row.type_desc ?? row.FileType),
      isTempdb: databaseName.toLowerCase() === "tempdb",
      readOperations,
      writeOperations,
      bytesRead,
      bytesWritten,
      reportedTotalOperations: optionalNonNegativeNumber(row.TotalIOPs ?? row.TotalIOPS ?? row.totaliops),
      reportedThroughputMbps: optionalNonNegativeNumber(row.Throuput ?? row.Throughput ?? row.throughput),
      counterMode: row.num_of_reads !== undefined || row.num_of_writes !== undefined
        ? "cumulative"
        : "interval_delta",
      intervalValid: false
    };

    if ([readOperations, writeOperations, bytesRead, bytesWritten].some((value) => value < 0)) {
      issues.push({
        code: "counter_reset",
        source: "database_io",
        timestamp: parsedTime.timestamp,
        sampleKey: parsedTime.sampleKey,
        databaseName,
        message: "Database I/O sample contains a negative delta consistent with a counter reset or invalid interval."
      });
    }

    samples.push(sample);
  }

  detectDuplicateKeys(
    "database_io",
    samples,
    (sample) => [sample.sampleKey, sample.databaseId ?? sample.databaseName, sample.fileId ?? "database"].join("|"),
    issues
  );
  return samples;
}

function attachIoElapsedTime(samples: DatabaseIoWorkloadSample[], issues: WorkloadSampleIssue[]): void {
  const byCounter = new Map<string, DatabaseIoWorkloadSample[]>();

  for (const sample of samples) {
    const key = [sample.databaseId ?? sample.databaseName, sample.fileId ?? "database"].join("|");
    const series = byCounter.get(key) ?? [];
    series.push(sample);
    byCounter.set(key, series);
  }

  for (const series of byCounter.values()) {
    const ordered = [...series].sort((left, right) => left.timestampMs - right.timestampMs);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const elapsedSeconds = (current.timestampMs - previous.timestampMs) / 1000;
      current.previousTimestamp = previous.timestamp;
      current.elapsedSeconds = elapsedSeconds;
      const valuesAreValid = current.counterMode === "cumulative"
        ? current.readOperations >= previous.readOperations
          && current.writeOperations >= previous.writeOperations
          && current.bytesRead >= previous.bytesRead
          && current.bytesWritten >= previous.bytesWritten
        : current.readOperations >= 0
          && current.writeOperations >= 0
          && current.bytesRead >= 0
          && current.bytesWritten >= 0;
      current.intervalValid = elapsedSeconds > 0 && valuesAreValid;

      if (elapsedSeconds <= 0) {
        issues.push({
          code: "invalid_elapsed",
          source: "database_io",
          timestamp: current.timestamp,
          sampleKey: current.sampleKey,
          databaseName: current.databaseName,
          message: "Database I/O interval elapsed time must be greater than zero."
        });
      } else if (!valuesAreValid) {
        issues.push({
          code: "counter_reset",
          source: "database_io",
          timestamp: current.timestamp,
          sampleKey: current.sampleKey,
          databaseName: current.databaseName,
          message: "Database I/O cumulative counters decreased or an interval delta was negative."
        });
      }
    }
  }
}

function detectIoFileCompleteness(
  samples: DatabaseIoWorkloadSample[],
  issues: WorkloadSampleIssue[]
): void {
  const cumulative = samples.filter((sample) => sample.counterMode === "cumulative");
  const byTimestamp = new Map<number, Map<string, DatabaseIoWorkloadSample>>();
  for (const sample of cumulative) {
    const rows = byTimestamp.get(sample.timestampMs) ?? new Map<string, DatabaseIoWorkloadSample>();
    rows.set(ioFileKey(sample), sample);
    byTimestamp.set(sample.timestampMs, rows);
  }

  const timestamps = [...byTimestamp.keys()].sort((left, right) => left - right);
  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = byTimestamp.get(timestamps[index - 1])!;
    const current = byTimestamp.get(timestamps[index])!;
    const requiredFiles = new Set([...previous.keys(), ...current.keys()]);
    const missingFiles = [...requiredFiles].filter((key) => !previous.has(key) || !current.has(key));
    if (missingFiles.length === 0) continue;

    for (const row of current.values()) row.intervalValid = false;
    for (const key of missingFiles) {
      const evidence = current.get(key) ?? previous.get(key);
      issues.push({
        code: "missing_sample",
        source: "database_io",
        timestamp: new Date(timestamps[index]).toISOString(),
        sampleKey: sampleKey(timestamps[index]),
        databaseName: evidence?.databaseName,
        message: `Database I/O synchronized interval is missing required file ${key}; the complete instance interval was rejected.`
      });
    }
  }
}

function ioFileKey(sample: DatabaseIoWorkloadSample): string {
  return [sample.databaseId ?? sample.databaseName, sample.fileId ?? "database"].join("|");
}

function synchronizeSamples(
  cpu: CpuWorkloadSample[],
  memory: MemoryWorkloadSample[],
  databaseIo: DatabaseIoWorkloadSample[],
  issues: WorkloadSampleIssue[]
): SynchronizedWorkloadSample[] {
  const byKey = new Map<string, SynchronizedWorkloadSample>();

  for (const sample of cpu) {
    synchronizedSample(byKey, sample.sampleKey, sample.timestampMs).cpu.push(sample);
  }
  for (const sample of memory) {
    synchronizedSample(byKey, sample.sampleKey, sample.timestampMs).memory.push(sample);
  }
  for (const sample of databaseIo) {
    const synchronized = synchronizedSample(byKey, sample.sampleKey, sample.timestampMs);
    if (sample.isTempdb) {
      synchronized.tempdbIo.push(sample);
    } else {
      synchronized.userDatabaseIo.push(sample);
    }
  }

  const synchronized = [...byKey.values()].sort((left, right) => left.timestampMs - right.timestampMs);
  for (const sample of synchronized) {
    if (sample.cpu.length === 0) sample.missingSources.push("cpu");
    if (sample.memory.length === 0) sample.missingSources.push("memory");
    if (sample.userDatabaseIo.length === 0 && sample.tempdbIo.length === 0) sample.missingSources.push("database_io");
    const ioRows = [...sample.userDatabaseIo, ...sample.tempdbIo];
    sample.valid = sample.missingSources.length === 0
      && sample.cpu.length === 1
      && sample.memory.length === 1
      && ioRows.length > 0
      && ioRows.every((row) => row.intervalValid);

    for (const source of sample.missingSources) {
      issues.push({
        code: "missing_sample",
        source,
        sampleKey: sample.sampleKey,
        message: `${sourceLabel(source)} evidence is missing from synchronized sample ${sample.sampleKey}.`
      });
    }
  }

  return synchronized;
}

function synchronizedSample(
  byKey: Map<string, SynchronizedWorkloadSample>,
  sampleKey: string,
  timestampMs: number
): SynchronizedWorkloadSample {
  const existing = byKey.get(sampleKey);
  if (existing) return existing;

  const created: SynchronizedWorkloadSample = {
    sampleKey,
    timestampMs: Math.floor(timestampMs / ALIGNMENT_INTERVAL_MS) * ALIGNMENT_INTERVAL_MS,
    cpu: [],
    memory: [],
    userDatabaseIo: [],
    tempdbIo: [],
    missingSources: [],
    valid: false
  };
  byKey.set(sampleKey, created);
  return created;
}

function detectSourceContinuity<T extends { timestamp: string; timestampMs: number; sampleKey: string }>(
  source: WorkloadSampleSource,
  samples: T[],
  issues: WorkloadSampleIssue[]
): void {
  const orderedTimes = [...new Set(samples.map((sample) => sample.timestampMs))].sort((left, right) => left - right);
  for (let index = 1; index < orderedTimes.length; index += 1) {
    const previous = orderedTimes[index - 1];
    const current = orderedTimes[index];
    const gapMinutes = Math.floor((current - previous) / ALIGNMENT_INTERVAL_MS) - 1;
    if (gapMinutes > 0) {
      issues.push({
        code: "missing_sample",
        source,
        timestamp: new Date(current).toISOString(),
        sampleKey: sampleKey(current),
        message: `${sourceLabel(source)} series has a gap containing ${gapMinutes} missing collector minute sample(s).`
      });
    }
  }
}

function detectDuplicateKeys<T extends { timestamp: string; sampleKey: string }>(
  source: WorkloadSampleSource,
  samples: T[],
  keyOf: (sample: T) => string,
  issues: WorkloadSampleIssue[]
): void {
  const seen = new Set<string>();
  for (const sample of samples) {
    const key = keyOf(sample);
    if (seen.has(key)) {
      issues.push({
        code: "duplicate_sample",
        source,
        timestamp: sample.timestamp,
        sampleKey: sample.sampleKey,
        message: `${sourceLabel(source)} contains a duplicate sample for ${key}.`
      });
    }
    seen.add(key);
  }
}

function parseTimestamp(value: string | undefined): { timestamp: string; timestampMs: number; sampleKey: string } | undefined {
  const timestamp = nonEmpty(value);
  if (!timestamp) return undefined;
  const timestampMs = Date.parse(timestamp.replace(" ", "T"));
  if (!Number.isFinite(timestampMs)) return undefined;
  return {
    timestamp,
    timestampMs,
    sampleKey: sampleKey(timestampMs)
  };
}

function sampleKey(timestampMs: number): string {
  return new Date(Math.floor(timestampMs / ALIGNMENT_INTERVAL_MS) * ALIGNMENT_INTERVAL_MS).toISOString();
}

function databaseNameFrom(row: CsvRow): string {
  return nonEmpty(row.DBName ?? row.DatabaseName ?? row.databaseName) ?? "unknown";
}

function sourceLabel(source: WorkloadSampleSource): string {
  if (source === "database_io") return "Database I/O";
  return source === "cpu" ? "CPU" : "Memory";
}

function requiredNumber(value: string | undefined): number | undefined {
  const normalized = nonEmpty(value);
  if (normalized === undefined) return undefined;
  const parsed = Number(normalized.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalNonNegativeNumber(value: string | undefined): number | undefined {
  const parsed = requiredNumber(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function optionalInteger(value: string | undefined): number | undefined {
  const parsed = requiredNumber(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (normalized === undefined) return undefined;
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return undefined;
}

function bufferCacheHitRatioPct(row: CsvRow): number | undefined {
  const ratio = optionalNonNegativeNumber(row.BufferCacheHitRatio);
  const base = optionalNonNegativeNumber(row.BufferCacheHitRatioBase);
  if (ratio === undefined || base === undefined || base <= 0) return undefined;
  return Math.round((ratio / base) * 10000) / 100;
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isPercent(value: number): boolean {
  return value >= 0 && value <= 100;
}

function hasInvalidPresentNumber(row: CsvRow, keys: string[]): boolean {
  return keys.some((key) => {
    const value = row[key];
    return nonEmpty(value) !== undefined && optionalNonNegativeNumber(value) === undefined;
  });
}
