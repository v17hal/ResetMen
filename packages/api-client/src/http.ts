import type { AuthTokens } from '@reset/types';

import { ResetApiError, ResetNetworkError, problemFromResponse } from './errors.js';
import { memoryTokenStore, type TokenPair, type TokenStore } from './tokens.js';

export type QueryValue = string | number | boolean | null | undefined | readonly string[];
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /**
   * Sent as `Idempotency-Key`. Supply a stable value for anything that spends money: the
   * server replays the first response instead of charging twice. Omitted requests get no
   * header at all — an auto-generated per-call key would be new on every retry and so would
   * protect nothing.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Overrides the client default. */
  timeoutMs?: number;
  /** Skips the Authorization header and the refresh-and-retry path. */
  anonymous?: boolean;
  headers?: Record<string, string>;
}

export interface HttpClientOptions {
  /** Origin only, e.g. `https://api.reset.app`. The `/api/v1` prefix is added here. */
  baseUrl: string;
  /** Which refresh endpoint a 401 should use. Staff and customers hold different tokens. */
  audience?: 'customer' | 'admin';
  tokens?: TokenStore;
  /** `X-Store-Id`. Omit for a single-outlet install; the server picks the only active store. */
  storeId?: string;
  /** Default per-request timeout. 0 disables it. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  /**
   * Called when the session is unrecoverable — no refresh token, or the refresh itself was
   * rejected. Tokens are already cleared by the time this runs; the app should route to
   * sign-in rather than clearing anything itself.
   */
  onAuthFailure?: () => void;
  /** Called after a successful silent refresh, so a host app can persist the new pair. */
  onTokensChanged?: (tokens: TokenPair | null) => void;
}

const API_PREFIX = '/api/v1';

export class HttpClient {
  readonly tokens: TokenStore;

  private readonly baseUrl: string;
  private readonly audience: 'customer' | 'admin';
  private readonly storeId: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onAuthFailure: (() => void) | undefined;
  private readonly onTokensChanged: ((tokens: TokenPair | null) => void) | undefined;

  /**
   * The in-flight refresh, shared by every request that 401s while it runs.
   *
   * Refresh tokens rotate: the server issues a new pair and invalidates the old one. Six
   * requests waking up together behind an expired access token would otherwise fire six
   * refreshes with the same token — the first succeeds and the other five are rejected as
   * replays, signing the user out mid-session. One promise, shared.
   */
  private refreshInFlight: Promise<TokenPair | null> | null = null;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.audience = options.audience ?? 'customer';
    this.tokens = options.tokens ?? memoryTokenStore();
    this.storeId = options.storeId;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.onAuthFailure = options.onAuthFailure;
    this.onTokensChanged = options.onTokensChanged;

    const bound = options.fetch ?? globalThis.fetch;
    if (typeof bound !== 'function') {
      throw new Error(
        '@reset/api-client needs a fetch implementation. Node 18+ and every target browser ' +
          'provide one globally; pass `fetch` explicitly if this runtime does not.',
      );
    }
    // Unbound `globalThis.fetch` throws "Illegal invocation" in browsers once detached.
    this.fetchImpl = bound.bind(globalThis);
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  put<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, options);
  }

  patch<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, options);
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  setTokens(tokens: TokenPair | null): void {
    this.tokens.set(tokens);
    this.onTokensChanged?.(tokens);
  }

  /** True when a token is held. Says nothing about whether the server still accepts it. */
  get isAuthenticated(): boolean {
    return this.tokens.get() !== null;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(method, path, options, false);
    return this.parse<T>(response);
  }

  /**
   * Raw send with the refresh-and-retry loop. `isRetry` is the recursion guard — a second
   * 401 after a fresh token means the token is not the problem.
   */
  private async send(
    method: string,
    path: string,
    options: RequestOptions,
    isRetry: boolean,
  ): Promise<Response> {
    const url = this.buildUrl(path, options.query);
    const headers = this.buildHeaders(options);

    const response = await this.dispatch(url, method, headers, options);

    if (response.status !== 401 || options.anonymous === true || isRetry) {
      if (response.ok) return response;
      throw new ResetApiError(await problemFromResponse(response));
    }

    const refreshed = await this.refresh();
    if (refreshed === null) {
      throw new ResetApiError(await problemFromResponse(response));
    }

    return this.send(method, path, options, true);
  }

  private async dispatch(
    url: string,
    method: string,
    headers: Record<string, string>,
    options: RequestOptions,
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const { signal, cleanup, didTimeout } = composeSignal(options.signal, timeoutMs);

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: encodeBody(options.body),
        signal,
      });
    } catch (error) {
      if (didTimeout()) {
        throw new ResetNetworkError(`Request timed out after ${timeoutMs}ms`, {
          cause: error,
          timedOut: true,
        });
      }
      // A caller-initiated abort is a deliberate cancellation — a component unmounting, a
      // newer search keystroke. Propagate it untouched so callers can ignore it, rather
      // than reporting "you appear to be offline" to someone who is not.
      if (options.signal?.aborted === true) throw error;
      throw new ResetNetworkError('Could not reach the RESET API', { cause: error });
    } finally {
      cleanup();
    }
  }

  private async parse<T>(response: Response): Promise<T> {
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return (await response.text()) as T;
    return (await response.json()) as T;
  }

  private buildUrl(path: string, query: Query | undefined): string {
    const normalised = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${API_PREFIX}${normalised}`;
    const qs = buildQuery(query);
    return qs === '' ? url : `${url}?${qs}`;
  }

  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    // FormData sets its own Content-Type, including the multipart boundary. Setting it here
    // would produce a header with no boundary and every upload would fail to parse.
    if (options.body !== undefined && !isFormData(options.body)) {
      headers['Content-Type'] = 'application/json';
    }
    if (this.storeId !== undefined) headers['X-Store-Id'] = this.storeId;
    if (options.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    if (options.anonymous !== true) {
      const token = this.tokens.get()?.accessToken;
      if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /** Single-flight. Concurrent callers await the same promise and share its outcome. */
  private refresh(): Promise<TokenPair | null> {
    this.refreshInFlight ??= this.performRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<TokenPair | null> {
    const current = this.tokens.get();
    if (current === null) {
      this.failAuth();
      return null;
    }

    const path = this.audience === 'admin' ? '/admin/auth/refresh' : '/auth/refresh';

    try {
      const response = await this.dispatch(
        this.buildUrl(path, undefined),
        'POST',
        { Accept: 'application/json', 'Content-Type': 'application/json' },
        { body: { refreshToken: current.refreshToken } },
      );

      if (!response.ok) {
        this.failAuth();
        return null;
      }

      const tokens = (await response.json()) as AuthTokens;
      if (typeof tokens.accessToken !== 'string' || typeof tokens.refreshToken !== 'string') {
        this.failAuth();
        return null;
      }

      const pair: TokenPair = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
      this.setTokens(pair);
      return pair;
    } catch {
      // The network failed rather than the token being rejected. Keep the tokens — they may
      // be perfectly valid, and discarding them would sign the user out for going through a
      // tunnel. The original request still surfaces its own error to the caller.
      return null;
    }
  }

  private failAuth(): void {
    this.setTokens(null);
    this.onAuthFailure?.();
  }
}

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function encodeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (isFormData(body)) return body;
  return JSON.stringify(body);
}

export function buildQuery(query: Query | undefined): string {
  if (query === undefined) return '';
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      // Repeated `?ids=a&ids=b`. The server's `idList` accepts this and the comma form;
      // repetition is the one that survives a value containing a comma.
      for (const item of value) params.append(key, item);
    } else {
      params.append(key, String(value));
    }
  }

  return params.toString();
}

/**
 * Merges a caller's AbortSignal with a timeout.
 *
 * Written by hand rather than with `AbortSignal.any` and `AbortSignal.timeout`: both are
 * recent, and this ships to whatever browser is on a ₹10,000 Android phone.
 */
function composeSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; cleanup: () => void; didTimeout: () => boolean } {
  if (timeoutMs <= 0 && external === undefined) {
    return { signal: undefined, cleanup: () => {}, didTimeout: () => false };
  }

  const controller = new AbortController();
  let timedOut = false;

  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

  const forward = (): void => controller.abort();
  if (external !== undefined) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', forward, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener('abort', forward);
    },
    didTimeout: () => timedOut,
  };
}
