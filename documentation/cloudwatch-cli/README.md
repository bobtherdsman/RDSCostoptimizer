# RDS SQL Server — CloudWatch Fleet Evidence Collector (read-only)

A one-click, **read-only** helper for customers who prefer **not** to run the full SQL Server collector. It auto-discovers every Amazon RDS **SQL Server** instance across all enabled regions, pulls CloudWatch (and, where enabled, Enhanced Monitoring and Performance Insights) evidence, and packages it into a single **ZIP** to upload to the RDS SQL Server Cost Optimization assessment.

> Windows only for now. It makes **no changes** to any database or AWS resource — only `Describe*` / metric-read calls. No credentials are written into the ZIP.

## Contents
| File | Purpose |
| --- | --- |
| `RunMe.bat` | One-click launcher (double-click). |
| `collect-cloudwatch-evidence.ps1` | The collector script it runs. |

Keep both files together in the same folder.

---

## 1. Prerequisites
1. **Windows** with **AWS CLI v2** installed — https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
   Verify: open PowerShell and run `aws --version` (expect `aws-cli/2.x`).
2. **Configured credentials** for the target AWS account, read-only is enough:
   ```powershell
   aws configure          # enter Access Key, Secret, default region, output=json
   ```
   Or use SSO: `aws configure sso` then run the collector with `-AwsProfile <name>`.
3. **IAM permissions** — attach the least-privilege policy in §4 to the identity you configured. It must allow **account-wide, cross-region read** so discovery works.
4. Network access to AWS API endpoints (standard outbound HTTPS).

---

## 2. How to run

**One click:** double-click **`RunMe.bat`**. No input is required — it scans the whole account and builds the ZIP.

**PowerShell (equivalent), with options:**
```powershell
powershell -ExecutionPolicy Bypass -File .\collect-cloudwatch-evidence.ps1
# options:
#   -Days 30                         collection window (default 14)
#   -Regions us-east-1,us-west-2     limit to specific regions (default: all enabled)
#   -AwsProfile myprofile            use a named AWS CLI/SSO profile
```

When it finishes it prints, e.g.:
```
>> Done. Found 3 SQL Server instance(s). Upload: cw-evidence_fleet_20260903_124500.zip
```
Upload that ZIP on the assessment page.

---

## 3. How it works
1. **Region discovery** — `ec2 describe-regions` lists all enabled regions (falls back to a built-in list if that call is denied).
2. **Instance discovery** — in each region, `rds describe-db-instances --filters engine=sqlserver-ee,sqlserver-se,sqlserver-ex,sqlserver-web` finds SQL Server instances.
3. **It writes the evidence in the EXACT collector file format** (same filenames and column names the tool already parses), populated **only from real AWS data**:
   - `collector_run_manifest.csv` — one row per instance: RDSSize, StorageType, ProvisionedIops, ProvisionedThroughputMbps, AllocatedStorageGb, MultiAz (from `describe-db-instances`).
   - `<endpoint>_CPUINFO.csv` — SQL Edition, SQL Version (RDS API); **Logical CPU Count** from Enhanced Monitoring `numVCPUs` (blank if EM is off).
   - `<endpoint>_00_CPU.csv` — `SqlSerCpuUT` = instance `CPUUtilization` (CloudWatch); `OtherProCpuUT` left **blank** (CloudWatch does not split SQL vs non-SQL CPU).
   - `<endpoint>_CO_WORKLOAD_SAMPLES.csv` — `memory` rows (OS memory from CloudWatch FreeableMemory + Enhanced Monitoring); `file_io` rows = instance-level Read/Write IOPS & throughput (CloudWatch) integrated into cumulative counters, labelled `(instance-total)`.
   - `<endpoint>_STORAGE.csv` — instance-total allocated storage (no per-database size available).
   - `_COLLECTION_NOTES.txt` — states every column left blank and why.
4. **Packaging** — files are written flat (collector layout) and zipped automatically.

All timestamps are **UTC**. Default window is 14 days; metric period 300s.

Output layout:
```
cw-collector_<stamp>/
  collector_run_manifest.csv
  <endpoint>_00_CPU.csv
  <endpoint>_CPUINFO.csv
  <endpoint>_CO_WORKLOAD_SAMPLES.csv
  <endpoint>_STORAGE.csv
  _COLLECTION_NOTES.txt
```

> The tool performs all assessment. Because `OtherProCpuUT`, per-database I/O, and SQL memory internals are not collected by CloudWatch (left blank, not fabricated), the tool will report reduced or incomplete assessments (e.g., it may require the SQL/other CPU split before projecting CPU) rather than an over-confident recommendation.

---

## 4. Least-privilege IAM policy
Attach to the read-only identity used to run the collector:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchEvidenceReadOnly",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeRegions",
        "rds:DescribeDBInstances",
        "rds:DescribeOrderableDBInstanceOptions",
        "rds:DescribeDBEngineVersions",
        "cloudwatch:GetMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics",
        "logs:GetLogEvents",
        "logs:DescribeLogStreams",
        "pi:GetResourceMetrics",
        "pi:ListAvailableResourceMetrics"
      ],
      "Resource": "*"
    }
  ]
}
```
`Resource: "*"` is required because discovery spans all regions/instances; every action above is read-only.

---

## 5. Confidence & limitations
A CloudWatch-only package is a **preliminary** screen, not a replacement for the collector.

| Sources present | Tier | Notes |
| --- | --- | --- |
| CloudWatch only | CW-basic | CPU, instance IOPS/throughput/latency, storage, config/edition/orderability |
| + Enhanced Monitoring | CW+EM | adds OS memory/CPU breakdown |
| + Performance Insights | CW+PI | adds PLE / buffer cache / memory-grants / DB-load waits |
| + both | CW+EM+PI | highest CloudWatch tier |

**Not available from CloudWatch (collector-only):** per-database physical I/O attribution, tempdb internals (version store/allocation), SQL memory internals (buffer pool / working-set / memory floor), the edition feature audit, and per-file latency. Decisions that depend on these are reported as **insufficient** on the CloudWatch path.
See `../CLOUDWATCH_METRIC_MAPPING.md` (field mapping + gaps) and `../CLOUDWATCH_CLI_EVIDENCE_RUNBOOK.md` (command reference).

---

## 6. Safety
- Read-only: no `modify-*`, `create-*`, or `delete-*` calls anywhere.
- No credentials are written into the ZIP — only metric values and instance metadata.
- You may redact account IDs / ARNs in `01_instance.json` before uploading.
