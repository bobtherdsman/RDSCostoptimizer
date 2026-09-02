import type { ExportFormat, ApiValidationError, CollectorExcelInput, NormalizedCollectorExcelInput } from "../api/index.js";
import { exportWorkloadReports, normalizeCollectorRunManifestInput } from "../api/index.js";
import type { CandidateRequirements, InstanceCatalogEntry } from "../catalog/index.js";
import type { CurrentRdsConfig, LimitingResourceAssessment, OptimizationBlocker, OptimizationResult, WorkloadProfile } from "../contracts/types.js";
import { parseCsv } from "../parser/csv.js";
import type { EditionChangeConfirmations } from "../contracts/types.js";
import { normalizeExistingCollectorCsvs, type ExistingCollectorCsvSet } from "../parser/index.js";
import { buildWorkloadOptimizationSummary, type WorkloadOptimizationReport, type WorkloadOptimizationSummary } from "../reports/index.js";
import { analyzeServerWorkload, type ServerWorkloadAnalysisResult, type WorkloadAnalysisResult, type ServerWorkloadAnalysisInput } from "../workload/index.js";

const MANUAL_RESPONSE_CANDIDATE_LIMIT = 32;
const MANUAL_RESPONSE_REASON_LIMIT = 40;
const MANUAL_RESPONSE_REASON_CHARS = 260;

export interface ManualUploadServerPackage {
  serverName: string;
  collectorInput: CollectorExcelInput;
  collectorCsvs: ExistingCollectorCsvSet;
  workload?: WorkloadProfile;
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

  const results = prepared.servers.map((server) =>
    compactManualServerResult(analyzeServerWorkload(server, [...request.catalog]))
  );
  const reports = results.map((result) => result.report);
  const summary = buildWorkloadOptimizationSummary(reports);
  const exports = buildManualExports(reports, request.exportFormats ?? []);

  return {
    ok: true,
    uploadCount: prepared.servers.length,
    collectorInputs: prepared.collectorInputs,
    analysis: {
      results,
      batch: { results: results.map((result) => result.workloadResult) }
    },
    reports,
    summary,
    exports
  };
}

export function validateManualUploadRequest(request: ManualUploadRequest): ApiValidationError[] {
  const prepared = prepareManualUploadRequest(request);
  return prepared.ok ? [] : prepared.errors;
}

function buildManualExports(
  reports: readonly WorkloadOptimizationReport[],
  formats: readonly ExportFormat[]
): Partial<Record<ExportFormat, string>> {
  const exports: Partial<Record<ExportFormat, string>> = {};
  for (const format of formats) {
    exports[format] = exportWorkloadReports(reports, format);
  }
  return exports;
}

function compactManualServerResult(result: ServerWorkloadAnalysisResult): ServerWorkloadAnalysisResult {
  const computeResult = compactOptimizationResult(result.computeResult);
  const workloadResult = compactOptimizationResult(result.workloadResult);
  const report = compactManualReport(result.report);
  return {
    ...result,
    computeResult,
    workloadResult,
    report
  };
}

function compactOptimizationResult(result: OptimizationResult): OptimizationResult {
  return {
    ...result,
    blockers: compactBlockers(result.blockers),
    limitingResources: compactLimitingResources(result.limitingResources),
    candidateEvaluations: compactCandidateEvaluations(result.candidateEvaluations)
  };
}

function compactManualReport(report: WorkloadOptimizationReport): WorkloadOptimizationReport {
  return {
    ...report,
    blockers: compactBlockers(report.blockers),
    limitingResources: compactLimitingResources(report.limitingResources),
    candidateEvaluations: compactCandidateEvaluations(report.candidateEvaluations)
  };
}

function compactCandidateEvaluations(
  candidates: OptimizationResult["candidateEvaluations"]
): OptimizationResult["candidateEvaluations"] {
  const selectedOrAccepted = candidates.filter((candidate) => candidate.selected || candidate.accepted);
  const notSelected = candidates.filter((candidate) => !candidate.selected && !candidate.accepted);
  return [...selectedOrAccepted, ...notSelected].slice(0, MANUAL_RESPONSE_CANDIDATE_LIMIT);
}

function compactBlockers(blockers: readonly OptimizationBlocker[]): OptimizationBlocker[] {
  const byKey = new Map<string, OptimizationBlocker>();
  for (const blocker of blockers) {
    const key = `${blocker.dimension}:${blocker.code}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...blocker,
        message: compactReason(blocker.message)
      });
    }
  }
  return [...byKey.values()].slice(0, MANUAL_RESPONSE_REASON_LIMIT);
}

function compactLimitingResources(resources: readonly LimitingResourceAssessment[]): LimitingResourceAssessment[] {
  const byKey = new Map<string, LimitingResourceAssessment>();
  for (const resource of resources) {
    const key = [
      resource.dimension,
      resource.scope,
      resource.status,
      resource.observed ?? "",
      resource.limit ?? "",
      resource.unit ?? ""
    ].join(":");
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...resource,
        reason: compactReason(resource.reason)
      });
    }
  }
  return [...byKey.values()].slice(0, MANUAL_RESPONSE_REASON_LIMIT);
}

function compactReason(reason: string): string {
  if (reason.length <= MANUAL_RESPONSE_REASON_CHARS && !/[A-Z0-9]+_[A-Z0-9_]+/.test(reason)) return reason;
  const lower = reason.toLowerCase();
  const parts: string[] = [];
  if (lower.includes("collected hour") || lower.includes("evidence window") || lower.includes("collection window")) {
    parts.push(reason.split(".")[0]);
  }
  if (lower.includes("cpu")) parts.push("CPU projection does not fit one or more lower candidates.");
  if (lower.includes("memory")) parts.push("Memory evidence does not fit one or more lower candidates.");
  if (lower.includes("iops")) parts.push("Observed physical IOPS demand does not fit one or more lower candidates.");
  if (lower.includes("throughput")) parts.push("Observed throughput demand does not fit one or more lower candidates.");
  if (lower.includes("tempdb")) parts.push("tempdb placement or capacity needs review.");
  if (lower.includes("order") || lower.includes("catalog") || lower.includes("version")) {
    parts.push("Exact RDS orderability evidence is incomplete for one or more lower candidates.");
  }
  return [...new Set(parts)].join(" ") || `${reason.slice(0, MANUAL_RESPONSE_REASON_CHARS - 1).trimEnd()}...`;
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
      const workload = upload.workload ?? normalizeExistingCollectorCsvs(upload.collectorCsvs);
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

  if (!hasCollectorIoEvidence(upload.collectorCsvs)) {
    errors.push({
      code: "IO_EVIDENCE_REQUIRED",
      serverName,
      field: "collectorCsvs",
      message: "Manual upload package must include legacy I/O CSV text, split CO file I/O samples, or compact CO_WorkloadSamples file_io rows."
    });
  }

  if (
    collectorInput.existingInstanceClass
    && upload.currentConfig?.instanceClass?.trim() !== collectorInput.existingInstanceClass
  ) {
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

function hasCollectorIoEvidence(csvs: ExistingCollectorCsvSet | undefined): boolean {
  if (!csvs) return false;
  if (csvs.ioCsv?.trim()) return true;
  if (csvs.fileIoSamplesCsv?.trim()) return true;
  if (!csvs.workloadSamplesCsv?.trim()) return false;
  return parseCsv(csvs.workloadSamplesCsv).some((row) =>
    (row.SampleType ?? row.sampleType ?? row.sample_type ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_") === "file_io"
  );
}

function buildCandidateOrder(orderedCandidateInstanceClasses: readonly string[]): string[] {
  const candidates = orderedCandidateInstanceClasses.map((candidate) => candidate.trim()).filter(Boolean);
  return [...new Set(candidates)];
}
