'use client';

import { isResetApiError, type UserProfile } from '@reset/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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
  /**
   * Bumped whenever the token changes, purely to force a render.
   *
   * `api().isAuthenticated` reads the token store directly. It is not React state, so
   * storing a token during sign-in changed nothing React could see: the profile query
   * stayed `enabled: false`, and invalidating a disabled query does not fetch it. Sign-in
   * appeared to do nothing until some other navigation happened to re-render the provider
   * and the flag was read again — which is exactly how it looked, signed out on the
   * checkout screen and signed in once you went back.
   */
  const [authTick, setAuthTick] = useState(0);
  const authenticated = useMemo(() => api().isAuthenticated, [authTick]);

  const profile = useQuery({
    queryKey: ['me'],
    queryFn: () => api().auth.me(),
    enabled: authenticated,
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
    setAuthTick((tick) => tick + 1);
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
      hasToken: authenticated,
      signOut,
      // The bump is what matters: it re-enables the query. The invalidate then refetches a
      // profile the previous user may have left behind.
      refresh: () => {
        setAuthTick((tick) => tick + 1);
        void queryClient.invalidateQueries({ queryKey: ['me'] });
      },
    }),
    [profile.data, profile.isLoading, signOut, queryClient, authenticated],
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
/**
 * An error whose message was written for the person reading it.
 *
 * `errorMessage` returns its fallback for anything it does not recognise, which is right
 * for a network failure and wrong for our own validation: "Enter a 10-digit mobile number"
 * became "Something went wrong", and the customer was told nothing at all about the field
 * they had just got wrong. Raising this says the message is safe to show as written.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof UserFacingError) return error.message;

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
      case 'RATE_LIMITED':
        return 'Too many attempts. Wait a minute and try again.';
      case 'STORE_CLOSED':
        return 'The store is closed then. Try another day.';
      case 'UNAUTHENTICATED':
        // "again" is wrong for the commonest case by far — someone who has not signed in
        // yet, on the booking screen, being told to do something over that they never did.
        return error.detail ?? 'Please sign in to continue.';
      default:
        return error.detail ?? fallback;
    }
  }
  return fallback;
}
