---
name: begleiten
description: "Accompany the owner through the current hand task (a ticket task marked `Hand: owner`) with the read-only platform-coach: explain, question, verification commands, learning note into the ticket. Owner-invoked from the main session; never builds the task."
disable-model-invocation: true
---

# Accompany a hand task

Decision: ticket "Lernpfad Plattform-Engineering" of the process map (`docs/process/lernpfad.md`). Rules: `.claude/rules/platform.md`, `.claude/rules/tickets.md`. Agent: `.claude/agents/platform-coach.md`.

## Preconditions

1. The ticket has a task section with `Hand: owner` and the label `ready-for-human`; gate 1 is passed and `.claude/frozen/<issue>.json` exists. Without the manifest there is nothing to build against: stop and tell the owner.
2. The owner works on branch `task/<issue>-<task>` in his own checkout and his own Compose project; the main session does not create a worktree for a hand task.
3. Note the deadline when the ticket blocks others: 7 days after the gate-1 comment. Tell the owner the date at the start of every session.

## Steps

1. Read the ticket (`gh issue view <n> --comments`), the task section, the manifest, and the learning notes of earlier sessions; the last note's **Offen** is the entry point.
2. Start the `platform-coach` agent in the foreground (not background: the session is a dialogue) with: issue and task, the task section verbatim, the manifest path, the paths he may touch, the previous learning notes, the deadline, and the host rules (sandbox, owner's own stack, no secrets). Relay the dialogue; do not answer platform questions yourself.
3. Keep the coach read-only: when the owner asks the main session for the diff instead, the answer is the same no. Verification runs on the owner's machine; the main session does not run his stack.
4. Session end (owner says so, or context at 60 to 70 %): take the coach's learning note, show it to the owner, post it as a comment under the task with `gh issue comment <n> --body-file <file>` (heading `Lernnotiz Task <t>, <date>`), and record the minutes and the session count in `.claude/scratch/balance/<issue>/hand-<task>.json` (`{"minutes": n, "sessions": n}`, cumulative) for the Agenten-Bilanz.
5. When the owner is ready for the PR: skill `open-pr` as for any task; the review chain runs with the platform-engineer in the reviewer seat; gate 2 is the owner's explanation, not the agent's.
6. Deadline reached and the task still open: ask the owner once; on takeover flip the label to `ready-for-agent`, brief the platform-engineer with the manifest and the learning notes, and add a `Nachbau` line under the task (rebuild later, off the path, same manifest).

## Never

Write the task's files from the main session; weaken or explain away a frozen test; start or touch the owner's stack; skip the learning note.
