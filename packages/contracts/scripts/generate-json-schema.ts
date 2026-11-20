// Generates the JSON Schema artefacts from the Zod schemas (ADR 0012): Zod is the only source, the artefacts in
// json-schema/ are for readers without Zod (the Python harness under evals/). Every Zod schema src/index.ts exports
// becomes json-schema/<kebab-name>.schema.json, so the export is the only registration. Never edit an artefact by
// hand; src/json-schema.test.ts fails while one is stale. Lives outside src/ so the contract check does not count
// it as a schema. Run: pnpm --filter @lfc/contracts run generate:json-schema
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import * as contracts from '../src/index.ts';

/** `SegmentEvent` -> `segment-event`. */
function kebab(name: string): string {
  return name.replace(/(?<=[a-z0-9])(?=[A-Z])/g, '-').toLowerCase();
}

/** Every artefact's path (relative to packages/contracts) and its exact file content, ordered by path. */
export function generateJsonSchemas(): Record<string, string> {
  const exported: Readonly<Record<string, unknown>> = contracts;
  const artefacts: [string, string][] = [];
  for (const [name, value] of Object.entries(exported)) {
    if (!(value instanceof z.ZodType)) continue;
    artefacts.push([
      `json-schema/${kebab(name)}.schema.json`,
      `${JSON.stringify(z.toJSONSchema(value), null, 2)}\n`,
    ]);
  }
  return Object.fromEntries(artefacts.sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const [path, content] of Object.entries(generateJsonSchemas())) {
    writeFileSync(join(root, path), content);
  }
}
