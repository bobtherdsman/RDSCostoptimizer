import type { CurrentRdsConfig, SqlServerEdition } from "../contracts/types.js";

export interface InstanceCatalogEntry {
  instanceClass: string;
  family: string;
  size: string;
  vcpu: number;
  memoryGb: number;
  maxIops: number;
  maxThroughputMbps: number;
  supportedEditions: SqlServerEdition[];
  minSqlMajorVersion: number;
  maxSqlMajorVersion?: number | null;
}

export interface CandidateRequirements {
  memoryGb: number;
  iops: number;
  throughputMbps: number;
}

export interface CandidateValidationResult {
  valid: boolean;
  failures: string[];
  entry?: InstanceCatalogEntry;
}

export function isOrderableCandidate(
  catalog: InstanceCatalogEntry[],
  currentConfig: Pick<CurrentRdsConfig, "sqlServerEdition" | "sqlServerVersion">,
  candidateInstanceClass: string,
  requirements: CandidateRequirements
): CandidateValidationResult {
  const entry = catalog.find((item) => item.instanceClass === candidateInstanceClass);
  const failures: string[] = [];

  if (!entry) {
    return {
      valid: false,
      failures: [`INSTANCE_NOT_IN_CATALOG: ${candidateInstanceClass}`]
    };
  }

  if (!entry.supportedEditions.includes(currentConfig.sqlServerEdition)) {
    failures.push(`EDITION_NOT_SUPPORTED: ${currentConfig.sqlServerEdition}`);
  }

  const sqlMajorVersion = parseSqlMajorVersion(currentConfig.sqlServerVersion);
  if (sqlMajorVersion < entry.minSqlMajorVersion) {
    failures.push(`SQL_VERSION_BELOW_MIN: ${sqlMajorVersion} < ${entry.minSqlMajorVersion}`);
  }

  if (entry.maxSqlMajorVersion && sqlMajorVersion > entry.maxSqlMajorVersion) {
    failures.push(`SQL_VERSION_ABOVE_MAX: ${sqlMajorVersion} > ${entry.maxSqlMajorVersion}`);
  }

  if (!editionVcpuLimitAllows(currentConfig.sqlServerEdition, entry.vcpu)) {
    failures.push(`EDITION_VCPU_LIMIT_EXCEEDED: ${currentConfig.sqlServerEdition} ${entry.vcpu} vCPU`);
  }

  if (entry.memoryGb < requirements.memoryGb) {
    failures.push(`MEMORY_UNDERFIT: ${entry.memoryGb} < ${requirements.memoryGb}`);
  }

  if (entry.maxIops < requirements.iops) {
    failures.push(`IOPS_UNDERFIT: ${entry.maxIops} < ${requirements.iops}`);
  }

  if (entry.maxThroughputMbps < requirements.throughputMbps) {
    failures.push(`THROUGHPUT_UNDERFIT: ${entry.maxThroughputMbps} < ${requirements.throughputMbps}`);
  }

  return {
    valid: failures.length === 0,
    failures,
    entry
  };
}

export function findCheapestValidByCatalogOrder(
  catalog: InstanceCatalogEntry[],
  currentConfig: Pick<CurrentRdsConfig, "sqlServerEdition" | "sqlServerVersion">,
  candidateInstanceClasses: string[],
  requirements: CandidateRequirements
): CandidateValidationResult {
  const checked = candidateInstanceClasses.map((instanceClass) =>
    isOrderableCandidate(catalog, currentConfig, instanceClass, requirements)
  );
  const valid = checked.find((result) => result.valid);
  if (valid) return valid;

  return {
    valid: false,
    failures: checked.flatMap((result) => result.failures)
  };
}

export function parseSqlMajorVersion(version: string): number {
  const match = version.match(/^(\d+)/);
  if (!match) return 0;
  return Number(match[1]);
}

function editionVcpuLimitAllows(edition: SqlServerEdition, vcpu: number): boolean {
  if (edition === "Standard") return vcpu <= 48;
  if (edition === "Web") return vcpu <= 32;
  if (edition === "Express") return vcpu <= 4;
  return true;
}