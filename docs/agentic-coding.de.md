# Agentisches Coding in diesem Projekt

[English](agentic-coding.md) · **Deutsch**

Dieses Dokument beschreibt, wie in `live-factchecker-v2` Software mit KI-Agenten entsteht. Es richtet sich an
Menschen, die wissen wollen, wie Marco als Owner mit Agenten arbeitet. Ganz gelesen braucht es etwa acht Minuten;
wer nur Überschriften, fett gesetzte Satzanfänge und Tabellen liest, hat den Kern in drei. Jede Aussage zeigt auf
die Datei, in der sie umgesetzt ist; was hier steht, lässt sich im Repository nachprüfen.

Der Kern in drei Sätzen: Agenten schreiben in diesem Projekt fast den ganzen Code, die Tests und die Reviews. Sie
tun das in getrennten Rollen, gegen Entscheidungen, die vorher ein Mensch getroffen hat, und unter Prüfungen, die
als Code laufen. Der Mensch entscheidet an zwei Stellen.

## Teil 1: Acht Grundsätze

Die übrigen Teile zeigen, wie diese acht Punkte im Alltag greifen. Keiner steht nur als Wunsch in einem Dokument;
jeder ist an einer Stelle verankert, die ein Agent nicht überreden kann.

| Grundsatz | Wo er sitzt |
|---|---|
| Wer den Code schreibt, schreibt nie seine Tests, auch Marco nicht. | getrennte Rollen in [`.claude/agents/`](../.claude/agents/), [`process/rollen.md`](process/rollen.md) |
| Verträge zwischen den Modulen sind für Agenten nur lesbar. | Hook [`contracts.sh`](../.claude/hooks/contracts.sh), Skill [`new-contract`](../.claude/skills/new-contract/SKILL.md) |
| Nach Tor 1 sind Tests, Verträge und Ticket-Text eingefroren. | Manifest je Ticket in [`.claude/frozen/`](../.claude/frozen/README.md), Hooks (sha256) und CI (rot vor grün) |
| Zwei Tore gehören dem Owner: vor dem Code und vor dem Merge. | [`process/rollen.md`](process/rollen.md), [ADR 0011](adr/0011-rollen-und-bahnen-des-arbeitssystems.md) |
| Eine Regel, die ein Werkzeug prüfen kann, wird ein Check und keine Prosa. | [`lefthook.yml`](../lefthook.yml), Skripte unter [`tools/`](../tools/) |
| Fertig ist eine Aufgabe erst mit Beleg, nie mit einer Behauptung. | Skill [`evidence`](../.claude/skills/evidence/SKILL.md), Abnahmebericht je Ticket |
| Eine Session bearbeitet ein Issue; jede Implementierer-Aufgabe bekommt eine frische. | [`CLAUDE.md`](../CLAUDE.md), Abschnitt *Working* |
| Niemand schwächt einen Test ab, überspringt oder parkt ihn; ein falscher Test wird gemeldet. | Hook [`test-integrity.sh`](../.claude/hooks/test-integrity.sh), [`CLAUDE.md`](../CLAUDE.md) |

**Warum die Trennung von Code und Tests an erster Stelle steht.** Ein Modell, das seinen eigenen Code testet,
prüft vor allem seine eigene Lesart der Aufgabe. Darum schreibt hier der Testdesigner die roten Tests, ein Kritiker
auf einer stärkeren Modellstufe greift sie an, und erst danach kommt der Implementierer.

**Warum zwei Tore genügen.** Marco liest nicht jede Zwischenstufe. Er entscheidet am Anfang, was "fertig" heißt
(Tests und Verträge), und am Ende, ob das Ergebnis dazu passt (Diff und Urteile). Dazwischen halten Hooks, CI und
Review-Rollen die Linie.

## Teil 2: Wer was trägt

Agenten lesen schnell viel und bleiben über viele Dateien konsistent. Sie neigen aber dazu, mehr zu bauen als
verlangt, Erfolg zu früh zu melden und eine Abkürzung zu nehmen, wenn ein Test sonst rot bliebe. Die Aufteilung
setzt genau dort an.

| Owner (Marco) | Agenten-Rollen | Checks ohne Modell |
|---|---|---|
| Architektur, Grenzen, Verträge, ADRs | Ticket-Entwurf aus ADR und Spezifikation | Format, Lint, Typen, Abhängigkeitsgrenzen |
| Freigabe der Tests und Verträge (Tor 1) | rote Tests, Abnahmefälle, Gegenprüfung | eingefrorene Dateien per Hash prüfen |
| Lesen von Diff und Urteilen, Merge (Tor 2) | Produktionscode je Aufgabe | "rot vor grün" auf der PR-Basis |
| Entscheidung über jede Ausnahme | Reviews mit Datei und Zeile, nie editierend | Abnahmelauf, Scanner, PR-Größe |
| Modellstufen, Regeln, was gelernt wird | Retro-Vorschläge | Kontextbudget, Fristen, Modell-Sync |

Elf Rollen sind definiert, jede mit dem, was sie tut, und dem, was sie nie tut; die Tabelle im
[README](../README.de.md#3-wie-die-agenten-zusammenarbeiten) zeigt sie vollständig.

## Teil 3: Vom Ticket zum Merge

Jede Änderung nimmt denselben Weg, bewusst lang am Anfang und kurz am Ende.

1. **Entscheiden.** Marco klärt offene Fragen in Grilling-Runden und hält sie als ADR und Spezifikation fest
   ([`docs/adr/`](adr/), [`docs/spec/`](spec/), [`process/wayfinder.md`](process/wayfinder.md)).
2. **Schneiden.** Der Refinement-Agent macht daraus einen Ticket-Entwurf mit Akzeptanzkriterien, Risiko und Aufgaben
   ([`process/tickets.md`](process/tickets.md)). Das Issue ist der Plan; Plandateien gibt es nicht.
3. **Tests zuerst.** Der Testdesigner schreibt Gherkin-Features, rote Unit-Tests und Abnahmefälle, darunter einen
   bewusst falschen Fall als Kanarienvogel. Der Kritiker prüft höchstens zwei Runden lang.
4. **Tor 1.** Marco gibt Tests und Verträge frei. Ein Manifest friert sie per Hash ein.
5. **Bauen.** Je Aufgabe ein Implementierer in eigenem Worktree, Branch und Compose-Projekt, mit höchstens drei
   Versuchen bis grün. Danach meldet er `DONE`, `DONE_WITH_CONCERNS` oder `BLOCKED`, mit echter Befehlsausgabe.
6. **Prüfen.** Die Review-Kette läuft parallel über ein gemeinsames Paket (Teil 6). Danach läuft der Abnahmelauf als
   Code, und ein Richter auf einem anderen Modell als dem des Autors beurteilt den Bericht.
7. **Tor 2.** Marco liest Diff und Urteile und merged. Ausnahme: Ein PR mit abgeleitetem Risiko "niedrig" (umkehrbar
   und örtlich), der alles bestanden hat, wird von der Hauptsession gemerged und Marco danach vorgelegt
   ([`process/pr-format.md`](process/pr-format.md)).

**Kleine Schritte mit Nachweis.** Eine Aufgabe ist ein PR, unter etwa 400 Zeilen Produktionscode
([`check_pr_size.py`](../tools/check_pr_size.py) warnt darüber und blockiert ab 800). Commits stehen in
Lesereihenfolge: Vertrag, rote Tests, Logik, Verdrahtung, Doku. CI prüft auf der PR-Basis, dass die eingefrorenen
Tests dort aus dem richtigen Grund rot sind ([`check_red_before_green.sh`](../tools/check_red_before_green.sh)); ein
Test, der schon ohne die Änderung grün ist, beweist nichts.

**Erkenntnisse gehen zurück ins Konzept.** Verschiebt sich beim Bauen eine Grenze, ein Vertrag oder ein Prinzip,
wird zuerst ein datierter ADR-Nachtrag geschrieben; er hat Vorrang vor der Spezifikation, die im selben Commit
angepasst wird, und [`architecture.md`](architecture.md) zieht mit. Erst dann folgt ein neuer Anlauf. Braucht eine
Korrektur im PR mehrere Absätze Erklärung, ist sie eine Spezifikationsänderung und gehört ins Issue
([`spec/process/tickets.md`](spec/process/tickets.md)).

## Teil 4: Sparsam mit Kontext und Tokens

Was ein Agent im Kontextfenster hat, bestimmt, was er liefert. Was dort steht und nichts mit der Aufgabe zu tun hat,
verdrängt das, was zählt, und jede Zeile wird bezahlt, oft bei jedem Aufruf neu. Darum behandelt das Projekt
Kontext wie ein knappes Budget und nicht wie einen Speicher, in den man vorsichtshalber alles legt.

**Feste Zeilenbudgets, geprüft vor dem Commit und in der CI.** Die Dateien, die Claude Code automatisch lädt, haben
Obergrenzen: `CLAUDE.md` 120 Zeilen, Regeln je Bereich 80, Rollen 120, Skills 100. Darüber wird gekürzt oder auf ein
Dokument verwiesen; das prüft [`check_context_budget.py`](../tools/check_context_budget.py).

**Drei Ladewege statt einer großen Datei.**

| Was | Wann es geladen wird | Wo |
|---|---|---|
| Regeln für jede Session | immer, darum knapp und meist als Verweis | [`CLAUDE.md`](../CLAUDE.md) |
| Regeln für einen Bereich | nur wenn der Agent Dateien dieses Pfads anfasst | [`.claude/rules/`](../.claude/rules/) mit `paths:` |
| Prozeduren | dauerhaft nur die Kurzbeschreibung, der Inhalt beim Aufruf | [`.claude/skills/`](../.claude/skills/) |
| Prüflisten für Rollen | nur in den Rollen, die sie brauchen, vorgeladen | Feld `skills:` in den Rollendateien |

**Zusammenfassen statt mitschleppen.** Muss eine Session einen ganzen Codebereich verstehen, schreibt vorher eine
eigene Session eine Synthese-Notiz: was der Bereich verantwortet, wie Daten fließen, welche Typen tragen, wo es
hakt, mit Datum und Commit ([`docs/synthesis/`](synthesis/README.md)). Der Implementierer liest die Notiz statt des
ganzen Bereichs. Briefings zählen die Dateien einzeln auf, statt ganze Ordner zu übergeben. Messrohdaten bleiben
außerhalb des Repos; eingecheckt wird nur die Auswertung.

**Subagenten nur mit Grund.** Ein Subagent hält die Hauptsession sauber, weil er liest und nur das Ergebnis
zurückgibt. Er baut seinen Kontext aber von vorn auf und verbraucht eigene Tokens. Darum sind
Hintergrund-Subagenten der Standard für reine Lesearbeit und die Review-Kette ([`CLAUDE.md`](../CLAUDE.md),
*Working*), jeweils mit Umfang, Dateien, getroffenen Entscheidungen, gewünschter Ausgabeform und den Host-Regeln im
Briefing. Bei knappem Kontingent verweigert ein Hook neue Subagenten ganz
([`limit-guard.sh`](../.claude/hooks/limit-guard.sh)).

**Modellstufe nach Rolle, Aufwand nach Risiko.** Die Stufen stehen an einer Stelle,
[`.claude/models.json`](../.claude/models.json). Urteile, auf die sich alles stützt (Abnahme-Richter, Kritiker,
Architektur-Review), laufen auf der höchsten Stufe; keine Review-Rolle läuft unter "stark". Den Reasoning-Aufwand
des Implementierers setzt das Risiko des Tickets: niedrig, mittel oder hoch.
[`sync_agent_models.py`](../tools/sync_agent_models.py) schreibt die Stufen in die Rollendateien und lässt die
Prüfung scheitern, wenn eine Untergrenze verletzt ist.

**Ein Präfix für alle Reviewer.** Die Hauptsession baut das Review-Paket einmal (Diff, Manifest, Synthese-Notiz,
Werkzeugergebnisse) und gibt es allen Reviewern als identischen Anfang ihres Prompts
([`review-chain.js`](../.claude/workflows/review-chain.js)). Das lässt Prompt-Caching greifen.

**Feste Abläufe statt freier Ketten.** Die drei Ketten, die sich wiederholen (Testdesign, Review, Abnahme), laufen
als Skripte unter [`.claude/workflows/`](../.claude/workflows/). Kein Agent ruft einen anderen nach eigenem
Ermessen auf. Runden und Versuche sind begrenzt: zwei Runden Kritik, drei Versuche bis grün.

**Rechtzeitig verdichten.** Bei 60 bis 70 Prozent Kontextfüllung wird manuell kompaktiert, nachdem die offenen
Punkte als Kommentar im Issue stehen. Ein Hinweis-Hook meldet sich ab 60 Prozent
([`context-hint.sh`](../.claude/hooks/context-hint.sh)), und vor jeder Verdichtung notiert ein Hook den Git-Stand
([`pre-compact.sh`](../.claude/hooks/pre-compact.sh)).

**Messen statt schätzen.** Jeder PR trägt eine Agenten-Bilanz: Runden, Versuche bis grün und Urteile je Rolle, dazu
Tokens, wo die Sitzungsdaten vorliegen ([`agent_balance.py`](../tools/agent_balance.py)). Die Retro liest diese
Zahlen und schlägt Änderungen an den Modellstufen vor.

## Teil 5: Arbeiten in Sessions

**Ein Issue, eine Session.** Was nicht zum Issue gehört, bekommt ein eigenes Issue und später eine eigene Session.
Jede Implementierer-Aufgabe startet frisch, damit der Code einer Aufgabe nicht vom Rauschen der vorigen abhängt.

**Die Hauptsession orchestriert, die Rollen arbeiten.** Nur die Hauptsession pusht, öffnet PRs und bereitet Merges
vor. Implementierer committen auf ihrem eigenen Branch und sonst nichts. Höchstens drei laufen parallel, nie auf
gemeinsamen Dateien.

**Das Briefing ist alles, was ein Subagent weiß.** Darum hat es eine feste Form
([`brief-implementer`](../.claude/skills/brief-implementer/SKILL.md)): Aufgabe, genaue Pfade, Vertrag, die
eingefrorenen roten Tests, Prüfbefehl, Host-Regeln, Namen für Worktree und Stack, Berichtsformat.

**Grenzen eines Laufs.** Meldet der Limit-Wächter ([`tools/limit-waechter/`](../tools/limit-waechter/README.md))
die harte Grenze, stoppt die Hauptsession alle Subagenten, schreibt den Stand ins Issue und plant die Fortsetzung.

**Nicht:** ein Implementierer, der nebenbei den Vertrag "kurz" erweitert und ein Akzeptanzkriterium umformuliert;
genau das verweigern die Hooks [`contracts.sh`](../.claude/hooks/contracts.sh) und
[`frozen-manifest.sh`](../.claude/hooks/frozen-manifest.sh).

## Teil 6: Review

**Mehrere Augen, verschiedene Fragen.** Die Reviewer sind getrennte Rollen mit eigenem Prüffeld und editieren nie.

| Rolle | Fragt nach |
|---|---|
| Reviewer (immer) | Abkürzungen: aufgeweichte Typen, abgeschwächte Tests, ungefragte Extras |
| Security-Reviewer | Secrets, Eingabegrenzen, Datenschutzgrenze, CI-Sicherheit; jeder Befund blockiert |
| Architektur-Reviewer | Modulgrenzen, doppelter Zustand, fehlende ADRs, veraltete Synthese-Notiz |
| Frontend-Reviewer | Komponenten, Barrierefreiheit, i18n; nur bei Änderungen unter `apps/` |

Vor den Modellen stehen die Werkzeuge: Fallow und Sonar aus [`process/review-tools.md`](process/review-tools.md),
Semgrep und Trivy aus der PR-Pipeline ([`pr.yml`](../.github/workflows/pr.yml)); ihre Ergebnisse liegen im
Review-Paket ([ADR 0011, Nachtrag 2026-10-25](adr/0011-rollen-und-bahnen-des-arbeitssystems.md)). Die Reviewer
bekommen außerdem eine kurze Prüfliste für Pläne, ADRs und Diffs vorgeladen und urteilen nach den
[Coding Standards](CODING_STANDARDS.md), die nur Ermessensfragen enthalten; alles Mechanische ist ein Lint.

**Die Abnahme urteilt über Belege, nicht über Code.** Der Abnahme-Richter liest ausschließlich den Bericht des
Abnahmelaufs und vergleicht ihn mit der Erwartung, die vor dem Bau aufgeschrieben wurde. Er weiß nicht, welcher Fall
der Kanarienvogel ist. Lässt er ihn durch, wird sein Urteil verworfen.

**Der PR ist für einen Leser geschrieben, der das Ticket nicht kennt.** Oben steht der deutsche Review-Leitfaden mit
Risiko, Umkehrbarkeit und höchstens fünf Stellen, an denen genau hingeschaut werden soll. Jede Nummer steht mit dem
Satz, auf den sie verweist. Ideen, die niemand bestellt hat, stehen als Vorschlag im PR und nicht still im Code.

Grüne Urteile sind eine Vorsortierung für Tor 2, kein Ersatz dafür; gemerged wird, was Marco gelesen hat.

## Teil 7: Saubere Module bei hohem Tempo

Was den Code hier bedroht, zeigt sich nicht in einem Diff, sondern in der Summe vieler, die jeder für sich harmlos
aussehen: ein Pflichtfeld, das optional wird, ein Typ, der weiter wird, ein stiller Default, der einen Fehler
schluckt ([`CLAUDE.md`](../CLAUDE.md), *Quality*; Rolle [`reviewer`](../.claude/agents/reviewer.md)).

**Grenzen vor dem Bauen.** Jede Naht zwischen Modulen hat einen Vertrag als Zod-Schema mit erzeugtem JSON-Schema
([ADR 0012](adr/0012-vertraege-in-zod-json-schema-erzeugt.md), `packages/contracts/`). Ändern darf ihn nur der Owner,
mit ADR, Versionssprung und Vertragstests.

**Grenzen als Werkzeug.** dependency-cruiser läuft vor dem Commit und in der CI, TypeScript-Projektreferenzen
trennen die Pakete, und der Architektur-Reviewer kennt die Verträge. Neue Verzeichnisse unter `apps/`, `services/`,
`packages/` und `tests/` bekommen ein README (Zweck, Grenzen, Fallstricke, Befehle) und eine passende Bereichsregel;
[`check_docs_coverage.py`](../tools/check_docs_coverage.py) prüft das.

**Tiefe Module.** Kleine Schnittstelle, viel Verhalten dahinter, ein Begriff an einem Ort. Kein Export und kein
Parameter nur dafür, dass ein Test an Interna kommt ([`CODING_STANDARDS.md`](CODING_STANDARDS.md)). Ein neuer
Teilbereich übernimmt Struktur und Qualitätsniveau des besten vorhandenen
([`new-service`](../.claude/skills/new-service/SKILL.md)).

**Ein Vokabular.** Die Fachbegriffe stehen einmal im [Glossar](../CONTEXT.md), samt der Begriffe, die nicht
verwendet werden.

## Teil 8: Lernen aus Fehlern

Ein Agent wiederholt einen Fehler so lange, bis ihn etwas daran hindert. Die Schleife dafür hat drei Stufen.

1. **Beim ersten Mal** wird der Fehler oder Marcos Korrektur eine Zeile in [`lessons.md`](lessons.md), mit der
   Frage, ob ein Werkzeug ihn gefangen hätte (Skills [`lesson`](../.claude/skills/lesson/SKILL.md) und
   [`feedback`](../.claude/skills/feedback/SKILL.md)).
2. **Beim zweiten Mal** wird daraus eine Vorkehrung, an der engsten passenden Stelle und bevorzugt als Check: Lint,
   Hook oder CI-Job vor Bereichsregel, Bereichsregel vor `CLAUDE.md`. Prosa nur, wenn sich nichts prüfen lässt.
3. **Beim dritten Mal** ist die Frage nicht mehr der Fehler, sondern warum die Vorkehrung nicht greift.

Zwei Beispiele aus der Tabelle, die heute Hooks sind: [`git-pipe.sh`](../.claude/hooks/git-pipe.sh) (eine Pipe
verdeckte gescheiterte Commits) und [`owner-stack.sh`](../.claude/hooks/owner-stack.sh) (Agenten erreichten den
Stack des Owners).

Die [Retro](../.claude/skills/retro/SKILL.md) läuft nach den ersten drei gemergten Tickets, danach am Ende jedes
Inkrements, und schlägt Änderungen an Regeln, Schwellen und Modellstufen vor. Projektregeln liegen im Repository,
nie im persönlichen Gedächtnis eines Agenten.

## Teil 9: Grenzen und Sicherheit

Was Agenten nicht dürfen, ist in mehreren Schichten gefasst.

| Schicht | Was sie verhindert |
|---|---|
| Claude-Code-Sandbox auf dem Host | Zugriffe außerhalb der freigegebenen Pfade und Netzziele |
| Toolbox-Container | Installationen auf dem Host: Node, pnpm und Pakete laufen nur im Container (`scripts/tb`) |
| Berechtigungen in [`settings.json`](../.claude/settings.json) | Lesen und Schreiben von `.env`-Dateien und dem Secrets-Verzeichnis |
| Hooks | Secrets, Owner-Stack, eingefrorene Dateien, Verträge, abgeschaltete Tests, Pipes hinter Git-Befehlen |
| Isolation | eigener Worktree, Branch und Compose-Projekt `lfc-<issue>-<task>` mit Wegwerf-Secrets je Aufgabe |
| Pre-Commit und CI | gitleaks, Scanner, Image-Scan, Fristen für jede Ausnahme |

**Hooks warnen früh, entscheiden aber nicht allein.** Sie sind Komfort und Frühwarnung; die eigentlichen Wächter
sind die Git-Hooks über [lefthook](../lefthook.yml) und die CI. Kein Schutz verlässt sich darauf, dass ein Hook
geladen ist. Die Pre-Commit-Prüfungen in `lefthook.yml` richtet jeder Klon selbst ein; weil `--no-verify` sie
umgehen kann, wiederholt die CI jede davon ([`ci.yml`](../.github/workflows/ci.yml),
[`pr.yml`](../.github/workflows/pr.yml)). Die Hooks selbst haben einen Regressionstest
([`test-hooks.sh`](../.claude/hooks/test-hooks.sh)).

**Secrets sieht kein Agent.** Er liest, druckt und schreibt keine `.env`-Dateien und nichts, was nach einem Schlüssel
aussieht. Muss Marco ein Secret setzen, bekommt er einen Einzeiler und führt ihn selbst aus.

**Blockiert heißt: melden.** Verweigert die Sandbox oder ein Hook einen Befehl, sucht der Agent keinen anderen Weg,
sondern meldet es. Einen Scanner-Befund erklärt kein Agent zum Fehlalarm; eine schmale Ausnahme braucht eine
Begründung im Code, eine Nennung im PR und ein Ablaufdatum, das [`check_due_dates.py`](../tools/check_due_dates.py)
durchsetzt ([`process/due.md`](process/due.md)).

## Was daraus folgt

Für ein Kundenprojekt heißt das: Agenten machen die Arbeit schneller, aber nicht unkontrollierter. Jede
Entscheidung hat einen Ort, jeder Schritt einen Nachweis, und jede Regel, die zweimal gebrochen wurde, ist danach
ein Check. Wie viel davon ein Projekt braucht, hängt von seiner Größe ab; die Grundsätze aus Teil 1 und die
Kontextdisziplin aus Teil 4 gelten immer.
