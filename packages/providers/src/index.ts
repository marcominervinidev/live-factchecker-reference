// Public interface of @lfc/providers: the model adapter port, callValidated and the adapters (here the mock).
export type {
  AdapterErrorKind,
  AdapterResult,
  ContentBlock,
  ModelAdapter,
  ModelRequest,
  ModelRole,
  Thinking,
  Usage,
} from './model-adapter.ts';
export {
  callValidated,
  type CallOutcome,
  type CallValidatedOptions,
  type ContractViolation,
  type DroppedElement,
} from './call-validated.ts';
export {
  createMockClaimExtractor,
  parseExpectations,
  type Expectation,
  type MockClaimExtractorOptions,
} from './mock/mock-claim-extractor.ts';
export {
  createMockTopicExtractor,
  type MockTopicExtractorOptions,
} from './mock/mock-topic-extractor.ts';
