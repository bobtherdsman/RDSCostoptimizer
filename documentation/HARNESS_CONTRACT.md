# Independent Harness Contract

## Purpose

The independent harness exists to prove that production recommendations remain correct every time this project changes. It is a regression and verification oracle, not the production recommendation engine.

Production code is responsible for parsing collector evidence, generating candidates, applying workload gates, selecting the result, and rendering reports. The harness independently recalculates the verified rules from preserved evidence and fails any result that cannot be reproduced.

## Authority

This contract is derived from:

- `documentation/Chodo_Cost_Optimization_Sizing_and_Guardrails_v2.docx`
- `documentation/ARCHITECTURE.md` Working Sizing Rule Architecture
- `documentation/COST_OPTIMIZATION_END_TO_END_SPEC.md`
- `documentation/MVP_SPEC.md` Non-Negotiables and Release Acceptance
- `documentation/TASKS.md`

If this file conflicts with the current rule document or architecture record, the current rule document and architecture record control.

## Required Separation

- The harness must not choose the production target instance.
- The harness must not supply thresholds, formulas, catalog facts, or candidate ordering to production at runtime.
- The harness must not import production optimizer, parser, memory, I/O, edition, or catalog predicates as its oracle.
- Production tests may call the harness to prove a result is reproducible.
- Runtime code may fail closed when a harness check fails, but that guard does not make the harness the source of the recommendation.
- The copied SSATWeb harness baseline is reference material only. It must not be used to choose a cost-optimization target and must not modify SSATWeb.

## Active Harness Scope

The active harness scope is intentionally simpler than the older oracle bundle.
It verifies the current approved sizing flow:

1. Start with the current RDS SQL Server instance size.
2. Use collected workload metrics for that current size.
3. Verify the selected candidate exists in exact catalog/orderability evidence.
4. Recalculate CPU projection independently when synchronized CPU samples exist.
5. Verify preserved CPU thresholds: SQL CPU P95 <= 70%, SQL CPU P99 <= 90%, and concurrent total CPU P99 <= 90%.
6. Verify memory fit and pressure status before allowing any I/O pass. A RAM-reducing `Recommended` result must have a stable working-set or not-required coupling verdict; otherwise it can only remain validation-required.
7. Verify IOPS using effective capability: min(candidate instance capability, configured storage IOPS). P95 must be <= 70% and P99 must be <= 90%.
8. Verify throughput using effective capability: min(candidate instance capability, configured storage throughput). P95 must be <= 70% and P99 must be <= 90%.
9. Verify that the selected candidate record matches the recommendation when candidate-evaluation evidence is present.
10. Verify independence from SSATWeb sizing logic.

The harness no longer treats the retired broad oracle bundle as the active
release authority. Older helper code may remain temporarily during refactoring,
but it must not define the pass/fail scope unless explicitly reactivated by the
architecture and current rule document.

## Active Verdict Mapping

- `Recommended`: every active hard gate must pass with sufficient evidence.
- `Aggressive Optimization`: may carry validation-required memory evidence, but must still pass CPU and I/O hard gates.
- `Not Recommended`: must include blockers explaining why no safe optimization was proven.

Missing required evidence must fail the active harness check for a hands-free
recommendation.

## Change Rule

Any production change that affects recommendation behavior must be accompanied by one of:

- existing harness tests that already cover the changed behavior, or
- a new/updated independent harness oracle and regression test authorized by the verified specification.

If the verified document does not authorize the new formula, threshold, blocker, metric, or scope item, stop and ask for approval before changing production or harness behavior.

## Verification Commands

Use the project scripts rather than ad hoc direct TypeScript execution:

```powershell
npm run harness
powershell -ExecutionPolicy Bypass -File tests/run-typescript-tests.ps1
npm run test
```

`npm run test` is the full verification path. The TypeScript tests are run through `tests/run-typescript-tests.ps1`; direct `node --test tests/*.ts` is not the supported path.
