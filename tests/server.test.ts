import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import AdmZip from "adm-zip";
import type { CurrentRdsConfig } from "../src/contracts/types.js";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import {
  buildCollectorDownloadZip,
  buildManualUploadRequestFromMultipart,
  createCostOptimizationServer,
  filterRuntimeCatalogEntries
} from "../src/server/index.js";
import { analyzeManualUploadRequest } from "../src/upload/index.js";

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

describe("collector download package", () => {
  it("contains only the approved standalone collector files", () => {
    const entries = new AdmZip(buildCollectorDownloadZip())
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();

    assert.deepEqual(entries, [
      "RunMefirst.bat",
      "RunMefirst.ps1",
      "SSATcollector.ps1",
      "SSATcollector_compatible.ps1",
      "SSATcollector_launcher.ps1",
      "servers_credentials_sample.csv"
    ]);
    assert.ok(entries.every((entry) => !entry.endsWith(".zip")));
    assert.ok(entries.every((entry) => !entry.includes("Copy")));
  });
});

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

const memoryDiagnosticsCsv = [
  "ServerName,CollectionTime,object_name,counter_name,instance_name,cntr_value,cntr_type",
  "sql1,2026-08-28 00:02:00,SQLServer:Memory Manager,Memory Grants Pending,,0,65792",
  "sql1,2026-08-28 00:02:00,SQLServer:Memory Manager,Total Server Memory (KB),,10485760,65792",
  "sql1,2026-08-28 00:02:00,SQLServer:Memory Manager,Target Server Memory (KB),,33554432,65792"
].join("\n");

const cpuInfoCsv = [
  "ServerName,Logical CPU Count,Hyperthread Ratio,Physical CPU Count,VM_type,SQL Edition,SQL Version",
  "sql1,16,2,8,HYPERVISOR,Standard Edition (64-bit),16.00.4125.3"
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

function collectorZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("cpu.csv", Buffer.from(cpuCsv));
  zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
  zip.addFile("memory.csv", Buffer.from(memoryCsv));
  zip.addFile("co_memory_samples.csv", Buffer.from(memorySamplesCsv));
  zip.addFile("co_memory_diagnostics.csv", Buffer.from(memoryDiagnosticsCsv));
  zip.addFile("io.csv", Buffer.from(ioCsv));
  zip.addFile("co_file_io_samples.csv", Buffer.from(fileIoSamplesCsv));
  zip.addFile("storage.csv", Buffer.from(storageCsv));
  zip.addFile("collector_run_manifest.csv", Buffer.from(spreadsheetCsv));
  return zip.toBuffer();
}

const spreadsheetCsv = [
  "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
  "prod-sql-01.abc123.us-east-1.rds.amazonaws.com,db.r8i.4xlarge,gp3,12000,500,512,false"
].join("\n");

function collectorZipWithManifest(manifestCsv: string): Buffer {
  const zip = new AdmZip();
  zip.addFile("cpu.csv", Buffer.from(cpuCsv));
  zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
  zip.addFile("memory.csv", Buffer.from(memoryCsv));
  zip.addFile("co_memory_samples.csv", Buffer.from(memorySamplesCsv));
  zip.addFile("co_memory_diagnostics.csv", Buffer.from(memoryDiagnosticsCsv));
  zip.addFile("io.csv", Buffer.from(ioCsv));
  zip.addFile("co_file_io_samples.csv", Buffer.from(fileIoSamplesCsv));
  zip.addFile("storage.csv", Buffer.from(storageCsv));
  zip.addFile("collector_run_manifest.csv", Buffer.from(manifestCsv));
  return zip.toBuffer();
}

function compactCollectorZip(): Buffer {
  const zip = new AdmZip();
  zip.addFile("cpu.csv", Buffer.from(cpuCsv));
  zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
  zip.addFile("co_workload_samples.csv", Buffer.from(compactWorkloadSamplesCsv()));
  zip.addFile("storage.csv", Buffer.from(storageCsv));
  zip.addFile("collector_run_manifest.csv", Buffer.from(spreadsheetCsv));
  return zip.toBuffer();
}

function compactWorkloadSamplesCsv(): string {
  const memoryClerks = (bufferPoolMb: number, generalMb: number) =>
    JSON.stringify([
      { ClerkType: "MEMORYCLERK_SQLBUFFERPOOL", SizeMb: bufferPoolMb },
      { ClerkType: "MEMORYCLERK_SQLGENERAL", SizeMb: generalMb }
    ]);
  const rows: Array<Record<string, string | number>> = [
    {
      ServerName: "sql1",
      Sample_ID: 1,
      CollectionTime: "2026-08-21 00:00:00",
      SampleType: "memory",
      SqlCommittedMemoryMb: 8000,
      SqlTargetMemoryMb: 16000,
      OsTotalMemoryMb: 32768,
      OsAvailableMemoryMb: 20000,
      MemoryGrantsPending: 0,
      MemoryGrantsOutstanding: 2,
      GrantedWorkspaceMemoryKb: 524288,
      PhysicalMemoryInUseKb: 8192000,
      StolenServerMemoryMb: 600,
      MemoryClerksData: memoryClerks(7000, 600),
      ProcessPhysicalMemoryLow: 0,
      ProcessVirtualMemoryLow: 0,
      SystemLowMemorySignalState: 0,
      SystemHighMemorySignalState: 1,
      SystemMemoryStateDesc: "Available physical memory is high",
      OverallPleSeconds: 10000,
      NumaPleJson: "[]",
      BufferCacheHitRatio: 9950,
      BufferCacheHitRatioBase: 10000,
      PageReadsPerSec: 0,
      PageWritesPerSec: 0,
      LazyWritesPerSec: 0,
      BatchRequestsPerSec: 100
    },
    {
      ServerName: "sql1",
      Sample_ID: 2,
      CollectionTime: "2026-08-21 00:01:00",
      SampleType: "memory",
      SqlCommittedMemoryMb: 9000,
      SqlTargetMemoryMb: 16000,
      OsTotalMemoryMb: 32768,
      OsAvailableMemoryMb: 19000,
      MemoryGrantsPending: 0,
      MemoryGrantsOutstanding: 2,
      GrantedWorkspaceMemoryKb: 524288,
      PhysicalMemoryInUseKb: 9216000,
      StolenServerMemoryMb: 700,
      MemoryClerksData: memoryClerks(7800, 700),
      ProcessPhysicalMemoryLow: 0,
      ProcessVirtualMemoryLow: 0,
      SystemLowMemorySignalState: 0,
      SystemHighMemorySignalState: 1,
      SystemMemoryStateDesc: "Available physical memory is high",
      OverallPleSeconds: 12000,
      NumaPleJson: "[]",
      BufferCacheHitRatio: 9950,
      BufferCacheHitRatioBase: 10000,
      PageReadsPerSec: 600,
      PageWritesPerSec: 120,
      LazyWritesPerSec: 0,
      BatchRequestsPerSec: 200
    },
    {
      ServerName: "sql1",
      Sample_ID: 3,
      CollectionTime: "2026-08-28 00:00:00",
      SampleType: "memory",
      SqlCommittedMemoryMb: 10000,
      SqlTargetMemoryMb: 16000,
      OsTotalMemoryMb: 32768,
      OsAvailableMemoryMb: 18000,
      MemoryGrantsPending: 0,
      MemoryGrantsOutstanding: 2,
      GrantedWorkspaceMemoryKb: 524288,
      PhysicalMemoryInUseKb: 10240000,
      StolenServerMemoryMb: 800,
      MemoryClerksData: memoryClerks(8500, 800),
      ProcessPhysicalMemoryLow: 0,
      ProcessVirtualMemoryLow: 0,
      SystemLowMemorySignalState: 0,
      SystemHighMemorySignalState: 1,
      SystemMemoryStateDesc: "Available physical memory is high",
      OverallPleSeconds: 14000,
      NumaPleJson: "[]",
      BufferCacheHitRatio: 9950,
      BufferCacheHitRatioBase: 10000,
      PageReadsPerSec: 1200,
      PageWritesPerSec: 240,
      LazyWritesPerSec: 0,
      BatchRequestsPerSec: 300
    },
    ...fileIoSamplesCsv.split("\n").slice(1).map((line) => {
      const [ServerName, Sample_ID, CollectionTime, DBName, database_id, file_id, file_type, logical_name, num_of_reads, num_of_bytes_read, io_stall_read_ms, num_of_writes, num_of_bytes_written, io_stall_write_ms, size_on_disk_bytes] = line.split(",");
      return {
        ServerName,
        Sample_ID,
        CollectionTime,
        SampleType: "file_io",
        DBName,
        database_id,
        file_id,
        file_type,
        logical_name,
        num_of_reads,
        num_of_bytes_read,
        io_stall_read_ms,
        num_of_writes,
        num_of_bytes_written,
        io_stall_write_ms,
        size_on_disk_bytes
      };
    })
  ];
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n");
}

function csvCell(value: string | number | undefined): string {
  const raw = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, "\"\"")}"` : raw;
}

describe("manual upload Express assembly", () => {
  it("returns validation errors instead of crashing when the analyze request has no body", async () => {
    const app = createCostOptimizationServer({ catalog });
    const server = app.listen(0);
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/cost/analyze`, { method: "POST" });
      const payload = await response.json() as { ok: boolean; errors: Array<{ code: string }> };

      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
      assert.ok(payload.errors.some((error) => error.code === "COLLECTOR_PACKAGE_REQUIRED"));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it("admits only exact AWS SQL Server processor metadata into the runtime catalog", () => {
    const exact = {
      ...catalog[0],
      region: "us-east-1",
      engineVersion: "16.00.4125.3.v1",
      sqlServerEdition: "Standard" as const,
      sqlServerDefaultVcpuSource: "aws-processor-features" as const,
      orderable: true
    };
    const filtered = filterRuntimeCatalogEntries([
      exact,
      { ...exact, sqlServerDefaultVcpuSource: "consolidated-vcpu" },
      {
        ...catalog[0],
        region: undefined,
        engine: undefined,
        engineVersion: undefined,
        sqlServerEdition: undefined,
        orderable: undefined
      }
    ]);

    assert.deepEqual(filtered, [exact]);
  });

  it("builds an analysis request from spreadsheet and collector ZIP files", async () => {
    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZip() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads.length, 1);
    assert.equal(built.request.uploads[0].currentVcpu, 16);
    assert.equal(built.request.uploads[0].requirements.memoryGb, 5.59);
    assert.equal(built.request.uploads[0].currentConfig.storageType, "gp3");
    assert.equal(built.request.uploads[0].currentConfig.provisionedIops, 12000);
    assert.equal(built.request.uploads[0].currentConfig.provisionedThroughputMbps, 500);
    assert.equal(built.request.uploads[0].currentConfig.allocatedStorageGb, 512);
    assert.equal(built.request.uploads[0].currentConfig.multiAz, false);
    assert.equal(JSON.stringify(built.request.uploads[0].collectorInput).includes("SecretPassword"), false);
    assert.deepEqual(built.request.uploads[0].orderedCandidateInstanceClasses, ["db.r8i.2xlarge"]);

    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true);
    if (!analyzed.ok) return;
    assert.equal(
      analyzed.summary.optimizedServers,
      1,
      JSON.stringify(analyzed.analysis.results[0].harnessFindings.filter((finding) => !finding.passed))
    );
    assert.equal(analyzed.reports[0].recommendedConfig?.instanceClass, "db.r8i.2xlarge");
  });

  it("generates same-size lead-family candidates before smaller sizes", async () => {
    const sameSizeCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.m5.4xlarge",
        region: "us-east-1",
        family: "m5",
        size: "4xlarge",
        vcpu: 16,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 64,
        baselineIops: 40000,
        maxIops: 40000,
        baselineThroughputMbps: 1250,
        maxThroughputMbps: 1250,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true
      },
      {
        instanceClass: "db.m8i.4xlarge",
        region: "us-east-1",
        family: "m8i",
        size: "4xlarge",
        vcpu: 12,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 64,
        baselineIops: 40000,
        maxIops: 40000,
        baselineThroughputMbps: 1250,
        maxThroughputMbps: 1250,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true
      },
      catalog[0]
    ];
    const manifest = [
      "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
      "prod-sql-01.abc123.us-east-1.rds.amazonaws.com,db.m5.4xlarge,gp3,12000,500,512,false"
    ].join("\n");

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZipWithManifest(manifest) }],
      catalog: sameSizeCatalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.deepEqual(built.request.uploads[0].orderedCandidateInstanceClasses, [
      "db.m8i.4xlarge",
      "db.r8i.2xlarge"
    ]);
  });

  it("generates same-size Optimize CPU rescue candidates before smaller I/O paths", async () => {
    const optimizeCpuCatalog: InstanceCatalogEntry[] = [
      {
        instanceClass: "db.m5.4xlarge",
        region: "us-east-1",
        family: "m5",
        size: "4xlarge",
        vcpu: 16,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        memoryGb: 64,
        baselineIops: 40000,
        maxIops: 40000,
        baselineThroughputMbps: 1250,
        maxThroughputMbps: 1250,
        supportedEditions: ["Standard"],
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
        defaultCpuCores: 8,
        defaultThreadsPerCore: 2,
        sqlServerDefaultVcpuSource: "aws-processor-features",
        optimizeCpuConfigurations: [
          { coreCount: 4, threadsPerCore: 2, sqlServerVisibleVcpu: 8, isDefault: false },
          { coreCount: 8, threadsPerCore: 2, sqlServerVisibleVcpu: 16, isDefault: true }
        ],
        memoryGb: 128,
        baselineIops: 80000,
        maxIops: 80000,
        baselineThroughputMbps: 2000,
        maxThroughputMbps: 2000,
        supportedEditions: ["Standard"],
        minSqlMajorVersion: 14,
        engine: "sqlserver-se",
        engineVersion: "16.00.4125.3.v1",
        sqlServerEdition: "Standard",
        orderable: true
      },
      catalog[0]
    ];
    const manifest = [
      "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
      "prod-sql-01.abc123.us-east-1.rds.amazonaws.com,db.m5.4xlarge,gp3,12000,500,512,false"
    ].join("\n");

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZipWithManifest(manifest) }],
      catalog: optimizeCpuCatalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.deepEqual(built.request.uploads[0].orderedCandidateInstanceClasses, [
      "db.r8i.4xlarge",
      "db.r8i.2xlarge"
    ]);
  });

  it("does not request inline exports by default for browser uploads", async () => {
    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZip() }],
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.deepEqual(built.request.exportFormats, []);

    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true);
    if (!analyzed.ok) return;
    assert.deepEqual(analyzed.exports, {});
  });

  it("builds an analysis request from compact CO workload samples without legacy memory CSV", async () => {
    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: compactCollectorZip() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads.length, 1);
    const upload = built.request.uploads[0];
    assert.ok(upload);
    assert.equal(upload.requirements.memoryGb, 7.31);
    assert.equal(upload.collectorCsvs.ioCsv, undefined);
    assert.ok(upload.collectorCsvs.workloadSamplesCsv?.includes("MemoryClerksData"));
    assert.ok(upload.collectorCsvs.workloadSamplesCsv?.includes("file_io"));
  });

  it("uses alternate current-config CSV when the collector run manifest is missing", async () => {
    const quotedSpreadsheetCsv = spreadsheetCsv
      .split("\n")
      .map((line) => line.split(",").map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const zip = new AdmZip();
    zip.addFile("cpu.csv", Buffer.from(cpuCsv));
    zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
    zip.addFile("co_workload_samples.csv", Buffer.from(compactWorkloadSamplesCsv()));
    zip.addFile("storage.csv", Buffer.from(storageCsv));
    zip.addFile("current_config.csv", Buffer.from(quotedSpreadsheetCsv));

    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads.length, 1);
    assert.equal(built.request.uploads[0].collectorInput.existingInstanceClass, "db.r8i.4xlarge");
    assert.equal(built.request.uploads[0].requirements.memoryGb, 7.31);
  });

  it("assesses collector evidence when current RDSSize is missing", async () => {
    const endpoint = "sqlserver.c8gp6baoubnh.us-east-1.rds.amazonaws.com";
    const withEndpoint = (text: string) => text.replaceAll("sql1", endpoint);
    const zip = new AdmZip();
    zip.addFile(`${endpoint}_CPU.csv`, Buffer.from(withEndpoint(cpuCsv)));
    zip.addFile(`${endpoint}_CPUINFO.csv`, Buffer.from(withEndpoint(cpuInfoCsv)));
    zip.addFile(`${endpoint}_CO_WORKLOAD_SAMPLES.csv`, Buffer.from(withEndpoint(compactWorkloadSamplesCsv())));
    zip.addFile(`${endpoint}_STORAGE.csv`, Buffer.from(withEndpoint(storageCsv)));

    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads.length, 1);
    assert.equal(built.request.uploads[0].collectorInput.existingInstanceClass, "");
    assert.equal(built.request.uploads[0].currentConfig.instanceClass, "unknown");
    assert.equal(built.request.uploads[0].currentVcpu, 16);
    assert.deepEqual(built.request.uploads[0].orderedCandidateInstanceClasses, ["db.r8i.2xlarge"]);
    assert.match(built.request.uploads[0].currentConfig.catalogComparisonNote ?? "", /did not include RDSSize/);

    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true, JSON.stringify(analyzed));
    if (!analyzed.ok) return;
    assert.equal(analyzed.reports.length, 1);
    assert.ok(analyzed.reports[0].advisorySignals.some((signal) => signal.includes("did not include RDSSize")));
  });

  it("accepts legacy summary TotalIOPs evidence when compact file_io rows are unavailable", async () => {
    const endpoint = "GAP_96XL_IOPS";
    const summaryIoCsv = [
      "\"ServerName\",\"TotalIOPs\",\"Throuput\",\"CollectionTime\"",
      "\"GAP_96XL_IOPS\",\"300000\",\"9000\",\"06/17/2026 12:00:00 PM\"",
      "\"GAP_96XL_IOPS\",\"300000\",\"9000\",\"06/17/2026 12:01:00 PM\"",
      "\"GAP_96XL_IOPS\",\"300000\",\"9000\",\"06/17/2026 12:02:00 PM\""
    ].join("\n");
    const zip = new AdmZip();
    zip.addFile(`${endpoint}_CPU.csv`, Buffer.from(cpuCsv.replaceAll("sql1", endpoint)));
    zip.addFile(`${endpoint}_CPUINFO.csv`, Buffer.from(cpuInfoCsv.replaceAll("sql1", endpoint)));
    zip.addFile(`${endpoint}_MEM.csv`, Buffer.from(memoryCsv.replaceAll("sql1", endpoint)));
    zip.addFile(`${endpoint}_IO.csv`, Buffer.from(summaryIoCsv));

    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads[0].requirements.iops, 300000);
    assert.equal(built.request.uploads[0].requirements.throughputMbps, 9000);
    assert.equal(built.request.uploads[0].collectorCsvs.fileIoSamplesCsv, undefined);

    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true, JSON.stringify(analyzed));
  });

  it("classifies required collector CSVs by header when filenames are different", async () => {
    const zip = new AdmZip();
    zip.addFile("part-001.csv", Buffer.from(cpuCsv));
    zip.addFile("part-002.csv", Buffer.from(cpuInfoCsv));
    zip.addFile("part-003.csv", Buffer.from(memoryCsv));
    zip.addFile("part-004.csv", Buffer.from(ioCsv));
    zip.addFile("part-005.csv", Buffer.from(spreadsheetCsv));

    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads[0].currentVcpu, 16);
    assert.ok(built.request.uploads[0].requirements.iops > 0);
    assert.ok(built.request.uploads[0].collectorCsvs.ioCsv?.includes("TotalIOPs"));
  });

  it("blocks when CPUINFO evidence is missing", async () => {
    const zip = new AdmZip();
    zip.addFile("cpu.csv", Buffer.from(cpuCsv));
    zip.addFile("memory.csv", Buffer.from(memoryCsv));
    zip.addFile("io.csv", Buffer.from(ioCsv));
    zip.addFile("collector_run_manifest.csv", Buffer.from(spreadsheetCsv));

    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, false, JSON.stringify(built));
    if (built.ok) return;
    assert.ok(built.errors.some((error) => error.code === "COLLECTOR_CPUINFO_FACTS_REQUIRED"));
  });

  it("blocks when memory evidence is missing", async () => {
    const zip = new AdmZip();
    zip.addFile("cpu.csv", Buffer.from(cpuCsv));
    zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
    zip.addFile("io.csv", Buffer.from(ioCsv));
    zip.addFile("collector_run_manifest.csv", Buffer.from(spreadsheetCsv));

    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, false, JSON.stringify(built));
    if (built.ok) return;
    assert.ok(built.errors.some((error) => error.code === "COLLECTOR_MEMORY_FACTS_REQUIRED"));
  });

  it("blocks when I/O evidence is missing", async () => {
    const zip = new AdmZip();
    zip.addFile("cpu.csv", Buffer.from(cpuCsv));
    zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
    zip.addFile("memory.csv", Buffer.from(memoryCsv));
    zip.addFile("collector_run_manifest.csv", Buffer.from(spreadsheetCsv));

    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      exportFormats: "json,csv,pdf",
      catalog
    });

    assert.equal(built.ok, false, JSON.stringify(built));
    if (built.ok) return;
    assert.ok(built.errors.some((error) => error.code === "COLLECTOR_IO_FACTS_REQUIRED"));
  });

  it("preserves approved Standard Edition confirmations and collector edition evidence", async () => {
    const zip = new AdmZip();
    zip.addFile("cpu.csv", Buffer.from(cpuCsv));
    zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
    zip.addFile("memory.csv", Buffer.from(memoryCsv));
    zip.addFile("co_memory_samples.csv", Buffer.from(memorySamplesCsv));
    zip.addFile("co_memory_diagnostics.csv", Buffer.from(memoryDiagnosticsCsv));
    zip.addFile("io.csv", Buffer.from(ioCsv));
    zip.addFile("co_file_io_samples.csv", Buffer.from(fileIoSamplesCsv));
    zip.addFile("storage.csv", Buffer.from(storageCsv));
    zip.addFile("co_edition_compatibility.csv", Buffer.from([
      "ServerName,CollectionTime,DatabaseName,EvidenceType,FeatureName,FeatureId,ValueMb,AuditStatus",
      "sql1,2026-08-28 00:01:00,orders,MEMORY_OPTIMIZED_ALLOCATED,,,0,complete",
      "sql1,2026-08-28 00:01:00,orders,MEMORY_OPTIMIZED_USED,,,0,complete",
      "sql1,2026-08-28 00:01:00,orders,DATABASE_AUDIT,,,,complete"
    ].join("\n")));
    zip.addFile("collector_run_manifest.csv", Buffer.from([
      "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz,VendorSupportsStandardEdition,MigrationPathAccepted,MigrationPath",
      "prod-sql-01.abc123.us-east-1.rds.amazonaws.com,db.r8i.4xlarge,gp3,12000,500,512,false,true,true,aws_dms"
    ].join("\n")));

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      catalog
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.request.uploads[0].collectorInput.vendorSupportsStandardEdition, "true");
    assert.equal(built.request.uploads[0].collectorInput.migrationPathAccepted, "true");
    assert.equal(built.request.uploads[0].collectorInput.migrationPath, "aws_dms");
    assert.match(built.request.uploads[0].collectorCsvs.editionCompatibilityCsv ?? "", /DATABASE_AUDIT/);
  });

  it("groups multi-server package metrics by manifest ServerName filename prefix", async () => {
    const zip = new AdmZip();
    const manifest = [
      "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
      "sql-a.abc123.us-east-1.rds.amazonaws.com,db.r8i.4xlarge,gp3,12000,500,512,false",
      "sql-b.abc123.us-east-1.rds.amazonaws.com,db.r8i.4xlarge,gp3,12000,500,512,false"
    ].join("\n");
    const cpuA = cpuCsv.replaceAll("sql1", "sql-a");
    const cpuB = cpuCsv.replaceAll("sql1", "sql-b").replace("10,80,10", "40,50,10");
    const cpuInfoA = cpuInfoCsv.replaceAll("sql1", "sql-a");
    const cpuInfoB = cpuInfoCsv.replaceAll("sql1", "sql-b");
    const memoryA = memoryCsv.replaceAll("sql1", "sql-a");
    const memoryB = memoryCsv.replaceAll("sql1", "sql-b");
    const ioA = ioCsv.replaceAll("sql1", "sql-a").replaceAll("orders", "orders_a");
    const ioB = ioCsv.replaceAll("sql1", "sql-b").replaceAll("orders", "orders_b");

    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_CPU.csv", Buffer.from(cpuA));
    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_CPUINFO.csv", Buffer.from(cpuInfoA));
    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_MEM.csv", Buffer.from(memoryA));
    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_IO.csv", Buffer.from(ioA));
    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_STORAGE.csv", Buffer.from(storageCsv.replaceAll("sql1", "sql-a").replaceAll("orders", "orders_a")));
    zip.addFile("sql-b.abc123.us-east-1.rds.amazonaws.com_CPU.csv", Buffer.from(cpuB));
    zip.addFile("sql-b.abc123.us-east-1.rds.amazonaws.com_CPUINFO.csv", Buffer.from(cpuInfoB));
    zip.addFile("sql-b.abc123.us-east-1.rds.amazonaws.com_MEM.csv", Buffer.from(memoryB));
    zip.addFile("sql-b.abc123.us-east-1.rds.amazonaws.com_IO.csv", Buffer.from(ioB));
    zip.addFile("sql-b.abc123.us-east-1.rds.amazonaws.com_STORAGE.csv", Buffer.from(storageCsv.replaceAll("sql1", "sql-b").replaceAll("orders", "orders_b")));
    zip.addFile("collector_run_manifest.csv", Buffer.from(manifest));

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads.length, 2);
    assert.equal(built.request.uploads[0].serverName, "sql-a.abc123.us-east-1.rds.amazonaws.com");
    assert.equal(built.request.uploads[1].serverName, "sql-b.abc123.us-east-1.rds.amazonaws.com");
    assert.ok(built.request.uploads[0].collectorCsvs.cpuCsv.includes("sql-a"));
    assert.ok(!built.request.uploads[0].collectorCsvs.cpuCsv.includes("sql-b"));
    assert.ok(built.request.uploads[1].collectorCsvs.cpuCsv.includes("sql-b"));
    assert.ok(!built.request.uploads[1].collectorCsvs.cpuCsv.includes("sql-a"));
    assert.ok(built.request.uploads[0].collectorCsvs.ioCsv?.includes("orders_a"));
    assert.ok(built.request.uploads[1].collectorCsvs.ioCsv?.includes("orders_b"));
  });

  it("fails closed when a multi-server package cannot isolate one server's files", async () => {
    const zip = new AdmZip();
    const manifest = [
      "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
      "sql-a.abc123.us-east-1.rds.amazonaws.com,db.r8i.4xlarge,gp3,12000,500,512,false",
      "sql-b.abc123.us-east-1.rds.amazonaws.com,db.r8i.4xlarge,gp3,12000,500,512,false"
    ].join("\n");

    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_CPU.csv", Buffer.from(cpuCsv.replaceAll("sql1", "sql-a")));
    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_CPUINFO.csv", Buffer.from(cpuInfoCsv.replaceAll("sql1", "sql-a")));
    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_MEM.csv", Buffer.from(memoryCsv.replaceAll("sql1", "sql-a")));
    zip.addFile("sql-a.abc123.us-east-1.rds.amazonaws.com_IO.csv", Buffer.from(ioCsv.replaceAll("sql1", "sql-a")));
    zip.addFile("collector_run_manifest.csv", Buffer.from(manifest));

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      catalog
    });

    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.ok(built.errors.some((error) =>
      error.code === "COLLECTOR_SERVER_EVIDENCE_REQUIRED"
      && error.serverName === "sql-b.abc123.us-east-1.rds.amazonaws.com"
    ));
  });

  it("uses endpoint region to filter regional catalog rows", async () => {
    const regionalCatalog: InstanceCatalogEntry[] = [
      { ...catalog[0], region: "eu-west-1", maxIops: 1000 },
      { ...catalog[0], region: "us-east-1", maxIops: 40000 },
      { ...catalog[1], region: "us-east-1" }
    ];

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZip() }],
      catalog: regionalCatalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads[0].currentConfig.region, "us-east-1");
    assert.deepEqual(built.request.uploads[0].orderedCandidateInstanceClasses, ["db.r8i.2xlarge"]);

    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true);
    if (!analyzed.ok) return;
    assert.equal(
      analyzed.reports[0].recommendedConfig?.instanceClass,
      "db.r8i.2xlarge",
      JSON.stringify(analyzed.analysis.results[0].harnessFindings.filter((finding) => !finding.passed))
    );
  });

  it("falls back to us-east-1 and labels evidence when endpoint region cannot be inferred", async () => {
    const fallbackManifest = [
      "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
      "prod-sql-01.rds.amazonaws.com,db.r8i.4xlarge,gp3,12000,500,512,false"
    ].join("\n");

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZipWithManifest(fallbackManifest) }],
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads[0].currentConfig.region, "us-east-1");
    assert.equal(built.request.uploads[0].currentConfig.regionSource, "fallback");

    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true);
    if (!analyzed.ok) return;
    assert.ok(analyzed.reports[0].advisorySignals.some((signal) => signal.includes("using us-east-1")));
  });

  it("uses CPUINFO current vCPU when current RDSSize is missing from the catalog", async () => {
    const missingCurrentManifest = [
      "ServerName,RDSSize,StorageType,ProvisionedIops,ProvisionedThroughputMbps,AllocatedStorageGb,MultiAz",
      "prod-sql-01.abc123.us-east-1.rds.amazonaws.com,db.r8i.12xlarge,gp3,12000,500,512,false"
    ].join("\n");

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZipWithManifest(missingCurrentManifest) }],
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads[0].currentVcpu, 16);
    assert.equal(built.request.uploads[0].currentConfig.catalogMatch, false);
    assert.deepEqual(built.request.uploads[0].orderedCandidateInstanceClasses, ["db.r8i.2xlarge"]);

    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true);
    if (!analyzed.ok) return;
    assert.equal(analyzed.reports[0].recommendedConfig?.instanceClass, "db.r8i.2xlarge");
    assert.ok(analyzed.reports[0].advisorySignals.some((signal) => signal.includes("not found in the us-east-1 catalog")));
  });

  it("allows upload assembly without owner email until registration and login are implemented", async () => {
    const built = await buildManualUploadRequestFromMultipart({
      customerName: "Example Customer",
      collectorPackages: [{ originalname: "collector.zip", buffer: collectorZip() }],
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads.length, 1);
  });

  it("does not treat installed memory or SQL target memory as required workload memory", async () => {
    const lowUsageMemoryCsv = [
      "ServerName,SQL_CollectionTime,SQLCurrMemUsageMB,SQLMaxMemTargetMB,OSTotalMemoryMB,OSAVAMemoryMB,PLE,StolenServerMem,MemoryClerksData",
      "sql1,2026-08-21 00:00:00,2048,262144,262144,245760,9000,100,{}",
      "sql1,2026-08-28 00:00:00,3072,262144,262144,244736,9000,100,{}"
    ].join("\n");
    const zip = new AdmZip();
    zip.addFile("cpu.csv", Buffer.from(cpuCsv));
    zip.addFile("cpuinfo.csv", Buffer.from(cpuInfoCsv));
    zip.addFile("memory.csv", Buffer.from(lowUsageMemoryCsv));
    zip.addFile("co_memory_diagnostics.csv", Buffer.from([
      "ServerName,CollectionTime,object_name,counter_name,instance_name,cntr_value,cntr_type",
      "sql1,2026-08-28 00:01:00,SQLServer:Memory Manager,Memory Grants Pending,,0,65792",
      "sql1,2026-08-28 00:01:00,SQLServer:Memory Manager,Total Server Memory (KB),,3145728,65792"
    ].join("\n")));
    zip.addFile("io.csv", Buffer.from(ioCsv));
    zip.addFile("co_file_io_samples.csv", Buffer.from(fileIoSamplesCsv));
    zip.addFile("storage.csv", Buffer.from(storageCsv));
    zip.addFile("collector_run_manifest.csv", Buffer.from(spreadsheetCsv));

    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [{ originalname: "collector.zip", buffer: zip.toBuffer() }],
      catalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    assert.equal(built.request.uploads[0].requirements.memoryGb, 16.92);
    assert.ok(built.request.uploads[0].requirements.memoryGb < 256);
  });
});







