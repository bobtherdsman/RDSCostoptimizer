# Collector → CloudWatch metric availability mapping

Question: if a customer chooses **not** to run the SQL Server in-database collector, can the collector workflow offer a CloudWatch fallback package that obtains equivalent workload metrics from CloudWatch (and related AWS-native sources)?

Short answer: **Partially.** AWS-native sources can reconstruct the *compute-fit basics* (CPU, instance-level IOPS/throughput/latency, coarse memory pressure, and — usefully — a historical evidence window without a fresh collection). They **cannot** reproduce the SQL Server collector's differentiators: **per-database physical I/O attribution, tempdb internals, deep SQL memory internals, the edition feature audit, per-file latency, and exact wait-stat cumulatives**. Several optimizer gates depend on exactly those, so the collector-driven CloudWatch fallback path is a lower-confidence, partial assessment — not a drop-in replacement for SQL Server collector evidence.

## AWS-native sources (legend)
- **CW** — Amazon CloudWatch `AWS/RDS` instance metrics (hypervisor layer, instance-level only).
- **EM** — Enhanced Monitoring (in-guest agent; OS metrics to CloudWatch Logs; down to 1s).
- **PI** — Performance Insights / CloudWatch **Database Insights** (DB load = average active sessions, wait events, top SQL/db/host/user, and **counter metrics** incl. native SQL Server perfmon counters). *Note: the PI console reaches end-of-life 2026‑07‑31 and folds into CloudWatch Database Insights; the PI API is preserved.*
- **API** — RDS control-plane APIs (`DescribeDBInstances`, `describe-orderable-db-instance-options`, `describe-db-engine-versions`). Not CloudWatch, but AWS-native and collector-free.

Confirmed CW `AWS/RDS` metrics used below: `CPUUtilization`, `FreeableMemory`, `FreeStorageSpace`, `ReadIOPS`, `WriteIOPS`, `ReadThroughput`, `WriteThroughput`, `ReadLatency`, `WriteLatency`, `DiskQueueDepth`, `EBSIOBalance%`, `EBSByteBalance%`.

## Mapping table

Coverage: ✅ Full · 🟡 Partial / lower fidelity · ❌ Not available without in‑DB collection.

| Collector field (contracts/types.ts) | AWS-native source | Coverage | Notes |
| --- | --- | --- | --- |
| `cpuPct` distribution (SqlSerCpuUT) | CW `CPUUtilization`; EM cpuUtilization breakdown | 🟡 | CW is **total instance** CPU, not SQL-process-only. EM splits guest/user/system but still not "SQL vs other" the way the collector does. |
| `cpuPressure` (sustained high-CPU streaks) | CW `CPUUtilization` time series | 🟡 | Reconstructable from history; streak logic must be recomputed from raw datapoints. |
| `iops` total (`ReadIOPS`+`WriteIOPS`) | CW `ReadIOPS`,`WriteIOPS` | ✅ | Instance-level physical IOPS — good match for the total-IOPS gate. |
| `throughputMbps` (`ReadThroughput`+`WriteThroughput`) | CW `ReadThroughput`,`WriteThroughput` | ✅ | Instance-level; bytes/s → MiB/s. |
| IOPS/throughput burst evidence | CW `EBSIOBalance%`,`EBSByteBalance%`,`DiskQueueDepth` | 🟡 | Burst-credit balance is a proxy, not the collector's excursion model. |
| `fileLatency` per DB file | CW `ReadLatency`,`WriteLatency` | 🟡 | Only **instance-aggregate** latency; no per-database or per-file breakdown. |
| `physicalIo.databaseSamples` — **per-database** IOPS/throughput | — | ❌ | **Key gap.** CW has no per-database physical I/O. PI slices *logical* DB **load** by database, not physical IOPS/MiBps. |
| `databases[].iopsSharePct / throughputSharePct` (top offender ranking) | PI (DB-load share) | 🟡 | Approximate ranking by DB load/AAS; not physical I/O share. |
| `databases[].sizeGb`, `totalDatabaseSizeGb` | API/CW `FreeStorageSpace` (+ engine queries) | 🟡 | Allocated/free storage from CW/API; per-database size is not a CloudWatch metric. |
| Memory: `pageLifeExpectancySeconds` (PLE) | PI counter `sqlserver Buffer Manager: Page life expectancy` | ✅ | Available as a PI SQL Server counter metric. |
| Memory: `bufferCacheHitRatioPct` | PI counter `Buffer Manager: Buffer cache hit ratio` | ✅ | PI counter. |
| Memory: `memoryGrantsPending/Outstanding` | PI counter `Memory Manager: Memory Grants Pending` | 🟡 | Pending available as counter; some grant fields are collector-only. |
| Memory: `batchRequestsPerSec`, `pageReads/Writes/sec`, `lazyWritesPerSec` | PI counters (`SQL Statistics`, `Buffer Manager`) | 🟡 | Capturable as PI counter metrics if configured. |
| Memory: `osTotalMemoryMb`, `osAvailableMemoryMb` | EM OS memory (free/available/cached) | 🟡 | OS-level memory from EM; `FreeableMemory` (CW) is a coarser proxy. |
| Memory: `sqlCommittedMemoryMb`, `sqlTargetMemoryMb`, `bufferPoolMemoryMb`, `stolenServerMemoryMb`, `columnstoreSegmentCacheMb`, memory clerks | — | ❌ | SQL internal memory breakdown is **not** exposed by CW/EM/PI; requires in-DB DMV queries (collector). Drives the **memory floor** and **Standard-edition buffer-pool/columnstore limits**. |
| `requiredMemoryFloorGb` / memory-coupling analysis | (derived) | ❌ | Depends on the SQL-internal memory fields above; cannot be computed CloudWatch-only at collector fidelity. |
| tempdb: `versionStoreMb`, `allocatedMb`, `userObjectMb`, `internalObjectMb`, peak | — | ❌ | No CW/PI metric for tempdb internals; in-DB only. Drives the **tempdb** gate and NVMe-placement logic. |
| `waitStats` (sys.dm_os_wait_stats cumulative) | PI wait events (AAS-by-wait) | 🟡 | PI gives sampled top waits, not the cumulative wait table the collector reads. |
| Edition feature audit (`persisted_sku_feature`, columnstore/memory-optimized per DB) | — | ❌ | Enterprise→Standard eligibility evidence is **in-DB only** (`sys.dm_db_persisted_sku_features`, etc.). Not in CW/PI/API. |
| `sqlServerEdition`, `sqlServerVersion` | API `DescribeDBInstances` / `describe-db-engine-versions` | ✅ | Collector-free via RDS API. |
| `instanceClass`, `multiAz`, `storageType`, `allocatedStorageGb`, `provisionedIops`, `provisionedThroughputMbps` | API `DescribeDBInstances` | ✅ | Collector-free via RDS API. |
| `sqlServerVisibleVcpu`, sockets/cores/threads, Optimize-CPU config | API (instance metadata) + catalog | 🟡 | Class vCPU/cores from catalog/API; live "SQL-visible vCPU" (collector CPUINFO) is not a CW metric. |
| Orderability (target class/version/region) | API `describe-orderable-db-instance-options` | ✅ | Already API-driven; collector-independent. |
| `evidenceWindow` (duration, continuity) | CW/PI metric history + retention | 🟡 | **Upside:** a history window can be built from existing CloudWatch/PI data *without* a new collection. Continuity/gap detection must be recomputed; retention/granularity limits apply (CW rolls up over time; PI/EM retention configurable). |

## Impact on optimizer gates (CloudWatch-only path)

| Gate / dimension | CloudWatch-only feasibility |
| --- | --- |
| CPU fit | 🟡 Feasible with a caveat: CW CPU is total-instance, not SQL-process-isolated. |
| Total IOPS fit | ✅ Feasible (`ReadIOPS`+`WriteIOPS`). |
| Total throughput fit | ✅ Feasible (`ReadThroughput`+`WriteThroughput`). |
| Memory floor fit | ❌ Not at fidelity — needs SQL internal memory (buffer pool, target/committed, clerks). |
| tempdb placement/capacity | ❌ Not available — tempdb internals are in-DB only. |
| Edition (Enterprise→Standard) | ❌ Feature audit + memory-optimized/columnstore usage are in-DB only. |
| Orderability | ✅ Already API-based. |
| Evidence window / confidence | 🟡 Can be built from history, but continuity fidelity and per-source alignment are reduced. |
| DB-level top-offender / split-merge | ❌/🟡 No per-database physical I/O; only PI logical DB-load approximation. |

## Recommendation
1. **Position CloudWatch as a collector-driven fallback, not a substitute.** It supports a *preliminary compute screen* (CPU + instance IOPS/throughput + config/edition/orderability from the RDS API) and can flag obvious over-/under-provisioning without an in-database SQL Server collection.
2. **Any decision that needs the memory floor, tempdb, edition eligibility, or DB-level attribution must remain collector-gated** and should return `insufficient evidence` on the CloudWatch-only path rather than a downsize decision.
3. **Prerequisites for even the partial path:** Performance Insights/Database Insights **and** Enhanced Monitoring enabled with adequate retention, plus IAM read access to CloudWatch, PI API, and RDS Describe APIs. Standard CW metrics are 1-min (60s) and roll up over time; sub-minute needs PI/EM.
4. **Data-freshness note:** the PI console EOLs 2026‑07‑31 (folds into CloudWatch Database Insights); build any integration against the **PI API / Database Insights**, not the console.

## Approved CloudWatch-only caution

CloudWatch-only findings must carry this customer-facing caution until collector
evidence is also provided:

> CloudWatch-only evidence does not include collector-only SQL Server details
> such as per-file DMV counters, full tempdb internals, SQL Server feature audit,
> and exact per-database physical I/O attribution. Treat this result as a
> lower-confidence assessment unless collector evidence is later provided.

Approved CloudWatch-only outcome labels:

- `CloudWatch optimized`
- `CloudWatch validation required`
- `CloudWatch as is`
- `Insufficient CloudWatch evidence`

These labels do not authorize production upload parsing or assessment behavior
until the corresponding `CW-*` rules move from `expected-gap` to `enforced`.

## Verification basis
- Collector field inventory: `src/contracts/types.ts` (`WorkloadProfile`, `MemoryEvidence`, `PhysicalIoEvidence`, `TempdbUsageEvidence`, `EditionWorkloadEvidence`, `EvidenceWindowAssessment`), `src/parser/index.ts`.
- CloudWatch/PI/EM availability: AWS RDS CloudWatch metrics, Enhanced Monitoring OS metrics, and Performance Insights counter-metric documentation (see AWS RDS User Guide: `rds-metrics`, `USER_Monitoring-Available-OS-Metrics`, `USER_PerfInsights_Counters`, and the RDS SQL Server troubleshooting guidance citing Buffer Manager PLE / buffer cache counters).
