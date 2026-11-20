# Lernpfad Plattform-Engineering: Mitwirkung von Hand

Referenz zur Entscheidung aus dem Wayfinder-Ticket "Mitwirkung von Hand: Lernpfad Plattform-Engineering" (marcominervinidev/live-factchecker-plan#48, 2026-10-22). Umsetzung in `live-factchecker-v2`, Branch `process/lernpfad`: `.claude/rules/platform.md`, `.claude/rules/tickets.md`, `.claude/agents/platform-coach.md`, `.claude/skills/begleiten/SKILL.md`, Ergänzungen in `cut-tickets`, `retro`, `.github/ISSUE_TEMPLATE/ticket.md`, `tools/agent_balance.py`, `docs/process/lernpfad.md`. Schaubild: https://claude.ai/artifact/UnxiB5PMT6HJjHojiFWTp3 (Kopie: docs/schaubilder/048-lernpfad.html)

## 1. Die Frage

Marco lernt Plattform-Engineering und baut Teile der Plattform selbst. Das Projekt darf dabei nicht an seinem Lerntempo hängen. Alles, was es dafür braucht, nutzt die Bahnen aus "Rollen und Bahnen" (#44), "Vom Plan zum Ticket" (#49) und dem PR-Format (#47); neu sind nur ein Marker, ein Begleit-Modus und ein Nebenweg für die Blockade.

## 2. Markierung (Q1, Q2)

- Die Markierung hängt am **Task**, nicht am Ticket: Der Task-Abschnitt im Ticket-Body trägt die Zeile `Hand: owner`. Ein Ticket an Marco zu geben, wäre zu grob; ein Task hat genau einen PR.
- Das Label `ready-for-human` liegt auf dem Ticket, solange ein Hand-Task der nächste ist, und geht beim Merge dieses Tasks wieder herunter. Kein neues Label.
- Markiert wird im `cut-tickets`-Quiz mit einer Frage je Task: Agent oder Hand. Das Quiz warnt, wenn ein Hand-Task auf dem kritischen Pfad liegt. Die Ticket-Vorlage trägt das Feld.

## 3. Tore, Branch, Review (Q3, Q4)

- **Tor 1 unverändert:** Manifest und rote Tests vom Testdesigner, bevor Marco baut. "Wer Code schreibt, schreibt nicht die Tests" gilt auch für ihn; die roten Tests sind das Lernziel.
- Gleicher Branch `task/<issue>-<task>`, gleicher Skill `open-pr`, gleiche Review-Kette. Der Platform-Engineer sitzt bei Hand-PRs im Reviewer-Stuhl.
- **Tor 2 umgedreht:** Marco erklärt dem Reviewer den Diff mit den drei Leitfaden-Fragen (Was ändert sich fachlich? Was würde ich anders bauen? Was muss ich später wissen?); der Reviewer bestätigt oder fragt nach. Was nicht erklärt werden kann, wird nicht gemergt.

## 4. Begleitung (Q5, Q6)

- Neue Rolle **Platform-Coach** (`.claude/agents/platform-coach.md`): der Platform-Engineer ohne Schreibrechte, Werkzeuge nur Read, Glob, Grep. Er erklärt, gibt Marco die Prüfbefehle (hadolint, `docker compose config`, actionlint, echter Start mit Health-Check) zum Selbstausführen und liest die Ausgabe, stellt Fragen und schlägt nie den fertigen Diff vor. Die Werkzeugliste ist die Durchsetzung, nicht der Prompt.
- Aufruf über den Skill `begleiten` aus der Hauptsession für den laufenden Hand-Task.
- Erklärungen und Lernnotizen landen als **Kommentar im Ticket** unter dem Hand-Task, eine Notiz je Sitzung: was gelernt, was offen. `docs/lessons.md` bleibt den Agentenfehlern vorbehalten.
- Marcos persönlicher Skill `teach` bleibt außerhalb des Repos.

## 5. Blockade: Frist, Übernahme, Nachbau (Q7)

- Hand-Tasks liegen vorzugsweise neben dem kritischen Pfad; das Quiz warnt, wenn nicht.
- Liegt ein Hand-Task auf dem Pfad: **Frist 7 Tage ab Tor 1.** Danach kippt die Hauptsession das Label auf `ready-for-agent`, der Platform-Engineer baut den Task und schreibt als Lernnotiz die drei Zeilen je Entscheidung ins Ticket.
- **Nachbau:** Marco baut den übernommenen Task später außerhalb des Pfads nach, mit demselben Manifest; der Nachbau ist ein eigener Task ohne Merge-Pflicht.

## 6. Welche Aufgaben (Q8)

- Fallweise im Quiz, mit einer kurzen Lernziel-Liste in der Rule `platform.md`: Docker-Härtung, Compose-Netze, CI-Stack; später Kubernetes und Terraform.
- Inkrement 1: **nicht T1** (das Gerüst blockiert alle anderen Tickets). Erste Hand-Tasks sind der nächtliche No-Cache-Build der Toolbox und `nightly.yml`. T1 baut der Agent; Marco begleitet es mit Erklär-Pflicht an Tor 2.

## 7. Kennzahlen (Q9)

- Hand-PRs bekommen in der Agent-Bilanz eine Zeile "Hand" mit Marcos Zeit statt Tokens (`hand-<task>.json` mit Minuten und Sitzungen unter `.claude/scratch/balance/<issue>/`).
- Die Retro zählt Hand-Tasks, Übernahmen und Nachbauten.

## 8. Verworfen

Eigenes Label `lernpfad` am Ticket; Präfix im Task-Titel; Markierung erst an Tor 1; Hand-Tasks ohne Manifest; eigene Branch-Form `hand/…` mit leichterer Kette; kein Agenten-Review für Hand-PRs; `teach` ins Repo; Lernlog als eigene Datei; Frist in Sitzungen; keine Frist; Aufgaben nach Kategorie; T1 von Hand; keine Bilanz für Hand-PRs.
