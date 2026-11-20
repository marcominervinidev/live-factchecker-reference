# Learning path: platform tasks by hand

Short form for readers in the repo. Decision: ticket "Lernpfad Plattform-Engineering" of the process map in the planning repo (2026-10-22). Files: `.claude/rules/platform.md`, `.claude/rules/tickets.md`, `.claude/agents/platform-coach.md`, `.claude/agents/platform-engineer.md`, `.claude/skills/begleiten/SKILL.md`, `.claude/skills/cut-tickets/SKILL.md`, `.github/ISSUE_TEMPLATE/ticket.md`, `tools/agent_balance.py`.

## Why

The owner learns platform engineering (Docker hardening, Compose networks, the CI stack; later Kubernetes and Terraform) and builds some platform tasks himself instead of reading what an agent built. The work system does not change for that: the same gates, branches, reviews and evidence apply to a hand task as to an agent task. Only the seat at the keyboard changes.

## Marking

- The unit is the task, not the ticket. A task section in the ticket body carries the line `Hand: owner`; the template has the field, every other task deletes it.
- The `cut-tickets` quiz asks per task of a platform ticket: agent or hand? It warns when a hand task lies on the critical path, i.e. its ticket blocks others. Which tasks qualify is decided case by case against the learning goals in `.claude/rules/platform.md`.
- The label `ready-for-human` goes on the ticket as soon as a hand task is the next task and comes off when its PR is merged. There is no new label.
- Increment 1: T1 (the skeleton) is not a hand task; the owner gets it explained back at gate 2. The first hand tasks are the nightly no-cache toolbox build and its wiring into the existing `nightly.yml`.

## Flow

1. **Gate 1 as usual.** The test designer writes the manifest and the red tests, the critic checks them, the owner approves. Whoever writes code does not write its tests; that holds for the owner.
2. **Build with the coach.** The owner runs the skill `begleiten` in the main session. It starts the `platform-coach`, an agent with Read, Glob and Grep only. The coach explains concepts, asks questions, hands over the exact verification commands (`hadolint`, `docker compose config`, `actionlint`, a real start with health check, the task's `Verify:` line) and reads the pasted output. It never proposes the finished diff; hints go from coarse to fine across turns.
3. **Learning note per session.** Every session ends with one comment under the task in the ticket: what was learned, what is open. `docs/lessons.md` stays reserved for agent mistakes. The minutes and sessions go into `.claude/scratch/balance/<issue>/hand-<task>.json`.
4. **PR as usual.** Branch `task/<issue>-<task>`, skill `open-pr`, the same review chain; the platform-engineer takes the reviewer seat. Gate 2 is reversed: the owner explains the diff with the three review questions (what changes, what would I build differently, what must I know later); the reviewer confirms or asks back.
5. **Agent balance.** The PR's Agenten-Bilanz shows a "Hand" line with the owner's minutes and sessions instead of tokens.

## Deadline, takeover, rebuild

Hand tasks are preferably off the critical path. On the path, the task has 7 days from gate 1. After that the main session flips the label to `ready-for-agent`, the platform-engineer builds the task and writes the learning note (three lines per decision) into the ticket, and the task gets a `Nachbau` line: the owner rebuilds it later, off the path, against the same manifest. The retro counts hand tasks, takeovers and rebuilds; a takeover without a scheduled rebuild is a finding.

## Not here

A separate learning plan, a curriculum or exercises outside tickets: learning happens on real tasks only. Kubernetes and Terraform tasks appear when the architecture needs them.
