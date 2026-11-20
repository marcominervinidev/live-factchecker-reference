# Spezifikation: Modellrollen und Vertrag der Erkennung

Stand 2026-10-12, Verifier und Modelle für Version 1 nachgetragen am 2026-10-25 (ADR 0004, Nachtrag 2026-10-25). Entscheidungen stehen in ADR 0002 (Form der Erkennung) und ADR 0004 (Modellrollen); dieses Dokument legt fest, wie Claim Extractor, Resolver und Topic Extractor aufgerufen werden, wie der Prompt aufgebaut ist, was sie ausgeben und mit welchen Parametern der Vergleichsprototyp ("Vergleichsprototyp Erkennung", #30) im Repo `live-factchecker-v2` startet. Begriffe nach `CONTEXT.md` (Tick, Turn, Claim, Candidate, Claim Extractor, Resolver, Topic Extractor, Setting). Messbegriffe (Golden Set, Arm, Richter) stehen in `docs/spec/messaufbau-erkennung.md`.

## 1. Rollen

| Rolle | Läuft | Eingabe | Ausgabe | Anforderung |
|---|---|---|---|---|
| **Claim Extractor** (Stufe 1) | in jedem Tick des aktuellen Sprechers | Präfix, Behauptungsliste des Gesprächs, die letzten zwei Turns, der kumulative Turn in Blöcken (Abschnitt 3) | `claims`, `candidates`, im Diagnosemodus `discarded` (Abschnitt 4) | p95 ≤ 5 s je Aufruf am EU-Endpunkt; beide Extraktoren zusammen ≤ 0,063 USD je Gesprächsminute bei 12 Aufrufen je Minute; Thinking aus oder `low` |
| **Resolver** (Stufe 2) | je Candidate, sofort nach Rückkehr der Stufe 1, außerhalb des Ticks | wie Stufe 1, aber fünf Turns Kontext, die ganze Behauptungsliste, der Candidate mit Grund (Abschnitt 5) | `claim` oder `none` | stärkere Modellklasse als Stufe 1; Latenz so, dass p95 vom letzten Wort bis zur Karte ≤ 20 s hält (ADR 0003 Nachtrag 2026-10-23, vorher 15 s) (Opus-Klasse nur bei Eskalationsrate unter 5 %) |
| **Verifier** (Prüfstufe) | je Behauptung, die sonst eine Karte würde (aus Stufe 1 oder Resolver), sofort, außerhalb des Ticks | Präfix mit Anweisung und Schema, Block mit Satz, Wortlaut, Sprecher als Platzhalter, Rolle, Kontext und Vorredner (Abschnitt 5a) | `pruefwuerdig` und `grund` | kurz, Thinking aus; fail-open; seine Latenz zählt in p95 bis zur Karte |
| **Topic Extractor** | in jedem Tick, eigener Aufruf | Anweisung, Tag-Liste, Fenster 60 s, Neues seit der letzten Analyse (Abschnitt 6) | fortgeschriebene Tag-Liste | wie Stufe 1; in Version 1 des Messaufbaus nur mitgeschrieben (ADR 0003) |
| Vortor | entfällt (ADR 0004) | | | |

Kein Modellaufruf verwirft still: Was Stufe 1 nicht auflöst, geht an den Resolver; was der Resolver nicht auflöst, steht im Protokoll mit Candidate und Grund; was der Verifier verwirft, steht im Protokoll mit Behauptung und Grund. Protokoll heißt: Kennungen, Grundkategorie und Ausgang im Log, der Text nur im Session-Zustand und als Diagnoseereignis auf dem internen Erkennungsstrom (ADR 0009, Nachtrag 2026-10-27).

**Modelle für Version 1** (ADR 0004, Nachtrag 2026-10-25; gemessen an der Anthropic-API, ADR 0006, Nachträge): Claim Extractor und Topic Extractor Haiku 5.5, Thinking aus, Prompt v2 (`evals/configs/prompts/claim_extractor.v2.de.txt`, `topic_extractor.de.txt`); Resolver Sonnet 5.5 `low` (`resolver.de.txt`); Verifier Sonnet 5.5, Thinking aus (`verifier.v2.de.txt`). Die Pipeline übernimmt diese Prompts unverändert; eine Änderung ist ein Messlauf, keine stille Anpassung.

## 2. Tick und Turn

- **Tick:** alle 5 Sekunden Redezeit des aktuellen Sprechers, gemessen an den Wortzeiten der finalisierten Segmente, plus eine Abschlussanalyse am Turn-Ende. Die Abschlussanalyse läuft immer, auch bei Turns unter 5 Sekunden und auch bei einem Wort; es gibt keinen Längen- oder Wortfilter. Mindestens ein Aufruf je Turn und Extraktor.
- **Überspringen:** Ist der vorige Aufruf desselben Extraktors für denselben Turn noch nicht zurück, entfällt der fällige Tick; der nächste Tick nach der Rückkehr bekommt den gesamten Zuwachs. Keine parallelen Aufrufe je Turn und Extraktor. Übersprungene Ticks werden gezählt und berichtet.
- **Turn-Bildung** (Startwerte, Abschnitt 8): Ein Turn endet, wenn der Sprecher wechselt, wenn eine Pause von 3 Sekunden oder mehr liegt, oder wenn er 3 Minuten erreicht; danach beginnt ein neuer Turn desselben Sprechers, und der vorige wird Kontext. Ein Einwurf eines anderen Sprechers unter 2 Sekunden, der sich mit der laufenden Rede überlappt, beendet den laufenden Turn nicht; der Einwurf ist ein eigener Turn und wird selbst analysiert (Abschlussanalyse).
- **Nur finalisierte Segmente** gehen in Turn-Blöcke; vorläufige STT-Hypothesen nie. Ein gesendeter Block ändert sich nicht mehr.
- **Beide Messmodi** bilden Turns nach diesen Regeln; im Textmodus kommen Sprecher und Zeiten aus dem Referenz-Transkript, Pause und Höchstlänge gelten trotzdem.

## 3. Prompt des Claim Extractors

Reihenfolge der Blöcke, von vorn nach hinten. Was früh steht, ändert sich selten; was spät steht, ändert sich je Tick. So bleibt der längste gleiche Anfang cachebar.

| # | Block | Ändert sich | Inhalt |
|---|---|---|---|
| 1 | **Präfix** | je Conversation einmal | Systemanweisung (Aufgabe, Regeln aus Abschnitt 4.3, Sprache), Ausgabeschema, Setting: Sprecher mit Namen und Rolle (Moderation, Gast, Host, private Person), Person des öffentlichen Lebens ja oder nein, Anfangs-Topic. Mindestlänge für Caching 512 Token; bei Haiku 4.5 (4.096 Token) mit Few-Shot-Beispielen auffüllen oder Caching dort nicht erwarten |
| 1a | **Zuordnungstabelle** | je Attribution | Label zu Sprecher mit Sicherheit (`docs/spec/sprecher.md`, Abschnitt 2); Sprechernamen nur aus dieser Tabelle, ein Label ohne `certain` bleibt Label |
| 2 | **Behauptungsliste des Gesprächs** | je Turn-Beginn | alle bis zum Beginn dieses Turns ausgegebenen Behauptungen in Kurzform `id · Sprecher · Satz`, älteste zuerst, Deckel 100 (älteste fallen heraus), append-only |
| 3 | **Kontext-Turns** | je Turn-Beginn | die letzten N = 2 Turns vor dem aktuellen, egal welcher Sprecher, je mit Sprechername, Start- und Endzeit, Wortlaut; Deckel 600 Token, der ältere wird zuerst gekürzt |
| 4 | **Turn-Blöcke** | je Tick ein neuer Block | der neue Redetext seit dem letzten Tick: Segment-Ids, Wortzeiten, Wortlaut; Block k enthält nur den Zuwachs, nie den ganzen Turn |
| 5 | **Delta-Behauptungen** | je Tick | die in diesem Turn bereits ausgegebenen Behauptungen in Kurzform (sie stehen noch nicht in Block 2) |
| 6 | **Schlussanweisung** | fest | "Gib nur aus, was in der Behauptungsliste und den Delta-Behauptungen noch nicht steht; verweise Wiederholungen mit `repeatOf`" |

Cache-Breakpoints: nach Block 1, nach Block 3, und je 20 Turn-Blöcke (die Präfixsuche der Anbieter geht 20 Blöcke zurück). Jeder Block ist ein eigener Inhaltsblock der Nachricht, kein Textblock, der länger wird. Welche API-Form das ist (Content-Blocks, Nachrichten), entscheidet der Provider-Adapter.

Sprechernamen aus dem Setting gehen in beiden Modi "Sendung" und "Gespräch" in den Prompt (ADR 0002); die Maske für Namen sitzt an der Grenze zur Websuche, nicht hier.

## 4. Ausgabe des Claim Extractors

### 4.1 Schema

```json
{
  "claims": [
    {
      "speaker": "Anna Müller",
      "sentence": "Anna Müller behauptet, dass die Mieten in Berlin seit 2015 um 40 Prozent gestiegen sind.",
      "verbatim": "also die Mieten hier in Berlin, die sind seit 2015 um vierzig Prozent hoch",
      "segmentIds": ["s-0412", "s-0413"],
      "type": "zahl",
      "checkworthiness": "hoch",
      "kind": "tatsache",
      "refersTo": null,
      "repeatOf": null
    }
  ],
  "candidates": [
    {
      "speaker": "Jens Weber",
      "verbatim": "das stimmt so nicht, die Zahl war viel niedriger",
      "segmentIds": ["s-0419"],
      "reason": "bezug_unklar",
      "note": "Bezug auf eine Zahl, die nicht in den letzten zwei Redebeiträgen steht"
    }
  ],
  "discarded": [
    { "verbatim": "das ist doch eine Schande", "reason": "meinung" }
  ]
}
```

| Feld | Werte | Regel |
|---|---|---|
| `speaker` | Name aus dem Setting oder Rolle | nie aus der Stimme; private Sprecher ohne Namen im Setting als Rolle ("die Anruferin") |
| `speakerLabel`, `speakerSource`, `speakerCertainty` | Diarisierungslabel; Quellen der Attribution; `certain`, `probable`, `none` | setzt der Harness aus der Zuordnungstabelle, nicht das Modell (ADR 0008) |
| `sentence` | Text | eigenständiger deutscher Satz mit benanntem Sprecher, immer Paraphrase, Form "X behauptet / bestreitet / bestätigt, dass …" (Richtlinie des Messaufbaus, Abschnitt 3.2) |
| `verbatim` | Text | wörtlicher Ausschnitt aus den Turn-Blöcken |
| `segmentIds` | Liste | alle Segmente, aus denen die Behauptung gebaut ist; daraus leitet der Harness Start- und Endzeit ab |
| `type` | `zahl`, `ereignis`, `zitat`, `ursache` | Typ nach ADR 0002 |
| `checkworthiness` | `hoch`, `niedrig` | ordnet die Warteschlange der Prüfung; `niedrig` bekommt eine Einschätzung (ADR 0002) |
| `kind` | `tatsache`, `widerspruch`, `zustimmung`, `meinung_mit_kern` | wie das Label-Schema des Messaufbaus; bei `meinung_mit_kern` formuliert `sentence` nur den Kern |
| `refersTo` | Id aus der Behauptungsliste oder null | Pflicht bei `widerspruch` und `zustimmung`; fehlt die Bezugsbehauptung in der Liste, ist das ein Candidate mit `bezug_unklar` |
| `repeatOf` | Id aus der Behauptungsliste oder null | derselbe Sprecher wiederholt eine eigene Behauptung: keine neue Karte, keine Dublette im Bericht |
| `candidates[].reason` | `bezug_unklar`, `kern_unklar`, `sprecher_unklar` | Bezug außerhalb des Kontexts; nicht entscheidbar, ob ein Tatsachenkern vorliegt; Sprecher nicht zuzuordnen (Überlappung, Diarisierungsfehler) |
| `discarded[].reason` | `meinung`, `prognose`, `appell`, `frage` | nur im Diagnosemodus (Abschnitt 9); im Produkt wird das Feld nicht angefordert |

Ids der Behauptungen vergibt der Harness bei der Ausgabe (`c-<laufende Nummer je Conversation>`); das Modell nennt in `refersTo` und `repeatOf` nur Ids, die es in der Behauptungsliste oder den Delta-Behauptungen gesehen hat.

### 4.2 Validierung und Fehler

- Der Harness validiert jede Antwort gegen das Schema, und zwar je Element (Behauptung, Candidate). Ein Element mit Verstoß wird verworfen und mit Grund gezählt; die gültigen Elemente derselben Antwort gelten (ADR 0004, Nachtrag 2026-10-26). Ist die Antwort als Ganzes unbrauchbar (kein gültiges JSON oder Schema der Hülle verletzt), wird einmal wiederholt mit der Fehlermeldung als Zusatz; schlägt auch das fehl, gilt der Tick als verloren (der nächste Tick sieht den ganzen Turn). Sind alle Elemente verletzt, gilt die Antwort als leer, ohne Wiederholung: Die Verstöße kommen fast immer aus Kontext-Turns und kämen wieder, und die Wiederholung kostet Ticks (Ticket #73, Probe 3). Der Bericht führt die Schema-Fehlerrate je Versuch, die verworfenen Elemente je Grund und die verlorenen Ticks getrennt.
- Wie der Adapter das Schema erzwingt (Structured Outputs, erzwungenes Tool, Prompt), ist Sache des Adapters; Bedrock kann nur Tool-Use, Vertex `eu` kann Structured Outputs. Die Fehlerrate wird je Adapter berichtet.
- Ein `sentence`, dessen `verbatim` nicht in den Turn-Blöcken vorkommt, ist ein Verstoß dieses Elements (Treue; der Harness prüft den Wortlaut nach Normalisierung von Groß- und Kleinschreibung und Satzzeichen). Ein Zitat aus einem Kontext-Turn, auch desselben Sprechers, zählt dazu.

### 4.3 Regeln an das Modell (Kern der Systemanweisung)

1. Eine Behauptung je Sachverhalt; ein Turn kann mehrere tragen; eine Behauptung kann mehrere Segmente umfassen.
2. Unvollständige Sätze bleiben liegen; sie sind weder Claim noch Candidate.
3. Widerspruch und Zustimmung zu einer Behauptung in der Liste oder den Kontext-Turns sind Behauptungen des antwortenden Sprechers über denselben Sachverhalt, mit `refersTo`.
4. Reine Werturteile, Prognosen, Versprechen, Appelle und echte Fragen sind keine Behauptung; rhetorische Fragen mit unterstelltem Fakt sind eine.
5. Was schon in der Behauptungsliste oder den Delta-Behauptungen steht, wird nicht erneut ausgegeben; eine Wiederholung desselben Sprechers bekommt `repeatOf`.
6. Candidate statt Claim, wenn ein Bezug nicht aus Kontext-Turns und Behauptungsliste auflösbar ist, wenn nicht entscheidbar ist, ob ein Tatsachenkern vorliegt, oder wenn der Sprecher nicht zuzuordnen ist.
7. Sprechernamen nur aus dem Setting.
8. Privatfilter (ADR 0009, Spezifikation Datenschutz, Abschnitt 5): Eine Aussage über eine Person, die nicht öffentlich bekannt ist, aus dem Umfeld der Sprecher (Anwesende, Familie, Freunde, Nachbarn, Kollegen) wird keine Behauptung und kein Candidate; Personen des öffentlichen Lebens werden auch bei Privatem geprüft, einschließlich öffentlich bekannter Tatsachen über ihre Familie; Amt, Abstimmungen und öffentliche Aussagen sind nie privat; im Zweifel privat. Der Resolver kennt dieselbe Regel. Anzahl im Diagnosefeld `dropped.private`.

## 5. Resolver

- **Auslöser:** jeder Candidate der Stufe 1, sofort nach deren Rückkehr; ein Aufruf je Candidate.
- **Eingabe:** Präfix wie Stufe 1 (eigene Anweisung, gleiches Schema für `claims`), die ganze Behauptungsliste des Gesprächs ohne Deckel 100 (bei mehr als 100 die letzten 100 plus alle desselben Sprechers), die letzten fünf Turns, der aktuelle Turn vollständig bis zum Zeitpunkt des Candidates, der Candidate mit `verbatim`, `segmentIds`, `reason`, `note`.
- **Ausgabe:**

```json
{ "resolution": "claim", "claim": { "…wie claims[] in 4.1…" }, "note": "" }
```

  oder `{ "resolution": "none", "claim": null, "note": "Grund" }`.

- **Folgen:** `claim` wird wie eine Behauptung der Stufe 1 behandelt (Id, Karte, Warteschlange); die Latenz zählt vom Ende des letzten Worts des Claims bis zur Karte und geht in p95 ein. `none`, Timeout (Startwert 12 s) und Fehler landen im Protokoll mit Candidate, Grund und Antwort; nichts davon erreicht eine Karte.
- **Modell:** stärkere Klasse als Stufe 1; im Prototyp Sonnet 5.5 `low` (Baseline) und Opus 5.5 `low` als Variable; die konkrete Wahl trifft "Anbieterentscheidungen" anhand der gemessenen Eskalationsrate.

## 5a. Verifier

- **Auslöser:** jede Behauptung, die sonst eine Karte würde, aus Stufe 1 oder aus dem Resolver, nach `repeatOf` und dem Abgleich mit der Behauptungsliste; ein Aufruf je Behauptung, sofort.
- **Behauptungsliste:** Die Behauptung bekommt ihre Id beim Eingang in den Verifier und steht ab dann in der Behauptungsliste und im Delta des Turns, gleich ob sie noch geprüft, gezeigt oder verworfen wird. Die Liste zeigt keinen Status. Eine neue Behauptung im selben Turn, die einer wartenden oder verworfenen gleicht (gleicher normalisierter Satz oder Wortlaut-Jaccard ab 0,5), geht nicht erneut an den Verifier und wird nicht gezeigt; sie steht im Protokoll als unterdrückte Wiederholung.
- **Eingabe:** Präfix mit Anweisung und Schema (je Lauf gleich, gecacht); je Aufruf ein Block mit `satz`, `wortlaut`, `sprecher` als Platzhalter (Sprecher A, B … in der Reihenfolge des ersten Auftretens; der Name wird auch in Satz und Kontext ersetzt), `rolle` aus dem Setting, `kontext` (die letzten 80 Wörter des aktuellen Turns bis zum Ende des Wortlauts), `vorredner` (die letzten 40 Wörter des vorigen Turns eines anderen Sprechers, ohne Einwürfe).
- **Ausgabe:** `{ "pruefwuerdig": true, "grund": "…" }`.
- **Folgen:** `true` ergibt die Karte bei der Rückkehr des Verifiers; `false` keine Karte, Eintrag im Protokoll mit Behauptung und Grund. Fehler nach einer Wiederholung und Timeout (Startwert 8 s) zeigen die Karte trotzdem (fail-open) und stehen im Protokoll. Die Latenz zählt vom Ende des letzten Worts bis zur Karte und schließt den Verifier ein.

## 6. Topic Extractor

- **Prompt:** [Anweisung][Tag-Liste][Fenster: die letzten 60 Sekunden Transkript mit Sprechern][Neues seit der letzten Analyse]. Präfix für Caching ist [Anweisung][Tag-Liste]; er wird bei jeder Änderung der Tag-Liste neu geschrieben.
- **Tag-Liste:** Topics und Unter-Topics der Conversation mit Status, beginnend mit dem Anfangs-Topic aus dem Setting.
- **Ausgabe:**

```json
{
  "current": ["Mieten Berlin", "Mietpreisbremse"],
  "new": [{ "tag": "Mietpreisbremse", "parent": "Mieten Berlin" }],
  "returned": [],
  "ended": []
}
```

- **Takt:** jeder Tick wie der Claim Extractor, eigener Aufruf, gleiche Überspringregel.
- **Version 1 des Messaufbaus:** Tag-Listen werden je Ausschnitt mitgeschrieben, ohne Soll-Wert (ADR 0003). Ein zweistufiger Themen-Extraktor ist kein Arm (ADR 0004).

## 7. Anforderungen an die Modelle (Eingabe für "Anbieterentscheidungen")

| Rolle | Latenz | Kosten | Thinking | Caching | Schema |
|---|---|---|---|---|---|
| Stufe 1 und Topic Extractor | p95 ≤ 5 s je Aufruf, gemessen am EU-Endpunkt mit dem echten Prompt | beide Extraktoren ≤ 0,063 USD je Gesprächsminute bei 12 Aufrufen je Minute und Extraktor | aus oder `low`; Modelle, die Thinking nicht abschalten können und über 5 s liegen, scheiden aus | Mindestpräfix erreichbar (512 Token bei Haiku 5.5, Sonnet 5.5, Opus 5.5; 4.096 bei Haiku 4.5) | erzwingbar, nativ oder per Tool-Use |
| Resolver | so, dass p95 gesamt ≤ 20 s hält (ADR 0003 Nachtrag 2026-10-23); bei Opus-Klasse (10 bis 13 s) nur, wenn die Eskalationsrate unter 5 % liegt | je Aufruf frei, zählt in die Minute | `low` | wie oben | wie oben |
| Richter, Zweitlabel | – | – | – | – | andere Modellfamilie als der Extraktor (ADR 0003) |

Kandidaten nach der Kostenresearch (#31): Haiku 4.5 (Baseline), Sonnet 5.5 `low` mit Cache, Haiku 5.5 nur wenn Thinking abschaltbar ist; Opus 5.5 nur als Resolver.

## 8. Parameter mit Startwerten

| Parameter | Startwert | Bedeutung | Quelle |
|---|---|---|---|
| `tick_seconds` | 5 | Redezeit je Tick | ADR 0002 |
| `turn_pause_end_seconds` | 3 | Pause, die einen Turn beendet | ADR 0004, Startwert |
| `turn_max_seconds` | 180 | Höchstlänge eines Turns | ADR 0004, Startwert |
| `interjection_max_seconds` | 2 | Einwurf mit Überlappung, der den Turn nicht beendet | ADR 0004, Startwert |
| `context_turns` | 2 | Kontext-Turns der Stufe 1 | ADR 0004 |
| `context_token_cap` | 600 | Deckel der Kontext-Turns | ADR 0004 |
| `claim_list_cap` | 100 | Deckel der Behauptungsliste | ADR 0004 |
| `resolver_context_turns` | 5 | Kontext-Turns des Resolvers | ADR 0004 |
| `resolver_timeout_seconds` | 12 | danach "nicht aufgelöst" | Startwert |
| `topic_window_seconds` | 60 | Fenster des Topic Extractors | ADR 0004 |
| `verifier_timeout_seconds` | 8 | danach Karte ohne Urteil des Verifiers (fail-open) | Messung #30 |
| `verifier_context_words` | 80 | Kontext des Verifiers aus dem aktuellen Turn | Messung #30 |
| `verifier_previous_turn_words` | 40 | Ende des Vorredners für den Verifier | Messung #30 |
| `schema_retries` | 1 | Wiederholungen bei Schemaverstoß | Startwert |
| `cache_block_breakpoint` | 20 | Turn-Blöcke je Cache-Breakpoint | Anbieter-Doku |

Startwerte werden im Bericht genannt; eine Änderung ist ein Parameter des Laufs, keine stille Anpassung.

## 9. Diagnosemodus

Im Textmodus des Messaufbaus und in manuellen Läufen fordert der Harness `discarded` an, protokolliert jede Resolver-Entscheidung und schreibt je Aufruf: Eingabetoken je Block, Cache-Treffer und -Schreibvorgänge, Ausgabetoken, Thinking-Token, Latenz, Modell und Adapter. Im Produkt wird `discarded` nicht angefordert.

## 10. Variablen des Vergleichsprototyps

Eine Pipeline, eine Baseline aus den Standardwerten, je Lauf ein umgelegter Schalter.

| Variable | Baseline | Weitere Werte | Was sie zeigt |
|---|---|---|---|
| Einheit | kumulativer Turn in Blöcken | neuestes Segment plus Fenster von 20 Segmenten, gleicher Prompt | ob ADR 0002 den verbesserten alten Weg schlägt |
| Modell Stufe 1 | Haiku 4.5 | Sonnet 5.5 `low` mit Cache; Haiku 5.5, falls Thinking abschaltbar | Qualität gegen Kosten und Latenz |
| Eskalation | an, Resolver Sonnet 5.5 `low` | aus; Resolver Opus 5.5 `low` | Eskalationsrate, Recall-Gewinn, Preis in p95 |
| Kontext N | 2 | 1, 4 | ob mehr Nachbartext hilft oder stört |
| Behauptungsliste | je Gespräch, Deckel 100 | je Turn (ADR 0002 wörtlich) | Dubletten über Turns hinweg |
| Themen-Fenster | 60 s | 0 s, 180 s | nur mitgeschrieben |
| Turn-Parameter | Startwerte aus Abschnitt 8 | nur bei Befund im Audiomodus | Turn-Bildung |

**Immer berichtet**, zusätzlich zu den Zahlen des Messaufbaus: Eskalationsrate (Candidates je 100 Claims), Anteil der Candidates je Grund und Ausgang (Claim, none, Timeout), Schema-Fehlerrate je Adapter, übersprungene Ticks, Dubletten über Turns hinweg, `repeatOf`-Treffer, Cache-Trefferquote, Thinking-Token je Aufruf, Länge der `discarded`-Liste je Teil des Golden Sets.

**Reihenfolge:** Baseline in beiden Modi auf Golden Set Version 1 (Praxistest, Schwellen prüfen), dann je ein Schalter: Modell Stufe 1, Einheit, Eskalation, Kontext N, Behauptungsliste, Themen-Fenster. Die Entscheidung fällt auf Golden Set Version 2 (ADR 0003).

**Tag eins des Prototyps:** per Models-API prüfen, ob Haiku 5.5 Thinking abschalten kann; mit `count_tokens` die Token je Wort Deutsch für beide Tokenizer an einem echten Transkriptausschnitt messen (die Kostenresearch rechnet mit 1,6 und 2,1).

## 11. Offen

- Modelle für Version 1 entschieden (Abschnitt 1, ADR 0004, Nachtrag 2026-10-25); Nachmessung am Bedrock-EU-Endpunkt vor den ersten Gesprächsdaten (ADR 0006, Nachtrag 2026-10-25) und auf Golden Set Version 2 (#25).
- Themenwechsel-Vortor und Topic-Labels: "Topic und Vorrecherche" (#24).
- Vortor für Behauptungen: nur mit Auslöser aus ADR 0004.
- Zusammenfassung je Sprecher: erst bei Turns über 5 Minuten.
- Schutz gegen Prompt-Injection, der mit dem stabilen Präfix verträglich ist: Sicherheitsentscheidung.
- Verhalten bei Diarisierungsfehlern, die einen Turn falsch teilen oder verschmelzen: Befund aus dem Audiomodus abwarten.
