# Kentra RDS for SQL Server Workload Optimization Specification

**Status:** Production workload-fit specification
**Authority:** `documentation/Kentra_RDS_SQL_Server_Optimization_Verified_v1_1.docx`

This file translates the verified document into the standalone product contract. It does not replace the verified document. If wording conflicts, the verified document controls.

## 1. Objective

Determine whether an existing Amazon RDS for SQL Server workload can run on a lower licensed/allocated vCPU configuration for an approximately six-month operating horizon.

CPU creates the optimization opportunity. A recommendation is valid only when CPU, memory, instance IOPS, instance throughput, tempdb placement, SQL Server edition, exact engine version, Region, processor configuration, orderability, and evidence quality support the candidate.

## 2. Scope

In scope:

- Amazon RDS for SQL Server only.
- Default and valid Optimize CPU configurations.
- Same-class, same-family, and cross-family compute candidates.
- SQL and Other CPU projection.
- Memory pressure, less-elastic working-set, and memory-to-I/O analysis.
- Instance IOPS and throughput capability validation.
- Candidate-aware tempdb placement and local-instance-store capacity.
- Enterprise-to-Standard eligibility as a migration recommendation.
- Per-database I/O attribution and advisory database CPU/memory attribution.
- Manual one-server and multi-server collector uploads.
- JSON, CSV, and PDF-style workload evidence exports.

Outside this phase:

- Changing gp3, io1, or io2 storage design.
- Recommending provisioned IOPS, provisioned throughput, or allocated storage.
- Detailed pricing, dollar savings, RI, or Savings Plans calculations.
- Automated changes to customer RDS instances.
- SSATWeb sizing or recommendation logic.

## 3. Customer Flow

1. Download the standalone collector.
2. Select the customer name in `RunMefirst`.
3. Enable Cost Optimization metrics when workload optimization is requested.
4. Supply endpoint, login, password, and existing RDS size to the collector spreadsheet.
5. Run the collector against the live RDS SQL Server instance.
6. Create all output under the selected customer directory.
7. Strip login and password from exported evidence.
8. ZIP the customer directory.
9. Manually upload one or more collector packages.
10. Analyze each server independently, then build an optional fleet summary.
11. Display and export the result, all resource gates, database drivers, and candidate evidence.

The upload analyzer accepts collector evidence only. It does not require side-loaded configuration JSON.

## 4. Collector Contract

The collector must be SQL Server-only, bounded, and low impact. Its workload evidence comes from read-only DMV, catalog, and performance-counter queries. To preserve the approved SSAT collector flow, it may create collector-owned staging tables and a SQL Agent sampling job, and must remove those artifacts after export. It must not modify customer application tables or data. When Cost Optimization is disabled, original collector behavior remains unchanged.

Cost Optimization mode preserves synchronized timestamped evidence for:

- SQL process CPU, system idle, and Other CPU.
- `sys.dm_os_sys_info.cpu_count` as current SQL Server-visible vCPU.
- OS available and total memory.
- SQL committed, target, process physical memory, and low-memory flags.
- Memory Grants Pending and Outstanding.
- Granted Workspace Memory.
- Overall and per-NUMA-node PLE.
- Buffer Cache Hit Ratio as supporting evidence.
- Page Reads/sec, Page Writes/sec, and Lazy Writes/sec.
- Memory clerks and stolen memory.
- Batch Requests/sec when available.
- Cumulative per-file reads, writes, bytes, stalls, database, file, file type, and timestamp.
- User-database and tempdb attribution.
- Representative and peak tempdb allocated size.
- Approved Cost Optimization wait statistics.

The collector must not collect SQL text, plans, Query Store content, traces, table rows, credentials in exported output, or PII.

## 5. Canonical Evidence Model

CPU, memory, user-database I/O, and tempdb I/O are aligned by sample time before candidate calculations.

The normalized model preserves:

- source timestamps
- actual elapsed time between cumulative-counter samples
- missing, duplicate, out-of-order, reset, negative-delta, and invalid-elapsed evidence
- raw synchronized samples needed to reproduce P50, P95, P99, maximum, burst duration, and burst frequency

If any expected file is missing from either side of a cumulative-counter pair, or any file has an invalid/reset/negative interval, the complete synchronized instance interval is rejected. Partial file totals never enter IOPS or throughput percentiles.

## 6. Evidence Window

Duration is calculated from collected timestamps and evaluated with continuity. Workload representativeness is confirmed verbally by the customer; the tool must not claim it can prove business representativeness.

| Window | Classification |
| --- | --- |
| Less than 48 hours | Insufficient for production rightsizing except clearly idle or non-production workloads |
| 48 to less than 72 hours | Below preliminary |
| 3 to 6 days | Preliminary, low-to-medium confidence, and requires explicit representativeness |
| At least 7 days | Minimum recommended production assessment |
| At least 14 days | Preferred default for high-confidence optimization |
| 30 to 32 days | Appropriate when month-end or monthly cycles materially affect workload |

The report states duration, continuity, representativeness status, confidence, and the reason for the classification.

## 7. Candidate Catalog

Candidates must be currently orderable for the resolved Region, SQL Server edition, exact engine version, instance class, and processor configuration.

Catalog evidence includes:

- SQL Server-visible default vCPU.
- Default cores and threads per core.
- Valid Optimize CPU core/thread combinations.
- Per-core capacity factor when authoritative normalization exists.
- Memory.
- sustained/baseline and maximum/burst IOPS capability.
- sustained/baseline and maximum/burst throughput capability.
- local-instance-store support and capacity.
- Multi-AZ capability where relevant.

Catalog data is refreshed from `DescribeOrderableDBInstanceOptions` or an approved equivalent source. SQL Server-visible vCPU, default cores, threads per core, and Optimize CPU configurations must come from AWS SQL Server processor metadata. An exact orderability row that falls back to generic consolidated vCPU metadata is not a candidate. Unavailable combinations cannot become candidates.

## 8. CPU Projection

For each synchronized sample:

```text
SQLCoreDemand =
  Current_SQL_visible_vCPU * SQLProcessUtilization / 100

OtherCoreDemand =
  Current_SQL_visible_vCPU * OtherCPUUtilization / 100

ProjectedSQLCPU =
  SQLCoreDemand / EffectiveCandidateSQLVisibleVCPU * 100

ProjectedTotalCPU =
  (SQLCoreDemand + OtherCoreDemand)
  / EffectiveCandidateSQLVisibleVCPU * 100
```

For cross-family comparisons, `EffectiveCandidateSQLVisibleVCPU` includes an authoritative normalized per-core capacity factor when available. Without authoritative normalization, confidence is lowered.

Percentiles are calculated after sample-by-sample projection. Independent CPU percentiles are never added.

CPU gates:

- Projected SQL CPU P95 must be `<= 70%`.
- Projected SQL CPU P99 must be `<= 90%`.
- Concurrent projected total CPU P99 must be `<= 90%`.
- Samples over 90% are reported as excursions.
- Raw maximum is context, not the sizing percentile.

Same-hardware and same-family comparisons receive the strongest projection confidence.

## 9. Memory Analysis

Committed memory alone is not treated as required RAM. Candidate memory uses concurrent pressure and working-set evidence.

The analysis evaluates:

- OS available-memory low tail.
- SQL physical memory and low-memory flags.
- Memory Grants Pending and Outstanding.
- Granted Workspace Memory.
- Overall and per-NUMA PLE.
- Memory clerks and stolen memory.
- Page Reads/sec, Page Writes/sec, and Lazy Writes/sec.
- Buffer Cache Hit Ratio as supporting evidence only.

The reproducible less-elastic memory floor receives `20%` headroom for the approximately six-month horizon.

A RAM reduction is material when it is at least `25%` or crosses into a lower-memory instance-family tier.

Missing or mixed key memory evidence does not prove a RAM reduction safe. It produces an aggressive/medium-confidence outcome and favors a same-memory lower-vCPU or Optimize CPU candidate.

## 10. Memory-to-I/O Coupling

For a material RAM reduction:

1. Build a memory-pressure score from synchronized pressure evidence.
2. Use the bottom quartile as low pressure and top quartile as high pressure.
3. Exclude the middle 50% from the magnitude comparison.
4. Use physical ReadIOPS calculated from interval deltas.
5. Normalize ReadIOPS by Batch Requests/sec when available.
6. When normalization is unavailable, label the result unnormalized and cap coupling confidence at medium.

Meaningful coupling requires all of:

- Spearman correlation `>= 0.40`.
- Median high-pressure ReadIOPS at least `20%` above low-pressure median.
- Persistence in at least `10%` of valid samples or at least three distinct pressure periods of five consecutive one-minute samples.

A high-pressure increase of at least `40%` is a strong pressure signal favoring preserved RAM.

Correlation without magnitude or persistence is weak evidence and cannot fail RAM reduction by itself. When stable working-set evidence is unavailable, the system must not claim an exact future IOPS prediction.

## 11. IOPS

Per file and interval:

```text
ReadIOPS  = delta(num_of_reads)  / actual_elapsed_seconds
WriteIOPS = delta(num_of_writes) / actual_elapsed_seconds
```

All relevant file and database values are aggregated within each synchronized instance sample before percentiles are calculated.

- P95 represents normal sustained demand and is compared with candidate sustained/baseline capability.
- P99 represents burst demand and is compared with maximum/burst capability.
- Burst capability may be used only when class-specific burst behavior and the observed burst duration/frequency support it.
- Maximum is context and anomaly evidence; one isolated maximum does not fail a candidate by itself.
- Independent database percentiles are never summed.

Read and write evidence remains separately visible in reports.

## 12. Throughput

Per file and interval:

```text
ReadMiB/s =
  delta(num_of_bytes_read) / actual_elapsed_seconds / 1,048,576

WriteMiB/s =
  delta(num_of_bytes_written) / actual_elapsed_seconds / 1,048,576
```

Throughput follows the same aggregate-before-percentile, sustained P95, burst P99, duration, frequency, invalid-interval, and maximum-context rules as IOPS. It is validated independently from IOPS.

## 13. tempdb and Local Instance Storage

Candidate evaluation remaps synchronized tempdb demand before candidate IOPS and throughput percentiles:

| Transition | Normal storage path |
| --- | --- |
| Non-NVMe to Non-NVMe | User/system database plus tempdb demand |
| Non-NVMe to NVMe | Remove time-aligned tempdb demand; validate tempdb separately |
| NVMe to NVMe | Keep tempdb separate and revalidate candidate local capacity |
| NVMe to Non-NVMe | Add time-aligned tempdb demand back |

An NVMe candidate is blocked when representative or peak tempdb allocated size exceeds local-instance-store capacity. Local tempdb I/O intensity is a risk/confidence signal unless an authoritative class-specific performance limit exists.

User database and log files are never treated as local-instance-store files.

## 14. Enterprise-to-Standard

```text
EditionEligible =
  FeatureCompatible
  AND VendorSupported
  AND StandardScaleLimitsFit
  AND RDSClassVersionOrderable
  AND MigrationPathAccepted
```

The evaluation applies SQL Server version-specific socket/core, buffer-pool, columnstore segment-cache, and memory-optimized-data limits. Unknown target socket or core counts cannot pass the scale term. Feature, vendor, scale, orderability, and migration blockers remain separate.

An edition change is reported as a migration recommendation, not an in-place instance resize.

## 15. Decision Outcomes

- `Recommended`: all hard gates pass with sufficient stable evidence.
- `Aggressive Optimization`: a candidate fits hard capacity gates, but material memory reduction or another explicitly supported uncertainty lowers confidence.
- `Not Recommended`: no evaluated candidate passes the required hard gates.

Every evaluated candidate records:

- current and candidate configuration
- decision and confidence
- passed gates
- failed gates
- rejection reasons
- preserved evidence
- all resource assessments

## 16. Limiting Resources and Database Attribution

The result lists all evaluated resource dimensions rather than collapsing them into one primary blocker:

- CPU
- memory
- IOPS
- throughput
- tempdb
- edition
- orderability
- evidence quality

Each assessment states scope, status, observed requirement, candidate capacity when applicable, utilization when applicable, and reason.

The report identifies a top offending database only when collected evidence supports that resource attribution:

- IOPS: highest defensible per-database physical I/O driver.
- Throughput: highest defensible per-database byte-rate driver.
- tempdb: tempdb attribution from synchronized file evidence.
- CPU: advisory only when the collector has approved approximate DB CPU evidence.
- Memory: advisory only when the collector has approved approximate DB memory/buffer evidence.
- Edition: a database may be named when a database-specific feature or scale blocker supplies that evidence.
- Orderability and evidence quality: server-level only; no database is assigned.

Missing database attribution never blocks the server-level resource assessment.

## 17. Reports

Per server, reports include:

- current and candidate class/configuration
- current and candidate SQL Server-visible vCPU
- CPU P95, P99, total CPU, excursions, and comparison confidence
- collection duration, continuity, representativeness, and confidence
- memory pressure, working-set, and coupling evidence
- read/write IOPS and throughput P95/P99
- sustained/baseline and maximum/burst candidate limits
- burst duration and frequency
- current and candidate tempdb placement, remapped demand, and capacity result
- Enterprise-to-Standard eligibility and migration requirement
- all limiting-resource assessments
- top database attribution where defensible
- passed gates, failed gates, and candidate rejection reasons

Fleet output separates Recommended, Aggressive Optimization, and Not Recommended servers without hiding per-server blockers.

## 18. Independent Harness

The harness independently recalculates the verified formulas from preserved raw evidence. It must not call production calculations as its oracle.

The harness is a verification and regression mechanism for production changes. It is not the production recommendation engine and must not choose candidates, provide production formulas at runtime, or replace the optimizer's decision flow.

It independently verifies:

- SQL-visible CPU and Optimize CPU metadata
- CPU sample projections and percentiles
- evidence-window classification
- memory pressure and working-set outcome
- memory-to-I/O coupling
- elapsed-time IOPS and throughput
- sustained and burst capability
- burst duration and frequency
- all four tempdb placement transitions
- local capacity
- Enterprise-to-Standard eligibility
- selected-candidate reproducibility

Any recommendation that cannot be reproduced fails validation.

## 19. Acceptance

The production workload-fit build is accepted when:

- the collector flow works with Cost Optimization disabled and enabled
- one-server and multi-server packages analyze independently
- representative regressions cover every verified formula and decision branch
- all three outcomes are exercised
- all limiting resources are reported
- top database attribution is shown only when supported
- storage provisioning and pricing remain absent from active recommendations
- no SSATWeb files or behavior are changed
