'use client';

import { isResetApiError } from '@reset/api-client';
import { ToastProvider } from '@reset/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth.js';

export function Providers({ children }: { children: ReactNode }) {
  /**
   * One QueryClient per browser session, created in state so React does not rebuild it on
   * every render and throw the cache away with it.
   */
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * The counter is a live screen. Ten seconds is short enough that a booking made
             * on the phone in someone's hand shows up before they reach the desk, and long
             * enough that switching tabs does not hammer the API.
             */
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // Retrying a 403 or a validation error just delays the message. Only server
              // faults and rate limits are worth a second attempt.
              if (isResetApiError(error) && !error.isRetryable) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // Never automatic. A retried booking, refund or status change is a second one.
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
