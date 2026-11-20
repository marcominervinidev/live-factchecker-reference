# Agentic coding in this project

**English** · [Deutsch](agentic-coding.de.md)

This document explains how software gets built with AI agents in `live-factchecker-v2`. It is written for people
who want to know how Marco, as the owner, works with agents. Read in full it takes about eight minutes; the
headings, bold openings and tables alone carry the core in three. Every statement points to the file that
implements it, so anything said here can be checked in the repository.

The short version: agents write almost all of the code, the tests and the reviews in this project. They do it in
separate roles, against decisions a human made beforehand, under checks that run as code. The human decides at two
points.

## Part 1: Eight principles

The remaining parts show how these eight points work day to day. None of them is just a wish in a document; each is
anchored in a place an agent cannot talk its way past.

| Principle | Where it lives |
|---|---|
| Whoever writes the code never writes its tests, Marco included. | separate roles in [`.claude/agents/`](../.claude/agents/), [`process/rollen.md`](process/rollen.md) |
| Contracts between modules are read-only for agents. | hook [`contracts.sh`](../.claude/hooks/contracts.sh), skill [`new-contract`](../.claude/skills/new-contract/SKILL.md) |
| After gate 1, tests, contracts and ticket text are frozen. | one manifest per ticket in [`.claude/frozen/`](../.claude/frozen/README.md), hooks (sha256) and CI (red before green) |
| Two gates belong to the owner: before the code and before the merge. | [`process/rollen.md`](process/rollen.md), [ADR 0011](adr/0011-rollen-und-bahnen-des-arbeitssystems.md) |
| A rule a tool can check becomes a check, not prose. | [`lefthook.yml`](../lefthook.yml), scripts under [`tools/`](../tools/) |
| A task is done only with evidence, never on a claim. | skill [`evidence`](../.claude/skills/evidence/SKILL.md), acceptance report per ticket |
| One session works on one issue; every implementer task gets a fresh one. | [`CLAUDE.md`](../CLAUDE.md), section *Working* |
| Nobody weakens, skips or parks a test; a wrong test is reported. | hook [`test-integrity.sh`](../.claude/hooks/test-integrity.sh), [`CLAUDE.md`](../CLAUDE.md) |

**Why splitting code from tests comes first.** A model that tests its own code mostly tests its own reading of the
task. So here the test designer writes the red tests, a critic on a stronger model tier attacks them, and only then
does the implementer start.

**Why two gates are enough.** Marco does not read every intermediate step. At the start he decides what "done"
means (tests and contracts); at the end he decides whether the result matches (diff and verdicts). In between,
hooks, CI and review roles hold the line.

## Part 2: Who carries what

Agents read a lot quickly and stay consistent across many files. They also tend to build more than was asked,
report success early and take a shortcut when a test would otherwise stay red. The split is aimed right there.

| Owner (Marco) | Agent roles | Checks without a model |
|---|---|---|
| architecture, boundaries, contracts, ADRs | ticket draft from ADR and spec | format, lint, types, dependency boundaries |
| approving tests and contracts (gate 1) | red tests, acceptance cases, counter-check | checking frozen files by hash |
| reading diff and verdicts, merging (gate 2) | production code per task | "red before green" on the PR base |
| deciding every exception | reviews with file and line, never editing | acceptance run, scanners, PR size |
| model tiers, rules, what gets learned | retro proposals | context budget, due dates, model sync |

Eleven roles are defined, each with what it does and what it never does; the table in the
[README](../README.md#3-how-the-agents-work-together) lists them all.

## Part 3: From ticket to merge

Every change takes the same path, long at the start and short at the end on purpose.

1. **Decide.** Marco settles open questions in grilling rounds and records them as ADR and spec
   ([`docs/adr/`](adr/), [`docs/spec/`](spec/), [`process/wayfinder.md`](process/wayfinder.md)).
2. **Cut.** The refinement agent turns them into a ticket draft with acceptance criteria, risk and tasks
   ([`process/tickets.md`](process/tickets.md)). The issue is the plan; there are no plan files.
3. **Tests first.** The test designer writes Gherkin features, red unit tests and acceptance cases, including one
   deliberately wrong case as a canary. The critic reviews for at most two rounds.
4. **Gate 1.** Marco approves tests and contracts. A manifest freezes them by hash.
5. **Build.** One implementer per task in its own worktree, branch and Compose project, with at most three attempts
   to reach green. It then reports `DONE`, `DONE_WITH_CONCERNS` or `BLOCKED`, with real command output.
6. **Check.** The review chain runs in parallel over one shared packet (Part 6). Then the acceptance run executes
   as code, and a judge on a different model than the author's assesses its report.
7. **Gate 2.** Marco reads diff and verdicts and merges. Exception: a PR whose derived risk is "low" (revertible and
   local) and that passed everything is merged by the main session and shown to Marco afterwards
   ([`process/pr-format.md`](process/pr-format.md)).

**Small steps with proof.** One task is one PR, below about 400 lines of production code
([`check_pr_size.py`](../tools/check_pr_size.py) warns above that and blocks at 800). Commits come in reading order:
contract, red tests, logic, wiring, docs. CI checks on the PR base that the frozen tests fail there for the right
reason ([`check_red_before_green.sh`](../tools/check_red_before_green.sh)); a test that is already green without
the change proves nothing.

**Findings go back into the concept.** When a boundary, a contract or a principle shifts during the build, a dated
ADR addendum is written first; it overrides the spec, which is updated in the same commit, and
[`architecture.md`](architecture.md) follows. Only then comes a new attempt. A correction in a PR that needs several
paragraphs of explanation is a spec change and belongs in the issue
([`spec/process/tickets.md`](spec/process/tickets.md)).

## Part 4: Spending context and tokens carefully

What an agent has in its context window decides what it delivers. Whatever sits there without serving the task
crowds out what matters, and every line is paid for, often again on every call. So the project treats context as a
tight budget rather than a place to store everything just in case.

**Fixed line budgets, checked before the commit and in CI.** The files Claude Code loads on its own have ceilings:
`CLAUDE.md` 120 lines, area rules 80, roles 120, skills 100. Above that, text is cut or moved to a document the
file points to; [`check_context_budget.py`](../tools/check_context_budget.py) checks it.

**Three ways in instead of one big file.**

| What | When it is loaded | Where |
|---|---|---|
| rules for every session | always, so short and mostly pointers | [`CLAUDE.md`](../CLAUDE.md) |
| rules for one area | only when the agent touches files on that path | [`.claude/rules/`](../.claude/rules/) with `paths:` |
| procedures | only the short description up front, the body on use | [`.claude/skills/`](../.claude/skills/) |
| checklists for roles | preloaded only into the roles that need them | `skills:` field in the role files |

**Summarise instead of carrying along.** When a session has to understand a whole area of the code, a separate
session first writes a synthesis note: what the area is responsible for, how data flows, which types carry it,
where it snags, with date and commit ([`docs/synthesis/`](synthesis/README.md)). The implementer reads the note
instead of the whole area. Briefings list the files one by one instead of handing over whole folders. Raw
measurement data stays out of the repository; only the evaluation is committed.

**Subagents only for a reason.** A subagent keeps the main session clean because it reads and returns only the
result. But it builds its context from scratch and spends tokens of its own. So background subagents are the
default for read-only work and the review chain ([`CLAUDE.md`](../CLAUDE.md), *Working*), each briefed with scope,
files, decisions already taken, the expected output form and the host rules. When the usage quota runs low, a hook
refuses new subagents altogether ([`limit-guard.sh`](../.claude/hooks/limit-guard.sh)).

**Model tier by role, effort by risk.** The tiers live in one place, [`.claude/models.json`](../.claude/models.json).
The judgements everything rests on (acceptance judge, critic, architecture review) run on the highest tier; no
review role runs below "stark". The implementer's reasoning effort follows the ticket's risk: low, medium or high.
[`sync_agent_models.py`](../tools/sync_agent_models.py) writes the tiers into the role files and fails the check
when a floor is broken.

**One prefix for all reviewers.** The main session builds the review packet once (diff, manifest, synthesis note,
tool results) and hands it to every reviewer as the identical start of its prompt
([`review-chain.js`](../.claude/workflows/review-chain.js)). That lets prompt caching work.

**Fixed sequences instead of free chains.** The three chains that repeat (test design, review, acceptance) run as
scripts under [`.claude/workflows/`](../.claude/workflows/). No agent calls another at its own discretion. Rounds
and attempts are capped: two rounds of critique, three attempts to green.

**Compact in time.** At 60 to 70 percent context fill the session is compacted by hand, after the open points have
been written into the issue as a comment. A hint hook speaks up from 60 percent
([`context-hint.sh`](../.claude/hooks/context-hint.sh)), and before every compaction a hook notes the git state
([`pre-compact.sh`](../.claude/hooks/pre-compact.sh)).

**Measure, don't guess.** Every PR carries an agent balance: rounds, attempts to green and verdicts per role, plus
tokens where the session data is available ([`agent_balance.py`](../tools/agent_balance.py)). The retro reads these
numbers and proposes changes to the model tiers.

## Part 5: Working in sessions

**One issue, one session.** Anything that does not belong to the issue gets its own issue and, later, its own
session. Every implementer task starts fresh, so the code of one task does not depend on the noise of the last.

**The main session orchestrates, the roles do the work.** Only the main session pushes, opens PRs and prepares
merges. Implementers commit on their own branch and nothing else. At most three run in parallel, never on shared
files.

**The briefing is all a subagent knows.** So it has a fixed shape
([`brief-implementer`](../.claude/skills/brief-implementer/SKILL.md)): task, exact paths, contract, the frozen red
tests, verification command, host rules, worktree and stack names, report format.

**Limits of a run.** When the limit watcher ([`tools/limit-waechter/`](../tools/limit-waechter/README.md)) reports
the hard limit, the main session stops all subagents, writes the state into the issue and schedules the
continuation.

**Don't:** an implementer that "quickly" extends the contract on the side and rewords an acceptance criterion; that
is exactly what the hooks [`contracts.sh`](../.claude/hooks/contracts.sh) and
[`frozen-manifest.sh`](../.claude/hooks/frozen-manifest.sh) refuse.

## Part 6: Review

**Several pairs of eyes, different questions.** The reviewers are separate roles with their own field and never
edit.

| Role | Looks for |
|---|---|
| reviewer (always) | shortcuts: loosened types, weakened tests, extras nobody asked for |
| security reviewer | secrets, input limits, privacy boundary, CI security; every finding blocks |
| architecture reviewer | module boundaries, duplicated state, missing ADRs, stale synthesis notes |
| frontend reviewer | components, accessibility, i18n; only for changes under `apps/` |

Tools come before models: Fallow and Sonar from [`process/review-tools.md`](process/review-tools.md), Semgrep and
Trivy from the PR pipeline ([`pr.yml`](../.github/workflows/pr.yml)); their results sit in the review packet
([ADR 0011, addendum 2026-10-25](adr/0011-rollen-und-bahnen-des-arbeitssystems.md)). The reviewers also get a short
checklist for plans, ADRs and diffs preloaded, and they judge by the [coding standards](CODING_STANDARDS.md), which
hold only judgement calls; anything mechanical is a lint rule.

**Acceptance judges evidence, not code.** The acceptance judge reads only the report of the acceptance run and
compares it with the expectation written down before anything was built. It is not told which case is the canary.
If it passes the canary, its verdict is thrown away.

**The PR is written for a reader who has not seen the ticket.** At the top sits the German review guide with risk,
revertibility and at most five places that deserve a close look. Every number appears with the sentence it refers
to. Ideas nobody ordered appear as suggestions in the PR, not quietly in the code.

Green verdicts are a pre-sort for gate 2, not a substitute for it; what gets merged is what Marco has read.

## Part 7: Clean modules at agent speed

What threatens the code here does not show in one diff but in the sum of many that each look harmless: a required
field that becomes optional, a type that gets wider, a silent default that swallows an error
([`CLAUDE.md`](../CLAUDE.md), *Quality*; role [`reviewer`](../.claude/agents/reviewer.md)).

**Boundaries before building.** Every seam between modules has a contract as a Zod schema with generated JSON
Schema ([ADR 0012](adr/0012-vertraege-in-zod-json-schema-erzeugt.md), `packages/contracts/`). Only the owner may
change one, with an ADR, a version bump and contract tests.

**Boundaries as tooling.** dependency-cruiser runs before the commit and in CI, TypeScript project references keep
the packages apart, and the architecture reviewer knows the contracts. New directories under `apps/`, `services/`,
`packages/` and `tests/` get a README (purpose, boundaries, pitfalls, commands) and a matching area rule;
[`check_docs_coverage.py`](../tools/check_docs_coverage.py) checks it.

**Deep modules.** A small interface with a lot of behaviour behind it, one concept in one place. No export and no
parameter just so a test can reach internals ([`CODING_STANDARDS.md`](CODING_STANDARDS.md)). A new sub-project
takes over the structure and quality level of the best existing one
([`new-service`](../.claude/skills/new-service/SKILL.md)).

**One vocabulary.** Domain terms are defined once in the [glossary](../CONTEXT.md), together with the terms not to
use.

## Part 8: Learning from mistakes

An agent repeats a mistake until something stops it. The loop for that has three steps.

1. **The first time**, the mistake or Marco's correction becomes one row in [`lessons.md`](lessons.md), noting
   whether a tool would have caught it (skills [`lesson`](../.claude/skills/lesson/SKILL.md) and
   [`feedback`](../.claude/skills/feedback/SKILL.md)).
2. **The second time**, it becomes a safeguard, in the narrowest place that fits and preferably as a check: lint,
   hook or CI job before an area rule, an area rule before `CLAUDE.md`. Prose only when nothing can be checked.
3. **The third time**, the question is no longer the mistake but why the safeguard does not take hold.

Two examples from the table that are hooks today: [`git-pipe.sh`](../.claude/hooks/git-pipe.sh) (a pipe hid failed
commits) and [`owner-stack.sh`](../.claude/hooks/owner-stack.sh) (agents reached the owner's stack).

The [retro](../.claude/skills/retro/SKILL.md) runs after the first three merged tickets and then at the end of
every increment, and proposes changes to rules, thresholds and model tiers. Project rules live in the repository,
never in an agent's personal memory.

## Part 9: Boundaries and security

What agents may not do is drawn in several layers.

| Layer | What it prevents |
|---|---|
| Claude Code sandbox on the host | access outside the allowed paths and network destinations |
| toolbox container | installs on the host: Node, pnpm and packages run only in the container (`scripts/tb`) |
| permissions in [`settings.json`](../.claude/settings.json) | reading and writing `.env` files and the secrets directory |
| hooks | secrets, the owner's stack, frozen files, contracts, disabled tests, pipes after git commands |
| isolation | own worktree, branch and Compose project `lfc-<issue>-<task>` with throwaway secrets per task |
| pre-commit and CI | gitleaks, scanners, image scan, an expiry date for every exception |

**Hooks warn early but do not decide alone.** They are comfort and early warning; the real guards are the git hooks
via [lefthook](../lefthook.yml) and CI. No protection relies on a hook being loaded. Every clone sets up the
pre-commit checks in `lefthook.yml` itself; because `--no-verify` can skip them, CI repeats each one
([`ci.yml`](../.github/workflows/ci.yml), [`pr.yml`](../.github/workflows/pr.yml)). The hooks have a regression
test of their own ([`test-hooks.sh`](../.claude/hooks/test-hooks.sh)).

**No agent sees secrets.** It does not read, print or write `.env` files or anything that looks like a key. When
Marco has to set a secret, he gets a one-line command and runs it himself.

**Blocked means: report.** When the sandbox or a hook refuses a command, the agent does not look for another way;
it reports. No agent declares a scanner finding a false positive; a narrow exception needs a reason in the code, a
mention in the PR and an expiry date that [`check_due_dates.py`](../tools/check_due_dates.py) enforces
([`process/due.md`](process/due.md)).

## What this means

For a client project this means: agents make the work faster, not less controlled. Every decision has a place,
every step has proof, and every rule broken twice becomes a check. How much of this a project needs depends on its
size; the principles from Part 1 and the context discipline from Part 4 always apply.
