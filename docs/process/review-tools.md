# Review tools

Short form for readers in the repo. Decision: ticket "PR-Format, Größe, Commits und Gates" (`docs/process/pr-format.md`), set up in "Review-Werkzeuge einrichten" (#116); tool facts: planning repo `docs/research/review-werkzeuge.md`. Stages: `docs/process/test-strategy.md`.

## Who checks what, where

| Tool | Finds | Local | Stage 0 / pre-commit | PR (`pr.yml`) | Nightly | Config |
|---|---|---|---|---|---|---|
| Fallow | dead code, cycles, boundaries, duplicates, complexity | MCP server, agent commit gate | – | `fallow audit --gate new-only`, PR comment, **blocks** on new findings | `audit --gate all`, report | `.fallowrc.json` |
| dependency-cruiser | cycles and zone boundaries | `pnpm depcruise` | **blocks** (lefthook, `ci.yml` static) | – | – | `.dependency-cruiser.cjs` |
| Knip | dead code (counter-check while Fallow is young) | `pnpm exec knip` | – | – (nightly only) | report | `knip.json` |
| StrykerJS | surviving mutants | `pnpm --filter <pkg> test:mutation` | – | – until the first retro sets `break` per package; then `--incremental` on changed packages, survivors in the PR | changed packages, all on Sundays | `<pkg>/stryker.config.mjs` from `tools/templates/` |
| SonarQube Cloud | bugs, smells, secrets, taint, duplication | – | – | runs in `ci.yml` on push, advisory until the owner decides (`docs/process/due.md`), then Quality Gate on new code | – | `sonar-project.properties` |

Zones (same in Fallow and dependency-cruiser): `apps/*` → `packages/*`; `services/*` → `packages/*` (never another service, never apps); `packages/*` → `packages/*` only; `tests/*` → `packages/*` and test helpers, never service or app code; `evals/` is outside the graph. Cycles and dead code start with Fallow; dependency-cruiser stays only until Fallow's boundaries have caught the same violations on real code for one increment (increment 1 has none yet), then its removal is an owner decision in a PR; Knip runs nightly only, never in the PR.

Fallow health thresholds are the defaults (cyclomatic 20, cognitive 15, CRAP 30, function length 60 lines; tests 500). Findings in `*.test.ts` and `tests/fixtures/` are not reported as dead code; boundary violations are reported everywhere. Step definitions (`**/features/steps/**`, `tests/**/steps/**`) may reach CRAP 100, because Fallow estimates CRAP without coverage and a step runs only through its scenarios; fixture helpers under `tests/fixtures/**` may reach CRAP 150 for the same reason (frozen helpers of the test designer, to be confirmed by the owner at gate 2 of #27 task 2); unused exports of test helpers (`**/src/testing/**`, `tests/**/steps/support/**`) are warnings, because a frozen helper may export what a later task uses (owner decision 2026-11-02).

## Local setup (once, inside the toolbox)

`fallow` is a devDependency of the root package, pinned to the version the action uses (`3.34.1`).

```sh
npx fallow agent install --dry-run   # show the plan
npx fallow agent install             # skills, .mcp.json entry, AGENTS.md task map, commit gate
fallow hooks install --target agent  # only the commit gate, if agent install was skipped
fallow agent status                  # what is installed
```

`.mcp.json` (checked in) starts the MCP server through pnpm because a devDependency binary is not on `PATH`:

```json
{ "mcpServers": { "fallow": { "command": "pnpm", "args": ["exec", "fallow-mcp"] } } }
```

Claude Code asks once before it starts a project MCP server. Tools: `analyze`, `check_changed`, `find_dupes`, `check_health`, `audit`, `check_architecture`, `fix_preview`, `fix_apply`, `symbol_impact`, `impact_closure`. Never run `fallow watch` in an agent loop; it does not exit.

## The agent commit gate

`fallow hooks install --target agent` adds a `PreToolUse` hook on `Bash` to `.claude/settings.json` plus `.claude/hooks/fallow-gate.sh`. When the agent runs `git commit` or `git push`, the hook runs `fallow audit --format json --quiet --explain --gate-marker agent` against the merge-base with `origin/main`: `pass` or `warn` continue, `fail` blocks and hands the findings to the agent. Runtime errors (no history yet, bad ref) do not block. It needs `jq` on `PATH`; without it the gate skips silently.

- The installer edits `.claude/settings.json` and adds a hook file: both are owner-reviewed paths (CODEOWNERS), and the new hook must be added to `.claude/hooks/test-hooks.sh`.
- Disable the plugin gate of the `fallow-skills` Claude Code plugin with `FALLOW_PLUGIN_GATE=off`; remove the project gate with `fallow hooks uninstall --target agent`.
- The gate is comfort; the real gate is the `fallow` job in `pr.yml`.

## Telemetry and cost

Fallow telemetry is opt-in and off by default; CI and the toolbox set `FALLOW_TELEMETRY_DISABLED=1` as a kill switch anyway. The action posts with `branded-token: false`, so nothing goes to `api.fallow.cloud`. Fallow, Knip, dependency-cruiser and Stryker are free and local; SonarQube Cloud Free costs nothing up to 50 000 lines in a private repo.

## Commands

```sh
pnpm depcruise                           # stage 0 boundaries and cycles
pnpm exec fallow audit                   # what CI will say about this branch
pnpm exec fallow architecture --boundaries
pnpm exec knip --cycles                  # counter-check
pnpm --filter <pkg> test:mutation        # Stryker for one package
python3 -I tools/usage_from_logs.py --project ~/.claude/projects/<encoded-repo-path> --since <iso> \
  --out .claude/scratch/balance/<issue>/usage.json   # tokens and cost per role for the agent balance
```
