# Spezifikation: Agentenregeln je Geltungsbereich

Gilt mit ADR 0011 (Nachtrag 2026-10-18). Die Dateien liegen in `live-factchecker-v2` auf dem Branch `process/rollen`; diese Spezifikation ist die Referenz.

## 1. Träger und Geltungsbereiche

| Ebene | Träger | Lädt | Inhalt |
|---|---|---|---|
| Repo | `CLAUDE.md` (einzige Wurzeldatei, keine AGENTS.md) | jede Session | Regeln, keine Prozeduren; unter 120 Zeilen |
| Teilprojekt | `.claude/rules/<thema>.md` mit `paths:` | bei Lesen oder Schreiben passender Dateien | Verantwortung, Dateikarte, Fallstricke, Konfiguration, Tests |
| Prozedur | `.claude/skills/<name>/SKILL.md` | auf Abruf oder per `skills:` in Rollen | Schrittfolgen |
| Pflicht | `.claude/hooks/*.sh` über `.claude/settings.json` | bei Ereignissen | deny, ask, Meldung, Halt |
| Benutzer | Marcos Memory | jede Session | nur Vorlieben, nie Projektregeln |

Echte Wächter sind lefthook und CI; Hooks sind Komfort und Frühwarnung.

## 2. CLAUDE.md

Elf Blöcke, 71 Zeilen (Stand 2026-10-18): Leitsatz; Quellen der Wahrheit (CONTEXT.md, ADRs und Specs im Planungsrepo bis zur Zusammenlegung, Issues als Plan, Standards, Lessons); Stack; Befehle (make, Toolbox, kein Docker-MCP); Host und Isolation (nichts auf dem Host, nie Marcos Stack, Worktree je Implementierer, blockierter Befehl wird gemeldet); Arbeiten (ein Issue je Session, compact bei 60 bis 70 %, Tore und Rollen, Subagenten als Standard, Briefings mit Host-Regeln, Workflows, Limit-Wächter); Git; Qualität; Sicherheit; Lernen; Sprache; Hooks sind Komfort. Der Text ist `CLAUDE.md` in v2.

## 3. Rules-Themen

`contracts` (packages/contracts), `tests` (tests, *.test.ts, *.feature, step-definitions), `pipeline` (services, packages/pipeline, packages/providers), `evals` (evals), `web` (apps/web, packages/ui), `platform` (Dockerfiles, Compose, Workflows, deploy, scripts, Makefile). Gleiche Gliederung; leere Abschnitte erlaubt; Inhalt wächst mit dem Code.

## 4. Hooks

| Hook | Ereignis | Entscheidung | Erkennung |
|---|---|---|---|
| guard-secrets | PreToolUse Read, Edit, Write, Grep, Glob, Bash | deny | `.env*` außer `.env.example`; Secrets-Verzeichnis; `/run/secrets`; secrets-init; Befehle, die `*_API_KEY` ausgeben |
| frozen-manifest | PreToolUse Edit, Write | deny | Pfad in einem `.claude/frozen/*.json`; die Manifeste selbst, außer `FROZEN_UNLOCK=<issue>` ist gesetzt |
| git-pipe | PreToolUse Bash | deny | zustandsändernder git- oder gh-Befehl mit nachfolgender Pipe; `--no-verify`; `core.hooksPath` |
| owner-stack | PreToolUse Bash | deny | `docker compose`, `docker-compose`, `docker run` ohne Projekt oder Namen, der mit `lfc-` beginnt, oder mit Marcos Projektnamen; `make up/dev/down/toolbox/stop/restart`; lesende Docker-Befehle erlaubt |
| contracts | PreToolUse Edit, Write | ask | Pfad unter `packages/contracts/` |
| limit-guard | PreToolUse Agent | deny | `level` in der Zustandsdatei des Limit-Wächters ist `session_hard` oder `week_soft` |
| format-lint | PostToolUse Edit, Write | Meldung, Exit 2 bei ESLint-Befunden | Prettier und ESLint in der Toolbox (`LFC_TOOLBOX`), sonst übersprungen |
| stop-tests | Stop | Exit 2 | Manifest-Datei im Diff; Unit-Tests der geänderten Workspaces rot; Fingerprint gegen Doppelläufe; übersprungen ohne `scripts/tb` |
| session-start | SessionStart | Ausgabe | Branch, zugewiesene Issues per gh (Timeout), offene Manifeste |
| pre-compact | PreCompact | Ausgabe | Git-Stand nach `.claude/scratch/compact-<datum>.md` (gitignored) |
| test-hooks | Skript | – | 53 Fälle (Stand 2026-10-23, `.claude/hooks/test-hooks.sh`), synthetische Eingaben, keine echten Secrets |

Entsperren eines Manifests: nur Marco, über `FROZEN_UNLOCK=<issue>` in der Hauptsession; danach Testdesigner und Kritiker erneut, erneute Freigabe, Issue-Kommentar.

## 5. Skills

Eigene: `evidence`, `new-service`, `new-contract`, `lesson`, `brief-implementer`, `open-pr` (Gerüst bis PR-Format #47), dazu `retro` und `leitfaden-pruefpunkte` aus ADR 0011. Aus dem Plugin mattpocock-skills: grilling, grill-with-docs, domain-modeling, research, tdd, code-review, codebase-design, prototype, improve-codebase-architecture (periodischer Lauf vor einem Meilenstein). Offen für "Vom Plan zum Ticket" (#49): to-tickets, to-spec, triage. Verworfen als Kopie: grilling, improve-codebase-architecture; `uat` entscheidet das Testteam (#46); `security-scan` geht in open-pr oder Gate (#47).

## 6. Lessons und Standards

`docs/lessons.md` mit Spalten Datum, Fehler, automatisch gefangen?, Status, Ziel; Startbestand zwölf Zeilen aus dem alten Repo (drei schon befördert: git-pipe, owner-stack, Retro-Abgleich). Zweimal-Regel, Check vor Regel, dritte Vorkommen fragen, warum die Regel nicht ankam. `docs/CODING_STANDARDS.md` mit sieben Abschnitten, Naming verweist auf CONTEXT.md; Reviewer, Architektur-Reviewer und Implementierer lesen sie.

## 7. Konzept-Ablage

Das Issue ist der Plan: Akzeptanzkriterien und Tasks im Body, Stand und Entscheidungen als Kommentare; keine Plan-Dateien. Synthesen als `docs/synthesis/<bereich>.md`. ADRs zweistufig bis zur Zusammenlegung: Produktarchitektur im Planungsrepo, Umsetzungsentscheidungen in `docs/adr/` von v2. Sobald der Prototyp durch ist, werden Planungsrepo und v2 zusammengelegt (Task der Prozess-Map); danach ein ADR-Ort.

## 8. Offen

- Stack-Block der CLAUDE.md wird nachgezogen, wenn die Architektur-Map den Stack endgültig nennt.
- `scripts/tb`, Toolbox-Name je Worktree und `make`-Ziele entstehen mit dem ersten Plattform-Ticket; bis dahin überspringen format-lint und stop-tests mit Meldung.
- Pipe-Erkennung und Projektnamen-Erkennung sind Regex; Fehlalarme kommen als Lessons und Testfälle.
- Öffentlichkeits-Check und "Commit auf offenem PR sofort gepusht": PR-Format (#47).

## 9. Nachtrag 2026-10-19: Doku-Deckung und Kontextbudget

Marco wollte wissen, ob ein Agent am Ende eines PR prüfen soll, dass neue Teile des Repos ihre Prosa haben und dass `CLAUDE.md` und die Agenten-Dateien nicht überlaufen. Entscheidung: als Checks aus Code plus je ein Prüfpunkt beim Reviewer und beim Architektur-Reviewer, keine neue Rolle.

- `tools/check_docs_coverage.py`: Jedes Verzeichnis erster Ebene unter `apps/`, `services/`, `packages/`, `tests/` braucht eine `README.md` mit den Abschnitten Purpose, Boundaries, Pitfalls, Commands und muss von einer Rule in `.claude/rules` über `paths:` abgedeckt oder in deren Dateikarte genannt sein. Stufe 0 und Pre-Commit; rot nennt die Datei.
- `tools/check_context_budget.py`: `CLAUDE.md` höchstens 120 Zeilen, jede Rule 80, jede Agenten-Datei 120, jeder Skill 100. Überlauf heißt kürzen oder auslagern.
- Reviewer: neues Verzeichnis, dessen Prosa einen Agenten ohne das Ticket nicht arbeiten ließe, ist major. Architektur-Reviewer: README und Rule müssen Grenze und Verantwortung nennen, nicht nur Dateien.
- Skill `new-service` endet mit README und Rule-Eintrag; acht Tests unter `tools/tests/`.

Zum Kontextfenster (60 bis 70 Prozent, Kompaktieren nach Stand im Issue): keine Routine, sondern der Limit-Wächter liest aus dem Statuszeilen-JSON auch den Füllstand je Session und schickt bei 60 Prozent einen Hinweis über den Inbox-Socket, bei 80 Prozent eine Sperre für neue Subagenten; der PreCompact-Hook bleibt das Netz. Übergabe an "Limit-Wächter bauen" (#54).
