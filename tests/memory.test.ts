import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MemoryWorkloadSample, MetricDistribution, WorkloadProfile } from "../src/contracts/types.js";
import {
  MEMORY_HEADROOM_PCT,
  buildMemoryEvidenceFromSamples,
  evaluateCandidateMemory
} from "../src/memory/index.js";
import { evaluateMemoryToIoCoupling } from "../src/memory/coupling.js";
import { synchronizedCpuSampleSeries } from "./cpu-samples.js";

function sample(
  index: number,
  overrides: Partial<MemoryWorkloadSample> = {}
): MemoryWorkloadSample {
  const timestampMs = Date.UTC(2026, 7, 1, 0, index, 0);
  const timestamp = new Date(timestampMs).toISOString();
  return {
    timestamp,
    timestampMs,
    sampleKey: timestamp,
    sqlCommittedMemoryMb: 102400,
    sqlTargetMemoryMb: 114688,
    osTotalMemoryMb: 131072,
    osAvailableMemoryMb: 16384,
    physicalMemoryInUseKb: 102400 * 1024,
    stolenServerMemoryMb: 4096,
    memoryClerksJson: JSON.stringify([
      { ClerkType: "MEMORYCLERK_SQLBUFFERPOOL", SizeMb: 92160 },
      { ClerkType: "MEMORYCLERK_SQLGENERAL", SizeMb: 4096 }
    ]),
    memoryGrantsPending: 0,
    memoryGrantsOutstanding: 4,
    grantedWorkspaceMemoryKb: 1024 * 1024,
    processPhysicalMemoryLow: false,
    processVirtualMemoryLow: false,
    systemLowMemorySignalState: false,
    systemHighMemorySignalState: true,
    overallPageLifeExpectancySeconds: 1800,
    numaPleJson: JSON.stringify([
      { NumaNode: "000", PageLifeExpectancySeconds: 1800 },
      { NumaNode: "001", PageLifeExpectancySeconds: 1700 }
    ]),
    bufferCacheHitRatio: 9950,
    bufferCacheHitRatioBase: 10000,
    bufferCacheHitRatioPct: 99.5,
    pageReadsCounter: index * 600,
    pageWritesCounter: index * 120,
    lazyWritesCounter: index * 6,
    ...overrides
  };
}

function dist(value: number): MetricDistribution {
  return { avg: value, p50: value, p90: value, p95: value, p99: value, max: value };
}

function workload(memorySamples: MemoryWorkloadSample[]): WorkloadProfile {
  const memory = buildMemoryEvidenceFromSamples(memorySamples);
  return {
    collectionHours: 168,
    cpuPct: dist(20),
    iops: dist(100),
    throughputMbps: dist(10),
    databases: [],
    evidence: {
      memory,
      topDatabasesByIops: [],
      topDatabasesByThroughput: [],
      fileLatency: [],
      waitStats: []
    }
  };
}

function couplingWorkload(options: {
  sampleCount?: number;
  collectionDays?: number;
  risingPressureAndReads?: boolean;
  isolatedLazyWrite?: boolean;
  omitCacheMetrics?: boolean;
  readOperations?: (index: number) => number;
  batchRequestsPerSec?: (index: number) => number;
  batchRequestsCounterRate?: (index: number) => number;
} = {}): WorkloadProfile {
  const sampleCount = options.sampleCount ?? 100;
  const series = synchronizedCpuSampleSeries(Array.from({ length: sampleCount }, () => 20));
  let pageReadsCounter = 0;
  let lazyWritesCounter = 0;
  let batchRequestsCounter = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const pageReadIncrement = options.risingPressureAndReads ? index + 1 : 600;
    pageReadsCounter += pageReadIncrement;
    if (index > 0) {
      batchRequestsCounter += (options.batchRequestsCounterRate?.(index) ?? 0) * 60;
    }
    if (options.isolatedLazyWrite && index === sampleCount - 1) lazyWritesCounter += 1;
    const memorySample = sample(index, {
      osAvailableMemoryMb: options.risingPressureAndReads ? 32768 - index * 100 : 16384,
      pageReadsCounter: options.omitCacheMetrics ? undefined : pageReadsCounter,
      pageWritesCounter: options.omitCacheMetrics ? undefined : index * 120,
      lazyWritesCounter: options.omitCacheMetrics ? undefined : lazyWritesCounter,
      bufferCacheHitRatio: options.omitCacheMetrics ? undefined : 9950,
      bufferCacheHitRatioBase: options.omitCacheMetrics ? undefined : 10000,
      bufferCacheHitRatioPct: options.omitCacheMetrics ? undefined : 99.5,
      batchRequestsPerSec: options.batchRequestsPerSec?.(index),
      batchRequestsCounter: options.batchRequestsCounterRate ? batchRequestsCounter : undefined
    });
    series.memory[index] = memorySample;
    series.synchronized[index].memory = [memorySample];
    series.databaseIo[index].readOperations = options.readOperations?.(index)
      ?? (options.risingPressureAndReads ? index * 10 : 600);
    series.databaseIo[index].elapsedSeconds = index > 0 ? 60 : undefined;
    series.databaseIo[index].intervalValid = index > 0;
    series.synchronized[index].userDatabaseIo = [series.databaseIo[index]];
  }

  const memory = buildMemoryEvidenceFromSamples(series.memory);
  return {
    collectionHours: (options.collectionDays ?? 7) * 24,
    cpuPct: dist(20),
    iops: dist(10),
    throughputMbps: dist(1),
    databases: [],
    sampleSeries: series,
    evidence: {
      memory,
      topDatabasesByIops: [],
      topDatabasesByThroughput: [],
      fileLatency: [],
      waitStats: []
    }
  };
}

describe("memory pressure and less-elastic working-set floor", () => {
  it("does not treat high committed memory as the standalone RAM requirement", () => {
    const memorySamples = [sample(0), sample(1), sample(2)];
    const evidence = buildMemoryEvidenceFromSamples(memorySamples);
    const evaluation = evaluateCandidateMemory({
      workload: workload(memorySamples),
      currentMemoryGb: 128,
      candidateMemoryGb: 64
    });

    assert.equal(evidence?.headroomPct, MEMORY_HEADROOM_PCT);
    assert.equal(evidence?.requiredMemoryFloorGb, 26.4);
    assert.equal(evaluation.valid, true);
    assert.equal(evaluation.workingSetValidationRequired, true);
    assert.equal(evaluation.pressureState, "no_direct_pressure_detected");
  });

  it("treats one isolated low-memory event as warning context", () => {
    const memorySamples = Array.from({ length: 100 }, (_, index) =>
      sample(index, index === 50 ? { processPhysicalMemoryLow: true } : {})
    );
    const evidence = buildMemoryEvidenceFromSamples(memorySamples);
    const evaluation = evaluateCandidateMemory({
      workload: workload(memorySamples),
      currentMemoryGb: 128,
      candidateMemoryGb: 64
    });

    assert.equal(evidence?.directPressureState, "isolated_pressure_detected");
    assert.equal(evaluation.valid, true);
    assert.equal(evaluation.pressureState, "isolated_pressure_detected");
    assert.equal(evaluation.evidenceConfidence, "medium");
    assert.deepEqual(evaluation.failures, []);
  });

  it("blocks a RAM reduction when low-memory pressure is repeated", () => {
    const memorySamples = Array.from({ length: 100 }, (_, index) =>
      sample(index, index >= 10 && index < 20 ? { processPhysicalMemoryLow: true } : {})
    );
    const evaluation = evaluateCandidateMemory({
      workload: workload(memorySamples),
      currentMemoryGb: 128,
      candidateMemoryGb: 64
    });

    assert.equal(evaluation.valid, false);
    assert.equal(evaluation.pressureState, "pressure_detected");
    assert.ok(evaluation.failures.some((failure) => failure.startsWith("MEMORY_PRESSURE_DETECTED")));
  });

  it("blocks a RAM reduction when Memory Grants Pending is sustained", () => {
    const memorySamples = Array.from({ length: 100 }, (_, index) =>
      sample(index, index >= 20 ? { memoryGrantsPending: 1 } : {})
    );
    const evaluation = evaluateCandidateMemory({
      workload: workload(memorySamples),
      currentMemoryGb: 128,
      candidateMemoryGb: 64
    });

    assert.equal(evaluation.valid, false);
    assert.equal(evaluation.pressureState, "pressure_detected");
    assert.ok(evaluation.failures.some((failure) => failure.startsWith("MEMORY_PRESSURE_DETECTED")));
  });

  it("blocks a candidate below the less-elastic floor with 20 percent headroom", () => {
    const memorySamples = [sample(0), sample(1), sample(2)];
    const evaluation = evaluateCandidateMemory({
      workload: workload(memorySamples),
      currentMemoryGb: 128,
      candidateMemoryGb: 16
    });

    assert.equal(evaluation.valid, false);
    assert.ok(evaluation.failures.some((failure) => failure.startsWith("MEMORY_LESS_ELASTIC_FLOOR_UNDERFIT")));
  });

  it("preserves low-tail, NUMA, grants, cache, and page-activity evidence", () => {
    const evidence = buildMemoryEvidenceFromSamples([
      sample(0, { osAvailableMemoryMb: 13107.2 }),
      sample(1, { osAvailableMemoryMb: 26214.4 }),
      sample(2, { osAvailableMemoryMb: 19660.8 })
    ]);

    assert.equal(evidence?.osAvailableMemoryPctLowTail?.min, 10);
    assert.equal(evidence?.memoryGrantsOutstandingDistribution?.p95, 4);
    assert.equal(evidence?.numaPleSeconds?.["000"].p95, 1800);
    assert.equal(evidence?.bufferCacheHitRatioPct?.p95, 99.5);
    assert.equal(evidence?.pageReadsPerSec?.p95, 10);
    assert.equal(evidence?.pageWritesPerSec?.p95, 2);
    assert.equal(evidence?.lazyWritesPerSec?.p95, 0.1);
    assert.equal(evidence?.evidenceConfidence, "high");
  });

  it("downgrades memory confidence when a required signal is incomplete across the window", () => {
    const evidence = buildMemoryEvidenceFromSamples([
      sample(0),
      sample(1, { numaPleJson: undefined })
    ]);

    assert.equal(evidence?.evidenceConfidence, "medium");
  });

  it("classifies a clean seven-day multi-signal trend as a stable working set", () => {
    const evaluation = evaluateMemoryToIoCoupling({
      workload: couplingWorkload({ isolatedLazyWrite: true }),
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.equal(evaluation.materialMemoryReduction, true);
    assert.equal(evaluation.verdict, "stable_working_set");
    assert.equal(evaluation.confidence, "medium");
    assert.equal(evaluation.lazyWritesP95PerSec, 0);
    assert.equal(evaluation.normalizedPageReadsTrend, "stable");
    assert.equal(evaluation.readIopsPressureRelationship, "not_rising");
    assert.equal(evaluation.readIopsWorkloadNormalized, false);
  });

  it("classifies persistent 40 percent ReadIOPS pressure coupling as strong", () => {
    const evaluation = evaluateMemoryToIoCoupling({
      workload: couplingWorkload({ risingPressureAndReads: true }),
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.equal(evaluation.verdict, "aggressive_medium_confidence");
    assert.equal(evaluation.normalizedPageReadsTrend, "rising");
    assert.equal(evaluation.readIopsPressureRelationship, "strong");
    assert.ok((evaluation.readIopsSpearmanCorrelation ?? 0) >= 0.4);
    assert.ok((evaluation.readIopsIncreasePct ?? 0) >= 40);
    assert.equal(evaluation.readIopsPersistenceMet, true);
  });

  it("treats correlation above 0.40 with less than 20 percent magnitude as weak", () => {
    const evaluation = evaluateMemoryToIoCoupling({
      workload: couplingWorkload({
        risingPressureAndReads: true,
        readOperations: (index) => 600 * (1 + index / 1000)
      }),
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.ok((evaluation.readIopsSpearmanCorrelation ?? 0) >= 0.4);
    assert.ok((evaluation.readIopsIncreasePct ?? 100) < 20);
    assert.equal(evaluation.readIopsPressureRelationship, "weak");
  });

  it("classifies a persistent 20 to 40 percent increase as meaningful", () => {
    const evaluation = evaluateMemoryToIoCoupling({
      workload: couplingWorkload({
        risingPressureAndReads: true,
        readOperations: (index) => 600 * (1 + index * 0.004)
      }),
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.ok((evaluation.readIopsIncreasePct ?? 0) >= 20);
    assert.ok((evaluation.readIopsIncreasePct ?? 100) < 40);
    assert.equal(evaluation.readIopsPressureRelationship, "meaningful");
    assert.equal(evaluation.readIopsPersistenceMet, true);
  });

  it("normalizes ReadIOPS by Batch Requests per second when every valid sample has it", () => {
    const evaluation = evaluateMemoryToIoCoupling({
      workload: couplingWorkload({
        risingPressureAndReads: true,
        readOperations: (index) => 600 * (index + 1),
        batchRequestsPerSec: (index) => index + 1
      }),
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.equal(evaluation.readIopsWorkloadNormalized, true);
    assert.equal(evaluation.readIopsPressureRelationship, "not_rising");
  });

  it("derives actual Batch Requests per second from cumulative counters before normalization", () => {
    const evaluation = evaluateMemoryToIoCoupling({
      workload: couplingWorkload({
        risingPressureAndReads: true,
        readOperations: (index) => 600 * (index + 1),
        batchRequestsCounterRate: (index) => index + 1
      }),
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.equal(evaluation.readIopsWorkloadNormalized, true);
    assert.equal(evaluation.readIopsPressureRelationship, "not_rising");
  });

  it("downgrades incomplete evidence and does not use Buffer Cache Hit Ratio alone", () => {
    const evaluation = evaluateMemoryToIoCoupling({
      workload: couplingWorkload({ omitCacheMetrics: true }),
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.equal(evaluation.verdict, "aggressive_medium_confidence");
    assert.equal(evaluation.confidence, "medium");
    assert.ok(evaluation.missingMetrics.includes("Buffer Cache Hit Ratio"));
  });

  it("does not classify RAM reduction as stable when required memory evidence is incomplete", () => {
    const testWorkload = couplingWorkload();
    const incompleteSamples = testWorkload.sampleSeries!.memory.map((memorySample) => ({
      ...memorySample,
      numaPleJson: undefined
    }));
    const incompleteEvidence = buildMemoryEvidenceFromSamples(incompleteSamples);
    testWorkload.sampleSeries!.memory = incompleteSamples;
    for (const synchronized of testWorkload.sampleSeries!.synchronized) {
      const replacement = incompleteSamples.find((memorySample) => memorySample.sampleKey === synchronized.sampleKey);
      synchronized.memory = replacement ? [replacement] : [];
    }
    testWorkload.evidence = {
      ...testWorkload.evidence!,
      memory: incompleteEvidence
    };

    const evaluation = evaluateMemoryToIoCoupling({
      workload: testWorkload,
      currentMemoryGb: 128,
      candidateMemoryGb: 64,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });

    assert.equal(incompleteEvidence?.evidenceConfidence, "medium");
    assert.equal(evaluation.verdict, "aggressive_medium_confidence");
    assert.ok(evaluation.missingMetrics.includes("Complete required memory evidence"));
  });

  it("requires coupling only for a 25 percent reduction or lower-memory family change", () => {
    const notMaterial = evaluateMemoryToIoCoupling({
      workload: couplingWorkload(),
      currentMemoryGb: 128,
      candidateMemoryGb: 100,
      currentFamily: "r8i",
      candidateFamily: "r8i"
    });
    const familyTierChange = evaluateMemoryToIoCoupling({
      workload: couplingWorkload(),
      currentMemoryGb: 128,
      candidateMemoryGb: 100,
      currentFamily: "r8i",
      candidateFamily: "m8i"
    });

    assert.equal(notMaterial.verdict, "not_required");
    assert.equal(familyTierChange.materialMemoryReduction, true);
  });
});
