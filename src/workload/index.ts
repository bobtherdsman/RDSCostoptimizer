import type {
  OptimizationBatchResult,
  OptimizationBlocker,
  OptimizationResult,
  EditionChangeConfirmations,
  LimitingResourceAssessment,
  ServerWorkloadInput
} from "../contracts/types.js";
import type { CandidateRequirements, InstanceCatalogEntry } from "../catalog/index.js";
import { runCostHarness, type HarnessFinding } from "../harness/index.js";
import { optimizeComputeCandidate } from "../optimizer/index.js";
import { buildWorkloadOptimizationReport, type WorkloadOptimizationReport } from "../reports/index.js";

export interface ServerWorkloadAnalysisInput extends ServerWorkloadInput {
  currentVcpu: number;
  requirements: CandidateRequirements;
  orderedCandidateInstanceClasses: string[];
  candidateGenerationFailures?: string[];
  editionChangeConfirmations?: EditionChangeConfirmations;
}

export interface WorkloadAnalysisInput {
  catalog: InstanceCatalogEntry[];
  servers: ServerWorkloadAnalysisInput[];
}

export interface ServerWorkloadAnalysisResult {
  serverName: string;
  computeResult: OptimizationResult;
  workloadResult: OptimizationResult;
  harnessFindings: HarnessFinding[];
  report: WorkloadOptimizationReport;
}

export interface WorkloadAnalysisResult {
  results: ServerWorkloadAnalysisResult[];
  batch: OptimizationBatchResult;
}

export function analyzeServerWorkload(
  input: ServerWorkloadAnalysisInput,
  catalog: InstanceCatalogEntry[]
): ServerWorkloadAnalysisResult {
  const computeResult = optimizeComputeCandidate({
    currentConfig: input.currentConfig,
    workload: input.workload,
    catalog,
    orderedCandidateInstanceClasses: input.orderedCandidateInstanceClasses,
    candidateGenerationFailures: input.candidateGenerationFailures,
    requirements: input.requirements,
    currentVcpu: input.currentVcpu,
    editionChangeConfirmations: input.editionChangeConfirmations
  });

  const harnessFindings = runCostHarness({
    result: computeResult,
    workload: input.workload,
    catalog,
    currentConfig: input.currentConfig,
    requirements: input.requirements,
    currentVcpu: input.currentVcpu,
    orderedCandidateInstanceClasses: input.orderedCandidateInstanceClasses
  });

  const workloadResult = withHarnessBlockers(computeResult, harnessFindings);
  const report = buildWorkloadOptimizationReport({
    serverName: input.serverName,
    result: workloadResult,
    harnessFindings
  });

  return {
    serverName: input.serverName,
    computeResult,
    workloadResult,
    harnessFindings,
    report
  };
}

export function analyzeWorkloadBatch(input: WorkloadAnalysisInput): WorkloadAnalysisResult {
  const results = input.servers.map((server) => analyzeServerWorkload(server, input.catalog));

  return {
    results,
    batch: {
      results: results.map((result) => result.workloadResult)
    }
  };
}

function withHarnessBlockers(result: OptimizationResult, findings: HarnessFinding[]): OptimizationResult {
  const failedFindings = findings.filter((finding) => !finding.passed);
  if (failedFindings.length === 0) return result;

  const blockers: OptimizationBlocker[] = failedFindings.map((finding) => ({
    code: finding.oracle,
    dimension: finding.dimension,
    message: finding.message
  }));

  return {
    ...result,
    recommendedConfig: undefined,
    decision: "Not Recommended",
    risk: "blocked",
    blockers: [...result.blockers, ...blockers],
    limitingResources: [
      ...result.limitingResources,
      ...failedFindings.flatMap((finding): LimitingResourceAssessment[] => {
        const dimension = limitingResourceDimension(finding.dimension);
        return dimension
          ? [{
              dimension,
              scope: "compute",
              status: "blocking",
              reason: `${finding.oracle}: ${finding.message}`
            }]
          : [];
      })
    ]
  };
}

function limitingResourceDimension(
  dimension: HarnessFinding["dimension"]
): LimitingResourceAssessment["dimension"] {
  return dimension;
}

