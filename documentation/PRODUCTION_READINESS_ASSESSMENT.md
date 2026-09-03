# Production Readiness Assessment

**Date:** 2026-09-02  
**Project:** Standalone RDS SQL Server Cost Optimization  
**Assessment type:** Deployment readiness for an SSATWeb-like hosted tool  
**Scope:** Current repository state and documented deployment path only

## Executive Verdict

The application is **ready for a controlled internal pilot or owner-operated demo after the current work is committed, pushed, and deployed from a clean revision**.

It is **not yet ready for broad external customer production** without operational hardening around authentication, upload security, monitoring, and deployment discipline.

The core workload-fit engine, collector-first flow, catalog validation, independent harness, reports, UI, and regression rules are in good local shape. The remaining production-readiness concerns are operational, security, and release-management items rather than sizing-engine correctness items.

## Current Facts

- The tool is standalone and does not call SSATWeb sizing logic.
- The customer flow is collector-first: download collector, run collector, upload ZIP, analyze workload optimization, view/export results.
- Runtime is Node.js/Express with `dist/server/index.js`.
- Main route is `/cost`.
- Health route is `/healthz`.
- Local startup was verified at `http://127.0.0.1:3001/cost`.
- Windows verification passed after the rules migration:
  - `229` tests
  - `216` passing
  - `13` expected-gap todos
  - `0` failures
- Task 19, Task 20, and Task 21 are complete under the agreed scope.
- Task 22 and Task 23 are newly created and not implemented.
- The working tree is currently dirty and must not be deployed as-is.

## Production Readiness Classification

| Area | Status | Notes |
| --- | --- | --- |
| Workload optimization engine | Ready for pilot | Covered by optimizer, I/O, memory, edition, catalog, workload, and harness tests. |
| Independent harness | Ready for pilot | Harness verifies selected results and remains separate from production recommendation logic. |
| Collector flow | Ready for pilot | Collector mode and package integrity are covered by tests; Windows/PowerShell flow is primary. |
| Manual upload flow | Ready for pilot | One-server and multi-server upload behavior is covered by API/server/upload tests. |
| Catalog/orderability | Ready for pilot | Exact RDS SQL Server orderability is used; manual refresh workflow exists. |
| Reports/UI | Ready for pilot with known UX cleanup | Task 22 remains open to simplify noisy `Next Action` wording. |
| CSV/JSON/PDF exports | Partially ready | Current export behavior exists, but Task 23 is open for improved download UX and business PDF. |
| Pricing/savings | Not in current production scope | Detailed pricing and dollar savings are intentionally deferred unless a pricing source and formula are approved. |
| Authentication | Not external-customer ready | Current owner control uses `COST_OWNER_EMAIL`; real auth is recommended before external customers. |
| Upload security | Pilot only | Malware scanning, retention controls, and rate limiting are not implemented. |
| Monitoring/operations | Needs deployment setup | Cloud logs, alarms, health checks, backups, and rollback process must be configured during deployment. |
| Release management | Not ready until committed | Current working tree includes uncommitted changes and unrelated file changes that must be resolved before deploy. |

## Go / No-Go

### Go for controlled pilot after these are done

1. Commit the completed work to git.
2. Push the branch.
3. Review the diff.
4. Confirm the dirty working tree is clean or intentionally scoped.
5. Run required Windows verification from the committed revision:

   ```powershell
   npm ci
   npm run build
   npm test
   ```

6. Deploy using the documented path in `documentation/AWS_DEPLOYMENT_GUIDE.md`.
7. Configure required environment variables.
8. Run the deployment smoke test.

### No-go for broad external production until these are addressed

- Real authentication replaces or wraps owner-email-only upload access.
- Upload size, retention, scanning, and abuse controls are defined.
- HTTPS, logging, monitoring, alerting, and rollback are configured.
- Deployment is from a clean committed revision.
- Task 22 is completed if customer-facing wording quality is part of the release bar.
- Task 23 is completed if business PDF/download packaging is part of the release bar.
- Pricing remains absent unless the pricing model is explicitly approved and tested.

## Required Environment

Set these in the deployed runtime:

```text
COST_OWNER_EMAIL=<approved owner email>
AWS_REGION=us-east-1
PORT=<platform-provided port or 3001>
NODE_ENV=production
```

Important:

- `COST_OWNER_EMAIL` controls current owner-only upload access.
- `AWS_REGION` is the fallback Region when an uploaded endpoint cannot be parsed.
- The app does not need RDS modify permissions.
- The current runtime does not need AWS data-plane permissions unless the deployment platform requires them.

## Deployment Path Similar to SSATWeb

This project should be deployed as a standalone web app, not merged into SSATWeb.

Recommended first hosted options:

| Option | Fit | Notes |
| --- | --- | --- |
| App Runner | Best managed option | Good for simple managed HTTPS, source deploy, and health checks. |
| Lightsail | Cheapest always-on pilot | Good for low-cost demo/pilot; requires OS, Nginx, TLS, and PM2 management. |
| Elastic Beanstalk | Acceptable EC2-managed option | More moving parts; useful if the team already uses it. |

For SSATWeb-like deployment behavior, App Runner is the cleanest managed choice. Lightsail is the cheapest practical pilot choice.

## Required Deployment Artifacts

Deployment package must include:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.app.json`
- `src/**`
- `src/catalog/data/rds-sqlserver-orderable.json`
- `src/catalog/data/family-preferences.json`
- `src/catalog/data/approved-regions.json`
- `collector/costoptimization/**`

Do not deploy without:

- exact runtime catalog data
- collector package files
- production environment variables
- clean committed source

## Verification Gates

### Pre-deploy

Run from project root:

```powershell
npm ci
npm run build
npm test
```

Expected:

- TypeScript build passes.
- Full Windows test suite passes.
- Rules coverage guard passes.
- No failed tests.
- Expected-gap todos remain visible.

### Post-deploy smoke test

Run against the deployed host:

```bash
curl -i https://<host>/healthz
curl -I https://<host>/cost
curl -I https://<host>/cost/services
curl -I https://<host>/cost/assessment
curl -I https://<host>/cost/collector
```

Expected:

- `/healthz` returns `200`.
- `/cost`, `/cost/services`, and `/cost/assessment` return HTML.
- `/cost/collector` returns a ZIP download response.

Manual smoke:

1. Open `/cost`.
2. Download the collector.
3. Open Start Assessment.
4. Upload a known-safe regression package in a non-production environment.
5. Confirm result page renders status, confidence, blockers, resource gates, candidate history, and exports.

## Current Known Gaps

These are documented, not hidden:

| Gap | Status | Production impact |
| --- | --- | --- |
| Parser robustness expected gaps `R1-R3`, `R5-R9`, `R11` | Documented in `rules.md` | Matters for malformed or unusual CSV inputs; normal collector-generated packages are covered. |
| GOLD-11 through GOLD-14 future fixtures | Documented expected gaps | Additional end-to-end ZIP fixtures are not created until approved real source packages exist. |
| Customer-facing `Next Action` verbosity | Task 22 open | UX/report clarity issue; does not change engine result. |
| Business PDF/download polish | Task 23 open | Export packaging issue; cost savings require approved pricing model. |
| Real authentication | Not implemented | Required before broad external customer exposure. |
| Upload malware scanning/rate limiting | Not implemented | Required before broad external customer exposure. |
| Persistent report storage/history | Not implemented | Optional unless business requires later download/history/audit retention. |

## Dirty Working Tree Risk

Do not deploy the current workspace directly.

Current status includes many modified and untracked files from Tasks 19 through 23, plus collector ZIP file changes visible in `git status`. Before deployment:

1. Review all modified, deleted, and untracked files.
2. Decide which collector ZIP changes are intentional.
3. Commit only approved files.
4. Deploy from the committed revision, not from a local dirty tree.

## Security Readiness

Minimum for internal pilot:

- HTTPS enabled.
- `COST_OWNER_EMAIL` configured.
- Upload body size set intentionally.
- Logs enabled.
- No `.env` committed.
- No public raw upload storage.
- Smoke tests pass.

Required before broad external production:

- Real authentication.
- Audit logging.
- Rate limiting.
- Malware scanning for uploaded ZIPs.
- WAF or equivalent protection.
- Upload retention policy if uploads are stored.
- Monitoring and alerting for 5xx, memory, disk, failed health checks, and upload failures.

## Pricing and Business PDF Boundary

Current scope intentionally excludes detailed pricing, dollar savings, RI, and Savings Plans calculations.

Task 23 may add business-oriented PDF downloads, but before any cost savings, before/after cost chart, pie chart, or dollar claim appears, the project needs approved facts for:

- pricing source
- calculation method
- currency
- Region treatment
- license treatment
- time horizon
- RI/Savings Plans handling
- tests and rules covering the calculation

Until then, PDF output must state that pricing is not included.

## Final Readiness Call

**Internal pilot:** Ready after commit, push, clean-tree review, environment setup, deploy, and smoke test.

**SSATWeb-like hosted production for controlled users:** Ready after the internal pilot checklist plus HTTPS, owner access, monitoring, and operational runbook are in place.

**Broad external customer production:** Not ready until authentication, upload security controls, monitoring, and release management are hardened.

