# @lfc/service-kit

## Purpose
The runtime every Node service shares (`.claude/rules/platform.md`, "Logging and health"): the JSON logging module,
configuration from the environment, the probe endpoints `/health` and `/ready`, and the start and stop of a service.

- `src/logger.ts`: `createLogger({ service, write? })`; one JSON object per line on stdout with `time`, `service`,
  `event` and, when given, `sessionId`, `segmentId` (#27: a Segment's id, never its words or Speaker), `turnId` (#28: a
  Turn's id, never its words or Speaker), `durationMs`, `costUsd`, the fields of a model call (Contract) and those of
  the Claim Extractor (#29): `claimId` and `candidateId` (ids such as `c-01`, `k-01`), `attempts` (a count) and
  `reason` (a code such as `kern_unklar` or `refersTo_fehlt`, never text). The field set is closed (`CALLER_FIELDS`,
  from which the type is derived): any other field, a missing or empty `event`, a text over 64 characters, a negative
  amount, a `durationMs`, `attempts` or token count that is not a whole number, a `segmentId`, a `turnId`, a
  `claimId`, a `candidateId` or a label of a model call (`modelRole`, `modelId`, `adapter`, `outcome`) outside
  `^[a-z0-9][a-z0-9._:@/-]{0,63}$`, or a `reason` outside the code pattern `^[A-Za-z][A-Za-z0-9_]{0,63}$` (the only
  kind that takes upper case, no spaces) throws an Error naming the field, and nothing is written. A field name that is not an identifier (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`) is never
  echoed, the Error gives only its length. Free text fits only into `event` and `sessionId`.
  `writeConfigError(service, error)` is the only other output: one stderr line naming the variable, never a value.
- `src/config.ts`: `requireEnv`, `readSecretFile` (`<NAME>_FILE`: a regular file of at most 4 KiB, exactly one
  trailing newline dropped, not empty), `loadServiceConfig` (`PORT` 1 to 65535; refuses `DEBUG` and `NODE_DEBUG`,
  whose library output can print secrets); a `ConfigError` names the variable, never a value or a path.
- `src/health.ts` (internal, used by `runService`): `/health` is 200 while the process runs and checks nothing;
  `/ready` runs one check per dependency (2 s timeout) and names each `ok` or `failed`, 200 only when all are `ok`
  and the service is not stopping.
- `src/lifecycle.ts`: `runService({ port, logger, checks, routes?, close, signals?, exit? })`; `routes` (a Node request
  listener) answers every request that is not `GET /health` or `GET /ready`, without it such a request gets 404; after
  SIGTERM a routed answer closes its connection too. The server cuts a request that is not complete after 10 s or
  whose headers are not after 5 s (408) and holds at most 256 sockets (`MAX_CONNECTIONS`). On
  SIGTERM `server.close()` closes the listener at once, so new connections are refused; only requests on open
  keep-alive connections still arrive, and `/ready` answers them 503 `stopping`. Running requests finish (cut after
  5 s), then `close` releases the dependencies, one `service.stopped` event is logged and the process exits 0. 9 s
  after SIGTERM at the latest it logs `service.stop_failed` and exits 1.
- `src/model-call.ts`: `createModelCallRecorder({ service, write?, counter? })` with `record(call)` and
  `totals(sessionId)`; `counter` is a `SessionCounter` (`add`, `totals`), by default one in process memory.
  `record` takes only a plain object (prototype `Object.prototype`) and reads each field once; it refuses any other
  value, a field outside the list of a model call or a missing one with an Error naming the field (a name that is
  not an identifier only by its length), then
  adds the tokens and cost to the Session counter and writes the log line and the metric line (Contract), counting
  first so that a failing sink cannot lose a count; a refused call writes nothing and counts nothing. `totals` is
  zero for a Session without calls.
- `src/testing/probe-body.ts` (export `@lfc/service-kit/testing`): test helper for the `/ready` body; production code
  never imports it.

## Contract
Internal format of the stdout stream, not a public contract (#26); frozen for T7 at T7's gate 1. One model call
writes exactly these two lines (values are examples; the lists of model roles, adapters and outcomes are T7's):

```json
{"time":"2026-10-28T09:00:00.000Z","service":"detection","event":"model.called","sessionId":"s-1","modelRole":"claim_extractor","modelId":"claude-haiku-5-5","adapter":"anthropic","inputTokens":1840,"cacheReadTokens":1536,"cacheWriteTokens":0,"outputTokens":212,"thinkingTokens":0,"durationMs":1730,"costUsd":0.00214,"outcome":"ok"}
{"time":"2026-10-28T09:00:00.000Z","service":"detection","event":"metric","name":"model.call","labels":{"service":"detection","modelRole":"claim_extractor","modelId":"claude-haiku-5-5"},"values":{"inputTokens":1840,"cacheReadTokens":1536,"cacheWriteTokens":0,"outputTokens":212,"thinkingTokens":0,"costUsd":0.00214}}
```

- Every metric line has `event: "metric"` and its own `name`; labels never hold the Session id, values only numbers.
- The log line and the metric line each carry their own `time`, taken when the line is built; the two can differ by
  a millisecond or so.
- The Session counter is the running sum per Session: it adds exactly the `values` of the metric line, so a
  Session's `totals` and the summed metrics of its calls agree. The quota per account (ADR 0005, #13) keeps its own
  counter in the account database and takes this record per call as its source. The default counter lives in process
  memory per recorder: one replica only, and it keeps a Session's totals until the process ends.

## Boundaries
Base layer: imports only Node built-ins and `packages/*` (`.dependency-cruiser.cjs`, `packages-only-packages`). No
client for a particular dependency: a service brings its own (the detection service brings Redis) and hands the kit a
check and a close function. Source is run directly by Node's type stripping; there is no build step.

## Pitfalls

- An error that is caught and not rethrown leaves its class in the log as `reason` (`errorCode`), never its text or its `code`: a text can name a host, a path or protected data. `isProgrammingError` tells a mistake in the code from a failed dependency.
- Background work (a stream consumer, a timer loop) must end inside `close`, before the connection it uses is closed
  (`quit()`); explicit lifecycle phases come with T3.
- Never `console` or `process.stdout`/`process.stderr` in a service (ESLint refuses them); log through
  `createLogger`. A field that is not in the set is a programming error,
  not something to redact: extend the list in its own ticket.
- Never put a value, a path or an error text of a dependency into a config error, a log line or the `/ready` body.
- Model calls only through `createModelCallRecorder`, never with the token fields through `createLogger`: only the
  recorder writes the metric and counts the call for its Session.
- TypeScript here is run by Node's type stripping: erasable syntax only (`erasableSyntaxOnly`).

## Commands
- `scripts/tb pnpm --filter @lfc/service-kit run test:unit` (stage 1)
- `scripts/tb pnpm --filter @lfc/service-kit run typecheck`
- `scripts/tb pnpm --filter @lfc/service-kit run test:mutation` (Stryker, nightly only; minutes)
