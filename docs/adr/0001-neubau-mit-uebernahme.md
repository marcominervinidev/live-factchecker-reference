# 0001: Neubau statt Fork oder Weiterbau von live-factcheck

live-factcheck setzt die Idee bereits weitgehend um, ist aber als öffentliches DevOps-Portfolio mit den Nicht-Zielen "kein Login, keine Mehrbenutzer, keine native App, kein Hyperscaler" gebaut, und seine Erkennung findet in echten Gesprächen kaum Behauptungen (Talkshow-Test: 25 Segmente, 0 Claims). Marco hat am 2026-10-07 entschieden, das Produkt in einem neuen, privaten Repo (`live-factchecker-v2`, Name vom 2026-10-07) neu zu bauen: Wissen (Brief als Vorlage, ADRs, Research, Sicherheitsarbeit, Prozessartefakte) wird übernommen und je in einem eigenen Ticket geprüft; Code wird nicht pauschal übernommen, sondern vor jedem Feature im alten Repo gesucht und gezielt geholt. Das alte Repo bleibt unverändert als Fundgrube liegen und wird irgendwann gelöscht.

Status: accepted. Quelle: Wayfinder-Ticket "Fork, Weiterbau oder Neuanfang" (marcominervinidev/live-factchecker-plan#14).

Nachtrag 2026-10-09: Das Repo ist angelegt, privat, unter https://github.com/marcominervinidev/live-factchecker-v2.

## Considered Options

- **Weiterbau in live-factcheck:** billigster Weg, aber Portfolio-Rahmen, Token-Auth und Satz-Erkennung sitzen in Verträgen, Dialogen und Topologie (Befund "Produktlücke", #5).
- **Fork:** Historie und alle Annahmen reisen mit; die Entscheidung "was bleibt" fiele implizit statt bewusst.
- **Neubau mit gezielter Übernahme:** gewählt, weil jede Übernahme eine geprüfte Entscheidung wird.

## Consequences

- Jedes Feature beginnt mit der Frage "gibt es das im alten Repo, und passt es?"; festgehalten in den Notes der Map.
- Die 23 ADRs des alten Projekts sind Vorentscheidungen, keine geltenden Regeln, bis das Ticket "Architekturprinzipien und ADRs" (#18) sie bestätigt oder kippt.
- Backend zuerst, getestet gegen Audio aus YouTube-Videos; das Frontend folgt später und holt sich die Browser-Aufnahme dann aus dem alten Repo, falls sie passt.
