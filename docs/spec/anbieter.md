# Spezifikation: Anbieter, Plattformen und Startmodelle

Stand 2026-10-12. Entscheidungen stehen in ADR 0006; dieses Dokument ist die Anbietermatrix, die das Backend in `live-factchecker-v2` ohne Rückfrage anbinden kann: je Anbieter Endpunkt, Region, Aufbewahrung, Vertrag, Schlüssel, Schranken; je Modellrolle ein Startwert, der nach Messung nachgeführt wird. Begriffe nach `CONTEXT.md`; Messbegriffe (Richter, Zweitlabel, Golden Set) nach `docs/spec/messaufbau-erkennung.md`. Preise sind Listenpreise vom 2026-10-09 (Research #33, #34, #23) und werden mit der ersten echten Rechnung nachgeführt.

## 1. Anbietermatrix

| Anbieter | Rolle | Endpunkt, Region | Aufbewahrung | Vertrag | Status | Schranke |
|---|---|---|---|---|---|---|
| Amazon Bedrock | Claude für Erkennung und Prüfung, **Standard** | Inferenzprofil `eu.`, Konto-Region Frankfurt (`eu-central-1`); acht EU-Regionen im Profil | null für Haiku, Sonnet, Opus; nur Fable 5/5.1 bis 30 Tage mit AWS-Prüfung (nicht verwendet) | AWS GDPR DPA mit SCC; Anthropic sieht keine Inhalte | bleibt | Zugang zu Haiku 5.5, Sonnet 5.5, Opus 5.5 in der Konsole beantragen; Haiku 4.5 sofort |
| Google Vertex AI | Claude als **Ausweichweg**; Gemini als Messfamilie | Claude: Multiregion `eu` (`aiplatform.eu.rep.googleapis.com`); Gemini: `europe-west3` Frankfurt | kein Training; In-Memory-Cache bis 24 h, projektweit abschalten; Abuse-Logging-Ausnahme beantragen | Google Cloud DPA mit DPF und SCC | bleibt | 24-h-Cache vor dem ersten Lauf mit Gesprächsdaten abschalten |
| Anthropic direkt | – | `inference_geo` nur `global`, `us` | – | – | fällt für Gesprächsdaten | Werkzeuge ohne Gesprächsdaten (Skripte, Korpus-Werkzeuge) dürfen sie nutzen |
| Deepgram | Spracherkennung und Diarisierung (ADR 0005) | `api.eu.deepgram.com`, Streaming `wss` | unbelegt (Primärseite 404; Privacy Policy nennt US-Server und Vertrag); `mip_opt_out=true` | Deepgram-Vertrag, DPA zu prüfen | bleibt | **vor dem Launch** schriftlicher Beleg, dass Audio und Transkript am EU-Endpunkt nicht gespeichert werden; sonst Wechsel auf AssemblyAI |
| AssemblyAI | Wechselpfad Spracherkennung | `wss://streaming.eu.assemblyai.com/v3/ws` | Zero Retention im Streaming bei abgewähltem Training | DPA | Option | zweiter STT-Mitschnitt auf Golden Set Version 1 vor dem Wechsel |
| Brave Search API | Websuche, **Standard** | Plan "Search", 5 USD je 1.000 Anfragen, 50 QPS | USA, Query-Log bis 90 Tage, ZDR nur Enterprise | Brave-Vertrag; Speicherrechte nur mit entsprechendem Plan, nichts von Brave wird gespeichert | bleibt | nur hinter der Namensmaske; Einsatz im Modus "Gespräch": Datenschutzmodell (#11) |
| SearXNG | – | – | – | – | fällt | – |
| Perplexity Search | zweiter Suchadapter | 5 USD je 1.000 | Nicht-Speicherung im Standardplan, Ort nicht genannt | – | Option | erst mit Messaufbau der Prüfung |
| Google Fact Check Tools | Claim Search, nur live | `claims:search`, `languageCode=de`, `maxAgeDays`, API-Key | Google, USA | Google-API-Terms: kein Cache über den Header, keine Datenbank | bleibt | nur hinter der Namensmaske; CORRECTIV fehlt seit 2026-04-02, Index aus Feed und RSS in #24 |
| Wikimedia (Wikipedia, Wikidata) | Referenzquelle | REST und SPARQL | – | frei lizenziert | bleibt | User-Agent mit Kontaktadresse; Budget 200 Anfragen je Minute (ohne Anmeldung), SPARQL 5 parallel; Anmeldung erst bei Bedarf |
| Jev (TypeSafe AI) | – | USA, kein EU-Endpunkt | – | – | fällt | Schlüssel entfernen |
| Embedding-Modell | – | – | – | – | verschoben an #24 | Anforderung: Verarbeitung in der EU (Bedrock EU, Mistral EU oder selbst gehostet) |
| Amtliche Quellen (Destatis, Eurostat, Bundesbank, DIP, abgeordnetenwatch) | Belege, Prefetch | je API, Deutschland und EU | – | frei lizenziert, speicherbar | bleiben | Umfang in #24 |

## 2. Modellrollen und Startwerte

Alle Claude-Modelle über die Plattform aus Abschnitt 1 (Bedrock EU, Ausweichweg Vertex). Thinking nie `high`. Preise USD je MTok Input / Output, Listenpreis plus 10 % für EU-Endpunkte (geschätzt).

| Rolle | Startwert | Thinking | Wird entschieden durch | Preisannahme |
|---|---|---|---|---|
| Claim Extractor (Stufe 1) | Haiku 5.5, Prompt v2 (entschieden 2026-10-25, ADR 0004 Nachtrag) | aus | Vergleichsprototyp (#30); Nachmessung am Bedrock-EU-Endpunkt | 1,10 / 5,50 |
| Topic Extractor | wie Stufe 1 | aus | #30 | wie oben |
| Resolver (Stufe 2) | Sonnet 5.5 (entschieden 2026-10-25) | `low` | #30; Opus 5.5 nur bei Eskalationsrate unter 5 % | 2,20 / 11,00 |
| Verifier (Prüfstufe) | Sonnet 5.5, Prompt v2 (entschieden 2026-10-25) | aus | #30, Arm `v2-pruef-sonnet-b` | 2,20 / 11,00 |
| Suchanfragen der Prüfung | Sonnet 5.5 | `low` | Messaufbau der Prüfung (neues Ticket) | 2,20 / 11,00 |
| Relevanz der Belege | Sonnet 5.5 | `low` | Messaufbau der Prüfung | 2,20 / 11,00 |
| Urteil | Opus 5.5 | `low` | Messaufbau der Prüfung | 4,40 / 22,00 |
| Einschätzung (Assessment) | Haiku 4.5, später Haiku 5.5 ohne Thinking | aus | Messaufbau der Prüfung | 1,10 / 5,50 |
| Erklärung auf der Karte | Haiku 4.5 | aus | Messaufbau der Prüfung | 1,10 / 5,50 |
| Label-Vorschlag (Messaufbau 3.3 Schritt 3) | Sonnet 5.5 | `low` | – | 2,20 / 11,00 |
| Richter (Messaufbau 4.3) | Gemini 3.8 Flash; 3.1 Pro, falls die Kalibrierung unter 45 von 50 liegt | – | Kalibrierung je Richter-Version | 0,75 / 3,75 bis 2026-12-31, dann 1,50 / 7,50 |
| Zweitlabel (Messaufbau 3.3 Schritt 5) | Gemini 3.8 Flash | – | Übereinstimmung α wird berichtet, kein Gate | wie Richter |

Budget der Prüfung: unter 0,05 USD und unter 30 Sekunden ab Karte je Behauptung (alter Messwert mit Opus 5: 0,049 USD bei adaptivem Thinking). Budget der Erkennung: ADR 0003 und 0004 (0,063 USD je Gesprächsminute, p95 ≤ 5 s je Aufruf).

## 3. Schema-Erzwingung je Weg

| Weg | Mechanik | Berichtet als |
|---|---|---|
| Bedrock | erzwungenes Tool (`tool_choice` auf das Ausgabe-Tool), Harness validiert gegen das JSON-Schema, eine Wiederholung bei Verstoß | Schema-Fehlerrate je Adapter (Spezifikation Modellrollen 4.2) |
| Vertex (Claude) | Structured Outputs | dito |
| Vertex (Gemini) | `response_format` mit `mime_type: application/json` und Schema; Werte trotzdem validieren | dito |

Schalter: Liegt die Schema-Fehlerrate auf Bedrock in der Baseline des Vergleichsprototyps über der von Vertex um mehr als einen Prozentpunkt, wird Vertex Standard; das ist eine Konfiguration, keine neue Entscheidung (ADR 0006).

## 4. Übergang für Golden Set Version 1

Für Label-Vorschlag und Zweitlabel auf Version 1 (Sendungen und Podcasts, keine privaten Sprecher) dürfen die vorhandenen Schlüssel genutzt werden (Anthropic direkt, Gemini-Developer-API), weil keine Gesprächsdaten privater Personen betroffen sind. Der Richter im Messlauf und jeder Lauf mit Gesprächsdaten laufen über Bedrock EU und Vertex Frankfurt. Übergang (ADR 0006, Nachtrag 2026-10-15): Bis die Konten für Bedrock EU und Google Cloud stehen, laufen auch der Vergleichsprototyp und sein Richter auf Golden Set Version 1 über diese Schlüssel; Latenz p95 und Schema-Fehlerrate werden danach am Bedrock-EU-Endpunkt nachgemessen. Inkrement 1 (ADR 0006, Nachtrag 2026-10-25): Die TypeScript-Pipeline läuft auf dem Golden Set im Textmodus ebenfalls über die Anthropic-API direkt; Bedrock EU wird in Inkrement 2 gebaut und nachgemessen, bevor der erste Input Gesprächsdaten in die Erkennung bringt.

## 5. Schlüssel und Konten

| Konto | Wofür | Wo der Schlüssel liegt |
|---|---|---|
| AWS | Bedrock EU | Betriebsmodell (#15), Sicherheit (#22) |
| Google Cloud | Vertex Frankfurt (Gemini), Vertex `eu` (Claude-Ausweichweg) | dito |
| Deepgram | Spracherkennung | `DEEPGRAM_API_KEY`, heute in Marcos Shell |
| Brave | Websuche | Betriebsmodell |
| Google Fact Check | Claim Search | API-Key, kostenlos |
| Gemini Developer API | nur Übergang für Version-1-Labels | `GEMINI_API_KEY`, heute in Marcos Shell |

Lokale Schlüsselablage nach dem Muster des alten Repos (`<NAME>_FILE`, außerhalb des Repo-Ordners); die Produktionsablage entscheidet das Betriebsmodell.

## 6. Offen

- Beleg zur Aufbewahrung bei Deepgram vor dem Launch (Datenschutzmodell #11).
- Ob im Modus "Gespräch" nach außen gesucht wird (#11).
- Partnerpreise Claude auf Bedrock und Vertex: mit der ersten Rechnung prüfen.
- Modelle der Prüfung: Messaufbau der Prüfung (neues Ticket).
- Embeddings, ClaimReview-Index, Umfang amtlicher Quellen: Topic und Vorrecherche (#24).
