# Kentra CPU, Memory, IOPS, and Throughput Rules

Source: `documentation/Kentra_RDS_SQL_Server_Optimization_Verified_v1_1.docx`

This file includes only rules and formulas stated in the Kentra verified document. If the Kentra document does not give a numeric formula or threshold, this file says so.

## CPU

### Kentra Rules

- SQL process CPU is the primary workload signal for SQL Server licensing and compute-footprint optimization.
- Host/Other CPU is a hard safety gate.
- Same-hardware or same-family size reduction can use sample-level linear projection.
- CPU projections are calculated per sample before calculating P95 or P99.
- Independent CPU percentiles are not summed.
- Normal optimization target: projected CPU P95 up to approximately `65-70%`.
- P99 is a burst/risk gate, not the primary sizing point.
- Current and candidate SQL-visible vCPU must come from RDS SQL Server engine/class/processor configuration.
- Generic RDS or EC2 vCPU values alone are not authoritative.
- For cross-generation or cross-family projections, apply a normalized per-core capacity factor or lower confidence.

### Kentra Formulas

```text
SQLCoreDemand(sample) =
  Current_SQL_visible_vCPU * SQLProcessUtilization(sample) / 100

ProjectedSQLCPU(sample) =
  SQLCoreDemand(sample) / Candidate_SQL_visible_vCPU * 100

ProjectedTotalCPU(sample) =
  [SQLCoreDemand + OtherCoreDemand] / Candidate_SQL_visible_vCPU * 100
```

The Kentra document uses `OtherCoreDemand` in the projected total CPU formula but does not separately define a numeric formula for `OtherCoreDemand`.

### CPU Example

Inputs:

```text
Current_SQL_visible_vCPU = 32
Candidate_SQL_visible_vCPU = 16
SQLProcessUtilization(sample) = 30%
OtherCoreDemand(sample) = 2.4 cores
```

Calculation:

```text
SQLCoreDemand =
  32 * 30 / 100 = 9.6 cores

ProjectedSQLCPU =
  9.6 / 16 * 100 = 60%

ProjectedTotalCPU =
  [9.6 + 2.4] / 16 * 100 = 75%
```

Rule result:

```text
Projected SQL CPU for this sample is 60%.
The normal CPU target in the Kentra document is projected CPU P95 up to approximately 65-70%.
Projected total CPU remains a safety-gate value.
```

### vCPU Metadata Example From Kentra

The Kentra document gives these examples showing why generic vCPU values are not enough:

```text
m7i.4xlarge:
  Generic hardware tables can show 16 vCPU.
  RDS SQL Server Optimize CPU metadata shows default 8 vCPU / 8 cores / 1 thread per core.

m7i.8xlarge:
  Generic hardware tables can show 32 vCPU.
  RDS SQL Server Optimize CPU metadata shows default 16 vCPU / 16 cores / 1 thread per core.

x2m.2xlarge:
  Underlying EC2 type supports more threads.
  RDS SQL Server exposes 4 vCPU by default with hyper-threading disabled.
```

## Memory

### Kentra Rules

- The pressure-based memory model is correct.
- SQL Server buffer pool grows by design.
- Steady-state committed memory commonly approaches the configured limit.
- Committed memory is not equivalent to irreducible RAM demand.
- Committed and target memory are demand/context signals, not a standalone required-RAM formula.
- Memory downsizing can increase physical reads.
- CPU, memory, and I/O cannot be treated as completely independent gates.
- ReadIOPS under load is evidence of whether the working set resides in memory.
- If a candidate materially reduces RAM and evidence cannot demonstrate a stable working set, do not predict exact future IOPS.
- If stable working-set evidence is missing, classify the candidate as `Aggressive/Medium-confidence` or prefer a memory-optimized / Optimize CPU candidate that preserves RAM.

### Kentra Memory Signals

The Kentra document lists these memory signals:

```text
Committed / target memory:
  Demand/context; not a standalone required-RAM formula.

OS available memory low tail:
  External/physical memory pressure.

Memory Grants Pending / Outstanding:
  Direct query-workspace pressure evidence.

Granted Workspace Memory:
  Size of active workspace demand.

PLE overall + per NUMA node:
  Cache churn evidence; node-level values improve overall PLE.

Process physical memory / low flags:
  Process-level pressure beyond SQL memory manager accounting.

Memory clerks / stolen memory:
  Separates less-elastic memory from reclaimable cache.

Buffer Cache Hit Ratio:
  Working-set confidence evidence.

Page Reads/sec:
  Physical read evidence under memory pressure.

Page Writes/sec:
  Page activity evidence.

Lazy Writes/sec:
  Preferred cache-eviction evidence.
```

### Numeric Memory Formula Status

The Kentra document does not define a numeric required-memory formula.

It states:

```text
Use pressure/working-set analysis.
Do not use committed memory alone.
Enforce modest six-month headroom.
```

The Kentra document does not specify the numeric amount of that headroom in the memory section.

### Memory Example

Inputs:

```text
Current memory = 128 GiB
Candidate memory = 64 GiB
Current ReadIOPS = low
Stable working-set evidence = not demonstrated
```

Rule result:

```text
The Kentra document explicitly warns that a 128 -> 64 GiB recommendation can increase physical ReadIOPS even when current ReadIOPS is low.
The result must not claim exact future IOPS.
The result should be Aggressive/Medium-confidence or should prefer a memory-preserving candidate.
```

### Memory-to-I/O Example

Inputs:

```text
Candidate materially reduces RAM.
Buffer Cache Hit Ratio is unavailable.
Page Reads/sec is unavailable.
Page Writes/sec is unavailable.
Lazy Writes/sec is unavailable.
```

Rule result:

```text
Evidence cannot demonstrate a stable working set.
The candidate cannot be treated as a normal safe RAM reduction.
The Kentra document says to classify as Aggressive/Medium-confidence or prefer a candidate that preserves RAM.
```

## IOPS

### Kentra Rules

- `sys.dm_io_virtual_file_stats` is the correct collector source.
- Read/write operation counts are cumulative file-level physical I/O statistics.
- Convert cumulative deltas into rates using actual elapsed time.
- Aggregate all relevant databases within each sample first.
- Calculate P50/P95/P99 over the resulting instance series.
- Never sum independent database P95 values.
- Validate against sustained baseline and burst maximum.
- Do not validate against maximum IOPS alone.
- P95 normal IOPS is compared with candidate sustained/baseline IOPS capability.
- P99 bursts are compared with candidate maximum/burst capability.
- Maximum is context/anomaly evidence.
- Do not reject solely for one isolated maximum sample; inspect duration and frequency.
- The comparison scope is target DB-instance capability, not storage optimization.

### Kentra IOPS Formulas

```text
ReadIOPS =
  delta(num_of_reads) / elapsed_seconds

WriteIOPS =
  delta(num_of_writes) / elapsed_seconds
```

### IOPS Example

One interval:

```text
elapsed_seconds = 60

File A delta(num_of_reads) = 6,000
File A delta(num_of_writes) = 1,200

File B delta(num_of_reads) = 3,000
File B delta(num_of_writes) = 600
```

Per-file calculation:

```text
File A ReadIOPS =
  6,000 / 60 = 100

File A WriteIOPS =
  1,200 / 60 = 20

File B ReadIOPS =
  3,000 / 60 = 50

File B WriteIOPS =
  600 / 60 = 10
```

Aggregate within the sample:

```text
Sample ReadIOPS =
  100 + 50 = 150

Sample WriteIOPS =
  20 + 10 = 30

Sample TotalIOPS =
  150 + 30 = 180
```

Candidate validation example:

```text
Candidate sustained/baseline IOPS = 5,000
Candidate maximum/burst IOPS = 10,000
Observed instance IOPS P95 = 4,200
Observed instance IOPS P99 = 9,000
Observed burst duration/frequency = fits candidate burst behavior
```

Rule result:

```text
P95 normal IOPS fits sustained/baseline capability.
P99 burst IOPS fits maximum/burst capability.
Candidate passes IOPS under the Kentra IOPS rule.
```

Failure example:

```text
Candidate sustained/baseline IOPS = 5,000
Observed instance IOPS P95 = 5,200
```

Rule result:

```text
P95 normal IOPS exceeds sustained/baseline capability.
Candidate fails IOPS even if maximum/burst capability is higher.
```

## Throughput

### Kentra Rules

- Throughput uses the same `sys.dm_io_virtual_file_stats` cumulative physical I/O source.
- Byte counters are cumulative file-level physical I/O statistics.
- Convert cumulative byte deltas into rates using actual elapsed time.
- Aggregate all relevant databases within each sample first.
- Calculate P50/P95/P99 over the resulting instance series.
- Never sum independent database P95 values.
- Validate against sustained baseline and burst maximum.
- Do not validate against maximum throughput alone.
- P95 normal throughput is compared with candidate sustained/baseline throughput or EBS bandwidth.
- P99 bursts are compared with candidate maximum/burst capability.
- Maximum is context/anomaly evidence.
- Do not reject solely for one isolated maximum sample; inspect duration and frequency.
- Throughput must be validated independently from IOPS.

### Kentra Throughput Formulas

```text
ReadMiB/s =
  delta(num_of_bytes_read) / elapsed_seconds / 1,048,576

WriteMiB/s =
  delta(num_of_bytes_written) / elapsed_seconds / 1,048,576
```

### Throughput Example

One interval:

```text
elapsed_seconds = 60

File A delta(num_of_bytes_read) = 125,829,120
File A delta(num_of_bytes_written) = 62,914,560

File B delta(num_of_bytes_read) = 62,914,560
File B delta(num_of_bytes_written) = 31,457,280
```

Per-file calculation:

```text
File A ReadMiB/s =
  125,829,120 / 60 / 1,048,576 = 2.0

File A WriteMiB/s =
  62,914,560 / 60 / 1,048,576 = 1.0

File B ReadMiB/s =
  62,914,560 / 60 / 1,048,576 = 1.0

File B WriteMiB/s =
  31,457,280 / 60 / 1,048,576 = 0.5
```

Aggregate within the sample:

```text
Sample ReadMiB/s =
  2.0 + 1.0 = 3.0

Sample WriteMiB/s =
  1.0 + 0.5 = 1.5

Sample TotalMiB/s =
  3.0 + 1.5 = 4.5
```

Candidate validation example:

```text
Candidate sustained/baseline throughput = 500 MiB/s
Candidate maximum/burst throughput = 1,250 MiB/s
Observed instance throughput P95 = 420 MiB/s
Observed instance throughput P99 = 900 MiB/s
Observed burst duration/frequency = fits candidate burst behavior
```

Rule result:

```text
P95 normal throughput fits sustained/baseline capability.
P99 burst throughput fits maximum/burst capability.
Candidate passes throughput under the Kentra throughput rule.
```

Failure example:

```text
Candidate sustained/baseline throughput = 500 MiB/s
Observed instance throughput P95 = 520 MiB/s
```

Rule result:

```text
P95 normal throughput exceeds sustained/baseline capability.
Candidate fails throughput even if maximum/burst capability is higher.
```

## Shared Rules From Kentra

- Use synchronized per-sample evidence.
- For CPU, calculate projections per sample before P95/P99.
- For IOPS and throughput, aggregate per sample before P50/P95/P99.
- Do not sum independent database P95 values.
- P95 is the normal sizing statistic.
- P99 is the burst/risk statistic.
- Maximum is context/anomaly evidence.
- Baseline and maximum/burst capability must both be validated.
- Storage provisioning and detailed pricing are outside this phase.
