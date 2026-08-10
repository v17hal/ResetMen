export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Where the client keeps its tokens.
 *
 * Synchronous on purpose. An async store would make every single request await a read before
 * it could set a header, and the two stores that matter — memory and `localStorage` — are
 * both synchronous. A store backed by something genuinely async (Flutter secure storage,
 * an OS keychain) should hydrate into memory at startup rather than being read per request.
 */
export interface TokenStore {
  get(): TokenPair | null;
  set(tokens: TokenPair | null): void;
}

export function memoryTokenStore(initial: TokenPair | null = null): TokenStore {
  let tokens = initial;
  return {
    get: () => tokens,
    set: (next) => {
      tokens = next;
    },
  };
}

/**
 * `localStorage`-backed, for the web and admin apps.
 *
 * Two deliberate choices:
 *
 * 1. **A memory copy shadows the read.** `localStorage` is synchronous main-thread I/O, and
 *    reading it before every request is measurable on a low-end Android browser.
 * 2. **`storage` events are honoured.** Signing out in one tab must sign out the others;
 *    without this, a second tab keeps a live access token for up to its 15-minute TTL.
 *
 * Falls back to memory when storage is unavailable — Safari private mode throws on write,
 * and an exception there would take down sign-in rather than merely failing to persist it.
 */
export function browserTokenStore(key = 'reset.auth'): TokenStore {
  const storage = safeStorage();
  if (storage === null) return memoryTokenStore();

  let cached: TokenPair | null = read(storage, key);

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', (event) => {
      if (event.key === key || event.key === null) cached = read(storage, key);
    });
  }

  return {
    get: () => cached,
    set: (next) => {
      cached = next;
      try {
        if (next === null) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(next));
      } catch {
        // Quota exceeded or a locked-down browser. The in-memory copy still works for this
        // tab; the session simply won't survive a reload.
      }
    },
  };
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touching the API is not enough — Safari private mode only throws on write.
    const probe = '__reset_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage, key: string): TokenPair | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as TokenPair).accessToken === 'string' &&
      typeof (parsed as TokenPair).refreshToken === 'string'
    ) {
      return parsed as TokenPair;
    }
    return null;
  } catch {
    return null;
  }
}
