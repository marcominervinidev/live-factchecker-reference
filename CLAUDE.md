# live-factchecker-v2

Rules for every agent session in this repository. Procedures live in `.claude/skills/`, sub-project rules in `.claude/rules/` (loaded by path), roles in `.claude/agents/` (ADR 0011, `docs/process/rollen.md`). Keep this file under 120 lines; a procedure or a rule for one part of the codebase does not belong here.

**Context is the product. The owner (Marco) leads the architecture; the agent builds against it.** If you cannot describe the design, you cannot build it; if the owner cannot understand the diff, he cannot merge it.

## Sources of truth

- Glossary: `CONTEXT.md` (canonical English terms, German UI labels). Never use a term it lists under _Avoid_.
- Architecture: ADRs in `docs/adr/` (one series, 0001 to 0011 came from the planning repo on 2026-10-25) and specs in `docs/spec/`; `docs/architecture.md` is the picture the ADRs add up to and is updated with every ADR. A dated ADR addendum overrides the spec; the spec is updated in the same commit. The planning repo is deleted; its issues live here (old numbers in moved documents: `docs/process/wayfinder.md`).
- Work: GitHub issues of this repo. The issue is the plan: acceptance criteria and tasks in its body, status and decisions as comments. There are no plan files. Levels, template, labels, evidence table and the cut of increment 1: `docs/process/tickets.md` (skill `cut-tickets`).
- Decisions before work: Wayfinder maps as issues of this repo; carriers, operations and the decision page (Schaubild) per grilling round in `docs/process/wayfinder.md`.
- Judgement standards: `docs/CODING_STANDARDS.md`. Lessons: `docs/lessons.md`.

## Stack

pnpm workspaces monorepo (`apps/*`, `services/*`, `packages/*`, `tests/*`, `evals/*`); Node LTS, TypeScript strict (ESM, project references), ESLint, Prettier, Vitest (unit, describe/it) with fast-check, Cucumber (integration, API, end-to-end), Playwright, StrykerJS; Python 3 stdlib only under `evals/`; Docker Compose; twelve-factor configuration (environment only, validated at startup, secrets as `<NAME>_FILE`). Six test stages and the acceptance track: `docs/process/test-strategy.md`.

## Commands

- Everything runs through `make`; `make help` lists the targets. Node tooling runs in the toolbox container (`scripts/tb <cmd>`), never on the host.
- Diagnose containers with `docker compose ps|logs|exec` in your own project; there is no Docker MCP server by design.

## Host and isolation

- The host has Docker, Git and the Claude Code sandbox. Never install Node, pnpm or Python packages on the host.
- Never touch the owner's stack, secrets or Compose project. Every agent stack runs as `lfc-<issue>-<task>` with its own ports and throwaway secrets; a hook enforces it.
- Implementers work in a worktree `../wt-<issue>-<task>` on branch `task/<issue>-<task>`; at most three in parallel, never on shared files.
- A command the sandbox or a hook blocks is reported to the owner, never retried another way.

## Working

- One issue per session; a new session per implementer task. Compact manually at 60 to 70 % context, after writing the open points as an issue comment.
- Gates and roles: the owner approves cases and contracts at gate 1 (then `.claude/frozen/<issue>.json` freezes them) and reads the diff plus the judge's verdicts at gate 2 (`docs/process/rollen.md`). Tasks marked `Hand: owner` he builds himself with the coach (`docs/process/lernpfad.md`, skill `begleiten`). Whoever writes code does not write its tests, the owner included. Nobody skips, quarantines or weakens a test; a wrong test is reported. There is never a healer.
- Background subagents are the default for read-only work and for the review chain; every briefing names scope, files, decisions, output form and the host rules above.
- Deterministic chains (review, acceptance, test design) run as `.claude/workflows/*.js`; no agent calls agents in free sequence.
- Limit watcher: at level hard stop all subagents, write the state to the issue, schedule the continuation, halt; at level soft give each subagent a deadline, collect reports, write the state, plan for the weekly reset.

## Git

- Never commit to `main`; the main session merges only a PR with risk "niedrig" under the conditions of `docs/process/pr-format.md` ("Auto-merge at low risk"), everything else the owner at gate 2; Conventional Commits with a known scope (`commitlint.config.mjs`), small; commits in review order (contract → red tests → logic → wiring → docs); one task per PR, no stacked PRs, squash merge (`docs/process/pr-format.md`).
- A PR opens as a draft and becomes ready only when the review chain, the acceptance run and `ci passed` plus `pr passed` are green; every commit on an open PR is pushed at once.
- Every commit runs the pre-commit hook; never `--no-verify` or `core.hooksPath`. State-changing `git` or `gh` commands never end in a pipe; judge success by the exit code; bodies via `--body-file`.
- Scripts that change git state run only in a throwaway clone, with `set -euo pipefail` and a directory check.
- Push, PR and merge preparation happen only in the orchestrating main session.

## Quality

- No shortcuts to turn a test green: never make a required field optional, widen a type, add a silent default or weaken a test. If a frozen test or a type blocks you, stop and report.
- No overbuild: nothing the issue or the spec did not ask for; ideas go into the PR as suggestions.
- A decision that is hard to reverse and surprising without context gets an ADR (`docs/adr/`, same format as the planning repo).
- A task is done only with evidence: real command output, reports, screenshots (skill `evidence`).
- Every new directory under `apps/`, `services/`, `packages/`, `tests/` gets a `README.md` (Purpose, Boundaries, Pitfalls, Commands) and a covering rule in `.claude/rules/`; the files Claude loads stay within their line budgets. Both are checked by `tools/check_docs_coverage.py` and `tools/check_context_budget.py` (stage 0, pre-commit).

## Security

- Never read, print or write `.env` files, the secrets directory or anything that looks like a key. When the owner must set a secret, hand him a one-line command; never run it yourself.
- Secrets never go into code, commits, images, build args, logs, errors, metrics or traces. `.env.example` holds only non-secret settings.
- Never dismiss a scanner or review finding as false positive or won't fix, never disable a rule; a narrow suppression needs a reason in code and a mention in the PR. The owner decides. Every temporary exception, pause or advisory gate carries `DUE <date>` where it lives; `tools/check_due_dates.py` fails once the date has passed (stage 0).
- Audio is never stored; transcripts never in logs; only what ADR 0009 allows leaves the backend.

## Learning

- First occurrence of a mistake or owner correction: one row in `docs/lessons.md` (skill `lesson`). A rule is written only on the second occurrence and only if no check catches it; prefer a check (lint, hook, CI) over prose. On the third occurrence ask why the rule did not land.
- The retro (skill `retro`) runs after the first three merged tickets, then at the end of every increment, and may propose model tier changes in `.claude/models.json`.
- Project rules live in this repo, never in the agent's personal memory.
- What would hold for any project goes back to the blueprint `marcominervinidev/project-blueprint`: the reviewer's "Blueprint feedback" section, the retro's step 9 and the `blueprint` target in `docs/lessons.md` collect it; the owner decides; the main session opens the issue there (label `rueckfluss`). Product knowledge never leaves this repo.

## Language

- No bare reference in anything the owner reads (PR, issue, comment, review guide, report, reply) or in an instruction an agent follows: next to every decision number, `AC<k>`, review finding, gate-1 addendum, ADR, rule or ticket number, quote what it says (one sentence or a short excerpt) and link the source where one exists, e.g. `AC3 („Ein neuer Push bricht den laufenden Lauf seines PR ab“)`, never `AC3` alone (owner decision 2026-11-03).
- Every message to the owner is German; code, identifiers, comments, commit messages, PR technical sections and these files are English. Stack terms stay English (Stream, Commit, Hook, Token, Pull Request, Blast Radius); never invent a translation. UI texts are German and i18n-ready.

## Hooks

Hooks in `.claude/settings.json` are comfort and early warning. The real guards are lefthook (pre-commit) and CI; never rely on a hook being present.
