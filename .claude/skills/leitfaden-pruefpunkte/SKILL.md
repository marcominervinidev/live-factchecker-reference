---
name: leitfaden-pruefpunkte
description: "Checklist distilled from an agentic-coding guide the owner keeps locally (2026-10-05); how this project applies it: docs/agentic-coding.md. For reviewing plans, ADRs and diffs. Background knowledge preloaded into reviewer roles; not for direct invocation."
user-invocable: false
---

# Review checkpoints from the agentic-coding guide

Source: the guide's parts I (principles), IV (workflow, reviews) and V (modularity); how this project applies them: `docs/agentic-coding.md`. Use only the section that matches what you review. Each point is a question; an unanswered "no" is a finding.

## Plan (guide part IV, steps 2 to 8)

- Is the work split into sub-projects that can be implemented, reviewed and merged independently, or is it one monolithic plan for a phased feature?
- Does every task name exact paths, the expected shape and the verification command (here: the frozen test that must turn green)?
- Are boundaries and contracts fixed before the first task, and are contracts marked read-only for the implementer?
- Which decisions did the plan take that do not follow from issue or spec, and is an ADR or amendment foreseen for each?
- Are review gates named (after which task the orchestrator stops)?

## ADR (guide part IV "ADRs across the sequence")

- Does it state the choice, at least one rejected alternative and the why?
- Is the decision really hard to reverse and surprising without context, or does it belong in the plan or the ticket?
- Is it reflected back into the issue (the functional concept) so the acceptance can be checked from the issue alone?

## Diff (guide parts I, IV reviews, V modularity)

- Boundary violations: imports, calls or data flows across a module boundary they should not cross.
- Weakened types: required field made optional, union widened to an any-equivalent, silent default hiding an edge case.
- Drive-by changes unrelated to the task; flags or features nobody asked for.
- Invented patterns: a new abstraction or utility where the codebase already has one.
- Test quality: does the test exercise behaviour or the mock; were expectations changed to turn green; were frozen tests touched?
- Evidence: does the PR show, per requirement, what proves it (command output, report, screenshot), or only "tests pass"?
- Concept alignment: does the code deviate from issue or spec, and is the deviation reported instead of silently built in?
- Glossary: do names follow `CONTEXT.md`, and is any new concept proposed as a term rather than smuggled in?
