import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  DatabaseIoWorkloadSample,
  MetricDistribution,
  PhysicalIoEvidence,
  PhysicalIoSample,
  WorkloadProfile
} from "../src/contracts/types.js";
import {
  buildPhysicalIoEvidence,
  evaluateCandidateIops,
  evaluateCandidateTempdbPlacement,
  evaluateCandidateThroughput
} from "../src/io/index.js";
import { distribution } from "../src/parser/stats.js";

function cumulativeSample(input: {
  minute: number;
  databaseId: number;
  databaseName: string;
  fileId: number;
  reads: number;
  writes?: number;
  bytesRead?: number;
  bytesWritten?: number;
  elapsedSeconds?: number;
  valid?: boolean;
}): DatabaseIoWorkloadSample {
  const timestampMs = Date.UTC(2026, 7, 1, 0, input.minute, 0);
  const timestamp = new Date(timestampMs).toISOString();
  return {
    timestamp,
    timestampMs,
    sampleKey: timestamp,
    databaseId: input.databaseId,
    databaseName: input.databaseName,
    fileId: input.fileId,
    isTempdb: input.databaseName.toLowerCase() === "tempdb",
    readOperations: input.reads,
    writeOperations: input.writes ?? 0,
    bytesRead: input.bytesRead ?? 0,
    bytesWritten: input.bytesWritten ?? 0,
    counterMode: "cumulative",
    elapsedSeconds: input.elapsedSeconds,
    intervalValid: input.valid ?? input.minute > 0
  };
}

function physicalEvidence(
  values: number[],
  throughputValues = values.map(() => 0),
  tempdbValues = values.map(() => 0),
  tempdbThroughputValues = values.map(() => 0)
): PhysicalIoEvidence {
  const samples: PhysicalIoSample[] = values.map((totalIops, index) => {
    const tempdbTotalIops = tempdbValues[index];
    const tempdbTotalMibPerSec = tempdbThroughputValues[index];
    const nonTempdbTotalIops = totalIops - tempdbTotalIops;
    const nonTempdbTotalMibPerSec = throughputValues[index] - tempdbTotalMibPerSec;
    return {
      sampleKey: new Date(Date.UTC(2026, 7, 1, 0, index, 0)).toISOString(),
      timestampMs: Date.UTC(2026, 7, 1, 0, index, 0),
      elapsedSeconds: 60,
      readIops: totalIops,
      writeIops: 0,
      totalIops,
      readMibPerSec: throughputValues[index],
      writeMibPerSec: 0,
      totalMibPerSec: throughputValues[index],
      nonTempdbReadIops: nonTempdbTotalIops,
      nonTempdbWriteIops: 0,
      nonTempdbTotalIops,
      nonTempdbReadMibPerSec: nonTempdbTotalMibPerSec,
      nonTempdbWriteMibPerSec: 0,
      nonTempdbTotalMibPerSec,
      tempdbReadIops: tempdbTotalIops,
      tempdbWriteIops: 0,
      tempdbTotalIops,
      tempdbReadMibPerSec: tempdbTotalMibPerSec,
      tempdbWriteMibPerSec: 0,
      tempdbTotalMibPerSec,
      validIntervalCount: 1
    };
  });
  return {
    source: "cumulative_file_counters",
    samples,
    readIops: distribution(values),
    writeIops: distribution(values.map(() => 0)),
    totalIops: distribution(values),
    readMibPerSec: distribution(throughputValues),
    writeMibPerSec: distribution(throughputValues.map(() => 0)),
    totalMibPerSec: distribution(throughputValues),
    nonTempdbTotalIops: distribution(samples.map((sample) => sample.nonTempdbTotalIops)),
    nonTempdbTotalMibPerSec: distribution(samples.map((sample) => sample.nonTempdbTotalMibPerSec)),
    tempdbTotalIops: distribution(tempdbValues),
    tempdbTotalMibPerSec: distribution(tempdbThroughputValues),
    invalidIntervalCount: 0,
    rejectedSampleCount: 0
  };
}

function workloadWithPhysical(values: number[], throughputValues = values.map(() => 0)): WorkloadProfile {
  const zero: MetricDistribution = { avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  return {
    collectionHours: 168,
    cpuPct: zero,
    iops: distribution(values),
    throughputMbps: zero,
    databases: [],
    physicalIo: physicalEvidence(values, throughputValues)
  };
}

describe("physical IOPS calculation", () => {
  it("requires cumulative physical evidence instead of using a maximum-only fallback", () => {
    const zero: MetricDistribution = { avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
    const workload: WorkloadProfile = {
      collectionHours: 168,
      cpuPct: zero,
      iops: zero,
      throughputMbps: zero,
      databases: []
    };
    const iops = evaluateCandidateIops({
      workload,
      baselineIops: 1000,
      maximumIops: 2000
    });
    const throughput = evaluateCandidateThroughput({
      workload,
      baselineThroughputMbps: 100,
      maximumThroughputMbps: 200
    });

    assert.equal(iops.valid, false);
    assert.ok(iops.failures.some((failure) => failure.startsWith("IOPS_PHYSICAL_EVIDENCE_REQUIRED")));
    assert.equal(throughput.valid, false);
    assert.ok(throughput.failures.some((failure) => failure.startsWith("THROUGHPUT_PHYSICAL_EVIDENCE_REQUIRED")));
  });

  it("uses actual elapsed time and aggregates files before calculating percentiles", () => {
    const evidence = buildPhysicalIoEvidence([
      cumulativeSample({ minute: 0, databaseId: 5, databaseName: "orders", fileId: 1, reads: 100, writes: 50, valid: false }),
      cumulativeSample({ minute: 0, databaseId: 5, databaseName: "orders", fileId: 2, reads: 200, writes: 80, valid: false }),
      cumulativeSample({ minute: 1, databaseId: 5, databaseName: "orders", fileId: 1, reads: 700, writes: 350, bytesRead: 60 * 1_048_576, bytesWritten: 30 * 1_048_576, elapsedSeconds: 60 }),
      cumulativeSample({ minute: 1, databaseId: 5, databaseName: "orders", fileId: 2, reads: 500, writes: 200, bytesRead: 120 * 1_048_576, bytesWritten: 60 * 1_048_576, elapsedSeconds: 60 }),
      cumulativeSample({ minute: 3, databaseId: 5, databaseName: "orders", fileId: 1, reads: 1900, writes: 950, bytesRead: 180 * 1_048_576, bytesWritten: 90 * 1_048_576, elapsedSeconds: 120 }),
      cumulativeSample({ minute: 3, databaseId: 5, databaseName: "orders", fileId: 2, reads: 1100, writes: 440, bytesRead: 360 * 1_048_576, bytesWritten: 180 * 1_048_576, elapsedSeconds: 120 })
    ]);

    assert.ok(evidence);
    assert.equal(evidence.samples.length, 2);
    assert.equal(evidence.samples[0].readIops, 15);
    assert.equal(evidence.samples[0].writeIops, 7);
    assert.equal(evidence.samples[1].readIops, 15);
    assert.equal(evidence.samples[1].writeIops, 7);
    assert.equal(evidence.totalIops.p95, 22);
    assert.equal(evidence.samples[0].readMibPerSec, 3);
    assert.equal(evidence.samples[0].writeMibPerSec, 1.5);
    assert.equal(evidence.totalMibPerSec.p95, 4.5);
  });

  it("rejects the complete synchronized sample when any file counter resets", () => {
    const evidence = buildPhysicalIoEvidence([
      cumulativeSample({ minute: 0, databaseId: 5, databaseName: "orders", fileId: 1, reads: 100, valid: false }),
      cumulativeSample({ minute: 0, databaseId: 5, databaseName: "orders", fileId: 2, reads: 100, valid: false }),
      cumulativeSample({ minute: 1, databaseId: 5, databaseName: "orders", fileId: 1, reads: 700 }),
      cumulativeSample({ minute: 1, databaseId: 5, databaseName: "orders", fileId: 2, reads: 700 }),
      cumulativeSample({ minute: 2, databaseId: 5, databaseName: "orders", fileId: 1, reads: 1300 }),
      cumulativeSample({ minute: 2, databaseId: 5, databaseName: "orders", fileId: 2, reads: 10, valid: false })
    ]);

    assert.ok(evidence);
    assert.equal(evidence.samples.length, 1);
    assert.equal(evidence.samples[0].sampleKey, new Date(Date.UTC(2026, 7, 1, 0, 1, 0)).toISOString());
    assert.equal(evidence.invalidIntervalCount, 3);
    assert.equal(evidence.rejectedSampleCount, 2);
  });

  it("rejects the complete synchronized sample when an expected file is missing", () => {
    const evidence = buildPhysicalIoEvidence([
      cumulativeSample({ minute: 0, databaseId: 5, databaseName: "orders", fileId: 1, reads: 100, valid: false }),
      cumulativeSample({ minute: 0, databaseId: 5, databaseName: "orders", fileId: 2, reads: 100, valid: false }),
      cumulativeSample({ minute: 1, databaseId: 5, databaseName: "orders", fileId: 1, reads: 700 }),
      cumulativeSample({ minute: 1, databaseId: 5, databaseName: "orders", fileId: 2, reads: 700 }),
      cumulativeSample({ minute: 2, databaseId: 5, databaseName: "orders", fileId: 1, reads: 1300 })
    ]);

    assert.ok(evidence);
    assert.equal(evidence.samples.length, 1);
    assert.equal(evidence.samples[0].sampleKey, new Date(Date.UTC(2026, 7, 1, 0, 1, 0)).toISOString());
    assert.equal(evidence.invalidIntervalCount, 3);
    assert.equal(evidence.rejectedSampleCount, 2);
  });

  it("does not sum independent database P95 values", () => {
    const samples: DatabaseIoWorkloadSample[] = [];
    let readsA = 0;
    let readsB = 0;
    samples.push(
      cumulativeSample({ minute: 0, databaseId: 5, databaseName: "orders", fileId: 1, reads: 0, valid: false }),
      cumulativeSample({ minute: 0, databaseId: 6, databaseName: "billing", fileId: 1, reads: 0, valid: false })
    );
    for (let minute = 1; minute <= 100; minute += 1) {
      readsA += minute % 2 === 1 ? 6000 : 0;
      readsB += minute % 2 === 0 ? 6000 : 0;
      samples.push(
        cumulativeSample({ minute, databaseId: 5, databaseName: "orders", fileId: 1, reads: readsA }),
        cumulativeSample({ minute, databaseId: 6, databaseName: "billing", fileId: 1, reads: readsB })
      );
    }

    const evidence = buildPhysicalIoEvidence(samples);
    assert.ok(evidence);
    assert.equal(evidence.samples.length, 100);
    assert.equal(evidence.totalIops.p95, 100);
  });

  it("fails P95 and P99 above effective capability headroom", () => {
    const sustainedFailure = evaluateCandidateIops({
      workload: workloadWithPhysical(Array.from({ length: 100 }, () => 200)),
      baselineIops: 150,
      maximumIops: 250,
      configuredStorageIops: 250
    });
    const burstFailure = evaluateCandidateIops({
      workload: workloadWithPhysical([
        ...Array.from({ length: 96 }, () => 100),
        ...Array.from({ length: 4 }, () => 300)
      ]),
      baselineIops: 150,
      maximumIops: 250,
      configuredStorageIops: 250
    });

    assert.ok(sustainedFailure.failures.some((failure) => failure.startsWith("IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED")));
    assert.ok(burstFailure.failures.some((failure) => failure.startsWith("IOPS_P99_EFFECTIVE_CAPABILITY_EXCEEDED")));
  });

  it("requires known burst duration and frequency behavior before relying on maximum IOPS", () => {
    const values = [
      ...Array.from({ length: 96 }, () => 100),
      ...Array.from({ length: 4 }, () => 200)
    ];
    const unknown = evaluateCandidateIops({
      workload: workloadWithPhysical(values),
      baselineIops: 150,
      maximumIops: 250,
      configuredStorageIops: 250
    });
    const valid = evaluateCandidateIops({
      workload: workloadWithPhysical(values),
      baselineIops: 150,
      maximumIops: 250,
      configuredStorageIops: 250,
      maximumBurstDurationMinutes: 5,
      maximumBurstEventsPer24Hours: 20
    });
    const durationFailure = evaluateCandidateIops({
      workload: workloadWithPhysical(values),
      baselineIops: 150,
      maximumIops: 250,
      configuredStorageIops: 250,
      maximumBurstDurationMinutes: 3,
      maximumBurstEventsPer24Hours: 20
    });
    const frequencyFailure = evaluateCandidateIops({
      workload: workloadWithPhysical(values),
      baselineIops: 150,
      maximumIops: 250,
      configuredStorageIops: 250,
      maximumBurstDurationMinutes: 5,
      maximumBurstEventsPer24Hours: 10
    });

    assert.equal(unknown.burstReliance, true);
    assert.ok(unknown.failures.some((failure) => failure.startsWith("IOPS_BURST_BEHAVIOR_UNKNOWN")));
    assert.equal(valid.valid, true);
    assert.equal(valid.burstEvidence?.longestEventMinutes, 4);
    assert.ok(durationFailure.failures.some((failure) => failure.startsWith("IOPS_BURST_DURATION_EXCEEDED")));
    assert.ok(frequencyFailure.failures.some((failure) => failure.startsWith("IOPS_BURST_FREQUENCY_EXCEEDED")));
  });

  it("fails an isolated maximum above effective capability", () => {
    const evaluation = evaluateCandidateIops({
      workload: workloadWithPhysical([
        ...Array.from({ length: 99 }, () => 100),
        1000
      ]),
      baselineIops: 150,
      maximumIops: 200,
      configuredStorageIops: 200
    });

    assert.equal(evaluation.valid, false);
    assert.equal(evaluation.p99, 109);
    assert.equal(evaluation.max, 1000);
    assert.ok(evaluation.failures.some((failure) => failure.startsWith("IOPS_HARD_MAXIMUM_EXCEEDED")));
  });

  it("validates throughput P95 and P99 independently from IOPS", () => {
    const sustainedFailure = evaluateCandidateThroughput({
      workload: workloadWithPhysical(
        Array.from({ length: 100 }, () => 10),
        Array.from({ length: 100 }, () => 200)
      ),
      baselineThroughputMbps: 150,
      maximumThroughputMbps: 250,
      configuredStorageThroughputMbps: 250
    });
    const burstFailure = evaluateCandidateThroughput({
      workload: workloadWithPhysical(
        Array.from({ length: 100 }, () => 10),
        [...Array.from({ length: 96 }, () => 100), ...Array.from({ length: 4 }, () => 300)]
      ),
      baselineThroughputMbps: 150,
      maximumThroughputMbps: 250,
      configuredStorageThroughputMbps: 250
    });

    assert.ok(sustainedFailure.failures.some((failure) => failure.startsWith("THROUGHPUT_P95_EFFECTIVE_CAPABILITY_EXCEEDED")));
    assert.ok(burstFailure.failures.some((failure) => failure.startsWith("THROUGHPUT_P99_EFFECTIVE_CAPABILITY_EXCEEDED")));
  });

  it("requires known throughput burst behavior and ignores an isolated raw maximum", () => {
    const burstValues = [...Array.from({ length: 96 }, () => 100), ...Array.from({ length: 4 }, () => 200)];
    const unknown = evaluateCandidateThroughput({
      workload: workloadWithPhysical(Array.from({ length: 100 }, () => 10), burstValues),
      baselineThroughputMbps: 150,
      maximumThroughputMbps: 250,
      configuredStorageThroughputMbps: 250
    });
    const validBurst = evaluateCandidateThroughput({
      workload: workloadWithPhysical(Array.from({ length: 100 }, () => 10), burstValues),
      baselineThroughputMbps: 150,
      maximumThroughputMbps: 250,
      configuredStorageThroughputMbps: 250,
      maximumBurstDurationMinutes: 5,
      maximumBurstEventsPer24Hours: 20
    });
    const isolatedMaximum = evaluateCandidateThroughput({
      workload: workloadWithPhysical(
        Array.from({ length: 100 }, () => 10),
        [...Array.from({ length: 99 }, () => 100), 1000]
      ),
      baselineThroughputMbps: 150,
      maximumThroughputMbps: 200,
      configuredStorageThroughputMbps: 200
    });

    assert.ok(unknown.failures.some((failure) => failure.startsWith("THROUGHPUT_BURST_BEHAVIOR_UNKNOWN")));
    assert.equal(validBurst.valid, true);
    assert.equal(isolatedMaximum.valid, false);
    assert.equal(isolatedMaximum.p99, 109);
    assert.equal(isolatedMaximum.max, 1000);
    assert.ok(isolatedMaximum.failures.some((failure) => failure.startsWith("THROUGHPUT_HARD_MAXIMUM_EXCEEDED")));
  });

  it("remaps all four candidate-aware tempdb placement transitions before percentiles", () => {
    const evidence = physicalEvidence(
      Array.from({ length: 100 }, () => 120),
      Array.from({ length: 100 }, () => 12),
      Array.from({ length: 100 }, () => 40),
      Array.from({ length: 100 }, () => 4)
    );
    const tempdbUsage = {
      representativeAllocatedMb: 50 * 1024,
      peakAllocatedMb: 80 * 1024
    };
    const nonToNon = evaluateCandidateTempdbPlacement({
      physicalIo: evidence,
      currentTempdbOnLocalStorage: false,
      candidateTempdbOnLocalStorage: false,
      tempdbUsage
    });
    const nonToNvme = evaluateCandidateTempdbPlacement({
      physicalIo: evidence,
      currentTempdbOnLocalStorage: false,
      candidateTempdbOnLocalStorage: true,
      candidateLocalStorageCapacityGb: 100,
      tempdbUsage
    });
    const nvmeToNvme = evaluateCandidateTempdbPlacement({
      physicalIo: evidence,
      currentTempdbOnLocalStorage: true,
      candidateTempdbOnLocalStorage: true,
      candidateLocalStorageCapacityGb: 100,
      tempdbUsage
    });
    const nvmeToNon = evaluateCandidateTempdbPlacement({
      physicalIo: evidence,
      currentTempdbOnLocalStorage: true,
      candidateTempdbOnLocalStorage: false,
      tempdbUsage
    });

    assert.equal(nonToNon.transition, "non_nvme_to_non_nvme");
    assert.equal(nonToNon.currentNormalPath?.totalIops.p95, 120);
    assert.equal(nonToNon.candidateNormalPath?.totalIops.p95, 120);

    assert.equal(nonToNvme.transition, "non_nvme_to_nvme");
    assert.equal(nonToNvme.currentNormalPath?.totalIops.p95, 120);
    assert.equal(nonToNvme.candidateNormalPath?.totalIops.p95, 80);
    assert.equal(nonToNvme.candidateNormalPath?.totalMibPerSec.p95, 8);
    assert.equal(nonToNvme.tempdbIo?.totalIops.p95, 40);
    assert.equal(nonToNvme.capacityResult, "fits");
    assert.equal(nonToNvme.localIoRiskSignal, true);

    assert.equal(nvmeToNvme.transition, "nvme_to_nvme");
    assert.equal(nvmeToNvme.currentNormalPath?.totalIops.p95, 80);
    assert.equal(nvmeToNvme.candidateNormalPath?.totalIops.p95, 80);

    assert.equal(nvmeToNon.transition, "nvme_to_non_nvme");
    assert.equal(nvmeToNon.currentNormalPath?.totalIops.p95, 80);
    assert.equal(nvmeToNon.candidateNormalPath?.totalIops.p95, 120);
    assert.equal(nvmeToNon.candidateNormalPath?.totalMibPerSec.p95, 12);
  });

  it("hard-blocks local NVMe when representative or peak tempdb allocation exceeds capacity", () => {
    const evaluation = evaluateCandidateTempdbPlacement({
      physicalIo: physicalEvidence([120], [12], [40], [4]),
      currentTempdbOnLocalStorage: false,
      candidateTempdbOnLocalStorage: true,
      candidateLocalStorageCapacityGb: 60,
      tempdbUsage: {
        representativeAllocatedMb: 50 * 1024,
        peakAllocatedMb: 80 * 1024
      }
    });

    assert.equal(evaluation.capacityResult, "exceeded");
    assert.ok(evaluation.failures.some((failure) => failure.startsWith("TEMPDB_LOCAL_CAPACITY_EXCEEDED")));
  });

  it("hard-blocks local NVMe when capacity or representative and peak allocation evidence is missing", () => {
    const missingCapacity = evaluateCandidateTempdbPlacement({
      physicalIo: physicalEvidence([120], [12], [40], [4]),
      currentTempdbOnLocalStorage: false,
      candidateTempdbOnLocalStorage: true,
      tempdbUsage: {
        representativeAllocatedMb: 50 * 1024,
        peakAllocatedMb: 80 * 1024
      }
    });
    const missingPeak = evaluateCandidateTempdbPlacement({
      physicalIo: physicalEvidence([120], [12], [40], [4]),
      currentTempdbOnLocalStorage: false,
      candidateTempdbOnLocalStorage: true,
      candidateLocalStorageCapacityGb: 100,
      tempdbUsage: {
        representativeAllocatedMb: 50 * 1024
      }
    });

    assert.equal(missingCapacity.capacityResult, "unavailable");
    assert.ok(missingCapacity.failures.some((failure) => failure.startsWith("TEMPDB_LOCAL_CAPACITY_EVIDENCE_REQUIRED")));
    assert.equal(missingPeak.capacityResult, "unavailable");
    assert.ok(missingPeak.failures.some((failure) => failure.startsWith("TEMPDB_LOCAL_CAPACITY_EVIDENCE_REQUIRED")));
  });
});
