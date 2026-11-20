// Conventional Commits for live-factchecker-v2 (docs/process/pr-format.md). Scopes are workspace names plus a
// few repo-level areas; tools/check_commits.py reads this file (the `scopes`, `types` and `properNouns`
// arrays) so the hook, the CI check and any commitlint install agree. Add a scope when a workspace is added,
// in the same PR.
export const types = ['feat', 'fix', 'test', 'refactor', 'docs', 'chore', 'ci', 'perf', 'build', 'revert'];
export const scopes = [
  // workspaces; gateway: open until #58 decides the service cut
  'gateway', 'contracts', 'pipeline', 'providers', 'web', 'ui', 'evals', 'tests', 'service-kit', 'detection',
  'inputs',
  // repo-level areas
  'ci', 'process', 'docs', 'platform', 'deps', 'release',
];
// Tool and product names allowed as the first word of a subject ("Sonar project key ..."); every other
// subject starts in lower case, acronyms (CI, GHCR) excepted. Single-word names only, exact spelling.
// Bump: the fixed verb of Dependabot titles (`build(deps): Bump ...`), first seen in PR #11.
export const properNouns = [
  'Bump',
  'Sonar', 'SonarQube', 'Fallow', 'Knip', 'Stryker', 'Docker', 'Compose', 'Redis', 'Postgres', 'GitHub', 'GHCR',
  'Deepgram', 'Gemini', 'Claude', 'Anthropic', 'Bedrock', 'Vertex', 'Brave', 'Caddy', 'Playwright', 'Vitest',
  'Cucumber', 'Gherkin', 'Semgrep', 'Trivy', 'Dependabot', 'Lighthouse', 'Golden', 'Opus', 'Sonnet', 'Haiku',
  'Fable', 'Jev', 'TypeScript', 'Node', 'Python', 'Lefthook', 'Prettier', 'ESLint', 'Wayfinder', 'Conventional',
  'Hetzner', 'OVHcloud', 'Scaleway', 'Stripe', 'Apple', 'Google', 'Wikimedia',
];
// commitlint's built-in subject-case has no allowlist, so a local rule mirrors tools/check_commits.py:
// reject a title-cased first word (one upper-case letter, then lower-case letters) unless it is a proper noun.
const subjectLowerCaseOrProperNoun = (parsed) => {
  const first = (parsed.subject || '').trim().split(/\s+/)[0] || '';
  const titleCased = /^\p{Lu}\p{Ll}+$/u.test(first);
  return [
    !titleCased || properNouns.includes(first),
    `subject starts with a capital letter (lower case unless an acronym or a proper noun: ${first})`,
  ];
};
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [{ rules: { 'subject-lower-case-or-proper-noun': subjectLowerCaseOrProperNoun } }],
  rules: {
    'type-enum': [2, 'always', types],
    'scope-enum': [2, 'always', scopes],
    'scope-empty': [2, 'never'],
    'subject-case': [0],
    'subject-lower-case-or-proper-noun': [2, 'always'],
    'header-max-length': [2, 'always', 100],
  },
};
