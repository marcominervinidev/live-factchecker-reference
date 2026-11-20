# Rollen und Bahnen des Arbeitssystems

Kurzfassung für Leser im Repo. Entscheidung: ADR 0011 (`docs/adr/0011-rollen-und-bahnen-des-arbeitssystems.md`), Entscheidungsstand: `docs/spec/process/rollen.md` (nicht mehr gepflegt). Die Dateien hier sind die Umsetzung.

## Ablauf eines Tickets

1. **Planen.** Marco entscheidet (Grilling, Wayfinder). Der Refinement Agent (`.claude/agents/refinement.md`) macht aus ADR und Spezifikation einen Ticket-Entwurf mit Akzeptanzkriterien, Blast Radius, Größe, Risiko. Der Testdesigner (`test-designer.md`) schreibt Gherkin-Features, Step-Definitionen, rote Unit-Tests und Abnahmefälle. Der Kritiker (`critic.md`, stärkstes Modell) prüft sie, höchstens zwei Runden (`.claude/workflows/test-design.js`).
2. **Tor 1.** Marco gibt frei. Die Hauptsession schreibt `.claude/frozen/<issue>.json`; ab jetzt sind Features, Steps, rote Tests, Verträge und Ticket-Text eingefroren.
3. **Bauen.** Die Hauptsession orchestriert: je Task ein Implementierer (`implementer.md`) in eigenem Worktree, Branch, Compose-Projekt; nur Produktionscode, Verbotsliste, Bericht DONE / DONE_WITH_CONCERNS / BLOCKED, höchstens drei Versuche. Deterministische Gates (tsc, ESLint, Tests, Fallow, Stryker, Scanner) laufen als Code. Vor dem PR die Review-Kette (`review-chain.js`): die Hauptsession baut einmal ein Review-Paket (Diff, Manifest, Synthese-Notiz, Werkzeugergebnisse), das alle Reviewer als gleiches Präfix bekommen; Reviewer, Security-Reviewer, Architektur-Reviewer parallel, Frontend-Reviewer bei Dateien unter `apps/`, bei einem reinen Doku-PR nur der Reviewer. Plattformaufgaben baut der Platform-Engineer (`platform-engineer.md`) nach den zwölf Faktoren.
4. **Abnehmen, im PR.** Sobald der Implementierer DONE meldet und die Review-Kette durch ist: Abnahmelauf als Code (`make acceptance ISSUE=<n>`, Stack `lfc-<issue>-acc`), Urteil durch den Abnahme-Richter (`acceptance-judge.md`, Stufe Spitze, nie das Modell des Implementierers) mit Kanarienvogel; die Urteile stehen als PR-Kommentar (`acceptance.js`, `docs/process/test-strategy.md`).
5. **Tor 2.** Marco liest Diff und Urteile zusammen und merged; einen PR mit Risiko niedrig merged die Hauptsession selbst nach `docs/process/pr-format.md` („Auto-merge at low risk“, Entscheidung Marco 2026-11-05) und listet ihn im Abendpaket. Danach schließt Code (`acceptance.js`) das Ticket aus denselben Urteilen, wenn alle echten Fälle passen und der Kanarienvogel erkannt wurde; die Belegtabelle (`tools/evidence_table.py`) kommt als Issue-Kommentar (`docs/process/tickets.md`). Auto-Merge bei niedrigem Blast Radius seit dem 2026-11-05 (nach 23 gemergten PRs), Bedingungen in `docs/process/pr-format.md`.
6. **Lernen.** Retro je Inkrement (`.claude/skills/retro`), Lessons, Agenten-Bilanz, Umstufung der Modelle.

Plattform-Tasks mit der Zeile `Hand: owner` baut Marco selbst, begleitet vom `platform-coach` (Skill `begleiten`); Ablauf, Frist und Nachbau: `docs/process/lernpfad.md`.

## Regeln, die immer gelten

- Wer Code schreibt, schreibt nicht die Tests dazu. Einen Healer gibt es nie.
- Blockieren dürfen Gates immer, der Security-Reviewer bei jedem Befund, der Architektur-Reviewer bei Grenzverletzung oder doppeltem Zustand, der Code-Reviewer bei PRIO-1-Abkürzungen. Der Richter berät vor Tor 2 und bindet den Ticket-Schluss; den Merge blockiert Marco mit dem Richterbericht in der Hand, nicht der Richter selbst.
- Modelle je Rolle stehen in `.claude/models.json`; `tools/sync_agent_models.py` schreibt sie in die Agenten-Dateien und prüft die Untergrenzen (Marco, 2026-10-25): Richter, Kritiker und Architektur-Reviewer immer Spitze (Rückfall nur auf Stark, lieber kein Urteil als ein schwaches), keine Review-Rolle unter Stark (Effort xhigh), der Implementierer auf Stark nie Spitze, sein Effort nach Ticket-Risiko (niedrig medium, mittel high, hoch xhigh).
- Prüfliste `leitfaden-pruefpunkte` ist in alle Reviewer und den Kritiker vorgeladen.
- Kennzahlen: Loops bis grün, Tokens je Rolle, Befunde je Reviewer mit Anteil berechtigt, Richter-Quote, Rücklauf an Tor 1.
- Retro-Zeitpunkt: zum ersten Mal nach drei gemergten Tickets (Inkrement 1: T1 bis T3), danach am Ende jedes Inkrements; die erste Retro setzt den Schalter `ARCHITECTURE_REVIEW` in `review-chain.js` (#127).
- Deutsch an Marco, Englisch im Repo. Tests: sechs Stufen, Cucumber für Integration, API und End-to-End, describe-it und fast-check für Unit-Tests (`docs/process/test-strategy.md`, `.claude/rules/tests.md`).

## Wo der Rest steht

PR-Vorlage, Required Checks und die Workflow-Dateien `ci.yml`, `pr.yml`, `nightly.yml`: `docs/process/pr-format.md`; Fallow, Knip und Stryker: `docs/process/review-tools.md`; Ticket-Ebenen und Inkrement 1: `docs/process/tickets.md`; Hand-Tasks: `docs/process/lernpfad.md`.
