import type {
  CanonicalWorkloadSampleSeries,
  CpuWorkloadSample,
  DatabaseIoWorkloadSample,
  MemoryWorkloadSample,
  SynchronizedWorkloadSample
} from "../src/contracts/types.js";

export function synchronizedCpuSampleSeries(
  sqlCpuValues: number[],
  otherCpuValues: number | number[] = 0
): CanonicalWorkloadSampleSeries {
  const cpu: CpuWorkloadSample[] = [];
  const memory: MemoryWorkloadSample[] = [];
  const databaseIo: DatabaseIoWorkloadSample[] = [];
  const synchronized: SynchronizedWorkloadSample[] = [];
  const otherValues = Array.isArray(otherCpuValues)
    ? otherCpuValues
    : sqlCpuValues.map(() => otherCpuValues);

  if (otherValues.length !== sqlCpuValues.length) {
    throw new Error("SQL CPU and Other CPU sample counts must match.");
  }

  for (let index = 0; index < sqlCpuValues.length; index += 1) {
    const timestampMs = Date.UTC(2026, 7, 1, 0, index, 0);
    const timestamp = new Date(timestampMs).toISOString();
    const sampleKey = timestamp;
    const cpuSample: CpuWorkloadSample = {
      timestamp,
      timestampMs,
      sampleKey,
      sqlCpuPct: sqlCpuValues[index],
      otherCpuPct: otherValues[index],
      systemIdlePct: Math.max(0, 100 - sqlCpuValues[index] - otherValues[index])
    };
    const memorySample: MemoryWorkloadSample = {
      timestamp,
      timestampMs,
      sampleKey,
      sqlCommittedMemoryMb: 1024,
      sqlTargetMemoryMb: 2048,
      osTotalMemoryMb: 4096,
      osAvailableMemoryMb: 2048,
      pageLifeExpectancySeconds: 1200
    };
    const ioSample: DatabaseIoWorkloadSample = {
      timestamp,
      timestampMs,
      sampleKey,
      sampleId: String(index + 1),
      databaseId: 5,
      databaseName: "orders",
      isTempdb: false,
      readOperations: index * 60,
      writeOperations: index * 30,
      bytesRead: index * 60 * 8192,
      bytesWritten: index * 30 * 8192,
      previousTimestamp: index > 0 ? cpu[index - 1].timestamp : undefined,
      elapsedSeconds: index > 0 ? 60 : undefined,
      intervalValid: index > 0
    };

    cpu.push(cpuSample);
    memory.push(memorySample);
    databaseIo.push(ioSample);
    synchronized.push({
      sampleKey,
      timestampMs,
      cpu: [cpuSample],
      memory: [memorySample],
      userDatabaseIo: [ioSample],
      tempdbIo: [],
      missingSources: [],
      valid: true
    });
  }

  return {
    alignmentIntervalSeconds: 60,
    cpu,
    memory,
    databaseIo,
    synchronized,
    issues: []
  };
}
