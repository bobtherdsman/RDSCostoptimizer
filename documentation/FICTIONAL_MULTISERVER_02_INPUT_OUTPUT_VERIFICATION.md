# Fictional Multi-Server 02 Input/Output Verification

Fixture:

`collector\ketnra v2\multiserver-fixtures\fictional-multiserver-02.zip`

Generated from a read-only audit of the raw fixture ZIP plus the app analysis output on 2026-09-02.

## Fleet Output

| Field | Value |
| --- | --- |
| Total servers | 2 |
| Optimized servers | 1 |
| Stay as-is servers | 1 |
| Aggressive optimization servers | 0 |
| Pricing | Deferred |

## Server 1: fictional-01-safe-downsize

Full name:

`fictional-01-safe-downsize.abc123.us-east-1.rds.amazonaws.com`

### Raw Input

| Input field | Raw value |
| --- | --- |
| Manifest RDSSize | `db.r8i.16xlarge` |
| Storage type | `gp3` |
| Provisioned IOPS | `32000` |
| Provisioned throughput | `1000 Mbps` |
| Allocated storage | `2048 GB` |
| Multi-AZ | `false` |
| SQL edition | `Standard Edition (64-bit)` |
| SQL version | `16.00.4125.3` |
| Logical CPU count | `32` |
| Physical CPU count | `16` |
| CPU samples | `10081` |
| Evidence window | `2026-09-01T05:00:00.000Z` to `2026-09-08T05:00:00.000Z` |
| Duration | `168 hours` |
| CPU P95 / P99 / max | `18% / 18% / 18%` |
| File I/O raw rows | `30243` |
| File I/O intervals | `10080` |
| Physical IOPS P95 / P99 | `11000 / 11000` |
| Physical throughput P95 / P99 | `270 / 270 MiB/s` |
| Database sizes | `orders=900 GB`, `reporting=450 GB`, `tempdb=128 GB` |

### Output

| Output field | Value |
| --- | --- |
| UI action | `Scaled Down to db.r8i.12xlarge` |
| UI current -> target | `db.r8i.16xlarge -> db.r8i.12xlarge` |
| Report status | `recommended` |
| Selected instance | `db.r8i.12xlarge` |
| Confidence | `medium` |
| Top driver | `orders (iops, throughput, size)` |
| UI reason | `Current CPU state is underutilized.` |

### Output Checks

| Check | Observed | Limit/capacity | Status |
| --- | ---: | ---: | --- |
| Projected SQL CPU P95 | `64%` | `70%` | Fits |
| Projected SQL CPU P99 | `64%` | `90%` | Fits |
| Projected total CPU P99 | `81.78%` | `90%` | Fits |
| Memory floor | `232.25 GB` | `384 GB` | Fits |
| Physical IOPS P95/P99 | `11000 / 11000` | `60000 / 60000` | Fits |
| Physical throughput P95/P99 | `270 / 270 MiB/s` | `1875 / 1875 MiB/s` | Fits |
| Evidence window | `7 collected days, complete` | Minimum production assessment window | Fits |

### Top Database Drivers

| Database | Drivers | IOPS P95 | Throughput P95 | Size |
| --- | --- | ---: | ---: | ---: |
| `orders` | iops, throughput, size | `6582.4` | `161.57 MiB/s` | `900 GB` |
| `reporting` | iops, throughput, size | `3097.6` | `76.03 MiB/s` | `450 GB` |
| `tempdb` | iops, throughput, tempdb, size | `1320` | `32.4 MiB/s` | `128 GB` |

### Harness Result

The independent harness passed the selected result. Important passing checks include:

- `CO-J-INDEPENDENT-SIZING`
- `CO-L-CPU-STATE-CLASSIFICATION`
- `CO-A-ORDERABLE-CATALOG`
- `CO-A-ORDERABLE-CONSTRAINTS`
- `CO-I-CPU-FIT`
- `CO-I-MEMORY-FIT`
- `CO-I-IOPS-FIT`
- `CO-I-THROUGHPUT-FIT`
- `CO-RULE-REPRODUCIBLE-RECOMMENDATION`

## Server 2: fictional-02-iops-blocked

Full name:

`fictional-02-iops-blocked.abc123.us-east-1.rds.amazonaws.com`

### Raw Input

| Input field | Raw value |
| --- | --- |
| Manifest RDSSize | `db.r8i.16xlarge` |
| Storage type | `gp3` |
| Provisioned IOPS | `64000` |
| Provisioned throughput | `1500 Mbps` |
| Allocated storage | `2048 GB` |
| Multi-AZ | `false` |
| SQL edition | `Standard Edition (64-bit)` |
| SQL version | `16.00.4125.3` |
| Logical CPU count | `32` |
| Physical CPU count | `16` |
| CPU samples | `10081` |
| Evidence window | `2026-09-01T05:00:00.000Z` to `2026-09-08T05:00:00.000Z` |
| Duration | `168 hours` |
| CPU P95 / P99 / max | `19% / 19% / 19%` |
| File I/O raw rows | `30243` |
| File I/O intervals | `10080` |
| Physical IOPS P95 / P99 | `50000 / 50000` |
| Physical throughput P95 / P99 | `740 / 740 MiB/s` |
| Database sizes | `orders=900 GB`, `reporting=450 GB`, `tempdb=128 GB` |

### Output

| Output field | Value |
| --- | --- |
| UI action | `Stay As Is` |
| UI current -> target | `Keep db.r8i.16xlarge` |
| Report status | `not_recommended` |
| Selected instance | `db.r8i.16xlarge` |
| Confidence | `medium` |
| Top driver | `orders (iops, throughput, size)` |
| UI reason | `IOPS: CPU projection does not fit one or more lower candidates. Observed physical IOPS demand does not fit one or more lower candidates.` |

### Output Checks

| Check | Observed | Limit/capacity | Status |
| --- | ---: | ---: | --- |
| Physical IOPS P95 | `50000` | Lower candidate effective IOPS gate fails | Blocking |
| Projected CPU | `76%` | `70%` | Blocking |
| Memory floor | `226.39 GB` | `192 GB` lower-memory candidate | Blocking |
| Evidence window | `7 collected days, complete` | Minimum production assessment window | Fits |

### Blockers

| Code | Dimension | Message |
| --- | --- | --- |
| `IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED` | iops | CPU projection does not fit one or more lower candidates. Observed physical IOPS demand does not fit one or more lower candidates. |
| `IOPS_BURST_BEHAVIOR_UNKNOWN` | iops | CPU projection does not fit one or more lower candidates. Observed physical IOPS demand does not fit one or more lower candidates. |
| `CPU_P95_TARGET_EXCEEDED` | cpu | CPU projection does not fit one or more lower candidates. |
| `TOTAL_CPU_P99_HARD_GATE_EXCEEDED` | cpu | CPU projection does not fit one or more lower candidates. |
| `CPU_P99_BURST_LIMIT_EXCEEDED` | cpu | CPU projection does not fit one or more lower candidates. |
| `MEMORY_LESS_ELASTIC_FLOOR_UNDERFIT` | memory | CPU projection does not fit one or more lower candidates. Memory evidence does not fit one or more lower candidates. |
| `IOPS_P99_EFFECTIVE_CAPABILITY_EXCEEDED` | iops | CPU projection does not fit one or more lower candidates. Observed physical IOPS demand does not fit one or more lower candidates. |

### Top Database Drivers

| Database | Drivers | IOPS P95 | Throughput P95 | Size |
| --- | --- | ---: | ---: | ---: |
| `orders` | iops, throughput, size | `29240` | `432.75 MiB/s` | `900 GB` |
| `reporting` | iops, throughput, size | `13760` | `203.65 MiB/s` | `450 GB` |
| `tempdb` | iops, throughput, tempdb, size | `7000` | `103.6 MiB/s` | `128 GB` |

### Harness Result

The independent harness passed the blocked result. Important passing checks include:

- `CO-J-INDEPENDENT-SIZING`
- `CO-L-CPU-STATE-CLASSIFICATION`
- `CO-H-BLOCKED-RESULT-HAS-BLOCKERS`

## Verification Conclusion

The raw input and the output agree:

- Both servers are correctly read as `db.r8i.16xlarge` with `32` logical CPUs.
- Both evidence windows are correctly read as complete 7-day windows.
- Raw CPU P95 values match the output classification.
- Independently calculated physical IOPS and throughput percentiles match the report values.
- `orders` is correctly surfaced as the top database driver for both servers.
- The first server's optimized outcome is supported by passing CPU, memory, IOPS, throughput, orderability, evidence, and harness checks.
- The second server's stay-as-is outcome is supported by IOPS, CPU, and memory blockers.

One provenance note: the current `db.r8i.16xlarge` value comes from the collector manifest and CPUINFO evidence. The selected lower candidate is checked against the candidate catalog.
