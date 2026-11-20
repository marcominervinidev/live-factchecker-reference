---
name: brief-implementer
description: "Write the briefing for one implementer run: task, exact paths, contract, frozen red tests, verification command, host rules, isolation names, report format. Use before every Agent call that starts the implementer role."
---

# Briefing an implementer

The implementer sees only its role file, the CLAUDE.md hierarchy and this briefing; never the conversation. Everything it needs to act, and nothing it would have to guess, goes in here.

## Template

```
Issue #<n>, task <t>: <one sentence goal>
Branch task/<n>-<t> in worktree ../wt-<n>-<t>; Compose project and toolbox lfc-<n>-<t>; ports <range>; LFC_TOOLBOX=lfc-<n>-<t>-toolbox-1.

Paths you may change: <list>
Contract(s): <paths>, read-only.
Frozen (never edit): everything in .claude/frozen/<n>.json: <list the red tests and features>
Definition of done: `<verification command>` exits 0; these tests turn green: <names>.
Decisions already made: <from issue comments, ADRs; three to six lines>
Reuse: <existing modules or helpers to use instead of inventing>
Synthesis: docs/synthesis/<area>.md (<date>, <commit>)   <- only when a note exists for the touched area; else drop the line
Host rules: sandbox and toolbox only; never install on the host; never touch the owner's stack, secrets or .env; a blocked command is reported, never retried another way; commits only on your branch through the pre-commit hook; no push, no gh, no pipes on git.
Attempts: at most three to green, then BLOCKED.
Report: STATUS, Attempts, Commits, Verification output, Changed files, Concerns. German for the owner.
```

## Before sending

- The worktree, branch and toolbox exist and the manifest is written (gate 1 passed).
- Model per `.claude/models.json`: role implementer (tier stark, never spitze); pass the effort from its map by the ticket's Risk field (low `medium`, medium `high`, high `xhigh`) as the Agent tool's `effort`.
- A synthesis note older than the area's last substantial change is named as stale in the briefing, not silently passed on.
- Nothing in the briefing contradicts the issue; if it would, fix the issue first.

## After the run

Read the report; verify side effects (`git status`, `git stash list`, remote branches, `docker ps` filtered by `lfc-<n>-<t>`); record attempts as the "Loops" metric; never treat the report as proof of the code.
