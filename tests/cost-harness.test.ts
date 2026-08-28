import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, OptimizationResult, WorkloadProfile } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { assertHarnessPassed, runCostHarness } from "../src/harness/index.js";

const catalog: InstanceCatalogEntry[] = [
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
  },
  {
    instanceClass: "db.m8i.2xlarge",
    family: "m8i",
    size: "2xlarge",
    vcpu: 8,
    memoryGb: 32,
    maxIops: 20000,
    maxThroughputMbps: 500,
    supportedEditions: ["Enterprise", "Standard", "Web"],
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

const workload: WorkloadProfile = {
  collectionHours: 168,
  cpuPct: dist(20),
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

function validResult(overrides: Partial<OptimizationResult> = {}): OptimizationResult {
  return {
    currentConfig,
    recommendedConfig: {
      ...currentConfig,
      instanceClass: "db.r8i.4xlarge"
    },
    currentMonthlyCostUsd: 1000,
    optimizedMonthlyCostUsd: 700,
    monthlySavingsUsd: 300,
    annualSavingsUsd: 3600,
    savingsPct: 30,
    risk: "medium",
    blockers: [],
    topOffendingDatabases: workload.databases,
    passedChecks: ["CPU_TARGET_FIT", "MEMORY_FIT", "IOPS_FIT", "THROUGHPUT_FIT"],
    ...overrides
  };
}

describe("runCostHarness", () => {
  it("passes a valid independently selected optimized size", () => {
    const findings = runCostHarness({
      result: validResult(),
      workload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assertHarnessPassed(findings);
  });

  it("accepts blocked results only when blockers are explained", () => {
    const findings = runCostHarness({
      result: {
        currentConfig,
        risk: "blocked",
        blockers: [{ code: "MEMORY_UNDERFIT", dimension: "memory", message: "No smaller candidate fits memory." }],
        topOffendingDatabases: workload.databases,
        passedChecks: []
      },
      workload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 999,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assertHarnessPassed(findings);
  });

  it("fails when recommended size underfits memory, IOPS, or throughput", () => {
    const findings = runCostHarness({
      result: validResult({ recommendedConfig: { ...currentConfig, instanceClass: "db.m8i.2xlarge" } }),
      workload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 60000,
        throughputMbps: 2000
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-A-ORDERABLE-CONSTRAINTS"));
    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-MEMORY-FIT"));
    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-IOPS-FIT"));
    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-THROUGHPUT-FIT"));
  });

  it("fails when optimized cost is higher than current cost", () => {
    const findings = runCostHarness({
      result: validResult({ optimizedMonthlyCostUsd: 1200 }),
      workload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-H-OPTIMIZED-COST-NOT-HIGHER"));
  });

  it("fails when caller says SSATWeb sizing engine was used", () => {
    const findings = runCostHarness({
      result: validResult(),
      workload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      usedSsatWebSizingEngine: true,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-J-INDEPENDENT-SIZING"));
  });
});