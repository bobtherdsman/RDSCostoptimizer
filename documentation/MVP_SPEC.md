# RDS Cost Optimization Production Release Specification

The filename is retained for compatibility. The approved target is a production workload-fit release, not a reduced MVP.

## Release Goal

Given collector evidence from a live Amazon RDS for SQL Server instance, determine whether licensed/allocated vCPU can be reduced without violating CPU, memory, IOPS, throughput, tempdb, SQL Server edition, exact-version orderability, or evidence-quality gates.

## Non-Negotiables

- Standalone project; no SSATWeb changes.
- SQL Server only.
- Collector-first inputs and manual upload.
- Extra metrics remain behind the Cost Optimization toggle.
- Read-only, bounded, low-impact collection.
- No SQL text, plans, Query Store content, traces, row data, uploaded credentials, or PII.
- No storage-provisioning recommendation.
- No detailed pricing.
- Every presented optimization must pass the independent harness.
- The independent harness verifies production output; it is not the production recommendation engine and must not choose candidates.

## Required Input

Each server package supplies:

- endpoint/`ServerName`
- existing `RDSSize`
- collector CPUINFO and synchronized workload evidence

Login and password are collector-run inputs only and are removed from exported evidence.

Uploads may contain one server or multiple servers. Matching manifest and filename prefixes keep each server's evidence isolated.

## Required Evidence

- SQL process CPU, Other CPU, and current SQL Server-visible vCPU.
- Memory pressure, process/system state, grants, PLE, clerks, stolen memory, cache activity, and Batch Requests/sec when available.
- Cumulative per-file read/write operations and bytes with actual timestamps.
- User database, file type, and tempdb attribution.
- Representative and peak tempdb allocation.
- Current and candidate SQL Server/catalog facts.
- Customer verbal confirmation of workload representativeness.

## Required Decision Flow

1. Resolve current SQL Server-visible CPU and class metadata.
2. Validate duration, continuity, and representativeness.
3. Synchronize CPU, memory, user-database I/O, and tempdb I/O.
4. Generate only valid orderable candidates with authoritative AWS SQL Server-visible CPU metadata, including Optimize CPU configurations.
5. Project SQL and total CPU per sample; apply P95 and P99 gates.
6. Validate memory pressure and less-elastic working set with 20% headroom.
7. Apply memory-to-I/O coupling for material RAM reductions.
8. Remap tempdb demand for the candidate.
9. Validate IOPS P95 against sustained capability and P99 against supported burst capability.
10. Validate throughput independently using the same sustained/burst structure.
11. Validate local tempdb capacity.
12. Apply Enterprise-to-Standard eligibility when an edition change is evaluated; unknown target socket/core counts fail the Standard scale term.
13. Select the first candidate that passes the approved candidate order.
14. Return `Recommended`, `Aggressive Optimization`, or `Not Recommended`.
15. Run the independent validation harness to verify the selected result can be reproduced from preserved evidence.

## Required Output

For each server:

- current and selected configuration
- visible vCPU comparison
- outcome and confidence
- complete CPU, memory, IOPS, throughput, tempdb, edition, orderability, and evidence gates
- all evaluated limiting resources
- top offending database for a resource only when supported by collected per-database evidence
- candidate history and rejection reasons
- current versus optimized narrative
- why not optimized narrative when no candidate passes

For a multi-server upload:

- total server count
- Recommended count
- Aggressive Optimization count
- Not Recommended count
- individual server evidence without hidden blockers

## Database Attribution

Direct per-database I/O and tempdb evidence can identify top IOPS, throughput, and tempdb drivers. Database CPU and memory attribution is advisory because SQL Server does not provide the same clean low-impact attribution; it is shown only when approved evidence exists.

Orderability and evidence quality are server-level gates and never receive invented database attribution.

## Release Acceptance

- Collector disabled mode preserves original behavior.
- Collector enabled mode emits all approved evidence under the customer directory.
- Credentials are absent from ZIP output.
- One-server and multi-server uploads work.
- CPU projection, memory, coupling, IOPS, throughput, tempdb, edition, and evidence-window branches are regression tested.
- The harness independently reproduces the selected result.
- All three outcomes are tested.
- Reports list all limiting resources and defensible top database attribution.
- Storage provisioning, pricing, and automatic RDS changes remain outside the active flow.
