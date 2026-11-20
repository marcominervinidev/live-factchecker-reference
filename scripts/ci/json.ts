// Shared by the CI scripts: a shape check for the JSON they read and the step output they write.
import { appendFileSync } from 'node:fs';

export function record(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${what}: expected an object`);
  return value as Readonly<Record<string, unknown>>;
}

export function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new TypeError(`${what}: expected a string`);
  return value;
}

/** Writes `key=<json>` to $GITHUB_OUTPUT (in CI) and to stdout. */
export function output(key: string, value: unknown): void {
  const line = `${key}=${JSON.stringify(value)}\n`;
  const file = process.env['GITHUB_OUTPUT'];
  if (file !== undefined && file !== '') appendFileSync(file, line);
  process.stdout.write(line);
}
