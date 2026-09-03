# Catalog Data

`aws-instances-consolidated.json` is a local copy from SSATWeb:

`C:\Users\bacrifai\Downloads\Projects\rdstools-web\aws-instances-consolidated.json`

Copy date: 2026-08-28.

Do not modify SSATWeb for this project. Refresh this file by copying from SSATWeb or replacing it with an independently generated catalog in this standalone project.

`fixture-catalog.json` is a small deterministic catalog used by tests.

`family-preferences.json` is the approved catalog-adjacent candidate family
preference policy. It stores mutable lead/fallback/rank metadata such as
current lead and fallback families so production and harness code do not embed
family arrays. Lower rank wins. Verified sizing thresholds stay in the spec and
code constants, not in this mutable catalog-adjacent file.

`approved-regions.json` is the explicit manual-refresh Region list. Catalog
refresh tooling must read this file instead of relying on implicit defaults.

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
npm run catalog:refresh:approved
```

Entries without matching standalone hardware capability data are excluded rather
than assigned invented values.

## Manual GitHub Catalog Refresh

The catalog refresh workflow is manual-only. It does not run on a schedule.

To trigger it:

1. Open the repository in GitHub.
2. Go to **Actions**.
3. Select **Catalog Refresh**.
4. Choose **Run workflow**.
5. Review the generated pull request and its catalog refresh summary before
   merging. Refreshed catalog data does not affect the tool until that pull
   request is reviewed and merged.
