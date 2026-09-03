# Customer-Run AWS CLI CloudWatch Evidence Runbook (Task 27)

Purpose: define the collector-driven CloudWatch fallback mode. The customer still starts from the collector package/workflow, but chooses the **read-only AWS CLI evidence** path when they cannot run the SQL Server collector. That mode gathers AWS-native workload evidence, saves the outputs to files, ZIPs them, and uploads the ZIP to the tool — the same "package and upload" shape as the collector. **We never extract from the customer's AWS account.** The tool only consumes the uploaded ZIP.

> Status: design + command templates. No parsing/production code exists yet; adding it is gated by future `CW-*` rules and tests (see Task 27).

> Integration gate: this CLI package must be tested before it is wired into the
> collector workflow, upload parser, or production assessment behavior. The
> minimum test gates are PowerShell syntax, `RunMe.bat` launcher path, read-only
> AWS command inventory, generated ZIP/manifest layout, no credentials in
> output, and at least one dry-run or fixture-driven package validation.

---

## 0. Who does what (flow)

**Supported environment: Windows (PowerShell), matching the existing collector.** This is a collector-delivered fallback mode, not a separate tool or separate product workflow. The delivered artifact is a one-click package:
`documentation/cloudwatch-cli/` → `RunMe.bat` (double-click) which runs `collect-cloudwatch-evidence.ps1`. AWS CLI v2 for Windows is required. (A Linux/CloudShell bash variant is out of scope for now.)

**Fleet-wide, no input needed.** The script auto-discovers **every RDS SQL Server instance across all enabled regions** (engines `sqlserver-ee/-se/-ex/-web`) and packages them into one ZIP. Optional flags: `-Days 30` (window), `-Regions us-east-1,us-west-2` (limit scope), `-AwsProfile name`.

1. **We provide** the normal collector package/workflow with this CloudWatch fallback package included or linked from it.
2. **The customer (read-only access)** selects the CloudWatch fallback path from the collector workflow and double-clicks `RunMe.bat` on a Windows host with AWS CLI v2 configured. No DB id/region prompt — it scans the whole account.
3. The script writes **only non-secret JSON** per instance under `<region>/<db-id>/`.
4. The script **zips everything** automatically into one fleet package.
5. The customer uploads the ZIP; we return per-server **CloudWatch-tier** results (lower confidence than the collector; see §8).

Credentials are never written into the package. Outputs are metric values and instance metadata only.

> The AWS CLI command snippets below are the reference for what the one-click script runs; the customer does not run them by hand on the supported Windows path.

---

## 1. Prerequisites & least-privilege IAM

- AWS CLI v2 for Windows, configured (`aws configure`) with a read-only identity. No DB id/region needed — the script scans the account.
- A read-only identity (account-wide read across regions):
  - `ec2:DescribeRegions` (region discovery)
  - `rds:DescribeDBInstances`, `rds:DescribeOrderableDBInstanceOptions`, `rds:DescribeDBEngineVersions`
  - `cloudwatch:GetMetricData`, `cloudwatch:GetMetricStatistics`, `cloudwatch:ListMetrics`
  - `logs:GetLogEvents`, `logs:DescribeLogStreams` (Enhanced Monitoring `RDSOSMetrics`) — only where enabled
  - `pi:GetResourceMetrics`, `pi:ListAvailableResourceMetrics` (Performance Insights) — only where enabled

---

## 2. Set variables (edit these)

```bash
# --- edit these ---
export DBID="prod-sqlserver-01"          # RDS DB instance identifier
export REGION="us-east-1"
export DAYS=14                            # collection window (14+ preferred)
# --- derived ---
export END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export START=$(date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%SZ)   # macOS: date -u -v-${DAYS}d ...
export PERIOD=300                         # seconds; 300s keeps datapoints within limits
export OUT="cw-evidence_${DBID}"
mkdir -p "$OUT"
```

PowerShell equivalent:
```powershell
$DBID="prod-sqlserver-01"; $REGION="us-east-1"; $DAYS=14
$END=(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$START=(Get-Date).ToUniversalTime().AddDays(-$DAYS).ToString("yyyy-MM-ddTHH:mm:ssZ")
$PERIOD=300; $OUT="cw-evidence_$DBID"; New-Item -ItemType Directory -Force $OUT | Out-Null
```

All times are **UTC** (CloudWatch is UTC).

---

## 3. Instance metadata + storage/config facts  → `01_instance.json`

Covers: instance class, edition, engine version, license, Multi-AZ, storage type, allocated GiB, provisioned IOPS/throughput, PI/Enhanced Monitoring status, and `DbiResourceId` (needed for PI/EM).

```bash
aws rds describe-db-instances --db-instance-identifier "$DBID" --region "$REGION" \
  --output json > "$OUT/01_instance.json"

# Capture the PI/EM resource id for later steps:
export RESID=$(aws rds describe-db-instances --db-instance-identifier "$DBID" --region "$REGION" \
  --query "DBInstances[0].DbiResourceId" --output text)
```

Optional orderability facts (target class/version availability):
```bash
aws rds describe-orderable-db-instance-options --engine sqlserver-se --region "$REGION" \
  --output json > "$OUT/01_orderable_se.json"   # repeat for sqlserver-ee if Enterprise
```

---

## 4. CloudWatch core metrics  → `02_cloudwatch.json`

Metrics pulled (namespace `AWS/RDS`, dimension `DBInstanceIdentifier=$DBID`), each with Average / Maximum / p95 / p99:

`CPUUtilization`, `FreeableMemory`, `FreeStorageSpace`, `ReadIOPS`, `WriteIOPS`, `ReadThroughput`, `WriteThroughput`, `ReadLatency`, `WriteLatency`, `DiskQueueDepth`, `EBSIOBalance%`, `EBSByteBalance%`.

Use **`get-metric-data`** (batches all metrics, paginates for long windows). Build the query file:

```bash
cat > "$OUT/_mdq.json" <<'JSON'
[
 {"Id":"cpu_avg","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"CPUUtilization","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"Average"}},
 {"Id":"cpu_p95","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"CPUUtilization","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"p95"}},
 {"Id":"cpu_p99","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"CPUUtilization","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"p99"}},
 {"Id":"read_iops_avg","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"ReadIOPS","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"Average"}},
 {"Id":"read_iops_p95","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"ReadIOPS","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"p95"}},
 {"Id":"write_iops_avg","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"WriteIOPS","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"Average"}},
 {"Id":"write_iops_p95","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"WriteIOPS","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"p95"}},
 {"Id":"read_tput_avg","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"ReadThroughput","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"Average"}},
 {"Id":"write_tput_avg","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"WriteThroughput","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"Average"}},
 {"Id":"read_lat_p95","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"ReadLatency","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"p95"}},
 {"Id":"write_lat_p95","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"WriteLatency","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"p95"}},
 {"Id":"free_mem_min","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"FreeableMemory","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"Minimum"}},
 {"Id":"free_storage_min","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"FreeStorageSpace","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"Minimum"}},
 {"Id":"queue_p95","MetricStat":{"Metric":{"Namespace":"AWS/RDS","MetricName":"DiskQueueDepth","Dimensions":[{"Name":"DBInstanceIdentifier","Value":"__DBID__"}]},"Period":__P__,"Stat":"p95"}}
]
JSON
sed -i "s/__DBID__/$DBID/g; s/__P__/$PERIOD/g" "$OUT/_mdq.json"

aws cloudwatch get-metric-data --region "$REGION" \
  --metric-data-queries file://"$OUT/_mdq.json" \
  --start-time "$START" --end-time "$END" \
  --output json > "$OUT/02_cloudwatch.json"
# For windows longer than ~1 call, follow NextToken and append pages.
```

Simple per-metric alternative (note the 1440-datapoint-per-call limit → keep `PERIOD` coarse or chunk by day):
```bash
aws cloudwatch get-metric-statistics --region "$REGION" --namespace AWS/RDS \
  --metric-name CPUUtilization --dimensions Name=DBInstanceIdentifier,Value="$DBID" \
  --start-time "$START" --end-time "$END" --period "$PERIOD" \
  --statistics Average Maximum --extended-statistics p95 p99 \
  --output json > "$OUT/02_cpu.json"
```

---

## 5. Enhanced Monitoring (optional)  → `03_enhanced_os.json`

Only if Enhanced Monitoring is on (`01_instance.json` → `MonitoringInterval > 0`). OS CPU/memory/disk/process metrics are delivered to CloudWatch Logs group `RDSOSMetrics`, stream = `DbiResourceId`.

```bash
aws logs get-log-events --region "$REGION" \
  --log-group-name RDSOSMetrics --log-stream-name "$RESID" \
  --start-time $(($(date -u -d "$START" +%s)*1000)) \
  --end-time   $(($(date -u -d "$END"   +%s)*1000)) \
  --output json > "$OUT/03_enhanced_os.json"
```

---

## 6. Performance Insights (optional)  → `04_pi_available.json`, `04_pi_metrics.json`

Only if PI is on (`01_instance.json` → `PerformanceInsightsEnabled = true`). First **discover** the available counter names (they vary by engine/version), then pull them — this avoids hard-coding counter IDs.

```bash
# 1) discover counters (os.* and db.* incl. SQL Server counters)
aws pi list-available-resource-metrics --region "$REGION" \
  --service-type RDS --identifier "$RESID" --metric-types os db \
  --output json > "$OUT/04_pi_available.json"

# 2) pull DB load + chosen counters. Build queries from the discovered names,
#    e.g. db.load.avg plus SQL Server counters for PLE / buffer cache / memory grants / batch req.
cat > "$OUT/_piq.json" <<'JSON'
[
 {"Metric":"db.load.avg","GroupBy":{"Group":"db.wait_event","Limit":10}}
]
JSON
aws pi get-resource-metrics --region "$REGION" \
  --service-type RDS --identifier "$RESID" \
  --metric-queries file://"$OUT/_piq.json" \
  --start-time "$START" --end-time "$END" --period-in-seconds "$PERIOD" \
  --output json > "$OUT/04_pi_metrics.json"
# Add one query object per counter name found in 04_pi_available.json
# (e.g. Page life expectancy, Buffer cache hit ratio, Memory Grants Pending, Batch Requests/sec).
```

---

## 7. Package layout + manifest  → ZIP

Folder to zip (one package for the whole fleet):
```
cw-evidence_fleet_<stamp>/
  manifest.json                       # fleet manifest: window + instances[]
  <region>/<db-id>/
    01_instance.json
    02_cloudwatch.json
    03_enhanced_os.json               (optional, if EM enabled)
    04_pi_available.json              (optional, if PI enabled)
    04_pi_metrics.json                (optional, if PI enabled)
  <region>/<db-id>/ ...               # one folder per discovered SQL Server instance
```

`manifest.json` (fleet) lists the collection window and every instance found:
```json
{
  "packageType": "cloudwatch-cli-evidence-fleet",
  "commandVersion": "1.1.0",
  "collectionStartUtc": "2026-08-20T00:00:00Z",
  "collectionEndUtc": "2026-09-03T00:00:00Z",
  "metricPeriodSeconds": 60,
  "timezone": "UTC",
  "regionsScanned": ["us-east-1","us-west-2","eu-west-1"],
  "instanceCount": 3,
  "instances": [
    {"dbInstanceIdentifier":"prod-sql-01","region":"us-east-1","engine":"sqlserver-se","dbiResourceId":"db-ABC...","enhancedMonitoring":true,"performanceInsights":false}
  ]
}
```

The script zips automatically (`Compress-Archive`); no manual zip step is required.

---

## 8. Confidence tiers (what the uploaded package can support)

| Tier | Sources present | Supported (preliminary) | Always insufficient without collector |
| --- | --- | --- | --- |
| **CW-basic** | CloudWatch only | CPU screen, total IOPS/throughput fit, instance latency, storage headroom, config/edition/orderability (API) | memory floor, tempdb, edition audit, per-DB attribution |
| **CW+EM** | + Enhanced Monitoring | above + OS memory/CPU breakdown | same gaps |
| **CW+PI** | + Performance Insights | above + PLE / buffer cache / memory-grants / batch-req counters, DB-load waits, logical top-DB ranking | tempdb internals, edition feature audit, exact per-DB physical I/O |
| **CW+EM+PI** | both | highest CloudWatch-tier confidence | still below collector for memory floor, tempdb, edition |

Approved CloudWatch-tier outcome labels:

- `CloudWatch optimized`
- `CloudWatch validation required`
- `CloudWatch as is`
- `Insufficient CloudWatch evidence`

Every CloudWatch-tier result must include this caution until collector evidence is
also provided:

> CloudWatch-only evidence does not include collector-only SQL Server details
> such as per-file DMV counters, full tempdb internals, SQL Server feature audit,
> and exact per-database physical I/O attribution. Treat this result as a
> lower-confidence assessment unless collector evidence is later provided.

Any decision that needs collector-only evidence must remain marked as
`Insufficient CloudWatch evidence`.

---

## 9. Safety / redaction
- Outputs are metric values + instance metadata; **no credentials** are written.
- Account IDs/ARNs in `01_instance.json` may be redacted before upload.
- Read-only IAM only; no `modify-*` calls anywhere in this pack.

## 10. Field coverage
See `documentation/CLOUDWATCH_METRIC_MAPPING.md` for the collector-field → CloudWatch/EM/PI mapping and the gate-by-gate feasibility that these commands feed.
