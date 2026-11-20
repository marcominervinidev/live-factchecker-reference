// Gate-1 chain: test designer writes the tests, the critic reviews them, at most two rounds.
// Skeleton (ADR 0011). Schemas, budgets and turn limits are set when the first ticket runs.
export const meta = {
  name: 'test-design',
  description: 'Test designer writes features, steps and red tests for one ticket; critic reviews with veto; at most two rounds',
  phases: [{ title: 'Design' }, { title: 'Critique' }],
}

const VERDICT = {
  type: 'object',
  properties: {
    verdict: { enum: ['freigeben', 'zurueck'] },
    blockers: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, line: { type: 'integer' }, finding: { type: 'string' } }, required: ['path', 'finding'] } },
    covered: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'blockers', 'covered'],
}

// args: { issue: number, ticket: string (markdown), paths: string[] }
let feedback = ''
let result = null
for (let round = 1; round <= 2; round++) {
  const design = await agent(
    `Ticket #${args.issue}:\n\n${args.ticket}\n\n${feedback ? 'Critic findings from the previous round:\n' + feedback : ''}\nWrite features, step definitions, red unit tests, acceptance cases and the canary as your role describes. Return the file list with a redRun (command, exit code, sha256 of the output) per test file.`,
    { label: `test-designer:r${round}`, phase: 'Design', agent: 'test-designer' },
  )
  const critique = await agent(
    `Ticket #${args.issue}:\n\n${args.ticket}\n\nTest designer output (round ${round}):\n${JSON.stringify(design)}\n\nReview as your role describes.`,
    { label: `critic:r${round}`, phase: 'Critique', agent: 'critic', schema: VERDICT },
  )
  result = { round, design, critique }
  if (critique.verdict === 'freigeben') break
  feedback = critique.blockers.map(b => `${b.path}${b.line ? ':' + b.line : ''}: ${b.finding}`).join('\n')
}
// The main session shows `result` to the owner at gate 1 (canary marked) and writes .claude/frozen/<issue>.json
// from the file list, including the redRun entries and tests/acceptance/canaries/<issue>.json.
return result
