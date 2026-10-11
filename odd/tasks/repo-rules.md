# Repo rules for humans and agents

- **Feature:** `repo-rules`
- **Branch:** `chore/repo-rules`
- **Engram mirror:** `odd/repo-rules/tasks` (project `casino-simulator`)
- **Status:** done; squash-merged to `main` as `42fc1fe` (PR #1)

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
- Required status check name for branch protection: `Conventional Commit title`.
- TDD: not applicable — no source code or test runner in this feature (no project TDD config exists).
- Delivery: forecast ~350 authored lines, single PR, strategy `ask-on-risk`.

## Tasks

- [x] **T1** `AGENTS.md` (invariants with README pointers, workflow, task-file convention, definition of done, language convention) + `CONTRIBUTING.md` pointer.
  - Route: inline — one non-trivial file, design already resolved from README read.
- [x] **T2** GitHub templates: `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/task.yml`, `bug.yml`, `config.yml`.
  - Route: delegated writer — multi-file, keeps parent thin (long-session backstop).
- [x] **T3** `.github/CODEOWNERS` + `.github/workflows/pr-title.yml`.
  - Route: same delegated writer, after T2.
- [x] **T4** Simplify the templates: task form to objective, acceptance criteria, notes; bug form to problem, steps, logs; PR template drops the duplicated definition-of-done list for one checkbox pointing to `AGENTS.md`.
  - Route: inline — mechanical rewrite of three small files, design agreed with the user in conversation.

## Acceptance criteria

- `AGENTS.md` at repo root, under ~100 lines, every invariant points to its `README.md` section instead of restating it.
- PR template carries `Closes #` and one checkbox pointing to the definition of done in `AGENTS.md` (single source of truth).
- Task issue form requires objective and acceptance criteria; everything else goes in optional notes. Area is a label, not a form field.
- `CODEOWNERS` assigns `@sebaveaa` as default owner, module paths ready for owners.
- PR-title workflow rejects non-conventional titles and accepts conventional ones; `permissions: {}`.

## Checks

- YAML files parse (`python -c "import yaml; ..."`).
- PR-title regex exercised locally against valid and invalid sample titles.
- Structural readback of every Markdown file.

## Progress and evidence

- **T1** done: `AGENTS.md` (51 lines) and `CONTRIBUTING.md`. Readback: every README section it cites (§2.2, 2.3, 3.1–3.4, 4.1, 4.2, 5.3, 6, 7, 11, 12, 13, 15) exists. Commit `a128e73`. Review assessment: medium, `under_budget`; reviewed boundary stays at branch point `a63efdb`.
- **T2** done: `.github/pull_request_template.md` (Definition of done checklist mirrors the six `AGENTS.md` items one-to-one), `.github/ISSUE_TEMPLATE/task.yml`, `bug.yml`, `config.yml` (`blank_issues_enabled: false`). Checks: `yaml.safe_load` over the three issue-template files printed `yaml ok`; form-structure script passed (task.yml ids: area, objective, context, scope, acceptance, dependencies, checks; bug.yml ids: area, actual, expected, steps, environment, logs; ids unique, every non-markdown item has `type` and `attributes.label`, all fields specified as required carry `validations.required: true`, the rest are optional). Structural readback of the PR template done. Commit `d09fbca`.
- **T3** done: `.github/CODEOWNERS` (default owner `@sebaveaa`, commented module placeholders) and `.github/workflows/pr-title.yml` (`permissions: {}`, title only via the `TITLE` env var, never echoed). Checks: `yaml.safe_load` over `task.yml`, `bug.yml`, `config.yml` and `pr-title.yml` printed `yaml ok`; the real `run` block extracted from `pr-title.yml` and executed with Git Bash once per title: exit 0 for `feat: add roulette`, `feat(wallet): add double-entry transfer`, `fix!: drop legacy endpoint`, `chore(repo-rules): add rules`, `ci: add pr title check`; exit 1 with `::error` for `Add stuff`, `feat:missing space`, `feature: add x`, `Feat: add x`, `feat(Wallet): add x`, `feat: ` (empty description), `feat(): add x`; 12 of 12 as expected. T2's commit is `d09fbca`.

- **Slice review:** `a63efdb..ec822b2` assessed high (`shell_source` in `pr-title.yml`), review due. Native review consent relayed; user chose **Skip this time** (`declined_this_candidate`, lineage `review-1dbba7c196799e68`). Reviewed boundary stays at `a63efdb`.
- **Independent verification** (RDD off path for a high candidate): no blockers. Workflow and issue forms valid against the SchemaStore schemas with negative controls; GitHub's recommended env-var pattern confirmed; 49 tricky titles (command substitution, backticks, unicode, 100k chars) matched the contract on four bash setups with no injected execution; CODEOWNERS and PR template valid.
  - Fixed: `scope` and `acceptance` in `task.yml` moved from prefilled `value` to `placeholder`, so `required` forces real content.
  - Fixed: required check name in pending decisions below.
  - Accepted as-is (nits): description guard allows tab/NBSP/trailing space; GitHub's Revert button title `Revert "…"` must be retitled `revert: …`; `edited` also re-runs on body edits.
  - Pending (remote): labels `type:task` and `type:bug` do not exist yet, so the forms skip them until created.
- **Second review:** after `172f80b`, consent relayed again; user chose **Skip this time** (lineage `review-48264b0455705d20`).
- **T4** done: forms cut from 7 and 6 fields to 3 each, because long forms get filled with noise and the PR checklist duplicated `AGENTS.md`. Checks: `yaml.safe_load` over `task.yml`, `bug.yml`, `config.yml`; ids unique, no prefilled `value`; required = task `objective`, `acceptance` and bug `problem`, `steps`. Review: skipped, the user explicitly left this candidate unreviewed (native review only for large feature merges). Commit `6ca2762`.
- **Delivery:** PR #1 squash-merged as `42fc1fe`; branch deleted.

## Next step

None. The project bootstrap continues in `odd/tasks/2-project-bootstrap.md`.

## Remote state (applied 2026-10-11)

- Labels: `type:task`, `type:bug`, `area:auth`, `area:wallet`, `area:games`, `area:realtime`, `area:frontend`, `area:infra`, `area:docs`.
- Milestones: `1.er corte` (2026-10-28), `2.º corte` (2026-12-09), `Entrega final` (2026-12-15).
- Merge settings: squash only; commit title = PR title, message = commit messages.
- `main` protection: PR with 1 approval, required check `Conventional Commit title`, no force pushes or deletions; admins can bypass; code-owner review off until module owners exist.
- Pending: invite the three missing teammates (needs their GitHub usernames), then fill module owners in `CODEOWNERS`.
- `.gitattributes` with `eol=lf` moved to the project bootstrap (#2).
