import type {
  CandidateEvaluationRecord,
  CpuState,
  CurrentRdsConfig,
  EditionChangeConfirmations,
  EnterpriseToStandardEvaluation,
  LimitingResourceAssessment,
  OptimizationBlocker,
  OptimizationDecision,
  OptimizationResult,
  WorkloadProfile
} from "../contracts/types.js";
import type { InstanceCatalogEntry } from "../catalog/index.js";
import { assessEvidenceWindowFromDuration } from "../evidence-window/index.js";
import {
  CPU_P99_SAFETY_LIMIT_PCT,
  DEFAULT_CPU_P95_TARGET_PCT,
  TOTAL_CPU_P99_HARD_LIMIT_PCT,
  cpuCandidateLabel,
  evaluateCpuCandidates,
  evaluateCpuOnlyCandidates,
  synchronizedCpuSamples,
  type CpuCandidate,
  type CpuCandidateEvaluation,
  type CpuProjection,
  type CpuProjectionContext
} from "./cpu-projection.js";
import type { MemoryCandidateEvaluation } from "../memory/index.js";
import type { MemoryCouplingEvaluation } from "../memory/coupling.js";
import type {
  CandidateIopsEvaluation,
  CandidateTempdbEvaluation,
  CandidateThroughputEvaluation
} from "../io/index.js";
import { evaluateEnterpriseToStandard } from "../edition/index.js";

export interface ComputeOptimizationInput extends CpuProjectionContext {
  candidateGenerationFailures?: string[];
  editionChangeConfirmations?: EditionChangeConfirmations;
}

export function requiredVcpuForCpuTarget(
  currentVcpu: number,
  cpuP95Pct: number
): number {
  if (currentVcpu <= 0) return 1;
  if (cpuP95Pct <= 0) return 1;
  return Math.max(1, Math.ceil((currentVcpu * cpuP95Pct) / DEFAULT_CPU_P95_TARGET_PCT));
}

export function optimizeComputeCandidate(input: ComputeOptimizationInput): OptimizationResult {
  const evidenceWindow = input.workload.evidenceWindow
    ?? assessEvidenceWindowFromDuration(input.workload.collectionHours);
  const confidence = evidenceWindow.confidence;
  const cpuState = classifyCurrentCpuState(input);

  if (!evidenceWindow.productionRightsizingEligible) {
    return blockedResult(input, cpuState, confidence, evidenceWindow, [{
      code: "COLLECTION_WINDOW_TOO_SHORT",
      dimension: "cpu",
      message: evidenceWindow.confidenceReason
    }]);
  }

  if (synchronizedCpuSamples(input.workload).length === 0) {
    return blockedResult(input, cpuState, confidence, evidenceWindow, [{
      code: "CPU_SAMPLE_SERIES_REQUIRED",
      dimension: "cpu",
      message: "CPU optimization requires synchronized per-sample SQL CPU and Other CPU evidence."
    }]);
  }

  if (input.orderedCandidateInstanceClasses.length === 0 && (input.candidateGenerationFailures?.length ?? 0) > 0) {
    return blockedResult(
      input,
      cpuState,
      confidence,
      evidenceWindow,
      input.candidateGenerationFailures!.map((failure) => blockerFromFailure("catalog", failure))
    );
  }

  const evaluations = evaluateCpuCandidates(input);
  const selected = selectBestSafeSurvivor(evaluations);
  if (selected?.candidate.entry && selected.projection) {
    const enterpriseCandidateConfig: CurrentRdsConfig = {
      ...input.currentConfig,
      instanceClass: selected.candidate.instanceClass,
      sqlServerVisibleVcpu: selected.candidate.sqlServerVisibleVcpu,
      cpuSocketCount: selected.candidate.entry.cpuSocketCount
        ?? (selected.candidate.instanceClass === input.currentConfig.instanceClass
          ? input.currentConfig.cpuSocketCount
          : undefined),
      cpuCoreCount: selected.candidate.coreCount,
      cpuThreadsPerCore: selected.candidate.threadsPerCore,
      cpuConfigurationType: selected.candidate.configurationType
    };
    const enterpriseToStandard = input.currentConfig.sqlServerEdition === "Enterprise"
      ? evaluateEnterpriseToStandard({
          currentConfig: input.currentConfig,
          candidateConfig: enterpriseCandidateConfig,
          workload: input.workload,
          catalog: input.catalog,
          confirmations: input.editionChangeConfirmations,
          requirements: input.requirements
        })
      : undefined;
    const recommendedConfig = enterpriseToStandard?.eligible
      ? { ...enterpriseCandidateConfig, sqlServerEdition: "Standard" as const }
      : enterpriseCandidateConfig;
    const thresholdRisk = riskFromVerifiedSignals(
      selected.projection,
      selected.memory,
      selected.memoryCoupling,
      selected.iops,
      selected.throughput,
      selected.tempdb
    );
    const decision = decisionForEvaluation(selected);
    const candidateEvaluations = evaluations.map((evaluation) =>
      candidateEvaluationRecord(
        input,
        evaluation,
        evaluation === selected,
        evaluation === selected ? enterpriseToStandard : undefined
      )
    );
    const selectedRecord = candidateEvaluations.find((evaluation) => evaluation.selected);
    return {
      currentConfig: input.currentConfig,
      recommendedConfig,
      decision,
      cpuState,
      optimizationEvidence: optimizationEvidence(
        input,
        selected.candidate,
        selected.projection,
        selected.memory,
        selected.memoryCoupling,
        selected.iops,
        selected.throughput,
        selected.tempdb
      ),
      risk: thresholdRisk,
      confidence,
      evidenceWindow,
      blockers: [],
      topOffendingDatabases: input.workload.databases,
      evidence: input.workload.evidence,
      enterpriseToStandard,
      limitingResources: selectedRecord?.limitingResources ?? [],
      candidateEvaluations,
      passedChecks: [
        "CPU_P95_TARGET_FIT",
        "CPU_P99_BURST_FIT",
        "TOTAL_CPU_P99_HARD_GATE_FIT",
        "MEMORY_FIT",
        selected.memoryCoupling?.verdict === "stable_working_set"
          ? "MEMORY_WORKING_SET_STABLE"
          : selected.memoryCoupling?.verdict === "aggressive_medium_confidence"
            ? "MEMORY_TO_IO_COUPLING_AGGRESSIVE"
            : "MEMORY_TO_IO_COUPLING_NOT_REQUIRED",
        selected.iops?.p95 !== undefined ? "IOPS_P95_BASELINE_FIT" : "IOPS_FIT",
        selected.iops?.p99 !== undefined ? "IOPS_P99_MAXIMUM_FIT" : "IOPS_MAXIMUM_FIT",
        selected.iops?.burstReliance ? "IOPS_BURST_DURATION_FREQUENCY_FIT" : "IOPS_BURST_NOT_REQUIRED",
        selected.throughput?.p95 !== undefined ? "THROUGHPUT_P95_BASELINE_FIT" : "THROUGHPUT_FIT",
        selected.throughput?.p99 !== undefined ? "THROUGHPUT_P99_MAXIMUM_FIT" : "THROUGHPUT_MAXIMUM_FIT",
        selected.throughput?.burstReliance
          ? "THROUGHPUT_BURST_DURATION_FREQUENCY_FIT"
          : "THROUGHPUT_BURST_NOT_REQUIRED",
        selected.tempdb?.candidatePlacement === "local_nvme"
          ? selected.tempdb.capacityResult === "fits"
            ? "TEMPDB_LOCAL_CAPACITY_FIT"
            : "TEMPDB_LOCAL_CAPACITY_EVIDENCE_UNAVAILABLE"
          : "TEMPDB_LOCAL_CAPACITY_NOT_APPLICABLE",
        "TEMPDB_CANDIDATE_PATH_MAPPED",
        "ORDERABILITY_FIT",
        selected.candidate.configurationType === "optimize_cpu"
          ? "OPTIMIZE_CPU_CONFIGURATION_ORDERABLE"
          : "DEFAULT_CPU_CONFIGURATION_ORDERABLE",
        enterpriseToStandard?.eligible
          ? "ENTERPRISE_TO_STANDARD_ELIGIBLE"
          : enterpriseToStandard
            ? "ENTERPRISE_TO_STANDARD_BLOCKED_KEEP_ENTERPRISE"
            : "ENTERPRISE_TO_STANDARD_NOT_APPLICABLE",
        confidence === "high"
          ? "COLLECTION_WINDOW_HIGH_CONFIDENCE"
          : confidence === "medium"
            ? "COLLECTION_WINDOW_MEDIUM_CONFIDENCE"
            : "COLLECTION_WINDOW_PRELIMINARY"
      ]
    };
  }

  const blockers = evaluations.flatMap((evaluation) =>
    evaluation.failures.map((failure) =>
      blockerFromFailure(cpuCandidateLabel(evaluation.candidate), failure)
    )
  );
  return blockedResult(input, cpuState, confidence, evidenceWindow, blockers, evaluations);
}

export function classifyCurrentCpuState(input: ComputeOptimizationInput): CpuState {
  const targetCpuP95 = DEFAULT_CPU_P95_TARGET_PCT;
  if (input.workload.cpuPct.p95 > targetCpuP95) {
    return "under_pressure";
  }

  if (synchronizedCpuSamples(input.workload).length === 0) return "normal";
  const smallerSupportedCandidateFits = evaluateCpuOnlyCandidates(input)
    .some((evaluation) => evaluation.valid);
  return smallerSupportedCandidateFits ? "underutilized" : "normal";
}

export function optimizeCost(currentConfig: CurrentRdsConfig, workload: WorkloadProfile): OptimizationResult {
  const evidenceWindow = workload.evidenceWindow
    ?? assessEvidenceWindowFromDuration(workload.collectionHours);
  return {
    currentConfig,
    decision: "Not Recommended",
    optimizationEvidence: {
      currentVcpu: 0,
      cpuP95Pct: workload.cpuPct.p95,
      requiredMemoryGb: 0,
      requiredIops: 0,
      requiredThroughputMbps: 0
    },
    risk: "blocked",
    confidence: evidenceWindow.confidence,
    evidenceWindow,
    blockers: [
      {
        code: "OPTIMIZER_REQUIRES_CATALOG_AND_CANDIDATES",
        dimension: "orderability",
        message: "Use optimizeComputeCandidate with a local catalog and caller-supplied ordered candidates."
      }
    ],
    topOffendingDatabases: workload.databases,
    evidence: workload.evidence,
    limitingResources: [{
      dimension: "orderability",
      scope: "compute",
      status: "blocking",
      reason: "A candidate catalog and explicit candidate order are required."
    }],
    candidateEvaluations: [],
    passedChecks: []
  };
}

function riskFromVerifiedSignals(
  projection: CpuProjection,
  memory: MemoryCandidateEvaluation | undefined,
  memoryCoupling: MemoryCouplingEvaluation | undefined,
  iops: CandidateIopsEvaluation | undefined,
  throughput: CandidateThroughputEvaluation | undefined,
  tempdb: CandidateTempdbEvaluation | undefined
): "low" | "medium" | "high" {
  if (
    memory?.workingSetValidationRequired === true
    || memoryCoupling?.verdict === "aggressive_medium_confidence"
    || iops?.burstReliance === true
    || throughput?.burstReliance === true
    || tempdb?.localIoRiskSignal === true
    || projection.excursionSampleCount > 0
    || projection.confidence === "low"
  ) {
    return "medium";
  }
  return "low";
}

function optimizationEvidence(
  input: ComputeOptimizationInput,
  candidate?: CpuCandidate,
  projection?: CpuProjection,
  memory?: MemoryCandidateEvaluation,
  memoryCoupling?: MemoryCouplingEvaluation,
  iops?: CandidateIopsEvaluation,
  throughput?: CandidateThroughputEvaluation,
  tempdb?: CandidateTempdbEvaluation
): OptimizationResult["optimizationEvidence"] {
  return {
    currentVcpu: input.currentVcpu,
    optimizedVcpu: candidate?.sqlServerVisibleVcpu,
    cpuP95Pct: input.workload.cpuPct.p95,
    projectedCpuPct: projection?.projectedSqlCpuPct.p95,
    projectedSqlCpuP95Pct: projection?.projectedSqlCpuPct.p95,
    projectedSqlCpuP99Pct: projection?.projectedSqlCpuPct.p99,
    projectedTotalCpuP95Pct: projection?.projectedTotalCpuPct.p95,
    projectedTotalCpuP99Pct: projection?.projectedTotalCpuPct.p99,
    observedOtherCpuP95Pct: projection?.observedOtherCpuPct.p95,
    observedOtherCpuP99Pct: projection?.observedOtherCpuPct.p99,
    cpuP95TargetPct: DEFAULT_CPU_P95_TARGET_PCT,
    cpuP99SafetyLimitPct: CPU_P99_SAFETY_LIMIT_PCT,
    totalCpuP99HardLimitPct: TOTAL_CPU_P99_HARD_LIMIT_PCT,
    cpuExcursionSampleCount: projection?.excursionSampleCount,
    cpuExcursionSamplePct: projection?.excursionSamplePct,
    cpuLongestExcursionStreakSamples: projection?.longestExcursionStreakSamples,
    cpuProjectionConfidence: projection?.confidence,
    cpuProjectionBasis: projection?.basis,
    normalizedPerCoreCapacityFactor: projection?.normalizedPerCoreCapacityFactor,
    candidateCpuConfigurationType: candidate?.configurationType,
    candidateCpuCoreCount: candidate?.coreCount,
    candidateCpuThreadsPerCore: candidate?.threadsPerCore,
    cpuHighThresholdPct: input.workload.cpuPressure?.highCpuThresholdPct,
    cpuHighSamplePct: input.workload.cpuPressure?.highCpuSamplePct,
    cpuLongestHighStreakSamples: input.workload.cpuPressure?.longestHighCpuStreakSamples,
    cpuSustainedPressure: input.workload.cpuPressure?.sustainedPressure,
    currentMemoryGb: memory?.currentMemoryGb,
    candidateMemoryGb: memory?.candidateMemoryGb,
    memoryReductionPct: memory?.memoryReductionPct,
    memoryRequiredFloorGb: memory?.requiredMemoryFloorGb,
    memoryHeadroomPct: input.workload.evidence?.memory?.headroomPct,
    memoryPressureState: memory?.pressureState,
    memoryEvidenceConfidence: memory?.evidenceConfidence,
    memoryWorkingSetValidationRequired: memory?.workingSetValidationRequired,
    memorySignalsUsed: memory?.signalsUsed,
    memoryCouplingVerdict: memoryCoupling?.verdict,
    materialMemoryReduction: memoryCoupling?.materialMemoryReduction,
    memoryCouplingConfidence: memoryCoupling?.confidence,
    memoryCouplingReasons: memoryCoupling?.reasons,
    memoryCouplingMissingMetrics: memoryCoupling?.missingMetrics,
    normalizedPageReadsTrend: memoryCoupling?.normalizedPageReadsTrend,
    readIopsPressureRelationship: memoryCoupling?.readIopsPressureRelationship,
    readIopsSpearmanCorrelation: memoryCoupling?.readIopsSpearmanCorrelation,
    readIopsHighPressureMedian: memoryCoupling?.readIopsHighPressureMedian,
    readIopsLowPressureMedian: memoryCoupling?.readIopsLowPressureMedian,
    readIopsIncreasePct: memoryCoupling?.readIopsIncreasePct,
    readIopsPersistenceSamplePct: memoryCoupling?.readIopsPersistenceSamplePct,
    readIopsPressurePeriodCount: memoryCoupling?.readIopsPressurePeriodCount,
    readIopsPersistenceMet: memoryCoupling?.readIopsPersistenceMet,
    readIopsWorkloadNormalized: memoryCoupling?.readIopsWorkloadNormalized,
    memoryPressureLowBandMaxPct: memoryCoupling?.memoryPressureLowBandMaxPct,
    memoryPressureHighBandMinPct: memoryCoupling?.memoryPressureHighBandMinPct,
    lazyWritesP95PerSec: memoryCoupling?.lazyWritesP95PerSec,
    bufferCacheHitRatioP05Pct: memoryCoupling?.bufferCacheHitRatioP05Pct,
    iopsP95: iops?.p95 ?? input.workload.physicalIo?.totalIops.p95,
    iopsP99: iops?.p99 ?? input.workload.physicalIo?.totalIops.p99,
    iopsMax: iops?.max ?? input.workload.physicalIo?.totalIops.max,
    readIopsP95: tempdb?.candidateNormalPath?.readIops.p95 ?? input.workload.physicalIo?.readIops.p95,
    readIopsP99: tempdb?.candidateNormalPath?.readIops.p99 ?? input.workload.physicalIo?.readIops.p99,
    writeIopsP95: tempdb?.candidateNormalPath?.writeIops.p95 ?? input.workload.physicalIo?.writeIops.p95,
    writeIopsP99: tempdb?.candidateNormalPath?.writeIops.p99 ?? input.workload.physicalIo?.writeIops.p99,
    candidateBaselineIops: iops?.baselineIops,
    candidateMaximumIops: iops?.maximumIops,
    iopsBurstEvidence: iops?.burstEvidence,
    iopsBurstReliance: iops?.burstReliance,
    throughputP95: throughput?.p95 ?? input.workload.physicalIo?.totalMibPerSec.p95,
    throughputP99: throughput?.p99 ?? input.workload.physicalIo?.totalMibPerSec.p99,
    throughputMax: throughput?.max ?? input.workload.physicalIo?.totalMibPerSec.max,
    readThroughputP95MibPerSec:
      tempdb?.candidateNormalPath?.readMibPerSec.p95 ?? input.workload.physicalIo?.readMibPerSec.p95,
    readThroughputP99MibPerSec:
      tempdb?.candidateNormalPath?.readMibPerSec.p99 ?? input.workload.physicalIo?.readMibPerSec.p99,
    writeThroughputP95MibPerSec:
      tempdb?.candidateNormalPath?.writeMibPerSec.p95 ?? input.workload.physicalIo?.writeMibPerSec.p95,
    writeThroughputP99MibPerSec:
      tempdb?.candidateNormalPath?.writeMibPerSec.p99 ?? input.workload.physicalIo?.writeMibPerSec.p99,
    candidateBaselineThroughputMbps: throughput?.baselineThroughputMbps,
    candidateMaximumThroughputMbps: throughput?.maximumThroughputMbps,
    throughputBurstEvidence: throughput?.burstEvidence,
    throughputBurstReliance: throughput?.burstReliance,
    currentTempdbPlacement: tempdb?.currentPlacement,
    candidateTempdbPlacement: tempdb?.candidatePlacement,
    tempdbPlacementTransition: tempdb?.transition,
    currentNormalPathIopsP95: tempdb?.currentNormalPath?.totalIops.p95,
    currentNormalPathIopsP99: tempdb?.currentNormalPath?.totalIops.p99,
    candidateNormalPathIopsP95: tempdb?.candidateNormalPath?.totalIops.p95,
    candidateNormalPathIopsP99: tempdb?.candidateNormalPath?.totalIops.p99,
    tempdbIopsP95: tempdb?.tempdbIo?.totalIops.p95,
    tempdbIopsP99: tempdb?.tempdbIo?.totalIops.p99,
    currentNormalPathThroughputP95: tempdb?.currentNormalPath?.totalMibPerSec.p95,
    currentNormalPathThroughputP99: tempdb?.currentNormalPath?.totalMibPerSec.p99,
    candidateNormalPathThroughputP95: tempdb?.candidateNormalPath?.totalMibPerSec.p95,
    candidateNormalPathThroughputP99: tempdb?.candidateNormalPath?.totalMibPerSec.p99,
    tempdbThroughputP95: tempdb?.tempdbIo?.totalMibPerSec.p95,
    tempdbThroughputP99: tempdb?.tempdbIo?.totalMibPerSec.p99,
    candidateLocalStorageCapacityGb: tempdb?.candidateLocalStorageCapacityGb,
    tempdbRepresentativeAllocatedGb: tempdb?.representativeAllocatedGb,
    tempdbPeakAllocatedGb: tempdb?.peakAllocatedGb,
    tempdbCapacityResult: tempdb?.capacityResult,
    tempdbLocalIoRiskSignal: tempdb?.localIoRiskSignal,
    requiredMemoryGb: memory?.requiredMemoryFloorGb ?? input.requirements.memoryGb,
    requiredIops: input.requirements.iops,
    requiredThroughputMbps: input.requirements.throughputMbps
  };
}

function blockedResult(
  input: ComputeOptimizationInput,
  cpuState: CpuState,
  confidence: "preliminary" | "medium" | "high",
  evidenceWindow: NonNullable<OptimizationResult["evidenceWindow"]>,
  blockers: OptimizationBlocker[],
  evaluations: CpuCandidateEvaluation[] = []
): OptimizationResult {
  const candidateEvaluations = evaluations.map((evaluation) =>
    candidateEvaluationRecord(input, evaluation, false)
  );
  return {
    currentConfig: input.currentConfig,
    decision: "Not Recommended",
    cpuState,
    optimizationEvidence: optimizationEvidence(input),
    risk: "blocked",
    confidence,
    evidenceWindow,
    blockers,
    topOffendingDatabases: input.workload.databases,
    evidence: input.workload.evidence,
    limitingResources: blockedLimitingResources(input, blockers, candidateEvaluations),
    candidateEvaluations,
    passedChecks: []
  };
}

function decisionForEvaluation(evaluation: CpuCandidateEvaluation): OptimizationDecision {
  if (!evaluation.valid) return "Not Recommended";
  return validationRequiredForEvaluation(evaluation)
    ? "Aggressive Optimization"
    : "Recommended";
}

function validationRequiredForEvaluation(evaluation: CpuCandidateEvaluation): boolean {
  return evaluation.memoryCoupling?.verdict === "aggressive_medium_confidence"
    || evaluation.projection?.basis === "unadjusted_cross_family";
}

function selectBestSafeSurvivor(evaluations: readonly CpuCandidateEvaluation[]): CpuCandidateEvaluation | undefined {
  return evaluations
    .filter((evaluation) => evaluation.valid)
    .sort(compareSafeSurvivors)[0];
}

function compareSafeSurvivors(left: CpuCandidateEvaluation, right: CpuCandidateEvaluation): number {
  return left.candidate.sqlServerVisibleVcpu - right.candidate.sqlServerVisibleVcpu
    || preferredFamilyTier(left) - preferredFamilyTier(right)
    || evaluationRiskRank(left) - evaluationRiskRank(right)
    || projectionConfidenceRank(left) - projectionConfidenceRank(right)
    || memoryPreservationRank(left) - memoryPreservationRank(right)
    || configurationTypeRank(left) - configurationTypeRank(right)
    || left.candidate.instanceClass.localeCompare(right.candidate.instanceClass);
}

function preferredFamilyTier(evaluation: CpuCandidateEvaluation): number {
  const family = evaluation.candidate.entry?.family ?? familyFromInstanceClass(evaluation.candidate.instanceClass);
  if (["m8i", "r8i", "x2m"].includes(family)) return 0;
  if (["m7i", "r7i", "x2iedn"].includes(family)) return 1;
  return 2;
}

function evaluationRiskRank(evaluation: CpuCandidateEvaluation): number {
  if (!evaluation.projection) return 3;
  return riskFromVerifiedSignals(
    evaluation.projection,
    evaluation.memory,
    evaluation.memoryCoupling,
    evaluation.iops,
    evaluation.throughput,
    evaluation.tempdb
  ) === "low" ? 0 : 1;
}

function projectionConfidenceRank(evaluation: CpuCandidateEvaluation): number {
  if (evaluation.projection?.confidence === "high") return 0;
  if (evaluation.projection?.confidence === "medium") return 1;
  return 2;
}

function memoryPreservationRank(evaluation: CpuCandidateEvaluation): number {
  if ((evaluation.memory?.memoryReductionPct ?? 0) <= 0) return 0;
  if (evaluation.memoryCoupling?.verdict === "not_required") return 1;
  if (evaluation.memoryCoupling?.verdict === "stable_working_set") return 2;
  return 3;
}

function configurationTypeRank(evaluation: CpuCandidateEvaluation): number {
  return evaluation.candidate.configurationType === "optimize_cpu" ? 0 : 1;
}

function familyFromInstanceClass(instanceClass: string): string {
  return instanceClass.split(".")[1] ?? "unknown";
}

function candidateEvaluationRecord(
  input: ComputeOptimizationInput,
  evaluation: CpuCandidateEvaluation,
  selected: boolean,
  editionEvaluation?: EnterpriseToStandardEvaluation
): CandidateEvaluationRecord {
  const failedGates = [...new Set(evaluation.failures.map((failure) => failure.split(":")[0]))];
  const failureDimensions = new Set(evaluation.failures.map(failureDimension));
  const passedGates = [
    ["CPU", "cpu"],
    ["MEMORY", "memory"],
    ["IOPS", "iops"],
    ["THROUGHPUT", "throughput"],
    ["TEMPDB", "tempdb"],
    ["ORDERABILITY", "orderability"]
  ].filter(([, dimension]) => !failureDimensions.has(dimension as OptimizationBlocker["dimension"]))
    .map(([gate]) => gate);

  return {
    instanceClass: evaluation.candidate.instanceClass,
    sqlServerVisibleVcpu: evaluation.candidate.sqlServerVisibleVcpu,
    cpuConfigurationType: evaluation.candidate.configurationType,
    cpuCoreCount: evaluation.candidate.coreCount,
    cpuThreadsPerCore: evaluation.candidate.threadsPerCore,
    accepted: evaluation.valid,
    selected,
    decision: decisionForEvaluation(evaluation),
    passedGates,
    failedGates,
    limitingResources: limitingResourceAssessments(input, evaluation, editionEvaluation),
    projectedSqlCpuP95Pct: evaluation.projection?.projectedSqlCpuPct.p95,
    projectedSqlCpuP99Pct: evaluation.projection?.projectedSqlCpuPct.p99,
    projectedTotalCpuP99Pct: evaluation.projection?.projectedTotalCpuPct.p99,
    memoryRequiredFloorGb: evaluation.memory?.requiredMemoryFloorGb,
    candidateMemoryGb: evaluation.memory?.candidateMemoryGb,
    iopsP95: evaluation.iops?.p95,
    iopsP99: evaluation.iops?.p99,
    throughputP95: evaluation.throughput?.p95,
    throughputP99: evaluation.throughput?.p99,
    tempdbPlacementTransition: evaluation.tempdb?.transition
  };
}

function limitingResourceAssessments(
  input: ComputeOptimizationInput,
  evaluation: CpuCandidateEvaluation,
  editionEvaluation?: EnterpriseToStandardEvaluation
): LimitingResourceAssessment[] {
  const targetCpu = DEFAULT_CPU_P95_TARGET_PCT;
  const resources: LimitingResourceAssessment[] = [
    resourceAssessment({
      input,
      evaluation,
      dimension: "cpu",
      observed: evaluation.projection?.projectedSqlCpuPct.p95,
      limit: targetCpu,
      unit: "%",
      risk: evaluation.projection?.confidence === "low"
        || (evaluation.projection?.excursionSampleCount ?? 0) > 0,
      reason: evaluation.projection
        ? `Projected SQL CPU P95/P99 is ${evaluation.projection.projectedSqlCpuPct.p95}/${evaluation.projection.projectedSqlCpuPct.p99}% and projected total CPU P99 is ${evaluation.projection.projectedTotalCpuPct.p99}%.`
        : "CPU projection evidence is unavailable."
    }),
    resourceAssessment({
      input,
      evaluation,
      dimension: "memory",
      observed: evaluation.memory?.requiredMemoryFloorGb,
      limit: evaluation.memory?.candidateMemoryGb,
      unit: "GB",
      risk: evaluation.memoryCoupling?.verdict === "aggressive_medium_confidence",
      reason: evaluation.memory
        ? `Required less-elastic memory floor is ${evaluation.memory.requiredMemoryFloorGb ?? "unavailable"} GB against ${evaluation.memory.candidateMemoryGb} GB; coupling verdict is ${evaluation.memoryCoupling?.verdict ?? "unavailable"}.`
        : "Candidate memory evidence is unavailable."
    }),
    resourceAssessment({
      input,
      evaluation,
      dimension: "iops",
      observed: evaluation.iops?.p95,
      limit: evaluation.iops?.baselineIops,
      unit: "IOPS",
      risk: evaluation.iops?.burstReliance === true,
      reason: evaluation.iops
        ? `Physical IOPS P95/P99 is ${evaluation.iops.p95 ?? "unavailable"}/${evaluation.iops.p99 ?? "unavailable"} against sustained/maximum capability ${evaluation.iops.baselineIops ?? "unavailable"}/${evaluation.iops.maximumIops}.`
        : "Physical IOPS evidence is unavailable."
    }),
    resourceAssessment({
      input,
      evaluation,
      dimension: "throughput",
      observed: evaluation.throughput?.p95,
      limit: evaluation.throughput?.baselineThroughputMbps,
      unit: "MiB/s",
      risk: evaluation.throughput?.burstReliance === true,
      reason: evaluation.throughput
        ? `Physical throughput P95/P99 is ${evaluation.throughput.p95 ?? "unavailable"}/${evaluation.throughput.p99 ?? "unavailable"} MiB/s against sustained/maximum capability ${evaluation.throughput.baselineThroughputMbps ?? "unavailable"}/${evaluation.throughput.maximumThroughputMbps} MiB/s.`
        : "Physical throughput evidence is unavailable."
    })
  ];

  const tempdb = evaluation.tempdb;
  resources.push(resourceAssessment({
    input,
    evaluation,
    dimension: "tempdb",
    observed: tempdb?.peakAllocatedGb,
    limit: tempdb?.candidateLocalStorageCapacityGb,
    unit: "GB",
    notApplicable: tempdb?.candidatePlacement !== "local_nvme",
    risk: tempdb?.localIoRiskSignal === true,
    reason: tempdb
      ? `tempdb transition is ${tempdb.transition}; local capacity result is ${tempdb.capacityResult}; representative/peak allocation is ${tempdb.representativeAllocatedGb ?? "unavailable"}/${tempdb.peakAllocatedGb ?? "unavailable"} GB.`
      : "Candidate-aware tempdb evidence is unavailable."
  }));

  resources.push(resourceAssessment({
    input,
    evaluation,
    dimension: "orderability",
    unit: "gate",
    reason: evaluation.candidate.entry
      ? "Region, edition, exact engine version, class, and processor configuration were checked against the candidate catalog."
      : "Candidate catalog metadata is unavailable."
  }));

  const evidenceWindow = input.workload.evidenceWindow
    ?? assessEvidenceWindowFromDuration(input.workload.collectionHours);
  resources.push({
    dimension: "evidence",
    scope: "compute",
    status: evidenceWindow.productionRightsizingEligible
      && evidenceWindow.continuityStatus !== "issues_detected"
      ? "within_limit"
      : evaluation.valid
        ? "risk"
        : "blocking",
    reason: evidenceWindow.confidenceReason
  });

  if (input.currentConfig.sqlServerEdition === "Enterprise") {
    resources.push({
      dimension: "edition",
      scope: "edition",
      status: editionEvaluation?.eligible
        ? "within_limit"
        : editionEvaluation
          ? "blocking"
          : "not_applicable",
      reason: editionEvaluation?.eligible
        ? `Enterprise-to-Standard passed all five terms and requires a separate ${editionEvaluation.acceptedMigrationPath} migration.`
        : editionEvaluation
          ? `Standard Edition migration is blocked: ${editionEvaluation.blockers.map((blocker) => blocker.message).join("; ")}`
          : "Edition migration was not evaluated for this rejected candidate.",
      topDatabaseName: editionEvaluation?.blockers.find((blocker) => blocker.databaseName)?.databaseName,
      topDatabaseMetric: editionEvaluation?.blockers.some((blocker) => blocker.databaseName)
        ? "edition compatibility"
        : undefined
    });
  }

  return resources;
}

function resourceAssessment(input: {
  input: ComputeOptimizationInput;
  evaluation: CpuCandidateEvaluation;
  dimension: LimitingResourceAssessment["dimension"];
  observed?: number;
  limit?: number;
  unit: string;
  reason: string;
  risk?: boolean;
  notApplicable?: boolean;
}): LimitingResourceAssessment {
  const failures = input.evaluation.failures.filter(
    (failure) => failureDimension(failure) === input.dimension
  );
  const topDatabase = topDatabaseForDimension(input.input.workload, input.dimension);
  return {
    dimension: input.dimension,
    scope: "compute",
    status: input.notApplicable
      ? "not_applicable"
      : failures.length > 0
        ? "blocking"
        : input.risk
          ? "risk"
          : "within_limit",
    observed: input.observed,
    limit: input.limit,
    utilizationPct: ratioPct(input.observed, input.limit),
    unit: input.unit,
    reason: failures.length > 0 ? failures.join("; ") : input.reason,
    topDatabaseName: topDatabase?.databaseName,
    topDatabaseMetric: topDatabase?.metric,
    topDatabaseValue: topDatabase?.value
  };
}

function blockedLimitingResources(
  input: ComputeOptimizationInput,
  blockers: OptimizationBlocker[],
  evaluations: CandidateEvaluationRecord[]
): LimitingResourceAssessment[] {
  const resources = evaluations.flatMap((evaluation) =>
    evaluation.limitingResources
      .filter((resource) => resource.status === "blocking")
      .map((resource) => ({
        ...resource,
        reason: `${evaluation.instanceClass}: ${resource.reason}`
      }))
  );
  for (const blocker of blockers) {
    const dimension = blocker.dimension;
    const topDatabase = topDatabaseForDimension(input.workload, dimension);
    resources.push({
      dimension,
      scope: blocker.dimension === "edition" ? "edition" : "compute",
      status: "blocking",
      reason: blocker.message,
      topDatabaseName: topDatabase?.databaseName,
      topDatabaseMetric: topDatabase?.metric,
      topDatabaseValue: topDatabase?.value
    });
  }

  const byKey = new Map<string, LimitingResourceAssessment>();
  for (const resource of resources) {
    const key = `${resource.scope}|${resource.dimension}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, resource);
      continue;
    }
    existing.reason = `${existing.reason}; ${resource.reason}`;
  }
  return [...byKey.values()];
}

function topDatabaseForDimension(
  workload: WorkloadProfile,
  dimension: LimitingResourceAssessment["dimension"]
): { databaseName: string; metric: string; value: number } | undefined {
  const candidates = workload.databases.flatMap((database) => {
    const value = dimension === "cpu"
      ? database.advisoryCpuSharePct
      : dimension === "memory"
        ? database.advisoryMemorySharePct
        : dimension === "iops"
          ? database.iopsSharePct
          : dimension === "throughput"
            ? database.throughputSharePct
            : dimension === "tempdb"
              ? database.tempdbSharePct
              : undefined;
    if (value === undefined) return [];
    return [{
      databaseName: database.databaseName,
      metric: dimension === "cpu"
        ? "advisory CPU share %"
        : dimension === "memory"
          ? "advisory memory share %"
          : dimension === "iops"
            ? "time-integrated IOPS share %"
            : dimension === "throughput"
              ? "time-integrated throughput share %"
              : "tempdb share %",
      value
    }];
  });
  return candidates.sort((left, right) => right.value - left.value)[0];
}

function ratioPct(observed: number | undefined, limit: number | undefined): number | undefined {
  if (observed === undefined || limit === undefined || limit <= 0) return undefined;
  return Math.round(observed / limit * 10_000) / 100;
}

function blockerFromFailure(instanceClass: string, failure: string): OptimizationBlocker {
  const dimension = failureDimension(failure);
  return {
    code: failure.split(":")[0],
    dimension,
    message: `${instanceClass}: ${failure}`
  };
}

function failureDimension(failure: string): OptimizationBlocker["dimension"] {
  if (failure.startsWith("CPU_") || failure.startsWith("TOTAL_CPU_")) return "cpu";
  if (failure.startsWith("MEMORY_")) return "memory";
  if (failure.startsWith("IOPS_")) return "iops";
  if (failure.startsWith("THROUGHPUT_")) return "throughput";
  if (failure.startsWith("TEMPDB_")) return "tempdb";
  if (failure.startsWith("EDITION_")) return "edition";
  if (failure.startsWith("SQL_VERSION_") || failure.startsWith("INSTANCE_")) return "orderability";
  return "orderability";
}
