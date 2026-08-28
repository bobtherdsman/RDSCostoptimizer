import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, WorkloadProfile } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { optimizeComputeCandidate, requiredVcpuForCpuTarget } from "../src/optimizer/index.js";

const catalog: InstanceCatalogEntry[] = [
  {
    instanceClass: "db.m8i.2xlarge",
    family: "m8i",
    size: "2xlarge",
    vcpu: 8,
    memoryGb: 32,
    maxIops: 40000,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard", "Web"],
    minSqlMajorVersion: 14
  },
  {
    instanceClass: "db.r8i.2xlarge",
    family: "r8i",
    size: "2xlarge",
    vcpu: 8,
    memoryGb: 64,
    maxIops: 40000,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard", "Web"],
    minSqlMajorVersion: 14
  },
  {
    instanceClass: "db.r8i.4xlarge",
    family: "r8i",
    size: "4xlarge",
    vcpu: 16,
    memoryGb: 128,
    maxIops: 50000,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 14
  }
];

const currentConfig: CurrentRdsConfig = {
  region: "us-east-1",
  instanceClass: "db.r8i.8xlarge",
  sqlServerEdition: "Standard",
  sqlServerVersion: "16.00",
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
    iops: dist(6000),
    throughputMbps: dist(200),
    databases: [
      {
        databaseName: "orders",
        iops: dist(4500),
        throughputMbps: dist(150),
        sizeGb: 300
      }
    ]
  };
}

describe("requiredVcpuForCpuTarget", () => {
  it("uses CPU P95 and target utilization", () => {
    assert.equal(requiredVcpuForCpuTarget(32, 20), 10);
    assert.equal(requiredVcpuForCpuTarget(32, 0), 1);
  });
});

describe("optimizeComputeCandidate", () => {
  it("selects the first caller-ordered candidate that passes all fit checks", () => {
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

    assert.equal(result.risk, "medium");
    assert.equal(result.recommendedConfig?.instanceClass, "db.r8i.2xlarge");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.topOffendingDatabases[0].databaseName, "orders");
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
    assert.ok(result.blockers.some((blocker) => blocker.code === "CPU_UNDERFIT"));
  });

  it("blocks when every candidate fails memory, IOPS, or throughput fit checks", () => {
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: workload(15),
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
    assert.ok(result.blockers.some((blocker) => blocker.dimension === "memory"));
    assert.ok(result.blockers.some((blocker) => blocker.dimension === "iops"));
    assert.ok(result.blockers.some((blocker) => blocker.dimension === "throughput"));
  });
});