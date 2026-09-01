import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv } from "../src/parser/csv.js";
import { normalizeExistingCollectorCsvs } from "../src/parser/index.js";

describe("parseCsv", () => {
  it("handles BOM, quoted headers, quoted commas, and escaped quotes", () => {
    const rows = parseCsv('\uFEFF"Name","Value","Note"\n"app,db",42,"has ""quotes"""');

    assert.deepEqual(rows, [
      {
        Name: "app,db",
        Value: "42",
        Note: 'has "quotes"'
      }
    ]);
  });
});

describe("normalizeExistingCollectorCsvs", () => {
  const cpuCsv = [
    "ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime",
    "sql1,20,70,10,2026-08-28 00:00:00",
    "sql1,30,60,10,2026-08-28 00:01:00",
    "sql1,40,50,10,2026-08-28 00:02:00"
  ].join("\n");

  const memoryCsv = [
    "ServerName,SQL_CollectionTime,SQLCurrMemUsageMB,SQLMaxMemTargetMB,OSTotalMemoryMB,OSAVAMemoryMB,PLE,StolenServerMem,MemoryClerksData",
    "sql1,2026-08-28 00:00:00,8000,16000,32768,12000,10000,100,\"[{\"\"ClerkType\"\":\"\"MEMORYCLERK_SQLBUFFERPOOL\"\",\"\"SizeMb\"\":8000}]\"",
    "sql1,2026-08-28 00:01:00,9000,16000,32768,11000,12000,100,\"[{\"\"ClerkType\"\":\"\"MEMORYCLERK_SQLBUFFERPOOL\"\",\"\"SizeMb\"\":9000}]\"",
    "sql1,2026-08-28 00:02:00,10000,16000,32768,10000,14000,100,\"[{\"\"ClerkType\"\":\"\"MEMORYCLERK_SQLBUFFERPOOL\"\",\"\"SizeMb\"\":10000}]\""
  ].join("\n");

  const ioCsv = [
    "ServerName,Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime",
    "sql1,1,5,orders,0,0,314572800,314572800,0,6000,0,0,2026-08-28 00:00:00",
    "sql1,1,6,billing,0,0,62914560,62914560,0,1200,0,0,2026-08-28 00:00:00",
    "sql1,2,5,orders,0,0,629145600,629145600,0,12000,0,0,2026-08-28 00:01:00",
    "sql1,2,6,billing,0,0,125829120,125829120,0,2400,0,0,2026-08-28 00:01:00",
    "sql1,3,5,orders,0,0,943718400,943718400,0,18000,0,0,2026-08-28 00:02:00",
    "sql1,3,6,billing,0,0,188743680,188743680,0,3600,0,0,2026-08-28 00:02:00"
  ].join("\n");

  const storageCsv = [
    "ServerName,DBName,SizeGB",
    "sql1,orders,500",
    "sql1,billing,120"
  ].join("\n");

  const dbCpuRequestCsv = [
    "ServerName,CollectionTime,DBName,database_id,ActiveRequests,CpuTimeMs,TotalElapsedMs,Reads,Writes,LogicalReads",
    "sql1,2026-08-28 00:02:00,orders,5,2,900,1000,10,1,100",
    "sql1,2026-08-28 00:02:00,billing,6,1,100,200,1,0,10"
  ].join("\n");

  const memoryDiagnosticsCsv = [
    "ServerName,CollectionTime,object_name,counter_name,instance_name,cntr_value,cntr_type",
    "sql1,2026-08-28 00:02:00,SQLServer:Memory Manager,Memory Grants Pending,,2,65792",
    "sql1,2026-08-28 00:02:00,SQLServer:Memory Manager,Total Server Memory (KB),,10485760,65792",
    "sql1,2026-08-28 00:02:00,SQLServer:Memory Manager,Target Server Memory (KB),,12582912,65792"
  ].join("\n");

  const memorySamplesCsv = [
    "ServerName,Sample_ID,CollectionTime,SqlCommittedMemoryMb,SqlTargetMemoryMb,OsTotalMemoryMb,OsAvailableMemoryMb,MemoryGrantsPending,MemoryGrantsOutstanding,GrantedWorkspaceMemoryKb,PhysicalMemoryInUseKb,ProcessPhysicalMemoryLow,ProcessVirtualMemoryLow,SystemLowMemorySignalState,SystemHighMemorySignalState,SystemMemoryStateDesc,OverallPleSeconds,NumaPleJson,BufferCacheHitRatio,BufferCacheHitRatioBase,PageReadsPerSec,PageWritesPerSec,LazyWritesPerSec,BatchRequestsPerSec,ColumnstoreSegmentCacheMb",
    "sql1,1,2026-08-28 00:00:00,8000,16000,32768,12000,0,3,524288,8192000,0,0,0,1,Available physical memory is high,10000,,9950,10000,0,0,0,0,1024",
    "sql1,2,2026-08-28 00:01:00,9000,16000,32768,11000,0,4,786432,9216000,0,0,0,1,Available physical memory is high,12000,,9960,10000,600,120,6,6000,2048",
    "sql1,3,2026-08-28 00:02:00,10000,16000,32768,10000,0,5,1048576,10240000,0,0,0,1,Available physical memory is high,14000,,9970,10000,1200,240,12,12000,3072"
  ].join("\n");

  const waitStatsCsv = [
    "ServerName,CollectionTime,wait_type,waiting_tasks_count,wait_time_ms,max_wait_time_ms,signal_wait_time_ms",
    "sql1,2026-08-28 00:02:00,PAGEIOLATCH_SH,10,5000,1000,100",
    "sql1,2026-08-28 00:02:00,SOS_SCHEDULER_YIELD,5,1000,100,50"
  ].join("\n");

  const fileIoCsv = [
    "ServerName,CollectionTime,DBName,database_id,file_id,type_desc,SizeGB,num_of_reads,num_of_writes,num_of_bytes_read,num_of_bytes_written,io_stall_read_ms,io_stall_write_ms,io_stall",
    "sql1,2026-08-28 00:02:00,orders,5,1,ROWS,500,10,10,1024,1024,300,300,600",
    "sql1,2026-08-28 00:02:00,orders,5,2,LOG,20,0,10,0,1024,0,200,200"
  ].join("\n");

  const fileIoSamplesCsv = [
    "ServerName,CollectionTime,DBName,database_id,file_id,type_desc,num_of_reads,num_of_writes,num_of_bytes_read,num_of_bytes_written,io_stall_read_ms,io_stall_write_ms",
    "sql1,2026-08-28 00:00:00,orders,5,1,ROWS,100,50,1048576,524288,100,50",
    "sql1,2026-08-28 00:00:00,billing,6,1,ROWS,50,25,524288,262144,50,25",
    "sql1,2026-08-28 00:00:00,tempdb,2,1,ROWS,25,25,262144,262144,25,25",
    "sql1,2026-08-28 00:01:00,orders,5,1,ROWS,700,350,7340032,3670016,700,350",
    "sql1,2026-08-28 00:01:00,billing,6,1,ROWS,170,85,1572864,786432,170,85",
    "sql1,2026-08-28 00:01:00,tempdb,2,1,ROWS,85,85,786432,786432,85,85",
    "sql1,2026-08-28 00:02:00,orders,5,1,ROWS,1300,650,13631488,6815744,1300,650",
    "sql1,2026-08-28 00:02:00,billing,6,1,ROWS,290,145,2621440,1310720,290,145",
    "sql1,2026-08-28 00:02:00,tempdb,2,1,ROWS,145,145,1310720,1310720,145,145"
  ].join("\n");

  const tempdbUsageCsv = [
    "ServerName,CollectionTime,file_id,TotalMB,AllocatedMB,UserObjectMB,InternalObjectMB,VersionStoreMB",
    "sql1,2026-08-28 00:02:00,1,1024,768,100,200,50"
  ].join("\n");

  const tempdbSamplesCsv = [
    "ServerName,Sample_ID,CollectionTime,TotalMb,AllocatedMb,UserObjectMb,InternalObjectMb,VersionStoreMb",
    "sql1,1,2026-08-28 00:00:00,1024,600,100,200,50",
    "sql1,2,2026-08-28 00:01:00,1024,900,150,250,75",
    "sql1,3,2026-08-28 00:02:00,1024,800,120,220,60"
  ].join("\n");

  const editionCompatibilityCsv = [
    "ServerName,CollectionTime,DatabaseName,EvidenceType,FeatureName,FeatureId,ValueMb,AuditStatus",
    "sql1,2026-08-28 00:02:00,orders,PERSISTED_SKU_FEATURE,Compression,1,,complete",
    "sql1,2026-08-28 00:02:00,orders,COLUMNSTORE_SEGMENT_CACHE,,,2048,complete",
    "sql1,2026-08-28 00:02:00,orders,MEMORY_OPTIMIZED_ALLOCATED,,,4096,complete",
    "sql1,2026-08-28 00:02:00,orders,MEMORY_OPTIMIZED_USED,,,3072,complete",
    "sql1,2026-08-28 00:02:00,orders,DATABASE_AUDIT,,,,complete"
  ].join("\n");

  function consolidatedWorkloadSamplesCsv(): string {
    const rows: Array<Record<string, string | undefined>> = [
      ...parseCsv(memorySamplesCsv).map((row) => ({ ...row, SampleType: "memory" })),
      ...parseCsv(fileIoSamplesCsv).map((row) => ({ ...row, SampleType: "file_io" })),
      ...parseCsv(tempdbSamplesCsv).map((row) => ({ ...row, SampleType: "tempdb" }))
    ];
    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
    ].join("\n");
  }

  function csvCell(value: string | undefined): string {
    const raw = value ?? "";
    return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  }

  it("normalizes existing collector CPU, memory, IO, throughput, and DB attribution", () => {
    const profile = normalizeExistingCollectorCsvs({ cpuCsv, memoryCsv, ioCsv, storageCsv, dbCpuRequestCsv });

    assert.equal(profile.cpuPct.p95, 39);
    assert.equal(profile.memoryPressurePct?.p95, 61.88);
    assert.equal(profile.pageLifeExpectancySeconds?.p95, 13800);

    // TotalIOPs is a 60-second delta in the collector output, so the parser converts it to per-second IOPS.
    assert.equal(profile.iops.p95, 348);

    // Throughput is derived from BRead+BWritten when legacy Throuput is zero.
    assert.equal(profile.throughputMbps.p95, 34.8);

    assert.equal(profile.totalDatabaseSizeGb, 620);
    assert.equal(profile.databases[0].databaseName, "orders");
    assert.equal(profile.databases[0].sizeGb, 500);
    assert.equal(profile.databases[0].iops?.p95, 290);
    assert.equal(profile.databases[0].advisoryCpuSharePct, 90);
    assert.equal(profile.databases[1].databaseName, "billing");
    assert.equal(profile.databases[1].advisoryCpuSharePct, 10);

    assert.equal(profile.sampleSeries?.cpu.length, 3);
    assert.equal(profile.sampleSeries?.cpu[0].otherCpuPct, 10);
    assert.equal(profile.sampleSeries?.memory.length, 3);
    assert.equal(profile.sampleSeries?.databaseIo.length, 6);
    assert.equal(profile.sampleSeries?.synchronized.length, 3);
    assert.equal(profile.sampleSeries?.synchronized[0].cpu.length, 1);
    assert.equal(profile.sampleSeries?.synchronized[0].memory.length, 1);
    assert.equal(profile.sampleSeries?.synchronized[0].userDatabaseIo.length, 2);
    assert.equal(profile.sampleSeries?.synchronized[0].tempdbIo.length, 0);
    assert.equal(profile.sampleSeries?.synchronized[0].valid, false);
    assert.equal(profile.sampleSeries?.synchronized[1].valid, true);
    assert.equal(profile.sampleSeries?.databaseIo[2].elapsedSeconds, 60);
    assert.equal(profile.evidenceWindow?.durationHours, 0.03);
    assert.equal(profile.evidenceWindow?.classification, "insufficient");
    assert.equal(profile.evidenceWindow?.continuityStatus, "complete");
    assert.equal(profile.evidenceWindow?.representativeness, "customer_confirmation_required");
  });

  it("adds advisory evidence from opt-in diagnostics without making hard blockers", () => {
    const profile = normalizeExistingCollectorCsvs({
      cpuCsv,
      memoryCsv,
      memorySamplesCsv,
      memoryDiagnosticsCsv,
      ioCsv,
      storageCsv,
      dbCpuRequestCsv,
      waitStatsCsv,
      fileIoCsv,
      fileIoSamplesCsv,
      tempdbUsageCsv,
      tempdbSamplesCsv,
      editionCompatibilityCsv
    });

    assert.equal(profile.evidence?.memory?.observedSqlMemoryMb, 10240);
    assert.equal(profile.evidence?.memory?.memoryGrantsPending, 2);
    assert.ok(profile.evidence?.memory?.pressureSignals.some((signal) => signal.includes("Memory Grants Pending")));
    assert.equal(profile.sampleSeries?.memory[2].memoryGrantsOutstanding, 5);
    assert.equal(profile.sampleSeries?.memory[2].grantedWorkspaceMemoryKb, 1048576);
    assert.equal(profile.evidence?.memory?.bufferCacheHitRatioPct?.p95, 99.69);
    assert.equal(profile.evidence?.memory?.pageReadsPerSec?.p95, 10);
    assert.equal(profile.evidence?.memory?.batchRequestsPerSec?.p95, 100);
    assert.equal(profile.sampleSeries?.memory[2].batchRequestsCounter, 12000);
    assert.equal(profile.evidence?.memory?.bufferPoolMemoryMb?.max, 10000);
    assert.equal(profile.evidence?.memory?.columnstoreSegmentCacheMb?.max, 3072);
    assert.equal(profile.evidence?.memory?.headroomPct, 20);
    assert.deepEqual(profile.evidence?.topDatabasesByIops, ["orders", "billing", "tempdb"]);
    assert.deepEqual(profile.evidence?.topDatabasesByThroughput, ["orders", "billing", "tempdb"]);
    assert.equal(profile.evidence?.waitStats[0].waitType, "PAGEIOLATCH_SH");
    assert.equal(profile.evidence?.fileLatency.length, 2);
    assert.ok(profile.evidence?.fileLatency[0].advisory.every((item) => item.startsWith("Observed average")));
    assert.equal(profile.evidence?.tempdbUsage?.internalObjectMb, 200);
    assert.equal(profile.evidence?.tempdbUsage?.versionStoreMb, 50);
    assert.equal(profile.evidence?.tempdbUsage?.representativeAllocatedMb, 768);
    assert.equal(profile.evidence?.tempdbUsage?.peakAllocatedMb, 900);
    assert.equal(profile.sampleSeries?.databaseIo[0].counterMode, "cumulative");
    assert.equal(profile.physicalIo?.source, "cumulative_file_counters");
    assert.equal(profile.physicalIo?.samples.length, 2);
    assert.equal(profile.physicalIo?.totalIops.p95, 20);
    assert.equal(profile.iops.p95, 20);
    assert.equal(profile.databases[0].databaseName, "orders");
    assert.equal(profile.databases[0].iops?.p95, 15);
    assert.equal(profile.databases[0].iopsSharePct, 75);
    assert.equal(profile.databases[0].throughputSharePct, 78.26);
    assert.equal(profile.databases.find((database) => database.databaseName === "tempdb")?.tempdbSharePct, 10);
    assert.equal(profile.evidence?.edition?.auditComplete, true);
    assert.deepEqual(profile.evidence?.edition?.databases[0].enterpriseFeatures, ["Compression"]);
    assert.equal(profile.evidence?.edition?.databases[0].memoryOptimizedAllocatedMb, 4096);
  });

  it("normalizes consolidated Cost Optimization workload samples", () => {
    const profile = normalizeExistingCollectorCsvs({
      cpuCsv,
      memoryCsv,
      workloadSamplesCsv: consolidatedWorkloadSamplesCsv(),
      ioCsv,
      storageCsv,
      editionCompatibilityCsv
    });

    assert.equal(profile.sampleSeries?.memory.length, 3);
    assert.equal(profile.sampleSeries?.memory[2].memoryGrantsOutstanding, 5);
    assert.equal(profile.sampleSeries?.memory[2].grantedWorkspaceMemoryKb, 1048576);
    assert.equal(profile.sampleSeries?.databaseIo[0].counterMode, "cumulative");
    assert.equal(profile.physicalIo?.source, "cumulative_file_counters");
    assert.equal(profile.iops.p95, 20);
    assert.equal(profile.evidence?.tempdbUsage?.peakAllocatedMb, 900);
    assert.equal(profile.evidence?.fileLatency.length, 3);
    assert.equal(profile.evidence?.edition?.auditComplete, true);
  });

  it("ranks physical database drivers by time-integrated shares instead of independent P95", () => {
    const header = "ServerName,CollectionTime,DBName,database_id,file_id,type_desc,num_of_reads,num_of_writes,num_of_bytes_read,num_of_bytes_written,io_stall_read_ms,io_stall_write_ms";
    const rows = [header];
    let sustainedOperations = 0;
    let burstOperations = 0;
    let sustainedBytes = 0;
    let burstBytes = 0;

    for (let minute = 0; minute <= 10; minute += 1) {
      if (minute > 0) {
        sustainedOperations += 1_200;
        sustainedBytes += 1_200 * 1_048_576;
        if (minute === 1) {
          burstOperations += 6_000;
          burstBytes += 6_000 * 1_048_576;
        }
      }
      const timestamp = `2026-08-28 00:${String(minute).padStart(2, "0")}:00`;
      rows.push(`sql1,${timestamp},sustained_db,5,1,ROWS,${sustainedOperations},0,${sustainedBytes},0,0,0`);
      rows.push(`sql1,${timestamp},burst_db,6,1,ROWS,${burstOperations},0,${burstBytes},0,0,0`);
    }

    const profile = normalizeExistingCollectorCsvs({
      cpuCsv,
      memoryCsv,
      ioCsv,
      fileIoSamplesCsv: rows.join("\n")
    });
    const sustained = profile.databases.find((database) => database.databaseName === "sustained_db");
    const burst = profile.databases.find((database) => database.databaseName === "burst_db");

    assert.ok((burst?.iops?.p95 ?? 0) > (sustained?.iops?.p95 ?? 0));
    assert.equal(sustained?.iopsSharePct, 66.67);
    assert.equal(burst?.iopsSharePct, 33.33);
    assert.equal(profile.databases[0].databaseName, "sustained_db");
    assert.deepEqual(profile.evidence?.topDatabasesByIops, ["sustained_db", "burst_db"]);
    assert.deepEqual(profile.evidence?.topDatabasesByThroughput, ["sustained_db", "burst_db"]);
  });

  it("preserves actual elapsed I/O time without replacing it with the collector cadence", () => {
    const irregularIoCsv = [
      "ServerName,Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime",
      "sql1,1,5,orders,10,5,1048576,524288,1572864,15,0,0,2026-08-28 00:00:00",
      "sql1,2,5,orders,20,10,2097152,1048576,3145728,30,0,0,2026-08-28 00:01:30",
      "sql1,3,5,orders,30,15,3145728,1572864,4718592,45,0,0,2026-08-28 00:03:00"
    ].join("\n");

    const profile = normalizeExistingCollectorCsvs({ cpuCsv, memoryCsv, ioCsv: irregularIoCsv });
    const io = profile.sampleSeries?.databaseIo ?? [];

    assert.equal(io[0].elapsedSeconds, undefined);
    assert.equal(io[0].intervalValid, false);
    assert.equal(io[1].elapsedSeconds, 90);
    assert.equal(io[1].intervalValid, true);
    assert.equal(io[2].elapsedSeconds, 90);
    assert.equal(io[2].intervalValid, true);
  });

  it("records missing, duplicate, out-of-order, reset, and invalid samples", () => {
    const invalidCpuCsv = [
      "ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime",
      "sql1,20,70,10,2026-08-28 00:01:00",
      "sql1,25,65,10,2026-08-28 00:01:30",
      "sql1,30,60,10,2026-08-28 00:00:00",
      "sql1,invalid,60,10,not-a-date"
    ].join("\n");
    const invalidIoCsv = [
      "ServerName,Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime",
      "sql1,1,2,tempdb,10,5,1048576,524288,1572864,15,0,0,2026-08-28 00:00:00",
      "sql1,2,2,tempdb,-1,5,1048576,524288,1572864,4,0,0,2026-08-28 00:01:00",
      "sql1,2,2,tempdb,10,5,1048576,524288,1572864,15,0,0,2026-08-28 00:01:00"
    ].join("\n");

    const profile = normalizeExistingCollectorCsvs({ cpuCsv: invalidCpuCsv, ioCsv: invalidIoCsv });
    const codes = new Set(profile.sampleSeries?.issues.map((issue) => issue.code));

    assert.equal(codes.has("missing_sample"), true);
    assert.equal(codes.has("duplicate_sample"), true);
    assert.equal(codes.has("out_of_order"), true);
    assert.equal(codes.has("counter_reset"), true);
    assert.equal(codes.has("invalid_sample"), true);
    assert.equal(codes.has("invalid_elapsed"), true);
    assert.equal(profile.sampleSeries?.synchronized[0].tempdbIo.length, 1);
  });
});
