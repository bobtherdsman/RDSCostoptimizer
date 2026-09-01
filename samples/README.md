# Gold Sample Regression Packages

`tool-regression/` contains exactly ten deterministic collector packages. They are generated from known inputs and must not be rebuilt from converted legacy ZIPs.

| Package | Expected result | Harness purpose |
|---|---|---|
| `gold-01-safe-downsize.zip` | Recommend `db.r8i.8xlarge` | CPU opportunity with memory, IOPS, throughput, edition, version, storage, and orderability fit |
| `gold-02-memory-blocked.zip` | Block `MEMORY_UNDERFIT` | Low CPU but candidate memory cannot satisfy observed SQL memory plus pressure headroom |
| `gold-03-iops-blocked.zip` | Block `IOPS_UNDERFIT` | Candidate compute class cannot satisfy workload IOPS |
| `gold-04-throughput-blocked.zip` | Block `THROUGHPUT_UNDERFIT` | Candidate compute class cannot satisfy workload throughput |
| `gold-05-cpu-blocked.zip` | Block `CPU_UNDERFIT` | Lower-vCPU candidates cannot satisfy projected CPU |
| `gold-06-short-collection.zip` | Block `COLLECTION_WINDOW_TOO_SHORT` | Collection-quality gate |
| `gold-07-sql-version-blocked.zip` | Block `SQL_VERSION_BELOW_MIN` | SQL version/orderability gate |
| `gold-08-edition-blocked.zip` | Block `EDITION_NOT_SUPPORTED` | SQL edition/orderability gate |
| `gold-09-catalog-gap-fallback.zip` | Recommend `db.r8i.8xlarge` | CPUINFO fallback, fallback region evidence, and missing optional storage facts |
| `gold-10-tempdb-dominant.zip` | Recommend `db.r8i.8xlarge` | DB attribution, tempdb dominance, latency evidence, and advisory reporting |

All packages include:

- Non-secret `collector_run_manifest.csv`.
- Valid CPU, CPUINFO, memory, per-database I/O, and database-size CSV schemas.
- `CO_MEMORY_DIAGNOSTICS`.
- `CO_WAIT_STATS`.
- `CO_FILE_IO`.
- `CO_TEMPDB_USAGE`.
- `CO_DB_CPU_REQUEST_SAMPLE`.

The generated metrics are synthetic regression evidence, not customer measurements. They validate deterministic parser, optimizer, harness, upload, and reporting behavior.

Regenerate the complete set with:

```bash
npm run samples:generate
```
