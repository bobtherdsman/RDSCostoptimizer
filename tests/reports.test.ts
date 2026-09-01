import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig, MetricDistribution, OptimizationResult } from "../src/contracts/types.js";
import { assessEvidenceWindowFromDuration } from "../src/evidence-window/index.js";
import { buildWorkloadOptimizationReport, buildWorkloadOptimizationSummary, toCsvReport, toJsonReport, toJsonSummaryReport, toPdfExecutiveSummary } from "../src/reports/index.js";

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
      projectedSqlCpuP99Pct: 44,
      projectedTotalCpuP95Pct: 42,
      projectedTotalCpuP99Pct: 46,
      observedOtherCpuP95Pct: 2,
      observedOtherCpuP99Pct: 2,
      cpuP95TargetPct: 70,
      cpuP99SafetyLimitPct: 90,
      totalCpuP99HardLimitPct: 90,
      cpuExcursionSampleCount: 0,
      cpuExcursionSamplePct: 0,
      cpuLongestExcursionStreakSamples: 0,
      cpuProjectionConfidence: "high",
      cpuProjectionBasis: "same_family",
      normalizedPerCoreCapacityFactor: 1,
      candidateCpuConfigurationType: "default",
      currentTempdbPlacement: "normal_storage",
      candidateTempdbPlacement: "local_nvme",
      tempdbPlacementTransition: "non_nvme_to_nvme",
      currentNormalPathIopsP95: 8000,
      currentNormalPathIopsP99: 9000,
      candidateNormalPathIopsP95: 6000,
      candidateNormalPathIopsP99: 7000,
      tempdbIopsP95: 2000,
      tempdbIopsP99: 2200,
      currentNormalPathThroughputP95: 300,
      currentNormalPathThroughputP99: 350,
      candidateNormalPathThroughputP95: 225,
      candidateNormalPathThroughputP99: 260,
      tempdbThroughputP95: 75,
      tempdbThroughputP99: 90,
      candidateLocalStorageCapacityGb: 100,
      tempdbRepresentativeAllocatedGb: 50,
      tempdbPeakAllocatedGb: 80,
      tempdbCapacityResult: "fits",
      tempdbLocalIoRiskSignal: true,
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
        iopsSharePct: 80,
        throughputSharePct: 75,
        sizeGb: 300,
        tempdbSharePct: 60
      },
      {
        databaseName: "archive",
        iops: dist(1000),
        throughputMbps: dist(50),
        iopsSharePct: 20,
        throughputSharePct: 25,
        sizeGb: 900
      }
    ],
    limitingResources: [
      {
        dimension: "cpu",
        scope: "compute",
        status: "within_limit",
        observed: 40,
        limit: 70,
        utilizationPct: 57.14,
        unit: "%",
        reason: "Projected SQL CPU P95 fits the sizing target.",
        topDatabaseName: "orders",
        topDatabaseMetric: "advisory CPU share",
        topDatabaseValue: 60
      },
      {
        dimension: "iops",
        scope: "compute",
        status: "within_limit",
        observed: 8000,
        limit: 50000,
        utilizationPct: 16,
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

describe("buildWorkloadOptimizationReport", () => {
  it("builds a workload-only recommended report without pricing claims", () => {
    const report = buildWorkloadOptimizationReport({
      serverName: "prod-sql-01",
      result: result()
    });

    assert.equal(report.status, "recommended");
    assert.equal(report.pricingDeferred, true);
    assert.equal(report.recommendedConfig?.instanceClass, "db.r8i.4xlarge");
    assert.ok(report.whyOptimized.some((reason) => reason.includes("32 vCPU")));
    assert.ok(report.whyOptimized.some((reason) => reason.includes("projected SQL CPU P95")));
    assert.ok(report.whyOptimized.some((reason) => reason.includes("non_nvme_to_nvme")));
    assert.ok(report.whyOptimized.some((reason) => reason.includes("Candidate-aware normal-path IOPS")));
    assert.ok(report.whyOptimized.some((reason) => reason.includes("Candidate local tempdb capacity result is fits")));
    assert.equal(report.topDatabaseDrivers[0].databaseName, "orders");
    assert.ok(report.advisorySignals.some((signal) => signal.includes("orders drives 80% of database-attributed IOPS")));
    assert.ok(report.advisorySignals.some((signal) => signal.includes("orders drives 75% of database-attributed throughput")));
    assert.equal(report.actionPlan.some((action) => action.includes("Storage performance target")), false);
    assert.equal(report.limitingResources.length, 2);
    assert.equal(report.limitingResources[0].topDatabaseName, "orders");
    assert.ok(report.pricingNote.includes("Pricing is deferred"));
    assert.equal(report.evidenceWindow?.classification, "preferred");
    assert.match(report.evidenceWindow?.representativenessStatement ?? "", /Customer must verbally confirm/);

    const parsed = JSON.parse(toJsonReport(report));
    assert.equal(parsed.status, "recommended");
    assert.equal(parsed.pricingDeferred, true);
    assert.ok(parsed.whyOptimized.some((reason: string) => reason.includes("IOPS requirement")));
  });

  it("builds a blocked report with dimension-specific action plan", () => {
    const report = buildWorkloadOptimizationReport({
      result: result({
        recommendedConfig: undefined,
        decision: "Not Recommended",
        risk: "blocked",
        blockers: [
          { code: "MEMORY_UNDERFIT", dimension: "memory", message: "No smaller candidate has enough memory." },
          { code: "IOPS_UNDERFIT", dimension: "iops", message: "No smaller candidate has enough IOPS." }
        ],
        limitingResources: [
          {
            dimension: "memory",
            scope: "compute",
            status: "blocking",
            reason: "No smaller candidate has enough memory.",
            topDatabaseName: "orders",
            topDatabaseMetric: "advisory memory share",
            topDatabaseValue: 60
          },
          {
            dimension: "iops",
            scope: "compute",
            status: "blocking",
            reason: "No smaller candidate has enough IOPS.",
            topDatabaseName: "orders",
            topDatabaseMetric: "IOPS P95",
            topDatabaseValue: 8000
          }
        ],
        passedChecks: []
      })
    });

    assert.equal(report.status, "not_recommended");
    assert.equal(report.risk, "blocked");
    assert.equal(report.recommendedConfig, undefined);
    assert.ok(report.actionPlan.some((action) => action.startsWith("Memory blocks")));
    assert.ok(report.actionPlan.some((action) => action.startsWith("IOPS blocks")));
  });

  it("surfaces structured memory, wait, file latency, and tempdb advisory evidence", () => {
    const report = buildWorkloadOptimizationReport({
      serverName: "prod-sql-01",
      result: result({
        evidence: {
          memory: {
            observedSqlMemoryMb: 10240,
            sqlTargetMemoryMb: 12288,
            osAvailablePct: 10,
            memoryGrantsPending: 1,
            pressureSignals: ["OS available memory is <=15%.", "Memory Grants Pending is above zero."]
          },
          topDatabasesByIops: ["orders"],
          topDatabasesByThroughput: ["orders"],
          tempdbIoSharePct: 45,
          fileLatency: [
            {
              databaseName: "orders",
              fileType: "LOG",
              writeLatencyMs: 20,
              advisory: ["Observed average write latency: 15 ms."]
            }
          ],
          tempdbUsage: {
            internalObjectMb: 200,
            versionStoreMb: 50
          },
          waitStats: [
            {
              waitType: "PAGEIOLATCH_SH",
              waitTimeMs: 5000
            }
          ]
        }
      })
    });

    assert.equal(report.evidence?.memory?.observedSqlMemoryMb, 10240);
    assert.ok(report.advisorySignals.some((signal) => signal.includes("Memory pressure evidence")));
    assert.ok(report.advisorySignals.some((signal) => signal.includes("orders LOG latency evidence")));
    assert.ok(report.advisorySignals.some((signal) => signal.includes("tempdb drives 45%")));
    assert.ok(report.advisorySignals.some((signal) => signal.includes("PAGEIOLATCH_SH=5000ms")));
  });

  it("reports a blocked Standard opportunity separately while keeping the Enterprise downsize", () => {
    const enterpriseConfig: CurrentRdsConfig = {
      ...currentConfig,
      sqlServerEdition: "Enterprise"
    };
    const featureBlocker = {
      code: "ENTERPRISE_FEATURE_NOT_SUPPORTED_BY_STANDARD",
      category: "feature" as const,
      message: "orders uses an Enterprise-only persisted feature.",
      databaseName: "orders"
    };
    const report = buildWorkloadOptimizationReport({
      serverName: "prod-sql-01",
      result: result({
        currentConfig: enterpriseConfig,
        recommendedConfig: {
          ...enterpriseConfig,
          instanceClass: "db.r8i.4xlarge"
        },
        enterpriseToStandard: {
          status: "blocked",
          eligible: false,
          targetEdition: "Standard",
          migrationRequired: true,
          terms: {
            featureCompatible: { passed: false, blockers: [featureBlocker] },
            vendorSupported: { passed: true, blockers: [] },
            standardScaleLimitsFit: { passed: true, blockers: [] },
            rdsClassVersionOrderable: { passed: true, blockers: [] },
            migrationPathAccepted: { passed: true, blockers: [] }
          },
          blockers: [featureBlocker],
          evidence: ["Per-database feature audit failed."]
        }
      })
    });

    assert.equal(report.status, "recommended");
    assert.equal(report.recommendedConfig?.sqlServerEdition, "Enterprise");
    assert.equal(report.enterpriseToStandard?.status, "blocked");
    assert.ok(report.whyOptimized.some((item) => item.includes("remains on Enterprise Edition")));
    assert.ok(report.actionPlan.some((item) => item.startsWith("Keep Enterprise Edition")));
    assert.ok(toCsvReport(report).includes("feature:ENTERPRISE_FEATURE_NOT_SUPPORTED_BY_STANDARD"));
  });

  it("exports one or many workload reports as CSV", () => {
    const recommended = buildWorkloadOptimizationReport({
      serverName: "prod-sql-01",
      result: result()
    });
    const blocked = buildWorkloadOptimizationReport({
      serverName: "blocked,server",
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

    const csv = toCsvReport([recommended, blocked]);
    const lines = csv.split("\n");

    assert.equal(lines.length, 3);
    assert.ok(lines[0].startsWith("summaryTotalServers,summaryOptimizedServers,summaryRecommendedServers,summaryAggressiveOptimizationServers,summaryNotOptimizedServers,serverName,status,decision,risk"));
    assert.ok(lines[0].includes("collectionDurationHours"));
    assert.ok(lines[1].includes("customer_confirmation_required"));
    assert.ok(lines[1].includes("prod-sql-01,recommended,Recommended,medium"));
    assert.ok(lines[1].includes("Why optimized") || lines[1].includes("Compute changes"));
    assert.ok(lines[1].includes("orders(iops+throughput+tempdb+size"));
    assert.ok(lines[2].startsWith('2,1,1,0,1,"blocked,server",not_recommended,Not Recommended,blocked'));
    assert.ok(lines[2].includes("No smaller candidate has enough memory"));
    assert.ok(lines[2].includes("memory:MEMORY_UNDERFIT"));
  });

  it("exports a dependency-free PDF executive summary", () => {
    const report = buildWorkloadOptimizationReport({
      serverName: "prod-sql-01",
      result: result()
    });

    const pdf = toPdfExecutiveSummary(report);
    const text = new TextDecoder().decode(pdf);

    assert.ok(pdf.length > 500);
    assert.ok(text.startsWith("%PDF-1.4"));
    assert.ok(text.includes("RDS SQL Server Workload Optimization Executive Summary"));
    assert.ok(text.includes("Pricing is deferred"));
    assert.ok(text.includes("Why optimized"));
    assert.ok(text.includes("%%EOF"));
  });

  it("builds a descriptive optimized vs not optimized fleet summary", () => {
    const recommended = buildWorkloadOptimizationReport({
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

    const summary = buildWorkloadOptimizationSummary([recommended, blocked]);
    const json = JSON.parse(toJsonSummaryReport([recommended, blocked]));

    assert.equal(summary.totalServers, 2);
    assert.equal(summary.optimizedServers, 1);
    assert.equal(summary.notOptimizedServers, 1);
    assert.equal(summary.optimized[0].currentInstanceClass, "db.r8i.8xlarge");
    assert.equal(summary.optimized[0].optimizedInstanceClass, "db.r8i.4xlarge");
    assert.equal(summary.notOptimized[0].serverName, "blocked-sql");
    assert.ok(summary.notOptimized[0].whyNotOptimized[0].includes("No smaller candidate has enough memory"));
    assert.equal(json.summary.notOptimizedServers, 1);
  });
});

