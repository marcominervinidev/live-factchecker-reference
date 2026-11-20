// What the acceptance run attaches per case and the runner reads back (tests/acceptance/README.md, report shape).
// The owner's expectation comes from steps/owner.steps.ts; one exchange per request of the API driver from
// support/evidence.ts.

// Equals the literal in the frozen steps/owner.steps.ts (it cannot import this); runner/report.test.ts pins both.
export const EXPECTATION_MEDIA_TYPE = 'text/x-owner-expectation';
export const EXCHANGE_MEDIA_TYPE = 'application/x-lfc-exchange+json';

/**
 * How the TLS connection of a request was checked (judge J1): read from the handshake of the connection the request
 * step opened (support/evidence.ts observes tls.connect, any agent), never from a second probe or an earlier step.
 */
export interface TlsFacts {
  /** False only when the request turned verification off; the stage-3 library never does. */
  readonly rejectUnauthorized: boolean;
  /** The trust anchor: the path in LFC_EDGE_CA_FILE when the request carried exactly its bytes, else `other`. */
  readonly ca: string;
  readonly authorized: boolean;
  readonly authorizationError: string | null;
  /** Common name of the issuer of the certificate the edge presented. */
  readonly issuer: string | null;
  readonly servername: string | null;
}

export interface ConnectOptions {
  readonly ca?: unknown;
  readonly rejectUnauthorized?: boolean | undefined;
  readonly servername?: string | null | undefined;
}

interface CheckedSocket {
  readonly authorized: boolean;
  /** Node sets null when the certificate verified. */
  readonly authorizationError?: Error | null | undefined;
  getPeerCertificate(): { readonly issuer?: { readonly CN?: unknown } | undefined };
}

type CaFile = { readonly path: string; readonly bytes: Buffer } | undefined;

/** The trust anchor of a connection: LFC_EDGE_CA_FILE when the options carry exactly its bytes. */
function anchor(options: ConnectOptions, caFile: CaFile): string {
  const ca = options.ca;
  if (caFile !== undefined && Buffer.isBuffer(ca) && ca.equals(caFile.bytes)) return caFile.path;
  return ca === undefined ? 'system' : 'other';
}

/** The code of a TLS error (`SELF_SIGNED_CERT_IN_CHAIN`, …), else its message. */
function reason(error: unknown): string {
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

/** The facts of one completed handshake; `caFile` is LFC_EDGE_CA_FILE and its bytes. */
export function tlsFacts(options: ConnectOptions, socket: CheckedSocket, caFile: CaFile): TlsFacts {
  const cn = socket.getPeerCertificate().issuer?.CN;
  return {
    rejectUnauthorized: options.rejectUnauthorized !== false,
    ca: anchor(options, caFile),
    authorized: socket.authorized,
    authorizationError: socket.authorizationError ? reason(socket.authorizationError) : null,
    issuer: typeof cn === 'string' ? cn : null,
    servername: options.servername ?? null,
  };
}

/** The facts of a handshake that failed, e.g. a certificate the trust anchor does not vouch for. */
export function tlsFailure(options: ConnectOptions, error: unknown, caFile: CaFile): TlsFacts {
  return {
    rejectUnauthorized: options.rejectUnauthorized !== false,
    ca: anchor(options, caFile),
    authorized: false,
    authorizationError: reason(error),
    issuer: null,
    servername: options.servername ?? null,
  };
}

/** One line for the report, the same shape for every request; `not observed` when no handshake was seen. */
export function tlsLine(tls: TlsFacts | null): string {
  if (tls === null) return 'TLS not observed';
  const issuer = tls.issuer === null ? 'none' : JSON.stringify(tls.issuer);
  const error =
    tls.authorizationError === null ? '' : ` error=${JSON.stringify(tls.authorizationError)}`;
  return `TLS rejectUnauthorized=${String(tls.rejectUnauthorized)} ca=${tls.ca} authorized=${String(tls.authorized)}${error} issuer=${issuer} servername=${tls.servername ?? 'none'}`;
}

/** One request through the edge as the API driver saw it; status null when no answer came. */
export interface Exchange {
  readonly method: 'GET';
  readonly path: string;
  readonly status: number | null;
  /** The edge's own mark (`X-Lfc-Edge`) on answers it wrote itself; null on forwarded answers. */
  readonly edgeMark: string | null;
  readonly body: string;
  readonly at: string;
  /**
   * A harness fault, not an answer of the edge: the request step passed but the World held no answer the evidence
   * hook could read (review R1). report.ts lifts it into the top-level `errors`; the run then exits 1.
   */
  readonly fault: string | null;
  /** The handshake of the connection the request used; null when none was observed. */
  readonly tls: TlsFacts | null;
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);

export function parseExchange(json: string): Exchange {
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null) throw new TypeError('exchange: not an object');
  const field = (name: string): unknown => Reflect.get(value, name);
  const status = field('status');
  const [path, edgeMark, body, at] = ['path', 'edgeMark', 'body', 'at'].map(field);
  if (
    field('method') !== 'GET' ||
    !isText(path) ||
    !isTextOrNull(edgeMark) ||
    !isText(body) ||
    !isText(at)
  ) {
    throw new TypeError('exchange: unexpected shape');
  }
  if (status !== null && typeof status !== 'number') throw new TypeError('exchange: status');
  const fault = field('fault');
  if (!isTextOrNull(fault)) throw new TypeError('exchange: fault');
  return { method: 'GET', path, status, edgeMark, body, at, fault, tls: parseTls(field('tls')) };
}

function parseTls(value: unknown): TlsFacts | null {
  if (value === null) return null;
  if (typeof value !== 'object') throw new TypeError('exchange: tls');
  const field = (name: string): unknown => Reflect.get(value, name);
  const [rejectUnauthorized, authorized] = [field('rejectUnauthorized'), field('authorized')];
  const [ca, authorizationError, issuer, servername] = [
    'ca',
    'authorizationError',
    'issuer',
    'servername',
  ].map(field);
  if (
    typeof rejectUnauthorized !== 'boolean' ||
    typeof authorized !== 'boolean' ||
    !isText(ca) ||
    !isTextOrNull(authorizationError) ||
    !isTextOrNull(issuer) ||
    !isTextOrNull(servername)
  ) {
    throw new TypeError('exchange: tls shape');
  }
  return { rejectUnauthorized, ca, authorized, authorizationError, issuer, servername };
}
