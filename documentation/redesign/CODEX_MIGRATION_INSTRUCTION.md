# Codex Instruction — Migrate current UI to the consulting redesign

## 0. Read first (project authority)
Before editing, read and follow, per `AGENTS.md`:
- `AGENTS.md`
- `documentation/COST_OPTIMIZATION_END_TO_END_SPEC.md`
- `documentation/MVP_SPEC.md`
- `documentation/ARCHITECTURE.md`
- `documentation/TASKS.md`
- `documentation/rules.md`

State, before editing, the exact task, the files you will change, and the spec/section that authorizes a **presentation-only** UI change. This task changes **presentation only**. It must not change collector behavior, the optimizer/engine, the harness, the catalog, routes, request/response contracts, or any user-facing decision wording semantics.

## 1. Objective
Replace the current server-rendered UI look-and-feel with the approved **consulting** design prototype, without changing behavior, routes, data, or copy semantics.

- **Design source of truth (static prototypes, do not ship as-is, translate them):**
  `documentation/redesign/consulting/`
  - `styles.css` — design system (blue-favored palette, serif headlines, matrices, dark bands, gauges)
  - `index.html` → maps to the Overview page
  - `approach.html` → maps to the Resources/guide page
  - `assessment.html` → maps to the Assessment page
  - `results.html` → maps to the Results page
- **Production target (edit these):**
  - `src/ui/html.ts` — all `render*Html` functions + `pageShell` (CSS in the `<style>` block) + `siteHeader`
  - `src/ui/index.ts` — only if a view-model field must be added; prefer no view-model changes

## 2. Guardrails (hard requirements)
1. **Behavior-preserving.** Keep every route and its handler unchanged (`src/server/index.ts`): `/cost`, `/cost/services`, `/cost/assessment`, `/cost/resources`, `/cost/about`, `/cost/login`, `/cost/collector`, `POST /cost/analyze`, `/healthz`.
2. **Form contract unchanged.** The assessment form must keep `method="post" action="/cost/analyze" enctype="multipart/form-data"`, the hidden `exportFormats` input, `name="customerName"`, `name="collectorPackages"` (`multiple`, `accept=".zip"`), and the existing upload-status behavior (`data-upload-form`, `data-upload-status`, `aria-live`). Preserve any inline `<script>` in `pageShell`.
3. **Export links unchanged.** Results export anchors/buttons keep their `href`/`download`/`disabled` logic and labels from the view model.
4. **Wording rule (AGENTS.md "User-Facing Wording").** Do **not** introduce the word "recommend"/"recommended" into user-facing prose. Use `optimized` and `as is`. The prototype uses "Recommended/Aggressive/Stay as is" as status labels — when porting, keep the **existing production status label mapping** (`displayStatusLabel`, `customerGateLabel` in `src/ui/index.ts`); do not hardcode new decision words. Status tags must be driven by the view model, not literals.
5. **All dynamic content stays dynamic.** Everything currently rendered from the view models (`ManualUploadPageViewModel`, `ManualUploadResultsViewModel`, `ServerResultsCard`, fleet counts, evidence window, database drivers, blockers, candidate/edition details, safeguards, required columns) must remain bound to those fields via `escapeHtml`/`escapeAttribute`. Do not drop server/fleet detail that the current results page shows.
6. **No new runtime dependencies.** Inline CSS only (as today). Prototype visuals use pure CSS/Unicode; keep it that way (no external fonts, no chart libraries).
7. **Accessibility must not regress and should improve.** Keep landmarks and `aria-*`; add the prototype's skip link, visible `:focus-visible` rings, `prefers-reduced-motion` handling, and ensure status is conveyed by text + shape/label, not color alone.
8. **Do not** touch: `src/optimizer`, `src/memory`, `src/io`, `src/edition`, `src/evidence-window`, `src/parser`, `src/catalog`, `src/harness`, `collector/**`, or any fixtures.

## 3. Design tokens to port
Move the `:root` variables and component CSS from `documentation/redesign/consulting/styles.css` into the `<style>` block of `pageShell` in `src/ui/html.ts`, replacing the current token/component CSS. Keep names generic (they are prototype-local). Ship the current palette:
- paper `#eaf0f7`, panel `#ffffff`, ink `#0f1b2e`, brand `#17457e`, brand-ink `#0f2f59`, accent `#2f77c2`, line `#d3dded`; status `ok #1f6f8f`, `warn #9a6a1f`, `stay #55606f`, `danger #9c342a`.
- Serif display stack for h1–h3; Inter/system sans for body.

## 4. File-by-file mapping
| Prototype | Production function (`src/ui/html.ts`) | Notes |
| --- | --- | --- |
| `styles.css` | `pageShell` `<style>` | Replace tokens + components; keep any existing `<script>` |
| header markup in every prototype | `siteHeader` | Rework nav to the new masthead; keep the same links/routes; keep it keyboard-accessible |
| `index.html` | `renderManualUploadPageHtml` | Hero + decision-panel visual + capability matrix + dark flow band; keep CTAs pointing to existing routes |
| `assessment.html` | `renderAssessmentPageHtml` | Keep the exact upload form contract (§2.2) and required-columns/safeguards lists from the view model |
| `results.html` | `renderManualUploadResultsHtml` + `renderServerCard`/`renderFleetServerRows`/`fleetOutcomeOverview` | Fleet stat band + per-server gauges + status tags, all bound to the view model; keep single-vs-multi-server branching |
| `approach.html` | `renderSimpleInfoPageHtml` (Resources) | Replace the stub with the structured guide; keep the function signature/callers |
| (n/a) | `renderOfferingServicesPageHtml` | Restyle to the new system; keep the two service actions and routes |
| About / Login (`renderSimpleInfoPageHtml`) | same | Restyle; optionally add a real Login form later (out of scope unless requested) |

## 5. Steps
1. Port the CSS into `pageShell`; keep the existing `<script>` and `<meta>`/`<title>` logic.
2. Rebuild `siteHeader` to the new masthead (same routes/labels).
3. Migrate each `render*Html` body to the corresponding prototype markup, re-inserting every dynamic binding (see §2.5). Convert prototype gauge widths/donut `--v` to values computed from the view model where a metric exists; otherwise omit the gauge rather than fake a number.
4. Ensure status tags/chips derive from `displayStatusLabel`/view-model status, not literals.
5. Keep the export row and fleet/summary tiles wired to `view.exportActions` and `view.fleet`.

## 6. Tests (must update and pass)
- Update snapshot/assertion tests that inspect markup: `tests/ui.test.ts`, `tests/ui-html.test.ts`. Adjust expected class names/structure to the new design **only** where presentation changed; keep assertions that verify dynamic content, routes, form fields, export links, and wording rules.
- Do not weaken tests that assert the absence of "recommend" in user-facing copy or that assert the form action/fields.
- If a test encodes required copy (safeguards, required columns, pricing-deferred notice), keep that copy present in the new markup.

## 7. Verification (run all; paste results in the PR)
1. `npm run build:app` — must compile clean.
2. `npm run build` (typecheck) and the repo test command (`npm test`) — all green; UI tests updated.
3. `npm run server`, then load each route and confirm:
   - `/cost`, `/cost/services`, `/cost/assessment`, `/cost/resources`, `/cost/about`, `/cost/login` render with the new design and no console errors.
   - Upload a known fixture ZIP (e.g. `collector/ketnra v2/multiserver-fixtures/edge-multi-az.zip`) through `/cost/analyze`; the results page renders fleet summary, per-server detail, status tags, and working export links.
4. Accessibility spot check: skip link works, visible focus rings, tab order intact, status not color-only.
5. Confirm no diffs outside `src/ui/**` and the two UI test files (plus generated `dist` from build).

## 8. Acceptance criteria
- All routes render the consulting design; behavior, routes, form contract, and exports are unchanged.
- No "recommend"-family words in user-facing prose; decision labels come from the existing mapping.
- `npm run build:app`, typecheck, and tests pass; UI tests updated to the new markup.
- No changes outside the UI layer and its tests.

## 9. Rollout note (AGENTS.md)
If work is done in a `.codex/worktrees/...` worktree, it is **not complete** until the same changes are applied and verified in the canonical project root (`C:\Users\bacrifai\Downloads\Projects\rdscostoptimization`) via `npm run build:app` and a route check. Do not create new worktrees/tasks unless explicitly asked.

## 10. Out of scope (do not do here)
- Pricing, storage redesign, engine/harness/catalog/collector changes.
- New runtime dependencies or external assets.
- A real authentication backend for `/cost/login` (visual only unless separately approved).
