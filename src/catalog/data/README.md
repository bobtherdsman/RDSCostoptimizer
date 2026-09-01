# Catalog Data

`aws-instances-consolidated.json` is a local copy from SSATWeb:

`C:\Users\bacrifai\Downloads\Projects\rdstools-web\aws-instances-consolidated.json`

Copy date: 2026-08-28.

Do not modify SSATWeb for this project. Refresh this file by copying from SSATWeb or replacing it with an independently generated catalog in this standalone project.

`fixture-catalog.json` is a small deterministic catalog used by tests.

## Exact RDS SQL Server Orderability

`rds-sqlserver-orderable.json` is generated from the AWS
`DescribeOrderableDBInstanceOptions` API and enriched with:

- the standalone consolidated hardware catalog for memory and
  sustained/maximum IOPS and throughput
- `sqlserver-local-instance-storage.json` for SQL Server tempdb local-instance
  storage support and capacity
- SQL Server-visible default vCPU plus valid core/thread configurations from
  AWS processor features

The generated runtime catalog excludes exact orderability rows when AWS SQL
Server processor features do not provide the default core/thread configuration.
Generic consolidated vCPU values may support hardware enrichment and isolated
tests, but they cannot become runtime recommendation candidates.

Refresh the approved Regions from the project root:

```powershell
npm run catalog:refresh -- --regions us-east-1
```

Multiple Regions can be comma-separated. Entries without matching standalone
hardware capability data are excluded rather than assigned invented values.
