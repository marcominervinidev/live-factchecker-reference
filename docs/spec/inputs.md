# Spezifikation: Inputs, Audio-Naht und Segment-Naht

Stand 2026-10-12. Entscheidungen stehen in ADR 0005; dieses Dokument legt fest, welche Inputs es gibt, welches Format an den zwei Nähten gilt, wie der Live-Vertrag, der Segment-Vertrag und der STT-Mitschnitt aussehen und was je Teststufe geprüft wird, damit das Backend im Repo `live-factchecker-v2` ohne Rückfrage gebaut werden kann. Begriffe nach `CONTEXT.md` (Input, Segment, Turn, Tick, Speaker, Setting, Session). Messbegriffe (Golden Set, Audiomodus, Textmodus, Referenz-Transkript) stehen in `docs/spec/messaufbau-erkennung.md`. Audio-Naht, Segment-Naht, STT-Mitschnitt und simulierte Uhr sind Begriffe dieser Spezifikation, nicht des Glossars.

## 1. Inputs

| Input | Naht | Uhr | Wer nutzt ihn | Wann |
|---|---|---|---|---|
| Datei | Audio | Wanduhr, 1,0 × Echtzeit | Kommandozeile, Harness, Betreiber; Pfad auf der Platte, kein Upload | erstes Inkrement, zuerst |
| STT-Mitschnitt | Segment | simuliert | Harness: Audiomodus beschleunigt (Qualität, Kosten), CI-Fixture | erstes Inkrement |
| Referenz-Transkript | Segment | simuliert | Harness: Textmodus | erstes Inkrement |
| Mock-STT | Segment oder Audio (zählt nur Bytes) | simuliert | CI, synthetisches Set | erstes Inkrement |
| Mikrofon | Audio | Wanduhr | Clients per WebSocket | mit dem Frontend |
| Spracherkennung auf dem Gerät | Segment | Wanduhr | Gerätemodus | nach den Store-Apps, eigenes Ticket (ADR 0010, `docs/spec/clients.md` 11) |
| Sender-Livestream | Audio | Wanduhr | Server-Ingestion | später, Abschnitt 8 |
| Datei-Upload für Kunden | Audio | Wanduhr | Web-App, die die Datei über den Live-Vertrag abspielt | nach dem Launch; Regel in ADR 0009 (nur Modus Gespräch, nie Sendungsmitschnitte), Umsetzung ADR 0010 (`docs/spec/clients.md` 12) |

Kein Input: URL, YouTube, Mediathek. Sendungen holen die Werkzeuge in `evals/tools/` (MediathekViewWeb plus ffmpeg, RSS, yt-dlp von Hand für TV-Duell und Quadrell) und legen Dateien ab; das Backend sieht nur Dateien.

Jeder Input hat kein bekanntes Ende vorauszusetzen: Nichts in der Pipeline braucht eine Gesamtlänge.

## 2. Audio-Naht

- **Format:** PCM16 little-endian, 16 kHz, mono, Blöcke à 100 ms (3.200 Bytes). Ein Format für alle Inputs und alle Anbieter.
- **Dekodieren** ist Sache des Inputs: Der Datei-Input liest alles, was ffmpeg liest (Opus, MP3, M4A, WAV, MP4), und wandelt es in dieses Format; der Live-Input dekodiert die vom Client gemeldete Kodierung (Abschnitt 3).
- **Taktung:** Der Datei-Input schickt Blöcke nach Wanduhr mit 1,0 × Echtzeit; jeder Block hat seinen Sendezeitpunkt aus der Position in der Datei, damit sich keine Drift aufsummiert.
- **Rückstau:** kein Puffern im Backend. Läuft der Sendepuffer zur Spracherkennung über 64 KiB (etwa 2 s Audio), endet der Input mit `overloaded`, statt still Audio zu verlieren (ADR 0015 alt).
- **Audio wird nie gespeichert,** weder auf Platte noch in einem Zwischenspeicher; Transkripttext steht nie im Log (Rechtslage #6).

## 3. Live-Vertrag (Mikrofon)

Übernimmt das Gerüst von ADR 0015 des alten Repos; gebaut wird er mit dem Frontend. Bis dahin sind Claim- und Topic-Ereignisse der Erkennung ein interner Vertrag auf einem Redis-Stream je Session (ADR 0005, Nachtrag 2026-10-25). Anmeldung und Session-Token entscheiden Konten (#13) und Sicherheit (#22).

| Nachricht | Richtung | Inhalt |
|---|---|---|
| `audio.start` | Client → Server | `encoding` (`pcm16` in der Web-App; `opus` in den Store-Apps, ADR 0010), `sampleRate`, `channels`, `language` |
| Binärframes | Client → Server | Audio in der gemeldeten Kodierung; bei `pcm16` nominal 100 ms je Frame, höchstens 8 KiB je Frame |
| `audio.stop` | Client → Server | beendet den Input; Server leert und schließt die Verbindung zur Spracherkennung |
| `audio.started` | Server → Client | Id des Inputs |
| `audio.stopped` | Server → Client | Id und Grund: `client`, `quota_exceeded`, `overloaded`, `provider_error` |

Änderungen gegenüber ADR 0015 alt: Die Kodierung ist ein Feld statt fest PCM16 (PCM16 kostet 256 kbit/s, über Mobilfunk etwa 115 MB je Stunde; Opus läge bei 24 bis 32 kbit/s). Die feste Höchstdauer von 60 Minuten entfällt, weil sie weder zur 90-Minuten-Debatte noch zu einem Input ohne Ende passt; an ihre Stelle tritt das Kontingent je Konto (#13), daher der Grund `quota_exceeded` statt `recording_limit` und `budget_exceeded`.

## 4. Segment-Naht

### 4.1 Vertrag

```json
{
  "schemaVersion": 1,
  "id": "s-0412",
  "sessionId": "5b0e…",
  "speaker": "A",
  "start": 0.12,
  "end": 0.71,
  "finalizedAt": 14.01,
  "language": "de",
  "words": [
    { "w": "die", "start": 0.12, "end": 0.25 },
    { "w": "Mieten", "start": 0.25, "end": 0.71 }
  ]
}
```

Der Vertrag ist das Zod-Schema `Segment` in `packages/contracts/src/segment.ts`; daraus erzeugt ist `packages/contracts/json-schema/segment.schema.json` (ADR 0012). Unbekannte Felder werden abgewiesen; eine Abweisung nennt das Feld.

| Feld | Bedeutung |
|---|---|
| `schemaVersion` | Version des Vertrags, derzeit `1` (ADR 0005, Nachtrag 2026-10-29) |
| `id` | Form `s-` mit 1 bis 15 Ziffern; eindeutig je Session, aufsteigend in der Reihenfolge der Finalisierung |
| `sessionId` | Id der Session, 1 bis 64 Zeichen |
| `speaker` | Sitzungslabel der Diarisierung (`A`, `B`, … `Z`, `AA`, … nach Auftreten, nur Großbuchstaben; nie ein Name, nie ein Anbieterlabel); keine Stimmprofile, kein Wiedererkennen über Sessions, kein Name aus der Stimme (Rechtslage #6). Die Zuordnung zu Namen aus dem Setting entscheidet "Sprecher benennen" (#20); im Textmodus liefert der Input die Zuordnung aus dem Referenz-Transkript mit |
| `start`, `end` | Audiozeit in Sekunden seit Beginn des Inputs, 0 bis 86400: `start` ist der Start des ersten Worts, `end` das Ende des letzten Worts |
| `finalizedAt` | Audiozeit, zu der das Segment final wurde: live die Wanduhr seit Beginn des Inputs, im Replay die Ankunftszeit aus dem Mitschnitt; nie vor `end`, höchstens 86400 |
| `language` | Sprache als Parameter (Messaufbau Abschnitt 8), 1 bis 35 Zeichen |
| `words` | 1 bis 500 Wörter; jedes Wort (`w` höchstens 100 Zeichen, `start`, `end`) mit Start und Ende in Audiozeit, Ende nie vor dem Start; die Startzeiten fallen nicht, Wörter dürfen sich überlappen (Regel 6) |

### 4.2 Regeln

1. Ein Segment gehört zu genau einem Speaker. Der Adapter teilt Anbieterblöcke an jedem Sprecherwechsel nach Wortzeiten.
2. Nur finale Segmente gehen über die Naht in die Pipeline. Vorläufige Hypothesen gehen über einen eigenen Kanal nur an die Anzeige des Live-Transkripts und sind nicht Teil dieses Vertrags.
3. Ein Segment ändert sich nach dem Senden nicht mehr (Spezifikation Modellrollen, Abschnitt 2).
4. Takt und Latenz rechnen nur mit Audiozeit und `finalizedAt`; damit verhalten sich Live und Replay gleich.
5. Der Vertrag hat kein Feld für Überlappung; die Turn-Bildung bestimmt sie aus `start` und `end` (ADR 0005, Nachtrag 2026-10-25).
6. Die Wörter eines Segments stehen nach ihrem Start geordnet: kein Wort beginnt vor dem Wort davor. Die Inputs sortieren die Wörter eines Segments stabil nach Start, bevor sie `start` und `end` ableiten (ADR 0005, Nachtrag 2026-10-29).

## 5. STT-Mitschnitt

- **Inhalt:** jedes Rohereignis des Anbieters (bei Deepgram jedes `Results`-Ereignis, final und vorläufig, sowie Metadaten) mit seiner Ankunftszeit relativ zum Beginn des Inputs; im Kopf Anbieter, Modell, alle Parameter (Abschnitt 6), Adapter-unabhängige Version, Ausschnitt, Datum.
- **Nicht** die fertigen Segmente: Der Adapter läuft beim Replay, damit eine Änderung am Adapter keine neue Aufnahme braucht.
- **Aufnahme:** Datei-Input mit 1,0 × Echtzeit durch die echte Spracherkennung; ein Mitschnitt je Ausschnitt, Anbieter und Konfiguration.
- **Replay:** Ein Input liest den Mitschnitt, lässt den Adapter laufen und gibt Segmente mit simulierter Uhr an die Segment-Naht, so schnell die Pipeline sie nimmt.
- **Ablage:** `evals/golden/<slug>/mitschnitt/<anbieter>-<konfiguration>.jsonl` im Repo `live-factchecker-v2`, privat wie der Korpus.
- **Schwankung der Spracherkennung:** wird nicht je Lauf gezogen; die Latenz-Läufe auf drei festen Ausschnitten gehen in jedem Lauf live durch die Spracherkennung (Messaufbau 4.2).
- Für das Golden Set (#25) ist der erste Deepgram-Mitschnitt zugleich die Quelle des Transkript-Entwurfs (`transcript.json`, Messaufbau 2.3).

Aufwand über Golden Set Version 1 (95 Minuten): eine Aufnahme dauert 95 Minuten und kostet bei Deepgram etwa 0,65 USD; ohne Mitschnitt kosteten die ersten 21 Audiomodus-Läufe mindestens 27 Stunden Wanduhr.

## 6. Spracherkennung im ersten Schritt

Deepgram Nova-3, Deutsch, über `api.eu.deepgram.com`. Startwerte aus ADR 0016 des alten Repos, Änderung ist ein Parameter des Laufs:

| Parameter | Startwert |
|---|---|
| `model` | `nova-3` |
| `language` | `de` |
| `diarize` | `true` (im Stream Diarizer v1) |
| `interim_results` | `true` |
| `endpointing` | 300 ms (Doku empfiehlt 300 bis 500 ms für Gespräche) |
| `utterance_end_ms` | 1000 |
| `mip_opt_out` | `true` |

Preis Streaming mit Diarisierung: 0,0048 + 0,0020 = 0,0068 USD je Minute (Aktionspreis, Research #34). Höchsttempo im Stream: 1,25 × Echtzeit. Offen: Aufbewahrung von Audio und Transkript (Datenschutzmodell #11, Anbieterentscheidungen #12).

## 7. Teststufen

| Stufe | Test | Was hineingeht | Was geprüft wird |
|---|---|---|---|
| 1, jeder Push | Segment-Naht, synthetisches Set | Mock-STT gibt die Segmente aus dem Skript aus; Mock-Extraktoren | Turn-Bildung, Tick, Dedup, Zuschreibung, Bericht (Messaufbau 6) |
| 1, jeder Push | Segment-Naht, Mitschnitt-Fixture | ein Zeitfenster (30 bis 60 s) aus einem echten Deepgram-Mitschnitt eines Golden-Set-Ausschnitts mit Sprecherwechsel mitten im Block, als Verweis (ADR 0005, Nachtrag 2026-10-25); Replay | Teilung an Sprecherwechseln, `finalizedAt`, simulierte Uhr, Latenzrechnung |
| 1, jeder Push | Audio-Naht, Datei | je eine WAV- und eine Opus-Datei von 5 s; Mock-STT zählt Bytes; simulierte Uhr | PCM16 16 kHz mono, 3.200 Bytes je 100 ms, Taktung 1,0 ×, Stopp bei Rückstau |
| 2, nachts, Budgetdeckel | Deepgram-Probe | die drei festen Latenz-Ausschnitte live durch Deepgram (etwa 13 Minuten, 0,09 USD) | Latenz bis final; Segmente gegen den letzten Mitschnitt; Erreichbarkeit und Schlüssel |
| 3, von Hand | Mitschnitte, Messläufe | ganzes Golden Set; Messläufe mit echten Modellen (#30) | alle Zahlen aus ADR 0003 |

Nie bei jedem Push: echte Spracherkennung, echte Modelle. Der Deepgram-Schlüssel liegt nur im nächtlichen Job.

## 8. Sender-Livestream (später)

Nicht im ersten Inkrement. Damit er später ohne Umbau kommt, gilt schon jetzt:

1. Ein Input hat kein bekanntes Ende; nichts setzt eine Gesamtlänge voraus.
2. Eine Session kann ohne verbundenen Client laufen, vom Server gestartet; Karten gehen auch an Zuschauer, die später dazukommen (Betriebsmodell #15).
3. Das Setting kann aus Programmdaten kommen statt vom Nutzer; wie genau, entscheidet "Sprecher benennen" (#20).

## 9. Offen

- Opus im Live-Vertrag: entschieden in ADR 0010 (Web-App `pcm16`, Store-Apps `opus`).
- Datei-Upload als Kundenfunktion: Regel in ADR 0009, Umsetzung in ADR 0010 (Web-App spielt die Datei über den Live-Vertrag ab), nach dem Launch.
- Aufbewahrung bei Deepgram: Datenschutzmodell (#11), Anbieterentscheidungen (#12).
- Vergleich mit AssemblyAI per zweitem Mitschnitt: Option für Anbieterentscheidungen (#12).
- Qualität der Diarisierung auf deutschen Gesprächen: erst der STT-Verlust im Audiomodus zeigt sie (Messaufbau 4.4).
