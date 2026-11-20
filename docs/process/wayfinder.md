# Wayfinder maps

Short form for readers in the repo. Origin: `docs/agents/issue-tracker.md` and `CLAUDE.md` of the planning repo `marcominervinidev/live-factchecker-plan`, which held both maps (architecture, work system) and was deleted after 2026-11-01. All its issues were transferred into this repo with their comments (architecture map now #54, process map #104); bodies and comments were relinked to the new numbers. Its Git history, its six pull requests and the number mapping (`plan-archive/issue-map.txt`: plan number, v2 number) live in the tag `archive/plan-repo`.

**Old numbers.** Ticket numbers in documents written in the planning repo (ADRs 0001 to 0011, `docs/spec/`, `docs/research/`, `docs/schaubilder/`) are planning-repo numbers; translate them with the mapping. Documents written in this repo use this repo's numbers.

A Wayfinder map charts decisions before they become work. It sits beside the ticket system of `docs/process/tickets.md`: a map ticket ends in a decision (ADR, spec, research finding), an increment ticket ends in code.

## Carriers

| Element | Carrier |
|---|---|
| Map | one issue labelled `wayfinder:map`; body holds Notes, Decisions so far, Fog |
| Map ticket | issue linked to the map as a native sub-issue, labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` or `wayfinder:task` |
| Blocking | native issue dependencies (`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`; the database id comes from `gh api repos/<owner>/<repo>/issues/<n> --jq .id`, not the number) |

`research` is AFK (a research subagent), `prototype` and `grilling` need the owner, `task` is manual work that unblocks a decision.

## Operations

- **Frontier**: open sub-issues of the map without an open blocker (`issue_dependencies_summary.blocked_by` is 0) and without an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: the answer as a comment, close the ticket, then append a pointer (gist and link) to the map's Decisions so far.
- **Results**: a research finding goes to `docs/research/` on a `research/<slug>` branch, a decision to `docs/adr/` (a dated addendum overrides the spec; both change in the same commit), a spec to `docs/spec/`.

## Daily owner hour

Owner decision 2026-11-03: the owner works through the agents' output once a day, from 16:00 for one hour, and is not interrupted in between except for a blocker that stops all work.

- **45 minutes review and merge**: the PRs that are green and up to date with `main`, in the order the main session recommends, plus gate-1 packages and decisions (gate 1 and gate 2 of `docs/process/rollen.md`).
- **15 minutes one Wayfinder task**: one grilling round of three to five questions with its decision page, or one research finding to read, from the frontier of the map (operations above). The main session prepares it during the day; a ticket that needs more than one round runs over several days.
- Shortly before 16:00 the main session sends one message: the merge list, the decisions with their quoted wording, the Wayfinder task with the link to its page and the questions with a recommendation, what got done, what comes next.

## Decision pages (Schaubilder)

- Before every grilling round the owner gets an HTML briefing page: data flow, fact tables, the questions as bullets with a recommendation. It is a private claude.ai artifact, one URL per ticket, updated in place across rounds.
- Before the ticket closes, the same page becomes the decision overview and is exported unchanged to `docs/schaubilder/<ticket>-<slug>.html`, with a row in `docs/schaubilder/README.md`. The ADR or spec links the artifact URL and the local copy.
