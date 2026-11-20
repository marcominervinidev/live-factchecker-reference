---
name: test-design
description: "Test design method for the test designer and the critic: analyse the ticket, pick the technique, derive conditions and coverage items, then cases; the model models, code computes boundaries and combinations; every expectation names its source. Preloaded into those roles; not for direct invocation."
user-invocable: false
---

# Test design

From the test team decision (`docs/spec/testteam.md` in the planning repo) and the market analysis of 2026-10-05. Three steps as in ISO/IEC/IEEE 29119-4: test model, coverage items, test cases. You model; code computes values.

## 1. Analyse the ticket

Summarise the requirement in two sentences. Extract parameters (type, range, unit, precision), business rules, states and transitions, roles and permissions, time (ticks, pauses, windows). List every unclear point as an open question ("Is 3 s pause inclusive?"); never resolve it by guessing.

## 2. Pick the technique

| When | Technique | You deliver | Who computes values |
|---|---|---|---|
| a field has a range, enum or format | equivalence classes | valid and invalid classes per parameter; each invalid class gets its own case | you |
| numbers, durations, lengths, amounts | boundary values | boundary spec (min, max, inclusive?, precision); 2- or 3-value variant by risk | code (`tests/fixtures/boundaries.ts` once it exists; until then a table you compute and show) |
| two or more combined conditions | decision table | table with rule ids; infeasible columns justified | you; completeness checked by code |
| lifecycle words (open, live, closed, locked) | state transition | state table plus matrix of invalid transitions | you |
| four or more independent parameters | pairwise | a PICT model file in git, never hand-typed combinations | PICT |
| always | negative cases, weighted by risk | expected error and proof of no side effect; roles × actions | you |
| pure logic (turns, dedup, tick plan, masks, contracts) | property-based | properties plus fast-check generators | fast-check |
| new feature, exploratory | heuristics | 0/1/many, empty, maximum, Unicode, interruption, double submit, time zones, month end | you |

## 3. Conditions and coverage items

One test condition per acceptance criterion at least, with risk and the criterion id (`@ac-<k>`). Coverage items: the classes, boundaries, rules, states, PICT model. Concrete values only from step 2's "who computes" column.

## 4. Cases

Minimal set; each case carries its `covers` (coverage item ids), its expectation and its `oracle_source` (acceptance criterion, contract path, glossary term). A missing source becomes an open question, never an invented error code or value. Place every case on the lowest stage that can show it (`.claude/rules/tests.md`).

## 5. Render

- Unit: `describe` per behaviour, `it` as a behaviour sentence; property tests with their generators.
- Gherkin: English keywords, glossary terms, tags `@issue-<n>` `@ac-<k>`; `Scenario Outline` with separate `Examples` blocks (valid, boundaries, invalid), one invalid input per row; negative scenarios end with the missing side effect.
- Acceptance cases: the owner's expectation verbatim as a docstring; one sealed canary per ticket.

## Rules that are checked as code (critic and CI)

- Each invalid class appears in exactly one case where it is the only invalid input.
- Boundary values carry the declared precision; midpoint-only values are rejected.
- Each negative case asserts rejection and no side effect.
- Each expectation has an `oracle_source`.
- Pairwise rows come from PICT only; the model is in git.
- Warning when negative cases fall below roughly 30 % on input-heavy tickets (rule of thumb).
- Specification mutants: the critic invents about ten plausible mistakes; each must be caught by at least one case.
