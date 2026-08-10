import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HttpClient,
  ResetApiError,
  ResetNetworkError,
  buildQuery,
  memoryTokenStore,
} from '../src/index.js';

const BASE = 'https://api.test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function problem(code: string, status: number, detail?: string): Response {
  return new Response(
    JSON.stringify({
      type: `https://api.reset.app/errors/${code.toLowerCase()}`,
      title: 'Something went wrong',
      status,
      code,
      detail,
    }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

describe('buildQuery', () => {
  it('drops undefined and null rather than sending the string "undefined"', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: 'x' })).toBe('a=1&d=x');
  });

  it('repeats a key for array values', () => {
    expect(buildQuery({ ids: ['a', 'b'] })).toBe('ids=a&ids=b');
  });

  it('encodes values that would otherwise break the URL', () => {
    expect(buildQuery({ q: 'a b&c=d' })).toBe('q=a+b%26c%3Dd');
  });

  it('keeps false, which is a real filter value and not an absent one', () => {
    expect(buildQuery({ blocked: false })).toBe('blocked=false');
  });
});

describe('HttpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  function client(overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
    return new HttpClient({
      baseUrl: BASE,
      fetch: fetchMock as unknown as typeof fetch,
      ...overrides,
    });
  }

  it('prefixes every path with /api/v1', async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));
    await client().get('/catalog/home');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/api/v1/catalog/home`);
  });

  it('sends the store header only when one is configured', async () => {
    // A Response body can only be read once, so each call needs its own object.
    fetchMock.mockImplementation(() => Promise.resolve(json({})));

    await client().get('/catalog/store');
    expect(headersOf(fetchMock, 0)['X-Store-Id']).toBeUndefined();

    await client({ storeId: 'store-1' }).get('/catalog/store');
    expect(headersOf(fetchMock, 1)['X-Store-Id']).toBe('store-1');
  });

  it('attaches the bearer token, and omits it for anonymous calls', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({})));
    const http = client({ tokens: memoryTokenStore({ accessToken: 'a', refreshToken: 'r' }) });

    await http.get('/auth/me');
    expect(headersOf(fetchMock, 0)['Authorization']).toBe('Bearer a');

    await http.post('/auth/otp/request', { body: { phone: '+91' }, anonymous: true });
    expect(headersOf(fetchMock, 1)['Authorization']).toBeUndefined();
  });

  it('sets Idempotency-Key only when the caller supplies one', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({})));
    const http = client();

    await http.post('/payments/order', { body: {}, idempotencyKey: 'key-1' });
    expect(headersOf(fetchMock, 0)['Idempotency-Key']).toBe('key-1');

    await http.post('/payments/order', { body: {} });
    expect(headersOf(fetchMock, 1)['Idempotency-Key']).toBeUndefined();
  });

  it('turns problem+json into a ResetApiError carrying the code', async () => {
    fetchMock.mockResolvedValue(problem('SLOT_TAKEN', 409, 'That time has just gone.'));

    const error = await client()
      .post('/bookings/hold', { body: {} })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResetApiError);
    const api = error as ResetApiError;
    expect(api.code).toBe('SLOT_TAKEN');
    expect(api.status).toBe(409);
    expect(api.isSlotGone).toBe(true);
    expect(api.message).toBe('That time has just gone.');
  });

  it('survives an error body that is not JSON at all', async () => {
    // A proxy or load balancer returning its own HTML error page. This must not surface as
    // a JSON parse error somewhere up in a React tree.
    fetchMock.mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = (await client()
      .get('/catalog/home')
      .catch((e: unknown) => e)) as ResetApiError;

    expect(error).toBeInstanceOf(ResetApiError);
    expect(error.code).toBe('INTERNAL');
    expect(error.status).toBe(502);
    expect(error.isRetryable).toBe(true);
  });

  it('does not hand UI code an error code it cannot switch on', async () => {
    // A server newer than this client. Keep the prose, discard the unknown code.
    fetchMock.mockResolvedValue(
      json({ title: 'Nope', status: 418, code: 'INVENTED_LATER' }, 418),
    );

    const error = (await client()
      .get('/x')
      .catch((e: unknown) => e)) as ResetApiError;

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.status).toBe(418);
  });

  it('reports an unreachable API as a network error, not an API error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await client()
      .get('/catalog/home')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResetNetworkError);
    expect((error as ResetNetworkError).timedOut).toBe(false);
  });

  it('returns undefined for 204 rather than trying to parse an empty body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(client().delete('/admin/media/x')).resolves.toBeUndefined();
  });

  it('returns text when the response is not JSON — CSV export', async () => {
    fetchMock.mockResolvedValue(
      new Response('date,net\n2026-08-10,4900', {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      }),
    );
    await expect(client().get<string>('/admin/reports/export')).resolves.toContain('4900');
  });

  describe('token refresh', () => {
    it('refreshes once and replays the original request', async () => {
      const tokens = memoryTokenStore({ accessToken: 'old', refreshToken: 'r1' });
      fetchMock
        .mockResolvedValueOnce(problem('UNAUTHENTICATED', 401))
        .mockResolvedValueOnce(json({ accessToken: 'new', refreshToken: 'r2' }))
        .mockResolvedValueOnce(json({ id: 'user-1' }));

      const result = await client({ tokens }).get<{ id: string }>('/auth/me');

      expect(result).toEqual({ id: 'user-1' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${BASE}/api/v1/auth/refresh`);
      // The replay must carry the *new* token, not the one that just failed.
      expect(headersOf(fetchMock, 2)['Authorization']).toBe('Bearer new');
      expect(tokens.get()).toEqual({ accessToken: 'new', refreshToken: 'r2' });
    });

    it('uses the admin refresh endpoint for a staff client', async () => {
      fetchMock
        .mockResolvedValueOnce(problem('UNAUTHENTICATED', 401))
        .mockResolvedValueOnce(json({ accessToken: 'new', refreshToken: 'r2' }))
        .mockResolvedValueOnce(json({}));

      await client({
        audience: 'admin',
        tokens: memoryTokenStore({ accessToken: 'old', refreshToken: 'r1' }),
      }).get('/admin/reports/dashboard');

      expect(fetchMock.mock.calls[1]?.[0]).toBe(`${BASE}/api/v1/admin/auth/refresh`);
    });

    it('refreshes exactly once for six requests that 401 together', async () => {
      // Refresh tokens rotate. Six parallel refreshes would mean the first succeeds and the
      // other five are rejected as replays — signing the user out mid-session.
      const tokens = memoryTokenStore({ accessToken: 'old', refreshToken: 'r1' });
      let refreshCalls = 0;

      fetchMock.mockImplementation((url: string, init: RequestInit) => {
        if (url.endsWith('/auth/refresh')) {
          refreshCalls += 1;
          return Promise.resolve(json({ accessToken: 'new', refreshToken: 'r2' }));
        }
        const auth = (init.headers as Record<string, string>)['Authorization'];
        return Promise.resolve(
          auth === 'Bearer new' ? json({ ok: true }) : problem('UNAUTHENTICATED', 401),
        );
      });

      const http = client({ tokens });
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => http.get(`/bookings/${i}`)),
      );

      expect(refreshCalls).toBe(1);
      expect(results).toHaveLength(6);
      expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true);
    });

    it('gives up after one retry rather than looping', async () => {
      fetchMock
        .mockResolvedValueOnce(problem('UNAUTHENTICATED', 401))
        .mockResolvedValueOnce(json({ accessToken: 'new', refreshToken: 'r2' }))
        .mockResolvedValueOnce(problem('UNAUTHENTICATED', 401));

      await expect(
        client({
          tokens: memoryTokenStore({ accessToken: 'old', refreshToken: 'r1' }),
        }).get('/auth/me'),
      ).rejects.toBeInstanceOf(ResetApiError);

      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('clears tokens and calls onAuthFailure when the refresh itself is rejected', async () => {
      const onAuthFailure = vi.fn();
      const tokens = memoryTokenStore({ accessToken: 'old', refreshToken: 'expired' });

      fetchMock
        .mockResolvedValueOnce(problem('UNAUTHENTICATED', 401))
        .mockResolvedValueOnce(problem('UNAUTHENTICATED', 401));

      await expect(client({ tokens, onAuthFailure }).get('/auth/me')).rejects.toBeInstanceOf(
        ResetApiError,
      );

      expect(tokens.get()).toBeNull();
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
    });

    it('keeps the tokens when the refresh fails on the network', async () => {
      // Going through a tunnel is not a reason to sign someone out.
      const onAuthFailure = vi.fn();
      const tokens = memoryTokenStore({ accessToken: 'old', refreshToken: 'r1' });

      fetchMock
        .mockResolvedValueOnce(problem('UNAUTHENTICATED', 401))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(client({ tokens, onAuthFailure }).get('/auth/me')).rejects.toBeInstanceOf(
        ResetApiError,
      );

      expect(tokens.get()).not.toBeNull();
      expect(onAuthFailure).not.toHaveBeenCalled();
    });

    it('does not try to refresh an anonymous request', async () => {
      fetchMock.mockResolvedValue(problem('UNAUTHENTICATED', 401));

      await expect(
        client({ tokens: memoryTokenStore({ accessToken: 'a', refreshToken: 'r' }) }).post(
          '/auth/otp/request',
          { body: {}, anonymous: true },
        ),
      ).rejects.toBeInstanceOf(ResetApiError);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails immediately when there is no token to refresh with', async () => {
      const onAuthFailure = vi.fn();
      fetchMock.mockResolvedValue(problem('UNAUTHENTICATED', 401));

      await expect(client({ onAuthFailure }).get('/auth/me')).rejects.toBeInstanceOf(
        ResetApiError,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeouts and cancellation', () => {
    it('reports a timeout distinctly from a network failure', async () => {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      });

      const error = (await client({ timeoutMs: 10 })
        .get('/catalog/home')
        .catch((e: unknown) => e)) as ResetNetworkError;

      expect(error).toBeInstanceOf(ResetNetworkError);
      expect(error.timedOut).toBe(true);
    });

    it('propagates a caller abort untouched', async () => {
      // A component unmounting or a superseded keystroke is a deliberate cancellation, not
      // an error to show the user.
      const controller = new AbortController();
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        });
      });

      const promise = client().get('/availability/slots', { signal: controller.signal });
      controller.abort();

      await expect(promise).rejects.not.toBeInstanceOf(ResetNetworkError);
    });
  });
});

function headersOf(mock: ReturnType<typeof vi.fn>, call: number): Record<string, string> {
  return (mock.mock.calls[call]?.[1] as RequestInit).headers as Record<string, string>;
}
