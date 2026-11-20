---
name: lesson
description: "Record the first occurrence of an agent mistake or owner correction in docs/lessons.md, or promote a repeated one to a check, hook, rule, skill or prompt. Use the moment a mistake is noticed, and in every retro."
---

# Lessons

`docs/lessons.md` is the learning loop (CLAUDE.md, Learning). Project rules never go into the agent's personal memory.

## Record a first occurrence

Append one row: `| <date> | <what went wrong, one sentence, with PR or issue> | <caught automatically? yes/no/partly, by what> | first occurrence | <target: check / hook / rule / skill / prompt, or "none yet"> |`. Do not write a rule yet. If the mistake sits in a file that came from the blueprint `marcominervinidev/project-blueprint` and would happen in any project, add `blueprint` to the target; the retro turns such rows into `rueckfluss` issues there.

## Promote on the second occurrence

1. Check whether a tool already catches it (lint, type, contract test, hook, CI, Fallow, gitleaks). If yes: status "no rule needed, caught by <tool>".
2. Otherwise prefer, in this order: an automated check; a hook; a line in the narrowest `.claude/rules/*.md`; a skill step; a reviewer prompt item; a line in `CLAUDE.md` (last, it costs every session).
3. Implement it in the same PR when small, otherwise open an issue and link it. Set status "promoted <date>: <file or check>".

## Third occurrence

The rule did not land. Ask why: wrong scope (file not loaded when it mattered)? should be a hook? contradicts another rule? Record the answer and move the rule.

## In the retro

Walk the open rows; mark rows whose check has since landed as promoted; propose deletions of rules that never changed behaviour.
