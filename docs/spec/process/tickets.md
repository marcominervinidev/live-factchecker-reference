# Vom Plan zum Ticket

Referenz zur Entscheidung aus dem Wayfinder-Ticket "Vom Plan zum Ticket: wie aus der Architektur Arbeit wird" (marcominervinidev/live-factchecker-plan#49, 2026-10-21). Umsetzung in `live-factchecker-v2`, Branch `process/tickets`: `.github/ISSUE_TEMPLATE/ticket.md`, `.github/ISSUE_TEMPLATE/request.md`, `.claude/skills/cut-tickets/SKILL.md`, `.claude/rules/tickets.md`, `.claude/agents/refinement.md` (Nachtrag), `tools/evidence_table.py`, `docs/process/tickets.md`, Labels `needs-triage`, `needs-info`, `refined`, `ready-for-agent`, `ready-for-human`.

Gesetzt vor diesem Ticket: Refinement Agent entwirft, Marco gibt an Tor 1 frei (ADR 0011); das Issue ist der Plan, keine Plan-Dateien (Agentenregeln, Abschnitt 7); ein Task je PR mit gemessener Größe (PR-Format, Abschnitt 1); Manifest je Ticket und Tags `@issue-<n>`, `@ac-<k>` als Rückverfolgung (Testteam, Abschnitt 2); Backend zuerst, komplett getestet, dann Frontend (Prozess-Map, ADR 0010).

## 1. Ebenen (Q1)

| Ebene | Träger | Was daran hängt |
|---|---|---|
| **Inkrement** | Eltern-Issue in `live-factchecker-v2` mit den Tickets als nativen Sub-Issues | Fortschrittsbalken, Frontier-Abfrage (offen, unblockiert, unbeansprucht), Retro am Ende |
| **Ticket** | ein Issue, Vorlage `ticket.md` | Testdesign, Kritiker, Tor 1, Manifest `.claude/frozen/<issue>.json`, Abnahmefälle, Kanarienvogel, Richter, Ticket-Schluss, Belegtabelle |
| **Task** | Abschnitt im Ticket-Body | genau ein PR, Branch `task/<issue>-<task>`, Worktree, Implementierer-Briefing |

Ein Teilprojekt im Sinn des Leitfadens (Schritt 2) ist bei uns ein Paket oder Service des Monorepos: der Pflicht-Scope der Commits, keine Ticket-Ebene. Tasks werden nie Sub-Issues, weil Manifest, Abnahme und Richter am Issue hängen und ein Task nichts aus Nutzersicht beweist.

## 2. Schnittregel (Q2)

- Ein Backend-Ticket endet an einer **beobachtbaren Naht**: Audio-Naht, Segment-Naht, Ereignis des Live-Vertrags oder Harness-Bericht. Es ist auf Stufe 3 (API, Cucumber gegen den Compose-Stack) oder im Harness abnehmbar; solange es keinen Client gibt, ist Stufe 3 die höchste Stufe, die aus Nutzersicht beweist, und die Abnahmefälle laufen über den API-Treiber.
- Ab dem Frontend-Inkrement gilt Matts Tracer-Bullet-Regel: eine schmale, vollständige Scheibe durch alle Schichten, auf Stufe 4 abnehmbar.
- Keine Horizontalscheiben ("alle Schemas", "alle Adapter"); die Ausnahme ist der breite Refactor als Expand-Contract in zwei Tickets.
- Die Reihenfolge folgt den Abhängigkeiten der Architektur und steht als **native Blockierkante** im Tracker. Das erste Ticket eines Inkrements ist das Gerüst (Walking Skeleton), das die Teststufen zum Laufen bringt.

## 3. Größe (Q3)

S = ein Task, M = zwei bis drei Tasks, L = splitten vor Tor 1 (der Refinement Agent schlägt den Split vor). Höchstens drei Tasks je Ticket; ein Ticket passt in eine Hauptsession; ein Task bleibt unter 400 Zeilen Produktionscode (PR-Format). Splits entscheidet der Refinement Agent beim Entwurf, nicht der Schnitt.

## 4. Weg (Q4)

Skill `cut-tickets` in v2, von Marco aufgerufen, je Inkrement oder je Quelle (ADR, Spezifikationsabschnitt, triagierter Brief):

1. Grilling mit Marco zu Umfang und Reihenfolge (A20 des alten Repos: Grilling vor jedem Schnitt).
2. Scheiben benennen, Kanten skizzieren; Quiz an Marco: Granularität, Kanten, zusammenlegen oder splitten (Matts `to-tickets`, Schritt 4).
3. Je Scheibe ein Lauf des Refinement Agents; Marco liest die Entwürfe.
4. Die Hauptsession legt das Eltern-Issue und die Sub-Issues in Abhängigkeitsreihenfolge an (Blocker zuerst), setzt die Kanten nativ und das Label `refined`.

Matts Skills: `to-tickets` wird nicht aufgerufen, seine Regeln (vertikale Scheiben, native Kanten, Sub-Issues des Quell-Issues, Quiz vor dem Publizieren) sind übernommen; `to-spec` entfällt, weil Spezifikationen als `docs/spec/*.md` aus Wayfinder-Tickets entstehen; `implement` entfällt zugunsten von Orchestrator, Implementierer-Rolle und Review-Kette; `triage` wird für den Ingest übernommen (Abschnitt 8).

## 5. Vorlage und Belege (Q5)

Die Vorlage `.github/ISSUE_TEMPLATE/ticket.md` trägt die Felder des Refinement-Entwurfs: Ziel, Akzeptanzkriterien (nummeriert `AC1` bis `ACn`, stabil, je eines testbar durch ein Szenario oder einen Unit-Test, Negativfälle eingeschlossen), Verträge, Blast Radius, Revertierbarkeit, Risiko, Größe, Sessiontyp, Tasks (Pfade, erwartete Form, Verifikationsbefehl), offene Fragen mit Empfehlung, Quellen; optional **Messung** (Abschnitt 10). Kein Issue-Form, weil Agenten Markdown schreiben.

**Belegtabelle.** Marco will je Ticket eine Tabelle mit Belegen. Die Testteam-Entscheidung hat nur die Tabelle von Hand abgeschafft; diese wird von Code erzeugt: `tools/evidence_table.py --issue <n>` rendert je Akzeptanzkriterium eine Zeile aus den Tags der Tests (Stufe und Name), dem letzten Lauf (Cucumber- und Vitest-Berichte), dem Richterurteil (Abnahmefälle) und einem Link auf den Bericht. Die Hauptsession postet sie als **Issue-Kommentar** nach jedem Abnahmelauf und beim Ticket-Schluss; der Body bleibt eingefroren. Ein Akzeptanzkriterium ohne Test erscheint als Zeile "ohne Test".

**Berichte.** Playwright-Berichte (Stufen 2b und 4, HTML mit Traces) und Cucumber-Berichte (Stufe 3) werden je PR-Lauf als GitHub-Actions-Artefakt hochgeladen (30 Tage, nur für den Owner abrufbar); die Spalte Bericht verlinkt darauf. Nichts aus `tests/acceptance/reports/` und keine Screenshots gelangen ins Repo (Testteam, Abschnitt 6); der Richterkommentar mit Zitat und höchstens zwei Bildern bleibt der dauerhafte Beleg.

## 6. Zustände (Q6)

| Label | Bedeutung | Setzt |
|---|---|---|
| `needs-triage` | neue Anforderung, noch nicht bewertet | Vorlage `request.md`, jedes unlabelte Issue |
| `needs-info` | wartet auf Angaben des Melders | triage |
| `refined` | Entwurf des Refinement Agents steht; wartet auf Testdesign, Kritiker und Tor 1 | `cut-tickets` |
| `ready-for-agent` | Tor 1 passiert, Manifest geschrieben; ein Agent darf bauen | Hauptsession an Tor 1 |
| `ready-for-human` | braucht Marcos Hand (Lernpfad, Zugang, Entscheidung) | triage, Lernpfad (#48) |
| `wontfix` | Kill Switch | Marco |

In Arbeit ist ein Ticket, wenn es einen Assignee hat; geschlossen wird es durch Code nach dem Merge, wenn alle Fälle `passt` sind (Testteam, Abschnitt 6).

## 7. Priorisierung (Q7)

Kein Prioritizer-Agent. Die Reihenfolge sind die Blockierkanten des Inkrements; die Hauptsession nimmt das erste Frontier-Ticket (offen, unblockiert, unbeansprucht, in Reihenfolge der Sub-Issues), sofern Marco keins nennt. Kill Switch: Marco schließt mit `wontfix`.

## 8. Ingest neuer Anforderungen (Q8)

Jede neue Anforderung (Bug, Idee, Lesson mit Ziel, Richterbefund außerhalb des Tickets, Nutzerwunsch) wird ein Issue mit `needs-triage` über die Vorlage `request.md`. Marco fährt Matts `triage` (Dedup gegen die Codebasis, `bug` oder `enhancement`, Zustand, Brief). Der Brief ist die Eingabe des Refinement Agents; danach läuft der Weg aus Abschnitt 4 ab Schritt 3. Keine Rolle Triage, kein Scribe (Prozess-Map, Not yet specified).

## 9. Refinement nach dem ersten Bau (Q9)

- Richter `passt nicht` nach dem Merge: das Ticket bleibt offen, der Refinement Agent entwirft das Delta als Kommentar, daraus ein neuer Task (neuer PR). Kein Agent ändert Erwartungen (nie ein Healer).
- Änderung an Akzeptanzkriterien oder Verträgen nach Tor 1: nur Marco mit `FROZEN_UNLOCK=<issue>` in der Hauptsession; der Hook verlangt einen Kommentar mit der Änderung.
- Designverschiebung (Grenze, Vertrag, Prinzip): zuerst ADR-Nachtrag im Planungsrepo (Leitfaden, Schritt 8), dann neuer Anlauf. Drei Absätze Korrektur im PR sind eine Spezifikationsänderung und gehören ins Issue.
- Neue Anforderung aus dem Bau: Abschnitt 8, mit Link auf das Ursprungsticket.

## 10. Messtickets (Q10)

Ein Messticket hat eine Zahl als Ziel. Sein Akzeptanzkriterium lautet "Lauf mit Konfiguration X auf Set Y liegt bei Zahl ≥ Z und nicht schlechter als die Baseline minus Schwelle" (Schwellen 0,02 voller Lauf, 0,05 Prüfset; Testteam, Abschnitt 13). Das Feld **Messung** der Vorlage hält Konfiguration, Set, Schwellen und Budget. Die Abnahme ist deterministisch: der Check "Eval-Bericht vorhanden" (PR-Format) verlangt den Bericht mit dem gemessenen Commit (Head oder früherer Commit mit denselben geänderten Dateien), der Harness-Vergleich gegen `evals/reports/baseline.json` entscheidet. Kein Richter, kein Kanarienvogel. Ohne Feld Messung ist es ein normales Ticket.

## 11. Inkrement 1 (Q11, Q12 bis Q16)

**Abgrenzung.** Das Gerüst der Erkennung als TypeScript-Pipeline ab der Segment-Naht bis zu den Ereignissen am Live-Vertrag, gemessen am Golden Set im Textmodus über den Harness. Kein Client, keine Prüfung (Check), keine Audio-Naht, keine Konten. Bis der Vergleichsprototyp (#30) den Arm liefert, baut das Inkrement gegen den Mock-Arm.

**Erster Schnitt (Vorschlag, von Marco am 2026-10-21 so abgenommen).** Pfeile sind Blockierkanten; Tickets der Architektur-Map in Klammern sind externe Blocker.

| Ticket | Was danach existiert | Abnahme | Blocker | Größe, Risiko |
|---|---|---|---|---|
| T1 Gerüst | pnpm-Workspace, Service der Erkennung mit Health-Route, Compose-Stack mit Caddy und Redis, Dockerfile, Stufen 0 bis 3 mit je einem echten Szenario grün; Referenz-Teilprojekt für `new-service`; Betriebsminimum (JSON-Logging-Modul in `packages/`, `/health` und `/ready`, Kosten je Modellaufruf; siehe „T1 Pflichtliste“) | Stufe 3: Health über die Kante | keiner | M, mittel |
| T2 Segment-Naht und Session | Segment-Vertrag (Inputs 4.1) validiert; Session mit Id und Lebenszeit 15 min nach dem letzten Segment in Redis ohne Platte (ADR 0009); Replay-Input für Referenz-Transkript und STT-Mitschnitt mit simulierter Uhr | Stufe 3: Segmente rein, Session-Zustand raus | T1 | M, mittel |
| T3 Turn-Bildung und Tick-Plan | Turn-Regeln (Wechsel, 3 s, 3 min, Einwurf unter 2 s), Tick alle 5 s Redezeit plus Abschluss, Überspringregel, Zähler; Eigenschaften mit fast-check | Stufe 1, 2a; Mitschnitt-Fixture | T2 | M, niedrig |
| T4 Claim Extractor Stufe 1 | Prompt-Aufbau mit Präfix, kumulativem Turn, Setting, bisherigen Claims (Deckel 100); Schema 4.1 validiert; Dedup über `repeatOf`; Candidates ins Protokoll; Claim-Ereignis am Live-Vertrag; Mock-Adapter | Stufe 3: Replay rein, Claim-Ereignisse raus | T3 | M, mittel |
| T5 Resolver | ein Aufruf je Candidate, Kontext nach Modellrollen 5, Timeout 12 s, `none` und Fehler im Protokoll | Stufe 2a, 3 | T4 | S, niedrig |
| T6 Topic Extractor | Tag-Liste je Session, Aufruf je Tick mit eigener Überspringregel, Topic-Ereignis; ohne Soll-Wert (ADR 0003) | Stufe 2a | T3 | S, niedrig |
| T7 Modell-Adapter | Bedrock EU mit erzwungenem Tool für JSON (ADR 0006), Vertex `eu` hinter demselben Adapter, Token und Kosten je Aufruf | Stufe 2a mit Mock; Stufe 5 Probe | T4, (#30) | M, hoch |
| T8 Messweg | die Pipeline als Arm des Harness: Textmodus-Replay über das Golden Set durch die Segment-Naht, Funde mit Zeiten zurück, Bericht nach Messaufbau 5; Mock-Lauf in der CI | Harness-Bericht (Mock) | T5, (#41) | M, mittel |
| T9 Messticket Baseline | erster echter Lauf auf dem Prüfset, `evals/reports/baseline.json` zeigt darauf; Schwellen aus Messaufbau 4.4 als Diagnose | Harness-Vergleich | T7, T8, (#25) | S, niedrig; Budget 100 USD |

Frontier am Tag 1: T1. Nach T3 laufen T4 und T6 parallel, nach T4 laufen T5 und T7 parallel. T6 blockiert T9 nicht und kann in Inkrement 2 rutschen.

### T1 Pflichtliste (Betriebsminimum ab T1, #61, 2026-10-23)

Was sich später nicht nachrüsten lässt, gehört ins Gerüst und in die Service-Vorlage (Skill `new-service`), bevor der erste Service entsteht; was das Betriebsmodell (#15) später anders entscheidet (Log-Senke, Metrik-Stack, Alarmierung), bleibt austauschbar. Grundlage: ADR 0011 (zwölf Faktoren), v2 `.claude/rules/platform.md`.

- **Strukturiertes JSON-Logging** als Strom nach stdout, Modul in `packages/`, Pflicht in der Service-Vorlage. Felder: Zeit, Service, Session-Id, Ereignis, Dauer, Kosten. Nie Transkripttext, nie Namen privater Personen; Aufbewahrung nach `docs/spec/datenschutz.md` Abschnitt 2.
- **`/health` und `/ready`** je Service; die Kante und die Stack-Tests nutzen sie (Abnahme T1: Health über die Kante).
- **Token und Kosten je Modellaufruf** als Log-Ereignis und als Metrik, dazu ein Zähler je Session als Vorgriff auf das Kontingent (ADR 0005); T7 liefert die Werte, hier steht das Format.
- **Release-Begriff** in v2 `docs/process/pr-format.md`: Tag-Schema `v0.x`, Bedeutung von `main passed`, deploybares Image-Tag `:sha`, Rollback = vorheriges `:sha` erneut ausrollen, `git-cliff` erst mit dem ersten Tag.
- **Make-Targets**, die Hooks, Workflows und Docs schon nennen: `acceptance`, `ci-secrets`, `ci-stack-up`, `ci-stack-down`, `test-api`, `test-e2e`, `lighthouse`, `hooks-install`, `up`, `dev`, `down`, `toolbox`, `stop`, `restart`, `secrets-init`, `test-unit`.
- **Skripte und Dateien**: `scripts/tb`, `scripts/ci/affected.ts`, `scripts/ci/images.ts`, `scripts/check-contract-change.sh`, `.nvmrc`.

Die Liste steht gleichlautend in v2 `docs/process/tickets.md`; T1 ist erst abnehmbar, wenn jedes Element existiert oder im Ticket als bewusst verschoben begründet ist.

**Ort und Zeitpunkt.** Eltern-Issue "Inkrement 1" und Sub-Issues entstehen in `live-factchecker-v2`; das Planungsrepo behält die Maps, verbunden durch einen Link im Eltern-Issue auf dieses Ticket. Angelegt wird erst, wenn `cut-tickets` existiert und der Refinement Agent jeden der neun Entwürfe geschrieben hat; dieses Anlegen ist der erste Lauf des Skills und zugleich sein Test.

## 12. Verworfen

Tasks als Sub-Issues; Inkrement als Milestone; Matts `to-tickets` direkt aufrufen; `to-spec` und `implement`; Prioritizer-Agent mit Kill Switch (Factory-Schaubild); Tabelle "Belegt durch" von Hand; Belegtabelle im Body; Playwright-Berichte im Repo oder auf GitHub Pages; Issue-Forms; Richter für Messtickets; Audio-Naht als Start von Inkrement 1; Topic Extractor als Blocker der Baseline.
