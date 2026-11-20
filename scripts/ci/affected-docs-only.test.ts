// Own unit tests of the implementer (ticket #68 AC2): a change set of documentation only starts no stack test and
// no image build in pr.yml. The rule lives in affected.ts next to the root files, so there is one source for the
// path rules of CI. Fail-safe: everything that is not documentation, an unknown file included, counts as code.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { docsOnly } from './affected.ts';

const DOCS = [
  'docs/process/tickets.md',
  'docs/schaubilder/047-pr-format.html',
  'docs/research/kadenz-kosten-calc.py',
  'README.md',
  'CLAUDE.md',
  'CONTEXT.md',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/ticket.md',
  '.claude/rules/ci.md',
  '.claude/agents/implementer.md',
  '.claude/skills/evidence/SKILL.md',
  '.claude/frozen/25.json',
  '.claude/settings.json',
  '.claude/models.json',
  'services/detection/README.md',
  'packages/service-kit/README.md',
  // a README nested in a folder an image ships is documentation too
  'services/detection/src/README.md',
  'apps/web/public/help/README.md',
  'packages/contracts/src/schemas/README.md',
  'tests/api/README.md',
  'evals/reports/2026-10-13-baseline-text-mock.md',
];

const CODE = [
  // the ticket's exceptions: hooks and the code of skills (and of the agent workflows)
  '.claude/hooks/guard-secrets.sh',
  '.claude/skills/evidence/capture.sh',
  '.claude/workflows/review-chain.js',
  // Markdown an image ships or a model reads: a prompt is configuration, not documentation
  'services/detection/prompts/claim.md',
  'packages/contracts/src/notes.md',
  'apps/web/src/content/help.md',
  'services/detection/src/readme.md',
  'services/detection/src/README.mdx',
  'evals/configs/prompts/claim_extractor.v3.md',
  '.claude/hooks/README.md',
  // stack, CI and workspace files
  'compose.yml',
  'Makefile',
  'docker/toolbox/Dockerfile',
  'deploy/edge/Caddyfile',
  '.github/workflows/pr.yml',
  'scripts/ci/affected.ts',
  'scripts/tb',
  'tools/check_pr_size.py',
  'packages/service-kit/src/logger.ts',
  'services/detection/Dockerfile',
  'tests/api/features/edge.feature',
  'pnpm-lock.yaml',
  'package.json',
  // look-alikes of documentation paths
  'docs',
  'xdocs/notes.md.ts',
  'src/docs/x.ts',
  'README.md.bak',
  '.claude',
  '.claudex/rules/ci.md.sh',
];

// Generated paths: one to four segments of lower-case letters, digits and . _ - (never README.md, which is upper case).
const segment = fc.stringMatching(/^[a-z0-9_-][a-z0-9_.-]{0,11}$/);
const path = fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => s.join('/'));
const markdown = fc.boolean();
const anyFile = fc.oneof(
  fc.constantFrom(...DOCS, ...CODE),
  path.map((p) => `docs/${p}`),
  path.map((p) => `services/detection/${p}`),
  path.map((p) => `${p}.md`),
);

describe('docsOnly (ticket #68 AC2)', () => {
  it.each(DOCS)('counts %s as documentation', (file) => {
    expect(docsOnly([file])).toBe(true);
  });

  it.each(CODE)('counts %s as code', (file) => {
    expect(docsOnly([file])).toBe(false);
  });

  it('is true for a change set of documentation files only', () => {
    expect(docsOnly(DOCS)).toBe(true);
  });

  it('is false for an empty change set, so a diff that came back empty runs everything', () => {
    expect(docsOnly([])).toBe(false);
  });

  it('is false as soon as one file of the change set is code, wherever it stands', () => {
    fc.assert(
      fc.property(fc.subarray(DOCS), fc.constantFrom(...CODE), fc.nat(), (docs, code, at) => {
        const files = [...docs];
        files.splice(at % (files.length + 1), 0, code);
        expect(docsOnly(files)).toBe(false);
      }),
    );
  });

  it('counts every path under docs/ as documentation', () => {
    fc.assert(
      fc.property(path, (p) => {
        expect(docsOnly([`docs/${p}`])).toBe(true);
      }),
    );
  });

  it('counts every path under .claude/hooks/ as code, Markdown included', () => {
    fc.assert(
      fc.property(path, markdown, (p, md) => {
        expect(docsOnly([`.claude/hooks/${p}${md ? '.md' : ''}`])).toBe(false);
      }),
    );
  });

  it('counts every file of a service as code unless it is a README.md', () => {
    fc.assert(
      fc.property(segment, path, markdown, (service, p, md) => {
        const file = `services/${service}/${p}${md ? '.md' : ''}`;
        fc.pre(!file.endsWith('/README.md'));
        expect(docsOnly([file])).toBe(false);
      }),
    );
  });

  it('is the conjunction over a union of two non-empty change sets', () => {
    const files = fc.array(anyFile, { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(files, files, (a, b) => {
        expect(docsOnly([...a, ...b])).toBe(docsOnly(a) && docsOnly(b));
      }),
    );
  });

  it('does not depend on the order of the change set', () => {
    fc.assert(
      fc.property(fc.subarray([...DOCS, ...CODE], { minLength: 1 }), (files) => {
        expect(docsOnly([...files].reverse())).toBe(docsOnly(files));
      }),
    );
  });
});
