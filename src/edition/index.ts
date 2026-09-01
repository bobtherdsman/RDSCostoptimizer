import {
  isOrderableCandidate,
  parseSqlMajorVersion,
  type CandidateRequirements,
  type InstanceCatalogEntry
} from "../catalog/index.js";
import type {
  CurrentRdsConfig,
  EditionChangeConfirmations,
  EditionEligibilityBlocker,
  EditionEligibilityTerm,
  EnterpriseToStandardEvaluation,
  StandardEditionScaleLimits,
  WorkloadProfile
} from "../contracts/types.js";

export interface EnterpriseToStandardInput {
  currentConfig: CurrentRdsConfig;
  candidateConfig: CurrentRdsConfig;
  workload: WorkloadProfile;
  catalog: InstanceCatalogEntry[];
  confirmations?: EditionChangeConfirmations;
  requirements: CandidateRequirements;
}

const STANDARD_LIMITS: Record<number, StandardEditionScaleLimits> = {
  13: standardLimits(13, 24, 128, 32, 32),
  14: standardLimits(14, 24, 128, 32, 32),
  15: standardLimits(15, 24, 128, 32, 32),
  16: standardLimits(16, 24, 128, 32, 32),
  17: standardLimits(17, 32, 256, 64, 32)
};

const STANDARD_SUPPORTED_PERSISTED_FEATURES = new Set([
  "changecapture",
  "columnstoreindex",
  "compression",
  "inmemoryoltp",
  "multiplefscontainers",
  "partitioning"
]);

export function evaluateEnterpriseToStandard(
  input: EnterpriseToStandardInput
): EnterpriseToStandardEvaluation {
  if (input.currentConfig.sqlServerEdition !== "Enterprise") {
    const term = passedTerm();
    return {
      status: "not_applicable",
      eligible: false,
      targetEdition: "Standard",
      migrationRequired: true,
      terms: {
        featureCompatible: term,
        vendorSupported: term,
        standardScaleLimitsFit: term,
        rdsClassVersionOrderable: term,
        migrationPathAccepted: term
      },
      blockers: [],
      evidence: ["Enterprise-to-Standard evaluation is not applicable because the current edition is not Enterprise."]
    };
  }

  const sqlMajorVersion = parseSqlMajorVersion(input.currentConfig.sqlServerVersion);
  const limits = STANDARD_LIMITS[sqlMajorVersion];
  const featureCompatible = evaluateFeatureCompatibility(input.workload, sqlMajorVersion);
  const vendorSupported = evaluateVendorSupport(input.confirmations);
  const standardScaleLimitsFit = evaluateStandardScaleLimits(input, limits);
  const rdsClassVersionOrderable = evaluateStandardOrderability(input);
  const migrationPathAccepted = evaluateMigrationPath(input.confirmations);
  const terms = {
    featureCompatible,
    vendorSupported,
    standardScaleLimitsFit,
    rdsClassVersionOrderable,
    migrationPathAccepted
  };
  const blockers = Object.values(terms).flatMap((term) => term.blockers);
  const eligible = Object.values(terms).every((term) => term.passed);

  return {
    status: eligible ? "eligible" : "blocked",
    eligible,
    targetEdition: "Standard",
    migrationRequired: true,
    acceptedMigrationPath: migrationPathAccepted.passed
      ? input.confirmations?.migrationPath
      : undefined,
    confirmations: input.confirmations,
    terms,
    limits,
    blockers,
    evidence: editionEvidence(input, limits, featureCompatible)
  };
}

export function standardEditionLimitsForVersion(
  sqlServerVersion: string
): StandardEditionScaleLimits | undefined {
  return STANDARD_LIMITS[parseSqlMajorVersion(sqlServerVersion)];
}

function evaluateFeatureCompatibility(
  workload: WorkloadProfile,
  sqlMajorVersion: number
): EditionEligibilityTerm {
  const evidence = workload.evidence?.edition;
  const blockers: EditionEligibilityBlocker[] = [];

  if (!evidence || evidence.databases.length === 0) {
    blockers.push(blocker(
      "EDITION_FEATURE_AUDIT_REQUIRED",
      "feature",
      "Collector output does not contain the per-database Standard Edition feature audit."
    ));
    return failedTerm(blockers);
  }

  for (const database of evidence.databases) {
    if (database.auditStatus !== "complete") {
      blockers.push(blocker(
        "EDITION_FEATURE_AUDIT_FAILED",
        "feature",
        `Feature compatibility could not be verified for ${database.databaseName}.`,
        database.databaseName
      ));
      continue;
    }

    for (const feature of database.enterpriseFeatures) {
      if (!persistedFeatureSupportedByStandard(feature, sqlMajorVersion)) {
        blockers.push(blocker(
          "ENTERPRISE_FEATURE_NOT_SUPPORTED_BY_STANDARD",
          "feature",
          `${database.databaseName} uses persisted feature ${feature}, which is not verified for Standard Edition on SQL Server ${sqlMajorVersion}.`,
          database.databaseName
        ));
      }
    }
  }

  if (!evidence.auditComplete && blockers.length === 0) {
    blockers.push(blocker(
      "EDITION_FEATURE_AUDIT_INCOMPLETE",
      "feature",
      "At least one database did not complete the Standard Edition feature audit."
    ));
  }

  return blockers.length === 0 ? passedTerm() : failedTerm(blockers);
}

function evaluateVendorSupport(
  confirmations: EditionChangeConfirmations | undefined
): EditionEligibilityTerm {
  if (confirmations?.vendorSupportsStandardEdition === true) return passedTerm();
  return failedTerm([blocker(
    confirmations?.vendorSupportsStandardEdition === false
      ? "VENDOR_STANDARD_EDITION_NOT_SUPPORTED"
      : "VENDOR_STANDARD_EDITION_CONFIRMATION_REQUIRED",
    "vendor",
    confirmations?.vendorSupportsStandardEdition === false
      ? "The application vendor does not support SQL Server Standard Edition."
      : "Customer or application-vendor confirmation of Standard Edition support is required."
  )]);
}

function evaluateStandardScaleLimits(
  input: EnterpriseToStandardInput,
  limits: StandardEditionScaleLimits | undefined
): EditionEligibilityTerm {
  const blockers: EditionEligibilityBlocker[] = [];
  if (!limits) {
    return failedTerm([blocker(
      "STANDARD_VERSION_LIMITS_UNAVAILABLE",
      "scale",
      `Standard Edition scale limits are not defined for SQL Server ${input.currentConfig.sqlServerVersion}.`
    )]);
  }

  const standardEntry = matchingStandardEntry(input);
  const candidateSockets = candidateSocketCount(input);
  if (candidateSockets === undefined) {
    blockers.push(blocker(
      "STANDARD_CANDIDATE_SOCKET_COUNT_REQUIRED",
      "scale",
      "The candidate socket count is unavailable, so the Standard Edition socket/core limit cannot be verified."
    ));
  } else if (candidateSockets > limits.maxSockets) {
    blockers.push(blocker(
      "STANDARD_SOCKET_LIMIT_EXCEEDED",
      "scale",
      `Candidate socket count ${candidateSockets} exceeds the SQL Server ${limits.sqlMajorVersion} Standard Edition limit of ${limits.maxSockets} sockets.`
    ));
  }

  const candidateCores = input.candidateConfig.cpuCoreCount ?? standardEntry?.defaultCpuCores;
  if (candidateCores === undefined) {
    blockers.push(blocker(
      "STANDARD_CANDIDATE_CORE_COUNT_REQUIRED",
      "scale",
      "The candidate physical core count is unavailable, so the Standard Edition socket/core limit cannot be verified."
    ));
  } else if (candidateCores > limits.maxCores) {
    blockers.push(blocker(
      "STANDARD_CORE_LIMIT_EXCEEDED",
      "scale",
      `Candidate core count ${candidateCores} exceeds the SQL Server ${limits.sqlMajorVersion} Standard Edition limit of ${limits.maxCores} cores.`
    ));
  }

  const bufferPoolMb = input.workload.evidence?.memory?.bufferPoolMemoryMb?.max;
  if (bufferPoolMb === undefined) {
    blockers.push(blocker(
      "STANDARD_BUFFER_POOL_EVIDENCE_REQUIRED",
      "scale",
      "Observed buffer-pool memory is unavailable."
    ));
  } else if (bufferPoolMb / 1024 > limits.maxBufferPoolGb) {
    blockers.push(blocker(
      "STANDARD_BUFFER_POOL_LIMIT_EXCEEDED",
      "scale",
      `Observed buffer-pool maximum ${round2(bufferPoolMb / 1024)} GB exceeds the Standard Edition limit of ${limits.maxBufferPoolGb} GB.`
    ));
  }

  const columnstoreMb = input.workload.evidence?.memory?.columnstoreSegmentCacheMb?.max;
  if (columnstoreMb === undefined) {
    blockers.push(blocker(
      "STANDARD_COLUMNSTORE_CACHE_EVIDENCE_REQUIRED",
      "scale",
      "Observed columnstore segment-cache memory is unavailable."
    ));
  } else if (columnstoreMb / 1024 > limits.maxColumnstoreSegmentCacheGb) {
    blockers.push(blocker(
      "STANDARD_COLUMNSTORE_CACHE_LIMIT_EXCEEDED",
      "scale",
      `Observed columnstore segment-cache maximum ${round2(columnstoreMb / 1024)} GB exceeds the Standard Edition limit of ${limits.maxColumnstoreSegmentCacheGb} GB.`
    ));
  }

  const editionEvidence = input.workload.evidence?.edition;
  if (!editionEvidence || editionEvidence.databases.length === 0) {
    blockers.push(blocker(
      "STANDARD_MEMORY_OPTIMIZED_EVIDENCE_REQUIRED",
      "scale",
      "Per-database memory-optimized data usage is unavailable."
    ));
  } else {
    for (const database of editionEvidence.databases) {
      const memoryOptimizedMb = maxDefined(
        database.memoryOptimizedAllocatedMb,
        database.memoryOptimizedUsedMb
      );
      if (memoryOptimizedMb === undefined) {
        blockers.push(blocker(
          "STANDARD_MEMORY_OPTIMIZED_EVIDENCE_REQUIRED",
          "scale",
          `Memory-optimized data usage is unavailable for ${database.databaseName}.`,
          database.databaseName
        ));
      } else if (memoryOptimizedMb / 1024 > limits.maxMemoryOptimizedDataGbPerDatabase) {
        blockers.push(blocker(
          "STANDARD_MEMORY_OPTIMIZED_LIMIT_EXCEEDED",
          "scale",
          `${database.databaseName} uses ${round2(memoryOptimizedMb / 1024)} GB of memory-optimized data, above the ${limits.maxMemoryOptimizedDataGbPerDatabase} GB Standard Edition per-database limit.`,
          database.databaseName
        ));
      }
    }
  }

  return blockers.length === 0 ? passedTerm() : failedTerm(blockers);
}

function evaluateStandardOrderability(
  input: EnterpriseToStandardInput
): EditionEligibilityTerm {
  const targetConfig: CurrentRdsConfig = {
    ...input.candidateConfig,
    sqlServerEdition: "Standard"
  };
  const validation = isOrderableCandidate(
    input.catalog,
    targetConfig,
    targetConfig.instanceClass,
    { memoryGb: 0, iops: 0, throughputMbps: 0 },
    targetConfig.cpuConfigurationType === "optimize_cpu"
      && targetConfig.cpuCoreCount
      && targetConfig.cpuThreadsPerCore
      && targetConfig.sqlServerVisibleVcpu
      ? {
          coreCount: targetConfig.cpuCoreCount,
          threadsPerCore: targetConfig.cpuThreadsPerCore,
          sqlServerVisibleVcpu: targetConfig.sqlServerVisibleVcpu
        }
      : undefined
  );

  if (validation.valid) return passedTerm();
  return failedTerm(validation.failures.map((failure) => blocker(
    failure.split(":")[0],
    "orderability",
    `Standard Edition target is not orderable: ${failure}`
  )));
}

function evaluateMigrationPath(
  confirmations: EditionChangeConfirmations | undefined
): EditionEligibilityTerm {
  if (
    confirmations?.migrationPathAccepted === true
    && ["native_backup_restore", "aws_dms"].includes(confirmations.migrationPath ?? "")
  ) {
    return passedTerm();
  }

  return failedTerm([blocker(
    confirmations?.migrationPathAccepted === false
      ? "STANDARD_MIGRATION_PATH_NOT_ACCEPTED"
      : "STANDARD_MIGRATION_PATH_CONFIRMATION_REQUIRED",
    "migration",
    "Enterprise-to-Standard requires an accepted migration path: native backup/restore or AWS DMS. It is not an in-place RDS resize."
  )]);
}

function editionEvidence(
  input: EnterpriseToStandardInput,
  limits: StandardEditionScaleLimits | undefined,
  featureTerm: EditionEligibilityTerm
): string[] {
  const databaseCount = input.workload.evidence?.edition?.databases.length ?? 0;
  const featureCount = input.workload.evidence?.edition?.databases
    .reduce((sum, database) => sum + database.enterpriseFeatures.length, 0) ?? 0;
  const bufferPoolMb = input.workload.evidence?.memory?.bufferPoolMemoryMb?.max;
  const columnstoreMb = input.workload.evidence?.memory?.columnstoreSegmentCacheMb?.max;
  const candidateSockets = candidateSocketCount(input);

  return [
    `Per-database feature audit covered ${databaseCount} database(s) and found ${featureCount} persisted edition-specific feature record(s).`,
    `Feature compatibility term ${featureTerm.passed ? "passed" : "failed"}.`,
    limits
      ? `SQL Server ${limits.sqlMajorVersion} Standard limits: lesser of ${limits.maxSockets} sockets or ${limits.maxCores} cores, ${limits.maxBufferPoolGb} GB buffer pool, ${limits.maxColumnstoreSegmentCacheGb} GB columnstore segment cache, ${limits.maxMemoryOptimizedDataGbPerDatabase} GB memory-optimized data per database.`
      : `No Standard Edition scale-limit table is available for ${input.currentConfig.sqlServerVersion}.`,
    `Candidate socket count: ${candidateSockets ?? "not exposed for this target; exact AWS Standard orderability is required"}.`,
    `Observed buffer-pool maximum: ${bufferPoolMb === undefined ? "unavailable" : `${round2(bufferPoolMb / 1024)} GB`}.`,
    `Observed columnstore segment-cache maximum: ${columnstoreMb === undefined ? "unavailable" : `${round2(columnstoreMb / 1024)} GB`}.`,
    `Target orderability was checked for ${input.currentConfig.region}, Standard Edition, exact engine version ${input.currentConfig.sqlServerVersion}, and ${input.candidateConfig.instanceClass}.`
  ];
}

function matchingStandardEntry(input: EnterpriseToStandardInput): InstanceCatalogEntry | undefined {
  return input.catalog.find((entry) =>
    entry.instanceClass === input.candidateConfig.instanceClass
    && (!entry.region || entry.region === input.currentConfig.region)
    && (
      entry.sqlServerEdition === "Standard"
      || (!entry.sqlServerEdition && entry.supportedEditions.includes("Standard"))
    )
  );
}

function candidateSocketCount(input: EnterpriseToStandardInput): number | undefined {
  if (input.candidateConfig.cpuSocketCount !== undefined) {
    return input.candidateConfig.cpuSocketCount;
  }
  const standardEntry = matchingStandardEntry(input);
  if (standardEntry?.cpuSocketCount !== undefined) {
    return standardEntry.cpuSocketCount;
  }
  return input.candidateConfig.instanceClass === input.currentConfig.instanceClass
    ? input.currentConfig.cpuSocketCount
    : undefined;
}

function persistedFeatureSupportedByStandard(feature: string, sqlMajorVersion: number): boolean {
  const normalized = feature.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (STANDARD_SUPPORTED_PERSISTED_FEATURES.has(normalized)) return sqlMajorVersion >= 13;
  if (normalized === "transparentdataencryption") return sqlMajorVersion >= 15;
  return false;
}

function standardLimits(
  sqlMajorVersion: number,
  maxCores: number,
  maxBufferPoolGb: number,
  maxColumnstoreSegmentCacheGb: number,
  maxMemoryOptimizedDataGbPerDatabase: number
): StandardEditionScaleLimits {
  return {
    sqlMajorVersion,
    maxSockets: 4,
    maxCores,
    maxBufferPoolGb,
    maxColumnstoreSegmentCacheGb,
    maxMemoryOptimizedDataGbPerDatabase
  };
}

function passedTerm(): EditionEligibilityTerm {
  return { passed: true, blockers: [] };
}

function failedTerm(blockers: EditionEligibilityBlocker[]): EditionEligibilityTerm {
  return { passed: false, blockers };
}

function blocker(
  code: string,
  category: EditionEligibilityBlocker["category"],
  message: string,
  databaseName?: string
): EditionEligibilityBlocker {
  return { code, category, message, databaseName };
}

function maxDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length > 0 ? Math.max(...defined) : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
