// From the messages of one Cucumber run to the cases of report.json (tests/acceptance/README.md, report shape).
// API driver (increment 1): no screenshots, no aria snapshots, no console; `network` lists the failed requests
// (status 400 and above, or no answer), `stdout` every exchange with its status, the edge's mark, the TLS check of
// its connection (trust anchor, verification, issuer) and the body.
// Every case has the same shape, the canary included: `steps` lists what the driver did and saw, built from the
// attachments only (the owner's expectation, then per request the request step and the runner's observation),
// never a scenario's own assertions; a failed assertion shows in `status` and `errors`.
import type { runCucumber } from '@cucumber/cucumber/api';

import {
  EXCHANGE_MEDIA_TYPE,
  EXPECTATION_MEDIA_TYPE,
  parseExchange,
  tlsLine,
  type Exchange,
} from './exchange.ts';

export type Envelope = Parameters<NonNullable<Parameters<typeof runCucumber>[2]>>[0];
type GherkinDocument = NonNullable<Envelope['gherkinDocument']>;
type Pickle = NonNullable<Envelope['pickle']>;
type TestCase = NonNullable<Envelope['testCase']>;
type CaseStarted = NonNullable<Envelope['testCaseStarted']>;
type StepFinished = NonNullable<Envelope['testStepFinished']>;
type Attachment = NonNullable<Envelope['attachment']>;
type Timestamp = CaseStarted['timestamp'];

export interface ReportCase {
  readonly title: string;
  readonly expected: string;
  readonly status: string;
  readonly errors: readonly string[];
  readonly stdout: string;
  readonly steps: readonly {
    readonly title: string;
    readonly at: string;
    readonly screenshot: null;
  }[];
  readonly console: readonly never[];
  readonly network: readonly { method: string; url: string; status: number | null; at: string }[];
  readonly screenshot: null;
  readonly aria: null;
  readonly harness: null;
}

// Worst first: the status of a case is that of its worst step.
const SEVERITY = ['FAILED', 'AMBIGUOUS', 'UNDEFINED', 'PENDING', 'SKIPPED', 'UNKNOWN', 'PASSED'];
// A step Cucumber could not bind breaks the run, not the case: the judge would read a harness fault as a verdict.
const BROKEN = new Set(['AMBIGUOUS', 'UNDEFINED']);

const iso = (t: Timestamp | undefined): string =>
  t === undefined ? '' : new Date(t.seconds * 1000 + Math.floor(t.nanos / 1e6)).toISOString();

interface Children {
  readonly background?: { readonly steps: readonly { id: string; keyword: string }[] } | undefined;
  readonly scenario?: { readonly steps: readonly { id: string; keyword: string }[] } | undefined;
  readonly rule?: { readonly children: readonly Children[] } | undefined;
}

function addKeywords(children: readonly Children[], into: Map<string, string>): void {
  for (const child of children) {
    for (const step of [...(child.background?.steps ?? []), ...(child.scenario?.steps ?? [])]) {
      into.set(step.id, step.keyword.trim());
    }
    addKeywords(child.rule?.children ?? [], into);
  }
}

const push = <V>(map: Map<string, V[]>, key: string, value: V): void => {
  map.set(key, [...(map.get(key) ?? []), value]);
};

/** The messages of one run, indexed for building the cases. */
class RunIndex {
  readonly keywords = new Map<string, string>();
  readonly pickles = new Map<string, Pickle>();
  readonly testCases = new Map<string, TestCase>();
  readonly started: CaseStarted[] = [];
  readonly stepStarts = new Map<string, Timestamp>();
  readonly results = new Map<string, StepFinished[]>();
  readonly attachments = new Map<string, Attachment[]>();
  readonly retried = new Set<string>();
  readonly errors: string[] = [];

  add(e: Envelope): void {
    this.addDefinitions(e);
    this.addProgress(e);
    this.addAttachment(e);
    this.addRetry(e);
    this.addFaults(e);
  }

  /** What the run is made of: the Gherkin documents, the pickles and the test cases. */
  private addDefinitions(e: Envelope): void {
    if (e.gherkinDocument) this.addDocument(e.gherkinDocument);
    if (e.pickle) this.pickles.set(e.pickle.id, e.pickle);
    if (e.testCase) this.testCases.set(e.testCase.id, e.testCase);
  }

  /** What ran: the started cases, when each step started and how each step finished. */
  private addProgress(e: Envelope): void {
    if (e.testCaseStarted) this.started.push(e.testCaseStarted);
    const step = e.testStepStarted;
    if (step) this.stepStarts.set(`${step.testCaseStartedId}/${step.testStepId}`, step.timestamp);
    if (e.testStepFinished)
      push(this.results, e.testStepFinished.testCaseStartedId, e.testStepFinished);
  }

  private addAttachment(e: Envelope): void {
    if (e.attachment?.testCaseStartedId !== undefined)
      push(this.attachments, e.attachment.testCaseStartedId, e.attachment);
  }

  private addRetry(e: Envelope): void {
    if (e.testCaseFinished?.willBeRetried === true)
      this.retried.add(e.testCaseFinished.testCaseStartedId);
  }

  /** The faults that break the run: a document Cucumber could not parse, an exception of the run itself. */
  private addFaults(e: Envelope): void {
    if (e.parseError) this.errors.push(`parse error: ${e.parseError.message}`);
    const exception = e.testRunFinished?.exception;
    if (exception) this.errors.push(`run: ${exception.message ?? exception.type}`);
  }

  private addDocument(doc: GherkinDocument): void {
    addKeywords(doc.feature?.children ?? [], this.keywords);
  }
}

function exchangeLines(exchanges: readonly Exchange[], edgeUrl: string): string {
  return exchanges
    .map((x) => {
      const mark = x.edgeMark === null ? '' : ` (X-Lfc-Edge: ${x.edgeMark})`;
      const line = `${x.at} ${x.method} ${new URL(x.path, edgeUrl).href} -> ${x.status ?? 'no answer'}${mark}`;
      const checked = `${line}\n${tlsLine(x.tls)}`;
      return x.body === '' ? checked : `${checked}\n${x.body}`;
    })
    .join('\n');
}

type Evidence = { readonly attachment: Attachment; readonly exchange?: Exchange | undefined };

function stepTitle(
  run: RunIndex,
  testCase: TestCase | undefined,
  testStepId: string | undefined,
): string {
  const pickleStepId = testCase?.testSteps.find((s) => s.id === testStepId)?.pickleStepId;
  const pickle = testCase === undefined ? undefined : run.pickles.get(testCase.pickleId);
  const step = pickle?.steps.find((s) => s.id === pickleStepId);
  if (step === undefined) return '';
  return `${run.keywords.get(step.astNodeIds[0] ?? '') ?? ''} ${step.text}`.trim();
}

const observation = (x: Exchange): string =>
  x.status === null
    ? 'Then the edge gave no answer'
    : `Then the edge answered with status ${x.status}${x.edgeMark === null ? '' : ` and X-Lfc-Edge: ${x.edgeMark}`}`;

function stepsOf(
  run: RunIndex,
  started: CaseStarted,
  testCase: TestCase | undefined,
  evidence: readonly Evidence[],
): ReportCase['steps'] {
  return evidence.flatMap(({ attachment, exchange }) => {
    const title = stepTitle(run, testCase, attachment.testStepId);
    const at = iso(run.stepStarts.get(`${started.id}/${attachment.testStepId ?? ''}`));
    const done = { title, at, screenshot: null };
    return exchange === undefined
      ? [done]
      : [done, { title: observation(exchange), at: exchange.at, screenshot: null }];
  });
}

const failures = (results: readonly StepFinished[]): string[] =>
  results.flatMap((r) => {
    const failure = r.testStepResult.exception?.message ?? r.testStepResult.message;
    return failure === undefined ? [] : [failure];
  });

const failedRequests = (exchanges: readonly Exchange[], edgeUrl: string): ReportCase['network'] =>
  exchanges
    .filter((x) => x.status === null || x.status >= 400)
    .map((x) => ({
      method: x.method,
      url: new URL(x.path, edgeUrl).href,
      status: x.status,
      at: x.at,
    }));

const caseTitle = (run: RunIndex, started: CaseStarted, testCase: TestCase | undefined): string =>
  (testCase && run.pickles.get(testCase.pickleId)?.name) ?? started.testCaseId;

/** The status of the worst step; a step Cucumber could not bind is also a fault of the run. */
function caseStatus(run: RunIndex, title: string, results: readonly StepFinished[]): string {
  const statuses = results.map((r) => r.testStepResult.status as string);
  const status = SEVERITY.find((s) => statuses.includes(s)) ?? 'UNKNOWN';
  if (statuses.some((s) => BROKEN.has(s)))
    run.errors.push(`${title}: a step is ${status.toLowerCase()}`);
  return status;
}

/** The owner's expectation and the exchanges, in the order they were attached; anything else is dropped. */
const evidenceOf = (attached: readonly Attachment[]): Evidence[] =>
  attached.flatMap((attachment) => {
    if (attachment.mediaType === EXPECTATION_MEDIA_TYPE) return [{ attachment }];
    if (attachment.mediaType !== EXCHANGE_MEDIA_TYPE) return [];
    return [{ attachment, exchange: parseExchange(attachment.body) }];
  });

const exchangesOf = (evidence: readonly Evidence[]): Exchange[] =>
  evidence.flatMap((e) => (e.exchange === undefined ? [] : [e.exchange]));

function addHarnessFaults(run: RunIndex, title: string, exchanges: readonly Exchange[]): void {
  for (const x of exchanges) if (x.fault !== null) run.errors.push(`${title}: harness: ${x.fault}`);
}

function caseOf(run: RunIndex, started: CaseStarted, edgeUrl: string): ReportCase {
  const testCase = run.testCases.get(started.testCaseId);
  const title = caseTitle(run, started, testCase);
  const results = run.results.get(started.id) ?? [];
  const status = caseStatus(run, title, results);
  const attached = run.attachments.get(started.id) ?? [];
  const evidence = evidenceOf(attached);
  const exchanges = exchangesOf(evidence);
  addHarnessFaults(run, title, exchanges);
  return {
    title,
    expected: attached.find((a) => a.mediaType === EXPECTATION_MEDIA_TYPE)?.body ?? '',
    status: status.toLowerCase(),
    errors: failures(results),
    stdout: exchangeLines(exchanges, edgeUrl),
    steps: stepsOf(run, started, testCase, evidence),
    console: [],
    network: failedRequests(exchanges, edgeUrl),
    screenshot: null,
    aria: null,
    harness: null,
  };
}

/** The cases of one run in the order they ran, and the faults that broke the run. */
export function buildCases(
  envelopes: readonly Envelope[],
  edgeUrl: string,
): { cases: ReportCase[]; errors: string[] } {
  const run = new RunIndex();
  for (const envelope of envelopes) run.add(envelope);
  const cases = run.started
    .filter((s) => !run.retried.has(s.id))
    .map((s) => caseOf(run, s, edgeUrl));
  return { cases, errors: run.errors };
}
