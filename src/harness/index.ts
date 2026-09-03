import type {
  CpuState,
  CurrentRdsConfig,
  EnterpriseToStandardEvaluation,
  LicenseModel,
  OptimizationResult,
  SqlServerEdition,
  WorkloadProfile
} from "../contracts/types.js";
import type {
  CandidateRequirements,
  InstanceCatalogEntry
} from "../catalog/index.js";
import {
  runIndependentRecommendationOracles,
  type IndependentOracleFinding
} from "./oracles.js";

const VERIFIED_CPU_P95_TARGET_PCT = 70;
const VERIFIED_CPU_P99_SAFETY_LIMIT_PCT = 90;
const VERIFIED_TOTAL_CPU_P99_HARD_LIMIT_PCT = 90;
const VERIFIED_IO_P95_HEADROOM = 0.70;
const VERIFIED_IO_P99_HEADROOM = 0.90;

export interface HarnessFinding {
  oracle: string;
  dimension: OptimizationResult["blockers"][number]["dimension"];
  passed: boolean;
  message: string;
}

export interface EditionChangeEligibility {
  eligible: boolean;
  blockers: string[];
  evidence?: string[];
}

export interface CostHarnessContext {
  result: OptimizationResult;
  workload: WorkloadProfile;
  catalog: InstanceCatalogEntry[];
  currentConfig: CurrentRdsConfig;
  requirements: CandidateRequirements;
  currentVcpu: number;
  orderedCandidateInstanceClasses?: string[];
  usedSsatWebSizingEngine?: boolean;
  editionChangeEligibility?: EditionChangeEligibility;
}

export function runCostHarness(context: CostHarnessContext): HarnessFinding[] {
  const findings: HarnessFinding[] = [];
  const recommended = context.result.recommendedConfig;

  findings.push(passFail(
    "CO-J-INDEPENDENT-SIZING",
    !context.usedSsatWebSizingEngine,
    "Cost Optimization must not call SSATWeb sizing/recommendation logic."
  ));

  findings.push(passFail(
    "CO-B-LICENSE-MODEL-VALID",
    licenseModelValid(context.currentConfig.sqlServerEdition, context.currentConfig.licenseModel),
    `License model ${context.currentConfig.licenseModel} must be valid for SQL Server ${context.currentConfig.sqlServerEdition}.`
  ));

  findings.push(passFail(
    "CO-C-EE-TO-SE-ELIGIBILITY",
    editionChangeAllowed(
      context.currentConfig,
      recommended,
      context.result.enterpriseToStandard ?? context.editionChangeEligibility
    ),
    editionChangeMessage(
      context.currentConfig,
      recommended,
      context.result.enterpriseToStandard ?? context.editionChangeEligibility
    )
  ));

  if (context.orderedCandidateInstanceClasses !== undefined) {
    findings.push(cpuStateClassificationFinding(context));
  }

  if (!recommended) {
    findings.push(passFail(
      "CO-H-BLOCKED-RESULT-HAS-BLOCKERS",
      context.result.blockers.length > 0,
      "Blocked/no-recommendation result must explain blockers."
    ));
    return findings;
  }

  const validation = independentRecommendedCandidateValidation(context, recommended);
  const entry = validation.entry;

  findings.push(passFail(
    "CO-A-ORDERABLE-CATALOG",
    Boolean(entry),
    validation.failures[0] ?? "Recommended instance has an exact AWS SQL Server orderability row."
  ));

  findings.push(passFail(
    "CO-A-ORDERABLE-CONSTRAINTS",
    validation.failures.length === 0,
    validation.failures.length === 0
      ? "Recommended instance satisfies exact Region, edition, engine-build, processor, and Multi-AZ orderability constraints."
      : validation.failures.join("; ")
  ));

  findings.push(passFail(
    "CO-F-ARCHITECTURE-SUPPORTED",
    architectureSupported(entry),
    `${recommended.instanceClass} must be an x86 SQL Server-supported RDS class, not an ARM/Graviton class.`
  ));

  if (!entry) return findings;

  findings.push(passFail(
    "CO-I-CPU-FIT",
    cpuProjectionFits(context.result),
    cpuProjectionMessage(context.result)
  ));

  findings.push(passFail(
    "CO-I-MEMORY-FIT",
    memoryProjectionFits(context.result, entry.memoryGb, context.requirements.memoryGb),
    memoryProjectionMessage(context.result, entry.memoryGb, context.requirements.memoryGb)
  ));

  findings.push(passFail(
    "CO-I-IOPS-FIT",
    iopsProjectionFits(context.result, entry),
    iopsProjectionMessage(context.result, entry)
  ));

  findings.push(passFail(
    "CO-I-THROUGHPUT-FIT",
    throughputProjectionFits(context.result, entry),
    throughputProjectionMessage(context.result, entry)
  ));

  const databaseAttributionAvailable = context.workload.databases.some((database) =>
    database.iops !== undefined
    || database.throughputMbps !== undefined
    || database.tempdbSharePct !== undefined
    || database.advisoryCpuSharePct !== undefined
    || database.advisoryMemorySharePct !== undefined
  );
  findings.push(passFail(
    "CO-DB-ATTRIBUTION-PRESENT",
    !databaseAttributionAvailable || context.result.topOffendingDatabases.length > 0,
    databaseAttributionAvailable
      ? "Result should preserve top offending database attribution when workload DB metrics exist."
      : "Missing database attribution does not block server-level assessment when no resource-attribution evidence exists."
  ));

  findings.push(...runIndependentRecommendationOracles(context).map(toHarnessFinding));

  return findings;
}

export function assertHarnessPassed(findings: HarnessFinding[]): void {
  const failures = findings.filter((finding) => !finding.passed);
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => `${failure.oracle}: ${failure.message}`).join("\n"));
  }
}

function passFail(
  oracle: string,
  passed: boolean,
  message: string,
  dimension: HarnessFinding["dimension"] = "orderability"
): HarnessFinding {
  return { oracle, dimension, passed, message };
}

function cpuStateClassificationFinding(context: CostHarnessContext): HarnessFinding {
  const expectedState = expectedCpuState(context);
  const pressure = context.workload.cpuPressure;
  const target = VERIFIED_CPU_P95_TARGET_PCT;
  const policyEvidenceValid = !pressure || (
    pressure.highCpuThresholdPct === target
    && pressure.sustainedPressure === (context.workload.cpuPct.p95 > target)
  );
  const passed = policyEvidenceValid && context.result.cpuState === expectedState;
  const evidenceMessage = pressure
    ? `SQL CPU P95=${context.workload.cpuPct.p95}% against ${target}%; samples above target=${pressure.highCpuSamplePct}%`
    : `SQL CPU P95=${context.workload.cpuPct.p95}% against ${target}%`;

  return passFail(
    "CO-L-CPU-STATE-CLASSIFICATION",
    passed,
    `Reported CPU state ${context.result.cpuState ?? "missing"}; independently expected ${expectedState}; CPU P95=${context.workload.cpuPct.p95}%; ${evidenceMessage}.`,
    "cpu"
  );
}

function expectedCpuState(context: CostHarnessContext): CpuState {
  const target = VERIFIED_CPU_P95_TARGET_PCT;
  if (context.workload.cpuPct.p95 > target) {
    return "under_pressure";
  }

  const samples = (context.workload.sampleSeries?.synchronized ?? [])
    .filter((sample) => sample.valid && sample.cpu.length === 1)
    .map((sample) => sample.cpu[0]);
  if (samples.length === 0) return "normal";
  const smallerSupportedCandidateFits = independentCpuOnlyCandidateFits(context, samples);

  return smallerSupportedCandidateFits ? "underutilized" : "normal";
}

function cpuProjectionFits(result: OptimizationResult): boolean {
  const evidence = result.optimizationEvidence;
  const crossFamilyValidationRequired = evidence?.cpuProjectionBasis === "unadjusted_cross_family";
  return evidence?.cpuP95TargetPct === VERIFIED_CPU_P95_TARGET_PCT
    && evidence.cpuP99SafetyLimitPct === VERIFIED_CPU_P99_SAFETY_LIMIT_PCT
    && evidence.totalCpuP99HardLimitPct === VERIFIED_TOTAL_CPU_P99_HARD_LIMIT_PCT
    && evidence.projectedSqlCpuP95Pct !== undefined
    && evidence.projectedSqlCpuP95Pct <= VERIFIED_CPU_P95_TARGET_PCT
    && evidence.projectedSqlCpuP99Pct !== undefined
    && evidence.projectedSqlCpuP99Pct <= VERIFIED_CPU_P99_SAFETY_LIMIT_PCT
    && evidence.projectedTotalCpuP99Pct !== undefined
    && evidence.projectedTotalCpuP99Pct <= VERIFIED_TOTAL_CPU_P99_HARD_LIMIT_PCT
    && (!crossFamilyValidationRequired || result.decision !== "Recommended");
}

function cpuProjectionMessage(result: OptimizationResult): string {
  const evidence = result.optimizationEvidence;
  return `Projected SQL CPU P95=${evidence?.projectedSqlCpuP95Pct ?? "missing"}% (verified limit ${VERIFIED_CPU_P95_TARGET_PCT}%; reported ${evidence?.cpuP95TargetPct ?? "missing"}%), SQL CPU P99=${evidence?.projectedSqlCpuP99Pct ?? "missing"}% (verified limit ${VERIFIED_CPU_P99_SAFETY_LIMIT_PCT}%; reported ${evidence?.cpuP99SafetyLimitPct ?? "missing"}%), total CPU P99=${evidence?.projectedTotalCpuP99Pct ?? "missing"}% (verified limit ${VERIFIED_TOTAL_CPU_P99_HARD_LIMIT_PCT}%; reported ${evidence?.totalCpuP99HardLimitPct ?? "missing"}%); basis=${evidence?.cpuProjectionBasis ?? "missing"}; decision=${result.decision}.`;
}

function memoryProjectionFits(result: OptimizationResult, candidateMemoryGb: number, fallbackRequiredMemoryGb: number): boolean {
  const evidence = result.optimizationEvidence;
  const requiredFloorGb = evidence?.memoryRequiredFloorGb ?? fallbackRequiredMemoryGb;
  const pressureAllowsReduction = evidence?.memoryPressureState !== "pressure_detected"
    || (evidence.memoryReductionPct ?? 0) <= 0;
  return candidateMemoryGb >= requiredFloorGb && pressureAllowsReduction;
}

function memoryProjectionMessage(result: OptimizationResult, candidateMemoryGb: number, fallbackRequiredMemoryGb: number): string {
  const evidence = result.optimizationEvidence;
  return `Recommended memory ${candidateMemoryGb} GB; less-elastic floor with ${evidence?.memoryHeadroomPct ?? 20}% headroom ${evidence?.memoryRequiredFloorGb ?? fallbackRequiredMemoryGb} GB; pressure state ${evidence?.memoryPressureState ?? "unavailable"}; working-set follow-up ${evidence?.memoryWorkingSetValidationRequired ? "required" : "not required"}.`;
}

function iopsProjectionFits(
  result: OptimizationResult,
  entry: InstanceCatalogEntry
): boolean {
  const evidence = result.optimizationEvidence;
  if (evidence?.iopsP95 === undefined || evidence.iopsP99 === undefined) {
    return false;
  }
  const effectiveSustained = effectiveCapability(
    evidence.candidateBaselineIops ?? entry.baselineIops,
    result.currentConfig.provisionedIops
  );
  const effectiveBurst = effectiveCapability(
    evidence.candidateMaximumIops ?? entry.maxIops,
    result.currentConfig.provisionedIops
  );
  return effectiveSustained !== undefined
    && effectiveBurst !== undefined
    && evidence.iopsP95 <= effectiveSustained * VERIFIED_IO_P95_HEADROOM
    && evidence.iopsP99 <= effectiveBurst * VERIFIED_IO_P99_HEADROOM;
}

function iopsProjectionMessage(
  result: OptimizationResult,
  entry: InstanceCatalogEntry
): string {
  const evidence = result.optimizationEvidence;
  if (evidence?.iopsP95 === undefined || evidence.iopsP99 === undefined) {
    return "Physical cumulative I/O P95/P99 evidence is required; a maximum-only IOPS fallback is not permitted.";
  }
  const effectiveSustained = effectiveCapability(
    evidence.candidateBaselineIops ?? entry.baselineIops,
    result.currentConfig.provisionedIops
  );
  const effectiveBurst = effectiveCapability(
    evidence.candidateMaximumIops ?? entry.maxIops,
    result.currentConfig.provisionedIops
  );
  return `Physical IOPS P95/P99=${evidence.iopsP95}/${evidence.iopsP99}; effective sustained/burst capability=${effectiveSustained ?? "missing"}/${effectiveBurst ?? "missing"}; required limits=${effectiveSustained === undefined || effectiveBurst === undefined ? "missing" : `${effectiveSustained * VERIFIED_IO_P95_HEADROOM}/${effectiveBurst * VERIFIED_IO_P99_HEADROOM}`}.`;
}

function throughputProjectionFits(
  result: OptimizationResult,
  entry: InstanceCatalogEntry
): boolean {
  const evidence = result.optimizationEvidence;
  if (evidence?.throughputP95 === undefined || evidence.throughputP99 === undefined) {
    return false;
  }
  const effectiveSustained = effectiveCapability(
    evidence.candidateBaselineThroughputMbps ?? entry.baselineThroughputMbps,
    result.currentConfig.provisionedThroughputMbps
  );
  const effectiveBurst = effectiveCapability(
    evidence.candidateMaximumThroughputMbps ?? entry.maxThroughputMbps,
    result.currentConfig.provisionedThroughputMbps
  );
  return effectiveSustained !== undefined
    && effectiveBurst !== undefined
    && evidence.throughputP95 <= effectiveSustained * VERIFIED_IO_P95_HEADROOM
    && evidence.throughputP99 <= effectiveBurst * VERIFIED_IO_P99_HEADROOM;
}

function throughputProjectionMessage(
  result: OptimizationResult,
  entry: InstanceCatalogEntry
): string {
  const evidence = result.optimizationEvidence;
  if (evidence?.throughputP95 === undefined || evidence.throughputP99 === undefined) {
    return "Physical cumulative byte-counter P95/P99 evidence is required; a maximum-only throughput fallback is not permitted.";
  }
  const effectiveSustained = effectiveCapability(
    evidence.candidateBaselineThroughputMbps ?? entry.baselineThroughputMbps,
    result.currentConfig.provisionedThroughputMbps
  );
  const effectiveBurst = effectiveCapability(
    evidence.candidateMaximumThroughputMbps ?? entry.maxThroughputMbps,
    result.currentConfig.provisionedThroughputMbps
  );
  return `Physical throughput P95/P99=${evidence.throughputP95}/${evidence.throughputP99} MiB/s; effective sustained/burst capability=${effectiveSustained ?? "missing"}/${effectiveBurst ?? "missing"} MiB/s; required limits=${effectiveSustained === undefined || effectiveBurst === undefined ? "missing" : `${effectiveSustained * VERIFIED_IO_P95_HEADROOM}/${effectiveBurst * VERIFIED_IO_P99_HEADROOM}`} MiB/s.`;
}

function effectiveCapability(
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

function licenseModelValid(edition: SqlServerEdition, licenseModel: LicenseModel): boolean {
  if (licenseModel === "unknown") return true;
  if (licenseModel === "license-included") {
    return ["Enterprise", "Standard", "Web", "Express"].includes(edition);
  }
  if (licenseModel === "byom") {
    return ["Enterprise", "Standard", "Developer"].includes(edition);
  }
  return false;
}

function editionChangeAllowed(
  currentConfig: CurrentRdsConfig,
  recommendedConfig: CurrentRdsConfig | undefined,
  eligibility: EditionChangeEligibility | EnterpriseToStandardEvaluation | undefined
): boolean {
  if (!recommendedConfig) return true;
  const isEeToSe = currentConfig.sqlServerEdition === "Enterprise" && recommendedConfig.sqlServerEdition === "Standard";
  if (!isEeToSe) return true;
  return eligibility?.eligible === true && eligibility.blockers.length === 0;
}

function editionChangeMessage(
  currentConfig: CurrentRdsConfig,
  recommendedConfig: CurrentRdsConfig | undefined,
  eligibility: EditionChangeEligibility | EnterpriseToStandardEvaluation | undefined
): string {
  if (!recommendedConfig) return "No recommended edition change."
  const isEeToSe = currentConfig.sqlServerEdition === "Enterprise" && recommendedConfig.sqlServerEdition === "Standard";
  if (!isEeToSe) return "No Enterprise to Standard edition change requested."
  if (!eligibility) return "Enterprise to Standard requires an explicit eligibility audit before recommendation."
  if (!eligibility.eligible || eligibility.blockers.length > 0) {
    return `Enterprise to Standard blocked: ${eligibility.blockers.map((item) =>
      typeof item === "string" ? item : item.message
    ).join("; ")}`;
  }
  return "Enterprise to Standard eligibility audit passed."
}

function architectureSupported(entry: InstanceCatalogEntry | undefined): boolean {
  if (!entry) return false;
  return !entry.family.toLowerCase().endsWith("g");
}

function independentCpuOnlyCandidateFits(
  context: CostHarnessContext,
  samples: Array<{ sqlCpuPct: number; otherCpuPct: number }>
): boolean {
  const currentEntry = context.catalog.find((entry) =>
    entry.instanceClass === context.currentConfig.instanceClass
    && independentCatalogEntryOrderable(context, entry)
  );
  const target = VERIFIED_CPU_P95_TARGET_PCT;

  for (const instanceClass of context.orderedCandidateInstanceClasses ?? []) {
    const entries = context.catalog.filter((entry) =>
      entry.instanceClass === instanceClass
      && independentCatalogEntryOrderable(context, entry)
    );
    for (const entry of entries) {
      const configurations = [
        {
          visibleVcpu: entry.vcpu,
          coreCount: entry.defaultCpuCores
        },
      ...(entry.optimizeCpuConfigurations ?? [])
        .filter((configuration) => !configuration.isDefault)
        .map((configuration) => ({
          visibleVcpu: configuration.sqlServerVisibleVcpu,
          coreCount: configuration.coreCount
        }))
      ].filter((configuration) =>
        configuration.visibleVcpu > 0
        && configuration.visibleVcpu < context.currentVcpu
        && independentEditionComputeLimitAllows(
          context.currentConfig.sqlServerEdition,
          independentSqlMajorVersion(context.currentConfig.sqlServerVersion),
          configuration.visibleVcpu,
          configuration.coreCount
        )
      );

      for (const configuration of configurations) {
        const factor = currentEntry
          && currentEntry.family !== entry.family
          && currentEntry.normalizedPerCoreCapacity
          && entry.normalizedPerCoreCapacity
            ? entry.normalizedPerCoreCapacity / currentEntry.normalizedPerCoreCapacity
            : 1;
        const effective = configuration.visibleVcpu * factor;
        const sql = samples.map((sample) => context.currentVcpu * sample.sqlCpuPct / effective);
        const total = samples.map((sample) =>
          context.currentVcpu * (sample.sqlCpuPct + sample.otherCpuPct) / effective
        );
        if (
          independentPercentile(sql, 95) <= target
          && independentPercentile(sql, 99) <= VERIFIED_CPU_P99_SAFETY_LIMIT_PCT
          && independentPercentile(total, 99) <= VERIFIED_TOTAL_CPU_P99_HARD_LIMIT_PCT
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function independentCatalogEntryOrderable(
  context: CostHarnessContext,
  entry: InstanceCatalogEntry
): boolean {
  if (
    !entry.region
    || !entry.engine
    || !entry.engineVersion
    || !entry.sqlServerEdition
    || entry.orderable !== true
    || entry.sqlServerDefaultVcpuSource !== "aws-processor-features"
  ) return false;
  if (entry.region !== context.currentConfig.region) return false;
  if (entry.sqlServerEdition !== context.currentConfig.sqlServerEdition) return false;
  if (!independentSqlProductVersionMatches(
    context.currentConfig.sqlServerVersion,
    entry.engineVersion
  )) return false;
  if (context.currentConfig.multiAz === true && entry.multiAzCapable === false) {
    return false;
  }
  return true;
}

function independentRecommendedCandidateValidation(
  context: CostHarnessContext,
  recommended: CurrentRdsConfig
): { entry?: InstanceCatalogEntry; failures: string[] } {
  const classEntries = context.catalog.filter((entry) =>
    entry.instanceClass === recommended.instanceClass
  );
  if (classEntries.length === 0) {
    return { failures: [`INSTANCE_NOT_IN_CATALOG: ${recommended.instanceClass}`] };
  }

  const exactEntries = classEntries.filter((entry) =>
    Boolean(entry.region && entry.engine && entry.engineVersion && entry.sqlServerEdition)
    && entry.orderable === true
    && entry.sqlServerDefaultVcpuSource === "aws-processor-features"
  );
  if (exactEntries.length === 0) {
    return { failures: [`EXACT_ORDERABILITY_METADATA_REQUIRED: ${recommended.instanceClass}`] };
  }

  const regional = exactEntries.filter((entry) => entry.region === recommended.region);
  if (regional.length === 0) {
    return { failures: [`REGION_NOT_ORDERABLE: ${recommended.instanceClass} in ${recommended.region}`] };
  }
  const edition = regional.filter((entry) =>
    entry.sqlServerEdition === recommended.sqlServerEdition
  );
  if (edition.length === 0) {
    return { failures: [`EDITION_NOT_SUPPORTED: ${recommended.sqlServerEdition}`] };
  }
  const version = edition.filter((entry) => independentSqlProductVersionMatches(
    recommended.sqlServerVersion,
    entry.engineVersion!
  ));
  if (version.length === 0) {
    return { failures: [`SQL_VERSION_NOT_ORDERABLE: ${recommended.sqlServerVersion}`] };
  }

  const entry = version[0];
  const failures: string[] = [];
  const processorMatches = recommended.cpuConfigurationType === "optimize_cpu"
    ? (entry.optimizeCpuConfigurations ?? []).some((configuration) =>
        configuration.coreCount === recommended.cpuCoreCount
        && configuration.threadsPerCore === recommended.cpuThreadsPerCore
        && configuration.sqlServerVisibleVcpu === recommended.sqlServerVisibleVcpu
      )
    : (recommended.sqlServerVisibleVcpu === undefined || recommended.sqlServerVisibleVcpu === entry.vcpu)
      && (recommended.cpuCoreCount === undefined || recommended.cpuCoreCount === entry.defaultCpuCores)
      && (recommended.cpuThreadsPerCore === undefined || recommended.cpuThreadsPerCore === entry.defaultThreadsPerCore);
  if (!processorMatches) {
    failures.push("PROCESSOR_CONFIGURATION_NOT_ORDERABLE: recommended processor configuration does not match the exact catalog row");
  }

  const visibleVcpu = recommended.sqlServerVisibleVcpu ?? entry.vcpu;
  const coreCount = recommended.cpuCoreCount ?? entry.defaultCpuCores;
  if (!independentEditionComputeLimitAllows(
    recommended.sqlServerEdition,
    independentSqlMajorVersion(recommended.sqlServerVersion),
    visibleVcpu,
    coreCount
  )) {
    failures.push("EDITION_COMPUTE_LIMIT_EXCEEDED: recommended visible vCPU/core configuration exceeds the SQL Server edition limit");
  }
  if (recommended.multiAz === true && entry.multiAzCapable === false) {
    failures.push(`MULTI_AZ_NOT_SUPPORTED: ${recommended.instanceClass}`);
  }

  return { entry, failures };
}

function independentSqlProductVersionMatches(
  productVersion: string,
  engineVersion: string
): boolean {
  const product = independentVersionParts(productVersion);
  const engine = independentVersionParts(engineVersion);
  return product.length >= 3
    && engine.length >= product.length
    && product.every((part, index) => engine[index] === part);
}

function independentVersionParts(value: string): number[] {
  return (value.match(/\d+/g) ?? []).slice(0, 4).map(Number);
}

function independentSqlMajorVersion(value: string): number {
  return independentVersionParts(value)[0] ?? 0;
}

function independentEditionComputeLimitAllows(
  edition: CurrentRdsConfig["sqlServerEdition"],
  sqlMajorVersion: number,
  visibleVcpu: number,
  coreCount: number | undefined
): boolean {
  if (edition === "Standard") {
    return coreCount === undefined || coreCount <= (sqlMajorVersion >= 17 ? 32 : 24);
  }
  if (edition === "Web") return visibleVcpu <= 32;
  if (edition === "Express") return visibleVcpu <= 4;
  return true;
}

function independentPercentile(values: number[], percentile: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const rank = percentile / 100 * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function toHarnessFinding(finding: IndependentOracleFinding): HarnessFinding {
  return finding;
}
