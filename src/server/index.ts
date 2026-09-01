import express, { type Request, type Response } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiValidationError, CollectorExcelInput, ExportFormat } from "../api/index.js";
import {
  candidateAvailabilityFailures,
  catalogForSqlServerConfiguration,
  hasExactCandidateOrderabilityMetadata,
  type CandidateRequirements,
  type InstanceCatalogEntry
} from "../catalog/index.js";
import type { CurrentRdsConfig } from "../contracts/types.js";
import { parseCsv, type CsvRow } from "../parser/csv.js";
import { normalizeExistingCollectorCsvs, type ExistingCollectorCsvSet } from "../parser/index.js";
import { validateOwnerAccess } from "../access/index.js";
import { analyzeManualUploadRequest, type ManualUploadRequest, type ManualUploadServerPackage } from "../upload/index.js";
import { buildManualUploadPageView, buildManualUploadResultsView, renderAssessmentPageHtml, renderManualUploadPageHtml, renderManualUploadResultsHtml, renderOfferingServicesPageHtml, renderSimpleInfoPageHtml } from "../ui/index.js";

export interface CostOptimizationServerOptions {
  catalog?: readonly InstanceCatalogEntry[];
  ownerEmail?: string;
}

export interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
}

export interface MultipartBuildInput {
  ownerEmail?: string;
  requesterEmail?: string;
  collectorPackages: readonly UploadedFileLike[];
  exportFormats?: string;
  catalog: readonly InstanceCatalogEntry[];
}

export type MultipartBuildResult =
  | { ok: true; request: ManualUploadRequest }
  | { ok: false; statusCode: number; errors: ApiValidationError[] };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 40 } });
const DEFAULT_FALLBACK_REGION = "us-east-1";

interface CollectorRowPackage {
  row: CollectorExcelInput;
  packageFile: UploadedFileLike;
}

export function createCostOptimizationServer(options: CostOptimizationServerOptions = {}) {
  const app = express();
  const catalog = [...(options.catalog ?? loadDefaultCatalog())];
  const ownerEmail = options.ownerEmail ?? process.env.COST_OWNER_EMAIL;

  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get(["/", "/cost"], (_req, res) => {
    res.type("html").send(renderManualUploadPageHtml(buildManualUploadPageView()));
  });

  app.get("/cost/assessment", (_req, res) => {
    res.type("html").send(renderAssessmentPageHtml(buildManualUploadPageView()));
  });

  app.get("/cost/services", (_req, res) => {
    res.type("html").send(renderOfferingServicesPageHtml(buildManualUploadPageView()));
  });

  app.get("/cost/resources", (_req, res) => {
    res.type("html").send(renderSimpleInfoPageHtml(
      "RDS SQL Server Cost Optimization Resources",
      "Resources",
      "Optimization guidance for evidence-led decisions.",
      "Use these resources to understand the workload evidence, guardrails, and decision flow behind the RDS SQL Server cost optimization offering."
    ));
  });

  app.get("/cost/about", (_req, res) => {
    res.type("html").send(renderSimpleInfoPageHtml(
      "About RDS SQL Server Cost Optimization",
      "About us",
      "A focused service for responsible database cost decisions.",
      "This standalone service helps teams decide whether RDS SQL Server workloads can safely move to a lower compute footprint without changing customer data or production behavior."
    ));
  });

  app.get("/cost/login", (_req, res) => {
    res.type("html").send(renderSimpleInfoPageHtml(
      "RDS SQL Server Cost Optimization Login",
      "Login",
      "Access is limited to approved owners.",
      "Use the owner-approved assessment workflow to upload collector evidence and review workload-fit results."
    ));
  });

  app.get("/cost/collector", (_req, res) => {
    const zip = buildCollectorDownloadZip();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=RDSCostOptimizationCollector.zip");
    res.send(zip);
  });

  app.post(
    "/cost/analyze",
    upload.fields([{ name: "collectorPackages", maxCount: 20 }]),
    (req, res) => void handleAnalyze(req, res, catalog, ownerEmail)
  );

  return app;
}

export async function buildManualUploadRequestFromMultipart(input: MultipartBuildInput): Promise<MultipartBuildResult> {
  const access = validateOwnerAccess({ ownerEmail: input.ownerEmail, requesterEmail: input.requesterEmail });
  if (!access.ok) return { ok: false, statusCode: 403, errors: access.errors };

  const errors: ApiValidationError[] = [];
  if (input.collectorPackages.length === 0) {
    errors.push({ code: "COLLECTOR_PACKAGE_REQUIRED", field: "collectorPackages", message: "Manual upload requires at least one collector ZIP package." });
  }

  const spreadsheetRows = await parseCollectorRowsFromPackages(input.collectorPackages, errors);
  const exportFormats = splitList(input.exportFormats).filter((format): format is ExportFormat => ["json", "csv", "pdf"].includes(format));

  if (spreadsheetRows.length === 0 && input.collectorPackages.length > 0) {
    errors.push({ code: "COLLECTOR_SPREADSHEET_NOT_FOUND", field: "collectorPackages", message: "Collector upload must include the non-secret collector run manifest CSV inside the collector package." });
  }

  if (errors.length > 0) return { ok: false, statusCode: 400, errors };

  const uploads: ManualUploadServerPackage[] = [];
  const serverRowsPerPackage = new Map<UploadedFileLike, number>();
  for (const item of spreadsheetRows) {
    serverRowsPerPackage.set(item.packageFile, (serverRowsPerPackage.get(item.packageFile) ?? 0) + 1);
  }

  for (const { row, packageFile } of spreadsheetRows) {
    let collectorCsvs: ExistingCollectorCsvSet;
    let workload: ReturnType<typeof normalizeExistingCollectorCsvs>;
    try {
      collectorCsvs = extractCollectorCsvs(
        packageFile,
        row.rdsEndpoint,
        (serverRowsPerPackage.get(packageFile) ?? 0) > 1
      );
      workload = normalizeExistingCollectorCsvs(collectorCsvs);
    } catch (error) {
      errors.push({
        code: "COLLECTOR_SERVER_EVIDENCE_REQUIRED",
        serverName: row.rdsEndpoint,
        field: "collectorPackages",
        message: error instanceof Error ? error.message : "Collector package evidence could not be isolated for this server."
      });
      continue;
    }
    const currentConfig = currentConfigFromCollectorOutput(row, collectorCsvs, workload.totalDatabaseSizeGb, errors);
    const requirements = requirementsFromCollectorOutput(row, workload, workload.iops.p95, workload.throughputMbps.p95, errors);

    if (!currentConfig || !requirements) continue;
    const regionalCatalog = catalogForSqlServerConfiguration(input.catalog, currentConfig);
    const currentCatalogEntry = regionalCatalog.find((entry) => entry.instanceClass === currentConfig.instanceClass);
    const cpuInfoCurrentVcpu = currentVcpuFromCpuInfo(collectorCsvs.cpuInfoCsv);
    const currentVcpu = cpuInfoCurrentVcpu || currentCatalogEntry?.vcpu || 0;
    const currentConfigWithCatalogEvidence: CurrentRdsConfig = currentCatalogEntry ? currentConfig : {
      ...currentConfig,
      catalogMatch: false,
      catalogComparisonNote: `Current RDSSize ${currentConfig.instanceClass} was not found in the ${currentConfig.region} catalog; current vCPU was derived from collector CPUINFO.`
    };
    currentConfigWithCatalogEvidence.sqlServerVisibleVcpu = currentVcpu;
    currentConfigWithCatalogEvidence.cpuConfigurationType = "collector";
    const candidateClasses = lowerVcpuCandidates(currentConfig.instanceClass, regionalCatalog, currentVcpu);
    const candidateGenerationFailures = candidateClasses.length === 0
      ? candidateAvailabilityFailures(input.catalog, currentConfig, currentVcpu)
      : [];

    uploads.push({
      serverName: row.rdsEndpoint,
      collectorInput: row,
      collectorCsvs,
      currentConfig: currentConfigWithCatalogEvidence,
      currentVcpu,
      requirements,
      orderedCandidateInstanceClasses: candidateClasses,
      candidateGenerationFailures
    });
  }

  if (errors.length > 0) return { ok: false, statusCode: 400, errors };

  return {
    ok: true,
    request: {
      catalog: [...input.catalog],
      uploads,
      exportFormats: exportFormats.length > 0 ? exportFormats : ["json", "csv", "pdf"]
    }
  };
}

async function handleAnalyze(req: Request, res: Response, catalog: InstanceCatalogEntry[], ownerEmail: string | undefined) {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const built = await buildManualUploadRequestFromMultipart({
    ownerEmail,
    requesterEmail: requesterEmailFrom(req),
    collectorPackages: files?.collectorPackages ?? [],
    exportFormats: req.body.exportFormats,
    catalog
  });

  if (!built.ok) {
    res.status(built.statusCode).json({ ok: false, errors: built.errors });
    return;
  }

  const analysis = analyzeManualUploadRequest(built.request);
  if (!analysis.ok) {
    res.status(400).json(analysis);
    return;
  }

  res.type("html").send(renderManualUploadResultsHtml(buildManualUploadResultsView(analysis)));
}

async function parseCollectorRowsFromPackages(files: readonly UploadedFileLike[], errors: ApiValidationError[]): Promise<CollectorRowPackage[]> {
  const rows: CollectorRowPackage[] = [];

  for (const file of files) {
    try {
      const spreadsheet = findSpreadsheetInPackage(file);
      if (spreadsheet) {
        const parsedRows = await parseCollectorSpreadsheet(spreadsheet);
        rows.push(...parsedRows.map((row) => ({ row, packageFile: file })));
      }
    } catch (error) {
      errors.push({
        code: "COLLECTOR_SPREADSHEET_PARSE_FAILED",
        field: "collectorPackages",
        message: error instanceof Error ? error.message : "Collector spreadsheet parsing failed."
      });
    }
  }

  return rows;
}

function findSpreadsheetInPackage(file: UploadedFileLike): UploadedFileLike | undefined {
  const extension = extname(file.originalname).toLowerCase();
  if ([".csv", ".xlsx"].includes(extension) && isCollectorManifestName(file.originalname)) return file;
  if (extension !== ".zip") return undefined;

  const zip = new AdmZip(file.buffer);
  const entry = zip.getEntries().find((candidate) => {
    if (candidate.isDirectory) return false;
    return isCollectorManifestName(candidate.entryName) && (candidate.entryName.toLowerCase().endsWith(".csv") || candidate.entryName.toLowerCase().endsWith(".xlsx"));
  });

  if (!entry) return undefined;
  return { originalname: entry.entryName, buffer: entry.getData() };
}

async function parseCollectorSpreadsheet(file: UploadedFileLike): Promise<CollectorExcelInput[]> {
  const extension = extname(file.originalname).toLowerCase();
  const rows: CsvRow[] = extension === ".xlsx" ? await parseWorkbookRows(file.buffer) : parseCsv(file.buffer.toString("utf8"));

  return rows.map((row) => ({
    ...row,
    rdsEndpoint: cell(row, "ServerName", "RdsEndpoint", "RDSEndpoint", "Endpoint"),
    login: cell(row, "Login", "User", "Username"),
    password: cell(row, "Password"),
    database: cell(row, "Database", "DBName") || "msdb",
    existingInstanceClass: cell(row, "ExistingRdsInstanceClass", "ExistingInstanceClass", "InstanceClass", "RDSSize"),
    storageType: cell(row, "StorageType", "CurrentStorageType"),
    provisionedIops: cell(row, "ProvisionedIops", "ProvisionedIOPS", "CurrentProvisionedIops", "CurrentProvisionedIOPS", "Iops", "IOPS"),
    provisionedThroughputMbps: cell(row, "ProvisionedThroughputMbps", "ProvisionedThroughputMBps", "ProvisionedThroughput", "CurrentProvisionedThroughputMbps", "ThroughputMbps"),
    allocatedStorageGb: cell(row, "AllocatedStorageGb", "AllocatedStorageGB", "StorageGB", "AllocatedStorage"),
    multiAz: cell(row, "MultiAz", "MultiAZ", "CurrentMultiAz", "CurrentMultiAZ"),
    vendorSupportsStandardEdition: cell(row, "VendorSupportsStandardEdition", "VendorSupportsStandard", "StandardEditionVendorSupported"),
    migrationPathAccepted: cell(row, "MigrationPathAccepted", "StandardMigrationPathAccepted"),
    migrationPath: cell(row, "MigrationPath", "StandardMigrationPath"),
  } as CollectorExcelInput & Record<string, string>));
}

async function parseWorkbookRows(buffer: Buffer): Promise<CsvRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const headers: string[] = [];
  const rows: CsvRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (rowNumber === 1) {
      for (const value of values) headers.push(String(value ?? "").trim());
      return;
    }

    const parsed: CsvRow = {};
    for (const [index, header] of headers.entries()) {
      if (!header) continue;
      parsed[header] = String(values[index] ?? "");
    }
    rows.push(parsed);
  });

  return rows;
}

function extractCollectorCsvs(file: UploadedFileLike, serverName?: string, requireServerMatch = false) {
  const allFiles = extname(file.originalname).toLowerCase() === ".zip" ? unzipCsvFiles(file.buffer) : [{ name: file.originalname, text: file.buffer.toString("utf8") }];
  const files = selectCollectorCsvsForServer(allFiles, serverName, requireServerMatch);

  return {
    cpuCsv: requiredCsv(excludeCsv(files, ["cpuinfo", "cpu_info"]), ["_cpu_", "cpu_csv"]),
    cpuInfoCsv: optionalCsv(files, ["_cpuinfo_", "cpuinfo_csv", "cpu_info"]),
    memoryCsv: optionalCsv(files, ["_mem_", "memory_csv", "mem_csv"]),
    workloadSamplesCsv: optionalCsv(files, ["co_workload_samples"]),
    memorySamplesCsv: optionalCsv(files, ["co_memory_samples"]),
    memoryDiagnosticsCsv: optionalCsv(files, ["co_memory_diagnostics"]),
    ioCsv: requiredCsv(excludeCsv(files, ["co_file_io"]), ["_io_", "io_csv", "iops_csv", "file_io"]),
    storageCsv: optionalCsv(files, ["storage", "db_size", "co_db_size"]),
    dbCpuRequestCsv: optionalCsv(files, ["co_db_cpu_request_sample", "db_cpu"]),
    waitStatsCsv: optionalCsv(files, ["co_wait_stats", "wait_stats"]),
    fileIoCsv: optionalCsv(excludeCsv(files, ["co_file_io_samples"]), ["co_file_io"]),
    fileIoSamplesCsv: optionalCsv(files, ["co_file_io_samples"]),
    tempdbUsageCsv: optionalCsv(files, ["co_tempdb_usage", "tempdb_usage"]),
    tempdbSamplesCsv: optionalCsv(files, ["co_tempdb_samples"]),
    editionCompatibilityCsv: optionalCsv(files, ["co_edition_compatibility", "edition_compatibility"])
  };
}

function unzipCsvFiles(buffer: Buffer): Array<{ name: string; text: string }> {
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith(".csv"))
    .map((entry) => ({ name: entry.entryName, text: entry.getData().toString("utf8") }));
}

export function selectCollectorCsvsForServer(
  files: Array<{ name: string; text: string }>,
  serverName: string | undefined,
  requireServerMatch = false
): Array<{ name: string; text: string }> {
  if (!requireServerMatch) return files;
  const normalizedServerName = normalizeName(serverName ?? "");
  const hostPrefix = normalizeName((serverName ?? "").split(".")[0] ?? "");
  const matchKeys = [normalizedServerName, hostPrefix].filter((key) => key.length > 0);
  if (matchKeys.length === 0) return [];

  const matched = files.filter((file) => {
    const name = normalizeName(file.name);
    return matchKeys.some((key) => name.includes(key));
  });

  return matched;
}

function requiredCsv(files: Array<{ name: string; text: string }>, aliases: string[]): string {
  const match = optionalCsv(files, aliases);
  if (!match) throw new Error(`Missing required collector CSV matching: ${aliases.join(", ")}`);
  return match;
}

function optionalCsv(files: Array<{ name: string; text: string }>, aliases: string[]): string | undefined {
  const normalizedAliases = aliases.map(normalizeName);
  return files.find((file) => normalizedAliases.some((alias) => normalizeName(file.name).includes(alias)))?.text;
}

function excludeCsv(files: Array<{ name: string; text: string }>, aliases: string[]): Array<{ name: string; text: string }> {
  const normalizedAliases = aliases.map(normalizeName);
  return files.filter((file) => !normalizedAliases.some((alias) => normalizeName(file.name).includes(alias)));
}

function currentConfigFromCollectorOutput(
  row: CollectorExcelInput,
  collectorCsvs: ExistingCollectorCsvSet,
  totalDatabaseSizeGb: number | undefined,
  errors: ApiValidationError[]
): CurrentRdsConfig | undefined {
  const cpuInfo = firstCsvRow(collectorCsvs.cpuInfoCsv);
  const regionEvidence = parseRdsRegionWithEvidence(row.rdsEndpoint);
  const region = regionEvidence.region;
  const sqlServerEdition = normalizeSqlEdition(cell(cpuInfo, "SQL Edition", "SqlServerEdition", "Edition"));
  const sqlServerVersion = cell(cpuInfo, "SQL Version", "SqlServerVersion", "ProductVersion");
  const allocatedStorageGb = positiveNumberFromCell(row.allocatedStorageGb) ?? totalDatabaseSizeGb;
  const storageType = normalizeStorageType(row.storageType);
  const provisionedIops = positiveNumberFromCell(row.provisionedIops);
  const provisionedThroughputMbps = positiveNumberFromCell(row.provisionedThroughputMbps);
  const multiAz = parseOptionalBoolean(row.multiAz);
  const storageFactsMissing = [
    storageType === "unknown" ? "storage type" : undefined,
    provisionedIops === undefined ? "provisioned IOPS" : undefined,
    provisionedThroughputMbps === undefined ? "provisioned throughput" : undefined,
    positiveNumberFromCell(row.allocatedStorageGb) === undefined ? "allocated storage" : undefined
  ].filter((value): value is string => Boolean(value));

  const missing = [
    ["Region", region],
    ["SqlServerEdition", sqlServerEdition],
    ["SqlServerVersion", sqlServerVersion]
  ].filter(([, value]) => value === undefined || value === "");

  if (missing.length > 0) {
    errors.push({
      code: "COLLECTOR_CURRENT_CONFIG_FACTS_REQUIRED",
      serverName: row.rdsEndpoint,
      field: "collectorPackages",
      message: `Collector output is missing facts required for optimization: ${missing.map(([name]) => name).join(", ")}. Run the SSAT collector export with Cost Optimization diagnostics enabled so these facts come from the collector output.`
    });
    return undefined;
  }

  const currentConfig: CurrentRdsConfig = {
    region: String(region),
    regionSource: regionEvidence.source,
    regionFallbackReason: regionEvidence.reason,
    instanceClass: row.existingInstanceClass,
    sqlServerEdition: sqlServerEdition as CurrentRdsConfig["sqlServerEdition"],
    sqlServerVersion: String(sqlServerVersion),
    licenseModel: "unknown",
    storageType,
    storageFactsComplete: storageFactsMissing.length === 0,
    storageFactsMissing,
    multiAz
  };
  if (allocatedStorageGb !== undefined) currentConfig.allocatedStorageGb = allocatedStorageGb;
  currentConfig.cpuSocketCount = positiveNumberFromCell(
    cell(cpuInfo, "Socket Count", "SocketCount", "socket_count")
  );

  if (provisionedIops !== undefined) currentConfig.provisionedIops = provisionedIops;
  if (provisionedThroughputMbps !== undefined) currentConfig.provisionedThroughputMbps = provisionedThroughputMbps;

  return currentConfig;
}

function requirementsFromCollectorOutput(
  row: CollectorExcelInput,
  workload: ReturnType<typeof normalizeExistingCollectorCsvs>,
  iops: number,
  throughputMbps: number,
  errors: ApiValidationError[]
): CandidateRequirements | undefined {
  const memoryGb = workload.evidence?.memory?.requiredMemoryFloorGb;
  if (memoryGb === undefined || memoryGb <= 0) {
    errors.push({
      code: "COLLECTOR_MEMORY_FACTS_REQUIRED",
      serverName: row.rdsEndpoint,
      field: "collectorPackages.memoryCsv",
      message: "Collector output must include enough memory evidence to reproduce the less-elastic memory floor."
    });
    return undefined;
  }

  return { memoryGb, iops, throughputMbps };
}

function parseRdsRegionWithEvidence(endpoint: string): { region: string; source: "endpoint" | "fallback"; reason?: string } {
  const region = endpoint.trim().toLowerCase().match(/\.([a-z]{2}(?:-gov)?-[a-z]+-\d)\.rds\./)?.[1];
  if (region) return { region, source: "endpoint" };
  return {
    region: DEFAULT_FALLBACK_REGION,
    source: "fallback",
    reason: `RDS endpoint region could not be inferred; using ${DEFAULT_FALLBACK_REGION}.`
  };
}

function firstCsvRow(csv: string | undefined): CsvRow {
  return csv ? (parseCsv(csv)[0] ?? {}) : {};
}

function normalizeSqlEdition(value: string): CurrentRdsConfig["sqlServerEdition"] | "" {
  const normalized = value.toLowerCase();
  if (normalized.includes("enterprise")) return "Enterprise";
  if (normalized.includes("standard")) return "Standard";
  if (normalized.includes("web")) return "Web";
  if (normalized.includes("express")) return "Express";
  if (normalized.includes("developer")) return "Developer";
  return "";
}

function numberFromCell(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}


function positiveNumberFromCell(value: string | undefined): number | undefined {
  const parsed = numberFromCell(value);
  return parsed > 0 ? parsed : undefined;
}

function normalizeStorageType(value: string | undefined): CurrentRdsConfig["storageType"] {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["gp2", "gp3", "io1", "io2"].includes(normalized)) return normalized as CurrentRdsConfig["storageType"];
  return "unknown";
}

function parseOptionalBoolean(value: string | undefined): boolean | "unknown" {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return "unknown";
}
function currentVcpuFromCpuInfo(cpuInfoCsv: string | undefined): number {
  const cpuInfo = firstCsvRow(cpuInfoCsv);
  return positiveNumberFromCell(cell(cpuInfo, "Logical CPU Count", "LogicalCpuCount", "cpu_count")) ?? 0;
}

function lowerVcpuCandidates(currentInstanceClass: string, catalog: readonly InstanceCatalogEntry[], currentVcpuFromCpuInfo = 0): string[] {
  const current = catalog.find((entry) => entry.instanceClass === currentInstanceClass);
  const currentVcpu = currentVcpuFromCpuInfo || current?.vcpu || 0;
  if (currentVcpu <= 0) return [];

  const seen = new Set<string>();
  const candidates: string[] = [];
  const currentHasLowerOptimizeCpu = catalog
    .filter((entry) => entry.instanceClass === currentInstanceClass)
    .some((entry) => (entry.optimizeCpuConfigurations ?? [])
      .some((configuration) => configuration.sqlServerVisibleVcpu < currentVcpu));
  if (currentHasLowerOptimizeCpu) {
    seen.add(currentInstanceClass);
    candidates.push(currentInstanceClass);
  }

  candidates.push(...catalog
    .filter((entry) => entry.vcpu < currentVcpu)
    .sort(compareCandidateOrder)
    .map((entry) => entry.instanceClass)
    .filter((instanceClass) => {
      if (seen.has(instanceClass)) return false;
      seen.add(instanceClass);
      return true;
    }));
  return candidates;
}

function compareCandidateOrder(left: InstanceCatalogEntry, right: InstanceCatalogEntry): number {
  return right.vcpu - left.vcpu
    || preferredFamilyTier(left) - preferredFamilyTier(right)
    || right.memoryGb - left.memoryGb
    || left.instanceClass.localeCompare(right.instanceClass);
}

function preferredFamilyTier(entry: InstanceCatalogEntry): number {
  if (["m8i", "r8i", "x2m"].includes(entry.family)) return 0;
  if (["m7i", "r7i", "x2iedn"].includes(entry.family)) return 1;
  return 2;
}

function requesterEmailFrom(req: Request): string {
  const header = req.header("x-user-email") ?? req.header("x-owner-email");
  const bodyValue = typeof req.body.requesterEmail === "string" ? req.body.requesterEmail : "";
  return header || bodyValue;
}

function splitList(value: string | undefined): string[] {
  return value?.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean) ?? [];
}

function cell(row: Record<string, string | undefined>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()];
    if (value?.trim()) return value.trim();
  }
  return "";
}

const COLLECTOR_DOWNLOAD_FILES = [
  "RunMefirst.bat",
  "RunMefirst.ps1",
  "servers_credentials_sample.csv",
  "SSATcollector_compatible.ps1",
  "SSATcollector_launcher.ps1",
  "SSATcollector.ps1"
] as const;

export function buildCollectorDownloadZip(): Buffer {
  const root = join(process.cwd(), "collector/costoptimization");
  const zip = new AdmZip();
  for (const fileName of COLLECTOR_DOWNLOAD_FILES) {
    const path = join(root, fileName);
    if (!existsSync(path)) {
      throw new Error(`Collector download file is missing: ${fileName}`);
    }
    zip.addFile(fileName, readFileSync(path));
  }
  return zip.toBuffer();
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function isCollectorManifestName(value: string): boolean {
  const name = normalizeName(value);
  return name.includes("collector_run_manifest") || name.includes("run_manifest") || name.includes("servers_credentials");
}

function loadDefaultCatalog(): InstanceCatalogEntry[] {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "src/catalog/data/rds-sqlserver-orderable.json"),
    join(process.cwd(), "dist/catalog/data/rds-sqlserver-orderable.json"),
    join(__dirname, "../catalog/data/rds-sqlserver-orderable.json")
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) return [];
  const parsed = JSON.parse(readFileSync(source, "utf8")) as InstanceCatalogEntry[];
  return filterRuntimeCatalogEntries(parsed);
}

export function filterRuntimeCatalogEntries(entries: readonly InstanceCatalogEntry[]): InstanceCatalogEntry[] {
  return entries.filter(hasExactCandidateOrderabilityMetadata);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  createCostOptimizationServer().listen(port, () => {
    console.log(`RDS Cost Optimization manual upload app listening on http://localhost:${port}/cost`);
  });
}



