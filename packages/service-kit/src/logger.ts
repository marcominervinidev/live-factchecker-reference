// The two output channels of a service (.claude/rules/platform.md, "Logging and health"). Log events are one
// JSON object per line on stdout with a closed field set: a caller sets only the fields of CALLER_FIELDS, `time`
// and `service` come from the logger, there are no free fields. Free text fits only into `event` and `sessionId`,
// both capped at MAX_TEXT_LENGTH; never put a transcript, a segment, a name or a secret there. `segmentId` (#27,
// the id of a Segment), `turnId` (#28, the id of a Turn) and the four labels of a model call (`modelRole`,
// `modelId`, `adapter`, `outcome`) are identifiers (LABEL_PATTERN), so neither an error text nor a name fits into
// them; `turnId` came with #28 (`tick.skipped`, `extractor.failed`), a named deviation from the ticket's "no new
// fields", approved by the owner at gate 1 on 2026-10-29 (.claude/frozen/28.json ownerDecisions). #29 adds the ids
// `claimId` and `candidateId` (labels), `attempts` (a count) and `reason`, a code such as `kern_unklar` or
// `refersTo_fehlt` (an identifier: letters, digits, `_`), never text (ticket #29, Contracts, "Log format"). Counts
// (`durationMs`, the token fields of a model call) are whole numbers of at least 0, `costUsd` a finite number of at
// least 0. #32 adds `final` (a boolean: whether a call was the final analysis of its Turn) and `unknownTags` (a count
// of tags the Topic Extractor named that the tag list does not hold), never the tags. The second channel is stderr,
// for a configuration error before the service runs; it names the variable only.
import { ConfigError } from './config.ts';

const CALLER_FIELDS = {
  event: 'text',
  segmentId: 'label', // #27: the id of a Segment (`s-<digits>`), never its words or its Speaker
  sessionId: 'text',
  turnId: 'label', // #28: the id of a Turn (`t-<digits>`), never its words or its Speaker
  durationMs: 'count',
  costUsd: 'amount',
  // One model call (#26), written by model-call.ts.
  modelRole: 'label',
  modelId: 'label',
  adapter: 'label',
  outcome: 'label',
  // #29: the Claim Extractor's call, its Claims and Candidates.
  claimId: 'label',
  candidateId: 'label',
  reason: 'code',
  attempts: 'count',
  inputTokens: 'count',
  cacheReadTokens: 'count',
  cacheWriteTokens: 'count',
  outputTokens: 'count',
  thinkingTokens: 'count',
  // #32: the Topic Extractor's call.
  final: 'flag',
  unknownTags: 'count',
} as const;

type Field = keyof typeof CALLER_FIELDS;
type Kind = (typeof CALLER_FIELDS)[Field];
type Value<K extends Kind> = K extends 'text' | 'label' | 'code'
  ? string
  : K extends 'flag'
    ? boolean
    : number;

/** Derived from CALLER_FIELDS, so the type and the runtime check cannot drift apart. */
export type LogFields = { readonly event: string } & {
  readonly [F in Exclude<Field, 'event'>]?: Value<(typeof CALLER_FIELDS)[F]>;
};

export interface Logger {
  /** Writes one line, or throws an Error naming the refused field and writes nothing. */
  log(fields: LogFields): void;
}

export interface LoggerOptions {
  readonly service: string;
  /** Receives each finished line, newline included; stdout when not given. */
  readonly write?: ((line: string) => void) | undefined;
}

const MAX_TEXT_LENGTH = 64;
/** Lower case, digits and `._:@/-`, starting with a letter or digit, at most 64 characters: no spaces, no prose. */
const LABEL_PATTERN = /^[a-z0-9][a-z0-9._:@/-]{0,63}$/;
/** A reason code: a letter, then letters, digits and `_`, at most 64 characters (camelCase as in `refersTo_fehlt`). */
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

const VALID: Readonly<Record<Kind, (value: unknown) => boolean>> = {
  text: (value) => typeof value === 'string' && value.length <= MAX_TEXT_LENGTH,
  label: (value) => typeof value === 'string' && LABEL_PATTERN.test(value),
  code: (value) => typeof value === 'string' && CODE_PATTERN.test(value),
  count: (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
  amount: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  flag: (value) => typeof value === 'boolean',
};

const PROBLEM: Readonly<Record<Kind, string>> = {
  text: `must be a string of at most ${MAX_TEXT_LENGTH} characters`,
  label: `must match ${String(LABEL_PATTERN)}`,
  code: `must match ${String(CODE_PATTERN)}`,
  count: 'must be a whole number of at least 0',
  amount: 'must be a finite number of at least 0',
  flag: 'must be a boolean',
};

/** A field name that is safe to repeat in an error; anything else may be text the caller should not have logged. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The one wording of a refused field, for the logger and the model call record (model-call.ts). */
export function refuseField(field: string, problem: string): never {
  // IDENTIFIER is anchored, one class with a bounded {0,63}, no nesting: linear, gives up after 64 characters.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
  const name = IDENTIFIER.test(field)
    ? `field "${field}"`
    : `a field that is not an identifier (${field.length} characters)`;
  throw new Error(`${name} ${problem}`);
}

function isField(field: string): field is Field {
  return Object.hasOwn(CALLER_FIELDS, field);
}

function checkField(field: string, value: unknown): void {
  if (!isField(field)) refuseField(field, 'is not an allowed log field');
  const kind = CALLER_FIELDS[field];
  if (value !== undefined && !VALID[kind](value)) refuseField(field, PROBLEM[kind]);
}

function checked(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields)) {
    checkField(field, value);
    if (value !== undefined) entry[field] = value;
  }
  if (entry['event'] === undefined || entry['event'] === '') refuseField('event', 'is required');
  return entry;
}

/** The default sink of a finished stdout line; inside the kit only (model-call.ts writes its metric line here). */
export function writeStdout(line: string): void {
  process.stdout.write(line);
}

/**
 * Checks the fields and returns the finished line without writing it, or throws naming the refused field; inside
 * the kit only (model-call.ts checks a model call's values here before it writes or counts anything).
 */
export function formatLogLine(service: string, fields: Readonly<Record<string, unknown>>): string {
  const entry = checked(fields);
  return `${JSON.stringify({ time: new Date().toISOString(), service, ...entry })}\n`;
}

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? writeStdout;
  return {
    log(fields) {
      write(formatLogLine(options.service, fields));
    },
  };
}

/** One stderr line for an invalid configuration: the variable's name and a fixed text, never a value. */
export function writeConfigError(service: string, error: unknown): void {
  const detail = error instanceof ConfigError ? `, check ${error.variable}` : '';
  process.stderr.write(`${service}: invalid configuration${detail}\n`);
}
