import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CpuState, CurrentRdsConfig, MetricDistribution, OptimizationResult, WorkloadProfile } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { assertHarnessPassed, runCostHarness } from "../src/harness/index.js";
import { optimizeComputeCandidate } from "../src/optimizer/index.js";
import { normalizeExistingCollectorCsvs } from "../src/parser/index.js";
import { productionWorkload } from "./production-workload.js";

const catalog: InstanceCatalogEntry[] = [
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
  },
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
    decision: "Recommended",
    cpuState: "underutilized",
    optimizationEvidence: {
      currentVcpu: 32,
      optimizedVcpu: 16,
      cpuP95Pct: 20,
      projectedCpuPct: 40,
      projectedSqlCpuP95Pct: 40,
      projectedSqlCpuP99Pct: 40,
      projectedTotalCpuP95Pct: 40,
      projectedTotalCpuP99Pct: 40,
      observedOtherCpuP95Pct: 0,
      observedOtherCpuP99Pct: 0,
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
      requiredMemoryGb: 96,
      requiredIops: 6000,
      requiredThroughputMbps: 200
    },
    risk: "medium",
    blockers: [],
    topOffendingDatabases: workload.databases,
    limitingResources: [],
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

function workloadFromCpuSamples(samples: number[]): WorkloadProfile {
  const timestamps = samples.map((_, index) => collectorTimestamp(index));
  const cpuCsv = [
    "ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime",
    ...samples.map((cpu, index) => `sql1,${cpu},${Math.max(0, 100 - cpu)},0,${timestamps[index]}`)
  ].join("\n");
  const memoryCsv = [
    "ServerName,SQLCurrMemUsageMB,SQLMaxMemTargetMB,OSTotalMemoryMB,OSAVAMemoryMB,PLE,SQL_CollectionTime",
    ...samples.map((_, index) => `sql1,1024,2048,4096,2048,1200,${timestamps[index]}`)
  ].join("\n");
  const ioCsv = [
    "ServerName,Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime",
    ...samples.map((_, index) => {
      const reads = index * 60;
      const writes = index * 30;
      const bytesRead = reads * 8192;
      const bytesWritten = writes * 8192;
      return `sql1,${index + 1},5,orders,${reads},${writes},${bytesRead},${bytesWritten},${bytesRead + bytesWritten},6000,200,0,${timestamps[index]}`;
    })
  ].join("\n");

  return {
    ...normalizeExistingCollectorCsvs({ cpuCsv, memoryCsv, ioCsv }),
    collectionHours: 168,
    evidenceWindow: undefined
  };
}

function collectorTimestamp(index: number): string {
  return new Date(Date.UTC(2026, 7, 1, 0, index, 0))
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", "");
}

function optimizeCpuScenario(scenarioWorkload: WorkloadProfile): OptimizationResult {
  return optimizeComputeCandidate({
    currentConfig,
    workload: scenarioWorkload,
    catalog,
    orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
    currentVcpu: 32,
    requirements: {
      memoryGb: 96,
      iops: 100,
      throughputMbps: 10
    }
  });
}

describe("runCostHarness", () => {
  it("CO-ADV-001: passes a valid independently selected optimized size", () => {
    const reproducibleWorkload = productionWorkload({
      sqlCpuPct: 20,
      currentMemoryGb: 256,
      totalIops: 6000,
      totalThroughputMibPerSec: 200
    });
    const reproducibleResult = optimizeComputeCandidate({
      currentConfig,
      workload: reproducibleWorkload,
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });
    const findings = runCostHarness({
      result: reproducibleResult,
      workload: reproducibleWorkload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.equal(reproducibleResult.decision, "Aggressive Optimization");
    assertHarnessPassed(findings);
  });

  it("CO-ADV-002: fails when production skips a smaller safe candidate", () => {
    const skippedCatalog: InstanceCatalogEntry[] = [
      catalog[0],
      {
        ...catalog[0],
        instanceClass: "db.r8i.2xlarge",
        size: "2xlarge",
        vcpu: 8,
        memoryGb: 128
      }
    ];
    const findings = runCostHarness({
      result: validResult({
        recommendedConfig: {
          ...currentConfig,
          instanceClass: "db.r8i.4xlarge",
          sqlServerVisibleVcpu: 16,
          cpuConfigurationType: "default"
        },
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
            limitingResources: [],
            candidateMemoryGb: 128
          },
          {
            instanceClass: "db.r8i.2xlarge",
            sqlServerVisibleVcpu: 8,
            cpuConfigurationType: "default",
            accepted: true,
            selected: false,
            decision: "Recommended",
            passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
            failedGates: [],
            limitingResources: [],
            candidateMemoryGb: 128
          }
        ]
      }),
      workload,
      catalog: skippedCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      !finding.passed
      && finding.oracle === "CO-RULE-OPTIMAL-SAFE-CANDIDATE"
      && finding.message.includes("db.r8i.2xlarge")
    ));
  });

  it("CO-ADV-003: fails when a fallback family is selected while an equal lead-family candidate is safe", () => {
    const fallbackCatalog: InstanceCatalogEntry[] = [
      catalog[0],
      {
        ...catalog[0],
        instanceClass: "db.r7i.4xlarge",
        family: "r7i"
      }
    ];
    const findings = runCostHarness({
      result: validResult({
        recommendedConfig: {
          ...currentConfig,
          instanceClass: "db.r7i.4xlarge",
          sqlServerVisibleVcpu: 16,
          cpuConfigurationType: "default"
        },
        candidateEvaluations: [
          {
            instanceClass: "db.r7i.4xlarge",
            sqlServerVisibleVcpu: 16,
            cpuConfigurationType: "default",
            accepted: true,
            selected: true,
            decision: "Recommended",
            passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
            failedGates: [],
            limitingResources: [],
            candidateMemoryGb: 128
          },
          {
            instanceClass: "db.r8i.4xlarge",
            sqlServerVisibleVcpu: 16,
            cpuConfigurationType: "default",
            accepted: true,
            selected: false,
            decision: "Recommended",
            passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
            failedGates: [],
            limitingResources: [],
            candidateMemoryGb: 128
          }
        ]
      }),
      workload,
      catalog: fallbackCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      !finding.passed
      && finding.oracle === "CO-RULE-FALLBACK-FAMILY-JUSTIFIED"
      && finding.message.includes("db.r8i.4xlarge")
    ));
  });

  it("CO-ADV-004: uses catalog family preference metadata for fallback-family justification", () => {
    const preferenceCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        instanceClass: "db.customlead.4xlarge",
        family: "customlead",
        familyPreferenceRole: "lead",
        familyPreferenceRank: 0
      },
      {
        ...catalog[0],
        instanceClass: "db.customfallback.4xlarge",
        family: "customfallback",
        familyPreferenceRole: "fallback",
        familyPreferenceRank: 1
      }
    ];
    const findings = runCostHarness({
      result: validResult({
        recommendedConfig: {
          ...currentConfig,
          instanceClass: "db.customfallback.4xlarge",
          sqlServerVisibleVcpu: 16,
          cpuConfigurationType: "default"
        },
        candidateEvaluations: [
          {
            instanceClass: "db.customfallback.4xlarge",
            sqlServerVisibleVcpu: 16,
            cpuConfigurationType: "default",
            accepted: true,
            selected: true,
            decision: "Recommended",
            passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
            failedGates: [],
            limitingResources: [],
            candidateMemoryGb: 128
          },
          {
            instanceClass: "db.customlead.4xlarge",
            sqlServerVisibleVcpu: 16,
            cpuConfigurationType: "default",
            accepted: true,
            selected: false,
            decision: "Recommended",
            passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
            failedGates: [],
            limitingResources: [],
            candidateMemoryGb: 128
          }
        ]
      }),
      workload,
      catalog: preferenceCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      !finding.passed
      && finding.oracle === "CO-RULE-FALLBACK-FAMILY-JUSTIFIED"
      && finding.message.includes("db.customlead.4xlarge")
    ));
  });

  it("CO-ADV-005: allows a fallback family when the equal lead-family candidate failed a real gate", () => {
    const fallbackCatalog: InstanceCatalogEntry[] = [
      catalog[0],
      {
        ...catalog[0],
        instanceClass: "db.r7i.4xlarge",
        family: "r7i"
      }
    ];
    const findings = runCostHarness({
      result: validResult({
        recommendedConfig: {
          ...currentConfig,
          instanceClass: "db.r7i.4xlarge",
          sqlServerVisibleVcpu: 16,
          cpuConfigurationType: "default"
        },
        candidateEvaluations: [
          {
            instanceClass: "db.r7i.4xlarge",
            sqlServerVisibleVcpu: 16,
            cpuConfigurationType: "default",
            accepted: true,
            selected: true,
            decision: "Recommended",
            passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
            failedGates: [],
            limitingResources: [],
            candidateMemoryGb: 128
          },
          {
            instanceClass: "db.r8i.4xlarge",
            sqlServerVisibleVcpu: 16,
            cpuConfigurationType: "default",
            accepted: false,
            selected: false,
            decision: "Not Recommended",
            passedGates: ["CPU", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
            failedGates: ["MEMORY_LESS_ELASTIC_FLOOR_UNDERFIT"],
            limitingResources: [{
              dimension: "memory",
              scope: "compute",
              status: "blocking",
              reason: "Candidate memory is below the preserved less-elastic floor.",
              observed: 160,
              limit: 128,
              unit: "GB"
            }],
            candidateMemoryGb: 128
          }
        ]
      }),
      workload,
      catalog: fallbackCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      finding.passed && finding.oracle === "CO-RULE-FALLBACK-FAMILY-JUSTIFIED"
    ));
    assert.ok(findings.some((finding) =>
      finding.passed && finding.oracle === "CO-RULE-OPTIMAL-SAFE-CANDIDATE"
    ));
  });

  it("CO-ADV-006: independently rejects a recommendation backed only by generic catalog metadata", () => {
    const genericCatalog = catalog.map((entry) => ({
      ...entry,
      region: undefined,
      engine: undefined,
      engineVersion: undefined,
      sqlServerEdition: undefined,
      orderable: undefined
    }));
    const findings = runCostHarness({
      result: validResult(),
      workload,
      catalog: genericCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      !finding.passed
      && finding.oracle === "CO-A-ORDERABLE-CATALOG"
      && finding.message.startsWith("EXACT_ORDERABILITY_METADATA_REQUIRED")
    ));
  });

  it("CO-ADV-007: rejects a recommendation when preserved CPU evidence is tampered after optimization", () => {
    const reproducibleWorkload = productionWorkload({
      sqlCpuPct: 20,
      currentMemoryGb: 256,
      totalIops: 6000,
      totalThroughputMibPerSec: 200
    });
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: reproducibleWorkload,
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });
    const findings = runCostHarness({
      result: {
        ...result,
        optimizationEvidence: {
          ...result.optimizationEvidence!,
          projectedSqlCpuP95Pct: 1
        }
      },
      workload: reproducibleWorkload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      !finding.passed && finding.oracle === "CO-RULE-CPU"
    ));
    assert.ok(findings.some((finding) =>
      !finding.passed && finding.oracle === "CO-RULE-REPRODUCIBLE-RECOMMENDATION"
    ));
  });

  it("CO-ADV-008: rejects caller-tampered CPU safety thresholds", () => {
    const base = validResult();
    const findings = runCostHarness({
      result: validResult({
        optimizationEvidence: {
          ...base.optimizationEvidence!,
          projectedSqlCpuP95Pct: 75,
          cpuP95TargetPct: 80
        }
      }),
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

    assert.ok(findings.some((finding) =>
      !finding.passed && finding.oracle === "CO-I-CPU-FIT"
    ));
  });

  it("CO-ADV-009: fails a hands-free result for unnormalized cross-family CPU projection", () => {
    const crossFamilyCatalog: InstanceCatalogEntry[] = [
      catalog[0],
      {
        ...catalog[0],
        instanceClass: "db.m8i.4xlarge",
        family: "m8i",
        size: "4xlarge"
      }
    ];
    const result = validResult({
      recommendedConfig: {
        ...currentConfig,
        instanceClass: "db.m8i.4xlarge",
        sqlServerVisibleVcpu: 16,
        cpuConfigurationType: "default"
      },
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        optimizedVcpu: 16,
        cpuProjectionConfidence: "low",
        cpuProjectionBasis: "unadjusted_cross_family",
        normalizedPerCoreCapacityFactor: 1
      },
      candidateEvaluations: [
        {
          instanceClass: "db.m8i.4xlarge",
          sqlServerVisibleVcpu: 16,
          cpuConfigurationType: "default",
          accepted: true,
          selected: true,
          decision: "Recommended",
          passedGates: ["CPU", "MEMORY", "IOPS", "THROUGHPUT", "TEMPDB", "ORDERABILITY"],
          failedGates: [],
          limitingResources: [],
          candidateMemoryGb: 128
        }
      ]
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: crossFamilyCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      !finding.passed && finding.oracle === "CO-I-CPU-FIT"
    ));
    assert.ok(findings.some((finding) =>
      !finding.passed && finding.oracle === "CO-RULE-CPU"
    ));
  });

  it("CO-ADV-010: validates physical IOPS P95, P99, and burst behavior from preserved evidence", () => {
    const burstCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        baselineIops: 10000,
        maxIops: 20000,
        maximumIopsBurstDurationMinutes: 10,
        maximumIopsBurstEventsPer24Hours: 4
      }
    ];
    const result = validResult({
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        iopsP95: 6000,
        iopsP99: 8000,
        iopsMax: 30000,
        candidateBaselineIops: 10000,
        candidateMaximumIops: 20000,
        iopsBurstReliance: true,
        iopsBurstEvidence: {
          threshold: 10000,
          excursionSampleCount: 20,
          excursionSamplePct: 2,
          eventCount: 2,
          longestEventMinutes: 5,
          eventsPer24Hours: 2
        }
      }
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: burstCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-I-IOPS-FIT"));
  });

  it("CO-ADV-011: allows physical IOPS P99 to use preserved burst capability", () => {
    const burstCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        baselineIops: 1000,
        maxIops: 10000,
        maximumIopsBurstDurationMinutes: 10,
        maximumIopsBurstEventsPer24Hours: 4
      }
    ];
    const result = validResult({
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        iopsP95: 600,
        iopsP99: 7000,
        iopsMax: 15000,
        candidateBaselineIops: 1000,
        candidateMaximumIops: 10000,
        iopsBurstReliance: true,
        iopsBurstEvidence: {
          threshold: 700,
          excursionSampleCount: 20,
          excursionSamplePct: 2,
          eventCount: 2,
          longestEventMinutes: 5,
          eventsPer24Hours: 2
        }
      }
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: burstCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 600,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-I-IOPS-FIT"));
    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-RULE-IOPS"));
  });

  it("CO-ADV-012: fails physical IOPS when P95 only fits burst capability", () => {
    const burstCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        baselineIops: 1000,
        maxIops: 10000,
        maximumIopsBurstDurationMinutes: 10,
        maximumIopsBurstEventsPer24Hours: 4
      }
    ];
    const result = validResult({
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        iopsP95: 800,
        iopsP99: 850,
        iopsMax: 1200,
        candidateBaselineIops: 1000,
        candidateMaximumIops: 10000,
        iopsBurstReliance: false
      }
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: burstCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 800,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-IOPS-FIT"));
    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-RULE-IOPS"));
  });

  it("CO-ADV-013: fails physical IOPS harness validation when burst duration exceeds capability", () => {
    const burstCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        baselineIops: 10000,
        maxIops: 20000,
        maximumIopsBurstDurationMinutes: 4,
        maximumIopsBurstEventsPer24Hours: 4
      }
    ];
    const result = validResult({
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        iopsP95: 9000,
        iopsP99: 15000,
        candidateBaselineIops: 10000,
        candidateMaximumIops: 20000,
        iopsBurstReliance: true,
        iopsBurstEvidence: {
          threshold: 10000,
          excursionSampleCount: 20,
          excursionSamplePct: 2,
          eventCount: 2,
          longestEventMinutes: 5,
          eventsPer24Hours: 2
        }
      }
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: burstCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 9000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-IOPS-FIT"));
  });

  it("CO-ADV-014: validates physical throughput independently from IOPS", () => {
    const throughputCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        baselineThroughputMbps: 250,
        maxThroughputMbps: 500,
        maximumThroughputBurstDurationMinutes: 10,
        maximumThroughputBurstEventsPer24Hours: 4
      }
    ];
    const result = validResult({
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        throughputP95: 150,
        throughputP99: 200,
        throughputMax: 900,
        candidateBaselineThroughputMbps: 500,
        candidateMaximumThroughputMbps: 500,
        throughputBurstReliance: true,
        throughputBurstEvidence: {
          threshold: 250,
          excursionSampleCount: 20,
          excursionSamplePct: 2,
          eventCount: 2,
          longestEventMinutes: 5,
          eventsPer24Hours: 2
        }
      }
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: throughputCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 150
      }
    });

    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-I-THROUGHPUT-FIT"));
  });

  it("CO-ADV-015: allows physical throughput P99 to use preserved burst capability", () => {
    const throughputCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        baselineThroughputMbps: 100,
        maxThroughputMbps: 500,
        maximumThroughputBurstDurationMinutes: 10,
        maximumThroughputBurstEventsPer24Hours: 4
      }
    ];
    const result = validResult({
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        throughputP95: 60,
        throughputP99: 400,
        throughputMax: 700,
        candidateBaselineThroughputMbps: 100,
        candidateMaximumThroughputMbps: 500,
        throughputBurstReliance: true,
        throughputBurstEvidence: {
          threshold: 70,
          excursionSampleCount: 20,
          excursionSamplePct: 2,
          eventCount: 2,
          longestEventMinutes: 5,
          eventsPer24Hours: 2
        }
      }
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: throughputCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 60
      }
    });

    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-I-THROUGHPUT-FIT"));
    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-RULE-THROUGHPUT"));
  });

  it("CO-ADV-016: fails physical throughput when P95 only fits burst capability", () => {
    const throughputCatalog: InstanceCatalogEntry[] = [
      {
        ...catalog[0],
        baselineThroughputMbps: 100,
        maxThroughputMbps: 500,
        maximumThroughputBurstDurationMinutes: 10,
        maximumThroughputBurstEventsPer24Hours: 4
      }
    ];
    const result = validResult({
      optimizationEvidence: {
        ...validResult().optimizationEvidence!,
        throughputP95: 80,
        throughputP99: 90,
        throughputMax: 120,
        candidateBaselineThroughputMbps: 100,
        candidateMaximumThroughputMbps: 500,
        throughputBurstReliance: false
      }
    });
    const findings = runCostHarness({
      result,
      workload,
      catalog: throughputCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 80
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-THROUGHPUT-FIT"));
    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-RULE-THROUGHPUT"));
  });

  it("CO-ADV-017: accepts blocked results only when blockers are explained", () => {
    const findings = runCostHarness({
      result: {
        currentConfig,
        decision: "Not Recommended",
        risk: "blocked",
        blockers: [{ code: "MEMORY_UNDERFIT", dimension: "memory", message: "No smaller candidate fits memory." }],
        topOffendingDatabases: workload.databases,
        limitingResources: [{
          dimension: "memory",
          scope: "compute",
          status: "blocking",
          reason: "No smaller candidate fits memory.",
          topDatabaseName: "orders",
          topDatabaseMetric: "advisory memory share"
        }],
        candidateEvaluations: [],
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

  it("CO-ADV-018: fails when recommended size underfits memory, IOPS, or throughput", () => {
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

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-MEMORY-FIT"));
    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-IOPS-FIT"));
    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-I-THROUGHPUT-FIT"));
  });

  it("CO-ADV-019: does not fail server-level validation when database attribution evidence is unavailable", () => {
    const serverOnlyWorkload: WorkloadProfile = {
      ...workload,
      databases: [{ databaseName: "server-level-only" }]
    };
    const findings = runCostHarness({
      result: validResult({ topOffendingDatabases: [] }),
      workload: serverOnlyWorkload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) =>
      finding.oracle === "CO-DB-ATTRIBUTION-PRESENT" && finding.passed
    ));
  });

  it("CO-ADV-020: fails when caller says SSATWeb sizing engine was used", () => {
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

  it("CO-ADV-021: fails when SQL edition and license model combination is invalid", () => {
    const invalidConfig: CurrentRdsConfig = {
      ...currentConfig,
      sqlServerEdition: "Web",
      licenseModel: "byom"
    };
    const findings = runCostHarness({
      result: validResult({
        currentConfig: invalidConfig,
        recommendedConfig: { ...invalidConfig, instanceClass: "db.r8i.4xlarge" }
      }),
      workload,
      catalog,
      currentConfig: invalidConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-B-LICENSE-MODEL-VALID"));
  });

  it("CO-ADV-022: blocks Enterprise to Standard edition changes without an explicit eligibility audit", () => {
    const enterpriseConfig: CurrentRdsConfig = {
      ...currentConfig,
      sqlServerEdition: "Enterprise"
    };
    const findings = runCostHarness({
      result: validResult({
        currentConfig: enterpriseConfig,
        recommendedConfig: { ...enterpriseConfig, sqlServerEdition: "Standard", instanceClass: "db.r8i.4xlarge" }
      }),
      workload,
      catalog,
      currentConfig: enterpriseConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-C-EE-TO-SE-ELIGIBILITY"));
  });

  it("CO-ADV-023: allows Enterprise to Standard edition changes when eligibility audit passes", () => {
    const enterpriseConfig: CurrentRdsConfig = {
      ...currentConfig,
      sqlServerEdition: "Enterprise"
    };
    const findings = runCostHarness({
      result: validResult({
        currentConfig: enterpriseConfig,
        recommendedConfig: {
          ...enterpriseConfig,
          sqlServerEdition: "Standard",
          instanceClass: "db.r8i.4xlarge",
          cpuSocketCount: 1
        }
      }),
      workload,
      catalog,
      currentConfig: enterpriseConfig,
      currentVcpu: 32,
      editionChangeEligibility: {
        eligible: true,
        blockers: [],
        evidence: ["Feature audit passed."]
      },
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-C-EE-TO-SE-ELIGIBILITY"));
  });

  it("CO-ADV-024: keeps retired Enterprise-to-Standard oracle out of the active harness scope", () => {
    const enterpriseConfig: CurrentRdsConfig = {
      ...currentConfig,
      sqlServerEdition: "Enterprise"
    };
    const findings = runCostHarness({
      result: validResult({
        currentConfig: enterpriseConfig,
        recommendedConfig: {
          ...enterpriseConfig,
          sqlServerEdition: "Standard",
          instanceClass: "db.r8i.4xlarge",
          cpuSocketCount: undefined
        },
        enterpriseToStandard: {
          status: "eligible",
          eligible: true,
          targetEdition: "Standard",
          migrationRequired: true,
          acceptedMigrationPath: "aws_dms",
          confirmations: {
            vendorSupportsStandardEdition: true,
            migrationPathAccepted: true,
            migrationPath: "aws_dms"
          },
          terms: {
            featureCompatible: { passed: true, blockers: [] },
            vendorSupported: { passed: true, blockers: [] },
            standardScaleLimitsFit: { passed: true, blockers: [] },
            rdsClassVersionOrderable: { passed: true, blockers: [] },
            migrationPathAccepted: { passed: true, blockers: [] }
          },
          blockers: [],
          evidence: ["Synthetic preserved evidence for independent-oracle tamper detection."]
        }
      }),
      workload,
      catalog,
      currentConfig: enterpriseConfig,
      currentVcpu: 32,
      editionChangeEligibility: {
        eligible: true,
        blockers: [],
        evidence: ["Feature audit passed."]
      },
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.every((finding) => finding.oracle !== "CO-14-EDITION"));
  });

  it("CO-ADV-025: uses preserved active I/O evidence instead of the retired raw interval oracle", () => {
    const reproducibleWorkload = productionWorkload({
      sqlCpuPct: 20,
      currentMemoryGb: 256,
      totalIops: 6000,
      totalThroughputMibPerSec: 200
    });
    const result = optimizeComputeCandidate({
      currentConfig,
      workload: reproducibleWorkload,
      catalog,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });
    const affectedKeys = new Set(
      reproducibleWorkload.sampleSeries!.cpu
        .filter((_, index) => [10, 40, 70, 100].includes(index))
        .map((sample) => sample.sampleKey)
    );
    const tamperedDatabaseIo = reproducibleWorkload.sampleSeries!.databaseIo.flatMap((sample) => {
      if (!affectedKeys.has(sample.sampleKey)) return [sample];
      if (sample.isTempdb) return [];
      return [{
        ...sample,
        readOperations: sample.readOperations + 1_000_000_000,
        writeOperations: sample.writeOperations + 1_000_000_000,
        bytesRead: sample.bytesRead + 1_000_000_000_000,
        bytesWritten: sample.bytesWritten + 1_000_000_000_000
      }];
    });
    const tamperedWorkload: WorkloadProfile = {
      ...reproducibleWorkload,
      sampleSeries: {
        ...reproducibleWorkload.sampleSeries!,
        databaseIo: tamperedDatabaseIo
      }
    };
    const findings = runCostHarness({
      result,
      workload: tamperedWorkload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 96,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-RULE-IOPS"));
    assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-RULE-THROUGHPUT"));
  });

  it("CO-ADV-026: fails unsupported ARM/Graviton-style instance families", () => {
    const armCatalog: InstanceCatalogEntry[] = [
      ...catalog,
      {
        instanceClass: "db.r7g.2xlarge",
        family: "r7g",
        size: "2xlarge",
        vcpu: 8,
        memoryGb: 64,
        maxIops: 40000,
        maxThroughputMbps: 1250,
        supportedEditions: ["Enterprise", "Standard"],
        minSqlMajorVersion: 14
      }
    ];
    const findings = runCostHarness({
      result: validResult({ recommendedConfig: { ...currentConfig, instanceClass: "db.r7g.2xlarge" } }),
      workload,
      catalog: armCatalog,
      currentConfig,
      currentVcpu: 32,
      requirements: {
        memoryGb: 48,
        iops: 6000,
        throughputMbps: 200
      }
    });

    assert.ok(findings.some((finding) => !finding.passed && finding.oracle === "CO-F-ARCHITECTURE-SUPPORTED"));
  });

  const cpuScenarios: Array<{ name: string; samples: number[]; expectedState: CpuState }> = [
    {
      name: "underutilized workload",
      samples: Array.from({ length: 20 }, () => 20),
      expectedState: "underutilized"
    },
    {
      name: "normal workload",
      samples: Array.from({ length: 20 }, () => 40),
      expectedState: "normal"
    },
    {
      name: "isolated high-CPU spike",
      samples: [...Array.from({ length: 99 }, () => 20), 85],
      expectedState: "underutilized"
    },
    {
      name: "sustained high-CPU pressure",
      samples: [...Array.from({ length: 10 }, () => 20), 80, 82, 85, 88, 90, ...Array.from({ length: 5 }, () => 20)],
      expectedState: "under_pressure"
    }
  ];

  for (const scenario of cpuScenarios) {
    it(`CO-ADV-027: independently validates CPU classification for ${scenario.name}`, () => {
      const scenarioWorkload = workloadFromCpuSamples(scenario.samples);
      const result = optimizeCpuScenario(scenarioWorkload);
      const findings = runCostHarness({
        result,
        workload: scenarioWorkload,
        catalog,
        currentConfig,
        currentVcpu: 32,
        orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
        requirements: {
          memoryGb: 96,
          iops: 100,
          throughputMbps: 10
        }
      });

      assert.equal(result.cpuState, scenario.expectedState);
      assert.ok(findings.some((finding) => finding.passed && finding.oracle === "CO-L-CPU-STATE-CLASSIFICATION"));
    });
  }

  it("CO-ADV-028: fails CO-L when the reported CPU state disagrees with the independent oracle", () => {
    const scenarioWorkload = workloadFromCpuSamples(Array.from({ length: 20 }, () => 20));
    const result = {
      ...optimizeCpuScenario(scenarioWorkload),
      cpuState: "normal" as const
    };
    const findings = runCostHarness({
      result,
      workload: scenarioWorkload,
      catalog,
      currentConfig,
      currentVcpu: 32,
      orderedCandidateInstanceClasses: ["db.r8i.4xlarge"],
      requirements: {
        memoryGb: 96,
        iops: 100,
        throughputMbps: 10
      }
    });

    const classificationFinding = findings.find((finding) =>
      !finding.passed && finding.oracle === "CO-L-CPU-STATE-CLASSIFICATION"
    );
    assert.equal(classificationFinding?.dimension, "cpu");
  });

});
