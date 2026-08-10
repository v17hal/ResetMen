'use client';

import { ResetAdminClient, browserTokenStore } from '@reset/api-client';

/**
 * One client for the whole app.
 *
 * A module-level singleton rather than a per-render instance: the token store and the
 * single-flight refresh promise both live on the client, and a new instance per render
 * would mean six components each refreshing the same rotating token.
 *
 * Created lazily so it is never constructed during a server render, where `localStorage`
 * does not exist.
 */
let instance: ResetAdminClient | null = null;

/** Set by the auth provider so a rejected refresh can route to the login screen. */
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

export function adminClient(): ResetAdminClient {
  instance ??= new ResetAdminClient({
    baseUrl: apiBaseUrl(),
    tokens: browserTokenStore('reset.admin.auth'),
    onAuthFailure: () => onSessionLost?.(),
  });
  return instance;
}

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set. Copy .env.example to .env.local — without it the ' +
        'panel builds fine and then fails on the first request, which is a worse way to ' +
        'find out.',
    );
  }
  return url;
}
