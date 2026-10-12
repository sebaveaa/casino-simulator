# AGENTS.md

Rules for everyone who changes this repository: humans and coding agents alike.

Casino Cloud is a cloud-native casino that runs on fictitious credits, built for a university course. The cloud architecture is the product; the games are the pretext. `README.md` (Spanish) is the design source of truth: read the section an issue touches before changing code there.

## Architecture invariants

Every change preserves these. Each one points to the README section that explains why.

- **Money moves only through the Wallet/Ledger module.** Games ask Wallet to record a movement; balance writes live in Wallet alone. (§2.3)
- **Double-entry, append-only ledger.** The entries of every transaction sum to zero. A correction is a new transaction; existing entries stay as written. (§3.1)
- **One bet, one PostgreSQL transaction.** Debit, record the bet, resolve, and credit inside a single `BEGIN … COMMIT`, with the wallet row locked by `SELECT … FOR UPDATE`. (§3.2)
- **Idempotent bets.** Bet endpoints require an `Idempotency-Key` header; a retry returns the original result and charges once. (§3.3)
- **Integer money.** Amounts are integers in the minimum unit. `bigint` columns become `BigInt` at a single point in the data layer and travel as strings in the API. (§3.4)
- **The server decides.** Outcomes and balances are computed on the server; the frontend animates results it has already received. (§2.2, §4.2)
- **Pure, shared `resolve`.** Each game's `resolve` is a pure function in `shared/`, so the browser verifier runs the exact server code. (§4.1, §5.3)
- **PostgreSQL is the source of truth.** Redis holds only state that can be lost or rebuilt without losing money. (§6)
- **Configuration from the environment.** Settings and secrets arrive as environment variables; `.env.example` lists the names with placeholder values. (§7, §13)

Stack and folder layout: README §11 and §12.

## Commands

- Node 22 (see `.nvmrc`).
- `npm install`: install all workspaces.
- `npm run lint`: Biome check.
- `npm run format`: Biome check with fixes applied.
- `npm run typecheck`: `tsc` in every workspace.
- `npm test`: Vitest in every workspace.
- `cp .env.example .env`: local settings (gitignored).
- `docker compose up -d`: PostgreSQL and Redis. If host port 5432 is taken, set `POSTGRES_PORT` in `.env` and match it in `DATABASE_URL`.
- `npm run migrate`: apply pending database migrations to `DATABASE_URL`. The image runs them with `node backend/dist/migrate.js`.
- `npm run dev -w backend`: backend with reload, reads `.env`.
- `npm run dev -w frontend`: Vite dev server.
- `docker build -t casino-cloud .`: the backend image; `PROCESS_ROLE` picks `api` or `worker`.
- `docker compose --profile app up --build`: whole stack in containers.

CI runs lint, typecheck and test on every PR.

## Workflow

1. **Start from an issue.** Every change traces to a GitHub issue, and its acceptance criteria define done. When they are missing or ambiguous, clarify them in the issue before coding.
2. **Branch** from `main` as `<type>/<issue>-<slug>`, for example `feat/12-roulette-bets`.
3. **Write a task file for multi-step work.** Before the first code change, create `odd/tasks/<issue>-<slug>.md` with a link to the issue, the objective, a checklist with stable IDs (`T1`, `T2`, …), the acceptance criteria, and the checks to run. Check an item off only after its checks pass, and commit after each item. The task file is committed with the work: it is the team's progress record.
4. **Commit** in [Conventional Commits](https://www.conventionalcommits.org/) format, with tests and docs in the same commit as the behavior they cover.
5. **Run the checks CI runs** (`.github/workflows/`) before pushing.
6. **Open a pull request** titled as a Conventional Commit. CI enforces the title, and it becomes the squash-merge commit on `main`. Fill in the template, including `Closes #<issue>`. Keep each PR reviewable, around 400 changed lines; split larger work into stacked PRs.

All changes reach `main` through a reviewed pull request.

## Definition of done

- The issue's acceptance criteria are met.
- Tests cover the new behavior, and CI is green.
- Docs are updated where behavior or setup changed (README sections, `.env.example`).
- The architecture invariants above still hold.
- Only placeholder values are committed; real secrets stay in the environment.
- The task file, if any, is fully checked off.

## Language

- English: code, identifiers, comments, commit messages, PR titles, and agent-facing docs such as this file.
- Spanish: `README.md` and `docs/`, which are course deliverables.
- Issues and PR discussion: either language.

## Ownership

`.github/CODEOWNERS` maps each module to its owner, who reviews changes to it. Every member must be able to explain the ledger and the flow of a bet (README §15).
