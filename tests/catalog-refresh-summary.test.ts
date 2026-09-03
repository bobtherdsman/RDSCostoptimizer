import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogRefreshSummaryMarkdown,
  summarizeCatalogRefresh
} from "../src/catalog/refresh-summary.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";

const baseEntry: InstanceCatalogEntry = {
  instanceClass: "db.m8i.4xlarge",
  region: "us-east-1",
  family: "m8i",
  size: "4xlarge",
  vcpu: 8,
  sqlServerDefaultVcpu: 8,
  sqlServerDefaultVcpuSource: "aws-processor-features",
  defaultCpuCores: 8,
  defaultThreadsPerCore: 1,
  optimizeCpuConfigurations: [
    { coreCount: 4, threadsPerCore: 1, sqlServerVisibleVcpu: 4, isDefault: false },
    { coreCount: 8, threadsPerCore: 1, sqlServerVisibleVcpu: 8, isDefault: true }
  ],
  memoryGb: 64,
  baselineIops: 40000,
  maxIops: 40000,
  baselineThroughputMbps: 1250,
  maxThroughputMbps: 1250,
  supportedEditions: ["Enterprise"],
  minSqlMajorVersion: 16,
  maxSqlMajorVersion: 16,
  engine: "sqlserver-ee",
  engineVersion: "16.00.4215.2.v1",
  sqlServerEdition: "Enterprise",
  licenseModel: "license-included",
  multiAzCapable: true,
  localInstanceStorage: {
    supported: false,
    tempdbOnLocalStorage: false
  },
  orderable: true
};

describe("catalog refresh summary", () => {
  it("ENG-CATALOG-REFRESH-001: reports new classes, removed classes, and changed capability facts", () => {
    const nextClass: InstanceCatalogEntry = {
      ...baseEntry,
      instanceClass: "db.r8i.4xlarge",
      family: "r8i",
      memoryGb: 128
    };
    const changedEntry: InstanceCatalogEntry = {
      ...baseEntry,
      memoryGb: 96,
      baselineIops: 50000,
      maxThroughputMbps: 2500,
      localInstanceStorage: {
        supported: true,
        capacityGb: 500,
        tempdbOnLocalStorage: true
      }
    };

    const summary = summarizeCatalogRefresh([baseEntry, nextClass], [changedEntry]);

    assert.equal(summary.beforeCount, 2);
    assert.equal(summary.afterCount, 1);
    assert.equal(summary.delta, -1);
    assert.deepEqual(summary.removedClasses, ["db.r8i.4xlarge"]);
    assert.deepEqual(summary.removedFamilies, ["r8i"]);
    assert.deepEqual(summary.newClasses, []);
    assert.equal(summary.changedEntries.length, 1);
    assert.deepEqual(summary.changedEntries[0].fields, [
      "memoryGb",
      "baselineIops",
      "maxThroughputMbps",
      "localInstanceStorage"
    ]);
  });

  it("ENG-CATALOG-REFRESH-002: renders a review-focused markdown summary", () => {
    const summary = summarizeCatalogRefresh([], [baseEntry]);
    const markdown = catalogRefreshSummaryMarkdown(summary);

    assert.match(markdown, /Entries before: 0/);
    assert.match(markdown, /Entry delta: \+1/);
    assert.match(markdown, /New families: m8i/);
    assert.match(markdown, /Human review is required/);
  });
});
