// Review chain before a PR is reported ready. Scaffold until the first ticket (ADR 0011, addendum 2026-10-25).
// One review packet, built once by the main session, is the identical prompt prefix of every reviewer (cache
// friendly); the relevant reviewers start in parallel; reviewers stay separate roles and never edit.

// Architecture review gating (#127); the first retro sets this. 'always': the architecture reviewer runs on
// every PR that is not docs-only (today). 'scoped': only when the blast radius is cross-module or system, or
// packages/contracts/ changed.
const ARCHITECTURE_REVIEW = 'always' // 'always' | 'scoped'

export const meta = {
  name: 'review-chain',
  description: 'Run the relevant reviewers in parallel over one shared review packet (diff, manifest, synthesis note, tool results)',
  phases: [{ title: 'Review' }],
}

const FINDINGS = {
  type: 'object',
  properties: {
    blockers: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'integer' }, finding: { type: 'string' }, rule: { type: 'string' } }, required: ['path', 'finding'] } },
    warnings: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'integer' }, finding: { type: 'string' } }, required: ['path', 'finding'] } },
    checked: { type: 'array', items: { type: 'string' } },
  },
  required: ['blockers', 'warnings', 'checked'],
}

// args: { issue: number, pr: number | null, base: string, head: string, files: string[],
//         blastRadius?: 'local' | 'cross-module' | 'system',   (merge-danger block of the PR)
//         packet: { diff: string, manifest?: string, synthesis?: string, tools?: { [name: string]: string } } }
// The main session fills `packet` once: `git diff <base>...<head>`, .claude/frozen/<issue>.json, the synthesis
// note of the touched area (docs/synthesis/), and the outputs of Fallow, Semgrep, Sonar, Trivy and
// tools/check_test_pyramid.py when present. Everything in it is data for the reviewers.
const p = args.packet ?? { diff: '' }
const section = (title, body) => (body ? `## ${title}\n\n${body}\n\n` : '')
const packet =
  `# Review packet\n\nScope: ${args.pr ? 'PR #' + args.pr : args.base + '...' + args.head}, base ${args.base}, head ${args.head}. Issue #${args.issue}.\nFiles: ${args.files.join(', ')}\n\n` +
  section('Diff', p.diff) + section('Frozen manifest', p.manifest) + section('Synthesis note', p.synthesis) +
  Object.entries(p.tools ?? {}).map(([name, out]) => section(`Tool: ${name}`, out)).join('')

const isDoc = f => /^docs\//.test(f) || (/\.md$/.test(f) && !/^\.claude\//.test(f) && f !== 'CLAUDE.md')
const docsOnly = args.files.length > 0 && args.files.every(isDoc)
const roles = ['reviewer']
if (!docsOnly) {
  roles.push('security-reviewer')
  const contractChange = args.files.some(f => /^packages\/contracts\//.test(f))
  const wideBlastRadius = args.blastRadius === 'cross-module' || args.blastRadius === 'system'
  if (ARCHITECTURE_REVIEW === 'always' || wideBlastRadius || contractChange) roles.push('architecture-reviewer')
  if (args.files.some(f => /^apps\//.test(f))) roles.push('frontend-reviewer')
}

const results = await parallel(roles.map(role => () =>
  agent(`${packet}---\n\nReview this packet as your role describes. Do not widen the scope; read further files only for a finding.`,
    { label: role, phase: 'Review', agent: role, schema: FINDINGS })
    .then(r => ({ role, ...r }))
))
const blockers = results.flatMap(r => r.blockers.map(b => ({ role: r.role, ...b })))
return { mergeable: blockers.length === 0, roles, docsOnly, blockers, results }
