# Rules Migration Map

Every row maps one existing test case to the rule id now prefixed in that test title. Seed parser/fuzz and future GOLD expected-gap rules live in `documentation/rules.md` and are referenced by the rules guard tests.

| old test file | rule id | old test behavior |
| --- | --- | --- |
| tests/access.test.ts | SRV-ACCESS-001 | allows upload access before registration and login are implemented |
| tests/access.test.ts | SRV-ACCESS-002 | does not require COST_OWNER_EMAIL during the pre-registration upload flow |
| tests/access.test.ts | SRV-ACCESS-003 | does not use requester email until registration and login are implemented |
| tests/api.test.ts | API-API-001 | validates local credentials without exposing login or password |
| tests/api.test.ts | API-API-002 | validates required collector spreadsheet fields |
| tests/api.test.ts | API-API-003 | allows collector run manifests to use non-RDS server identifiers |
| tests/api.test.ts | API-API-004 | parses region from standard RDS endpoints |
| tests/api.test.ts | API-API-005 | returns workload analysis reports and requested exports |
| tests/api.test.ts | API-API-006 | returns validation errors instead of running analysis when required inputs are missing |
| tests/api.test.ts | API-API-007 | validates per-server workload inputs |
| tests/api.test.ts | API-API-008 | exports reports directly as JSON or CSV |
| tests/catalog-refresh-summary.test.ts | ENG-CATALOG-REFRESH-001 | reports new classes, removed classes, and changed capability facts |
| tests/catalog-refresh-summary.test.ts | ENG-CATALOG-REFRESH-002 | renders a review-focused markdown summary |
| tests/catalog.test.ts | ENG-CATALOG-001 | parses SQL Server major versions |
| tests/catalog.test.ts | ENG-CATALOG-002 | reads candidate family preference from catalog-adjacent metadata |
| tests/catalog.test.ts | ENG-CATALOG-003 | allows catalog entries to carry family preference metadata without code changes |
| tests/catalog.test.ts | ENG-CATALOG-004 | accepts a candidate that fits edition, version, memory, IOPS, and throughput |
| tests/catalog.test.ts | ENG-CATALOG-005 | rejects memory underfit |
| tests/catalog.test.ts | ENG-CATALOG-006 | rejects IOPS and throughput underfit |
| tests/catalog.test.ts | ENG-CATALOG-007 | rejects unsupported SQL version |
| tests/catalog.test.ts | ENG-CATALOG-008 | rejects unsupported edition and version-specific Standard core limit |
| tests/catalog.test.ts | ENG-CATALOG-009 | explains why exact lower-vCPU candidate generation produced no candidates |
| tests/catalog.test.ts | ENG-CATALOG-010 | returns the first valid candidate in catalog order supplied by caller |
| tests/catalog.test.ts | ENG-CATALOG-011 | rejects generic catalog rows that are not exact AWS SQL Server orderability evidence |
| tests/catalog.test.ts | ENG-CATALOG-012 | maps copied consolidated catalog rows into regional orderability entries |
| tests/catalog.test.ts | ENG-CATALOG-013 | filters regional catalogs and validates orderability against current region |
| tests/catalog.test.ts | ENG-CATALOG-014 | builds exact SQL Server-visible processor and capability entries from AWS orderability |
| tests/catalog.test.ts | ENG-CATALOG-015 | does not build or accept exact candidates from generic vCPU fallback metadata |
| tests/catalog.test.ts | ENG-CATALOG-016 | filters exact Region, edition, and SQL product build |
| tests/collector.test.js | COL-001 | adds an explicit RunMefirst toggle that defaults off |
| tests/collector.test.js | COL-002 | passes the costoptimization switch through launcher and collector scripts |
| tests/collector.test.js | COL-003 | exports only the required SQL-only Cost Optimization diagnostic CSV |
| tests/collector.test.js | COL-004 | collects verified opt-in memory, file IO, and tempdb evidence in one table |
| tests/collector.test.js | COL-005 | keeps Cost Optimization time-series export and manifest export behind the opt-in toggle |
| tests/collector.test.js | COL-006 | keeps per-minute additions behind the existing opt-in collection toggle |
| tests/collector.test.js | COL-007 | uses compact Cost Optimization collection without legacy MEM and DBIO staging |
| tests/collector.test.js | COL-008 | preserves SQL Server-visible CPU metadata and existing CPU evidence |
| tests/collector.test.js | COL-009 | does not add forbidden high-impact capture patterns |
| tests/collector.test.js | COL-010 | keeps the collector spreadsheet SSAT-style with only approved current comparison fields |
| tests/collector.test.js | COL-011 | exports a non-secret collector run manifest from the standalone collector |
| tests/collector.test.js | COL-012 | uses an existing customer-named output directory instead of nesting another one |
| tests/cost-harness.test.ts | CO-ADV-001 | passes a valid independently selected optimized size |
| tests/cost-harness.test.ts | CO-ADV-002 | fails when production skips a smaller safe candidate |
| tests/cost-harness.test.ts | CO-ADV-003 | fails when a fallback family is selected while an equal lead-family candidate is safe |
| tests/cost-harness.test.ts | CO-ADV-004 | uses catalog family preference metadata for fallback-family justification |
| tests/cost-harness.test.ts | CO-ADV-005 | allows a fallback family when the equal lead-family candidate failed a real gate |
| tests/cost-harness.test.ts | CO-ADV-006 | independently rejects a recommendation backed only by generic catalog metadata |
| tests/cost-harness.test.ts | CO-ADV-007 | rejects a recommendation when preserved CPU evidence is tampered after optimization |
| tests/cost-harness.test.ts | CO-ADV-008 | rejects caller-tampered CPU safety thresholds |
| tests/cost-harness.test.ts | CO-ADV-009 | fails a hands-free result for unnormalized cross-family CPU projection |
| tests/cost-harness.test.ts | CO-ADV-010 | validates physical IOPS P95, P99, and burst behavior from preserved evidence |
| tests/cost-harness.test.ts | CO-ADV-011 | allows physical IOPS P99 to use preserved burst capability |
| tests/cost-harness.test.ts | CO-ADV-012 | fails physical IOPS when P95 only fits burst capability |
| tests/cost-harness.test.ts | CO-ADV-013 | fails physical IOPS harness validation when burst duration exceeds capability |
| tests/cost-harness.test.ts | CO-ADV-014 | validates physical throughput independently from IOPS |
| tests/cost-harness.test.ts | CO-ADV-015 | allows physical throughput P99 to use preserved burst capability |
| tests/cost-harness.test.ts | CO-ADV-016 | fails physical throughput when P95 only fits burst capability |
| tests/cost-harness.test.ts | CO-ADV-017 | accepts blocked results only when blockers are explained |
| tests/cost-harness.test.ts | CO-ADV-018 | fails when recommended size underfits memory, IOPS, or throughput |
| tests/cost-harness.test.ts | CO-ADV-019 | does not fail server-level validation when database attribution evidence is unavailable |
| tests/cost-harness.test.ts | CO-ADV-020 | fails when caller says SSATWeb sizing engine was used |
| tests/cost-harness.test.ts | CO-ADV-021 | fails when SQL edition and license model combination is invalid |
| tests/cost-harness.test.ts | CO-ADV-022 | blocks Enterprise to Standard edition changes without an explicit eligibility audit |
| tests/cost-harness.test.ts | CO-ADV-023 | allows Enterprise to Standard edition changes when eligibility audit passes |
| tests/cost-harness.test.ts | CO-ADV-024 | keeps retired Enterprise-to-Standard oracle out of the active harness scope |
| tests/cost-harness.test.ts | CO-ADV-025 | uses preserved active I/O evidence instead of the retired raw interval oracle |
| tests/cost-harness.test.ts | CO-ADV-026 | fails unsupported ARM/Graviton-style instance families |
| tests/cost-harness.test.ts | CO-ADV-027 | independently validates CPU classification for ${scenario.name} |
| tests/cost-harness.test.ts | CO-ADV-028 | fails CO-L when the reported CPU state disagrees with the independent oracle |
| tests/edition.test.ts | ENG-EDITION-001 | requires all five documented terms and returns a migration recommendation |
| tests/edition.test.ts | ENG-EDITION-002 | does not accept an Enterprise-to-Standard change when target socket count is unknown |
| tests/edition.test.ts | ENG-EDITION-003 | reports unsupported persisted database features separately |
| tests/edition.test.ts | ENG-EDITION-004 | requires explicit vendor support confirmation |
| tests/edition.test.ts | ENG-EDITION-005 | applies socket, core, buffer-pool, columnstore, and per-database memory-optimized limits |
| tests/edition.test.ts | ENG-EDITION-006 | requires exact Standard Edition class and engine-version orderability |
| tests/edition.test.ts | ENG-EDITION-007 | requires an accepted native backup/restore or AWS DMS path |
| tests/edition.test.ts | ENG-EDITION-008 | uses the documented SQL Server 2025 Standard scale limits |
| tests/evidence-window.test.ts | ENG-EVIDENCE-001 | applies every verified duration classification |
| tests/evidence-window.test.ts | ENG-EVIDENCE-002 | assigns preliminary, medium, and high confidence from the verified bands |
| tests/evidence-window.test.ts | ENG-EVIDENCE-003 | calculates duration and reports continuity without inventing an allowable-gap threshold |
| tests/harness/fixtures.test.js | CO-FIX-001 | contains the initial deterministic cases |
| tests/harness/fixtures.test.js | CO-FIX-002 | ${file} matches the fixture envelope |
| tests/io.test.ts | ENG-IO-001 | requires cumulative physical evidence instead of using a maximum-only fallback |
| tests/io.test.ts | ENG-IO-002 | uses actual elapsed time and aggregates files before calculating percentiles |
| tests/io.test.ts | ENG-IO-003 | rejects the complete synchronized sample when any file counter resets |
| tests/io.test.ts | ENG-IO-004 | rejects the complete synchronized sample when an expected file is missing |
| tests/io.test.ts | ENG-IO-005 | does not sum independent database P95 values |
| tests/io.test.ts | ENG-IO-006 | fails P95 and P99 above effective capability headroom |
| tests/io.test.ts | ENG-IO-007 | requires known burst duration and frequency behavior before relying on maximum IOPS |
| tests/io.test.ts | ENG-IO-008 | treats an isolated raw IOPS maximum above capability as context |
| tests/io.test.ts | ENG-IO-009 | validates throughput P95 and P99 independently from IOPS |
| tests/io.test.ts | ENG-IO-010 | requires known throughput burst behavior and ignores an isolated raw maximum |
| tests/io.test.ts | ENG-IO-011 | remaps all four candidate-aware tempdb placement transitions before percentiles |
| tests/io.test.ts | ENG-IO-012 | hard-blocks local NVMe when representative or peak tempdb allocation exceeds capacity |
| tests/io.test.ts | ENG-IO-013 | hard-blocks local NVMe when capacity or representative and peak allocation evidence is missing |
| tests/memory.test.ts | ENG-MEMORY-001 | does not treat high committed memory as the standalone RAM requirement |
| tests/memory.test.ts | ENG-MEMORY-002 | treats one isolated low-memory event as warning context |
| tests/memory.test.ts | ENG-MEMORY-003 | blocks a RAM reduction when low-memory pressure is repeated |
| tests/memory.test.ts | ENG-MEMORY-004 | blocks a RAM reduction when Memory Grants Pending is sustained |
| tests/memory.test.ts | ENG-MEMORY-005 | blocks a candidate below the less-elastic floor with 20 percent headroom |
| tests/memory.test.ts | ENG-MEMORY-006 | preserves low-tail, NUMA, grants, cache, and page-activity evidence |
| tests/memory.test.ts | ENG-MEMORY-007 | downgrades memory confidence when a required signal is incomplete across the window |
| tests/memory.test.ts | ENG-MEMORY-008 | classifies a clean seven-day multi-signal trend as a stable working set |
| tests/memory.test.ts | ENG-MEMORY-009 | classifies persistent 40 percent ReadIOPS pressure coupling as strong |
| tests/memory.test.ts | ENG-MEMORY-010 | treats correlation above 0.40 with less than 20 percent magnitude as weak |
| tests/memory.test.ts | ENG-MEMORY-011 | classifies a persistent 20 to 40 percent increase as meaningful |
| tests/memory.test.ts | ENG-MEMORY-012 | normalizes ReadIOPS by Batch Requests per second when every valid sample has it |
| tests/memory.test.ts | ENG-MEMORY-013 | derives actual Batch Requests per second from cumulative counters before normalization |
| tests/memory.test.ts | ENG-MEMORY-014 | downgrades incomplete evidence and does not use Buffer Cache Hit Ratio alone |
| tests/memory.test.ts | ENG-MEMORY-015 | does not classify RAM reduction as stable when required memory evidence is incomplete |
| tests/memory.test.ts | ENG-MEMORY-016 | requires coupling only for a 25 percent reduction or lower-memory family change |
| tests/optimizer.test.ts | ENG-OPTIMIZER-001 | uses CPU P95 and target utilization |
| tests/optimizer.test.ts | ENG-OPTIMIZER-002 | selects a safe caller-ordered candidate that passes all fit checks |
| tests/optimizer.test.ts | ENG-OPTIMIZER-003 | supports a same-size generational move when SQL-visible vCPU differs |
| tests/optimizer.test.ts | ENG-OPTIMIZER-004 | selects the smaller safe candidate when two candidates pass |
| tests/optimizer.test.ts | ENG-OPTIMIZER-005 | uses a fallback family only when the lead-family path fails a workload gate |
| tests/optimizer.test.ts | ENG-OPTIMIZER-006 | prefers a lead family over an equivalent fallback survivor |
| tests/optimizer.test.ts | ENG-OPTIMIZER-007 | uses catalog family preference metadata when ranking equivalent survivors |
| tests/optimizer.test.ts | ENG-OPTIMIZER-008 | blocks production-safe recommendations when collection window is below 48 hours |
| tests/optimizer.test.ts | ENG-OPTIMIZER-009 | allows the documented sub-48-hour path only with explicit customer confirmation |
| tests/optimizer.test.ts | ENG-OPTIMIZER-010 | returns Aggressive Optimization when a material RAM reduction lacks stable working-set evidence |
| tests/optimizer.test.ts | ENG-OPTIMIZER-011 | uses preliminary confidence for three to six days and high confidence from fourteen days |
| tests/optimizer.test.ts | ENG-OPTIMIZER-012 | does not invent utilization risk bands when verified physical I/O fits |
| tests/optimizer.test.ts | ENG-OPTIMIZER-013 | blocks when CPU target cannot fit candidate vCPU |
| tests/optimizer.test.ts | ENG-OPTIMIZER-014 | blocks when every candidate fails memory, IOPS, or throughput fit checks |
| tests/optimizer.test.ts | ENG-OPTIMIZER-015 | does not classify CPU as underutilized when the lower-vCPU class is not orderable for the SQL version |
| tests/optimizer.test.ts | ENG-OPTIMIZER-016 | uses projected P95 for sizing and projected P99 as the burst safety gate |
| tests/optimizer.test.ts | ENG-OPTIMIZER-017 | applies concurrent Other CPU through the projected total CPU P99 hard gate |
| tests/optimizer.test.ts | ENG-OPTIMIZER-018 | reports an isolated projected excursion without letting the raw maximum replace P99 |
| tests/optimizer.test.ts | ENG-OPTIMIZER-019 | generates and selects an orderable Optimize CPU configuration on the current class |
| tests/optimizer.test.ts | ENG-OPTIMIZER-020 | lowers cross-family confidence without a capacity factor and uses a factor when supplied |
| tests/optimizer.test.ts | ENG-OPTIMIZER-021 | blocks a candidate when physical IOPS P95 exceeds effective capability headroom |
| tests/optimizer.test.ts | ENG-OPTIMIZER-022 | preserves an isolated IOPS maximum as evidence when P95 and P99 fit |
| tests/optimizer.test.ts | ENG-OPTIMIZER-023 | uses an alternate Optimize CPU path when a smaller candidate fails IOPS |
| tests/optimizer.test.ts | ENG-OPTIMIZER-024 | blocks throughput independently when physical P95 exceeds effective capability headroom |
| tests/optimizer.test.ts | ENG-OPTIMIZER-025 | removes time-aligned tempdb demand for a Non-NVMe to NVMe candidate |
| tests/optimizer.test.ts | ENG-OPTIMIZER-026 | blocks an NVMe candidate when peak tempdb allocation exceeds local capacity |
| tests/optimizer.test.ts | ENG-OPTIMIZER-027 | keeps an approved compute downsize on Enterprise when the Standard gate is blocked |
| tests/optimizer.test.ts | ENG-OPTIMIZER-028 | changes to Standard only when every documented edition term passes |
| tests/parser.test.ts | R12 | handles BOM, quoted headers, quoted commas, and escaped quotes |
| tests/parser.test.ts | R13 | normalizes existing collector CPU, memory, IO, throughput, and DB attribution |
| tests/parser.test.ts | R14 | adds advisory evidence from opt-in diagnostics without making hard blockers |
| tests/parser.test.ts | R15 | normalizes consolidated Cost Optimization workload samples |
| tests/parser.test.ts | R16 | derives the memory floor from compact consolidated workload samples without legacy memory CSV |
| tests/parser.test.ts | R17 | uses legacy memory facts to supplement older Cost Optimization samples with US collector timestamps |
| tests/parser.test.ts | R18 | does not duplicate Cost Optimization samples when consolidated and split files are both present |
| tests/parser.test.ts | R19 | ranks physical database drivers by time-integrated shares instead of independent P95 |
| tests/parser.test.ts | R20 | preserves actual elapsed I/O time without replacing it with the collector cadence |
| tests/parser.test.ts | R21 | accepts summary IOPS and throughput aliases when cumulative file I/O is unavailable |
| tests/parser.test.ts | R22 | records missing, duplicate, out-of-order, reset, and invalid samples |
| tests/reports.test.ts | RPT-001 | builds a workload-only recommended report without pricing claims |
| tests/reports.test.ts | RPT-002 | filters AWS-managed rdsadmin from customer-facing database drivers |
| tests/reports.test.ts | RPT-003 | builds a blocked report with dimension-specific action plan |
| tests/reports.test.ts | RPT-004 | uses specific no-optimization wording for missing evidence and orderability blockers |
| tests/reports.test.ts | RPT-005 | surfaces structured memory, wait, file latency, and tempdb advisory evidence |
| tests/reports.test.ts | RPT-006 | reports a blocked Standard opportunity separately while keeping the Enterprise downsize |
| tests/reports.test.ts | RPT-007 | exports one or many workload reports as CSV |
| tests/reports.test.ts | RPT-008 | exports a dependency-free PDF executive summary |
| tests/reports.test.ts | RPT-009 | builds a descriptive scaled-down vs stay-as-is fleet summary |
| tests/samples-regression.test.ts | GOLD-SUITE-001 | contains exactly the ten approved gold scenarios and no root legacy ZIPs |
| tests/samples-regression.test.ts | GOLD-SUITE-002 | uses valid collector schemas and preserves required diagnostics in every package |
| tests/samples-regression.test.ts | GOLD-SUITE-003 | produces the exact expected recommendation or blocker for every gold scenario |
| tests/samples-regression.test.ts | GOLD-SUITE-004 | covers catalog-gap fallback, missing storage facts, and tempdb-dominant advisory evidence |
| tests/samples-regression.test.ts | GOLD-SUITE-005 | supports a multi-server upload with independent recommendation and blocker results |
| tests/server.test.ts | SRV-SERVER-001 | contains only the approved standalone collector files |
| tests/server.test.ts | SRV-SERVER-002 | returns validation errors instead of crashing when the analyze request has no body |
| tests/server.test.ts | SRV-SERVER-003 | admits only exact AWS SQL Server processor metadata into the runtime catalog |
| tests/server.test.ts | SRV-SERVER-004 | builds an analysis request from spreadsheet and collector ZIP files |
| tests/server.test.ts | SRV-SERVER-005 | generates same-size lead-family candidates before smaller sizes |
| tests/server.test.ts | SRV-SERVER-006 | uses catalog family preference metadata for same-size candidate ordering |
| tests/server.test.ts | SRV-SERVER-007 | generates same-size Optimize CPU rescue candidates before smaller I/O paths |
| tests/server.test.ts | SRV-SERVER-008 | does not request inline exports by default for browser uploads |
| tests/server.test.ts | SRV-SERVER-009 | builds an analysis request from compact CO workload samples without legacy memory CSV |
| tests/server.test.ts | SRV-SERVER-010 | uses alternate current-config CSV when the collector run manifest is missing |
| tests/server.test.ts | SRV-SERVER-011 | assesses collector evidence when current RDSSize is missing |
| tests/server.test.ts | SRV-SERVER-012 | accepts legacy summary TotalIOPs evidence when compact file_io rows are unavailable |
| tests/server.test.ts | SRV-SERVER-013 | classifies required collector CSVs by header when filenames are different |
| tests/server.test.ts | SRV-SERVER-014 | blocks when CPUINFO evidence is missing |
| tests/server.test.ts | SRV-SERVER-015 | blocks when memory evidence is missing |
| tests/server.test.ts | SRV-SERVER-016 | blocks when I/O evidence is missing |
| tests/server.test.ts | SRV-SERVER-017 | preserves approved Standard Edition confirmations and collector edition evidence |
| tests/server.test.ts | SRV-SERVER-018 | groups multi-server package metrics by manifest ServerName filename prefix |
| tests/server.test.ts | SRV-SERVER-019 | fails closed when a multi-server package cannot isolate one server's files |
| tests/server.test.ts | SRV-SERVER-020 | uses endpoint region to filter regional catalog rows |
| tests/server.test.ts | SRV-SERVER-021 | falls back to us-east-1 and labels evidence when endpoint region cannot be inferred |
| tests/server.test.ts | SRV-SERVER-022 | uses CPUINFO current vCPU when current RDSSize is missing from the catalog |
| tests/server.test.ts | SRV-SERVER-023 | allows upload assembly without owner email until registration and login are implemented |
| tests/server.test.ts | SRV-SERVER-024 | does not treat installed memory or SQL target memory as required workload memory |
| tests/ui-html.test.ts | UI-HTML-001 | renders a concise business overview separate from the assessment workspace |
| tests/ui-html.test.ts | UI-HTML-002 | renders offering services on their own page |
| tests/ui-html.test.ts | UI-HTML-003 | renders the focused assessment upload contract |
| tests/ui-html.test.ts | UI-HTML-004 | renders descriptive results without password or dollar savings claims |
| tests/ui-html.test.ts | UI-HTML-005 | keeps single-server analysis details visible without the multi-server collapse wrapper |
| tests/ui-html.test.ts | UI-HTML-006 | renders reason-only resource gates without n/a metric rows |
| tests/ui-html.test.ts | UI-HTML-007 | renders short collection windows as evidence checks while keeping fallback visible |
| tests/ui.test.ts | UI-VIEW-001 | builds a descriptive scaled-down vs stay-as-is results view model |
| tests/ui.test.ts | UI-VIEW-002 | explains blocked metric cards when no candidate is selected |
| tests/ui.test.ts | UI-VIEW-003 | does not show AWS-managed rdsadmin as a customer database driver |
| tests/ui.test.ts | UI-VIEW-004 | omits not-applicable metric rows for reason-only resource gates |
| tests/ui.test.ts | UI-VIEW-005 | keeps large multi-server display payloads bounded and customer-facing |
| tests/upload.test.ts | API-UPLOAD-001 | runs one manual upload using derived lower-vCPU candidate order |
| tests/upload.test.ts | API-UPLOAD-002 | preserves per-server reporting for multiple manual uploads |
| tests/upload.test.ts | API-UPLOAD-003 | returns descriptive validation errors for incomplete manual uploads |
| tests/workload.test.ts | ENG-WORKLOAD-001 | runs compute, independent harness, and report assembly for one server |
| tests/workload.test.ts | ENG-WORKLOAD-002 | keeps pricing unavailable from blocking a technical optimization result |
| tests/workload.test.ts | ENG-WORKLOAD-003 | fails closed when current storage provisioning facts are missing |
| tests/workload.test.ts | ENG-WORKLOAD-004 | preserves per-server results for multi-server uploads |
