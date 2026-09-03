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

export type AssessmentArtifactFormat = "html" | "json" | "csv" | "pdf";

export interface AssessmentArtifactSummary {
  artifactId: string;
  label: string;
  format: AssessmentArtifactFormat;
  scope: "server" | "fleet";
  includedSections: string[];
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
  supportingEvidence: string[];
  advisorySignals: string[];
  actionPlan: string[];
  harnessFindings: HarnessFinding[];
  assessmentArtifacts: AssessmentArtifactSummary[];
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
  const limitingResources = input.result.limitingResources.map(toCustomerVisibleLimitingResource);
  const supportingEvidence = advisorySignals(input.result.topOffendingDatabases, input.result.currentConfig, input.result.evidence);

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
    limitingResources,
    candidateEvaluations: input.result.candidateEvaluations,
    whyOptimized: status !== "not_recommended" ? whyOptimized({ ...input.result, limitingResources }, topDatabaseDrivers) : [],
    topDatabaseDrivers,
    supportingEvidence,
    advisorySignals: supportingEvidence,
    actionPlan: actionPlan(
      status,
      input.result.currentConfig,
      input.result.recommendedConfig,
      blockers,
      limitingResources,
      topDatabaseDrivers,
      input.result.enterpriseToStandard
    ),
    harnessFindings: input.harnessFindings ?? [],
    assessmentArtifacts: assessmentArtifacts(input.serverName, input.result, input.harnessFindings ?? [], topDatabaseDrivers),
    pricingDeferred: true,
    pricingNote: "Pricing is deferred for the workload-optimization MVP; this report verifies workload fit and evidence checks only."
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
  return buildSimplePdf(businessPdfPages(items));
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
    "supportingEvidence",
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
    report.supportingEvidence.join("; "),
    report.actionPlan.join("; "),
    String(report.pricingDeferred)
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function summarizeDatabaseDrivers(databases: DatabaseAttribution[]): DatabaseDriverSummary[] {
  return databases.filter(isCustomerVisibleDatabase).map((database) => {
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

function assessmentArtifacts(
  serverName: string | undefined,
  result: OptimizationResult,
  harnessFindings: readonly HarnessFinding[],
  topDatabaseDrivers: readonly DatabaseDriverSummary[]
): AssessmentArtifactSummary[] {
  const serverId = (serverName ?? "server").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server";
  const commonSections = [
    "current and selected configuration",
    "visible vCPU comparison",
    "evidence window and confidence",
    "all limiting resource gates",
    "candidate evaluation history",
    "passed checks and stay-as-is reasons"
  ];
  const evidenceSections = [
    result.optimizationEvidence ? "candidate evidence" : undefined,
    result.enterpriseToStandard ? "Enterprise-to-Standard assessment" : undefined,
    topDatabaseDrivers.length > 0 ? "defensible top database drivers" : undefined,
    harnessFindings.length > 0 ? "independent harness findings" : undefined
  ].filter((section): section is string => Boolean(section));

  return [
    {
      artifactId: `${serverId}-results-html`,
      label: "Assessment results page",
      format: "html",
      scope: "server",
      includedSections: [...commonSections, ...evidenceSections, "next action plan"],
      notes: ["Rendered for review immediately after upload analysis."]
    },
    {
      artifactId: `${serverId}-evidence-json`,
      label: "Structured JSON evidence package",
      format: "json",
      scope: "fleet",
      includedSections: [
        ...commonSections,
        ...evidenceSections,
        "fleet summary",
        "blockers",
        "harness findings",
        "preserved evidence references"
      ],
      notes: ["Available from the JSON export link; credentials are not included."]
    },
    {
      artifactId: `${serverId}-decision-csv`,
      label: "CSV decision matrix",
      format: "csv",
      scope: "fleet",
      includedSections: [
        "fleet counts",
        "per-server decision row",
        "CPU, memory, IOPS, throughput, tempdb, edition, orderability, and evidence fields",
        "candidate and blocker summaries",
        "database drivers",
        "harness findings"
      ],
      notes: ["Available from the CSV export link for spreadsheet review."]
    },
    {
      artifactId: `${serverId}-executive-pdf`,
      label: "PDF-style executive summary",
      format: "pdf",
      scope: "fleet",
      includedSections: ["fleet summary", "per-server outcome", "top blockers or opportunities", "non-financial workload visual", "next action"],
      notes: ["Available from the PDF export link; pricing is not included."]
    }
  ];
}

function whyOptimized(result: OptimizationResult, topDatabaseDrivers: DatabaseDriverSummary[]): string[] {
  const evidence = result.optimizationEvidence;
  const recommended = result.recommendedConfig;
  if (!evidence || !recommended) return [];

  const items = [
    `Outcome: Scaled down to ${recommended.instanceClass}.`,
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
      ? "The candidate relies on local NVMe for observed tempdb I/O. Capacity passed, while I/O intensity remains a confidence signal because no authoritative class-specific performance limit is available."
      : undefined,
    result.enterpriseToStandard?.eligible
      ? `Enterprise-to-Standard eligibility passed. Standard Edition is a migration recommendation using ${formatMigrationPath(result.enterpriseToStandard.acceptedMigrationPath)}, not an in-place RDS resize.`
      : result.enterpriseToStandard?.status === "blocked"
        ? `The compute recommendation remains on Enterprise Edition. Standard Edition is not ready because of ${unique(result.enterpriseToStandard.blockers.map((blocker) => blocker.category)).join(", ")} evidence.`
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
  const customerDatabases = databases.filter(isCustomerVisibleDatabase);
  const largestIops = maxDatabaseShare(customerDatabases, "iops");
  const largestThroughput = maxDatabaseShare(customerDatabases, "throughput");

  if (largestIops && largestIops.sharePct >= 50) {
    signals.push(`${largestIops.databaseName} drives ${round(largestIops.sharePct)}% of database-attributed IOPS; review isolate or split options.`);
  }
  if (largestThroughput && largestThroughput.sharePct >= 50) {
    signals.push(`${largestThroughput.databaseName} drives ${round(largestThroughput.sharePct)}% of database-attributed throughput; review isolate or split options.`);
  }
  if (customerDatabases.length >= 5 && !largestIops && !largestThroughput) {
    signals.push("Multiple databases are present without a single dominant I/O driver; review merge or consolidation options only after workload ownership is confirmed.");
  }
  if (customerDatabases.some((database) => (database.tempdbSharePct ?? 0) >= 50)) {
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
  signals.push(...fileLatencySignals(evidence?.fileLatency ?? []));
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
  currentConfig: CurrentRdsConfig,
  optimizedConfig: CurrentRdsConfig | undefined,
  blockers: OptimizationBlocker[],
  limitingResources: LimitingResourceAssessment[],
  topDatabaseDrivers: DatabaseDriverSummary[],
  enterpriseToStandard: EnterpriseToStandardEvaluation | undefined
): string[] {
  const actions: string[] = [];

  if (status === "not_recommended") {
    actions.push(noOptimizationRecommendation(currentConfig, blockers, limitingResources));
    actions.push(...noOptimizationFollowUps(blockers, limitingResources));
  } else {
    actions.push(optimizedNextAction(status, optimizedConfig));
    if (status === "aggressive_optimization") {
      actions.push("Treat this as an aggressive, medium-confidence option and validate memory behavior under representative load before production adoption.");
    }

    for (const dimension of unique(blockers.map((blocker) => blocker.dimension))) {
      if (dimension === "memory") actions.push("Memory does not fit the downsize yet; review PLE, SQL max memory, grants, waits, and database size before reducing vCPU/memory.");
      if (dimension === "iops") actions.push("IOPS does not fit the downsize yet; review top database I/O, tempdb share, file latency, and choose a class with sufficient sustained and burst instance capability.");
      if (dimension === "throughput") actions.push("Throughput does not fit the downsize yet; review reporting, backup, and large-block workload windows and choose a class with sufficient sustained and burst instance capability.");
      if (dimension === "tempdb") actions.push("tempdb local-capacity fit is not ready for the candidate; use a class with enough local instance storage or keep tempdb on the normal storage path.");
      if (dimension === "cpu") actions.push("CPU fit does not support the lower candidate yet; reassess only after a representative evidence window or a candidate with sufficient SQL-visible vCPU is available.");
      if (dimension === "edition") actions.push("Edition constraints must be resolved before the recommendation; run the edition feature eligibility check before any edition change.");
      if (dimension === "orderability") actions.push("Orderability evidence must be resolved before the recommendation; verify SQL version, edition, region, and instance class availability.");
    }

    if (topDatabaseDrivers.length > 0) {
      actions.push(`Review top database driver: ${topDatabaseDrivers[0].databaseName}.`);
    }
  }
  if (enterpriseToStandard?.eligible) {
    actions.push(`Plan Enterprise-to-Standard as a separate ${formatMigrationPath(enterpriseToStandard.acceptedMigrationPath)} migration with application validation and rollback planning.`);
  } else if (enterpriseToStandard?.status === "blocked") {
    actions.push(`Keep Enterprise Edition. Standard Edition remains an optional future migration only after resolving: ${enterpriseToStandard.blockers.map((blocker) => blocker.message).join("; ")}`);
  }

  return unique(actions);
}

function optimizedNextAction(status: WorkloadReportStatus, optimizedConfig: CurrentRdsConfig | undefined): string {
  const target = optimizedConfig?.instanceClass ?? "the optimized target";
  if (status === "aggressive_optimization") {
    return `Validate ${target} before any production change: confirm the workload window is representative, review the CSV/JSON evidence, and prepare a maintenance-window plan with normal RDS snapshot and rollback.`;
  }
  return `Proceed with controlled validation for ${target}: confirm the workload window is representative, review the CSV/JSON evidence, and prepare a maintenance-window plan with normal RDS snapshot and rollback.`;
}

function noOptimizationRecommendation(
  currentConfig: CurrentRdsConfig,
  blockers: readonly OptimizationBlocker[],
  limitingResources: readonly LimitingResourceAssessment[]
): string {
  const primary = primaryNoOptimizationBlocker(blockers, limitingResources);
  const observed = primary?.observed === undefined
    ? "observed demand unavailable"
    : `observed demand ${round(primary.observed)}${primary.unit ? " " + primary.unit : ""}`;
  const capacity = primary?.limit === undefined
    ? "safe capacity unavailable"
    : `safe capacity ${round(primary.limit)}${primary.unit ? " " + primary.unit : ""}`;
  return `Stay as is on ${currentConfig.instanceClass}. Primary blocker: ${primary?.label ?? "no lower candidate passed every required gate"}; ${observed}; ${capacity}.`;
}

function primaryNoOptimizationBlocker(
  blockers: readonly OptimizationBlocker[],
  limitingResources: readonly LimitingResourceAssessment[]
): { label: string; observed?: number; limit?: number; unit?: string } | undefined {
  const blockingResource = limitingResources.find((resource) => resource.status === "blocking");
  if (blockingResource) {
    return {
      label: resourceReasonLabel(blockingResource),
      observed: blockingResource.observed,
      limit: blockingResource.limit,
      unit: blockingResource.unit
    };
  }
  const blocker = blockers[0];
  return blocker ? { label: blockerReasonLabel(blocker) } : undefined;
}

function blockerReasonLabel(blocker: OptimizationBlocker): string {
  if (isEvidenceWindowIssue(blocker.code, blocker.message)) return "insufficient evidence window";
  if (blocker.dimension === "cpu") return "CPU fit failure";
  if (blocker.dimension === "memory") return "memory fit or pressure failure";
  if (blocker.dimension === "iops") return "IOPS fit failure";
  if (blocker.dimension === "throughput") return "throughput fit failure";
  if (blocker.dimension === "tempdb") return "tempdb capacity or placement failure";
  if (blocker.dimension === "edition") return "SQL Server edition constraint";
  return "orderability or current-configuration issue";
}

function resourceReasonLabel(resource: LimitingResourceAssessment): string {
  if (isEvidenceWindowIssue(resource.dimension, resource.reason)) return "insufficient evidence window";
  if (resource.dimension === "cpu") return "CPU fit failure";
  if (resource.dimension === "memory") return "memory fit or pressure failure";
  if (resource.dimension === "iops") return "IOPS fit failure";
  if (resource.dimension === "throughput") return "throughput fit failure";
  if (resource.dimension === "tempdb") return "tempdb capacity or placement failure";
  if (resource.dimension === "edition") return "SQL Server edition constraint";
  if (resource.dimension === "evidence") return "missing or insufficient evidence";
  return "orderability or current-configuration issue";
}

function resourceSignalLabel(resource: LimitingResourceAssessment): string {
  if (resource.status === "blocking") return resourceReasonLabel(resource);
  if (resource.dimension === "cpu") return "CPU gate passed";
  if (resource.dimension === "memory") return "memory gate passed";
  if (resource.dimension === "iops") return "IOPS gate passed";
  if (resource.dimension === "throughput") return "throughput gate passed";
  if (resource.dimension === "tempdb") return "tempdb gate passed";
  if (resource.dimension === "edition") return "edition gate passed";
  if (resource.dimension === "evidence") return "evidence gate passed";
  return "orderability gate passed";
}

function resourceGate(report: WorkloadOptimizationReport, dimension: LimitingResourceAssessment["dimension"]): LimitingResourceAssessment | undefined {
  return report.limitingResources.find((resource) => resource.dimension === dimension);
}

function noOptimizationFollowUps(
  blockers: readonly OptimizationBlocker[],
  limitingResources: readonly LimitingResourceAssessment[]
): string[] {
  const dimensions = unique([
    ...blockers.map((blocker) => blocker.dimension),
    ...limitingResources.filter((resource) => resource.status === "blocking").map((resource) => resource.dimension)
  ]);
  const actions: string[] = [];

  if (blockers.some((blocker) => isEvidenceWindowIssue(blocker.code, blocker.message))
    || limitingResources.some((resource) => resource.status === "blocking" && isEvidenceWindowIssue(resource.dimension, resource.reason))) {
    actions.push("Before reassessment, collect a longer representative workload window and confirm it includes normal peak business periods.");
  }
  if (dimensions.includes("cpu")) actions.push("CPU fit blocks optimization; reassess only with a candidate whose SQL-visible vCPU passes projected SQL CPU P95, SQL CPU P99, and concurrent total CPU P99 gates.");
  if (dimensions.includes("memory")) actions.push("Memory blocks optimization; keep the current memory footprint until pressure, working-set, and memory-to-I/O evidence support a lower-memory candidate.");
  if (dimensions.includes("iops")) actions.push("IOPS blocks optimization; use a candidate with sufficient sustained and burst instance IOPS capability for the observed physical I/O demand.");
  if (dimensions.includes("throughput")) actions.push("Throughput blocks optimization; use a candidate with sufficient sustained and burst throughput capability for the observed workload windows.");
  if (dimensions.includes("tempdb")) actions.push("tempdb blocks optimization; choose a class with enough local instance storage or keep tempdb on the normal storage path.");
  if (dimensions.includes("edition")) actions.push("Edition constraints block optimization; complete the Enterprise-to-Standard eligibility checks before considering an edition migration.");
  if (dimensions.includes("orderability")) actions.push("Orderability or configuration blocks optimization; provide the endpoint, Region, current RDSSize, SQL Server edition/version, and a currently orderable class before reassessment.");

  return actions;
}

function isEvidenceWindowIssue(code: string, message: string): boolean {
  const text = `${code} ${message}`.toLowerCase();
  return text.includes("evidence window")
    || text.includes("collection window")
    || text.includes("collected hour")
    || text.includes("collected hours")
    || text.includes("collection duration")
    || text.includes("window too short");
}

function formatSentenceList(values: readonly string[]): string {
  if (values.length === 0) return "no lower candidate proving every required workload gate";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
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

function isCustomerVisibleDatabase(database: DatabaseAttribution): boolean {
  return isCustomerVisibleDatabaseName(database.databaseName);
}

function isCustomerVisibleDatabaseName(databaseName: string): boolean {
  return databaseName.trim().toLowerCase() !== "rdsadmin";
}

function fileLatencySignals(latencies: readonly WorkloadEvidence["fileLatency"][number][]): string[] {
  const customerLatencies = latencies.filter((latency) => isCustomerVisibleDatabaseName(latency.databaseName));
  const tempdbLatencies = customerLatencies.filter((latency) => isTempdbDatabaseName(latency.databaseName));
  const signals = groupedFileLatencySignals(customerLatencies.filter((latency) => !isTempdbDatabaseName(latency.databaseName)));

  if (tempdbLatencies.length > 0) {
    const fileTypes = unique(tempdbLatencies.map((latency) => latency.fileType).filter((value): value is string => Boolean(value)));
    const metrics = latencyMetricSummary(tempdbLatencies);
    const advisory = unique(tempdbLatencies.flatMap((latency) => latency.advisory)).join(" ");
    signals.push([
      `tempdb latency evidence summarized from ${tempdbLatencies.length} row(s)`,
      fileTypes.length > 0 ? `file types: ${fileTypes.join(", ")}` : undefined,
      metrics || undefined,
      advisory || undefined
    ].filter((value): value is string => Boolean(value)).join("; ") + ".");
  }

  return signals;
}

function groupedFileLatencySignals(latencies: readonly WorkloadEvidence["fileLatency"][number][]): string[] {
  const groups = new Map<string, WorkloadEvidence["fileLatency"]>();
  for (const latency of latencies) {
    const key = `${latency.databaseName}\u0000${latency.fileType ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), latency]);
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const metrics = latencyMetricSummary(group);
    const advisory = unique(group.flatMap((latency) => latency.advisory)).join(" ");
    return [
      `${first.databaseName}${first.fileType ? " " + first.fileType : ""} latency evidence`,
      metrics || undefined,
      advisory || undefined
    ].filter((value): value is string => Boolean(value)).join(": ");
  });
}

function latencyMetricSummary(latencies: readonly WorkloadEvidence["fileLatency"][number][]): string {
  const maxRead = maxOptional(latencies.map((latency) => latency.readLatencyMs));
  const maxWrite = maxOptional(latencies.map((latency) => latency.writeLatencyMs));
  const maxTotal = maxOptional(latencies.map((latency) => latency.totalLatencyMs));
  return [
    maxRead === undefined ? undefined : `max read ${maxRead} ms`,
    maxWrite === undefined ? undefined : `max write ${maxWrite} ms`,
    maxTotal === undefined ? undefined : `max total ${maxTotal} ms`
  ].filter((value): value is string => Boolean(value)).join(", ");
}

function maxOptional(values: readonly (number | undefined)[]): number | undefined {
  const numeric = values.filter((value): value is number => value !== undefined);
  return numeric.length === 0 ? undefined : Math.max(...numeric);
}

function isTempdbDatabaseName(databaseName: string): boolean {
  return databaseName.trim().toLowerCase() === "tempdb";
}

function toCustomerVisibleLimitingResource(resource: LimitingResourceAssessment): LimitingResourceAssessment {
  if (!resource.topDatabaseName || isCustomerVisibleDatabaseName(resource.topDatabaseName)) {
    return resource;
  }
  return {
    ...resource,
    topDatabaseName: undefined,
    topDatabaseMetric: undefined,
    topDatabaseValue: undefined
  };
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
    whyNotOptimized: whyNotOptimized(report).slice(0, 10),
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

function customerFacingOutcome(report: WorkloadOptimizationReport): string {
  return report.status === "not_recommended"
    ? `Stay as is on ${report.currentConfig.instanceClass}`
    : `Scaled down to ${report.recommendedConfig?.instanceClass ?? "the optimized instance"}`;
}

function businessPdfPages(reports: readonly WorkloadOptimizationReport[]): string[] {
  const summary = buildWorkloadOptimizationSummary(reports);
  const pages = [overviewPdfPage(reports, summary)];
  for (const report of reports.slice(0, 12)) {
    pages.push(serverPdfPage(report));
  }
  return pages;
}

function overviewPdfPage(reports: readonly WorkloadOptimizationReport[], summary: WorkloadOptimizationSummary): string {
  const commands: string[] = [
    ...pageChrome("RDS SQL Server Workload Optimization", "Business PDF"),
    pdfText("Executive Decision Summary", 44, 724, 22, "F2", INK),
    pdfText("Pricing is not included. This PDF makes no financial amount, cost chart, or dollar claim.", 44, 700, 9, "F1", MUTED),
    ...kpiTile(44, 626, "Total servers", String(summary.totalServers), "Collector packages analyzed"),
    ...kpiTile(180, 626, "Scaled down", String(summary.optimizedServers), "Workloads with a lower target"),
    ...kpiTile(316, 626, "Validation required", String(summary.aggressiveOptimizationServers), "Hard gates fit with caution"),
    ...kpiTile(452, 626, "As is", String(summary.notOptimizedServers), "Current instance retained"),
    pdfText("Outcome mix chart", 44, 580, 13, "F2", INK),
    ...stackedOutcomeBar(44, 554, 500, 18, summary),
    ...legendItem(44, 524, "Scaled down", ACCENT),
    ...legendItem(160, 524, "Validation required", WARN),
    ...legendItem(316, 524, "As is", DANGER),
    pdfText("Business interpretation", 44, 490, 13, "F2", INK),
    ...wrappedPdfText(
      `The assessment compares the current RDS SQL Server class with orderable lower compute targets. A workload is shown as scaled down only when CPU, memory, IOPS, throughput, tempdb, edition, orderability, evidence quality, and independent harness checks support the result.`,
      44,
      468,
      94,
      10,
      "F1",
      INK
    ),
    pdfText("Fleet decision table", 44, 408, 13, "F2", INK),
    ...fleetTable(reports.slice(0, 8), 44, 380),
    reports.length > 8
      ? pdfText(`${reports.length - 8} additional server(s) are included in the JSON and CSV technical exports.`, 44, 104, 9, "F1", MUTED)
      : "",
    pdfText("Non-financial workload visual. Financial impact requires approved pricing inputs.", 44, 76, 9, "F1", MUTED),
    pdfText("1", 548, 28, 9, "F1", MUTED)
  ];
  return commands.filter(Boolean).join("\n");
}

function businessResourceSummary(report: WorkloadOptimizationReport): string {
  const blockers = report.limitingResources.filter((resource) => resource.status === "blocking");
  const source = blockers.length > 0 ? blockers : report.limitingResources;
  return source.slice(0, 3).map((resource) => {
    const observed = resource.observed === undefined ? "observed n/a" : `observed ${round(resource.observed)}${resource.unit ? " " + resource.unit : ""}`;
    const limit = resource.limit === undefined ? "safe capacity n/a" : `safe capacity ${round(resource.limit)}${resource.unit ? " " + resource.unit : ""}`;
    return `${resourceSignalLabel(resource)} (${observed}; ${limit})`;
  }).join("; ");
}

function serverPdfPage(report: WorkloadOptimizationReport): string {
  const selected = report.recommendedConfig ?? report.currentConfig;
  const evidence = report.resultEvidence;
  const cpuGate = resourceGate(report, "cpu");
  const iopsGate = resourceGate(report, "iops");
  const throughputGate = resourceGate(report, "throughput");
  const currentVcpu = report.cpuAssessment?.currentVisibleVcpu ?? evidence?.currentVcpu;
  const targetVcpu = report.recommendedConfig
    ? report.cpuAssessment?.candidateVisibleVcpu ?? evidence?.optimizedVcpu
    : currentVcpu;
  const memoryFloorGb = evidence?.memoryRequiredFloorGb ?? evidence?.requiredMemoryGb;
  const memoryTargetGb = evidence?.candidateMemoryGb;
  const memoryShape = memoryTargetGb === undefined
    ? metricBar("Memory required floor", memoryFloorGb, 316, 558, 220, "GB", "Required")
    : comparisonBar("Memory floor vs target", memoryFloorGb, memoryTargetGb, 316, 558, 220, "GB", "Required", "Target");
  const projectedSqlCpuP95Pct = report.cpuAssessment?.projectedSqlCpuP95Pct ?? evidence?.projectedSqlCpuP95Pct ?? cpuGate?.observed;
  const projectedSqlCpuP99Pct = report.cpuAssessment?.projectedSqlCpuP99Pct ?? evidence?.projectedSqlCpuP99Pct;
  const cpuP95LimitPct = report.cpuAssessment?.p95TargetPct ?? evidence?.cpuP95TargetPct ?? cpuGate?.limit ?? 70;
  const cpuP99LimitPct = report.cpuAssessment?.p99SafetyLimitPct ?? evidence?.cpuP99SafetyLimitPct ?? 90;
  const iopsObserved = evidence?.iopsP95 ?? evidence?.requiredIops ?? iopsGate?.observed ?? evidence?.currentNormalPathIopsP95;
  const iopsLimit = evidence?.candidateBaselineIops ?? iopsGate?.limit;
  const throughputObserved = evidence?.throughputP95 ?? evidence?.requiredThroughputMbps ?? throughputGate?.observed ?? evidence?.currentNormalPathThroughputP95;
  const throughputLimit = evidence?.candidateBaselineThroughputMbps ?? throughputGate?.limit;
  const topDriver = report.topDatabaseDrivers[0]?.databaseName ?? "No defensible database driver";
  const nextAction = report.actionPlan[0] ?? "Review technical evidence before action.";
  const title = report.serverName ?? "unknown";
  const commands: string[] = [
    ...pageChrome(title, customerFacingOutcome(report)),
    pdfText("Business Decision", 44, 724, 18, "F2", INK),
    pdfText(customerFacingOutcome(report), 44, 700, 13, "F2", statusColor(report.status)),
    pdfText(`Confidence: ${report.confidence ?? "n/a"} | Evidence window: ${formatEvidenceWindow(report)}`, 44, 680, 9, "F1", MUTED),
    ...beforeAfterPanel(report, 44, 626),
    pdfText("Optimization shape", 316, 638, 13, "F2", INK),
    ...comparisonBar("Visible vCPU", currentVcpu, targetVcpu, 316, 610, 220, "vCPU"),
    ...memoryShape,
    pdfText("Workload gate snapshot", 44, 508, 13, "F2", INK),
    ...gateBar("Projected SQL CPU P95", projectedSqlCpuP95Pct, cpuP95LimitPct, 44, 478, "%"),
    ...gateBar("Projected SQL CPU P99", projectedSqlCpuP99Pct, cpuP99LimitPct, 44, 432, "%"),
    ...gateBar("IOPS P95", iopsObserved, iopsLimit, 316, 478, "IOPS"),
    ...gateBar("Throughput P95", throughputObserved, throughputLimit, 316, 432, "MiB/s"),
    pdfText("Meaningful business signals", 44, 360, 13, "F2", INK),
    ...signalList([
      `Key workload signals: ${businessResourceSummary(report) || "No blocking resource gate."}`,
      `Top database driver: ${topDriver}.`,
      `Technical audit trail: candidate history, blockers, resource gates, and harness findings are preserved in CSV/JSON.`,
      report.enterpriseToStandard?.status === "blocked"
        ? "Edition opportunity: Standard Edition is blocked and should stay separate from compute scaling."
        : report.enterpriseToStandard?.eligible
          ? "Edition opportunity: Standard Edition requires a separate migration plan."
          : "Edition opportunity: no separate edition migration is included in this PDF."
    ], 44, 336),
    pdfText("Next Action", 44, 178, 13, "F2", INK),
    ...wrappedPdfText(nextAction, 44, 156, 92, 10, "F1", INK),
    pdfText("Pricing is not included. No dollar amount or cost chart is shown.", 44, 76, 9, "F1", MUTED)
  ];
  return commands.join("\n");
}

function pageChrome(title: string, subtitle: string): string[] {
  return [
    rect(0, 760, 612, 32, NAVY),
    pdfText(title, 44, 772, 11, "F2", WHITE),
    pdfText(subtitle, 420, 772, 9, "F1", WHITE),
    line(44, 62, 568, 62, LINE),
    pdfText("Standalone RDS SQL Server workload optimization. Storage redesign, automated RDS changes, and pricing are outside this phase.", 44, 44, 8, "F1", MUTED)
  ];
}

function kpiTile(x: number, y: number, label: string, value: string, note: string): string[] {
  return [
    rect(x, y, 120, 62, PANEL),
    strokeRect(x, y, 120, 62, LINE),
    pdfText(label, x + 10, y + 42, 8, "F1", MUTED),
    pdfText(value, x + 10, y + 19, 22, "F2", INK),
    pdfText(note, x + 10, y + 8, 7, "F1", MUTED)
  ];
}

function stackedOutcomeBar(x: number, y: number, width: number, height: number, summary: WorkloadOptimizationSummary): string[] {
  const total = Math.max(summary.totalServers, 1);
  const scaled = width * summary.optimizedServers / total;
  const validation = width * summary.aggressiveOptimizationServers / total;
  const asIs = Math.max(0, width - scaled - validation);
  return [
    rect(x, y, scaled, height, ACCENT),
    rect(x + scaled, y, validation, height, WARN),
    rect(x + scaled + validation, y, asIs, height, DANGER),
    strokeRect(x, y, width, height, LINE)
  ];
}

function legendItem(x: number, y: number, label: string, color: PdfColor): string[] {
  return [
    rect(x, y - 8, 10, 10, color),
    pdfText(label, x + 16, y - 7, 9, "F1", INK)
  ];
}

function fleetTable(reports: readonly WorkloadOptimizationReport[], x: number, y: number): string[] {
  const commands = [
    rect(x, y, 520, 24, NAVY),
    pdfText("Server", x + 8, y + 9, 8, "F2", WHITE),
    pdfText("Outcome", x + 190, y + 9, 8, "F2", WHITE),
    pdfText("Current", x + 318, y + 9, 8, "F2", WHITE),
    pdfText("Target", x + 420, y + 9, 8, "F2", WHITE)
  ];
  reports.forEach((report, index) => {
    const rowY = y - 26 - index * 30;
    commands.push(rect(x, rowY, 520, 28, index % 2 === 0 ? WHITE : PANEL));
    commands.push(strokeRect(x, rowY, 520, 28, LINE));
    commands.push(pdfText(trimPdfText(report.serverName ?? "unknown", 28), x + 8, rowY + 10, 8, "F1", INK));
    commands.push(pdfText(statusLabel(report.status), x + 190, rowY + 10, 8, "F2", statusColor(report.status)));
    commands.push(pdfText(report.currentConfig.instanceClass, x + 318, rowY + 10, 8, "F1", INK));
    commands.push(pdfText((report.recommendedConfig ?? report.currentConfig).instanceClass, x + 420, rowY + 10, 8, "F1", INK));
  });
  return commands;
}

function beforeAfterPanel(report: WorkloadOptimizationReport, x: number, y: number): string[] {
  const selected = report.recommendedConfig ?? report.currentConfig;
  return [
    rect(x, y - 22, 236, 70, PANEL),
    strokeRect(x, y - 22, 236, 70, LINE),
    pdfText("Current", x + 12, y + 26, 8, "F1", MUTED),
    pdfText(report.currentConfig.instanceClass, x + 12, y + 8, 13, "F2", INK),
    pdfText("Target", x + 136, y + 26, 8, "F1", MUTED),
    pdfText(selected.instanceClass, x + 136, y + 8, 13, "F2", report.recommendedConfig ? ACCENT : DANGER),
    pdfText(report.recommendedConfig ? "Lower compute target passed workload gates." : "Current instance retained by workload gates.", x + 12, y - 10, 8, "F1", MUTED)
  ];
}

function comparisonBar(label: string, current: number | undefined, target: number | undefined, x: number, y: number, width: number, unit: string, currentLabel = "Current", targetLabel = "Target"): string[] {
  const max = Math.max(current ?? 0, target ?? 0, 1);
  const currentWidth = width * ((current ?? 0) / max);
  const targetWidth = width * ((target ?? 0) / max);
  return [
    pdfText(label, x, y + 20, 8, "F2", INK),
    rect(x, y + 5, currentWidth, 8, MUTED_BAR),
    rect(x, y - 10, targetWidth, 8, ACCENT),
    pdfText(`${currentLabel} ${formatPdfNumber(current)} ${unit}`, x + width + 8, y + 2, 7, "F1", MUTED),
    pdfText(`${targetLabel} ${formatPdfNumber(target)} ${unit}`, x + width + 8, y - 13, 7, "F1", MUTED)
  ];
}

function metricBar(label: string, value: number | undefined, x: number, y: number, width: number, unit: string, valueLabel: string): string[] {
  const barWidth = value === undefined ? 0 : width;
  return [
    pdfText(label, x, y + 20, 8, "F2", INK),
    rect(x, y + 2, width, 8, PANEL),
    rect(x, y + 2, barWidth, 8, ACCENT),
    pdfText(`${valueLabel} ${formatPdfNumber(value)} ${unit}`, x + width + 8, y - 1, 7, "F1", MUTED)
  ];
}

function gateBar(label: string, observed: number | undefined, limit: number | undefined, x: number, y: number, unit: string): string[] {
  if (limit === undefined) {
    return [
      pdfText(label, x, y + 18, 8, "F2", INK),
      rect(x, y, 190, 9, PANEL),
      rect(x, y, observed === undefined ? 0 : 190, 9, observed === undefined ? MUTED_BAR : ACCENT),
      pdfText(observed === undefined ? `Observed n/a ${unit}` : `Observed ${formatPdfNumber(observed)} ${unit}`, x, y - 13, 7, "F1", MUTED)
    ];
  }
  const max = Math.max(observed ?? 0, limit ?? 0, 1);
  const observedWidth = 190 * ((observed ?? 0) / max);
  const limitX = x + 190 * ((limit ?? 0) / max);
  const passed = observed !== undefined && limit !== undefined ? observed <= limit : undefined;
  return [
    pdfText(label, x, y + 18, 8, "F2", INK),
    rect(x, y, 190, 9, PANEL),
    rect(x, y, Math.min(observedWidth, 190), 9, passed === false ? DANGER : ACCENT),
    line(limitX, y - 2, limitX, y + 13, NAVY),
    pdfText(`${formatPdfNumber(observed)} / ${formatPdfNumber(limit)} ${unit}`, x, y - 13, 7, "F1", MUTED)
  ];
}

function signalList(items: readonly string[], x: number, y: number): string[] {
  const commands: string[] = [];
  let cursorY = y;
  for (const item of items) {
    commands.push(rect(x, cursorY - 4, 5, 5, ACCENT));
    commands.push(...wrappedPdfText(item, x + 14, cursorY, 86, 9, "F1", INK, 2));
    cursorY -= 34;
  }
  return commands;
}

function wrappedPdfText(
  value: string,
  x: number,
  y: number,
  widthChars: number,
  size: number,
  font: "F1" | "F2",
  color: PdfColor,
  maxLines = 4
): string[] {
  return wrapPdfText(value, widthChars).slice(0, maxLines).map((lineText, index) =>
    pdfText(lineText, x, y - index * (size + 3), size, font, color)
  );
}

function wrapPdfText(value: string, widthChars: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let lineText = "";
  for (const word of words) {
    const candidate = lineText ? `${lineText} ${word}` : word;
    if (candidate.length > widthChars && lineText) {
      lines.push(lineText);
      lineText = word;
    } else {
      lineText = candidate;
    }
  }
  if (lineText) lines.push(lineText);
  return lines;
}

function formatEvidenceWindow(report: WorkloadOptimizationReport): string {
  if (!report.evidenceWindow) return "n/a";
  return `${round(report.evidenceWindow.durationDays)} days, ${report.evidenceWindow.classification}`;
}

function statusLabel(status: WorkloadReportStatus): string {
  if (status === "not_recommended") return "As is";
  if (status === "aggressive_optimization") return "Validation required";
  return "Scaled down";
}

function statusColor(status: WorkloadReportStatus): PdfColor {
  if (status === "not_recommended") return DANGER;
  if (status === "aggressive_optimization") return WARN;
  return ACCENT;
}

function formatPdfNumber(value: number | undefined): string {
  return value === undefined ? "n/a" : String(round(value));
}

function trimPdfText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`;
}

function pdfText(value: string, x: number, y: number, size: number, font: "F1" | "F2", color: PdfColor): string {
  return `${colorCommand(color, "fill")}\nBT /${font} ${size} Tf 1 0 0 1 ${roundPdf(x)} ${roundPdf(y)} Tm (${pdfEscape(value)}) Tj ET`;
}

function rect(x: number, y: number, width: number, height: number, color: PdfColor): string {
  return `q ${colorCommand(color, "fill")} ${roundPdf(x)} ${roundPdf(y)} ${roundPdf(width)} ${roundPdf(height)} re f Q`;
}

function strokeRect(x: number, y: number, width: number, height: number, color: PdfColor): string {
  return `q ${colorCommand(color, "stroke")} 0.6 w ${roundPdf(x)} ${roundPdf(y)} ${roundPdf(width)} ${roundPdf(height)} re S Q`;
}

function line(x1: number, y1: number, x2: number, y2: number, color: PdfColor): string {
  return `q ${colorCommand(color, "stroke")} 0.8 w ${roundPdf(x1)} ${roundPdf(y1)} m ${roundPdf(x2)} ${roundPdf(y2)} l S Q`;
}

function colorCommand(color: PdfColor, mode: "fill" | "stroke"): string {
  const suffix = mode === "fill" ? "rg" : "RG";
  return `${color.map((value) => roundPdf(value / 255)).join(" ")} ${suffix}`;
}

function roundPdf(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildSimplePdf(pageContents: readonly string[]): Uint8Array {
  const pageCount = pageContents.length;
  const pagesObjectNumber = 2;
  const fontNormalObjectNumber = 3 + pageCount * 2;
  const fontBoldObjectNumber = fontNormalObjectNumber + 1;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
  ];
  const kids: string[] = [];
  pageContents.forEach((pageContent, index) => {
    const pageObjectNumber = 3 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    kids.push(`${pageObjectNumber} 0 R`);
    objects.push(`${pageObjectNumber} 0 obj\n<< /Type /Page /Parent ${pagesObjectNumber} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontNormalObjectNumber} 0 R /F2 ${fontBoldObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>\nendobj\n`);
    objects.push(`${contentObjectNumber} 0 obj\n<< /Length ${byteLength(pageContent)} >>\nstream\n${pageContent}\nendstream\nendobj\n`);
  });
  objects.splice(1, 0, `2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>\nendobj\n`);
  objects.push(`${fontNormalObjectNumber} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  objects.push(`${fontBoldObjectNumber} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`);
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

type PdfColor = readonly [number, number, number];

const INK: PdfColor = [30, 41, 59];
const MUTED: PdfColor = [100, 116, 139];
const LINE: PdfColor = [203, 213, 225];
const PANEL: PdfColor = [248, 250, 252];
const WHITE: PdfColor = [255, 255, 255];
const NAVY: PdfColor = [15, 23, 42];
const ACCENT: PdfColor = [15, 118, 110];
const WARN: PdfColor = [180, 83, 9];
const DANGER: PdfColor = [180, 35, 24];
const MUTED_BAR: PdfColor = [148, 163, 184];

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
