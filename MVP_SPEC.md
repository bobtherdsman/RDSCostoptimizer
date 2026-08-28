# RDS Cost Optimization MVP Spec

## MVP Goal
Build a standalone owner-only tool that analyzes live RDS SQL Server collector output and produces a verified current-cost vs optimized-cost recommendation.

The first version should prove one core workflow:
CPU shows a vCPU savings opportunity, then the optimizer verifies that memory, IOPS, throughput, SQL edition, SQL version, and RDS orderability still fit. If not, it reports the blocker instead of recommending the downsize.

## Non-Negotiables
- Separate project from SSATWeb.
- No changes to SSATWeb public analyzer behavior.
- No dependency on SSATWeb sizing/recommendation engine.
- Copied SSATWeb harness rules may validate the optimized size, but cannot choose the optimized size.
- Instance catalog/orderability data is used only for validation.
- Collector remains SQL-only and low impact.
- Cost Optimization extra metrics are opt-in.
- No customer data, SQL text, query plans, tracing, or table scans.
- Every customer-facing number must pass the cost harness.

## MVP Inputs
Uploads may contain one server or multiple servers. Each server must produce its own current RDS config, workload profile, recommendation/blocker result, top DB attribution, and cost summary.
Required:
- Collector ZIP/CSV output.
- Current RDS instance class.
- Region.
- SQL Server edition.
- SQL Server version.
- License model: License Included or BYOM.
- Storage type.
- Allocated storage GB.
- Provisioned IOPS.
- Provisioned throughput.
- Multi-AZ flag.

Optional:
- RI coverage/term assumptions.
- BYOM license confirmation.
- Backup/snapshot estimates.
- Current monthly bill override if provided by customer.

## MVP Metrics
Required from collector:
- CPU distribution.
- SQL/OS memory values.
- PLE.
- Per-database IOPS.
- Per-database throughput.
- tempdb I/O share when available.
- Total database size.
- Per-database size where available.
- Advisory per-database CPU signal where safely available.
- Advisory per-database memory/buffer-pool footprint where safely available.

Optional opt-in diagnostics:
- Memory Grants Pending.
- Buffer Cache Hit Ratio.
- PAGEIOLATCH waits.
- RESOURCE_SEMAPHORE waits.
- File-level io_stall.
- Per-file tempdb/data/log attribution.
- Wait stats.
- Tempdb usage.

## MVP Optimization Scope
Included:
- CPU/vCPU right-sizing candidate.
- Memory fit validation.
- IOPS fit validation.
- Throughput fit validation.
- Top offending database ranking for IOPS, throughput, tempdb contribution, and storage share.
- Approximate DB-level CPU/memory attribution only when collected with negligible overhead and labeled advisory.
- Split/isolate/merge advisory signals based on DB-level load distribution.
- SQL edition/version/orderability validation.
- Current vs optimized monthly cost.
- Storage performance right-sizing for gp3/io2 where facts are verified.
- Blocker reporting.
- JSON and CSV/Excel-style export.

Deferred:
- Automated RDS API enrichment.
- Full RI optimization.
- BYOM automation beyond comparison fields.
- Fleet consolidation.
- Extended Support modeling.
- Backup/snapshot cleanup modeling.
- Production change automation.
- Full customer-facing polished UI.

## Decision Flow
1. Parse current workload.
2. Calculate current cost.
3. Use CPU P95 to propose lower-vCPU candidates.
4. For each candidate, verify:
   Candidate order must be explicit. Until pricing is implemented, do not silently infer cheapest; validate caller-supplied order only.
   - memory capacity fits
   - EBS IOPS fits
   - throughput fits
   - SQL edition limits fit
   - SQL version/edition/family/size is orderable
   - storage rule is legal
5. Pick the cheapest valid candidate.
6. If no smaller candidate passes, keep current compute and report the blocker.
7. Evaluate storage performance savings separately.
8. Run cost harness.
9. Produce report.

## Output Contract
Per server:
For multi-server uploads, repeat this output per server and include a fleet summary.
- Current configuration.
- Current monthly cost.
- Optimized configuration or blocked opportunity.
- Optimized monthly cost.
- Monthly savings.
- Annual savings.
- Savings percentage.
- Risk rating.
- Top offending databases by IOPS, throughput, tempdb, and size.
- Advisory DB-level CPU/memory notes when available.
- Split/isolate/merge notes when the data supports them.
- Passed checks.
- Failed checks/blockers.
- Action plan.

Example blocker messages:
- CPU is underutilized, but smaller candidates do not provide enough memory.
- CPU is underutilized, but smaller candidates do not meet required EBS IOPS.
- CPU is underutilized, but throughput requirement forces the current/larger class.
- EE to SE is blocked by edition feature usage or scale limits.
- Storage IOPS can be reduced, but allocated storage size cannot be reduced.

## Harness Requirements
The MVP is not complete until the harness validates:
- Recommended instance is orderable.
- License model is valid.
- EE to SE only occurs when eligible.
- Storage type/performance recommendation is legal.
- No allocated-storage shrink.
- Pricing source is live or explicitly marked non-customer-facing.
- Optimized cost is less than or equal to current cost unless marked as no-savings/blocker.
- CPU-driven downsize still fits memory, IOPS, and throughput.
- Optimizer does not call SSATWeb sizing logic.
- SSATWeb harness-derived checks validate the optimized size after the Cost Optimization engine selects it.

## Acceptance Criteria
- Upload one collector package and current RDS config.
- Support one-server and multi-server upload envelopes.
- Generate normalized workload profile.
- Generate at least one safe recommendation or one clear blocker.
- Show top offending database attribution when per-database metrics exist.
- Show current and optimized monthly cost.
- Show savings and risk.
- Run harness successfully.
- No SSATWeb files or behavior changed.
