# Spezifikation: Setting, Topic und Vorrecherche

Stand 2026-10-12. Entscheidungen stehen in ADR 0007; dieses Dokument legt fest, was das Setting enthält, wann eine Vorrecherche läuft, was sie je Quellenklasse lädt, wie ein Beleg aussieht, wie der Belegspeicher und der gemeinsame Index geführt werden, wie die Prüfung darauf zugreift und wie das gemessen wird, damit das Backend in `live-factchecker-v2` ohne Rückfrage gebaut werden kann. Begriffe nach `CONTEXT.md` (Setting, Topic, Topic Extractor, Prefetch, Evidence Store, Shared Index, Source, Evidence, Check). Der Topic Extractor selbst steht in `docs/spec/erkennung-modellrollen.md`, Abschnitt 6.

## 1. Setting

| Feld | Pflicht | Werte | Wirkung |
|---|---|---|---|
| `mode` | ja | `broadcast` (Sendung), `conversation` (Gespräch) | Einwilligungsdialog, Nebensprecher und Urteilscache je Modus: ADR 0009, `docs/spec/datenschutz.md`; die Grenze nach außen ist in beiden Modi dieselbe |
| `speakers[]` | nein | `name`, `role` (`host`, `guest`, `moderator`, `private`), `public` (bool) | Namen in der Extraktion (ADR 0002); `public: true` erlaubt den Namen nach außen und löst den Sprecher-Prefetch aus |
| `topic` | nein | freier Text | Anfangs-Topic der Tag-Liste; löst den ersten Topic-Prefetch aus |
| `programme` | nein | Sendung, Datum | Programmkontext für "Sprecher benennen" (#20) |

Standardwerte ohne Angabe: keine Sprecher (Diarisierungslabel A, B bleiben), kein Topic (die Tag-Liste beginnt leer, der erste Prefetch läuft beim ersten `new` des Topic Extractors).

## 2. Auslöser

| Ereignis | Vorrecherche |
|---|---|
| Setting mit `speakers[].public = true` | Sprecher-Prefetch je öffentlichem Sprecher, einmal je Session |
| Setting mit `topic` | Topic-Prefetch für das Anfangs-Topic |
| Topic Extractor: `new` | Topic-Prefetch; ein Unter-Topic (`parent` gesetzt) erbt die Belege des Eltern-Topics und lädt nur, was seine eigenen Suchbegriffe ergeben |
| Topic Extractor: `returned` | kein Laden; Belege, deren Abrufzeit älter ist als `evidence_max_age`, werden nachgeladen |
| Topic Extractor: `current`, `ended` | nichts |

Ein Topic, das innerhalb der Abkühlzeit (`topic_cooldown_seconds`) erneut `new` wird, löst nichts aus. Nach `max_prefetch_topics` je Session läuft nur noch die Live-Prüfung.

## 3. Was je Quellenklasse geladen wird

| Klasse | Quelle, Abruf | Je Topic-Prefetch | Je Sprecher-Prefetch | Lizenz |
|---|---|---|---|---|
| Faktencheck-Index | gemeinsamer Index (Abschnitt 5), Volltextsuche | Top `index_hits` Einträge, getaggt | – | Feed CC BY; RSS nur Titel, Link, Auszug |
| Amtliche Statistik | Eurostat live (JSON-stat, `lang=DE`); GENESIS und Bundesbank aus dem gemeinsamen Index | bis `tables_per_topic` Tabellen, Zuordnung Topic zu Tabelle durch den Prefetch-Modellaufruf (Liste der etwa 50 Kerntabellen im Prompt) | – | dl-de/by-2-0, CC BY 4.0, frei mit Quellenangabe |
| Parlament | DIP (`search.dip.bundestag.de/api/v1`, Reden, Anträge), abgeordnetenwatch (Mandate, Abstimmungen) | – | letzte `speeches_per_speaker` Reden und `votes_per_speaker` Abstimmungen | Bundestag-Bedingungen (Anwaltsfrage für Bezahlprodukt), CC0 |
| Referenz | Wikipedia REST (Suche, Artikel), Wikidata (`wbsearchentities`, `wbgetentities`) | `wiki_articles_per_topic` Artikel (Einleitung plus bis `paragraphs_per_article` Absätze), `entities_per_topic` Entitäten | – | CC BY-SA 4.0, CC0 |
| Presse | – | nie | nie | § 44b, § 87g UrhG |
| Websuche | – | nie | nie | Brave ohne Speicherplan |

**Prefetch-Modellaufruf:** ein Aufruf der Haiku-Klasse je Topic (Plattform nach ADR 0006) mit Topic, Tag-Liste und Setting; Ausgabe: Suchbegriffe für Wikipedia, Entitäten für Wikidata, Tabellen-Ids für Eurostat, Suchbegriffe für den Faktencheck-Index. Namen privater Sprecher sind vor dem Aufruf nach außen maskiert (ADR 0002); der Modellaufruf selbst läuft in der EU und sieht das Setting.

## 4. Beleg im Belegspeicher

```json
{
  "id": "e-0042",
  "sessionId": "5b0e…",
  "topics": ["Mieten Berlin", "Mietpreisbremse"],
  "speaker": null,
  "source": { "kind": "amtlich", "publisher": "Eurostat", "url": "https://…", "title": "Harmonisierter Verbraucherpreisindex, Wohnen", "licence": "CC BY 4.0" },
  "excerpt": "…",
  "data": { "table": "prc_hicp_midx", "cells": [] },
  "fetchedAt": "2026-10-12T19:04:11Z",
  "validUntil": "2026-10-12T23:00:00Z"
}
```

| Feld | Regel |
|---|---|
| `topics` | Tags aus der Tag-Liste, zu denen der Beleg geladen wurde; ein Unter-Topic trägt auch das Eltern-Topic |
| `speaker` | nur beim Sprecher-Prefetch: Name aus dem Setting |
| `source.kind` | `faktencheck`, `amtlich`, `parlament`, `referenz` (Gewichte wie `config/source-tiers.yaml` des alten Repos: 1,0 / 0,9 / 0,9 / 0,8) |
| `excerpt` | Textauszug im Rahmen der Lizenz; bei Faktenchecks aus RSS nur Titel und Teaser |
| `data` | strukturierte Daten (Tabellenzellen, Abstimmungen) statt Text, wo vorhanden |
| `fetchedAt`, `validUntil` | Abrufzeit; `validUntil` aus der Quelle (Eurostat-Update 11:00 und 23:00 Brüssel) oder `evidence_max_age` |

Nie im Beleg: Transkripttext, Behauptungssätze, Session-Metadaten außer `sessionId`.

## 5. Belegspeicher und gemeinsamer Index

| | Belegspeicher (Evidence Store) | Gemeinsamer Index (Shared Index) |
|---|---|---|
| Inhalt | Belege einer Session, Abschnitt 4 | ClaimReview-Feed (Data Commons), RSS-Einträge der Faktenchecker (CORRECTIV, Mimikama; Titel, Link, Teaser), GENESIS- und Bundesbank-Kerntabellen mit Stand |
| Ablage | Redis, Schlüssel je Session, ohne Platte (wie ADR 0018 alt) | Datenbank nach Datenmodell (Nebel); bis dahin eigene Redis-Instanz mit Platte, getrennt von der Pipeline |
| Lebensdauer | Session plus `evidence_store_ttl` (Startwert 15 Minuten nach Ende) | dauerhaft; Einträge tragen Abrufzeit und Quelle |
| Nachführung | je Prefetch | geplanter Job: **nachts** (Startwert 03:00 Europe/Berlin) Feed und Tabellen; **stündlich** RSS. "Nachts nachgeführt" heißt: ein zeitgesteuerter Job außerhalb des Live-Pfads holt die Quelle neu und ersetzt oder ergänzt die Einträge; keine Conversation wartet darauf |
| Zugriff | Prüfung und Prefetch derselben Session | Prefetch jeder Session (Volltextsuche), Prüfung live (Faktencheck-Treffer in Millisekunden) |
| Personenbezug | keiner außer Sprechernamen öffentlicher Personen | Namen öffentlicher Personen aus den Quellen selbst |

## 6. Abruf durch die Prüfung

1. **Belegspeicher:** Filter nach den Topic-Tags der Behauptung (das `current` der Tag-Liste zum Zeitpunkt der Behauptung plus deren Eltern), dann Stichwortsuche über `excerpt` und `data` mit Zahlen, Namen und Begriffen aus dem Behauptungssatz; Top `evidence_candidates` an die Relevanzstufe der Prüfung.
2. **Gemeinsamer Index live:** Faktencheck-Treffer zum Behauptungssatz (Volltext), unabhängig vom Topic.
3. **Live-Quellen:** Google Fact Check Claim Search, Eurostat, Wikimedia, nur wenn 1 und 2 unter `evidence_min` liegen.
4. **Websuche Brave:** zuletzt, maskierter Satz, 1 bis 3 Anfragen.

Kein Embedding, kein Vektorspeicher in Version 1. Variable für den Messaufbau der Prüfung (#39): Abruf "Stichwort" gegen "Embeddings" (Modell mit EU-Verarbeitung nach ADR 0006).

## 7. Parameter mit Startwerten

| Parameter | Startwert | Bedeutung |
|---|---|---|
| `wiki_articles_per_topic` | 3 | Wikipedia-Artikel je Topic-Prefetch |
| `paragraphs_per_article` | 20 | Absätze je Artikel nach der Einleitung |
| `entities_per_topic` | 5 | Wikidata-Entitäten je Topic |
| `tables_per_topic` | 3 | Statistik-Tabellen je Topic |
| `index_hits` | 20 | Treffer aus dem Faktencheck-Index je Topic |
| `speeches_per_speaker` | 20 | Reden je öffentlichem Sprecher |
| `votes_per_speaker` | 20 | Abstimmungen je öffentlichem Sprecher |
| `max_prefetch_topics` | 30 | Topics mit Prefetch je Session |
| `topic_cooldown_seconds` | 600 | Abkühlzeit je Topic |
| `evidence_max_age` | 24 h | danach nachladen bei `returned` |
| `evidence_store_ttl` | 15 min | nach Session-Ende |
| `evidence_candidates` | 12 | Kandidaten an die Relevanzstufe |
| `evidence_min` | 2 | darunter Live-Quellen |
| `wikimedia_budget_per_minute` | 150 | zentral, Prüfung vor Prefetch; Rest bis 200 als Reserve |
| `shared_index_refresh` | 03:00 täglich; RSS stündlich | Nachführung |

Startwerte werden im Bericht genannt; eine Änderung ist ein Parameter des Laufs.

## 8. Sichtbarkeit

Das Topic ist Teil der Karte (Tag) und der Zeitleiste (Kapitel aus der Tag-Liste mit Start und Ende). Ob der Nutzer Topics umbenennt oder setzt, entscheidet der Prototyp "Live-Ansicht und Karte" (#16).

## 9. Messung

| Zahl | Definition | Wo gemessen |
|---|---|---|
| Prefetch-Trefferquote | Belege einer Prüfung aus dem Belegspeicher geteilt durch alle Belege der Prüfung | Messaufbau der Prüfung (#39), Arm "mit und ohne Vorrecherche" |
| Zeit bis zum ersten Beleg | ab Karte, mit und ohne Vorrecherche | #39 |
| Topic-Erkennung | je Topic der Label-Liste: erkannt ja oder nein, Verzögerung in Sekunden, Fehlalarme je Stunde | Golden Set Version 2 mit Topic-Labels (#25): je Ausschnitt Liste der Topics mit Minutenangabe |
| Prefetch-Aufwand | Anfragen je Quelle und Topic, Modellkosten je Topic, Anteil am Wikimedia-Budget | jeder Lauf |

## 10. Offen

- Regeln je Modus, Einwilligungsfluss, ob im Modus Gespräch nach außen gesucht wird: Datenschutzmodell (#11), Research #40.
- Markierung "öffentliche Person" und Abbildung Diarisierungslabel auf Setting-Sprecher: Sprecher benennen (#20).
- Ablage des gemeinsamen Index: Datenmodell (Nebel).
- bundestag.de-Nutzungsbedingungen für ein Bezahlprodukt: Anwaltsfrage (#6).
- Embeddings: erst nach Messung (#39).
