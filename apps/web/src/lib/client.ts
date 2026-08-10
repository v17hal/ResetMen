'use client';

import { ResetClient, browserTokenStore } from '@reset/api-client';

/**
 * One customer client for the session.
 *
 * Module-level, created lazily — the token store and the single-flight refresh promise both
 * live on it, and a per-render instance would mean several components each refreshing the
 * same rotating token.
 */
let instance: ResetClient | null = null;
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(handler: (() => void) | null): void {
  onSessionLost = handler;
}

export function api(): ResetClient {
  instance ??= new ResetClient({
    baseUrl: apiBaseUrl(),
    tokens: browserTokenStore('reset.web.auth'),
    onAuthFailure: () => onSessionLost?.(),
  });
  return instance;
}

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (url === undefined || url === '') {
    throw new Error('NEXT_PUBLIC_API_URL is not set. Copy .env.example to .env.local.');
  }
  return url;
}
