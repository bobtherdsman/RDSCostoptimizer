import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, OptimizationResult } from "../src/contracts/types.js";
import type { ManualUploadSuccessResponse } from "../src/upload/index.js";
import { buildWorkloadOptimizationReport, buildWorkloadOptimizationSummary } from "../src/reports/index.js";
import { buildManualUploadResultsView } from "../src/ui/index.js";
import { buildManualUploadPageView, renderAssessmentPageHtml, renderManualUploadPageHtml, renderManualUploadResultsHtml, renderOfferingServicesPageHtml } from "../src/ui/html.js";
import { assessEvidenceWindowFromDuration } from "../src/evidence-window/index.js";

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

function result(overrides: Partial<OptimizationResult> = {}): OptimizationResult {
  return {
    currentConfig,
    recommendedConfig: {
      ...currentConfig,
      instanceClass: "db.r8i.4xlarge"
    },
    decision: "Recommended",
    optimizationEvidence: {
      currentVcpu: 32,
      optimizedVcpu: 16,
      cpuP95Pct: 20,
      projectedCpuPct: 40,
      requiredMemoryGb: 96,
      requiredIops: 8000,
      requiredThroughputMbps: 300
    },
    risk: "medium",
    confidence: "high",
    evidenceWindow: assessEvidenceWindowFromDuration(336),
    blockers: [],
    topOffendingDatabases: [
      {
        databaseName: "orders",
        iops: dist(8000),
        throughputMbps: dist(300),
        sizeGb: 300,
        tempdbSharePct: 60
      }
    ],
    limitingResources: [
      {
        dimension: "iops",
        scope: "compute",
        status: "within_limit",
        observed: 8000,
        limit: 50000,
        unit: "IOPS",
        reason: "Physical IOPS fits the candidate capability.",
        topDatabaseName: "orders",
        topDatabaseMetric: "IOPS P95",
        topDatabaseValue: 8000
      }
    ],
    candidateEvaluations: [
      {
        instanceClass: "db.r8i.4xlarge",
        sqlServerVisibleVcpu: 16,
        cpuConfigurationType: "default",
        accepted: true,
        selected: true,
        decision: "Recommended",
        passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
        failedGates: [],
        limitingResources: []
      }
    ],
    passedChecks: ["CPU_TARGET_FIT", "MEMORY_FIT", "IOPS_FIT", "THROUGHPUT_FIT"],
    ...overrides
  };
}

describe("manual upload HTML", () => {
  it("renders a concise business overview separate from the assessment workspace", () => {
    const view = buildManualUploadPageView();
    const html = renderManualUploadPageHtml(view);

    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("Reduce database spend with evidence, not guesswork."));
    assert.ok(html.includes("Solutions"));
    assert.ok(html.includes("Resources"));
    assert.ok(html.includes("About Us"));
    assert.ok(html.includes("Login"));
    assert.ok(html.includes("Why It Matters"));
    assert.ok(html.includes("What We Do"));
    assert.ok(html.includes("What You Get"));
    assert.ok(html.includes("Offering services"));
    assert.ok(html.includes("/cost/services"));
    assert.ok(html.includes("View Offering Services"));
    assert.ok(html.includes("/cost/assessment"));
    assert.equal(html.includes("Download Collector"), false);
    assert.equal(html.includes("collectorPackages"), false);
    assert.equal(html.includes("Frequently asked questions"), false);
  });

  it("renders offering services on their own page", () => {
    const view = buildManualUploadPageView();
    const html = renderOfferingServicesPageHtml(view);

    assert.ok(html.includes("Offering services"));
    assert.ok(html.includes("Start Assessment"));
    assert.ok(html.includes("/cost/assessment"));
    assert.ok(html.includes("Download Collector"));
    assert.ok(html.includes("/cost/collector"));
    assert.equal(html.includes("collectorPackages"), false);
  });

  it("renders the focused assessment upload contract", () => {
    const view = buildManualUploadPageView();
    const html = renderAssessmentPageHtml(view);

    assert.ok(html.includes("Assessment workspace"));
    assert.ok(html.includes("Download Collector"));
    assert.ok(html.includes("/cost/collector"));
    assert.ok(html.includes("Back to Overview"));
    assert.ok(html.includes("RDSSize"));
    assert.equal(html.includes("CompareInstanceClass"), false);
    assert.ok(html.includes("collectorPackages"));
    assert.equal(html.includes("collectorSpreadsheet"), false);
    assert.ok(html.includes("Pricing is deferred"));
  });

  it("renders descriptive results without password or dollar savings claims", () => {
    const optimized = buildWorkloadOptimizationReport({
      serverName: "optimized-sql",
      result: result()
    });
    const blocked = buildWorkloadOptimizationReport({
      serverName: "blocked-sql",
      result: result({
        recommendedConfig: undefined,
        decision: "Not Recommended",
        risk: "blocked",
        blockers: [
          { code: "MEMORY_UNDERFIT", dimension: "memory", message: "No smaller candidate has enough memory." }
        ],
        passedChecks: []
      })
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 2,
      collectorInputs: [
        {
          rdsEndpoint: "optimized-sql.abc123.us-east-1.rds.amazonaws.com",
          database: "msdb",
          existingInstanceClass: "db.r8i.8xlarge",
          region: "us-east-1"
        },
        {
          rdsEndpoint: "blocked-sql.abc123.us-east-1.rds.amazonaws.com",
          database: "msdb",
          existingInstanceClass: "db.r8i.8xlarge",
          region: "us-east-1"
        }
      ],
      analysis: { results: [], batch: { results: [] } },
      reports: [optimized, blocked],
      summary: buildWorkloadOptimizationSummary([optimized, blocked]),
      exports: { json: "{}", csv: "serverName", pdf: "JVBERi0xLjQ=" }
    };

    const html = renderManualUploadResultsHtml(buildManualUploadResultsView(response));

    assert.ok(html.includes("CPU samples &gt;=70%"));
    assert.ok(html.includes("Longest &gt;=70% streak"));
    assert.ok(html.includes("Total servers"));
    assert.ok(html.includes("Optimized"));
    assert.ok(html.includes("Not recommended"));
    assert.ok(html.includes("db.r8i.8xlarge"));
    assert.ok(html.includes("db.r8i.4xlarge"));
    assert.ok(html.includes("Why Optimized"));
    assert.ok(html.includes("data:application/json;base64"));
    assert.ok(html.includes("download=\"rds-cost-optimization.json\""));
    assert.ok(html.includes("data:application/pdf;base64"));
    assert.ok(html.includes("No smaller candidate has enough memory."));
    assert.ok(html.includes("Top Database Drivers"));
    assert.ok(html.includes("Resource Gates"));
    assert.ok(html.includes("Top database: orders"));
    assert.ok(html.includes("Candidate Evaluation History"));
    assert.ok(html.includes("Evidence Window"));
    assert.ok(html.includes("Customer must verbally confirm"));
    assert.ok(html.includes("orders"));
    assert.equal(html.includes("SecretPassword123!"), false);
    assert.equal(html.includes("monthly savings"), false);
    assert.equal(html.includes("dollar savings"), false);
  });
});

