import type { CurrentRdsConfig, SqlServerEdition } from "../contracts/types.js";
export {
  DEFAULT_FAMILY_PREFERENCE_RANK,
  familyPreferenceFieldsForFamily,
  familyPreferenceForEntry,
  familyPreferenceForFamily,
  familyPreferenceRankForEntry,
  familyPreferenceRoleForEntry,
  loadCandidateFamilyPreferenceConfig,
  type CandidateFamilyPreference,
  type CandidateFamilyPreferenceConfig,
  type CandidateFamilyPreferenceFields,
  type CandidateFamilyPreferenceRole
} from "./family-preferences.js";
import { familyPreferenceFieldsForFamily, type CandidateFamilyPreferenceFields } from "./family-preferences.js";

export type RdsSqlServerEngine = "sqlserver-ee" | "sqlserver-se" | "sqlserver-web" | "sqlserver-ex";

export interface ProcessorFeature {
  name: string;
  defaultValue: string;
  allowedValues: string[];
}

export interface OptimizeCpuConfiguration {
  coreCount: number;
  threadsPerCore: number;
  sqlServerVisibleVcpu: number;
  isDefault: boolean;
}

export interface LocalInstanceStorageCapability {
  supported: boolean;
  capacityGb?: number;
  tempdbOnLocalStorage: boolean;
}

export interface InstanceCatalogEntry extends CandidateFamilyPreferenceFields {
  instanceClass: string;
  region?: string;
  family: string;
  size: string;
  /**
   * Compatibility alias used by the existing optimizer. For an enriched SQL
   * Server entry this is the SQL Server-visible default vCPU count.
   */
  vcpu: number;
  hardwareVcpu?: number;
  sqlServerDefaultVcpu?: number;
  sqlServerDefaultVcpuSource?: "aws-processor-features" | "consolidated-vcpu";
  defaultCpuCores?: number;
  defaultThreadsPerCore?: number;
  cpuSocketCount?: number;
  optimizeCpuConfigurations?: OptimizeCpuConfiguration[];
  availableProcessorFeatures?: ProcessorFeature[];
  memoryGb: number;
  baselineIops?: number;
  maxIops: number;
  maximumIopsBurstDurationMinutes?: number;
  maximumIopsBurstEventsPer24Hours?: number;
  baselineThroughputMbps?: number;
  maxThroughputMbps: number;
  maximumThroughputBurstDurationMinutes?: number;
  maximumThroughputBurstEventsPer24Hours?: number;
  supportedEditions: SqlServerEdition[];
  minSqlMajorVersion: number;
  maxSqlMajorVersion?: number | null;
  engine?: RdsSqlServerEngine;
  engineVersion?: string;
  sqlServerEdition?: SqlServerEdition;
  licenseModel?: string;
  multiAzCapable?: boolean;
  supportedStorageTypes?: string[];
  localInstanceStorage?: LocalInstanceStorageCapability;
  normalizedPerCoreCapacity?: number;
  orderable?: boolean;
  catalogRefreshedAt?: string;
}

export interface ConsolidatedInstanceCatalogRow {
  instanceType?: string;
  vcpu?: number;
  memory?: number;
  instanceFamily?: string;
  sqlServerEdition?: string;
  region?: string;
  engineCode?: string;
  multiAZ?: boolean;
  baselineIops?: number;
  maximumIops?: number;
  baselineThroughputMBps?: number;
  baselineThroughputMbps?: number;
  maximumThroughputMBps?: number;
  maximumThroughputMbps?: number;
}

export interface RdsOrderableProcessorFeature {
  Name?: string;
  DefaultValue?: string;
  AllowedValues?: string;
}

export interface RdsOrderableDbInstanceOption {
  Engine?: string;
  EngineVersion?: string;
  DBInstanceClass?: string;
  LicenseModel?: string;
  MultiAZCapable?: boolean;
  StorageType?: string;
  AvailableProcessorFeatures?: RdsOrderableProcessorFeature[];
}

export interface LocalInstanceStorageSource {
  instances?: Record<string, { capacityGb?: number }>;
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

export const SQL_SERVER_ENGINES: readonly RdsSqlServerEngine[] = [
  "sqlserver-ee",
  "sqlserver-se",
  "sqlserver-web",
  "sqlserver-ex"
];

export function isOrderableCandidate(
  catalog: InstanceCatalogEntry[],
  currentConfig: Pick<CurrentRdsConfig, "region" | "sqlServerEdition" | "sqlServerVersion"> & Partial<Pick<CurrentRdsConfig, "multiAz">>,
  candidateInstanceClass: string,
  requirements: CandidateRequirements,
  processorConfiguration?: Pick<OptimizeCpuConfiguration, "coreCount" | "threadsPerCore" | "sqlServerVisibleVcpu">
): CandidateValidationResult {
  const classEntries = catalog.filter((item) => item.instanceClass === candidateInstanceClass);
  const failures: string[] = [];

  if (classEntries.length === 0) {
    return {
      valid: false,
      failures: [`INSTANCE_NOT_IN_CATALOG: ${candidateInstanceClass}`]
    };
  }

  const exactEntries = classEntries.filter(hasExactCandidateOrderabilityMetadata);
  if (exactEntries.length === 0) {
    return {
      valid: false,
      failures: [`EXACT_ORDERABILITY_METADATA_REQUIRED: ${candidateInstanceClass} lacks an exact AWS SQL Server orderability row`]
    };
  }

  let matchingEntries = exactEntries.filter((entry) => entry.region === currentConfig.region);
  if (matchingEntries.length === 0) {
    return {
      valid: false,
      failures: [`REGION_NOT_ORDERABLE: ${candidateInstanceClass} in ${currentConfig.region}`]
    };
  }

  const editionEntries = matchingEntries.filter((entry) =>
    entry.sqlServerEdition === currentConfig.sqlServerEdition
  );
  if (editionEntries.length === 0) {
    failures.push(`EDITION_NOT_SUPPORTED: ${currentConfig.sqlServerEdition}`);
  } else {
    matchingEntries = editionEntries;
  }

  const exactVersionEntries = matchingEntries.filter((entry) =>
    sqlProductVersionMatches(currentConfig.sqlServerVersion, entry.engineVersion!)
  );
  if (exactVersionEntries.length === 0) {
    return {
      valid: false,
      failures: [`SQL_VERSION_NOT_ORDERABLE: ${currentConfig.sqlServerVersion}`]
    };
  }
  matchingEntries = exactVersionEntries;

  const entry = matchingEntries[0];
  if (!hasVerifiedSqlServerVcpuMetadata(entry)) {
    failures.push(
      `SQL_VISIBLE_VCPU_METADATA_UNVERIFIED: ${candidateInstanceClass} lacks AWS SQL Server processor metadata`
    );
  }
  if (processorConfiguration && !isOrderableProcessorConfiguration(entry, processorConfiguration)) {
    failures.push(
      `PROCESSOR_CONFIGURATION_NOT_ORDERABLE: ${processorConfiguration.coreCount} cores x ${processorConfiguration.threadsPerCore} threads`
    );
  }
  const candidateVisibleVcpu = processorConfiguration?.sqlServerVisibleVcpu ?? entry.vcpu;
  const candidateCoreCount = processorConfiguration?.coreCount ?? entry.defaultCpuCores;
  const sqlMajorVersion = parseSqlMajorVersion(currentConfig.sqlServerVersion);
  if (!editionComputeLimitAllows(
    currentConfig.sqlServerEdition,
    sqlMajorVersion,
    candidateVisibleVcpu,
    candidateCoreCount
  )) {
    failures.push(
      currentConfig.sqlServerEdition === "Standard"
        ? `EDITION_CORE_LIMIT_EXCEEDED: Standard ${candidateCoreCount} cores`
        : `EDITION_VCPU_LIMIT_EXCEEDED: ${currentConfig.sqlServerEdition} ${candidateVisibleVcpu} vCPU`
    );
  }

  if (currentConfig.multiAz === true && entry.multiAzCapable === false) {
    failures.push(`MULTI_AZ_NOT_SUPPORTED: ${candidateInstanceClass}`);
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

export function candidateAvailabilityFailures(
  catalog: readonly InstanceCatalogEntry[],
  currentConfig: Pick<CurrentRdsConfig, "region" | "sqlServerEdition" | "sqlServerVersion">,
  currentVcpu: number
): string[] {
  const exactEntries = catalog.filter(hasExactCandidateOrderabilityMetadata);
  if (exactEntries.length === 0) {
    return ["EXACT_ORDERABILITY_METADATA_REQUIRED: catalog has no exact AWS SQL Server orderability rows"];
  }

  const lowerVcpuEntries = exactEntries.filter((entry) =>
    entry.vcpu > 0
    && entry.vcpu < currentVcpu
    && hasVerifiedSqlServerVcpuMetadata(entry)
  );
  if (lowerVcpuEntries.length === 0) {
    return [`NO_LOWER_ORDERABLE_CANDIDATE: no catalog entry has fewer than ${currentVcpu} SQL Server-visible vCPU`];
  }

  const regionalEntries = lowerVcpuEntries.filter((entry) => entry.region === currentConfig.region);
  if (regionalEntries.length === 0) {
    return [`REGION_NOT_ORDERABLE: no lower-vCPU SQL Server candidate is orderable in ${currentConfig.region}`];
  }

  const editionEntries = regionalEntries.filter((entry) =>
    entry.sqlServerEdition === currentConfig.sqlServerEdition
  );
  if (editionEntries.length === 0) {
    return [`EDITION_NOT_SUPPORTED: no lower-vCPU SQL Server candidate supports ${currentConfig.sqlServerEdition}`];
  }

  const versionEntries = editionEntries.filter((entry) =>
    sqlProductVersionMatches(currentConfig.sqlServerVersion, entry.engineVersion!)
  );
  if (versionEntries.length === 0) {
    return [`SQL_VERSION_NOT_ORDERABLE: no lower-vCPU SQL Server candidate supports ${currentConfig.sqlServerVersion}`];
  }

  return [];
}

export function findCheapestValidByCatalogOrder(
  catalog: InstanceCatalogEntry[],
  currentConfig: Pick<CurrentRdsConfig, "region" | "sqlServerEdition" | "sqlServerVersion"> & Partial<Pick<CurrentRdsConfig, "multiAz">>,
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

export function sqlProductVersionMatches(productVersion: string, rdsEngineVersion: string): boolean {
  const product = normalizedVersionParts(productVersion);
  const engine = normalizedVersionParts(rdsEngineVersion);
  return product.length >= 3
    && engine.length >= product.length
    && product.every((part, index) => engine[index] === part);
}

export function catalogForRegion(catalog: readonly InstanceCatalogEntry[], region: string): InstanceCatalogEntry[] {
  if (!catalog.some((entry) => entry.region)) return [...catalog];
  return catalog.filter((entry) => entry.region === region);
}

export function catalogForSqlServerConfiguration(
  catalog: readonly InstanceCatalogEntry[],
  currentConfig: Pick<CurrentRdsConfig, "region" | "sqlServerEdition" | "sqlServerVersion">
): InstanceCatalogEntry[] {
  return catalogForRegion(catalog, currentConfig.region).filter((entry) => {
    return hasExactCandidateOrderabilityMetadata(entry)
      && entry.sqlServerEdition === currentConfig.sqlServerEdition
      && sqlProductVersionMatches(currentConfig.sqlServerVersion, entry.engineVersion!);
  });
}

export function isOrderableProcessorConfiguration(
  entry: InstanceCatalogEntry,
  configuration: Pick<OptimizeCpuConfiguration, "coreCount" | "threadsPerCore">
): boolean {
  return (entry.optimizeCpuConfigurations ?? []).some((candidate) =>
    candidate.coreCount === configuration.coreCount
    && candidate.threadsPerCore === configuration.threadsPerCore
  );
}

export function instanceCatalogFromOrderableOptions(
  options: readonly RdsOrderableDbInstanceOption[],
  hardwareRows: readonly ConsolidatedInstanceCatalogRow[],
  region: string,
  refreshedAt: string,
  localStorageSource: LocalInstanceStorageSource = {}
): InstanceCatalogEntry[] {
  const hardware = hardwareByClass(hardwareRows, region);
  const grouped = new Map<string, {
    engine: RdsSqlServerEngine;
    engineVersion: string;
    instanceClass: string;
    licenseModel: string;
    multiAzCapable: boolean;
    storageTypes: Set<string>;
    processorFeatures: RdsOrderableProcessorFeature[];
  }>();

  for (const option of options) {
    const engine = normalizeEngine(option.Engine);
    const engineVersion = option.EngineVersion?.trim();
    const instanceClass = option.DBInstanceClass?.trim();
    if (!engine || !engineVersion || !instanceClass) continue;
    const key = [region, engine, engineVersion, instanceClass, option.LicenseModel ?? ""].join("|");
    const existing = grouped.get(key) ?? {
      engine,
      engineVersion,
      instanceClass,
      licenseModel: option.LicenseModel ?? "unknown",
      multiAzCapable: false,
      storageTypes: new Set<string>(),
      processorFeatures: []
    };
    existing.multiAzCapable ||= option.MultiAZCapable === true;
    if (option.StorageType) existing.storageTypes.add(option.StorageType);
    if ((option.AvailableProcessorFeatures?.length ?? 0) > existing.processorFeatures.length) {
      existing.processorFeatures = option.AvailableProcessorFeatures ?? [];
    }
    grouped.set(key, existing);
  }

  const entries: InstanceCatalogEntry[] = [];
  for (const orderable of grouped.values()) {
    const hardwareEntry = hardware.get(orderable.instanceClass);
    if (!hardwareEntry?.vcpu || !hardwareEntry.memory) continue;
    const processor = processorMetadata(orderable.processorFeatures, hardwareEntry.vcpu);
    if (processor.source !== "aws-processor-features") continue;
    const edition = editionFromEngine(orderable.engine);
    const parsedClass = parseInstanceClass(orderable.instanceClass);
    const localCapacity = localStorageSource.instances?.[orderable.instanceClass]?.capacityGb;

    entries.push({
      instanceClass: orderable.instanceClass,
      region,
      family: parsedClass.family,
      size: parsedClass.size,
      vcpu: processor.sqlServerDefaultVcpu,
      hardwareVcpu: hardwareEntry.vcpu,
      sqlServerDefaultVcpu: processor.sqlServerDefaultVcpu,
      sqlServerDefaultVcpuSource: processor.source,
      defaultCpuCores: processor.defaultCpuCores,
      defaultThreadsPerCore: processor.defaultThreadsPerCore,
      optimizeCpuConfigurations: processor.configurations,
      availableProcessorFeatures: processor.features,
      memoryGb: hardwareEntry.memory,
      baselineIops: hardwareEntry.baselineIops,
      maxIops: hardwareEntry.maximumIops ?? 0,
      baselineThroughputMbps: hardwareEntry.baselineThroughputMBps ?? hardwareEntry.baselineThroughputMbps,
      maxThroughputMbps: hardwareEntry.maximumThroughputMBps ?? hardwareEntry.maximumThroughputMbps ?? 0,
      supportedEditions: [edition],
      minSqlMajorVersion: parseSqlMajorVersion(orderable.engineVersion),
      maxSqlMajorVersion: parseSqlMajorVersion(orderable.engineVersion),
      engine: orderable.engine,
      engineVersion: orderable.engineVersion,
      sqlServerEdition: edition,
      licenseModel: orderable.licenseModel,
      multiAzCapable: orderable.multiAzCapable,
      supportedStorageTypes: [...orderable.storageTypes].sort(),
      localInstanceStorage: {
        supported: localCapacity !== undefined,
        capacityGb: localCapacity,
        tempdbOnLocalStorage: localCapacity !== undefined
      },
      ...familyPreferenceFieldsForFamily(parsedClass.family),
      orderable: true,
      catalogRefreshedAt: refreshedAt
    });
  }

  return entries.sort((left, right) =>
    left.region!.localeCompare(right.region!)
    || left.sqlServerEdition!.localeCompare(right.sqlServerEdition!)
    || left.engineVersion!.localeCompare(right.engineVersion!, undefined, { numeric: true })
    || left.instanceClass.localeCompare(right.instanceClass, undefined, { numeric: true })
  );
}

export function instanceCatalogFromConsolidatedRows(rows: readonly ConsolidatedInstanceCatalogRow[]): InstanceCatalogEntry[] {
  const grouped = new Map<string, InstanceCatalogEntry>();

  for (const row of rows) {
    if (!row.instanceType || !row.region || !row.vcpu || !row.memory) continue;
    const key = `${row.region}|${row.instanceType}`;
    const existing = grouped.get(key);
    const edition = normalizeEdition(row.sqlServerEdition);
    const sqlMajor = Math.max(14, Number(row.engineCode) || 14);
    const parsed = parseInstanceClass(row.instanceType);

    if (!existing) {
      grouped.set(key, {
        instanceClass: row.instanceType,
        region: row.region,
        family: parsed.family,
        size: parsed.size,
        vcpu: row.vcpu,
        hardwareVcpu: row.vcpu,
        sqlServerDefaultVcpu: row.vcpu,
        sqlServerDefaultVcpuSource: "consolidated-vcpu",
        memoryGb: row.memory,
        baselineIops: row.baselineIops,
        maxIops: row.maximumIops ?? 0,
        baselineThroughputMbps: row.baselineThroughputMBps ?? row.baselineThroughputMbps,
        maxThroughputMbps: row.maximumThroughputMBps ?? row.maximumThroughputMbps ?? 0,
        supportedEditions: edition ? [edition] : [],
        minSqlMajorVersion: sqlMajor,
        maxSqlMajorVersion: null,
        multiAzCapable: row.multiAZ,
        ...familyPreferenceFieldsForFamily(parsed.family)
      });
      continue;
    }

    existing.baselineIops = Math.max(existing.baselineIops ?? 0, row.baselineIops ?? 0);
    existing.maxIops = Math.max(existing.maxIops, row.maximumIops ?? 0);
    existing.baselineThroughputMbps = Math.max(
      existing.baselineThroughputMbps ?? 0,
      row.baselineThroughputMBps ?? row.baselineThroughputMbps ?? 0
    );
    existing.maxThroughputMbps = Math.max(existing.maxThroughputMbps, row.maximumThroughputMBps ?? row.maximumThroughputMbps ?? 0);
    existing.minSqlMajorVersion = Math.min(existing.minSqlMajorVersion, sqlMajor);
    existing.multiAzCapable ||= row.multiAZ === true;
    if (edition && !existing.supportedEditions.includes(edition)) {
      existing.supportedEditions.push(edition);
    }
  }

  return [...grouped.values()].map((entry) => ({
    ...entry,
    supportedEditions: entry.supportedEditions.length > 0 ? entry.supportedEditions : ["Enterprise", "Standard", "Web"]
  }));
}

function hardwareByClass(
  rows: readonly ConsolidatedInstanceCatalogRow[],
  region: string
): Map<string, ConsolidatedInstanceCatalogRow> {
  const grouped = new Map<string, ConsolidatedInstanceCatalogRow>();
  for (const row of rows) {
    if (row.region !== region || !row.instanceType || !row.vcpu || !row.memory) continue;
    const existing = grouped.get(row.instanceType);
    if (!existing) {
      grouped.set(row.instanceType, { ...row });
      continue;
    }
    existing.baselineIops = Math.max(existing.baselineIops ?? 0, row.baselineIops ?? 0);
    existing.maximumIops = Math.max(existing.maximumIops ?? 0, row.maximumIops ?? 0);
    existing.baselineThroughputMBps = Math.max(
      existing.baselineThroughputMBps ?? existing.baselineThroughputMbps ?? 0,
      row.baselineThroughputMBps ?? row.baselineThroughputMbps ?? 0
    );
    existing.maximumThroughputMBps = Math.max(
      existing.maximumThroughputMBps ?? existing.maximumThroughputMbps ?? 0,
      row.maximumThroughputMBps ?? row.maximumThroughputMbps ?? 0
    );
    existing.multiAZ ||= row.multiAZ === true;
  }
  return grouped;
}

function processorMetadata(features: readonly RdsOrderableProcessorFeature[], hardwareVcpu: number): {
  sqlServerDefaultVcpu: number;
  source: "aws-processor-features" | "consolidated-vcpu";
  defaultCpuCores?: number;
  defaultThreadsPerCore?: number;
  configurations: OptimizeCpuConfiguration[];
  features: ProcessorFeature[];
} {
  const normalizedFeatures = features.map((feature) => ({
    name: feature.Name ?? "",
    defaultValue: feature.DefaultValue ?? "",
    allowedValues: parseAllowedValues(feature.AllowedValues)
  })).filter((feature) => feature.name);
  const coreFeature = normalizedFeatures.find((feature) => feature.name.toLowerCase() === "corecount");
  const threadFeature = normalizedFeatures.find((feature) => feature.name.toLowerCase() === "threadspercore");
  const defaultCpuCores = positiveInteger(coreFeature?.defaultValue);
  const defaultThreadsPerCore = positiveInteger(threadFeature?.defaultValue);

  if (!defaultCpuCores || !defaultThreadsPerCore) {
    return {
      sqlServerDefaultVcpu: hardwareVcpu,
      source: "consolidated-vcpu",
      configurations: [],
      features: normalizedFeatures
    };
  }

  const configurations: OptimizeCpuConfiguration[] = [];
  for (const coreCount of positiveIntegers(coreFeature?.allowedValues ?? [])) {
    for (const threadsPerCore of positiveIntegers(threadFeature?.allowedValues ?? [])) {
      configurations.push({
        coreCount,
        threadsPerCore,
        sqlServerVisibleVcpu: coreCount * threadsPerCore,
        isDefault: coreCount === defaultCpuCores && threadsPerCore === defaultThreadsPerCore
      });
    }
  }

  return {
    sqlServerDefaultVcpu: defaultCpuCores * defaultThreadsPerCore,
    source: "aws-processor-features",
    defaultCpuCores,
    defaultThreadsPerCore,
    configurations,
    features: normalizedFeatures
  };
}

export function hasVerifiedSqlServerVcpuMetadata(entry: InstanceCatalogEntry): boolean {
  return entry.sqlServerDefaultVcpuSource === "aws-processor-features";
}

export function hasExactCandidateOrderabilityMetadata(entry: InstanceCatalogEntry): boolean {
  return Boolean(
    entry.region
    && entry.engine
    && entry.engineVersion
    && entry.sqlServerEdition
    && entry.orderable === true
    && hasVerifiedSqlServerVcpuMetadata(entry)
  );
}

function normalizedVersionParts(value: string): number[] {
  return (value.match(/\d+/g) ?? []).slice(0, 4).map(Number);
}

function parseAllowedValues(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function positiveIntegers(values: readonly string[]): number[] {
  return values.map(positiveInteger).filter((value): value is number => value !== undefined);
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeEngine(value: string | undefined): RdsSqlServerEngine | undefined {
  return SQL_SERVER_ENGINES.find((engine) => engine === value);
}

function editionFromEngine(engine: RdsSqlServerEngine): SqlServerEdition {
  if (engine === "sqlserver-ee") return "Enterprise";
  if (engine === "sqlserver-se") return "Standard";
  if (engine === "sqlserver-web") return "Web";
  return "Express";
}

function normalizeEdition(value: string | undefined): SqlServerEdition | undefined {
  const normalized = (value ?? "").toLowerCase();
  if (normalized.includes("enterprise")) return "Enterprise";
  if (normalized.includes("standard")) return "Standard";
  if (normalized.includes("web")) return "Web";
  if (normalized.includes("express")) return "Express";
  if (normalized.includes("developer")) return "Developer";
  return undefined;
}

function parseInstanceClass(instanceClass: string): { family: string; size: string } {
  const match = instanceClass.match(/^db\.([^.]+)\.(.+)$/i);
  return {
    family: match?.[1] ?? "unknown",
    size: match?.[2] ?? "unknown"
  };
}

function editionComputeLimitAllows(
  edition: SqlServerEdition,
  sqlMajorVersion: number,
  vcpu: number,
  coreCount: number | undefined
): boolean {
  if (edition === "Standard") {
    if (coreCount === undefined) return true;
    return coreCount <= (sqlMajorVersion >= 17 ? 32 : 24);
  }
  if (edition === "Web") return vcpu <= 32;
  if (edition === "Express") return vcpu <= 4;
  return true;
}
