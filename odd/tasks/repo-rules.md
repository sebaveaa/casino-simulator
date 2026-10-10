# Repo rules for humans and agents

- **Feature:** `repo-rules`
- **Branch:** `chore/repo-rules`
- **Engram mirror:** `odd/repo-rules/tasks` (project `casino-simulator`)
- **Status:** in progress

## Objective

Give a five-person team, each using a different coding agent, one shared rulebook and the GitHub plumbing that enforces it, before any application code exists.

## Problem and why

Teammates will use different agents (unknown mix). Without shared rules each agent invents its own conventions, and the architecture invariants in `README.md` (ledger, atomicity, idempotency, server-decided outcomes) erode silently. Prose alone is advisory, so anything checkable moves into CI and GitHub settings; `AGENTS.md` keeps only what tooling cannot enforce.

## Scope

- In: `AGENTS.md`, `CONTRIBUTING.md` pointer, PR template, issue forms, `CODEOWNERS`, PR-title CI check.
- Out: monorepo scaffold and code-check CI (lint/typecheck/test) — they land with the project bootstrap, since there is no code to check yet. Remote GitHub changes (push, PR, branch protection, merge settings, labels, milestones, invites) — each needs explicit user authorization.

## Constraints and decisions

- No `CLAUDE.md`: Claude Code v2.1.277+ reads `AGENTS.md` directly when no `CLAUDE.md` exists (code.claude.com/docs/en/memory, section "AGENTS.md"). A `CLAUDE.md` would shadow it.
- Language convention (assumption, confirm with team): code, identifiers, comments, commits, PR titles and agent-facing docs in English; `README.md` and `docs/` (course deliverables) in Spanish.
- PR titles follow Conventional Commits and are enforced in CI, so squash merges keep `main` history conventional.
- CI uses no third-party actions and passes the PR title through an env var (no script injection).
- TDD: not applicable — no source code or test runner in this feature (no project TDD config exists).
- Delivery: forecast ~350 authored lines, single PR, strategy `ask-on-risk`.

## Tasks

- [x] **T1** `AGENTS.md` (invariants with README pointers, workflow, task-file convention, definition of done, language convention) + `CONTRIBUTING.md` pointer.
  - Route: inline — one non-trivial file, design already resolved from README read.
- [x] **T2** GitHub templates: `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/task.yml`, `bug.yml`, `config.yml`.
  - Route: delegated writer — multi-file, keeps parent thin (long-session backstop).
- [ ] **T3** `.github/CODEOWNERS` + `.github/workflows/pr-title.yml`.
  - Route: same delegated writer, after T2.

## Acceptance criteria

- `AGENTS.md` at repo root, under ~100 lines, every invariant points to its `README.md` section instead of restating it.
- PR template carries `Closes #`, and a definition-of-done checklist matching `AGENTS.md`.
- Task issue form captures objective, context, scope, acceptance criteria, dependencies, area.
- `CODEOWNERS` assigns `@sebaveaa` as default owner, module paths ready for owners.
- PR-title workflow rejects non-conventional titles and accepts conventional ones; `permissions: {}`.

## Checks

- YAML files parse (`python -c "import yaml; ..."`).
- PR-title regex exercised locally against valid and invalid sample titles.
- Structural readback of every Markdown file.

## Progress and evidence

- **T1** done: `AGENTS.md` (51 lines) and `CONTRIBUTING.md`. Readback: every README section it cites (§2.2, 2.3, 3.1–3.4, 4.1, 4.2, 5.3, 6, 7, 11, 12, 13, 15) exists. Commit `a128e73`. Review assessment: medium, `under_budget`; reviewed boundary stays at branch point `a63efdb`.
- **T2** done: `.github/pull_request_template.md` (Definition of done checklist mirrors the six `AGENTS.md` items one-to-one), `.github/ISSUE_TEMPLATE/task.yml`, `bug.yml`, `config.yml` (`blank_issues_enabled: false`). Checks: `yaml.safe_load` over the three issue-template files printed `yaml ok`; form-structure script passed (task.yml ids: area, objective, context, scope, acceptance, dependencies, checks; bug.yml ids: area, actual, expected, steps, environment, logs; ids unique, every non-markdown item has `type` and `attributes.label`, all fields specified as required carry `validations.required: true`, the rest are optional). Structural readback of the PR template done.

## Next step

T2 (delegated writer).

## Pending user decisions (remote, not tasks)

- Push `chore/repo-rules` and open the PR.
- Protect `main`: require PR, require the `pr-title` check, optionally require code-owner review.
- Merge settings: squash only, default commit message = PR title.
- Invite the three missing teammates; create area labels and stage milestones.
