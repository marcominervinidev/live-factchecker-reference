# 0006: Anbieter und Plattformen: Claude über Bedrock EU, Gemini als Messfamilie, Brave als Standard, Deepgram mit Schranke

Die Modelle der Erkennung und der Prüfung laufen als Claude über **Amazon Bedrock mit dem EU-Inferenzprofil** (Standard; null Aufbewahrung für Haiku, Sonnet und Opus; JSON-Schema über ein erzwungenes Tool), **Google Vertex `eu`** ist Ausweichweg hinter demselben Adapter und wird ohne neue Entscheidung gewählt, wenn die gemessene Schema-Fehlerrate auf Bedrock zu hoch liegt. Die Anthropic-API direkt fällt für Gesprächsdaten, weil sie keinen EU-Endpunkt hat. **Richter und Zweitlabel** des Messaufbaus laufen als **Gemini über Vertex in Frankfurt**, die zweite Modellfamilie nach ADR 0003. Websuche ist **Brave als Standard**, SearXNG fällt; **Google Fact Check Claim Search** bleibt live ohne Cache; **Wikipedia und Wikidata** bleiben mit User-Agent und Budget; nach außen geht nur der Behauptungssatz hinter der Namensmaske aus ADR 0002. **Deepgram Nova-3 EU** bleibt die Spracherkennung (ADR 0005) mit einer Schranke: Vor dem Launch liegt schriftlich vor, dass am EU-Endpunkt weder Audio noch Transkript gespeichert wird, sonst wechselt das Produkt auf AssemblyAI. **Jev fällt** (kein EU-Endpunkt, kein Vortor nach ADR 0004). Das **Embedding-Modell** ist verschoben an "Topic und Vorrecherche" mit der Anforderung EU-Verarbeitung. Die konkreten Modelle je Rolle fallen nach Messung: Erkennung im Vergleichsprototyp, Prüfung mit Startwerten bis zu einem eigenen Messaufbau. Marco hat das am 2026-10-12 entschieden.

Status: accepted. Quelle: Wayfinder-Ticket "Anbieterentscheidungen für das Produkt bestätigen oder kippen" (marcominervinidev/live-factchecker-plan#12); Research "Modellfamilien mit EU-Inferenz" (#33), "Spracherkennung und Diarisierung" (#34), "Klassifikator-Optionen" (#32), "Quellen-Landschaft" (#23), "Rechtslage" (#6). Spezifikation: `docs/spec/anbieter.md`. Schaubild: https://claude.ai/artifact/4sQFzjcWN7Qsihdj7ANmt7 (Kopie: docs/schaubilder/012-anbieter-und-plattformen.html). Zu den ADRs des alten Repos: 0007 (Jev mit LLM-Fallback) gekippt; 0023 (Brave Opt-in) wird Standard; 0016 (Deepgram) bestätigt mit Schranke; 0012 (Embeddings) verschoben.

## Considered Options

- **Anthropic-API direkt:** `inference_geo` kennt nur `global` und `us`; Gesprächsdaten verließen die EU. Verworfen für Gesprächsdaten; für Werkzeuge ohne Gesprächsdaten nicht betroffen.
- **Vertex `eu` als Standard für Claude:** hat Structured Outputs, aber nur Multiregion, und Google hält Ein- und Ausgaben bis 24 Stunden im Speicher, das muss aktiv abgeschaltet werden; Bedrock hat null Aufbewahrung als Standard. Verworfen als Standard, gewählt als Ausweichweg; der Vergleichsprototyp misst die Schema-Fehlerrate je Adapter, das ist der Schalter.
- **Beide Plattformen gleichwertig hinter dem Adapter ohne Standard:** verdoppelt Konten und Messläufe. Verworfen.
- **SearXNG als Standard** (altes Repo bis zum Vergleich auf 34 Claims): reicht die Anfragen an Google und Bing weiter, wird dort als Bot behandelt und bekommt CAPTCHAs; spart keinen Datenschutz. Verworfen.
- **Perplexity Search statt Brave:** gleicher Preis, Nicht-Speicherung im Standardplan dokumentiert, Verarbeitungsort nicht genannt, nicht gebaut. Verworfen für den Start; bleibt Kandidat für einen zweiten Adapter.
- **Google Fact Check mit Cache:** Die Google-API-Bedingungen verbieten Kopien über den Cache-Header hinaus. Verworfen; die CORRECTIV-Lücke (seit 2026-04-02 nicht mehr in ClaimReview) füllt ein eigener Index aus Feed und RSS in "Topic und Vorrecherche".
- **AssemblyAI statt Deepgram jetzt:** 34 % günstiger, Zero Retention belegt, aber nur gegen Mocks getestet; Deepgram-Adapter ist echt getestet (ADR 0005). Verworfen; AssemblyAI ist der Wechselpfad, falls Deepgram den Beleg zur Aufbewahrung nicht liefert.
- **GPT über Azure Data Zone EU als Messfamilie:** striktes Schema, aber Quota-Tier, Antrag für den Verzicht auf Abuse-Monitoring-Speicherung, Data Zone kann Norwegen und die Schweiz einschließen. Verworfen zugunsten von Gemini, das regional in Frankfurt läuft und das Konto mit dem Vertex-Ausweichweg teilt.
- **Mistral oder offenes Modell bei Scaleway als Messfamilie:** billiger, Richterqualität ungemessen, α-Schwelle unbewiesen. Verworfen für den Start; offenes Modell bleibt Option für ein billiges Zweitlabel über Version 2.
- **Drei Familien** (Claude, Gemini, GPT) für Extraktor, Richter und Zweitlabel: drei Konten, drei Verträge; ADR 0003 verlangt nur eine andere Familie als der Extraktor. Verworfen.
- **Gemini-Developer-API** (vorhandener Schlüssel) für die Messrollen: keine EU-Residenz. Zulässig nur als Übergang für die Labels von Golden Set Version 1, weil dort nur Sendungen und Podcasts ohne private Sprecher liegen; nicht für den Richter im Messlauf und nichts, was Gesprächsdaten berührt.
- **Modelle der Prüfung jetzt festlegen:** kein Messaufbau für die Prüfung vorhanden. Verworfen; Startwerte und Budget stehen in der Spezifikation, die Wahl fällt in einem eigenen Ticket.
- **Embedding-Modell jetzt entscheiden:** im ersten Inkrement ohne Bedarf (Erkennung reines LLM, Dedup über die Behauptungsliste). Verschoben.

## Consequences

- Konten, die das Produkt braucht: AWS (Bedrock, EU-Regionen), Google Cloud (Vertex Frankfurt, Gemini, Claude-Ausweichweg), Brave Search API, Deepgram, Google Fact Check API-Key; Wikimedia nur User-Agent. Betriebsmodell (#15) und Sicherheit (#22) regeln Schlüssel und Rotation.
- Der Provider-Adapter für Claude kennt zwei Transportwege (Bedrock, Vertex) und erzwingt das Schema je Weg anders (Tool-Use, Structured Outputs); die Schema-Fehlerrate wird je Weg berichtet (Spezifikation Modellrollen 4.2).
- Die Latenzschwelle p95 ≤ 5 s je Aufruf (ADR 0004) wird am Bedrock-EU-Endpunkt gemessen; der Vergleichsprototyp beginnt dort, nicht an der Anthropic-API.
- Der Messaufbau (ADR 0003) bekommt seine Messfamilie: Richter nach Kalibrierung (45 von 50 Paaren) als Gemini 3.1 Pro oder 3.8 Flash, Zweitlabel Gemini 3.8 Flash, über Vertex Frankfurt mit abgeschaltetem 24-h-Cache.
- Vor dem Launch: schriftlicher Beleg zur Aufbewahrung bei Deepgram (DPA oder Zusage); fehlt er, zweiter STT-Mitschnitt mit AssemblyAI und Wechsel. Das Datenschutzmodell (#11) führt die Schranke.
- Ob im Modus "Gespräch" überhaupt nach außen gesucht wird (Brave, Google Fact Check, Wikimedia), entscheidet das Datenschutzmodell (#11); die Namensmaske aus ADR 0002 ist Voraussetzung jeder Anfrage nach außen.
- Das Fenster "Qualitäts- und Eval-Strategie" im Nebel der Map bekommt ein scharfes Ticket: Messaufbau der Prüfung (Benchmarks X-Fact, deutscher ClaimReview-Korpus), das die Modelle der Prüfung wählt.
- Die Preisannahme für Claude auf Bedrock und Vertex ist Listenpreis plus 10 %, aus der Anthropic-Doku, nicht von den Partner-Preisseiten; die erste Rechnung des Vergleichsprototyps prüft sie.
- Die Gemini-Preise bis 2026-12-31 (0,75 / 3,75 USD je MTok) verdoppeln sich danach; die Messläufe bleiben davon klein, aber die Spezifikation trägt beide Preise.

## Nachtrag 2026-10-15: Übergang für den Vergleichsprototyp

- Solange die Konten für Bedrock EU und Google Cloud nicht stehen, läuft der Vergleichsprototyp (#30) samt Richter und Zweitlabel an der **Anthropic-API direkt** und an der **Gemini-Developer-API**. Das ist zulässig, weil Golden Set Version 1 nur Sendungen und Podcasts ohne private Sprecher enthält (Option "Gemini-Developer-API" oben); Gesprächsdaten privater Personen berührt der Lauf nicht.
- Folge: Die Latenz p95 je Aufruf und die Schema-Fehlerrate je Weg aus diesem Lauf sind vorläufig. Bevor ein Modell je Rolle festgelegt wird, werden beide am Bedrock-EU-Endpunkt nachgemessen; bis dahin gilt die Modellwahl aus dem Prototyp unter Vorbehalt.
- Die Entscheidung oben bleibt: Das Produkt läuft für Gesprächsdaten über Bedrock EU mit Vertex `eu` als Ausweichweg; der Übergang gilt nur für Messläufe auf Golden Set Version 1.
- Marco hat das am 2026-10-15 entschieden.

## Nachtrag 2026-10-25: Anthropic-API direkt in Inkrement 1, Bedrock vor den ersten Gesprächsdaten

Marco hat am 2026-10-25 entschieden: Erst muss die Pipeline als Ganzes laufen, dann kommt die Plattform. Inkrement 1 baut die Erkennung in TypeScript mit einem Modell-Adapter für die **Anthropic-API direkt**, wie der Vergleichsprototyp. Zulässig aus demselben Grund wie im Nachtrag vom 2026-10-15: Inkrement 1 verarbeitet nur das Golden Set (Sendungen und Podcasts ohne private Sprecher) im Textmodus, keine Gesprächsdaten.

- Bedrock EU (erzwungenes Tool für das Schema) kommt als eigenes Ticket in Inkrement 2 und ist gebaut und am EU-Endpunkt nachgemessen (Latenz p95 je Aufruf, Schema-Fehlerrate), **bevor** der erste Input über Mikrofon oder Audio-Naht Gesprächsdaten in die Erkennung bringt. Vertex `eu` bleibt Ausweichweg und wird erst gebaut, wenn die Schema-Fehlerrate auf Bedrock zu hoch liegt.
- Der Adapter wird so geschnitten, dass Bedrock dahinter passt: Schema, Tokens und Kosten je Aufruf sind Sache des Adapters, nicht der Rollen.
- Die Entscheidung oben bleibt: Gesprächsdaten laufen über Bedrock EU.
