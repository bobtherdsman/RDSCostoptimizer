# RDS Cost Optimization — FACT BASE (proven, cited, no opinions)

Rule: every row is a FACT quoted from a PRIMARY SOURCE, with the exact source and how it was proven.
No assumptions, no estimates, no opinions. "VERIFY" = not yet proven from primary source.

Legend for PROOF METHOD:
- DOC = direct quote from vendor documentation (URL + retrieval date).
- API = returned by a live authoritative API call (command shown).

═══════════════════════════════════════════════════════════════════════════════
SOURCE S1 — Microsoft, "Editions and supported features of SQL Server 2022"
URL: https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2022
Retrieved: 2026-08-28. Page "Last updated 2026-07-20." Applies to: SQL Server 2022 (16.x).
PROOF METHOD: DOC (verbatim from the edition feature tables).
═══════════════════════════════════════════════════════════════════════════════

## FACT GROUP A — SE scale limits (S1, "Scale limits" table, verbatim)
A1. Max compute per instance — Standard: "Limited to lesser of 4 sockets or 24 cores". Enterprise: "Operating system maximum".
A2. Max buffer pool per instance — Standard: "128 GB". Enterprise: "Operating system maximum".
A3. Max columnstore segment cache per instance — Standard: "32 GB". Enterprise: "Unlimited memory".
A4. Max memory-optimized (In-Memory OLTP) data size per DB — Standard: "32 GB". Enterprise: "Unlimited memory".
A5. Web max compute: "lesser of 4 sockets or 16 cores"; Web buffer pool: "64 GB".

## FACT GROUP B — Features PRESENT in Standard (S1, verbatim "Yes" for Standard)
   → therefore NOT a blocker for EE→SE downgrade (presence alone does not require EE):
B1. In-Memory OLTP — Standard: "Yes" (subject to A4 32 GB cap).
B2. Transparent data encryption (TDE) — Standard: "Yes".
B3. Table and index partitioning — Standard: "Yes".
B4. Data compression — Standard: "Yes".
B5. Columnstore — Standard: "Yes" (subject to A3 32 GB cap).
B6. Change data capture — Standard: "Yes".
B7. Backup compression / Encrypted backup / EKM — Standard: "Yes".
B8. Basic availability groups — Standard: "Yes" (2 replicas, 1 DB); Always On failover cluster instances — Standard: "Yes" (2 nodes).
B9. Accelerated Database Recovery, Query Store, Always Encrypted (+secure enclaves), Ledger,
    Row-level security, Dynamic data masking, Partitioned table parallelism — Standard: "Yes".

## FACT GROUP C — Features ENTERPRISE-ONLY (S1, verbatim: Enterprise "Yes", Standard "No")
   → therefore a HARD BLOCKER for EE→SE if the workload uses them:
C1. Always On availability groups (full) — EE "Yes" / SE "No". (SE has only Basic AGs, per B8.)
C2. Contained availability groups — EE only. Distributed availability groups — EE only.
C3. Automatic read/write connection rerouting — EE only.
C4. Online page and file restore — EE only.
C5. Online index create and rebuild — EE only. Resumable online index rebuilds — EE only.
C6. Resumable online ADD CONSTRAINT — EE only. Online schema change — EE only.
C7. Fast recovery — EE only. Mirrored backups — EE only. Hot add memory and CPU — EE only.
C8. Online nonclustered columnstore index rebuild — EE only.
C9. In-Memory: hybrid buffer pool direct write — EE only; Memory-optimized TempDB metadata — EE only.
C10. Resource governor — EE only. I/O resource governance — EE only.
C11. NUMA aware large page memory — EE only. Read-ahead — EE only. Advanced scanning — EE only.
C12. AVX-512 support — EE only. Integrated acceleration/offloading (hardware) — EE only.
C13. Intelligent Query Processing EE-only: Automatic tuning, Batch mode adaptive joins,
     Batch mode memory grant feedback, Batch mode on rowstore, Cardinality estimate feedback,
     Degree of parallelism feedback, Memory grant feedback persistence, Row mode memory grant feedback.
C14. Data warehouse EE-only: Star join query optimizations, Parallel query processing on partitioned
     tables/indexes, Global batch aggregation.
C15. Manageability EE-only: Distributed partitioned views, Parallel index maintenance operations,
     Automatic use of indexed view by optimizer, Parallel consistency check, SQL Server Utility Control Point.
C16. Replication EE-only: Oracle publishing, Peer-to-peer transactional replication (+last-write-wins).
C17. Query Store on secondary replicas — EE only. Query Store on secondary replicas — EE only.
C18. Advanced R / Advanced Python integration, Machine Learning Server (Standalone) — EE only.

## FACT GROUP D — Edition lifecycle (S1, verbatim footnotes)
D1. "Web edition isn't available in SQL Server 2025 (17.x) and later versions."
D2. Developer edition "includes all the functionality of Enterprise edition" (licensed for dev/test only).
D3. EE Server+CAL licensing (legacy, not for new agreements) capped at 20 cores; core-based EE has no core limit.

## DERIVED EE→SE ELIGIBILITY RULE (composed only from the FACTS above — no opinion)
EE→SE downgrade is BLOCKED if ANY is true:
  (a) physical cores > 24  [A1]           (b) required buffer pool > 128 GB  [A2]
  (c) In-Memory OLTP data > 32 GB [A4]     (d) columnstore segment cache > 32 GB [A3]
  (e) workload uses ANY C1–C18 Enterprise-only feature.
Otherwise EE→SE is technically eligible. Presence of In-Memory OLTP / TDE / partitioning / columnstore /
CDC alone does NOT block (B1–B9), only their EE-only variants (C-list) or the size caps (A-list).

═══════════════════════════════════════════════════════════════════════════════
SOURCE S2 — AWS, "Instance store support for the tempdb database on RDS for SQL Server"
URL: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/SQLServer.InstanceStore.html
Retrieved: 2026-08-28. PROOF METHOD: DOC (verbatim).
═══════════════════════════════════════════════════════════════════════════════
E1. tempdb auto-placed on local NVMe instance store on exactly: db.m5d, db.r5d, db.x2iedn, db.x2m (verbatim list).
E2. Placement is automatic on those classes; tempdb files go to T:\rdsdbdata\DATA; tempdb.mdf starts at
    "80% or more of the instance's storage capacity."
E3. "When tempdb is on the instance store, snapshots don't include temporary files" → smaller snapshots.
E4. Instance store is temporary/ephemeral; "SQL Server database files and database log files aren't
    placed on the instance store."
E5. Disk-full risk documented; remedies incl. scaling up NVMe or mixed-mode (extra tempdb files on EBS).

═══════════════════════════════════════════════════════════════════════════════
SOURCE S3 — AWS RDS API (live) — PROOF METHOD: API
═══════════════════════════════════════════════════════════════════════════════
F1. RDS SQL Server orderable instance classes per edition/version — proven via:
    `aws rds describe-orderable-db-instance-options --engine sqlserver-{ee|se|web|ex} --engine-version <v>`
    (used earlier this session to prove x2m/x2iedn edition/size availability, r8i up to 96xl for EE,
     SE x2 capped at 8xlarge). Re-run at build time for the current region.

═══════════════════════════════════════════════════════════════════════════════
NOT YET PROVEN FROM PRIMARY SOURCE (marked VERIFY — do NOT state as fact):
═══════════════════════════════════════════════════════════════════════════════
V1. RDS SQL Server License-Included per-vCPU $ adder by edition — needs AWS Pricing API (live).
V2. Reserved DB Instance discount % for SQL Server — needs AWS Pricing API / RDS RI pricing (live).
V4. RDS Multi-AZ standby readable? — see G-group; standby-not-readable still needs an explicit doc quote.
V6. PLE threshold formula — DBA guidance, not a Microsoft-documented constant → label as heuristic, not fact.
V7. EE vs SE per-core LIST price ratio (~3.8x) — from Microsoft pricing page + third-party; confirm on
    the official MS SQL Server pricing page before quoting.

═══════════════════════════════════════════════════════════════════════════════
SOURCE S4 — AWS, "Licensing Microsoft SQL Server on Amazon RDS"
URL: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/SQLServer.Concepts.General.Licensing.html
Retrieved: 2026-08-28. PROOF METHOD: DOC (verbatim).
═══════════════════════════════════════════════════════════════════════════════
G1. "RDS for SQL Server supports two licensing models: License Included and Bring Your Own Media."
G2. License Included editions: Enterprise, Standard, Web, Express (verbatim list).
G3. **BYOM IS SUPPORTED on RDS** for editions: Enterprise, Standard, Developer — via "License Mobility
    through Software Assurance"; "Amazon RDS does not charge SQL Server license fees" (you pay AWS
    infra + Windows OS license + RDS features). Requires valid SQL license with active SA + License
    Mobility rights.
    ⚠️ CORRECTION TO EARLIER SPEC (C1): the prior claim "No BYOL/BYOM on standard RDS" is FALSE per S4.
    BYOM (EE/SE/Developer) is a REAL in-RDS lever when the customer owns licenses with active SA.
G4. Developer Edition on RDS = BYOM only, non-production; Express = License Included, free.
G5. Web Edition usage restricted to public web hosting per Microsoft terms (AWS Service Terms 10.5).
G6. License-terminated instances: RDS snapshots them; restore yields a License-Included instance.

═══════════════════════════════════════════════════════════════════════════════
SOURCE S5 — AWS, "Multi-AZ deployments for Amazon RDS for Microsoft SQL Server"
URL: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_SQLServerMultiAZ.html
Retrieved: 2026-08-28. PROOF METHOD: DOC (verbatim).
═══════════════════════════════════════════════════════════════════════════════
H1. RDS SQL Server Multi-AZ uses one of: Database Mirroring (DBM), Always On Availability Groups (AGs),
    or block-level replication (Web Edition 2022 16.00.4215.2+). RDS auto-selects by version/edition.
H2. "There are no additional licensing requirements for Multi-AZ deployments." (also in S4)
H3. Primary + standby share the same endpoint; failover transitions the address to the secondary.
H4. Multi-AZ w/ AGs supported: SQL 2016 EE+, 2017 SE(14.00.3401.7+)/EE, 2019 SE(15.00.4073.23+)/EE,
    2022 SE+EE, 2025 SE+EE. DBM used for older/other SE/EE combos. Block-level replication = 2022 Web.
H5. DBM + in-memory optimization caveat: disable in-memory OLTP before adding Multi-AZ on 2016/2017 EE w/ DBM.
    ⚠️ NOTE vs earlier spec (C7): the RDS Multi-AZ standby is for HA/failover. This doc does NOT state
    the standby is readable; the "read replica" feature is separate. Whether the Multi-AZ standby is
    readable is NOT established here → keep as VERIFY (V4), do not claim either way without a doc quote.

═══════════════════════════════════════════════════════════════════════════════
SOURCE S6 — AWS, "Optimize CPUs for RDS for SQL Server instances"
URL: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/SQLServer.Concepts.General.OptimizeCPU.html
Retrieved: 2026-08-28. PROOF METHOD: DOC (verbatim).
═══════════════════════════════════════════════════════════════════════════════
I1. Optimize CPU configures a specific number of vCPUs while maintaining the same memory, storage, and IOPS
    limits as a full-sized DB instance.
I2. AWS states the feature helps reduce Microsoft Windows OS and SQL Server licensing costs because those
    licensing costs are based on vCPU count.
I3. Supported License Included editions: Enterprise, Standard, Web. Supported BYOM editions: Enterprise,
    Standard, Developer.
I4. Supported families: db.m7i, db.r7i, db.m8i, db.r8i, db.m8a, db.r8a, db.x2m. Minimum size: 2xlarge;
    minimum vCPU count: 4.

═══════════════════════════════════════════════════════════════════════════════
SOURCE S7 — AWS, "Modifying settings for gp3 storage" and "Amazon RDS DB instance storage"
URLS:
  https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIOPS.gp3.html
  https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html
Retrieved: 2026-08-28. PROOF METHOD: DOC (verbatim).
═══════════════════════════════════════════════════════════════════════════════
J1. For gp3 storage, you can reduce Provisioned IOPS and storage throughput.
J2. You can't reduce the storage size after storage is allocated.
J3. RDS for SQL Server gp3 baseline is 3,000 IOPS and 125 MiB/s. The supported gp3 range is 3,000-80,000
    IOPS and 125-2,000 MiB/s for any available storage size.
J4. Actual storage throughput can be limited by instance-level throughput limits even when storage is
    provisioned higher.
