'use client';

import { isResetApiError, type UserProfile } from '@reset/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';

import { api, setSessionLostHandler } from './client.js';

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  /** True when a token is held, even if the profile has not loaded yet. */
  hasToken: boolean;
  signOut: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * The profile is fetched rather than cached from sign-in.
   *
   * `GET /auth/me` exists and is cheap, and it means a name changed on the phone shows up
   * on the web without signing out — and a token the server has stopped accepting is
   * discovered on load rather than during checkout.
   */
  const profile = useQuery({
    queryKey: ['me'],
    queryFn: () => api().auth.me(),
    enabled: api().isAuthenticated,
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    setSessionLostHandler(() => {
      queryClient.setQueryData(['me'], null);
      void queryClient.invalidateQueries();
    });
    return () => setSessionLostHandler(null);
  }, [queryClient]);

  const signOut = useCallback(() => {
    api().auth.signOut();
    // Also clear the Firebase session. Leaving it behind means the next "Sign in" silently
    // reuses the same Google account, which looks broken to anyone trying to switch.
    void import('./firebase').then(({ signOutOfFirebase }) => signOutOfFirebase());
    queryClient.clear();
    router.push('/');
  }, [queryClient, router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: profile.data ?? null,
      loading: profile.isLoading,
      hasToken: api().isAuthenticated,
      signOut,
      refresh: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
    }),
    [profile.data, profile.isLoading, signOut, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used inside an <AuthProvider>.');
  return context;
}

/**
 * A message worth showing a customer.
 *
 * Deliberately warmer than the admin equivalent, and it never shows a raw error code —
 * someone mid-checkout needs to know what to do next, not what went wrong internally.
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (isResetApiError(error)) {
    switch (error.code) {
      case 'SLOT_TAKEN':
      case 'SLOT_UNAVAILABLE':
        return 'That time has just been taken. Pick another and we will hold it for you.';
      case 'HOLD_EXPIRED':
        return 'Your slot was released because checkout took too long. Choose a time again.';
      case 'CUSTOMER_BLOCKED':
        return 'This account cannot book online. Please call the store.';
      case 'REWARD_INVALID':
        return error.detail ?? 'That reward cannot be used on this booking.';
      case 'OUT_OF_STOCK':
        return 'That has just sold out.';
      case 'OTP_RATE_LIMITED':
      case 'RATE_LIMITED':
        return 'Too many attempts. Wait a minute and try again.';
      case 'STORE_CLOSED':
        return 'The store is closed then. Try another day.';
      case 'UNAUTHENTICATED':
        return 'Please sign in again.';
      default:
        return error.detail ?? fallback;
    }
  }
  return fallback;
}
