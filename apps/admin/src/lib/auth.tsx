'use client';

import { isResetApiError, type AdminRole } from '@reset/api-client';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { adminClient, setSessionLostHandler } from './client.js';

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

interface AuthContextValue {
  session: AdminSession | null;
  /** True until the stored token has been checked against the server. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Role check. OWNER can do anything a MANAGER can, and so on down. */
  can: (minimum: AdminRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Higher index = more authority. */
const RANK: Record<AdminRole, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };

const SESSION_KEY = 'reset.admin.session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const signOut = useCallback(() => {
    adminClient().auth.signOut();
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Private mode. The token is already gone from memory, which is what matters.
    }
    setSession(null);
    router.replace('/login');
  }, [router]);

  /**
   * Restores a session on load.
   *
   * The profile is cached alongside the token rather than re-fetched, because there is no
   * `GET /admin/auth/me` — the login response is the only place the role appears. The token
   * remains the authority: a cached role cannot grant access the server will not, since
   * every admin route checks the JWT independently.
   */
  useEffect(() => {
    setSessionLostHandler(() => {
      setSession(null);
      router.replace('/login');
    });

    if (!adminClient().isAuthenticated) {
      setLoading(false);
      return () => setSessionLostHandler(null);
    }

    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw !== null) setSession(JSON.parse(raw) as AdminSession);
    } catch {
      // Corrupt or unreadable. Treat it as signed out rather than crashing the shell.
    }
    setLoading(false);

    return () => setSessionLostHandler(null);
  }, [router]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { admin } = await adminClient().auth.login(email, password);

    const next: AdminSession = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      // Session survives this tab only. Better than refusing to sign in.
    }
    setSession(next);
  }, []);

  const can = useCallback(
    (minimum: AdminRole) => session !== null && RANK[session.role] >= RANK[minimum],
    [session],
  );

  const value = useMemo(
    () => ({ session, loading, signIn, signOut, can }),
    [session, loading, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used inside an <AuthProvider>.');
  return context;
}

/**
 * Turns any thrown value into something worth showing a person.
 *
 * Staff read these at a counter with someone waiting, so the API's `detail` is preferred
 * over its `title` and a bare "Error" is never shown.
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (isResetApiError(error)) {
    if (error.code === 'FORBIDDEN') return 'Your account does not have access to that.';
    if (error.code === 'RATE_LIMITED') return 'Too many attempts. Wait a moment and retry.';
    return error.detail ?? error.message ?? fallback;
  }
  if (error instanceof Error && error.message !== '') return error.message;
  return fallback;
}
