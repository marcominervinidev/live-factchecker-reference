# Agentisches Coding: ein Referenzleitfaden

[English](agentic-coding.md) · **Deutsch**

Dieser Leitfaden erklärt, wie man Software mit KI-Agenten baut, wenn ein Mensch die Verantwortung trägt und die
Agenten in getrennten Rollen arbeiten. Er beschreibt die Regeln, die sich dabei bewährt haben, und warum sie
wichtig sind. Du kannst ihn auf dein eigenes Projekt übertragen; jeder Abschnitt zeigt am Ende kurz, wie dieses
Repository es umsetzt.

Das Modell in einem Satz: Agenten schreiben Code, Tests und Reviews, der Owner entscheidet an zwei Toren, und
alles, was sich prüfen lässt, prüft Code statt eines Modells.

## Teil 1: Die Grundsätze

| Regel | Warum |
|---|---|
| Wer den Code schreibt, schreibt nie seine Tests. | Ein Modell, das sich selbst testet, prüft nur seine eigene Lesart der Aufgabe. |
| Verträge zwischen Modulen sind für Agenten nur lesbar. | Sonst passt der Agent die Schnittstelle an seinen Code an statt umgekehrt. |
| Nach der Freigabe sind Tests und Verträge eingefroren. | Ein Ziel, das sich während des Bauens bewegen lässt, ist kein Ziel. |
| Der Owner entscheidet an zwei Toren: vor dem Code und vor dem Merge. | Dort liegt die Verantwortung; dazwischen arbeiten Rollen und Checks. |
| Was ein Werkzeug prüfen kann, wird ein Check, keine Prosa. | Regeln in Textform werden überlesen, Checks nicht. |
| Fertig ist nur, was belegt ist. | Ohne Befehlsausgabe, Bericht oder Screenshot zählt eine Fertigmeldung nicht. |
| Eine Session, eine Aufgabe. | Kontext aus fremden Aufgaben verschlechtert jede Antwort. |
| Kein Test wird abgeschwächt, übersprungen oder geparkt. | Ein falscher Test wird gemeldet und vom Owner entschieden, nie still repariert. |

*In diesem Repo:* [`CLAUDE.md`](../CLAUDE.md), Rollen in [`.claude/agents/`](../.claude/agents/), Hooks
[`contracts.sh`](../.claude/hooks/contracts.sh) und [`test-integrity.sh`](../.claude/hooks/test-integrity.sh),
eingefrorene Stände in [`.claude/frozen/`](../.claude/frozen/README.md).

## Teil 2: Rollen und Tore

Agenten lesen schnell viel und bleiben über viele Dateien konsistent. Sie bauen aber gern mehr als verlangt, melden
Erfolg zu früh und nehmen eine Abkürzung, wenn ein Test sonst rot bliebe. Getrennte Rollen fangen genau das ab:
Jede Rolle hat eine Aufgabe und eine Liste dessen, was sie nie tut.

| Rolle | Tut | Tut nie |
|---|---|---|
| Owner | Architektur, Verträge, Freigaben, Ausnahmen | Tests für eigenen Code schreiben |
| Refinement | Ticket mit Akzeptanzkriterien aus der Entscheidung | Code oder Tests |
| Testdesigner | rote Tests und Abnahmefälle vor dem Code | Produktionscode |
| Kritiker | greift die Tests an, auf stärkerem Modell | Tests ändern |
| Implementierer | macht die eingefrorenen Tests grün | Tests, Verträge, Push |
| Reviewer | suchen Abkürzungen, Grenz- und Sicherheitsfehler | Code ändern |
| Abnahme-Richter | urteilt über Belege gegen die vorher geschriebene Erwartung | Code lesen; auf dem Modell des Autors laufen |

**Tor 1** liegt vor dem Code: Du gibst Tests und Verträge frei, danach werden sie eingefroren. **Tor 2** liegt vor
dem Merge: Du liest Diff und Urteile. Alles dazwischen läuft ohne dich, aber nicht ohne Kontrolle.

Ein Trick macht den Richter ehrlich: Unter den Abnahmefällen steckt ein bewusst falscher, ein Kanarienvogel. Lässt
der Richter ihn durch, zählt sein Urteil nicht.

*In diesem Repo:* [`process/rollen.md`](process/rollen.md),
[ADR 0011](adr/0011-rollen-und-bahnen-des-arbeitssystems.md),
Modellstufen in [`.claude/models.json`](../.claude/models.json).

## Teil 3: Kleine Schritte mit Nachweis

**Das Ticket ist der Plan.** Akzeptanzkriterien und Aufgaben stehen im Ticket, nicht in losen Plandateien, die
niemand pflegt.

**Eine Aufgabe, ein Pull Request.** Kleine PRs lassen sich lesen; große werden durchgewinkt. Eine harte Grenze für
Produktionszeilen hält das ein.

**Rot vor grün.** Ein Test beweist nur etwas, wenn er ohne die Änderung aus dem richtigen Grund fehlschlägt. Lass
das die CI auf der Basis des PRs prüfen.

**Fertig heißt belegt.** Ein Agent meldet fertig mit echter Befehlsausgabe, Bericht oder Screenshot. Der
Abnahmelauf ist Code; das Modell beurteilt nur sein Ergebnis.

**Erkenntnisse zurück ins Konzept.** Zeigt sich beim Bauen, dass eine Grenze oder ein Vertrag anders sein muss,
wird zuerst die Entscheidung festgehalten (als Entscheidungsnotiz, ADR, oder als Nachtrag), dann neu angesetzt. Braucht eine Korrektur mehrere
Absätze Erklärung, ist sie eine Spezifikationsänderung und gehört ins Ticket.

*In diesem Repo:* [`process/tickets.md`](process/tickets.md), [`process/pr-format.md`](process/pr-format.md),
[`check_pr_size.py`](../tools/check_pr_size.py), [`check_red_before_green.sh`](../tools/check_red_before_green.sh),
Skill [`evidence`](../.claude/skills/evidence/SKILL.md).

## Teil 4: Sparsam mit Kontext und Tokens

Was ein Agent im Kontextfenster hat, bestimmt, was er liefert. Alles, was dort nicht zur Aufgabe gehört, verdrängt
das Wichtige, und jede Zeile kostet, oft bei jedem Aufruf neu. Behandle Kontext deshalb wie ein knappes Budget.

- **Zeilenbudgets mit Check.** Die Dateien, die der Agent immer lädt, bekommen eine Obergrenze, die ein Skript
  prüft. Wird es zu lang, wird gekürzt oder auf ein Dokument verwiesen.
- **Laden nach Bedarf.** Die Hauptdatei enthält Grundsätze und Verweise. Regeln für einen Bereich laden nur, wenn
  der Agent dort arbeitet; Prozeduren liegen in Skills, von denen nur die Kurzbeschreibung ständig geladen ist.
- **Zusammenfassen statt mitschleppen.** Vor großer Arbeit in einem Bereich schreibt eine eigene Session eine kurze
  Notiz zu Verantwortung, Datenfluss, Typen und Fallstricken. Die Umsetzung liest die Notiz, nicht den Bereich.
- **Subagenten mit Grund.** Ein Subagent hält die Hauptsession sauber, baut aber seinen Kontext neu auf und kostet
  eigene Tokens. Nutze ihn für breite Lesearbeit und für Reviews, mit einem Briefing aus Umfang, Dateien,
  Entscheidungen und gewünschter Ausgabeform.
- **Modell nach Rolle, Aufwand nach Risiko.** Die stärksten Modelle urteilen (Kritiker, Richter, Architektur), die
  Umsetzung läuft eine Stufe darunter, ihr Reasoning-Aufwand richtet sich nach dem Risiko der Aufgabe.
- **Ein gemeinsames Präfix.** Alle Reviewer bekommen dasselbe Paket als Anfang ihres Prompts. Das spart über
  Prompt-Caching und hält die Befunde vergleichbar.
- **Feste Abläufe.** Wiederkehrende Ketten laufen als Skript mit begrenzten Runden, nicht als Agenten, die sich
  gegenseitig aufrufen.
- **Rechtzeitig verdichten.** Bei 60 bis 70 Prozent Kontextfüllung kompaktieren, vorher die offenen Punkte ins
  Ticket schreiben.
- **Messen.** Jeder PR zeigt Runden, Versuche und, wo verfügbar, Tokens je Rolle. Die Retro stützt ihre Vorschläge darauf.

*In diesem Repo:* [`check_context_budget.py`](../tools/check_context_budget.py),
[`.claude/rules/`](../.claude/rules/), [`.claude/skills/`](../.claude/skills/),
[`docs/synthesis/`](synthesis/README.md), [`review-chain.js`](../.claude/workflows/review-chain.js),
[`.claude/workflows/`](../.claude/workflows/), [`agent_balance.py`](../tools/agent_balance.py).

## Teil 5: Arbeiten in Sessions

**Eine Hauptsession orchestriert.** Nur sie pusht, öffnet PRs und bereitet Merges vor. Implementierer arbeiten je
Aufgabe in einer frischen Session, auf eigenem Branch und in eigener Arbeitskopie, nie auf gemeinsamen Dateien.

**Das Briefing ist alles, was ein Subagent weiß.** Gib ihm eine feste Form: Aufgabe, genaue Pfade, Vertrag, die
roten Tests, Prüfbefehl, Grenzen, Berichtsformat.

**An Grenzen sauber anhalten.** Wird das Nutzungskontingent knapp, keine neuen Subagenten starten, den Stand ins
Ticket schreiben und die Fortsetzung planen, statt mitten in einer Aufgabe abzubrechen.

*In diesem Repo:* Skill [`brief-implementer`](../.claude/skills/brief-implementer/SKILL.md),
Hook [`limit-guard.sh`](../.claude/hooks/limit-guard.sh), [`tools/limit-waechter/`](../tools/limit-waechter/README.md).

## Teil 6: Review

**Werkzeuge vor Modellen.** Statische Analyse, Scanner und Abhängigkeitsprüfung laufen zuerst; ihre Ergebnisse
gehen ins Review-Paket.

**Getrennte Prüffelder.** Ein Reviewer sucht Abkürzungen (aufgeweichte Typen, abgeschwächte Tests, ungefragte
Extras), einer Sicherheit, einer Architektur. Keiner ändert Code; jeder meldet mit Datei und Zeile.

**Der PR erklärt sich selbst.** Oben stehen Risiko, Umkehrbarkeit und die wenigen Stellen, die genaues Hinsehen
verdienen. Jede Verweisnummer steht mit dem Satz, auf den sie zeigt.

**Grüne Reviews sortieren vor; sie ersetzen Tor 2 nicht.** Gemerged wird, was der Owner gelesen hat. Wer will,
kann für eng definierte PRs mit niedrigem Risiko eine Ausnahme festlegen, aber nur mit schriftlichen Bedingungen.

*In diesem Repo:* [`process/review-tools.md`](process/review-tools.md), [`pr.yml`](../.github/workflows/pr.yml),
[`CODING_STANDARDS.md`](CODING_STANDARDS.md), [`process/pr-format.md`](process/pr-format.md).

## Teil 7: Saubere Module

Was eine Codebasis unter Agenten verschlechtert, zeigt sich selten in einem Diff, sondern in der Summe vieler
harmloser: ein Pflichtfeld, das optional wird, ein Typ, der weiter wird, ein stiller Default, der einen Fehler
schluckt. Verbiete genau diese Abkürzungen ausdrücklich.

**Grenzen vor dem Bauen.** Jede Naht zwischen Modulen bekommt einen geprüften Vertrag. Ändern darf ihn nur der Owner,
mit Entscheidung, Versionssprung und Vertragstests.

**Grenzen als Werkzeug.** Abhängigkeitsregeln und Projektreferenzen machen falsche Importe zu Build-Fehlern. Jeder
neue Bereich bekommt ein kurzes README mit Zweck, Grenzen und Fallstricken.

**Tiefe Module, ein Vokabular.** Kleine Schnittstellen mit viel Verhalten dahinter, keine Exporte nur für Tests, und
ein Glossar, damit Agenten keine Synonyme erfinden.

*In diesem Repo:* [ADR 0012](adr/0012-vertraege-in-zod-json-schema-erzeugt.md),
[`check_docs_coverage.py`](../tools/check_docs_coverage.py), [`CODING_STANDARDS.md`](CODING_STANDARDS.md),
[Glossar](../CONTEXT.md).

## Teil 8: Lernen aus Fehlern

Ein Agent wiederholt einen Fehler, bis ihn etwas daran hindert. Die Schleife hat drei Stufen:

1. **Beim ersten Auftreten** eine Zeile in einer Lessons-Datei, mit der Frage, ob ein Werkzeug ihn gefangen hätte.
2. **Beim zweiten Auftreten** eine Vorkehrung an der engsten passenden Stelle, bevorzugt als Check (Lint, Hook,
   CI), sonst als Regel für den Bereich, erst zuletzt in der Hauptdatei.
3. **Beim dritten Auftreten** fragen, warum die Vorkehrung nicht greift.

Eine Retro nach den ersten Tickets und danach je Etappe schlägt Änderungen an Regeln, Schwellen und Modellstufen
vor. Projektregeln gehören ins Repository, nie ins persönliche Gedächtnis eines Agenten.

*In diesem Repo:* [`lessons.md`](lessons.md), Skills [`lesson`](../.claude/skills/lesson/SKILL.md) und
[`retro`](../.claude/skills/retro/SKILL.md), Hook [`git-pipe.sh`](../.claude/hooks/git-pipe.sh) als Beispiel einer
beförderten Lesson.

## Teil 9: Grenzen und Sicherheit

Agenten bekommen weitreichende Rechte. Ziehe deshalb mehrere Schichten ein:

| Schicht | Schützt vor |
|---|---|
| Sandbox | Zugriffen außerhalb freigegebener Pfade und Netzziele |
| Container für Werkzeuge | Installationen auf dem Rechner des Owners |
| Berechtigungen | Lesen und Schreiben von Secrets und `.env`-Dateien |
| Hooks | Änderungen an Secrets, eingefrorenen Dateien, Verträgen und Tests |
| Isolation | Kollisionen: eigene Arbeitskopie, eigener Stack, Wegwerf-Secrets je Aufgabe |
| Pre-Commit und CI | Secrets im Commit, Scanner-Befunde, abgelaufene Ausnahmen |

**Hooks sind Frühwarnung, nicht die letzte Instanz.** Lokale Prüfungen lassen sich umgehen; die CI wiederholt jede
davon.

**Secrets sieht kein Agent.** Muss der Owner eins setzen, bekommt er einen Einzeiler und führt ihn selbst aus.

**Blockiert heißt melden.** Verweigert die Sandbox oder ein Hook einen Befehl, sucht der Agent keinen Umweg.
Scanner-Befunde erklärt kein Agent zum Fehlalarm; jede Ausnahme braucht eine Begründung und ein Ablaufdatum, das
ein Check durchsetzt.

*In diesem Repo:* [`settings.json`](../.claude/settings.json), [`.claude/hooks/`](../.claude/hooks/),
[`lefthook.yml`](../lefthook.yml), [`ci.yml`](../.github/workflows/ci.yml),
[`check_due_dates.py`](../tools/check_due_dates.py).

## Zum Schluss

Agenten machen die Arbeit schneller, aber nicht unkontrollierter. Jede Entscheidung hat einen Ort, jeder Schritt
einen Nachweis, und jede Regel, die zweimal gebrochen wurde, wird ein Check. Wie viel davon ein Projekt braucht,
hängt von seiner Größe ab. Die Grundsätze aus Teil 1 und der sparsame Umgang mit Kontext aus Teil 4 gelten immer.
