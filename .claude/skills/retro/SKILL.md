---
name: retro
description: "Retrospective over the merged PRs, tickets and agent runs: first after the first three merged tickets, then at the end of every increment (or on request). Reviews the system that produces the code: proposes checks before prompt rules before prose, model tier changes from the role metrics, slimmer steering files. The owner decides; the skill changes nothing itself."
---

# Retrospective: after three merged tickets, then per increment

You review the **system that produces the code**, not the code: no review comment, agent mistake or detour should happen a second time. Suggest; never apply without the owner's approval. Report in German.

**When.** The first retro runs as soon as three tickets are merged (increment 1: T1 to T3), because the chain calls eight models per ticket before the owner sees the diff and only the agent balance shows whether that fits nine small tickets (#127). After that, one retro at the end of every increment. The date is a comment on the increment's parent issue.

## 1. Collect the period

- Merged PRs since the last retro: `gh pr list --state merged --base main --json number,title,mergedAt,url`; per PR the review guide, the owner's comments, the Agenten-Bilanz block.
- Closed tickets and their acceptance reports; the critic's verdicts and how many rounds each ticket took before gate 1.
- `docs/lessons.md` rows of the period and which are not promoted yet.
- The owner's decisions of the period (issue comments, PR checkboxes, chat): name the commit that implemented each; a decided-but-never-landed change is a finding.
- The role metrics (ADR 0011, spec section 6): loops to green per implementer run, tokens and cost per role and model, findings per reviewer with the owner's "berechtigt" share, judge quota (passt / passt nicht / unklar / canary caught), returns at gate 1.
- The test pyramid: `python3 -I tools/check_test_pyramid.py --all` (whole repository against 80 / 15 / 5) and without `--all` per ticket manifest; the flaky issues of the period (label `flaky`) with their root causes.
- The learning path (`docs/process/lernpfad.md`): hand tasks built by the owner (`Hand` line of the Agenten-Bilanz: minutes, sessions), takeovers after the 7-day deadline, rebuilds done and still open; the learning notes under the tasks. A takeover without a rebuild scheduled is a finding.

## 1a. Key figures of the first retro, and the decisions it prepares

Collect per ticket T1 to T3 from `tools/agent_balance.py --issue <n>` and `tools/usage_from_logs.py`:

- loops to green per role (implementer attempts, test-design rounds);
- tokens and API-equivalent cost per ticket and per role;
- findings per reviewer with hit rate (the owner's "berechtigt" share), separately for reviewer, security-reviewer, architecture-reviewer;
- critic vetoes and what they caught;
- judge verdicts against the owner's own finding at gate 2 (agreed, missed, false alarm).

Decisions it prepares, with the numbers next to each: model tier per role (`.claude/models.json`); number of reviewers per PR, i.e. whether `ARCHITECTURE_REVIEW` in `.claude/workflows/review-chain.js` moves from `always` to `scoped` (architecture reviewer only for blast radius cross-module or system, or a change under `packages/contracts/`; the security reviewer always runs); critic only at risk medium and high; the Stryker `break` per package. Not now: cutting the chain before the numbers exist.

## 2. Look for candidates, in this order

1. **Automated checks** first: a mistake a lint rule, type, contract test, hook, Fallow rule or CI job could have caught. Check whether the check exists but is unwired or lax.
2. **Reviewer prompt or coding standard**: judgement-call findings the automated review missed, or prose that a tool now covers (remove it).
3. **Model tiers**: a role whose loops, cost or "berechtigt" share argue for a tier up or down; propose the change to `.claude/models.json` with the numbers.
4. **Distribution**: does anything in `CLAUDE.md` or `.claude/rules/*.md` belong in a prompt, a standard or a check instead?
5. **Navigation pointers**: where did an agent search long or guess wrong? One pointer line in the narrowest `README.md` or rule file?
6. **Tool economy**: expensive or repeated tool calls a script or Make target could replace; token-heavy outputs that could be filtered at the source.
7. **Lessons against landed checks**: a lesson that a check now covers is marked promoted; a check without a lesson gets one line of provenance.
8. **Bloat**: steering files, skills or prompts that grew without effect; duplicated rules; propose deletions.
9. **Blueprint feedback**: which of the above would hold for any project (not this product)? Collect them as one list for the blueprint `marcominervinidev/project-blueprint` (its `docs/rueckfluss.md`): source, finding, affected template file, proposed change. The owner decides; accepted items become issues there with label `rueckfluss`.

## 3. Report

Numbered, most valuable first. Per suggestion: **Befund** (evidence: PR, commit, file:line, metric), **Vorschlag** (the concrete change and target file, and why this layer), **Aufwand** (klein / mittel / groß). End with what you checked and found healthy, one line each. An empty retro is a valid result.

## 4. After the owner decides

Accepted suggestions are implemented before the next ticket block; covered lessons are marked promoted; new lessons are added for what stays unfixed.
