import type {
  CanonicalWorkloadSampleSeries,
  CpuWorkloadSample,
  DatabaseIoWorkloadSample,
  MemoryWorkloadSample,
  SynchronizedWorkloadSample,
  WorkloadProfile
} from "../src/contracts/types.js";
import { assessEvidenceWindow } from "../src/evidence-window/index.js";
import { buildPhysicalIoEvidence } from "../src/io/index.js";
import { buildMemoryEvidenceFromSamples } from "../src/memory/index.js";
import { distribution } from "../src/parser/stats.js";

export interface ProductionWorkloadOptions {
  durationHours?: number;
  sqlCpuPct?: number;
  otherCpuPct?: number;
  currentMemoryGb?: number;
  totalIops?: number;
  totalThroughputMibPerSec?: number;
}

export function productionWorkload(
  options: ProductionWorkloadOptions = {}
): WorkloadProfile {
  const durationHours = options.durationHours ?? 168;
  const sqlCpuPct = options.sqlCpuPct ?? 15;
  const otherCpuPct = options.otherCpuPct ?? 5;
  const currentMemoryGb = options.currentMemoryGb ?? 256;
  const totalIops = options.totalIops ?? 6000;
  const totalThroughput = options.totalThroughputMibPerSec ?? 200;
  const intervalSeconds = 3600;
  const sampleCount = durationHours + 1;
  const cpu: CpuWorkloadSample[] = [];
  const memory: MemoryWorkloadSample[] = [];
  const databaseIo: DatabaseIoWorkloadSample[] = [];
  const synchronized: SynchronizedWorkloadSample[] = [];
  const counters = new Map<string, {
    reads: number;
    writes: number;
    bytesRead: number;
    bytesWritten: number;
  }>();

  for (let index = 0; index < sampleCount; index += 1) {
    const timestampMs = Date.UTC(2026, 7, 1, index, 0, 0);
    const timestamp = new Date(timestampMs).toISOString();
    const sampleKey = timestamp;
    const cpuSample: CpuWorkloadSample = {
      timestamp,
      timestampMs,
      sampleKey,
      sqlCpuPct,
      otherCpuPct,
      systemIdlePct: Math.max(0, 100 - sqlCpuPct - otherCpuPct)
    };
    const totalMemoryMb = currentMemoryGb * 1024;
    const processMemoryMb = totalMemoryMb * 0.25;
    const memorySample: MemoryWorkloadSample = {
      timestamp,
      timestampMs,
      sampleKey,
      sqlCommittedMemoryMb: processMemoryMb,
      sqlTargetMemoryMb: totalMemoryMb * 0.75,
      osTotalMemoryMb: totalMemoryMb,
      osAvailableMemoryMb: totalMemoryMb * 0.6,
      pageLifeExpectancySeconds: 3600,
      stolenServerMemoryMb: totalMemoryMb * 0.02,
      memoryClerksJson: JSON.stringify([
        { ClerkType: "MEMORYCLERK_SQLBUFFERPOOL", SizeMb: totalMemoryMb * 0.2 },
        { ClerkType: "MEMORYCLERK_SQLGENERAL", SizeMb: totalMemoryMb * 0.05 }
      ]),
      memoryGrantsPending: 0,
      memoryGrantsOutstanding: 2,
      grantedWorkspaceMemoryKb: 512 * 1024,
      physicalMemoryInUseKb: processMemoryMb * 1024,
      processPhysicalMemoryLow: false,
      processVirtualMemoryLow: false,
      systemLowMemorySignalState: false,
      systemHighMemorySignalState: true,
      systemMemoryStateDescription: "Available physical memory is high",
      overallPageLifeExpectancySeconds: 3600,
      bufferCacheHitRatio: 9950,
      bufferCacheHitRatioBase: 10000,
      bufferCacheHitRatioPct: 99.5,
      pageReadsCounter: index * 3600,
      pageWritesCounter: index * 900,
      lazyWritesCounter: 0,
      batchRequestsPerSec: 100,
      columnstoreSegmentCacheMb: 0
    };
    const userIo = cumulativeIoSample({
      databaseName: "orders",
      databaseId: 5,
      share: 0.9,
      index,
      timestamp,
      timestampMs,
      sampleKey,
      intervalSeconds,
      totalIops,
      totalThroughput,
      counters
    });
    const tempdbIo = cumulativeIoSample({
      databaseName: "tempdb",
      databaseId: 2,
      share: 0.1,
      index,
      timestamp,
      timestampMs,
      sampleKey,
      intervalSeconds,
      totalIops,
      totalThroughput,
      counters
    });

    cpu.push(cpuSample);
    memory.push(memorySample);
    databaseIo.push(userIo, tempdbIo);
    synchronized.push({
      sampleKey,
      timestampMs,
      cpu: [cpuSample],
      memory: [memorySample],
      userDatabaseIo: [userIo],
      tempdbIo: [tempdbIo],
      missingSources: [],
      valid: true
    });
  }

  const sampleSeries: CanonicalWorkloadSampleSeries = {
    alignmentIntervalSeconds: 60,
    cpu,
    memory,
    databaseIo,
    synchronized,
    issues: []
  };
  const physicalIo = buildPhysicalIoEvidence(databaseIo);
  if (!physicalIo) throw new Error("Production workload fixture must produce physical I/O evidence.");
  const memoryEvidence = buildMemoryEvidenceFromSamples(memory);
  const evidenceWindow = assessEvidenceWindow(sampleSeries);

  return {
    collectionHours: evidenceWindow.durationHours,
    evidenceWindow,
    cpuPct: distribution(cpu.map((sample) => sample.sqlCpuPct)),
    cpuPressure: {
      sampleCount,
      highCpuThresholdPct: 70,
      highCpuSamplePct: 0,
      longestHighCpuStreakSamples: 0,
      sustainedPressure: false
    },
    memoryPressurePct: distribution(memory.map((sample) =>
      (1 - sample.osAvailableMemoryMb! / sample.osTotalMemoryMb!) * 100
    )),
    pageLifeExpectancySeconds: distribution(memory.map((sample) =>
      sample.pageLifeExpectancySeconds!
    )),
    iops: physicalIo.totalIops,
    throughputMbps: physicalIo.totalMibPerSec,
    totalDatabaseSizeGb: 620,
    databases: [
      {
        databaseName: "orders",
        iops: distribution(Array(sampleCount - 1).fill(totalIops * 0.9)),
        throughputMbps: distribution(Array(sampleCount - 1).fill(totalThroughput * 0.9)),
        sizeGb: 600,
        advisoryCpuSharePct: 90,
        advisoryMemorySharePct: 80
      },
      {
        databaseName: "tempdb",
        iops: distribution(Array(sampleCount - 1).fill(totalIops * 0.1)),
        throughputMbps: distribution(Array(sampleCount - 1).fill(totalThroughput * 0.1)),
        sizeGb: 20,
        tempdbSharePct: 10,
        advisoryCpuSharePct: 10,
        advisoryMemorySharePct: 20
      }
    ],
    evidence: {
      memory: memoryEvidence,
      topDatabasesByIops: ["orders", "tempdb"],
      topDatabasesByThroughput: ["orders", "tempdb"],
      tempdbIoSharePct: 10,
      fileLatency: [],
      tempdbUsage: {
        totalMb: 32768,
        allocatedMb: 20480,
        representativeAllocatedMb: 20480,
        peakAllocatedMb: 24576,
        userObjectMb: 4096,
        internalObjectMb: 4096,
        versionStoreMb: 2048
      },
      waitStats: []
    },
    sampleSeries,
    physicalIo
  };
}

function cumulativeIoSample(input: {
  databaseName: string;
  databaseId: number;
  share: number;
  index: number;
  timestamp: string;
  timestampMs: number;
  sampleKey: string;
  intervalSeconds: number;
  totalIops: number;
  totalThroughput: number;
  counters: Map<string, {
    reads: number;
    writes: number;
    bytesRead: number;
    bytesWritten: number;
  }>;
}): DatabaseIoWorkloadSample {
  const counter = input.counters.get(input.databaseName) ?? {
    reads: 0,
    writes: 0,
    bytesRead: 0,
    bytesWritten: 0
  };
  if (input.index > 0) {
    const iops = input.totalIops * input.share;
    const throughput = input.totalThroughput * input.share;
    counter.reads += iops * 0.7 * input.intervalSeconds;
    counter.writes += iops * 0.3 * input.intervalSeconds;
    counter.bytesRead += throughput * 0.7 * 1_048_576 * input.intervalSeconds;
    counter.bytesWritten += throughput * 0.3 * 1_048_576 * input.intervalSeconds;
  }
  input.counters.set(input.databaseName, counter);

  return {
    timestamp: input.timestamp,
    timestampMs: input.timestampMs,
    sampleKey: input.sampleKey,
    sampleId: String(input.index + 1),
    databaseId: input.databaseId,
    databaseName: input.databaseName,
    fileId: 1,
    fileType: "ROWS",
    isTempdb: input.databaseName === "tempdb",
    readOperations: counter.reads,
    writeOperations: counter.writes,
    bytesRead: counter.bytesRead,
    bytesWritten: counter.bytesWritten,
    counterMode: "cumulative",
    previousTimestamp: input.index > 0
      ? new Date(input.timestampMs - input.intervalSeconds * 1000).toISOString()
      : undefined,
    elapsedSeconds: input.index > 0 ? input.intervalSeconds : undefined,
    intervalValid: input.index > 0
  };
}
