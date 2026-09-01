import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import AdmZip from "adm-zip";

const outputDir = resolve(process.cwd(), "samples", "tool-regression");
if (basename(outputDir) !== "tool-regression" || basename(dirname(outputDir)) !== "samples") {
  throw new Error(`Refusing to replace samples outside samples/tool-regression: ${outputDir}`);
}

const cases = [
  {
    fileName: "gold-01-safe-downsize.zip",
    serverName: "safe-downsize.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [12, 15, 18, 20, 22],
    sqlMemoryMaxMb: 128000,
    iops: [9000, 10000, 11000, 12000, 13000],
    throughput: [220, 250, 280, 300, 320],
    tempdbShare: 0.15,
    includeStorageFields: true
  },
  {
    fileName: "gold-02-memory-blocked.zip",
    serverName: "memory-blocked.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [10, 12, 14, 16, 18],
    sqlMemoryMaxMb: 230000,
    memoryGrantsPending: 2,
    iops: [8000, 9000, 10000, 11000, 12000],
    throughput: [180, 210, 240, 260, 280],
    tempdbShare: 0.1,
    includeStorageFields: true
  },
  {
    fileName: "gold-03-iops-blocked.zip",
    serverName: "iops-blocked.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [11, 13, 15, 17, 19],
    sqlMemoryMaxMb: 120000,
    iops: [42000, 44000, 46000, 48000, 50000],
    throughput: [650, 700, 750, 800, 850],
    tempdbShare: 0.12,
    includeStorageFields: true,
    provisionedIops: 64000,
    provisionedThroughputMbps: 1500
  },
  {
    fileName: "gold-04-throughput-blocked.zip",
    serverName: "throughput-blocked.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [10, 12, 14, 16, 18],
    sqlMemoryMaxMb: 120000,
    iops: [18000, 20000, 22000, 24000, 26000],
    throughput: [1350, 1450, 1550, 1650, 1750],
    tempdbShare: 0.1,
    includeStorageFields: true,
    provisionedIops: 64000,
    provisionedThroughputMbps: 2000
  },
  {
    fileName: "gold-05-cpu-blocked.zip",
    serverName: "cpu-blocked.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [45, 48, 52, 55, 60],
    sqlMemoryMaxMb: 110000,
    iops: [10000, 11000, 12000, 13000, 14000],
    throughput: [250, 280, 310, 340, 370],
    tempdbShare: 0.1,
    includeStorageFields: true
  },
  {
    fileName: "gold-06-short-collection.zip",
    serverName: "short-collection.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 6,
    cpu: [10, 12, 15, 18, 20],
    sqlMemoryMaxMb: 100000,
    iops: [7000, 8000, 9000, 10000, 11000],
    throughput: [150, 180, 200, 220, 240],
    tempdbShare: 0.1,
    includeStorageFields: true
  },
  {
    fileName: "gold-07-sql-version-blocked.zip",
    serverName: "version-blocked.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "13.00.6300.2",
    durationHours: 168,
    cpu: [10, 12, 14, 16, 18],
    sqlMemoryMaxMb: 100000,
    iops: [7000, 8000, 9000, 10000, 11000],
    throughput: [150, 180, 200, 220, 240],
    tempdbShare: 0.1,
    includeStorageFields: true
  },
  {
    fileName: "gold-08-edition-blocked.zip",
    serverName: "edition-blocked.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Express Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [8, 10, 12, 14, 16],
    sqlMemoryMaxMb: 1200,
    iops: [1000, 1200, 1400, 1600, 1800],
    throughput: [25, 30, 35, 40, 45],
    tempdbShare: 0.1,
    includeStorageFields: true
  },
  {
    fileName: "gold-09-catalog-gap-fallback.zip",
    serverName: "catalog-gap.rds.amazonaws.com",
    rdsSize: "db.r8i.12xlarge",
    logicalCpu: 24,
    memoryGb: 384,
    edition: "Standard Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [10, 12, 14, 16, 18],
    sqlMemoryMaxMb: 100000,
    iops: [8000, 9000, 10000, 11000, 12000],
    throughput: [180, 210, 240, 270, 300],
    tempdbShare: 0.1,
    includeStorageFields: false
  },
  {
    fileName: "gold-10-tempdb-dominant.zip",
    serverName: "tempdb-dominant.abc123.us-east-1.rds.amazonaws.com",
    rdsSize: "db.r8i.16xlarge",
    logicalCpu: 32,
    memoryGb: 512,
    edition: "Enterprise Edition (64-bit)",
    sqlVersion: "16.00.4125.3",
    durationHours: 168,
    cpu: [14, 16, 18, 20, 22],
    sqlMemoryMaxMb: 150000,
    iops: [18000, 20000, 22000, 24000, 26000],
    throughput: [500, 560, 620, 680, 740],
    tempdbShare: 0.7,
    includeStorageFields: true,
    provisionedIops: 64000,
    provisionedThroughputMbps: 2000,
    highLatency: true
  }
];

mkdirSync(outputDir, { recursive: true });
for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.toLowerCase().endsWith(".zip")) {
    rmSync(join(outputDir, entry.name));
  }
}

for (const sample of cases) {
  const zip = new AdmZip();
  const prefix = sample.serverName;

  zip.addFile(`${prefix}_00_CPU.csv`, Buffer.from(cpuCsv(sample)));
  zip.addFile(`${prefix}_CPUINFO.csv`, Buffer.from(cpuInfoCsv(sample)));
  zip.addFile(`${prefix}_MEM.csv`, Buffer.from(memoryCsv(sample)));
  zip.addFile(`${prefix}_CO_MEMORY_SAMPLES.csv`, Buffer.from(memorySamplesCsv(sample)));
  zip.addFile(`${prefix}_IO.csv`, Buffer.from(ioCsv(sample)));
  zip.addFile(`${prefix}_STORAGE.csv`, Buffer.from(storageCsv(sample)));
  zip.addFile(`${prefix}_CO_MEMORY_DIAGNOSTICS.csv`, Buffer.from(memoryDiagnosticsCsv(sample)));
  zip.addFile(`${prefix}_CO_WAIT_STATS.csv`, Buffer.from(waitStatsCsv(sample)));
  zip.addFile(`${prefix}_CO_FILE_IO.csv`, Buffer.from(fileIoCsv(sample)));
  zip.addFile(`${prefix}_CO_FILE_IO_SAMPLES.csv`, Buffer.from(fileIoSamplesCsv(sample)));
  zip.addFile(`${prefix}_CO_TEMPDB_USAGE.csv`, Buffer.from(tempdbUsageCsv(sample)));
  zip.addFile(`${prefix}_CO_TEMPDB_SAMPLES.csv`, Buffer.from(tempdbSamplesCsv(sample)));
  zip.addFile(`${prefix}_CO_DB_CPU_REQUEST_SAMPLE.csv`, Buffer.from(dbCpuRequestCsv(sample)));
  zip.addFile("collector_run_manifest.csv", Buffer.from(manifestCsv(sample)));

  writeFileSync(join(outputDir, sample.fileName), zip.toBuffer());
}

console.log(`Generated ${cases.length} gold regression packages in ${outputDir}.`);

function manifestCsv(sample) {
  if (!sample.includeStorageFields) {
    return [
      "ServerName,RDSSize",
      `${sample.serverName},${sample.rdsSize}`
    ].join("\n");
  }

  return [
    "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
    [
      sample.serverName,
      sample.rdsSize,
      "gp3",
      sample.provisionedIops ?? 32000,
      sample.provisionedThroughputMbps ?? 1000,
      2048,
      false
    ].join(",")
  ].join("\n");
}

function cpuCsv(sample) {
  return [
    "ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime",
    ...sampleIndexes(sample).map((index) => {
      const cpu = metricAt(sample.cpu, index);
      const other = 5;
      return `${sample.serverName},${cpu},${100 - cpu - other},${other},${timestampAt(sample, index)}`;
    })
  ].join("\n");
}

function cpuInfoCsv(sample) {
  return [
    "ServerName,Logical CPU Count,Socket Count,Hyperthread Ratio,Physical CPU Count,VM_type,SQL Edition,SQL Version",
    `${sample.serverName},${sample.logicalCpu},1,2,${sample.logicalCpu / 2},HYPERVISOR,${sample.edition},${sample.sqlVersion}`
  ].join("\n");
}

function memoryCsv(sample) {
  const totalMemoryMb = sample.memoryGb * 1024;
  const targetMemoryMb = Math.floor(totalMemoryMb * 0.75);
  const multipliers = [0.72, 0.8, 0.88, 0.95, 1];

  return [
    "ServerName,SQL_CollectionTime,SQLCurrMemUsageMB,SQLMaxMemTargetMB,OSTotalMemoryMB,OSAVAMemoryMB,PLE,StolenServerMem,MemoryClerksData",
    ...sampleIndexes(sample).map((index) => {
      const multiplier = multipliers[index % multipliers.length];
      const current = Math.round(sample.sqlMemoryMaxMb * multiplier);
      const available = Math.max(Math.round(totalMemoryMb * 0.2), totalMemoryMb - current - 32768);
      const ple = sample.memoryGrantsPending ? 240 : 12000;
      return `${sample.serverName},${timestampAt(sample, index)},${current},${targetMemoryMb},${totalMemoryMb},${available},${ple},4096,{}`;
    })
  ].join("\n");
}

function memoryDiagnosticsCsv(sample) {
  const timestamp = timestampAt(sample, samplePointCount(sample) - 1);
  const totalServerMemoryKb = sample.sqlMemoryMaxMb * 1024;
  const targetServerMemoryKb = Math.floor(sample.memoryGb * 1024 * 0.75) * 1024;

  return [
    "ServerName,CollectionTime,object_name,counter_name,instance_name,cntr_value,cntr_type",
    `${sample.serverName},${timestamp},SQLServer:Memory Manager,Memory Grants Pending,,${sample.memoryGrantsPending ?? 0},65792`,
    `${sample.serverName},${timestamp},SQLServer:Memory Manager,Total Server Memory (KB),,${totalServerMemoryKb},65792`,
    `${sample.serverName},${timestamp},SQLServer:Memory Manager,Target Server Memory (KB),,${targetServerMemoryKb},65792`,
    `${sample.serverName},${timestamp},SQLServer:Buffer Manager,Page life expectancy,,${sample.memoryGrantsPending ? 240 : 12000},65792`
  ].join("\n");
}

function memorySamplesCsv(sample) {
  const totalMemoryMb = sample.memoryGb * 1024;
  const targetMemoryMb = Math.floor(totalMemoryMb * 0.75);
  const availableMemoryMb = Math.floor(totalMemoryMb * 0.5);
  const rows = [
    "ServerName,Sample_ID,CollectionTime,SqlCommittedMemoryMb,SqlTargetMemoryMb,OsTotalMemoryMb,OsAvailableMemoryMb,MemoryGrantsPending,MemoryGrantsOutstanding,GrantedWorkspaceMemoryKb,PhysicalMemoryInUseKb,ProcessPhysicalMemoryLow,ProcessVirtualMemoryLow,SystemLowMemorySignalState,SystemHighMemorySignalState,SystemMemoryStateDesc,OverallPleSeconds,NumaPleJson,BufferCacheHitRatio,BufferCacheHitRatioBase,PageReadsPerSec,PageWritesPerSec,LazyWritesPerSec,BatchRequestsPerSec,ColumnstoreSegmentCacheMb"
  ];

  let pageReads = 0;
  let pageWrites = 0;
  let batchRequests = 0;
  for (const index of sampleIndexes(sample)) {
    pageReads += index === 0 ? 0 : 3600;
    pageWrites += index === 0 ? 0 : 900;
    batchRequests += index === 0 ? 0 : 6000;
    rows.push([
      sample.serverName,
      index + 1,
      timestampAt(sample, index),
      sample.sqlMemoryMaxMb,
      targetMemoryMb,
      totalMemoryMb,
      availableMemoryMb,
      sample.memoryGrantsPending ?? 0,
      4,
      1048576,
      sample.sqlMemoryMaxMb * 1024,
      0,
      0,
      0,
      1,
      "Available physical memory is high",
      sample.memoryGrantsPending ? 240 : 12000,
      "[]",
      9950,
      10000,
      pageReads,
      pageWrites,
      0,
      batchRequests,
      0
    ].join(","));
  }
  return rows.join("\n");
}

function ioCsv(sample) {
  const dbShares = databaseShares(sample.tempdbShare);
  const rows = ["ServerName,Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime"];

  for (const index of sampleIndexes(sample)) {
    const timestamp = timestampAt(sample, index);
    for (const database of dbShares) {
      const iops = metricAt(sample.iops, index) * database.share;
      const throughput = metricAt(sample.throughput, index) * database.share;
      const operationsPerMinute = Math.round(iops * 60);
      const bytesPerMinute = Math.round(throughput * 60 * 1048576);
      const reads = Math.round(operationsPerMinute * 0.7);
      const writes = operationsPerMinute - reads;
      const bytesRead = Math.round(bytesPerMinute * 0.7);
      const bytesWritten = bytesPerMinute - bytesRead;

      rows.push([
        sample.serverName,
        index + 1,
        database.databaseId,
        database.name,
        reads,
        writes,
        bytesRead,
        bytesWritten,
        bytesPerMinute,
        operationsPerMinute,
        round2(throughput),
        0,
        timestamp
      ].join(","));
    }
  }

  return rows.join("\n");
}

function storageCsv(sample) {
  return [
    "ServerName,DBName,SizeGB",
    `${sample.serverName},orders,900`,
    `${sample.serverName},reporting,450`,
    `${sample.serverName},tempdb,128`
  ].join("\n");
}

function waitStatsCsv(sample) {
  const timestamp = timestampAt(sample, samplePointCount(sample) - 1);
  return [
    "ServerName,CollectionTime,wait_type,waiting_tasks_count,wait_time_ms,max_wait_time_ms,signal_wait_time_ms",
    `${sample.serverName},${timestamp},PAGEIOLATCH_SH,20,9000,1200,200`,
    `${sample.serverName},${timestamp},RESOURCE_SEMAPHORE,${sample.memoryGrantsPending ?? 0},${sample.memoryGrantsPending ? 8000 : 200},800,40`,
    `${sample.serverName},${timestamp},SOS_SCHEDULER_YIELD,25,${sample.fileName.includes("cpu-blocked") ? 15000 : 2500},900,500`
  ].join("\n");
}

function fileIoCsv(sample) {
  const timestamp = timestampAt(sample, samplePointCount(sample) - 1);
  const readStall = sample.highLatency ? 9000 : 2600;
  const writeStall = sample.highLatency ? 5000 : 1200;

  return [
    "ServerName,CollectionTime,DBName,database_id,file_id,type_desc,SizeGB,num_of_reads,num_of_writes,num_of_bytes_read,num_of_bytes_written,io_stall_read_ms,io_stall_write_ms,io_stall",
    `${sample.serverName},${timestamp},orders,5,1,ROWS,900,100,50,104857600,52428800,${readStall},${writeStall},${readStall + writeStall}`,
    `${sample.serverName},${timestamp},orders,5,2,LOG,128,0,100,0,104857600,0,1500,1500`,
    `${sample.serverName},${timestamp},tempdb,2,1,ROWS,128,120,80,125829120,83886080,${sample.highLatency ? 12000 : 3600},${sample.highLatency ? 7200 : 1600},${sample.highLatency ? 19200 : 5200}`
  ].join("\n");
}

function fileIoSamplesCsv(sample) {
  const rows = [
    "ServerName,Sample_ID,CollectionTime,DBName,database_id,file_id,file_type,logical_name,num_of_reads,num_of_bytes_read,io_stall_read_ms,num_of_writes,num_of_bytes_written,io_stall_write_ms,size_on_disk_bytes"
  ];
  const counters = new Map();
  const shares = databaseShares(sample.tempdbShare);

  for (const index of sampleIndexes(sample)) {
    const timestamp = timestampAt(sample, index);
    const elapsedSeconds = index === 0
      ? 0
      : (Date.parse(timestampAt(sample, index)) - Date.parse(timestampAt(sample, index - 1))) / 1000;
    for (const database of shares) {
      const prior = counters.get(database.name) ?? {
        reads: 0,
        writes: 0,
        bytesRead: 0,
        bytesWritten: 0,
        readStall: 0,
        writeStall: 0
      };
      const iops = metricAt(sample.iops, index) * database.share;
      const throughput = metricAt(sample.throughput, index) * database.share;
      prior.reads += Math.round(iops * 0.7 * elapsedSeconds);
      prior.writes += Math.round(iops * 0.3 * elapsedSeconds);
      prior.bytesRead += Math.round(throughput * 0.7 * 1048576 * elapsedSeconds);
      prior.bytesWritten += Math.round(throughput * 0.3 * 1048576 * elapsedSeconds);
      prior.readStall += Math.round(iops * 0.7 * elapsedSeconds * 2);
      prior.writeStall += Math.round(iops * 0.3 * elapsedSeconds * 2);
      counters.set(database.name, prior);
      rows.push([
        sample.serverName,
        index + 1,
        timestamp,
        database.name,
        database.databaseId,
        1,
        "ROWS",
        `${database.name}_data`,
        prior.reads,
        prior.bytesRead,
        prior.readStall,
        prior.writes,
        prior.bytesWritten,
        prior.writeStall,
        database.name === "tempdb" ? 128 * 1073741824 : 900 * 1073741824
      ].join(","));
    }
  }
  return rows.join("\n");
}

function tempdbUsageCsv(sample) {
  const timestamp = timestampAt(sample, samplePointCount(sample) - 1);
  const internalMb = sample.tempdbShare >= 0.6 ? 65536 : 8192;
  return [
    "ServerName,CollectionTime,file_id,TotalMB,AllocatedMB,UserObjectMB,InternalObjectMB,VersionStoreMB",
    `${sample.serverName},${timestamp},1,131072,98304,8192,${internalMb},4096`
  ].join("\n");
}

function tempdbSamplesCsv(sample) {
  const rows = [
    "ServerName,Sample_ID,CollectionTime,TotalMb,AllocatedMb,UserObjectMb,InternalObjectMb,VersionStoreMb"
  ];
  for (const index of sampleIndexes(sample)) {
    const allocatedMb = 65536 + (index % 5) * 8192;
    rows.push([
      sample.serverName,
      index + 1,
      timestampAt(sample, index),
      131072,
      allocatedMb,
      8192,
      sample.tempdbShare >= 0.6 ? 65536 : 8192,
      4096
    ].join(","));
  }
  return rows.join("\n");
}

function dbCpuRequestCsv(sample) {
  const timestamp = timestampAt(sample, samplePointCount(sample) - 1);
  return [
    "ServerName,CollectionTime,DBName,database_id,ActiveRequests,CpuTimeMs,TotalElapsedMs,Reads,Writes,LogicalReads",
    `${sample.serverName},${timestamp},orders,5,4,7000,9000,200,40,5000`,
    `${sample.serverName},${timestamp},reporting,6,2,2000,4000,80,10,1800`,
    `${sample.serverName},${timestamp},tempdb,2,1,1000,1800,40,20,900`
  ].join("\n");
}

function databaseShares(tempdbShare) {
  const remaining = 1 - tempdbShare;
  return [
    { databaseId: 5, name: "orders", share: remaining * 0.7 },
    { databaseId: 6, name: "reporting", share: remaining * 0.3 },
    { databaseId: 2, name: "tempdb", share: tempdbShare }
  ];
}

function timestampAt(sample, index) {
  const start = Date.UTC(2026, 7, 1, 0, 0, 0);
  return new Date(start + index * 60000).toISOString().replace("T", " ").replace(".000Z", "");
}

function samplePointCount(sample) {
  return Math.max(2, Math.round(sample.durationHours * 60) + 1);
}

function sampleIndexes(sample) {
  return Array.from({ length: samplePointCount(sample) }, (_, index) => index);
}

function metricAt(values, index) {
  return values[index % values.length];
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
