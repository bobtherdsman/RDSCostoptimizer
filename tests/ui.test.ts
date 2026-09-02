import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, OptimizationResult, WorkloadEvidence } from "../src/contracts/types.js";
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

describe("buildManualUploadResultsView", () => {
  it("builds a descriptive scaled-down vs stay-as-is results view model", () => {
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

    const view = buildManualUploadResultsView(response);

    assert.equal(view.title, "RDS SQL Server Workload Optimization Results");
    assert.equal(view.fleet.totalServers, 3);
    assert.equal(view.fleet.optimizedServers, 2);
    assert.equal(view.fleet.recommendedServers, 1);
    assert.equal(view.fleet.aggressiveOptimizationServers, 1);
    assert.equal(view.fleet.notOptimizedServers, 1);
    assert.deepEqual(view.fleet.optimizedServerNames, ["optimized-sql", "validation-sql"]);
    assert.deepEqual(view.fleet.notOptimizedServerNames, ["blocked-sql"]);
    assert.deepEqual(
      view.fleet.outcomeGroups.map((group) => [group.label, group.count, group.serverNames]),
      [
        ["Recommended", 1, ["optimized-sql"]],
        ["Aggressive Optimization", 1, ["validation-sql"]],
        ["Stay As Is", 1, ["blocked-sql"]]
      ]
    );

    assert.equal(view.servers[0].statusLabel, "Scaled Down to db.r8i.4xlarge");
    assert.match(view.servers[0].decisionSummary, /Scale down from db\.r8i\.8xlarge to db\.r8i\.4xlarge/);
    assert.ok(view.servers[0].visualMetrics.some((metric) =>
      metric.label === "Projected SQL CPU" && metric.value === "40% / 55%"
    ));
    assert.ok(view.servers[0].resourceGates.some((gate) =>
      gate.dimension === "IOPS" && gate.statusLabel === "Within limit" && gate.topDatabase.includes("orders")
    ));
    assert.ok(view.servers[0].candidateSummary.some((candidate) =>
      candidate.instanceClass === "db.r8i.4xlarge" && candidate.state === "selected"
    ));
    assert.equal(view.servers[0].current.instanceClass, "db.r8i.8xlarge");
    assert.equal(view.servers[0].optimized.instanceClass, "db.r8i.4xlarge");
    assert.ok(view.servers[0].whyOptimized.some((reason) => reason.includes("32 vCPU")));
    assert.ok(view.servers[0].limitingResources.some((item) =>
      item.includes("Top database: orders")
    ));
    assert.ok(view.servers[0].candidateEvaluations.some((item) =>
      item.includes("Selected db.r8i.4xlarge")
    ));
    assert.ok(view.artifactBundle.some((artifact) => artifact.label === "Structured JSON evidence package"));
    assert.ok(view.servers[0].assessmentArtifacts.some((artifact) =>
      artifact.includedSections.includes("candidate evaluation history")
    ));
    assert.equal(view.servers[0].topDatabaseDrivers[0].databaseName, "orders");
    assert.equal(view.servers[0].topDatabaseDrivers[0].tempdbSharePct, "60%");
    assert.equal(view.servers[0].evidenceWindow.duration, "14 days");
    assert.equal(view.servers[0].evidenceWindow.continuity, "unavailable (0 issue(s))");
    assert.match(view.servers[0].evidenceWindow.representativeness, /Customer must verbally confirm/);

    assert.equal(view.servers[1].statusLabel, "Scaled Down to db.r8i.4xlarge");
    assert.equal(view.servers[2].statusLabel, "Stay As Is");
    assert.equal(view.servers[2].riskLabel, "Current instance retained");
    assert.equal(view.servers[2].assessmentDetail, "Current instance retained | high confidence");
    assert.equal(view.servers[2].optimizedTitle, "Stay As Is");
    assert.equal(view.servers[2].optimized.instanceClass, "db.r8i.8xlarge");
    assert.match(view.servers[2].decisionSummary, /Stay as is on db\.r8i\.8xlarge because/);
    assert.ok(view.servers[2].whyNotOptimized.some((reason) => reason.includes("No smaller candidate has enough memory")));
    assert.ok(view.servers[2].actionPlan.some((action) => action.startsWith("Memory blocks")));
    assert.ok(view.exportActions.every((action) => action.available));
    assert.ok(view.exportActions.every((action) => action.href?.startsWith("data:")));
    assert.ok(view.exportActions.every((action) => action.filename?.startsWith("rds-cost-optimization.")));
  });

  it("explains blocked metric cards when no candidate is selected", () => {
    const workloadEvidence: WorkloadEvidence = {
      memory: {
        requiredMemoryFloorGb: 13.35,
        headroomPct: 20,
        pressureSignals: []
      },
      topDatabasesByIops: [],
      topDatabasesByThroughput: [],
      fileLatency: [],
      waitStats: []
    };
    const blocked = buildWorkloadOptimizationReport({
      serverName: "short-window-sql",
      result: result({
        recommendedConfig: undefined,
        decision: "Not Recommended",
        risk: "blocked",
        confidence: "preliminary",
        optimizationEvidence: {
          currentVcpu: 32,
          cpuP95Pct: 0,
          iopsP95: 3.25,
          throughputP95: 0.03,
          requiredMemoryGb: 13.35,
          requiredIops: 3.25,
          requiredThroughputMbps: 0.03
        },
        evidence: workloadEvidence,
        candidateEvaluations: [],
        limitingResources: [
          {
            dimension: "cpu",
            scope: "compute",
            status: "blocking",
            reason: "Observed 1.01 collected hours is below the 48 hour minimum evidence window."
          }
        ],
        blockers: [
          { code: "COLLECTION_WINDOW_TOO_SHORT", dimension: "cpu", message: "Evidence window is insufficient." }
        ],
        passedChecks: []
      })
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 1,
      collectorInputs: [{
        rdsEndpoint: "short-window-sql.abc123.us-east-1.rds.amazonaws.com",
        database: "msdb",
        existingInstanceClass: "db.r8i.8xlarge",
        region: "us-east-1"
      }],
      analysis: { results: [], batch: { results: [] } },
      reports: [blocked],
      summary: buildWorkloadOptimizationSummary([blocked]),
      exports: {}
    };

    const view = buildManualUploadResultsView(response);
    const metrics = new Map(view.servers[0].visualMetrics.map((metric) => [metric.label, metric.value]));

    assert.equal(metrics.get("Visible vCPU"), "32 -> 32");
    assert.equal(metrics.get("Projected SQL CPU"), "Current instance retained");
    assert.equal(metrics.get("Memory Fit"), "13.35 / current instance");
    assert.equal(metrics.get("IOPS Fit"), "3.25 / current instance");
    assert.equal(metrics.get("Throughput Fit"), "0.03 / current instance");
    assert.equal(view.servers[0].statusLabel, "Stay As Is");
    assert.equal(view.servers[0].riskLabel, "Current instance retained");
    assert.equal(view.servers[0].assessmentDetail, "Current instance retained | preliminary confidence");
    assert.match(view.servers[0].decisionSummary, /Stay as is on db\.r8i\.8xlarge because Observed 1\.01 collected hours/);
    assert.equal(view.servers[0].candidateVisibleVcpu, "32");
    assert.equal(view.servers[0].candidateCpuConfiguration, "Current configuration retained");
    assert.equal(view.servers[0].optimizedTitle, "Stay As Is");
    assert.equal(view.servers[0].optimized.instanceClass, "db.r8i.8xlarge");
    assert.ok(view.servers[0].actionPlan[0].startsWith("Stay as is on the current instance (db.r8i.8xlarge) because insufficient evidence window"));
    assert.ok(view.servers[0].actionPlan[0].includes("Reassess only after"));
    assert.ok(view.servers[0].actionPlan[0].includes("representative collection window of at least 7 days"));
    assert.equal(view.servers[0].actionPlan.some((action) => action.includes("CPU target does not fit")), false);
    assert.equal(view.servers[0].projectedSqlCpuP95Pct, "Not projected");
    assert.equal(view.servers[0].resourceGates[0].dimension, "Evidence Check");
    assert.equal(view.servers[0].resourceGates[0].scope, "evidence");
    assert.deepEqual(view.servers[0].resourceGates[0].details, []);
    assert.match(view.servers[0].resourceGates[0].reason, /1\.01 collected hours/);
    assert.ok(view.servers[0].memoryAssessment.some((line) => line.includes("Less-elastic floor") && line.includes("13.35 GB")));
    assert.ok(view.servers[0].ioAssessment.some((line) => line.includes("candidate sustained/maximum: No selected candidate")));
  });

  it("does not show AWS-managed rdsadmin as a customer database driver", () => {
    const report = buildWorkloadOptimizationReport({
      serverName: "prod-sql-01",
      result: result({
        topOffendingDatabases: [
          {
            databaseName: "rdsadmin",
            iops: dist(9000),
            throughputMbps: dist(400),
            iopsSharePct: 90,
            throughputSharePct: 90
          },
          {
            databaseName: "orders",
            iops: dist(1000),
            throughputMbps: dist(50),
            iopsSharePct: 10,
            throughputSharePct: 10
          }
        ],
        limitingResources: [
          {
            dimension: "iops",
            scope: "compute",
            status: "within_limit",
            observed: 1000,
            limit: 50000,
            utilizationPct: 2,
            unit: "IOPS",
            reason: "Physical IOPS fits the candidate capability.",
            topDatabaseName: "rdsadmin",
            topDatabaseMetric: "IOPS P95",
            topDatabaseValue: 9000
          }
        ],
        evidence: {
          topDatabasesByIops: [],
          topDatabasesByThroughput: [],
          fileLatency: [
            {
              databaseName: "rdsadmin",
              fileType: "ROWS",
              readLatencyMs: 99,
              advisory: ["AWS-managed database latency evidence."]
            },
            {
              databaseName: "orders",
              fileType: "ROWS",
              readLatencyMs: 12,
              advisory: ["Observed average read latency: 12 ms."]
            }
          ],
          waitStats: []
        }
      })
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 1,
      collectorInputs: [{
        rdsEndpoint: "prod-sql-01.abc123.us-east-1.rds.amazonaws.com",
        database: "msdb",
        existingInstanceClass: "db.r8i.8xlarge",
        region: "us-east-1"
      }],
      analysis: { results: [], batch: { results: [] } },
      reports: [report],
      summary: buildWorkloadOptimizationSummary([report]),
      exports: {}
    };

    const view = buildManualUploadResultsView(response);

    assert.deepEqual(view.servers[0].topDatabaseDrivers.map((driver) => driver.databaseName), ["orders"]);
    assert.equal(view.servers[0].resourceGates[0].topDatabase, "Server-level");
    assert.ok(view.servers[0].supportingEvidence.some((line) => line.includes("orders ROWS latency evidence")));
    assert.equal(JSON.stringify(view).includes("rdsadmin"), false);
  });

  it("omits not-applicable metric rows for reason-only resource gates", () => {
    const report = buildWorkloadOptimizationReport({
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
      collectorInputs: [{
        rdsEndpoint: "blocked-sql.abc123.us-east-1.rds.amazonaws.com",
        database: "msdb",
        existingInstanceClass: "db.r8i.8xlarge",
        region: "us-east-1"
      }],
      analysis: { results: [], batch: { results: [] } },
      reports: [report],
      summary: buildWorkloadOptimizationSummary([report]),
      exports: {}
    };

    const view = buildManualUploadResultsView(response);

    assert.equal(view.servers[0].resourceGates[0].dimension, "CPU");
    assert.equal(view.servers[0].resourceGates[0].statusLabel, "Does not fit");
    assert.deepEqual(view.servers[0].resourceGates[0].details, []);
    assert.equal(view.servers[0].resourceGates[0].reason, "No selected candidate was available for CPU projection.");
  });

  it("keeps large multi-server display payloads bounded and customer-facing", () => {
    const manyCandidates = Array.from({ length: 60 }, (_, index) => ({
      instanceClass: `db.r8i.${index + 1}xlarge`,
      sqlServerVisibleVcpu: 64 - index,
      cpuConfigurationType: "default" as const,
      accepted: false,
      selected: false,
      decision: "Not Recommended" as const,
      passedGates: [],
      failedGates: ["CPU_P95_TARGET_EXCEEDED", "IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED"],
      limitingResources: []
    }));
    const report = buildWorkloadOptimizationReport({
      serverName: "large-history-sql",
      result: result({
        recommendedConfig: undefined,
        decision: "Not Recommended",
        risk: "blocked",
        candidateEvaluations: manyCandidates,
        blockers: [
          {
            code: "CPU_P95_TARGET_EXCEEDED",
            dimension: "cpu",
            message: "db.r8i.4xlarge: CPU_P95_TARGET_EXCEEDED: 110 > 70; db.r8i.2xlarge: CPU_P99_BURST_LIMIT_EXCEEDED: 180 > 90"
          }
        ],
        limitingResources: [
          {
            dimension: "cpu",
            scope: "compute",
            status: "blocking",
            reason: "db.r8i.4xlarge: CPU_P95_TARGET_EXCEEDED: 110 > 70; db.r8i.2xlarge: CPU_P99_BURST_LIMIT_EXCEEDED: 180 > 90"
          }
        ],
        passedChecks: []
      })
    });
    const response: ManualUploadSuccessResponse = {
      ok: true,
      uploadCount: 1,
      collectorInputs: [{
        rdsEndpoint: "large-history-sql.abc123.us-east-1.rds.amazonaws.com",
        database: "msdb",
        existingInstanceClass: "db.r8i.8xlarge",
        region: "us-east-1"
      }],
      analysis: { results: [], batch: { results: [] } },
      reports: [report],
      summary: buildWorkloadOptimizationSummary([report]),
      exports: {}
    };

    const view = buildManualUploadResultsView(response);

    assert.equal(view.servers[0].resourceGates[0].dimension, "CPU");
    assert.equal(view.servers[0].resourceGates[0].statusLabel, "Does not fit");
    assert.equal(view.servers[0].resourceGates[0].reason, "CPU projection does not fit the lower candidate.");
    assert.equal(view.servers[0].candidateEvaluations.length, 25);
    assert.ok(view.servers[0].candidateEvaluations.at(-1)?.includes("additional candidate checks"));
    assert.equal(view.servers[0].candidateEvaluations.some((item) => item.includes("CPU_P95_TARGET_EXCEEDED")), false);
    assert.ok(view.servers[0].decisionSummary.includes("projected CPU does not fit a lower candidate"));
  });
});
