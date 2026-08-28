export type SqlServerEdition = "Enterprise" | "Standard" | "Web" | "Express" | "Developer";
export type LicenseModel = "license-included" | "byom";
export type StorageType = "gp2" | "gp3" | "io1" | "io2";

export interface CurrentRdsConfig {
  region: string;
  instanceClass: string;
  sqlServerEdition: SqlServerEdition;
  sqlServerVersion: string;
  licenseModel: LicenseModel;
  storageType: StorageType;
  allocatedStorageGb: number;
  provisionedIops?: number;
  provisionedThroughputMbps?: number;
  multiAz: boolean;
}

export interface MetricDistribution {
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface DatabaseAttribution {
  databaseName: string;
  iops?: MetricDistribution;
  throughputMbps?: MetricDistribution;
  sizeGb?: number;
  tempdbSharePct?: number;
  advisoryCpuSharePct?: number;
  advisoryMemorySharePct?: number;
}

export interface WorkloadProfile {
  collectionHours: number;
  cpuPct: MetricDistribution;
  memoryPressurePct?: MetricDistribution;
  pageLifeExpectancySeconds?: MetricDistribution;
  iops: MetricDistribution;
  throughputMbps: MetricDistribution;
  totalDatabaseSizeGb?: number;
  databases: DatabaseAttribution[];
}

export interface OptimizationBlocker {
  code: string;
  message: string;
  dimension: "cpu" | "memory" | "iops" | "throughput" | "edition" | "orderability" | "storage" | "pricing";
}

export interface OptimizationResult {
  currentConfig: CurrentRdsConfig;
  recommendedConfig?: CurrentRdsConfig;
  currentMonthlyCostUsd?: number;
  optimizedMonthlyCostUsd?: number;
  monthlySavingsUsd?: number;
  annualSavingsUsd?: number;
  savingsPct?: number;
  risk: "low" | "medium" | "high" | "blocked";
  blockers: OptimizationBlocker[];
  topOffendingDatabases: DatabaseAttribution[];
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