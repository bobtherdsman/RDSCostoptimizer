# RDS Cost Optimization Tasks

## Phase 0 - Project Foundation
- [x] Create standalone app/service scaffold.
- [x] Add project README with purpose, boundaries, and setup.
- [x] Choose implementation stack. Initial stack: TypeScript/Node scaffold.
- [x] Create source layout for parser, optimizer, catalog, pricing, harness, and reports.
- [x] Add test runner. Scripts are defined; dependencies still need install.
- [x] Add sample fixtures folder.
- [x] Add owner-only config placeholder: `COST_OWNER_EMAIL`.
- [x] Confirm no dependency on SSATWeb runtime or sizing engine.

## Phase 1 - Data Contracts
- [x] Define collector ZIP/CSV input contract.
- [x] Define current RDS configuration input schema.
- [x] Define normalized workload profile schema.
- [x] Define optimizer output schema.
- [x] Define single-server and multi-server upload/result envelope schemas.
- [x] Define report/export schema.
- [x] Create sample JSON fixtures for small, medium, high-IOPS, high-throughput, and memory-blocked workloads.

## Phase 2 - Parser
- [x] Parse CPU metrics.
- [x] Parse memory metrics.
- [x] Parse PLE.
- [x] Parse per-database IOPS.
- [x] Parse per-database throughput.
- [x] Parse per-database size where available.
- [x] Parse total DB size.
- [x] Detect tempdb share from existing per-DB I/O.
- [x] Rank top offending databases by IOPS, throughput, tempdb contribution, and storage size.
- [ ] Add optional advisory per-database CPU attribution if a negligible-overhead method is available.
- [ ] Add optional advisory per-database memory/buffer-pool attribution if a negligible-overhead method is available.
- [ ] Label DB-level CPU and memory attribution as approximate/advisory in output.
- [x] Compute avg, P50, P90, P95, P99, and max.
- [x] Add outlier-cleaning utility. Not applied by default until cleaning policy is approved.
- [x] Emit normalized workload profile.

## Phase 3 - Catalog And Orderability
- [x] Import or copy instance catalog into this standalone project. Initial fixture catalog added; full catalog import remains future work.
- [x] Define catalog schema.
- [x] Validate instance family, size, memory, vCPU, IOPS, throughput.
- [x] Validate SQL edition limits.
- [x] Validate SQL version/edition/family/size orderability.
- [x] Add fixture tests for valid and invalid recommendations.
- [x] Ensure catalog is used only as constraints, not as SSATWeb sizing logic.
- [x] Copy SSATWeb sizing harness as local validation baseline/reference.

## Phase 4 - Core Optimizer
- [x] Implement CPU P95 vCPU target formula.
- [x] Generate lower-vCPU candidate list. Current implementation accepts caller-supplied ordered candidates; pricing-based ordering comes later.
- [x] Validate candidate memory fit.
- [x] Validate candidate IOPS fit.
- [x] Validate candidate throughput fit.
- [x] Validate edition/version/orderability fit.
- [ ] Pick cheapest valid candidate. Deferred until pricing phase; current optimizer picks first valid caller-ordered candidate.
- [x] Emit blocked opportunity when no candidate fits.
- [x] Emit top offending database attribution.
- [ ] Emit split/isolate/merge advisory signals. Deferred until report layer consumes DB attribution.
- [x] Add risk rating.
- [ ] Add action plan text for blocked memory, IOPS, throughput, tempdb, and edition/orderability. Deferred to report layer.

## Phase 5 - Storage Optimizer
- [ ] Model current storage cost.
- [ ] Validate gp3 baseline and provisioned IOPS/throughput rules.
- [ ] Right-size gp3 IOPS to P95 plus headroom.
- [ ] Right-size throughput to P95/P99 plus headroom.
- [ ] Block allocated storage shrink.
- [ ] Add gp3/io2 comparison where pricing is verified.
- [ ] Add storage blocker messages.

## Phase 6 - Pricing
- [ ] Integrate live AWS pricing source.
- [ ] Model License Included.
- [ ] Model BYOM comparison fields.
- [ ] Model Multi-AZ multiplier/assumption.
- [ ] Model storage, IOPS, and throughput cost.
- [ ] Mark stale or fallback pricing as non-customer-facing.
- [ ] Add pricing reconciliation tests.

## Phase 7 - Cost Harness
- [x] Build harness runner.
- [x] Add oracle CO-A: orderable instance.
- [ ] Add oracle CO-B: valid license model.
- [ ] Add oracle CO-C: EE to SE eligibility.
- [ ] Add oracle CO-D: legal storage recommendation.
- [ ] Add oracle CO-E: RI only after right-sizing.
- [ ] Add oracle CO-F: no storage shrink/no unsupported architecture.
- [ ] Add oracle CO-G: live pricing/totals reconcile. Partial: cost-not-higher check exists when current/optimized prices are present.
- [x] Add oracle CO-H: optimized cost <= current cost unless blocked.
- [x] Add oracle CO-I: CPU downsize still fits memory/IOPS/throughput.
- [x] Add oracle CO-J: no SSATWeb sizing engine dependency.
- [x] Add oracle CO-K: optimized size passes applicable copied SSATWeb sizing-harness validation. Current implementation covers applicable fit/orderability oracles from the copied harness inventory.

## Phase 8 - Collector Package
- [ ] Decide separate Cost Optimization launcher vs RunMefirst toggle.
- [ ] Keep original/default collection unchanged.
- [ ] Add explicit `Enable Cost Optimization metrics` option if using shared launcher.
- [ ] Add SQL-only low-impact diagnostics.
- [ ] Add bounded result sets.
- [ ] Add opt-in output CSVs.
- [ ] Add collector overhead review checklist.
- [ ] Validate no SQL text, row data, plans, tracing, or PII are captured.

## Phase 9 - API/UI
- [ ] Add owner-only upload endpoint.
- [ ] Add current RDS config form/input.
- [ ] Add analysis endpoint.
- [ ] Add results view.
- [ ] Show current vs optimized cost.
- [ ] Show savings, risk, and blockers.
- [ ] Add export endpoint.
- [ ] Add error states for missing metrics or unverifiable pricing.

## Phase 10 - Reports
- [ ] Generate JSON output.
- [ ] Generate CSV/Excel-style output.
- [ ] Generate PDF executive summary.
- [ ] Add per-server detail section.
- [ ] Add risk/action plan section.
- [ ] Add evidence/checks section.

## Open Decisions
- [ ] Final app stack.
- [ ] `COST_OWNER_EMAIL` value.
- [ ] Whether collector is separate package or shared launcher toggle.
- [ ] Required MVP regions.
- [ ] Pricing source/cache policy.
- [ ] Phase 1 storage scope: gp3 only vs gp3/io2.
- [ ] Whether BYOM appears in MVP as comparison only or full recommendation.
- [ ] Export priority: JSON, CSV/Excel, or PDF first.
