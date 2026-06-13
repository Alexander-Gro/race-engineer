---
name: build-task
description: >-
  Execute one task from the Race Engineer build plan (docs/14-BUILD-PLAN.md),
  e.g. `/build-task T0.3`. Resolves the task, checks its dependencies, loads the
  docs listed in its Context line, implements the Build step, makes the Verify
  step pass, and enforces the global Definition of Done. With no argument, picks
  the lowest-numbered unblocked task. Use when starting or continuing a
  build-plan task.
---

# build-task — run one Race Engineer build-plan task

The build plan in [docs/14-BUILD-PLAN.md](../../docs/14-BUILD-PLAN.md) is the source of
truth for *what to build next and how it's verified*. Each task is sized to one focused
session and has **Build**, **Verify**, **deps**, and a **Context** line of docs to load.
This skill runs exactly one such task to a small, reviewable, green-tested change.

## Procedure

1. **Resolve the task.** Use the argument (e.g. `T3.1`) as the task ID. If none was given,
   read [docs/14-BUILD-PLAN.md](../../docs/14-BUILD-PLAN.md) and pick the **lowest-numbered
   unblocked task** (all its `deps:` are done). State which task you're doing and why.

2. **Check dependencies.** Confirm every task in the task's `deps:` is complete. If a dep
   is missing, stop and say so — do not build out of order.

3. **Load context.** Read [CLAUDE.md](../../CLAUDE.md) and every doc on the task's
   **Context** line before writing code. Don't guess at things those docs specify.

4. **Handle `[human-assisted]` tasks.** If the task is marked `[human-assisted]` (the M1
   spikes, API keys, wheel mapping, recording real sessions — see the build plan and the
   "Human-in-the-loop checklist"), do the part you can (scripts, scaffolding, tests against
   mocks/fixtures) and then **clearly list the exact steps the user must do on the Windows
   rig / with hardware / with a key.** Don't fake the live half.

5. **Implement the Build step**, honoring the architectural rules in [CLAUDE.md](../../CLAUDE.md):
   LLM never does math; **read-only/advisory — no write path to the game**; per-game code
   only in `adapters/`; canonical schema downstream of the Normalizer; pure `core`/`strategy`;
   tiered voice latency. Match the conventions in [docs/12-DEV-SETUP.md](../../docs/12-DEV-SETUP.md)
   (TypeScript strict, pure functions, Vitest). Prefer the replay/synthetic data source so
   the change is testable offline (the linchpin from T0.4).

6. **Make Verify pass + the global Definition of Done.** Run the task's **Verify** step,
   plus the global DoD from the build plan:
   - `pnpm typecheck && pnpm lint && pnpm test` are green.
   - New logic has unit tests. For strategy math, use the **worked examples** from
     [docs/05-STRATEGY-ENGINE.md](../../docs/05-STRATEGY-ENGINE.md) plus property tests
     (monotonicity, no NaN/Infinity, `confidence01 ∈ [0,1]`).
   - No secrets committed; docs updated if behavior diverged from them; spike findings
     written back into [docs/03-LMU-INTEGRATION.md](../../docs/03-LMU-INTEGRATION.md).
   Report results honestly — if a check fails or a step was skipped, say so with output.

7. **Compliance check before committing.** Run the **compliance-reviewer** subagent over the
   change. If it returns FAIL, fix the blockers before committing.

8. **Commit (per the build-plan convention).** When Verify is green and compliance passes,
   stage the change and commit with a conventional-commit message (`feat:`/`fix:`/`test:`/
   `docs:`/`chore:`) referencing the task ID, e.g. `feat: T3.1 fuel model`. **Do not push**
   unless asked. Note: the repo isn't a git repo until **T0.1** runs — for T0.1 itself,
   initialize it; for any task before it exists, skip the commit and flag it.

## Notes

- **One task per invocation.** If the work is bigger than one build-plan task, that's a sign
  the task should be split in the plan — surface it rather than ballooning the change.
- The first three suggested sessions (per the build plan) are **T0.1+T0.2**, then **T0.3**,
  then **T0.4+T0.5** — after which every logic task is testable offline with no game running.
