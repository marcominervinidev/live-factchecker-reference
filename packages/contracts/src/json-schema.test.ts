// Stage 1, issue #27 (T2), Task 1: the generated JSON Schema of the contracts (owner decision 2026-10-28 on #27:
// Zod is the single source, JSON Schema is generated from it as an artifact in the package, the Python harness under
// evals/ reads only that artifact; a stale artifact turns this test red).
//
// Public interface these tests define (built in Task 1):
//   packages/contracts/scripts/generate-json-schema.ts
//     export function generateJsonSchemas(): Record<string, string>
//       key   the artifact's path relative to packages/contracts, e.g. "json-schema/segment.schema.json"
//       value the exact file content (JSON text) the generator writes
//     run as a script (`pnpm --filter @lfc/contracts run generate:json-schema`) it writes every entry to disk.
//   The artifacts live in packages/contracts/json-schema/; nothing else lives there.
// The generator sits outside src/ on purpose: scripts/check-contract-change.sh treats every other file under src/
// as a schema or a shared building block (open question 2 of the test designer's report).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateJsonSchemas } from '../scripts/generate-json-schema.ts';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEGMENT_ARTIFACT = 'json-schema/segment.schema.json';

type Json = Record<string, unknown>;

function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${what} is not an object`);
  return value as Json;
}

function segmentSchema(): Json {
  const text = generateJsonSchemas()[SEGMENT_ARTIFACT];
  if (text === undefined) throw new Error(`the generator yields no ${SEGMENT_ARTIFACT}`);
  return asObject(JSON.parse(text), SEGMENT_ARTIFACT);
}

describe('generated JSON Schema artifacts are up to date', () => {
  it('yields an artifact for the Segment contract', () => {
    expect(Object.keys(generateJsonSchemas())).toContain(SEGMENT_ARTIFACT);
  });

  it('matches every committed artifact byte for byte with what the generator yields from the Zod schemas', () => {
    const generated = generateJsonSchemas();
    for (const [path, content] of Object.entries(generated)) {
      expect(
        readFileSync(join(PACKAGE, path), 'utf8'),
        `${path} is stale: run generate:json-schema`,
      ).toBe(content);
    }
  });

  it('holds no committed artifact the generator does not yield', () => {
    const generated = new Set(Object.keys(generateJsonSchemas()));
    const committed = readdirSync(join(PACKAGE, 'json-schema')).map(
      (name) => `json-schema/${name}`,
    );
    expect(committed.filter((path) => !generated.has(path))).toEqual([]);
  });

  it('yields the same artifacts on every run (deterministic)', () => {
    expect(generateJsonSchemas()).toEqual(generateJsonSchemas());
  });
});

describe('the Segment artifact carries the contract a reader without Zod relies on', () => {
  it('describes a closed object that requires every field of inputs 4.1 plus schemaVersion', () => {
    const schema = segmentSchema();
    expect(schema['type']).toBe('object');
    expect(schema['additionalProperties']).toBe(false);
    expect([...(schema['required'] as string[])].sort()).toEqual(
      [
        'end',
        'finalizedAt',
        'id',
        'language',
        'schemaVersion',
        'sessionId',
        'speaker',
        'start',
        'words',
      ].sort(),
    );
  });

  it('pins schemaVersion to 1 and has no overlap property', () => {
    const properties = asObject(segmentSchema()['properties'], 'properties');
    expect(asObject(properties['schemaVersion'], 'schemaVersion')['const']).toBe(1);
    expect(Object.keys(properties)).not.toContain('overlap');
  });

  it('describes words as a non-empty list of closed objects with w, start and end', () => {
    const words = asObject(asObject(segmentSchema()['properties'], 'properties')['words'], 'words');
    expect(words['type']).toBe('array');
    expect(words['minItems']).toBe(1);
    const item = asObject(words['items'], 'words.items');
    expect(item['additionalProperties']).toBe(false);
    expect([...(item['required'] as string[])].sort()).toEqual(['end', 'start', 'w']);
  });
});
