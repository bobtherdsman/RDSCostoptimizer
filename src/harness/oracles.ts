import type {
  CandidateEvaluationRecord,
  CurrentRdsConfig,
  DatabaseIoWorkloadSample,
  MemoryWorkloadSample,
  MetricDistribution,
  OptimizationBlocker,
  OptimizationResult,
  WorkloadProfile
} from "../contracts/types.js";
import type {
  CandidateRequirements,
  InstanceCatalogEntry,
  OptimizeCpuConfiguration
} from "../catalog/index.js";

export interface IndependentOracleContext {
  result: OptimizationResult;
  workload: WorkloadProfile;
  catalog: InstanceCatalogEntry[];
  currentConfig: CurrentRdsConfig;
  requirements: CandidateRequirements;
  currentVcpu: number;
}

export interface IndependentOracleFinding {
  oracle: string;
  dimension: OptimizationBlocker["dimension"];
  passed: boolean;
  message: string;
}

interface OracleIoSample {
  sampleKey: string;
  timestampMs: number;
  elapsedSeconds: number;
  readIops: number;
  writeIops: number;
  totalIops: number;
  readMibPerSec: number;
  writeMibPerSec: number;
  totalMibPerSec: number;
  nonTempdbReadIops: number;
  nonTempdbWriteIops: number;
  nonTempdbReadMibPerSec: number;
  nonTempdbWriteMibPerSec: number;
  tempdbReadIops: number;
  tempdbWriteIops: number;
  tempdbReadMibPerSec: number;
  tempdbWriteMibPerSec: number;
}

export function runIndependentRecommendationOracles(
  context: IndependentOracleContext
): IndependentOracleFinding[] {
  if (!context.result.recommendedConfig) return [];

  const findings = [
    activeCandidateEvidenceFinding(context),
    optimalSafeCandidateFinding(context),
    fallbackFamilyJustificationFinding(context),
    activeCpuProjectionFinding(context),
    activeMemoryFinding(context),
    activeIoFinding(context, "iops"),
    activeIoFinding(context, "throughput")
  ];
  const failed = findings.filter((finding) => !finding.passed);
  findings.push({
    oracle: "CO-RULE-REPRODUCIBLE-RECOMMENDATION",
    dimension: failed[0]?.dimension ?? "orderability",
    passed: failed.length === 0,
    message: failed.length === 0
      ? "The active CPU -> memory -> IOPS -> throughput rule flow was independently reproduced from preserved evidence."
      : `Active rule flow could not be independently reproduced: ${failed.map((finding) => finding.oracle).join(", ")}.`
  });
  return findings;
}

function optimalSafeCandidateFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  const accepted = context.result.candidateEvaluations.filter((candidate) => candidate.accepted);
  const selected = context.result.candidateEvaluations.find((candidate) => candidate.selected);
  if (accepted.length === 0 || !selected) {
    return finding(
      "CO-RULE-OPTIMAL-SAFE-CANDIDATE",
      "orderability",
      false,
      "Accepted candidate evidence and a selected candidate record are required to verify best-safe selection."
    );
  }

  const best = [...accepted].sort(compareSafeCandidateRecords)[0];
  const passed = candidateRecordMatchesConfig(best, recommended)
    && candidateRecordMatchesConfig(selected, recommended);

  return finding(
    "CO-RULE-OPTIMAL-SAFE-CANDIDATE",
    "orderability",
    passed,
    passed
      ? `Selected ${candidateRecordLabel(selected)} is the best independently ranked safe survivor among ${accepted.length} accepted candidate(s).`
      : `Selected ${candidateRecordLabel(selected)} but independent safe-survivor ranking expected ${candidateRecordLabel(best)}.`
  );
}

function fallbackFamilyJustificationFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  const selectedFamily = family(recommended.instanceClass);
  if (!fallbackFamilyTier(selectedFamily)) {
    return finding(
      "CO-RULE-FALLBACK-FAMILY-JUSTIFIED",
      "orderability",
      true,
      `${recommended.instanceClass} is not a fallback-family selection.`
    );
  }

  const selectedVisibleVcpu = recommended.sqlServerVisibleVcpu
    ?? context.result.candidateEvaluations.find((candidate) => candidate.selected)?.sqlServerVisibleVcpu
    ?? 0;
  const orderableLeadClasses = context.catalog
    .filter((entry) =>
      leadFamilyTier(entry.family)
      && entry.vcpu > 0
      && entry.vcpu <= selectedVisibleVcpu
      && entry.vcpu < context.currentVcpu
      && exactCatalogEntryForClass(context, entry.instanceClass) !== undefined
    )
    .map((entry) => entry.instanceClass);
  const evaluatedLeadRecords = context.result.candidateEvaluations.filter((candidate) =>
    leadFamilyTier(family(candidate.instanceClass))
    && candidate.sqlServerVisibleVcpu <= selectedVisibleVcpu
  );
  const acceptedLead = evaluatedLeadRecords.find((candidate) => candidate.accepted);
  const failedLead = evaluatedLeadRecords.find((candidate) =>
    !candidate.accepted
    && (
      candidate.failedGates.length > 0
      || candidate.limitingResources.some((resource) => resource.status === "blocking")
    )
  );
  const orderableLeadSet = new Set(orderableLeadClasses);
  const unevaluatedOrderableLead = [...orderableLeadSet].filter((instanceClass) =>
    !evaluatedLeadRecords.some((candidate) => candidate.instanceClass === instanceClass)
  );
  const passed = acceptedLead === undefined
    && (orderableLeadSet.size === 0 || failedLead !== undefined)
    && unevaluatedOrderableLead.length === 0;

  return finding(
    "CO-RULE-FALLBACK-FAMILY-JUSTIFIED",
    "orderability",
    passed,
    passed
      ? `Fallback family ${selectedFamily} is justified: ${orderableLeadSet.size === 0 ? "no equal-or-better lead-family path is exactly orderable" : `lead path ${failedLead?.instanceClass ?? "unknown"} failed a preserved workload gate`}.`
      : `Fallback family ${selectedFamily} is not justified: ${acceptedLead ? `lead candidate ${acceptedLead.instanceClass} was also accepted` : unevaluatedOrderableLead.length > 0 ? `orderable lead candidate(s) were not evaluated: ${unevaluatedOrderableLead.join(", ")}` : "no failed lead-family gate was preserved"}.`
  );
}

function activeCandidateEvidenceFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  const selected = context.result.candidateEvaluations.filter((candidate) => candidate.selected);
  const candidateExists = Boolean(exactCatalogEntry(context.catalog, recommended));
  const selectedMatches = selected.length === 0
    || (
      selected.length === 1
      && selected[0].accepted
      && selected[0].instanceClass === recommended.instanceClass
    );

  return finding(
    "CO-RULE-CANDIDATE",
    "orderability",
    candidateExists && selectedMatches,
    `Recommended candidate=${recommended.instanceClass}; exact catalog row=${candidateExists ? "present" : "missing"}; selected record=${selected.map((candidate) => candidate.instanceClass).join(", ") || "none"}.`
  );
}

function compareSafeCandidateRecords(left: CandidateEvaluationRecord, right: CandidateEvaluationRecord): number {
  return left.sqlServerVisibleVcpu - right.sqlServerVisibleVcpu
    || candidateFamilyTier(left) - candidateFamilyTier(right)
    || candidateRiskRank(left) - candidateRiskRank(right)
    || candidateMemoryRank(left, right)
    || candidateConfigurationRank(left) - candidateConfigurationRank(right)
    || left.instanceClass.localeCompare(right.instanceClass);
}

function candidateFamilyTier(candidate: CandidateEvaluationRecord): number {
  const candidateFamily = family(candidate.instanceClass);
  if (leadFamilyTier(candidateFamily)) return 0;
  if (fallbackFamilyTier(candidateFamily)) return 1;
  return 2;
}

function candidateRiskRank(candidate: CandidateEvaluationRecord): number {
  const resourceRisk = candidate.limitingResources.some((resource) => resource.status === "risk") ? 1 : 0;
  return (candidate.decision === "Recommended" ? 0 : 1) + resourceRisk;
}

function candidateMemoryRank(left: CandidateEvaluationRecord, right: CandidateEvaluationRecord): number {
  return (right.candidateMemoryGb ?? 0) - (left.candidateMemoryGb ?? 0);
}

function candidateConfigurationRank(candidate: CandidateEvaluationRecord): number {
  return candidate.cpuConfigurationType === "optimize_cpu" ? 0 : 1;
}

function candidateRecordMatchesConfig(
  candidate: CandidateEvaluationRecord | undefined,
  config: CurrentRdsConfig
): boolean {
  return candidate !== undefined
    && candidate.instanceClass === config.instanceClass
    && (config.sqlServerVisibleVcpu === undefined || candidate.sqlServerVisibleVcpu === config.sqlServerVisibleVcpu)
    && candidate.cpuConfigurationType === (config.cpuConfigurationType ?? candidate.cpuConfigurationType);
}

function candidateRecordLabel(candidate: CandidateEvaluationRecord | undefined): string {
  if (!candidate) return "none";
  return `${candidate.instanceClass} ${candidate.cpuConfigurationType} ${candidate.sqlServerVisibleVcpu} visible vCPU`;
}

function leadFamilyTier(value: string): boolean {
  return ["m8i", "r8i", "x2m"].includes(value);
}

function fallbackFamilyTier(value: string): boolean {
  return ["m7i", "r7i", "x2iedn"].includes(value);
}

function activeCpuProjectionFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  const evidence = context.result.optimizationEvidence;
  if (!evidence || !recommended.sqlServerVisibleVcpu) {
    return finding(
      "CO-RULE-CPU",
      "cpu",
      false,
      "Preserved CPU evidence and candidate SQL-visible vCPU are required."
    );
  }

  const samples = (context.workload.sampleSeries?.synchronized ?? [])
    .filter((sample) => sample.valid && sample.cpu.length === 1)
    .map((sample) => sample.cpu[0]);
  const independent = samples.length > 0
    ? {
      sql: metricDistribution(samples.map((sample) =>
        context.currentVcpu * sample.sqlCpuPct / recommended.sqlServerVisibleVcpu!
      )),
      total: metricDistribution(samples.map((sample) =>
        context.currentVcpu * (sample.sqlCpuPct + sample.otherCpuPct) / recommended.sqlServerVisibleVcpu!
      ))
    }
    : undefined;
  const projectedSqlP95 = independent?.sql.p95 ?? evidence.projectedSqlCpuP95Pct;
  const projectedSqlP99 = independent?.sql.p99 ?? evidence.projectedSqlCpuP99Pct;
  const projectedTotalP99 = independent?.total.p99 ?? evidence.projectedTotalCpuP99Pct;
  const matches = independent === undefined
    || (
      close(independent.sql.p95, evidence.projectedSqlCpuP95Pct)
      && close(independent.sql.p99, evidence.projectedSqlCpuP99Pct)
      && close(independent.total.p99, evidence.projectedTotalCpuP99Pct)
    );
  const fits =
    evidence.cpuP95TargetPct === 70
    && evidence.cpuP99SafetyLimitPct === 90
    && evidence.totalCpuP99HardLimitPct === 90
    && projectedSqlP95 !== undefined
    && projectedSqlP99 !== undefined
    && projectedTotalP99 !== undefined
    && projectedSqlP95 <= 70
    && projectedSqlP99 <= 90
    && projectedTotalP99 <= 90;
  const crossFamilyValidationRequired = evidence.cpuProjectionBasis === "unadjusted_cross_family";

  return finding(
    "CO-RULE-CPU",
    "cpu",
    matches && fits && (!crossFamilyValidationRequired || context.result.decision !== "Recommended"),
    `Projected SQL CPU P95/P99=${format(projectedSqlP95)}/${format(projectedSqlP99)}%; projected total CPU P99=${format(projectedTotalP99)}%; limits=70/90/90%; basis=${evidence.cpuProjectionBasis ?? "missing"}; validation required=${crossFamilyValidationRequired ? "yes" : "no"}; decision=${context.result.decision}.`
  );
}

function activeMemoryFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const entry = exactCatalogEntry(context.catalog, context.result.recommendedConfig!);
  const evidence = context.result.optimizationEvidence;
  if (!entry || !evidence) {
    return finding(
      "CO-RULE-MEMORY",
      "memory",
      false,
      "Candidate memory and preserved memory evidence are required."
    );
  }

  const floor = evidence.memoryRequiredFloorGb ?? context.requirements.memoryGb;
  const pressureState = evidence.memoryPressureState ?? "insufficient_evidence";
  const validationRequired = pressureState === "insufficient_evidence"
    || pressureState === "isolated_pressure_detected"
    || evidence.memoryWorkingSetValidationRequired === true;
  const stableWorkingSet = evidence.memoryCouplingVerdict === "stable_working_set"
    || evidence.memoryCouplingVerdict === "not_required";
  const fits =
    entry.memoryGb >= floor
    && pressureState !== "pressure_detected"
    && (!validationRequired || stableWorkingSet || context.result.decision !== "Recommended");

  return finding(
    "CO-RULE-MEMORY",
    "memory",
    fits,
    `Candidate memory=${entry.memoryGb} GB; required floor=${floor} GB; pressure state=${pressureState}; coupling verdict=${evidence.memoryCouplingVerdict ?? "missing"}; validation required=${validationRequired ? "yes" : "no"}; decision=${context.result.decision}.`
  );
}

function activeIoFinding(
  context: IndependentOracleContext,
  dimension: "iops" | "throughput"
): IndependentOracleFinding {
  const entry = exactCatalogEntry(context.catalog, context.result.recommendedConfig!);
  const evidence = context.result.optimizationEvidence;
  if (!entry || !evidence) {
    return finding(
      dimension === "iops" ? "CO-RULE-IOPS" : "CO-RULE-THROUGHPUT",
      dimension,
      false,
      "Candidate capability and preserved I/O evidence are required."
    );
  }

  const observedP95 = dimension === "iops" ? evidence.iopsP95 : evidence.throughputP95;
  const observedP99 = dimension === "iops" ? evidence.iopsP99 : evidence.throughputP99;
  const candidateSustainedCapability = dimension === "iops"
    ? (evidence.candidateBaselineIops ?? entry.baselineIops)
    : (evidence.candidateBaselineThroughputMbps ?? entry.baselineThroughputMbps);
  const candidateBurstCapability = dimension === "iops"
    ? (evidence.candidateMaximumIops ?? entry.maxIops)
    : (evidence.candidateMaximumThroughputMbps ?? entry.maxThroughputMbps);
  const configuredCapability = dimension === "iops"
    ? context.currentConfig.provisionedIops
    : context.currentConfig.provisionedThroughputMbps;
  const effectiveSustainedCapability = activeEffectiveCapability(candidateSustainedCapability, configuredCapability);
  const effectiveBurstCapability = activeEffectiveCapability(candidateBurstCapability, configuredCapability);
  const p95Limit = effectiveSustainedCapability === undefined ? undefined : effectiveSustainedCapability * 0.70;
  const p99Limit = effectiveBurstCapability === undefined ? undefined : effectiveBurstCapability * 0.90;
  const fits =
    observedP95 !== undefined
    && observedP99 !== undefined
    && p95Limit !== undefined
    && p99Limit !== undefined
    && observedP95 <= p95Limit
    && observedP99 <= p99Limit;

  return finding(
    dimension === "iops" ? "CO-RULE-IOPS" : "CO-RULE-THROUGHPUT",
    dimension,
    fits,
    `${dimension} P95/P99=${format(observedP95)}/${format(observedP99)}; effective sustained/burst capability=${format(effectiveSustainedCapability)}/${format(effectiveBurstCapability)}; limits=${format(p95Limit)}/${format(p99Limit)}.`
  );
}

function activeEffectiveCapability(
  candidateCapability: number | undefined,
  configuredCapability: number | undefined
): number | undefined {
  if (
    candidateCapability === undefined
    || candidateCapability <= 0
    || configuredCapability === undefined
    || configuredCapability <= 0
  ) return undefined;
  return Math.min(candidateCapability, configuredCapability);
}

function cpuMetadataFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  const entry = exactCatalogEntry(context.catalog, recommended);
  if (!entry) {
    return finding(
      "CO-14-CPU-METADATA",
      "orderability",
      false,
      "Exact Region, edition, engine-version, and class metadata is unavailable for the recommendation."
    );
  }

  const visibleVcpu = recommended.sqlServerVisibleVcpu;
  const validMetadata = entry.sqlServerDefaultVcpuSource === "aws-processor-features";
  const valid = validMetadata && (recommended.cpuConfigurationType === "optimize_cpu"
    ? Boolean(validOptimizeCpu(entry, recommended) && visibleVcpu === recommended.cpuCoreCount! * recommended.cpuThreadsPerCore!)
    : visibleVcpu === entry.vcpu
      && (recommended.cpuCoreCount === undefined || recommended.cpuCoreCount === entry.defaultCpuCores)
      && (recommended.cpuThreadsPerCore === undefined || recommended.cpuThreadsPerCore === entry.defaultThreadsPerCore));
  return finding(
    "CO-14-CPU-METADATA",
    "orderability",
    valid,
    valid
      ? `SQL Server-visible vCPU ${visibleVcpu} and processor configuration match authoritative AWS SQL Server metadata.`
      : "Recommended SQL Server-visible vCPU provenance or processor configuration does not match authoritative AWS SQL Server metadata."
  );
}

function cpuProjectionFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  const evidence = context.result.optimizationEvidence;
  const samples = (context.workload.sampleSeries?.synchronized ?? [])
    .filter((sample) => sample.valid && sample.cpu.length === 1)
    .map((sample) => sample.cpu[0])
    .sort((left, right) => left.timestampMs - right.timestampMs);
  if (
    samples.length === 0
    || !recommended.sqlServerVisibleVcpu
    || !evidence
  ) {
    return finding(
      "CO-14-CPU-PROJECTION",
      "cpu",
      false,
      "Raw synchronized CPU samples, candidate visible vCPU, or preserved projection evidence is missing."
    );
  }

  const currentEntry = exactCatalogEntry(context.catalog, context.currentConfig);
  const candidateEntry = exactCatalogEntry(context.catalog, recommended);
  const factor = independentCapacityFactor(currentEntry, candidateEntry, context.currentConfig, recommended);
  const effectiveCandidateVcpu = recommended.sqlServerVisibleVcpu * factor;
  const sql = samples.map((sample) =>
    context.currentVcpu * sample.sqlCpuPct / effectiveCandidateVcpu
  );
  const total = samples.map((sample) =>
    context.currentVcpu * (sample.sqlCpuPct + sample.otherCpuPct) / effectiveCandidateVcpu
  );
  const sqlDistribution = metricDistribution(sql);
  const totalDistribution = metricDistribution(total);
  const p95Limit = 70;
  const matches =
    close(sqlDistribution.p95, evidence.projectedSqlCpuP95Pct)
    && close(sqlDistribution.p99, evidence.projectedSqlCpuP99Pct)
    && close(totalDistribution.p99, evidence.projectedTotalCpuP99Pct);
  const fits =
    sqlDistribution.p95 <= p95Limit
    && sqlDistribution.p99 <= 90
    && totalDistribution.p99 <= 90;

  return finding(
    "CO-14-CPU-PROJECTION",
    "cpu",
    matches && fits,
    `Independent projected SQL CPU P95/P99=${sqlDistribution.p95}/${sqlDistribution.p99}% and total CPU P99=${totalDistribution.p99}%; limits=${p95Limit}/90/90%.`
  );
}

function evidenceWindowFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const series = context.workload.sampleSeries;
  const reported = context.result.evidenceWindow;
  if (!series || !reported) {
    return finding(
      "CO-14-EVIDENCE-WINDOW",
      "orderability",
      false,
      "Canonical sample series or reported evidence-window assessment is unavailable."
    );
  }

  const timestamps = [
    ...series.cpu.map((sample) => sample.timestampMs),
    ...series.memory.map((sample) => sample.timestampMs),
    ...series.databaseIo.map((sample) => sample.timestampMs)
  ].filter(Number.isFinite);
  const durationHours = timestamps.length > 0
    ? round2((Math.max(...timestamps) - Math.min(...timestamps)) / 3_600_000)
    : 0;
  const continuityIssues = series.issues.filter((issue) =>
    ["missing_sample", "duplicate_sample", "out_of_order"].includes(issue.code)
  ).length;
  const classification = independentWindowClassification(durationHours);
  const expectedEligible = durationHours >= 48
    || (
      durationHours < 48
      && reported.shortWindowException?.customerConfirmed === true
      && ["clearly_idle", "non_production"].includes(reported.shortWindowException.category)
    );
  const passed =
    close(durationHours, reported.durationHours)
    && classification === reported.classification
    && continuityIssues === reported.continuityIssueCount
    && reported.productionRightsizingEligible === expectedEligible
    && reported.representativeness === "customer_confirmation_required";
  return finding(
    "CO-14-EVIDENCE-WINDOW",
    "orderability",
    passed,
    `Independent window=${round2(durationHours / 24)} days, classification=${classification}, continuity issues=${continuityIssues}; customer peak-period confirmation remains external.`
  );
}

function memoryFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const entry = exactCatalogEntry(context.catalog, context.result.recommendedConfig!);
  const samples = context.workload.sampleSeries?.memory ?? [];
  const evidence = context.result.optimizationEvidence;
  if (!entry || samples.length === 0 || !evidence) {
    return finding(
      "CO-14-MEMORY-WORKING-SET",
      "memory",
      false,
      "Candidate memory, raw memory samples, or preserved memory evidence is unavailable."
    );
  }

  const lessElastic = samples.flatMap((sample) => {
    const value = independentLessElasticMemoryMb(sample);
    return value === undefined ? [] : [value];
  });
  const observedFloorGb = lessElastic.length > 0
    ? round2(percentile(lessElastic, 95) * 1.2 / 1024)
    : undefined;
  const floorGb = observedFloorGb === undefined
    ? undefined
    : Math.max(observedFloorGb, context.requirements.memoryGb);
  const pressure = independentDirectMemoryPressure(samples);
  const currentMemoryGb = currentMemory(context);
  const reducing = currentMemoryGb === undefined || entry.memoryGb < currentMemoryGb;
  const fits = floorGb !== undefined
    && entry.memoryGb >= floorGb
    && !(reducing && pressure.state === "pressure_detected");
  const matches =
    close(floorGb, evidence.memoryRequiredFloorGb)
    && evidence.memoryPressureState === pressure.state;
  return finding(
    "CO-14-MEMORY-WORKING-SET",
    "memory",
    fits && matches,
    `Independent required memory floor=max(observed ${observedFloorGb ?? "unavailable"} GB with 20% headroom, preserved requirement ${context.requirements.memoryGb} GB)=${floorGb ?? "unavailable"} GB against ${entry.memoryGb} GB; direct pressure state=${pressure.state}; direct pressure signals=${pressure.signals.length}.`
  );
}

function memoryCouplingFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const entry = exactCatalogEntry(context.catalog, context.result.recommendedConfig!);
  const evidence = context.result.optimizationEvidence;
  const currentMemoryGb = currentMemory(context);
  if (!entry || !evidence || currentMemoryGb === undefined) {
    return finding(
      "CO-14-MEMORY-IO-COUPLING",
      "memory",
      false,
      "Current/candidate memory or preserved coupling evidence is unavailable."
    );
  }

  const currentEntry = exactCatalogEntry(context.catalog, context.currentConfig);
  const reductionPct = Math.max(0, (currentMemoryGb - entry.memoryGb) / currentMemoryGb * 100);
  const material = reductionPct >= 25
    || Boolean(currentEntry && currentEntry.family !== entry.family && reductionPct > 0);
  if (!material) {
    return finding(
      "CO-14-MEMORY-IO-COUPLING",
      "memory",
      evidence.memoryCouplingVerdict === "not_required",
      `Independent RAM reduction=${round2(reductionPct)}%; material coupling analysis is not required.`
    );
  }

  const coupling = independentMemoryCoupling(context.workload);
  const reportedMatches =
    evidence.materialMemoryReduction === true
    && evidence.memoryCouplingVerdict === coupling.verdict
    && close(coupling.correlation, evidence.readIopsSpearmanCorrelation)
    && close(coupling.increasePct, evidence.readIopsIncreasePct)
    && evidence.readIopsPersistenceMet === coupling.persistenceMet;
  return finding(
    "CO-14-MEMORY-IO-COUPLING",
    "memory",
    reportedMatches,
    `Independent coupling verdict=${coupling.verdict}; Spearman=${format(coupling.correlation)}, high-vs-low ReadIOPS=${format(coupling.increasePct)}%, persistence=${coupling.persistenceMet ? "met" : "not met"}.`
  );
}

function ioFinding(
  context: IndependentOracleContext,
  dimension: "iops" | "throughput"
): IndependentOracleFinding {
  const entry = exactCatalogEntry(context.catalog, context.result.recommendedConfig!);
  const evidence = context.result.optimizationEvidence;
  const physical = independentPhysicalIo(context.workload.sampleSeries?.databaseIo ?? []);
  if (!entry || !evidence || physical.length === 0) {
    return finding(
      dimension === "iops" ? "CO-14-IOPS" : "CO-14-THROUGHPUT",
      dimension,
      false,
      "Raw cumulative file evidence, candidate capability, or preserved result evidence is unavailable."
    );
  }

  const candidateLocal = entry.localInstanceStorage?.tempdbOnLocalStorage === true;
  const remapped = physical.map((sample) => remapIoSample(sample, candidateLocal));
  const values = dimension === "iops"
    ? remapped.map((sample) => sample.totalIops)
    : remapped.map((sample) => sample.totalMibPerSec);
  const stats = metricDistribution(values);
  const baseline = dimension === "iops" ? entry.baselineIops : entry.baselineThroughputMbps;
  const maximum = dimension === "iops" ? entry.maxIops : entry.maxThroughputMbps;
  const reportedP95 = dimension === "iops" ? evidence.iopsP95 : evidence.throughputP95;
  const reportedP99 = dimension === "iops" ? evidence.iopsP99 : evidence.throughputP99;
  const burstReliance = baseline !== undefined && stats.p99 > baseline && stats.p99 <= maximum;
  const burst = burstReliance ? independentBurst(remapped, baseline!, dimension) : undefined;
  const maxDuration = dimension === "iops"
    ? entry.maximumIopsBurstDurationMinutes
    : entry.maximumThroughputBurstDurationMinutes;
  const maxFrequency = dimension === "iops"
    ? entry.maximumIopsBurstEventsPer24Hours
    : entry.maximumThroughputBurstEventsPer24Hours;
  const fits =
    baseline !== undefined
    && stats.p95 <= baseline
    && stats.p99 <= maximum
    && (!burstReliance || (
      maxDuration !== undefined
      && maxFrequency !== undefined
      && burst!.longestMinutes <= maxDuration
      && burst!.eventsPer24Hours <= maxFrequency
    ));
  const matches = close(stats.p95, reportedP95) && close(stats.p99, reportedP99);

  return finding(
    dimension === "iops" ? "CO-14-IOPS" : "CO-14-THROUGHPUT",
    dimension,
    fits && matches,
    `Independent ${dimension} P95/P99=${stats.p95}/${stats.p99}, sustained/maximum=${baseline ?? "unavailable"}/${maximum}, burst reliance=${burstReliance ? "yes" : "no"}.`
  );
}

function tempdbFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const currentEntry = exactCatalogEntry(context.catalog, context.currentConfig);
  const candidateEntry = exactCatalogEntry(context.catalog, context.result.recommendedConfig!);
  const evidence = context.result.optimizationEvidence;
  if (!candidateEntry || !evidence) {
    return finding(
      "CO-14-TEMPDB",
      "tempdb",
      false,
      "Candidate local-storage metadata or preserved tempdb evidence is unavailable."
    );
  }

  const currentLocal = currentEntry
    ? currentEntry.localInstanceStorage?.tempdbOnLocalStorage === true
    : undefined;
  const candidateLocal = candidateEntry.localInstanceStorage?.tempdbOnLocalStorage === true;
  const expectedTransition = transition(currentLocal, candidateLocal);
  const representativeGb = mbToGb(context.workload.evidence?.tempdbUsage?.representativeAllocatedMb);
  const peakGb = mbToGb(context.workload.evidence?.tempdbUsage?.peakAllocatedMb);
  const capacity = candidateEntry.localInstanceStorage?.capacityGb;
  const capacityFits = !candidateLocal
    || (
      capacity !== undefined
      && representativeGb !== undefined
      && peakGb !== undefined
      && representativeGb <= capacity
      && peakGb <= capacity
    );
  const matches =
    evidence.tempdbPlacementTransition === expectedTransition
    && (!candidateLocal || (
      close(representativeGb, evidence.tempdbRepresentativeAllocatedGb)
      && close(peakGb, evidence.tempdbPeakAllocatedGb)
      && close(capacity, evidence.candidateLocalStorageCapacityGb)
    ));
  return finding(
    "CO-14-TEMPDB",
    "tempdb",
    matches && capacityFits,
    `Independent transition=${expectedTransition}; representative/peak=${representativeGb ?? "unavailable"}/${peakGb ?? "unavailable"} GB; target local capacity=${capacity ?? "not applicable"} GB.`
  );
}

function editionFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  if (
    context.currentConfig.sqlServerEdition !== "Enterprise"
    || recommended.sqlServerEdition !== "Standard"
  ) {
    return finding(
      "CO-14-EDITION",
      "edition",
      true,
      "No Enterprise-to-Standard migration is present in the recommendation."
    );
  }

  const evaluation = context.result.enterpriseToStandard;
  if (!evaluation) {
    return finding(
      "CO-14-EDITION",
      "edition",
      false,
      "Enterprise-to-Standard recommendation lacks preserved eligibility evidence."
    );
  }

  const major = sqlMajor(context.currentConfig.sqlServerVersion);
  const limits = major >= 17
    ? { sockets: 4, cores: 32, buffer: 256, columnstore: 64, memoryOptimized: 32 }
    : { sockets: 4, cores: 24, buffer: 128, columnstore: 32, memoryOptimized: 32 };
  const databases = context.workload.evidence?.edition?.databases ?? [];
  const featureCompatible = databases.length > 0
    && context.workload.evidence?.edition?.auditComplete === true
    && databases.every((database) =>
      database.auditStatus === "complete"
      && database.enterpriseFeatures.every((feature) => supportedStandardFeature(feature, major))
    );
  const vendorSupported = evaluation.confirmations?.vendorSupportsStandardEdition === true;
  const cores = recommended.cpuCoreCount
    ?? exactCatalogEntry(context.catalog, recommended)?.defaultCpuCores;
  const sockets = recommended.cpuSocketCount
    ?? exactCatalogEntry(context.catalog, recommended)?.cpuSocketCount
    ?? (recommended.instanceClass === context.currentConfig.instanceClass
      ? context.currentConfig.cpuSocketCount
      : undefined);
  const bufferGb = (context.workload.evidence?.memory?.bufferPoolMemoryMb?.max ?? Number.POSITIVE_INFINITY) / 1024;
  const columnstoreGb = (context.workload.evidence?.memory?.columnstoreSegmentCacheMb?.max ?? Number.POSITIVE_INFINITY) / 1024;
  const memoryOptimizedFits = databases.length > 0 && databases.every((database) =>
    Math.max(
      database.memoryOptimizedAllocatedMb ?? Number.POSITIVE_INFINITY,
      database.memoryOptimizedUsedMb ?? Number.POSITIVE_INFINITY
    ) / 1024 <= limits.memoryOptimized
  );
  const scaleFits =
    sockets !== undefined
    && sockets <= limits.sockets
    &&
    cores !== undefined
    && cores <= limits.cores
    && bufferGb <= limits.buffer
    && columnstoreGb <= limits.columnstore
    && memoryOptimizedFits;
  const orderable = Boolean(exactCatalogEntry(context.catalog, recommended));
  const migrationAccepted =
    evaluation.confirmations?.migrationPathAccepted === true
    && ["native_backup_restore", "aws_dms"].includes(evaluation.confirmations.migrationPath ?? "");
  const terms = [
    featureCompatible,
    vendorSupported,
    scaleFits,
    orderable,
    migrationAccepted
  ];
  const passed =
    terms.every(Boolean)
    && evaluation.eligible === terms.every(Boolean)
    && evaluation.terms.featureCompatible.passed === featureCompatible
    && evaluation.terms.vendorSupported.passed === vendorSupported
    && evaluation.terms.standardScaleLimitsFit.passed === scaleFits
    && evaluation.terms.rdsClassVersionOrderable.passed === orderable
    && evaluation.terms.migrationPathAccepted.passed === migrationAccepted;
  return finding(
    "CO-14-EDITION",
    "edition",
    passed,
    `Independent edition terms: feature=${featureCompatible}, vendor=${vendorSupported}, sockets=${sockets ?? "unavailable"}/${limits.sockets}, scale=${scaleFits}, orderability=${orderable}, migration=${migrationAccepted}.`
  );
}

function candidateEvidenceFinding(context: IndependentOracleContext): IndependentOracleFinding {
  const recommended = context.result.recommendedConfig!;
  const selected = context.result.candidateEvaluations.filter((candidate) => candidate.selected);
  const matches = selected.length === 1
    && selected[0].accepted
    && selected[0].instanceClass === recommended.instanceClass
    && selected[0].sqlServerVisibleVcpu === recommended.sqlServerVisibleVcpu
    && context.result.candidateEvaluations.every((candidate) =>
      candidate.accepted || candidate.failedGates.length > 0
    );
  return finding(
    "CO-14-CANDIDATE-EVIDENCE",
    "orderability",
    matches,
    matches
      ? `${context.result.candidateEvaluations.length} candidate evaluation record(s) preserve the selected candidate and all rejection reasons.`
      : "Candidate history does not uniquely identify the selected recommendation or preserve every rejection reason."
  );
}

function independentPhysicalIo(samples: readonly DatabaseIoWorkloadSample[]): OracleIoSample[] {
  const cumulative = samples.filter((sample) => sample.counterMode === "cumulative");
  const byTimestamp = new Map<number, Map<string, DatabaseIoWorkloadSample>>();
  for (const sample of cumulative) {
    const rows = byTimestamp.get(sample.timestampMs) ?? new Map<string, DatabaseIoWorkloadSample>();
    rows.set(oracleFileKey(sample), sample);
    byTimestamp.set(sample.timestampMs, rows);
  }

  const timestamps = [...byTimestamp.keys()].sort((left, right) => left - right);
  const results: OracleIoSample[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const previousRows = byTimestamp.get(timestamps[index - 1])!;
    const currentRows = byTimestamp.get(timestamps[index])!;
    const requiredFiles = new Set([...previousRows.keys(), ...currentRows.keys()]);
    const elapsed = (timestamps[index] - timestamps[index - 1]) / 1000;
    const firstCurrent = currentRows.values().next().value as DatabaseIoWorkloadSample | undefined;
    if (!firstCurrent) continue;
    const aggregate = emptyOracleIo(firstCurrent, elapsed);
    let intervalInvalid = elapsed <= 0;
    let validFileCount = 0;

    for (const key of requiredFiles) {
      const previous = previousRows.get(key);
      const current = currentRows.get(key);
      if (!previous || !current) {
        intervalInvalid = true;
        continue;
      }
      const deltas = [
        current.readOperations - previous.readOperations,
        current.writeOperations - previous.writeOperations,
        current.bytesRead - previous.bytesRead,
        current.bytesWritten - previous.bytesWritten
      ];
      if (!current.intervalValid || elapsed <= 0 || deltas.some((value) => value < 0)) {
        intervalInvalid = true;
        continue;
      }
      const [reads, writes, bytesRead, bytesWritten] = deltas;
      const readIops = reads / elapsed;
      const writeIops = writes / elapsed;
      const readMib = bytesRead / elapsed / 1_048_576;
      const writeMib = bytesWritten / elapsed / 1_048_576;
      aggregate.readIops += readIops;
      aggregate.writeIops += writeIops;
      aggregate.totalIops += readIops + writeIops;
      aggregate.readMibPerSec += readMib;
      aggregate.writeMibPerSec += writeMib;
      aggregate.totalMibPerSec += readMib + writeMib;
      if (current.isTempdb) {
        aggregate.tempdbReadIops += readIops;
        aggregate.tempdbWriteIops += writeIops;
        aggregate.tempdbReadMibPerSec += readMib;
        aggregate.tempdbWriteMibPerSec += writeMib;
      } else {
        aggregate.nonTempdbReadIops += readIops;
        aggregate.nonTempdbWriteIops += writeIops;
        aggregate.nonTempdbReadMibPerSec += readMib;
        aggregate.nonTempdbWriteMibPerSec += writeMib;
      }
      validFileCount += 1;
    }

    if (!intervalInvalid && validFileCount === requiredFiles.size) results.push(aggregate);
  }
  return results;
}

function oracleFileKey(sample: DatabaseIoWorkloadSample): string {
  return `${sample.databaseId ?? sample.databaseName}|${sample.fileId ?? "database"}`;
}

function emptyOracleIo(
  sample: DatabaseIoWorkloadSample,
  elapsedSeconds: number
): OracleIoSample {
  return {
    sampleKey: sample.sampleKey,
    timestampMs: sample.timestampMs,
    elapsedSeconds,
    readIops: 0,
    writeIops: 0,
    totalIops: 0,
    readMibPerSec: 0,
    writeMibPerSec: 0,
    totalMibPerSec: 0,
    nonTempdbReadIops: 0,
    nonTempdbWriteIops: 0,
    nonTempdbReadMibPerSec: 0,
    nonTempdbWriteMibPerSec: 0,
    tempdbReadIops: 0,
    tempdbWriteIops: 0,
    tempdbReadMibPerSec: 0,
    tempdbWriteMibPerSec: 0
  };
}

function remapIoSample(sample: OracleIoSample, tempdbOnLocal: boolean): OracleIoSample {
  if (!tempdbOnLocal) return sample;
  return {
    ...sample,
    readIops: sample.nonTempdbReadIops,
    writeIops: sample.nonTempdbWriteIops,
    totalIops: sample.nonTempdbReadIops + sample.nonTempdbWriteIops,
    readMibPerSec: sample.nonTempdbReadMibPerSec,
    writeMibPerSec: sample.nonTempdbWriteMibPerSec,
    totalMibPerSec: sample.nonTempdbReadMibPerSec + sample.nonTempdbWriteMibPerSec
  };
}

function independentBurst(
  samples: OracleIoSample[],
  threshold: number,
  dimension: "iops" | "throughput"
): { longestMinutes: number; eventsPer24Hours: number } {
  let events = 0;
  let longest = 0;
  let current = 0;
  let previousTimestamp: number | undefined;
  for (const sample of samples) {
    const value = dimension === "iops" ? sample.totalIops : sample.totalMibPerSec;
    const continuous = previousTimestamp !== undefined
      && sample.timestampMs - previousTimestamp <= sample.elapsedSeconds * 1000;
    if (value > threshold) {
      if (!continuous || current === 0) {
        events += 1;
        current = 0;
      }
      current += sample.elapsedSeconds / 60;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
    previousTimestamp = sample.timestampMs;
  }
  const durationDays = samples.length === 0
    ? 0
    : (samples[samples.length - 1].timestampMs - samples[0].timestampMs + samples[samples.length - 1].elapsedSeconds * 1000) / 86_400_000;
  return {
    longestMinutes: round2(longest),
    eventsPer24Hours: round2(durationDays > 0 ? events / durationDays : 0)
  };
}

function independentMemoryCoupling(workload: WorkloadProfile): {
  verdict: "stable_working_set" | "aggressive_medium_confidence";
  correlation?: number;
  increasePct?: number;
  persistenceMet: boolean;
} {
  const synchronized = workload.sampleSeries?.synchronized ?? [];
  const physicalIoBySample = new Map(
    independentPhysicalIo(workload.sampleSeries?.databaseIo ?? [])
      .map((sample) => [sample.sampleKey, sample])
  );
  const batchRates = counterRates(
    workload.sampleSeries?.memory ?? [],
    (sample) => sample.batchRequestsCounter
  );
  for (const sample of workload.sampleSeries?.memory ?? []) {
    if (sample.batchRequestsPerSec !== undefined && sample.batchRequestsPerSec >= 0) {
      batchRates.set(sample.sampleKey, sample.batchRequestsPerSec);
    }
  }
  const points = synchronized.flatMap((sample) => {
    if (!sample.valid || sample.memory.length !== 1) return [];
    const memory = sample.memory[0];
    if (!memory.osTotalMemoryMb || memory.osAvailableMemoryMb === undefined) return [];
    const physicalReadIops = physicalIoBySample.get(sample.sampleKey)?.readIops;
    const intervalRows = [...sample.userDatabaseIo, ...sample.tempdbIo]
      .filter((row) =>
        row.counterMode !== "cumulative"
        && row.elapsedSeconds !== undefined
        && row.elapsedSeconds > 0
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
      pressure: (1 - memory.osAvailableMemoryMb / memory.osTotalMemoryMb) * 100,
      readIops,
      batch: batchRates.get(sample.sampleKey)
    }];
  });
  const normalize = points.length > 0 && points.every((point) => point.batch !== undefined && point.batch > 0);
  const evaluated = points.map((point) => ({
    ...point,
    value: normalize ? point.readIops / point.batch! : point.readIops
  }));
  const pressures = evaluated.map((point) => point.pressure);
  const correlation = spearman(pressures, evaluated.map((point) => point.value));
  const lowCut = percentile(pressures, 25);
  const highCut = percentile(pressures, 75);
  const lowMedian = median(evaluated.filter((point) => point.pressure <= lowCut).map((point) => point.value));
  const highMedian = median(evaluated.filter((point) => point.pressure >= highCut).map((point) => point.value));
  const increasePct = lowMedian === 0
    ? highMedian > 0 ? Number.POSITIVE_INFINITY : 0
    : (highMedian - lowMedian) / lowMedian * 100;
  const qualifying = new Set(evaluated
    .filter((point) => point.pressure >= highCut && point.value >= lowMedian * 1.2 && point.value > lowMedian)
    .map((point) => point.sampleKey));
  const samplePct = evaluated.length > 0 ? qualifying.size / evaluated.length * 100 : 0;
  const periods = pressurePeriods(evaluated, qualifying);
  const persistenceMet = samplePct >= 10 || periods >= 3;
  const relationshipSafe = correlation !== undefined
    && (correlation < 0.4 || increasePct < 20 || !persistenceMet);
  const lazyRates = counterRates(workload.sampleSeries?.memory ?? [], (sample) => sample.lazyWritesCounter);
  const pageReadRates = counterRates(workload.sampleSeries?.memory ?? [], (sample) => sample.pageReadsCounter);
  const pageReadsHaveBatchRate = pageReadRates.size > 0
    && [...pageReadRates.keys()].every((sampleKey) => (batchRates.get(sampleKey) ?? 0) > 0);
  const cpuBySample = new Map(synchronized.flatMap((sample) =>
    sample.cpu.length === 1 ? [[sample.sampleKey, sample.cpu[0].sqlCpuPct] as const] : []
  ));
  const pageReadTrend = slope([...pageReadRates.entries()].flatMap(([sampleKey, pageReads]) => {
    const batch = batchRates.get(sampleKey);
    if (pageReadsHaveBatchRate && batch !== undefined && batch > 0) return [pageReads / batch];
    const sqlCpu = cpuBySample.get(sampleKey);
    return sqlCpu === undefined ? [] : [pageReads / Math.max(sqlCpu, 1)];
  }));
  const complete =
    correlation !== undefined
    && workload.evidence?.memory?.bufferCacheHitRatioPct?.p05 !== undefined
    && lazyRates.size > 0
    && pageReadTrend !== undefined
    && workload.evidence?.memory?.evidenceConfidence === "high";
  const stable =
    complete
    && (workload.evidence?.memory?.pressureSignals.length ?? 0) === 0
    && percentile([...lazyRates.values()], 95) === 0
    && pageReadTrend! <= 0
    && relationshipSafe
    && (workload.evidenceWindow?.durationDays ?? workload.collectionHours / 24) >= 7;
  return {
    verdict: stable ? "stable_working_set" : "aggressive_medium_confidence",
    correlation,
    increasePct,
    persistenceMet
  };
}

function independentLessElasticMemoryMb(sample: MemoryWorkloadSample): number | undefined {
  const clerks = parseClerks(sample.memoryClerksJson);
  const bufferPool = clerks
    .filter((clerk) => clerk.type.includes("SQLBUFFERPOOL"))
    .reduce((sum, clerk) => sum + clerk.sizeMb, 0);
  const nonBuffer = clerks
    .filter((clerk) => !clerk.type.includes("SQLBUFFERPOOL"))
    .reduce((sum, clerk) => sum + clerk.sizeMb, 0);
  const processMb = sample.physicalMemoryInUseKb !== undefined
    ? sample.physicalMemoryInUseKb / 1024
    : sample.sqlCommittedMemoryMb;
  const sqlLessElastic = processMb !== undefined && bufferPool > 0
    ? Math.max(sample.stolenServerMemoryMb ?? 0, processMb - bufferPool)
    : Math.max(sample.stolenServerMemoryMb ?? 0, nonBuffer);
  const osNonSql = sample.osTotalMemoryMb !== undefined
    && sample.osAvailableMemoryMb !== undefined
    && processMb !== undefined
      ? Math.max(0, sample.osTotalMemoryMb - sample.osAvailableMemoryMb - processMb)
      : 0;
  return sqlLessElastic > 0 || osNonSql > 0 ? sqlLessElastic + osNonSql : undefined;
}

function independentDirectMemoryPressure(samples: readonly MemoryWorkloadSample[]): {
  state: "pressure_detected" | "isolated_pressure_detected" | "no_direct_pressure_detected" | "insufficient_evidence";
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
  const pending = samples.flatMap((sample) =>
    sample.memoryGrantsPending === undefined ? [] : [sample.memoryGrantsPending]
  );
  if (pending.some((value) => value > 0)) {
    const stats = independentPressurePersistence(samples, (sample) => (sample.memoryGrantsPending ?? 0) > 0);
    if (percentile(pending, 95) > 0 || independentPressurePersistenceMet(stats)) {
      blockingSignals.push("grants_pending");
    } else {
      isolatedSignals.push("grants_pending_isolated");
    }
  }

  const physicalLow = independentPressurePersistence(samples, (sample) => sample.processPhysicalMemoryLow === true);
  if (physicalLow.sampleCount > 0) {
    if (independentPressurePersistenceMet(physicalLow)) blockingSignals.push("process_physical_low");
    else isolatedSignals.push("process_physical_low_isolated");
  }

  const virtualLow = independentPressurePersistence(samples, (sample) => sample.processVirtualMemoryLow === true);
  if (virtualLow.sampleCount > 0) {
    if (independentPressurePersistenceMet(virtualLow)) blockingSignals.push("process_virtual_low");
    else isolatedSignals.push("process_virtual_low_isolated");
  }

  const systemLow = independentPressurePersistence(samples, (sample) => sample.systemLowMemorySignalState === true);
  if (systemLow.sampleCount > 0) {
    if (independentPressurePersistenceMet(systemLow)) blockingSignals.push("system_low");
    else isolatedSignals.push("system_low_isolated");
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

function independentPressurePersistence(
  samples: readonly MemoryWorkloadSample[],
  qualifies: (sample: MemoryWorkloadSample) => boolean
): { sampleCount: number; samplePct: number; periodCount: number } {
  const ordered = [...samples].sort((left, right) => left.timestampMs - right.timestampMs);
  let sampleCount = 0;
  let periodCount = 0;
  let consecutive = 0;
  let previousTimestampMs: number | undefined;

  for (const sample of ordered) {
    const qualified = qualifies(sample);
    if (qualified) sampleCount += 1;
    const continuous =
      previousTimestampMs === undefined
      || sample.timestampMs - previousTimestampMs <= 60_000;
    if (qualified && continuous) {
      consecutive += 1;
    } else {
      if (consecutive >= 5) periodCount += 1;
      consecutive = qualified ? 1 : 0;
    }
    previousTimestampMs = sample.timestampMs;
  }
  if (consecutive >= 5) periodCount += 1;

  return {
    sampleCount,
    samplePct: ordered.length > 0 ? sampleCount / ordered.length * 100 : 0,
    periodCount
  };
}

function independentPressurePersistenceMet(stats: { samplePct: number; periodCount: number }): boolean {
  return stats.samplePct >= 10 || stats.periodCount >= 3;
}

function parseClerks(value: string | undefined): Array<{ type: string; sizeMb: number }> {
  if (!value) return [];
  try {
    const rows = JSON.parse(value) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      const type = String(row.ClerkType ?? row.clerkType ?? row.type ?? "").toUpperCase();
      const sizeMb = Number(row.SizeMb ?? row.sizeMb ?? row.size_mb);
      return type && Number.isFinite(sizeMb) && sizeMb >= 0 ? [{ type, sizeMb }] : [];
    });
  } catch {
    return [];
  }
}

function currentMemory(context: IndependentOracleContext): number | undefined {
  return exactCatalogEntry(context.catalog, context.currentConfig)?.memoryGb
    ?? (context.workload.evidence?.memory?.osTotalMemoryMb !== undefined
      ? context.workload.evidence.memory.osTotalMemoryMb / 1024
      : undefined);
}

function exactCatalogEntry(
  catalog: readonly InstanceCatalogEntry[],
  config: CurrentRdsConfig
): InstanceCatalogEntry | undefined {
  return catalog.find((entry) =>
    entry.instanceClass === config.instanceClass
    && entry.region === config.region
    && Boolean(entry.engine)
    && entry.sqlServerEdition === config.sqlServerEdition
    && Boolean(entry.engineVersion)
    && versionMatches(config.sqlServerVersion, entry.engineVersion!)
    && entry.orderable === true
    && entry.sqlServerDefaultVcpuSource === "aws-processor-features"
  );
}

function exactCatalogEntryForClass(
  context: IndependentOracleContext,
  instanceClass: string
): InstanceCatalogEntry | undefined {
  return context.catalog.find((entry) =>
    entry.instanceClass === instanceClass
    && entry.region === context.currentConfig.region
    && Boolean(entry.engine)
    && entry.sqlServerEdition === context.currentConfig.sqlServerEdition
    && Boolean(entry.engineVersion)
    && versionMatches(context.currentConfig.sqlServerVersion, entry.engineVersion!)
    && entry.orderable === true
    && entry.sqlServerDefaultVcpuSource === "aws-processor-features"
    && (context.currentConfig.multiAz !== true || entry.multiAzCapable !== false)
  );
}

function validOptimizeCpu(entry: InstanceCatalogEntry, config: CurrentRdsConfig): OptimizeCpuConfiguration | undefined {
  return entry.optimizeCpuConfigurations?.find((candidate) =>
    candidate.coreCount === config.cpuCoreCount
    && candidate.threadsPerCore === config.cpuThreadsPerCore
    && candidate.sqlServerVisibleVcpu === config.sqlServerVisibleVcpu
  );
}

function independentCapacityFactor(
  current: InstanceCatalogEntry | undefined,
  candidate: InstanceCatalogEntry | undefined,
  currentConfig: CurrentRdsConfig,
  recommended: CurrentRdsConfig
): number {
  if (currentConfig.instanceClass === recommended.instanceClass) return 1;
  const currentFamily = current?.family ?? family(currentConfig.instanceClass);
  const candidateFamily = candidate?.family ?? family(recommended.instanceClass);
  if (currentFamily === candidateFamily) return 1;
  if (current?.normalizedPerCoreCapacity && candidate?.normalizedPerCoreCapacity) {
    return candidate.normalizedPerCoreCapacity / current.normalizedPerCoreCapacity;
  }
  return 1;
}

function metricDistribution(values: readonly number[]): MetricDistribution {
  return {
    avg: round2(values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)),
    p50: round2(percentile(values, 50)),
    p90: round2(percentile(values, 90)),
    p95: round2(percentile(values, 95)),
    p99: round2(percentile(values, 99)),
    max: round2(values.length > 0 ? Math.max(...values) : 0)
  };
}

function percentile(values: readonly number[], pct: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = pct / 100 * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  return sorted[lower] * (1 - (rank - lower)) + sorted[upper] * (rank - lower);
}

function median(values: readonly number[]): number {
  return percentile(values, 50);
}

function counterRates(
  samples: readonly MemoryWorkloadSample[],
  valueOf: (sample: MemoryWorkloadSample) => number | undefined
): Map<string, number> {
  const result = new Map<string, number>();
  const ordered = [...samples].sort((left, right) => left.timestampMs - right.timestampMs);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = valueOf(ordered[index - 1]);
    const current = valueOf(ordered[index]);
    const elapsed = (ordered[index].timestampMs - ordered[index - 1].timestampMs) / 1000;
    if (previous === undefined || current === undefined || current < previous || elapsed <= 0) continue;
    result.set(ordered[index].sampleKey, (current - previous) / elapsed);
  }
  return result;
}

function spearman(left: readonly number[], right: readonly number[]): number | undefined {
  if (left.length !== right.length || left.length < 3) return undefined;
  const leftRanks = ranks(left);
  const rightRanks = ranks(right);
  const leftMean = leftRanks.reduce((sum, value) => sum + value, 0) / leftRanks.length;
  const rightMean = rightRanks.reduce((sum, value) => sum + value, 0) / rightRanks.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < leftRanks.length; index += 1) {
    const l = leftRanks[index] - leftMean;
    const r = rightRanks[index] - rightMean;
    numerator += l * r;
    leftVariance += l * l;
    rightVariance += r * r;
  }
  return leftVariance === 0 || rightVariance === 0
    ? 0
    : numerator / Math.sqrt(leftVariance * rightVariance);
}

function ranks(values: readonly number[]): number[] {
  const ordered = values.map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const result = new Array<number>(values.length);
  let start = 0;
  while (start < ordered.length) {
    let end = start;
    while (end + 1 < ordered.length && ordered[end + 1].value === ordered[start].value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let index = start; index <= end; index += 1) result[ordered[index].index] = rank;
    start = end + 1;
  }
  return result;
}

function pressurePeriods(
  points: Array<{ sampleKey: string; timestampMs: number }>,
  qualifying: Set<string>
): number {
  let periods = 0;
  let consecutive = 0;
  let previous: number | undefined;
  for (const point of points) {
    const continuous = previous === undefined || point.timestampMs - previous <= 60_000;
    if (qualifying.has(point.sampleKey) && continuous) {
      consecutive += 1;
    } else {
      if (consecutive >= 5) periods += 1;
      consecutive = qualifying.has(point.sampleKey) ? 1 : 0;
    }
    previous = point.timestampMs;
  }
  if (consecutive >= 5) periods += 1;
  return periods;
}

function slope(values: readonly number[]): number | undefined {
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

function transition(currentLocal: boolean | undefined, candidateLocal: boolean): string {
  if (currentLocal === undefined) return "unknown";
  if (!currentLocal && !candidateLocal) return "non_nvme_to_non_nvme";
  if (!currentLocal && candidateLocal) return "non_nvme_to_nvme";
  if (currentLocal && candidateLocal) return "nvme_to_nvme";
  return "nvme_to_non_nvme";
}

function independentWindowClassification(hours: number): string {
  if (hours < 48) return "insufficient";
  if (hours < 72) return "below_preliminary_window";
  if (hours < 168) return "preliminary";
  if (hours < 336) return "minimum_recommended";
  if (hours >= 720 && hours <= 768) return "monthly_cycle";
  return "preferred";
}

function supportedStandardFeature(feature: string, major: number): boolean {
  const normalized = feature.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if ([
    "changecapture",
    "columnstoreindex",
    "compression",
    "inmemoryoltp",
    "multiplefscontainers",
    "partitioning"
  ].includes(normalized)) return major >= 13;
  if (normalized === "transparentdataencryption") return major >= 15;
  return false;
}

function versionMatches(product: string, engine: string): boolean {
  const productParts = (product.match(/\d+/g) ?? []).slice(0, 4).map(Number);
  const engineParts = (engine.match(/\d+/g) ?? []).slice(0, 4).map(Number);
  return productParts.length >= 3
    && engineParts.length >= productParts.length
    && productParts.every((part, index) => engineParts[index] === part);
}

function sqlMajor(value: string): number {
  return Number(value.match(/^(\d+)/)?.[1] ?? 0);
}

function family(instanceClass: string): string {
  return instanceClass.split(".")[1] ?? "unknown";
}

function mbToGb(value: number | undefined): number | undefined {
  return value === undefined ? undefined : round2(value / 1024);
}

function close(left: number | undefined, right: number | undefined, tolerance = 0.05): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left === right || Math.abs(left - right) <= tolerance;
}

function format(value: number | undefined): string {
  if (value === undefined) return "unavailable";
  if (!Number.isFinite(value)) return ">100";
  return String(round2(value));
}

function finding(
  oracle: string,
  dimension: OptimizationBlocker["dimension"],
  passed: boolean,
  message: string
): IndependentOracleFinding {
  return { oracle, dimension, passed, message };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
