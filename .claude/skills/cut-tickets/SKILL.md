---
name: cut-tickets
description: "Cut an increment, an ADR, a spec section or a triaged request into tickets: grill the owner, draft one slice at a time with the refinement agent, quiz the owner on granularity and edges, then publish parent and sub-issues with native blocking edges. Owner-invoked; the main session runs it."
disable-model-invocation: true
---

# Cut tickets

Decision: `docs/process/tickets.md` (planning repo `docs/spec/tickets.md`, ticket "Vom Plan zum Ticket"). Ticket template: `.github/ISSUE_TEMPLATE/ticket.md`. Matt's `to-tickets` is not called; its rules are folded in here.

## Input

The owner names the source: an increment ("Inkrement 1"), an ADR, a spec section, or a request issue carrying an agent brief after triage. Read the source, `CONTEXT.md`, the ADRs the source cites, and what this repo already has in the area (reuse before invention).

## Steps

1. **Grill.** Call the Skill tool for "grilling" and "domain-modeling". Settle scope and order with the owner: what the increment ends at, what is out, which architecture tickets still block parts of it. German, numbered questions, recommendation first.
2. **Slice.** Draft the slices as a numbered list: title, what exists afterwards, the seam it is accepted at (segment seam, live contract event, stage 3, harness report), blockers. Backend tickets end at an observable seam; from the frontend increment on, every ticket is a tracer bullet through all layers. No horizontal slices except a wide refactor as expand–contract. The first ticket of an increment is the walking skeleton.
3. **Quiz.** Ask the owner: granularity right? every edge a real gate? merge or split any? Then one question per task of a platform ticket: agent or hand (learning goals in `.claude/rules/platform.md`)? Warn when a hand task lies on the critical path (its ticket blocks others): deadline 7 days after gate 1, then takeover and later rebuild (`docs/process/lernpfad.md`). Iterate until approved.
4. **Draft.** One run of the `refinement` agent per slice (background, parallel, each with the slice text, the sources, and the increment). Size L comes back as a split proposal: apply it before publishing. At most three tasks per ticket; each task under 400 production lines.
5. **Review.** Show the owner one table with one plain German line per ticket (from the box "Für Marco") and only the open questions; deduplicate questions that recur across drafts. Assumptions stand unless he objects; the drafts are attached, not required reading. Edit only on the owner's word.
6. **Publish.** In dependency order, blockers first:
   - parent issue "Inkrement <n>" (or the request issue as parent) with a link to the planning ticket;
   - one issue per draft from the template, label `refined`, as a native sub-issue of the parent (`gh api` sub-issues endpoint);
   - blocking edges with the native dependency relation (`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`); external blockers in the planning repo go as a `Blocked by (planning): <links>` line in the body;
   - a measurement ticket carries the "Measurement" section; everything else deletes it;
   - a task the owner builds keeps the line `Hand: owner` in its section; every other task deletes the `Hand:` line. The label `ready-for-human` is set later by the main session, when the hand task is the next one.
7. **Report.** Publish an overview page of the increment (Artifact: the tickets as a chain with their edges, one plain line each, links to the issues) and link it from the parent issue; tell the owner the frontier (open, unblocked, unassigned, in sub-issue order).

## Rules

- No file paths or code in acceptance criteria; paths belong to tasks. Snippets only when a prototype fixed a decision more precisely than prose.
- No bare reference in tickets, comments and questions to the owner: next to every AC, decision, ADR or other ticket stands the sentence it refers to, quoted (`CLAUDE.md` "Language", owner decision 2026-11-03).
- Never close or edit the source issue; never create tickets without the owner's approval of the slice list.
- `gh` commands never end in a pipe; judge success by the exit code; bodies via `--body-file`.
- The first run of this skill is the cut of increment 1 in `docs/process/tickets.md`; it is also the skill's test.
