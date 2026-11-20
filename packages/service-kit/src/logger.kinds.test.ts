// Stage 1, issue #26 task 1 (implementer-owned): the kinds of a log field (label, count, required event), a refused
// field and an optional field set to undefined, through the public createLogger interface only. A refusal is checked
// by what the README promises (an Error naming the field, a name that is not an identifier only by its length,
// nothing written), never by the wording of the sentence. The frozen tests of #25 and #26 stay as they are.
import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.ts';

type LogFields = Parameters<ReturnType<typeof createLogger>['log']>[0];

/** An untyped caller: the cases below pass values the LogFields type would reject. */
function capture(): { lines: string[]; log: (fields: Record<string, unknown>) => void } {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'kit-26',
    write: (line: string) => {
      lines.push(line);
    },
  });
  return {
    lines,
    log: (fields) => {
      logger.log(fields as unknown as LogFields);
    },
  };
}

/** The message of the Error the call throws; fails the test when it throws nothing or something else. */
function refusalOf(call: () => void): string {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error instanceof Error ? error.message : '';
  }
  throw new Error('expected a refusal, but nothing was thrown');
}

/** The fields among `candidates` that the message names as a whole word. */
function namedFields(message: string, candidates: Iterable<string>): string[] {
  const words = new Set(message.match(/[A-Za-z_][A-Za-z0-9_]*/g));
  return [...candidates].filter((field) => words.has(field));
}

describe('createLogger: a label is a string', () => {
  it.each([
    { name: 'a number', value: 42 },
    { name: 'null', value: null },
    { name: 'a boolean', value: true },
    { name: 'an array', value: ['a'] },
  ])('refuses $name as modelId, names it and writes nothing', ({ value }) => {
    const { lines, log } = capture();
    const fields = { event: 'model.called', modelId: value };
    const message = refusalOf(() => {
      log(fields);
    });
    expect(namedFields(message, Object.keys(fields))).toEqual(['modelId']);
    expect(lines).toEqual([]);
  });
});

describe('createLogger: a refused field is named, its value never echoed', () => {
  it('refuses a field name that is not an identifier by its length only, without echoing it', () => {
    const { lines, log } = capture();
    const fields = { event: 'cache.hit', 'zwei Wörter': 'x' };
    const message = refusalOf(() => {
      log(fields);
    });
    expect(message).toMatch(/\b11\b/);
    expect(message).not.toContain('zwei');
    expect(message).not.toContain('Wörter');
    expect(namedFields(message, Object.keys(fields))).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('refuses an unknown identifier field, names it and does not echo its value', () => {
    const { lines, log } = capture();
    const fields = { event: 'cache.hit', transcript: 'the speaker said the tax rose' };
    const message = refusalOf(() => {
      log(fields);
    });
    expect(namedFields(message, Object.keys(fields))).toEqual(['transcript']);
    expect(message).not.toContain('the speaker said the tax rose');
    expect(lines).toEqual([]);
  });

  it('refuses a label outside the label pattern, names it and does not echo it', () => {
    const { lines, log } = capture();
    const fields = { event: 'model.called', modelId: 'Not A Label' };
    const message = refusalOf(() => {
      log(fields);
    });
    expect(namedFields(message, Object.keys(fields))).toEqual(['modelId']);
    expect(message).not.toContain('Not A Label');
    expect(lines).toEqual([]);
  });

  it('refuses a negative count, names it and does not echo it', () => {
    const { lines, log } = capture();
    const fields = { event: 'cache.hit', durationMs: -1 };
    const message = refusalOf(() => {
      log(fields);
    });
    expect(namedFields(message, Object.keys(fields))).toEqual(['durationMs']);
    expect(message).not.toContain('-1');
    expect(lines).toEqual([]);
  });

  it('refuses a line without event and names event', () => {
    const { lines, log } = capture();
    const message = refusalOf(() => {
      log({ sessionId: 's-1' });
    });
    expect(namedFields(message, ['event', 'sessionId'])).toEqual(['event']);
    expect(lines).toEqual([]);
  });
});

describe('createLogger: an optional field set to undefined', () => {
  it('omits sessionId set to undefined instead of refusing it', () => {
    const { lines, log } = capture();
    log({ event: 'cache.hit', sessionId: undefined });
    expect(lines).toHaveLength(1);
    const entry: unknown = JSON.parse(lines[0] ?? '');
    expect(entry).toMatchObject({ service: 'kit-26', event: 'cache.hit' });
    expect(entry).not.toHaveProperty('sessionId');
  });
});

// #29 task 3 (implementer-owned, review finding M2): the fields of the Claim Extractor. `reason` is a code (letters,
// digits, `_`; the only kind that takes upper case), `claimId` and `candidateId` are labels, `attempts` a count.
describe('createLogger: the fields of the Claim Extractor (#29)', () => {
  it.each(['refersTo_fehlt', 'ungueltig', 'kern_unklar'])('takes the reason code %s', (reason) => {
    const { lines, log } = capture();
    log({ event: 'claim_extractor.dropped', reason });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ reason });
  });

  it.each([
    ['a space', 'kern unklar'],
    ['a hyphen', 'refersTo-fehlt'],
    ['a leading digit', '1abc'],
    ['65 characters', `a${'b'.repeat(64)}`],
    ['a number', 7],
  ])('refuses a reason with %s, names it and writes nothing', (_, reason) => {
    const { lines, log } = capture();
    const fields = { event: 'claim_extractor.dropped', reason };
    const message = refusalOf(() => {
      log(fields);
    });
    expect(namedFields(message, Object.keys(fields))).toEqual(['reason']);
    if (typeof reason === 'string') expect(message).not.toContain(reason);
    expect(lines).toEqual([]);
  });

  it('takes attempts, claimId and candidateId in their forms', () => {
    const { lines, log } = capture();
    log({ event: 'claim_extractor.call', attempts: 2, claimId: 'c-01', candidateId: 'k-01' });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      attempts: 2,
      claimId: 'c-01',
      candidateId: 'k-01',
    });
  });

  it.each([
    ['attempts', -1],
    ['attempts', 1.5],
    ['claimId', 'C-01'],
    ['candidateId', 'K-01'],
  ])('refuses %s = %j, names it and writes nothing', (field, value) => {
    const { lines, log } = capture();
    const fields = { event: 'claim_extractor.call', [field]: value };
    const message = refusalOf(() => {
      log(fields);
    });
    expect(namedFields(message, Object.keys(fields))).toEqual([field]);
    expect(lines).toEqual([]);
  });
});
