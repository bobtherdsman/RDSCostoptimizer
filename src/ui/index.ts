import type { ManualUploadSuccessResponse } from "../upload/index.js";
import type { DatabaseDriverSummary, WorkloadOptimizationReport } from "../reports/index.js";

const MAX_CANDIDATE_DISPLAY_ROWS = 24;
const MAX_REASON_DISPLAY_ROWS = 10;
const MAX_RESOURCE_DISPLAY_ROWS = 16;
const MAX_REASON_CHARS = 220;

export interface ManualUploadResultsViewModel {
  title: string;
  pricingNotice: string;
  fleet: FleetResultsSummary;
  servers: ServerResultsCard[];
  exportActions: ExportAction[];
  artifactBundle: ArtifactBundleItem[];
}

export interface FleetResultsSummary {
  totalServers: number;
  optimizedServers: number;
  recommendedServers: number;
  aggressiveOptimizationServers: number;
  notOptimizedServers: number;
  outcomeGroups: FleetOutcomeGroup[];
  optimizedServerNames: string[];
  notOptimizedServerNames: string[];
}

export interface FleetOutcomeGroup {
  status: "recommended" | "aggressive_optimization" | "not_recommended";
  label: string;
  count: number;
  serverNames: string[];
  summary: string;
}

export interface ServerResultsCard {
  serverName: string;
  outcome: "recommended" | "aggressive_optimization" | "not_recommended";
  statusLabel: string;
  riskLabel: string;
  assessmentDetail: string;
  decisionSummary: string;
  assessmentNotes: string[];
  cpuStateLabel: string;
  visualMetrics: AssessmentMetricDisplay[];
  currentVisibleVcpu: string;
  candidateVisibleVcpu: string;
  cpuP95Pct: string;
  projectedSqlCpuP95Pct: string;
  projectedSqlCpuP99Pct: string;
  projectedTotalCpuP99Pct: string;
  observedOtherCpuP95Pct: string;
  observedOtherCpuP99Pct: string;
  cpuProjectionConfidence: string;
  cpuProjectionBasis: string;
  cpuExcursions: string;
  candidateCpuConfiguration: string;
  highCpuThresholdPct: string;
  highCpuSamplePct: string;
  longestHighCpuStreakMinutes: string;
  evidenceWindow: EvidenceWindowDisplay;
  current: ConfigurationDisplay;
  optimizedTitle: string;
  optimized: ConfigurationDisplay;
  editionAssessment: EditionAssessmentDisplay;
  memoryAssessment: string[];
  ioAssessment: string[];
  tempdbAssessment: string[];
  resourceGates: ResourceGateDisplay[];
  limitingResources: string[];
  candidateSummary: CandidateSummaryDisplay[];
  candidateEvaluations: string[];
  whyOptimized: string[];
  whyNotOptimized: string[];
  blockers: string[];
  topDatabaseDrivers: DatabaseDriverDisplay[];
  supportingEvidence: string[];
  advisorySignals: string[];
  passedChecks: string[];
  failedChecks: string[];
  actionPlan: string[];
  assessmentArtifacts: ArtifactBundleItem[];
}

export interface EvidenceWindowDisplay {
  duration: string;
  classification: string;
  continuity: string;
  confidence: string;
  reason: string;
  representativeness: string;
}

export interface ConfigurationDisplay {
  instanceClass: string;
  sqlServerEdition: string;
  sqlServerVersion: string;
  licenseModel: string;
  multiAz: string;
}

export interface EditionAssessmentDisplay {
  status: string;
  verdict: string;
  migrationPath: string;
  blockers: string[];
}

export interface DatabaseDriverDisplay {
  databaseName: string;
  drivers: string;
  iopsP95: string;
  throughputP95Mbps: string;
  sizeGb: string;
  tempdbSharePct: string;
  notes: string[];
}

export interface AssessmentMetricDisplay {
  label: string;
  value: string;
  detail: string;
}

export interface ResourceGateDisplay {
  dimension: string;
  status: string;
  statusLabel: string;
  scope: string;
  observed: string;
  limit: string;
  utilization: string;
  details: ResourceGateDetailDisplay[];
  reason: string;
  topDatabase: string;
}

export interface ResourceGateDetailDisplay {
  label: string;
  value: string;
}

export interface CandidateSummaryDisplay {
  instanceClass: string;
  decision: string;
  state: "selected" | "passed" | "rejected";
  visibleVcpu: string;
  cpuConfiguration: string;
  failedGates: string;
}

export interface ExportAction {
  format: string;
  available: boolean;
  label: string;
  href?: string;
  filename?: string;
}

export interface ArtifactBundleItem {
  artifactId: string;
  label: string;
  format: string;
  scope: string;
  includedSections: string;
  notes: string;
}

export function buildManualUploadResultsView(response: ManualUploadSuccessResponse): ManualUploadResultsViewModel {
  return {
    title: "RDS SQL Server Workload Optimization Results",
    pricingNotice: "Pricing is deferred. Results show workload fit, evidence checks, and next actions only.",
    fleet: {
      totalServers: response.summary.totalServers,
      optimizedServers: response.summary.optimizedServers,
      recommendedServers: response.summary.recommendedServers,
      aggressiveOptimizationServers: response.summary.aggressiveOptimizationServers,
      notOptimizedServers: response.summary.notOptimizedServers,
      outcomeGroups: fleetOutcomeGroups(response.reports),
      optimizedServerNames: response.summary.optimized.map((server) => server.serverName),
      notOptimizedServerNames: response.summary.notOptimized.map((server) => server.serverName)
    },
    servers: response.reports.map((report) => toServerCard(report)),
    exportActions: ["pdf", "csv", "json"].map((format) => ({
      format,
      available: Boolean(response.exports[format as keyof typeof response.exports]),
      label: exportLabel(format),
      href: exportHref(format, response.exports[format as keyof typeof response.exports]),
      filename: `rds-cost-optimization.${format === "pdf" ? "pdf" : format}`
    })),
    artifactBundle: summarizeFleetArtifacts(response.reports)
  };
}

function fleetOutcomeGroups(reports: readonly WorkloadOptimizationReport[]): FleetOutcomeGroup[] {
  const groups: Array<Omit<FleetOutcomeGroup, "count" | "serverNames">> = [
    {
      status: "recommended",
      label: "Recommended",
      summary: "Passed the workload-fit gates with sufficient evidence."
    },
    {
      status: "aggressive_optimization",
      label: "Aggressive Optimization",
      summary: "Capacity fits hard gates, but validation or evidence caution remains."
    },
    {
      status: "not_recommended",
      label: "Stay As Is",
      summary: "The current instance is retained; no lower-size change is approved by the workload-fit checks."
    }
  ];

  return groups.map((group) => {
    const serverNames = reports
      .filter((report) => report.status === group.status)
      .map((report) => report.serverName ?? "unknown");
    return {
      ...group,
      count: serverNames.length,
      serverNames
    };
  });
}

function toServerCard(report: WorkloadOptimizationReport): ServerResultsCard {
  const failedChecks = report.harnessFindings
    .filter((finding) => !finding.passed)
    .map((finding) => `${finding.oracle}: ${finding.message}`);
  const why = whyNotOptimized(report, failedChecks);
  const hasSelectedCandidate = selectedCandidateExists(report);
  const selectedConfig = report.recommendedConfig ?? report.currentConfig;
  const candidateEvaluations = summarizeCandidateEvaluations(report.candidateEvaluations);
  const candidateSummary = summarizeCandidateSummary(report.candidateEvaluations);
  const limitingResources = summarizeLimitingResources(report.limitingResources);

  return {
    serverName: report.serverName ?? "unknown",
    outcome: report.status,
    statusLabel: displayStatusLabel(report),
    riskLabel: displayRiskLabel(report),
    assessmentDetail: assessmentDetail(report),
    decisionSummary: decisionSummary(report),
    assessmentNotes: assessmentNotes(report),
    cpuStateLabel: formatCpuState(report.cpuAssessment?.state),
    visualMetrics: visualMetrics(report),
    currentVisibleVcpu: formatNumber(report.cpuAssessment?.currentVisibleVcpu),
    candidateVisibleVcpu: hasSelectedCandidate
      ? formatNumber(report.cpuAssessment?.candidateVisibleVcpu)
      : formatNumber(report.cpuAssessment?.currentVisibleVcpu ?? report.resultEvidence?.currentVcpu),
    cpuP95Pct: formatPercent(report.cpuAssessment?.cpuP95Pct),
    projectedSqlCpuP95Pct: hasSelectedCandidate ? formatPercent(report.cpuAssessment?.projectedSqlCpuP95Pct) : "Not projected",
    projectedSqlCpuP99Pct: hasSelectedCandidate ? formatPercent(report.cpuAssessment?.projectedSqlCpuP99Pct) : "Not projected",
    projectedTotalCpuP99Pct: hasSelectedCandidate ? formatPercent(report.cpuAssessment?.projectedTotalCpuP99Pct) : "Not projected",
    observedOtherCpuP95Pct: formatPercent(report.cpuAssessment?.observedOtherCpuP95Pct),
    observedOtherCpuP99Pct: formatPercent(report.cpuAssessment?.observedOtherCpuP99Pct),
    cpuProjectionConfidence: report.cpuAssessment?.projectionConfidence ?? "n/a",
    cpuProjectionBasis: report.cpuAssessment?.projectionBasis ?? "n/a",
    cpuExcursions: report.cpuAssessment?.excursionSampleCount === undefined
      ? "n/a"
      : `${report.cpuAssessment.excursionSampleCount} (${formatPercent(report.cpuAssessment.excursionSamplePct)})`,
    candidateCpuConfiguration: hasSelectedCandidate
      ? report.cpuAssessment?.candidateConfigurationType === "optimize_cpu"
        ? `Optimize CPU: ${report.cpuAssessment.candidateCoreCount} cores x ${report.cpuAssessment.candidateThreadsPerCore} threads`
        : report.cpuAssessment?.candidateConfigurationType ?? "n/a"
      : "Current configuration retained",
    highCpuThresholdPct: formatNumber(report.cpuAssessment?.highCpuThresholdPct ?? 70),
    highCpuSamplePct: formatPercent(report.cpuAssessment?.highCpuSamplePct),
    longestHighCpuStreakMinutes: formatNumber(report.cpuAssessment?.longestHighCpuStreakMinutes),
    evidenceWindow: {
      duration: report.evidenceWindow ? `${formatNumber(report.evidenceWindow.durationDays)} days` : "n/a",
      classification: report.evidenceWindow?.classification ?? "n/a",
      continuity: report.evidenceWindow
        ? `${report.evidenceWindow.continuityStatus} (${report.evidenceWindow.continuityIssueCount} issue(s))`
        : "n/a",
      confidence: report.confidence ?? "n/a",
      reason: report.evidenceWindow?.confidenceReason ?? "Evidence-window assessment unavailable.",
      representativeness: report.evidenceWindow?.representativenessStatement
        ?? "Customer confirmation of representative workload is required."
    },
    current: {
      instanceClass: report.currentConfig.instanceClass,
      sqlServerEdition: report.currentConfig.sqlServerEdition,
      sqlServerVersion: report.currentConfig.sqlServerVersion,
      licenseModel: report.currentConfig.licenseModel,
      multiAz: formatMultiAz(report.currentConfig.multiAz)
    },
    optimizedTitle: hasSelectedCandidate ? "Optimized" : "Stay As Is",
    optimized: {
      instanceClass: selectedConfig.instanceClass,
      sqlServerEdition: selectedConfig.sqlServerEdition,
      sqlServerVersion: selectedConfig.sqlServerVersion,
      licenseModel: selectedConfig.licenseModel,
      multiAz: formatMultiAz(selectedConfig.multiAz)
    },
    editionAssessment: {
      status: report.enterpriseToStandard?.status ?? "not applicable",
      verdict: report.enterpriseToStandard?.eligible
        ? "Eligible for a separate Standard Edition migration"
        : report.enterpriseToStandard?.status === "blocked"
          ? "Remain on Enterprise Edition"
          : "Not applicable",
      migrationPath: formatMigrationPath(report.enterpriseToStandard?.acceptedMigrationPath),
      blockers: report.enterpriseToStandard?.blockers.map((blocker) =>
        `${blocker.category}: ${blocker.message}`
      ) ?? []
    },
    memoryAssessment: memoryAssessment(report),
    ioAssessment: ioAssessment(report),
    tempdbAssessment: tempdbAssessment(report),
    resourceGates: report.limitingResources.map(toResourceGateDisplay),
    limitingResources,
    candidateEvaluations,
    candidateSummary,
    whyOptimized: report.whyOptimized,
    whyNotOptimized: why,
    blockers: report.blockers.map((blocker) => `${blocker.dimension}: ${blocker.message}`),
    topDatabaseDrivers: report.topDatabaseDrivers.map(toDatabaseDriverDisplay),
    supportingEvidence: report.supportingEvidence,
    advisorySignals: report.advisorySignals,
    passedChecks: report.passedChecks,
    failedChecks,
    actionPlan: report.actionPlan,
    assessmentArtifacts: report.assessmentArtifacts.map(toArtifactBundleItem)
  };
}

function assessmentNotes(report: WorkloadOptimizationReport): string[] {
  const notes: string[] = [];
  if (report.currentConfig.regionSource === "fallback") {
    notes.push(report.currentConfig.regionFallbackReason ?? `RDS endpoint region could not be inferred; using ${report.currentConfig.region} for catalog validation.`);
  }
  if (report.currentConfig.catalogMatch === false) {
    notes.push(report.currentConfig.catalogComparisonNote ?? `Current RDSSize ${report.currentConfig.instanceClass} was not found in the catalog; current-versus-optimized comparison is limited.`);
  }
  if (report.currentConfig.storageFactsComplete === false && report.currentConfig.storageFactsMissing?.length) {
    notes.push(`Storage facts missing from collector output: ${report.currentConfig.storageFactsMissing.join(", ")}. Storage design is retained and compute assessment uses available workload evidence.`);
  }
  if (report.currentConfig.multiAz === "unknown") {
    notes.push("Multi-AZ status was not provided; Multi-AZ capability comparison is limited.");
  }
  if (report.evidenceWindow && !["minimum_recommended", "preferred", "monthly_cycle"].includes(report.evidenceWindow.classification)) {
    notes.push(`Evidence window is ${report.evidenceWindow.classification}: ${report.evidenceWindow.confidenceReason}`);
  }
  return unique(notes);
}

function decisionSummary(report: WorkloadOptimizationReport): string {
  if (report.status === "recommended") {
    return `Scale down from ${report.currentConfig.instanceClass} to ${report.recommendedConfig?.instanceClass ?? "the selected candidate"} because the workload evidence fits the required CPU, memory, IOPS, throughput, tempdb, edition, orderability, and evidence checks.`;
  }
  if (report.status === "aggressive_optimization") {
    return `Scale down from ${report.currentConfig.instanceClass} to ${report.recommendedConfig?.instanceClass ?? "the selected candidate"} after validation because candidate capacity fits the hard gates while evidence uncertainty remains.`;
  }
  return `Stay as is on ${report.currentConfig.instanceClass} because ${stayAsIsSummary(report)}.`;
}

function displayStatusLabel(report: WorkloadOptimizationReport): string {
  return report.status === "not_recommended"
    ? "Stay As Is"
    : `Scaled Down to ${report.recommendedConfig?.instanceClass ?? "the optimized instance"}`;
}

function displayRiskLabel(report: WorkloadOptimizationReport): string {
  return report.status === "not_recommended" ? "Current instance retained" : "Workload-fit checks passed";
}

function assessmentDetail(report: WorkloadOptimizationReport): string {
  return report.status === "not_recommended"
    ? `Current instance retained | ${report.confidence ?? "n/a"} confidence`
    : `From ${report.currentConfig.instanceClass} | ${report.confidence ?? "n/a"} confidence`;
}

function stayAsIsSummary(report: WorkloadOptimizationReport): string {
  const evidenceReasons = report.evidenceWindow && !["minimum_recommended", "preferred", "monthly_cycle"].includes(report.evidenceWindow.classification)
    ? [
        normalizeReason(report.evidenceWindow.confidenceReason),
        "Business-period representativeness requires customer confirmation"
      ]
    : [];
  const limitingResourceReasons = report.limitingResources
    .filter((resource) => resource.status === "blocking")
    .map((resource) => stayAsIsReason(resource.dimension, resource.reason));
  const blockerReasons = report.blockers.map((blocker) => stayAsIsReason(blocker.dimension, blocker.message));
  const reasons = unique([...evidenceReasons, ...limitingResourceReasons, ...blockerReasons])
    .filter(Boolean)
    .slice(0, 3);
  return sentenceList(reasons.length > 0 ? reasons : ["the collected evidence does not prove a safe lower instance for this workload"]);
}

function normalizeReason(value: string): string {
  return value
    .replace(/^No candidate is recommended because\s+/i, "")
    .replace(/^No optimization is recommended because\s+/i, "")
    .replace(/\.$/, "");
}

function stayAsIsReason(dimension: string, reason: string): string {
  return isEvidenceWindowReason(reason)
    ? normalizeReason(reason)
    : dimensionStayAsIsReason(dimension);
}

function isEvidenceWindowReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("collected hours")
    || normalized.includes("evidence window")
    || normalized.includes("collection window");
}

function dimensionStayAsIsReason(dimension: string): string {
  if (dimension === "cpu") return "projected CPU does not fit a lower candidate";
  if (dimension === "memory") return "memory evidence does not support a safe lower instance";
  if (dimension === "iops") return "observed physical IOPS demand does not fit a lower candidate";
  if (dimension === "throughput") return "observed throughput demand does not fit a lower candidate";
  if (dimension === "tempdb") return "tempdb placement or capacity evidence does not fit the candidate";
  if (dimension === "edition") return "SQL Server edition requirements are not ready for this change";
  if (dimension === "orderability") return "exact RDS orderability evidence is not available for a lower candidate";
  if (dimension === "evidence") return "the collection window or evidence quality is not sufficient yet";
  return "the collected evidence does not prove a safe lower instance for this workload";
}

function visualMetrics(report: WorkloadOptimizationReport): AssessmentMetricDisplay[] {
  const evidence = report.resultEvidence;
  const hasSelectedCandidate = selectedCandidateExists(report);
  const currentVcpu = report.cpuAssessment?.currentVisibleVcpu ?? evidence?.currentVcpu;
  const candidateVcpu = report.cpuAssessment?.candidateVisibleVcpu ?? evidence?.optimizedVcpu;
  const projectedSqlCpuP95 = report.cpuAssessment?.projectedSqlCpuP95Pct
    ?? report.cpuAssessment?.projectedCpuPct
    ?? evidence?.projectedSqlCpuP95Pct
    ?? evidence?.projectedCpuPct;
  const projectedSqlCpuP99 = report.cpuAssessment?.projectedSqlCpuP99Pct
    ?? evidence?.projectedSqlCpuP99Pct;
  const memoryRequiredFloorGb = evidence?.memoryRequiredFloorGb
    ?? report.evidence?.memory?.requiredMemoryFloorGb;
  return [
    {
      label: "Visible vCPU",
      value: hasSelectedCandidate
        ? `${formatNumber(currentVcpu)} -> ${formatNumber(candidateVcpu)}`
        : `${formatNumber(currentVcpu)} -> ${formatNumber(currentVcpu)}`,
      detail: hasSelectedCandidate ? "Current to selected candidate" : "Current instance retained"
    },
    {
      label: "Projected SQL CPU",
      value: hasSelectedCandidate
        ? `${formatPercent(projectedSqlCpuP95)} / ${formatPercent(projectedSqlCpuP99)}`
        : "Current instance retained",
      detail: hasSelectedCandidate ? "P95 / P99 after candidate projection" : "No resize projection shown"
    },
    {
      label: "Memory Fit",
      value: hasSelectedCandidate
        ? `${formatMetricValue(memoryRequiredFloorGb)} / ${formatNumber(evidence?.candidateMemoryGb)} GB`
        : `${formatMetricValue(memoryRequiredFloorGb)} / current instance`,
      detail: hasSelectedCandidate ? "Required floor / candidate memory" : "Required floor; current instance retained"
    },
    {
      label: "IOPS Fit",
      value: `${formatMetricValue(evidence?.iopsP95)} / ${candidateMetricValue(evidence?.candidateBaselineIops, hasSelectedCandidate)}`,
      detail: hasSelectedCandidate ? "P95 demand / sustained candidate limit" : "P95 demand; current instance retained"
    },
    {
      label: "Throughput Fit",
      value: hasSelectedCandidate
        ? `${formatMetricValue(evidence?.throughputP95)} / ${formatNumber(evidence?.candidateBaselineThroughputMbps)} MiB/s`
        : `${formatMetricValue(evidence?.throughputP95)} / current instance`,
      detail: hasSelectedCandidate ? "P95 demand / sustained candidate limit" : "P95 demand; current instance retained"
    },
    {
      label: "Evidence Window",
      value: report.evidenceWindow ? `${formatNumber(report.evidenceWindow.durationDays)} days` : "n/a",
      detail: report.evidenceWindow?.classification ?? "Collection window unavailable"
    }
  ];
}

function candidateMetricValue(value: number | undefined, hasSelectedCandidate: boolean): string {
  return hasSelectedCandidate ? formatNumber(value) : "current instance";
}

function formatMetricValue(value: number | undefined): string {
  return value === undefined ? "Unavailable" : formatNumber(value);
}

function toResourceGateDisplay(resource: WorkloadOptimizationReport["limitingResources"][number]): ResourceGateDisplay {
  const reasonOnly = resource.observed === undefined
    && resource.limit === undefined
    && resource.utilizationPct === undefined;
  const evidenceCheck = reasonOnly && isEvidenceCheck(resource);
  const database = resource.topDatabaseName && isCustomerVisibleDatabaseName(resource.topDatabaseName)
    ? `${resource.topDatabaseName}${resource.topDatabaseMetric ? ` (${resource.topDatabaseMetric}${resource.topDatabaseValue === undefined ? "" : `: ${formatNumber(resource.topDatabaseValue)}`})` : ""}`
    : "Server-level";
  const observed = resource.observed === undefined ? "n/a" : `${formatNumber(resource.observed)}${resource.unit ? ` ${resource.unit}` : ""}`;
  const limit = resource.limit === undefined ? "n/a" : `${formatNumber(resource.limit)}${resource.unit ? ` ${resource.unit}` : ""}`;
  const utilization = formatPercent(resource.utilizationPct);
  return {
    dimension: evidenceCheck ? "Evidence Check" : formatDimension(resource.dimension),
    status: resource.status,
    statusLabel: evidenceCheck && resource.status === "blocking" ? "Needs evidence" : formatGateStatus(resource.status),
    scope: evidenceCheck ? "evidence" : resource.scope,
    observed,
    limit,
    utilization,
    details: [
      resource.observed === undefined ? undefined : { label: "Observed", value: observed },
      resource.limit === undefined ? undefined : { label: "Limit", value: limit },
      resource.utilizationPct === undefined ? undefined : { label: "Utilization", value: utilization },
      database === "Server-level" ? undefined : { label: "Attribution", value: database }
    ].filter((detail): detail is ResourceGateDetailDisplay => Boolean(detail)),
    reason: summarizeReason(resource.reason),
    topDatabase: database
  };
}

function isEvidenceCheck(resource: WorkloadOptimizationReport["limitingResources"][number]): boolean {
  const reason = resource.reason.toLowerCase();
  return reason.includes("evidence window")
    || reason.includes("collection window")
    || reason.includes("collected hour")
    || reason.includes("collected hours")
    || reason.includes("collection duration");
}

function summarizeFleetArtifacts(reports: readonly WorkloadOptimizationReport[]): ArtifactBundleItem[] {
  const firstByFormat = new Map<string, ArtifactBundleItem>();
  for (const report of reports) {
    for (const artifact of report.assessmentArtifacts) {
      const key = `${artifact.format}:${artifact.label}`;
      if (!firstByFormat.has(key)) firstByFormat.set(key, toArtifactBundleItem(artifact));
    }
  }
  return [...firstByFormat.values()];
}

function toArtifactBundleItem(artifact: WorkloadOptimizationReport["assessmentArtifacts"][number]): ArtifactBundleItem {
  return {
    artifactId: artifact.artifactId,
    label: artifact.label,
    format: artifact.format.toUpperCase(),
    scope: artifact.scope,
    includedSections: artifact.includedSections.join(", "),
    notes: artifact.notes.join(" ")
  };
}

function toDatabaseDriverDisplay(driver: DatabaseDriverSummary): DatabaseDriverDisplay {
  return {
    databaseName: driver.databaseName,
    drivers: driver.drivers.join(", ") || "none",
    iopsP95: formatNumber(driver.iopsP95),
    throughputP95Mbps: formatNumber(driver.throughputP95Mbps),
    sizeGb: formatNumber(driver.sizeGb),
    tempdbSharePct: formatPercent(driver.tempdbSharePct),
    notes: driver.notes
  };
}

function summarizeLimitingResources(resources: WorkloadOptimizationReport["limitingResources"]): string[] {
  const rows = resources.map((resource) => {
    const capacity = resource.observed === undefined && resource.limit === undefined
      ? ""
      : ` Observed ${formatNumber(resource.observed)} / limit ${formatNumber(resource.limit)} ${resource.unit ?? ""}.`;
    const database = resource.topDatabaseName && isCustomerVisibleDatabaseName(resource.topDatabaseName)
      ? ` Top database: ${resource.topDatabaseName}${resource.topDatabaseMetric ? ` (${resource.topDatabaseMetric}: ${formatNumber(resource.topDatabaseValue)})` : ""}.`
      : "";
    return `${resource.scope} ${formatDimension(resource.dimension)}: ${formatGateStatus(resource.status)}.${capacity} ${summarizeReason(resource.reason)}${database}`.trim();
  });
  return limitDisplayRows(rows, MAX_RESOURCE_DISPLAY_ROWS, "Additional resource-gate details are retained in the JSON and CSV exports.");
}

function summarizeCandidateEvaluations(candidates: WorkloadOptimizationReport["candidateEvaluations"]): string[] {
  const selectedOrPassed = candidates.filter((candidate) => candidate.selected || candidate.accepted);
  const notSelected = candidates.filter((candidate) => !candidate.selected && !candidate.accepted);
  const rows = [...selectedOrPassed, ...notSelected]
    .slice(0, MAX_CANDIDATE_DISPLAY_ROWS)
    .map((candidate) => `${candidate.selected ? "Selected" : candidate.accepted ? "Passed" : "Not selected"} ${candidate.instanceClass}, ${candidate.sqlServerVisibleVcpu} visible vCPU. ${candidate.failedGates.length > 0 ? `Needs review: ${summarizeFailedGates(candidate.failedGates)}.` : "All gates passed."}`);
  const omitted = candidates.length - rows.length;
  return omitted > 0 ? [...rows, `${omitted} additional candidate checks are retained in the JSON and CSV exports.`] : rows;
}

function summarizeCandidateSummary(candidates: WorkloadOptimizationReport["candidateEvaluations"]): CandidateSummaryDisplay[] {
  const selectedOrPassed = candidates.filter((candidate) => candidate.selected || candidate.accepted);
  const notSelected = candidates.filter((candidate) => !candidate.selected && !candidate.accepted);
  const display = [...selectedOrPassed, ...notSelected].slice(0, MAX_CANDIDATE_DISPLAY_ROWS);
  const rows: CandidateSummaryDisplay[] = display.map((candidate) => ({
    instanceClass: candidate.instanceClass,
    decision: candidate.selected ? "Selected target" : candidate.accepted ? "Fits workload checks" : "Not selected",
    state: candidate.selected ? "selected" : candidate.accepted ? "passed" : "rejected",
    visibleVcpu: formatNumber(candidate.sqlServerVisibleVcpu),
    cpuConfiguration: candidate.cpuConfigurationType === "optimize_cpu"
      ? `Optimize CPU ${candidate.cpuCoreCount ?? "?"}x${candidate.cpuThreadsPerCore ?? "?"}`
      : "Default CPU",
    failedGates: candidate.failedGates.length > 0 ? summarizeFailedGates(candidate.failedGates) : "None"
  }));
  const omitted = candidates.length - rows.length;
  if (omitted > 0) {
    rows.push({
      instanceClass: "Additional candidate checks",
      decision: `${omitted} retained in exports`,
      state: "rejected",
      visibleVcpu: "n/a",
      cpuConfiguration: "See JSON/CSV exports",
      failedGates: "Summary row"
    });
  }
  return rows;
}

function summarizeFailedGates(gates: readonly string[]): string {
  const labels = unique(gates.map(customerGateLabel));
  return sentenceList(labels.slice(0, 4));
}

function customerGateLabel(gate: string): string {
  if (gate.includes("CPU")) return "CPU fit";
  if (gate.includes("MEMORY")) return "memory fit";
  if (gate.includes("IOPS")) return "IOPS fit";
  if (gate.includes("THROUGHPUT")) return "throughput fit";
  if (gate.includes("TEMPDB")) return "tempdb fit";
  if (gate.includes("EDITION")) return "edition readiness";
  if (gate.includes("ORDER") || gate.includes("VERSION") || gate.includes("CATALOG")) return "orderability evidence";
  if (gate.includes("STORAGE")) return "storage capability evidence";
  return gate.replace(/_/g, " ").toLowerCase();
}

function whyNotOptimized(report: WorkloadOptimizationReport, failedChecks: string[]): string[] {
  if (report.status !== "not_recommended") return [];
  const blockerReasons = report.blockers.map((blocker) => `${formatDimension(blocker.dimension)}: ${summarizeReason(blocker.message)}`);
  const harnessReasons = failedChecks.map((finding) => summarizeReason(finding));
  return limitDisplayRows(unique([...blockerReasons, ...harnessReasons]), MAX_REASON_DISPLAY_ROWS, "Additional stay-as-is details are retained in the JSON and CSV exports.");
}

function summarizeReason(reason: string): string {
  const normalized = normalizeReason(reason);
  const displayReason = normalizeDisplayReason(reason);
  if (displayReason.length <= MAX_REASON_CHARS && !/[A-Z0-9]+_[A-Z0-9_]+/.test(displayReason)) return displayReason;
  const lower = normalized.toLowerCase();
  const parts: string[] = [];
  if (lower.includes("collected hour") || lower.includes("collection window") || lower.includes("evidence window")) {
    parts.push(normalized.split(".")[0]);
  }
  if (lower.includes("cpu")) parts.push("CPU projection does not fit the lower candidate.");
  if (lower.includes("memory")) parts.push("Memory evidence does not fit the lower candidate.");
  if (lower.includes("iops")) parts.push("Observed physical IOPS demand does not fit the lower candidate.");
  if (lower.includes("throughput")) parts.push("Observed throughput demand does not fit the lower candidate.");
  if (lower.includes("tempdb")) parts.push("tempdb placement or capacity needs review.");
  if (lower.includes("order") || lower.includes("catalog") || lower.includes("version")) parts.push("Exact RDS orderability evidence is incomplete for a lower candidate.");
  return unique(parts).slice(0, 3).join(" ") || `${normalized.slice(0, MAX_REASON_CHARS - 1).trimEnd()}...`;
}

function normalizeDisplayReason(value: string): string {
  return value
    .replace(/^No candidate is recommended because\s+/i, "")
    .replace(/^No optimization is recommended because\s+/i, "")
    .trim();
}

function limitDisplayRows(rows: string[], limit: number, omittedMessage: string): string[] {
  const limited = rows.slice(0, limit);
  const omitted = rows.length - limited.length;
  return omitted > 0 ? [...limited, `${omitted} ${omittedMessage}`] : limited;
}

function memoryAssessment(report: WorkloadOptimizationReport): string[] {
  const evidence = report.resultEvidence;
  if (!evidence) return [];
  const hasSelectedCandidate = selectedCandidateExists(report);
  const memoryRequiredFloorGb = evidence.memoryRequiredFloorGb
    ?? report.evidence?.memory?.requiredMemoryFloorGb;
  return [
    `Candidate memory: ${hasSelectedCandidate ? `${formatNumber(evidence.candidateMemoryGb)} GB` : "No selected candidate"}.`,
    `Less-elastic floor with ${formatNumber(evidence.memoryHeadroomPct ?? report.evidence?.memory?.headroomPct ?? 20)}% headroom: ${formatNumber(memoryRequiredFloorGb)} GB.`,
    `Pressure state: ${evidence.memoryPressureState ?? "n/a"}; evidence confidence: ${evidence.memoryEvidenceConfidence ?? "n/a"}.`,
    `Memory-to-I/O coupling: ${evidence.memoryCouplingVerdict ?? "n/a"}; ${evidence.memoryCouplingReasons?.join(" ") ?? ""}`
  ];
}

function ioAssessment(report: WorkloadOptimizationReport): string[] {
  const evidence = report.resultEvidence;
  if (!evidence) return [];
  const hasSelectedCandidate = selectedCandidateExists(report);
  const candidateIops = hasSelectedCandidate
    ? `${formatNumber(evidence.candidateBaselineIops)}/${formatNumber(evidence.candidateMaximumIops)}`
    : "No selected candidate";
  const candidateThroughput = hasSelectedCandidate
    ? `${formatNumber(evidence.candidateBaselineThroughputMbps)}/${formatNumber(evidence.candidateMaximumThroughputMbps)} MiB/s`
    : "No selected candidate";
  return [
    `Read IOPS P95/P99: ${formatNumber(evidence.readIopsP95)}/${formatNumber(evidence.readIopsP99)}.`,
    `Write IOPS P95/P99: ${formatNumber(evidence.writeIopsP95)}/${formatNumber(evidence.writeIopsP99)}.`,
    `Total IOPS P95/P99: ${formatNumber(evidence.iopsP95)}/${formatNumber(evidence.iopsP99)}; candidate sustained/maximum: ${candidateIops}.`,
    `Read throughput P95/P99: ${formatNumber(evidence.readThroughputP95MibPerSec)}/${formatNumber(evidence.readThroughputP99MibPerSec)} MiB/s.`,
    `Write throughput P95/P99: ${formatNumber(evidence.writeThroughputP95MibPerSec)}/${formatNumber(evidence.writeThroughputP99MibPerSec)} MiB/s.`,
    `Total throughput P95/P99: ${formatNumber(evidence.throughputP95)}/${formatNumber(evidence.throughputP99)} MiB/s; candidate sustained/maximum: ${candidateThroughput}.`,
    `IOPS burst: ${formatBurst(evidence.iopsBurstEvidence)}. Throughput burst: ${formatBurst(evidence.throughputBurstEvidence)}.`
  ];
}

function selectedCandidateExists(report: WorkloadOptimizationReport): boolean {
  if (report.status === "not_recommended") return false;
  return report.recommendedConfig !== undefined
    || report.candidateEvaluations.some((candidate) => candidate.selected);
}

function isCustomerVisibleDatabaseName(databaseName: string): boolean {
  return databaseName.trim().toLowerCase() !== "rdsadmin";
}

function tempdbAssessment(report: WorkloadOptimizationReport): string[] {
  const evidence = report.resultEvidence;
  if (!evidence?.tempdbPlacementTransition) return [];
  return [
    `Placement: ${evidence.currentTempdbPlacement ?? "unknown"} to ${evidence.candidateTempdbPlacement ?? "unknown"} (${evidence.tempdbPlacementTransition}).`,
    `tempdb IOPS P95/P99: ${formatNumber(evidence.tempdbIopsP95)}/${formatNumber(evidence.tempdbIopsP99)}.`,
    `tempdb throughput P95/P99: ${formatNumber(evidence.tempdbThroughputP95)}/${formatNumber(evidence.tempdbThroughputP99)} MiB/s.`,
    `Representative/peak allocation: ${formatNumber(evidence.tempdbRepresentativeAllocatedGb)}/${formatNumber(evidence.tempdbPeakAllocatedGb)} GB; candidate local capacity: ${formatNumber(evidence.candidateLocalStorageCapacityGb)} GB; result: ${evidence.tempdbCapacityResult ?? "n/a"}.`
  ];
}

function formatBurst(evidence: { eventCount: number; longestEventMinutes: number; eventsPer24Hours: number } | undefined): string {
  return evidence
    ? `${evidence.eventCount} event(s), longest ${evidence.longestEventMinutes} minutes, ${evidence.eventsPer24Hours} per 24 hours`
    : "not required or unavailable";
}

function formatNumber(value: number | undefined): string {
  if (value === undefined) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatMultiAz(value: boolean | "unknown"): string {
  if (value === "unknown") return "unknown";
  return value ? "Yes" : "No";
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) return "n/a";
  return `${formatNumber(value)}%`;
}

function formatCpuState(value: string | undefined): string {
  if (!value) return "Not assessed";
  if (value === "under_pressure") return "Under pressure";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDimension(value: string): string {
  if (value === "cpu") return "CPU";
  if (value === "iops") return "IOPS";
  if (value === "tempdb") return "tempdb";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatGateStatus(value: string): string {
  if (value === "within_limit") return "Within limit";
  if (value === "not_applicable") return "Not applicable";
  if (value === "blocking") return "Does not fit";
  if (value === "risk") return "Needs review";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMigrationPath(value: string | undefined): string {
  if (value === "native_backup_restore") return "Native backup/restore";
  if (value === "aws_dms") return "AWS DMS";
  return "Not accepted";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sentenceList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function exportHref(format: string, content: string | undefined): string | undefined {
  if (!content) return undefined;
  if (format === "pdf") return `data:application/pdf;base64,${content}`;
  const mime = format === "json" ? "application/json" : "text/csv";
  return `data:${mime};base64,${Buffer.from(content, "utf8").toString("base64")}`;
}

function exportLabel(format: string): string {
  if (format === "pdf") return "Download business PDF";
  if (format === "csv") return "Download technical CSV";
  return "Download technical JSON";
}
export * from "./html.js";

