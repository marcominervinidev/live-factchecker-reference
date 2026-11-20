// Stage 1, issue #26 (T1b), Task 1: the logger edge cases that gate 1 of #25 moved to T1b (#25, gate-1 comment,
// decision 4): `time` and `service` set by the caller, an empty `event`, NaN, Infinity or a non-number refused with
// the field's name, `durationMs` an integer, `costUsd` at least 0. Interface as in logger.test.ts (#25):
// createLogger({ service, write? }).log(fields); a refused event throws an Error naming the field and writes nothing.
// Most rows already hold on the T1 logger; they are pinned here because the gate decided them. Red on the T1 tree:
// the non-integer durationMs row. The negative costUsd row is in logger.test.ts (#25) and is not repeated.
import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.ts';

type LogFields = Parameters<ReturnType<typeof createLogger>['log']>[0];

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

describe('createLogger: fields only the logger sets', () => {
  it.each([
    { field: 'time', value: '1999-01-01T00:00:00.000Z' },
    { field: 'service', value: 'someone-else' },
  ])('refuses $field set by the caller, names it and writes nothing', ({ field, value }) => {
    const { lines, log } = capture();
    expect(() => {
      log({ event: 'cache.hit', [field]: value });
    }).toThrow(field);
    expect(lines).toEqual([]);
  });
});

describe('createLogger: event', () => {
  it('refuses an empty event, names it and writes nothing', () => {
    const { lines, log } = capture();
    expect(() => {
      log({ event: '' });
    }).toThrow('event');
    expect(lines).toEqual([]);
  });
});

describe('createLogger: amounts', () => {
  it.each([
    { invalidClass: 'NaN', field: 'durationMs', value: Number.NaN },
    { invalidClass: 'Infinity', field: 'durationMs', value: Number.POSITIVE_INFINITY },
    { invalidClass: 'a numeric string', field: 'durationMs', value: '840' },
    { invalidClass: 'a non-integer', field: 'durationMs', value: 0.5 },
    { invalidClass: 'NaN', field: 'costUsd', value: Number.NaN },
    { invalidClass: 'Infinity', field: 'costUsd', value: Number.POSITIVE_INFINITY },
    { invalidClass: '-Infinity', field: 'costUsd', value: Number.NEGATIVE_INFINITY },
    { invalidClass: 'a numeric string', field: 'costUsd', value: '0.01' },
  ])('refuses $field as $invalidClass, names it and writes nothing', ({ field, value }) => {
    const { lines, log } = capture();
    expect(() => {
      log({ event: 'model.called', [field]: value });
    }).toThrow(field);
    expect(lines).toEqual([]);
  });

  it('accepts a whole durationMs next to a fractional costUsd', () => {
    const { lines, log } = capture();
    log({ event: 'model.called', durationMs: 2, costUsd: 0.5 });
    expect(lines).toHaveLength(1);
  });
});
