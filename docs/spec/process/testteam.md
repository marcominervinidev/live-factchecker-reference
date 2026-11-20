# Testteam und Testpyramide

Referenz zur Entscheidung aus dem Wayfinder-Ticket "Testteam und Testpyramide: TDD erzwingen, Golden Set als Regressionstest" (marcominervinidev/live-factchecker-plan#46, 2026-10-18). Entscheidung: ADR 0011 mit Nachtrag vom 2026-10-18 (Abnahme im PR). Umsetzung: `live-factchecker-v2`, Branch `process/rollen` (`.claude/rules/tests.md`, `docs/process/test-strategy.md`, Agenten, Skill `test-design`, Hook `test-integrity`, Workflow `acceptance.js`, Paket `tests/acceptance`). Begriffe nach `CONTEXT.md`. Schaubild: https://claude.ai/artifact/7zwDnnBKwG2Jb7V4k13cpX (Kopie: docs/schaubilder/046-testteam-und-testpyramide.html)

Gesetzt vor diesem Ticket: TDD; wer Code schreibt, schreibt nicht die Tests dazu; Fälle vor dem Code mit Marcos Freigabe an Tor 1; Ausführer ohne Modell; Richter auf anderem Modell als der Autor mit Kanarienvogel; nie ein Healer. Annahme: Produktstack TypeScript auf Node (folgt aus Cucumber mit Steps in TypeScript und Vitest); ein Stack-ADR der Architektur-Map steht noch aus und würde nur Werkzeugnamen ändern, nicht die Stufen.

## 1. Sechs Stufen (Q1 b)

Das Stufenmodell des alten Repos (Brief 13), erweitert. Jeder Fall liegt auf der niedrigsten Stufe, die ihn zeigen kann; vor einem neuen Fall wird geprüft, ob eine niedrigere Stufe ihn schon deckt (keine Dubletten über Stufen).

| Stufe | Frage | Werkzeug | Läuft | Mocks |
|---|---|---|---|---|
| 0 statisch | Baut es, hält es die mechanischen Regeln? | tsc strict, ESLint, Prettier, dependency-cruiser, gitleaks über die Historie, Paritätschecks, `test-hooks.sh`, `sync_agent_models.py --check` | jeder Push | – |
| 1 Unit | Rechnet das Modul richtig? | Vitest, describe-it neben dem Modul; fast-check für reine Logik | jeder Push, betroffene Workspaces | alles außer dem Modul |
| 2a Backend-Integration | Arbeiten die Module eines Service zusammen? | Cucumber im Prozess, Container nur für Infrastruktur (Redis und Co.) | jeder Push, betroffene Workspaces | Provider (STT, LLM, Websuche) |
| 2b Frontend-Integration | Verhält sich der Client richtig gegen ein gemocktes Backend? | Cucumber mit Playwright gegen den Vorschau-Server **mit derselben CSP wie die Kante** | jeder Push, wenn `apps/web` betroffen | Backend |
| 3 API | Läuft der Pfad durch den echten Stack? | Cucumber über HTTP und WebSocket gegen den Compose-Stack (Projekt `lfc-ci-<run>`), importiert nie Service-Code | PR | Provider |
| 4 End-to-End | Sieht der Nutzer das Richtige? | Cucumber mit Playwright durch die Kante (Caddy, TLS), nur kritische Journeys | PR: Chromium Desktop und Mobil; nachts: ein weiterer Browser im Wechsel | Provider |
| 5 nachts | Was Minuten oder Geld kostet | siehe Abschnitt 8 | 02:23 | – |

Die Abnahme aus Nutzersicht (Abschnitt 6) ist keine Stufe; sie läuft nie in der CI.

## 2. Gherkin (Q2 a)

- Englische Schlüsselwörter, Begriffe aus dem Glossar unübersetzt (Segment, Turn, Claim, Speaker, Setting); deutsche Zeichenketten nur dort, wo der Nutzer sie sieht.
- Ein Feature je Gruppe von Akzeptanzkriterien; jedes Szenario trägt `@issue-<n>` und `@ac-<k>`. Die Tags sind die Rückverfolgung; es gibt keine Tabelle von Hand (ersetzt `@dod`).
- `Scenario Outline` mit getrennten `Examples`-Blöcken für gültige Klassen, Grenzen und ungültige Klassen; jede ungültige Klasse genau einmal und als einzige ungültige Eingabe.
- Negativfälle prüfen Ablehnung **und** fehlende Nebenwirkung ("and no card is created").
- Steps behaupten Verhalten, nie Mock-Aufrufe.

## 3. Step-Bibliothek und Fixtures (Q3 a)

- Eine Step-Bibliothek je Stufe unter `tests/<stufe>/steps/`; Fachsteps in Glossarsprache ("a Turn by Speaker Merz containing …"); in 2a keine UI-Steps, in 4 keine Steps, die Interna kennen.
- Der Testdesigner erweitert die Bibliothek und kopiert sie nicht; der Kritiker prüft Wiederverwendung. Page Objects nur per `data-testid` oder Rolle.
- Audio-Fixtures sind Verweise auf einen Golden-Ausschnitt mit Zeitfenster (`golden: synt-2026-10-06-a 00:12-00:41`); `tests/fixtures/` hält das deterministische Schneideskript und die Lizenzhinweise, nicht Kopien. Sprache in Fixtures ist echte Stimme (Regel vom 2026-10-02); das synthetische TTS-Set (ADR 0003) prüft nur Mechanik und bleibt im Eval. Fixtures widersprechen nie den Labels des Golden Sets.

## 4. Unit-Tests (Q4 a)

- `*.test.ts` neben dem Modul; ein `describe` je öffentlicher Funktion oder Verhalten; `it` als englischer Verhaltenssatz ("drops a duplicate claim within 60 s"); kein Snapshot-Test; Fake-Timer, sobald Zeit im Spiel ist; eigene Ids und Schlüsselpräfixe je Test; kein Netz.
- Eigenschaftsbasierte Tests mit fast-check für reine Logik (Turn-Bildung, Dedup, Takt-Plan, Namensmaske, Vertragsvalidierung); Generatoren schreibt der Testdesigner, der Implementierer darf Eigenschaften für Interna ergänzen.
- Der Implementierer darf neue Unit-Testdateien für Interna anlegen, nie bestehende ändern; der Reviewer prüft sie mit der Testprüfliste (Abschnitt 7).

## 5. Gates, die aus den Tests folgen (Q5 bis Q7)

**Rot vor Grün (Q5 a).** Der Testdesigner führt die roten Tests aus und legt je Datei Befehl, Exit-Code und Hash der Ausgabe in die Dateiliste; die Hauptsession schreibt sie als `redRun` ins Manifest `.claude/frozen/<issue>.json`. Ein CI-Job holt die Basis des PR, legt nur die im Manifest eingefrorenen Testdateien darauf und erwartet Rot. Grün auf der Basis heißt "unbewiesen" und blockiert den PR. Ein Test, der nie rot war, zählt nicht.

**Mutation Testing (Q6 a).** StrykerJS vom ersten Paket an. Nachts (Abschnitt 8) für die Pakete, die sich seit dem letzten grünen Nachtlauf geändert haben, einmal die Woche alle. Im PR `--incremental` nur auf geänderten Dateien; überlebende Mutanten im Diff stehen als Liste im PR. Vier Wochen nur Bericht; danach setzt die Retro `break` je Paket auf den gemessenen Wert minus fünf Punkte, nie auf einen Wunschwert. Risikoakzeptanz für überlebende Mutanten liegt bei Marco. Command-Runner statt Vitest-Runner, solange der Vitest-5-Fehler besteht (altes Repo).

**Flaky (Q7 a).** Lokal keine Retries, in CI höchstens einer. Ein neuer Fall der Stufen 3 und 4 läuft im PR dreimal (`--repeat-each=3`) und zählt nur bei dreimal grün. Ein flackernder Test bekommt ein Issue und `@quarantine` mit Ablaufdatum (14 Tage); danach fixen oder löschen. Quarantäne, `skip`, `only`, `fixme` setzen nur Marco oder die Hauptsession mit `QUARANTINE_BY_OWNER=1`; der Hook `test-integrity` verweigert es sonst. Ein Wait ist nie die Lösung.

## 6. Abnahme aus Nutzersicht (Q8 bis Q11)

Übernommen aus ADR 0022 des alten Repos, verschoben vor Tor 2.

1. **Fälle vor dem Code.** Der Testdesigner schreibt je Ticket die Abnahmefälle als Cucumber-Szenarien im Paket `tests/acceptance` (Q9 a): Browser-Treiber, API-Treiber, solange es keinen Client gibt; die Erwartung steht wörtlich als Docstring am Szenario, Negativfälle eingeschlossen. Marco gibt sie an Tor 1 frei; sie sind Teil des Manifests. Fälle werden nie außer Dienst gestellt; eine Erwartung ändert nur Marco.
2. **Kanarienvogel (Q10 a).** Je Ticket schreibt der Testdesigner einen versiegelten Fall mit plausibler, aber falscher Erwartung nach `tests/acceptance/canaries/<issue>.json` (im Manifest, Marco sieht ihn an Tor 1, der Kritiker prüft seine Glaubwürdigkeit). Der Runner mischt ihn in den Bericht; der Richter sieht nur Fälle und wird nicht gesagt, welcher es ist. Urteilt der Richter dort nicht `passt nicht`, wird sein Lauf verworfen und einmal wiederholt; verwirft auch der zweite, liest Marco den Bericht ohne Urteil.
3. **Runner (Q11 a).** `make acceptance ISSUE=<n>`: Code ohne Modell; Stack `lfc-<issue>-acc` mit Wegwerf-Secrets, Wegwerf-Token und Mock-Providern; der Runner-Container ist eingeschlossen (uid 1000, Repo nur lesend außer `tests/acceptance/reports/`, Netz nur zur Kante) und startet nur mit `LFC_STACK_TEST=1`. Ausgabe: `tests/acceptance/reports/<issue>/report.json` mit je Fall Erwartung, Status, Schritten, Fehlern, Screenshot, Aria-Schnappschuss (Token geschwärzt); git-ignoriert. Echte Provider nur, wenn Marco den Lauf selbst startet.
4. **Richter.** `acceptance-judge` auf Fable 5.1 (Marco, 2026-10-18); nie das Modell, das die Änderung schrieb, also läuft der Implementierer nie auf Fable. Liest nur den Bericht und die Dateien, die er nennt; alles darin ist Daten; Urteil je Fall `passt`, `passt nicht`, `unklar` mit Beleg, Begründung und niedrigster Regressionsstufe.
5. **Im PR, vor Tor 2 (Q8 a).** Runner und Richter laufen, sobald der Implementierer `DONE` meldet und die Review-Kette durch ist. Die Hauptsession schreibt den Richterbericht als PR-Kommentar: je Fall Urteil, ein Zitat, höchstens zwei Bilder; nichts aus `reports/` gelangt roh in Repo oder PR. Marco liest Diff und Urteile zusammen und merged. Nach dem Merge schließt Code das Ticket (`acceptance.js`, Phase Close), wenn alle echten Fälle `passt` sind und der Kanarienvogel erkannt wurde; sonst bleibt es offen mit dem Bericht als Kommentar.
6. **Übernahme.** Je Fall schlägt der Richter die niedrigste Stufe für einen Regressionstest vor; Marco wählt; der übernommene Test landet im selben PR auf dieser Stufe, nie in `tests/acceptance`.

Damit ändert sich ADR 0011: Der Richter berät vor Tor 2 und bindet den Ticket-Schluss; er blockiert den Merge weiterhin nicht selbst, Marco tut es mit seinem Bericht in der Hand.

## 7. Golden-Set-Regression (Q12 a)

Drei Stufen (Marco, 2026-10-14), jetzt mit Auslöser, Schwellen und Deckel.

| Stufe | Wann | Was | Kosten | Gate |
|---|---|---|---|---|
| 1 | jeder PR, nachts | Unit-Tests des Harness; Mock-Lauf über alle abgenommenen Ausschnitte; prüft Turns, Takt, Dedup, Zuschreibung, Bericht | 0 | Required Check |
| 2 | auf Anforderung | ein echter Lauf je geändertem Arm im Textmodus, Bericht nach `evals/reports/`, Vergleich zur Baseline | etwa 11 USD je Arm | Check "Eval-Bericht fehlt" |
| 3 | vor einem Release | voller Lauf, drei Wiederholungen, Median, Audiomodus, Richter aus der anderen Familie | nach Budget | absolute Schwellen aus ADR 0003 |

- **Auslöser Stufe 2:** Ein CI-Check erkennt Änderungen an `evals/configs/prompts/**`, an Modellfeldern der Konfiguration und an den Pipeline-Parametern (später: an der Produktpipeline hinter den Adaptern) und verlangt einen Eval-Bericht, dessen Metadaten den Head-Commit des PR nennen oder einen früheren Commit, an dem die geänderten Dateien schon so lauten wie am Head (Lauf auf dem Code-Commit, Bericht danach eingecheckt; übersteht Squash und Rebase); fehlt er, schlägt der Check "Eval-Bericht fehlt" an. Den Lauf startet Marco mit seinen Schlüsseln; nie die CI.
- **Regressionsschwellen:** relativ zur letzten abgenommenen Baseline (`evals/reports/baseline.json` zeigt auf den Bericht): Recall und Precision höchstens 0,02 schlechter, Zuschreibung höchstens 0,01 schlechter, Kosten je Minute höchstens 10 % höher, p95 höchstens 1 s länger. Verletzt blockiert; Marco kann mit Begründung im PR überstimmen und eine neue Baseline abnehmen.
- **Budgetdeckel:** 100 USD im Monat in `evals/budget.json` (Monat, Deckel, Ausgaben je Lauf); der Runner verweigert einen Lauf, der den Deckel überschreiten würde, und meldet den Rest. `budget_usd` je Lauf bleibt (Baseline 15 USD).
- Bis die Produktpipeline steht, läuft Stufe 1 gegen den Python-Harness; danach gegen die Pipeline hinter denselben Adaptern (Ticket Eval-Harness #41, Vergleichsprototyp #30).

## 8. Die Nacht (Q14, angepasst)

Workflow `nightly` um 02:23, Ergebnis als Kommentar am laufenden Nacht-Issue mit Trend (Mutation Score je Paket, Flake-Rate, Eval-Mechanik, Scanner-Funde, Kennzahlen aus ADR 0011):

- Stryker für die seit dem letzten grünen Nachtlauf geänderten Pakete; sonntags alle Pakete.
- End-to-End mit `--repeat-each=3` in **einem** weiteren Browser im Wechsel (Montag WebKit iPhone, Dienstag Firefox, Mittwoch Chromium Desktop, und wieder von vorn); der PR deckt Chromium Desktop und Mobil.
- Lighthouse CI gegen die Kante.
- Trivy voll: HIGH und CRITICAL einschließlich ungefixter Funde, nur Bericht (im PR: CRITICAL mit Fix blockiert). Trivy ist der Scanner für Container-Images: Schwachstellen in Betriebssystempaketen und Abhängigkeiten, Secrets im Image, Fehlkonfigurationen.
- Neu: Golden-Set-Mock-Lauf über alle Ausschnitte plus Harness-Tests; Fallow-Audit und Knip (toter Code, Zyklen, ungenutzte Exporte; Einrichtung in "Review-Werkzeuge einrichten" #55); Deepgram-Probe auf den drei Latenz-Ausschnitten mit Budgetdeckel (ADR 0005).

## 9. Testteam: Rollen und Verfahren (Q13 a)

Keine neue Agentenrolle. Das Testteam sind Testdesigner, Kritiker und Richter; Ausführer und Ticket-Schluss sind Code; Triage bleibt Nebel der Map.

| Rolle | Neu durch dieses Ticket |
|---|---|
| Testdesigner (Opus 5.5) | Skill `test-design` vorgeladen: Äquivalenzklassen, Grenzwerte (Code rechnet die Werte), Entscheidungstabelle, Zustandsübergang, Negativfälle, Heuristiken; Regel "jede Erwartung hat eine Quelle" (Kriterium, Vertrag, Glossar), sonst Frage statt erfundener Wert; schreibt Abnahmefälle und Kanarienvogel; liefert `redRun` je Testdatei |
| Kritiker (Fable 5.1) | Prüfung 8: Spezifikations-Mutanten, rund zehn plausible Fehler je Ticket (`<=` statt `<`, fehlende Maske, falscher Sprecher); jeder muss von mindestens einem Fall entdeckt werden, sonst Befund; Prüfung 9: Kanarienvogel glaubwürdig und nur einer; Warnung, wenn Negativfälle bei eingabelastigen Tickets unter etwa 30 % liegen |
| Reviewer (Sonnet 5.5) | Testprüfliste für vom Implementierer ergänzte Unit-Tests: Erwartung aus Kriterium oder Vertrag statt aus dem Code; würde der Test bei entferntem Verhalten scheitern; Grenzen und Negativfall vorhanden; Mocks nur an Grenzen; Determinismus |
| Richter (Fable 5.1) | Modellstufe Spitze; Berichtspfad `tests/acceptance/reports/<issue>/report.json` |
| Implementierer | läuft nie auf Fable 5.1 (Regel in `models.json`); Hook `test-integrity` verweigert `skip`, `only`, `fixme`, `@quarantine` |

## 10. Kennzahlen, die dazukommen

Zu den fünf aus ADR 0011: Mutation Score je Paket (nachts), Rot-vor-Grün-Quote (Manifeste mit vollständigem `redRun`), Flake-Rate je Test und Zahl der Quarantänen, Kanarienvogel-Quote des Richters (verworfene Läufe), Abnahmequote der Testdesigns an Tor 1 ohne Rücklauf, Eval-Läufe und Ausgaben je Monat.

## 11. Übergaben

- PR-Format (#47): die Required Checks je Stufe, der Rot-vor-Grün-Job, der Check "Eval-Bericht fehlt", die Liste überlebender Mutanten und der Richterbericht als PR-Abschnitte; die Workflow-Dateien `ci.yml`, `pr.yml`, `nightly.yml` entstehen dort nach der Tabelle in `docs/process/test-strategy.md`.
- Review-Werkzeuge einrichten (#55): Fallow und Knip in der Nacht, Stryker-Konfiguration je Paket.
- Eval-Harness (#41) und Vergleichsprototyp (#30): `evals/budget.json`, `evals/reports/baseline.json`, Metadaten mit Commit im Bericht, relativer Vergleich im `report`-Befehl.
- Architekturprinzipien (#18): Stack-ADR bestätigt oder kippt die Annahme TypeScript auf Node.
- Sicherheit (#22): eingeschlossener Runner, Token-Schwärzung, Trivy-Schwellen.

## 12. Offen

- Erste Werte für `break` je Paket: nach vier Wochen Messung (Retro).
- Ob der Rot-vor-Grün-Job auch für 2b und 3 läuft (Stack nötig) oder nur für Stufe 1 und 2a; Entscheidung beim ersten gebauten Ticket.
- Browser-Wechsel: ob Firefox bleibt, wenn der Client Capacitor-Stores bedient (Clients-ADR 0010).

## 13. Nachtrag 2026-10-20: Prüfset und Kostenhebel (Marco)

Nach der Kostenübersicht (#56) entschieden:

- **Prüfset für Golden-Set-Stufe 2:** 6 Ausschnitte mit etwa 110 Labels (je 2 aus Talkshow, Debatte, Alltag; Debatte sind beide Phoenix-Ausschnitte), eine Wiederholung, rund 4 USD statt 11 je Arm. Es blockiert ab 0,05 Verlust bei Recall oder Precision (die Schwankung bei rund 110 Labels liegt bei etwa ±0,04, eine Schwelle von 0,02 wäre Rauschen); zwischen 0,02 und 0,05 folgt ein voller Lauf. Volles Set vor jedem Release (Stufe 3) und einmal im Monat als Kontrolle, dass das Prüfset die Unterschiede der Arme noch trifft.
- **Auswahl aus Daten:** Die 6 Ausschnitte werden aus den vorhandenen Berichten gewählt (Ergebnisse je Ausschnitt), so dass die Unterschiede zwischen den Armen auf dem Prüfset denen auf dem vollen Set am nächsten kommen; die Liste liegt versioniert in `evals/configs/pruefset.json`.
- **Batch-API im Harness:** Der Harness rechnet mit simulierter Uhr, Latenz der Aufrufe spielt keine Rolle; Batch spart 50 % der Anthropic-Kosten. Gilt nicht für die Latenzmessung im Audiomodus.
- **Max-API-Guthaben:** Marco verknüpft das monatliche API-Guthaben seines Max-Abos mit einer Console-Organisation; der Schlüssel für die Läufe muss aus dieser Organisation stammen.
- **Abo vor API-Key (2026-10-20):** Alles, was Agentenarbeit in Claude Code ist (Implementierer, Prüfer, Research, Label-Vorschläge als Sitzungsaufgabe), läuft über das Max-Abo; `ANTHROPIC_API_KEY` wird nie global exportiert. Nur Aufrufe, die kein Agent, sondern Harness oder Produkt macht (Erkennung, Richter, Vergleichsarme, Messläufe), laufen über einen API-Key aus der Guthaben-Organisation, pro Lauf gesetzt. Das Abo deckt nach Anthropics Bedingungen die Nutzung von Claude Code, nicht Produkt- oder Messaufrufe über `claude -p`.
- **Caching nur ab Präfix-Minimum:** Ein Cache-Marker wirkt erst ab 512 Token stabilem Präfix (Sonnet 5.5, Opus 5.5, Haiku 5.5) beziehungsweise 4.096 Token (Haiku 4.5); kürzere Prompts werden stillschweigend nicht gecacht. Die Prompts in `live-factcheck` (unter 400 Token System-Anteil) sind deshalb nicht cachefähig; der Harness in v2 baut den Präfix nach Spezifikation Modellrollen Abschnitt 3 (Block 1 mindestens 512 Token) und prüft `cache_read_input_tokens` im Bericht.

Geschätzter Golden-Set-Posten bei 2, 5 und 10 Tickets pro Woche: rund 51, 61 und 79 USD vor Guthaben und Batch-Rabatt (vorher 52, 81, 100); den Anthropic-Anteil davon trägt weitgehend das Max-Guthaben.
