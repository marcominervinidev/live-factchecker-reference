# Spezifikation: Rollen und Bahnen des Arbeitssystems

Gilt mit ADR 0011 und seinen Nachträgen (2026-10-18 Abnahme im PR und Richter auf Fable 5.1, 2026-10-19 Implementierer auf Opus 5.5, 2026-10-22 Platform-Coach); ein datierter Nachtrag schlägt diese Spec, die im selben Commit nachgezogen wird. Die Dateien liegen in `live-factchecker-v2` unter `.claude/` und `docs/process/`; diese Spezifikation ist die Referenz, die Dateien sind die Umsetzung.

## 1. Bahnen, Tore, Gates

| Stufe | Wer | Was |
|---|---|---|
| Bahn 1 Planen | Marco mit Grilling und Wayfinder; Refinement Agent; Testdesigner; Kritiker; Explore | Vom ADR zum Ticket mit Akzeptanzkriterien; Fälle und rote Tests vor dem Code |
| Tor 1 | Marco | Gibt Ticket, Akzeptanzkriterien, Features, Steps, rote Unit-Tests und Verträge frei; danach eingefroren (Manifest, Hook) |
| Bahn 2 Bauen | Hauptsession als Orchestrator; Implementierer; Ausführer (Code); Reviewer, Security-Reviewer, Architektur-Reviewer, Frontend-Reviewer; Platform-Engineer | Produktionscode gegen die roten Tests; Review-Kette als Workflow |
| Gates | Code | Hooks, tsc, ESLint, Tests, Fallow, Stryker, Semgrep, gitleaks, Trivy als Required Checks |
| Abnahme im PR | Ausführer (Code); Abnahme-Richter | Sobald der Implementierer fertig meldet und die Review-Kette durch ist: Abnahmelauf und Urteile je Fall als PR-Kommentar, vor Tor 2 (Nachtrag 2026-10-18) |
| Tor 2 | Marco | Liest Diff und Richterurteile zusammen, Commit für Commit in GitHub, merged; Auto-Merge bei niedrigem Blast Radius frühestens nach zwanzig PRs (#47) |
| Bahn 3 Schließen und Lernen | Ticket-Schluss (Code, aus denselben Urteilen nach dem Merge); Retro; Limit-Wächter (Skript) | Issue zu mit Belegen; Lessons und Kennzahlen |

## 2. Rollen

Modellstufen: **Spitze** Fable 5.1 (`claude-fable-5-1`), **stark** Opus 5.5 (`claude-opus-5-5`), **mittel** Sonnet 5.5 (`claude-sonnet-5-5`), **günstig** Haiku 5.5 (`claude-haiku-5-5`); `tools/check_plan_sync.py` in v2 vergleicht diese IDs mit `.claude/models.json`. Zuordnung Rolle zu Stufe und Stufe zu Modell-ID in `.claude/models.json`; ein Skript schreibt die IDs in die Agenten-Dateien.

| Rolle | Datei | Art | Eingabe → Ausgabe | Rechte | Stufe |
|---|---|---|---|---|---|
| Refinement Agent | `agents/refinement.md` | Agent | ADR, Spezifikation, Issue-Entwurf → Ticket-Entwurf mit Akzeptanzkriterien, Blast Radius, Größe, Risiko, Sessiontyp | lesend; schreibt nur den Entwurf; Marco gibt frei | stark |
| Testdesigner | `agents/test-designer.md` | Agent | Ticket → Gherkin-Features, Step-Definitionen, rote Unit-Tests (describe-it), Abnahmefälle mit Erwartung | schreibt nur Test- und Feature-Dateien, nie Produktionscode | stark |
| Kritiker | `agents/critic.md` | Agent | Ticket plus Ausgabe des Testdesigners → Befunde: Abdeckung, Eindeutigkeit, tautologische oder mockende Tests, fehlende Negativfälle; höchstens zwei Runden | nur lesend; Veto vor Tor 1 | Spitze |
| Implementierer | `agents/implementer.md` | Agent, bis drei parallel | Task mit Pfaden, Vertrag, roten Tests, Verifikationsbefehl, Host-Regeln → Commits auf eigenem Branch, Bericht DONE, DONE_WITH_CONCERNS, BLOCKED | Worktree; Verbotsliste (Abschnitt 4) | stark (Opus 5.5) mit Effort hoch, zwischen medium und max; bei Risiko hoch Effort xhigh; nie Spitze (Marco, 2026-10-19; vorher günstig) |
| Ausführer | Make-Ziele, CI, Workflow | Code | Branch → Tests, Lint, Fallow, Stryker, Scanner, Harness | – | – |
| Reviewer (Code) | `agents/reviewer.md` | Agent | Diff mit festem Scope → Blocker, Warnungen (PRIO 1 Abkürzungen, Tests, Standards) | nur lesend | mittel |
| Security-Reviewer | `agents/security-reviewer.md` | Agent | Diff → Befunde mit Angreifer und Szenario; jeder Befund blockiert | nur lesend | stark |
| Architektur-Reviewer | `agents/architecture-reviewer.md` | Agent | Diff plus CONTEXT.md, ADRs, Fallow-Befund → Grenzverletzungen, Redundanz, doppelter Zustand, erfundene Muster, zwölf Faktoren | nur lesend | stark |
| Frontend-Reviewer | `agents/frontend-reviewer.md` | Agent | Diff in der Web-App plus Bilder des Abnahmelaufs → Bauweise, Zustand, i18n, Barrierefreiheit | nur lesend; aktiv bei Frontend-Tickets | mittel |
| Platform-Engineer | `agents/platform-engineer.md` | Agent | Plattformaufgabe → Dockerfiles, Compose, CI, Betriebskonfiguration nach zwölf Faktoren, mit Erklärung; reviewt Hand-PRs | eigene Werkzeugliste, keine Secrets; aktiv bei Plattform-Tickets; Lernpfad (#48) | stark |
| Platform-Coach | `agents/platform-coach.md` | Agent | Hand-Task des Owners (`Hand: owner`) → Erklärungen, Fragen, die Verifikationsbefehle, Lesen der eingefügten Ausgabe; eine Lernnotiz je Session als Ticket-Kommentar | nur lesend (Read, Glob, Grep), kein Bash; über Skill `begleiten`; nie der fertige Diff (Nachtrag 2026-10-22, Lernpfad #48) | stark |
| Prüfliste | `skills/leitfaden-pruefpunkte/SKILL.md` | Skill | in Reviewer, Architektur-Reviewer, Frontend-Reviewer, Kritiker vorgeladen | – | – |
| Abnahme-Richter | `agents/acceptance-judge.md` | Agent | Berichte des Abnahmelaufs im PR → je Fall passt, passt nicht, unklar mit Beleg und Regressionsstufe; Kanarienvogel; Urteile als PR-Kommentar vor Tor 2 | liest nur Berichte; nie Code, nie Erwartungen; nie in CI | Spitze (Fable 5.1, Nachtrag 2026-10-18); nie das Modell des Autors, darum läuft der Implementierer nie auf Spitze |
| Ticket-Schluss | Workflow `acceptance.js` | Code | gemergt und alle Fälle passt → Issue geschlossen mit Belegen; Marco kann öffnen | gh | – |
| Retro | `skills/retro/SKILL.md` | Skill | Inkrement → Lessons befördern, Agenten-Bilanz, Umstufungsvorschläge | nach Freigabe | stark |
| Limit-Wächter | Skript (Task #54) | Code | Statuszeile → Stufe, Nachricht, Hook-Sperre | – | – |

Nie: Healer (kein Agent ändert Tests, Erwartungen oder Locatoren, um grün zu werden). Später: Triage, Scribe.

## 3. Wer blockiert, wer schließt, wer merged

- Gates blockieren immer.
- Security-Reviewer: jeder Befund ist Blocker. Architektur-Reviewer: Grenzverletzung oder doppelter Zustand ist Blocker. Reviewer: PRIO-1-Abkürzung ist Blocker. Frontend-Reviewer: Barrierefreiheit und Bauweise als Blocker nur bei Verstoß gegen eine benannte Regel.
- Kritiker: Veto vor Tor 1, höchstens zwei Runden, dann entscheidet Marco.
- Richter: urteilt im PR vor Tor 2 und bindet den Ticket-Schluss; den Merge blockiert Marco mit dem Richterbericht in der Hand, nie der Richter selbst.
- Ticket-Schluss durch Code, wenn der PR gemergt ist und alle Fälle `passt` sind; Marco kann wieder öffnen.
- Mergen: Marco, in Inkrement 1 immer.

## 4. Implementierer

- Ein Task je Aufruf. Briefing: Ticket, Pfade, Vertrag, rote Tests, Verifikationsbefehl, Host-Regeln (Sandbox, Toolbox, kein Zugriff auf Marcos Stack), erwartete Berichtsform.
- Isolation: Worktree `../wt-<issue>-<task>`, Branch `task/<issue>-<task>`, Compose-Projekt und Toolbox `lfc-<issue>-<task>`, Portbereich je Task, Wegwerf-Secrets. Höchstens drei parallel, nur auf getrennten Tasks ohne gemeinsame Dateien.
- Werkzeuge: Read, Edit, Write, Grep, Glob, Bash. Kein Agent-Werkzeug, kein Web, keine schreibenden MCPs.
- Verbotsliste: kein Push, kein `gh`, kein Branch-Wechsel, kein `reset`, `stash`, `rebase`, `merge`; keine Änderung an Dateien im Manifest (Features, Steps, rote Tests des Testdesigners, Verträge), am Ticket, an Secrets; kein `--no-verify`; kein git- oder gh-Befehl in einer Pipe; kein Docker-Befehl mit Marcos Projektnamen. Ein blockierter Befehl wird gemeldet, nie auf anderem Weg wiederholt.
- Erlaubt: eigene Unit-Tests für Interna hinzufügen (neue Dateien), Commits auf dem eigenen Branch durch den Pre-Commit-Hook.
- Bericht: `DONE`, `DONE_WITH_CONCERNS` oder `BLOCKED` mit echter Befehlsausgabe, Commit-Hashes, Zahl der Versuche. Höchstens drei Versuche bis grün, dann `BLOCKED`.
- Die Hauptsession prüft Nebenwirkungen vor dem Push: `git status`, `git stash list`, Remote-Branches, `docker ps`.

## 5. Tor 1 und das Manifest

- Mit Marcos Freigabe schreibt die Hauptsession `.claude/frozen/<issue>.json`: Pfade der Features, Step-Definitionen, roten Unit-Tests, Verträge und der Ticket-Text (Hash).
- Ein PreToolUse-Hook (Agentenregeln #45) verweigert Edit und Write auf diese Pfade für jeden Agenten außer dem Testdesigner, bis das Ticket geschlossen ist.
- Änderungen am Eingefrorenen gehen über Marco zurück an den Testdesigner; der Kritiker prüft erneut.
- Das Manifest ist zugleich die Tabelle "Belegt durch" im PR (#47).

## 6. Kennzahlen

| Zahl | Quelle | Ausgabe |
|---|---|---|
| Loops bis grün je Implementierer-Aufruf | Bericht des Implementierers | Agenten-Bilanz im PR |
| Tokens und Kosten je Rolle und Modell | Workflow-Ergebnisse, Claude-Code-Logs (`tools/usage_from_logs.py`, Format geprüft 2026-10-19) | Agenten-Bilanz, Retro |
| Befunde je Reviewer und PR, Anteil berechtigt | Marco markiert beim Lesen | Retro |
| Richter-Quote: passt, passt nicht, unklar, Kanarienvogel erkannt | Workflow `acceptance.js` | Retro |
| Rücklauf an Tor 1 | Issue-Ereignisse | Retro |

Die Retro schlägt daraus Umstufungen der Modelle vor.

## 7. Orchestrator-Regeln

- Hält Ticket, Verträge, Plan; startet Implementierer; einzige Stelle mit Push, PR, Merge-Vorbereitung.
- Feste Ketten als Workflow-Skripte in `.claude/workflows/`: `test-design.js` (Testdesigner, Kritiker, bis zwei Runden), `review-chain.js` (drei Reviewer parallel, Frontend-Reviewer bei Frontend-Dateien), `acceptance.js` (Ausführer und Richter im PR, sobald der Implementierer fertig meldet; Ticket-Schluss nach dem Merge aus denselben Urteilen).
- Limit-Wächter: bei Stufe hart alle Subagenten stoppen, Stand ins Ticket, Fortsetzung auf die Reset-Minute planen, anhalten; bei sanft jedem Subagenten eine Frist setzen, Berichte abwarten, Stand ins Ticket, Weiterarbeit auf den Wochen-Reset planen.
- Deutsch an Marco, Englisch im Repo.

## 8. Testform

End-to-End- und Integrationstests in Cucumber (Gherkin-Features, Step-Definitionen in TypeScript), Unit-Tests im describe-it-Stil (Vitest). Stufen, Pyramide, Konventionen: Testteam (#46).

## 9. Offen

- Erledigt 2026-10-18: Subagenten starten Fable 5.1; Kritiker und Richter laufen auf Spitze (`.claude/models.json`).
- Hooks für Manifest, Docker-Namen, Pipe-Verbot: Agentenregeln (#45).
- Schemas, Budgets und Turn-Limits der Workflow-Skripte: mit dem ersten gebauten Ticket.
- Erledigt 2026-10-19: `tools/usage_from_logs.py` rechnet mit dem heutigen Log-Format.
- Auto-Merge bei niedrigem Blast Radius: PR-Format (#47), frühestens nach zwanzig PRs.
