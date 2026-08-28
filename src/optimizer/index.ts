import type { CurrentRdsConfig, OptimizationBlocker, OptimizationResult, WorkloadProfile } from "../contracts/types.js";
import {
  isOrderableCandidate,
  type CandidateRequirements,
  type InstanceCatalogEntry
} from "../catalog/index.js";

export interface ComputeOptimizationInput {
  currentConfig: CurrentRdsConfig;
  workload: WorkloadProfile;
  catalog: InstanceCatalogEntry[];
  orderedCandidateInstanceClasses: string[];
  requirements: CandidateRequirements;
  currentVcpu: number;
  targetCpuUtilizationPct?: number;
}

export function requiredVcpuForCpuTarget(
  currentVcpu: number,
  cpuP95Pct: number,
  targetCpuUtilizationPct = 70
): number {
  if (currentVcpu <= 0) return 1;
  if (cpuP95Pct <= 0) return 1;
  return Math.max(1, Math.ceil((currentVcpu * cpuP95Pct) / targetCpuUtilizationPct));
}

export function optimizeComputeCandidate(input: ComputeOptimizationInput): OptimizationResult {
  const requiredVcpu = requiredVcpuForCpuTarget(
    input.currentVcpu,
    input.workload.cpuPct.p95,
    input.targetCpuUtilizationPct
  );

  const blockers: OptimizationBlocker[] = [];
  const evaluations = input.orderedCandidateInstanceClasses.map((instanceClass) => {
    const validation = isOrderableCandidate(input.catalog, input.currentConfig, instanceClass, input.requirements);
    const vcpu = validation.entry?.vcpu ?? 0;
    const failures = [...validation.failures];

    if (vcpu < requiredVcpu) {
      failures.push(`CPU_UNDERFIT: ${vcpu} < ${requiredVcpu}`);
    }

    return {
      instanceClass,
      entry: validation.entry,
      failures,
      valid: failures.length === 0
    };
  });

  const selected = evaluations.find((evaluation) => evaluation.valid);
  if (selected?.entry) {
    return {
      currentConfig: input.currentConfig,
      recommendedConfig: {
        ...input.currentConfig,
        instanceClass: selected.entry.instanceClass
      },
      risk: riskFromCpuTarget(input.workload.cpuPct.p95, input.currentVcpu, selected.entry.vcpu),
      blockers: [],
      topOffendingDatabases: input.workload.databases,
      passedChecks: [
        "CPU_TARGET_FIT",
        "MEMORY_FIT",
        "IOPS_FIT",
        "THROUGHPUT_FIT",
        "ORDERABILITY_FIT"
      ]
    };
  }

  for (const evaluation of evaluations) {
    for (const failure of evaluation.failures) {
      blockers.push(blockerFromFailure(evaluation.instanceClass, failure));
    }
  }

  return {
    currentConfig: input.currentConfig,
    risk: "blocked",
    blockers,
    topOffendingDatabases: input.workload.databases,
    passedChecks: []
  };
}

export function optimizeCost(currentConfig: CurrentRdsConfig, workload: WorkloadProfile): OptimizationResult {
  return {
    currentConfig,
    risk: "blocked",
    blockers: [
      {
        code: "OPTIMIZER_REQUIRES_CATALOG_AND_CANDIDATES",
        dimension: "orderability",
        message: "Use optimizeComputeCandidate with a local catalog and caller-supplied ordered candidates."
      }
    ],
    topOffendingDatabases: workload.databases,
    passedChecks: []
  };
}

function riskFromCpuTarget(cpuP95Pct: number, currentVcpu: number, selectedVcpu: number): "low" | "medium" | "high" {
  const projectedCpu = selectedVcpu > 0 ? (currentVcpu * cpuP95Pct) / selectedVcpu : 100;
  if (projectedCpu < 50) return "low";
  if (projectedCpu <= 70) return "medium";
  return "high";
}

function blockerFromFailure(instanceClass: string, failure: string): OptimizationBlocker {
  const dimension = failureDimension(failure);
  return {
    code: failure.split(":")[0],
    dimension,
    message: `${instanceClass}: ${failure}`
  };
}

function failureDimension(failure: string): OptimizationBlocker["dimension"] {
  if (failure.startsWith("CPU_")) return "cpu";
  if (failure.startsWith("MEMORY_")) return "memory";
  if (failure.startsWith("IOPS_")) return "iops";
  if (failure.startsWith("THROUGHPUT_")) return "throughput";
  if (failure.startsWith("EDITION_")) return "edition";
  if (failure.startsWith("SQL_VERSION_") || failure.startsWith("INSTANCE_")) return "orderability";
  return "orderability";
}