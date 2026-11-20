# Spezifikation: Sprecher benennen

Stand 2026-10-12. Entscheidungen stehen in ADR 0008; dieses Dokument legt fest, wie das Setting Sprecher beschreibt, wie der Speaker Mapper die Attributionen einer Session führt, wann eine Attribution sicher ist, was bei einer Änderung geschieht, was die Behauptung und die Karte tragen und wie das gemessen wird. Begriffe nach `CONTEXT.md` (Speaker, Setting, Attribution, Speaker Mapper, Segment, Turn, Claim, Card). Das Setting als Ganzes steht in `docs/spec/topic-vorrecherche.md`, Abschnitt 1; hier nur die Sprecherfelder.

## 1. Sprecher im Setting

```json
{
  "speakers": [
    { "id": "sp-1", "name": "Friedrich Merz", "role": "guest", "public": true, "source": "user" },
    { "id": "sp-2", "name": "Markus Lanz", "role": "moderator", "public": true, "source": "programme" },
    { "id": "sp-3", "name": null, "role": "private", "public": false, "source": "user" }
  ]
}
```

| Feld | Werte | Regel |
|---|---|---|
| `role` | `moderator`, `host`, `guest`, `private` | `private` auch in Sendungen (Anruferin, Publikum) |
| `public` | bool | Standard: Modus Sendung und Rolle nicht `private` → `true`; Modus Gespräch → `false`; Nutzer kann je Sprecher umschalten. `true` erlaubt den Namen nach außen (Namensmaske, ADR 0002) und löst den Sprecher-Prefetch aus (ADR 0007) |
| `source` | `user`, `programme` | woher der Eintrag stammt; `programme` erst mit dem Programmdaten-Adapter (Abschnitt 7) |
| `name` | Text oder null | ohne Namen zeigt die Karte die Rolle ("die Anruferin") |

## 2. Zuordnungstabelle

Je Session eine Tabelle, geführt vom Speaker Mapper:

```json
{
  "sessionId": "5b0e…",
  "attributions": [
    { "label": "A", "speakerId": "sp-1", "certainty": "certain", "sources": ["setting", "address"], "since": 42.1, "note": "Lanz: 'Herr Merz, Sie haben …' bei 38 s, A antwortet" },
    { "label": "B", "speakerId": "sp-2", "certainty": "certain", "sources": ["setting", "address"], "since": 12.4, "note": "Merz: 'Herr Lanz, …' bei 9 s, B antwortet" },
    { "label": "C", "speakerId": null, "certainty": "none", "sources": [], "since": 311.4, "note": "drittes Label, Setting kennt nur zwei Sprecher" }
  ]
}
```

| Feld | Werte | Regel |
|---|---|---|
| `certainty` | `certain`, `probable`, `none` | Abschnitt 4 |
| `sources` | `setting`, `address`, `programme`, `user`; später erweiterbar | jede Quelle höchstens einmal; `user` allein macht sicher |
| `since` | Audiozeit | ab wann die Attribution gilt; Karten davor werden beim Nachziehen geprüft |
| `note` | Text | Begründung des Mappers, für Diagnose und Richter |

Labels werden nie über Sessions hinweg wiedererkannt; die Tabelle stirbt mit der Session.

## 3. Speaker Mapper

| | Regel |
|---|---|
| Auslöser | neues Label in einem finalen Segment; Anrede, Vorstellung oder Moderationsansage im Transkript (erkannt durch den Claim Extractor als Nebenausgabe `addressCues`, oder durch Stichwortmuster "Herr", "Frau", "ich bin", "bei mir ist", "zu Gast"); Setting-Änderung; Nutzereingriff (Umbenennen, Bestätigen, Verwerfen, Antwort auf die Rückfrage); Label-Revision des Anbieters |
| Eingabe | Setting (Sprecher), aktuelle Tabelle, die letzten fünf Turns mit Labels und Wortlaut, das auslösende Ereignis |
| Ausgabe | neue Tabelle mit `note` je Änderung; keine Behauptungen |
| Modell | Haiku-Klasse, `thinking` aus, Plattform nach ADR 0006; Timeout 8 s, dann bleibt die Tabelle unverändert |
| Takt | außerhalb des Ticks, ein Aufruf je Auslöser, Entprellung 10 s je Label |
| Regeln an das Modell | Quellen nur aus der Liste; eine Quelle allein ergibt `probable`; zwei unabhängige Quellen oder `user` ergeben `certain`; ein Label, das sich mit einem schon sicher zugeordneten Sprecher überschneiden würde, bleibt `none` mit Begründung; nie aus Stimme, Tonfall, Akzent, Geschlecht schließen |

Der Nutzereingriff läuft nicht durch das Modell: Umbenennen und ein Name aus der Rückfrage (Abschnitt 8) setzen `speakerId`, `certainty: certain`, `sources: ["user"]`; Verwerfen setzt `none`; "Sprecher ausnehmen" setzt `excluded: true`, worauf das Backend Segmente dieses Labels vor der Erkennung verwirft und seine Behauptungen und Karten löscht (ADR 0009, Spezifikation Datenschutz 1.3).

## 4. Sicherheitsstufen

| Stufe | Bedingung | Wirkung |
|---|---|---|
| `certain` | Nutzerangabe (Umbenennen, Bestätigen, Name aus der Rückfrage) oder zwei unabhängige Quellen (Anrede plus Setting, Vorstellung plus Programmdaten) | Name in Behauptung und auf der Karte; Name nach außen nur bei `public: true` |
| `probable` | eine Quelle allein | Behauptung trägt das Label; Karte zeigt "Sprecher B, vermutlich Alice Weidel" mit Bestätigen; nichts mit diesem Namen nach außen |
| `none` | keine Quelle | Behauptung und Karte tragen das Label; Rolle, falls aus dem Setting ableitbar |

## 5. Änderung einer Attribution

1. Der Mapper schreibt die neue Tabelle und veröffentlicht `attribution.changed { sessionId, label, from, to, certainty, since }`.
2. Das Backend zieht alle Behauptungen und Karten der Session mit diesem Label nach: `speaker`, `speakerSource`, `speakerCertainty` werden neu gesetzt, die Karte zeigt den neuen Stand.
3. Eine Prüfung, die bereits mit einem Namen nach außen ging, wird nicht wiederholt; die Karte trägt den neuen Namen, das Protokoll den alten.
4. Kippt eine Attribution von `certain` auf `none` oder zu einem anderen Sprecher, zählt das im Bericht als Zuschreibungsfehler für alle davon betroffenen Behauptungen.

## 6. Behauptung und Karte

Ergänzte Felder der Behauptung (Spezifikation Modellrollen 4.1 wird nachgeführt):

| Feld | Werte |
|---|---|
| `speaker` | Name bei `certain`, sonst Label |
| `speakerLabel` | Diarisierungslabel |
| `speakerSource` | `setting`, `address`, `programme`, `user`, `none`, kombiniert als Liste |
| `speakerCertainty` | `certain`, `probable`, `none` |
| `sentence` | Paraphrase, auf der Karte immer mit "sinngemäß" |
| `verbatim` | Wortlaut, auf der Karte immer sichtbar |

Karte: Name oder Label, Plakette mit Quelle ("Rahmen", "Anrede", "Programm", "von dir", "nicht zugeordnet", "vermutlich …"), Umbenennen am Label mit einmaligem Hinweis "Du trägst die Verantwortung, dass die Zuordnung stimmt", Bestätigen bei `probable`. Teilen und Export: private Namen (`public: false`) durch das Label ersetzt, Kennzeichnung "automatisch erzeugt, nicht redaktionell geprüft". Gestaltung im Prototyp Live-Ansicht (#16).

Der Claim Extractor bekommt die Zuordnungstabelle als Block zwischen Präfix und Behauptungsliste (Spezifikation Modellrollen 3, neuer Block 1a, ändert sich je Attribution) und darf Sprechernamen nur aus ihr setzen; ein Label ohne `certain` erscheint in `speaker` als Label.

## 7. Programmdaten-Adapter (später)

Nicht im ersten Inkrement. Liest Titel, Datum und Beschreibung einer Sendung (etwa MediathekViewWeb), lässt ein Modell Gästeliste mit Rollen extrahieren, schlägt sie als Sprecher mit `source: programme` vor; der Nutzer bestätigt. Wikidata-Abgleich als Vorschlag für `public`. Sender-Untertitel sind keine Produktquelle.

## 8. Nebensprecher

Ein Label ohne Attribution in einem Setting, das keinen weiteren Sprecher kennt (Modus Sendung im Wohnzimmer: Research #40, Trennung über das Mikrofon nicht belegt), erscheint als "Sprecher C" mit `none`. Entschieden in ADR 0009: Im Modus Sendung werden Segmente von Labels ohne Attribution bis zu einer Frist (Startwert 30 s) zurückgehalten; bekommt das Label in der Frist eine Attribution, gehen sie in die Erkennung, sonst werden sie vor der Erkennung verworfen und gezählt, es entsteht keine Karte (ADR 0009, Nachtrag 2026-10-27); im Modus Gespräch bleibt "Sprecher C" mit Karte.

**Rückfrage** (ADR 0009, Nachtrag 2026-10-28; nur Modus Sendung über das Mikrofon, nicht beim Kanalabgriff): Solange Segmente eines Labels zurückgehalten werden, fragt die App am Label "Sprecher B: wer ist das?". Auswahl: die Namen der Sprecher aus dem Setting und "Niemand aus der Sendung / ausnehmen".

| Antwort | Wirkung |
|---|---|
| Name in der Frist | Nutzerzuordnung: `speakerId`, `certainty: certain`, `sources: ["user"]` (Abschnitt 3); die zurückgehaltenen Segmente gehen in Zeitfolge in die Erkennung |
| "Niemand aus der Sendung / ausnehmen" | zurückgehaltene Segmente sofort verworfen und gezählt; das Label wird ausgenommen (`excluded: true`, Abschnitt 3) |
| keine Antwort in der Frist | verworfen und gezählt wie oben; die Rückfrage verschwindet |

Die Rückfrage verlängert die Frist nicht. Im Harness beantwortet niemand die Rückfrage; der Messbericht weist deshalb Recall und Latenz zweimal aus, ohne ADR 0009 und mit ADR 0009 ohne Antwort (Messaufbau, Abschnitt 5). Gestaltung in der Live-Ansicht (#16). Der Kanalabgriff des Sendungstons ist Anforderung an die Clients (#10).

## 9. Messung

| Zahl | Definition | Wo |
|---|---|---|
| Zuschreibung | Treffer mit richtigem Sprecher geteilt durch Treffer, nur Behauptungen mit `certain`; Schwelle ≥ 0,95 (ADR 0003) | Audiomodus |
| Anteil vermutlich und keine | Behauptungen je Sicherheitsstufe geteilt durch alle | Diagnose |
| Trefferquote vermutlich | Anteil der `probable`, die laut Referenz richtig gewesen wären | Diagnose |
| Zeit bis sicher | Audiozeit vom ersten Segment eines Labels bis `certain` | Diagnose |
| Kippfehler | Attributionen, die von `certain` wegkippen, je Stunde | Diagnose |

Das Referenz-Transkript (Messaufbau 2.3) trägt je Sprecher zusätzlich die Quelle der Zuordnung, die Marco beim Korrigieren genutzt hat (Setting, Anrede, Untertitel), damit der Harness sehen kann, welche Quellen dem Mapper überhaupt zur Verfügung standen.

## 10. Offen

- Kanalabgriff je Plattform: entschieden in ADR 0010 (`docs/spec/clients.md`, Abschnitt 2); Nebensprecher sind in ADR 0009 entschieden.
- Stimmerkennung für Personen des öffentlichen Lebens: Anwaltsfrage 13; die Quellenliste ist dafür erweiterbar.
- Art. 9 für private Mitsprecher, deren Name der Nutzer im Setting einträgt: Anwaltsfrage 2, mit dem Privatfilter als Minderung (ADR 0009).
- Gestaltung von Plakette, Umbenennen, Bestätigen, Rückfrage, Teilen: Prototyp Live-Ansicht (#16).
