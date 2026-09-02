import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, WorkloadProfile } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { analyzeServerWorkload, analyzeWorkloadBatch } from "../src/workload/index.js";
import { productionWorkload } from "./production-workload.js";

const catalog: InstanceCatalogEntry[] = [
  {
    instanceClass: "db.m8i.2xlarge",
    region: "us-east-1",
    family: "m8i",
    size: "2xlarge",
    vcpu: 8,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 32,
    baselineIops: 20000,
    maxIops: 20000,
    baselineThroughputMbps: 500,
    maxThroughputMbps: 500,
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
    baselineIops: 40000,
    maxIops: 40000,
    baselineThroughputMbps: 1250,
    maxThroughputMbps: 1250,
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
    baselineIops: 50000,
    maxIops: 50000,
    baselineThroughputMbps: 1250,
    maxThroughputMbps: 1250,
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

function workload(cpuP95: number, iopsP95 = 6000, throughputP95 = 200): WorkloadProfile {
  return productionWorkload({
    sqlCpuPct: cpuP95,
    currentMemoryGb: 256,
    totalIops: iopsP95,
    totalThroughputMibPerSec: throughputP95
  });
}

describe("analyzeServerWorkload", () => {
  it("runs compute, independent harness, and report assembly for one server", () => {
    const result = analyzeServerWorkload({
      serverName: "prod-sql-01",
      currentConfig,
      workload: workload(15),
      currentVcpu: 32,
      orderedCandidateInstanceClasses: ["db.m8i.2xlarge", "db.r8i.2xlarge"],
      requirements: {
        memoryGb: 48,
        iops: 6000,
        throughputMbps: 200
      }
    }, catalog);

    assert.equal(result.computeResult.recommendedConfig?.instanceClass, "db.r8i.2xlarge");
    assert.equal(result.workloadResult.risk, "medium");
    assert.equal(result.report.status, "aggressive_optimization");
    assert.equal(result.report.serverName, "prod-sql-01");
    assert.equal(result.report.pricingDeferred, true);
    assert.ok(result.harnessFindings.every((finding) => finding.passed));
    assert.equal(result.report.currentConfig.storageType, "gp3");
    assert.equal("storageRecommendation" in result, false);
  });

  it("keeps pricing unavailable from blocking a technical optimization result", () => {
    const result = analyzeServerWorkload({
      serverName: "pricing-deferred-sql",
      currentConfig,
      workload: workload(10),
      currentVcpu: 32,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    }, catalog);
    const serializedReport = JSON.stringify(result.report);

    assert.equal(result.computeResult.recommendedConfig?.instanceClass, "db.r8i.4xlarge");
    assert.notEqual(result.workloadResult.decision, "Not Recommended");
    assert.equal(result.report.pricingDeferred, true);
    assert.match(result.report.pricingNote, /Pricing is deferred/);
    assert.equal("monthlySavings" in result.report, false);
    assert.equal("annualSavings" in result.report, false);
    assert.equal(/monthly savings|annual savings/i.test(serializedReport), false);
  });

  it("fails closed when current storage provisioning facts are missing", () => {
    const result = analyzeServerWorkload({
      serverName: "prod-sql-01",
      currentConfig: {
        ...currentConfig,
        storageType: "unknown",
        provisionedIops: undefined,
        provisionedThroughputMbps: undefined,
        storageFactsComplete: false,
        storageFactsMissing: ["storage type", "provisioned IOPS", "provisioned throughput", "allocated storage"]
      },
      workload: workload(15),
      currentVcpu: 32,
      orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
      requirements: {
        memoryGb: 48,
        iops: 6000,
        throughputMbps: 200
      }
    }, catalog);

    assert.equal(result.computeResult.recommendedConfig, undefined);
    assert.equal(result.report.status, "not_recommended");
    assert.equal("storageRecommendation" in result, false);
    assert.ok(result.harnessFindings.every((finding) => finding.passed));
  });
});

describe("analyzeWorkloadBatch", () => {
  it("preserves per-server results for multi-server uploads", () => {
    const result = analyzeWorkloadBatch({
      catalog,
      servers: [
        {
          serverName: "prod-sql-01",
          currentConfig,
          workload: workload(15),
          currentVcpu: 32,
          orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
          requirements: {
            memoryGb: 48,
            iops: 6000,
            throughputMbps: 200
          }
        },
        {
          serverName: "prod-sql-02",
          currentConfig,
          workload: workload(15),
          currentVcpu: 32,
          orderedCandidateInstanceClasses: ["db.m8i.2xlarge"],
          requirements: {
            memoryGb: 96,
            iops: 6000,
            throughputMbps: 200
          }
        }
      ]
    });

    assert.equal(result.results.length, 2);
    assert.equal(result.batch.results.length, 2);
    assert.equal(result.results[0].report.status, "aggressive_optimization");
    assert.equal(result.results[1].report.status, "not_recommended");
    assert.equal(result.results[1].serverName, "prod-sql-02");
    assert.ok(result.results[1].report.actionPlan.some((action) => action.startsWith("Memory blocks")));
  });
});
