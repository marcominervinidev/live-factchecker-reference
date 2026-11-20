// A Segment as it arrives at the segment seam (ticket #27, AC8): the body is read up to MAX_BODY_BYTES before
// JSON.parse sees it, then checked with the segment contract. Only `result.data` goes on; the input itself, Zod's
// issue messages and `reportInput` never do, because they can carry transcript text (packages/contracts README,
// "For consumers"). A rejection names at most MAX_NAMED_FIELDS fields, each a path of identifiers and indices; a
// name that is not an identifier (an unknown field can be named by any text) is never repeated.
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

import { Segment } from '@lfc/contracts';

/**
 * Derived from the contract's bounds, so no contract-valid Segment is refused: 500 words, each `w` of at most 100
 * UTF-16 units (at most 600 bytes as JSON escapes) and two numbers of at most 24 characters, come to about 340 KB
 * without whitespace. A larger body is refused before parsing (413). A typical Segment is a few KB.
 */
export const MAX_BODY_BYTES = 512 * 1024;

/** A rejection names at most this many fields. */
const MAX_NAMED_FIELDS = 10;

/** Stands for a field whose name is not an identifier. */
const UNNAMED_FIELD = '(unnamed field)';

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

export type SegmentInput =
  | { readonly ok: true; readonly segment: Segment }
  | { readonly ok: false; readonly fields: readonly string[] };

/** A body read in full, or why not: over the limit, or the client went away before its end. */
export type Body =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'too-large' | 'aborted' };

/**
 * Reads the body up to MAX_BODY_BYTES bytes. Over the limit (announced or counted) it settles at once with
 * `too-large`; the rest is not kept, the request keeps flowing and its data is dropped, so the caller can answer 413
 * at once (and close). A request that fails or closes before its end settles with `aborted`: that is the client, not
 * the store.
 */
export function readBody(request: Readable & Pick<IncomingMessage, 'headers'>): Promise<Body> {
  return new Promise((resolve) => {
    if (Number(request.headers['content-length'] ?? '0') > MAX_BODY_BYTES) {
      request.resume();
      resolve({ ok: false, reason: 'too-large' });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (body: Body): void => {
      if (!settled) resolve(body);
      settled = true;
    };
    request.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) settle({ ok: false, reason: 'too-large' });
      else chunks.push(chunk);
    });
    request.on('end', () => {
      settle({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    });
    request.on('error', () => {
      settle({ ok: false, reason: 'aborted' });
    });
    request.on('close', () => {
      settle({ ok: false, reason: 'aborted' });
    });
  });
}

/** One field as a dotted path (`words.3.end`); a key that is not an identifier becomes UNNAMED_FIELD. */
function fieldName(path: readonly PropertyKey[]): string {
  const parts = path.map((key) =>
    typeof key === 'number' || (typeof key === 'string' && IDENTIFIER.test(key))
      ? String(key)
      : undefined,
  );
  return parts.includes(undefined) ? UNNAMED_FIELD : parts.join('.');
}

/** The fields a rejection names: unique, in the order Zod reports them, issues without a path left out. */
export function namedFields(paths: readonly (readonly PropertyKey[])[]): string[] {
  const names = new Set<string>();
  for (const path of paths) {
    if (path.length > 0) names.add(fieldName(path));
    if (names.size === MAX_NAMED_FIELDS) break;
  }
  return [...names];
}

/** Parses a body that already passed the size limit; text that is not JSON names no field. */
export function parseSegment(body: string): SegmentInput {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, fields: [] };
  }
  const result = Segment.safeParse(value);
  if (result.success) return { ok: true, segment: result.data };
  return { ok: false, fields: namedFields(result.error.issues.map((issue) => issue.path)) };
}
