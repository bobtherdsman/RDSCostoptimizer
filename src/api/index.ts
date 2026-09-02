import type {
  EditionMigrationPath,
  MetricDistribution,
  WorkloadProfile
} from "../contracts/types.js";
import { buildWorkloadOptimizationSummary, toCsvReport, toJsonSummaryReport, toPdfExecutiveSummary, type WorkloadOptimizationReport, type WorkloadOptimizationSummary } from "../reports/index.js";
import { analyzeWorkloadBatch, type WorkloadAnalysisInput, type WorkloadAnalysisResult } from "../workload/index.js";

export type ExportFormat = "json" | "csv" | "pdf";

export interface CollectorExcelInput {
  rdsEndpoint: string;
  login: string;
  password: string;
  existingInstanceClass: string;
  database?: string;
  storageType?: string;
  provisionedIops?: string;
  provisionedThroughputMbps?: string;
  allocatedStorageGb?: string;
  multiAz?: string;
  vendorSupportsStandardEdition?: string;
  migrationPathAccepted?: string;
  migrationPath?: string;
}

export interface NormalizedCollectorExcelInput {
  rdsEndpoint: string;
  existingInstanceClass: string;
  database: string;
  region?: string;
  storageType?: string;
  provisionedIops?: string;
  provisionedThroughputMbps?: string;
  allocatedStorageGb?: string;
  multiAz?: string;
  vendorSupportsStandardEdition?: boolean;
  migrationPathAccepted?: boolean;
  migrationPath?: EditionMigrationPath;
}

export interface CollectorExcelInputSuccessResponse {
  ok: true;
  collectorInput: NormalizedCollectorExcelInput;
}

export interface CollectorExcelInputErrorResponse {
  ok: false;
  errors: ApiValidationError[];
}

export type CollectorExcelInputResponse = CollectorExcelInputSuccessResponse | CollectorExcelInputErrorResponse;

export interface ApiValidationError {
  code: string;
  message: string;
  serverName?: string;
  field?: string;
}

export interface AnalyzeWorkloadRequest extends WorkloadAnalysisInput {
  exportFormats?: readonly ExportFormat[];
}

export interface AnalyzeWorkloadSuccessResponse {
  ok: true;
  analysis: WorkloadAnalysisResult;
  reports: WorkloadOptimizationReport[];
  summary: WorkloadOptimizationSummary;
  exports: Partial<Record<ExportFormat, string>>;
}

export interface AnalyzeWorkloadErrorResponse {
  ok: false;
  errors: ApiValidationError[];
}

export type AnalyzeWorkloadResponse = AnalyzeWorkloadSuccessResponse | AnalyzeWorkloadErrorResponse;

export function normalizeCollectorExcelInput(input: CollectorExcelInput): CollectorExcelInputResponse {
  const errors = validateCollectorExcelInput(input, { requireCredentials: true });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    collectorInput: normalizedCollectorInput(input)
  };
}

export function normalizeCollectorRunManifestInput(input: CollectorExcelInput): CollectorExcelInputResponse {
  const errors = validateCollectorExcelInput(input, {
    requireCredentials: false,
    requireExistingInstanceClass: false,
    requireRdsEndpoint: false
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    collectorInput: normalizedCollectorInput(input)
  };
}

export function validateCollectorExcelInput(
  input: CollectorExcelInput,
  options: { requireCredentials?: boolean; requireExistingInstanceClass?: boolean; requireRdsEndpoint?: boolean } = {
    requireCredentials: true,
    requireExistingInstanceClass: true,
    requireRdsEndpoint: true
  }
): ApiValidationError[] {
  const errors: ApiValidationError[] = [];
  const endpoint = input.rdsEndpoint?.trim() ?? "";
  const login = input.login?.trim() ?? "";
  const password = input.password ?? "";
  const instanceClass = input.existingInstanceClass?.trim() ?? "";

  if (!endpoint) {
    errors.push({ code: "RDS_ENDPOINT_REQUIRED", field: "rdsEndpoint", message: "RDS endpoint is required in the collector spreadsheet." });
  } else if (options.requireRdsEndpoint !== false && !endpoint.includes(".rds.") && !endpoint.includes(".rds.amazonaws.com")) {
    errors.push({ code: "RDS_ENDPOINT_INVALID", field: "rdsEndpoint", message: "RDS endpoint should be an Amazon RDS endpoint." });
  }

  if (options.requireCredentials !== false && !login) {
    errors.push({ code: "LOGIN_REQUIRED", field: "login", message: "Login is required in the collector spreadsheet." });
  }

  if (options.requireCredentials !== false && !password) {
    errors.push({ code: "PASSWORD_REQUIRED", field: "password", message: "Password is required for the collector connection and must not be stored in reports." });
  }

  if (!instanceClass && options.requireExistingInstanceClass !== false) {
    errors.push({ code: "EXISTING_INSTANCE_REQUIRED", field: "existingInstanceClass", message: "Existing RDS instance class is required in the collector spreadsheet." });
  } else if (instanceClass && !isRdsInstanceClass(instanceClass)) {
    errors.push({ code: "EXISTING_INSTANCE_INVALID", field: "existingInstanceClass", message: "Existing instance must look like an RDS DB class, for example db.r8i.4xlarge." });
  }

  return errors;
}

function normalizedCollectorInput(input: CollectorExcelInput): NormalizedCollectorExcelInput {
  return {
    rdsEndpoint: input.rdsEndpoint.trim(),
    existingInstanceClass: input.existingInstanceClass.trim(),
    database: input.database?.trim() || "msdb",
    region: parseRdsRegionFromEndpoint(input.rdsEndpoint),
    storageType: input.storageType?.trim() || undefined,
    provisionedIops: input.provisionedIops?.trim() || undefined,
    provisionedThroughputMbps: input.provisionedThroughputMbps?.trim() || undefined,
    allocatedStorageGb: input.allocatedStorageGb?.trim() || undefined,
    multiAz: input.multiAz?.trim() || undefined,
    vendorSupportsStandardEdition: optionalBoolean(input.vendorSupportsStandardEdition),
    migrationPathAccepted: optionalBoolean(input.migrationPathAccepted),
    migrationPath: normalizeMigrationPath(input.migrationPath)
  };
}

function optionalBoolean(value: string | undefined): boolean | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return undefined;
}

function normalizeMigrationPath(value: string | undefined): EditionMigrationPath | undefined {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (["native_backup_restore", "backup_restore", "native"].includes(normalized)) {
    return "native_backup_restore";
  }
  if (["aws_dms", "dms"].includes(normalized)) return "aws_dms";
  return undefined;
}

export function parseRdsRegionFromEndpoint(endpoint: string): string | undefined {
  const match = endpoint.trim().toLowerCase().match(/\.([a-z]{2}(?:-gov)?-[a-z]+-\d)\.rds\./);
  return match?.[1];
}

export function analyzeWorkloadRequest(request: AnalyzeWorkloadRequest): AnalyzeWorkloadResponse {
  const errors = validateAnalyzeWorkloadRequest(request);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const analysis = analyzeWorkloadBatch(request);
  const reports = analysis.results.map((result) => result.report);
  const summary = buildWorkloadOptimizationSummary(reports);
  const exports = buildExports(reports, request.exportFormats ?? ["json"]);

  return {
    ok: true,
    analysis,
    reports,
    summary,
    exports
  };
}

export function validateAnalyzeWorkloadRequest(request: AnalyzeWorkloadRequest): ApiValidationError[] {
  const errors: ApiValidationError[] = [];

  if (!Array.isArray(request.catalog) || request.catalog.length === 0) {
    errors.push({
      code: "CATALOG_REQUIRED",
      field: "catalog",
      message: "At least one catalog entry is required to validate orderability."
    });
  }

  if (!Array.isArray(request.servers) || request.servers.length === 0) {
    errors.push({
      code: "SERVERS_REQUIRED",
      field: "servers",
      message: "At least one server workload is required."
    });
    return errors;
  }

  for (const server of request.servers) {
    if (!server.serverName.trim()) {
      errors.push({ code: "SERVER_NAME_REQUIRED", field: "serverName", message: "Server name is required." });
    }
    if (server.currentVcpu <= 0) {
      errors.push({ code: "CURRENT_VCPU_INVALID", serverName: server.serverName, field: "currentVcpu", message: "Current vCPU must be greater than zero." });
    }
    if (
      !Array.isArray(server.orderedCandidateInstanceClasses)
      || (
        server.orderedCandidateInstanceClasses.length === 0
        && (server.candidateGenerationFailures?.length ?? 0) === 0
      )
    ) {
      errors.push({ code: "CANDIDATES_REQUIRED", serverName: server.serverName, field: "orderedCandidateInstanceClasses", message: "At least one ordered candidate instance class is required." });
    }
    if (server.requirements.memoryGb <= 0) {
      errors.push({ code: "MEMORY_REQUIREMENT_INVALID", serverName: server.serverName, field: "requirements.memoryGb", message: "Memory requirement must be greater than zero." });
    }
    if (server.requirements.iops < 0) {
      errors.push({ code: "IOPS_REQUIREMENT_INVALID", serverName: server.serverName, field: "requirements.iops", message: "IOPS requirement cannot be negative." });
    }
    if (server.requirements.throughputMbps < 0) {
      errors.push({ code: "THROUGHPUT_REQUIREMENT_INVALID", serverName: server.serverName, field: "requirements.throughputMbps", message: "Throughput requirement cannot be negative." });
    }

    errors.push(...validateWorkload(server.workload, server.serverName));
  }

  return errors;
}

export function exportWorkloadReports(reports: readonly WorkloadOptimizationReport[], format: ExportFormat): string {
  if (format === "csv") return toCsvReport(reports);
  if (format === "pdf") return bytesToBase64(toPdfExecutiveSummary(reports));
  return toJsonSummaryReport(reports);
}

function buildExports(reports: readonly WorkloadOptimizationReport[], formats: readonly ExportFormat[]): Partial<Record<ExportFormat, string>> {
  const uniqueFormats = [...new Set(formats)];
  const exports: Partial<Record<ExportFormat, string>> = {};

  for (const format of uniqueFormats) {
    exports[format] = exportWorkloadReports(reports, format);
  }

  return exports;
}

function validateWorkload(workload: WorkloadProfile, serverName: string): ApiValidationError[] {
  const errors: ApiValidationError[] = [];

  errors.push(...validateDistribution(workload.cpuPct, "workload.cpuPct", serverName));
  errors.push(...validateDistribution(workload.iops, "workload.iops", serverName));
  errors.push(...validateDistribution(workload.throughputMbps, "workload.throughputMbps", serverName));

  if (workload.collectionHours <= 0) {
    errors.push({ code: "COLLECTION_HOURS_INVALID", serverName, field: "workload.collectionHours", message: "Collection hours must be greater than zero." });
  }

  if (!Array.isArray(workload.databases)) {
    errors.push({ code: "DATABASES_INVALID", serverName, field: "workload.databases", message: "Database attribution must be an array, even when empty." });
  }

  return errors;
}

function validateDistribution(distribution: MetricDistribution, field: string, serverName: string): ApiValidationError[] {
  const errors: ApiValidationError[] = [];
  const values: Array<keyof MetricDistribution> = ["avg", "p50", "p90", "p95", "p99", "max"];

  for (const key of values) {
    const value = distribution?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push({
        code: "METRIC_DISTRIBUTION_INVALID",
        serverName,
        field: `${field}.${key}`,
        message: `${field}.${key} must be a non-negative finite number.`
      });
    }
  }

  return errors;
}

function isRdsInstanceClass(instanceClass: string): boolean {
  return /^db\.[a-z0-9]+[a-z]?\.[a-z0-9.]+$/i.test(instanceClass);
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
