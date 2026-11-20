// Acceptance step shared by every ticket: records the owner's expectation, verbatim, as the case's `expected`.
// It asserts nothing; the following steps (API driver: tests/api/steps) produce the evidence the judge reads.
// The runner (`make acceptance`, tests/acceptance/README.md) copies this attachment into report.json.
import { Given } from '@cucumber/cucumber';

Given('the owner expects:', function (this: { attach: (data: string, mediaType: string) => void | Promise<void> }, expected: string) {
  return this.attach(expected, 'text/x-owner-expectation');
});
