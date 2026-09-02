# RDS Cost Optimization Architecture

## Purpose

This standalone system analyzes collector evidence from live Amazon RDS for SQL Server instances and recommends a lower licensed/allocated vCPU configuration only when every verified workload gate supports it.

It does not modify or call SSATWeb sizing logic.

## Boundaries

In scope:

- SQL Server-only collector mode.
- Manual owner-only upload of one or more collector ZIPs.
- Synchronized CPU, memory, user-database I/O, and tempdb evidence.
- SQL Server-specific candidate catalog and orderability.
- Candidate compute, memory, IOPS, throughput, tempdb, edition, and evidence gates.
- Independent recommendation harness.
- Per-server and fleet reports.

Out of scope:

- Storage-provisioning optimization.
- Detailed pricing or savings calculations.
- Automated RDS changes.
- SQL text, plans, Query Store, traces, table data, or uploaded credentials.
- SSATWeb code or behavior changes.

## Working Sizing Rule Architecture

This is the current optimization rule architecture. It is expected to evolve as
the sizing and guardrail rules are adjusted, but production, documentation, and
scenario validation must stay aligned to this flow while it is active.

The optimizer starts from a real current RDS SQL Server size and the collected
workload metrics for that instance. It does not start from a target size or from
a desired percentage reduction.

Required scenario input shape:

- current RDS SQL Server instance class
- current SQL-visible vCPU and memory from the catalog
- SQL CPU P95 and P99
- concurrent non-SQL CPU evidence when available
- memory utilization plus memory-pressure evidence
- IOPS P95 and P99
- throughput P95 and P99
- configured storage IOPS and throughput capability when I/O is evaluated

Candidate evaluation order:

1. Generate cheaper technically eligible candidates from the catalog.
2. Prefer current approved lead families before fallback families at the same
   lower size. Current lead families are `m8i`, `r8i`, and `x2m`. Current
   fallback families are `m7i`, `r7i`, and `x2iedn`.
3. Project SQL CPU onto each candidate using candidate SQL-visible vCPU.
4. Validate memory fit and pressure before any I/O approval.
5. Validate IOPS against the lower of candidate instance capability and
   configured storage capability.
6. Validate throughput against the lower of candidate instance capability and
   configured storage capability.
7. Preserve each candidate's PASS, WARN, FAIL, or insufficient-evidence result
   with the exact metric, threshold, and reason.
8. Only a candidate that survives every required hard gate can become an
   optimized target.

CPU rule:

- Project SQL CPU per sample before calculating candidate percentiles.
- Projected SQL CPU P95 must be less than or equal to 70%.
- Projected SQL CPU P99 must be less than or equal to 90%.
- Concurrent total CPU must combine same-sample projected SQL CPU and non-SQL
  CPU before percentile calculation.
- CPU by itself cannot approve a recommendation.

Memory rule:

- High SQL Server memory utilization is an investigation trigger, not an
  automatic pass or fail.
- RAM reduction cannot be approved from utilization alone.
- Memory pressure evidence must be evaluated before a RAM-reducing candidate
  can pass.
- Sustained memory pressure fails the candidate.
- Incomplete or mixed memory evidence can only produce a validation-required
  result, not a hands-free recommendation.

IOPS rule:

- Effective IOPS capability is the lower of candidate instance capability and
  configured storage IOPS capability.
- Observed IOPS P95 must be less than or equal to 70% of effective capability.
- Observed IOPS P99 must be less than or equal to 90% of effective capability.
- IOPS is evaluated only after CPU and memory allow the candidate to remain in
  contention.

Throughput rule:

- Effective throughput capability is the lower of candidate instance capability
  and configured storage throughput capability.
- Observed throughput P95 must be less than or equal to 70% of effective
  capability.
- Observed throughput P99 must be less than or equal to 90% of effective
  capability.
- Throughput is evaluated independently from IOPS.

Scenario validation must be written in this form:

```text
Current size:
  <instance class>, <SQL-visible vCPU>, <memory>

Observed metrics:
  CPU P95/P99, memory utilization and pressure evidence,
  IOPS P95/P99, throughput P95/P99, configured storage capability

Candidate tested:
  <candidate class>, <candidate SQL-visible vCPU>, <candidate memory>

Rule math:
  CPU projection, memory fit/pressure result,
  IOPS effective-capability result,
  throughput effective-capability result

Verdict:
  Recommended, Consider with Validation, No Safe Optimization Identified,
  or Insufficient Evidence
```

## Components

### 1. Collector

- Runs against the live RDS SQL Server endpoint.
- Accepts endpoint, login, password, and existing RDS size.
- Keeps extra Cost Optimization metrics behind the `RunMefirst` toggle.
- Writes all output below the selected customer directory.
- Exports endpoint/`ServerName` and `RDSSize`, but removes credentials.
- Produces repeated timestamped raw evidence rather than recommendation decisions.
- Uses read-only workload evidence queries while preserving the bounded SSAT-style collector-owned staging lifecycle and SQL Agent sampling job, with cleanup after export.
- In Kentra V2 Cost Optimization mode, keeps CPU evidence in `SQL_CPUCollection` and stores memory, cumulative per-file I/O, and tempdb evidence in `dbo.CO_WorkloadSamples`; the legacy `SQL_MemCollection`, `SQL_DBIOTotal`, and `SQL_DBIO` staging/export path is skipped for that run.

### 2. Upload and Access

- Owner-only manual workflow modeled after SSATWeb.
- Accepts one-server and multi-server ZIPs.
- Groups files by manifest `ServerName` and filename prefix.
- Does not accept side-loaded workload or RDS configuration JSON.

### 3. Parser and Synchronizer

- Parses collector CSVs into typed evidence.
- Aligns SQL CPU, Other CPU, memory, user-database I/O, and tempdb I/O by sample time.
- Calculates actual elapsed time between cumulative-counter samples.
- Rejects the complete instance interval when any expected file is missing or invalid.
- Preserves raw evidence, distributions, burst episodes, database attribution, and data-quality findings.

### 4. Evidence Window

- Calculates duration and continuity.
- Applies verified window classifications.
- Carries customer verbal representativeness confirmation.
- Produces confidence and an auditable reason.

### 5. Candidate Catalog

- Stores SQL Server-visible default vCPU and valid Optimize CPU configurations.
- Filters by Region, edition, exact version, class, and processor configuration.
- Excludes rows whose SQL-visible vCPU falls back to generic hardware metadata.
- Stores memory, sustained/burst IOPS, sustained/burst throughput, local storage, and Multi-AZ facts.
- Refreshes orderability metadata independently from SSATWeb.

### 6. CPU Projection

- Converts each observed CPU sample to SQL and Other core demand.
- Projects each synchronized sample to each candidate.
- Calculates P95 and P99 after projection.
- Applies SQL P95, SQL P99, and concurrent total P99 gates.
- Lowers confidence for cross-family comparisons without authoritative normalization.

### 7. Memory Analysis

- Derives a reproducible less-elastic working-set floor.
- Evaluates direct pressure evidence.
- Applies 20% six-month headroom.
- Detects material RAM reduction.
- Evaluates memory-to-physical-read coupling using synchronized interval ReadIOPS.
- Marks uncertain material RAM reduction as aggressive rather than silently safe.

### 8. I/O and tempdb

- Derives read/write IOPS and throughput from cumulative per-file counters using actual elapsed time.
- Aggregates by synchronized sample before percentiles.
- Separately validates P95 sustained demand and P99 burst demand.
- Evaluates burst duration and frequency.
- Remaps tempdb demand for each current/candidate local-storage transition.
- Applies local tempdb capacity as a hard gate.

The component validates instance capability only. It does not change the customer's gp3, io1, or io2 provisioning.

### 9. Edition Evaluation

- Evaluates every Enterprise-to-Standard eligibility term.
- Requires verified target socket/core counts before the Standard scale term can pass.
- Preserves feature, vendor, scale, orderability, and migration blockers separately.
- Treats an edition change as a migration recommendation.

### 10. Optimizer

- Evaluates candidates in the approved deterministic order.
- Applies all hard gates.
- Preserves every candidate's evidence and rejection reasons.
- Returns `Recommended`, `Aggressive Optimization`, or `Not Recommended`.
- Emits a separate assessment for every resource dimension.

### 11. Independent Harness

- Recalculates the active sizing rule flow independently from preserved evidence.
- Does not import production calculations as its oracle.
- Verifies candidate selection evidence, CPU projection, memory fit/pressure, IOPS effective capability, and throughput effective capability.
- Uses the current simplified architecture as the active pass/fail scope.
- Exists to verify production correctness on every change, not to choose production candidates or supply production formulas at runtime.

### 12. Reports and UI

- Present current versus candidate configuration.
- Show all resource gates and candidate history.
- Show why optimized or why not optimized.
- Identify top database drivers only where collected evidence supports attribution.
- Keep server-only resources un-attributed.
- Export JSON, CSV, and PDF-style results.

## End-to-End Data Flow

```text
RunMefirst
  -> collector raw CSVs and non-secret manifest
     (Kentra V2 Cost Optimization: CPU plus consolidated CO_WORKLOAD_SAMPLES)
  -> customer-named ZIP
  -> owner-only manual upload
  -> per-server parsing and synchronization
  -> evidence-window assessment
  -> SQL Server-specific candidate generation
  -> CPU projection
  -> memory and coupling validation
  -> candidate-aware tempdb remapping
  -> IOPS and throughput validation
  -> edition and orderability validation
  -> candidate decision
  -> independent harness verification
  -> per-server report and fleet summary
```

## Decision Contract

Inputs:

- current configuration from collector output
- normalized synchronized workload
- candidate catalog
- approved edition confirmations when an edition change is considered

Outputs:

- decision
- optional recommended configuration
- confidence and risk
- all resource assessments
- blockers
- candidate evaluations
- top database drivers
- preserved evidence

Resource dimensions:

- `cpu`
- `memory`
- `iops`
- `throughput`
- `tempdb`
- `edition`
- `orderability`
- `evidence`

Each resource assessment includes:

- scope
- pass, risk, or fail status
- requirement and capacity when applicable
- utilization when applicable
- reason
- top database name, metric, and value only when defensible

## Database Attribution Rules

IOPS and throughput use synchronized per-database physical I/O. tempdb uses file/database attribution. Edition may name a database-specific feature or scale blocker.

CPU and memory database attribution is optional advisory evidence. It cannot replace server-level CPU or memory gates.

Orderability and evidence quality are always server-level.

## Safety Properties

- No recommendation from CPU alone.
- No percentile addition across independent database series.
- No future I/O claim from uncertain memory reduction.
- No reliance on burst capability without burst evidence and catalog support.
- No local-tempdb recommendation without capacity fit.
- No edition change unless every eligibility term passes.
- No recommendation that the independent harness cannot reproduce.
- No harness oracle may import the production calculation it is meant to verify.
- No storage-provisioning or pricing claim in this phase.
- No changes to SSATWeb.
