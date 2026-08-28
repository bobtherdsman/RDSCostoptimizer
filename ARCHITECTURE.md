# RDS Cost Optimization Architecture

## Purpose
RDS Cost Optimization is a standalone project for analyzing live Amazon RDS for SQL Server instances and producing a verified cost-reduction plan. It must not change SSATWeb behavior, SSATWeb sizing logic, the public analyzer flow, or the default SSAT collector path.

The optimizer owns its own sizing and savings logic. It may use an instance catalog/orderability dataset only as a constraint source to prove that a recommended target instance is valid for the SQL Server version, edition, region, and RDS instance class.

## System Boundaries
In scope:
- Owner-only web/app surface for uploading collector output.
- SQL-only, low-impact collector mode for cost optimization diagnostics.
- Parser for original SSAT metrics plus optional cost-optimization metrics.
- Independent optimizer for CPU/vCPU, memory fit, IOPS fit, throughput fit, storage, edition, licensing, and savings.
- Cost harness that blocks unverifiable or unsafe recommendations.
- Report/export output with current cost, optimized cost, savings, blockers, and actions.

Out of scope for MVP:
- Changes to SSATWeb public analyzer behavior.
- Calling SSATWeb recommendation/sizing engine.
- Workload replay, tracing, Extended Events, Query Store scraping, query-plan capture, or application-table scans.
- Customer data capture, SQL text capture, stored procedure text capture, passwords, or PII.
- Automated production changes to customer RDS instances.

## High-Level Components
1. Collector Package
   - Runs from the customer environment against the live RDS SQL Server instance.
   - Uses read-only DMV, catalog, and performance-counter queries.
   - Default mode collects original metrics only.
   - Cost Optimization mode is explicit and adds lightweight diagnostics.

2. Upload/API Surface
   - Supports both single-server and multi-server uploads.
   - Owner-only.
   - Accepts ZIP/CSV collector output.
   - Captures current RDS configuration required for cost calculation: region, instance class, SQL edition/version, license model, storage type, allocated storage, provisioned IOPS, provisioned throughput, Multi-AZ, and RI/BYOM assumptions when known.

3. Parser/Normalizer
   - Converts collector CSVs into a normalized workload profile.
   - Computes cleaned distributions: avg, P50, P90, P95, P99, max.
   - Separates sustained demand from outliers.
   - Preserves per-database I/O, tempdb share, throughput, and size context where available.
   - Ranks top offending databases by IOPS, throughput, tempdb pressure, and storage share.
   - Treats DB-level CPU and memory as optional advisory signals, not hard fit metrics, because low-impact SQL Server collection cannot always attribute them reliably per database.

4. Optimizer
   - Starts with CPU/vCPU reduction as the first savings candidate.
   - Evaluates candidates in caller-supplied order until pricing can order by verified cost.
   - Rejects any candidate that does not fit memory, IOPS, throughput, edition limits, and orderability.
   - Investigates blockers instead of forcing an unsafe downsize.
   - Owns all right-sizing logic; does not call SSATWeb sizing code.

5. Catalog/Orderability Validator
   - Uses instance catalog and live/API-derived orderability facts as constraints.
   - Validates SQL Server edition, version, region, license model, family, and size.
   - Does not decide sizing by itself.

6. Pricing Service
   - Uses live AWS pricing data where available.
   - Separates compute/license, storage, IOPS, throughput, backup, RI, BYOM, and Multi-AZ assumptions.
   - Refuses customer-facing numbers when pricing source is stale or unverifiable.

7. Cost Harness
   - Incorporates applicable SSATWeb sizing harness rules as validation oracles for the independently selected optimized target.
   - Does not call SSATWeb sizing/recommendation logic to choose an instance.
   - Runs deterministic fixtures against recommendation outputs.
   - Blocks recommendations that violate AWS/Microsoft facts, orderability, storage rules, or workload fit.

8. Report/Export
   - Produces executive summary, per-server details, savings, risk, blockers, and action plan.
   - Exports PDF, Excel/CSV, and JSON when implemented.

## Data Flow
1. Collector runs on live RDS SQL Server for the selected collection window.
2. User uploads ZIP/CSV output to the owner-only Cost Optimization app.
3. Parser normalizes CPU, memory, IOPS, throughput, storage, edition, and version data.
4. Current-cost model calculates actual current monthly cost from current RDS configuration.
5. CPU P95 proposes lower-vCPU candidates.
6. Memory, IOPS, throughput, edition, and orderability checks validate or reject each candidate.
7. Storage optimizer evaluates gp3/io2/performance right-sizing without shrinking allocated storage.
8. Pricing service calculates current vs optimized cost.
9. Cost harness verifies the result.
10. For multi-server uploads, aggregate per-server results into a fleet summary without hiding individual blockers.
10. Report layer presents recommended changes, blocked opportunities, risk, and next actions.

## Optimizer Contract
Input:
- Current RDS configuration.
- SQL Server edition/version/license model.
- Normalized workload profile.
- Instance catalog/orderability facts.
- Pricing data.

Output:
- Current monthly cost.
- Recommended target configuration, if safe.
- Optimized monthly cost.
- Monthly and annual savings.
- Risk rating.
- Blockers when savings cannot be safely recommended.
- Top offending databases and the metric each database is driving.
- Advisory DB-level CPU/memory attribution when safely available, clearly labeled as approximate.
- Split/isolate/merge advisory signals when database-level metrics show uneven load or consolidation opportunity.
- Evidence fields showing which checks passed.

Hard rules:
- CPU proposes; it does not decide alone.
- Final recommendation must fit memory, IOPS, throughput, edition limits, and orderability.
- If a smaller vCPU candidate fails a fit check, show it as a blocked savings opportunity.
- Preserve database-level attribution wherever the collector provides it; do not collapse all workload evidence to instance-level averages.
- Do not shrink allocated primary storage.
- Do not recommend EE to SE unless the fact-based eligibility gate passes.
- Do not recommend unsupported SQL Server version/edition/family/size combinations.
- Do not use SSATWeb sizing logic.
- Use copied SSATWeb harness rules only to validate the independently selected optimized size.

## Collector Safety Model
Collector queries must be:
- SQL Server-only.
- Read-only.
- Lightweight.
- Interval-based for runtime counters.
- One-time for catalog and size snapshots.
- Bounded in output size.

Cost Optimization metrics must be opt-in:
- Default mode: original collector metrics only.
- Cost Optimization mode: additional lightweight diagnostics for memory and I/O blockers.

Candidate extra metrics:
- Memory Grants Pending.
- Buffer Cache Hit Ratio.
- PAGEIOLATCH waits.
- RESOURCE_SEMAPHORE waits.
- Wait stats.
- File-level io_stall latency.
- Read/write latency split.
- Per-file tempdb/data/log attribution.
- Per-database sizes.
- Tempdb usage.

## Suggested Module Layout
```text
rdscostoptimization/
  docs/
  collector/
    RunCostOptimization.ps1
    SSATcollector_cost.ps1
  src/
    api/
    parser/
    optimizer/
    pricing/
    catalog/
    harness/
    reports/
  tests/
    fixtures/
    harness/
```

The exact framework can be chosen later. The architecture requirement is separation, not a specific stack.
