// Stage 1, issue #25 (T1), AC1 and AC2: the JSON log line of the service kit (`.claude/rules/platform.md`,
// "Logging and health").
//
// Public interface these tests define (built in Task 2):
//   createLogger({ service, write? }) -> { log(fields) }
//   fields: { event: string; sessionId?: string; durationMs?: number; costUsd?: number }
//   `write` receives each finished line and defaults to process.stdout; `time` and `service` are set by the logger.
//   A refused event throws an Error whose message names the offending field, and nothing is written.
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from './logger.ts';

const NOW = new Date('2026-10-27T12:00:00.000Z');
// Source: .claude/rules/platform.md, "Logging and health"; ticket #25, AC1.
const PLATFORM_FIELDS: readonly string[] = ['time', 'service', 'sessionId', 'event', 'durationMs', 'costUsd'];
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/;

type Logger = ReturnType<typeof createLogger>;
type LogFields = Parameters<Logger['log']>[0];

function capture(service = 'detection'): { lines: string[]; logger: Logger } {
  const lines: string[] = [];
  const logger = createLogger({
    service,
    write: (line: string) => {
      lines.push(line);
    },
  });
  return { lines, logger };
}

// The runtime check exists for callers the type system cannot see (plain JS, spread objects, parsed input).
function untyped(fields: Record<string, unknown>): LogFields {
  return fields as unknown as LogFields;
}

function onlyEntry(lines: readonly string[]): Record<string, unknown> {
  expect(lines).toHaveLength(1);
  const line = lines[0] ?? '';
  expect(line.endsWith('\n')).toBe(true);
  expect(line.slice(0, -1)).not.toContain('\n');
  const parsed: unknown = JSON.parse(line);
  expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)).toBe(true);
  return parsed as Record<string, unknown>;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createLogger: one JSON object per line (AC1)', () => {
  it('writes exactly one line holding one JSON object per event', () => {
    const { lines, logger } = capture();
    logger.log({ event: 'service.started' });
    expect(onlyEntry(lines)['event']).toBe('service.started');
  });

  it('stamps the event with the current time in ISO 8601 UTC', () => {
    const { lines, logger } = capture();
    logger.log({ event: 'service.started' });
    const time = onlyEntry(lines)['time'];
    expect(typeof time).toBe('string');
    expect(time).toMatch(ISO_8601_UTC);
    expect(Date.parse(String(time))).toBe(NOW.getTime());
  });

  it('names the service the logger was created for', () => {
    const { lines, logger } = capture('detection');
    logger.log({ event: 'service.started' });
    expect(onlyEntry(lines)['service']).toBe('detection');
  });

  it('leaves out sessionId, durationMs and costUsd when the caller does not pass them', () => {
    const { lines, logger } = capture();
    logger.log({ event: 'service.started' });
    expect(Object.keys(onlyEntry(lines)).sort()).toEqual(['event', 'service', 'time']);
  });

  it('carries sessionId, durationMs and costUsd unchanged when the caller passes them', () => {
    const { lines, logger } = capture();
    logger.log({ event: 'model.called', sessionId: 's-25-a', durationMs: 840, costUsd: 0.0123 });
    expect(onlyEntry(lines)).toMatchObject({ event: 'model.called', sessionId: 's-25-a', durationMs: 840, costUsd: 0.0123 });
  });

  it('accepts zero as the lower boundary of durationMs and costUsd', () => {
    const { lines, logger } = capture();
    logger.log({ event: 'cache.hit', durationMs: 0, costUsd: 0 });
    expect(onlyEntry(lines)).toMatchObject({ durationMs: 0, costUsd: 0 });
  });

  it('accepts the smallest positive step above zero for durationMs and costUsd', () => {
    const { lines, logger } = capture();
    logger.log({ event: 'cache.hit', durationMs: 1, costUsd: 0.000001 });
    expect(onlyEntry(lines)).toMatchObject({ durationMs: 1, costUsd: 0.000001 });
  });

  it('writes to stdout when no sink is given', () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    createLogger({ service: 'detection' }).log({ event: 'service.started' });
    expect(onlyEntry([written.join('')])).toMatchObject({ event: 'service.started', service: 'detection' });
  });

  it('keeps every valid event on one line with only platform fields, whatever its text (property)', () => {
    const validFields = fc.record(
      {
        event: fc.string({ minLength: 1, maxLength: 40 }),
        sessionId: fc.string({ maxLength: 40 }),
        durationMs: fc.nat({ max: 3_600_000 }),
        costUsd: fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
      },
      { requiredKeys: ['event'] },
    );
    fc.assert(
      fc.property(validFields, (fields) => {
        const { lines, logger } = capture();
        logger.log(fields);
        const entry = onlyEntry(lines);
        for (const key of Object.keys(entry)) expect(PLATFORM_FIELDS).toContain(key);
        for (const key of ['sessionId', 'durationMs', 'costUsd'] as const) {
          expect(key in entry).toBe(fields[key] !== undefined);
          if (fields[key] !== undefined) expect(entry[key]).toEqual(JSON.parse(JSON.stringify(fields[key])));
        }
        expect(entry['event']).toBe(fields.event);
      }),
    );
  });
});

describe('createLogger: refused events (AC2)', () => {
  it.each([
    { invalidClass: 'field outside the allowed set', field: 'transcript', fields: { event: 'segment.received', transcript: 'Die Inflation lag 2023 bei sechs Prozent.' } },
    { invalidClass: 'event missing', field: 'event', fields: { sessionId: 's-25-b' } },
    { invalidClass: 'negative durationMs', field: 'durationMs', fields: { event: 'model.called', durationMs: -1 } },
    { invalidClass: 'negative costUsd', field: 'costUsd', fields: { event: 'model.called', costUsd: -0.000001 } },
  ])('refuses an event with $invalidClass, names $field and writes no line', ({ field, fields }) => {
    const { lines, logger } = capture();
    expect(() => logger.log(untyped(fields))).toThrow(field);
    expect(lines).toEqual([]);
  });

  it('refuses any field outside the platform set, names it and writes no line (property)', () => {
    const foreignKey = fc
      .stringMatching(/^[a-z][A-Za-z0-9_]{0,24}$/)
      .filter((key) => !PLATFORM_FIELDS.includes(key) && key !== '__proto__' && key !== 'constructor');
    fc.assert(
      fc.property(foreignKey, fc.string({ maxLength: 40 }), (key, value) => {
        const { lines, logger } = capture();
        expect(() => logger.log(untyped({ event: 'segment.received', [key]: value }))).toThrow(key);
        expect(lines).toEqual([]);
      }),
    );
  });
});
