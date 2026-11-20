---
name: open-pr
description: "Open a pull request in the agreed format (docs/process/pr-format.md): draft first, merge-danger block, German review guide with a sketch, 'Belegt durch' from the manifest, judge verdicts as a comment, surviving mutants, agent balance; ready only when chain, acceptance and both aggregate checks are green. Main session only."
---

# Open a pull request

One task per PR, at most about 400 production lines (the check warns over 400, blocks over 800). Push, PR and merge preparation happen only in the orchestrating main session; never in a pipe (`gh pr create --body-file`).

## Before opening

1. `git status` clean, `git log origin/<branch>..HEAD` empty after the push: every commit of an open PR is pushed at once.
2. Commits in review order (contract → red tests → logic → wiring → docs), Conventional Commits with a known scope (`python3 -I tools/check_commits.py "origin/main..HEAD"`); no `wip:` left.
3. Review chain green (`.claude/workflows/review-chain.js`), every blocker resolved; acceptance run and judge done (`make acceptance ISSUE=<n>`, `.claude/workflows/acceptance.js`).
4. Size: `python3 -I tools/check_pr_size.py origin/main HEAD`.

## Body (`.github/pull_request_template.md`)

- Title = the squash commit: `<type>(<scope>): <subject>`.
- Merge-danger block: risk, revertibility, blast radius, value, review depth; derive it, do not guess (the reviewer verifies the self-rating).
- `Ticket`, `Task`, and the verdict line with the judge's counts.
- Visual review guide as a private artifact only for UI changes or risk medium and above; otherwise delete the line and let the sketch carry it.
- "Was und warum": at most three sentences plus the smallest sketch that shows the core (pseudocode, call tree, file tree as diff, contract excerpt).
- "Hier genau hinschauen": at most five places, riskiest first, each with the three questions answered in one line (what changes in the domain, what would you build differently, what must the owner know later).
- Collapsed: "Belegt durch" from `.claude/frozen/<issue>.json` (criterion, stage, test, red on base), "Überlebende Mutanten" from the Stryker artifact with a decision per mutant, "So habe ich geprüft", "Agent-Bilanz" from `python3 -I tools/agent_balance.py --issue <n>`, "Details (English)".
- German for the owner's part, English for the details; stack terms stay English.
- No bare reference: next to every AC, gate-1 decision or addendum, review finding, owner decision, ADR or ticket number stands the sentence it refers to, quoted, with a link where one exists (`CLAUDE.md` "Language", owner decision 2026-11-03). The same holds for the judge comment and the report to the owner.

## Open, then ready

1. `gh pr create --draft --title "<title>" --body-file <file>`.
2. Post the judge's verdicts as one comment (one quote and at most two images per case; a repeat run is a new comment).
3. Wait for `ci passed` and `pr passed`; fix findings; never relax a gate.
4. `gh pr ready <n>`, then report to the owner in German: link, the verdict line, what to read first, decisions waiting for him.

## Never

Stacked PRs; `--no-verify`; a PR without the manifest table; editing an expectation or a frozen test to get green; marking ready with a red check.
