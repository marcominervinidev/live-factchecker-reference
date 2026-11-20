# Agentic coding: a reference guide

**English** · [Deutsch](agentic-coding.de.md)

This guide explains how to build software with AI agents when one human carries the responsibility and the agents
work in separate roles. It sets out the rules that have proven useful and why they matter. You can carry it over to
your own project; each part ends with a short note on how this repository does it.

The model in one sentence: agents write code, tests and reviews, the owner decides at two gates, and whatever can be
checked is checked by code rather than by a model.

## Part 1: The principles

| Rule | Why |
|---|---|
| Whoever writes the code never writes its tests. | A model that tests itself only checks its own reading of the task. |
| Contracts between modules are read-only for agents. | Otherwise the agent bends the interface to fit its code instead of the reverse. |
| After approval, tests and contracts are frozen. | A target that can move during the build is not a target. |
| The owner decides at two gates: before the code and before the merge. | That is where responsibility sits; roles and checks work in between. |
| What a tool can check becomes a check, not prose. | Written rules get skimmed; checks do not. |
| Done means proven. | A done report without command output, a report or a screenshot does not count. |
| One session, one task. | Context from other tasks makes every answer worse. |
| No test is weakened, skipped or parked. | A wrong test is reported and decided by the owner, never quietly fixed. |

*In this repo:* [`CLAUDE.md`](../CLAUDE.md), roles in [`.claude/agents/`](../.claude/agents/), hooks
[`contracts.sh`](../.claude/hooks/contracts.sh) and [`test-integrity.sh`](../.claude/hooks/test-integrity.sh),
frozen states in [`.claude/frozen/`](../.claude/frozen/README.md).

## Part 2: Roles and gates

Agents read a lot quickly and stay consistent across many files. But they like to build more than was asked,
report success early and take a shortcut when a test would otherwise stay red. Separate roles catch exactly that:
each role has a job and a list of what it never does.

| Role | Does | Never does |
|---|---|---|
| owner | architecture, contracts, approvals, exceptions | write the tests for their own code |
| refinement | ticket with acceptance criteria from the decision | code or tests |
| test designer | red tests and acceptance cases before the code | production code |
| critic | attacks the tests, on a stronger model | edit tests |
| implementer | turns the frozen tests green | tests, contracts, push |
| reviewers | look for shortcuts, boundary and security faults | change code |
| acceptance judge | judges evidence against the expectation written beforehand | read code; run on the author's model |

**Gate 1** comes before the code: you approve tests and contracts, and they are frozen. **Gate 2** comes before the
merge: you read the diff and the verdicts. Everything in between runs without you, but not without control.

One trick keeps the judge honest: among the acceptance cases sits a deliberately wrong one, a canary. If the judge
passes it, its verdict does not count.

*In this repo:* [`process/rollen.md`](process/rollen.md), [ADR 0011](adr/0011-rollen-und-bahnen-des-arbeitssystems.md),
model tiers in [`.claude/models.json`](../.claude/models.json).

## Part 3: Small steps with proof

**The ticket is the plan.** Acceptance criteria and tasks live in the ticket, not in loose plan files nobody keeps
up to date.

**One task, one pull request.** Small PRs get read; large ones get waved through. A hard limit on production lines
keeps it that way.

**Red before green.** A test proves something only if it fails for the right reason without the change. Let CI check
that on the PR's base.

**Done comes with evidence.** An agent reports done with real command output, a report or a screenshot. The
acceptance run is code; the model only judges its result.

**Findings flow back into the concept.** When the build shows that a boundary or contract has to change, the decision
is recorded first (as an architecture decision record, ADR, or an addendum), then the work restarts. A correction that needs several paragraphs of
explanation is a spec change and belongs in the ticket.

*In this repo:* [`process/tickets.md`](process/tickets.md), [`process/pr-format.md`](process/pr-format.md),
[`check_pr_size.py`](../tools/check_pr_size.py), [`check_red_before_green.sh`](../tools/check_red_before_green.sh),
skill [`evidence`](../.claude/skills/evidence/SKILL.md).

## Part 4: Spending context and tokens carefully

What an agent has in its context window decides what it delivers. Anything there that does not serve the task
crowds out what matters, and every line costs, often again on every call. So treat context as a tight budget.

- **Line budgets with a check.** The files the agent always loads get a ceiling that a script checks. When a file
  grows too long, cut it or point to a document instead.
- **Load on demand.** The main file holds principles and pointers. Rules for one area load only when the agent works
  there; procedures live in skills, of which only the short description is always loaded.
- **Summarise instead of carrying along.** Before larger work in an area, a separate session writes a short note on
  responsibilities, data flow, types and pitfalls. The implementation reads the note, not the area.
- **Subagents for a reason.** A subagent keeps the main session clean but rebuilds its context and spends tokens of
  its own. Use it for broad reading and for reviews, with a briefing of scope, files, decisions and the expected
  output form.
- **Model by role, effort by risk.** The strongest models judge (critic, judge, architecture), implementation runs a
  tier below, and its reasoning effort follows the task's risk.
- **One shared prefix.** All reviewers get the same packet as the start of their prompt. That saves through prompt
  caching and keeps findings comparable.
- **Fixed sequences.** Recurring chains run as scripts with capped rounds, not as agents calling each other.
- **Compact in time.** At 60 to 70 percent context fill, compact, after writing the open points into the ticket.
- **Measure.** Every PR shows rounds, attempts and, where available, tokens per role. The retro bases its proposals on them.

*In this repo:* [`check_context_budget.py`](../tools/check_context_budget.py),
[`.claude/rules/`](../.claude/rules/), [`.claude/skills/`](../.claude/skills/),
[`docs/synthesis/`](synthesis/README.md), [`review-chain.js`](../.claude/workflows/review-chain.js),
[`.claude/workflows/`](../.claude/workflows/), [`agent_balance.py`](../tools/agent_balance.py).

## Part 5: Working in sessions

**One main session orchestrates.** Only it pushes, opens PRs and prepares merges. Implementers work in a fresh
session per task, on their own branch and in their own working copy, never on shared files.

**The briefing is all a subagent knows.** Give it a fixed shape: task, exact paths, contract, the red tests,
verification command, limits, report format.

**Stop cleanly at limits.** When the usage quota runs low, start no new subagents, write the state into the ticket
and plan the continuation instead of breaking off mid-task.

*In this repo:* skill [`brief-implementer`](../.claude/skills/brief-implementer/SKILL.md),
hook [`limit-guard.sh`](../.claude/hooks/limit-guard.sh), [`tools/limit-waechter/`](../tools/limit-waechter/README.md).

## Part 6: Review

**Tools before models.** Static analysis, scanners and dependency checks run first; their results go into the review
packet.

**Separate fields.** One reviewer looks for shortcuts (loosened types, weakened tests, extras nobody asked for), one
for security, one for architecture. None changes code; each reports with file and line.

**The PR explains itself.** At the top stand the risk, the revertibility and the few places that deserve a close
look. Every reference number appears with the sentence it points to.

**Green reviews pre-sort; they do not replace gate 2.** What gets merged is what the owner has read. You may define
an exception for narrowly scoped low-risk PRs, but only with written conditions.

*In this repo:* [`process/review-tools.md`](process/review-tools.md), [`pr.yml`](../.github/workflows/pr.yml),
[`CODING_STANDARDS.md`](CODING_STANDARDS.md), [`process/pr-format.md`](process/pr-format.md).

## Part 7: Clean modules

What wears a codebase down under agents rarely shows in one diff but in the sum of many harmless ones: a required
field that becomes optional, a type that gets wider, a silent default that swallows an error. Forbid exactly these
shortcuts in so many words.

**Boundaries before building.** Every seam between modules gets a checked contract. Only the owner may change it,
with a decision, a version bump and contract tests.

**Boundaries as tooling.** Dependency rules and project references turn wrong imports into build errors. Every new
area gets a short README with purpose, boundaries and pitfalls.

**Deep modules, one vocabulary.** Small interfaces with a lot of behaviour behind them, no exports just for tests,
and a glossary so agents do not invent synonyms.

*In this repo:* [ADR 0012](adr/0012-vertraege-in-zod-json-schema-erzeugt.md),
[`check_docs_coverage.py`](../tools/check_docs_coverage.py), [`CODING_STANDARDS.md`](CODING_STANDARDS.md),
[glossary](../CONTEXT.md).

## Part 8: Learning from mistakes

An agent repeats a mistake until something stops it. The loop has three steps:

1. **The first time**, one row in a lessons file, noting whether a tool would have caught it.
2. **The second time**, a safeguard in the narrowest place that fits, preferably a check (lint, hook, CI), otherwise
   a rule for the area, the main file only as a last resort.
3. **The third time**, ask why the safeguard does not take hold.

A retro after the first tickets and then per stage proposes changes to rules, thresholds and model tiers. Project
rules belong in the repository, never in an agent's personal memory.

*In this repo:* [`lessons.md`](lessons.md), skills [`lesson`](../.claude/skills/lesson/SKILL.md) and
[`retro`](../.claude/skills/retro/SKILL.md), hook [`git-pipe.sh`](../.claude/hooks/git-pipe.sh) as an example of a
promoted lesson.

## Part 9: Boundaries and security

Agents get far-reaching rights. So put several layers in place:

| Layer | Protects against |
|---|---|
| sandbox | access outside the allowed paths and network destinations |
| container for tooling | installs on the owner's machine |
| permissions | reading and writing secrets and `.env` files |
| hooks | changes to secrets, frozen files, contracts and tests |
| isolation | collisions: own working copy, own stack, throwaway secrets per task |
| pre-commit and CI | secrets in commits, scanner findings, expired exceptions |

**Hooks are early warning, not the last word.** Local checks can be skipped; CI repeats each one.

**No agent sees secrets.** When the owner has to set one, they get a one-line command and run it themselves.

**Blocked means report.** When the sandbox or a hook refuses a command, the agent does not look for a way around it.
No agent declares a scanner finding a false positive; every exception needs a reason and an expiry date that a check
enforces.

*In this repo:* [`settings.json`](../.claude/settings.json), [`.claude/hooks/`](../.claude/hooks/),
[`lefthook.yml`](../lefthook.yml), [`ci.yml`](../.github/workflows/ci.yml),
[`check_due_dates.py`](../tools/check_due_dates.py).

## In closing

Agents make the work faster, not less controlled. Every decision has a place, every step has proof, and every rule
broken twice becomes a check. How much of this a project needs depends on its size. The principles from Part 1 and
the careful use of context from Part 4 always apply.
