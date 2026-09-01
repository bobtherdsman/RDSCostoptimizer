import type {
  CpuState,
  CurrentRdsConfig,
  DatabaseAttribution,
  EnterpriseToStandardEvaluation,
  EvidenceWindowAssessment,
  LimitingResourceAssessment,
  OptimizationBlocker,
  OptimizationDecision,
  OptimizationResult,
  WorkloadEvidence
} from "../contracts/types.js";
import type { HarnessFinding } from "../harness/index.js";

export type WorkloadReportStatus =
  | "recommended"
  | "aggressive_optimization"
  | "not_recommended";

export interface DatabaseDriverSummary {
  databaseName: string;
  drivers: string[];
  iopsP95?: number;
  throughputP95Mbps?: number;
  sizeGb?: number;
  tempdbSharePct?: number;
  notes: string[];
}

export interface WorkloadOptimizationReport {
  serverName?: string;
  status: WorkloadReportStatus;
  decision: OptimizationDecision;
  currentConfig: CurrentRdsConfig;
  recommendedConfig?: CurrentRdsConfig;
  risk: OptimizationResult["risk"];
  confidence?: OptimizationResult["confidence"];
  evidenceWindow?: EvidenceWindowAssessment;
  cpuAssessment?: CpuAssessmentSummary;
  passedChecks: string[];
  blockers: OptimizationBlocker[];
  evidence?: WorkloadEvidence;
  resultEvidence?: OptimizationResult["optimizationEvidence"];
  enterpriseToStandard?: EnterpriseToStandardEvaluation;
  limitingResources: LimitingResourceAssessment[];
  candidateEvaluations: OptimizationResult["candidateEvaluations"];
  whyOptimized: string[];
  topDatabaseDrivers: DatabaseDriverSummary[];
  advisorySignals: string[];
  actionPlan: string[];
  harnessFindings: HarnessFinding[];
  pricingDeferred: true;
  pricingNote: string;
}

export interface CpuAssessmentSummary {
  state: CpuState;
  currentVisibleVcpu: number;
  candidateVisibleVcpu?: number;
  cpuP95Pct: number;
  projectedCpuPct?: number;
  projectedSqlCpuP95Pct?: number;
  projectedSqlCpuP99Pct?: number;
  projectedTotalCpuP95Pct?: number;
  projectedTotalCpuP99Pct?: number;
  observedOtherCpuP95Pct?: number;
  observedOtherCpuP99Pct?: number;
  p95TargetPct?: number;
  p99SafetyLimitPct?: number;
  totalP99HardLimitPct?: number;
  excursionSampleCount?: number;
  excursionSamplePct?: number;
  longestExcursionStreakMinutes?: number;
  projectionConfidence?: "high" | "medium" | "low";
  projectionBasis?: string;
  candidateConfigurationType?: "default" | "optimize_cpu";
  candidateCoreCount?: number;
  candidateThreadsPerCore?: number;
  highCpuThresholdPct?: number;
  highCpuSamplePct?: number;
  longestHighCpuStreakMinutes?: number;
  sustainedPressure?: boolean;
}

export interface WorkloadReportInput {
  serverName?: string;
  result: OptimizationResult;
  harnessFindings?: HarnessFinding[];
}

export interface WorkloadServerComparison {
  serverName: string;
  status: WorkloadReportStatus;
  currentInstanceClass: string;
  optimizedInstanceClass?: string;
  currentStorageType: string;
  currentProvisionedIops?: number;
  currentProvisionedThroughputMbps?: number;
  risk: OptimizationResult["risk"];
  confidence?: OptimizationResult["confidence"];
  cpuState?: CpuState;
  whyNotOptimized: string[];
  topDatabaseDriver?: string;
}

export interface WorkloadOptimizationSummary {
  totalServers: number;
  optimizedServers: number;
  recommendedServers: number;
  aggressiveOptimizationServers: number;
  notOptimizedServers: number;
  optimized: WorkloadServerComparison[];
  notOptimized: WorkloadServerComparison[];
  allServers: WorkloadServerComparison[];
  pricingDeferred: true;
}

export function buildWorkloadOptimizationReport(input: WorkloadReportInput): WorkloadOptimizationReport {
  const blockers = [...input.result.blockers];
  const status: WorkloadReportStatus = input.result.decision === "Recommended"
    ? "recommended"
    : input.result.decision === "Aggressive Optimization"
      ? "aggressive_optimization"
      : "not_recommended";
  const topDatabaseDrivers = summarizeDatabaseDrivers(input.result.topOffendingDatabases);

  return {
    serverName: input.serverName,
    status,
    decision: input.result.decision,
    currentConfig: input.result.currentConfig,
    recommendedConfig: status === "not_recommended" ? undefined : input.result.recommendedConfig,
    risk: status === "not_recommended" ? "blocked" : input.result.risk,
    confidence: input.result.confidence,
    evidenceWindow: input.result.evidenceWindow,
    cpuAssessment: buildCpuAssessment(input.result),
    passedChecks: input.result.passedChecks,
    blockers,
    evidence: input.result.evidence,
    resultEvidence: input.result.optimizationEvidence,
    enterpriseToStandard: input.result.enterpriseToStandard,
    limitingResources: input.result.limitingResources,
    candidateEvaluations: input.result.candidateEvaluations,
    whyOptimized: status !== "not_recommended" ? whyOptimized(input.result, topDatabaseDrivers) : [],
    topDatabaseDrivers,
    advisorySignals: advisorySignals(input.result.topOffendingDatabases, input.result.currentConfig, input.result.evidence),
    actionPlan: actionPlan(
      status,
      blockers,
      topDatabaseDrivers,
      input.result.enterpriseToStandard
    ),
    harnessFindings: input.harnessFindings ?? [],
    pricingDeferred: true,
    pricingNote: "Pricing is deferred for the workload-optimization MVP; this report verifies workload fit and blockers only."
  };
}

export function buildWorkloadOptimizationSummary(reports: readonly WorkloadOptimizationReport[]): WorkloadOptimizationSummary {
  const allServers = reports.map(toServerComparison);
  const optimized = allServers.filter((server) => server.status !== "not_recommended");
  const notOptimized = allServers.filter((server) => server.status === "not_recommended");

  return {
    totalServers: allServers.length,
    optimizedServers: optimized.length,
    recommendedServers: allServers.filter((server) => server.status === "recommended").length,
    aggressiveOptimizationServers:
      allServers.filter((server) => server.status === "aggressive_optimization").length,
    notOptimizedServers: notOptimized.length,
    optimized,
    notOptimized,
    allServers,
    pricingDeferred: true
  };
}

export function toJsonReport(report: WorkloadOptimizationReport): string {
  return JSON.stringify(report, null, 2);
}

export function toJsonSummaryReport(reports: readonly WorkloadOptimizationReport[]): string {
  return JSON.stringify({ summary: buildWorkloadOptimizationSummary(reports), reports }, null, 2);
}

export function toPdfExecutiveSummary(reports: WorkloadOptimizationReport | readonly WorkloadOptimizationReport[]): Uint8Array {
  const items: readonly WorkloadOptimizationReport[] = Array.isArray(reports) ? reports : [reports];
  const lines = executiveSummaryLines(items).flatMap((line) => wrapLine(line, 95)).slice(0, 58);
  const content = [
    "BT",
    "/F1 10 Tf",
    "12 TL",
    "50 760 Td",
    ...lines.map((line, index) => `${index === 0 ? "" : "T* "}(${pdfEscape(line)}) Tj`),
    "ET"
  ].join("\n");

  return buildSimplePdf(content);
}
export function toCsvReport(reports: WorkloadOptimizationReport | readonly WorkloadOptimizationReport[]): string {
  const items: readonly WorkloadOptimizationReport[] = Array.isArray(reports) ? reports : [reports];
  const headers = [
    "summaryTotalServers",
    "summaryOptimizedServers",
    "summaryRecommendedServers",
    "summaryAggressiveOptimizationServers",
    "summaryNotOptimizedServers",
    "serverName",
    "status",
    "decision",
    "risk",
    "confidence",
    "collectionStart",
    "collectionEnd",
    "collectionDurationHours",
    "collectionDurationDays",
    "collectionClassification",
    "continuityStatus",
    "continuityIssueCount",
    "representativeness",
    "confidenceReason",
    "cpuState",
    "currentVisibleVcpu",
    "candidateVisibleVcpu",
    "cpuP95Pct",
    "projectedSqlCpuP95Pct",
    "projectedSqlCpuP99Pct",
    "projectedTotalCpuP95Pct",
    "projectedTotalCpuP99Pct",
    "observedOtherCpuP95Pct",
    "observedOtherCpuP99Pct",
    "cpuP95TargetPct",
    "cpuP99SafetyLimitPct",
    "totalCpuP99HardLimitPct",
    "cpuExcursionSampleCount",
    "cpuExcursionSamplePct",
    "cpuProjectionConfidence",
    "cpuProjectionBasis",
    "candidateCpuConfiguration",
    "cpuHighSamplePct",
    "cpuLongestHighStreakMinutes",
    "currentInstanceClass",
    "recommendedInstanceClass",
    "currentEdition",
    "recommendedEdition",
    "enterpriseToStandardStatus",
    "enterpriseToStandardEligible",
    "acceptedMigrationPath",
    "enterpriseToStandardBlockers",
    "currentStorageType",
    "allocatedStorageGb",
    "memoryRequiredFloorGb",
    "candidateMemoryGb",
    "memoryPressureState",
    "memoryCouplingVerdict",
    "readIopsP95",
    "readIopsP99",
    "writeIopsP95",
    "writeIopsP99",
    "totalIopsP95",
    "totalIopsP99",
    "candidateSustainedIops",
    "candidateMaximumIops",
    "iopsBurstEvidence",
    "readThroughputP95MibPerSec",
    "readThroughputP99MibPerSec",
    "writeThroughputP95MibPerSec",
    "writeThroughputP99MibPerSec",
    "totalThroughputP95MibPerSec",
    "totalThroughputP99MibPerSec",
    "candidateSustainedThroughputMibPerSec",
    "candidateMaximumThroughputMibPerSec",
    "throughputBurstEvidence",
    "tempdbPlacementTransition",
    "tempdbIopsP95",
    "tempdbIopsP99",
    "tempdbThroughputP95MibPerSec",
    "tempdbThroughputP99MibPerSec",
    "tempdbRepresentativeAllocatedGb",
    "tempdbPeakAllocatedGb",
    "candidateLocalStorageCapacityGb",
    "tempdbCapacityResult",
    "limitingResources",
    "candidateEvaluations",
    "topDatabaseDrivers",
    "whyOptimized",
    "whyNotOptimized",
    "blockers",
    "passedChecks",
    "failedHarnessChecks",
    "advisorySignals",
    "actionPlan",
    "pricingDeferred"
  ];

  const summary = buildWorkloadOptimizationSummary(items);
  const rows = items.map((report) => [
    summary.totalServers,
    summary.optimizedServers,
    summary.recommendedServers,
    summary.aggressiveOptimizationServers,
    summary.notOptimizedServers,
    report.serverName ?? "",
    report.status,
    report.decision,
    report.risk,
    report.confidence ?? "",
    report.evidenceWindow?.startTimestamp ?? "",
    report.evidenceWindow?.endTimestamp ?? "",
    report.evidenceWindow?.durationHours ?? "",
    report.evidenceWindow?.durationDays ?? "",
    report.evidenceWindow?.classification ?? "",
    report.evidenceWindow?.continuityStatus ?? "",
    report.evidenceWindow?.continuityIssueCount ?? "",
    report.evidenceWindow?.representativeness ?? "",
    report.evidenceWindow?.confidenceReason ?? "",
    report.cpuAssessment?.state ?? "",
    report.cpuAssessment?.currentVisibleVcpu ?? "",
    report.cpuAssessment?.candidateVisibleVcpu ?? "",
    report.cpuAssessment?.cpuP95Pct ?? "",
    report.cpuAssessment?.projectedSqlCpuP95Pct ?? "",
    report.cpuAssessment?.projectedSqlCpuP99Pct ?? "",
    report.cpuAssessment?.projectedTotalCpuP95Pct ?? "",
    report.cpuAssessment?.projectedTotalCpuP99Pct ?? "",
    report.cpuAssessment?.observedOtherCpuP95Pct ?? "",
    report.cpuAssessment?.observedOtherCpuP99Pct ?? "",
    report.cpuAssessment?.p95TargetPct ?? "",
    report.cpuAssessment?.p99SafetyLimitPct ?? "",
    report.cpuAssessment?.totalP99HardLimitPct ?? "",
    report.cpuAssessment?.excursionSampleCount ?? "",
    report.cpuAssessment?.excursionSamplePct ?? "",
    report.cpuAssessment?.projectionConfidence ?? "",
    report.cpuAssessment?.projectionBasis ?? "",
    report.cpuAssessment?.candidateConfigurationType === "optimize_cpu"
      ? `${report.cpuAssessment.candidateCoreCount}x${report.cpuAssessment.candidateThreadsPerCore}`
      : report.cpuAssessment?.candidateConfigurationType ?? "",
    report.cpuAssessment?.highCpuSamplePct ?? "",
    report.cpuAssessment?.longestHighCpuStreakMinutes ?? "",
    report.currentConfig.instanceClass,
    report.recommendedConfig?.instanceClass ?? "",
    report.currentConfig.sqlServerEdition,
    report.recommendedConfig?.sqlServerEdition ?? report.currentConfig.sqlServerEdition,
    report.enterpriseToStandard?.status ?? "not_applicable",
    report.enterpriseToStandard?.eligible ?? false,
    report.enterpriseToStandard?.acceptedMigrationPath ?? "",
    report.enterpriseToStandard?.blockers
      .map((blocker) => `${blocker.category}:${blocker.code}:${blocker.message}`)
      .join("; ") ?? "",
    report.currentConfig.storageType,
    report.currentConfig.allocatedStorageGb ?? "",
    report.resultEvidence?.memoryRequiredFloorGb ?? "",
    report.resultEvidence?.candidateMemoryGb ?? "",
    report.resultEvidence?.memoryPressureState ?? "",
    report.resultEvidence?.memoryCouplingVerdict ?? "",
    report.resultEvidence?.readIopsP95 ?? "",
    report.resultEvidence?.readIopsP99 ?? "",
    report.resultEvidence?.writeIopsP95 ?? "",
    report.resultEvidence?.writeIopsP99 ?? "",
    report.resultEvidence?.iopsP95 ?? "",
    report.resultEvidence?.iopsP99 ?? "",
    report.resultEvidence?.candidateBaselineIops ?? "",
    report.resultEvidence?.candidateMaximumIops ?? "",
    formatBurstEvidence(report.resultEvidence?.iopsBurstEvidence),
    report.resultEvidence?.readThroughputP95MibPerSec ?? "",
    report.resultEvidence?.readThroughputP99MibPerSec ?? "",
    report.resultEvidence?.writeThroughputP95MibPerSec ?? "",
    report.resultEvidence?.writeThroughputP99MibPerSec ?? "",
    report.resultEvidence?.throughputP95 ?? "",
    report.resultEvidence?.throughputP99 ?? "",
    report.resultEvidence?.candidateBaselineThroughputMbps ?? "",
    report.resultEvidence?.candidateMaximumThroughputMbps ?? "",
    formatBurstEvidence(report.resultEvidence?.throughputBurstEvidence),
    report.resultEvidence?.tempdbPlacementTransition ?? "",
    report.resultEvidence?.tempdbIopsP95 ?? "",
    report.resultEvidence?.tempdbIopsP99 ?? "",
    report.resultEvidence?.tempdbThroughputP95 ?? "",
    report.resultEvidence?.tempdbThroughputP99 ?? "",
    report.resultEvidence?.tempdbRepresentativeAllocatedGb ?? "",
    report.resultEvidence?.tempdbPeakAllocatedGb ?? "",
    report.resultEvidence?.candidateLocalStorageCapacityGb ?? "",
    report.resultEvidence?.tempdbCapacityResult ?? "",
    report.limitingResources.map(formatLimitingResource).join("; "),
    report.candidateEvaluations.map(formatCandidateEvaluation).join("; "),
    report.topDatabaseDrivers.map(formatDatabaseDriver).join("; "),
    report.whyOptimized.join("; "),
    whyNotOptimized(report).join("; "),
    report.blockers.map((blocker) => `${blocker.dimension}:${blocker.code}:${blocker.message}`).join("; "),
    report.passedChecks.join("; "),
    report.harnessFindings.filter((finding) => !finding.passed).map((finding) => `${finding.oracle}:${finding.message}`).join("; "),
    report.advisorySignals.join("; "),
    report.actionPlan.join("; "),
    String(report.pricingDeferred)
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function summarizeDatabaseDrivers(databases: DatabaseAttribution[]): DatabaseDriverSummary[] {
  return databases.map((database) => {
    const drivers: string[] = [];
    const notes: string[] = [];

    if (database.iops) drivers.push("iops");
    if (database.throughputMbps) drivers.push("throughput");
    if (database.tempdbSharePct !== undefined && database.tempdbSharePct > 0) drivers.push("tempdb");
    if (database.sizeGb !== undefined) drivers.push("size");
    if (database.advisoryCpuSharePct !== undefined) notes.push("CPU attribution is advisory.");
    if (database.advisoryMemorySharePct !== undefined) notes.push("Memory attribution is advisory.");
    if (database.tempdbSharePct !== undefined && database.tempdbSharePct >= 50) {
      notes.push("tempdb is a dominant I/O contributor for this sample set.");
    }

    return {
      databaseName: database.databaseName,
      drivers,
      iopsP95: database.iops?.p95,
      throughputP95Mbps: database.throughputMbps?.p95,
      sizeGb: database.sizeGb,
      tempdbSharePct: database.tempdbSharePct,
      notes
    };
  });
}

function whyOptimized(result: OptimizationResult, topDatabaseDrivers: DatabaseDriverSummary[]): string[] {
  const evidence = result.optimizationEvidence;
  const recommended = result.recommendedConfig;
  if (!evidence || !recommended) return [];

  const items = [
    `Decision: ${result.decision}.`,
    `Compute changes from ${result.currentConfig.instanceClass} (${evidence.currentVcpu} vCPU) to ${recommended.instanceClass} (${evidence.optimizedVcpu ?? "unknown"} vCPU).`,
    result.cpuState ? `Current CPU state is ${formatCpuState(result.cpuState)}.` : undefined,
    `Observed SQL CPU P95 is ${round(evidence.cpuP95Pct)}%; projected SQL CPU P95 is ${formatOptionalPercent(evidence.projectedSqlCpuP95Pct)} and P99 is ${formatOptionalPercent(evidence.projectedSqlCpuP99Pct)}.`,
    `Projected concurrent total CPU P99 is ${formatOptionalPercent(evidence.projectedTotalCpuP99Pct)}; observed Other CPU P95/P99 is ${formatOptionalPercent(evidence.observedOtherCpuP95Pct)}/${formatOptionalPercent(evidence.observedOtherCpuP99Pct)}.`,
    `CPU projection comparison is ${evidence.cpuProjectionConfidence ?? "unknown"} confidence (${evidence.cpuProjectionBasis ?? "unknown basis"}).`,
    `Candidate memory is ${evidence.candidateMemoryGb ?? "unknown"} GB; the reproducible less-elastic floor is ${round(evidence.memoryRequiredFloorGb ?? evidence.requiredMemoryGb)} GB including ${evidence.memoryHeadroomPct ?? 20}% headroom.`,
    `Memory pressure state is ${evidence.memoryPressureState ?? "unknown"} with ${evidence.memoryEvidenceConfidence ?? "unknown"} evidence confidence.`,
    evidence.memoryWorkingSetValidationRequired === true
      ? "The candidate reduces RAM and must pass the separate memory-to-I/O working-set validation."
      : evidence.memoryWorkingSetValidationRequired === false
        ? "The candidate preserves current memory capacity, so no RAM-reduction working-set validation is required."
        : undefined,
    evidence.memoryCouplingVerdict
      ? `Memory-to-I/O coupling verdict is ${evidence.memoryCouplingVerdict} at ${evidence.memoryCouplingConfidence ?? "unknown"} confidence; normalized Page Reads are ${evidence.normalizedPageReadsTrend ?? "unavailable"} and ReadIOPS coupling is ${evidence.readIopsPressureRelationship ?? "unavailable"} (Spearman=${evidence.readIopsSpearmanCorrelation ?? "unavailable"}, high-vs-low pressure change=${evidence.readIopsIncreasePct ?? "unavailable"}%, persistence=${evidence.readIopsPersistenceMet === undefined ? "unavailable" : evidence.readIopsPersistenceMet ? "met" : "not met"}, workload-normalized=${evidence.readIopsWorkloadNormalized === true ? "yes" : "no"}).`
      : undefined,
    evidence.bufferCacheHitRatioP05Pct !== undefined
      ? `Buffer Cache Hit Ratio P05 is ${evidence.bufferCacheHitRatioP05Pct}% and is supporting evidence only, not a hard safety threshold.`
      : undefined,
    evidence.iopsP95 !== undefined
      ? `Physical IOPS P95/P99/max is ${round(evidence.iopsP95)}/${round(evidence.iopsP99 ?? 0)}/${round(evidence.iopsMax ?? 0)} against candidate sustained/maximum capability ${evidence.candidateBaselineIops ?? "unknown"}/${evidence.candidateMaximumIops ?? "unknown"}; burst reliance is ${evidence.iopsBurstReliance ? "yes" : "no"}.`
      : `IOPS requirement is ${round(evidence.requiredIops)} and passed candidate maximum IOPS fit.`,
    evidence.readIopsP95 !== undefined
      ? `Read/write IOPS P95/P99 is ${round(evidence.readIopsP95)}/${round(evidence.readIopsP99 ?? 0)} and ${round(evidence.writeIopsP95 ?? 0)}/${round(evidence.writeIopsP99 ?? 0)}.`
      : undefined,
    evidence.iopsBurstEvidence
      ? `Observed IOPS above the sustained baseline formed ${evidence.iopsBurstEvidence.eventCount} event(s), with a longest duration of ${evidence.iopsBurstEvidence.longestEventMinutes} minutes and ${evidence.iopsBurstEvidence.eventsPer24Hours} events per 24 hours.`
      : undefined,
    evidence.throughputP95 !== undefined
      ? `Physical throughput P95/P99/max is ${round(evidence.throughputP95)}/${round(evidence.throughputP99 ?? 0)}/${round(evidence.throughputMax ?? 0)} MiB/s against candidate sustained/maximum capability ${evidence.candidateBaselineThroughputMbps ?? "unknown"}/${evidence.candidateMaximumThroughputMbps ?? "unknown"} MiB/s; burst reliance is ${evidence.throughputBurstReliance ? "yes" : "no"}.`
      : `Throughput requirement is ${round(evidence.requiredThroughputMbps)} MB/s and passed candidate maximum throughput fit.`,
    evidence.readThroughputP95MibPerSec !== undefined
      ? `Read/write throughput P95/P99 is ${round(evidence.readThroughputP95MibPerSec)}/${round(evidence.readThroughputP99MibPerSec ?? 0)} and ${round(evidence.writeThroughputP95MibPerSec ?? 0)}/${round(evidence.writeThroughputP99MibPerSec ?? 0)} MiB/s.`
      : undefined,
    evidence.throughputBurstEvidence
      ? `Observed throughput above the sustained baseline formed ${evidence.throughputBurstEvidence.eventCount} event(s), with a longest duration of ${evidence.throughputBurstEvidence.longestEventMinutes} minutes and ${evidence.throughputBurstEvidence.eventsPer24Hours} events per 24 hours.`
      : undefined,
    evidence.tempdbPlacementTransition
      ? `tempdb placement is ${evidence.currentTempdbPlacement ?? "unknown"} on the current class and ${evidence.candidateTempdbPlacement ?? "unknown"} on the candidate (${evidence.tempdbPlacementTransition}).`
      : undefined,
    evidence.candidateNormalPathIopsP95 !== undefined
      ? `Candidate-aware normal-path IOPS P95/P99 is ${round(evidence.candidateNormalPathIopsP95)}/${round(evidence.candidateNormalPathIopsP99 ?? 0)} after time-aligned tempdb remapping; current normal-path P95/P99 is ${round(evidence.currentNormalPathIopsP95 ?? 0)}/${round(evidence.currentNormalPathIopsP99 ?? 0)}.`
      : undefined,
    evidence.candidateNormalPathThroughputP95 !== undefined
      ? `Candidate-aware normal-path throughput P95/P99 is ${round(evidence.candidateNormalPathThroughputP95)}/${round(evidence.candidateNormalPathThroughputP99 ?? 0)} MiB/s; current normal-path P95/P99 is ${round(evidence.currentNormalPathThroughputP95 ?? 0)}/${round(evidence.currentNormalPathThroughputP99 ?? 0)} MiB/s.`
      : undefined,
    evidence.tempdbIopsP95 !== undefined
      ? `tempdb demand is ${round(evidence.tempdbIopsP95)}/${round(evidence.tempdbIopsP99 ?? 0)} IOPS at P95/P99 and ${round(evidence.tempdbThroughputP95 ?? 0)}/${round(evidence.tempdbThroughputP99 ?? 0)} MiB/s at P95/P99.`
      : undefined,
    evidence.tempdbCapacityResult
      ? `Candidate local tempdb capacity result is ${evidence.tempdbCapacityResult}; representative/peak allocation is ${evidence.tempdbRepresentativeAllocatedGb ?? "unavailable"}/${evidence.tempdbPeakAllocatedGb ?? "unavailable"} GB against ${evidence.candidateLocalStorageCapacityGb ?? "not applicable"} GB.`
      : undefined,
    evidence.tempdbLocalIoRiskSignal
      ? "The candidate relies on local NVMe for observed tempdb I/O. Capacity passed, while I/O intensity remains a confidence/risk signal because no authoritative class-specific performance limit is available."
      : undefined,
    result.enterpriseToStandard?.eligible
      ? `Enterprise-to-Standard eligibility passed. Standard Edition is a migration recommendation using ${formatMigrationPath(result.enterpriseToStandard.acceptedMigrationPath)}, not an in-place RDS resize.`
      : result.enterpriseToStandard?.status === "blocked"
        ? `The compute recommendation remains on Enterprise Edition. Standard Edition is blocked by ${unique(result.enterpriseToStandard.blockers.map((blocker) => blocker.category)).join(", ")} evidence.`
        : undefined,
    topDatabaseDrivers[0] ? `Top database driver is ${topDatabaseDrivers[0].databaseName}.` : undefined,
    result.limitingResources.length > 0
      ? `Resource gates: ${result.limitingResources.map(formatLimitingResource).join("; ")}.`
      : undefined,
    result.passedChecks.length > 0 ? `Passed checks: ${result.passedChecks.join(", ")}.` : undefined
  ];

  return items.filter((item): item is string => Boolean(item));
}

function advisorySignals(databases: DatabaseAttribution[], currentConfig: CurrentRdsConfig, evidence: WorkloadEvidence | undefined): string[] {
  const signals: string[] = [];
  const largestIops = maxDatabaseShare(databases, "iops");
  const largestThroughput = maxDatabaseShare(databases, "throughput");

  if (largestIops && largestIops.sharePct >= 50) {
    signals.push(`${largestIops.databaseName} drives ${round(largestIops.sharePct)}% of database-attributed IOPS; review isolate or split options.`);
  }
  if (largestThroughput && largestThroughput.sharePct >= 50) {
    signals.push(`${largestThroughput.databaseName} drives ${round(largestThroughput.sharePct)}% of database-attributed throughput; review isolate or split options.`);
  }
  if (databases.length >= 5 && !largestIops && !largestThroughput) {
    signals.push("Multiple databases are present without a single dominant I/O driver; review merge or consolidation options only after workload ownership is confirmed.");
  }
  if (databases.some((database) => (database.tempdbSharePct ?? 0) >= 50)) {
    signals.push("tempdb is a major workload driver; investigate tempdb-heavy operations before changing storage or instance class.");
  }
  if (currentConfig.regionSource === "fallback") {
    signals.push(currentConfig.regionFallbackReason ?? `Region could not be inferred; catalog validation used ${currentConfig.region}.`);
  }
  if (currentConfig.catalogMatch === false) {
    signals.push(currentConfig.catalogComparisonNote ?? `Current RDSSize ${currentConfig.instanceClass} was not found in the catalog; current-vs-optimized catalog comparison is limited.`);
  }
  if (evidence?.memory?.pressureSignals.length) {
    signals.push(`Memory pressure evidence: ${evidence.memory.pressureSignals.join(" ")}`);
  }
  if (evidence?.memory?.osAvailableMemoryPctLowTail) {
    signals.push(`OS available-memory low tail: P05=${evidence.memory.osAvailableMemoryPctLowTail.p05}%, minimum=${evidence.memory.osAvailableMemoryPctLowTail.min}%.`);
  }
  if (evidence?.memory?.requiredMemoryFloorGb !== undefined) {
    signals.push(`Less-elastic memory floor is ${evidence.memory.requiredMemoryFloorGb} GB including ${evidence.memory.headroomPct ?? 20}% headroom; committed memory was not used as a standalone RAM requirement.`);
  }
  for (const latency of evidence?.fileLatency ?? []) {
    signals.push(`${latency.databaseName}${latency.fileType ? " " + latency.fileType : ""} latency evidence: ${latency.advisory.join(" ")}`);
  }
  if ((evidence?.tempdbIoSharePct ?? 0) >= 40) {
    signals.push(`tempdb drives ${evidence?.tempdbIoSharePct}% of database-attributed I/O; review tempdb usage before storage or instance changes.`);
  }
  if (evidence?.tempdbUsage && ((evidence.tempdbUsage.internalObjectMb ?? 0) > 0 || (evidence.tempdbUsage.versionStoreMb ?? 0) > 0)) {
    signals.push(`tempdb usage evidence: internal=${evidence.tempdbUsage.internalObjectMb ?? 0}MB, versionStore=${evidence.tempdbUsage.versionStoreMb ?? 0}MB.`);
  }
  const pressureWaits = (evidence?.waitStats ?? []).filter((wait) => ["PAGEIOLATCH", "WRITELOG", "RESOURCE_SEMAPHORE"].some((prefix) => wait.waitType.startsWith(prefix)));
  if (pressureWaits.length > 0) {
    signals.push(`Wait-stat advisory: ${pressureWaits.map((wait) => `${wait.waitType}=${wait.waitTimeMs}ms`).join(", ")}.`);
  }

  return [...new Set(signals)];
}

function actionPlan(
  status: WorkloadReportStatus,
  blockers: OptimizationBlocker[],
  topDatabaseDrivers: DatabaseDriverSummary[],
  enterpriseToStandard: EnterpriseToStandardEvaluation | undefined
): string[] {
  const actions: string[] = [];

  if (status !== "not_recommended") {
    actions.push("Review the recommended target as workload-fit only; pricing is deferred.");
    actions.push("Validate the change in a maintenance window with normal RDS snapshot and rollback planning.");
    if (status === "aggressive_optimization") {
      actions.push("Treat this as an aggressive, medium-confidence option and validate memory behavior under representative load before production adoption.");
    }
  }

  for (const dimension of unique(blockers.map((blocker) => blocker.dimension))) {
    if (dimension === "memory") actions.push("Memory blocks the downsize; review PLE, SQL max memory, grants, waits, and database size before reducing vCPU/memory.");
    if (dimension === "iops") actions.push("IOPS blocks the downsize; review top database I/O, tempdb share, file latency, and choose a class with sufficient sustained and burst instance capability.");
    if (dimension === "throughput") actions.push("Throughput blocks the downsize; review reporting, backup, and large-block workload windows and choose a class with sufficient sustained and burst instance capability.");
    if (dimension === "tempdb") actions.push("tempdb local-capacity fit blocks the candidate; use a class with enough local instance storage or keep tempdb on the normal storage path.");
    if (dimension === "cpu") actions.push("CPU target does not fit the proposed candidate; keep the current/larger candidate order or collect a longer window.");
    if (dimension === "edition") actions.push("Edition constraints block the recommendation; run the edition feature eligibility check before any edition change.");
    if (dimension === "orderability") actions.push("Orderability blocks the recommendation; verify SQL version, edition, region, and instance class availability.");
  }

  if (topDatabaseDrivers.length > 0) {
    actions.push(`Review top database driver: ${topDatabaseDrivers[0].databaseName}.`);
  }
  if (enterpriseToStandard?.eligible) {
    actions.push(`Plan Enterprise-to-Standard as a separate ${formatMigrationPath(enterpriseToStandard.acceptedMigrationPath)} migration with application validation and rollback planning.`);
  } else if (enterpriseToStandard?.status === "blocked") {
    actions.push(`Keep Enterprise Edition. Standard Edition remains an optional future migration only after resolving: ${enterpriseToStandard.blockers.map((blocker) => blocker.message).join("; ")}`);
  }

  return unique(actions);
}

function maxDatabaseShare(
  databases: DatabaseAttribution[],
  metric: "iops" | "throughput"
): { databaseName: string; sharePct: number } | undefined {
  const values = databases.map((database) => ({
    databaseName: database.databaseName,
    value: metric === "iops" ? database.iopsSharePct : database.throughputSharePct
  }));
  const largest = values
    .filter((value): value is { databaseName: string; value: number } => value.value !== undefined)
    .sort((a, b) => b.value - a.value)[0];
  if (!largest || largest.value <= 0) return undefined;
  return { databaseName: largest.databaseName, sharePct: largest.value };
}

function toServerComparison(report: WorkloadOptimizationReport): WorkloadServerComparison {
  return {
    serverName: report.serverName ?? "unknown",
    status: report.status,
    currentInstanceClass: report.currentConfig.instanceClass,
    optimizedInstanceClass: report.recommendedConfig?.instanceClass,
    currentStorageType: report.currentConfig.storageType,
    currentProvisionedIops: report.currentConfig.provisionedIops,
    currentProvisionedThroughputMbps: report.currentConfig.provisionedThroughputMbps,
    risk: report.risk,
    confidence: report.confidence,
    cpuState: report.cpuAssessment?.state,
    whyNotOptimized: whyNotOptimized(report),
    topDatabaseDriver: report.topDatabaseDrivers[0]?.databaseName
  };
}

function whyNotOptimized(report: WorkloadOptimizationReport): string[] {
  if (report.status !== "not_recommended") return [];
  const reasons = report.blockers.map((blocker) => `${blocker.dimension}: ${blocker.message}`);
  const failedHarness = report.harnessFindings
    .filter((finding) => !finding.passed)
    .map((finding) => `harness ${finding.oracle}: ${finding.message}`);
  return unique([...reasons, ...failedHarness]);
}
function executiveSummaryLines(reports: readonly WorkloadOptimizationReport[]): string[] {
  const summary = buildWorkloadOptimizationSummary(reports);
  const lines = [
    "RDS SQL Server Workload Optimization Executive Summary",
    "Pricing is deferred. This summary reports workload fit, blockers, risk, and next actions only.",
    `Fleet summary: total=${summary.totalServers}, optimized=${summary.optimizedServers}, not optimized=${summary.notOptimizedServers}`,
    ""
  ];

  for (const report of reports) {
    lines.push(`Server: ${report.serverName ?? "unknown"}`);
    lines.push(`Decision: ${report.decision} | Risk: ${report.risk}`);
    if (report.cpuAssessment) {
      lines.push(`CPU state: ${formatCpuState(report.cpuAssessment.state)} | current/candidate visible vCPU=${report.cpuAssessment.currentVisibleVcpu}/${report.cpuAssessment.candidateVisibleVcpu ?? "blocked"}`);
      lines.push(`Projected SQL CPU P95/P99=${report.cpuAssessment.projectedSqlCpuP95Pct ?? "n/a"}%/${report.cpuAssessment.projectedSqlCpuP99Pct ?? "n/a"}% | total CPU P99=${report.cpuAssessment.projectedTotalCpuP99Pct ?? "n/a"}% | Other CPU P95/P99=${report.cpuAssessment.observedOtherCpuP95Pct ?? "n/a"}%/${report.cpuAssessment.observedOtherCpuP99Pct ?? "n/a"}%`);
    }
    if (report.evidenceWindow) {
      lines.push(`Evidence window: ${report.evidenceWindow.durationDays} days | ${report.evidenceWindow.classification} | continuity=${report.evidenceWindow.continuityStatus}`);
      lines.push(`Evidence confidence: ${report.evidenceWindow.confidenceReason}`);
    }
    lines.push(`Current: ${report.currentConfig.instanceClass} | storage design retained: ${report.currentConfig.storageType}`);
    lines.push(`Recommended: ${report.recommendedConfig?.instanceClass ?? "blocked"}`);
    if (report.enterpriseToStandard) {
      lines.push(`Enterprise to Standard: ${report.enterpriseToStandard.status} | migration path=${report.enterpriseToStandard.acceptedMigrationPath ?? "not accepted"}`);
    }
    if (report.limitingResources.length > 0) {
      lines.push(`Resource gates: ${report.limitingResources.map(formatLimitingResource).join("; ")}`);
    }
    if (report.topDatabaseDrivers.length > 0) {
      lines.push(`Top DB: ${formatDatabaseDriver(report.topDatabaseDrivers[0])}`);
    }
    if (report.whyOptimized.length > 0) {
      lines.push(`Why optimized: ${report.whyOptimized.join("; ")}`);
    }
    const why = whyNotOptimized(report);
    if (why.length > 0) {
      lines.push(`Why not optimized: ${why.join("; ")}`);
    }
    if (report.advisorySignals.length > 0) {
      lines.push(`Advisory: ${report.advisorySignals.join("; ")}`);
    }
    if (report.actionPlan.length > 0) {
      lines.push(`Next action: ${report.actionPlan[0]}`);
    }
    lines.push("");
  }

  return lines;
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];
  const wrapped: string[] = [];
  let remaining = line;
  while (remaining.length > width) {
    const breakAt = remaining.lastIndexOf(" ", width);
    const index = breakAt > 20 ? breakAt : width;
    wrapped.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }
  if (remaining.length > 0) wrapped.push(remaining);
  return wrapped;
}

function buildSimplePdf(pageContent: string): Uint8Array {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${byteLength(pageContent)} >>\nstream\n${pageContent}\nendstream\nendobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(byteLength(pdf));
    pdf += object;
  }
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
function formatDatabaseDriver(driver: DatabaseDriverSummary): string {
  const metrics = [
    driver.iopsP95 === undefined ? undefined : `iopsP95=${driver.iopsP95}`,
    driver.throughputP95Mbps === undefined ? undefined : `throughputP95Mbps=${driver.throughputP95Mbps}`,
    driver.sizeGb === undefined ? undefined : `sizeGb=${driver.sizeGb}`,
    driver.tempdbSharePct === undefined ? undefined : `tempdbSharePct=${driver.tempdbSharePct}`
  ].filter((value): value is string => Boolean(value));

  return `${driver.databaseName}(${driver.drivers.join("+")}${metrics.length > 0 ? ":" + metrics.join("|") : ""})`;
}

function formatBurstEvidence(
  evidence: {
    eventCount: number;
    longestEventMinutes: number;
    eventsPer24Hours: number;
    excursionSamplePct: number;
  } | undefined
): string {
  if (!evidence) return "";
  return `events=${evidence.eventCount}|longestMinutes=${evidence.longestEventMinutes}|eventsPer24Hours=${evidence.eventsPer24Hours}|samplePct=${evidence.excursionSamplePct}`;
}

function formatLimitingResource(resource: LimitingResourceAssessment): string {
  const capacity = resource.observed === undefined && resource.limit === undefined
    ? ""
    : ` observed=${resource.observed ?? "unavailable"} limit=${resource.limit ?? "unavailable"}${resource.unit ? " " + resource.unit : ""}`;
  const utilization = resource.utilizationPct === undefined
    ? ""
    : ` utilization=${resource.utilizationPct}%`;
  const database = resource.topDatabaseName
    ? ` topDB=${resource.topDatabaseName}${resource.topDatabaseMetric ? " " + resource.topDatabaseMetric : ""}${resource.topDatabaseValue === undefined ? "" : "=" + resource.topDatabaseValue}`
    : "";
  return `${resource.scope}:${resource.dimension}:${resource.status}${capacity}${utilization}${database} ${resource.reason}`.trim();
}

function formatCandidateEvaluation(
  candidate: OptimizationResult["candidateEvaluations"][number]
): string {
  const configuration = candidate.cpuConfigurationType === "optimize_cpu"
    ? `${candidate.cpuCoreCount}x${candidate.cpuThreadsPerCore}`
    : "default";
  return `${candidate.instanceClass}:${configuration}:${candidate.sqlServerVisibleVcpu}vCPU:${candidate.decision}:${candidate.selected ? "selected" : candidate.accepted ? "accepted" : "rejected"}:failed=${candidate.failedGates.join("|") || "none"}`;
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function buildCpuAssessment(result: OptimizationResult): CpuAssessmentSummary | undefined {
  const evidence = result.optimizationEvidence;
  if (!result.cpuState || !evidence) return undefined;

  return {
    state: result.cpuState,
    currentVisibleVcpu: evidence.currentVcpu,
    candidateVisibleVcpu: evidence.optimizedVcpu,
    cpuP95Pct: evidence.cpuP95Pct,
    projectedCpuPct: evidence.projectedCpuPct,
    projectedSqlCpuP95Pct: evidence.projectedSqlCpuP95Pct,
    projectedSqlCpuP99Pct: evidence.projectedSqlCpuP99Pct,
    projectedTotalCpuP95Pct: evidence.projectedTotalCpuP95Pct,
    projectedTotalCpuP99Pct: evidence.projectedTotalCpuP99Pct,
    observedOtherCpuP95Pct: evidence.observedOtherCpuP95Pct,
    observedOtherCpuP99Pct: evidence.observedOtherCpuP99Pct,
    p95TargetPct: evidence.cpuP95TargetPct,
    p99SafetyLimitPct: evidence.cpuP99SafetyLimitPct,
    totalP99HardLimitPct: evidence.totalCpuP99HardLimitPct,
    excursionSampleCount: evidence.cpuExcursionSampleCount,
    excursionSamplePct: evidence.cpuExcursionSamplePct,
    longestExcursionStreakMinutes: evidence.cpuLongestExcursionStreakSamples,
    projectionConfidence: evidence.cpuProjectionConfidence,
    projectionBasis: evidence.cpuProjectionBasis,
    candidateConfigurationType: evidence.candidateCpuConfigurationType,
    candidateCoreCount: evidence.candidateCpuCoreCount,
    candidateThreadsPerCore: evidence.candidateCpuThreadsPerCore,
    highCpuThresholdPct: evidence.cpuHighThresholdPct,
    highCpuSamplePct: evidence.cpuHighSamplePct,
    longestHighCpuStreakMinutes: evidence.cpuLongestHighStreakSamples,
    sustainedPressure: evidence.cpuSustainedPressure
  };
}

function formatCpuState(state: CpuState): string {
  return state === "under_pressure" ? "under pressure" : state;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatOptionalPercent(value: number | undefined): string {
  return value === undefined ? "unknown" : `${round(value)}%`;
}

function formatMigrationPath(value: EnterpriseToStandardEvaluation["acceptedMigrationPath"]): string {
  if (value === "native_backup_restore") return "native backup/restore";
  if (value === "aws_dms") return "AWS DMS";
  return "an approved migration path";
}
