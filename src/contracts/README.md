# Data Contracts

The contracts define the standalone RDS for SQL Server workload-optimization boundary.

## Current Configuration

Current facts come from collector output:

- endpoint/`ServerName`
- current RDS instance class
- Region
- SQL Server edition and exact version
- license model
- current SQL Server-visible vCPU
- processor configuration when known
- current storage and Multi-AZ facts as comparison context

Credentials are never part of the analysis contract.

## Workload Profile

The workload profile preserves:

- synchronized SQL CPU and Other CPU samples
- synchronized memory pressure and working-set samples
- cumulative per-file I/O counters and actual elapsed time
- user-database and tempdb attribution
- raw evidence needed for P50, P95, P99, maximum, burst duration, and burst frequency
- invalid-sample and continuity evidence
- evidence-window and representativeness state

Per-database IOPS, throughput, tempdb, and size remain available for reporting. Database CPU and memory fields are advisory only when approved low-impact evidence exists.

## Optimization Result

`OptimizationDecision` is:

- `Recommended`
- `Aggressive Optimization`
- `Not Recommended`

The result contains:

- current configuration
- optional recommended configuration
- risk and confidence
- blockers
- passed checks
- complete preserved evidence
- every evaluated candidate and its rejection reasons
- all limiting-resource assessments
- top database drivers

## Limiting Resource Assessment

Each assessment identifies:

- dimension
- scope
- pass, risk, or fail status
- requirement and capacity when applicable
- utilization when applicable
- reason
- optional top database name, metric, and value

Dimensions are CPU, memory, IOPS, throughput, tempdb, edition, orderability, and evidence quality.

Top database fields are populated only when collected evidence supports attribution. Orderability and evidence quality remain server-level. Missing database attribution does not remove or weaken the server-level resource result.

## Candidate Evaluation

Each candidate record preserves:

- class and processor configuration
- decision and confidence
- whether it was selected
- passed gates
- failed gates
- rejection reasons
- limiting-resource assessments

This record is the reproducibility boundary used by the independent harness.

## Batch Contract

One upload can contain one or multiple servers. Optimization is performed per server before a fleet summary is produced. Fleet aggregation must not hide individual blockers, resource gates, or top database drivers.

## Deferred Contracts

Storage-recommendation and dollar-savings contracts are absent from this phase. Current storage facts remain read-only context for instance-capability analysis; no storage provisioning recommendation is produced.
