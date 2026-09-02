# Codex Instructions — Chodo Flexible Optimization Alignment

## Mission

Update the RDSCostoptimizer project so Chodo behaves as a flexible, evidence-driven RDS for SQL Server optimizer whose primary goal is to find safe compute and SQL Server license reduction opportunities without becoming unnecessarily restrictive.

Do not rewrite the product from scratch. Preserve the current collector, parser, evidence model, catalog, report model, and independent harness architecture unless a change is explicitly required below.

Pricing is NOT a required dependency for this implementation. Keep pricing optional. A missing pricing module must never block a technically valid optimization recommendation.

---

## Core Product Rule

Implement this product principle everywhere:

> Search aggressively for optimization. Be flexible with manageable uncertainty. Be strict only when evidence proves a real safety, support, or reproducibility boundary.

Safety metrics are constraints, not the optimization objective.

---

## Approved Family Strategy

Preferred lead families:

- M8i
- R8i
- X2m

Fallback families:

- M7i
- R7i
- X2iedn

Fallback families are used only when the lead-family path is unavailable, not orderable, unsupported for the exact Region/edition/version/configuration, or fails a real workload gate.

Do not treat family preference as a hard blocker.

---

## Important Same-Size Rule

Support same-size generational comparisons even when SQL-visible vCPU differs.

Example:

```text
older M-family 4xlarge -> M8i.4xlarge
older R-family 4xlarge -> R8i.4xlarge
```

A same-size suffix is a family-size position, not a guarantee of identical SQL-visible CPU.

RDS SQL Server may expose fewer SQL-visible vCPUs on newer families because of processor configuration or hyper-threading behavior. That is expected and is a valid optimization path.

Use exact AWS RDS SQL Server processor metadata and sample-level CPU projection. Never use generic EC2 vCPU count as the sizing authority when exact SQL Server processor metadata is available.

---

# Implementation Order

Implement these phases in order. Keep each phase independently testable.

## Phase 1 — Candidate Generation and Best-Safe Selection

### Required files to inspect first

- `src/server/index.ts`
- `src/optimizer/index.ts`
- `src/optimizer/cpu-projection.ts`
- `src/catalog/index.ts`
- `src/contracts/types.ts`
- `tests/optimizer.test.ts`
- `tests/samples-regression.test.ts`
- `documentation/ARCHITECTURE.md`
- `documentation/HARNESS_CONTRACT.md`

### Required behavior

Replace the current first-valid-candidate behavior with evaluate-all + rank-safe-survivors.

Do NOT stop at the first candidate that passes.

Target flow:

```text
resolve current configuration
  -> generate same-size lead-family candidate(s)
  -> generate fallback same-size candidate(s) when needed
  -> generate one-size-down lead candidate(s)
  -> generate fallback one-size-down candidate(s) when needed
  -> continue through smaller technically eligible sizes
  -> include Optimize CPU configurations
  -> include memory-preserving alternatives where relevant
  -> include candidate-aware NVMe/tempdb paths
  -> evaluate every candidate
  -> preserve PASS/WARN/FAIL evidence for each
  -> collect safe survivors
  -> rank safe survivors
  -> select best survivor
```

### Ranking when pricing is OFF

Use this ranking intent:

1. Greater safe reduction in SQL-visible/licensed vCPU.
2. Preferred modern family: M8i/R8i/X2m.
3. Lower risk / stronger confidence.
4. Memory preservation where it materially improves safety or licensing value.
5. Fallback family only when lead paths are unavailable or unsuitable.

Do not introduce dollar pricing into hard safety gates.

### Acceptance tests

Add tests for:

- same-size generational move where visible vCPU differs
- two passing candidates where the smaller safe candidate must win
- fallback family used only when lead family cannot be used
- Optimize CPU remains a valid alternate path

Do not change CPU, memory, I/O, or evidence thresholds yet in Phase 1.

---

## Phase 2 — Harness Must Verify Best-Safe Candidate

### Required files

- `src/harness/index.ts`
- `src/harness/oracles.ts`
- `tests/cost-harness.test.ts`
- `documentation/HARNESS_CONTRACT.md`

### Add independent oracle

Add an oracle equivalent to:

```text
CO-RULE-OPTIMAL-SAFE-CANDIDATE
```

The independent harness must verify that production did not skip a better safe candidate.

Example:

```text
Current: r8i.12xlarge
r8i.8xlarge PASS
r8i.4xlarge PASS
r8i.2xlarge FAIL
```

Expected selected target:

```text
r8i.4xlarge
```

If production returns `r8i.8xlarge`, the harness must fail the recommendation even though `r8i.8xlarge` is technically safe.

### Add fallback-family verification

Add independent verification that a fallback family is used only for a justified reason:

- lead family unavailable
- exact orderability missing
- Region/version/edition incompatibility
- lead candidate fails a real workload gate
- platform limitation

The harness must remain independent. Do not import production optimizer predicates as the oracle implementation.

---

## Phase 3 — Correct IOPS and Throughput Semantics

### Required files

- `src/io/index.ts`
- `src/harness/index.ts`
- `src/harness/oracles.ts`
- `tests/io.test.ts`
- `tests/cost-harness.test.ts`

### P95 sustained rule

Use sustained/baseline capability for P95.

```text
EffectiveSustainedIOPS =
  min(candidate sustained instance capability,
      effective storage sustained capability)

P95 IOPS <= 70% of EffectiveSustainedIOPS
```

For throughput:

```text
EffectiveSustainedThroughput =
  min(candidate sustained instance throughput,
      effective storage sustained throughput)

P95 Throughput <= 70% of EffectiveSustainedThroughput
```

### P99 burst rule

Use burst/maximum capability for P99.

```text
P99 IOPS <= 90% of EffectiveBurstIOPS
P99 Throughput <= 90% of EffectiveBurstThroughput
```

Retain burst duration and frequency validation.

### Raw maximum behavior

Remove any unconditional rule equivalent to:

```text
raw maximum > capability => automatic FAIL
```

Target interpretation:

```text
P95 = sustained sizing
P99 = burst/risk safety
MAX = anomaly/context
```

An isolated raw maximum excursion must be WARN/context unless recurrence, duration, or an authoritative absolute limit demonstrates the candidate is unsafe.

Do not loosen the current 70% P95 or 90% P99 limits in this phase.

---

## Phase 4 — Persistence-Aware Memory Pressure

### Required files

- `src/memory/index.ts`
- `src/memory/coupling.ts`
- `src/harness/oracles.ts`
- `tests/memory.test.ts`

### Keep unchanged

Keep:

- less-elastic memory floor
- 20% headroom
- 25% material RAM reduction rule
- memory-to-I/O coupling model
- Buffer Cache Hit Ratio as supporting evidence only

### Change isolated pressure behavior

Do not hard-fail every RAM-reducing candidate because one low-memory event occurred in an otherwise clean observation window.

Target model:

```text
isolated low-memory event
  -> WARN / lower confidence

repeated pressure periods
  -> FAIL candidate

sustained Memory Grants Pending / eviction / low-memory pressure
  -> FAIL candidate

candidate below less-elastic floor + headroom
  -> FAIL candidate
```

High SQL Server memory utilization alone must never be a blocker.

### Preserve coupling thresholds

Keep:

- material RAM reduction >=25% or lower-memory-tier transition
- Spearman correlation >=0.40
- high-pressure ReadIOPS median >=20% above low-pressure median
- persistence >=10% of valid samples OR >=3 qualifying pressure periods
- >=40% increase as a strong pressure signal
- normalize ReadIOPS by Batch Requests/sec when available

Do not claim exact future IOPS when working-set evidence is incomplete.

---

## Phase 5 — I/O Rescue and Alternate Paths

A single candidate failing IOPS or throughput must reject that candidate, not automatically the server-level optimization opportunity.

When I/O blocks a candidate:

1. Identify whether the blocker is instance bandwidth, storage capability, tempdb placement, or another platform constraint.
2. Evaluate equivalent lead-family candidate(s) with better I/O capability.
3. Evaluate NVMe/tempdb-capable candidates and remap synchronized tempdb demand.
4. Evaluate Optimize CPU / memory-preserving paths.
5. Evaluate fallback families only when lead paths are unavailable or unsuitable.
6. Continue through remaining technically eligible candidates.
7. Return no safe optimization only when all valid paths have been exhausted.

### NVMe rules

Local NVMe on RDS SQL Server is a tempdb path.

Never treat user database or transaction-log files as local NVMe files.

Maintain all four transitions:

```text
Non-NVMe -> Non-NVMe
Non-NVMe -> NVMe
NVMe -> NVMe
NVMe -> Non-NVMe
```

Representative and peak tempdb allocation must fit candidate local capacity.

Do not add gp3/io1/io2 optimization changes yet unless explicitly requested as a new scope item.

---

## Phase 6 — Cross-Family Confidence

Use these confidence rules:

- same hardware: HIGH
- same family: HIGH
- cross-family with authoritative normalized per-core capacity: MEDIUM
- cross-family without authoritative normalization: validation-required

Do not silently expose an unnormalized cross-family recommendation as a normal hands-free `Recommended` result.

Do not automatically hard-fail it if all actual capacity gates pass.

Target customer outcome:

```text
Recommended with Validation
```

---

## Phase 7 — Pricing Optional

Pricing is an enhancement, not a dependency.

### Pricing OFF

Technical optimizer must still work and return a recommendation.

Rank safe survivors using technical optimization value.

### Pricing ON later

Allow pricing to rank safe survivors by total cost using authoritative pricing inputs.

Potential inputs:

- RDS instance cost
- SQL Server licensing component
- Multi-AZ/deployment model
- storage
- provisioned IOPS/throughput

### Pricing unavailable

Do not block recommendation.

Allowed output:

```text
Technical optimization identified
Compute/license footprint reduction identified
Dollar savings unavailable
```

Never fabricate monthly or annual savings.

---

# Customer Decision States

## Recommended

All hard gates pass with sufficient evidence.

## Recommended with Validation

Hard capacity gates pass but manageable uncertainty exists, such as:

- material RAM reduction with mixed evidence
- isolated pressure event
- unnormalized cross-family comparison
- burst reliance requiring operational validation

## Alternate Optimization Opportunity

One path fails, but another valid lead/fallback/NVMe/Optimize CPU path remains.

## No Safe Optimization Identified

Only after all valid candidate paths have been exhausted.

## Insufficient Evidence

Use only when critical evidence prevents safety from being established for any candidate.

---

# Hard FAIL vs WARN Rules

## Hard FAIL examples

- projected SQL CPU P95 >70%
- projected SQL CPU P99 >90%
- concurrent projected total CPU P99 >90%
- candidate memory below reproducible less-elastic floor + headroom
- sustained/repeated memory pressure showing RAM reduction is unsafe
- IOPS P95 sustained underfit
- IOPS P99 burst underfit
- throughput P95 sustained underfit
- throughput P99 burst underfit
- tempdb local capacity underfit
- unsupported SQL edition/version/orderability
- recommendation cannot be reproduced by independent harness

A hard FAIL rejects the candidate. Continue evaluating other candidates.

## WARN examples

- isolated memory-pressure signal
- material RAM reduction with incomplete but non-blocking working-set evidence
- unnormalized cross-family CPU projection
- reliance on valid burst capability
- isolated raw I/O maximum excursion
- short but usable observation window

WARN should not automatically become `Not Recommended`.

---

# Required Regression Scenarios

Add or update regression scenarios for:

1. Same-size generation change with fewer SQL-visible vCPUs that still passes.
2. M8i/R8i/X2m preferred-family recommendation.
3. M7i/R7i/X2iedn fallback only when lead is unavailable/invalid.
4. One-size-down recommendation.
5. Two-size-down recommendation where larger and smaller candidates both pass.
6. P95 CPU passes but P99 fails.
7. High memory utilization with no pressure -> not blocked.
8. One isolated memory event -> WARN.
9. Sustained memory pressure -> FAIL RAM reduction.
10. IOPS sustained underfit -> candidate fails, search continues.
11. Throughput sustained underfit -> candidate fails, search continues.
12. One isolated IOPS maximum spike with safe P95/P99 -> WARN/context.
13. One isolated throughput maximum spike with safe P95/P99 -> WARN/context.
14. NVMe/tempdb path rescues a candidate.
15. Optimize CPU preserves memory while reducing licensed CPU.
16. Cross-family without authoritative normalization -> Recommended with Validation.
17. Multiple safe candidates -> best-safe candidate wins.
18. Pricing unavailable -> technical recommendation still succeeds.

---

# Do Not Change Without Explicit Approval

Do not change these values unless explicitly instructed:

```text
SQL CPU P95 target = 70%
SQL CPU P99 safety ceiling = 90%
Concurrent total CPU P99 ceiling = 90%
Memory headroom = 20%
Material RAM reduction threshold = 25%
ReadIOPS Spearman threshold = 0.40
Meaningful high-pressure ReadIOPS increase = 20%
Strong high-pressure ReadIOPS increase = 40%
Persistence threshold = 10% or 3 qualifying pressure periods
Initial I/O P95 headroom target = 70%
Initial I/O P99 safety target = 90%
```

Do not remove exact RDS SQL Server Region/edition/version/orderability checks.

Do not use generic EC2 CPU metadata in place of authoritative SQL Server processor metadata.

Do not use local NVMe for user database or transaction-log assumptions.

Do not make pricing mandatory.

Do not modify SSATWeb sizing logic or depend on SSATWeb to select Chodo targets.

---

# Verification Commands

Before declaring any phase complete, run:

```powershell
npm run build
npm run harness
powershell -ExecutionPolicy Bypass -File tests/run-typescript-tests.ps1
npm run test
```

Do not accept a change with failing existing safety regressions unless the expected behavior was intentionally changed by this instruction set and the new expected result is explicitly encoded in the appropriate regression test.

---

# Final Definition of Done

This work is complete only when:

- same-size generational comparisons work
- SQL-visible processor metadata controls CPU projection
- M8i/R8i/X2m are preferred lead families
- M7i/R7i/X2iedn are justified fallbacks
- the first-valid shortcut is removed
- all technically eligible candidates are evaluated
- the best safe survivor is selected
- the harness independently verifies safety and best-safe selection
- P95 I/O uses sustained capability
- P99 I/O uses burst capability
- raw I/O maximum is not an unconditional blocker
- isolated memory events warn rather than automatically fail
- sustained/repeated memory pressure still blocks unsafe RAM reduction
- an I/O failure triggers alternate-family/NVMe/Optimize CPU investigation
- pricing remains optional
- regression tests cover successful optimization paths as thoroughly as blocker paths

Final operating principle:

> Chodo should maximize safe optimization opportunity, not maximize the number of reasons to say no.
