# Spezifikation: Messaufbau der Erkennung

Stand 2026-10-08. Entscheidungen stehen in ADR 0003; dieses Dokument legt fest, wie Korpus, Labels, Messläufe und Bericht aussehen, damit der Task "Testkorpus Gespräche" und der Harness im Repo `live-factchecker-v2` ohne Rückfrage gebaut werden können. Begriffe nach `CONTEXT.md`; Messbegriffe (Golden Set, Referenz-Transkript, Label, Arm, Richter, Treffer) sind hier definiert und gehören nicht ins Glossar.

## 1. Zwei Sets

| | Golden Set | Synthetisches Set |
|---|---|---|
| Material | echte Aufnahmen, Ausschnitte 3 bis 5 min | LLM-Skript mit eingebauten Behauptungen, Audio per Text-to-Speech mit mehreren Stimmen, bewusst eingemischte Überlappungen |
| Umfang | Version 1: 10 bis 20 Ausschnitte; Version 2: siehe Abschnitt 2 | 20 bis 30 kurze Gespräche |
| Labels | von Marco abgenommen, nach Richtlinie, mit Zweitlabel | entstehen beim Bauen aus dem Skript |
| Läuft | manuell oder nächtlich mit echten Modellen und Budgetdeckel | in der CI bei jedem Commit, mit Mock-Extraktoren |
| Beweist | Qualität: Recall, Precision, Zuschreibung, Dubletten, Latenz, Kosten | Mechanik: Turn-Bildung, Fünf-Sekunden-Takt, Dedup, Zuschreibung, Latenzpfad |
| Nie | | Qualitätszahlen |

Ablage in `live-factchecker-v2`: `evals/golden/`, `evals/synthetic/`, Harness unter `evals/src/`, Berichte unter `evals/reports/`. Das Repo bleibt privat, solange der Korpus drin ist.

## 2. Golden Set

### 2.1 Teile, Quellen, Größe

| Teil | Anteil (nach Behauptungen) | Quellen | Abruf | Was der Teil prüft |
|---|---|---|---|---|
| Talkshow | 40 % | Markus Lanz, Maybrit Illner, Maischberger, Hart aber fair, Caren Miosga | MediathekView mit Senderuntertiteln als Labelhilfe | Zielfall: mehrere Gäste mit Namen, Unterbrechungen, Tatsache und Meinung gemischt |
| Debatte | 40 % | TV-Duell und Quadrell zur Bundestagswahl 2025 (externe Recall-Referenz: Faktenchecks von CORRECTIV und ZDFheute); Bundestag Regierungsbefragung und Fragestunde (SRT plus Plenarprotokoll-XML, einzige Quelle mit offizieller Sprecherzuordnung) | MediathekView, yt-dlp, Bundestag-Mediathek | dichte Behauptungen, Zuschreibung, Turn-Bildung bei kurzen Wechseln |
| Alltag | 20 % | Version 1: eine Episode Realitätsabgleich (zwei Sprecher, CC BY-NC-SA), eine Episode Baywatch Berlin (drei Sprecher); Version 2: Gemischtes Hack, Fest & Flauschig, Podcast UFO, Drinnies, media.ccc.de-Live-Podcasts | RSS-Feeds | Negativkontrolle: Fehlalarme je 10 Minuten |

Nicht im Golden Set: eigene Aufnahmen, Forschungskorpora (FOLK, GRAIN, CALLHOME), Debatten-Podcasts, YouTube-Streams (RSS und Mediatheken liefern dasselbe Audio robuster). Begründung in Research #26 und #29.

**Version 1** startet den Harness: 10 bis 20 Ausschnitte à 3 bis 5 Minuten, Alltag mindestens 50 Minuten aus den zwei Episoden oben.
**Version 2** muss stehen, bevor die messbaren Entscheidungen aus "Erkennungseinheit und Modellrollen" fallen: mindestens 100 erwartete Behauptungen je Teil Debatte und Talkshow, aus mindestens vier verschiedenen Sendungen oder Sitzungen je Teil, Alltag mindestens 30 Minuten.

### 2.2 Ausschnitte

- 3 bis 5 Minuten je Ausschnitt, Schnitt an einer Pause oder einem Sprecherwechsel, möglichst hohe Behauptungsdichte (Talkshow, Debatte) beziehungsweise typisches Geplauder (Alltag).
- Audio als Opus, mono, 24 kbit/s, 16 kHz oder höher; Datei im Repo.
- Je Ausschnitt eine Quellenangabe (`source.md`): Sendung oder Podcast, Episode, Datum, URL, Abrufdatum, Zeitbereich im Original, Sprecher mit Rolle (Moderation, Gast, Host) und ob Person des öffentlichen Lebens, Lizenz oder Nutzungsbedingungen, Werkzeug und Version, Untertitel- oder Transkriptquelle als Labelhilfe, Sprache (`de`), Teil (`talkshow`, `debatte`, `alltag`).
- Das Setting je Ausschnitt (Sprecher mit Namen, Anfangs-Topic) liegt in `setting.json` und geht in beiden Modi an die Extraktoren, wie im Produkt.

### 2.3 Referenz-Transkript

`transcript.json`: Liste von Turns, je Turn `speaker`, `start`, `end`, `overlap` (true, wenn gleichzeitig mit einem anderen Turn gesprochen wird), `words` mit `w`, `start`, `end`. Entwurf aus der Spracherkennung des Produkts; korrigiert werden:

1. überall: Sprecherwechsel und Sprechernamen (Namen aus dem Setting, nie aus der Stimme);
2. nur rund um jede gelabelte Behauptung: der Wortlaut, einen Satz davor und danach;
3. Überlappungen werden markiert, nicht herausgeschnitten.

Alles andere bleibt roh. Senderuntertitel, Plenarprotokolle und Podcast-Transkripte sind Labelhilfe, nie Referenz.

## 3. Labels

### 3.1 Schema

`labels.jsonl`, eine Zeile je erwartete Behauptung:

```json
{
  "id": "lanz-2026-09-24-a-07",
  "speaker": "Anna Müller",
  "sentence": "Anna Müller behauptet, dass die Mieten in Berlin seit 2015 um 40 Prozent gestiegen sind.",
  "verbatim": "also die Mieten hier in Berlin, die sind seit 2015 um vierzig Prozent hoch",
  "start": 212.4,
  "end": 219.1,
  "type": "zahl",
  "checkworthiness": "hoch",
  "kind": "tatsache",
  "refersTo": null,
  "overlap": false,
  "repeatOf": null,
  "reviewed": true,
  "note": ""
}
```

| Feld | Werte | Bedeutung |
|---|---|---|
| `sentence` | Text | eigenständiger deutscher Satz mit benanntem Sprecher, immer Paraphrase (ADR 0002) |
| `verbatim` | Text | wörtlicher Ausschnitt aus dem Referenz-Transkript |
| `start`, `end` | Sekunden | Zeitspanne des Wortlauts; Anker für die Zuordnung, unabhängig von der Segmentierung einer Spracherkennung |
| `type` | `zahl`, `ereignis`, `zitat`, `ursache` | Typ nach ADR 0002 (Zahl oder Statistik; Ereignis oder Handlung; Zitat oder Zuschreibung; Ursache und Wirkung) |
| `checkworthiness` | `hoch`, `niedrig` | hoch entspricht ClaimBuster CFS und ViClaim FCW; niedrig entspricht UFS und FNC |
| `kind` | `tatsache`, `widerspruch`, `zustimmung`, `meinung_mit_kern` | Widerspruch und Zustimmung sind Behauptungen des antwortenden Sprechers über denselben Sachverhalt; bei Meinung mit Tatsachenkern wird nur der Kern als Satz formuliert |
| `refersTo` | Label-Id oder null | Pflicht bei Widerspruch und Zustimmung |
| `overlap` | bool | Wortlaut liegt in einem Überlappungs-Turn |
| `repeatOf` | Label-Id oder null | derselbe Sprecher wiederholt eine eigene Behauptung; die Wiederholung wird gelabelt, zählt aber nicht als eigene Erwartung (ein Fund genügt, ein zweiter Fund ist eine Dublette) |
| `reviewed` | bool | nur Marco setzt true; ein Vorschlag ist nie ein Label |
| `note` | Text | Begründung bei Grenzfällen |

Reine Meinungen ohne Tatsachenkern, Prognosen, Versprechen, Appelle und echte Fragen werden nicht gelabelt (ADR 0002 und ClaimBuster NFS, ViClaim OPN). Findet das System dort eine Behauptung, ist das ein Fehlalarm.

### 3.2 Richtlinie (Gerüst)

`evals/golden/RICHTLINIE.md`, versioniert; eine Änderung an Labels ist ein Commit mit Begründung, nie eine stille Korrektur. Inhalt:

1. Definitionen von prüfwürdig, Tatsache ohne Prüfwürdigkeit und Meinung, übersetzt aus ClaimBuster (CFS, UFS, NFS) und ViClaim (FCW, FNC, OPN), mit je fünf deutschen Beispielen aus dem Korpus.
2. Der Satz: eigenständig, benannter Sprecher, Tempus und Zahlen wie gesagt, keine Bewertung; Form "X behauptet, dass …", "X bestreitet, dass …", "X bestätigt, dass …".
3. Eine Behauptung je Sachverhalt; ein Turn kann mehrere tragen; eine Behauptung kann mehrere Segmente umfassen.
4. Widerspruch und Zustimmung: immer labeln, immer mit `refersTo`; "da bin ich anderer Meinung" nach einer Zahl ist ein Widerspruch zur Zahl.
5. Meinung mit Tatsachenkern: nur der Kern wird formuliert.
6. Rhetorische Fragen mit unterstelltem Fakt: labeln; echte Fragen: nicht.
7. Wiederholungen desselben Sprechers: `repeatOf`.
8. Überlappung: labeln, wenn der Wortlaut verständlich ist; `overlap` setzen.
9. Hörfehler der Spracherkennung spielen beim Labeln keine Rolle; gelabelt wird gegen das Referenz-Transkript.
10. Private Sprecher und Gäste ohne öffentliche Rolle: Name nur, wenn er im Setting steht; sonst Rolle ("die Anruferin").

### 3.3 Prozess

1. Spracherkennung liefert den Entwurf des Transkripts mit Wortzeiten und Sprecherlabels.
2. Marco korrigiert nach 2.3.
3. Ein erstes Modell schlägt Labels nach 3.1 vor.
4. Marco korrigiert und setzt `reviewed`.
5. Ein zweites Modell einer anderen Familie labelt dasselbe Material unabhängig; Uneinigkeiten gehen an Marco.
6. Übereinstimmung (Krippendorffs α über hoch, niedrig, kein Label) wird je Korpusversion berichtet; unter 0,6 wird die Richtlinie nachgeschärft. Kein Gate.

## 4. Messlauf

### 4.1 Eingaben

Ein Lauf ist bestimmt durch: Arm (Konfiguration der Erkennung: Einheit, Prompts, Modelle, Kontextregeln), Modus (Audio, Text), Korpusversion, Richtlinienversion, Spracherkennung und Diarisierung samt Version, Sprache, Richter-Modell samt Kalibrierungsergebnis, Datum. Alles steht im Bericht.

### 4.2 Modi

- **Textmodus:** Turns des Referenz-Transkripts werden in Fünf-Sekunden-Schritten Redezeit an die Extraktoren gegeben, kumulativ je Turn wie im Produkt (ADR 0002); Sprecher und Setting liegen vor.
- **Audiomodus:** Audio wird abgespielt, Spracherkennung und Diarisierung laufen wie im Produkt, Segmente werden zu Turns gebildet, die Extraktoren laufen im Takt. Qualität und Kosten im beschleunigten Replay mit simulierter Uhr; Latenz im Echtzeit-Replay auf drei festen Ausschnitten je Lauf (je ein Talkshow-, Debatte- und Alltagsausschnitt). Beschleunigtes Replay heißt: der STT-Mitschnitt des Ausschnitts wird mit simulierter Uhr abgespielt, die Spracherkennung läuft dabei nicht erneut (ADR 0005, `docs/spec/inputs.md` Abschnitt 5). Mit echten Modellen kehrt ein Aufruf auf der simulierten Uhr zu Start plus gemessener Antwortzeit zurück; das nächste Segment kommt erst, wenn alle fälligen Aufrufe zurück sind (ADR 0005, Nachtrag 2026-10-27).

### 4.3 Zuordnung Fund zu Label

1. Kandidatenfilter: gleicher Sprecher; Zeitspanne des Funds (Zeiten seiner Quellsegmente) überlappt die Label-Spanne, Toleranz ±5 s.
2. Richter-Modell (nie das Extraktor-Modell) beantwortet je Kandidatenpaar "derselbe Sachverhalt: ja oder nein" mit beiden Sätzen und beiden Wortlauten als Eingabe.
3. Fund und Label werden je Zählregel ("alle", "nur hoch" und die Gegenrechnung ADR 0009) durch ein maximales bipartites Matching über die "ja"-Paare zugeordnet: ein Fund trifft höchstens ein Label, ein Label zählt höchstens einen Treffer, und die Zahl der getroffenen Labels ist so groß wie möglich, unabhängig von der Ausgabereihenfolge. Zeitliche Nähe (Abstand der Startzeiten von Label und Fund, kleinste Summe) entscheidet nur zwischen gleich großen Matchings, bei gleicher Summe die kleinere Id (als Zeichenkette sortiert) (Owner-Entscheidung 2026-11-03 zu Frage 1 „Zählregel beim Matching“ in #48: „maximales bipartites Matching je Zählregel; zeitliche Nähe nur als zweites Kriterium“). Ein Fund mit "ja", der im Matching kein Label bekommt, ist eine Dublette. Ein Fund ohne "ja" ist ein Fehlalarm, außer er trifft ein Label mit `checkworthiness: niedrig` (zählt als Zusatzausbeute, weder Treffer noch Fehlalarm, wenn die Zählregel "nur hoch" gilt).
4. Kalibrierung je Richter-Version: 50 Kandidatenpaare, von Marco entschieden; das Modell muss mindestens 45 gleich entscheiden, sonst wird die Frage nachgeschärft und erneut geprüft. In Version 1 sieht Marco zusätzlich alle Fälle durch, in denen Richter und Filter uneins wirken (Fund und Label passen zeitlich, Richter sagt nein).

### 4.4 Zahlen

| Zahl | Definition | Schwelle (vorläufig) | Modus | Teil |
|---|---|---|---|---|
| Recall | getroffene Labels geteilt durch Labels; zweimal: nur `hoch`, und `hoch` plus `niedrig`; `repeatOf`-Labels zählen nicht als eigene Erwartung | ≥ 0,75 | Audio | Debatte, Talkshow |
| Precision | Treffer geteilt durch Funde ohne Zusatzausbeute | ≥ 0,80 | Audio | Debatte, Talkshow |
| Fehlalarme je 10 min | Funde ohne Label je 10 Minuten Audio | ≤ 2 | Audio | Alltag |
| Zuschreibung | Treffer mit richtigem Sprecher geteilt durch Treffer | ≥ 0,95 | Audio | alle |
| Latenz p95 | vom Ende des letzten Worts, das zur Behauptung gehört, bis die Karte ausgegeben ist; gezählt werden nur Treffer, also Karten, die ein Label treffen (ein Fehlalarm hat kein solches Wort); p95 über alle Karten wird als Zusatzzahl berichtet (Marco, 2026-10-16) | ≤ 20 s (Marco, 2026-10-23, ADR 0003 Nachtrag; vorher ≤ 15 s) | Audio, Echtzeit | alle |
| Kosten | USD je Gesprächsminute, beide Extraktoren, aus den gemeldeten Token | ≤ 0,063 | Audio | alle |
| Dubletten | Funde, die ein schon getroffenes Label erneut treffen, geteilt durch alle Funde | ≤ 10 % | Audio | alle |
| Treue | Richter: Wortlaut des Funds stützt seinen Satz; Anteil ja | ≥ 0,95 (Diagnose) | Text | alle |
| STT-Verlust | Treffer im Textmodus, die im Audiomodus fehlen, je Teil | Diagnose | beide | alle |
| Übereinstimmung | α zwischen Marcos Labels und Zweitlabel | Diagnose | Labels | alle |

Je Arm drei Läufe; der Bericht zeigt Median und Spanne, Schwellen werden am Median beurteilt. Die Schwellen gelten als vorläufig bis zum Ende des ersten Praxistests (alle Arme auf Golden Set Version 1); eine Änderung ist eine Entscheidung mit Begründung im Bericht.

## 5. Bericht

`evals/reports/<datum>-<arm>-<modus>.md` plus `.json` mit den Rohdaten. Aufbau:

1. Kopf: alle Eingaben aus 4.1, Kalibrierungsergebnis des Richters.
2. Tabelle je Teil (Talkshow, Debatte, Alltag) und gesamt: alle Zahlen aus 4.4, Median und Spanne über die drei Läufe, Schwelle daneben, erfüllt oder nicht.
3. STT-Verlust je Teil mit den betroffenen Label-Ids.
4. Listen: verpasste Labels, Fehlalarme, Dubletten, falsch zugeschriebene Treffer, je mit Ids und Richter-Entscheidung.
5. Topic-Tags des Themen-Extraktors je Ausschnitt, ohne Soll-Wert.
6. Kosten je Modellaufruf-Klasse.

Im Audiomodus gelten die Gates Recall, Precision und Latenz ohne das Zurückhalten nach ADR 0009 (obere Grenze: als ob jede Rückfrage sofort richtig beantwortet würde); dieselben Zahlen mit ADR 0009 ohne Antwort auf die Rückfrage (untere Grenze) stehen als Gegenrechnung daneben. Die Antwortzeit des Nutzers ist im Harness nicht messbar (ADR 0009 und ADR 0003, Nachträge 2026-10-28).

Vergleichsberichte stellen mehrere Arme nebeneinander, gleiche Tabelle, eine Spalte je Arm.

## 6. Synthetisches Set

- 20 bis 30 Gespräche zu 1 bis 3 Minuten, Skript vom LLM: zwei bis vier Sprecher mit Namen, eingebaute Behauptungen jedes Typs, Widersprüche, Wiederholungen, Meinungen; Audio per Text-to-Speech mit verschiedenen Stimmen, einige Stellen mit absichtlicher Überlappung durch Mischen zweier Spuren.
- Labels entstehen aus dem Skript (Satz, Sprecher, Zeitspanne aus der TTS-Ausgabe).
- CI: Mock-Extraktoren erkennen die markierten Behauptungen; geprüft werden Turn-Bildung, Takt, Dedup, Zuschreibung, Latenzmessung, Berichtserzeugung. Echte Modelle nur im manuellen oder nächtlichen Lauf mit Budgetdeckel.
- Keine Zahl aus diesem Set wird als Qualität berichtet.

## 7. Englischer Benchmark (Stufe 2)

Nach dem ersten Praxistest: ClaimBuster (CC BY 4.0, Sätze mit Sprecher aus US-Debatten) im Textmodus. Transkripte werden zu Turns gruppiert, die Extraktoren laufen wie in 4.2; ein Satz gilt als positiv, wenn ein Fund ihn als Quelle nutzt; Precision, Recall und F1 auf CFS gegen den Rest. Misst nur den Prüfwürdigkeits-Begriff, nicht Zuschreibung, Paraphrase oder Turn-Bildung. Ivanov-Audio und Podcast-Labels: nicht in Stufe 2.

## 8. Sprache als Parameter

Spracherkennungs-Sprache, Prompt-Sprache und Sprach-Tag am Korpus sind von Anfang an Parameter des Laufs. Deutsch ist Primärsprache mit dem Golden Set. Externe Datensätze sind Benchmarks, keine Trainingsdaten, solange "Erkennungseinheit und Modellrollen" keinen trainierten Vortor-Klassifikator wählt.

## 9. Offen

- Zählregel für die Recall-Schwelle (nur hoch oder hoch plus niedrig): nach dem ersten Praxistest.
- Schwellen: vorläufig, siehe 4.4.
- Modelle für Richter und Zweitlabel: "Anbieterentscheidungen".
- Topic-Labels und Soll-Werte für den Themen-Extraktor: "Topic und Vorrecherche".
