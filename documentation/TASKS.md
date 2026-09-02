# Kentra RDS for SQL Server Optimization Tasks

## Governing Authority

All technical behavior in this plan comes from:

- `documentation/Kentra_RDS_SQL_Server_Optimization_Verified_v1_1.docx`
- `AGENTS.md` for project boundaries and change control

No task may introduce a formula, threshold, blocker, metric, recommendation, or scope item that is not stated in the verified document or separately approved by the user.

## Locked Scope

- [x] Optimize the RDS for SQL Server compute footprint for an approximately six-month operating horizon.
- [x] Reduce licensed/allocated vCPU only when CPU, memory, instance I/O, tempdb placement, edition, orderability, and evidence quality support the result.
- [x] Keep storage provisioning optimization outside this phase.
- [x] Keep detailed pricing outside this phase.
- [x] Keep the project independent from SSATWeb sizing logic.
- [x] Do not change SSATWeb.
- [x] Keep collector workload evidence read-only, SQL Server-only, bounded, and low impact while preserving the approved temporary SSAT-style staging/job lifecycle.
- [x] Preserve the established collector download, run, ZIP upload, analysis, and report flow.

## Task 1 - Verified Requirements Matrix

Source: Sections 3 through 10 and the Final Verified Kentra Algorithm.

- [x] Map each verified document requirement to the current collector, parser, catalog, optimizer, harness, reports, and tests.
- [x] Mark each requirement as implemented, partially implemented, missing, or conflicting.
- [x] Identify existing behavior that conflicts with the verified document.
- [x] Do not change conflicting behavior until its document requirement and replacement task are identified.
- [x] Update `COST_OPTIMIZATION_END_TO_END_SPEC.md`, `MVP_SPEC.md`, and `ARCHITECTURE.md` so they match the verified document.

## Task 2 - Canonical Synchronized Sample Model

Source: Final Verified Algorithm steps 2 and 3.

- [x] Preserve timestamped SQL CPU, Other CPU, memory, user-database I/O, and tempdb I/O evidence.
- [x] Align evidence by sample time before candidate calculations.
- [x] Preserve actual elapsed time between cumulative-counter samples.
- [x] Preserve raw evidence needed to reproduce P50, P95, P99, maximum, burst duration, and burst frequency.
- [x] Detect missing, duplicate, out-of-order, reset, or invalid samples.

## Task 3 - Collector Requirements

Source: Sections 3.3, 4, 4.1, 5, and 6.

No collector implementation begins until the current collector is checked against each item and the exact missing changes are approved.

- [x] Verify that `sys.dm_os_sys_info.cpu_count` in CPUINFO represents the current SQL Server-visible vCPU count.
- [x] Preserve the existing per-minute SQL process CPU, system idle, and Other CPU samples.
- [x] Preserve the existing Cost Optimization wait-stat collection.
- [x] Collect Memory Grants Pending.
- [x] Collect Memory Grants Outstanding.
- [x] Collect Granted Workspace Memory.
- [x] Collect process physical-memory state and process low-memory flags.
- [x] Collect system low-memory state.
- [x] Collect overall PLE and per-NUMA-node PLE.
- [x] Preserve committed/target memory, OS total/available memory, memory clerks, and stolen memory.
- [x] Collect Buffer Cache Hit Ratio alongside the memory samples.
- [x] Collect Page Reads/sec alongside the memory samples.
- [x] Collect Page Writes/sec alongside the memory samples.
- [x] Collect Lazy Writes/sec as the document's preferred additional cache-pressure signal.
- [x] Preserve cumulative per-file reads, writes, bytes read, bytes written, and I/O stall counters with timestamps.
- [x] Preserve database, file, and file-type attribution, including tempdb.
- [x] Capture representative and peak tempdb allocated size needed for the local-instance-store capacity gate.
- [x] Keep all additional Cost Optimization metrics behind the existing RunMefirst toggle.
- [x] Keep original collector behavior unchanged when Cost Optimization is disabled.
- [x] In Kentra V2 Cost Optimization mode, collect CPU plus consolidated `CO_WorkloadSamples` evidence and skip legacy `SQL_MemCollection`, `SQL_DBIOTotal`, and `SQL_DBIO` staging/export to avoid overlapping memory/I/O collection.
- [x] Prove that workload evidence queries remain read-only, bounded, and low impact and that collector-owned staging/job artifacts are removed after export.
- [x] Prove that no SQL text, plans, Query Store content, traces, row data, credentials, or PII are collected.

## Task 4 - SQL Server-Specific Candidate Catalog

Source: Sections 3.3 and 8.

- [x] Stop using generic RDS or EC2 vCPU metadata as the only CPU source for SQL Server candidates.
- [x] Store the SQL Server-visible default vCPU count for each supported RDS SQL Server class.
- [x] Store valid Optimize CPU core and threads-per-core configurations.
- [x] Resolve candidates by Region.
- [x] Resolve candidates by SQL Server edition.
- [x] Resolve candidates by exact SQL Server engine version.
- [x] Include DB instance class and available processor features.
- [x] Include Multi-AZ capability where relevant.
- [x] Include sustained/baseline and maximum/burst instance IOPS capability.
- [x] Include sustained/baseline and maximum/burst EBS throughput capability.
- [x] Include local instance-store support and capacity.
- [x] Build or refresh candidate metadata from `DescribeOrderableDBInstanceOptions` or an equivalent periodically refreshed source.
- [x] Prevent unavailable class, Region, edition, version, or processor configurations from becoming candidates.

## Task 5 - Evidence Window and Confidence

Source: Section 9.

- [x] Calculate collection duration from the collected timestamps.
- [x] Validate sample continuity.
- [x] Validate that the window includes normal peak business periods through the approved customer verbal confirmation requirement; do not claim tool verification.
- [x] Classify less than 48 hours as insufficient for production rightsizing except clearly idle or non-production cases.
- [x] Classify 3 to 6 days as preliminary, low-to-medium confidence, and require the window to be explicitly representative.
- [x] Treat at least 7 days as the minimum recommended production assessment.
- [x] Treat at least 14 days as the preferred default for high-confidence optimization.
- [x] Support 30 to 32 days when month-end or monthly cycles materially affect the workload.
- [x] Report the collection window and the reason for the assigned confidence.

## Task 6 - CPU Projection

Source: Sections 3.1 through 3.4 and Final Verified Algorithm step 5.

- [x] Use SQL process utilization as the primary compute-footprint signal.
- [x] Keep Host/Other CPU as a hard safety gate.
- [x] Calculate `SQLCoreDemand(sample) = Current_SQL_visible_vCPU * SQLProcessUtilization(sample) / 100`.
- [x] Calculate `ProjectedSQLCPU(sample) = SQLCoreDemand(sample) / Candidate_SQL_visible_vCPU * 100`.
- [x] Calculate `ProjectedTotalCPU(sample) = (SQLCoreDemand + OtherCoreDemand) / Candidate_SQL_visible_vCPU * 100`.
- [x] Calculate every projection per sample before calculating P95 or P99.
- [x] Never sum independent CPU percentiles.
- [x] Use projected SQL CPU P95 `<= 70%` as the sizing target.
- [x] Use projected SQL CPU P99 `<= 90%` as the burst safety ceiling.
- [x] Use concurrent projected total CPU P99 `<= 90%` as the Host/Other CPU hard gate.
- [x] Report samples above the 90% ceilings as excursions; do not independently scale or use raw maximum as the sizing percentile.
- [x] Use current and candidate SQL Server-visible vCPU counts in all CPU calculations.
- [x] Generate valid Optimize CPU configurations as candidates.
- [x] Treat same-hardware and same-family projections as the strongest linear comparisons.
- [x] For cross-generation or cross-family candidates, use a normalized per-core capacity factor when authoritative data exists; otherwise lower confidence.
- [x] Report current visible vCPU, candidate visible vCPU, projected P95, projected P99, Other CPU, and family-comparison confidence.

## Task 7 - Memory Pressure and Working-Set Analysis

Source: Section 4.

- [x] Do not treat committed memory alone as irreducible required RAM.
- [x] Evaluate OS available-memory low-tail behavior.
- [x] Evaluate SQL process memory and process/system low-memory flags.
- [x] Evaluate Memory Grants Pending and Outstanding.
- [x] Evaluate Granted Workspace Memory.
- [x] Evaluate overall and per-NUMA-node PLE.
- [x] Evaluate memory clerks and stolen memory.
- [x] Evaluate Buffer Cache Hit Ratio, Page Reads/sec, Page Writes/sec, and Lazy Writes/sec.
- [x] Use pressure and working-set evidence to validate candidate memory.
- [x] Apply the approved `20%` headroom to the reproducible less-elastic memory floor for the approximately six-month optimization horizon.
- [x] Preserve every memory signal used in the candidate result.

## Task 8 - Memory-to-Physical-I/O Coupling

Source: Section 4.1 and Final Verified Algorithm step 7.

- [x] Detect a material RAM reduction at `>=25%` or when moving to a lower-memory instance-family tier.
- [x] Evaluate Buffer Cache Hit Ratio, Page Reads/sec, Page Writes/sec, and Lazy Writes/sec before assuming current physical I/O will continue after the RAM reduction.
- [x] Use current ReadIOPS under load as evidence of whether the working set resides in memory.
- [x] Define low-pressure samples as the bottom pressure-score quartile and high-pressure samples as the top pressure-score quartile; exclude the middle 50% from the magnitude comparison.
- [x] Use Spearman correlation across all valid pressure/ReadIOPS sample pairs and require correlation `>=0.40` before treating the relationship as meaningful.
- [x] Require median high-pressure ReadIOPS to be at least `20%` above the low-pressure median before treating the relationship as meaningful.
- [x] Treat a `>=40%` high-pressure median increase as a strong pressure signal that favors preserving RAM.
- [x] Require persistence in at least `10%` of valid samples or at least `3` distinct qualifying pressure periods of `5` consecutive one-minute samples.
- [x] Normalize ReadIOPS by Batch Requests/sec when available; otherwise use raw ReadIOPS, label it unnormalized, and cap coupling confidence at medium.
- [x] Treat correlation `>=0.40` with less than `20%` magnitude, or without persistence, as weak evidence that cannot fail RAM reduction by itself.
- [x] Do not claim an exact future IOPS prediction when the stable working set cannot be demonstrated.
- [x] When a materially RAM-reducing candidate lacks stable-working-set evidence, classify it as aggressive/medium-confidence and prefer a memory-preserving Optimize CPU candidate.
- [x] Treat Buffer Cache Hit Ratio as supporting evidence rather than a standalone hard threshold.
- [x] Preserve the memory-to-I/O reasoning in the recommendation evidence.

## Task 9 - Physical IOPS Calculation

Source: Sections 5, 5.1, 5.2, and 5.3.

- [x] Use cumulative `sys.dm_io_virtual_file_stats` read and write operation counters.
- [x] Calculate `ReadIOPS = delta(num_of_reads) / elapsed_seconds`.
- [x] Calculate `WriteIOPS = delta(num_of_writes) / elapsed_seconds`.
- [x] Reject invalid intervals caused by resets, negative deltas, missing pairs, or invalid elapsed time.
- [x] Reject a synchronized instance sample when any required file interval is invalid so partial file data cannot understate instance demand.
- [x] Aggregate all relevant database and file IOPS within each synchronized sample.
- [x] Calculate instance percentiles only after per-sample aggregation.
- [x] Never sum independent database P95 values.
- [x] Compare normal IOPS P95 with candidate sustained/baseline IOPS capability.
- [x] Compare IOPS P99 with candidate maximum/burst capability.
- [x] Validate observed burst duration and frequency before relying on burst capability.
- [x] Do not rely on burst when class-specific duration or frequency behavior is unavailable.
- [x] Treat maximum as context/anomaly evidence and do not reject solely for one isolated sample.
- [x] Validate against target DB-instance capability without changing the customer's gp3 or io2 design in this phase.

## Task 10 - Physical Throughput Calculation

Source: Sections 5, 5.1, 5.2, and 5.3.

- [x] Use cumulative `sys.dm_io_virtual_file_stats` byte counters.
- [x] Calculate `ReadMiB/s = delta(num_of_bytes_read) / elapsed_seconds / 1,048,576`.
- [x] Calculate `WriteMiB/s = delta(num_of_bytes_written) / elapsed_seconds / 1,048,576`.
- [x] Reject invalid intervals caused by resets, negative deltas, missing pairs, or invalid elapsed time.
- [x] Reject a synchronized instance sample when any required file interval is invalid so partial file data cannot understate throughput.
- [x] Aggregate all relevant database and file throughput within each synchronized sample.
- [x] Calculate instance percentiles only after per-sample aggregation.
- [x] Never sum independent database throughput percentiles.
- [x] Compare normal throughput P95 with candidate sustained/baseline throughput or EBS bandwidth.
- [x] Compare throughput P99 with candidate maximum/burst capability.
- [x] Validate observed burst duration and frequency before relying on burst capability.
- [x] Do not rely on burst when class-specific duration or frequency behavior is unavailable.
- [x] Treat maximum as context/anomaly evidence and do not reject solely for one isolated sample.
- [x] Validate throughput independently from IOPS.

## Task 11 - Candidate-Aware tempdb and Local NVMe

Source: Section 6 and Final Verified Algorithm steps 8 and 11.

- [x] Identify whether the current class places tempdb on local instance storage.
- [x] Identify whether each candidate class places tempdb on local instance storage.
- [x] For `Non-NVMe -> Non-NVMe`, keep user/system database and tempdb demand on the normal storage path.
- [x] For `Non-NVMe -> NVMe`, remove time-aligned tempdb demand from the normal storage path and validate tempdb separately.
- [x] For `NVMe -> NVMe`, keep tempdb separate and revalidate the target class's local capacity.
- [x] For `NVMe -> Non-NVMe`, add time-aligned tempdb IOPS and throughput back to the normal storage path.
- [x] Perform tempdb remapping on synchronized samples before candidate P95 and P99 calculations.
- [x] Hard-block an NVMe candidate when representative or peak tempdb allocated size exceeds target local-instance-store capacity.
- [x] Treat local-NVMe I/O intensity as a confidence/risk signal unless an authoritative class-specific performance limit exists.
- [x] Never treat user database or log files as local-NVMe files.
- [x] Report current placement, candidate placement, remapped normal-path demand, tempdb demand, and capacity result.

## Task 12 - Enterprise-to-Standard Evaluation

Source: Section 7.

- [x] Implement `EditionEligible = FeatureCompatible AND VendorSupported AND StandardScaleLimitsFit AND RDSClassVersionOrderable AND MigrationPathAccepted`.
- [x] Validate Enterprise-only feature compatibility.
- [x] Validate vendor support.
- [x] Apply SQL Server version-specific Standard Edition socket and core limits.
- [x] Apply SQL Server version-specific Standard Edition buffer-pool limits.
- [x] Apply version-specific columnstore segment-cache limits.
- [x] Apply version-specific memory-optimized-data limits per database.
- [x] Validate target class, Region, edition, and exact engine version orderability.
- [x] Require an accepted migration path.
- [x] Present Enterprise-to-Standard as a migration recommendation rather than a simple in-place instance resize.
- [x] Report feature, scale, orderability, and migration blockers separately.

## Task 13 - Final Candidate Decision Flow

Source: Section 10, Final Verified Kentra Algorithm.

- [x] Resolve the current SQL Server-visible CPU configuration and class metadata.
- [x] Validate collection duration, continuity, and representativeness.
- [x] Build synchronized SQL CPU, Other CPU, memory, user-database I/O, and tempdb I/O series.
- [x] Generate only currently orderable Region, edition, and exact-version candidates, including Optimize CPU configurations.
- [x] Apply the CPU gate using sample-level projections, P95 target, and P99 burst risk.
- [x] Apply the pressure/working-set memory gate with modest six-month headroom.
- [x] Apply the memory-to-I/O coupling check.
- [x] Map tempdb placement for each candidate.
- [x] Apply the IOPS sustained/baseline and burst/maximum gate.
- [x] Apply the throughput sustained/baseline and burst/maximum gate independently.
- [x] Apply the local-NVMe tempdb capacity hard gate.
- [x] Apply the Enterprise-to-Standard feature, vendor, scale, orderability, and migration gate.
- [x] Return `Recommended`, `Aggressive Optimization`, or `Not Recommended`.
- [x] Return confidence and all limiting-resource assessments.
- [x] Identify the top offending database for a resource only when collected evidence supports that attribution.
- [x] Preserve the evidence and rejection reason for every evaluated candidate.

## Task 14 - Independent Validation Harness

Source: The verified formulas, decision tables, and Final Verified Kentra Algorithm.

- [x] Independently reproduce SQL and total CPU sample projections.
- [x] Independently verify SQL-visible vCPU and Optimize CPU metadata.
- [x] Independently verify collection-window confidence.
- [x] Independently verify memory pressure and working-set evidence.
- [x] Independently verify the memory-to-I/O coupling outcome.
- [x] Independently recalculate IOPS from cumulative counters and actual elapsed time.
- [x] Independently recalculate throughput from cumulative counters and actual elapsed time.
- [x] Independently verify P95 against sustained capability and P99 against burst capability.
- [x] Independently verify burst duration and frequency.
- [x] Independently verify all four tempdb placement transitions.
- [x] Independently verify the local-instance-store capacity hard gate.
- [x] Independently verify the Enterprise-to-Standard eligibility expression.
- [x] Fail any recommendation that cannot be reproduced from its preserved evidence.

## Task 15 - Required Reports and Exports

Source: Sections 3 through 10 and the final outcome contract.

- [x] Show current and candidate RDS class/configuration.
- [x] Show current and candidate SQL Server-visible vCPU.
- [x] Show projected CPU P95, P99, Other CPU, and CPU confidence.
- [x] Show collection duration, continuity, representativeness, and confidence.
- [x] Show memory pressure, working-set, and cache-activity evidence.
- [x] Show the memory-to-I/O coupling result.
- [x] Show read/write IOPS and throughput P95/P99.
- [x] Show candidate sustained/baseline and maximum/burst limits.
- [x] Show observed burst duration and frequency.
- [x] Show per-database and tempdb I/O attribution.
- [x] Show current and candidate tempdb placement and local-capacity fit.
- [x] Show Enterprise-to-Standard eligibility and migration requirement.
- [x] Show `Recommended`, `Aggressive Optimization`, or `Not Recommended`.
- [x] Show confidence and all limiting resources.
- [x] Show the top offending database for each resource when defensible.
- [x] Show passed gates, failed gates, and candidate rejection reasons.
- [x] Keep storage provisioning and detailed pricing outside the report scope for this phase.

## Task 16 - Regression Coverage

Source: Every verified formula and decision branch above.

- [x] Test same-family CPU reduction.
- [x] Test Optimize CPU on the same RDS class.
- [x] Test cross-family projection with normalized capacity data.
- [x] Test cross-family projection without normalized capacity data and verify lower confidence.
- [x] Test P95 CPU fit and P99 burst risk.
- [x] Test Other CPU hard-gate failure.
- [x] Test healthy memory behavior and true memory pressure.
- [x] Test material RAM reduction with stable working-set evidence.
- [x] Test material RAM reduction without stable working-set evidence.
- [x] Test actual-elapsed-time IOPS and throughput calculations.
- [x] Test counter resets and invalid sample intervals.
- [x] Test P95 sustained-capability fit and failure.
- [x] Test P99 burst-capability fit and failure using burst duration/frequency.
- [x] Test all four tempdb placement transitions.
- [x] Test local tempdb capacity fit and failure.
- [x] Test every Enterprise-to-Standard eligibility term.
- [x] Test every documented evidence-window classification.
- [x] Test `Recommended`, `Aggressive Optimization`, and `Not Recommended`.
- [x] Test all limiting-resource reporting and defensible top-database attribution.

## Task 17 - CPU Classification Alignment Correction

Source: Sections 3.1 through 3.4 and Final Verified Kentra Algorithm steps 4 through 10.

- [x] Generate the CPU-classification candidate set using Region, SQL Server edition, exact engine version, instance class, Multi-AZ, and processor-configuration orderability.
- [x] Classify CPU as `under_pressure` only from the documented sustained CPU-pressure evidence.
- [x] Otherwise classify CPU as `underutilized` when at least one currently orderable lower-vCPU candidate passes projected SQL CPU P95, projected SQL CPU P99, and concurrent projected total CPU P99.
- [x] Classify CPU as `normal` when no currently orderable lower-vCPU candidate passes the three CPU gates.
- [x] Keep memory, memory-to-I/O coupling, IOPS, throughput, tempdb, edition migration, and evidence quality out of the CPU-state classification.
- [x] Continue applying every non-CPU gate to the final `Recommended`, `Aggressive Optimization`, or `Not Recommended` decision.
- [x] Rebuild the independent harness CPU-state oracle to apply the same documented policy without importing the production classifier.
- [x] Regression-test resource-blocked CPU opportunities and exact-version/orderability failures so production and harness cannot disagree silently.

## Task 18 - Verified Document End-to-End Alignment Correction

Source: Sections 3 through 10 and the Final Verified Kentra Algorithm.

- [x] Replace the undocumented fixed `80% for 5 samples` CPU-pressure classifier with the verified SQL CPU P95 policy while preserving P99 and concurrent total CPU as candidate safety gates.
- [x] Remove caller-supplied CPU target overrides so every production and harness path uses the locked projected SQL CPU P95 limit of `70%`.
- [x] Collect Batch Requests/sec in the opt-in per-minute collector evidence and convert the cumulative performance counter to an actual elapsed-time rate before workload normalization.
- [x] Keep login and password local to collector execution; exclude both from normalized manifest/upload response objects and reports.
- [x] Reject the complete synchronized instance I/O interval when any expected file is missing from either side of the cumulative-counter pair.
- [x] Independently apply the same missing-file interval rejection in the harness without importing production I/O calculations.
- [x] Build per-database IOPS, throughput, and tempdb attribution from synchronized cumulative per-file evidence using actual elapsed time.
- [x] Stop using independent database P95 values to calculate tempdb share.
- [x] Stop using sums of independent database P95 values for report percentages; derive database IOPS and throughput shares from time-integrated synchronized physical evidence.
- [x] Require local-instance-store capacity plus representative and peak tempdb allocation evidence before accepting an NVMe candidate.
- [x] Independently reproduce the Standard Edition socket limit in the harness.
- [x] Make the harness verify AWS SQL Server-visible vCPU provenance without importing the production catalog predicate.
- [x] Use the same workload-relative Page Reads evidence and actual Batch Requests/sec rate in production and the independent memory-to-I/O oracle.
- [x] Prevent the default runtime from falling back to generic consolidated or fixture catalogs for recommendation candidates when exact SQL Server orderability data is unavailable.
- [x] Reject exact orderability rows whose SQL Server-visible vCPU provenance falls back to generic consolidated hardware metadata.
- [x] Require a verified target socket count before an Enterprise-to-Standard recommendation can pass the documented Standard Edition socket/core limit.
- [x] Reject candidate IOPS and throughput qualification when cumulative physical file-counter evidence is unavailable; do not fall back to a maximum-only comparison.
- [x] Remove undocumented CPU/IOPS/throughput utilization risk bands and derive accepted-candidate risk only from the verified burst, excursion, cross-family, memory-coupling, and tempdb risk evidence.
- [x] Render the collected CPU pressure threshold in the UI instead of retaining the obsolete fixed `80%` label.
- [x] Remove public storage-optimization APIs, contracts, and regression tests from this phase; retain current storage facts only as unchanged context for instance-capability validation.
- [x] Keep storage type, provisioned IOPS/throughput, and allocated storage optional context; missing storage-provisioning facts must not block compute optimization.
- [x] Remove legacy dollar-cost and savings fields from the optimization result contract and harness fixtures.
- [x] Replace arbitrary memory-evidence count thresholds with complete/partial/unavailable classification over the document-required memory signals.
- [x] Preserve measured file-stall latency as raw advisory evidence without undocumented `10/20/50 ms` pass/fail judgments.
- [x] Replace sparse multi-day regression packages with continuous collector-cadence evidence and include Batch Requests/sec.
- [x] Compact Kentra V2 collector collection so Cost Optimization mode no longer creates, populates, or exports legacy SSAT memory/database-I/O staging tables when consolidated workload samples are enabled.
- [x] Add regression coverage for every correction above.
- [x] Update the verified requirements matrix only after production, harness, collector, samples, and tests prove each correction.

## Deferred by the Verified Document

- [x] Keep storage provisioning optimization out of the active workload flow and reports in this phase.
- [x] Do not implement detailed pricing in this phase.
- [x] Do not add gp3/io1/io2 cost selection in this phase.
- [x] Do not add RI/Savings Plans financial recommendations in this phase.
- [x] Do not add automated RDS changes in this phase.

## First Implementation Task

- [x] Complete Task 1, the verified requirements matrix, before changing collector or production code.
