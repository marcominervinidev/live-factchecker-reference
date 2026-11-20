# Spezifikation: Datenschutzmodell

Stand 2026-10-15. Entscheidungen stehen in ADR 0009; dieses Dokument legt fest, wie die Einwilligung je Modus abläuft und protokolliert wird, was wo wie lange liegt, welche Felder die Grenze nach außen passieren, wie der Privatfilter lautet, wie der Urteilscache gebaut ist, wie gelöscht wird, wie Urteil und Einschätzung gekennzeichnet werden und was dem Anwalt vorgelegt wird. Begriffe nach `CONTEXT.md` (Consent Record, History, Private Matter, Setting, Speaker, Attribution, Claim, Card, Evidence Store, Shared Index). Rechtsgrundlagen und Fundstellen: Research "Rechtslage" (#6) und "Modi Sendung und Gespräch" (#40).

## 1. Einwilligung je Modus

### 1.1 Dialog

Vor jedem Gespräch, nach dem Setting, vor dem ersten Audio. Bestätigung ist Pflicht in beiden Modi; ohne Bestätigung öffnet der Client keinen Input. Die Texte sind versioniert (`dialogVersion`, Datum); eine Änderung des Textes ist eine neue Version. Die Anbieterliste im Text kommt aus der Konfiguration des Backends, nicht aus dem Client.

**Modus Gespräch (`conversation`), Version 2026-10-15:**

> Alle, die mitsprechen, müssen wissen, dass dieses Gespräch mitgehört und auf Fakten geprüft wird, und damit einverstanden sein. Das Gesetz verlangt die Einwilligung jeder einzelnen Person (§ 201 StGB).
>
> Was passiert: Der Ton geht an Deepgram (EU) zur Verschriftung, Ausschnitte an Claude (AWS, EU) zur Erkennung. Behauptungen gehen ohne Namen privater Personen an Brave, Google Fact Check und Wikipedia (USA). Nichts wird gespeichert; 15 Minuten nach dem Ende ist alles weg. Der Ton wird nie gespeichert.
>
> [Alle sind informiert und einverstanden] [Abbrechen]
> Schalter: Ansage über den Lautsprecher abspielen. Link: Informationen für Gesprächsteilnehmer.

**Modus Sendung (`broadcast`), Version 2026-10-15:**

> Geprüft wird die Sendung. Wer im Raum mitspricht, wird mit erfasst; seine Beiträge werden nicht geprüft und nicht angezeigt. Sag den Anwesenden Bescheid oder nimm den Ton direkt vom Gerät ab.
>
> Was passiert: wie oben; die Namen der Sendungsgäste gehen mit in die Suche.
>
> [Verstanden, starten] [Tonabgriff wählen]

Mit Kanalabgriff (Input `broadcast` über den Sendungston, Clients #10) entfällt der Satz zu den Anwesenden. Im Gerätemodus (Spracherkennung auf dem Gerät) ersetzt "Dein Ton verlässt das Gerät nicht; der Text geht an Claude (AWS, EU)" den ersten Satz unter "Was passiert".

**Ansage** (Schalter, Standard aus): Der Client spricht nach dem Start über den Lautsprecher: "Dieses Gespräch wird mitgehört und auf Fakten geprüft. Informationen unter live-factchecker.de/teilnehmer." Ob sie lief, steht im Consent Record.

### 1.2 Consent Record (Einwilligungsereignis)

```json
{
  "id": "cr-7f3a…",
  "accountId": "acc-…",
  "sessionId": "5b0e…",
  "mode": "conversation",
  "dialogVersion": "2026-10-15",
  "confirmedAt": "2026-10-15T19:02:11Z",
  "speakersInSetting": 3,
  "announcementPlayed": false,
  "inputKind": "microphone",
  "client": "ios-1.0"
}
```

Nie im Record: Namen, Setting-Text, Topic, Transkript, Audio. Ablage: Kontodatenbank (Abschnitt 2), Aufbewahrung drei Jahre ab `confirmedAt` (regelmäßige Verjährung § 195 BGB), getrennt von Inhalten; überlebt die Kontolöschung für diese Frist ohne Verbindung zu einem Verlauf.

### 1.3 Während des Gesprächs

| Element | Regel |
|---|---|
| Aufnahmeanzeige | dauerhaft sichtbar, solange ein Input offen ist (Apple 2.5.14, Google Play Prominent Disclosure) |
| Pause | stoppt den Input; kein Audio verlässt das Gerät; Segmente in der Pipeline laufen aus |
| Sprecher ausnehmen | am Label der Karte oder des Transkripts; ab sofort verwirft das Backend Segmente dieses Labels vor der Erkennung, löscht alle Behauptungen und Karten dieses Labels der Session und entfernt seine Segmente aus dem Transkript auf dem Client; Attribution bleibt mit `excluded: true` (BayLDA-Muster: Widerspruch wirkt ab diesem Zeitpunkt, Erfasstes wird entfernt) |
| Nebensprecher im Modus Sendung | Labels ohne Attribution (Spezifikation Sprecher, Abschnitt 8): Segmente werden bis zu 30 s im Pipeline-Speicher zurückgehalten (`unattributed_hold_seconds`); bekommt das Label in der Frist eine Attribution, gehen sie in die Erkennung, sonst werden sie vor der Erkennung verworfen, nicht im Transkript gezeigt, gezählt (`segments_dropped_unattributed`; ADR 0009, Nachtrag 2026-10-27); Behauptungen entstehen nicht; im Modus Gespräch bleibt "Sprecher C" mit Karte |
| Rückfrage im Modus Sendung über das Mikrofon | solange Segmente eines Labels zurückgehalten werden, fragt die App "Sprecher B: wer ist das?" mit den Namen aus dem Setting und "Niemand aus der Sendung / ausnehmen" (Spezifikation Sprecher, Abschnitt 8); ein Name ist eine Nutzerzuordnung (`certain`, ADR 0008) und gibt die zurückgehaltenen Segmente in der Frist frei; "ausnehmen" verwirft sofort wie "Sprecher ausnehmen"; ohne Antwort wird in der Frist verworfen; Frist und Speicherort wie oben, nichts verlässt das Backend; beim Kanalabgriff keine Rückfrage (ADR 0009, Nachtrag 2026-10-28) |

## 2. Datentabelle: was wo wie lange liegt

| Datum | Zweck | Ort | Dauer | Personenbezug |
|---|---|---|---|---|
| Audio | Transkription | Durchlauf zu Deepgram EU (Audio-Naht) | nie gespeichert | Stimme, Inhalt |
| Transkript, Behauptungen, Urteile, Belege, Zuordnungstabelle, Topic-Liste einer Session | Live-Pipeline, Karten | Redis ohne Platte (`appendonly no`, `save ''`, tmpfs), EU | 15 Minuten nach dem letzten finalen Segment (TTL je Schlüssel, wie ADR 0018 alt; der Stream wird nicht getrimmt, Nachtrag 2026-10-29) | Inhalt, Namen |
| Belegspeicher | Prüfung | Redis ohne Platte | Session + 15 min (ADR 0007) | nur Namen öffentlicher Personen |
| Gemeinsamer Index | Faktencheck-Treffer, Statistik | Datenbank EU | dauerhaft; keine Gesprächsdaten (ADR 0007) | Namen öffentlicher Personen aus Quellen |
| Urteilscache | Kosten, Latenz | Redis mit Platte neben dem Index | 7 Tage je Eintrag; nur Modus Sendung (Abschnitt 5) | Namen öffentlicher Personen im Satz |
| Consent Record | Nachweis | Kontodatenbank EU (Postgres) | 3 Jahre | Konto |
| Nutzungszähler (Minuten, Prüfungen je Konto und Abrechnungszeitraum) | Kontingent, Abrechnung | Kontodatenbank | laufender Abrechnungszeitraum + 1 Jahr | Konto |
| Rechnungen, Zahlungsdaten | Abrechnung | Konten (#13), getrennte Tabellen oder Dienst | 10 Jahre (§ 147 AO) | Konto |
| Verlauf (History) | Nachlesen, Export | Kontodatenbank EU, je Konto | nur auf Wunsch je Gespräch; bis der Nutzer löscht, spätestens mit dem Konto | Inhalt, Namen öffentlicher Personen, Labels |
| Logs, Metriken und Traces | Betrieb | EU | 30 Tage | nie Transkripttext, Behauptungssatz, Namen; Session-IDs ja (Traces: ADR 0009, Nachtrag 2026-11-04) |
| Backups | Wiederherstellung | nur Kontodatenbank, verschlüsselt, EU | 30 Tage | wie Kontodatenbank |

Nie auf Platte: Audio, Transkript, Zuordnungstabelle, Belegspeicher. Nie in Logs und Traces: Transkripttext, Behauptungssätze, Namen, Setting-Text.

**Nachtrag 2026-10-29 (Entscheidung Marco, #27):** Der Segment-Stream einer Session wird nicht getrimmt. Er bleibt ganz und läuft wie jeder Schlüssel der Session mit der TTL ab, 15 Minuten nach dem letzten Segment. Grund: T3 und T4 brauchen den vollständigen Stream einer Session. Die Menge im Redis begrenzen ein Byte-Budget je Session (`SESSION_BYTE_BUDGET`, Standard 3 MiB) und eine Höchstzahl gleichzeitiger Sessions (`MAX_SESSIONS`, Standard 20) unterhalb der Speichergrenze des Redis. Das Budget zählt die JSON-Bytes der Segmente; im Redis belegen sie bis etwa das 1,3-Fache (Overhead der Stream-Einträge, Rundung des Allocators), also 20 × 3 MiB × 1,3 ≈ 78 MB < 96 MB.

## 3. Verlauf (History)

| | Regel |
|---|---|
| Schalter | "Gespräch behalten" je Gespräch, vor dem Start oder bis 15 Minuten nach dem Ende; Standard aus |
| Inhalt je Karte | `sentence` (Paraphrase), `verdict` oder `assessment` mit Konfidenz und Begründung, `evidence` (Quelle, Auszug im Rahmen der Lizenz), `topic`, Audiozeit, `speakerLabel`, `speakerSource`, `speakerCertainty`, `generated` |
| Name und Wortlaut | `speaker` als Name nur bei `public: true` und `certain`; `verbatim` nur bei `public: true`; private Sprecher als Label mit Rolle, ohne Wortlaut (§ 201 Abs. 2, ADR 0008) |
| Nie im Verlauf | Transkript, Segmente, Setting-Text, Zuordnungstabelle, Consent Record |
| Export | Datei (Markdown und JSON) mit Kennzeichnung (Abschnitt 7); private Sprecher als Label |
| Lokaler Verlauf auf dem Gerät | Entscheidung der Clients (#10); die Regel "private Namen nur auf dem Gerät" bleibt |

## 4. Grenze nach außen

Die Stelle im Backend zwischen der Formulierung der Suchanfragen und dem Versand. Gilt in beiden Modi.

| Empfänger | Was passiert | Schranken | Mechanismus |
|---|---|---|---|
| Brave Search | Suchanfragen aus dem Behauptungssatz (1 bis 3), Fallback der Satz selbst | Namensmaske, Privatfilter | DPA mit SCC abschließen; DPF-Listung prüfen (Anwaltsfrage 4) |
| Google Fact Check | Behauptungssatz als Suchbegriff | Namensmaske, Privatfilter | Google LLC DPF-zertifiziert; API-Terms, kein Cache über den Header |
| Wikimedia (Wikipedia, Wikidata) | nur Stichworte und Entitätsnamen öffentlicher Personen, kein Behauptungssatz, bis zur Anwaltsantwort (Frage 3) | Namensmaske, Privatfilter | keiner dokumentiert |
| Amtliche Quellen (Destatis, Eurostat, DIP, Bundesbank, abgeordnetenwatch) | Stichworte, Tabellen-IDs, Namen öffentlicher Personen (Sprecher-Prefetch) | Namensmaske | EU, keine Übermittlung ins Drittland |
| Deepgram EU | Audio (Audio-Naht) | `mip_opt_out=true` erzwungen und getestet | Auftragsverarbeiter, DPA; Schranke vor Launch (ADR 0006) |
| Bedrock EU, Vertex EU | Transkriptausschnitte, Setting mit Namen, Zuordnungstabelle, Behauptungsliste, Belege | Prompt ohne Konto und Session-ID | Auftragsverarbeiter, DPA mit SCC (AWS) beziehungsweise DPF und SCC (Google Cloud) |

**Nie nach außen** (zu eigenständigen Empfängern): Wortlaut (`verbatim`), Transkript, Segmente, Diarisierungslabel, Sprecher-IDs, Session-ID, Konto, Zeitpunkt des Gesprächs, Setting, Topic-Liste als Ganzes, Namen mit `public: false` oder ohne `certain`. Anfragen gehen vom Backend aus (Egress-IP des Hostings), nie vom Gerät; keine Kennung des Nutzers in Headern oder Parametern. Namensmaske: Namen aus dem Setting und aus der Zuordnungstabelle ohne `public: true` und `certain` werden im Satz durch die Rolle ersetzt ("die Anruferin"), bevor Suchanfragen formuliert werden; die Formulierung sieht den maskierten Satz.

## 5. Privatfilter (Private Matter)

Regel 8 der Systemanweisung des Claim Extractors (Spezifikation Modellrollen, Abschnitt 4.3) und des Resolvers:

> Eine Aussage über eine Person, die nicht öffentlich bekannt ist, aus dem Umfeld der Sprecher (Anwesende, Familie, Freunde, Nachbarn, Kollegen) wird keine Behauptung und kein Candidate. Personen des öffentlichen Lebens werden auch bei Privatem geprüft, einschließlich öffentlich bekannter Tatsachen über ihre Familie ("hat drei Töchter"). Was jemand über ein Amt, Abstimmungen oder öffentliche Aussagen sagt, ist nie privat. Was ein Sprecher über sich selbst sagt, ist privat, wenn er nicht öffentlich bekannt ist.

| | Regel |
|---|---|
| Ausgabe | keine Behauptung; der Extractor zählt im Diagnosefeld `dropped.private` je Tick (nur Anzahl) |
| Reihenfolge | vor Resolver, Speaker Mapper-Hinweisen und Prüfung; ein Candidate kann nicht nachträglich privat werden, der Resolver kennt dieselbe Regel |
| Öffentlich bekannt | Sprecher mit `public: true` im Setting; Personen, die das Modell als Personen des öffentlichen Lebens kennt; im Zweifel privat |
| Messung | Golden Set Version 2, Alltagsteil: Labels `privat`; Harness berichtet Privates als Behauptung ausgegeben (Fehlalarm) und Öffentliches als privat verworfen (Verlust), beides Diagnose (#39) |

## 6. Urteilscache

| | Regel |
|---|---|
| Geltung | nur Behauptungen aus Sessions mit `mode: broadcast` |
| Schlüssel | `verdict:v2:<sha256(normalisierter maskierter Satz)>`; Normalisierung wie die Dedup der Erkennung (Zahlen und Negationen bleiben) |
| Wert | Urteil, Konfidenz, Begründung, Belege (Quelle, Auszug, Abrufzeit), `generated`; nie Session, Konto, Label, Zeitpunkt, Setting |
| Dauer | 7 Tage je Eintrag |
| Ort | Redis-Instanz mit Platte neben dem gemeinsamen Index, nicht die Pipeline-Instanz |
| Löschpfad | Werkzeug `cache-forget <Behauptungssatz>`: normalisiert, hasht, löscht; für Art.-17-Ersuchen öffentlicher Personen; Vorgang protokolliert ohne Satz |
| Messung | Trefferquote je Sendung und je Tag im Messaufbau der Prüfung (#39); unter 10 % fällt der Cache |

## 7. Kennzeichnung (Art. 50 AI Act)

| Wo | Was |
|---|---|
| Karte | sichtbar: "automatisch erzeugt, nicht redaktionell geprüft"; Einschätzung zusätzlich "ohne Belege" (ADR 0002) |
| Vertrag Urteil und Einschätzung | Feld `generated: { "system": "live-factchecker", "model": "<Modell-ID>", "promptVersion": "<Version>" }` |
| Export Markdown | Fußzeile mit demselben Inhalt je Datei |
| Export JSON | Feld `generated` je Karte |
| Teilen (HTML) | `<meta name="generator">` und sichtbarer Hinweis; private Sprecher als Label |
| Onboarding | Hinweis "KI-System" vor der ersten Nutzung (Art. 50 Abs. 1) |

Keine Zähler je Sprecher, keine Ranglisten, keine Persönlichkeits- oder Stimmungsbewertung, auch nicht im Verlauf (DSK Muss-Liste Nr. 13 bleibt fern).

## 8. Löschung und Betroffenenrechte

| Wer | Was | Wirkung |
|---|---|---|
| Nutzer | Verlauf eines Gesprächs löschen | sofort aus der Kontodatenbank; aus Backups nach spätestens 30 Tagen |
| Nutzer | Konto löschen | Verlauf und Zähler sofort; Consent Records und Rechnungen bleiben für ihre Fristen ohne Verbindung zu Inhalten |
| Nutzer | Verlauf exportieren | Datei nach Abschnitt 3 (Art. 20) |
| Mitsprecher | Widerspruch während des Gesprächs | "Sprecher ausnehmen" durch den Nutzer (Abschnitt 1.3) |
| Mitsprecher | Auskunft oder Löschung nachträglich | der Anbieter hält nichts, was ihn identifiziert; die öffentliche Datenschutzinformation erklärt das und verweist auf den Nutzer, falls ein Verlauf besteht |
| Öffentliche Person | Löschung im Urteilscache | Löschpfad nach Behauptungstext (Abschnitt 6); gemeinsamer Index enthält nur fremde Veröffentlichungen mit Quelle |
| Datenpanne | Prozess Art. 33, 34 | Sicherheitsarchitektur (#22); ruhende personenbezogene Daten sind nur Verlauf, Consent Records, Konto und Zähler |

## 9. Öffentliche Datenschutzinformation für Gesprächsteilnehmer

Eigene Seite (Art. 14 Abs. 5 lit. b), verlinkt aus Dialog, Ansage und App-Store-Eintrag; Abschnitte nach DSK 3.5.1: Was wird aufgenommen, Empfänger und Länder, Fristen (Abschnitt 2), Rechte und wie sie wirken (Abschnitt 8), Verantwortlicher und Kontakt. Store-Angaben (Clients #10): Audio Data und User Content, Deepgram und AWS als Dienstleister, Brave, Google, Wikimedia als Dritte.

## 10. Gerätemodus und Datei

- Gerätemodus (Segment-Naht, ADR 0005): Versprechen "Dein Ton verlässt das Gerät nicht." Segmente, Setting und Behauptungen gehen wie sonst an das Backend und nach Abschnitt 4 nach außen. Kein weiteres Versprechen.
- Datei-Upload (nach dem Launch): nur `mode: conversation`; Dialog wie 1.1 plus Bestätigung "Diese Aufnahme ist mit Einwilligung aller entstanden"; Sendungsmitschnitte werden nicht angenommen (§ 87 UrhG, Anwaltsfragen 6 und 7); die Datei wird im Durchlauf verarbeitet und nach der Verarbeitung gelöscht, nie als Audio behalten.

## 11. Vorlage für den Anwalt

Dem Task-Ticket "Anwaltliche Prüfung und DSFA vor dem Launch" werden vorgelegt: ADR 0009 und diese Spezifikation, die Dialogtexte (1.1), die Datentabelle (2), die Grenze nach außen (4), die Anbietermatrix (ADR 0006, `docs/spec/anbieter.md`), das Schaubild, und die 13 Fragen aus der Rechtslage mit zwei Präzisierungen: Frage 2 mit dem Privatfilter als technischer Minderung; Frage 3 als "Behauptungssatz ohne Namen privater Personen, vom Backend, ohne Kennungen, an DPF-gelistete Empfänger; Wikimedia nur Stichworte". Ergebnis: Antworten je Frage, DSFA und Verarbeitungsverzeichnis als Dateien in `docs/legal/` des privaten Repos; Deepgram-Schranke (ADR 0006) wird dort abgehakt.

## 12. Offen

- Form der § 201-Einwilligung und das Verwerfen der Nebensprecher, einschließlich der Rückfrage (der Nutzer gibt durch Benennen Segmente einer über das Mikrofon gehörten Person in die Erkennung): Anwaltsfrage 1.
- Art. 9 für private Mitsprecher: Anwaltsfrage 2 mit dem Privatfilter als Minderung.
- Übermittlung maskierter Behauptungssätze, Wikimedia ohne Mechanismus: Anwaltsfrage 3; bis dahin Wikimedia nur Stichworte.
- DPF-Listung von Brave und Deepgram: Anwaltsfrage 4.
- Form der maschinenlesbaren Kennzeichnung: Anwaltsfrage 9.
- Gestaltung von Dialog, Ansage, Pause, "Sprecher ausnehmen", Rückfrage, Verlauf-Schalter, Teilen: Live-Ansicht (#16).
- Kanalabgriff je Plattform, Aufnahmeanzeige, lokaler Verlauf, Store-Angaben: entschieden in ADR 0010, `docs/spec/clients.md` (Abschnitte 2, 5, 6, 8).
