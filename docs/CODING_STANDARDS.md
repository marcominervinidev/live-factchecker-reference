# Coding standards

Judgement calls the review roles enforce (`.claude/agents/reviewer.md` and `architecture-reviewer.md` read this file; the implementer reads it too, so it knows what the review will ask). Two rules keep this file
honest:

- **Mechanical rules do not live here.** Anything a tool can check (function length, complexity,
  parameter count, import shapes, banned APIs) becomes an ESLint, dependency-cruiser, Sonar or CI
  rule instead of prose.
- **It grows through retros, never by copying books.** A review comment that would be written a
  second time becomes a check or a standard here (`docs/lessons.md`, skill `lesson`). Entries name the
  lesson or PR they came from where one exists.

Rules in `CLAUDE.md` and `.claude/rules/` are binding anyway and are not repeated here.

## Deep modules

- Hide behaviour behind the smallest interface that serves the caller; the caller should get much
  for calling little (leverage). One concept, one place: e.g. one module maps verdicts to labels, colours and icons; one module turns samples into PCM16.
- Never add exports, parameters or config only so tests can reach internals. Tests go through the
  public interface; if that makes behaviour untestable, the interface is wrong – fix the design.
- New behaviour goes into the module that owns the concept, not beside it (locality: a small
  change should not ripple across files).

## Tests as behaviour

Scope: unit tests (stage 1) and pure-logic integration tests. The UI and E2E stages (2b/3/4)
replay user behaviour on purpose – stable test ids, clicked flows and visible texts are the
point there, not a smell. What stays tautological on every stage: asserting back exactly what
the test's own mock injected, without asserting a user-visible outcome.

- A test states an observable behaviour, not the implementation: no asserting a constant against
  its own literal, no reading source files, no pinning internal call order. If a refactor that
  keeps behaviour breaks the test, the test was wrong.
- Mock only at system boundaries; asserting "the mock was called with X" without asserting an
  outcome tests nothing.

## Naming and language

- Names say what something is or does in the glossary's words (`CONTEXT.md`: Conversation, Session, Segment, Turn, Claim, Check, Verdict, Card); a term listed under _Avoid_ is a finding, and so is a name that needs a comment. No abbreviations beyond common ones (id, url, ws).
- One name per concept across the codebase; do not rename a concept at a boundary.

## Honest errors

- Fail fast and loud: no silent defaults, no swallowed errors, no broad catch that logs and
  continues as if nothing happened. Error messages name what failed and what the operator can do,
  never secret values.
- Impossible states are unrepresentable where cheap: narrow unions and zod schemas over wide
  types plus runtime hope.

## Comments

- Comments explain why (constraints, decisions, links to ADR/brief), not what the code already
  says. Every suppression (`eslint-disable`, `@ts-expect-error`, `nosemgrep`) carries its reason.

## Structure smells worth reporting

Heuristics, not laws – report with file:line and a suggestion (Fowler, *Refactoring* ch. 3):

- **Feature envy:** a function working mostly on another module's data belongs there.
- **Data clump:** the same fields travelling together want to be a type.
- **Primitive obsession:** a domain concept passed around as bare string/number instead of a
  contract type or narrow union.
- **Shotgun surgery:** one logical change forcing edits across many files – gather it.
- **Speculative generality:** abstractions, flags or hooks with a single caller and no task in
  the plan – delete or inline (CLAUDE.md, Quality: no overbuild).

## Failure and lifecycle paths

- A catch names what it expects. An error that is dropped still leaves a diagnostic code: the class of the error (`errorCode` of `@lfc/service-kit`), never its text or its `code`, which can name a host, a path or protected data. A programming error never looks like an unavailable dependency.
- Every outbound call takes a signal or a timeout that something can trigger. A fresh signal that nobody aborts is the same as none.
- Background work (timers, loops, calls in flight) ends before the connection it uses is closed; the stop path drains or cancels it, and a test shows it.

## Temporary exceptions

A suppression, an ignore entry, a paused updater or an advisory gate is as narrow as the tool allows, carries its reason and `DUE <date>` next to it, and is removed when the date arrives or renewed by a new owner decision (`docs/process/due.md`, `tools/check_due_dates.py`).
