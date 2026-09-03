# Website Audit & Redesign — RDS SQL Server Cost Optimization

Scope: audit of the current server-rendered UI (`src/ui/html.ts`, `src/ui/index.ts`) and a redesign proposal delivered as standalone HTML prototypes in this folder. No existing files are modified.

## Current pages

| Route | Renderer | Purpose | State |
| --- | --- | --- | --- |
| `/cost` | `renderManualUploadPageHtml` | Overview / marketing | Full |
| `/cost/services` | `renderOfferingServicesPageHtml` | Start assessment / download collector | Full |
| `/cost/assessment` | `renderAssessmentPageHtml` | Upload collector ZIP, run analysis | Full (app) |
| `/cost/resources` | `renderSimpleInfoPageHtml` | Guide | **Stub** (1 hero, no content) |
| `/cost/about` | `renderSimpleInfoPageHtml` | About | **Stub** |
| `/cost/login` | `renderSimpleInfoPageHtml` | Login | **Stub** (no form) |
| results | `renderManualUploadResultsHtml` | Fleet + per-server outcomes | Full (app) |

## What works today
- Coherent CSS custom-property token system (`:root` variables).
- Semantic landmarks (`main`, `section`, `nav`, `aside`) and many `aria-label`/`aria-labelledby`.
- Sticky header, keyboard-usable `<details>` dropdowns, export affordances, `aria-live` upload status.

## Findings (issues)

1. **Information architecture is repetitive.** Overview, Services, and Assessment each repeat the same 3-step process and the same collector/assessment CTAs. The value proposition is diluted across three near-identical hero+process pages.
2. **Three stub pages.** Resources, About, and Login render a single hero with one paragraph via `renderSimpleInfoPageHtml`. Login has no form. This hurts trust, wayfinding, and SEO.
3. **Visual noise.** Multiple stacked gradients (body radial+linear washes, a 4-color top bar, gradient headers, gradient panels, gradient nav buttons) compete with the content and read as "busy" rather than authoritative. There are four near-duplicate hero variants (`page-header`, `offering-hero`, `live-hero`, `guide-hero`).
4. **Weak marketing/app separation.** The data-heavy assessment and results screens use the same oversized marketing hero (44px `h1`) as the landing page, so the working surfaces feel less focused.
5. **Accessibility gaps.**
   - No skip-to-content link.
   - Interactive elements define `:hover` but no visible `:focus`/`:focus-visible` ring.
   - Status is conveyed by class name/background only (`signal-row pass/review`) — needs text + icon, not color alone.
   - No `prefers-color-scheme` / reduced-motion handling.
6. **No footer.** No persistent scope, security, or contact reassurance ("SQL Server only", "no automatic RDS changes", "pricing deferred").
7. **Results density.** KPIs and per-server cards are information-dense with limited status color-coding and no progressive disclosure at the fleet level.

## Redesign principles

1. **Two shells, one system.**
   - *Marketing shell* (Overview, Services, About, Resources): confident, spacious, one accent.
   - *App shell* (Assessment, Results): calmer, denser, console-like; smaller headings, more structure.
2. **Calm the palette.** One primary accent (teal `--accent`) + neutral grays. Reserve color exclusively for **status** (green = optimize, amber = aggressive, slate = stay-as-is, red = blocked). Replace stacked gradients with a single subtle surface wash.
3. **Type scale.** Marketing `h1` 40px; app `h1` 28px; consistent `--step-*` scale; line-length capped ~72ch.
4. **Fill the stubs.** Real Resources guide, About/trust, and a working Login form.
5. **Accessibility first.** Skip link, visible `:focus-visible` rings, status chips with icon+label, `aria-live` for async, `prefers-color-scheme: dark`, `prefers-reduced-motion`.
6. **Add a footer** with scope + safeguard messaging on every page.
7. **Results as a decision surface.** Status-colored summary KPIs, per-server accordion, clear "why" and evidence chips.

## Prototype files in this folder

| File | Redesigns |
| --- | --- |
| `styles.css` | Shared design system (tokens, shells, components) |
| `overview.html` | `/cost` marketing landing |
| `services.html` | `/cost/services` |
| `assessment.html` | `/cost/assessment` (app shell + upload form) |
| `results.html` | results page (status KPIs + server accordion) |
| `resources.html` | fills the Resources stub with a real guide |

Open any file directly in a browser (`file://`) — they are self-contained except for the shared `styles.css`.

## Migration note (later, only if approved)
These prototypes are static HTML. Porting into production means translating the markup back into the `pageShell`/render functions in `src/ui/html.ts` and updating the corresponding UI snapshot tests (`tests/ui.test.ts`, `tests/ui-html.test.ts`). That is a separate, test-guarded change and is **not** performed here.
