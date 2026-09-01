export type SqlServerEdition = "Enterprise" | "Standard" | "Web" | "Express" | "Developer";
export type LicenseModel = "license-included" | "byom" | "unknown";
export type StorageType = "gp2" | "gp3" | "io1" | "io2" | "unknown";
export type CpuState = "underutilized" | "normal" | "under_pressure";
export type EditionMigrationPath = "native_backup_restore" | "aws_dms";
export type OptimizationDecision =
  | "Recommended"
  | "Aggressive Optimization"
  | "Not Recommended";
export type OptimizationResourceDimension =
  | "cpu"
  | "memory"
  | "iops"
  | "throughput"
  | "tempdb"
  | "edition"
  | "orderability"
  | "evidence";
export type OptimizationTempdbPlacementTransition =
  | "non_nvme_to_non_nvme"
  | "non_nvme_to_nvme"
  | "nvme_to_nvme"
  | "nvme_to_non_nvme"
  | "unknown";

export interface CurrentRdsConfig {
  region: string;
  regionSource?: "endpoint" | "fallback";
  regionFallbackReason?: string;
  catalogMatch?: boolean;
  catalogComparisonNote?: string;
  instanceClass: string;
  sqlServerEdition: SqlServerEdition;
  sqlServerVersion: string;
  licenseModel: LicenseModel;
  storageType: StorageType;
  allocatedStorageGb?: number;
  provisionedIops?: number;
  provisionedThroughputMbps?: number;
  storageFactsComplete?: boolean;
  storageFactsMissing?: string[];
  multiAz: boolean | "unknown";
  sqlServerVisibleVcpu?: number;
  cpuSocketCount?: number;
  cpuCoreCount?: number;
  cpuThreadsPerCore?: number;
  cpuConfigurationType?: "collector" | "default" | "optimize_cpu";
}

export interface MetricDistribution {
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LowTailMetricDistribution extends MetricDistribution {
  min: number;
  p05: number;
  p10: number;
}

export type WorkloadSampleSource = "cpu" | "memory" | "database_io";
export type WorkloadSampleIssueCode =
  | "missing_sample"
  | "duplicate_sample"
  | "out_of_order"
  | "counter_reset"
  | "invalid_sample"
  | "invalid_elapsed";

export interface WorkloadSampleIssue {
  code: WorkloadSampleIssueCode;
  source: WorkloadSampleSource;
  message: string;
  timestamp?: string;
  sampleKey?: string;
  databaseName?: string;
}

export interface CpuWorkloadSample {
  timestamp: string;
  timestampMs: number;
  sampleKey: string;
  sqlCpuPct: number;
  otherCpuPct: number;
  systemIdlePct: number;
}

export interface MemoryWorkloadSample {
  timestamp: string;
  timestampMs: number;
  sampleKey: string;
  sqlCommittedMemoryMb?: number;
  sqlTargetMemoryMb?: number;
  osTotalMemoryMb?: number;
  osAvailableMemoryMb?: number;
  pageLifeExpectancySeconds?: number;
  stolenServerMemoryMb?: number;
  memoryClerksJson?: string;
  memoryGrantsPending?: number;
  memoryGrantsOutstanding?: number;
  grantedWorkspaceMemoryKb?: number;
  physicalMemoryInUseKb?: number;
  processPhysicalMemoryLow?: boolean;
  processVirtualMemoryLow?: boolean;
  systemLowMemorySignalState?: boolean;
  systemHighMemorySignalState?: boolean;
  systemMemoryStateDescription?: string;
  overallPageLifeExpectancySeconds?: number;
  numaPleJson?: string;
  bufferCacheHitRatio?: number;
  bufferCacheHitRatioBase?: number;
  bufferCacheHitRatioPct?: number;
  pageReadsCounter?: number;
  pageWritesCounter?: number;
  lazyWritesCounter?: number;
  batchRequestsCounter?: number;
  batchRequestsPerSec?: number;
  columnstoreSegmentCacheMb?: number;
}

export interface DatabaseIoWorkloadSample {
  timestamp: string;
  timestampMs: number;
  sampleKey: string;
  sampleId?: string;
  databaseId?: number;
  databaseName: string;
  fileId?: number;
  fileType?: string;
  isTempdb: boolean;
  readOperations: number;
  writeOperations: number;
  bytesRead: number;
  bytesWritten: number;
  reportedTotalOperations?: number;
  reportedThroughputMbps?: number;
  counterMode?: "cumulative" | "interval_delta";
  previousTimestamp?: string;
  elapsedSeconds?: number;
  intervalValid: boolean;
}

export interface PhysicalIoSample {
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
  nonTempdbTotalIops: number;
  nonTempdbReadMibPerSec: number;
  nonTempdbWriteMibPerSec: number;
  nonTempdbTotalMibPerSec: number;
  tempdbReadIops: number;
  tempdbWriteIops: number;
  tempdbTotalIops: number;
  tempdbReadMibPerSec: number;
  tempdbWriteMibPerSec: number;
  tempdbTotalMibPerSec: number;
  validIntervalCount: number;
}

export interface PhysicalDatabaseIoSample {
  sampleKey: string;
  timestampMs: number;
  elapsedSeconds: number;
  databaseName: string;
  isTempdb: boolean;
  readIops: number;
  writeIops: number;
  totalIops: number;
  readMibPerSec: number;
  writeMibPerSec: number;
  totalMibPerSec: number;
}

export interface IoBurstEvidence {
  threshold: number;
  excursionSampleCount: number;
  excursionSamplePct: number;
  eventCount: number;
  longestEventMinutes: number;
  eventsPer24Hours: number;
}

export interface PhysicalIoEvidence {
  source: "cumulative_file_counters";
  samples: PhysicalIoSample[];
  databaseSamples?: PhysicalDatabaseIoSample[];
  readIops: MetricDistribution;
  writeIops: MetricDistribution;
  totalIops: MetricDistribution;
  readMibPerSec: MetricDistribution;
  writeMibPerSec: MetricDistribution;
  totalMibPerSec: MetricDistribution;
  nonTempdbTotalIops: MetricDistribution;
  nonTempdbTotalMibPerSec: MetricDistribution;
  tempdbTotalIops: MetricDistribution;
  tempdbTotalMibPerSec: MetricDistribution;
  invalidIntervalCount: number;
  rejectedSampleCount: number;
}

export interface SynchronizedWorkloadSample {
  sampleKey: string;
  timestampMs: number;
  cpu: CpuWorkloadSample[];
  memory: MemoryWorkloadSample[];
  userDatabaseIo: DatabaseIoWorkloadSample[];
  tempdbIo: DatabaseIoWorkloadSample[];
  missingSources: WorkloadSampleSource[];
  valid: boolean;
}

export interface CanonicalWorkloadSampleSeries {
  alignmentIntervalSeconds: 60;
  cpu: CpuWorkloadSample[];
  memory: MemoryWorkloadSample[];
  databaseIo: DatabaseIoWorkloadSample[];
  synchronized: SynchronizedWorkloadSample[];
  issues: WorkloadSampleIssue[];
}

export type EvidenceWindowClassification =
  | "insufficient"
  | "below_preliminary_window"
  | "preliminary"
  | "minimum_recommended"
  | "preferred"
  | "monthly_cycle";

export interface EvidenceWindowShortWindowException {
  category: "clearly_idle" | "non_production";
  customerConfirmed: true;
}

export interface EvidenceWindowAssessment {
  startTimestamp?: string;
  endTimestamp?: string;
  durationHours: number;
  durationDays: number;
  classification: EvidenceWindowClassification;
  confidence: "preliminary" | "medium" | "high";
  productionRightsizingEligible: boolean;
  continuityStatus: "complete" | "issues_detected" | "unavailable";
  continuityIssueCount: number;
  invalidSampleCount: number;
  issueCounts: Record<WorkloadSampleIssueCode, number>;
  representativeness: "customer_confirmation_required";
  representativenessStatement: string;
  shortWindowException?: EvidenceWindowShortWindowException;
  confidenceReason: string;
}

export interface CpuPressureEvidence {
  sampleCount: number;
  highCpuThresholdPct: number;
  highCpuSamplePct: number;
  longestHighCpuStreakSamples: number;
  sustainedPressure: boolean;
}

export interface DatabaseAttribution {
  databaseName: string;
  iops?: MetricDistribution;
  throughputMbps?: MetricDistribution;
  iopsSharePct?: number;
  throughputSharePct?: number;
  sizeGb?: number;
  tempdbSharePct?: number;
  advisoryCpuSharePct?: number;
  advisoryMemorySharePct?: number;
}

export interface MemoryEvidence {
  observedSqlMemoryMb?: number;
  sqlTargetMemoryMb?: number;
  osTotalMemoryMb?: number;
  osAvailableMemoryMb?: number;
  sqlCurrentToTargetPct?: number;
  osAvailablePct?: number;
  pageLifeExpectancySeconds?: number;
  memoryGrantsPending?: number;
  memoryGrantsOutstanding?: number;
  grantedWorkspaceMemoryKb?: number;
  physicalMemoryInUseKb?: number;
  processPhysicalMemoryLow?: boolean;
  processVirtualMemoryLow?: boolean;
  systemLowMemorySignalState?: boolean;
  systemHighMemorySignalState?: boolean;
  systemMemoryStateDescriptions?: string[];
  osAvailableMemoryPctLowTail?: LowTailMetricDistribution;
  sqlProcessPhysicalMemoryMb?: MetricDistribution;
  sqlCommittedMemoryMb?: MetricDistribution;
  sqlTargetMemoryMbDistribution?: MetricDistribution;
  memoryGrantsPendingDistribution?: MetricDistribution;
  memoryGrantsOutstandingDistribution?: MetricDistribution;
  grantedWorkspaceMemoryMb?: MetricDistribution;
  overallPleSeconds?: LowTailMetricDistribution;
  numaPleSeconds?: Record<string, LowTailMetricDistribution>;
  stolenServerMemoryMb?: MetricDistribution;
  lessElasticMemoryMb?: MetricDistribution;
  osNonSqlUsedMemoryMb?: MetricDistribution;
  bufferCacheHitRatioPct?: LowTailMetricDistribution;
  pageReadsPerSec?: MetricDistribution;
  pageWritesPerSec?: MetricDistribution;
  lazyWritesPerSec?: MetricDistribution;
  batchRequestsPerSec?: MetricDistribution;
  bufferPoolMemoryMb?: MetricDistribution;
  columnstoreSegmentCacheMb?: MetricDistribution;
  requiredMemoryFloorGb?: number;
  headroomPct?: number;
  evidenceConfidence?: "high" | "medium" | "low";
  evidenceCompleteness?: string[];
  workingSetValidationRequired?: boolean;
  pressureSignals: string[];
}

export interface EditionDatabaseEvidence {
  databaseName: string;
  auditStatus: "complete" | "failed";
  enterpriseFeatures: string[];
  columnstoreSegmentCacheMb?: number;
  memoryOptimizedAllocatedMb?: number;
  memoryOptimizedUsedMb?: number;
}

export interface EditionWorkloadEvidence {
  source: "collector";
  databases: EditionDatabaseEvidence[];
  auditComplete: boolean;
}

export interface EditionChangeConfirmations {
  vendorSupportsStandardEdition?: boolean;
  migrationPathAccepted?: boolean;
  migrationPath?: EditionMigrationPath;
}

export type EditionEligibilityCategory =
  | "feature"
  | "vendor"
  | "scale"
  | "orderability"
  | "migration";

export interface EditionEligibilityBlocker {
  code: string;
  category: EditionEligibilityCategory;
  message: string;
  databaseName?: string;
}

export interface EditionEligibilityTerm {
  passed: boolean;
  blockers: EditionEligibilityBlocker[];
}

export interface StandardEditionScaleLimits {
  sqlMajorVersion: number;
  maxSockets: number;
  maxCores: number;
  maxBufferPoolGb: number;
  maxColumnstoreSegmentCacheGb: number;
  maxMemoryOptimizedDataGbPerDatabase: number;
}

export interface EnterpriseToStandardEvaluation {
  status: "not_applicable" | "eligible" | "blocked";
  eligible: boolean;
  targetEdition: "Standard";
  migrationRequired: true;
  acceptedMigrationPath?: EditionMigrationPath;
  confirmations?: EditionChangeConfirmations;
  terms: {
    featureCompatible: EditionEligibilityTerm;
    vendorSupported: EditionEligibilityTerm;
    standardScaleLimitsFit: EditionEligibilityTerm;
    rdsClassVersionOrderable: EditionEligibilityTerm;
    migrationPathAccepted: EditionEligibilityTerm;
  };
  limits?: StandardEditionScaleLimits;
  blockers: EditionEligibilityBlocker[];
  evidence: string[];
}

export interface FileLatencyEvidence {
  databaseName: string;
  fileType?: string;
  readLatencyMs?: number;
  writeLatencyMs?: number;
  totalLatencyMs?: number;
  advisory: string[];
}

export interface TempdbUsageEvidence {
  totalMb?: number;
  allocatedMb?: number;
  representativeAllocatedMb?: number;
  peakAllocatedMb?: number;
  userObjectMb?: number;
  internalObjectMb?: number;
  versionStoreMb?: number;
}

export interface WaitStatEvidence {
  waitType: string;
  waitTimeMs: number;
  signalWaitTimeMs?: number;
}

export interface WorkloadEvidence {
  memory?: MemoryEvidence;
  edition?: EditionWorkloadEvidence;
  topDatabasesByIops: string[];
  topDatabasesByThroughput: string[];
  tempdbIoSharePct?: number;
  fileLatency: FileLatencyEvidence[];
  tempdbUsage?: TempdbUsageEvidence;
  waitStats: WaitStatEvidence[];
}

export interface WorkloadProfile {
  collectionHours: number;
  evidenceWindow?: EvidenceWindowAssessment;
  cpuPct: MetricDistribution;
  cpuPressure?: CpuPressureEvidence;
  memoryPressurePct?: MetricDistribution;
  pageLifeExpectancySeconds?: MetricDistribution;
  iops: MetricDistribution;
  throughputMbps: MetricDistribution;
  totalDatabaseSizeGb?: number;
  databases: DatabaseAttribution[];
  evidence?: WorkloadEvidence;
  sampleSeries?: CanonicalWorkloadSampleSeries;
  physicalIo?: PhysicalIoEvidence;
}

export interface OptimizationBlocker {
  code: string;
  message: string;
  dimension: "cpu" | "memory" | "iops" | "throughput" | "tempdb" | "edition" | "orderability";
}

export interface LimitingResourceAssessment {
  dimension: OptimizationResourceDimension;
  scope: "compute" | "edition";
  status: "within_limit" | "risk" | "blocking" | "not_applicable";
  observed?: number;
  limit?: number;
  utilizationPct?: number;
  unit?: string;
  reason: string;
  topDatabaseName?: string;
  topDatabaseMetric?: string;
  topDatabaseValue?: number;
}

export interface CandidateEvaluationRecord {
  instanceClass: string;
  sqlServerVisibleVcpu: number;
  cpuConfigurationType: "default" | "optimize_cpu";
  cpuCoreCount?: number;
  cpuThreadsPerCore?: number;
  accepted: boolean;
  selected: boolean;
  decision: OptimizationDecision;
  passedGates: string[];
  failedGates: string[];
  limitingResources: LimitingResourceAssessment[];
  projectedSqlCpuP95Pct?: number;
  projectedSqlCpuP99Pct?: number;
  projectedTotalCpuP99Pct?: number;
  memoryRequiredFloorGb?: number;
  candidateMemoryGb?: number;
  iopsP95?: number;
  iopsP99?: number;
  throughputP95?: number;
  throughputP99?: number;
  tempdbPlacementTransition?: OptimizationTempdbPlacementTransition;
}

export interface OptimizationResult {
  currentConfig: CurrentRdsConfig;
  recommendedConfig?: CurrentRdsConfig;
  decision: OptimizationDecision;
  cpuState?: CpuState;
  optimizationEvidence?: {
    currentVcpu: number;
    optimizedVcpu?: number;
    cpuP95Pct: number;
    projectedCpuPct?: number;
    projectedSqlCpuP95Pct?: number;
    projectedSqlCpuP99Pct?: number;
    projectedTotalCpuP95Pct?: number;
    projectedTotalCpuP99Pct?: number;
    observedOtherCpuP95Pct?: number;
    observedOtherCpuP99Pct?: number;
    cpuP95TargetPct?: number;
    cpuP99SafetyLimitPct?: number;
    totalCpuP99HardLimitPct?: number;
    cpuExcursionSampleCount?: number;
    cpuExcursionSamplePct?: number;
    cpuLongestExcursionStreakSamples?: number;
    cpuProjectionConfidence?: "high" | "medium" | "low";
    cpuProjectionBasis?: "same_hardware" | "same_family" | "normalized_cross_family" | "unadjusted_cross_family";
    normalizedPerCoreCapacityFactor?: number;
    candidateCpuConfigurationType?: "default" | "optimize_cpu";
    candidateCpuCoreCount?: number;
    candidateCpuThreadsPerCore?: number;
    cpuHighThresholdPct?: number;
    cpuHighSamplePct?: number;
    cpuLongestHighStreakSamples?: number;
    cpuSustainedPressure?: boolean;
    currentMemoryGb?: number;
    candidateMemoryGb?: number;
    memoryReductionPct?: number;
    memoryRequiredFloorGb?: number;
    memoryHeadroomPct?: number;
    memoryPressureState?: "pressure_detected" | "no_direct_pressure_detected" | "insufficient_evidence";
    memoryEvidenceConfidence?: "high" | "medium" | "low";
    memoryWorkingSetValidationRequired?: boolean;
    memorySignalsUsed?: string[];
    memoryCouplingVerdict?: "not_required" | "stable_working_set" | "aggressive_medium_confidence";
    materialMemoryReduction?: boolean;
    memoryCouplingConfidence?: "high" | "medium" | "low";
    memoryCouplingReasons?: string[];
    memoryCouplingMissingMetrics?: string[];
    normalizedPageReadsTrend?: "declining" | "stable" | "rising" | "unavailable";
    readIopsPressureRelationship?: "not_rising" | "weak" | "meaningful" | "strong" | "unavailable";
    readIopsSpearmanCorrelation?: number;
    readIopsHighPressureMedian?: number;
    readIopsLowPressureMedian?: number;
    readIopsIncreasePct?: number;
    readIopsPersistenceSamplePct?: number;
    readIopsPressurePeriodCount?: number;
    readIopsPersistenceMet?: boolean;
    readIopsWorkloadNormalized?: boolean;
    memoryPressureLowBandMaxPct?: number;
    memoryPressureHighBandMinPct?: number;
    lazyWritesP95PerSec?: number;
    bufferCacheHitRatioP05Pct?: number;
    iopsP95?: number;
    iopsP99?: number;
    iopsMax?: number;
    readIopsP95?: number;
    readIopsP99?: number;
    writeIopsP95?: number;
    writeIopsP99?: number;
    candidateBaselineIops?: number;
    candidateMaximumIops?: number;
    iopsBurstEvidence?: IoBurstEvidence;
    iopsBurstReliance?: boolean;
    throughputP95?: number;
    throughputP99?: number;
    throughputMax?: number;
    readThroughputP95MibPerSec?: number;
    readThroughputP99MibPerSec?: number;
    writeThroughputP95MibPerSec?: number;
    writeThroughputP99MibPerSec?: number;
    candidateBaselineThroughputMbps?: number;
    candidateMaximumThroughputMbps?: number;
    throughputBurstEvidence?: IoBurstEvidence;
    throughputBurstReliance?: boolean;
    currentTempdbPlacement?: "normal_storage" | "local_nvme" | "unknown";
    candidateTempdbPlacement?: "normal_storage" | "local_nvme" | "unknown";
    tempdbPlacementTransition?: OptimizationTempdbPlacementTransition;
    currentNormalPathIopsP95?: number;
    currentNormalPathIopsP99?: number;
    candidateNormalPathIopsP95?: number;
    candidateNormalPathIopsP99?: number;
    tempdbIopsP95?: number;
    tempdbIopsP99?: number;
    currentNormalPathThroughputP95?: number;
    currentNormalPathThroughputP99?: number;
    candidateNormalPathThroughputP95?: number;
    candidateNormalPathThroughputP99?: number;
    tempdbThroughputP95?: number;
    tempdbThroughputP99?: number;
    candidateLocalStorageCapacityGb?: number;
    tempdbRepresentativeAllocatedGb?: number;
    tempdbPeakAllocatedGb?: number;
    tempdbCapacityResult?: "fits" | "exceeded" | "not_applicable" | "unavailable";
    tempdbLocalIoRiskSignal?: boolean;
    requiredMemoryGb: number;
    requiredIops: number;
    requiredThroughputMbps: number;
  };
  risk: "low" | "medium" | "high" | "blocked";
  confidence?: "preliminary" | "medium" | "high";
  evidenceWindow?: EvidenceWindowAssessment;
  blockers: OptimizationBlocker[];
  topOffendingDatabases: DatabaseAttribution[];
  evidence?: WorkloadEvidence;
  enterpriseToStandard?: EnterpriseToStandardEvaluation;
  limitingResources: LimitingResourceAssessment[];
  candidateEvaluations: CandidateEvaluationRecord[];
  passedChecks: string[];
}
export interface ServerWorkloadInput {
  serverName: string;
  currentConfig: CurrentRdsConfig;
  workload: WorkloadProfile;
}

export interface OptimizationBatchInput {
  servers: ServerWorkloadInput[];
}

export interface OptimizationBatchResult {
  results: OptimizationResult[];
}
