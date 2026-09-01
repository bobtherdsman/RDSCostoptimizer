import type { ExportFormat, ApiValidationError, CollectorExcelInput, NormalizedCollectorExcelInput } from "../api/index.js";
import { analyzeWorkloadRequest, normalizeCollectorRunManifestInput } from "../api/index.js";
import type { CandidateRequirements, InstanceCatalogEntry } from "../catalog/index.js";
import type { CurrentRdsConfig } from "../contracts/types.js";
import type { EditionChangeConfirmations } from "../contracts/types.js";
import { normalizeExistingCollectorCsvs, type ExistingCollectorCsvSet } from "../parser/index.js";
import type { WorkloadOptimizationReport, WorkloadOptimizationSummary } from "../reports/index.js";
import type { WorkloadAnalysisResult, ServerWorkloadAnalysisInput } from "../workload/index.js";

export interface ManualUploadServerPackage {
  serverName: string;
  collectorInput: CollectorExcelInput;
  collectorCsvs: ExistingCollectorCsvSet;
  currentConfig: CurrentRdsConfig;
  currentVcpu: number;
  requirements: CandidateRequirements;
  orderedCandidateInstanceClasses?: readonly string[];
  candidateGenerationFailures?: readonly string[];
}

export interface ManualUploadRequest {
  catalog: readonly InstanceCatalogEntry[];
  uploads: readonly ManualUploadServerPackage[];
  exportFormats?: readonly ExportFormat[];
}

export interface ManualUploadSuccessResponse {
  ok: true;
  uploadCount: number;
  collectorInputs: NormalizedCollectorExcelInput[];
  analysis: WorkloadAnalysisResult;
  reports: WorkloadOptimizationReport[];
  summary: WorkloadOptimizationSummary;
  exports: Partial<Record<ExportFormat, string>>;
}

export interface ManualUploadErrorResponse {
  ok: false;
  errors: ApiValidationError[];
}

export type ManualUploadResponse = ManualUploadSuccessResponse | ManualUploadErrorResponse;

export function analyzeManualUploadRequest(request: ManualUploadRequest): ManualUploadResponse {
  const prepared = prepareManualUploadRequest(request);
  if (!prepared.ok) return prepared;

  const response = analyzeWorkloadRequest({
    catalog: [...request.catalog],
    exportFormats: request.exportFormats,
    servers: prepared.servers
  });

  if (!response.ok) return response;

  return {
    ok: true,
    uploadCount: prepared.servers.length,
    collectorInputs: prepared.collectorInputs,
    analysis: response.analysis,
    reports: response.reports,
    summary: response.summary,
    exports: response.exports
  };
}

export function validateManualUploadRequest(request: ManualUploadRequest): ApiValidationError[] {
  const prepared = prepareManualUploadRequest(request);
  return prepared.ok ? [] : prepared.errors;
}

function prepareManualUploadRequest(request: ManualUploadRequest):
  | { ok: true; collectorInputs: NormalizedCollectorExcelInput[]; servers: ServerWorkloadAnalysisInput[] }
  | ManualUploadErrorResponse {
  const errors: ApiValidationError[] = [];

  if (!Array.isArray(request.catalog) || request.catalog.length === 0) {
    errors.push({ code: "CATALOG_REQUIRED", field: "catalog", message: "Manual upload analysis requires an instance catalog." });
  }

  if (!Array.isArray(request.uploads) || request.uploads.length === 0) {
    errors.push({ code: "UPLOADS_REQUIRED", field: "uploads", message: "Manual upload requires at least one collector package." });
    return { ok: false, errors };
  }

  const collectorInputs: NormalizedCollectorExcelInput[] = [];
  const servers: ServerWorkloadAnalysisInput[] = [];

  for (const [index, upload] of request.uploads.entries()) {
    const serverName = upload.serverName?.trim() || upload.collectorInput?.rdsEndpoint?.trim() || `upload-${index + 1}`;
    const normalizedInput = normalizeCollectorRunManifestInput(upload.collectorInput);
    if (!normalizedInput.ok) {
      errors.push(...normalizedInput.errors.map((error) => ({ ...error, serverName })));
      continue;
    }

    collectorInputs.push(normalizedInput.collectorInput);
    errors.push(...validateManualUploadPackage(upload, normalizedInput.collectorInput, serverName));

    try {
      const workload = normalizeExistingCollectorCsvs(upload.collectorCsvs);
      servers.push({
        serverName,
        currentConfig: upload.currentConfig,
        workload,
        currentVcpu: upload.currentVcpu,
        requirements: upload.requirements,
        orderedCandidateInstanceClasses: buildCandidateOrder(upload.orderedCandidateInstanceClasses ?? []),
        candidateGenerationFailures: [...(upload.candidateGenerationFailures ?? [])],
        editionChangeConfirmations: editionConfirmations(normalizedInput.collectorInput)
      });
    } catch (error) {
      errors.push({
        code: "COLLECTOR_CSV_PARSE_FAILED",
        serverName,
        field: "collectorCsvs",
        message: error instanceof Error ? error.message : "Collector CSV parsing failed."
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, collectorInputs, servers };
}

function editionConfirmations(
  input: NormalizedCollectorExcelInput
): EditionChangeConfirmations | undefined {
  if (
    input.vendorSupportsStandardEdition === undefined
    && input.migrationPathAccepted === undefined
    && input.migrationPath === undefined
  ) {
    return undefined;
  }
  return {
    vendorSupportsStandardEdition: input.vendorSupportsStandardEdition,
    migrationPathAccepted: input.migrationPathAccepted,
    migrationPath: input.migrationPath
  };
}

function validateManualUploadPackage(
  upload: ManualUploadServerPackage,
  collectorInput: NormalizedCollectorExcelInput,
  serverName: string
): ApiValidationError[] {
  const errors: ApiValidationError[] = [];

  if (!upload.serverName?.trim()) {
    errors.push({ code: "SERVER_NAME_REQUIRED", serverName, field: "serverName", message: "Manual upload package must include a server name." });
  }

  if (!upload.collectorCsvs?.cpuCsv?.trim()) {
    errors.push({ code: "CPU_CSV_REQUIRED", serverName, field: "collectorCsvs.cpuCsv", message: "Manual upload package must include collector CPU CSV text." });
  }

  if (!upload.collectorCsvs?.ioCsv?.trim()) {
    errors.push({ code: "IO_CSV_REQUIRED", serverName, field: "collectorCsvs.ioCsv", message: "Manual upload package must include collector I/O CSV text." });
  }

  if (upload.currentConfig?.instanceClass?.trim() !== collectorInput.existingInstanceClass) {
    errors.push({
      code: "EXISTING_INSTANCE_MISMATCH",
      serverName,
      field: "currentConfig.instanceClass",
      message: `Current config instance (${upload.currentConfig?.instanceClass ?? "missing"}) must match collector spreadsheet RDSSize (${collectorInput.existingInstanceClass}).`
    });
  }

  const candidateOrder = buildCandidateOrder(upload.orderedCandidateInstanceClasses ?? []);
  if (candidateOrder.length === 0 && (upload.candidateGenerationFailures?.length ?? 0) === 0) {
    errors.push({
      code: "CANDIDATES_REQUIRED",
      serverName,
      field: "orderedCandidateInstanceClasses",
      message: "Manual upload could not derive any lower-vCPU candidate instance classes from the collector RDSSize and local catalog."
    });
  }

  return errors;
}

function buildCandidateOrder(orderedCandidateInstanceClasses: readonly string[]): string[] {
  const candidates = orderedCandidateInstanceClasses.map((candidate) => candidate.trim()).filter(Boolean);
  return [...new Set(candidates)];
}
