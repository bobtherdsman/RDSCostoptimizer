import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurrentRdsConfig } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { analyzeManualUploadRequest, validateManualUploadRequest } from "../src/upload/index.js";

const catalog: InstanceCatalogEntry[] = [
  {
    instanceClass: "db.r8i.2xlarge",
    region: "us-east-1",
    family: "r8i",
    size: "2xlarge",
    vcpu: 8,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 64,
    baselineIops: 40000,
    maxIops: 40000,
    baselineThroughputMbps: 1250,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard", "Web"],
    minSqlMajorVersion: 14,
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
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
  }
];

const currentConfig: CurrentRdsConfig = {
  region: "us-east-1",
  instanceClass: "db.r8i.4xlarge",
  sqlServerEdition: "Standard",
  sqlServerVersion: "16.00.4125.3",
  licenseModel: "license-included",
  storageType: "gp3",
  allocatedStorageGb: 512,
  provisionedIops: 12000,
  provisionedThroughputMbps: 500,
  multiAz: false
};

const cpuCsv = [
  "ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime",
  "sql1,10,80,10,2026-08-21 00:00:00",
  "sql1,20,70,10,2026-08-21 00:01:00",
  "sql1,30,60,10,2026-08-28 00:00:00"
].join("\n");

const memoryCsv = [
  "ServerName,SQL_CollectionTime,SQLCurrMemUsageMB,SQLMaxMemTargetMB,OSTotalMemoryMB,OSAVAMemoryMB,PLE,StolenServerMem,MemoryClerksData",
  "sql1,2026-08-21 00:00:00,8000,16000,32768,12000,10000,100,{}",
  "sql1,2026-08-21 00:01:00,9000,16000,32768,11000,12000,100,{}",
  "sql1,2026-08-28 00:00:00,10000,16000,32768,10000,14000,100,{}"
].join("\n");

const memorySamplesCsv = [
  "ServerName,Sample_ID,CollectionTime,SqlCommittedMemoryMb,SqlTargetMemoryMb,OsTotalMemoryMb,OsAvailableMemoryMb,MemoryGrantsPending,MemoryGrantsOutstanding,GrantedWorkspaceMemoryKb,PhysicalMemoryInUseKb,ProcessPhysicalMemoryLow,ProcessVirtualMemoryLow,SystemLowMemorySignalState,SystemHighMemorySignalState,SystemMemoryStateDesc,OverallPleSeconds,NumaPleJson,BufferCacheHitRatio,BufferCacheHitRatioBase,PageReadsPerSec,PageWritesPerSec,LazyWritesPerSec,BatchRequestsPerSec,ColumnstoreSegmentCacheMb",
  "sql1,1,2026-08-21 00:00:00,8000,16000,32768,20000,0,2,524288,8192000,0,0,0,1,Available physical memory is high,10000,[],9950,10000,0,0,0,100,0",
  "sql1,2,2026-08-21 00:01:00,9000,16000,32768,20000,0,2,524288,9216000,0,0,0,1,Available physical memory is high,12000,[],9950,10000,600,120,0,100,0",
  "sql1,3,2026-08-28 00:00:00,10000,16000,32768,20000,0,2,524288,10240000,0,0,0,1,Available physical memory is high,14000,[],9950,10000,1200,240,0,100,0"
].join("\n");

const ioCsv = [
  "ServerName,Sample_ID,Database_ID,DBName,Read,Written,BRead,BWritten,TotalB,TotalIOPs,Throuput,Netpackets,CollectionTime",
  "sql1,1,5,orders,0,0,314572800,314572800,0,6000,0,0,2026-08-21 00:00:00",
  "sql1,2,5,orders,0,0,629145600,629145600,0,12000,0,0,2026-08-21 00:01:00",
  "sql1,3,5,orders,0,0,943718400,943718400,0,18000,0,0,2026-08-28 00:00:00"
].join("\n");

const fileIoSamplesCsv = [
  "ServerName,Sample_ID,CollectionTime,DBName,database_id,file_id,file_type,logical_name,num_of_reads,num_of_bytes_read,io_stall_read_ms,num_of_writes,num_of_bytes_written,io_stall_write_ms,size_on_disk_bytes",
  "sql1,1,2026-08-21 00:00:00,orders,5,1,ROWS,orders_data,0,0,0,0,0,0,536870912000",
  "sql1,2,2026-08-21 00:01:00,orders,5,1,ROWS,orders_data,600,62914560,1200,300,31457280,600,536870912000",
  "sql1,3,2026-08-28 00:00:00,orders,5,1,ROWS,orders_data,1200,125829120,2400,600,62914560,1200,536870912000"
].join("\n");

const storageCsv = [
  "ServerName,DBName,SizeGB",
  "sql1,orders,500"
].join("\n");

function upload(overrides = {}) {
  return {
    serverName: "prod-sql-01",
    collectorInput: {
      rdsEndpoint: "prod-sql-01.abc123.us-east-1.rds.amazonaws.com",
      login: "collector_login",
      password: "SecretPassword123!",
      database: "msdb",
      existingInstanceClass: "db.r8i.4xlarge"
    },
    collectorCsvs: {
      cpuCsv,
      memoryCsv,
      memorySamplesCsv,
      ioCsv,
      fileIoSamplesCsv,
      storageCsv
    },
    currentConfig,
    currentVcpu: 16,
    requirements: {
      memoryGb: 48,
      iops: 400,
      throughputMbps: 40
    },
    orderedCandidateInstanceClasses: ["db.r8i.2xlarge"],
    ...overrides
  };
}

describe("manual upload analysis", () => {
  it("runs one manual upload using derived lower-vCPU candidate order", () => {
    const response = analyzeManualUploadRequest({
      catalog,
      uploads: [upload()],
      exportFormats: ["json", "csv"]
    });

    assert.equal(response.ok, true);
    if (!response.ok) return;
    assert.equal(response.uploadCount, 1);
    assert.equal(
      response.reports[0].recommendedConfig?.instanceClass,
      "db.r8i.2xlarge",
      JSON.stringify(response.analysis.results[0].harnessFindings.filter((finding) => !finding.passed))
    );
    assert.equal(response.summary.optimizedServers, 1);
    assert.equal(JSON.stringify(response.collectorInputs).includes("collector_login"), false);
    assert.equal(JSON.stringify(response.collectorInputs).includes("SecretPassword123!"), false);
    assert.ok(response.exports.json?.includes('"summary"'));
    assert.ok(response.exports.csv?.includes("prod-sql-01"));
  });

  it("preserves per-server reporting for multiple manual uploads", () => {
    const response = analyzeManualUploadRequest({
      catalog,
      uploads: [
        upload(),
        upload({ serverName: "prod-sql-02", collectorInput: { ...upload().collectorInput, rdsEndpoint: "prod-sql-02.abc123.us-east-1.rds.amazonaws.com" } })
      ]
    });

    assert.equal(response.ok, true);
    if (!response.ok) return;
    assert.equal(response.uploadCount, 2);
    assert.equal(response.reports.length, 2);
    assert.equal(response.summary.totalServers, 2);
  });

  it("returns descriptive validation errors for incomplete manual uploads", () => {
    const errors = validateManualUploadRequest({
      catalog,
      uploads: [
        upload({
          collectorCsvs: { cpuCsv: "", ioCsv: "" },
          currentConfig: { ...currentConfig, instanceClass: "db.r8i.8xlarge" },
          orderedCandidateInstanceClasses: []
        })
      ]
    });

    assert.ok(errors.some((error) => error.code === "CPU_CSV_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "IO_CSV_REQUIRED"));
    assert.ok(errors.some((error) => error.code === "EXISTING_INSTANCE_MISMATCH"));
    assert.ok(errors.some((error) => error.code === "CANDIDATES_REQUIRED"));
  });
});
