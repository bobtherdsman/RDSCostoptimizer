import type {
  LowTailMetricDistribution,
  MemoryEvidence,
  MemoryWorkloadSample,
  MetricDistribution,
  WorkloadProfile
} from "../contracts/types.js";
import { distribution } from "../parser/stats.js";
import {
  READ_IOPS_MIN_PRESSURE_PERIOD_SAMPLES,
  READ_IOPS_MIN_PRESSURE_PERIODS,
  READ_IOPS_PERSISTENCE_SAMPLE_PCT
} from "./coupling.js";

export const MEMORY_HEADROOM_PCT = 20;

type DirectMemoryPressureState =
  | "pressure_detected"
  | "isolated_pressure_detected"
  | "no_direct_pressure_detected"
  | "insufficient_evidence";

type MemorySignalCheck = readonly [string, (sample: MemoryWorkloadSample) => boolean];

const REQUIRED_MEMORY_SIGNAL_CHECKS: readonly MemorySignalCheck[] = [
  ["SQL committed/target memory", (sample) => sample.sqlCommittedMemoryMb !== undefined && sample.sqlTargetMemoryMb !== undefined],
  ["OS total/available memory", (sample) => sample.osTotalMemoryMb !== undefined && sample.osAvailableMemoryMb !== undefined],
  ["SQL process physical memory", (sample) => sample.physicalMemoryInUseKb !== undefined],
  ["Process/system low-memory flags", (sample) =>
    sample.processPhysicalMemoryLow !== undefined
    && sample.processVirtualMemoryLow !== undefined
    && sample.systemLowMemorySignalState !== undefined
    && sample.systemHighMemorySignalState !== undefined],
  ["Memory Grants Pending/Outstanding", (sample) =>
    sample.memoryGrantsPending !== undefined && sample.memoryGrantsOutstanding !== undefined],
  ["Granted Workspace Memory", (sample) => sample.grantedWorkspaceMemoryKb !== undefined],
  ["Overall PLE", (sample) =>
    sample.overallPageLifeExpectancySeconds !== undefined || sample.pageLifeExpectancySeconds !== undefined],
  ["Per-NUMA PLE", (sample) => Boolean(sample.numaPleJson)],
  ["Memory clerks/stolen memory", (sample) =>
    Boolean(sample.memoryClerksJson) && sample.stolenServerMemoryMb !== undefined],
  ["Buffer Cache Hit Ratio", (sample) => sample.bufferCacheHitRatioPct !== undefined],
  ["Page Reads/Writes and Lazy Writes", (sample) =>
    sample.pageReadsCounter !== undefined
    && sample.pageWritesCounter !== undefined
    && sample.lazyWritesCounter !== undefined]
];

const SUPPLEMENTAL_MEMORY_SIGNAL_CHECKS: readonly MemorySignalCheck[] = [
  ["Batch Requests/sec", (sample) =>
    sample.batchRequestsCounter !== undefined || sample.batchRequestsPerSec !== undefined],
  ["Columnstore segment cache", (sample) => sample.columnstoreSegmentCacheMb !== undefined]
];

export interface MemoryCandidateEvaluation {
  valid: boolean;
  failures: string[];
  currentMemoryGb?: number;
  candidateMemoryGb: number;
  memoryReductionPct?: number;
  requiredMemoryFloorGb?: number;
  pressureState: DirectMemoryPressureState;
  evidenceConfidence: "high" | "medium" | "low";
  workingSetValidationRequired: boolean;
  signalsUsed: string[];
}

export function buildMemoryEvidenceFromSamples(samples: readonly MemoryWorkloadSample[]): MemoryEvidence | undefined {
  if (samples.length === 0) return undefined;

  const sqlCommitted = values(samples, (sample) => sample.sqlCommittedMemoryMb);
  const sqlTarget = values(samples, (sample) => sample.sqlTargetMemoryMb);
  const osTotal = values(samples, (sample) => sample.osTotalMemoryMb);
  const osAvailable = values(samples, (sample) => sample.osAvailableMemoryMb);
  const osAvailablePct = samples.flatMap((sample) =>
    sample.osTotalMemoryMb && sample.osAvailableMemoryMb !== undefined
      ? [sample.osAvailableMemoryMb / sample.osTotalMemoryMb * 100]
      : []
  );
  const physicalMemory = values(samples, (sample) =>
    sample.physicalMemoryInUseKb !== undefined ? sample.physicalMemoryInUseKb / 1024 : undefined
  );
  const grantsPending = values(samples, (sample) => sample.memoryGrantsPending);
  const grantsOutstanding = values(samples, (sample) => sample.memoryGrantsOutstanding);
  const grantedWorkspace = values(samples, (sample) =>
    sample.grantedWorkspaceMemoryKb !== undefined ? sample.grantedWorkspaceMemoryKb / 1024 : undefined
  );
  const overallPle = values(samples, (sample) =>
    sample.overallPageLifeExpectancySeconds ?? sample.pageLifeExpectancySeconds
  );
  const stolen = values(samples, (sample) => sample.stolenServerMemoryMb);
  const bufferCacheHitRatio = values(samples, (sample) => sample.bufferCacheHitRatioPct);
  const pageReads = ratesFromCounters(samples, (sample) => sample.pageReadsCounter);
  const pageWrites = ratesFromCounters(samples, (sample) => sample.pageWritesCounter);
  const lazyWrites = ratesFromCounters(samples, (sample) => sample.lazyWritesCounter);
  const batchRequests = rateValues(
    samples,
    (sample) => sample.batchRequestsCounter,
    (sample) => sample.batchRequestsPerSec
  );
  const bufferPoolMemory = samples.flatMap((sample) => {
    const value = bufferPoolMemoryMb(sample);
    return value === undefined ? [] : [value];
  });
  const columnstoreSegmentCache = values(samples, (sample) => sample.columnstoreSegmentCacheMb);
  const lessElastic = samples.flatMap((sample) => {
    const value = lessElasticMemoryMb(sample);
    return value === undefined ? [] : [value.totalMb];
  });
  const osNonSqlUsed = samples.flatMap((sample) => {
    const value = lessElasticMemoryMb(sample);
    return value === undefined ? [] : [value.osNonSqlUsedMb];
  });
  const requiredMemoryFloorGb = lessElastic.length > 0
    ? round2(distribution(lessElastic).p95 * (1 + MEMORY_HEADROOM_PCT / 100) / 1024)
    : undefined;
  const pressureAssessment = directPressureAssessment(samples);
  const evidenceCompleteness = availableSignals(samples);
  const evidenceConfidence = memoryEvidenceConfidence(samples);
  const observedSqlMemoryMb = maximum([
    ...sqlCommitted,
    ...physicalMemory
  ]);
  const sqlTargetMemoryMb = maximum(sqlTarget);
  const osTotalMemoryMb = maximum(osTotal);
  const osAvailableMemoryMb = minimumPositive(osAvailable);
  const pageLifeExpectancySeconds = minimumPositive(overallPle);
  const pendingMaximum = maximum(grantsPending);

  return {
    observedSqlMemoryMb,
    sqlTargetMemoryMb,
    osTotalMemoryMb,
    osAvailableMemoryMb,
    sqlCurrentToTargetPct: observedSqlMemoryMb !== undefined && sqlTargetMemoryMb
      ? round2(observedSqlMemoryMb / sqlTargetMemoryMb * 100)
      : undefined,
    osAvailablePct: osTotalMemoryMb && osAvailableMemoryMb !== undefined
      ? round2(osAvailableMemoryMb / osTotalMemoryMb * 100)
      : undefined,
    pageLifeExpectancySeconds,
    memoryGrantsPending: pendingMaximum,
    memoryGrantsOutstanding: maximum(grantsOutstanding),
    grantedWorkspaceMemoryKb: maximum(grantedWorkspace) !== undefined
      ? round2(maximum(grantedWorkspace)! * 1024)
      : undefined,
    physicalMemoryInUseKb: maximum(physicalMemory) !== undefined
      ? round2(maximum(physicalMemory)! * 1024)
      : undefined,
    processPhysicalMemoryLow: samples.some((sample) => sample.processPhysicalMemoryLow === true),
    processVirtualMemoryLow: samples.some((sample) => sample.processVirtualMemoryLow === true),
    systemLowMemorySignalState: samples.some((sample) => sample.systemLowMemorySignalState === true),
    systemHighMemorySignalState: samples.some((sample) => sample.systemHighMemorySignalState === true),
    systemMemoryStateDescriptions: [
      ...new Set(samples.map((sample) => sample.systemMemoryStateDescription).filter((value): value is string => Boolean(value)))
    ],
    osAvailableMemoryPctLowTail: lowTailDistribution(osAvailablePct),
    sqlProcessPhysicalMemoryMb: optionalDistribution(physicalMemory),
    sqlCommittedMemoryMb: optionalDistribution(sqlCommitted),
    sqlTargetMemoryMbDistribution: optionalDistribution(sqlTarget),
    memoryGrantsPendingDistribution: optionalDistribution(grantsPending),
    memoryGrantsOutstandingDistribution: optionalDistribution(grantsOutstanding),
    grantedWorkspaceMemoryMb: optionalDistribution(grantedWorkspace),
    overallPleSeconds: lowTailDistribution(overallPle),
    numaPleSeconds: numaPleDistributions(samples),
    stolenServerMemoryMb: optionalDistribution(stolen),
    lessElasticMemoryMb: optionalDistribution(lessElastic),
    osNonSqlUsedMemoryMb: optionalDistribution(osNonSqlUsed),
    bufferCacheHitRatioPct: lowTailDistribution(bufferCacheHitRatio),
    pageReadsPerSec: optionalDistribution(pageReads),
    pageWritesPerSec: optionalDistribution(pageWrites),
    lazyWritesPerSec: optionalDistribution(lazyWrites),
    batchRequestsPerSec: optionalDistribution(batchRequests),
    bufferPoolMemoryMb: optionalDistribution(bufferPoolMemory),
    columnstoreSegmentCacheMb: optionalDistribution(columnstoreSegmentCache),
    requiredMemoryFloorGb,
    headroomPct: MEMORY_HEADROOM_PCT,
    evidenceConfidence,
    evidenceCompleteness,
    workingSetValidationRequired: true,
    directPressureState: pressureAssessment.state,
    pressureSignals: pressureAssessment.signals
  };
}

export function evaluateCandidateMemory(input: {
  workload: WorkloadProfile;
  currentMemoryGb?: number;
  candidateMemoryGb: number;
  fallbackRequiredMemoryGb?: number;
}): MemoryCandidateEvaluation {
  const evidence = input.workload.evidence?.memory
    ?? buildMemoryEvidenceFromSamples(input.workload.sampleSeries?.memory ?? []);
  const pressureState = !evidence
    ? "insufficient_evidence"
    : evidence.directPressureState
      ?? directPressureAssessment(input.workload.sampleSeries?.memory ?? []).state;
  const evidenceConfidence = pressureState === "isolated_pressure_detected" && evidence?.evidenceConfidence === "high"
    ? "medium"
    : evidence?.evidenceConfidence ?? "low";
  const currentMemoryGb = input.currentMemoryGb
    ?? (evidence?.osTotalMemoryMb !== undefined ? evidence.osTotalMemoryMb / 1024 : undefined);
  const memoryReductionPct = currentMemoryGb && currentMemoryGb > 0
    ? round2(Math.max(0, (currentMemoryGb - input.candidateMemoryGb) / currentMemoryGb * 100))
    : undefined;
  const memoryReducing = memoryReductionPct !== undefined
    ? memoryReductionPct > 0
    : true;
  const evidenceFloor = evidence?.requiredMemoryFloorGb;
  const requiredMemoryFloorGb = maximum([
    evidenceFloor,
    input.fallbackRequiredMemoryGb
  ]);
  const failures: string[] = [];

  if (memoryReducing && pressureState === "pressure_detected") {
    failures.push(`MEMORY_PRESSURE_DETECTED: ${evidence?.pressureSignals.join("; ")}`);
  }
  if (requiredMemoryFloorGb === undefined) {
    failures.push("MEMORY_EVIDENCE_INCOMPLETE: a reproducible less-elastic memory floor is unavailable");
  } else if (input.candidateMemoryGb < requiredMemoryFloorGb) {
    failures.push(`MEMORY_LESS_ELASTIC_FLOOR_UNDERFIT: ${input.candidateMemoryGb} < ${requiredMemoryFloorGb}`);
  }

  return {
    valid: failures.length === 0,
    failures,
    currentMemoryGb,
    candidateMemoryGb: input.candidateMemoryGb,
    memoryReductionPct,
    requiredMemoryFloorGb,
    pressureState,
    evidenceConfidence,
    workingSetValidationRequired: memoryReducing,
    signalsUsed: evidence?.evidenceCompleteness ?? []
  };
}

function directPressureAssessment(samples: readonly MemoryWorkloadSample[]): {
  state: DirectMemoryPressureState;
  signals: string[];
} {
  if (samples.length === 0) {
    return {
      state: "insufficient_evidence",
      signals: []
    };
  }

  const blockingSignals: string[] = [];
  const isolatedSignals: string[] = [];
  const grantsPending = values(samples, (sample) => sample.memoryGrantsPending);
  if (grantsPending.some((value) => value > 0)) {
    const grantStats = pressurePersistence(samples, (sample) => (sample.memoryGrantsPending ?? 0) > 0);
    if (distribution(grantsPending).p95 > 0 || pressurePersistenceMet(grantStats)) {
      blockingSignals.push("Memory Grants Pending was sustained or repeated.");
    } else {
      isolatedSignals.push("Memory Grants Pending occurred only as an isolated event.");
    }
  }

  const physicalLowStats = pressurePersistence(samples, (sample) => sample.processPhysicalMemoryLow === true);
  if (physicalLowStats.sampleCount > 0) {
    if (pressurePersistenceMet(physicalLowStats)) {
      blockingSignals.push("SQL Server reported repeated process physical-memory pressure.");
    } else {
      isolatedSignals.push("SQL Server reported an isolated process physical-memory pressure event.");
    }
  }

  const virtualLowStats = pressurePersistence(samples, (sample) => sample.processVirtualMemoryLow === true);
  if (virtualLowStats.sampleCount > 0) {
    if (pressurePersistenceMet(virtualLowStats)) {
      blockingSignals.push("SQL Server reported repeated process virtual-memory pressure.");
    } else {
      isolatedSignals.push("SQL Server reported an isolated process virtual-memory pressure event.");
    }
  }

  const systemLowStats = pressurePersistence(samples, (sample) => sample.systemLowMemorySignalState === true);
  if (systemLowStats.sampleCount > 0) {
    if (pressurePersistenceMet(systemLowStats)) {
      blockingSignals.push("The operating system reported repeated low-memory pressure.");
    } else {
      isolatedSignals.push("The operating system reported an isolated low-memory pressure event.");
    }
  }

  if (blockingSignals.length > 0) {
    return {
      state: "pressure_detected",
      signals: [...blockingSignals, ...isolatedSignals]
    };
  }
  if (isolatedSignals.length > 0) {
    return {
      state: "isolated_pressure_detected",
      signals: isolatedSignals
    };
  }
  return {
    state: "no_direct_pressure_detected",
    signals: []
  };
}

function pressurePersistence(
  samples: readonly MemoryWorkloadSample[],
  qualifies: (sample: MemoryWorkloadSample) => boolean
): { sampleCount: number; samplePct: number; periodCount: number } {
  const ordered = [...samples].sort((left, right) => left.timestampMs - right.timestampMs);
  let sampleCount = 0;
  let periodCount = 0;
  let consecutiveSamples = 0;
  let previousTimestampMs: number | undefined;

  for (const sample of ordered) {
    const qualified = qualifies(sample);
    if (qualified) sampleCount += 1;
    const consecutiveTimestamp =
      previousTimestampMs === undefined
      || sample.timestampMs - previousTimestampMs <= 60_000;
    if (qualified && consecutiveTimestamp) {
      consecutiveSamples += 1;
    } else {
      if (consecutiveSamples >= READ_IOPS_MIN_PRESSURE_PERIOD_SAMPLES) periodCount += 1;
      consecutiveSamples = qualified ? 1 : 0;
    }
    previousTimestampMs = sample.timestampMs;
  }
  if (consecutiveSamples >= READ_IOPS_MIN_PRESSURE_PERIOD_SAMPLES) periodCount += 1;

  return {
    sampleCount,
    samplePct: ordered.length > 0 ? sampleCount / ordered.length * 100 : 0,
    periodCount
  };
}

function pressurePersistenceMet(stats: { samplePct: number; periodCount: number }): boolean {
  return stats.samplePct >= READ_IOPS_PERSISTENCE_SAMPLE_PCT
    || stats.periodCount >= READ_IOPS_MIN_PRESSURE_PERIODS;
}

function lessElasticMemoryMb(sample: MemoryWorkloadSample): { totalMb: number; osNonSqlUsedMb: number } | undefined {
  const clerks = parseMemoryClerks(sample.memoryClerksJson);
  const bufferPoolMb = clerks
    .filter((clerk) => clerk.type.toUpperCase().includes("SQLBUFFERPOOL"))
    .reduce((sum, clerk) => sum + clerk.sizeMb, 0);
  const nonBufferClerkMb = clerks
    .filter((clerk) => !clerk.type.toUpperCase().includes("SQLBUFFERPOOL"))
    .reduce((sum, clerk) => sum + clerk.sizeMb, 0);
  const processPhysicalMb = sample.physicalMemoryInUseKb !== undefined
    ? sample.physicalMemoryInUseKb / 1024
    : sample.sqlCommittedMemoryMb;
  const stolenMb = sample.stolenServerMemoryMb ?? 0;
  const sqlLessElasticMb = processPhysicalMb !== undefined && bufferPoolMb > 0
    ? Math.max(stolenMb, processPhysicalMb - bufferPoolMb)
    : Math.max(stolenMb, nonBufferClerkMb);
  const osNonSqlUsedMb = sample.osTotalMemoryMb !== undefined
    && sample.osAvailableMemoryMb !== undefined
    && processPhysicalMb !== undefined
      ? Math.max(0, sample.osTotalMemoryMb - sample.osAvailableMemoryMb - processPhysicalMb)
      : 0;

  if (sqlLessElasticMb <= 0 && osNonSqlUsedMb <= 0) return undefined;
  return {
    totalMb: sqlLessElasticMb + osNonSqlUsedMb,
    osNonSqlUsedMb
  };
}

function bufferPoolMemoryMb(sample: MemoryWorkloadSample): number | undefined {
  const values = parseMemoryClerks(sample.memoryClerksJson)
    .filter((clerk) => clerk.type.toUpperCase().includes("SQLBUFFERPOOL"))
    .map((clerk) => clerk.sizeMb);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function parseMemoryClerks(value: string | undefined): Array<{ type: string; sizeMb: number }> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const type = String(entry.ClerkType ?? entry.clerkType ?? entry.type ?? "");
      const sizeMb = Number(entry.SizeMb ?? entry.sizeMb ?? entry.size_mb);
      return type && Number.isFinite(sizeMb) && sizeMb >= 0 ? [{ type, sizeMb }] : [];
    });
  } catch {
    return [];
  }
}

function numaPleDistributions(samples: readonly MemoryWorkloadSample[]): Record<string, LowTailMetricDistribution> | undefined {
  const byNode = new Map<string, number[]>();

  for (const sample of samples) {
    if (!sample.numaPleJson) continue;
    try {
      const parsed = JSON.parse(sample.numaPleJson) as Array<Record<string, unknown>>;
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const node = String(entry.NumaNode ?? entry.numaNode ?? entry.instance_name ?? "");
        const ple = Number(entry.PageLifeExpectancySeconds ?? entry.pageLifeExpectancySeconds ?? entry.cntr_value);
        if (!node || !Number.isFinite(ple) || ple < 0) continue;
        const values = byNode.get(node) ?? [];
        values.push(ple);
        byNode.set(node, values);
      }
    } catch {
      continue;
    }
  }

  const result: Record<string, LowTailMetricDistribution> = {};
  for (const [node, nodeValues] of byNode.entries()) {
    const nodeDistribution = lowTailDistribution(nodeValues);
    if (nodeDistribution) result[node] = nodeDistribution;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function ratesFromCounters(
  samples: readonly MemoryWorkloadSample[],
  valueOf: (sample: MemoryWorkloadSample) => number | undefined
): number[] {
  const ordered = [...samples].sort((left, right) => left.timestampMs - right.timestampMs);
  const rates: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = valueOf(ordered[index - 1]);
    const current = valueOf(ordered[index]);
    const elapsedSeconds = (ordered[index].timestampMs - ordered[index - 1].timestampMs) / 1000;
    if (previous === undefined || current === undefined || current < previous || elapsedSeconds <= 0) continue;
    rates.push((current - previous) / elapsedSeconds);
  }
  return rates;
}

function rateValues(
  samples: readonly MemoryWorkloadSample[],
  counterOf: (sample: MemoryWorkloadSample) => number | undefined,
  directRateOf: (sample: MemoryWorkloadSample) => number | undefined
): number[] {
  const directRates = values(samples, directRateOf);
  return directRates.length === samples.length && directRates.length > 0
    ? directRates
    : ratesFromCounters(samples, counterOf);
}

function availableSignals(samples: readonly MemoryWorkloadSample[]): string[] {
  return [...REQUIRED_MEMORY_SIGNAL_CHECKS, ...SUPPLEMENTAL_MEMORY_SIGNAL_CHECKS]
    .filter(([, present]) => samples.some(present))
    .map(([name]) => name);
}

function memoryEvidenceConfidence(
  samples: readonly MemoryWorkloadSample[]
): "high" | "medium" | "low" {
  if (samples.length === 0) return "low";
  const complete = REQUIRED_MEMORY_SIGNAL_CHECKS.every(([, present]) => samples.every(present));
  if (complete) return "high";
  const partial = REQUIRED_MEMORY_SIGNAL_CHECKS.some(([, present]) => samples.some(present));
  return partial ? "medium" : "low";
}

function values(
  samples: readonly MemoryWorkloadSample[],
  valueOf: (sample: MemoryWorkloadSample) => number | undefined
): number[] {
  return samples.flatMap((sample) => {
    const value = valueOf(sample);
    return value !== undefined && Number.isFinite(value) ? [value] : [];
  });
}

function optionalDistribution(valuesToMeasure: number[]): MetricDistribution | undefined {
  return valuesToMeasure.length > 0 ? distribution(valuesToMeasure) : undefined;
}

function lowTailDistribution(valuesToMeasure: number[]): LowTailMetricDistribution | undefined {
  const clean = valuesToMeasure.filter(Number.isFinite).sort((left, right) => left - right);
  if (clean.length === 0) return undefined;
  return {
    ...distribution(clean),
    min: round2(clean[0]),
    p05: round2(percentile(clean, 5)),
    p10: round2(percentile(clean, 10))
  };
}

function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 1) return sorted[0];
  const rank = percentileValue / 100 * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function maximum(valuesToMeasure: Array<number | undefined>): number | undefined {
  const clean = valuesToMeasure.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return clean.length > 0 ? Math.max(...clean) : undefined;
}

function minimumPositive(valuesToMeasure: number[]): number | undefined {
  const clean = valuesToMeasure.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length > 0 ? Math.min(...clean) : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export * from "./coupling.js";
