# 0002: Erkennung mit zwei Extraktoren im Fünf-Sekunden-Takt

Die Erkennung von live-factchecker besteht aus zwei Extraktoren auf demselben Transkriptstrom, die alle fünf Sekunden Redezeit laufen und verschiedene Kontextregeln haben. Der **Behauptungs-Extraktor** bekommt den bisherigen Redebeitrag des aktuellen Sprechers vollständig (kumulativ, mit jeder Analyse wächst er), das Setting (Sprecher mit Namen, aktuelles Topic) und die aus diesem Redebeitrag bereits ausgegebenen Behauptungen; er liefert null bis n Behauptungen als eigenständige Sätze mit benanntem Sprecher. Der **Themen-Extraktor** hält eine Tag-Liste der erkannten Topics und Unter-Topics, taggt alles, was er zu einem Topic vorab lädt, und prüft mit jeder Analyse, ob ein Topic neu ist, weitergeht oder zurückkehrt; Arbeitsannahme für seine Eingabe ist die Tag-Liste plus das seit der letzten Analyse Neue. Kontext und Sprecher-Metadaten werden damit vor der Entscheidung in den Text geschrieben, nicht danach aus einem Buchstaben rekonstruiert. Nichts wird still verworfen: Was eine Stufe nicht auflösen kann, geht an die nächststärkere; die Prüfwürdigkeit ordnet die Warteschlange, hohe Behauptungen zuerst zur Prüfung mit Belegen, niedrige bekommen eine Einschätzung ohne Belege. Marco hat das am 2026-10-07 entschieden.

Status: accepted. Quelle: Wayfinder-Ticket "Erkennungsstrategie für Debatten und Gespräche festlegen" (marcominervinidev/live-factchecker-plan#4). Begriffe: `CONTEXT.md` (Segment, Turn, Claim, Assessment).

## Considered Options

- **Entscheidung pro STT-Segment mit Fenster als Kontext** (live-factcheck, dessen ADR 0017): Das Segment ist ein Satzfetzen, den Pausen und Interpunktion schneiden; im Talkshow-Test fielen alle 25 Segmente vor der Formulierung, und die Precision-zuerst-Schwellen ließen das System schweigen. Verworfen.
- **Extraktion erst am Ende des Redebeitrags** (Claimify-Muster rein): sauberste Einheit, aber die Karte wartet auf das Ende eines Monologs. Verworfen zugunsten der kumulativen Analyse alle fünf Sekunden.
- **Ein Modellaufruf für Themen und Behauptungen:** billiger, aber die beiden brauchen verschiedene Eingaben (Tag-Liste plus Neues gegen vollständiger Redebeitrag) und verschiedene Modelle. Verworfen.
- **Zwei Extraktoren, kumulativ alle fünf Sekunden, mit Dedup:** gewählt.

## Consequences

- Dedup innerhalb des Redebeitrags ist Pflicht, weil die kumulative Analyse dieselbe Behauptung bei jeder Wiederholung erneut findet; die bereits ausgegebenen Behauptungen gehen deshalb als Eingabe mit.
- Die Latenz wird vom letzten gesprochenen Wort, das zur Behauptung gehört, bis zur Karte gemessen; die 30 Sekunden für die Prüfung gelten ab Karte.
- Die Kosten der Fünf-Sekunden-Kadenz (zwei Modellaufrufe je laufendem Sprecher) sind unbemessen und gehen in den Messaufbau; die alte Schätzung lag bei 0,063 USD pro Gesprächsminute.
- Die Sprechernamen aus dem Setting gehen in die Extraktion, in beiden Modi "Sendung" und "Gespräch". Die Maske aus ADR 0017 des alten Repos wandert an die Grenze zur Websuche und zum Cache; dorthin nur Namen, die das Setting als Person des öffentlichen Lebens markiert.
- Eine Behauptung trägt: eigenständigen Satz (immer Paraphrase), wörtlichen Ausschnitt, Ids aller Quellsegmente, Sprecher, Zeitstempel, Typ (Zahl oder Statistik; Ereignis oder Handlung; Zitat oder Zuschreibung; Ursache und Wirkung), Prüfwürdigkeit.
- Widerspruch und Zustimmung zu einer Behauptung sind selbst Behauptungen über denselben Sachverhalt; die alte Regel "Meinungen werden aussortiert" gilt nur noch für reine Werturteile ohne Tatsachenkern, und selbst das klärt das Folgeticket.
- Die Einschätzung (Assessment) ist ein neuer Begriff mit eigener Optik auf der Karte, hochstufbar zur vollen Prüfung.
- Offen und an Folgetickets weitergegeben: die Einheit innerhalb des Behauptungs-Extraktors (Satz nach Normalisierung, Redebeitrag, Satz plus Merkmale), Klassifikator gegen LLM und die Eskalationsleiter, die Zahl zusätzlicher Redebeiträge anderer Sprecher als Kontext, eine Zusammenfassung früherer Redebeiträge desselben Sprechers, die Eingabe des Themen-Extraktors (Neues gegen ganzes Gespräch), Testdaten und Messaufbau.
