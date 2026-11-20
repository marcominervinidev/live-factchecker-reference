# Architekturbild

Zweck: das Bild, das die ADRs zusammen ergeben; kein neues Wort, nur Verweise. Jede Aussage trägt ihre Quelle in Klammern (ADR-Nummer oder Spezifikationsdatei mit Abschnitt). Begriffe nach `CONTEXT.md`; was dort nicht steht, ist hier auch kein Bauteil.

Stand: 2026-11-05, aus ADR 0002 bis 0010, 0012 und 0013 samt der Nachträge zu ADR 0003, 0004, 0005 und 0006, und den Spezifikationen `docs/spec/inputs.md`, `erkennung-modellrollen.md`, `topic-vorrecherche.md`, `sprecher.md`, `datenschutz.md`, `clients.md`, `anbieter.md`. ADR 0001 (Neubau) und ADR 0011 (Arbeitssystem) beschreiben kein Bauteil und kommen im Bild nicht vor.

Pflegeregel: Wer ein ADR schreibt oder einen Nachtrag macht, zieht dieses Bild im selben Commit nach (Knoten, Kanten, Tabellen, Stand). Wo die ADRs schweigen, steht "offen" mit Ticketnummer; gestrichelte Knoten sind offene Entscheidungen, durchgezogene sind entschieden.

## 1. Komponenten

```mermaid
flowchart TB
  classDef offen stroke-dasharray: 6 4,stroke:#b45309,fill:#fff7ed
  classDef aussen fill:#f1f5f9,stroke:#475569
  subgraph clients["Clients: eine React-Codebasis (ADR 0010)"]
    web["Web-App im Browser<br/>Inkrement 1, Tab-Audio am Desktop"]
    store["Store-Apps iOS und Android<br/>Capacitor-Hülle, Inkrement 2, Playback Capture auf Android"]
    ingest["Server-Ingestion<br/>kopfloser Client, ffmpeg, Dienstanmeldung, später"]
    device["Gerätemodus: STT und Diarisierung auf dem Gerät<br/>nach den Store-Apps, eigenes Ticket (ADR 0010)"]
  end
  class device offen
  ws["Live-Vertrag (WebSocket)<br/>audio.start, Binärframes, audio.stop, audio.stopped (inputs.md 3)"]
  web -->|"Audio pcm16"| ws
  store -->|"Audio opus"| ws
  ingest -->|"Audio pcm16 oder opus"| ws
  subgraph eingang["Eingang: zwei Nähte (ADR 0005)"]
    audioseam["Audio-Naht<br/>PCM16 LE, 16 kHz, mono, Blöcke à 100 ms, kein Puffern"]
    stt["Spracherkennung mit Diarisierung<br/>Deepgram Nova-3, EU-Endpunkt, Schranke vor Launch (ADR 0005, 0006)"]
    segseam["Segment-Naht<br/>finale Segmente, ein Speaker je Segment, Wortzeiten, finalizedAt<br/>Vertrag Segment, schemaVersion 1 (inputs.md 4, ADR 0005 Nachtrag 2026-10-29)"]
    fileinput["Datei-Input, intern<br/>1,0 x Echtzeit, Wanduhr"]
    replay["STT-Mitschnitt, Referenz-Transkript, Mock-STT<br/>simulierte Uhr, Harness (inputs.md 1, 5)"]
  end
  ws -->|"Audio, dekodiert"| audioseam
  fileinput -->|"Audio PCM16"| audioseam
  audioseam -->|"Audio PCM16, nie gespeichert"| stt
  stt -->|"Rohereignisse, Adapter teilt an Sprecherwechseln"| segseam
  replay -->|"Segmente"| segseam
  device -.->|"Segmente, Segment-Vertrag wird dann öffentlich"| segseam
  subgraph erkennung["Erkennung (ADR 0002, 0004, 0008)"]
    turn["Turn-Bildung und Tick<br/>alle 5 s Redezeit und am Turn-Ende (erkennung-modellrollen.md 2)"]
    ce["Claim Extractor, Stufe 1<br/>jeder Tick, Haiku 5.5 Prompt v2, Privatfilter Regel 8 (ADR 0004, 0009)"]
    res["Resolver, Stufe 2<br/>außerhalb des Ticks, nur Candidates, Sonnet 5.5"]
    pruefstufe["Verifier (Prüfstufe)<br/>je Behauptung vor der Karte, Sonnet 5.5, fail-open (ADR 0004 Nachtrag 2026-10-25)"]
    te["Topic Extractor<br/>jeder Tick, Tag-Liste, Fenster 60 s (ADR 0004)"]
    sm["Speaker Mapper<br/>außerhalb des Ticks, Zuordnungstabelle je Session, Haiku-Klasse (ADR 0008)"]
  end
  segseam -->|"Segmente, im Modus Sendung ohne Labels ohne Attribution"| turn
  turn -->|"kumulativer Turn in Blöcken, 2 Kontext-Turns"| ce
  turn -->|"Neues seit der letzten Analyse"| te
  segseam -->|"neues Label, Anrede, Vorstellung"| sm
  sm -->|"Zuordnungstabelle, Prompt-Block 1a"| ce
  ce -->|"Candidates mit Grund"| res
  ce -->|"Claims"| pruefstufe
  res -->|"Claim"| pruefstufe
  karten["Karten (Cards) je Session<br/>Claim sofort, Verdict oder Assessment nachgereicht, attribution.changed zieht nach (ADR 0002, 0008)"]
  pruefstufe -->|"prüfwürdige Claims; verworfene nur im Protokoll"| karten
  sm -->|"attribution.changed"| karten
  karten -->|"Karten, Kanal wird mit dem Frontend gebaut (ADR 0005, #57)"| clients
  subgraph pruefung["Prüfung (Startwerte anbieter.md 2, Budget unter 0,05 USD und 30 s ab Karte)"]
    queue["Warteschlange nach Prüfwürdigkeit<br/>hoch: Check, niedrig: Assessment (ADR 0002)"]
    sq["Suchanfragen<br/>Startwert Sonnet 5.5"]
    rel["Relevanz der Belege<br/>Startwert Sonnet 5.5"]
    urteil["Urteil (Verdict)<br/>fünf Werte, Konfidenz, Feld generated, Startwert Opus 5.5"]
    assess["Einschätzung (Assessment)<br/>ohne Belege, hochstufbar, Startwert Haiku 4.5"]
    erkl["Erklärung auf der Karte<br/>Startwert Haiku 4.5"]
    pv["Prüfvertrag: Verdict, Evidence, Card, Konfidenz, Warteschlange, Degradation<br/>offen, #62"]
  end
  class pv offen
  karten -->|"Claim mit Prüfwürdigkeit"| queue
  queue -->|"Claim hoch"| sq
  queue -->|"Claim niedrig"| assess
  sq --> rel --> urteil --> erkl
  erkl -->|"Verdict mit Evidence"| karten
  assess -->|"Assessment, als solches markiert"| karten

  subgraph speicher["Speicher (ADR 0007, 0009)"]
    pipe["Pipeline-Redis ohne Platte, EU<br/>Transkript, Claims, Urteile, Zuordnungstabelle, Topic-Liste, 15 min nach letztem Segment"]
    es["Belegspeicher (Evidence Store) je Session<br/>Redis ohne Platte, Topic-Tags, Session plus 15 min, nie Transkript"]
    si["Gemeinsamer Index (Shared Index)<br/>ClaimReview-Feed, RSS, amtliche Tabellen, Redis mit Platte bis zum Datenmodell"]
    cache["Urteilscache<br/>nur Modus Sendung, 7 Tage, Redis mit Platte neben dem Index (ADR 0009)"]
    pg["Konto-Datenbank Postgres EU<br/>Konto, Consent Record, Nutzungszähler, Verlauf (ADR 0009)"]
    konten["Konten und Kontingent (ADR 0013)<br/>Konto = Mandant, eine Berechtigung je Konto, Minuten hart, Prüfungen weich<br/>Anmeldung Cognito Frankfurt, Web-Abo Stripe Managed Payments"]
    betrieb["Betriebsmodell: Hosting, Redis-Instanzen, Logs 30 Tage, Backups<br/>offen, #56"]
  end
  class betrieb offen
  erkennung -->|"Transkript, Claims, Zuordnungstabelle, Topic-Liste"| pipe
  urteil -->|"Urteile"| pipe
  es -->|"Belege nach Topic-Tag und Stichwort"| rel
  si -->|"Faktencheck-Treffer, live"| rel
  urteil -->|"Verdict, maskierter Satz als Schlüssel"| cache
  cache -->|"Treffer"| queue
  clients -->|"Setting, Bestätigung des Dialogs"| pg
  karten -->|"Verlauf auf Wunsch, Karten ohne Transkript"| pg

  prefetch["Prefetch (Vorrecherche)<br/>beim Setting und je neuem Topic, ein Haiku-Aufruf je Topic (ADR 0007)"]
  job["Nachführungsjob<br/>nachts Feed und Tabellen, stündlich RSS (topic-vorrecherche.md 5)"]
  te -->|"neues Topic"| prefetch
  prefetch -->|"Belege"| es
  si -->|"Index-Treffer"| prefetch
  job --> si

  grenze["Grenze nach außen<br/>Namensmaske, Privatfilter, Feldliste je Empfänger, immer vom Backend (ADR 0009, datenschutz.md 4)"]
  egress["Egress-Allowlist, Schlüssel, Rotation, Prompt-Injection-Schutz<br/>offen, #59"]
  class egress offen
  sq -->|"Suchanfragen aus dem maskierten Satz"| grenze
  prefetch -->|"Stichworte, Entitäten, Tabellen-Ids, maskiert"| grenze
  grenze -->|"Belege"| rel
  egress -.- grenze

  subgraph aussen["Außen (ADR 0006)"]
    bedrock["Claude über Bedrock EU, Standard<br/>Vertex eu als Ausweichweg hinter demselben Adapter"]
    brave["Brave Search (USA)<br/>Websuche, zuletzt in der Reihenfolge"]
    gfc["Google Fact Check Claim Search<br/>live, ohne Cache"]
    wiki["Wikipedia, Wikidata<br/>bis zur Anwaltsantwort nur Stichworte"]
    amt["Amtliche Quellen: Eurostat, GENESIS, Bundesbank, DIP, abgeordnetenwatch (EU)"]
  end
  class bedrock,brave,gfc,wiki,amt aussen
  erkennung -->|"Prompts ohne Konto und Session-Id"| bedrock
  pruefung -->|"Prompts ohne Konto und Session-Id"| bedrock
  grenze --> brave
  grenze --> gfc
  grenze --> wiki
  grenze --> amt
```

Lesehilfe: Der Speaker Mapper, der Resolver und der Prefetch-Aufruf laufen außerhalb des Ticks; im Tick laufen nur Claim Extractor und Topic Extractor, je ein Aufruf, ohne Vortor (ADR 0004). Die Namensmaske sitzt an der Grenze nach außen, nicht im Prompt; die Prompts der Erkennung sehen die Namen aus dem Setting in beiden Modi (ADR 0002, erkennung-modellrollen.md 3). Richter und Zweitlabel des Messaufbaus (Gemini über Vertex Frankfurt, ADR 0003, 0006) sind Werkzeuge des Harness und kein Bauteil des Produkts. Die Verträge an den Nähten sind Zod-Schemas in `packages/contracts`; der Harness liest nur das daraus erzeugte JSON Schema (ADR 0012).

## 2. Datenfluss einer Conversation

```mermaid
sequenceDiagram
  autonumber
  participant U as User und Client
  participant B as Backend (Session)
  participant D as Deepgram EU
  participant E as Erkennung
  participant P as Prüfung
  participant A as Außen, hinter der Grenze
  participant R as Redis ohne Platte
  participant K as Postgres EU

  U->>B: Setting, Modus ist Pflicht, Sprecher und Topic freiwillig (ADR 0007, topic-vorrecherche.md 1)
  B->>A: Prefetch je öffentlichem Sprecher und für das Anfangs-Topic, maskiert (ADR 0007)
  A-->>R: Belege in den Belegspeicher, mit Topic-Tags
  B->>U: Consent-Dialog je Modus, Text und Version aus dem Backend (ADR 0009, datenschutz.md 1.1)
  U->>B: Bestätigung, Schalter Ansage
  B->>K: Consent Record ohne Inhalt, 3 Jahre (datenschutz.md 1.2)
  U->>B: audio.start mit encoding, sampleRate, language (inputs.md 3)
  B-->>U: audio.started mit Input-Id
  loop solange der Input offen ist, Aufnahmeanzeige sichtbar
    U->>B: Binärframes, 100 ms
    B->>D: PCM16 16 kHz mono über die Audio-Naht, nie gespeichert (ADR 0005)
    D-->>B: Rohereignisse, der Adapter teilt an Sprecherwechseln
    B->>E: finale Segmente über die Segment-Naht (inputs.md 4)
    E->>R: Transkript, Turns, Topic-Liste, Zuordnungstabelle
  end
  Note over E: Tick alle 5 s Redezeit des aktuellen Speakers und einmal am Turn-Ende (ADR 0002, 0004)
  E->>E: Claim Extractor und Topic Extractor, je ein Aufruf, laufender Aufruf überspringt den Tick
  opt Candidate
    E->>E: Resolver außerhalb des Ticks, Claim oder none, none wird nie gezeigt (ADR 0004)
    E->>E: Verifier je Claim vor der Karte, verworfene nur im Protokoll, fail-open (ADR 0004 Nachtrag 2026-10-25)
  end
  E-->>U: Karte mit Claim, sinngemäß plus Wortlaut, Name nur bei sicherer Attribution (ADR 0002, 0008)
  E->>P: Claim mit Prüfwürdigkeit in die Warteschlange (ADR 0002)
  alt Prüfwürdigkeit hoch
    P->>R: Belegspeicher nach Topic-Tag und Stichwort, dann gemeinsamer Index (topic-vorrecherche.md 6)
    P->>A: Suchanfragen aus dem maskierten Satz an Google Fact Check, Wikimedia, zuletzt Brave (ADR 0009)
    A-->>P: Belege
    P->>P: Relevanz, Urteil, Erklärung (anbieter.md 2)
    P-->>U: Verdict mit Evidence auf dieselbe Karte, innerhalb 30 s ab Karte (ADR 0002, CONTEXT.md Check)
  else Prüfwürdigkeit niedrig
    P-->>U: Assessment ohne Belege, als solches markiert, hochstufbar (ADR 0002)
  end
  opt Topic Extractor meldet ein neues Topic
    E->>A: Prefetch, Abkühlzeit 10 min je Topic (ADR 0007)
  end
  U->>B: audio.stop oder Ende des Gesprächs
  opt Gespräch behalten, bis 15 min nach dem Ende
    B->>K: Verlauf: Karten ohne Transkript, Wortlaut nur öffentlicher Speaker (datenschutz.md 3)
  end
  Note over R: 15 min nach dem letzten finalen Segment sind Transkript, Claims, Urteile, Belege und Zuordnungstabelle weg (ADR 0009)
```

Latenzbudget: p95 vom Ende des letzten Worts der Behauptung bis zur Karte ≤ 20 s (ADR 0003 Nachtrag 2026-10-23, vorher 15 s); Stufe 1 p95 ≤ 5 s je Aufruf (ADR 0004); die 30 s der Prüfung zählen ab Karte (ADR 0002).

## 3. Zustände einer Session

Kein ADR beschreibt die Session als Zustandsautomat; das Bild ist aus den Nachrichten des Live-Vertrags (inputs.md 3), den Regeln während des Gesprächs (datenschutz.md 1.3), der Unterbrechung (clients.md 4) und der Löschfrist (ADR 0009) abgeleitet. Die Session ist der technische Träger, die Conversation die Bedeutung (CONTEXT.md).

```mermaid
stateDiagram-v2
  angelegt : angelegt, Session-Id, Setting mit Modus
  consent : Consent, Dialog je Modus offen
  aktiv : aktiv, Input offen, Aufnahmeanzeige sichtbar
  unterbrochen : unterbrochen, Session lebt, kein Input offen
  beendet : beendet, Karten 15 min lesbar, Verlauf wählbar
  geloescht : gelöscht

  [*] --> angelegt : Client verbindet, Setting (ADR 0007)
  angelegt --> consent : Dialog angezeigt, ohne Bestätigung kein Input (datenschutz.md 1.1)
  consent --> beendet : Abbrechen
  consent --> aktiv : bestätigt, Consent Record geschrieben, audio.start (inputs.md 3)
  aktiv --> aktiv : Speaker ausnehmen, Umbenennen, Bestätigen (datenschutz.md 1.3, sprecher.md 3)
  aktiv --> unterbrochen : audio.stop durch Pause, Mikrofonverlust, Reconnect, Anruf (clients.md 4)
  aktiv --> unterbrochen : audio.stopped mit overloaded oder provider_error (inputs.md 2, 3)
  unterbrochen --> aktiv : Weiter, neuer Input in derselben Session (ADR 0010)
  aktiv --> beendet : audio.stopped mit quota_exceeded, Minuten des Kontos aufgebraucht, kein Weiter (ADR 0013)
  aktiv --> beendet : User beendet das Gespräch
  unterbrochen --> beendet : kein Weiter
  beendet --> geloescht : 15 min nach dem letzten finalen Segment, TTL je Schlüssel (ADR 0009)
  unterbrochen --> geloescht : dieselbe TTL läuft weiter, abgeleitet aus datenschutz.md 2
  geloescht --> [*]
```

Nach `quota_exceeded` gibt es kein "Weiter" bis zum nächsten Abrechnungszeitraum; ein `audio.start` mit Rest null bekommt dieselbe Antwort. Der Rand des Backends prüft bei jedem Verbindungsaufbau und bei jedem `audio.start`, also auch bei jedem "Weiter", das Token und die Konto-Zeile in Postgres (ADR 0013).

Was in keinem Dokument steht und deshalb offen ist: ob eine unterbrochene Session vor Ablauf der TTL ein eigenes Ende meldet, und wie eine Session ohne verbundenen Client für den Sender-Livestream läuft (inputs.md 8, Betriebsmodell #56).

## 4. Was lebt wo

| Komponente | Zustand | Aufbewahrung | Quelle |
|---|---|---|---|
| Audio | flüchtig, Durchlauf zur Audio-Naht und zu Deepgram EU | nie gespeichert, auch nicht im Zwischenspeicher | ADR 0005, ADR 0009, inputs.md 2 |
| Transkript, Claims, Urteile, Zuordnungstabelle, Topic-Liste einer Session | Redis ohne Platte (appendonly no, save '', tmpfs), EU | 15 min nach dem letzten finalen Segment | ADR 0009, datenschutz.md 2 |
| Belegspeicher (Evidence Store) | Redis ohne Platte, Schlüssel je Session | Session plus 15 min | ADR 0007, topic-vorrecherche.md 5 |
| Gemeinsamer Index (Shared Index) | Redis mit Platte, eigene Instanz, bis das Datenmodell entscheidet | dauerhaft, Einträge mit Abrufzeit und Quelle | ADR 0007, topic-vorrecherche.md 5 |
| Urteilscache | Redis mit Platte neben dem Index | 7 Tage je Eintrag, nur Modus Sendung, Löschpfad nach Behauptungstext | ADR 0009, datenschutz.md 6 |
| Consent Record | Postgres EU | 3 Jahre ab Bestätigung, überlebt die Kontolöschung | ADR 0009, datenschutz.md 1.2 |
| Nutzungszähler | Postgres EU | laufender Abrechnungszeitraum plus 1 Jahr | datenschutz.md 2 |
| Konto mit Berechtigung (Kennung `sub` von Cognito, Status, Zeitraum, Quelle, Kunden-Id bei Stripe) | Postgres EU | bis "Konto löschen" | ADR 0013 |
| Rechnungen, Zahlungsdaten | beim Verkäufer Stripe (Managed Payments), nicht in der Kontodatenbank | 10 Jahre | ADR 0009, ADR 0013, datenschutz.md 2 |
| Verlauf (History) | Postgres EU, je Konto | nur auf Wunsch je Gespräch, bis der User löscht | ADR 0009, datenschutz.md 3 |
| Anmeldung, Einstellungen, Setting-Vorlagen | Gerät, nur lokal | bis der User sie löscht, nie zum Konto | ADR 0010, clients.md 6 |
| Logs, Metriken und Traces | Betrieb, EU | 30 Tage, nie Transkripttext, Behauptungssatz, Namen | ADR 0009 (Nachtrag 2026-11-04 für Traces), datenschutz.md 2 |
| Backups | nur Kontodatenbank, verschlüsselt, EU | 30 Tage; Pipeline-Redis und Belegspeicher ohne Backup | ADR 0009 |

## 5. Offen

| Was | Ticket |
|---|---|
| Prüfvertrag: Verdict, Evidence, Card, Konfidenz, Warteschlange, Degradation; damit auch der Kartenkanal zum Client | #62 |
| Messaufbau der Prüfung: Modelle je Rolle, Abruf Stichwort gegen Embeddings, Prefetch-Trefferquote, Urteilscache bleibt oder fällt | #60 |
| Store-Abos: Abgleich mit der Berechtigung des Kontos, Eigenbau oder RevenueCat, doppeltes Abo in Web und Store | #176, Inkrement 2 (ADR 0013) |
| Tarifzahlen (Minuten, Prüfungen, Probezeit), Nachkauf, Schwelle der Warnung vor dem Stopp | #177, nach #60 (ADR 0013) |
| Dienstanmeldung und Kontingent je Dienst-Id der Ingestion: entschieden, nicht gebaut | mit dem ersten Partner (ADR 0013) |
| Haushalt und Team über Konten | Nebel, kein Ticket (ADR 0013) |
| Betriebsmodell: Hosting, die zwei Redis-Instanzen, Logs, Backups, Schlüsselablage, Session ohne verbundenen Client | #56 |
| Sicherheitsarchitektur: Egress-Allowlist, Schlüssel und Rotation, Prompt-Injection-Schutz, der mit dem stabilen Präfix verträglich ist | #59 |
| Live-Ansicht und Karte: Plakette, Umbenennen, Bestätigen, Teilen, Topic-Zeitleiste, Dialog, Pause, Speaker ausnehmen; Gäste lesen per Link mit (ADR 0013) | #57 |
| Nachmessung der Erkennung am Bedrock-EU-Endpunkt vor den ersten Gesprächsdaten; Modellwahl auf Golden Set Version 2 | Inkrement 2 (ADR 0006 Nachtrag 2026-10-25), #88 |
| Anwaltliche Prüfung und DSFA vor dem Launch, Deepgram-Schranke, Store-Ausnahmen; Erstattung beim Löschen mit laufendem Abo, Kündigungsbutton beim Verkäufermodell (ADR 0013) | #61 |
| Datenmodell: Ablage des gemeinsamen Index | Nebel, kein Ticket |
| Sender-Livestream, Programmdaten-Adapter, Setting aus Programmdaten | Nebel (inputs.md 8, sprecher.md 7) |
| Gerätemodus auf dem Smartphone, Desktop nativ mit Systemton, iOS-Tonabgriff | nach den Store-Apps, eigenes Ticket (ADR 0010, clients.md 13) |
| Session-Zustandsautomat, Live-Vertrag jenseits der Audio-Nachrichten, darin die erste Nachricht mit dem Access-Token, der Rest vor dem Start und die Warnung bei wenigen Restminuten (ADR 0013) | kein Ticket; der Live-Vertrag wird mit dem Frontend gebaut (ADR 0005) |
