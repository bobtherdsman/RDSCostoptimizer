# RDS Cost Optimization

Standalone project for Amazon RDS for SQL Server cost optimization.

## Boundaries

- RDS SQL Server only.
- No SSATWeb behavior changes.
- No dependency on SSATWeb sizing or recommendation logic.
- Copied SSATWeb harness rules may validate the new optimized target size, but must not choose it.
- Instance catalog/orderability data may be used only as a validation constraint.
- Collector must be SQL-only, read-only, low impact, and opt-in for extra cost diagnostics.
- Uploads may contain one server or multiple servers; parser and optimizer contracts must handle both.

## First Build Goal

Build the data contracts and cost harness skeleton before optimizer behavior. The first working milestone should prove that a CPU-driven downsize is rejected unless memory, IOPS, throughput, SQL edition/version, and RDS orderability all fit.

## Project Layout

```text
src/api        owner-only API surface later
src/catalog    instance catalog/orderability constraints
src/contracts  shared TypeScript contracts
src/harness    cost harness oracles
src/optimizer  independent optimization logic
src/parser     collector ZIP/CSV normalization
src/pricing    pricing source and reconciliation
src/reports    JSON/CSV/PDF report generation later
tests/fixtures sample inputs and expected outputs
tests/harness  harness tests
collector      separate or opt-in collector package later
```
