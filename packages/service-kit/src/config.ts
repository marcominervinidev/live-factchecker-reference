// Configuration from the environment only, validated at startup (.claude/rules/platform.md, "Configuration").
// A secret arrives as `<NAME>_FILE`, the path of a file holding it. Errors name the variable, never a value
// and never a path: a value may be a secret, a path tells where one lies.
import { readFile, stat } from 'node:fs/promises';

export type Env = Readonly<Record<string, string | undefined>>;

/** Settings every service shares; a service's own config extends it. */
export interface ServiceConfig {
  readonly port: number;
}

export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

/** A secret file is a regular file of at most this size. */
const MAX_SECRET_BYTES = 4096;

// Library debug output (ioredis through `debug`, Node core through NODE_DEBUG) can print the AUTH password.
const DEBUG_VARIABLES = ['DEBUG', 'NODE_DEBUG'] as const;

/** A required value: missing and empty are the same, there is no default. */
export function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new ConfigError(name, 'is required');
  return value;
}

async function readSmallFile(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size <= MAX_SECRET_BYTES
      ? await readFile(path, 'utf8')
      : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the secret `<name>` from the file named by `<name>_FILE`; exactly one trailing newline is dropped. */
export async function readSecretFile(env: Env, name: string): Promise<string> {
  const variable = `${name}_FILE`;
  const content = await readSmallFile(requireEnv(env, variable));
  if (content === undefined) {
    throw new ConfigError(variable, 'must name a readable regular file of at most 4 KiB');
  }
  const secret = content.replace(/\r?\n$/, '');
  if (secret.length === 0) throw new ConfigError(variable, 'names an empty file');
  return secret;
}

export function loadServiceConfig(env: Env): ServiceConfig {
  for (const name of DEBUG_VARIABLES) {
    if ((env[name] ?? '') !== '') {
      throw new ConfigError(name, 'must not be set: debug output can print secrets');
    }
  }
  const raw = requireEnv(env, 'PORT');
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
  if (port < 1 || port > 65_535) {
    throw new ConfigError('PORT', 'must be an integer from 1 to 65535');
  }
  return { port };
}
