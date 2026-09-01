import type {
  DatabaseIoWorkloadSample,
  IoBurstEvidence,
  PhysicalDatabaseIoSample,
  PhysicalIoEvidence,
  PhysicalIoSample,
  TempdbUsageEvidence,
  WorkloadProfile
} from "../contracts/types.js";
import { distribution } from "../parser/stats.js";

export interface CandidateIopsEvaluation {
  valid: boolean;
  failures: string[];
  p95?: number;
  p99?: number;
  max?: number;
  baselineIops?: number;
  maximumIops: number;
  burstReliance: boolean;
  burstEvidence?: IoBurstEvidence;
}

export interface CandidateThroughputEvaluation {
  valid: boolean;
  failures: string[];
  p95?: number;
  p99?: number;
  max?: number;
  baselineThroughputMbps?: number;
  maximumThroughputMbps: number;
  burstReliance: boolean;
  burstEvidence?: IoBurstEvidence;
}

export type TempdbPlacement = "normal_storage" | "local_nvme" | "unknown";

export type TempdbPlacementTransition =
  | "non_nvme_to_non_nvme"
  | "non_nvme_to_nvme"
  | "nvme_to_nvme"
  | "nvme_to_non_nvme"
  | "unknown";

const NORMAL_IO_HEADROOM_TARGET = 0.70;
const BURST_IO_SAFETY_LIMIT = 0.90;

export interface CandidateTempdbEvaluation {
  currentPlacement: TempdbPlacement;
  candidatePlacement: TempdbPlacement;
  transition: TempdbPlacementTransition;
  currentNormalPath?: PhysicalIoEvidence;
  candidateNormalPath?: PhysicalIoEvidence;
  tempdbIo?: PhysicalIoEvidence;
  candidateLocalStorageCapacityGb?: number;
  representativeAllocatedGb?: number;
  peakAllocatedGb?: number;
  capacityResult: "fits" | "exceeded" | "not_applicable" | "unavailable";
  localIoRiskSignal: boolean;
  failures: string[];
}

interface AggregateInterval {
  sampleKey: string;
  timestampMs: number;
  elapsedSeconds: number;
  readIops: number;
  writeIops: number;
  readMibPerSec: number;
  writeMibPerSec: number;
  nonTempdbReadIops: number;
  nonTempdbWriteIops: number;
  nonTempdbReadMibPerSec: number;
  nonTempdbWriteMibPerSec: number;
  tempdbReadIops: number;
  tempdbWriteIops: number;
  tempdbReadMibPerSec: number;
  tempdbWriteMibPerSec: number;
  validIntervalCount: number;
}

interface DatabaseAggregateInterval {
  databaseName: string;
  isTempdb: boolean;
  readIops: number;
  writeIops: number;
  readMibPerSec: number;
  writeMibPerSec: number;
}

export function buildPhysicalIoEvidence(
  samples: readonly DatabaseIoWorkloadSample[]
): PhysicalIoEvidence | undefined {
  const cumulativeSamples = samples.filter((sample) => sample.counterMode === "cumulative");
  if (cumulativeSamples.length === 0) return undefined;

  const byTimestamp = new Map<number, Map<string, DatabaseIoWorkloadSample>>();
  for (const sample of cumulativeSamples) {
    const rows = byTimestamp.get(sample.timestampMs) ?? new Map<string, DatabaseIoWorkloadSample>();
    rows.set(fileKey(sample), sample);
    byTimestamp.set(sample.timestampMs, rows);
  }

  const timestamps = [...byTimestamp.keys()].sort((left, right) => left - right);
  const validSamples: PhysicalIoSample[] = [];
  const databaseSamples: PhysicalDatabaseIoSample[] = [];
  let invalidIntervalCount = 0;

  for (let index = 0; index < timestamps.length; index += 1) {
    const currentRows = byTimestamp.get(timestamps[index])!;
    if (index === 0) {
      invalidIntervalCount += currentRows.size;
      continue;
    }

    const previousRows = byTimestamp.get(timestamps[index - 1])!;
    const elapsedSeconds = (timestamps[index] - timestamps[index - 1]) / 1000;
    const expectedFiles = new Set([...previousRows.keys(), ...currentRows.keys()]);
    const firstCurrent = currentRows.values().next().value as DatabaseIoWorkloadSample | undefined;
    if (!firstCurrent) continue;
    const aggregate = emptyAggregate(firstCurrent, elapsedSeconds);
    const databaseAggregates = new Map<string, DatabaseAggregateInterval>();
    let intervalInvalid = elapsedSeconds <= 0;

    for (const key of expectedFiles) {
      const previous = previousRows.get(key);
      const current = currentRows.get(key);
      if (!previous || !current) {
        invalidIntervalCount += 1;
        intervalInvalid = true;
        continue;
      }

      const readDelta = current.readOperations - previous.readOperations;
      const writeDelta = current.writeOperations - previous.writeOperations;
      const bytesReadDelta = current.bytesRead - previous.bytesRead;
      const bytesWrittenDelta = current.bytesWritten - previous.bytesWritten;
      const valid = current.intervalValid
        && elapsedSeconds > 0
        && readDelta >= 0
        && writeDelta >= 0
        && bytesReadDelta >= 0
        && bytesWrittenDelta >= 0;

      if (!valid) {
        invalidIntervalCount += 1;
        intervalInvalid = true;
        continue;
      }

      const readIops = readDelta / elapsedSeconds;
      const writeIops = writeDelta / elapsedSeconds;
      const readMibPerSec = bytesReadDelta / elapsedSeconds / 1_048_576;
      const writeMibPerSec = bytesWrittenDelta / elapsedSeconds / 1_048_576;
      aggregate.readIops += readIops;
      aggregate.writeIops += writeIops;
      aggregate.readMibPerSec += readMibPerSec;
      aggregate.writeMibPerSec += writeMibPerSec;
      if (current.isTempdb) {
        aggregate.tempdbReadIops += readIops;
        aggregate.tempdbWriteIops += writeIops;
        aggregate.tempdbReadMibPerSec += readMibPerSec;
        aggregate.tempdbWriteMibPerSec += writeMibPerSec;
      } else {
        aggregate.nonTempdbReadIops += readIops;
        aggregate.nonTempdbWriteIops += writeIops;
        aggregate.nonTempdbReadMibPerSec += readMibPerSec;
        aggregate.nonTempdbWriteMibPerSec += writeMibPerSec;
      }
      aggregate.validIntervalCount += 1;

      const database = databaseAggregateFor(databaseAggregates, current);
      database.readIops += readIops;
      database.writeIops += writeIops;
      database.readMibPerSec += readMibPerSec;
      database.writeMibPerSec += writeMibPerSec;
    }

    if (intervalInvalid || aggregate.validIntervalCount !== expectedFiles.size) continue;

    validSamples.push(physicalSampleFromAggregate(aggregate));
    for (const database of databaseAggregates.values()) {
      databaseSamples.push({
        sampleKey: aggregate.sampleKey,
        timestampMs: aggregate.timestampMs,
        elapsedSeconds,
        databaseName: database.databaseName,
        isTempdb: database.isTempdb,
        readIops: database.readIops,
        writeIops: database.writeIops,
        totalIops: database.readIops + database.writeIops,
        readMibPerSec: database.readMibPerSec,
        writeMibPerSec: database.writeMibPerSec,
        totalMibPerSec: database.readMibPerSec + database.writeMibPerSec
      });
    }
  }

  return physicalEvidenceFromSamples(validSamples, {
    source: "cumulative_file_counters",
    databaseSamples,
    invalidIntervalCount,
    rejectedSampleCount: timestamps.length - validSamples.length
  });
}

export function evaluateCandidateTempdbPlacement(input: {
  physicalIo?: PhysicalIoEvidence;
  currentTempdbOnLocalStorage?: boolean;
  candidateTempdbOnLocalStorage: boolean;
  candidateLocalStorageCapacityGb?: number;
  tempdbUsage?: TempdbUsageEvidence;
}): CandidateTempdbEvaluation {
  const currentPlacement = placementFrom(input.currentTempdbOnLocalStorage);
  const candidatePlacement = placementFrom(input.candidateTempdbOnLocalStorage);
  const transition = placementTransition(input.currentTempdbOnLocalStorage, input.candidateTempdbOnLocalStorage);
  const representativeAllocatedGb = mbToGb(input.tempdbUsage?.representativeAllocatedMb);
  const peakAllocatedGb = mbToGb(input.tempdbUsage?.peakAllocatedMb);
  const failures: string[] = [];
  let capacityResult: CandidateTempdbEvaluation["capacityResult"] = "not_applicable";

  if (input.candidateTempdbOnLocalStorage) {
    if (
      input.candidateLocalStorageCapacityGb === undefined
      || representativeAllocatedGb === undefined
      || peakAllocatedGb === undefined
    ) {
      capacityResult = "unavailable";
      failures.push(
        `TEMPDB_LOCAL_CAPACITY_EVIDENCE_REQUIRED: representative/peak/capacity ${representativeAllocatedGb ?? "unavailable"}/${peakAllocatedGb ?? "unavailable"}/${input.candidateLocalStorageCapacityGb ?? "unavailable"} GB`
      );
    } else if (
      representativeAllocatedGb > input.candidateLocalStorageCapacityGb
      || peakAllocatedGb > input.candidateLocalStorageCapacityGb
    ) {
      capacityResult = "exceeded";
      failures.push(
        `TEMPDB_LOCAL_CAPACITY_EXCEEDED: representative/peak ${representativeAllocatedGb ?? "unavailable"}/${peakAllocatedGb ?? "unavailable"} GB > ${input.candidateLocalStorageCapacityGb} GB`
      );
    } else {
      capacityResult = "fits";
    }
  }

  const currentNormalPath = input.physicalIo && input.currentTempdbOnLocalStorage !== undefined
    ? remapPhysicalIo(input.physicalIo, input.currentTempdbOnLocalStorage)
    : undefined;
  const candidateNormalPath = input.physicalIo
    ? remapPhysicalIo(input.physicalIo, input.candidateTempdbOnLocalStorage)
    : undefined;
  const tempdbIo = input.physicalIo
    ? tempdbOnlyPhysicalIo(input.physicalIo)
    : undefined;
  const localIoRiskSignal = input.candidateTempdbOnLocalStorage
    && ((tempdbIo?.totalIops.p95 ?? 0) > 0 || (tempdbIo?.totalMibPerSec.p95 ?? 0) > 0);

  return {
    currentPlacement,
    candidatePlacement,
    transition,
    currentNormalPath,
    candidateNormalPath,
    tempdbIo,
    candidateLocalStorageCapacityGb: input.candidateLocalStorageCapacityGb,
    representativeAllocatedGb,
    peakAllocatedGb,
    capacityResult,
    localIoRiskSignal,
    failures
  };
}

export function evaluateCandidateThroughput(input: {
  workload: WorkloadProfile;
  physicalIo?: PhysicalIoEvidence;
  baselineThroughputMbps?: number;
  maximumThroughputMbps: number;
  configuredStorageThroughputMbps?: number;
  maximumBurstDurationMinutes?: number;
  maximumBurstEventsPer24Hours?: number;
}): CandidateThroughputEvaluation {
  const physicalIo = input.physicalIo ?? input.workload.physicalIo;
  if (!physicalIo) {
    return {
      valid: false,
      failures: ["THROUGHPUT_PHYSICAL_EVIDENCE_REQUIRED: cumulative file byte counters are required for P95 baseline and P99 burst validation"],
      maximumThroughputMbps: input.maximumThroughputMbps,
      burstReliance: false
    };
  }

  const failures: string[] = [];
  const p95 = physicalIo.totalMibPerSec.p95;
  const p99 = physicalIo.totalMibPerSec.p99;
  const maximum = physicalIo.totalMibPerSec.max;
  const effectiveCapability = effectiveCapabilityLimit(
    input.maximumThroughputMbps,
    input.configuredStorageThroughputMbps
  );
  const p95Limit = effectiveCapability !== undefined
    ? effectiveCapability * NORMAL_IO_HEADROOM_TARGET
    : undefined;
  const p99Limit = effectiveCapability !== undefined
    ? effectiveCapability * BURST_IO_SAFETY_LIMIT
    : undefined;

  if (physicalIo.samples.length === 0) {
    failures.push("THROUGHPUT_SAMPLE_SERIES_UNAVAILABLE: cumulative file byte counters produced no complete valid intervals");
  }
  if (input.maximumThroughputMbps <= 0) {
    failures.push("THROUGHPUT_MAXIMUM_CAPABILITY_UNKNOWN: candidate maximum throughput capability is unavailable");
  }
  if (input.configuredStorageThroughputMbps === undefined || input.configuredStorageThroughputMbps <= 0) {
    failures.push("THROUGHPUT_STORAGE_CAPABILITY_UNKNOWN: configured storage throughput capability is required for effective capability validation");
  }
  if (p95Limit !== undefined && p95 > p95Limit) {
    failures.push(`THROUGHPUT_P95_EFFECTIVE_CAPABILITY_EXCEEDED: ${p95} > ${round2(p95Limit)}`);
  }
  if (p99Limit !== undefined && p99 > p99Limit) {
    failures.push(`THROUGHPUT_P99_EFFECTIVE_CAPABILITY_EXCEEDED: ${p99} > ${round2(p99Limit)}`);
  }
  if (effectiveCapability !== undefined && maximum > effectiveCapability) {
    failures.push(`THROUGHPUT_HARD_MAXIMUM_EXCEEDED: ${maximum} > ${effectiveCapability}`);
  }

  const burstReliance =
    p95Limit !== undefined
    && p99Limit !== undefined
    && p99 > p95Limit
    && p99 <= p99Limit;
  const burstEvidence = burstReliance
    ? buildIoBurstEvidence(
        physicalIo.samples,
        p95Limit!,
        (sample) => sample.totalMibPerSec
      )
    : undefined;

  if (burstReliance) {
    if (
      input.maximumBurstDurationMinutes === undefined
      || input.maximumBurstEventsPer24Hours === undefined
    ) {
      failures.push("THROUGHPUT_BURST_BEHAVIOR_UNKNOWN: candidate burst duration or frequency capability is unavailable");
    } else {
      if ((burstEvidence?.longestEventMinutes ?? 0) > input.maximumBurstDurationMinutes) {
        failures.push(
          `THROUGHPUT_BURST_DURATION_EXCEEDED: ${burstEvidence?.longestEventMinutes ?? 0} > ${input.maximumBurstDurationMinutes}`
        );
      }
      if ((burstEvidence?.eventsPer24Hours ?? 0) > input.maximumBurstEventsPer24Hours) {
        failures.push(
          `THROUGHPUT_BURST_FREQUENCY_EXCEEDED: ${burstEvidence?.eventsPer24Hours ?? 0} > ${input.maximumBurstEventsPer24Hours}`
        );
      }
    }
  }

  return {
    valid: failures.length === 0,
    failures,
    p95,
    p99,
    max: maximum,
    baselineThroughputMbps: input.baselineThroughputMbps,
    maximumThroughputMbps: input.maximumThroughputMbps,
    burstReliance,
    burstEvidence
  };
}

export function evaluateCandidateIops(input: {
  workload: WorkloadProfile;
  physicalIo?: PhysicalIoEvidence;
  baselineIops?: number;
  maximumIops: number;
  configuredStorageIops?: number;
  maximumBurstDurationMinutes?: number;
  maximumBurstEventsPer24Hours?: number;
}): CandidateIopsEvaluation {
  const physicalIo = input.physicalIo ?? input.workload.physicalIo;
  if (!physicalIo) {
    return {
      valid: false,
      failures: ["IOPS_PHYSICAL_EVIDENCE_REQUIRED: cumulative file operation counters are required for P95 baseline and P99 burst validation"],
      maximumIops: input.maximumIops,
      burstReliance: false
    };
  }

  const failures: string[] = [];
  const p95 = physicalIo.totalIops.p95;
  const p99 = physicalIo.totalIops.p99;
  const maximum = physicalIo.totalIops.max;
  const effectiveCapability = effectiveCapabilityLimit(
    input.maximumIops,
    input.configuredStorageIops
  );
  const p95Limit = effectiveCapability !== undefined
    ? effectiveCapability * NORMAL_IO_HEADROOM_TARGET
    : undefined;
  const p99Limit = effectiveCapability !== undefined
    ? effectiveCapability * BURST_IO_SAFETY_LIMIT
    : undefined;

  if (physicalIo.samples.length === 0) {
    failures.push("IOPS_SAMPLE_SERIES_UNAVAILABLE: cumulative file counters produced no complete valid intervals");
  }
  if (input.maximumIops <= 0) {
    failures.push("IOPS_MAXIMUM_CAPABILITY_UNKNOWN: candidate maximum IOPS capability is unavailable");
  }
  if (input.configuredStorageIops === undefined || input.configuredStorageIops <= 0) {
    failures.push("IOPS_STORAGE_CAPABILITY_UNKNOWN: configured storage IOPS capability is required for effective capability validation");
  }
  if (p95Limit !== undefined && p95 > p95Limit) {
    failures.push(`IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED: ${p95} > ${round2(p95Limit)}`);
  }
  if (p99Limit !== undefined && p99 > p99Limit) {
    failures.push(`IOPS_P99_EFFECTIVE_CAPABILITY_EXCEEDED: ${p99} > ${round2(p99Limit)}`);
  }
  if (effectiveCapability !== undefined && maximum > effectiveCapability) {
    failures.push(`IOPS_HARD_MAXIMUM_EXCEEDED: ${maximum} > ${effectiveCapability}`);
  }

  const burstReliance =
    p95Limit !== undefined
    && p99Limit !== undefined
    && p99 > p95Limit
    && p99 <= p99Limit;
  const burstEvidence = burstReliance
    ? buildIoBurstEvidence(physicalIo.samples, p95Limit!, (sample) => sample.totalIops)
    : undefined;

  if (burstReliance) {
    if (
      input.maximumBurstDurationMinutes === undefined
      || input.maximumBurstEventsPer24Hours === undefined
    ) {
      failures.push("IOPS_BURST_BEHAVIOR_UNKNOWN: candidate burst duration or frequency capability is unavailable");
    } else {
      if ((burstEvidence?.longestEventMinutes ?? 0) > input.maximumBurstDurationMinutes) {
        failures.push(
          `IOPS_BURST_DURATION_EXCEEDED: ${burstEvidence?.longestEventMinutes ?? 0} > ${input.maximumBurstDurationMinutes}`
        );
      }
      if ((burstEvidence?.eventsPer24Hours ?? 0) > input.maximumBurstEventsPer24Hours) {
        failures.push(
          `IOPS_BURST_FREQUENCY_EXCEEDED: ${burstEvidence?.eventsPer24Hours ?? 0} > ${input.maximumBurstEventsPer24Hours}`
        );
      }
    }
  }

  return {
    valid: failures.length === 0,
    failures,
    p95,
    p99,
    max: maximum,
    baselineIops: input.baselineIops,
    maximumIops: input.maximumIops,
    burstReliance,
    burstEvidence
  };
}

function effectiveCapabilityLimit(
  candidateCapability: number | undefined,
  configuredStorageCapability: number | undefined
): number | undefined {
  if (
    candidateCapability === undefined
    || configuredStorageCapability === undefined
    || candidateCapability <= 0
    || configuredStorageCapability <= 0
  ) {
    return undefined;
  }
  return Math.min(candidateCapability, configuredStorageCapability);
}

export function buildIoBurstEvidence(
  samples: readonly PhysicalIoSample[],
  threshold: number,
  valueOf: (sample: PhysicalIoSample) => number = (sample) => sample.totalIops
): IoBurstEvidence {
  const ordered = [...samples].sort((left, right) => left.timestampMs - right.timestampMs);
  let eventCount = 0;
  let currentEventMinutes = 0;
  let longestEventMinutes = 0;
  let previousTimestampMs: number | undefined;
  let excursionSampleCount = 0;

  for (const sample of ordered) {
    const excursion = valueOf(sample) > threshold;
    const continuous = previousTimestampMs !== undefined
      && sample.timestampMs - previousTimestampMs <= sample.elapsedSeconds * 1000;

    if (excursion) {
      excursionSampleCount += 1;
      if (!continuous || currentEventMinutes === 0) {
        eventCount += 1;
        currentEventMinutes = 0;
      }
      currentEventMinutes += sample.elapsedSeconds / 60;
      longestEventMinutes = Math.max(longestEventMinutes, currentEventMinutes);
    } else {
      currentEventMinutes = 0;
    }
    previousTimestampMs = sample.timestampMs;
  }

  const observationDays = observationDurationDays(ordered);
  return {
    threshold,
    excursionSampleCount,
    excursionSamplePct: round2(ordered.length > 0 ? excursionSampleCount / ordered.length * 100 : 0),
    eventCount,
    longestEventMinutes: round2(longestEventMinutes),
    eventsPer24Hours: round2(observationDays > 0 ? eventCount / observationDays : 0)
  };
}

function fileKey(sample: DatabaseIoWorkloadSample): string {
  return [sample.databaseId ?? sample.databaseName, sample.fileId ?? "database"].join("|");
}

function emptyAggregate(
  sample: DatabaseIoWorkloadSample,
  elapsedSeconds: number
): AggregateInterval {
  return {
    sampleKey: sample.sampleKey,
    timestampMs: sample.timestampMs,
    elapsedSeconds,
    readIops: 0,
    writeIops: 0,
    readMibPerSec: 0,
    writeMibPerSec: 0,
    nonTempdbReadIops: 0,
    nonTempdbWriteIops: 0,
    nonTempdbReadMibPerSec: 0,
    nonTempdbWriteMibPerSec: 0,
    tempdbReadIops: 0,
    tempdbWriteIops: 0,
    tempdbReadMibPerSec: 0,
    tempdbWriteMibPerSec: 0,
    validIntervalCount: 0
  };
}

function databaseAggregateFor(
  byDatabase: Map<string, DatabaseAggregateInterval>,
  sample: DatabaseIoWorkloadSample
): DatabaseAggregateInterval {
  const key = `${sample.databaseId ?? sample.databaseName}|${sample.databaseName}`;
  const existing = byDatabase.get(key);
  if (existing) return existing;
  const created: DatabaseAggregateInterval = {
    databaseName: sample.databaseName,
    isTempdb: sample.isTempdb,
    readIops: 0,
    writeIops: 0,
    readMibPerSec: 0,
    writeMibPerSec: 0
  };
  byDatabase.set(key, created);
  return created;
}

function physicalSampleFromAggregate(sample: AggregateInterval): PhysicalIoSample {
  return {
    sampleKey: sample.sampleKey,
    timestampMs: sample.timestampMs,
    elapsedSeconds: sample.elapsedSeconds,
    readIops: sample.readIops,
    writeIops: sample.writeIops,
    totalIops: sample.readIops + sample.writeIops,
    readMibPerSec: sample.readMibPerSec,
    writeMibPerSec: sample.writeMibPerSec,
    totalMibPerSec: sample.readMibPerSec + sample.writeMibPerSec,
    nonTempdbReadIops: sample.nonTempdbReadIops,
    nonTempdbWriteIops: sample.nonTempdbWriteIops,
    nonTempdbTotalIops: sample.nonTempdbReadIops + sample.nonTempdbWriteIops,
    nonTempdbReadMibPerSec: sample.nonTempdbReadMibPerSec,
    nonTempdbWriteMibPerSec: sample.nonTempdbWriteMibPerSec,
    nonTempdbTotalMibPerSec: sample.nonTempdbReadMibPerSec + sample.nonTempdbWriteMibPerSec,
    tempdbReadIops: sample.tempdbReadIops,
    tempdbWriteIops: sample.tempdbWriteIops,
    tempdbTotalIops: sample.tempdbReadIops + sample.tempdbWriteIops,
    tempdbReadMibPerSec: sample.tempdbReadMibPerSec,
    tempdbWriteMibPerSec: sample.tempdbWriteMibPerSec,
    tempdbTotalMibPerSec: sample.tempdbReadMibPerSec + sample.tempdbWriteMibPerSec,
    validIntervalCount: sample.validIntervalCount
  };
}

function observationDurationDays(samples: readonly PhysicalIoSample[]): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0].elapsedSeconds / 86_400;
  const first = samples[0];
  const last = samples[samples.length - 1];
  return (last.timestampMs - first.timestampMs + last.elapsedSeconds * 1000) / 86_400_000;
}

function remapPhysicalIo(
  physicalIo: PhysicalIoEvidence,
  tempdbOnLocalStorage: boolean
): PhysicalIoEvidence {
  const samples = physicalIo.samples.map((sample) => {
    const readIops = tempdbOnLocalStorage ? sample.nonTempdbReadIops : sample.readIops;
    const writeIops = tempdbOnLocalStorage ? sample.nonTempdbWriteIops : sample.writeIops;
    const readMibPerSec = tempdbOnLocalStorage ? sample.nonTempdbReadMibPerSec : sample.readMibPerSec;
    const writeMibPerSec = tempdbOnLocalStorage ? sample.nonTempdbWriteMibPerSec : sample.writeMibPerSec;
    return {
      ...sample,
      readIops,
      writeIops,
      totalIops: readIops + writeIops,
      readMibPerSec,
      writeMibPerSec,
      totalMibPerSec: readMibPerSec + writeMibPerSec
    };
  });
  return physicalEvidenceFromSamples(samples, physicalIo);
}

function tempdbOnlyPhysicalIo(physicalIo: PhysicalIoEvidence): PhysicalIoEvidence {
  const samples = physicalIo.samples.map((sample) => ({
    ...sample,
    readIops: sample.tempdbReadIops,
    writeIops: sample.tempdbWriteIops,
    totalIops: sample.tempdbTotalIops,
    readMibPerSec: sample.tempdbReadMibPerSec,
    writeMibPerSec: sample.tempdbWriteMibPerSec,
    totalMibPerSec: sample.tempdbTotalMibPerSec
  }));
  return physicalEvidenceFromSamples(samples, physicalIo);
}

function physicalEvidenceFromSamples(
  samples: PhysicalIoSample[],
  source: Pick<PhysicalIoEvidence, "source" | "invalidIntervalCount" | "rejectedSampleCount">
    & Pick<PhysicalIoEvidence, "databaseSamples">
): PhysicalIoEvidence {
  return {
    ...source,
    samples,
    databaseSamples: source.databaseSamples ?? [],
    readIops: distribution(samples.map((sample) => sample.readIops)),
    writeIops: distribution(samples.map((sample) => sample.writeIops)),
    totalIops: distribution(samples.map((sample) => sample.totalIops)),
    readMibPerSec: distribution(samples.map((sample) => sample.readMibPerSec)),
    writeMibPerSec: distribution(samples.map((sample) => sample.writeMibPerSec)),
    totalMibPerSec: distribution(samples.map((sample) => sample.totalMibPerSec)),
    nonTempdbTotalIops: distribution(samples.map((sample) => sample.nonTempdbTotalIops)),
    nonTempdbTotalMibPerSec: distribution(samples.map((sample) => sample.nonTempdbTotalMibPerSec)),
    tempdbTotalIops: distribution(samples.map((sample) => sample.tempdbTotalIops)),
    tempdbTotalMibPerSec: distribution(samples.map((sample) => sample.tempdbTotalMibPerSec))
  };
}

function placementFrom(onLocalStorage: boolean | undefined): TempdbPlacement {
  if (onLocalStorage === undefined) return "unknown";
  return onLocalStorage ? "local_nvme" : "normal_storage";
}

function placementTransition(
  currentOnLocalStorage: boolean | undefined,
  candidateOnLocalStorage: boolean
): TempdbPlacementTransition {
  if (currentOnLocalStorage === undefined) return "unknown";
  if (!currentOnLocalStorage && !candidateOnLocalStorage) return "non_nvme_to_non_nvme";
  if (!currentOnLocalStorage && candidateOnLocalStorage) return "non_nvme_to_nvme";
  if (currentOnLocalStorage && candidateOnLocalStorage) return "nvme_to_nvme";
  return "nvme_to_non_nvme";
}

function mbToGb(value: number | undefined): number | undefined {
  return value === undefined ? undefined : round2(value / 1024);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
