// A diagnostic code for an error whose text must not be logged (.claude/rules/platform.md, "Logging and health":
// an error text can name a host, a port, a path or a piece of a transcript). The code is the name of the error's
// class and nothing else: `TypeError` tells a programming error from `Error` or `MaxRetriesPerRequestError`, and a
// class name holds no data. The error's `code` (`ECONNREFUSED`) and its message stay out on purpose. It fits the
// log field `reason`, a code of letters, digits and `_`.
const CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** The class name of an Error when it is a usable code, otherwise `unknown`. */
export function errorCode(error: unknown): string {
  if (error instanceof Error && CODE.test(error.name)) return error.name;
  return 'unknown';
}

/** A mistake in this program's own code, as opposed to a dependency that failed or an input that was refused. */
export function isProgrammingError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    error instanceof RangeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError
  );
}
