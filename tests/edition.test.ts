import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  CurrentRdsConfig,
  MetricDistribution,
  WorkloadProfile
} from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import {
  evaluateEnterpriseToStandard,
  standardEditionLimitsForVersion
} from "../src/edition/index.js";

const currentConfig: CurrentRdsConfig = {
  region: "us-east-1",
  instanceClass: "db.r8i.8xlarge",
  sqlServerEdition: "Enterprise",
  sqlServerVersion: "16.00.4125.3",
  licenseModel: "license-included",
  storageType: "gp3",
  allocatedStorageGb: 512,
  multiAz: false,
  sqlServerVisibleVcpu: 32,
  cpuSocketCount: 1,
  cpuCoreCount: 16,
  cpuThreadsPerCore: 2,
  cpuConfigurationType: "collector"
};

const candidateConfig: CurrentRdsConfig = {
  ...currentConfig,
  instanceClass: "db.r8i.4xlarge",
  sqlServerVisibleVcpu: 16,
  cpuSocketCount: undefined,
  cpuCoreCount: 8,
  cpuThreadsPerCore: 2,
  cpuConfigurationType: "default"
};

const enterpriseEntry: InstanceCatalogEntry = {
  instanceClass: "db.r8i.4xlarge",
  region: "us-east-1",
  family: "r8i",
  size: "4xlarge",
  vcpu: 16,
  defaultCpuCores: 8,
  defaultThreadsPerCore: 2,
  cpuSocketCount: 1,
  sqlServerDefaultVcpuSource: "aws-processor-features",
  memoryGb: 128,
  maxIops: 50000,
  maxThroughputMbps: 1250,
  supportedEditions: ["Enterprise"],
  sqlServerEdition: "Enterprise",
  engine: "sqlserver-ee",
  engineVersion: "16.00.4125.3.v1",
  minSqlMajorVersion: 16,
  orderable: true
};

const standardEntry: InstanceCatalogEntry = {
  ...enterpriseEntry,
  supportedEditions: ["Standard"],
  sqlServerEdition: "Standard",
  engine: "sqlserver-se"
};

function dist(value: number): MetricDistribution {
  return {
    avg: value,
    p50: value,
    p90: value,
    p95: value,
    p99: value,
    max: value
  };
}

function workload(overrides: Partial<WorkloadProfile["evidence"]> = {}): WorkloadProfile {
  return {
    collectionHours: 336,
    cpuPct: dist(20),
    iops: dist(1000),
    throughputMbps: dist(100),
    databases: [],
    evidence: {
      memory: {
        pressureSignals: [],
        bufferPoolMemoryMb: dist(64 * 1024),
        columnstoreSegmentCacheMb: dist(8 * 1024)
      },
      edition: {
        source: "collector",
        auditComplete: true,
        databases: [
          {
            databaseName: "orders",
            auditStatus: "complete",
            enterpriseFeatures: [],
            columnstoreSegmentCacheMb: 8192,
            memoryOptimizedAllocatedMb: 4096,
            memoryOptimizedUsedMb: 3072
          }
        ]
      },
      topDatabasesByIops: [],
      topDatabasesByThroughput: [],
      fileLatency: [],
      waitStats: [],
      ...overrides
    }
  };
}

function evaluate(input: {
  workload?: WorkloadProfile;
  catalog?: InstanceCatalogEntry[];
  confirmations?: {
    vendorSupportsStandardEdition?: boolean;
    migrationPathAccepted?: boolean;
    migrationPath?: "native_backup_restore" | "aws_dms";
  };
  candidate?: CurrentRdsConfig;
} = {}) {
  return evaluateEnterpriseToStandard({
    currentConfig,
    candidateConfig: input.candidate ?? candidateConfig,
    workload: input.workload ?? workload(),
    catalog: input.catalog ?? [enterpriseEntry, standardEntry],
    confirmations: input.confirmations ?? {
      vendorSupportsStandardEdition: true,
      migrationPathAccepted: true,
      migrationPath: "native_backup_restore"
    },
    requirements: {
      memoryGb: 64,
      iops: 1000,
      throughputMbps: 100
    }
  });
}

describe("Enterprise-to-Standard evaluation", () => {
  it("requires all five documented terms and returns a migration recommendation", () => {
    const result = evaluate();

    assert.equal(result.eligible, true);
    assert.equal(result.status, "eligible");
    assert.equal(result.migrationRequired, true);
    assert.equal(result.acceptedMigrationPath, "native_backup_restore");
    assert.equal(result.blockers.length, 0);
    assert.ok(Object.values(result.terms).every((term) => term.passed));
  });

  it("does not accept an Enterprise-to-Standard change when target socket count is unknown", () => {
    const result = evaluate({
      candidate: { ...candidateConfig, cpuSocketCount: undefined },
      catalog: [enterpriseEntry, { ...standardEntry, cpuSocketCount: undefined }]
    });

    assert.equal(result.terms.standardScaleLimitsFit.passed, false);
    assert.ok(result.blockers.some((item) =>
      item.code === "STANDARD_CANDIDATE_SOCKET_COUNT_REQUIRED"
    ));
  });

  it("reports unsupported persisted database features separately", () => {
    const featureWorkload = workload({
      edition: {
        source: "collector",
        auditComplete: true,
        databases: [
          {
            databaseName: "orders",
            auditStatus: "complete",
            enterpriseFeatures: ["UnknownEnterpriseFeature"],
            columnstoreSegmentCacheMb: 0,
            memoryOptimizedAllocatedMb: 0,
            memoryOptimizedUsedMb: 0
          }
        ]
      }
    });
    const result = evaluate({ workload: featureWorkload });

    assert.equal(result.eligible, false);
    assert.equal(result.terms.featureCompatible.passed, false);
    assert.ok(result.blockers.some((item) =>
      item.category === "feature"
      && item.code === "ENTERPRISE_FEATURE_NOT_SUPPORTED_BY_STANDARD"
      && item.databaseName === "orders"
    ));
  });

  it("requires explicit vendor support confirmation", () => {
    const result = evaluate({
      confirmations: {
        migrationPathAccepted: true,
        migrationPath: "aws_dms"
      }
    });

    assert.equal(result.terms.vendorSupported.passed, false);
    assert.ok(result.blockers.some((item) =>
      item.code === "VENDOR_STANDARD_EDITION_CONFIRMATION_REQUIRED"
    ));
  });

  it("applies socket, core, buffer-pool, columnstore, and per-database memory-optimized limits", () => {
    const scaleWorkload = workload({
      memory: {
        pressureSignals: [],
        bufferPoolMemoryMb: dist(129 * 1024),
        columnstoreSegmentCacheMb: dist(33 * 1024)
      },
      edition: {
        source: "collector",
        auditComplete: true,
        databases: [
          {
            databaseName: "orders",
            auditStatus: "complete",
            enterpriseFeatures: [],
            columnstoreSegmentCacheMb: 33 * 1024,
            memoryOptimizedAllocatedMb: 33 * 1024,
            memoryOptimizedUsedMb: 32 * 1024
          }
        ]
      }
    });
    const result = evaluate({
      workload: scaleWorkload,
      candidate: {
        ...candidateConfig,
        cpuSocketCount: 5,
        cpuCoreCount: 25
      }
    });

    assert.equal(result.terms.standardScaleLimitsFit.passed, false);
    for (const code of [
      "STANDARD_SOCKET_LIMIT_EXCEEDED",
      "STANDARD_CORE_LIMIT_EXCEEDED",
      "STANDARD_BUFFER_POOL_LIMIT_EXCEEDED",
      "STANDARD_COLUMNSTORE_CACHE_LIMIT_EXCEEDED",
      "STANDARD_MEMORY_OPTIMIZED_LIMIT_EXCEEDED"
    ]) {
      assert.ok(result.blockers.some((item) => item.code === code), code);
    }
  });

  it("requires exact Standard Edition class and engine-version orderability", () => {
    const result = evaluate({ catalog: [enterpriseEntry] });

    assert.equal(result.terms.rdsClassVersionOrderable.passed, false);
    assert.ok(result.blockers.some((item) =>
      item.category === "orderability"
      && item.code === "EDITION_NOT_SUPPORTED"
    ));
  });

  it("requires an accepted native backup/restore or AWS DMS path", () => {
    const result = evaluate({
      confirmations: {
        vendorSupportsStandardEdition: true
      }
    });

    assert.equal(result.terms.migrationPathAccepted.passed, false);
    assert.ok(result.blockers.some((item) =>
      item.code === "STANDARD_MIGRATION_PATH_CONFIRMATION_REQUIRED"
    ));
  });

  it("uses the documented SQL Server 2025 Standard scale limits", () => {
    assert.deepEqual(standardEditionLimitsForVersion("17.0.1000.7"), {
      sqlMajorVersion: 17,
      maxSockets: 4,
      maxCores: 32,
      maxBufferPoolGb: 256,
      maxColumnstoreSegmentCacheGb: 64,
      maxMemoryOptimizedDataGbPerDatabase: 32
    });
  });
});
