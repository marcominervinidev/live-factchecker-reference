<!-- Review guide for the owner in German first (docs/process/pr-format.md), technical details in English below.
     The PR opens as a draft and becomes ready only when the review chain, the acceptance run and both
     aggregate checks (ci passed, pr passed) are green. Title = Conventional Commit of the squash merge:
     <type>(<scope>): <summary>   e.g. feat(gateway): accept audio uploads over websocket
     References are quoted, never bare: next to every AC, decision, addendum, review finding or ADR stands the
     sentence it refers to (docs/process/pr-format.md). -->

> **Merge-Gefahr:** Risiko **niedrig / mittel / hoch** · **revertibel / nicht revertibel** (warum) · Wirkradius: **örtlich / dienstübergreifend / System** · Nutzen: **hoch / mittel / niedrig** (warum)
> **Empfohlene Review-Tiefe:** überfliegen · gezielt die genannten Stellen · Zeile für Zeile

**Ticket:** #<issue> · **Task:** <n von m> · **Urteile:** <k> passt, <l> passt nicht, <m> unklar, Kanarienvogel erkannt (Kommentar unten)

**Visuelle Review-Anleitung:** <Link zum privaten Artifact; nur bei UI-Änderung oder Risiko ab mittel, sonst diese Zeile löschen>

<!-- Herleitung: nicht revertibel = Verträge/Schema, Migration oder Datenverlust, Secrets/Security, CI/Branch-Schutz,
     nach außen sichtbares Verhalten. Risiko niedrig = revertibel + örtlich; hoch = nicht revertibel oder Wirkradius System;
     sonst mittel. Nutzen: hoch = Inkrementziel oder spürbarer Fehler; mittel = Qualität/Prozess; niedrig = Aufräumen. -->

## Für Marco: Review-Leitfaden

**Was und warum** (höchstens drei Sätze, dann die Skizze: das kleinste Bild, das den Kern zeigt):

```text
<Pseudocode der Logik, Aufrufbaum, Dateibaum als diff, oder Vertragsausschnitt>
```

**Hier genau hinschauen** (höchstens fünf Stellen, riskanteste zuerst; je Stelle die drei Fragen: Was ändert sich fachlich? Was würde ich anders bauen? Was muss ich später wissen?):

- `pfad/datei.ts:10-40`: warum hier ein Fehler wehtun würde

**Kannst du überspringen:** Tests des Testdesigners (eingefroren), Lockfile, Fixtures, reine Formatierung, …

**Deine Entscheidungen:**

- [ ] …

**Abweichungen vom Ticket:** keine / <benannt>

<!-- Ab hier eingeklappt, damit der PR kompakt öffnet. GitHub braucht die Leerzeile nach </summary>. -->

<details><summary><b>Belegt durch</b> (aus dem Manifest <code>.claude/frozen/&lt;issue&gt;.json</code>: jedes Akzeptanzkriterium mit Test und Stufe)</summary>

| Kriterium | Stufe | Test | Rot auf Basis |
|---|---|---|---|
| @ac-1 … | 1 / 2a / 2b / 3 / 4 | `pfad/test.ts` („Testname“) | ✓ |

</details>

<details><summary><b>Überlebende Mutanten</b> (Stryker inkrementell auf dem Diff)</summary>

| Datei:Zeile | Mutant | Entscheidung |
|---|---|---|
| … | … | neuer Test im PR / akzeptiert, weil … |

</details>

<details><summary><b>So habe ich geprüft</b></summary>

Stufe 0 … · Stufe 1 … · Stufe 2a/2b … · Stufe 3/4 im Stack `lfc-ci-<run>` … · Abnahmelauf `lfc-<issue>-acc` …

</details>

<details><summary><b>Agent-Bilanz</b> (<code>python3 -I tools/agent_balance.py --issue &lt;n&gt;</code>)</summary>

| Rolle | Modell | Aufrufe | Loops bis grün | Tokens | Kosten |
|---|---|---|---|---|---|
| … | … | … | … | … | … |

Befunde je Reviewer (du kreuzt „berechtigt“ beim Lesen an):

- [ ] reviewer: <Befund> · berechtigt
- [ ] security-reviewer: …

Rücklauf an Tor 1: <n> Runden · Richter: <passt/passt nicht/unklar>, Kanarienvogel <erkannt/verpasst>

</details>

<details><summary><b>Details (English)</b></summary>

### Changes

### Deviations from the ticket or spec

### Evidence

</details>
