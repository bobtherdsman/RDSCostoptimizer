import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, OptimizationResult } from "../src/contracts/types.js";
import type { ManualUploadSuccessResponse } from "../src/upload/index.js";
import { buildWorkloadOptimizationReport, buildWorkloadOptimizationSummary } from "../src/reports/index.js";
import { buildManualUploadResultsView } from "../src/ui/index.js";
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

describe("buildManualUploadResultsView", () => {
  it("builds a descriptive optimized vs not optimized results view model", () => {
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

    const view = buildManualUploadResultsView(response);

    assert.equal(view.title, "RDS SQL Server Workload Optimization Results");
    assert.equal(view.fleet.totalServers, 2);
    assert.equal(view.fleet.optimizedServers, 1);
    assert.equal(view.fleet.notOptimizedServers, 1);
    assert.deepEqual(view.fleet.optimizedServerNames, ["optimized-sql"]);
    assert.deepEqual(view.fleet.notOptimizedServerNames, ["blocked-sql"]);

    assert.equal(view.servers[0].statusLabel, "Recommended");
    assert.equal(view.servers[0].current.instanceClass, "db.r8i.8xlarge");
    assert.equal(view.servers[0].optimized.instanceClass, "db.r8i.4xlarge");
    assert.ok(view.servers[0].whyOptimized.some((reason) => reason.includes("32 vCPU")));
    assert.ok(view.servers[0].limitingResources.some((item) =>
      item.includes("Top database: orders")
    ));
    assert.ok(view.servers[0].candidateEvaluations.some((item) =>
      item.includes("Selected db.r8i.4xlarge")
    ));
    assert.equal(view.servers[0].topDatabaseDrivers[0].databaseName, "orders");
    assert.equal(view.servers[0].topDatabaseDrivers[0].tempdbSharePct, "60%");
    assert.equal(view.servers[0].evidenceWindow.duration, "14 days");
    assert.equal(view.servers[0].evidenceWindow.continuity, "unavailable (0 issue(s))");
    assert.match(view.servers[0].evidenceWindow.representativeness, /Customer must verbally confirm/);

    assert.equal(view.servers[1].statusLabel, "Not Recommended");
    assert.equal(view.servers[1].optimized.instanceClass, "Blocked");
    assert.ok(view.servers[1].whyNotOptimized.some((reason) => reason.includes("No smaller candidate has enough memory")));
    assert.ok(view.servers[1].actionPlan.some((action) => action.startsWith("Memory blocks")));
    assert.ok(view.exportActions.every((action) => action.available));
    assert.ok(view.exportActions.every((action) => action.href?.startsWith("data:")));
    assert.ok(view.exportActions.every((action) => action.filename?.startsWith("rds-cost-optimization.")));
  });
});
