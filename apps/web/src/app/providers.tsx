'use client';

import { isResetApiError } from '@reset/api-client';
import { ToastProvider } from '@reset/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The catalog barely changes; availability is never cached at all and sets its
            // own staleTime of 0 where it is used.
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (isResetApiError(error) && !error.isRetryable) return false;
              return failureCount < 2;
            },
          },
          // Never automatic. A retried hold or order is a second one.
          mutations: { retry: false },
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
