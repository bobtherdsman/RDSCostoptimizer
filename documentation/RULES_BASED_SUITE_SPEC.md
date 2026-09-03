# Rules-Based Regression Suite Spec (for Codex implementation)

Status: DRAFT — implementation-ready, with user-approved Windows-first verification scope
Objective: Replace the current ad-hoc test suite with a SINGLE rules-driven regression suite. `rules.md` becomes the one source of truth for every behavior we assert. Existing test files are RETIRED once every behavior they cover is represented as a rule in `rules.md` and backed by a rule-tagged test.

Hard guardrail: Do NOT change engine behavior. No edits to `src/optimizer`, `src/io`, `src/memory`, `src/edition`, `src/catalog`, `src/parser`, `src/harness` logic. This is a test/fixture/spec restructure only. If migrating a test reveals an engine bug, record it as an `expected-gap` rule and report — do NOT fix the engine here.

Repo: rdscostoptimization (TypeScript, ESM, `node --test`).
Run: `npm test` from the project root. This project is collector-first and Windows/PowerShell-oriented; Windows `npm test` is the required local verification path. Linux CI is optional portability evidence, not a production-readiness blocker for this collector workflow.

---

## Current state (verified 2026-09-02) — what must be preserved as rules

- Typecheck passes. Full suite: ~207 `it()` cases across 19 test files, all pass from repo root. (163 top-level subtests reported by the runner; 207 total `it()` including nested — migrate ALL, not just top-level.)
- 19 test files under `tests/` (access, api, catalog, collector, cost-harness, edition, evidence-window, harness/fixtures, io, memory, optimizer, parser, reports, samples-regression, server, ui, ui-html, upload, workload).
- Harness `src/harness/` is a genuine INDEPENDENT oracle (imports only `contracts/types` + `catalog`, never the optimizer). 31 `CO-*` checks. 27 adversarial scenarios in `tests/cost-harness.test.ts`.
- 10 gold fixtures at `samples/tool-regression/gold-01..10-*.zip`, wired in `tests/samples-regression.test.ts`.

Every one of these behaviors MUST survive the migration as a rule. Retirement is not deletion of coverage — it is re-expressing coverage as rules.

---

## Deliverable: `documentation/rules.md`

Single source of truth. One row per rule. Columns EXACTLY:

`id | area | status | invariant | input/fixture | expected | pins`

- `id`: stable, namespaced by area. Never renumber. Prefixes (EVERY existing test file maps to one — no file left unmapped):
  - `CO-*` = harness oracle checks (reuse existing CO- codes verbatim) — from `tests/cost-harness.test.ts`, `tests/harness/fixtures.test.js`.
  - `GOLD-*` = gold fixture end-to-end outcomes — from `tests/samples-regression.test.ts`.
  - `R*` = parser robustness, `F*` = parser fuzz — from `tests/parser.test.ts` + new.
  - `ENG-*` = engine-math unit rules — from `tests/optimizer.test.ts`, `io.test.ts`, `memory.test.ts`, `edition.test.ts`, `catalog.test.ts`, `workload.test.ts`, `evidence-window.test.ts`.
  - `RPT-*` = report generation — from `tests/reports.test.ts`.
  - `COL-*` = collector package/download integrity — from `tests/collector.test.js`.
  - `API-*` = api behavior — from `tests/api.test.ts`, `tests/upload.test.ts`.
  - `UI-*` = UI/html rendering — from `tests/ui.test.ts`, `tests/ui-html.test.ts`.
  - `SRV-*` = server routes/access — from `tests/server.test.ts`, `tests/access.test.ts`.
  - Coverage check: the 19 files are cost-harness, harness/fixtures, samples-regression, parser, optimizer, io, memory, edition, catalog, workload, evidence-window, reports, collector, api, upload, ui, ui-html, server, access — ALL mapped above.
- `area`: parser | harness | optimizer | io | memory | edition | catalog | workload | evidence-window | reports | collector | api | ui | server | access | fixtures.
- `status`: `enforced` (must pass) | `expected-gap` (known engine defect; documented xfail until fixed).
- `input/fixture`: crafted string, or fixture filename, or "unit input".
- `pins`: audit finding `file:line` where relevant, else `—`.

### Seed rows — parser (new coverage, highest risk)

```
id  | area   | status       | invariant                                                        | input/fixture                                     | expected                                          | pins
R1  | parser | enforced     | Duplicate headers have defined, documented behavior              | two columns with same name                        | last-wins documented, or warning/error            | csv.ts:13
R2  | parser | enforced     | Stray unescaped " mid-field must not corrupt following rows      | a,b"c,d\n1,2,3                                     | only affected field affected; later rows intact   | csv.ts:34
R3  | parser | enforced     | Unterminated quote surfaces a diagnostic, not a giant cell       | field opens " never closes                        | structured error/flagged, not one swallowed cell  | csv.ts parseCsvRows
R4  | parser | enforced     | BOM + CRLF/LF/CR parse identically                              | same data in 4 line-ending/BOM variants           | identical parsed rows                             | (lock; handled)
R5  | parser | enforced     | Row column-count mismatch handled explicitly                    | rows with extra / fewer cols                      | extra dropped/flagged; missing padded (documented)| csv.ts:13
R6  | parser | expected-gap | Non-numeric where numeric expected is NOT a legit 0             | abc in an IOPS/mem numeric cell                    | rejected or marked missing, not silently 0        | stats.ts:44
R7  | parser | expected-gap | Decimal-comma not mis-scaled                                    | "1,5"                                             | not parsed as 15                                  | stats.ts:43
R8  | parser | expected-gap | IOPS/throughput from ACTUAL inter-sample delta, not fixed 60s    | samples at 30s cadence                            | rates from real elapsed seconds                   | index.ts:253,274
R9  | parser | expected-gap | Sample bucketing deterministic regardless of host TZ            | bare timestamps under TZ=UTC and TZ=NY            | identical alignment/results                       | synchronized-samples.ts:532
R10 | parser | enforced     | Counter reset / negative delta drops that interval             | descending cumulative counter                     | interval dropped, not negative rate               | (lock; handled)
R11 | parser | expected-gap | Missing Sample_ID+CollectionTime must not collapse to one bucket | IO rows lacking both keys                          | not a single-value "single" bucket distribution   | index.ts:278
F1  | parser | enforced     | Parser never throws unhandled                                   | randomized CSV                                    | returns rows or structured error                  | fuzz
F2  | parser | enforced     | No stat/percentile returns NaN/Infinity for finite input        | randomized numeric sets                           | always finite                                     | fuzz
F3  | parser | enforced     | IOPS/thru/mem-floor outputs ≥0 & finite, or "unavailable"       | randomized samples                                | never negative/NaN silently                       | fuzz
F4  | parser | enforced     | Parsed rows ≤ non-empty input lines; no undefined-as-number     | randomized CSV                                    | bounded; no silent coercion                       | fuzz
F5  | parser | enforced     | Benign mutations yield identical parsed evidence (idempotence)   | valid fixture + whitespace/quote/CRLF mutations   | same parsed evidence                              | fuzz
```

### Seed rows — gold fixtures (end-to-end outcomes)

```
id      | area     | status   | invariant                                   | input/fixture                       | expected                                              | pins
GOLD-01 | fixtures | enforced | safe downsize recommended                   | gold-01-safe-downsize.zip           | status=recommended, rec=db.r8i.8xlarge                | —
GOLD-02 | fixtures | enforced | memory pressure blocks                       | gold-02-memory-blocked.zip          | status=not_recommended, blocker=MEMORY_PRESSURE_DETECTED | —
GOLD-03 | fixtures | enforced | IOPS blocks                                  | gold-03-iops-blocked.zip            | blocker=IOPS_P95_EFFECTIVE_CAPABILITY_EXCEEDED        | —
GOLD-04 | fixtures | enforced | throughput blocks                            | gold-04-throughput-blocked.zip      | blocker=THROUGHPUT_P95_EFFECTIVE_CAPABILITY_EXCEEDED  | —
GOLD-05 | fixtures | enforced | CPU blocks                                   | gold-05-cpu-blocked.zip             | blocker=CPU_P95_TARGET_EXCEEDED                       | —
GOLD-06 | fixtures | enforced | short collection blocks                      | gold-06-short-collection.zip        | blocker=COLLECTION_WINDOW_TOO_SHORT                   | —
GOLD-07 | fixtures | enforced | sql version not orderable blocks             | gold-07-sql-version-blocked.zip     | blocker=SQL_VERSION_NOT_ORDERABLE                     | —
GOLD-08 | fixtures | enforced | edition not supported blocks                 | gold-08-edition-blocked.zip         | blocker=EDITION_NOT_SUPPORTED                         | —
GOLD-09 | fixtures | enforced | catalog gap / storage capability unknown     | gold-09-catalog-gap-fallback.zip    | blocker=IOPS_STORAGE_CAPABILITY_UNKNOWN               | —
GOLD-10 | fixtures | enforced | tempdb-dominant still downsizes              | gold-10-tempdb-dominant.zip         | status=recommended, rec=db.r8i.8xlarge                | —
GOLD-11 | fixtures | expected-gap | multi-server mixed (A downsize, B blocked) | NEW multi-server-mixed.zip | per-server outcomes + fleet counts | pending approved source fixture package
GOLD-12 | fixtures | expected-gap | cross-family path exercised | NEW cross-family.zip | low-confidence/aggressive flagged; fallback justified | pending approved source fixture package
GOLD-13 | fixtures | expected-gap | enterprise edition + EE→SE eligibility | NEW enterprise-edition.zip | edition-change decision correct | pending approved source fixture package
GOLD-14 | fixtures | expected-gap | Multi-AZ carried through | NEW multi-az.zip (MultiAz=true) | Multi-AZ in result; sizing unaffected | pending approved source fixture package
```

### Seed rows — ALL other areas (MIGRATED from existing tests): harness, engine, reports, collector, api, ui, server

Do NOT hand-invent these. Codex must ENUMERATE every `it(...)` / assertion in the 19 existing test files (~207 cases) and create one rule per distinct behavior, reusing `CO-*` codes where present. Fill this section by migration, not guesswork. Minimum required (nothing omitted):
- All 31 `CO-*` harness checks → `CO-*` rules (verbatim ids), status `enforced` — cost-harness, harness/fixtures.
- All 27 adversarial scenarios in `tests/cost-harness.test.ts` → rules (share CO- ids or add `CO-ADV-*`).
- Each optimizer/io/memory/edition/catalog/workload/evidence-window unit assertion → an `ENG-*` rule.
- Each `tests/reports.test.ts` assertion → `RPT-*` rule.
- Each `tests/collector.test.js` assertion → `COL-*` rule.
- Each api/upload assertion → `API-*`; each ui/ui-html assertion → `UI-*`; each server/access assertion → `SRV-*`.
- Every one of the ~207 `it()` cases must map to exactly one rule id in the migration map (Step 1). Zero unmapped.

The migration is complete only when: for every assertion in the old suite there exists a rule whose test reproduces it.

---

## Implementation steps (order matters)

1. **Enumerate.** List every `it(...)`/assertion across all 19 test files. Produce a migration map: old test → new rule id. Commit the map as `documentation/rules-migration-map.md` for review.
2. **Populate `rules.md`** with all rows (seed rows above + every migrated behavior). This is the acceptance gate for retirement — if it isn't in `rules.md`, it isn't covered.
3. **Add the rule-tagged tests.** Each test title starts with its rule id (e.g. `it("CO-I-CPU-FIT: ...")`, `it("R6: ...")`, `it("GOLD-03: ...")`). Group by area. Parser R*/F* use crafted strings + a seeded PRNG (no new dep unless owner approves `fast-check` pinned; fuzz budget <30s / ~500–1000 cases; log seed on failure).
4. **Add the coverage-guard test** (see below).
5. **Retire old tests.** Once the guard is green AND the migration map shows 100% coverage, DELETE the superseded old test files (or fold them entirely into the rule-tagged files). No behavior may be dropped. Keep the collector download / samples-regression fixture wiring if it is the mechanism a GOLD-* rule uses.
6. **Track future fixtures** GOLD-11..14 (multi-server-mixed, cross-family, enterprise-edition, multi-az) as `expected-gap` rules until approved source collector packages exist. Do not invent or casually synthesize gold ZIPs.
7. **Checksum fixtures.** Commit `samples/tool-regression/CHECKSUMS.txt` (sha256 per committed zip). A GOLD-* fixture byte change fails unless CHECKSUMS.txt is updated in the same change.

---

## Coverage guard (the mechanism that makes rules.md authoritative)

One test that:
1. Parses `documentation/rules.md`; extracts every `id` + `status`.
2. Scans all test files for each id token (title prefix).
3. FAILS if any rule id has no referencing test (no orphan rules).
4. FAILS if any test title uses a rule id NOT in `rules.md` (no orphan tests — forces everything through the contract).
5. `enforced` rules must PASS. `expected-gap` rules are documented xfails and must CURRENTLY fail (so a later engine fix trips the guard, reminding you to flip status to `enforced`).

This is what turns `rules.md` into a guardrail: the contract and the suite cannot diverge — CI fails if they do.

---

## How this is used for regression

- `rules.md` is the contract, the regression guardrail, and the live punch-list of known gaps, all in one file.
- Add a behavior → add a rule → guard forces a test.
- Break a behavior → the rule's test fails, naming the rule id + `pins` finding.
- Fix an `expected-gap` engine defect → flip status to `enforced`; guard enforces it forever.
- Reviewers read one file (`rules.md`) to know exactly what the system guarantees.

---

## Known engine gaps captured as `expected-gap` rules (do NOT fix here)

- csv.ts:13 duplicate headers overwrite silently (R1/R5).
- csv.ts:34 stray `"` corrupts following rows (R2/R3).
- stats.ts:44 non-numeric → 0 (R6); stats.ts:43 strips all commas (R7).
- index.ts:253,274 hardcoded 60s interval (R8); index.ts:278 missing keys → one "single" bucket (R11).
- synchronized-samples.ts:285 counter classification by key presence; :532 bare timestamps host-local (R9).
- optimizer/index.ts ~195 empty candidate list → Not-Recommended with empty blockers/no reason (add `ENG-EMPTY-CANDIDATE`, expected-gap).
- cross-family `normalizedPerCoreCapacity` never populated → factor 1 (GOLD-12 / `ENG-CROSSFAMILY`).
- catalog/index.ts:293 `sqlProductVersionMatches` needs ≥3 version parts ("15.0" fails) (`ENG-VERSION-PARTS`, expected-gap).
- edition/index.ts:35 whitelist "changecapture" vs normalized "changedatacapture" (`ENG-EE-FEATURE-NORMALIZE`, expected-gap).

---

## Definition of done

- `documentation/rules.md` committed; every current behavior + new parser rules represented.
- `documentation/rules-migration-map.md` shows old-test → rule for 100% of prior assertions.
- Every rule id has exactly one referencing test; coverage guard green; no orphan rules or orphan tests.
- Superseded old test files retired (deleted/folded) with ZERO loss of behavior coverage.
- `enforced` rules pass; `expected-gap` rules are documented xfails, flagged to owner in the PR with reproducing input.
- GOLD-11..14 are either approved real fixtures committed and checksummed, or explicitly tracked as `expected-gap` rules.
- `npm test` green on Windows. No engine `src/**` behavior changed.
