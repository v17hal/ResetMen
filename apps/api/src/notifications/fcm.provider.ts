import { Injectable, Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';

import { loadEnv } from '../config/env.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export interface PushMessage {
  readonly token: string;
  readonly title: string;
  readonly body: string;
  /** Flat string map — FCM rejects nested values. Carries the deep link. */
  readonly data: Record<string, string>;
}

export type PushOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryable: boolean; readonly unregistered: boolean; readonly error: string };

interface ServiceAccount {
  readonly project_id: string;
  readonly client_email: string;
  readonly private_key: string;
}

/**
 * Firebase Cloud Messaging over the HTTP v1 API.
 *
 * Written against the REST endpoint with a hand-rolled service-account JWT rather than
 * pulling in `firebase-admin`, which is a very large dependency for one POST. The whole
 * integration is the token exchange below plus a single send call.
 *
 * With no credentials configured it logs what it would have sent and reports success. That
 * keeps the booking and rewards flows fully exercisable before the client's Firebase
 * project exists, and it is the same shape the real provider returns, so nothing downstream
 * behaves differently once keys arrive.
 */
@Injectable()
export class FcmProvider {
  private readonly logger = new Logger(FcmProvider.name);
  private readonly account: ServiceAccount | null;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  readonly configured: boolean;

  constructor() {
    const raw = loadEnv().FCM_SERVICE_ACCOUNT_JSON;
    this.account = raw === undefined ? null : parseServiceAccount(raw, this.logger);
    this.configured = this.account !== null;

    if (!this.configured) {
      this.logger.warn('No FCM service account — push notifications are logged, not sent.');
    }
  }

  async send(message: PushMessage): Promise<PushOutcome> {
    if (this.account === null) {
      this.logger.log(`[push:dry-run] ${message.title} — ${message.body}`);
      return { ok: true };
    }

    let accessToken: string;
    try {
      accessToken = await this.accessToken(this.account);
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        unregistered: false,
        error: `Token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: { priority: 'high', notification: { channel_id: 'reset_bookings' } },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (response.ok) return { ok: true };

      const text = await response.text();

      // A token for an uninstalled app is permanent garbage. Saying so lets the caller
      // delete it, which is the only thing that stops the device table growing forever.
      const unregistered =
        response.status === 404 ||
        text.includes('UNREGISTERED') ||
        text.includes('INVALID_ARGUMENT');

      return {
        ok: false,
        retryable: response.status >= 500 || response.status === 429,
        unregistered,
        error: `FCM ${response.status}: ${text.slice(0, 300)}`,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        unregistered: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Service-account JWT exchanged for an OAuth access token, cached until shortly before
   * it expires. Without the cache every push would cost two round-trips to Google.
   */
  private async accessToken(account: ServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken !== null && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.value;
    }

    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    );

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(account.private_key).toString('base64url');
    const assertion = `${header}.${claims}.${signature}`;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { value: body.access_token, expiresAt: now + body.expires_in };

    return body.access_token;
  }
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function parseServiceAccount(raw: string, logger: Logger): ServiceAccount | null {
  try {
    // Accepts the JSON itself or a base64 blob of it — the latter survives .env files and
    // CI secret stores, which mangle embedded newlines in the private key.
    const text = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');

    const parsed = JSON.parse(text) as Partial<ServiceAccount>;

    if (
      typeof parsed.project_id !== 'string' ||
      typeof parsed.client_email !== 'string' ||
      typeof parsed.private_key !== 'string'
    ) {
      logger.error('FCM_SERVICE_ACCOUNT_JSON is missing project_id, client_email or private_key.');
      return null;
    }

    return {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      // Escaped newlines are how the key survives most secret stores.
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch (error) {
    logger.error(
      `FCM_SERVICE_ACCOUNT_JSON could not be parsed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
