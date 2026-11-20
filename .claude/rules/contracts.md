---
paths:
  - "packages/contracts/**"
---

# Contracts

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Keep the sections, fill them as the code arrives; an empty section is a reminder, not a licence to invent.

## Responsibility
The schemas every seam speaks: the live audio contract and the segment contract (ADR 0005), claim, verdict, assessment, card (ADR 0002, 0004), consent record (ADR 0009). Specs: `docs/spec/inputs.md`, `erkennung-modellrollen.md`, `datenschutz.md`.

## File map
`src/<kebab-name>.ts` one schema per file, `src/common.ts` building blocks, `src/index.ts` exports, `src/testing/fixtures.ts` valid examples (export `@lfc/contracts/testing`), `README.md` table of schemas and versions. `scripts/generate-json-schema.ts` generates `json-schema/<kebab-name>.schema.json` from every Zod schema `src/index.ts` exports (ADR 0012); never edit an artefact by hand, `src/json-schema.test.ts` fails while one is stale.

## Pitfalls
- Read-only for agents: a change needs the owner's word, an ADR, a higher `schemaVersion`, contract tests and its own commit (skill `new-contract`). A hook asks; CI refuses otherwise.
- Strict objects with `.check(unknownFieldsNamed)` (a rejection names the field), no unknown fields; every verdict and assessment carries `generated` (ADR 0009).
- Rules across fields (`.refine`) do not reach the JSON Schema artefact; name them in the README.
- Names follow `CONTEXT.md`; a new concept is proposed as a glossary term first.

## Configuration
None; contracts have no runtime configuration.

## Tests
`src/<name>.test.ts`: the fixture parses; one failing case per rule; JSON round trip.
