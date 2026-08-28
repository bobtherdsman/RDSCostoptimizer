# RDS SQL Server Cost Optimization — MASTER DOCUMENT v3 (single source of truth)

**Version:** 3.0.0  **Date:** 2026-08-28  **Status:** DRAFT for approval — no code changed.
**Replaces/consolidates:** MASTER_SPEC_v2, FACT_BASE, SPEC_REVIEW, and the 3 original COST_OPTIMIZATION_* docs.
This is the ONE doc. Each section explains what it is, why, and cites proven facts where they exist.

Convention: **[FACT Sx]** = proven from a primary source (see §12). **[VERIFY]** = not yet proven; do
not state to customers until confirmed. No opinions stated as fact.

---

## 1. WHAT THIS IS (purpose)
A separate Cost Optimization project that analyzes a customer's **existing Amazon RDS for SQL Server**
instance(s) and produces a **fact-checked, licensing-aware cost-optimization plan** — current cost vs
optimized cost, with the specific changes and an action plan.

This must not affect the existing SSATWeb analyzer, public upload workflow, current recommendation engine,
or default collector behavior. Treat it as a parallel owner-only project/workstream until explicitly approved
for integration.

- **Post-migration** (the SSAT collector runs ON the live RDS instance). Current cost is the ACTUAL
  running config, not an estimate.
- **Differentiator:** AWS Compute Optimizer covers RDS MySQL/PostgreSQL/Aurora, NOT SQL Server; no
  FinOps tool is SQL-Server-license-aware. This fills that gap. [VERIFY competitive claim periodically]
- **Verifiable:** every recommendation must pass a cost harness against authoritative AWS/MS facts plus
  applicable copied SSATWeb sizing-harness checks for the independently selected optimized size before it
  is shown.

---

## 2. HOW IT'S DELIVERED (access)
- Separate project surface. Do not modify the existing SSATWeb user flow or default analyzer screens.
- If hosted inside the same repo/app later, use a new isolated route **`/cost`**, separate from the public
  analyzer and from `/admin`; otherwise keep it as a standalone app/service.
- **Owner-only.** Use a dedicated `COST_OWNER_EMAIL` gate. Gate the route + hide any nav item + guard every
  `/api/cost/*` endpoint server-side (403 otherwise). Never rely on UI hiding alone.

---

## 3. THE PROCESS (end-to-end flow) — explained step by step
1. **Collect** — SSAT collector runs on the RDS instance (DMVs, 7–14 days).
2. **Upload** — ZIP of CSVs to `/cost`; also capture the ACTUAL RDS config (class, edition, storage,
   Upload can contain one server or multiple servers; all analysis remains per-server first, then optionally summarized as a fleet.
   Multi-AZ, region). Optional: enrich via RDS APIs / CloudWatch.
3. **Analyze** — clean outliers; compute per-dimension distributions; establish real current cost.
4. **Optimize** — first try to reduce vCPU/license cost, then prove the smaller candidate still fits
   memory, IOPS, and throughput. If it does not fit, keep/increase that dimension and investigate the
   blocker instead of forcing the downsize.
5. **Verify** — cost harness (§9) confirms each recommendation is AWS/MS-correct.
6. **Present** — current vs optimized, per-server, risk ladder.
7. **Export** — PDF (exec) / Excel (auditable) / JSON.
8. **Act** — risk-ranked steps.

---

## 4. COST MODEL (what makes up the bill) — [VERIFY all rates live]
TOTAL_MONTHLY = COMPUTE(base + SQL-license) + STORAGE + IOPS + THROUGHPUT + BACKUP + DATA-TRANSFER + EXTRAS
- COMPUTE = (base_rate + license_adder_per_vCPU × vCPUs) × 730 × multiAZ × RI_factor.
- STORAGE/IOPS/THROUGHPUT: gp3 (free 3000 IOPS / 125 MB/s, then per-unit) vs io1 vs io2 (tiered).
- **All rates MUST come from the live AWS Pricing API** (we have `awsPricingService.js`), not hardcoded.
- Note: on License Included, the SQL license is bundled into the hourly rate; on BYOM the license fee
  is not charged by RDS [FACT S4]. This changes the compute term materially.

---

## 5. THE FOUR-DIMENSION DEEP DIVE (how "optimize" actually decides) 
CPU is the easiest savings signal, but it only creates the first right-size candidate. The final
recommendation is the least-cost instance+storage option that still satisfies **memory, IOPS,
throughput, SQL edition limits, and RDS orderability**. No "CPU savings" recommendation can ship if it
under-fits any other dimension.

Operational flow:
1. Collector runs on the live RDS SQL Server instance and captures actual workload behavior.
2. CPU/P95 proposes a lower-vCPU target to reduce compute + SQL licensing cost.
3. Memory, IOPS, and throughput validate whether that lower-vCPU candidate can safely run the workload.
4. If memory does not fit, investigate SQL max memory, PLE, grants, waits, and DB size before downsizing.
5. If IOPS/throughput does not fit, investigate storage type, provisioned IOPS/throughput, tempdb share,
   per-database drivers, and query/storage tuning before claiming savings.
6. Preserve database-level attribution so the report can identify top offending DBs and support split,
   isolate, or merge conversations.
7. For DB-level CPU and memory, use advisory signals only when they can be collected with negligible overhead;
   do not treat approximate CPU/memory attribution as hard proof.
8. Only recommend the cheapest option that passes every fit check.

### 5.1 CPU
Full distribution (avg/P50/P90/P95/P99/max); HT-adjusted physical vs logical cores; time-of-day pattern
(business vs maintenance); sustained-high vs bursty. CPU proposes the lower-vCPU candidate; memory, IOPS,
throughput, edition, and orderability either approve it or force the next larger valid option.

### 5.2 Memory — SQL holds memory BY DESIGN; high % is NOT a problem by itself
Judge real pressure via signals, not "% used":
- **PLE (Page Life Expectancy)** — primary signal; collected today. High & stable = healthy → downsize
  RAM safe; low/collapsing = pressure → keep RAM. Exclude one-off nightly-report dips (outliers).
  Threshold: use a buffer-pool-scaled heuristic (≈ (pool_GB/4)×300s) — this is a [VERIFY heuristic],
  NOT a Microsoft-documented constant.
- **Memory Grants Pending / Buffer Cache Hit Ratio / PAGEIOLATCH & RESOURCE_SEMAPHORE waits** —
  corroborating signals; NOT in the collector today (collector-v2, §8).
Decision: high mem% + stable PLE + no grants pending + low PAGEIOLATCH → downsize RAM; else keep.

### 5.3 IOPS — attribute per-DB; catch tempdb; consider NVMe
- Per-DB IOPS with read/write split (collected today) → detect if **tempdb dominates**.
- Rank top databases by IOPS, throughput, tempdb contribution, and size. Use this to explain whether the
  cost driver is one database, several databases, or broad instance-wide load.
- DB-level CPU and memory are different: SQL Server does not provide the same clean, low-impact per-DB
  attribution as I/O. Capture only advisory signals such as active-request DB samples or buffer-pool
  footprint when safe, and label them approximate.
- If one/few DBs dominate I/O or throughput, flag as split/isolate candidates. If many small DBs have low
  combined utilization, flag as possible merge/consolidation candidates. These are advisory only, not
  automatic recommendations.
- If tempdb-dominant: **tempdb on local NVMe instance store** removes that I/O from EBS.
  [FACT S2] Auto-enabled on db.m5d, db.r5d, db.x2iedn, db.x2m; snapshots exclude tempdb; ephemeral;
  never holds data/log files. Cost logic: compare (m8i/r8i + paid EBS IOPS for tempdb) vs
  (m5d/r5d/x2 + free NVMe tempdb) → cheaper wins. (m5d/r5d not yet in tool catalog — would add.)
- Separate sustained vs spike IOPS (outliers). gp3-vs-io2 break-even + provisioned-IOPS right-size.

### 5.4 Throughput (MB/s)
P95/P99 sustained, SEPARATE ceiling from IOPS; validate vs instance EBS-optimized max AND storage-type
max. Often the real constraint for reporting/large-block workloads.

---

## 6. OPTIMIZATION LEVERS (ranked by savings-per-effort) — each explained
1. **Edition EE→SE** — biggest license lever. Governed by the fact-based eligibility rule in §7.
2. **Right-size compute (P95, outlier-cleaned, ~20% headroom)** — Cost Optimization owns this logic.
   Do not use the SSATWeb sizing/recommendation engine; use the instance catalog/orderability data only to
   validate that the optimized instance is legal for the SQL Server version, edition, and instance class.
3. **BYOM (Bring Your Own Media)** [FACT S4] — if the customer owns SQL licenses with active Software
   Assurance + License Mobility, RDS drops the SQL license fee (EE/SE/Developer). Real in-RDS lever.
   (Corrects earlier doc that wrongly said BYOM isn't available on RDS.)
4. **Optimize CPU** — reduce vCPU count while maintaining the same memory and IOPS, to reduce Windows/SQL
   licensing costs on supported RDS SQL Server editions and families [FACT S6].
5. **Storage: gp2→gp3 + IOPS right-size + gp3/io2 break-even** — Provisioned IOPS and storage throughput
   can be reduced, but primary storage size cannot be reduced [FACT S7]. Only type/performance changes,
   never primary-GB shrink.
6. **Reserved DB Instances (AFTER right-sizing)** — RDS uses Reserved DB Instances (NOT Savings Plans);
   SQL Server RIs match exact class (no size flexibility) → right-size first. [VERIFY discount %, live].
7. **Non-prod Stop/Start + Single-AZ** — stopped = no compute/license charge; Multi-AZ ≈ doubles cost.
8. **Extended Support avoidance** — upgrade EOL SQL versions to drop the surcharge [VERIFY rates/timeline].
9. **Backup/snapshot + IPv4/AZ hygiene** — trim retention/stale snapshots; private subnets; AZ co-location.
10. **Instance consolidation (fleet)** — fewer licensed vCPUs across many DBs (needs per-DB data, §8).
11. **Web Edition** — public web apps only [FACT S1/S4]; NOT available in SQL Server 2025+ [FACT S1].

---

## 7. EE→SE ELIGIBILITY RULE (fact-based gate) — the credibility-critical logic
EE→SE downgrade is **BLOCKED** if ANY is true (all thresholds/features are [FACT S1]):
- physical cores > 24, OR required buffer pool > 128 GB, OR In-Memory OLTP data > 32 GB, OR columnstore
  segment cache > 32 GB; OR
- the workload uses any Enterprise-ONLY feature: full Always On AGs, online index create/rebuild,
  Resource Governor, I/O resource governance, most Intelligent Query Processing (batch-mode/adaptive
  joins/memory-grant & CE & DOP feedback/automatic tuning), star-join/parallel-partitioned-query DW
  features, distributed partitioned views, parallel index maintenance, online nonclustered columnstore
  rebuild, peer-to-peer/Oracle-publishing replication, NUMA large-page/read-ahead/advanced-scanning,
  AVX-512/HW offload, Query Store on secondary replicas, advanced R/Python.
**NOT blockers** (present in Standard) [FACT S1]: In-Memory OLTP (≤32GB), TDE, table/index partitioning,
data compression, columnstore (≤32GB), CDC, backup compression/encryption/EKM, Basic AGs, ADR, Always
Encrypted, Ledger, RLS, dynamic data masking.
→ Requires a **feature-usage audit** on the source instance (which needs data we must collect/confirm).

---

## 8. DATA AVAILABILITY (what the collector gives us)
**Today** (build/collectorv2/SSATcollector.ps1): SQL/OS memory MB, **PLE**, StolenServerMem, MemoryClerks;
per-DB IO with read/write split incl. tempdb, throughput, IOPS. → tempdb attribution + PLE work now.
This is enough for Phase 1 to find CPU/vCPU savings candidates and reject candidates that clearly do not
fit memory, IOPS, or throughput. Preserve per-DB metrics so the report can show top offending databases
and support split/isolate/merge analysis.

**Collector v2 (needed to explain blockers and increase confidence):**
- Memory blockers: Memory Grants Pending, Buffer Cache Hit Ratio, PAGEIOLATCH waits, RESOURCE_SEMAPHORE waits.
- I/O blockers: file-level `io_stall` latency, read/write latency split, per-file tempdb/data/log attribution.
- Sizing context: per-database sizes, tempdb usage, and wait stats.
Without these, Phase 1 should still be able to say "CPU savings candidate blocked by memory/IOPS/throughput,"
but it should not over-explain the root cause.

**Collection mode:** RunMefirst must keep the original SSAT collection as the default. The Cost Optimization
project should either ship a separate Cost Optimization collector package/launcher or add an explicit
`Enable Cost Optimization metrics` toggle without changing default behavior. When OFF, collect only the
original metrics and produce the current output format. When ON, add the lightweight Cost Optimization
diagnostics above and include the extra CSVs/columns needed to explain memory and I/O blockers. This keeps
normal assessments unchanged and avoids extra collection overhead unless the owner intentionally enables cost
optimization.

**Collector safety constraints (non-negotiable):**
- Collect only from inside SQL Server using read-only DMV, catalog, and performance-counter queries.
- No workload replay, tracing, Extended Events, Query Store scraping, query-plan capture, or application-table scans.
- No customer row data, SQL text, stored procedure text, passwords, or PII.
- Keep collection lightweight: short queries, scheduled interval sampling, one-time catalog/size snapshots, and bounded
  result sets. If a metric cannot be captured with negligible overhead, mark it optional and skip it by default.
- Core recommendations must not depend on CloudWatch or RDS API access; those can enrich actual config/pricing only.

---

## 9. VERIFICATION — COST HARNESS (the trust layer)
Mirror the sizing harness. Oracles (ALL must pass before any customer number):
- CO-A recommended instance orderable for its edition [API S3].
- CO-B license model valid (License Included OR BYOM per [FACT S4]) — no invalid model.
- CO-C EE→SE only when §7 rule passes.
- CO-D storage type cost-optimal per break-even.
- CO-E RI only on post-right-size class; RDS uses Reserved DB Instances (no Savings Plans).
- CO-F no storage shrink; no Graviton (RDS SQL Server is x86 — [VERIFY doc] / API shows only x86 classes).
- CO-G pricing sourced live; totals reconcile.
- CO-H optimized cost ≤ current cost unless explicitly flagged.
- CO-I CPU-driven downsizes must still meet required memory, IOPS, and throughput. If not, choose the next
  larger valid option or report the blocker.
- CO-J Cost Optimization sizing must be independent from SSATWeb sizing logic. It may read the shared
  instance catalog/orderability facts only as constraints, not call the SSATWeb recommendation engine.
- CO-K copied SSATWeb harness rules may validate the new optimized size, but must not select it.

---

## 9a. DECISION FORMULAS & PATTERNS (operational — reconciled to §12 facts)

**Right-sizing formulas (per server):**
- Required vCPUs = ceil(current_vCPU × P95_CPU% / 0.70)  (target P95 ≈ 70% on new instance).
- CPU right-sizing produces a candidate only. Final pick = cheapest candidate that also satisfies required
  Until pricing is implemented, candidate order must be explicit and treated as caller-supplied, not inferred.
  memory, EBS IOPS, storage throughput, edition limits, and orderability.
- Right-sized SQL Max Memory ≈ MAX(DB_size × 2, DB_size + 20 GB); flag over-provisioned if
  DB_size × 2 < current SQL Max Memory. (Example: DB 4.1 GB → ~24 GB, not 221 GB.)
- EBS-only IOPS = total_P95 × (1 − tempdb%) when tempdb on NVMe [FACT S2]; else = total.
- Storage by EBS-only P95: ≤3000 IOPS → gp3 baseline; ≤16000 → gp3 provisioned; higher/tput-bound →
  io1/io2 via break-even. gp3 provisioned IOPS = ceil(P95 × 1.2 / 1000)×1000.
- Edition caps [FACT S1]: SE ≤ 24 cores; Web ≤ 16 cores (also gate x2 by RDS orderability [API S3]).
- Family by right-sized mem:CPU ratio: ≤4 → m; >4 → r; extreme → x2. NVMe: tempdb-dominant + not on
  NVMe → consider m5d/r5d/x2iedn/x2m [FACT S2] and compare cost.

**Named patterns (fast wins):** P1 big instance/tiny DB → cut SQL Max Memory → downsize · P2 tempdb
inflating IOPS → NVMe family/query fix → cut provisioned IOPS · P3 io2 w/ low actual IOPS → gp3 ·
P4 over-provisioned CPU (P95<30%) → downsize · P5 old-gen → current gen.

**Blocker handling:** If CPU suggests a smaller instance but memory, IOPS, or throughput fails the fit
check, do not show the smaller instance as the recommendation. Show it as a blocked savings opportunity
with the reason: memory pressure, insufficient EBS IOPS, insufficient throughput, tempdb-heavy I/O, or
edition/orderability limit. The action plan becomes "investigate and reduce the blocker," then re-run.

**Risk rubric (overall = max):** CPU new-P95 <50 low/50-70 med/>70 high; memory cut same low/10-25 med/
>25 high; io→gp3 med; NVMe loss high.

**Per-server output:** current(type+storage+IOPS)=$/mo → recommended=$/mo → savings $/mo & /yr, %, risk,
key changes, prerequisites (reduce mem+monitor 2wk, snapshot, maintenance window, test failover if Multi-AZ).

## 10. IMPLEMENTATION PLAN (phased)
- **Phase 0** — separate Cost Optimization scaffold; owner-only access; live pricing wiring; cost harness
  with fixtures; encode §7 rule. No changes to existing SSATWeb public flow or default collector behavior.
- **Phase 1** — EE→SE eligibility + right-size logic + storage + two-number savings + export. Reuse existing
  instance catalog/orderability data only as a validation input; do not use or mutate SSATWeb sizing logic.
- **Phase 2** — BYOM comparison, Optimize CPU, Reserved DB Instances (post-right-size), non-prod stop/start
  + Single-AZ, Extended-Support + backup/IPv4 hygiene.
- **Phase 3** — Collector v2 (grants/waits/latency/DB-sizes) → memory-pressure corroboration, tempdb-NVMe
  tradeoff (add m5d/r5d), fleet consolidation.
- **Phase 4** — report UX + risk ladder + modernization narrative.
Guardrail: verified by BOTH the sizing harness (no regression) and the cost harness; branch-based; no PII in repo.

---

## 11. OPEN DECISIONS (need your call before build)
1. `COST_OWNER_EMAIL` value.  2. Phase-1 lever set (recommend §6 #1,#2,#5 + export).  3. Collector-v2 now or Phase 3.
4. Live pricing region assumptions.  5. Build cost harness first (recommended).

---

## 12. FACT BASE (proven, cited) — evidence for everything above
Convention: DOC = verbatim vendor doc (URL + retrieved 2026-08-28); API = live authoritative call.

**S1 — Microsoft "Editions and supported features of SQL Server 2022"** (learn.microsoft.com/.../editions-and-components-of-sql-server-2022). DOC.
- SE caps: compute lesser of 4 sockets or 24 cores; buffer pool 128 GB; columnstore cache 32 GB;
  In-Memory OLTP data 32 GB/DB. Web: 16 cores / 64 GB.
- SE-present features + EE-only features exactly as listed in §7 (verbatim from the feature tables).
- "Web edition isn't available in SQL Server 2025 (17.x) and later versions." Developer = all EE features (dev/test only).

**S2 — AWS "Instance store support for tempdb on RDS for SQL Server"** (docs.aws.amazon.com/.../SQLServer.InstanceStore.html). DOC.
- tempdb auto on NVMe for db.m5d, db.r5d, db.x2iedn, db.x2m; tempdb.mdf ~80% of storage; snapshots
  exclude tempdb temp files; instance store ephemeral; never holds data/log files; disk-full remedies.

**S3 — AWS RDS API (live).** API.
- `aws rds describe-orderable-db-instance-options --engine sqlserver-{ee|se|web|ex} --engine-version <v>`
  proves orderable classes per edition/version (this session: x2m/x2iedn both editions; SE x2 ≤8xlarge;
  EE r8i/m8i up to 96xlarge). Re-run per region at build.

**S4 — AWS "Licensing Microsoft SQL Server on Amazon RDS"** (docs.aws.amazon.com/.../SQLServer.Concepts.General.Licensing.html). DOC.
- Two models: **License Included** (EE/SE/Web/Express) AND **Bring Your Own Media (BYOM)** (EE/SE/Developer)
  via License Mobility w/ active Software Assurance; with BYOM "RDS does not charge SQL Server license fees."
- Developer on RDS = BYOM, non-production. Web restricted to public web hosting. No extra license for Multi-AZ.

**S5 — AWS "Multi-AZ deployments for RDS for SQL Server"** (docs.aws.amazon.com/.../USER_SQLServerMultiAZ.html). DOC.
- Multi-AZ via DBM / Always On AGs / block-level replication (auto-selected by version/edition; matrix in doc);
  same endpoint, automatic failover; "no additional licensing requirements." Standby readability NOT stated here.

**S6 — AWS "Optimize CPUs for RDS for SQL Server instances"** (docs.aws.amazon.com/.../SQLServer.Concepts.General.OptimizeCPU.html). DOC.
- Optimize CPU configures vCPU count while maintaining the same memory and IOPS; AWS states this can reduce
  Microsoft Windows OS and SQL Server licensing costs because those costs are based on vCPU count.
- Supported editions: Enterprise/Standard/Web (License Included) and Enterprise/Standard/Developer (BYOM).
  Supported families: m7i, r7i, m8i, r8i, m8a, r8a, x2m. Minimum supported size: 2xlarge; minimum vCPU: 4.

**S7 — AWS "Modifying settings for gp3 storage" + "Amazon RDS DB instance storage"** (docs.aws.amazon.com/.../USER_PIOPS.gp3.html and CHAP_Storage.html). DOC.
- gp3 Provisioned IOPS and storage throughput can be reduced; DB instance storage size cannot be reduced.
- RDS for SQL Server gp3 baseline is 3,000 IOPS / 125 MiB/s and can provision 3,000-80,000 IOPS and
  125-2,000 MiB/s for any available storage size; actual usable performance is also capped by instance limits.

**NOT YET PROVEN — [VERIFY] before customer-facing use:**
V1 live LI per-vCPU rates · V2 Reserved DB Instance % (live) · V4 Multi-AZ standby readability ·
V5 Extended Support rates/timeline · V6 PLE threshold formula (heuristic, not MS-documented) ·
V7 EE:SE list-price ratio (~3.8x, confirm on MS pricing page) · V9 no-Graviton confirmed via doc
(API shows x86 only).

---
## APPENDIX — superseded docs (kept for detail/history, not source of truth)
COST_OPTIMIZATION_END_TO_END_SPEC.md (v1 algorithms), GAP_ANALYSIS, COMPETITIVE_OFFER, MASTER_SPEC_v2,
SPEC_REVIEW, FACT_BASE. This v3 supersedes them for planning.
