// Stage-2a steps for Turn building and the Tick plan in a Session (issue #28, T3, Task 3; feature
// features/turn-building.feature). In-process: the recording fixture is cut by tests/fixtures/golden-window.mjs (run
// as a child process, a reference to the Golden Set, never a copy), replayed through T2's STT-recording Input into the
// Session's Turn building, with fake extractors on the Session clock. No HTTP and no Redis: the Session part this
// ticket adds lives in process memory (ticket #28: "exposes Turns, Ticks and skip counts in-process").
// Extends the step library of features/steps/detection.steps.ts (#25): it uses that World's `lines` for the log lines,
// and the shared helper features/support/service.ts (#27) for the test project's Redis settings that loadConfig needs.
// Steps observe behaviour only: the Session's Turns, Ticks and skip counts, the calls the fakes received, the log lines.
//
// Interface these steps define (built in Task 3), next to the unit-test interfaces of src/turns/:
//   src/session/session-turns.ts
//     export function createSessionTurns(options: {
//       sessionId: string;
//       parameters: TurnParameters;                              // from loadConfig(env).turnParameters
//       extractors: Readonly<Record<ExtractorName, Extractor>>;  // the ports of src/turns/tick-scheduler.ts
//       logger: Logger;                                          // @lfc/service-kit
//     }): {
//       accept(segment: Segment): Promise<void>;   // one finalized Segment from the segment seam, in seam order
//       end(): Promise<void>;                      // the end of the Input; resolves once every call has returned
//       readonly turns: readonly EndedTurn[];      // the Turns whose end is known (after end(): every Turn)
//       readonly ticks: readonly Tick[];           // every Tick, in the order it fell due
//       readonly skippedTicks: Readonly<Record<ExtractorName, number>>;
//     }
//   @lfc/inputs exports sttRecordingInput from its root (T2, Task 2; interface in packages/inputs/src/stt-recording.test.ts).
// "Turn <n>" is the n-th Turn in seam order of its first Segment.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSessionTurns } from '../../src/session/session-turns.ts';
import { loadConfig } from '../../src/config.ts';
import { testProjectRedis } from '../support/service.ts';
import { DataTable, Given, Then, When, defineParameterType, type World } from '@cucumber/cucumber';
import { sttRecordingInput } from '@lfc/inputs';
import { createLogger } from '@lfc/service-kit';
import type { Segment } from '@lfc/contracts';
import type { Tick } from '../../src/turns/tick-plan.ts';
import type { Extractor, ExtractorName } from '../../src/turns/tick-scheduler.ts';
import type { EndedTurn, TurnParameters } from '../../src/turns/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SESSION_ID = '28a0c0de-0000-4000-8000-000000000002';
const PRECISION = 0.001; // finalizedAt as T2 pins it (packages/inputs/src/stt-recording.test.ts)

interface Call {
  readonly extractor: ExtractorName;
  readonly turn: string;
  readonly segments: readonly string[];
  readonly final: boolean;
  readonly at: number;
}

interface SessionRun {
  readonly turns: readonly EndedTurn[];
  readonly ticks: readonly Tick[];
  readonly skippedTicks: Readonly<Record<ExtractorName, number>>;
}

/** The World of detection.steps.ts (its `lines`) plus the state of this file, set on the same object. */
interface TurnWorld extends World {
  lines: string[];
  recording?: string;
  turnParameters?: TurnParameters;
  latencies?: Partial<Record<ExtractorName, number>>;
  calls?: Call[];
  replayed?: Segment[];
  session?: SessionRun;
}

defineParameterType({
  name: 'extractor',
  regexp: /Claim Extractor|Topic Extractor/,
  transformer: (name: string): ExtractorName =>
    name === 'Claim Extractor' ? 'claim_extractor' : 'topic_extractor',
});

// ---- helpers ------------------------------------------------------------------------------------------------

function ran(world: TurnWorld): SessionRun {
  if (world.session === undefined) throw new Error('the recording fixture was not replayed');
  return world.session;
}

/** The Session's Turns in seam order of their first Segment: index n - 1 is "Turn n". */
function turnsInOrder(world: TurnWorld): EndedTurn[] {
  const first = (turn: EndedTurn) => Number((turn.segments[0]?.id ?? 's-0').slice(2));
  return [...ran(world).turns].sort((a, b) => first(a) - first(b));
}

function turnNumber(world: TurnWorld, n: number): EndedTurn {
  const turn = turnsInOrder(world)[n - 1];
  if (turn === undefined) throw new Error(`the Session has no Turn ${n}`);
  return turn;
}

function ordinalOf(world: TurnWorld): Map<string, number> {
  return new Map(turnsInOrder(world).map((turn, i) => [turn.id, i + 1]));
}

function fake(name: ExtractorName, latencySeconds: number, calls: Call[]): Extractor {
  return {
    call({ turn, segments, final, at }) {
      calls.push({
        extractor: name,
        turn: turn.id,
        segments: segments.map((s) => s.id),
        final,
        at,
      });
      return Promise.resolve({ latencySeconds });
    },
  };
}

function logEvents(world: TurnWorld): Record<string, unknown>[] {
  return world.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function close(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) <= PRECISION;
}

function finalCall(world: TurnWorld, extractor: ExtractorName, n: number): Call {
  const id = turnNumber(world, n).id;
  const finals = (world.calls ?? []).filter(
    (c) => c.extractor === extractor && c.turn === id && c.final,
  );
  if (finals.length !== 1)
    throw new Error(`${extractor}: ${finals.length} final analyses of Turn ${n}, expected 1`);
  const [only] = finals;
  if (only === undefined) throw new Error('no final analysis');
  return only;
}

// ---- steps --------------------------------------------------------------------------------------------------

Given('the recording fixture {string}', function (this: TurnWorld, reference: string) {
  this.recording = execFileSync(
    process.execPath,
    [join(ROOT, 'tests', 'fixtures', 'golden-window.mjs'), 'recording', reference],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
});

Given(
  'the Turn parameters of the configuration, none of them set',
  async function (this: TurnWorld) {
    // the service's environment of stage 2a (support/service.ts of #27), no Turn parameter in it
    const env = { PORT: '8080', ...testProjectRedis() };
    this.turnParameters = (await loadConfig(env)).turnParameters;
  },
);

Given(
  'a fake {extractor} that returns after {float} seconds',
  function (this: TurnWorld, extractor: ExtractorName, seconds: number) {
    this.latencies = { ...this.latencies, [extractor]: seconds };
  },
);

When(
  'the recording fixture is replayed into a Session through the STT-recording Input',
  async function (this: TurnWorld) {
    const claim = this.latencies?.claim_extractor;
    const topic = this.latencies?.topic_extractor;
    if (this.recording === undefined || this.turnParameters === undefined) {
      throw new Error('no recording fixture or no Turn parameters');
    }
    if (claim === undefined || topic === undefined)
      throw new Error('both fake extractors need a latency');
    const calls: Call[] = [];
    const session = createSessionTurns({
      sessionId: SESSION_ID,
      parameters: this.turnParameters,
      extractors: {
        claim_extractor: fake('claim_extractor', claim, calls),
        topic_extractor: fake('topic_extractor', topic, calls),
      },
      logger: createLogger({
        service: 'detection',
        write: (line) => {
          this.lines.push(line.trimEnd());
        },
      }),
    });
    const input = await sttRecordingInput({
      recording: this.recording,
      sessionId: SESSION_ID,
      language: 'de',
    });
    const replayed: Segment[] = [];
    for await (const segment of input.segments) {
      replayed.push(segment);
      await session.accept(segment);
    }
    await session.end();
    this.calls = calls;
    this.replayed = replayed;
    this.session = session;
  },
);

Then('the Session has these Turns:', function (this: TurnWorld, table: DataTable) {
  const actual = turnsInOrder(this).map((turn, i) => ({
    Turn: String(i + 1),
    Speaker: turn.speaker,
    Segments: turn.segments.map((s) => s.id).join(' '),
    'end reason': turn.endReason,
  }));
  const expected = table.hashes().map((row) => ({
    Turn: row['Turn'],
    Speaker: row['Speaker'],
    Segments: (row['Segments'] ?? '').trim().split(/\s+/).join(' '),
    'end reason': row['end reason'],
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Turns differ:\n${actual.map((t) => JSON.stringify(t)).join('\n')}\nexpected:\n${expected.map((t) => JSON.stringify(t)).join('\n')}`,
    );
  }
});

Then('no Turn of the Session is marked as interjection', function (this: TurnWorld) {
  const marked = ran(this).turns.filter((t) => t.interjection || t.endReason === 'interjection');
  if (marked.length > 0) throw new Error(`${marked.length} Turn(s) marked as interjection`);
});

Then('the Session has these Ticks:', function (this: TurnWorld, table: DataTable) {
  const ordinal = ordinalOf(this);
  const key = (t: { turn: number; at: number; final: boolean }) =>
    t.at * 1e6 + t.turn * 10 + (t.final ? 1 : 0);
  const actual = ran(this)
    .ticks.map((t) => ({
      turn: ordinal.get(t.turn.id) ?? -1,
      at: t.time,
      covers: t.upto,
      final: t.final,
    }))
    .sort((a, b) => key(a) - key(b));
  const expected = table
    .hashes()
    .map((row) => ({
      turn: Number(row['Turn']),
      at: Number(row['at']),
      covers: Number(row['covers']),
      final: row['final'] === 'yes',
    }))
    .sort((a, b) => key(a) - key(b));
  const same =
    actual.length === expected.length &&
    actual.every((a, i) => {
      const e = expected[i];
      return (
        e !== undefined &&
        a.turn === e.turn &&
        close(a.at, e.at) &&
        a.covers === e.covers &&
        a.final === e.final
      );
    });
  if (!same) {
    throw new Error(
      `Ticks differ:\n${actual.map((t) => JSON.stringify(t)).join('\n')}\nexpected:\n${expected.map((t) => JSON.stringify(t)).join('\n')}`,
    );
  }
});

Then(
  'the {extractor} was called once for every Tick',
  function (this: TurnWorld, extractor: ExtractorName) {
    const calls = (this.calls ?? []).filter((c) => c.extractor === extractor);
    const ticks = ran(this).ticks;
    if (calls.length !== ticks.length)
      throw new Error(`${extractor}: ${calls.length} calls for ${ticks.length} Ticks`);
    for (const turn of ran(this).turns) {
      const ownTicks = ticks.filter((t) => t.turn.id === turn.id).length;
      const ownCalls = calls.filter((c) => c.turn === turn.id).length;
      if (ownTicks !== ownCalls)
        throw new Error(`${extractor}: ${ownCalls} calls for ${ownTicks} Ticks of a Turn`);
    }
  },
);

Then(
  'every Turn got exactly one final analysis from each extractor, and each extractor got every Segment of the Turn once',
  function (this: TurnWorld) {
    for (const turn of ran(this).turns) {
      for (const extractor of ['claim_extractor', 'topic_extractor'] as const) {
        const own = (this.calls ?? []).filter(
          (c) => c.extractor === extractor && c.turn === turn.id,
        );
        const finals = own.filter((c) => c.final).length;
        const sent = own.flatMap((c) => c.segments).join(' ');
        const segments = turn.segments.map((s) => s.id).join(' ');
        if (finals !== 1)
          throw new Error(`${extractor}: ${finals} final analyses of the Turn ${segments}`);
        if (sent !== segments)
          throw new Error(`${extractor}: sent "${sent}" for the Turn "${segments}"`);
      }
    }
  },
);

Then(
  'the Session reports {int} skipped Tick(s) for the {extractor} and {int} for the {extractor}',
  function (
    this: TurnWorld,
    first: number,
    firstExtractor: ExtractorName,
    second: number,
    secondExtractor: ExtractorName,
  ) {
    const counts = ran(this).skippedTicks;
    if (counts[firstExtractor] !== first || counts[secondExtractor] !== second) {
      throw new Error(`the Session reports ${JSON.stringify(counts)}`);
    }
  },
);

Then(
  'exactly one {string} event names the Session, the {extractor} and Turn {int}',
  function (this: TurnWorld, event: string, extractor: ExtractorName, n: number) {
    const turnId = turnNumber(this, n).id;
    const events = logEvents(this).filter((e) => e['event'] === event);
    if (events.length !== 1) throw new Error(`expected one ${event} event, got ${events.length}`);
    const values = Object.values(events[0] ?? {});
    if (
      events[0]?.['sessionId'] !== SESSION_ID ||
      !values.includes(extractor) ||
      !values.includes(turnId)
    ) {
      throw new Error(`the ${event} event names ${JSON.stringify(events[0])}`);
    }
  },
);

Then(
  'that event carries the Session id, the extractor and the Turn id and nothing else',
  function (this: TurnWorld) {
    const [event] = logEvents(this).filter((e) => e['event'] === 'tick.skipped');
    const fields = Object.keys(event ?? {}).filter(
      (key) => !['time', 'service', 'event'].includes(key),
    );
    if (fields.length !== 3 || !fields.includes('sessionId')) {
      throw new Error(`the tick.skipped event carries the fields ${fields.join(', ')}`);
    }
  },
);

Then('no log line contains a word of the replayed Segments', function (this: TurnWorld) {
  const words = new Set(
    (this.replayed ?? [])
      .flatMap((s) => s.words.map((w) => w.w.replace(/[.,?!…:;"„“]+/g, '')))
      .filter((w) => w.length >= 4 && /\p{L}/u.test(w)),
  );
  if (words.size === 0) throw new Error('no Segment was replayed');
  const leaking = this.lines.filter((line) => [...words].some((word) => line.includes(word)));
  if (leaking.length > 0)
    throw new Error(`${leaking.length} log line(s) contain a word of the replayed Segments`);
});

Then('no log line is a {string} event', function (this: TurnWorld, event: string) {
  const found = logEvents(this).filter((e) => e['event'] === event);
  if (found.length > 0) throw new Error(`${found.length} ${event} event(s) were written`);
});

Then(
  "the {extractor}'s final analysis of Turn {int} started at {float} seconds with the Segments {string}",
  function (this: TurnWorld, extractor: ExtractorName, n: number, at: number, segments: string) {
    const call = finalCall(this, extractor, n);
    if (!close(call.at, at) || call.segments.join(' ') !== segments) {
      throw new Error(`${extractor}: final analysis of Turn ${n} was ${JSON.stringify(call)}`);
    }
  },
);

Then(
  "the {extractor}'s final analysis of Turn {int} started at {float} seconds with no Segment",
  function (this: TurnWorld, extractor: ExtractorName, n: number, at: number) {
    const call = finalCall(this, extractor, n);
    if (!close(call.at, at) || call.segments.length !== 0) {
      throw new Error(`${extractor}: final analysis of Turn ${n} was ${JSON.stringify(call)}`);
    }
  },
);
