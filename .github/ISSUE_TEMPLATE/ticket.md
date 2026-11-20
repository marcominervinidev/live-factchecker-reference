---
name: Ticket
about: One coherent goal for the agents, drafted by the refinement agent, approved by the owner at gate 1 (docs/process/tickets.md)
title: "<glossary terms, English identifiers>"
labels: refined
---

<!-- References are quoted, never bare: next to every AC, decision, ADR or ticket number stands the sentence it
     refers to (docs/process/tickets.md). -->

## Für Marco

Drei kurze Sätze auf Deutsch, ohne Fachwörter und ohne Pfade: Was gibt es danach? Woran siehst du es? Was musst du entscheiden (nur die offenen Fragen unten, sonst „nichts“)? Alles darunter ist für die Agenten; du musst es nicht lesen.

## Parent

Increment #<n> (sub-issue). Source: ADR <nnnn> / `docs/spec/<file>.md` section <k> / triaged request #<m>.

## Goal

Two sentences: what exists after this ticket that did not before, observable at a seam (segment seam, live contract event, stage-3 API, harness report).

## Acceptance criteria

Numbered and stable; each testable by one Gherkin scenario or one unit test; negative cases included. Tests tag them `@issue-<n>` and `@ac-<k>`; the evidence table is generated from those tags, never written here.

1. AC1: …
2. AC2: …
3. AC3 (negative): … and no side effect.

## Contracts

Schemas, message formats, routes this ticket touches. Read-only for the implementer; a change needs an ADR and is named here.

- `packages/contracts/…`: unchanged | changed (ADR …)

## Risk

- Blast radius: local | cross-module | system
- Revertibility: two-way | one-way (contracts, schema, data, secrets, CI, outward-visible behaviour)
- Risk: low | medium | high (sets the implementer's effort: low medium, medium high, high xhigh)
- Size: S (1 task) | M (2–3 tasks); L is split before gate 1
- Session type: implement | prototype | research | clarify

## Tasks

One task = one PR on branch `task/<issue>-<t>`, under 400 production lines. Exact paths, expected shape, and the verification command (the red test the test designer writes). `Hand: owner` marks a task the owner builds himself (learning path, `docs/process/lernpfad.md`); delete the line otherwise.

### Task 1: <title>
- Paths: …
- Shape: …
- Verify: `make test …`
- Hand: owner

### Task 2: <title>
- …

## Measurement (optional; makes this a measurement ticket)

- Configuration (arm): `evals/configs/…`
- Set: pruefset | full
- Thresholds: … (relative to `evals/reports/baseline.json`; 0.05 pruefset, 0.02 full)
- Budget: … USD

Acceptance is the harness comparison and the check "eval report present"; no judge, no canary.

## Assumptions

Smaller points the draft settles by its own recommendation (paths, names, defaults, test details). They stand unless the owner objects at gate 1.

## Open questions

Only what the owner must decide: a point that touches several tickets, is one-way, or changes scope; at most three, each with the recommendation first. Everything else goes under Assumptions. Decisions are posted as comments, never edited into this body after gate 1.

## Sources

ADR, spec and issue lines this draft rests on.
