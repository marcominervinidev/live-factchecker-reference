// The docs-only flag of pr.yml (ticket #68 AC2): `docs_only=true` when every file changed since the merge base
// with <git-ref> is documentation (docsOnly in affected.ts, the one source of the CI path rules). pr.yml then
// skips the stack tests and the image build; `pr passed` counts the skipped jobs as green. Needs git, no pnpm.
// Usage: node scripts/ci/docs-only.ts <git-ref>   -> `docs_only=true|false` to $GITHUB_OUTPUT and stdout
import { changedSince, docsOnly } from './affected.ts';
import { output } from './json.ts';

if (import.meta.main) {
  const ref = process.argv[2];
  if (ref === undefined) throw new Error('usage: node scripts/ci/docs-only.ts <git-ref>');
  output('docs_only', docsOnly(changedSince(ref)));
}
