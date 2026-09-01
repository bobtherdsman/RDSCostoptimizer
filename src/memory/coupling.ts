import type {
  MemoryWorkloadSample,
  SynchronizedWorkloadSample,
  WorkloadProfile
} from "../contracts/types.js";
import { distribution } from "../parser/stats.js";

export const MATERIAL_MEMORY_REDUCTION_PCT = 25;
export const READ_IOPS_SPEARMAN_THRESHOLD = 0.4;
export const READ_IOPS_MEANINGFUL_INCREASE_PCT = 20;
export const READ_IOPS_STRONG_INCREASE_PCT = 40;
export const READ_IOPS_PERSISTENCE_SAMPLE_PCT = 10;
export const READ_IOPS_MIN_PRESSURE_PERIOD_SAMPLES = 5;
export const READ_IOPS_MIN_PRESSURE_PERIODS = 3;

export interface MemoryCouplingEvaluation {
  verdict: "not_required" | "stable_working_set" | "aggressive_medium_confidence";
  materialMemoryReduction: boolean;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  missingMetrics: string[];
  normalizedPageReadsTrend: "declining" | "stable" | "rising" | "unavailable";
  readIopsPressureRelationship: "not_rising" | "weak" | "meaningful" | "strong" | "unavailable";
  readIopsSpearmanCorrelation?: number;
  readIopsHighPressureMedian?: number;
  readIopsLowPressureMedian?: number;
  readIopsIncreasePct?: number;
  readIopsPersistenceSamplePct?: number;
  readIopsPressurePeriodCount?: number;
  readIopsPersistenceMet?: boolean;
  readIopsWorkloadNormalized: boolean;
  memoryPressureLowBandMaxPct?: number;
  memoryPressureHighBandMinPct?: number;
  lazyWritesP95PerSec?: number;
  bufferCacheHitRatioP05Pct?: number;
}

export function evaluateMemoryToIoCoupling(input: {
  workload: WorkloadProfile;
  currentMemoryGb?: number;
  candidateMemoryGb: number;
  currentFamily?: string;
  candidateFamily?: string;
}): MemoryCouplingEvaluation {
  const memoryReductionPct = input.currentMemoryGb && input.currentMemoryGb > 0
    ? Math.max(0, (input.currentMemoryGb - input.candidateMemoryGb) / input.currentMemoryGb * 100)
    : undefined;
  const crossesLowerMemoryFamilyTier = Boolean(
    input.currentFamily
    && input.candidateFamily
    && input.currentFamily !== input.candidateFamily
    && memoryReductionPct
    && memoryReductionPct > 0
  );
  const materialMemoryReduction =
    (memoryReductionPct ?? 0) >= MATERIAL_MEMORY_REDUCTION_PCT
    || crossesLowerMemoryFamilyTier;

  if (!materialMemoryReduction) {
    return {
      verdict: "not_required",
      materialMemoryReduction: false,
      confidence: "high",
      reasons: ["Candidate does not reduce memory by 25% or cross to a lower-memory instance family tier."],
      missingMetrics: [],
      normalizedPageReadsTrend: "unavailable",
      readIopsPressureRelationship: "unavailable",
      readIopsWorkloadNormalized: false
    };
  }

  const synchronized = input.workload.sampleSeries?.synchronized ?? [];
  const pageReadRates = memoryCounterRates(input.workload.sampleSeries?.memory ?? [], (sample) => sample.pageReadsCounter);
  const lazyWriteRates = memoryCounterRates(input.workload.sampleSeries?.memory ?? [], (sample) => sample.lazyWritesCounter);
  const batchRequestRates = memoryRateBySample(
    input.workload.sampleSeries?.memory ?? [],
    (sample) => sample.batchRequestsCounter,
    (sample) => sample.batchRequestsPerSec
  );
  const allPageReadSamplesHaveBatchRate = pageReadRates.size > 0
    && [...pageReadRates.keys()].every((sampleKey) => (batchRequestRates.get(sampleKey) ?? 0) > 0);
  const normalizedPageReads = synchronized.flatMap((sample) => {
    const pageReads = pageReadRates.get(sample.sampleKey);
    const batchRequests = batchRequestRates.get(sample.sampleKey);
    const sqlCpu = sample.cpu.length === 1 ? sample.cpu[0].sqlCpuPct : undefined;
    if (pageReads === undefined) return [];
    if (allPageReadSamplesHaveBatchRate && batchRequests !== undefined && batchRequests > 0) {
      return [pageReads / batchRequests];
    }
    return sqlCpu !== undefined ? [pageReads / Math.max(sqlCpu, 1)] : [];
  });
  const pageReadsSlope = linearSlope(normalizedPageReads);
  const normalizedPageReadsTrend = pageReadsSlope === undefined
    ? "unavailable"
    : pageReadsSlope > 0
      ? "rising"
      : pageReadsSlope < 0
        ? "declining"
        : "stable";
  const physicalIoBySample = new Map(
    (input.workload.physicalIo?.samples ?? []).map((sample) => [sample.sampleKey, sample])
  );
  const readIopsAndPressure = synchronized
    .flatMap((sample) => readIopsPressurePoint(
      sample,
      physicalIoBySample.get(sample.sampleKey)?.readIops,
      batchRequestRates.get(sample.sampleKey)
    ))
    .sort((left, right) => left.timestampMs - right.timestampMs);
  const workloadNormalizedPoints = readIopsAndPressure.filter(
    (point) => point.batchRequestsPerSec !== undefined && point.batchRequestsPerSec > 0
  );
  const readIopsWorkloadNormalized =
    readIopsAndPressure.length > 0
    && workloadNormalizedPoints.length === readIopsAndPressure.length;
  const couplingPoints = readIopsAndPressure.map((point) => ({
    ...point,
    evaluatedReadIops: readIopsWorkloadNormalized
      ? point.readIops / point.batchRequestsPerSec!
      : point.readIops
  }));
  const pressureValues = couplingPoints.map((point) => point.pressurePct);
  const memoryPressureLowBandMaxPct = quantile(pressureValues, 25);
  const memoryPressureHighBandMinPct = quantile(pressureValues, 75);
  const lowPressurePoints = memoryPressureLowBandMaxPct === undefined
    ? []
    : couplingPoints.filter((point) => point.pressurePct <= memoryPressureLowBandMaxPct);
  const highPressurePoints = memoryPressureHighBandMinPct === undefined
    ? []
    : couplingPoints.filter((point) => point.pressurePct >= memoryPressureHighBandMinPct);
  const readIopsPressureCorrelation = spearmanCorrelation(
    pressureValues,
    couplingPoints.map((point) => point.evaluatedReadIops)
  );
  const readIopsLowPressureMedian = median(lowPressurePoints.map((point) => point.evaluatedReadIops));
  const readIopsHighPressureMedian = median(highPressurePoints.map((point) => point.evaluatedReadIops));
  const readIopsIncreasePct = percentageIncrease(
    readIopsLowPressureMedian,
    readIopsHighPressureMedian
  );
  const qualifyingHighPressurePoints = readIopsLowPressureMedian === undefined
    ? []
    : highPressurePoints.filter((point) =>
        point.evaluatedReadIops >= readIopsLowPressureMedian * 1.2
        && point.evaluatedReadIops > readIopsLowPressureMedian
      );
  const readIopsPersistenceSamplePct = couplingPoints.length > 0
    ? qualifyingHighPressurePoints.length / couplingPoints.length * 100
    : undefined;
  const readIopsPressurePeriodCount = countPersistentPressurePeriods(
    couplingPoints,
    qualifyingHighPressurePoints
  );
  const readIopsPersistenceMet =
    (readIopsPersistenceSamplePct ?? 0) >= READ_IOPS_PERSISTENCE_SAMPLE_PCT
    || readIopsPressurePeriodCount >= READ_IOPS_MIN_PRESSURE_PERIODS;
  const readIopsPressureRelationship = classifyReadIopsRelationship({
    correlation: readIopsPressureCorrelation,
    increasePct: readIopsIncreasePct,
    persistenceMet: readIopsPersistenceMet
  });
  const lazyWritesP95PerSec = lazyWriteRates.size > 0
    ? distribution([...lazyWriteRates.values()]).p95
    : undefined;
  const bufferCacheHitRatioP05Pct = input.workload.evidence?.memory?.bufferCacheHitRatioPct?.p05;
  const memoryEvidenceConfidence = input.workload.evidence?.memory?.evidenceConfidence;
  const missingMetrics = [
    memoryEvidenceConfidence !== "high" ? "Complete required memory evidence" : undefined,
    normalizedPageReadsTrend === "unavailable" ? "Page Reads/sec relative to SQL workload" : undefined,
    readIopsPressureRelationship === "unavailable" ? "ReadIOPS relative to memory pressure" : undefined,
    lazyWritesP95PerSec === undefined ? "Lazy Writes/sec" : undefined,
    bufferCacheHitRatioP05Pct === undefined ? "Buffer Cache Hit Ratio" : undefined
  ].filter((value): value is string => Boolean(value));
  const pressureSignals = input.workload.evidence?.memory?.pressureSignals ?? [];
  const durationDays = input.workload.evidenceWindow?.durationDays
    ?? input.workload.collectionHours / 24;
  const stable = pressureSignals.length === 0
    && lazyWritesP95PerSec === 0
    && normalizedPageReadsTrend !== "rising"
    && normalizedPageReadsTrend !== "unavailable"
    && ["not_rising", "weak"].includes(readIopsPressureRelationship)
    && missingMetrics.length === 0
    && durationDays >= 7;
  const reasons = [
    pressureSignals.length > 0
      ? `Memory pressure signals were present: ${pressureSignals.join(" ")}`
      : "No meaningful memory-pressure signals were present.",
    lazyWritesP95PerSec === undefined
      ? "Lazy Writes/sec evidence is unavailable."
      : lazyWritesP95PerSec === 0
        ? "Lazy Writes/sec P95 is zero; isolated samples do not control the verdict."
        : `Lazy Writes/sec P95 is ${lazyWritesP95PerSec}, indicating sustained cache eviction activity.`,
    `Page Reads/sec relative to ${allPageReadSamplesHaveBatchRate ? "Batch Requests/sec" : "SQL CPU"} is ${normalizedPageReadsTrend}.`,
    readIopsPressureCorrelation === undefined
      ? "The Spearman relationship between memory pressure and ReadIOPS is unavailable."
      : `ReadIOPS coupling is ${readIopsPressureRelationship}: Spearman=${round2(readIopsPressureCorrelation)}, high-pressure median change=${formatPercent(readIopsIncreasePct)}, persistence=${readIopsPersistenceMet ? "met" : "not met"} (${round2(readIopsPersistenceSamplePct ?? 0)}% of valid samples, ${readIopsPressurePeriodCount} qualifying pressure periods).`,
    readIopsWorkloadNormalized
      ? "ReadIOPS was normalized by Batch Requests/sec."
      : "Batch Requests/sec was unavailable, so raw ReadIOPS was used and coupling confidence cannot exceed medium.",
    memoryEvidenceConfidence === "high"
      ? "Required memory evidence was complete across the window."
      : "Required memory evidence was incomplete, so RAM reduction cannot be classified as a stable working set.",
    bufferCacheHitRatioP05Pct === undefined
      ? "Buffer Cache Hit Ratio is unavailable."
      : `Buffer Cache Hit Ratio P05 is ${bufferCacheHitRatioP05Pct}% and is supporting evidence only.`,
    durationDays >= 14
      ? `The ${round2(durationDays)}-day window provides stronger trend evidence.`
      : durationDays >= 7
        ? `The ${round2(durationDays)}-day window meets the preferred minimum for trend evidence.`
        : `The ${round2(durationDays)}-day window is below the preferred seven-day trend window.`
  ];

  return {
    verdict: stable ? "stable_working_set" : "aggressive_medium_confidence",
    materialMemoryReduction,
    confidence: stable && durationDays >= 14 && readIopsWorkloadNormalized
      ? "high"
      : "medium",
    reasons,
    missingMetrics,
    normalizedPageReadsTrend,
    readIopsPressureRelationship,
    readIopsSpearmanCorrelation: readIopsPressureCorrelation,
    readIopsHighPressureMedian,
    readIopsLowPressureMedian,
    readIopsIncreasePct,
    readIopsPersistenceSamplePct,
    readIopsPressurePeriodCount,
    readIopsPersistenceMet,
    readIopsWorkloadNormalized,
    memoryPressureLowBandMaxPct,
    memoryPressureHighBandMinPct,
    lazyWritesP95PerSec,
    bufferCacheHitRatioP05Pct
  };
}

function memoryCounterRates(
  samples: readonly MemoryWorkloadSample[],
  valueOf: (sample: MemoryWorkloadSample) => number | undefined
): Map<string, number> {
  const rates = new Map<string, number>();
  const ordered = [...samples].sort((left, right) => left.timestampMs - right.timestampMs);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = valueOf(ordered[index - 1]);
    const current = valueOf(ordered[index]);
    const elapsedSeconds = (ordered[index].timestampMs - ordered[index - 1].timestampMs) / 1000;
    if (previous === undefined || current === undefined || current < previous || elapsedSeconds <= 0) continue;
    rates.set(ordered[index].sampleKey, (current - previous) / elapsedSeconds);
  }
  return rates;
}

function memoryRateBySample(
  samples: readonly MemoryWorkloadSample[],
  counterOf: (sample: MemoryWorkloadSample) => number | undefined,
  directRateOf: (sample: MemoryWorkloadSample) => number | undefined
): Map<string, number> {
  const rates = memoryCounterRates(samples, counterOf);
  for (const sample of samples) {
    const directRate = directRateOf(sample);
    if (directRate !== undefined && Number.isFinite(directRate) && directRate >= 0) {
      rates.set(sample.sampleKey, directRate);
    }
  }
  return rates;
}

interface ReadIopsPressurePoint {
  sampleKey: string;
  timestampMs: number;
  pressurePct: number;
  readIops: number;
  batchRequestsPerSec?: number;
}

function readIopsPressurePoint(
  sample: SynchronizedWorkloadSample,
  physicalReadIops: number | undefined,
  batchRequestsPerSec: number | undefined
): ReadIopsPressurePoint[] {
  if (!sample.valid || sample.memory.length !== 1) return [];
  const memory = sample.memory[0];
  if (!memory.osTotalMemoryMb || memory.osAvailableMemoryMb === undefined) return [];
  const intervalRows = [...sample.userDatabaseIo, ...sample.tempdbIo]
    .filter((row) =>
      row.counterMode !== "cumulative"
      && row.elapsedSeconds !== undefined
      && row.elapsedSeconds > 0
      && row.readOperations >= 0
    );
  const readIops = physicalReadIops
    ?? (
      intervalRows.length > 0
        ? intervalRows.reduce((sum, row) => sum + row.readOperations / row.elapsedSeconds!, 0)
        : undefined
    );
  if (readIops === undefined) return [];
  return [{
    sampleKey: sample.sampleKey,
    timestampMs: sample.timestampMs,
    pressurePct: (1 - memory.osAvailableMemoryMb / memory.osTotalMemoryMb) * 100,
    readIops,
    batchRequestsPerSec
  }];
}

function linearSlope(values: readonly number[]): number | undefined {
  if (values.length < 2) return undefined;
  const xMean = (values.length - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    numerator += (index - xMean) * (values[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

function spearmanCorrelation(left: readonly number[], right: readonly number[]): number | undefined {
  if (left.length !== right.length || left.length < 3) return undefined;
  return pearsonCorrelation(ranks(left), ranks(right));
}

function ranks(values: readonly number[]): number[] {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const result = new Array<number>(values.length);
  let start = 0;
  while (start < ordered.length) {
    let end = start;
    while (end + 1 < ordered.length && ordered[end + 1].value === ordered[start].value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let index = start; index <= end; index += 1) {
      result[ordered[index].index] = rank;
    }
    start = end + 1;
  }
  return result;
}

function pearsonCorrelation(left: readonly number[], right: readonly number[]): number | undefined {
  if (left.length !== right.length || left.length < 3) return undefined;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  if (leftVariance === 0 || rightVariance === 0) return 0;
  return numerator / Math.sqrt(leftVariance * rightVariance);
}

function classifyReadIopsRelationship(input: {
  correlation: number | undefined;
  increasePct: number | undefined;
  persistenceMet: boolean;
}): MemoryCouplingEvaluation["readIopsPressureRelationship"] {
  if (input.correlation === undefined || input.increasePct === undefined) return "unavailable";
  if (input.correlation < READ_IOPS_SPEARMAN_THRESHOLD) return "not_rising";
  if (
    input.increasePct < READ_IOPS_MEANINGFUL_INCREASE_PCT
    || !input.persistenceMet
  ) {
    return "weak";
  }
  return input.increasePct >= READ_IOPS_STRONG_INCREASE_PCT ? "strong" : "meaningful";
}

function countPersistentPressurePeriods(
  allPoints: Array<ReadIopsPressurePoint & { evaluatedReadIops: number }>,
  qualifyingPoints: Array<ReadIopsPressurePoint & { evaluatedReadIops: number }>
): number {
  const qualifyingKeys = new Set(qualifyingPoints.map((point) => point.sampleKey));
  let periodCount = 0;
  let consecutiveSamples = 0;
  let previousTimestampMs: number | undefined;

  for (const point of allPoints) {
    const consecutiveTimestamp =
      previousTimestampMs === undefined
      || point.timestampMs - previousTimestampMs <= 60_000;
    if (qualifyingKeys.has(point.sampleKey) && consecutiveTimestamp) {
      consecutiveSamples += 1;
    } else {
      if (consecutiveSamples >= READ_IOPS_MIN_PRESSURE_PERIOD_SAMPLES) periodCount += 1;
      consecutiveSamples = qualifyingKeys.has(point.sampleKey) ? 1 : 0;
    }
    previousTimestampMs = point.timestampMs;
  }
  if (consecutiveSamples >= READ_IOPS_MIN_PRESSURE_PERIOD_SAMPLES) periodCount += 1;
  return periodCount;
}

function quantile(values: readonly number[], percentile: number): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  if (sorted.length === 1) return sorted[0];
  const rank = percentile / 100 * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values: readonly number[]): number | undefined {
  return quantile(values, 50);
}

function percentageIncrease(baseline: number | undefined, comparison: number | undefined): number | undefined {
  if (baseline === undefined || comparison === undefined) return undefined;
  if (baseline === 0) return comparison > 0 ? Number.POSITIVE_INFINITY : 0;
  return (comparison - baseline) / baseline * 100;
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) return "unavailable";
  if (!Number.isFinite(value)) return ">100%";
  return `${round2(value)}%`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
