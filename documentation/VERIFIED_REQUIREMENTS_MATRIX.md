# Verified Requirements Matrix

**Verified on:** 2026-08-31  
**Authority:** `documentation/Kentra_RDS_SQL_Server_Optimization_Verified_v1_1.docx`

This matrix records the completed standalone implementation after Tasks 2–16. Detailed formulas and thresholds are in `COST_OPTIMIZATION_END_TO_END_SPEC.md`.

## Status

| Area | Verified requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| Scope | RDS for SQL Server workload optimization only | Standalone collector, parser, optimizer, harness, and reporting flow | `AGENTS.md`, `src/workload` | Implemented |
| Boundary | No SSATWeb changes or sizing dependency | Standalone catalog and optimizer; SSATWeb baseline used only as copied validation context | project boundary audit | Implemented |
| Flow | Download, run, customer ZIP, manual upload, analyze, export | Collector and owner-only upload server | collector, upload, server, UI tests | Implemented |
| Security | Credentials excluded from upload evidence | Non-secret manifest; login/password remain collector-run inputs | collector tests | Implemented |
| Toggle | Extra metrics opt-in; original behavior preserved when disabled | `RunMefirst` Cost Optimization mode | collector tests | Implemented |
| Safety | Read-only workload evidence with bounded collector lifecycle | DMV/performance-counter queries; temporary collector-owned staging/job artifacts are cleaned after export; no customer-table writes, SQL text, or row data | collector audit/tests | Implemented |
| Evidence | Synchronized CPU, memory, user DB I/O, and tempdb series | Canonical sample model and parser synchronizer | parser tests | Implemented |
| Evidence | Actual elapsed time and invalid interval handling | Counter-pair validation and elapsed-time calculations | I/O and parser tests | Implemented |
| Window | Verified duration classifications and continuity | Evidence-window module | evidence-window tests | Implemented |
| Representativeness | Customer verbal confirmation, not a tool claim | Explicit evidence field and report reason | evidence/report tests | Implemented |
| Catalog | SQL-visible vCPU and Optimize CPU metadata | SQL Server candidate catalog | catalog tests | Implemented |
| Catalog | Region, edition, exact version, and processor orderability | Candidate filtering and exact-entry validation | catalog/harness tests | Implemented |
| Catalog | Sustained/burst I/O and local-storage capability | Candidate metadata and refresh path | catalog tests | Implemented |
| CPU | Sample-level SQL and Other core demand | CPU projection module | CPU/optimizer tests | Implemented |
| CPU | SQL P95 `<=70%`, SQL P99 `<=90%`, total P99 `<=90%` | Candidate hard gates | optimizer/harness tests | Implemented |
| CPU | Same-family confidence and cross-family normalization | Capacity factor and confidence behavior | optimizer tests | Implemented |
| Memory | Pressure and less-elastic working-set assessment | Memory analysis module | memory tests | Implemented |
| Memory | 20% six-month headroom | Working-set floor calculation | memory/harness tests | Implemented |
| Coupling | Material RAM reduction detection | `>=25%` or lower-memory tier | memory tests | Implemented |
| Coupling | Spearman, magnitude, and persistence rules | Independent physical ReadIOPS coupling | memory/harness tests | Implemented |
| Coupling | Uncertain material reduction becomes aggressive | Three-state candidate decision | optimizer/report tests | Implemented |
| IOPS | Cumulative read/write operations divided by elapsed time | I/O module | I/O tests | Implemented |
| IOPS | Aggregate before P95/P99; sustained and burst validation | Candidate IOPS gate | optimizer/harness tests | Implemented |
| Throughput | Cumulative bytes divided by elapsed time | I/O module | I/O tests | Implemented |
| Throughput | Independent sustained and burst validation | Candidate throughput gate | optimizer/harness tests | Implemented |
| tempdb | Four current/candidate placement transitions | Candidate remapping | optimizer/harness tests | Implemented |
| tempdb | Representative/peak local-capacity hard gate | Candidate local-storage validation | optimizer/harness tests | Implemented |
| Edition | Five-term Enterprise-to-Standard expression | Edition module | edition/harness tests | Implemented |
| Edition | Version-specific scale limits and migration requirement | Edition blockers and migration result | edition/report tests | Implemented |
| Decision | `Recommended`, `Aggressive Optimization`, `Not Recommended` | Optimization decision contract | optimizer/report/UI tests | Implemented |
| Decision | Preserve every evaluated candidate and rejection reason | Candidate evaluation records | optimizer/report tests | Implemented |
| Resources | List all limiting-resource assessments | CPU, memory, IOPS, throughput, tempdb, edition, orderability, evidence | optimizer/report/UI tests | Implemented |
| DB attribution | Identify top offending DB when evidence supports it | Resource-specific top DB fields and driver summaries | optimizer/report tests | Implemented |
| DB attribution | Rank sustained physical drivers without summing or ranking independent database P95 values | Time-integrated synchronized IOPS/throughput shares | parser regression | Implemented |
| DB attribution | Do not invent attribution for server-only gates | Orderability/evidence remain server-only | optimizer/report tests | Implemented |
| Harness | Independent raw-evidence reproduction | Independent oracle module | cost-harness tests | Implemented |
| Harness | Independently enforce locked CPU safety limits | Harness-local `70/90/90` constants; reported threshold tampering fails | cost-harness tampering regression | Implemented |
| Harness | Fail unreproducible recommendation | Selected-candidate evidence comparison | tampering regression | Implemented |
| Reports | Full current/candidate and evidence output | JSON, CSV, PDF-style, and UI output | report/UI/API tests | Implemented |
| Samples | Representative and edge-case collector packages | Ten generated regression ZIPs | sample regression tests | Implemented |
| Deferred | Storage provisioning excluded from active flow | Workload path and reports do not invoke storage optimizer | workload/report tests | Guard enforced |
| Deferred | Detailed pricing excluded | No active pricing or savings recommendation | workload/report tests | Guard enforced |
| Deferred | No automated RDS changes | Advisory output only | architecture boundary | Guard enforced |

## Outcome Regression Set

The regression suite includes:

- safe lower-vCPU recommendation
- memory-pressure rejection
- IOPS sustained-capability rejection
- throughput sustained-capability rejection
- CPU P95 rejection
- insufficient collection rejection
- exact-version/orderability rejection
- edition rejection
- current-catalog-gap fallback
- tempdb-dominant workload
- material memory reduction with insufficient stable-working-set proof
- Optimize CPU candidate
- cross-family comparison with and without normalization
- all four tempdb transitions
- local tempdb capacity failure
- every evidence-window class
- every Enterprise-to-Standard eligibility term
- tampered evidence that must fail independent reproduction

## Verification Verdict

The workload-fit implementation matches the verified algorithm for the current phase. The final audit passed 16 JavaScript collector/fixture tests and 141 TypeScript production, harness, report, upload, UI, and gold-sample tests. Production recommendations remain dependent on representative customer evidence and current exact catalog facts. Storage provisioning, pricing, and automated customer changes remain intentionally deferred.
