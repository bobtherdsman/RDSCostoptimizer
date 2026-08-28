import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findCheapestValidByCatalogOrder,
  isOrderableCandidate,
  parseSqlMajorVersion,
  type InstanceCatalogEntry
} from "../src/catalog/index.js";

const catalog: InstanceCatalogEntry[] = [
  {
    instanceClass: "db.m8i.4xlarge",
    family: "m8i",
    size: "4xlarge",
    vcpu: 16,
    memoryGb: 64,
    maxIops: 50000,
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
  },
  {
    instanceClass: "db.x2m.16xlarge",
    family: "x2m",
    size: "16xlarge",
    vcpu: 64,
    memoryGb: 2048,
    maxIops: 130000,
    maxThroughputMbps: 5000,
    supportedEditions: ["Enterprise"],
    minSqlMajorVersion: 14
  },
  {
    instanceClass: "db.x2iedn.8xlarge",
    family: "x2iedn",
    size: "8xlarge",
    vcpu: 32,
    memoryGb: 1024,
    maxIops: 65000,
    maxThroughputMbps: 2500,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 15
  }
];

const standardSql2022 = {
  sqlServerEdition: "Standard" as const,
  sqlServerVersion: "16.00"
};

describe("catalog/orderability validation", () => {
  it("parses SQL Server major versions", () => {
    assert.equal(parseSqlMajorVersion("16.00.4215.2"), 16);
    assert.equal(parseSqlMajorVersion("14"), 14);
    assert.equal(parseSqlMajorVersion("bad"), 0);
  });

  it("accepts a candidate that fits edition, version, memory, IOPS, and throughput", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.r8i.4xlarge", {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.entry?.instanceClass, "db.r8i.4xlarge");
  });

  it("rejects memory underfit", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.m8i.4xlarge", {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("MEMORY_UNDERFIT")));
  });

  it("rejects IOPS and throughput underfit", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.r8i.4xlarge", {
      memoryGb: 96,
      iops: 70000,
      throughputMbps: 2000
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("IOPS_UNDERFIT")));
    assert.ok(result.failures.some((failure) => failure.startsWith("THROUGHPUT_UNDERFIT")));
  });

  it("rejects unsupported SQL version", () => {
    const result = isOrderableCandidate(catalog, { sqlServerEdition: "Standard", sqlServerVersion: "14.00" }, "db.x2iedn.8xlarge", {
      memoryGb: 512,
      iops: 40000,
      throughputMbps: 1200
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("SQL_VERSION_BELOW_MIN")));
  });

  it("rejects unsupported edition and edition vCPU limit", () => {
    const result = isOrderableCandidate(catalog, standardSql2022, "db.x2m.16xlarge", {
      memoryGb: 512,
      iops: 40000,
      throughputMbps: 1200
    });

    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.startsWith("EDITION_NOT_SUPPORTED")));
    assert.ok(result.failures.some((failure) => failure.startsWith("EDITION_VCPU_LIMIT_EXCEEDED")));
  });

  it("returns the first valid candidate in catalog order supplied by caller", () => {
    const result = findCheapestValidByCatalogOrder(catalog, standardSql2022, ["db.m8i.4xlarge", "db.r8i.4xlarge"], {
      memoryGb: 96,
      iops: 30000,
      throughputMbps: 900
    });

    assert.equal(result.valid, true);
    assert.equal(result.entry?.instanceClass, "db.r8i.4xlarge");
  });
});