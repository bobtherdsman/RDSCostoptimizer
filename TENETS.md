# RDS Cost Optimization Tenets

## 1. Standalone By Design
RDS Cost Optimization is a separate project. It must not change SSATWeb behavior, SSATWeb sizing logic, the public analyzer flow, or the default collector path.

## 2. No Production Impact Collector
The collector must be safe to run against a live RDS SQL Server instance. It must use lightweight, read-only SQL Server DMV, catalog, and performance-counter queries only. It must not use tracing, Extended Events, Query Store scraping, query-plan capture, workload replay, application-table scans, or customer data extraction.

## 3. Opt-In Cost Diagnostics
The original collector behavior remains the default. Extra Cost Optimization metrics must run only through a separate Cost Optimization collector package or an explicit toggle that is off by default.

## 4. Live RDS Reality First
Recommendations are based on the customer’s actual running RDS SQL Server workload and current RDS configuration, not generic assumptions or migration-only estimates.

## 5. Per-Server First, Fleet Summary Second
Uploads may contain one server or multiple servers. Every recommendation, blocker, top database, and cost calculation must be correct per server before any fleet-level summary is shown.

## 6. CPU Finds The Savings, Fit Checks Approve It
CPU/vCPU reduction is the first cost-saving candidate because vCPU often drives SQL Server compute and licensing cost. The final recommendation must still pass memory, IOPS, throughput, SQL edition, SQL version, and RDS orderability checks.

## 7. Never Recommend An Underfit Instance
A cheaper instance is not valid if it cannot safely run the workload. If a smaller candidate fails memory, IOPS, throughput, edition, or orderability checks, the report must show it as a blocked opportunity, not as a recommendation.

## 8. Database-Level Attribution
Instance-level metrics are not enough. The tool must preserve database-level IOPS, throughput, tempdb contribution, and size context so it can identify top offending databases and support split, isolate, or merge conversations.
DB-level I/O, throughput, tempdb, and size are hard attribution metrics. DB-level CPU and memory are advisory only unless captured through negligible-overhead signals; do not use approximate DB CPU/memory attribution as the sole basis for a recommendation.

## 9. SQL Server Licensing-Aware
Every recommendation must respect SQL Server edition limits, EE-to-SE eligibility, BYOM rules, Optimize CPU support, License Included pricing behavior, and RDS orderability.

## 10. Evidence Over Opinion
Customer-facing claims must come from verified AWS/Microsoft facts, live pricing, or harness-validated logic. Anything unproven remains internal and marked for verification.

## 11. Explain Blockers Clearly
If memory, IOPS, throughput, storage, edition, or orderability blocks savings, the report must explain the blocker and the next investigation or tuning action.

## 12. Harness Before Report
No recommendation or savings number should be shown unless it passes the cost harness: orderability, licensing, storage legality, workload fit, pricing reconciliation, and independence from SSATWeb sizing logic.
The copied SSATWeb sizing harness may be used as a validation reference for the new optimized target size. It must not be used to choose the target size.
