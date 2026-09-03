import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, WorkloadProfile } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { analyzeWorkloadRequest, exportWorkloadReports, normalizeCollectorExcelInput, normalizeCollectorRunManifestInput, parseRdsRegionFromEndpoint, validateAnalyzeWorkloadRequest, validateCollectorExcelInput } from "../src/api/index.js";
import { productionWorkload } from "./production-workload.js";

const catalog: InstanceCatalogEntry[] = [
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

function workload(): WorkloadProfile {
  return productionWorkload({
    sqlCpuPct: 15,
    currentMemoryGb: 256,
    totalIops: 6000,
    totalThroughputMibPerSec: 200
  });
}

function request(overrides = {}) {
  return {
    catalog,
    exportFormats: ["json", "csv", "pdf"] as const,
    servers: [
      {
        serverName: "prod-sql-01",
        currentConfig,
        workload: workload(),
        currentVcpu: 32,
        orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
        requirements: {
          memoryGb: 48,
          iops: 6000,
          throughputMbps: 200
        }
      }
    ],
    ...overrides
  };
}


describe("collector Excel input", () => {
  it("API-API-001: validates local credentials without exposing login or password", () => {
    const response = normalizeCollectorExcelInput({
      rdsEndpoint: "mydb.abc123.us-east-2.rds.amazonaws.com",
      login: "admin",
      password: "SecretPassword123!",
      existingInstanceClass: "db.r8i.4xlarge",
      vendorSupportsStandardEdition: "yes",
      migrationPathAccepted: "true",
      migrationPath: "AWS DMS"
    });

    assert.equal(response.ok, true);
    if (!response.ok) return;
    assert.equal(response.collectorInput.region, "us-east-2");
    assert.equal(response.collectorInput.database, "msdb");
    assert.equal(response.collectorInput.existingInstanceClass, "db.r8i.4xlarge");
    assert.equal(response.collectorInput.vendorSupportsStandardEdition, true);
    assert.equal(response.collectorInput.migrationPathAccepted, true);
    assert.equal(response.collectorInput.migrationPath, "aws_dms");
    assert.equal(JSON.stringify(response.collectorInput).includes("admin"), false);
    assert.equal(JSON.stringify(response.collectorInput).includes("SecretPassword123!"), false);
  });

  it("API-API-002: validates required collector spreadsheet fields", () => {
    const errors = validateCollectorExcelInput({
      rdsEndpoint: "",
      login: "",
      password: "",
      existingInstanceClass: "r8i.4xlarge"
    });

    assert.ok(errors.some((error) => error.code === "RDS_ENDPOINT_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "LOGIN_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "PASSWORD_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "EXISTING_INSTANCE_INVALID"));
  });

  it("API-API-003: allows collector run manifests to use non-RDS server identifiers", () => {
    const response = normalizeCollectorRunManifestInput({
      rdsEndpoint: "GAP_96XL_IOPS",
      login: "",
      password: "",
      existingInstanceClass: ""
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    if (!response.ok) return;
    assert.equal(response.collectorInput.rdsEndpoint, "GAP_96XL_IOPS");
    assert.equal(response.collectorInput.region, undefined);
  });

  it("API-API-004: parses region from standard RDS endpoints", () => {
    assert.equal(parseRdsRegionFromEndpoint("mydb.abc123.eu-central-1.rds.amazonaws.com"), "eu-central-1");
    assert.equal(parseRdsRegionFromEndpoint("not-rds.example.com"), undefined);
  });
});
describe("analyzeWorkloadRequest", () => {
  it("API-API-005: returns workload analysis reports and requested exports", () => {
    const response = analyzeWorkloadRequest(request());

    assert.equal(response.ok, true);
    if (!response.ok) return;
    assert.equal(response.reports.length, 1);
    assert.equal(response.summary.totalServers, 1);
    assert.equal(response.summary.optimizedServers, 1);
    assert.equal(response.summary.notOptimizedServers, 0);
    assert.equal(response.reports[0].status, "aggressive_optimization");
    assert.equal(response.reports[0].pricingDeferred, true);
    assert.ok(response.exports.json?.includes('"summary"'));
    assert.ok(response.exports.json?.includes('"serverName": "prod-sql-01"'));
    assert.ok(response.exports.csv?.startsWith("summaryTotalServers,summaryOptimizedServers,summaryRecommendedServers,summaryAggressiveOptimizationServers,summaryNotOptimizedServers,serverName,status,decision,risk"));
    assert.ok(response.exports.pdf && Buffer.from(response.exports.pdf, "base64").toString("utf8").startsWith("%PDF-1.4"));
  });

  it("API-API-006: returns validation errors instead of running analysis when required inputs are missing", () => {
    const response = analyzeWorkloadRequest({ catalog: [], servers: [] });

    assert.equal(response.ok, false);
    if (response.ok) return;
    assert.ok(response.errors.some((error) => error.code === "CATALOG_REQUIRED"));
    assert.ok(response.errors.some((error) => error.code === "SERVERS_REQUIRED"));
  });

  it("API-API-007: validates per-server workload inputs", () => {
    const invalid = request({
      servers: [
        {
          serverName: "prod-sql-01",
          currentConfig,
          workload: {
            ...workload(),
            collectionHours: 0,
            cpuPct: { ...dist(15), p95: Number.NaN }
          },
          currentVcpu: 0,
          orderedCandidateInstanceClasses: [],
          requirements: {
            memoryGb: 0,
            iops: -1,
            throughputMbps: -1
          }
        }
      ]
    });

    const errors = validateAnalyzeWorkloadRequest(invalid);

    assert.ok(errors.some((error) => error.code === "CURRENT_VCPU_INVALID"));
    assert.ok(errors.some((error) => error.code === "CANDIDATES_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "MEMORY_REQUIREMENT_INVALID"));
    assert.ok(errors.some((error) => error.field === "workload.cpuPct.p95"));
    assert.ok(errors.some((error) => error.code === "COLLECTION_HOURS_INVALID"));
  });

  it("API-API-008: exports reports directly as JSON or CSV", () => {
    const response = analyzeWorkloadRequest(request({ exportFormats: ["json"] as const }));
    assert.equal(response.ok, true);
    if (!response.ok) return;

    const json = exportWorkloadReports(response.reports, "json");
    const csv = exportWorkloadReports(response.reports, "csv");
    const pdf = exportWorkloadReports(response.reports, "pdf");

    assert.equal(JSON.parse(json).summary.optimizedServers, 1);
    assert.ok(csv.includes("prod-sql-01"));
    assert.ok(Buffer.from(pdf, "base64").toString("utf8").includes("Pricing is not included"));
  });
});



