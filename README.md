# RDS Cost Optimization

Standalone production workload optimizer for Amazon RDS for SQL Server. It determines whether licensed/allocated vCPU can be reduced while CPU, memory, instance I/O, tempdb placement, SQL Server edition, exact engine version, and RDS orderability remain supported.

Pricing and storage-provisioning changes are outside the current phase.

## Customer Flow

1. Download the standalone collector.
2. Enable Cost Optimization metrics in `RunMefirst` when optimization evidence is required.
3. Run the SQL Server-only, bounded, low-impact collector.
4. Upload the customer-named collector ZIP manually.
5. Analyze one server or multiple servers.
6. Review or export the workload recommendation and its evidence.

Credentials are used only by the collector and are not included in uploaded output. The uploaded manifest carries the endpoint/`ServerName` and current `RDSSize`.

## Decision Model

CPU proposes a lower-vCPU candidate. The candidate is accepted only after independent validation of:

- projected SQL CPU P95 and P99
- concurrent SQL plus Other CPU P99
- memory pressure, reproducible working set, and memory-to-I/O coupling
- sustained and burst IOPS
- sustained and burst throughput
- candidate-aware tempdb placement and local-storage capacity
- SQL Server edition and migration eligibility
- Region, exact engine version, class, and processor-configuration orderability
- authoritative SQL Server-visible vCPU provenance; generic hardware-vCPU fallback rows are excluded
- collection duration, continuity, and representativeness

The result is `Recommended`, `Aggressive Optimization`, or `Not Recommended`.

Enterprise-to-Standard remains a separate migration recommendation and requires verified target socket/core counts in addition to feature, vendor, memory-scale, orderability, and migration-path evidence.

Every evaluated candidate preserves its passed gates, failed gates, rejection reasons, and evidence. Reports list all limiting resources. When collected per-database evidence supports attribution, the relevant resource also identifies its top offending database. Server-only gates such as orderability and evidence quality are not assigned a database.

## Boundaries

- RDS for SQL Server only.
- No SSATWeb changes or dependency on SSATWeb sizing logic.
- Collector-first workload evidence.
- Extra Cost Optimization metrics are opt-in and low impact.
- No SQL text, plans, Query Store content, traces, row data, credentials, or PII.
- No automated RDS changes.
- No storage type, provisioned IOPS, provisioned throughput, or allocated-storage recommendation in this phase.
- No detailed pricing, monthly savings, RI, or Savings Plans recommendation in this phase.

## Project Layout

```text
collector/      standalone collector and launcher
src/access/     owner-only access guard
src/api/        analysis and export service
src/catalog/    SQL Server candidate and orderability metadata
src/contracts/  shared TypeScript contracts
src/edition/    Enterprise-to-Standard eligibility
src/harness/    independent validation oracles
src/io/         elapsed-time IOPS and throughput analysis
src/memory/     pressure, working-set, and coupling analysis
src/optimizer/  candidate generation and decision flow
src/parser/     collector ZIP/CSV normalization
src/reports/    JSON, CSV, and PDF-style exports
src/server/     manual upload server
src/ui/         upload and results views
src/upload/     upload orchestration
src/workload/   end-to-end workload analysis
samples/        regression collector packages
tests/          unit, integration, harness, and regression tests
```

## Harness Contract

The independent harness is the project's regression oracle. It verifies that production recommendations remain reproducible from preserved evidence after every change; it is not the production recommendation engine and must not choose candidates or import production calculations as its oracle.

See [HARNESS_CONTRACT.md](documentation/HARNESS_CONTRACT.md).

## Run

Set `COST_OWNER_EMAIL`, then:

```powershell
npm run server
```

Open `http://localhost:3001/cost`.
