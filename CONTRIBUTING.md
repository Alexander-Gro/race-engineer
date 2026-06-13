# Contributing to Race Engineer

This is an early-stage, planning-first repository. Before writing code, read
[CLAUDE.md](CLAUDE.md) and the relevant numbered docs in [docs/](docs/). The numbered
docs are the source of truth; if code and docs disagree, reconcile explicitly rather
than silently diverging.

## Workflow

- **Build plan is the order of work.** Pick the lowest-numbered unblocked task in
  [docs/14-BUILD-PLAN.md](docs/14-BUILD-PLAN.md), load the docs on its **Context** line,
  implement the **Build** step, make its **Verify** step pass, then commit.
- **One branch per task**, small reviewable PRs. Branch off `main`.
- **Definition of Done (global):** `pnpm typecheck && pnpm lint && pnpm test` are green;
  new logic has unit tests; no secrets committed; docs updated if behavior diverges.

## Commit messages — Conventional Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). Reference the build-plan
task ID in the subject where applicable.

```
<type>: <description>

[optional body]
```

Allowed types: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`, `ci`, `build`.

Examples:

```
feat: T3.1 fuel model with confidence
test: T0.3 fixture validation against canonical schema
docs: record S2 REST findings in 03-LMU-INTEGRATION
chore: T0.2 scaffold pnpm monorepo + tooling
```

## Non-negotiable architectural rules (see CLAUDE.md)

1. The LLM never computes numbers — strategy math is pure, unit-tested TypeScript.
2. The app is **read-only and advisory** — there is no write path to the game.
3. Per-game code lives only in `packages/adapters/<game>/`; the rest speaks the canonical
   schema from `packages/core`.
4. Keep `core` and `strategy` pure (no I/O).
5. No embedded secrets, no central server — free, local-first, bring-your-own-key.

## Secrets

API keys live in OS-level secure storage at runtime, and in a git-ignored `.env.local`
for local development. Never commit a key; never log one.
