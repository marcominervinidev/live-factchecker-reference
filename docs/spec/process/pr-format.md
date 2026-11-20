# PR-Format, Größe, Commits und Gates

Referenz zur Entscheidung aus dem Wayfinder-Ticket "PR-Format, Größe, Commits und Gates" (marcominervinidev/live-factchecker-plan#47, 2026-10-19). Umsetzung in `live-factchecker-v2`, Branch `process/rollen`: `.github/pull_request_template.md`, `.github/CODEOWNERS`, `.github/workflows/{ci,pr,main,nightly,stack-tests}.yml`, `lefthook.yml`, `commitlint.config.mjs`, `sonar-project.properties`, `tools/check_{commits,pr_size,eval_report}.py`, `tools/check_red_before_green.sh`, `tools/agent_balance.py`, `tools/nightly_trend.py`, Rule `.claude/rules/ci.md`, Skill `open-pr`, `docs/process/pr-format.md`. Schaubild: https://claude.ai/artifact/S7e3jCMMg4twFdQpA7XWQd (Kopie: docs/schaubilder/047-pr-format.html)

## 1. Größe und Form (Q1, Q2, Q9, Q11)

- Ein Task je PR. Ein Check zählt geänderte Zeilen Produktionscode (ohne Tests, Fixtures, Lockfiles, Docs, CI-Konfiguration): über 400 warnt er im PR, über 800 blockiert er.
- Keine Stapel-PRs: der nächste Task desselben Tickets wartet auf den Merge; unabhängige Tasks laufen parallel in Worktrees auf getrennten Dateien. Repo-Setting "Automatically delete head branches" am Tag 1.
- Jeder PR öffnet als Draft und wird erst "ready", wenn Review-Kette, Abnahmelauf und die Sammel-Checks `ci passed` und `pr passed` grün sind; "ready" heißt: Marco ist dran. Jeder Commit auf einem offenen PR wird sofort gepusht.
- Squash-Merge: ein Commit je Task auf main, Titel ist der Conventional Commit des PR, Body listet die Einzel-Commits; lineare Historie. Die Review-Reihenfolge der Commits lebt im PR.

## 2. Commits (Q3)

Conventional Commits mit Pflicht-Scope. Typen `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `ci`, `perf`, `build`, `revert`; Scopes sind die Workspace-Namen (`gateway`, `contracts`, `pipeline`, `providers`, `web`, `ui`, `evals`, `tests`) plus `ci`, `process`, `docs`, `platform`, `deps`, `release`; ein neuer Workspace bringt seinen Scope im selben PR mit. Durchsetzung durch `tools/check_commits.py` im lefthook `commit-msg`, in der CI über alle Commits des PR und über den PR-Titel. `wip:` nur auf Task-Branches. Review-Reihenfolge Vertrag → rote Tests → Logik → Verdrahtung → Docs. Release Notes aus den Squash-Titeln mit git-cliff beim ersten Release; vorher keine Changelog-Datei.

## 3. Die Vorlage (Q4, Q10)

Deutscher Leitfaden zuerst: Merge-Gefahr-Block (Risiko, Revertierbarkeit, Wirkradius, Nutzen, Review-Tiefe, Herleitung wie alt), Ticket und Task, Urteilszeile des Richters, Link zur visuellen Anleitung nur bei UI-Änderung oder Risiko ab mittel, "Was und warum" mit der kleinsten Skizze (Skizzenregel aus Matts `pr`-Skill), "Hier genau hinschauen" mit höchstens fünf Stellen und den drei Leitfaden-Fragen je Stelle, Überspringen, Entscheidungen, Abweichungen. Eingeklappt: "Belegt durch" aus dem Manifest (Kriterium, Stufe, Test, rot auf Basis), überlebende Mutanten mit Entscheidung je Mutant, So geprüft, Agent-Bilanz, Details (English).

Der Richterbericht ist ein PR-Kommentar je Lauf (ein Zitat, höchstens zwei Bilder je Fall); der Body trägt nur die Zählzeile. Ein Wiederholungslauf ist ein neuer Kommentar.

## 4. Gates (Q5, Q7, Q14)

| Check | Workflow | Blockiert |
|---|---|---|
| Repo-Checks: Hook-Tests, Modell-Sync, Doku-Deckung, Kontextbudget, Tool-Tests, Commit-Form, gitleaks über die Historie | `ci.yml` | ja |
| Stufe 0 (tsc, ESLint, Prettier, dependency-cruiser), Stufen 1, 2a, 2b je betroffenem Workspace | `ci.yml` | ja |
| Rot vor Grün: eingefrorene Tests eines geänderten Manifests fallen auf der Basis | `ci.yml` | ja |
| Golden Set Stufe 1 (Harness-Tests, Mock-Lauf) | `ci.yml`, nachts | ja |
| SonarQube Cloud (Frankfurt) | `ci.yml` | vier Wochen beratend, dann Quality Gate auf neuem Code ohne Coverage-Bedingung |
| PR-Größe, Commits, PR-Titel, Eval-Bericht vorhanden | `pr.yml` | ja |
| Vertragscheck, hadolint, Semgrep, Image-Build und Trivy (CRITICAL mit Fix, Secrets) | `pr.yml` | ja |
| Fallow `audit --gate new-only` mit PR-Kommentar | `pr.yml` | ja, nur neue Befunde |
| Stryker inkrementell auf geänderten Paketen, Überlebende im PR | `pr.yml` | beratend, bis die Retro `break` je Paket setzt |
| Stufen 3 und 4 gegen den Stack `lfc-ci-<run>`, neue Szenarien dreimal | `pr.yml` via `stack-tests.yml` | ja |
| Nach dem Merge: Images nach GHCR, Stufen 3 und 4 gegen die Images | `main.yml` | `main passed` |
| Nacht: Stryker geänderte Pakete (sonntags alle), ein Browser im Wechsel dreifach, Lighthouse, Trivy voll, Fallow, Knip, Golden-Mock, Deepgram-Probe; Trend-Kommentar | `nightly.yml` | Bericht |

Required Checks im Ruleset: `ci passed` und `pr passed`; je Workflow eine Sammel-Prüfung, weil Matrix-Jobnamen wandern. Beratende Jobs sind im Sammel-Schritt namentlich genannt und ändern sich nur durch Marcos Entscheidung. dependency-cruiser bleibt in Stufe 0, bis Fallow-Boundaries die Regeln tragen. CodeQL bleibt offen (braucht im privaten Repo Advanced Security; Kostenfrage in #56). Bis `pnpm-lock.yaml` existiert, überspringen die Code-Jobs über `has_code`; die Repo-Checks laufen ab sofort.

Ruleset auf main (braucht GitHub Pro): PR-Pflicht ohne Pflicht-Freigabe (Marco ist Autor jedes PR), beide Sammel-Checks, lineare Historie, nur Squash-Merge; CODEOWNERS (`packages/contracts`, `.github`, `.claude`, `deploy`, Hook- und Lint-Konfiguration) ist die Pflichtliste für „Hier genau hinschauen“, keine erzwungene Freigabe (Nachtrag 2026-10-20 nach der Kostenübersicht). Kein Auto-Merge in Inkrement 1; nach zwanzig PRs entscheidet die Retro mit den Kennzahlen.

## 5. Werkzeuge (Q6)

Eigene Reviewer-Rollen mit `fallow-review` als deterministischer Vorstufe, dazu **SonarQube Cloud Free ab Tag 1** (Marco, "sofort"): Frankfurt, Quality Gate, Taint, Secrets. Marco nimmt die Free-Terms in Kauf (kein DPA, Sonar darf Customer Data zum Training nutzen); Sicherheit (#22) führt das als bekanntes Risiko und prüft den Wechsel auf Team, sobald das Repo personenbezogene Daten enthalten könnte. Kein Greptile, kein CodeScene. Der Plugin-Skill `improve-codebase-architecture` ist kein Gate, sondern ein periodischer Lauf in der Hauptsession vor jedem Inkrement-Meilenstein und in jeder Retro; der Bericht wird als privates Artifact veröffentlicht, weil `open` in der Sandbox blockiert ist; `GLOSSARY.md` in v2 zeigt auf `CONTEXT.md`.

## 6. lefthook (Q12)

pre-commit parallel unter 30 Sekunden: gitleaks auf Staged, Prettier und ESLint auf Staged, typecheck, Unit-Tests betroffener Pakete, dependency-cruiser, Doku-Deckung, Kontextbudget, Modell-Sync, Hook-Tests; commit-msg mit der Commit-Prüfung; kein pre-push. Läuft im Toolbox-Container über den Shim (`make hooks-install`, kommt mit dem ersten Plattform-Ticket).

## 7. Tor 2 (Q8)

Marco liest in GitHub, Commit für Commit in Review-Reihenfolge, mit "Hier genau hinschauen" als Karte; die drei Fragen des Leitfadens (Was ändert sich fachlich? Was würde ich anders bauen? Was muss ich später wissen?) stehen je Stelle im PR. Kein lokales Staging.

## 8. Agent-Bilanz (Q13)

`tools/agent_balance.py --issue <n>` rendert den Abschnitt aus den Workflow-Ergebnissen und Implementierer-Berichten, die die Hauptsession unter `.claude/scratch/balance/<issue>/` ablegt (`test-design-r*.json`, `review-chain.json`, `acceptance.json`, `implementer-<task>.md`, optional `usage.json` mit Tokens und Kosten je Rolle). Marco kreuzt je Reviewer-Befund "berechtigt" an; die Retro summiert Loops, Tokens, Befundquote, Richter-Quote und Rücklauf an Tor 1. Der Port des alten `agent-usage.py` für Tokens wartet, bis das heutige Log-Format geprüft ist (Task Review-Werkzeuge einrichten).

## 9. Marcos Checkliste (einmalig)

1. GitHub Pro für das Konto (Rulesets im privaten Repo gehen auf Free nicht, API antwortet 403; Kostenübersicht #56). Dann Ruleset auf main wie in Abschnitt 4, aber **ohne Pflicht-Freigabe**: Marco ist Autor jedes PR, weil die Agenten unter seinem Konto pushen, und GitHub lässt Autoren nie selbst freigeben. CODEOWNERS bleibt die Liste der Pfade, die der Leitfaden unter „Hier genau hinschauen“ nennen muss. Squash als einzige Merge-Methode, Squash-Titel = PR-Titel.
2. "Automatically delete head branches" an.
3. Secrets `SONAR_TOKEN` (Projekt `marcominervinidev_live-factcheck_2`; der Schlüssel trägt den Namen des alten Repos, so wurde das Sonar-Projekt angelegt und so steht er in `sonar-project.properties`; Organisation `marcominervinidev`, New-Code-Definition "previous version"), später `DEEPGRAM_API_KEY` für die Nachtprobe.
4. SonarQube Cloud: Projekt ans Repo binden, Automatic Analysis aus, nach vier Wochen Quality Gate als Required Check.
5. Ein Issue mit Label `nightly` für die Trend-Kommentare.
6. `make hooks-install` nach dem ersten Plattform-Ticket.

## 10. Übergaben

- Review-Werkzeuge einrichten (#55): Fallow-Action auf Commit-SHA pinnen, `.fallowrc.json`, `fallow hooks install --target agent`, Stryker-Konfiguration je Paket, Knip-Konfiguration, Prüfung des Log-Formats für `usage.json`.
- Kostenübersicht (#56): GitHub-Minuten der Workflows, Sonar Free, CodeQL-Frage.
- Sicherheit (#22): Sonar-Free-Terms als bekanntes Risiko; Trivy-Schwellen; eingeschlossener Runner.
- Erstes Plattform-Ticket: `make`-Ziele `ci-secrets`, `ci-stack-up`, `test-api`, `test-e2e`, `lighthouse`, `ci-stack-down`, `hooks-install`; `scripts/ci/affected.ts`, `images.ts`, `check-contract-change.sh` aus dem alten Repo übernehmen.

## 11. Verworfen

400 Zeilen als harte Grenze; keine Zahl; ein Stapel-PR als Draft; CHANGELOG ab Tag 1; Commit-Regel ohne Durchsetzung; Matts `pr`-Vorlage allein; visuelle Anleitung bei jedem PR; Gate ohne Fallow; Greptile; CodeScene; Auto-Merge sofort; lokales Staging; "ready" sofort; Richterbericht nur im Body; Rebase-Merge; pre-push-Hook; Sonar sofort blockierend.
