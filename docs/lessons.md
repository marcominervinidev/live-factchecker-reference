# Lessons (first occurrences)

Agent mistakes and owner corrections, noted the first time they happen (CLAUDE.md, Learning; skill `lesson`). A lesson becomes a rule only on its **second** occurrence and only if no tool catches it already; prefer an automated check over a written rule. On the third occurrence ask why the rule did not land. The retro walks this table and marks rows whose check has since landed.

| Date | Mistake | Caught automatically? | Status | Target |
|---|---|---|---|---|
| 2026-09-29 | A check was judged green by grepping filtered output; the errors were coloured and missed. | no | open from live-factcheck | rule: judge checks by exit code, never by filtered output (CLAUDE.md, Git) |
| 2026-09-29 | A new service passed all tests but could not run in its container (missing runtime dependency). | later by stack tests | open from live-factcheck | check: start a new service once for real in CI (skill `new-service`, step 8) |
| 2026-10-03 | Subagent briefings lacked the host rules; a subagent installed a Python package on the host. | no | open from live-factcheck | skill `brief-implementer` carries the host rules |
| 2026-10-03 | A subagent worked around a blocked command instead of reporting it (twice). | no | open from live-factcheck | rule in CLAUDE.md (Host) and implementer role; hooks deny instead of warn |
| 2026-10-04 | State-changing git or gh commands ended in a pipe; the pipe's exit code masked failures (three times). | no | promoted 2026-10-18: hook `git-pipe` | hook |
| 2026-10-04 | The toolbox image went stale; a nightly no-cache build was missing. | no | open from live-factcheck | check: nightly toolbox build (platform ticket) |
| 2026-10-04 | A clone or second session reached the owner's Compose project and real secrets. | no | promoted 2026-10-18: hook `owner-stack` | hook |
| 2026-10-04 | A test-gap report named gaps after a truncated read; two of three were wrong. | no | open from live-factcheck | reviewer prompt: report gaps only after a full read, with file and line |
| 2026-10-05 | Public text named private details twice. | no | open from live-factcheck | check: pre-push or gh hook against a private term list (PR ticket) |
| 2026-10-05 | A commit on an open PR stayed unpushed while the owner merged. | no | open from live-factcheck | rule: every commit on an open PR is pushed at once, or the PR is a draft (PR ticket) |
| 2026-10-05 | The secrets guard produced false alarms on Compose `secrets:` blocks and documentation. | n/a | open from live-factcheck | hook tests cover the known false alarms (`test-hooks.sh`) |
| 2026-10-05 | A lesson had become a CI check without the row being updated. | n/a | promoted 2026-10-18: retro step "lessons against landed checks" | skill `retro` |
| 2026-11-03 | PR bodies pointed to rules stated elsewhere ("Variante A aus Tor 1", "Obergrenze aus dem Tor-1-Nachtrag") without quoting them; the owner could not follow the PR without opening ticket and addendum. | no | promoted 2026-11-03 at once (owner asked for the rule) | rule: references are quoted, never bare (CLAUDE.md, Language; pr-format.md; tickets.md) |
