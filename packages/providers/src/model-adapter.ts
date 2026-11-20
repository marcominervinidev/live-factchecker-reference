// The model adapter port (#29 AC18): the one interface the four roles of increment 1 call through, for the Claim
// Extractor here and unchanged for the Verifier, Resolver and Topic Extractor (T4b, T5, T6) and the Anthropic adapter
// (T7). The Speaker Mapper and the model call of a Prefetch extend ModelRole when they come.
// Model id and thinking come from configuration per role and are passed through; an adapter never picks them.
// Reference: evals/src/harness/adapters/base.py (ModelRequest, AdapterResult).

export type ModelRole = 'claim_extractor' | 'resolver' | 'verifier' | 'topic_extractor';

export type Thinking = 'off' | 'low';

/** One content block of the prompt, in order; `cache` marks a cache breakpoint, `system` a system block. */
export interface ContentBlock {
  readonly kind: string;
  readonly text: string;
  readonly cache: boolean;
  readonly system: boolean;
}

export interface ModelRequest {
  readonly role: ModelRole;
  /** For the record per request (T7) only; never sent to a provider. */
  readonly sessionId: string;
  readonly model: string;
  readonly thinking: Thinking;
  readonly blocks: readonly ContentBlock[];
  /** The strict JSON Schema of the answer and its name, enforced by the adapter (ADR 0004). */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly schemaName: string;
  readonly maxTokens: number;
  /** Epoch milliseconds (`Date.now()`) by which the call must have returned. */
  readonly deadline: number;
  readonly signal: AbortSignal;
}

export interface Usage {
  readonly input: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
  readonly output: number;
  readonly thinking: number;
}

/** fatal: never repeated (e.g. an exhausted account); retryable and timeout: repeated once (spec 4.2). */
export type AdapterErrorKind = 'fatal' | 'retryable' | 'timeout';

export type AdapterResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly usage: Usage;
      readonly latencySeconds: number;
      readonly model: string;
      readonly adapter: string;
    }
  | {
      readonly ok: false;
      readonly error: { readonly kind: AdapterErrorKind; readonly message: string };
      readonly latencySeconds: number;
      readonly model: string;
      readonly adapter: string;
    };

/** An adapter answers every call with a result, an error included; it rejects only on a programming error. */
export interface ModelAdapter {
  readonly name: string;
  call(request: ModelRequest): Promise<AdapterResult>;
}
