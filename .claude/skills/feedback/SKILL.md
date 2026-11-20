---
name: feedback
description: "The owner's entry point for a correction: /feedback <what was wrong>. Finds the root cause, records it through the skill `lesson`, and proposes a concrete rule or check with its target file; nothing is written to a rule before the owner says yes. Use when the owner types /feedback or explicitly asks to turn a correction into a rule."
---

# /feedback

The owner names a mistake; you turn it into a lesson and, where it earns one, a rule. Adapted from the owner's Playwright-BDD repo; here rules stay in the owner's hand and follow the learning loop of the skill `lesson` (CLAUDE.md, Learning).

## Steps

1. **What went wrong.** If the message does not say it, ask once: "Was war am letzten Ergebnis falsch?" Find the concrete instance (PR, issue, file and line, agent role).
2. **Root cause**, one category: test design (missing case, duplicate step, wrong stage), code (pattern, boundary, error handling), process (gate, briefing, review chain), agent behaviour (which role did what), tooling (a check that let it through), other.
3. **Already caught?** Check whether a tool would catch it today (lint, type, contract test, hook, CI, Fallow, gitleaks, semgrep, the red-before-green check). If yes, say so; the answer may be "no rule needed".
4. **Record** the occurrence through the skill `lesson`: a new row in `docs/lessons.md`, or the existing row's next occurrence.
5. **Propose** one rule or check, unless step 3 already covers it:
   - Specific and actionable: starts with NEVER, ALWAYS, PREFER or AVOID, or names the check and its failure condition. Never "be more careful".
   - Narrowest place, in the order of the skill `lesson`: automated check → hook → `.claude/rules/<area>.md` → the role file under `.claude/agents/` → a skill step → `CLAUDE.md` (last, it costs every session).
   - Not a duplicate: grep the target and the neighbouring rules first; extend or sharpen an existing line instead of adding a second one.
   - Show the exact text, the target file and the line it goes after.
6. **Wait for the owner.** "ja" → write it on a branch and open a small PR (skill `open-pr`), and set the lesson row's status to "promoted <date>: <target>". "nein" or no answer → the lesson row stays "first occurrence"; nothing else changes. The owner may promote on the first occurrence; the "second occurrence" default of `lesson` is a default, not a gate.

## Limits

- Never write a rule, role or hook file without the owner's yes in this conversation; files under `.claude/hooks`, `.claude/skills` and settings stay owner-only.
- A rule that would hold in any project gets the `blueprint` target (skill `lesson`); the owner decides on the issue in `marcominervinidev/project-blueprint`.
- Report in German: the cause, whether a tool catches it, the proposed text with target, and the lesson row.
