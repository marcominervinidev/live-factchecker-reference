---
paths:
  - "apps/web/**"
  - "packages/ui/**"
---

# Web app

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Keep the sections, fill them as the code arrives; an empty section is a reminder, not a licence to invent.

## Responsibility
The client of increment 1 (ADR 0010): React web app in the browser, later the Capacitor shell. Consent dialog per mode, recording indicator, pause, "Sprecher ausnehmen", cards, transcript, topic timeline, wake lock, "Tonabgriff wählen" (specs `clients.md`, `datenschutz.md`, `sprecher.md`).

## File map
Filled with the first frontend ticket; design rules in `docs/design.md` once it exists.

## Pitfalls
- No German strings inline: every UI text in the i18n resources, labels from `CONTEXT.md` (the German word in brackets).
- No business logic in rendering; state in one store; cards show the generated-content label; untrusted text never as HTML.
- Accessibility is a gate (`eslint-plugin-jsx-a11y`) and a review item (focus, live regions, colour never the only signal).
- The consent dialog cannot be bypassed; the recording indicator is visible while an input is open; no home-screen install prompt.

## Configuration
Runtime configuration from `/config.json` written at container start; never secrets in the bundle.

## Tests
Unit tests for logic, Cucumber end-to-end for journeys, acceptance screenshots for the judge and the frontend reviewer.
