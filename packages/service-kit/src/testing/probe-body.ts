// Test helper of issue #25 (T1), written and frozen with the tests; production code never imports it.
// Shared by the stage-1 tests of the service kit (relative import) and the stage-2a steps of every service
// (`@lfc/service-kit/testing`: the package's `exports` map `./testing` to this file). Stage 3 keeps its own copy in
// tests/api/steps: it treats the stack as a black box and imports no workspace code (.claude/rules/tests.md).
//
// The /ready body rule (AC6): every dependency name carries the string "ok" or "failed". The shape around it is not
// fixed, so this reads every [name, state] pair whose value is "ok" or "failed", wherever it sits in the JSON.
export function dependencyStates(body: string): Record<string, string> {
  const states: Record<string, string> = {};
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (inner === 'ok' || inner === 'failed') states[key] = inner;
      else walk(inner);
    }
  };
  walk(JSON.parse(body));
  return states;
}
