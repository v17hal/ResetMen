import { ERROR_CODES, type ErrorCode, type ProblemDetail } from '@reset/types';

const KNOWN_CODES = new Set<string>(ERROR_CODES);

/**
 * Every non-2xx response arrives here.
 *
 * The API speaks RFC 9457 problem+json with a stable `code`, and UI code should switch on
 * that code and nothing else. `title` and `detail` are written for a human reading a log;
 * they are not a contract and they will be reworded.
 */
export class ResetApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;
  readonly instance: string | undefined;
  readonly meta: Record<string, unknown> | undefined;

  constructor(problem: ProblemDetail) {
    super(problem.detail ?? problem.title);
    this.name = 'ResetApiError';
    this.code = problem.code;
    this.status = problem.status;
    this.detail = problem.detail;
    this.instance = problem.instance;
    this.meta = problem.meta;
  }

  /** The slot went while the customer was deciding — the one error worth a bespoke screen. */
  get isSlotGone(): boolean {
    return this.code === 'SLOT_TAKEN' || this.code === 'SLOT_UNAVAILABLE';
  }

  /** Signed out, or the session expired past what a refresh can fix. */
  get isAuthFailure(): boolean {
    return this.code === 'UNAUTHENTICATED';
  }

  /** Worth offering a retry button for; anything else will fail again the same way. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === 'RATE_LIMITED';
  }
}

/** The request never reached the API: offline, DNS, TLS, or a timeout we imposed. */
export class ResetNetworkError extends Error {
  override readonly cause: unknown;
  /** True when *we* aborted it, rather than the network failing. */
  readonly timedOut: boolean;

  constructor(message: string, options: { cause?: unknown; timedOut?: boolean } = {}) {
    super(message);
    this.name = 'ResetNetworkError';
    this.cause = options.cause;
    this.timedOut = options.timedOut ?? false;
  }
}

export function isResetApiError(error: unknown): error is ResetApiError {
  return error instanceof ResetApiError;
}

export function isResetNetworkError(error: unknown): error is ResetNetworkError {
  return error instanceof ResetNetworkError;
}

/**
 * Builds a problem from whatever the response actually contained.
 *
 * A load balancer returning an HTML 502, or a proxy truncating the body, must not surface as
 * "Unexpected token < in JSON" three layers up in a React component — so anything that is
 * not a well-formed problem document is coerced into one, keeping the real status.
 */
export async function problemFromResponse(response: Response): Promise<ProblemDetail> {
  const fallback: ProblemDetail = {
    type: 'https://api.reset.app/errors/internal',
    title: response.statusText || 'Request failed',
    status: response.status,
    code: statusToCode(response.status),
  };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  if (typeof body !== 'object' || body === null) return fallback;

  const candidate = body as Partial<ProblemDetail>;
  if (typeof candidate.code !== 'string' || !KNOWN_CODES.has(candidate.code)) {
    // A code we don't recognise means the server is newer than this client. Keep the
    // human-readable parts, but don't hand UI code a code it can't switch on.
    return {
      ...fallback,
      title: typeof candidate.title === 'string' ? candidate.title : fallback.title,
      detail: typeof candidate.detail === 'string' ? candidate.detail : undefined,
    };
  }

  return {
    type: typeof candidate.type === 'string' ? candidate.type : fallback.type,
    title: typeof candidate.title === 'string' ? candidate.title : fallback.title,
    status: typeof candidate.status === 'number' ? candidate.status : response.status,
    code: candidate.code as ErrorCode,
    detail: typeof candidate.detail === 'string' ? candidate.detail : undefined,
    instance: typeof candidate.instance === 'string' ? candidate.instance : undefined,
    meta:
      typeof candidate.meta === 'object' && candidate.meta !== null
        ? (candidate.meta as Record<string, unknown>)
        : undefined,
  };
}

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED';
  }
}
