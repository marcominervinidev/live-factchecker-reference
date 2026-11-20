// Stage 1 of the logger's text cap and the stderr channel (#25 round 3: B7, B8).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigError } from './config.ts';
import { createLogger, writeConfigError } from './logger.ts';

// Round-3 review decision B7 (#25): event and sessionId hold at most 64 characters.
const MAX_TEXT_LENGTH = 64;

afterEach(() => {
  vi.restoreAllMocks();
});

function capture(): { lines: string[]; log: ReturnType<typeof createLogger>['log'] } {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'kit',
    write: (line) => {
      lines.push(line);
    },
  });
  return {
    lines,
    log: (fields) => {
      logger.log(fields);
    },
  };
}

describe('createLogger: text fields are capped', () => {
  it('accepts event and sessionId of exactly the cap', () => {
    const { lines, log } = capture();
    log({ event: 'e'.repeat(MAX_TEXT_LENGTH), sessionId: 's'.repeat(MAX_TEXT_LENGTH) });
    expect(lines).toHaveLength(1);
  });

  it.each(['event', 'sessionId'])(
    'refuses %s one character over the cap and writes nothing',
    (field) => {
      const { lines, log } = capture();
      const fields = { event: 'cache.hit', [field]: 'x'.repeat(MAX_TEXT_LENGTH + 1) };
      expect(() => {
        log(fields);
      }).toThrow(field);
      expect(lines).toEqual([]);
    },
  );
});

describe('writeConfigError', () => {
  function stderr(): string[] {
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    return written;
  }

  it('writes one line naming the variable and nothing of the problem text', () => {
    const written = stderr();
    writeConfigError('kit', new ConfigError('PORT', 'held the value eighty-25'));
    expect(written).toEqual(['kit: invalid configuration, check PORT\n']);
  });

  it('writes no detail for an error that is not a ConfigError', () => {
    const written = stderr();
    writeConfigError('kit', new Error('secret-25 inside'));
    expect(written).toEqual(['kit: invalid configuration\n']);
  });
});
