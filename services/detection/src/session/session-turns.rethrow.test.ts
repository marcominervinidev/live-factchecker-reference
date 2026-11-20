// Stage 1, issue #29 (T4), Task 3: the Session catches a rejection of tick() (AC22, the condition under which
// Marco accepted decision 3 of the gate-1 addendum 2 of #28 on 2026-11-03, issue #29 comment of that day: "tick() lässt
// alle Lanes des Ticks settlen, loggt extractor.failed (nur sessionId, modelRole, turnId) und lehnt dann mit dem ersten
// Originalfehler ab ... unter der Bedingung: #29 fängt Ablehnungen von tick()", because an unhandled rejection ends the
// Node process).
// AC22 (gate 1, owner 2026-11-03, question 7: "Angenommen, mit Log-Ereignis `tick.failed`"): "When tick() rejects (an extractor threw or rejected, a programming error), the Session catches the
// rejection, logs it once with the Session id and the Turn id and never with the error text or Transcript text, and
// keeps running: later Segments are accepted, later Ticks reach both extractors, and the end of the Input resolves."
//
// Interface: createSessionTurns of src/session/session-turns.ts as #28 task 3 defines it (frozen
// features/steps/turn-building.steps.ts of #28: createSessionTurns({ sessionId, parameters, extractors, logger }) ->
// { accept(segment): Promise<void>; end(): Promise<void>; turns; ticks; skippedTicks }), which #29 task 3 wires into
// the Session routes; this file adds the catch. Log event (gate 1, owner 2026-11-03, question 7): `tick.failed` with sessionId and turnId,
// next to the scheduler's own `extractor.failed` (unchanged, #28).
// Fakes only at the extractor port: a Claim Extractor that throws once, on its first call.
import { createSessionTurns } from './session-turns.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '@lfc/service-kit';
import { seg, sid, START_VALUES } from '../testing/turns.ts';
import type { Extractor, ExtractorCall, ExtractorName } from '../turns/tick-scheduler.ts';

const SESSION = '29a0c0de-0000-4000-8000-000000000061';
const TRANSCRIPT_WORD = 'Mietpreisbremse';

// Turn 1 by A (two Segments, 6 s of speech: one non-final Tick at 5 s and the final analysis), Turn 2 by B, Turn 3 by A.
const SEGMENTS = [
  seg(sid(1), 'A', 0, 3, 3.5, `Die ${TRANSCRIPT_WORD} wirkt kaum`),
  seg(sid(2), 'A', 3, 6, 6.5, 'sagt die Statistik'),
  seg(sid(3), 'B', 6.5, 9, 9.5, 'das stimmt so nicht'),
  seg(sid(4), 'A', 9.5, 12, 12.5, 'doch das stimmt'),
];

interface Seen {
  readonly extractor: ExtractorName;
  readonly turn: string;
  readonly final: boolean;
}

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
});

function extractors(seen: Seen[], throwOnFirst: ExtractorName): Record<ExtractorName, Extractor> {
  let thrown = false;
  const make = (name: ExtractorName): Extractor => ({
    call({ turn, final }: ExtractorCall) {
      seen.push({ extractor: name, turn: turn.id, final });
      if (name === throwOnFirst && !thrown) {
        thrown = true;
        return Promise.reject(new Error(`programming error near "${TRANSCRIPT_WORD}"`));
      }
      return Promise.resolve({ latencySeconds: 0.5 });
    },
  });
  return { claim_extractor: make('claim_extractor'), topic_extractor: make('topic_extractor') };
}

async function replay(throwOnFirst: ExtractorName) {
  const seen: Seen[] = [];
  const lines: string[] = [];
  const session = createSessionTurns({
    sessionId: SESSION,
    parameters: START_VALUES,
    extractors: extractors(seen, throwOnFirst),
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  const outcomes: string[] = [];
  for (const segment of SEGMENTS) {
    outcomes.push(
      await session.accept(segment).then(
        () => 'resolved',
        () => 'rejected',
      ),
    );
  }
  outcomes.push(
    await session.end().then(
      () => 'resolved',
      () => 'rejected',
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { seen, lines, outcomes, session };
}

/** A log line without the logger's own fields `time` and `service`. */
function withoutTimeAndService(line: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(line).filter(([name]) => name !== 'time' && name !== 'service'),
  );
}

describe('the Session catches a rejection of tick() and keeps running (AC22)', () => {
  it.each(['claim_extractor', 'topic_extractor'] as const)(
    'when the %s throws on its first call, every accept and the end resolve and nothing is unhandled',
    async (name) => {
      const { outcomes } = await replay(name);
      expect(outcomes).toEqual(Array(SEGMENTS.length + 1).fill('resolved'));
      expect(unhandled).toEqual([]);
    },
  );

  it('keeps calling both extractors for the later Ticks: every Turn still gets its final analysis', async () => {
    const { seen, session } = await replay('claim_extractor');
    const finals = (name: ExtractorName) =>
      seen
        .filter((s) => s.extractor === name && s.final)
        .map((s) => s.turn)
        .sort();
    const turnIds = session.turns.map((t) => t.id).sort();
    expect(turnIds).toHaveLength(3);
    expect(finals('claim_extractor')).toEqual(turnIds);
    expect(finals('topic_extractor')).toEqual(turnIds);
  });

  it('logs the caught rejection once, with the Session id and the Turn id only', async () => {
    const { lines, seen } = await replay('claim_extractor');
    const failedTurn = seen.find((s) => s.extractor === 'claim_extractor')?.turn;
    const caught = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l['event'] === 'tick.failed');
    expect(caught).toHaveLength(1);
    const fields = withoutTimeAndService(caught[0]);
    expect(fields).toEqual({ event: 'tick.failed', sessionId: SESSION, turnId: failedTurn });
  });

  it('writes neither the error text nor a Transcript word into any log line', async () => {
    const { lines } = await replay('claim_extractor');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(TRANSCRIPT_WORD);
      expect(line).not.toContain('programming error');
      expect(line).not.toContain('Statistik');
    }
  });
});
