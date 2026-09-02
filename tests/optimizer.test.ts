import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, PhysicalIoEvidence, WorkloadProfile } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { assessEvidenceWindowFromDuration } from "../src/evidence-window/index.js";
import { optimizeComputeCandidate, requiredVcpuForCpuTarget } from "../src/optimizer/index.js";
import { distribution } from "../src/parser/stats.js";
import { synchronizedCpuSampleSeries } from "./cpu-samples.js";

const catalog: InstanceCatalogEntry[] = [
  {
    instanceClass: "db.m8i.2xlarge",
    region: "us-east-1",
    family: "m8i",
    size: "2xlarge",
    vcpu: 8,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 32,
    maxIops: 40000,
    baselineIops: 40000,
    maxThroughputMbps: 1250,
    baselineThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard", "Web"],
    minSqlMajorVersion: 14,
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
  {
    instanceClass: "db.r8i.2xlarge",
    region: "us-east-1",
    family: "r8i",
    size: "2xlarge",
    vcpu: 8,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 64,
    maxIops: 40000,
    baselineIops: 40000,
    maxThroughputMbps: 1250,
    baselineThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard", "Web"],
    minSqlMajorVersion: 14,
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
  {
    instanceClass: "db.r8i.4xlarge",
    region: "us-east-1",
    family: "r8i",
    size: "4xlarge",
    vcpu: 16,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 128,
    maxIops: 50000,
    baselineIops: 50000,
    maxThroughputMbps: 1250,
    baselineThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 14,
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  }
];

const currentConfig: CurrentRdsConfig = {
  region: "us-east-1",
  instanceClass: "db.r8i.8xlarge",
  sqlServerEdition: "Standard",
  sqlServerVersion: "16.00.4125.3",
  licenseModel: "license-included",
  storageType: "gp3",
  allocatedStorageGb: 512,
  provisionedIops: 12000,
  provisionedThroughputMbps: 500,
  multiAz: false
};

function dist(p95: number): MetricDistribution {
  return { avg: p95 / 2, p50: p95 / 2, p90: p95 * 0.9, p95, p99: p95 * 1.1, max: p95 * 1.4 };
}

function workload(cpuP95: number): WorkloadProfile {
  return {
    collectionHours: 168,
    cpuPct: dist(cpuP95),
    sampleSeries: synchronizedCpuSampleSeries(Array.from({ length: 100 }, () => cpuP95)),
    iops: dist(6000),
    throughputMbps: dist(200),
    physicalIo: physicalIo(
      Array.from({ length: 100 }, () => 6000),
      Array.from({ length: 100 }, () => 200)
    ),
    databases: [
      {
        databaseName: "orders",
        iops: dist(4500),
        throughputMbps: dist(150),
        iopsSharePct: 75,
        throughputSharePct: 75,
        sizeGb: 300
      }
    ]
  };
}

function physicalIo(
  values: number[],
  throughputValues = values.map(() => 0),
  tempdbValues = values.map(() => 0),
  tempdbThroughputValues = values.map(() => 0)
): PhysicalIoEvidence {
  const samples = values.map((totalIops, index) => {
    const tempdbTotalIops = tempdbValues[index];
    const tempdbTotalMibPerSec = tempdbThroughputValues[index];
    const nonTempdbTotalIops = totalIops - tempdbTotalIops;
    const nonTempdbTotalMibPerSec = throughputValues[index] - tempdbTotalMibPerSec;
    return {
      sampleKey: new Date(Date.UTC(2026, 7, 1, 0, index, 0)).toISOString(),
      timestampMs: Date.UTC(2026, 7, 1, 0, index, 0),
      elapsedSeconds: 60,
      readIops: totalIops,
      writeIops: 0,
      totalIops,
      readMibPerSec: throughputValues[index],
      writeMibPerSec: 0,
      totalMibPerSec: throughputValues[index],
      nonTempdbReadIops: nonTempdbTotalIops,
      nonTempdbWriteIops: 0,
      nonTempdbTotalIops,
      nonTempdbReadMibPerSec: nonTempdbTotalMibPerSec,
      nonTempdbWriteMibPerSec: 0,
      nonTempdbTotalMibPerSec,
      tempdbReadIops: tempdbTotalIops,
      tempdbWriteIops: 0,
      tempdbTotalIops,
      tempdbReadMibPerSec: tempdbTotalMibPerSec,
      tempdbWriteMibPerSec: 0,
      tempdbTotalMibPerSec,
      validIntervalCount: 1
    };
  });
  return {
    source: "cumulative_file_counters",
    samples,
    readIops: distribution(values),
    writeIops: distribution(values.map(() => 0)),
    totalIops: distribution(values),
    readMibPerSec: distribution(throughputValues),
    writeMibPerSec: distribution(throughputValues.map(() => 0)),
    totalMibPerSec: distribution(throughputValues),
    nonTempdbTotalIops: distribution(samples.map((sample) => sample.nonTempdbTotalIops)),
    nonTempdbTotalMibPerSec: distribution(samples.map((sample) => sample.nonTempdbTotalMibPerSec)),
    tempdbTotalIops: distribution(tempdbValues),
    tempdbTotalMibPerSec: distribution(tempdbThroughputValues),
    invalidIntervalCount: 0,
    rejectedSampleCount: 0
  };
}

describe("requiredVcpuForCpuTarget", () => {
  it("uses CPU P95 and target utilization", () => {
    assert.equal(requiredVcpuForCpuTarget(32, 20), 10);
    assert.equal(requiredVcpuForCpuTarget(32, 0), 1);
  });
});

describe("optimizeComputeCandidate", () => {
  it("selects a safe caller-ordered candidate that passes all fit checks", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(15),
      catalog,
      orderedCandidateInstanceClasses: ["db.m8i.2xlarge", "db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 48,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.equal(result.risk, "low");
    assert.equal(result.decision, "Recommended");
    assert.equal(result.confidence, "medium");
    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.2xlarge");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.topOffendingDatabases[0].databaseName, "orders");
    assert.ok(result.limitingResources.some((resource) =>
      resource.dimension === "iops" && resource.topDatabaseName === "orders"
    ));
    assert.equal(result.candidateEvaluations.filter((candidate) => candidate.selected).length, 1);
    assert.ok(result.passedChecks.includes("COLLECTION_WINDOW_MEDIUM_CONFIDENCE"));
  });

  it("supports a same-size generational move when SQL-visible vCPU differs", () => {
    const sameSizeCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.m5.4xlarge",
        region: "us-east-1",
        family: "m5",
        size: "4xlarge",
        vcpu: 16,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 64,
        baselineIops: 40000,
        maxIops: 40000,
        baselineThroughputMbps: 1250,
        maxThroughputMbps: 1250,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true
      },
      {
        instanceClass: "db.m8i.4xlarge",
        region: "us-east-1",
        family: "m8i",
        size: "4xlarge",
        vcpu: 12,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 64,
        baselineIops: 40000,
        maxIops: 40000,
        baselineThroughputMbps: 1250,
        maxThroughputMbps: 1250,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true
      }
    ];

    const result = optimizeComputeCandidate({
      currentConfig: {
        ...currentConfig,
        instanceClass: "db.m5.4xlarge"
      },
      workload: workload(20),
      catalog: sameSizeCatalog,
      orderedCandidateInstanceClasses: ["db.m8i.4xlarge"],
      currentVcpu: 16,
      requirements: { memoryGb: 48, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.m8i.4xlarge");
    assert.equal(result.recommendedConfig?.sqlServerVisibleVcpu, 12);
    assert.equal(result.optimizationEvidence?.projectedSqlCpuP95Pct, 26.67);
  });

  it("selects the smaller safe candidate when two candidates pass", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(10),
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge", "db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.decision, "Recommended");
    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.2xlarge");
    assert.equal(result.recommendedConfig?.sqlServerVisibleVcpu, 8);
    assert.equal(result.candidateEvaluations.filter((candidate) => candidate.accepted).length, 2);
    assert.equal(result.candidateEvaluations.find((candidate) => candidate.instanceClass === "db.r8i.4xlarge")?.selected, false);
  });

  it("uses a fallback family only when the lead-family path fails a workload gate", () => {
    const fallbackCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        instanceClass: "db.m8i.2xlarge",
        family: "m8i",
        memoryGb: 32
      },
      {
        ...catalog[1],
        instanceClass: "db.r7i.2xlarge",
        family: "r7i",
        memoryGb: 64
      }
    ];

    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(15),
      catalog: fallbackCatalog,
      orderedCandidateInstanceClasses: ["db.m8i.2xlarge", "db.r7i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r7i.2xlarge");
    assert.ok(result.candidateEvaluations.some((candidate) =>
      candidate.instanceClass === "db.m8i.2xlarge"
      && candidate.failedGates.includes("MEMORY_LESS_ELASTIC_FLOOR_UNDERFIT")
    ));
  });

  it("prefers a lead family over an equivalent fallback survivor", () => {
    const equivalentCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[1],
        instanceClass: "db.r7i.2xlarge",
        family: "r7i"
      },
      {
        ...catalog[1],
        instanceClass: "db.m8i.2xlarge",
        family: "m8i"
      }
    ];

    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(15),
      catalog: equivalentCatalog,
      orderedCandidateInstanceClasses: ["db.r7i.2xlarge", "db.m8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.m8i.2xlarge");
    assert.equal(result.candidateEvaluations.filter((candidate) => candidate.accepted).length, 2);
  });

  it("blocks production-safe recommendations when collection window is below 48 hours", () => {
    const shortWorkload = {
      ...workload(15),
      collectionHours: 4
    };

    const result = optimizeComputeCandidate({
      currentConfig,
      workload: shortWorkload,
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 48,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.equal(result.risk, "blocked");
    assert.equal(result.decision, "Not Recommended");
    assert.equal(result.confidence, "preliminary");
    assert.equal(result.recommendedConfig, undefined);
    assert.ok(result.blockers.some((blocker) => blocker.code === "COLLECTION_WINDOW_TOO_SHORT"));
    assert.match(result.blockers[0].message, /below 48 hours/);
  });

  it("allows the documented sub-48-hour path only with explicit customer confirmation", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        collectionHours: 4,
        evidenceWindow: assessEvidenceWindowFromDuration(4, {
          category: "non_production",
          customerConfirmed: true
        })
      },
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 48,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.notEqual(result.decision, "Not Recommended");
    assert.equal(result.evidenceWindow?.productionRightsizingEligible, true);
    assert.equal(result.evidenceWindow?.shortWindowException?.category, "non_production");
    assert.equal(result.evidenceWindow?.shortWindowException?.customerConfirmed, true);
  });

  it("returns Aggressive Optimization when a material RAM reduction lacks stable working-set evidence", () => {
    const currentEntry: InstanceCatalogEntry = {
      instanceClass: "db.r8i.8xlarge",
      region: "us-east-1",
      family: "r8i",
      size: "8xlarge",
      vcpu: 32,
      sqlServerDefaultVcpuSource: "aws-processor-features",
      memoryGb: 256,
      maxIops: 80000,
      maxThroughputMbps: 2000,
      supportedEditions: ["Enterprise", "Standard"],
      minSqlMajorVersion: 14,
      engine: "sqlserver-se",
      engineVersion: "16.00.4125.3.v1",
      sqlServerEdition: "Standard",
      orderable: true
    };
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(15),
      catalog: [currentEntry, ...catalog],
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 48,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.4xlarge");
    assert.equal(result.decision, "Aggressive Optimization");
    assert.equal(result.optimizationEvidence?.memoryCouplingVerdict, "aggressive_medium_confidence");
    assert.ok(result.limitingResources.some((resource) =>
      resource.dimension === "memory" && resource.status === "risk"
    ));
  });

  it("uses preliminary confidence for three to six days and high confidence from fourteen days", () => {
    const preliminary = optimizeComputeCandidate({
      currentConfig,
      workload: { ...workload(15), collectionHours: 96 },
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 6000, throughputMbps: 200 }
    });
    const preferred = optimizeComputeCandidate({
      currentConfig,
      workload: { ...workload(15), collectionHours: 336 },
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(preliminary.confidence, "preliminary");
    assert.ok(preliminary.passedChecks.includes("COLLECTION_WINDOW_PRELIMINARY"));
    assert.equal(preferred.confidence, "high");
    assert.ok(preferred.passedChecks.includes("COLLECTION_WINDOW_HIGH_CONFIDENCE"));
  });

  it("does not invent utilization risk bands when verified physical I/O fits", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(10),
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 54,
        iops: 33000,
        throughputMbps: 200
      }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.2xlarge");
    assert.notEqual(result.risk, "high");
  });

  it("blocks when CPU target cannot fit candidate vCPU", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(60),
      catalog,
      orderedCandidateInstanceClasses: ["db.m8i.2xlarge", "db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 32,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.equal(result.risk, "blocked");
    assert.ok(result.blockers.some((blocker) => blocker.code === "CPU_P95_TARGET_EXCEEDED"));
  });

  it("blocks when every candidate fails memory, IOPS, or throughput fit checks", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        physicalIo: physicalIo(
          Array.from({ length: 100 }, () => 70000),
          Array.from({ length: 100 }, () => 2000)
        )
      },
      catalog,
      orderedCandidateInstanceClasses: ["db.m8i.2xlarge", "db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 70000,
        throughputMbps: 2000
      }
    });

    assert.equal(result.risk, "blocked");
    assert.equal(result.cpuState, "underutilized");
    assert.ok(result.blockers.some((blocker) => blocker.dimension === "memory"));
    assert.ok(result.blockers.some((blocker) => blocker.dimension === "iops"));
    assert.ok(result.blockers.some((blocker) => blocker.dimension === "throughput"));
  });

  it("does not classify CPU as underutilized when the lower-vCPU class is not orderable for the SQL version", () => {
    const result = optimizeComputeCandidate({
      currentConfig: {
        ...currentConfig,
        sqlServerVersion: "13.00.6300.2"
      },
      workload: workload(15),
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.equal(result.cpuState, "normal");
    assert.ok(result.blockers.some((blocker) => blocker.code === "SQL_VERSION_NOT_ORDERABLE"));
  });

  it("uses projected P95 for sizing and projected P99 as the burst safety gate", () => {
    const burstyWorkload = {
      ...workload(20),
      sampleSeries: synchronizedCpuSampleSeries([
        ...Array.from({ length: 96 }, () => 20),
        ...Array.from({ length: 4 }, () => 50)
      ])
    };
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: burstyWorkload,
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig, undefined);
    assert.ok(result.blockers.some((blocker) => blocker.code === "CPU_P99_BURST_LIMIT_EXCEEDED"));
    assert.ok(!result.blockers.some((blocker) => blocker.code === "CPU_P95_TARGET_EXCEEDED"));
  });

  it("applies concurrent Other CPU through the projected total CPU P99 hard gate", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(30),
        sampleSeries: synchronizedCpuSampleSeries(
          Array.from({ length: 100 }, () => 30),
          20
        )
      },
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig, undefined);
    assert.ok(result.blockers.some((blocker) => blocker.code === "TOTAL_CPU_P99_HARD_GATE_EXCEEDED"));
    assert.ok(!result.blockers.some((blocker) => blocker.code === "CPU_P99_BURST_LIMIT_EXCEEDED"));
  });

  it("reports an isolated projected excursion without letting the raw maximum replace P99", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(20),
        sampleSeries: synchronizedCpuSampleSeries([
          ...Array.from({ length: 99 }, () => 20),
          50
        ])
      },
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.4xlarge");
    assert.equal(result.optimizationEvidence?.projectedSqlCpuP99Pct, 40.6);
    assert.equal(result.optimizationEvidence?.cpuExcursionSampleCount, 1);
    assert.equal(result.risk, "medium");
  });

  it("generates and selects an orderable Optimize CPU configuration on the current class", () => {
    const optimizeCpuCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.r8i.8xlarge",
        region: "us-east-1",
        family: "r8i",
        size: "8xlarge",
        vcpu: 32,
        defaultCpuCores: 16,
        defaultThreadsPerCore: 2,
        cpuSocketCount: 1,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        optimizeCpuConfigurations: [
          { coreCount: 8, threadsPerCore: 2, sqlServerVisibleVcpu: 16, isDefault: false },
          { coreCount: 16, threadsPerCore: 2, sqlServerVisibleVcpu: 32, isDefault: true }
        ],
        memoryGb: 256,
        baselineIops: 80000,
        maxIops: 80000,
        baselineThroughputMbps: 2000,
        maxThroughputMbps: 2000,
        supportedEditions: ["Enterprise", "Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true
      }
    ];
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(30),
      catalog: optimizeCpuCatalog,
      orderedCandidateInstanceClasses: ["db.r8i.8xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.8xlarge");
    assert.equal(result.recommendedConfig?.cpuConfigurationType, "optimize_cpu");
    assert.equal(result.recommendedConfig?.sqlServerVisibleVcpu, 16);
    assert.equal(result.optimizationEvidence?.cpuProjectionBasis, "same_hardware");
  });

  it("lowers cross-family confidence without a capacity factor and uses a factor when supplied", () => {
    const currentEntry: InstanceCatalogEntry = {
      instanceClass: "db.r8i.8xlarge",
      region: "us-east-1",
      family: "r8i",
      size: "8xlarge",
      vcpu: 32,
      sqlServerDefaultVcpuSource: "aws-processor-features",
      memoryGb: 256,
      maxIops: 80000,
      maxThroughputMbps: 2000,
      supportedEditions: ["Enterprise", "Standard"],
      minSqlMajorVersion: 14,
      engine: "sqlserver-se",
      engineVersion: "16.00.4125.3.v1",
      sqlServerEdition: "Standard",
      orderable: true
    };
    const unadjusted = optimizeComputeCandidate({
      currentConfig,
      workload: workload(15),
      catalog: [currentEntry, { ...catalog[0], memoryGb: 256 }],
      orderedCandidateInstanceClasses: ["db.m8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 16, iops: 6000, throughputMbps: 200 }
    });
    const normalized = optimizeComputeCandidate({
      currentConfig,
      workload: workload(15),
      catalog: [
        { ...currentEntry, normalizedPerCoreCapacity: 1 },
        { ...catalog[0], memoryGb: 256, normalizedPerCoreCapacity: 1.2 }
      ],
      orderedCandidateInstanceClasses: ["db.m8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 16, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(unadjusted.optimizationEvidence?.cpuProjectionConfidence, "low");
    assert.equal(unadjusted.optimizationEvidence?.cpuProjectionBasis, "unadjusted_cross_family");
    assert.equal(unadjusted.decision, "Aggressive Optimization");
    assert.equal(normalized.optimizationEvidence?.cpuProjectionConfidence, "medium");
    assert.equal(normalized.optimizationEvidence?.cpuProjectionBasis, "normalized_cross_family");
    assert.equal(normalized.decision, "Recommended");
    assert.equal(normalized.optimizationEvidence?.normalizedPerCoreCapacityFactor, 1.2);
    assert.equal(normalized.optimizationEvidence?.projectedSqlCpuP95Pct, 50);
  });

  it("blocks a candidate when physical IOPS P95 exceeds effective capability headroom", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        physicalIo: physicalIo(Array.from({ length: 100 }, () => 200))
      },
      catalog: [{ ...catalog[1], baselineIops: 150, maxIops: 250, baselineThroughputMbps: 1250 }],
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 200, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig, undefined);
    assert.ok(result.blockers.some((blocker) => blocker.code === "IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED"));
  });

  it("preserves an isolated IOPS maximum as evidence when P95 and P99 fit", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        physicalIo: physicalIo([
          ...Array.from({ length: 99 }, () => 100),
          1000
        ])
      },
      catalog: [{ ...catalog[1], baselineIops: 200, maxIops: 200, baselineThroughputMbps: 1250 }],
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 109, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.2xlarge");
    assert.equal(result.optimizationEvidence?.iopsP95, 100);
    assert.equal(result.optimizationEvidence?.iopsP99, 109);
    assert.equal(result.optimizationEvidence?.iopsMax, 1000);
    assert.ok(!result.blockers.some((blocker) => blocker.code === "IOPS_HARD_MAXIMUM_EXCEEDED"));
  });

  it("uses an alternate Optimize CPU path when a smaller candidate fails IOPS", () => {
    const rescueCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.r8i.8xlarge",
        region: "us-east-1",
        family: "r8i",
        size: "8xlarge",
        vcpu: 32,
        defaultCpuCores: 16,
        defaultThreadsPerCore: 2,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        optimizeCpuConfigurations: [
          { coreCount: 8, threadsPerCore: 2, sqlServerVisibleVcpu: 16, isDefault: false },
          { coreCount: 16, threadsPerCore: 2, sqlServerVisibleVcpu: 32, isDefault: true }
        ],
        memoryGb: 256,
        baselineIops: 80000,
        maxIops: 80000,
        baselineThroughputMbps: 2000,
        maxThroughputMbps: 2000,
        supportedEditions: ["Enterprise", "Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true
      },
      {
        ...catalog[1],
        baselineIops: 150,
        maxIops: 250,
        baselineThroughputMbps: 1250
      }
    ];
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        physicalIo: physicalIo(Array.from({ length: 100 }, () => 200))
      },
      catalog: rescueCatalog,
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge", "db.r8i.8xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 200, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.8xlarge");
    assert.equal(result.recommendedConfig?.cpuConfigurationType, "optimize_cpu");
    assert.equal(result.recommendedConfig?.sqlServerVisibleVcpu, 16);
    assert.equal(result.candidateEvaluations.find((candidate) =>
      candidate.instanceClass === "db.r8i.2xlarge"
    )?.failedGates.includes("IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED"), true);
    assert.equal(result.candidateEvaluations.find((candidate) =>
      candidate.instanceClass === "db.r8i.8xlarge"
      && candidate.cpuConfigurationType === "optimize_cpu"
    )?.selected, true);
  });

  it("blocks throughput independently when physical P95 exceeds effective capability headroom", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        physicalIo: physicalIo(
          Array.from({ length: 100 }, () => 10),
          Array.from({ length: 100 }, () => 200)
        )
      },
      catalog: [{
        ...catalog[1],
        baselineIops: 40000,
        baselineThroughputMbps: 150,
        maxThroughputMbps: 250
      }],
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 48, iops: 10, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig, undefined);
    assert.ok(result.blockers.some((blocker) => blocker.code === "THROUGHPUT_P95_EFFECTIVE_CAPABILITY_EXCEEDED"));
    assert.ok(!result.blockers.some((blocker) => blocker.dimension === "iops"));
  });

  it("removes time-aligned tempdb demand for a Non-NVMe to NVMe candidate", () => {
    const placementCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.r8i.8xlarge",
        region: "us-east-1",
        family: "r8i",
        size: "8xlarge",
        vcpu: 32,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 256,
        baselineIops: 400,
        maxIops: 800,
        baselineThroughputMbps: 40,
        maxThroughputMbps: 80,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true,
        localInstanceStorage: {
          supported: false,
          tempdbOnLocalStorage: false
        }
      },
      {
        instanceClass: "db.x2iedn.4xlarge",
        region: "us-east-1",
        family: "x2iedn",
        size: "4xlarge",
        vcpu: 16,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 128,
        baselineIops: 120,
        maxIops: 200,
        baselineThroughputMbps: 20,
        maxThroughputMbps: 20,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true,
        localInstanceStorage: {
          supported: true,
          capacityGb: 100,
          tempdbOnLocalStorage: true
        }
      }
    ];
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        physicalIo: physicalIo(
          Array.from({ length: 100 }, () => 120),
          Array.from({ length: 100 }, () => 12),
          Array.from({ length: 100 }, () => 40),
          Array.from({ length: 100 }, () => 4)
        ),
        evidence: {
          memory: {
            pressureSignals: []
          },
          topDatabasesByIops: [],
          topDatabasesByThroughput: [],
          fileLatency: [],
          waitStats: [],
          tempdbUsage: {
            representativeAllocatedMb: 50 * 1024,
            peakAllocatedMb: 80 * 1024
          }
        }
      },
      catalog: placementCatalog,
      orderedCandidateInstanceClasses: ["db.x2iedn.4xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 120, throughputMbps: 12 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.x2iedn.4xlarge");
    assert.equal(result.optimizationEvidence?.tempdbPlacementTransition, "non_nvme_to_nvme");
    assert.equal(result.optimizationEvidence?.candidateNormalPathIopsP95, 80);
    assert.equal(result.optimizationEvidence?.candidateNormalPathThroughputP95, 8);
    assert.equal(result.optimizationEvidence?.tempdbCapacityResult, "fits");
    assert.equal(result.risk, "medium");
  });

  it("blocks an NVMe candidate when peak tempdb allocation exceeds local capacity", () => {
    const placementCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.r8i.8xlarge",
        region: "us-east-1",
        family: "r8i",
        size: "8xlarge",
        vcpu: 32,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 256,
        maxIops: 800,
        maxThroughputMbps: 80,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true,
        localInstanceStorage: {
          supported: false,
          tempdbOnLocalStorage: false
        }
      },
      {
        instanceClass: "db.x2iedn.4xlarge",
        region: "us-east-1",
        family: "x2iedn",
        size: "4xlarge",
        vcpu: 16,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 128,
        baselineIops: 100,
        maxIops: 200,
        baselineThroughputMbps: 10,
        maxThroughputMbps: 20,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true,
        localInstanceStorage: {
          supported: true,
          capacityGb: 60,
          tempdbOnLocalStorage: true
        }
      }
    ];
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: {
        ...workload(15),
        physicalIo: physicalIo([80], [8], [20], [2]),
        evidence: {
          memory: {
            pressureSignals: []
          },
          topDatabasesByIops: [],
          topDatabasesByThroughput: [],
          fileLatency: [],
          waitStats: [],
          tempdbUsage: {
            representativeAllocatedMb: 50 * 1024,
            peakAllocatedMb: 80 * 1024
          }
        }
      },
      catalog: placementCatalog,
      orderedCandidateInstanceClasses: ["db.x2iedn.4xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 80, throughputMbps: 8 }
    });

    assert.equal(result.recommendedConfig, undefined);
    assert.ok(result.blockers.some((blocker) => blocker.code === "TEMPDB_LOCAL_CAPACITY_EXCEEDED"));
    assert.ok(result.blockers.some((blocker) => blocker.dimension === "tempdb"));
  });

  it("keeps an approved compute downsize on Enterprise when the Standard gate is blocked", () => {
    const enterpriseConfig: CurrentRdsConfig = {
      ...currentConfig,
      instanceClass: "db.r8i.8xlarge",
      sqlServerEdition: "Enterprise",
      sqlServerVersion: "16.00.4125.3"
    };
    const editionCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.r8i.8xlarge",
        region: "us-east-1",
        family: "r8i",
        size: "8xlarge",
        vcpu: 32,
        defaultCpuCores: 16,
        defaultThreadsPerCore: 2,
        cpuSocketCount: 1,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 256,
        baselineIops: 80000,
        maxIops: 80000,
        baselineThroughputMbps: 2000,
        maxThroughputMbps: 2000,
        supportedEditions: ["Enterprise"],
        sqlServerEdition: "Enterprise",
        engine: "sqlserver-ee",
        engineVersion: "16.00.4125.3.v1",
        minSqlMajorVersion: 16,
        orderable: true
      },
      {
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
        baselineIops: 50000,
        maxIops: 50000,
        baselineThroughputMbps: 1250,
        maxThroughputMbps: 1250,
        supportedEditions: ["Enterprise"],
        sqlServerEdition: "Enterprise",
        engine: "sqlserver-ee",
        engineVersion: "16.00.4125.3.v1",
        minSqlMajorVersion: 16,
        orderable: true
      },
      {
        instanceClass: "db.r8i.4xlarge",
        region: "us-east-1",
        family: "r8i",
        size: "4xlarge",
        vcpu: 16,
        defaultCpuCores: 8,
        defaultThreadsPerCore: 2,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 128,
        baselineIops: 50000,
        maxIops: 50000,
        baselineThroughputMbps: 1250,
        maxThroughputMbps: 1250,
        supportedEditions: ["Standard"],
        sqlServerEdition: "Standard",
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        minSqlMajorVersion: 16,
        orderable: true
      }
    ];
    const editionWorkload: WorkloadProfile = {
      ...workload(20),
      evidence: {
        memory: {
          pressureSignals: [],
          bufferPoolMemoryMb: dist(64 * 1024),
          columnstoreSegmentCacheMb: dist(8 * 1024)
        },
        edition: {
          source: "collector",
          auditComplete: true,
          databases: [{
            databaseName: "orders",
            auditStatus: "complete",
            enterpriseFeatures: [],
            memoryOptimizedAllocatedMb: 1024,
            memoryOptimizedUsedMb: 1024
          }]
        },
        topDatabasesByIops: ["orders"],
        topDatabasesByThroughput: ["orders"],
        fileLatency: [],
        waitStats: []
      }
    };
    const result = optimizeComputeCandidate({
      currentConfig: enterpriseConfig,
      workload: editionWorkload,
      catalog: editionCatalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 6000, throughputMbps: 200 }
    });

    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.4xlarge");
    assert.equal(result.recommendedConfig?.sqlServerEdition, "Enterprise");
    assert.equal(result.enterpriseToStandard?.status, "blocked");
    assert.ok(result.enterpriseToStandard?.blockers.some((item) =>
      item.code === "VENDOR_STANDARD_EDITION_CONFIRMATION_REQUIRED"
    ));
  });

  it("changes to Standard only when every documented edition term passes", () => {
    const enterpriseConfig: CurrentRdsConfig = {
      ...currentConfig,
      sqlServerEdition: "Enterprise",
      sqlServerVersion: "16.00.4125.3"
    };
    const enterpriseCandidate: InstanceCatalogEntry = {
      ...catalog[2],
      region: "us-east-1",
      defaultCpuCores: 8,
      defaultThreadsPerCore: 2,
      cpuSocketCount: 1,
      sqlServerDefaultVcpuSource: "aws-processor-features",
      supportedEditions: ["Enterprise"],
      sqlServerEdition: "Enterprise",
      engineVersion: "16.00.4125.3.v1"
    };
    const standardCandidate: InstanceCatalogEntry = {
      ...enterpriseCandidate,
      supportedEditions: ["Standard"],
      sqlServerEdition: "Standard"
    };
    const result = optimizeComputeCandidate({
      currentConfig: enterpriseConfig,
      workload: {
        ...workload(20),
        evidence: {
          memory: {
            pressureSignals: [],
            bufferPoolMemoryMb: dist(64 * 1024),
            columnstoreSegmentCacheMb: dist(8 * 1024)
          },
          edition: {
            source: "collector",
            auditComplete: true,
            databases: [{
              databaseName: "orders",
              auditStatus: "complete",
              enterpriseFeatures: [],
              memoryOptimizedAllocatedMb: 1024,
              memoryOptimizedUsedMb: 1024
            }]
          },
          topDatabasesByIops: ["orders"],
          topDatabasesByThroughput: ["orders"],
          fileLatency: [],
          waitStats: []
        }
      },
      catalog: [enterpriseCandidate, standardCandidate],
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: { memoryGb: 96, iops: 6000, throughputMbps: 200 },
      editionChangeConfirmations: {
        vendorSupportsStandardEdition: true,
        migrationPathAccepted: true,
        migrationPath: "aws_dms"
      }
    });

    assert.equal(result.recommendedConfig?.sqlServerEdition, "Standard");
    assert.equal(result.enterpriseToStandard?.eligible, true);
    assert.equal(result.enterpriseToStandard?.acceptedMigrationPath, "aws_dms");
  });

});
