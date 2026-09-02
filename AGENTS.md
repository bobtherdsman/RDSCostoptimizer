# Agent Instructions

These instructions are mandatory for all work in this standalone RDS Cost Optimization project.

## Project Authority

Before making any code, collector, UI, API, architecture, documentation, or test change, the agent must read and follow:

- `AGENTS.md`
- `documentation/COST_OPTIMIZATION_END_TO_END_SPEC.md`
- `documentation/MVP_SPEC.md`
- `documentation/ARCHITECTURE.md`
- `documentation/TASKS.md`
- `documentation/HARNESS_CONTRACT.md`

The agent must identify the exact spec, architecture, or task section that authorizes the change. If no section clearly authorizes the change, the agent must stop and ask for approval before editing.

## Approval Rules

- Do not make silent design or behavior decisions.
- Do not change collector behavior unless `documentation/TASKS.md` or the user explicitly approves that collector change.
- Do not change SSATWeb or files under `C:\Users\bacrifai\Downloads\Projects\rdstools-web` from this project.
- Do not read-write, modify, move, delete, format, or generate files outside `C:\Users\bacrifai\Downloads\Projects\rdscostoptimization` unless the user explicitly approves the exact external path and action.
- Do not add side inputs, manual JSON inputs, or website-only optimization fields unless explicitly approved.
- Keep the flow aligned with the agreed model: download collector, run collector, upload collector ZIP, analyze workload optimization.
- Keep this project standalone and independent from SSATWeb sizing logic.
- Treat the independent harness as a verification/regression oracle, not as production recommendation logic. Production code may be tested or guarded by harness results, but the harness must not choose candidates, supply formulas to production at runtime, or import production calculations as its oracle.

## Required Pre-Edit Check

Before editing files, the agent must state:

- The task being implemented.
- The files expected to change.
- The spec, architecture, or task section authorizing each change.
- Any uncertainty or assumption that requires user approval.

If the agent cannot provide this mapping, it must not edit files.

## Required Final Check

Before final response, the agent must report:

- Files changed.
- Spec, architecture, or task section followed.
- Assumptions made, or state `No assumptions`.
- Tests or validation run.
- Any files intentionally not changed.

## Current Tenets

- No customer product or application-data modification; only approved collector-owned staging artifacts may be created and cleaned up.
- SQL Server only.
- Collector-first data source.
- Bounded, low-impact collection only; no tracing, plans, Query Store scraping, workload replay, or application-table scans.
- Workload optimization only; pricing is deferred.
- CPU downsize is the easiest win, but memory, IOPS, and throughput must fit before recommending a smaller instance.
- DB-level metrics must be preserved so reports can show top offending databases and support split or merge discussions.
- Every production behavior change must keep the independent harness aligned through tests or an explicit harness update authorized by the verified specification.

## User-Facing Wording

- Avoid the word `recommend` and its variants in user-facing summaries, explanations, and UI copy unless quoting existing code, enums, specifications, or file content.
- Use `optimized` for workloads that can move to a better/lower target.
- Use `as is` for workloads that should stay on the current setup.
