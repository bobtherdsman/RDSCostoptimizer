import type { ManualUploadSuccessResponse } from "../upload/index.js";
import type { DatabaseDriverSummary, WorkloadOptimizationReport } from "../reports/index.js";

export interface ManualUploadResultsViewModel {
  title: string;
  pricingNotice: string;
  fleet: FleetResultsSummary;
  servers: ServerResultsCard[];
  exportActions: ExportAction[];
}

export interface FleetResultsSummary {
  totalServers: number;
  optimizedServers: number;
  recommendedServers: number;
  aggressiveOptimizationServers: number;
  notOptimizedServers: number;
  optimizedServerNames: string[];
  notOptimizedServerNames: string[];
}

export interface ServerResultsCard {
  serverName: string;
  outcome: "recommended" | "aggressive_optimization" | "not_recommended";
  statusLabel: string;
  riskLabel: string;
  cpuStateLabel: string;
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
  optimized: ConfigurationDisplay;
  editionAssessment: EditionAssessmentDisplay;
  memoryAssessment: string[];
  ioAssessment: string[];
  tempdbAssessment: string[];
  limitingResources: string[];
  candidateEvaluations: string[];
  whyOptimized: string[];
  whyNotOptimized: string[];
  blockers: string[];
  topDatabaseDrivers: DatabaseDriverDisplay[];
  advisorySignals: string[];
  passedChecks: string[];
  failedChecks: string[];
  actionPlan: string[];
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

export interface ExportAction {
  format: string;
  available: boolean;
  label: string;
  href?: string;
  filename?: string;
}

export function buildManualUploadResultsView(response: ManualUploadSuccessResponse): ManualUploadResultsViewModel {
  return {
    title: "RDS SQL Server Workload Optimization Results",
    pricingNotice: "Pricing is deferred. Results show workload fit, blockers, risk, and next actions only.",
    fleet: {
      totalServers: response.summary.totalServers,
      optimizedServers: response.summary.optimizedServers,
      recommendedServers: response.summary.recommendedServers,
      aggressiveOptimizationServers: response.summary.aggressiveOptimizationServers,
      notOptimizedServers: response.summary.notOptimizedServers,
      optimizedServerNames: response.summary.optimized.map((server) => server.serverName),
      notOptimizedServerNames: response.summary.notOptimized.map((server) => server.serverName)
    },
    servers: response.reports.map((report) => toServerCard(report)),
    exportActions: ["json", "csv", "pdf"].map((format) => ({
      format,
      available: Boolean(response.exports[format as keyof typeof response.exports]),
      label: `Download ${format.toUpperCase()}`,
      href: exportHref(format, response.exports[format as keyof typeof response.exports]),
      filename: `rds-cost-optimization.${format === "pdf" ? "pdf" : format}`
    }))
  };
}

function toServerCard(report: WorkloadOptimizationReport): ServerResultsCard {
  const failedChecks = report.harnessFindings
    .filter((finding) => !finding.passed)
    .map((finding) => `${finding.oracle}: ${finding.message}`);
  const why = whyNotOptimized(report, failedChecks);

  return {
    serverName: report.serverName ?? "unknown",
    outcome: report.status,
    statusLabel: report.decision,
    riskLabel: report.risk.toUpperCase(),
    cpuStateLabel: formatCpuState(report.cpuAssessment?.state),
    currentVisibleVcpu: formatNumber(report.cpuAssessment?.currentVisibleVcpu),
    candidateVisibleVcpu: formatNumber(report.cpuAssessment?.candidateVisibleVcpu),
    cpuP95Pct: formatPercent(report.cpuAssessment?.cpuP95Pct),
    projectedSqlCpuP95Pct: formatPercent(report.cpuAssessment?.projectedSqlCpuP95Pct),
    projectedSqlCpuP99Pct: formatPercent(report.cpuAssessment?.projectedSqlCpuP99Pct),
    projectedTotalCpuP99Pct: formatPercent(report.cpuAssessment?.projectedTotalCpuP99Pct),
    observedOtherCpuP95Pct: formatPercent(report.cpuAssessment?.observedOtherCpuP95Pct),
    observedOtherCpuP99Pct: formatPercent(report.cpuAssessment?.observedOtherCpuP99Pct),
    cpuProjectionConfidence: report.cpuAssessment?.projectionConfidence ?? "n/a",
    cpuProjectionBasis: report.cpuAssessment?.projectionBasis ?? "n/a",
    cpuExcursions: report.cpuAssessment?.excursionSampleCount === undefined
      ? "n/a"
      : `${report.cpuAssessment.excursionSampleCount} (${formatPercent(report.cpuAssessment.excursionSamplePct)})`,
    candidateCpuConfiguration: report.cpuAssessment?.candidateConfigurationType === "optimize_cpu"
      ? `Optimize CPU: ${report.cpuAssessment.candidateCoreCount} cores x ${report.cpuAssessment.candidateThreadsPerCore} threads`
      : report.cpuAssessment?.candidateConfigurationType ?? "n/a",
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
    optimized: {
      instanceClass: report.recommendedConfig?.instanceClass ?? "Blocked",
      sqlServerEdition: report.recommendedConfig?.sqlServerEdition ?? report.currentConfig.sqlServerEdition,
      sqlServerVersion: report.recommendedConfig?.sqlServerVersion ?? report.currentConfig.sqlServerVersion,
      licenseModel: report.recommendedConfig?.licenseModel ?? report.currentConfig.licenseModel,
      multiAz: formatMultiAz(report.recommendedConfig?.multiAz ?? report.currentConfig.multiAz)
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
    limitingResources: report.limitingResources.map((resource) => {
      const capacity = resource.observed === undefined && resource.limit === undefined
        ? ""
        : ` Observed ${formatNumber(resource.observed)} / limit ${formatNumber(resource.limit)} ${resource.unit ?? ""}.`;
      const database = resource.topDatabaseName
        ? ` Top database: ${resource.topDatabaseName}${resource.topDatabaseMetric ? ` (${resource.topDatabaseMetric}: ${formatNumber(resource.topDatabaseValue)})` : ""}.`
        : "";
      return `${resource.scope} ${resource.dimension}: ${resource.status}.${capacity} ${resource.reason}${database}`.trim();
    }),
    candidateEvaluations: report.candidateEvaluations.map((candidate) =>
      `${candidate.selected ? "Selected" : candidate.accepted ? "Passed" : "Rejected"} ${candidate.instanceClass}, ${candidate.sqlServerVisibleVcpu} visible vCPU, ${candidate.decision}. ${candidate.failedGates.length > 0 ? `Failed: ${candidate.failedGates.join(", ")}.` : "All gates passed."}`
    ),
    whyOptimized: report.whyOptimized,
    whyNotOptimized: why,
    blockers: report.blockers.map((blocker) => `${blocker.dimension}: ${blocker.message}`),
    topDatabaseDrivers: report.topDatabaseDrivers.map(toDatabaseDriverDisplay),
    advisorySignals: report.advisorySignals,
    passedChecks: report.passedChecks,
    failedChecks,
    actionPlan: report.actionPlan
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

function whyNotOptimized(report: WorkloadOptimizationReport, failedChecks: string[]): string[] {
  if (report.status !== "not_recommended") return [];
  const blockerReasons = report.blockers.map((blocker) => `${blocker.dimension}: ${blocker.message}`);
  return unique([...blockerReasons, ...failedChecks]);
}

function memoryAssessment(report: WorkloadOptimizationReport): string[] {
  const evidence = report.resultEvidence;
  if (!evidence) return [];
  return [
    `Candidate memory: ${formatNumber(evidence.candidateMemoryGb)} GB.`,
    `Less-elastic floor with ${formatNumber(evidence.memoryHeadroomPct)}% headroom: ${formatNumber(evidence.memoryRequiredFloorGb)} GB.`,
    `Pressure state: ${evidence.memoryPressureState ?? "n/a"}; evidence confidence: ${evidence.memoryEvidenceConfidence ?? "n/a"}.`,
    `Memory-to-I/O coupling: ${evidence.memoryCouplingVerdict ?? "n/a"}; ${evidence.memoryCouplingReasons?.join(" ") ?? ""}`
  ];
}

function ioAssessment(report: WorkloadOptimizationReport): string[] {
  const evidence = report.resultEvidence;
  if (!evidence) return [];
  return [
    `Read IOPS P95/P99: ${formatNumber(evidence.readIopsP95)}/${formatNumber(evidence.readIopsP99)}.`,
    `Write IOPS P95/P99: ${formatNumber(evidence.writeIopsP95)}/${formatNumber(evidence.writeIopsP99)}.`,
    `Total IOPS P95/P99: ${formatNumber(evidence.iopsP95)}/${formatNumber(evidence.iopsP99)}; candidate sustained/maximum: ${formatNumber(evidence.candidateBaselineIops)}/${formatNumber(evidence.candidateMaximumIops)}.`,
    `Read throughput P95/P99: ${formatNumber(evidence.readThroughputP95MibPerSec)}/${formatNumber(evidence.readThroughputP99MibPerSec)} MiB/s.`,
    `Write throughput P95/P99: ${formatNumber(evidence.writeThroughputP95MibPerSec)}/${formatNumber(evidence.writeThroughputP99MibPerSec)} MiB/s.`,
    `Total throughput P95/P99: ${formatNumber(evidence.throughputP95)}/${formatNumber(evidence.throughputP99)} MiB/s; candidate sustained/maximum: ${formatNumber(evidence.candidateBaselineThroughputMbps)}/${formatNumber(evidence.candidateMaximumThroughputMbps)} MiB/s.`,
    `IOPS burst: ${formatBurst(evidence.iopsBurstEvidence)}. Throughput burst: ${formatBurst(evidence.throughputBurstEvidence)}.`
  ];
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

function formatMigrationPath(value: string | undefined): string {
  if (value === "native_backup_restore") return "Native backup/restore";
  if (value === "aws_dms") return "AWS DMS";
  return "Not accepted";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function exportHref(format: string, content: string | undefined): string | undefined {
  if (!content) return undefined;
  if (format === "pdf") return `data:application/pdf;base64,${content}`;
  const mime = format === "json" ? "application/json" : "text/csv";
  return `data:${mime};base64,${Buffer.from(content, "utf8").toString("base64")}`;
}
export * from "./html.js";

