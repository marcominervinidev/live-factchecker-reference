// Before gate 2: run the acceptance cases (code, no model), let the judge judge, hand the verdicts to the
// main session for the PR comment; after the merge the same verdicts close the ticket (ADR 0011, test team
// decision 2026-10-18). The runner is `make acceptance ISSUE=<n>`; it must have written
// tests/acceptance/reports/<issue>/report.json before this workflow starts (the workflow never runs make).
export const meta = {
  name: 'acceptance',
  description: 'Judge the acceptance report of one ticket on a model that did not write the change; verify the canary; return verdicts for the PR and the ticket close',
  phases: [{ title: 'Run' }, { title: 'Judge' }, { title: 'Close' }],
}

const VERDICTS = {
  type: 'object',
  properties: {
    cases: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, verdict: { enum: ['passt', 'passt nicht', 'unklar'] }, evidence: { type: 'string' }, reason: { type: 'string' }, stage: { type: 'string' } }, required: ['title', 'verdict', 'reason'] } },
    notChecked: { type: 'array', items: { type: 'string' } },
  },
  required: ['cases', 'notChecked'],
}

// args: { issue: number, reportPath?: string, canaryTitle: string }
//   reportPath defaults to tests/acceptance/reports/<issue>/report.json
//   canaryTitle comes from tests/acceptance/canaries/<issue>.json (the main session reads it; the judge never does)
const reportPath = args.reportPath ?? `tests/acceptance/reports/${args.issue}/report.json`

await phase('Run')
// Deterministic code wrote the report: stack lfc-<issue>-acc, throwaway secrets, mock providers, token redacted.
// From the first client (increment 2) the runner extracts per case from the Playwright trace and video one
// screenshot per step with its timestamp, console errors and failed requests into the report
// (tests/acceptance/README.md); raw video and trace go to an Actions artifact, never to the judge.

await phase('Judge')
async function judgeOnce(attempt) {
  return agent(`Judge the acceptance report at ${reportPath} as your role describes.`,
    { label: `acceptance-judge:${attempt}`, phase: 'Judge', agent: 'acceptance-judge', schema: VERDICTS })
}
function evaluate(judged) {
  const canary = judged.cases.find(c => c.title === args.canaryTitle)
  const canaryCaught = canary ? canary.verdict === 'passt nicht' : false
  const real = judged.cases.filter(c => c.title !== args.canaryTitle)
  const allPass = canaryCaught && real.length > 0 && real.every(c => c.verdict === 'passt')
  return { canaryCaught, real, allPass, notChecked: judged.notChecked }
}

let result = evaluate(await judgeOnce(1))
let discardedRuns = 0
if (!result.canaryCaught) {
  // A judge that passes the canary rubber-stamped: discard and repeat once (ADR 0022 old, kept).
  discardedRuns = 1
  result = evaluate(await judgeOnce(2))
}

await phase('Close')
// The main session: posts the verdicts (one quote, at most two images per case) as a PR comment before gate 2,
// with a link to the Actions artifact holding the raw video and trace for the owner (never attached inline);
// after the merge runs `gh issue close <issue> --comment-file <evidence>` only when allPass is true.
// After every run and at close it also posts the generated evidence table as an issue comment:
// `python3 -I tools/evidence_table.py --issue <issue> --verdicts <this result as JSON> --cucumber … --report Abnahme=<artifact url>`
// (docs/process/tickets.md); never a hand-written table, never into the body.
// If the canary was missed twice, judgeValid is false: the owner reads the report without a verdict.
return { ...result, judgeValid: result.canaryCaught, discardedRuns, reportPath }
