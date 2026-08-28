import type { CurrentRdsConfig, OptimizationResult, WorkloadProfile } from "../contracts/types.js";
import {
  isOrderableCandidate,
  type CandidateRequirements,
  type InstanceCatalogEntry
} from "../catalog/index.js";
import { requiredVcpuForCpuTarget } from "../optimizer/index.js";

export interface HarnessFinding {
  oracle: string;
  passed: boolean;
  message: string;
}

export interface CostHarnessContext {
  result: OptimizationResult;
  workload: WorkloadProfile;
  catalog: InstanceCatalogEntry[];
  currentConfig: CurrentRdsConfig;
  requirements: CandidateRequirements;
  currentVcpu: number;
  targetCpuUtilizationPct?: number;
  usedSsatWebSizingEngine?: boolean;
}

export function runCostHarness(context: CostHarnessContext): HarnessFinding[] {
  const findings: HarnessFinding[] = [];
  const recommended = context.result.recommendedConfig;

  findings.push(passFail(
    "CO-J-INDEPENDENT-SIZING",
    !context.usedSsatWebSizingEngine,
    "Cost Optimization must not call SSATWeb sizing/recommendation logic."
  ));

  if (!recommended) {
    findings.push(passFail(
      "CO-H-BLOCKED-RESULT-HAS-BLOCKERS",
      context.result.blockers.length > 0,
      "Blocked/no-recommendation result must explain blockers."
    ));
    return findings;
  }

  const validation = isOrderableCandidate(
    context.catalog,
    context.currentConfig,
    recommended.instanceClass,
    context.requirements
  );
  const entry = validation.entry;

  findings.push(passFail(
    "CO-A-ORDERABLE-CATALOG",
    Boolean(entry) && !validation.failures.some((failure) => failure.startsWith("INSTANCE_NOT_IN_CATALOG")),
    validation.failures.find((failure) => failure.startsWith("INSTANCE_NOT_IN_CATALOG")) ?? "Recommended instance exists in local catalog."
  ));

  findings.push(passFail(
    "CO-A-ORDERABLE-CONSTRAINTS",
    validation.valid,
    validation.valid ? "Recommended instance satisfies edition/version/orderability and workload-fit constraints." : validation.failures.join("; ")
  ));

  if (!entry) return findings;

  const requiredVcpu = requiredVcpuForCpuTarget(
    context.currentVcpu,
    context.workload.cpuPct.p95,
    context.targetCpuUtilizationPct
  );

  findings.push(passFail(
    "CO-I-CPU-FIT",
    entry.vcpu >= requiredVcpu,
    `Recommended vCPU ${entry.vcpu}; required vCPU ${requiredVcpu}.`
  ));

  findings.push(passFail(
    "CO-I-MEMORY-FIT",
    entry.memoryGb >= context.requirements.memoryGb,
    `Recommended memory ${entry.memoryGb} GB; required memory ${context.requirements.memoryGb} GB.`
  ));

  findings.push(passFail(
    "CO-I-IOPS-FIT",
    entry.maxIops >= context.requirements.iops,
    `Recommended max IOPS ${entry.maxIops}; required IOPS ${context.requirements.iops}.`
  ));

  findings.push(passFail(
    "CO-I-THROUGHPUT-FIT",
    entry.maxThroughputMbps >= context.requirements.throughputMbps,
    `Recommended throughput ${entry.maxThroughputMbps} MB/s; required throughput ${context.requirements.throughputMbps} MB/s.`
  ));

  findings.push(passFail(
    "CO-H-OPTIMIZED-COST-NOT-HIGHER",
    costNotHigherOrNotPriced(context.result),
    "Optimized cost must be <= current cost when both costs are present."
  ));

  findings.push(passFail(
    "CO-DB-ATTRIBUTION-PRESENT",
    context.result.topOffendingDatabases.length > 0,
    "Result should preserve top offending database attribution when workload DB metrics exist."
  ));

  return findings;
}

export function assertHarnessPassed(findings: HarnessFinding[]): void {
  const failures = findings.filter((finding) => !finding.passed);
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => `${failure.oracle}: ${failure.message}`).join("\n"));
  }
}

function passFail(oracle: string, passed: boolean, message: string): HarnessFinding {
  return { oracle, passed, message };
}

function costNotHigherOrNotPriced(result: OptimizationResult): boolean {
  if (result.currentMonthlyCostUsd === undefined || result.optimizedMonthlyCostUsd === undefined) {
    return true;
  }
  return result.optimizedMonthlyCostUsd <= result.currentMonthlyCostUsd;
}