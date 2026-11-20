---
paths:
  - ".github/ISSUE_TEMPLATE/**"
  - "tools/evidence_table.py"
  - ".claude/skills/cut-tickets/**"
---

# Tickets, increments and the evidence table

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Decision: `docs/process/tickets.md` (planning repo `docs/spec/tickets.md`).

- Three levels: increment = parent issue with native sub-issues; ticket = one issue with one manifest; task = a section of the ticket body and exactly one PR. Tasks are never sub-issues.
- Templates: `ticket.md` (refinement draft fields, optional Measurement section) and `request.md` (anything new, label `needs-triage`). No issue forms: agents write Markdown.
- States are labels: `needs-triage`, `needs-info`, `refined`, `ready-for-agent` (gate 1 passed, manifest written), `ready-for-human`, `wontfix`. In progress = assignee. Closed by code after the merge when every case passes.
- Hand tasks (`docs/process/lernpfad.md`): a task section with the line `Hand: owner` is built by the owner. `ready-for-human` goes on the ticket as soon as a hand task is the next task and comes off when its PR is merged. A hand task on the critical path has a deadline of 7 days after gate 1; after that the main session flips the label to `ready-for-agent`, the platform-engineer builds it and writes the learning note into the ticket, and the task is marked for a later rebuild by the owner (same manifest, off the path).
- No bare references in tickets, comments and addenda: quote the AC, decision, ADR or ticket you point to next to its number (`CLAUDE.md` "Language").
- Acceptance criteria are numbered `AC<k>` and stable; after gate 1 only the owner changes them (`FROZEN_UNLOCK=<issue>`, logged as a comment). Tests carry `@issue-<n>` and `@ac-<k>`.
- The evidence table is generated: `python3 -I tools/evidence_table.py --issue <n> …` after every acceptance run and at ticket close, posted as an issue comment, never written by hand and never into the body.
- Reports stay out of the repo: Playwright and Cucumber reports are Actions artifacts (30 days); the judge comment holds one quote and at most two images per case.
- Priority is the blocking graph: take the first frontier ticket unless the owner names one. No prioritizer agent.
