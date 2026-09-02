import type {
  CpuWorkloadSample,
  CurrentRdsConfig,
  MetricDistribution,
  WorkloadProfile
} from "../contracts/types.js";
import {
  catalogForSqlServerConfiguration,
  isOrderableCandidate,
  type CandidateRequirements,
  type InstanceCatalogEntry,
  type OptimizeCpuConfiguration
} from "../catalog/index.js";
import { distribution } from "../parser/stats.js";
import {
  evaluateCandidateMemory,
  type MemoryCandidateEvaluation
} from "../memory/index.js";
import {
  evaluateMemoryToIoCoupling,
  type MemoryCouplingEvaluation
} from "../memory/coupling.js";
import {
  evaluateCandidateIops,
  evaluateCandidateTempdbPlacement,
  evaluateCandidateThroughput,
  type CandidateIopsEvaluation,
  type CandidateTempdbEvaluation,
  type CandidateThroughputEvaluation
} from "../io/index.js";

export const DEFAULT_CPU_P95_TARGET_PCT = 70;
export const CPU_P99_SAFETY_LIMIT_PCT = 90;
export const TOTAL_CPU_P99_HARD_LIMIT_PCT = 90;

export interface CpuProjectionContext {
  currentConfig: CurrentRdsConfig;
  workload: WorkloadProfile;
  catalog: InstanceCatalogEntry[];
  orderedCandidateInstanceClasses: string[];
  requirements: CandidateRequirements;
  currentVcpu: number;
}

export interface CpuCandidate {
  instanceClass: string;
  entry?: InstanceCatalogEntry;
  configurationType: "default" | "optimize_cpu";
  sqlServerVisibleVcpu: number;
  coreCount?: number;
  threadsPerCore?: number;
  processorConfiguration?: OptimizeCpuConfiguration;
}

export interface CpuProjection {
  projectedSqlCpuPct: MetricDistribution;
  projectedTotalCpuPct: MetricDistribution;
  observedOtherCpuPct: MetricDistribution;
  sampleCount: number;
  excursionSampleCount: number;
  excursionSamplePct: number;
  longestExcursionStreakSamples: number;
  confidence: "high" | "medium" | "low";
  basis: "same_hardware" | "same_family" | "normalized_cross_family" | "unadjusted_cross_family";
  normalizedPerCoreCapacityFactor: number;
}

export interface CpuCandidateEvaluation {
  candidate: CpuCandidate;
  projection?: CpuProjection;
  memory?: MemoryCandidateEvaluation;
  memoryCoupling?: MemoryCouplingEvaluation;
  iops?: CandidateIopsEvaluation;
  throughput?: CandidateThroughputEvaluation;
  tempdb?: CandidateTempdbEvaluation;
  failures: string[];
  valid: boolean;
}

export interface CpuOnlyCandidateEvaluation {
  candidate: CpuCandidate;
  projection?: CpuProjection;
  failures: string[];
  valid: boolean;
}

export function evaluateCpuOnlyCandidates(
  input: CpuProjectionContext
): CpuOnlyCandidateEvaluation[] {
  const cpuSamples = synchronizedCpuSamples(input.workload);
  const targetCpuP95 = DEFAULT_CPU_P95_TARGET_PCT;

  return buildCpuCandidates(input).map((candidate) => {
    const validation = isOrderableCandidate(
      input.catalog,
      input.currentConfig,
      candidate.instanceClass,
      { memoryGb: 0, iops: 0, throughputMbps: 0 },
      candidate.processorConfiguration
    );
    const failures = [...validation.failures];
    const resolvedCandidate = {
      ...candidate,
      entry: validation.entry ?? candidate.entry
    };
    const projection = resolvedCandidate.sqlServerVisibleVcpu > 0 && cpuSamples.length > 0
      ? projectCpuSamples(input, resolvedCandidate, cpuSamples)
      : undefined;

    failures.push(...cpuProjectionFailures(projection, targetCpuP95));

    return {
      candidate: resolvedCandidate,
      projection,
      failures,
      valid: failures.length === 0
    };
  });
}

export function evaluateCpuCandidates(
  input: CpuProjectionContext,
  requirements: CandidateRequirements = input.requirements
): CpuCandidateEvaluation[] {
  const cpuSamples = synchronizedCpuSamples(input.workload);
  const targetCpuP95 = DEFAULT_CPU_P95_TARGET_PCT;
  const currentEntry = catalogForSqlServerConfiguration(input.catalog, input.currentConfig)
    .find((entry) => entry.instanceClass === input.currentConfig.instanceClass);
  const currentFamily = currentEntry?.family ?? familyFromInstanceClass(input.currentConfig.instanceClass);
  const currentMemoryGb = currentEntry?.memoryGb
    ?? (input.workload.evidence?.memory?.osTotalMemoryMb !== undefined
      ? input.workload.evidence.memory.osTotalMemoryMb / 1024
      : undefined);

  const projectionCache = new Map<string, CpuProjection>();
  const memoryCache = new Map<string, MemoryCandidateEvaluation>();
  const memoryCouplingCache = new Map<string, MemoryCouplingEvaluation>();
  const tempdbCache = new Map<string, CandidateTempdbEvaluation>();
  const iopsCache = new Map<string, CandidateIopsEvaluation>();
  const throughputCache = new Map<string, CandidateThroughputEvaluation>();
  const evaluations: CpuCandidateEvaluation[] = [];
  for (const candidate of buildCpuCandidates(input)) {
    const validation = isOrderableCandidate(
      input.catalog,
      input.currentConfig,
      candidate.instanceClass,
      { ...requirements, memoryGb: 0, iops: 0, throughputMbps: 0 },
      candidate.processorConfiguration
    );
    const failures = [...validation.failures];
    const resolvedCandidate = {
      ...candidate,
      entry: validation.entry ?? candidate.entry
    };
    const projection = resolvedCandidate.sqlServerVisibleVcpu > 0 && cpuSamples.length > 0
      ? cached(projectionCache, projectionCacheKey(resolvedCandidate), () =>
          projectCpuSamples(input, resolvedCandidate, cpuSamples)
        )
      : undefined;
    failures.push(...cpuProjectionFailures(projection, targetCpuP95));

    let memory: MemoryCandidateEvaluation | undefined;
    let memoryCoupling: MemoryCouplingEvaluation | undefined;
    let tempdb: CandidateTempdbEvaluation | undefined;
    let iops: CandidateIopsEvaluation | undefined;
    let throughput: CandidateThroughputEvaluation | undefined;

    if (resolvedCandidate.entry) {
      memory = cached(memoryCache, memoryCacheKey(currentMemoryGb, resolvedCandidate.entry.memoryGb, requirements.memoryGb), () =>
        evaluateCandidateMemory({
          workload: input.workload,
          currentMemoryGb,
          candidateMemoryGb: resolvedCandidate.entry!.memoryGb,
          fallbackRequiredMemoryGb: requirements.memoryGb
        })
      );
      memoryCoupling = cached(memoryCouplingCache, memoryCouplingCacheKey(currentMemoryGb, resolvedCandidate.entry.memoryGb, currentFamily, resolvedCandidate.entry.family), () =>
        evaluateMemoryToIoCoupling({
          workload: input.workload,
          currentMemoryGb,
          candidateMemoryGb: resolvedCandidate.entry!.memoryGb,
          currentFamily,
          candidateFamily: resolvedCandidate.entry!.family
        })
      );
      tempdb = cached(tempdbCache, tempdbCacheKey(currentEntry, resolvedCandidate.entry), () =>
        evaluateCandidateTempdbPlacement({
          physicalIo: input.workload.physicalIo,
          currentTempdbOnLocalStorage: currentEntry
            ? currentEntry.localInstanceStorage?.tempdbOnLocalStorage === true
            : undefined,
          candidateTempdbOnLocalStorage:
            resolvedCandidate.entry!.localInstanceStorage?.tempdbOnLocalStorage === true,
          candidateLocalStorageCapacityGb:
            resolvedCandidate.entry!.localInstanceStorage?.capacityGb,
          tempdbUsage: input.workload.evidence?.tempdbUsage
        })
      );
      iops = cached(iopsCache, iopsCacheKey(resolvedCandidate.entry, input.currentConfig.provisionedIops, tempdb), () =>
        evaluateCandidateIops({
          workload: input.workload,
          physicalIo: tempdb?.candidateNormalPath,
          baselineIops: resolvedCandidate.entry!.baselineIops,
          maximumIops: resolvedCandidate.entry!.maxIops,
          configuredStorageIops: input.currentConfig.provisionedIops,
          maximumBurstDurationMinutes: resolvedCandidate.entry!.maximumIopsBurstDurationMinutes,
          maximumBurstEventsPer24Hours: resolvedCandidate.entry!.maximumIopsBurstEventsPer24Hours
        })
      );
      throughput = cached(throughputCache, throughputCacheKey(resolvedCandidate.entry, input.currentConfig.provisionedThroughputMbps, tempdb), () =>
        evaluateCandidateThroughput({
          workload: input.workload,
          physicalIo: tempdb?.candidateNormalPath,
          baselineThroughputMbps: resolvedCandidate.entry!.baselineThroughputMbps,
          maximumThroughputMbps: resolvedCandidate.entry!.maxThroughputMbps,
          configuredStorageThroughputMbps: input.currentConfig.provisionedThroughputMbps,
          maximumBurstDurationMinutes: resolvedCandidate.entry!.maximumThroughputBurstDurationMinutes,
          maximumBurstEventsPer24Hours: resolvedCandidate.entry!.maximumThroughputBurstEventsPer24Hours
        })
      );

      failures.push(...memory.failures);
      failures.push(...tempdb.failures);
      failures.push(...iops.failures);
      failures.push(...throughput.failures);
    }

    const evaluation = {
      candidate: resolvedCandidate,
      projection,
      memory,
      memoryCoupling,
      iops,
      throughput,
      tempdb,
      failures,
      valid: failures.length === 0
    };
    evaluations.push(evaluation);
    if (evaluation.valid && memoryPreferenceRank(evaluation) === 0) break;
  }

  return evaluations.sort((left, right) =>
    memoryPreferenceRank(left) - memoryPreferenceRank(right)
  );
}

function cached<T>(cache: Map<string, T>, key: string, build: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing;
  const value = build();
  cache.set(key, value);
  return value;
}

function projectionCacheKey(candidate: CpuCandidate): string {
  return [
    candidate.instanceClass,
    candidate.configurationType,
    candidate.sqlServerVisibleVcpu,
    candidate.coreCount ?? "",
    candidate.threadsPerCore ?? "",
    candidate.entry?.normalizedPerCoreCapacity ?? ""
  ].join("|");
}

function memoryCacheKey(currentMemoryGb: number | undefined, candidateMemoryGb: number, fallbackRequiredMemoryGb: number): string {
  return [currentMemoryGb ?? "", candidateMemoryGb, fallbackRequiredMemoryGb].join("|");
}

function memoryCouplingCacheKey(
  currentMemoryGb: number | undefined,
  candidateMemoryGb: number,
  currentFamily: string,
  candidateFamily: string
): string {
  return [currentMemoryGb ?? "", candidateMemoryGb, currentFamily, candidateFamily].join("|");
}

function tempdbCacheKey(currentEntry: InstanceCatalogEntry | undefined, candidateEntry: InstanceCatalogEntry): string {
  return [
    currentEntry?.localInstanceStorage?.tempdbOnLocalStorage === true,
    candidateEntry.localInstanceStorage?.tempdbOnLocalStorage === true,
    candidateEntry.localInstanceStorage?.capacityGb ?? ""
  ].join("|");
}

function iopsCacheKey(
  entry: InstanceCatalogEntry,
  configuredStorageIops: number | undefined,
  tempdb: CandidateTempdbEvaluation | undefined
): string {
  return [
    tempdb?.transition ?? "",
    tempdb?.capacityResult ?? "",
    entry.baselineIops ?? "",
    entry.maxIops,
    configuredStorageIops ?? "",
    entry.maximumIopsBurstDurationMinutes ?? "",
    entry.maximumIopsBurstEventsPer24Hours ?? ""
  ].join("|");
}

function throughputCacheKey(
  entry: InstanceCatalogEntry,
  configuredStorageThroughputMbps: number | undefined,
  tempdb: CandidateTempdbEvaluation | undefined
): string {
  return [
    tempdb?.transition ?? "",
    tempdb?.capacityResult ?? "",
    entry.baselineThroughputMbps ?? "",
    entry.maxThroughputMbps,
    configuredStorageThroughputMbps ?? "",
    entry.maximumThroughputBurstDurationMinutes ?? "",
    entry.maximumThroughputBurstEventsPer24Hours ?? ""
  ].join("|");
}

function cpuProjectionFailures(
  projection: CpuProjection | undefined,
  targetCpuP95: number
): string[] {
  if (!projection) {
    return [
      "CPU_PROJECTION_UNAVAILABLE: synchronized CPU samples or candidate SQL Server-visible vCPU are unavailable"
    ];
  }

  const failures: string[] = [];
  if (projection.projectedSqlCpuPct.p95 > targetCpuP95) {
    failures.push(`CPU_P95_TARGET_EXCEEDED: ${projection.projectedSqlCpuPct.p95} > ${targetCpuP95}`);
  }
  if (projection.projectedSqlCpuPct.p99 > CPU_P99_SAFETY_LIMIT_PCT) {
    failures.push(`CPU_P99_BURST_LIMIT_EXCEEDED: ${projection.projectedSqlCpuPct.p99} > ${CPU_P99_SAFETY_LIMIT_PCT}`);
  }
  if (projection.projectedTotalCpuPct.p99 > TOTAL_CPU_P99_HARD_LIMIT_PCT) {
    failures.push(`TOTAL_CPU_P99_HARD_GATE_EXCEEDED: ${projection.projectedTotalCpuPct.p99} > ${TOTAL_CPU_P99_HARD_LIMIT_PCT}`);
  }
  return failures;
}

export function synchronizedCpuSamples(workload: WorkloadProfile): CpuWorkloadSample[] {
  return (workload.sampleSeries?.synchronized ?? [])
    .filter((sample) => sample.valid && sample.cpu.length === 1)
    .map((sample) => sample.cpu[0])
    .sort((left, right) => left.timestampMs - right.timestampMs);
}

export function cpuCandidateLabel(candidate: CpuCandidate): string {
  if (candidate.configurationType === "default") {
    return `${candidate.instanceClass} default ${candidate.sqlServerVisibleVcpu} visible vCPU`;
  }
  return `${candidate.instanceClass} Optimize CPU ${candidate.coreCount} cores x ${candidate.threadsPerCore} threads (${candidate.sqlServerVisibleVcpu} visible vCPU)`;
}

function buildCpuCandidates(input: CpuProjectionContext): CpuCandidate[] {
  const candidates: CpuCandidate[] = [];
  const seen = new Set<string>();

  for (const instanceClass of input.orderedCandidateInstanceClasses) {
    const validation = isOrderableCandidate(
      input.catalog,
      input.currentConfig,
      instanceClass,
      { memoryGb: 0, iops: 0, throughputMbps: 0 }
    );
    const entry = validation.entry;
    if (!entry) {
      candidates.push({
        instanceClass,
        configurationType: "default",
        sqlServerVisibleVcpu: 0
      });
      continue;
    }

    const configurations: CpuCandidate[] = [];
    if (entry.vcpu < input.currentVcpu) {
      configurations.push({
        instanceClass,
        entry,
        configurationType: "default",
        sqlServerVisibleVcpu: entry.vcpu,
        coreCount: entry.defaultCpuCores,
        threadsPerCore: entry.defaultThreadsPerCore
      });
    }
    for (const configuration of entry.optimizeCpuConfigurations ?? []) {
      if (configuration.sqlServerVisibleVcpu >= input.currentVcpu || configuration.isDefault) continue;
      configurations.push({
        instanceClass,
        entry,
        configurationType: "optimize_cpu",
        sqlServerVisibleVcpu: configuration.sqlServerVisibleVcpu,
        coreCount: configuration.coreCount,
        threadsPerCore: configuration.threadsPerCore,
        processorConfiguration: configuration
      });
    }

    configurations.sort((left, right) =>
      right.sqlServerVisibleVcpu - left.sqlServerVisibleVcpu
      || Number(right.configurationType === "default") - Number(left.configurationType === "default")
      || (right.coreCount ?? 0) - (left.coreCount ?? 0)
      || (right.threadsPerCore ?? 0) - (left.threadsPerCore ?? 0)
    );

    for (const candidate of configurations) {
      const key = [
        candidate.instanceClass,
        candidate.configurationType,
        candidate.coreCount ?? "default",
        candidate.threadsPerCore ?? "default",
        candidate.sqlServerVisibleVcpu
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

function projectCpuSamples(
  input: CpuProjectionContext,
  candidate: CpuCandidate,
  samples: CpuWorkloadSample[]
): CpuProjection {
  const comparison = cpuComparison(input, candidate);
  const effectiveCandidateVcpu =
    candidate.sqlServerVisibleVcpu * comparison.normalizedPerCoreCapacityFactor;
  const projectedSql: number[] = [];
  const projectedTotal: number[] = [];
  const observedOther: number[] = [];
  let excursionSampleCount = 0;
  let longestExcursionStreakSamples = 0;
  let currentExcursionStreak = 0;

  for (const sample of samples) {
    const sqlCoreDemand = input.currentVcpu * sample.sqlCpuPct / 100;
    const otherCoreDemand = input.currentVcpu * sample.otherCpuPct / 100;
    const projectedSqlCpuPct = effectiveCandidateVcpu > 0
      ? sqlCoreDemand / effectiveCandidateVcpu * 100
      : 100;
    const projectedTotalCpuPct = effectiveCandidateVcpu > 0
      ? (sqlCoreDemand + otherCoreDemand) / effectiveCandidateVcpu * 100
      : 100;

    projectedSql.push(projectedSqlCpuPct);
    projectedTotal.push(projectedTotalCpuPct);
    observedOther.push(sample.otherCpuPct);

    if (
      projectedSqlCpuPct > CPU_P99_SAFETY_LIMIT_PCT
      || projectedTotalCpuPct > TOTAL_CPU_P99_HARD_LIMIT_PCT
    ) {
      excursionSampleCount += 1;
      currentExcursionStreak += 1;
      longestExcursionStreakSamples = Math.max(longestExcursionStreakSamples, currentExcursionStreak);
    } else {
      currentExcursionStreak = 0;
    }
  }

  return {
    projectedSqlCpuPct: distribution(projectedSql),
    projectedTotalCpuPct: distribution(projectedTotal),
    observedOtherCpuPct: distribution(observedOther),
    sampleCount: samples.length,
    excursionSampleCount,
    excursionSamplePct: round(samples.length > 0 ? excursionSampleCount / samples.length * 100 : 0),
    longestExcursionStreakSamples,
    confidence: comparison.confidence,
    basis: comparison.basis,
    normalizedPerCoreCapacityFactor: comparison.normalizedPerCoreCapacityFactor
  };
}

function cpuComparison(
  input: CpuProjectionContext,
  candidate: CpuCandidate
): Pick<CpuProjection, "confidence" | "basis" | "normalizedPerCoreCapacityFactor"> {
  const currentEntry = catalogForSqlServerConfiguration(input.catalog, input.currentConfig)
    .find((entry) => entry.instanceClass === input.currentConfig.instanceClass);
  const currentFamily = currentEntry?.family ?? familyFromInstanceClass(input.currentConfig.instanceClass);
  const candidateFamily = candidate.entry?.family ?? familyFromInstanceClass(candidate.instanceClass);

  if (candidate.instanceClass === input.currentConfig.instanceClass) {
    return { confidence: "high", basis: "same_hardware", normalizedPerCoreCapacityFactor: 1 };
  }
  if (currentFamily === candidateFamily) {
    return { confidence: "high", basis: "same_family", normalizedPerCoreCapacityFactor: 1 };
  }
  if (currentEntry?.normalizedPerCoreCapacity && candidate.entry?.normalizedPerCoreCapacity) {
    return {
      confidence: "medium",
      basis: "normalized_cross_family",
      normalizedPerCoreCapacityFactor:
        candidate.entry.normalizedPerCoreCapacity / currentEntry.normalizedPerCoreCapacity
    };
  }
  return { confidence: "low", basis: "unadjusted_cross_family", normalizedPerCoreCapacityFactor: 1 };
}

function familyFromInstanceClass(instanceClass: string): string {
  return instanceClass.split(".")[1] ?? "unknown";
}

function memoryPreferenceRank(evaluation: CpuCandidateEvaluation): number {
  if (evaluation.memoryCoupling?.verdict === "not_required") return 0;
  if (evaluation.memoryCoupling?.verdict === "stable_working_set") return 1;
  return 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
