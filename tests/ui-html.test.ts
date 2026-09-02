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
      projectedSqlCpuP95Pct: 40,
      projectedSqlCpuP99Pct: 55,
      projectedTotalCpuP99Pct: 68,
      requiredMemoryGb: 96,
      memoryRequiredFloorGb: 96,
      candidateMemoryGb: 128,
      requiredIops: 8000,
      iopsP95: 8000,
      candidateBaselineIops: 50000,
      requiredThroughputMbps: 300,
      throughputP95: 300,
      candidateBaselineThroughputMbps: 1250
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
    assert.ok(html.includes("Customer name"));
    assert.ok(html.includes("name=\"customerName\""));
    assert.ok(html.includes("RDSSize"));
    assert.equal(html.includes("CompareInstanceClass"), false);
    assert.ok(html.includes("collectorPackages"));
    assert.ok(html.includes("data-upload-form"));
    assert.ok(html.includes("data-upload-status"));
    assert.ok(html.includes("Analyzing uploads..."));
    assert.equal(html.includes("requesterEmail"), false);
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
        currentConfig: {
          ...currentConfig,
          regionSource: "fallback",
          regionFallbackReason: "RDS endpoint region could not be inferred; using us-east-1.",
          catalogMatch: false,
          catalogComparisonNote: "Collector output did not include RDSSize; current class is unknown.",
          instanceClass: "unknown",
          storageType: "unknown",
          storageFactsComplete: false,
          storageFactsMissing: ["storage type", "provisioned IOPS"],
          multiAz: "unknown"
        },
        recommendedConfig: undefined,
        decision: "Not Recommended",
        risk: "blocked",
        confidence: "preliminary",
        evidenceWindow: assessEvidenceWindowFromDuration(1),
        blockers: [
          { code: "MEMORY_UNDERFIT", dimension: "memory", message: "No smaller candidate has enough memory." }
        ],
        passedChecks: []
      })
    });
    const aggressive = buildWorkloadOptimizationReport({
      serverName: "validation-sql",
      result: result({
        decision: "Aggressive Optimization",
        risk: "medium",
        confidence: "medium"
      })
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 3,
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
        },
        {
          rdsEndpoint: "validation-sql.abc123.us-east-1.rds.amazonaws.com",
          database: "msdb",
          existingInstanceClass: "db.r8i.8xlarge",
          region: "us-east-1"
        }
      ],
      analysis: { results: [], batch: { results: [] } },
      reports: [optimized, aggressive, blocked],
      summary: buildWorkloadOptimizationSummary([optimized, aggressive, blocked]),
      exports: { json: "{}", csv: "serverName", pdf: "JVBERi0xLjQ=" }
    };

    const html = renderManualUploadResultsHtml(buildManualUploadResultsView(response));

    assert.ok(html.includes("Server Decisions"));
    assert.ok(html.includes("fleet-server-row-wrap"));
    assert.ok(html.includes("<span>Current -> Target</span>"));
    assert.ok(html.includes("<span>Reason</span>"));
    assert.ok(html.includes("Open"));
    assert.ok(html.includes("Assessment Notes"));
    assert.ok(html.includes("These items limit a full assessment"));
    assert.ok(html.includes("RDS endpoint region could not be inferred"));
    assert.ok(html.includes("Collector output did not include RDSSize"));
    assert.ok(html.includes("Storage facts missing from collector output: storage type, provisioned IOPS"));
    assert.ok(html.includes("Multi-AZ status was not provided"));
    assert.ok(html.includes("Evidence window is insufficient"));
    assert.ok(html.includes("Projected SQL CPU"));
    assert.ok(html.includes("Workload Fit Checks"));
    assert.equal(html.includes("Resource Gate Matrix"), false);
    assert.ok(html.includes("<summary>Show candidate summary and evaluation history</summary>"));
    assert.equal(/<details class="candidate-history-details"\s+open/.test(html), false);
    assert.ok(html.includes("Candidate Summary"));
    assert.equal(html.includes("<summary>Show server evidence, blockers, gates, and candidate history</summary>"), false);
    assert.equal(/<details class="fleet-server-row-wrap [^"]+"\s+open/.test(html), false);
    assert.ok(html.includes("<details class=\"supporting-evidence\">"));
    assert.ok(html.includes("<summary>Show supporting evidence</summary>"));
    assert.ok(html.includes("Supporting Evidence"));
    assert.ok(html.includes("Supporting evidence is retained for analyst review; it is not the recommendation."));
    assert.equal(html.includes("<h3>Advisory Signals</h3>"), false);
    assert.equal(/<details class="supporting-evidence"\s+open/.test(html), false);
    assert.ok(html.includes("Stay As Is"));
    assert.ok(html.includes("Stay As Is"));
    assert.equal(html.includes("BLOCKED risk"), false);
    assert.equal(html.includes("Assessment Result</span>\n          <strong>Not Recommended</strong>"), false);
    assert.equal(html.includes("L2L Fallback"), false);
    assert.equal(html.includes("<dd>Blocked</dd>"), false);
    assert.ok(html.includes("Reasons to Stay As Is"));
    assert.ok(html.includes("issue-panel critical"));
    assert.ok(html.includes("fleet-server-row-wrap not_recommended"));
    assert.ok(html.includes("Projected SQL CPU"));
    assert.ok(html.includes("Total servers"));
    assert.ok(html.includes("Multi-server assessment"));
    assert.ok(html.includes("Outcome groups"));
    assert.ok(html.includes("validation-sql"));
    assert.ok(html.includes("No servers in this outcome") === false);
    assert.ok(html.includes("Scaled Down to db.r8i.4xlarge"));
    assert.ok(html.includes("Stay as is"));
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
    assert.equal(html.includes("Generated Report Artifacts"), false);
    assert.equal(html.includes("Assessment Artifact Inventory"), false);
    assert.equal(html.includes("Structured JSON evidence package"), false);
    assert.equal(html.includes("CSV decision matrix"), false);
    assert.ok(html.includes("Evidence Window"));
    assert.ok(html.includes("Customer must verbally confirm"));
    assert.ok(html.includes("orders"));
    assert.equal(html.includes("SecretPassword123!"), false);
    assert.equal(html.includes("monthly savings"), false);
    assert.equal(html.includes("dollar savings"), false);
  });

  it("keeps single-server analysis details visible without the multi-server collapse wrapper", () => {
    const optimized = buildWorkloadOptimizationReport({
      serverName: "optimized-sql",
      result: result()
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 1,
      collectorInputs: [
        {
          rdsEndpoint: "optimized-sql.abc123.us-east-1.rds.amazonaws.com",
          database: "msdb",
          existingInstanceClass: "db.r8i.8xlarge",
          region: "us-east-1"
        }
      ],
      analysis: { results: [], batch: { results: [] } },
      reports: [optimized],
      summary: buildWorkloadOptimizationSummary([optimized]),
      exports: { json: "{}", csv: "serverName", pdf: "JVBERi0xLjQ=" }
    };

    const html = renderManualUploadResultsHtml(buildManualUploadResultsView(response));

    assert.ok(html.includes("Workload Fit Checks"));
    assert.ok(html.includes("<summary>Show details and evidence</summary>"));
    assert.ok(html.includes("<summary>Show candidate summary and evaluation history</summary>"));
    assert.equal(/<details class="candidate-history-details"\s+open/.test(html), false);
    assert.equal(html.includes("<summary>Show server evidence, blockers, gates, and candidate history</summary>"), false);
  });

  it("renders reason-only resource gates without n/a metric rows", () => {
    const blocked = buildWorkloadOptimizationReport({
      serverName: "blocked-sql",
      result: result({
        recommendedConfig: undefined,
        decision: "Not Recommended",
        risk: "blocked",
        limitingResources: [
          {
            dimension: "cpu",
            scope: "compute",
            status: "blocking",
            reason: "No selected candidate was available for CPU projection."
          }
        ],
        blockers: [
          { code: "CPU_CANDIDATE_UNAVAILABLE", dimension: "cpu", message: "No selected candidate was available for CPU projection." }
        ],
        passedChecks: []
      })
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 1,
      collectorInputs: [
        {
          rdsEndpoint: "blocked-sql.abc123.us-east-1.rds.amazonaws.com",
          database: "msdb",
          existingInstanceClass: "db.r8i.8xlarge",
          region: "us-east-1"
        }
      ],
      analysis: { results: [], batch: { results: [] } },
      reports: [blocked],
      summary: buildWorkloadOptimizationSummary([blocked]),
      exports: {}
    };

    const html = renderManualUploadResultsHtml(buildManualUploadResultsView(response));

    assert.ok(html.includes("Workload Fit Checks"));
    assert.ok(html.includes("No selected candidate was available for CPU projection."));
    assert.equal(html.includes("<dt>Observed</dt><dd>n/a</dd>"), false);
    assert.equal(html.includes("<dt>Limit</dt><dd>n/a</dd>"), false);
    assert.equal(html.includes("<dt>Utilization</dt><dd>n/a</dd>"), false);
    assert.equal(html.includes("<dt>Attribution</dt><dd>Server-level</dd>"), false);
  });

  it("renders short collection windows as evidence checks while keeping fallback visible", () => {
    const blocked = buildWorkloadOptimizationReport({
      serverName: "short-window-sql",
      result: result({
        recommendedConfig: undefined,
        decision: "Not Recommended",
        risk: "blocked",
        limitingResources: [
          {
            dimension: "cpu",
            scope: "compute",
            status: "blocking",
            reason: "Observed 1.01 collected hours is below the 48 hour minimum evidence window."
          }
        ],
        blockers: [
          {
            code: "COLLECTION_WINDOW_TOO_SHORT",
            dimension: "cpu",
            message: "Observed 1.01 collected hours is below the 48 hour minimum evidence window."
          }
        ],
        passedChecks: []
      })
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 1,
      collectorInputs: [
        {
          rdsEndpoint: "short-window-sql.abc123.us-east-1.rds.amazonaws.com",
          database: "msdb",
          existingInstanceClass: "db.r8i.8xlarge",
          region: "us-east-1"
        }
      ],
      analysis: { results: [], batch: { results: [] } },
      reports: [blocked],
      summary: buildWorkloadOptimizationSummary([blocked]),
      exports: {}
    };

    const html = renderManualUploadResultsHtml(buildManualUploadResultsView(response));

    assert.ok(html.includes("Workload Fit Checks"));
    assert.ok(html.includes("<strong>Evidence Check</strong>"));
    assert.ok(html.includes("Observed 1.01 collected hours is below the 48 hour minimum evidence window."));
    assert.ok(html.includes("Stay As Is"));
    assert.ok(html.includes("Stay As Is"));
    assert.ok(html.includes("Stay as is on the current instance (db.r8i.8xlarge) because insufficient evidence window"));
    assert.ok(html.includes("Why Stay As Is"));
    assert.ok(html.includes("Reassess only after"));
    assert.ok(html.includes("representative collection window of at least 7 days"));
    assert.equal(html.includes("CPU target does not fit the proposed candidate"), false);
    assert.equal(html.includes("BLOCKED risk"), false);
    assert.equal(html.includes("<strong>Not Recommended</strong>"), false);
    assert.equal(html.includes("<strong>Cpu</strong>"), false);
    assert.equal(html.includes("<dt>Observed</dt><dd>n/a</dd>"), false);
    assert.equal(html.includes("<dt>Limit</dt><dd>n/a</dd>"), false);
    assert.equal(html.includes("<dt>Utilization</dt><dd>n/a</dd>"), false);
    assert.equal(html.includes("<dt>Attribution</dt><dd>Server-level</dd>"), false);
  });
});

