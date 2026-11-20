// Stage 1 of the Segment input of the Session routes (ticket #27, Task 3): the body limit before JSON.parse, and
// what a rejection may name (packages/contracts README, "For consumers": no unknown field name that is not an
// identifier; services/detection README: at most 10 fields). Behaviour through readBody and parseSegment only.
import { once } from 'node:events';
import type { IncomingHttpHeaders } from 'node:http';
import { Readable } from 'node:stream';

import { segmentFixture } from '@lfc/contracts/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES, parseSegment, readBody } from './segment-input.ts';

function request(
  chunks: readonly string[],
  headers: IncomingHttpHeaders = {},
): Readable & { headers: IncomingHttpHeaders } {
  return Object.assign(Readable.from(chunks.map((chunk) => Buffer.from(chunk))), { headers });
}

const TOO_LARGE = { ok: false, reason: 'too-large' };

describe('readBody', () => {
  it('settles as aborted when the client goes away before the end of the body', async () => {
    const broken = new Readable({
      read() {
        this.push(Buffer.from('{"id":'));
        this.destroy(new Error('aborted'));
      },
    });
    const body = readBody(Object.assign(broken, { headers: {} }));
    await expect(body).resolves.toEqual({ ok: false, reason: 'aborted' });
  });

  // Kills segment-input.ts:70/71 (close listener on '' / empty / settle({})): no error, no end, only close.
  it('settles as aborted when the body stream closes without an error and without its end', async () => {
    const cut = new Readable({
      read() {
        this.push(Buffer.from('{"id":'));
        this.destroy();
      },
    });
    const body = readBody(Object.assign(cut, { headers: {} }));
    await expect(body).resolves.toEqual({ ok: false, reason: 'aborted' });
  });

  it('returns a body of exactly the limit', async () => {
    const body = 'x'.repeat(MAX_BODY_BYTES);
    await expect(readBody(request([body.slice(0, 10), body.slice(10)]))).resolves.toEqual({
      ok: true,
      text: body,
    });
  });

  it('refuses a body one byte over the limit', async () => {
    await expect(readBody(request(['x'.repeat(MAX_BODY_BYTES + 1)]))).resolves.toEqual(TOO_LARGE);
  });

  it('refuses an announced length over the limit before reading', async () => {
    const headers = { 'content-length': String(MAX_BODY_BYTES + 1) };
    await expect(readBody(request(['{}'], headers))).resolves.toEqual(TOO_LARGE);
  });

  it('returns a body whose announced length is exactly the limit', async () => {
    const body = 'x'.repeat(MAX_BODY_BYTES);
    const headers = { 'content-length': String(MAX_BODY_BYTES) };
    await expect(readBody(request([body], headers))).resolves.toEqual({ ok: true, text: body });
  });

  it('keeps a request with an announced length over the limit flowing to its end, its data dropped', async () => {
    const stream = request(['{}', '[]'], { 'content-length': String(MAX_BODY_BYTES + 1) });
    await expect(readBody(stream)).resolves.toEqual(TOO_LARGE);
    expect(stream.readableFlowing).toBe(true);
    await once(stream, 'end');
  });

  // 'ü' is two bytes in UTF-8: half as many characters as the limit fill it exactly.
  it('returns a body of two-byte characters that is exactly the limit in bytes', async () => {
    const body = 'ü'.repeat(MAX_BODY_BYTES / 2);
    await expect(readBody(request([body]))).resolves.toEqual({ ok: true, text: body });
  });

  it('counts bytes, not characters: refuses a body over the limit in bytes and under it in characters', async () => {
    const body = 'ü'.repeat(MAX_BODY_BYTES / 2 + 1);
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    await expect(readBody(request([body]))).resolves.toEqual(TOO_LARGE);
  });
});

describe('MAX_BODY_BYTES', () => {
  it('fits the largest Segment the contract allows', () => {
    // contract bounds: 500 words, w of 100 UTF-16 units (a control character is 6 bytes as JSON), long numbers
    const time = 1.2345678901234566e-7; // 21 characters as JSON
    const word = { w: '\u0000'.repeat(100), start: time, end: time };
    const largest = {
      ...segmentFixture,
      sessionId: 's'.repeat(64),
      language: 'l'.repeat(35),
      start: time,
      end: time,
      finalizedAt: 86_399.99999999999,
      words: Array.from({ length: 500 }, () => word),
    };
    const body = JSON.stringify(largest);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(parseSegment(body).ok).toBe(true);
  });
});

describe('parseSegment', () => {
  it('accepts the contract fixture and hands on the parsed Segment', () => {
    expect(parseSegment(JSON.stringify(segmentFixture))).toEqual({
      ok: true,
      segment: segmentFixture,
    });
  });

  it('rejects text that is not JSON without naming a field', () => {
    expect(parseSegment('{"id": "s-1"')).toEqual({ ok: false, fields: [] });
  });

  it('names an unknown field that is an identifier', () => {
    const input = parseSegment(JSON.stringify({ ...segmentFixture, overlap: true }));
    expect(input).toEqual({ ok: false, fields: ['overlap'] });
  });

  it('never repeats an unknown field name that is not an identifier', () => {
    const input = parseSegment(JSON.stringify({ ...segmentFixture, 'die Mieten steigen': 1 }));
    if (input.ok) throw new Error('expected a rejection');
    expect(input.fields).toHaveLength(1);
    expect(input.fields).not.toContain('die Mieten steigen');
    expect(JSON.stringify(input)).not.toContain('Mieten');
  });

  it('leaves out an issue of the whole Segment, which has no path', () => {
    expect(parseSegment('null')).toEqual({ ok: false, fields: [] });
  });

  it('names a field inside a word by its path', () => {
    const words = [segmentFixture.words[0], { ...segmentFixture.words[1], end: 'late' }];
    expect(parseSegment(JSON.stringify({ ...segmentFixture, words }))).toEqual({
      ok: false,
      fields: ['words.1.end'],
    });
  });

  it('names nothing of the words or the Speaker of a rejected Segment', () => {
    const input = parseSegment(JSON.stringify({ ...segmentFixture, speaker: 'Kallac Haqy' }));
    expect(input).toEqual({ ok: false, fields: ['speaker'] });
  });
});

/** A rejection of the contract fixture with these extra fields; fails the test if it is accepted. */
function fieldsNamedFor(extra: Record<string, unknown>): readonly string[] {
  const input = parseSegment(JSON.stringify({ ...segmentFixture, ...extra }));
  if (input.ok) throw new Error('expected a rejection');
  return input.fields;
}

/** What a rejection says in place of a field name that is not an identifier. */
const unnamed = fieldsNamedFor({ 'die Mieten steigen': 1 })[0];

describe('parseSegment, the fields a rejection names', () => {
  // services/detection README, Session routes: a rejection names at most 10 fields.
  it('names at most 10 fields, each once', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.integer(), { maxKeys: 40 }), (extra) => {
        const input = parseSegment(JSON.stringify({ ...segmentFixture, ...extra }));
        const fields = input.ok ? [] : input.fields;
        expect(fields.length).toBeLessThanOrEqual(10);
        expect(new Set(fields).size).toBe(fields.length);
      }),
    );
  });

  it('repeats only identifiers and indices, never an unknown field name that is not one', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.integer(), { maxKeys: 12 }), (extra) => {
        const input = parseSegment(JSON.stringify({ ...segmentFixture, ...extra }));
        const fields = input.ok ? [] : input.fields;
        const notIdentifiers = Object.keys(extra).filter(
          (key) => !/^[A-Za-z][A-Za-z0-9]*$/.test(key),
        );
        for (const name of fields) {
          expect(name === unnamed || /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/.test(name)).toBe(
            true,
          );
          expect(notIdentifiers).not.toContain(name);
        }
      }),
    );
  });

  it('names the first 10 unknown fields and not the next one', () => {
    const names = Array.from({ length: 11 }, (_, i) => `field${i}`);
    const extra = Object.fromEntries(names.map((name) => [name, 1]));
    expect(fieldsNamedFor(extra)).toEqual(names.slice(0, 10));
  });

  it('repeats a field name of 32 characters and not one of 33', () => {
    const longest = `a${'b'.repeat(31)}`;
    expect(fieldsNamedFor({ [longest]: 1, [`${longest}c`]: 1 })).toEqual([longest, unnamed]);
  });

  it('says one and the same thing for every field name that is not an identifier', () => {
    expect(unnamed).toBeDefined();
    expect(fieldsNamedFor({ 'die Mieten steigen': 1, 'Kallac Haqy': 2, '1x': 3 })).toEqual([
      unnamed,
    ]);
  });
});
