# Kentra V2 Collector

This folder contains the local PowerShell collector package for the standalone RDS Cost Optimization project.

## Baseline

`ssatweb-v2-baseline/` is copied from:

`C:\Users\bacrifai\Downloads\Projects\rdstools-web\public\collectorv2`

Do not edit the SSATWeb source collector for this project.

## Cost Optimization Package

`costoptimization/` is the editable standalone collector package for this project. It keeps the original collector behavior as the default and adds an explicit RunMefirst checkbox:

`Enable Cost Optimization diagnostics`

Default OFF:
- original collector metrics only
- original collection/export behavior preserved

When ON:
- passes `-costoptimization` through the local launcher and collector
- collects verified per-minute memory pressure/cache, cumulative per-file I/O, and tempdb allocation evidence in one consolidated collector-owned table, `dbo.CO_WorkloadSamples`
- keeps the legacy SSAT memory and database-I/O staging path disabled for that run; `SQL_MemCollection`, `SQL_DBIOTotal`, and `SQL_DBIO` are not created, populated, or exported in Cost Optimization mode
- still collects `SQL_CPUCollection` because SQL process CPU, system idle, and Other CPU remain required synchronized evidence
- adds the bounded SQL-only Enterprise-to-Standard feature audit export
- does not collect SQL text, query plans, Query Store data, Extended Events, table row data, stored procedure text, passwords, or PII

The workload evidence queries are read-only. As in the approved SSAT collector flow, execution creates only the collector-owned staging artifacts needed for the selected mode plus the `SQL_IOCollection` SQL Agent sampling job, exports the evidence, and removes those artifacts during cleanup. It does not write to customer application tables or data.

Per-minute opt-in CSV:
- `CO_WORKLOAD_SAMPLES`

Extra opt-in CSV:
- `CO_EDITION_COMPATIBILITY`

The consolidated per-minute evidence preserves exact timestamps and cumulative
file counters so the analyzer can calculate actual elapsed intervals. DB-level
memory attribution is not collected by default because low-impact, reliable
per-database memory attribution is not guaranteed without heavier DMV scans.
## Collector Spreadsheet Input

The collector spreadsheet/CSV remains the operator input for connection details. For this project each row should include:

- `ServerName`: RDS SQL Server endpoint.
- `Login`, `Password`, `Database`: collector connection fields. Password is used only for collection and must not be stored in normalized reports.
- `RDSSize`: current RDS DB instance class, for example `db.r8i.4xlarge`.
- `VendorSupportsStandardEdition`, `MigrationPathAccepted`, and `MigrationPath`: optional customer confirmations used only when evaluating an Enterprise-to-Standard migration. `MigrationPath` must be `native_backup_restore` or `aws_dms`.

CPU, memory, I/O, feature, and scale facts must come from collector output. The optional Standard Edition fields above are confirmations, not workload metrics. If a required collector fact is absent, the analyzer reports it as missing instead of accepting a website-side replacement.
