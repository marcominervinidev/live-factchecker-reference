---
name: new-contract
description: "Add or change a schema in packages/contracts: ADR first, strict schema with schemaVersion, fixture, contract tests, README row, own commit. Only after the owner approved the change in this conversation."
---

# New or changed contract

Contracts are read-only for agents (`.claude/rules/contracts.md`). Start only when the owner approved the change in this conversation; otherwise stop and propose it with the reason.

## Steps

1. **ADR first** in `docs/adr/` (same format as the planning repo): why, the fields and formats, compatibility during rollout, the rejected alternative.
2. **Schema** in `packages/contracts/src/<kebab-name>.ts`: `z.strictObject({ schemaVersion: z.literal(<n>), ... })`; new schemas start at 1, a changed schema gets old + 1; building blocks from `src/common.ts`; cross-field rules via `.refine` with `path`; export schema and type.
3. **Export** from `src/index.ts`; add to the envelope if it travels on a stream or channel.
4. **Fixture** in `src/testing/fixtures.ts`.
5. **Contract tests** in `src/<kebab-name>.test.ts`: fixture parses; one failing case per rule (wrong type, missing field, unknown field, each refine); JSON round trip.
6. **README** table row.
7. **Verify**: contract unit tests, typecheck, the contract-change check against `origin/main`.
8. **Commit** the contract alone: `feat(contracts): ...` or `feat(contracts)!: ...` for a breaking change; consumers follow in separate commits. Add the file to the ticket's frozen manifest if the ticket is already past gate 1 (owner unlock required).
