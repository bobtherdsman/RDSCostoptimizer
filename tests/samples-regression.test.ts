import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import type { InstanceCatalogEntry } from "../src/catalog/index.js";
import { normalizeExistingCollectorCsvs, type ExistingCollectorCsvSet } from "../src/parser/index.js";
import { buildManualUploadRequestFromMultipart } from "../src/server/index.js";
import { analyzeManualUploadRequest } from "../src/upload/index.js";

const samplesDir = join(process.cwd(), "samples");
const toolSamplesDir = join(samplesDir, "tool-regression");
const sampleZipFiles = readdirSync(samplesDir).filter((name) => name.toLowerCase().endsWith(".zip")).sort();
const toolSampleZipFiles = readdirSync(toolSamplesDir).filter((name) => name.toLowerCase().endsWith(".zip")).sort();

const sampleCases = [
  { fileName: "gold-01-safe-downsize.zip", status: "recommended", recommendation: "db.r8i.8xlarge" },
  { fileName: "gold-02-memory-blocked.zip", status: "not_recommended", blocker: "MEMORY_PRESSURE_DETECTED" },
  { fileName: "gold-03-iops-blocked.zip", status: "not_recommended", blocker: "IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED" },
  { fileName: "gold-04-throughput-blocked.zip", status: "not_recommended", blocker: "THROUGHPUT_P95_EFFECTIVE_CAPABILITY_EXCEEDED" },
  { fileName: "gold-05-cpu-blocked.zip", status: "not_recommended", blocker: "CPU_P95_TARGET_EXCEEDED" },
  { fileName: "gold-06-short-collection.zip", status: "not_recommended", blocker: "COLLECTION_WINDOW_TOO_SHORT" },
  { fileName: "gold-07-sql-version-blocked.zip", status: "not_recommended", blocker: "SQL_VERSION_NOT_ORDERABLE" },
  { fileName: "gold-08-edition-blocked.zip", status: "not_recommended", blocker: "EDITION_NOT_SUPPORTED" },
  { fileName: "gold-09-catalog-gap-fallback.zip", status: "not_recommended", blocker: "IOPS_STORAGE_CAPABILITY_UNKNOWN" },
  { fileName: "gold-10-tempdb-dominant.zip", status: "recommended", recommendation: "db.r8i.8xlarge" }
] as const;

const toolSampleStandardCatalog: InstanceCatalogEntry[] = [
  {
    instanceClass: "db.r8i.2xlarge",
    family: "r8i",
    size: "2xlarge",
    vcpu: 4,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 64,
    baselineIops: 40000,
    maxIops: 40000,
    baselineThroughputMbps: 1250,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 14,
    region: "us-east-1",
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
  {
    instanceClass: "db.r8i.4xlarge",
    family: "r8i",
    size: "4xlarge",
    vcpu: 8,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 128,
    baselineIops: 40000,
    maxIops: 40000,
    baselineThroughputMbps: 1250,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 14,
    region: "us-east-1",
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
  {
    instanceClass: "db.r8i.8xlarge",
    family: "r8i",
    size: "8xlarge",
    vcpu: 16,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 256,
    baselineIops: 40000,
    maxIops: 40000,
    baselineThroughputMbps: 1250,
    maxThroughputMbps: 1250,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 14,
    region: "us-east-1",
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  },
  {
    instanceClass: "db.r8i.16xlarge",
    family: "r8i",
    size: "16xlarge",
    vcpu: 32,
    sqlServerDefaultVcpuSource: "aws-processor-features",
    memoryGb: 512,
    baselineIops: 80000,
    maxIops: 80000,
    baselineThroughputMbps: 2000,
    maxThroughputMbps: 2000,
    supportedEditions: ["Enterprise", "Standard"],
    minSqlMajorVersion: 14,
    region: "us-east-1",
    engine: "sqlserver-se",
    engineVersion: "16.00.4125.3.v1",
    sqlServerEdition: "Standard",
    orderable: true
  }
];

const toolSampleCatalog: InstanceCatalogEntry[] = toolSampleStandardCatalog.flatMap((entry) => [
  entry,
  {
    ...entry,
    engine: "sqlserver-ee",
    sqlServerEdition: "Enterprise",
    supportedEditions: ["Enterprise"]
  }
]);

describe("gold sample collector package regression fixtures", () => {
  it("GOLD-SUITE-001: contains exactly the ten approved gold scenarios and no root legacy ZIPs", () => {
    assert.equal(sampleZipFiles.length, 0);
    assert.deepEqual(toolSampleZipFiles, sampleCases.map((sample) => sample.fileName).sort());
  });

  it("GOLD-SUITE-002: uses valid collector schemas and preserves required diagnostics in every package", () => {
    for (const sample of sampleCases) {
      const csvs = collectorCsvSetFromToolZip(sample.fileName);
      assert.match(firstLine(csvs.cpuCsv), /ServerName,SqlSerCpuUT,SystemIdle,OtherProCpuUT,Collectiontime/i);
      assert.match(firstLine(csvs.cpuInfoCsv), /Logical CPU Count/i);
      assert.match(firstLine(csvs.cpuInfoCsv), /Socket Count/i);
      assert.match(firstLine(csvs.memoryCsv), /SQLCurrMemUsageMB/i);
      assert.match(firstLine(csvs.ioCsv), /TotalIOPs/i);
      assert.ok(csvs.memoryDiagnosticsCsv?.trim(), `${sample.fileName} must include memory diagnostics`);
      assert.ok(csvs.memorySamplesCsv?.trim(), `${sample.fileName} must include per-minute memory samples`);
      assert.ok(csvs.waitStatsCsv?.trim(), `${sample.fileName} must include wait stats`);
      assert.ok(csvs.fileIoCsv?.trim(), `${sample.fileName} must include file I/O`);
      assert.ok(csvs.fileIoSamplesCsv?.trim(), `${sample.fileName} must include cumulative per-file I/O samples`);
      assert.ok(csvs.tempdbUsageCsv?.trim(), `${sample.fileName} must include tempdb usage`);
      assert.ok(csvs.tempdbSamplesCsv?.trim(), `${sample.fileName} must include per-minute tempdb samples`);
      assert.ok(csvs.dbCpuRequestCsv?.trim(), `${sample.fileName} must include DB CPU advisory evidence`);

      const profile = normalizeExistingCollectorCsvs(csvs as ExistingCollectorCsvSet);
      assert.ok(profile.cpuPct.p95 > 0, `${sample.fileName} CPU P95 must be a real utilization signal`);
      assert.ok(profile.iops.p95 > 0, `${sample.fileName} IOPS P95 must be positive`);
      assert.ok(profile.throughputMbps.p95 > 0, `${sample.fileName} throughput P95 must be positive`);
      assert.equal(profile.databases.length, 3, `${sample.fileName} must preserve three DB-level drivers`);
      const durationHours = sample.fileName === "gold-06-short-collection.zip" ? 6 : 168;
      const expectedSampleCount = durationHours * 60 + 1;
      assert.equal(profile.sampleSeries?.cpu.length, expectedSampleCount, `${sample.fileName} CPU cadence mismatch`);
      assert.equal(profile.sampleSeries?.memory.length, expectedSampleCount, `${sample.fileName} memory cadence mismatch`);
      assert.equal(profile.physicalIo?.samples.length, expectedSampleCount - 1, `${sample.fileName} physical I/O cadence mismatch`);
      assert.equal(profile.evidenceWindow?.durationHours, durationHours, `${sample.fileName} duration mismatch`);
      assert.equal(profile.evidenceWindow?.continuityStatus, "complete", `${sample.fileName} continuity mismatch`);
      assert.equal(profile.evidence?.memory?.batchRequestsPerSec?.p95, 100, `${sample.fileName} Batch Requests rate mismatch`);
    }
  });

  it("GOLD-SUITE-003: produces the exact expected recommendation or blocker for every gold scenario", async () => {
    for (const sample of sampleCases) {
      const built = await buildToolSampleUpload(sample.fileName);
      assert.equal(built.ok, true, `${sample.fileName} failed upload assembly: ${JSON.stringify(built)}`);
      if (!built.ok) continue;

      const analyzed = analyzeManualUploadRequest(built.request);
      assert.equal(analyzed.ok, true, `${sample.fileName} failed analysis: ${JSON.stringify(analyzed)}`);
      if (!analyzed.ok) continue;

      const report = analyzed.reports[0];
      assert.equal(report.status, sample.status, `${sample.fileName} status mismatch`);
      const cpuClassificationFinding = report.harnessFindings.find((finding) =>
        finding.oracle === "CO-L-CPU-STATE-CLASSIFICATION"
      );
      assert.equal(
        cpuClassificationFinding?.passed,
        true,
        `${sample.fileName} production and independent CPU classification disagree: ${JSON.stringify(cpuClassificationFinding)}`
      );
      if ("recommendation" in sample) {
        assert.equal(report.recommendedConfig?.instanceClass, sample.recommendation, `${sample.fileName} recommendation mismatch`);
      } else {
        assert.ok(report.blockers.some((blocker) => blocker.code === sample.blocker), `${sample.fileName} missing blocker ${sample.blocker}: ${JSON.stringify(report.blockers)}`);
      }
    }
  });

  it("GOLD-SUITE-004: covers catalog-gap fallback, missing storage facts, and tempdb-dominant advisory evidence", async () => {
    const gapBuilt = await buildToolSampleUpload("gold-09-catalog-gap-fallback.zip");
    assert.equal(gapBuilt.ok, true, JSON.stringify(gapBuilt));
    if (gapBuilt.ok) {
      const upload = gapBuilt.request.uploads[0];
      assert.equal(upload.currentConfig.catalogMatch, false);
      assert.equal(upload.currentConfig.regionSource, "fallback");
      assert.equal(upload.currentConfig.storageType, "unknown");
      assert.equal(upload.currentVcpu, 24);
    }

    const tempdbBuilt = await buildToolSampleUpload("gold-10-tempdb-dominant.zip");
    assert.equal(tempdbBuilt.ok, true, JSON.stringify(tempdbBuilt));
    if (!tempdbBuilt.ok) return;
    const analyzed = analyzeManualUploadRequest(tempdbBuilt.request);
    assert.equal(analyzed.ok, true, JSON.stringify(analyzed));
    if (!analyzed.ok) return;

    assert.ok((analyzed.reports[0].evidence?.tempdbIoSharePct ?? 0) > 60);
    assert.ok(analyzed.reports[0].advisorySignals.some((signal) => signal.toLowerCase().includes("tempdb")));
    assert.equal(analyzed.reports[0].topDatabaseDrivers[0]?.databaseName, "tempdb");
  });

  it("GOLD-SUITE-005: supports a multi-server upload with independent recommendation and blocker results", async () => {
    const built = await buildManualUploadRequestFromMultipart({
      ownerEmail: "owner@example.com",
      requesterEmail: "owner@example.com",
      collectorPackages: [
        packageFile("gold-01-safe-downsize.zip"),
        packageFile("gold-03-iops-blocked.zip")
      ],
      catalog: toolSampleCatalog
    });

    assert.equal(built.ok, true, JSON.stringify(built));
    if (!built.ok) return;
    const analyzed = analyzeManualUploadRequest(built.request);
    assert.equal(analyzed.ok, true, JSON.stringify(analyzed));
    if (!analyzed.ok) return;

    assert.equal(analyzed.summary.totalServers, 2);
    assert.equal(analyzed.summary.optimizedServers, 1);
    assert.equal(analyzed.summary.notOptimizedServers, 1);
  });
});

function collectorCsvSetFromToolZip(file: string): Partial<ExistingCollectorCsvSet> {
  const zip = new AdmZip(join(toolSamplesDir, file));
  const csvs = zip.getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith(".csv"))
    .map((entry) => ({ name: normalizeName(entry.entryName), text: entry.getData().toString("utf8") }));

  return {
    cpuCsv: csvs.find((csv) => csv.name.includes("_cpu_") && !csv.name.includes("_cpuinfo_") && !csv.name.includes("co_db_cpu"))?.text,
    cpuInfoCsv: csvs.find((csv) => csv.name.includes("_cpuinfo_"))?.text,
    memoryCsv: csvs.find((csv) => csv.name.includes("_mem_"))?.text,
    memorySamplesCsv: csvs.find((csv) => csv.name.includes("co_memory_samples"))?.text,
    memoryDiagnosticsCsv: csvs.find((csv) => csv.name.includes("co_memory_diagnostics"))?.text,
    ioCsv: csvs.find((csv) => csv.name.includes("_io_") && !csv.name.includes("co_file_io"))?.text,
    waitStatsCsv: csvs.find((csv) => csv.name.includes("co_wait_stats"))?.text,
    fileIoCsv: csvs.find((csv) => csv.name.includes("co_file_io") && !csv.name.includes("co_file_io_samples"))?.text,
    fileIoSamplesCsv: csvs.find((csv) => csv.name.includes("co_file_io_samples"))?.text,
    tempdbUsageCsv: csvs.find((csv) => csv.name.includes("co_tempdb_usage"))?.text,
    tempdbSamplesCsv: csvs.find((csv) => csv.name.includes("co_tempdb_samples"))?.text,
    dbCpuRequestCsv: csvs.find((csv) => csv.name.includes("co_db_cpu_request_sample"))?.text
  };
}

function packageFile(fileName: string) {
  return {
    originalname: fileName,
    buffer: readFileSync(join(toolSamplesDir, fileName))
  };
}

function firstLine(value: string | undefined): string {
  return value?.split(/\r?\n/, 1)[0] ?? "";
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

async function buildToolSampleUpload(file: string) {
  return buildManualUploadRequestFromMultipart({
    ownerEmail: "owner@example.com",
    requesterEmail: "owner@example.com",
    collectorPackages: [packageFile(file)],
    catalog: toolSampleCatalog
  });
}
