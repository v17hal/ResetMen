import { Injectable, Logger } from '@nestjs/common';
import { createPublicKey, createVerify } from 'node:crypto';

import { AppError } from '../common/errors.js';
import { loadEnv } from '../config/env.js';

/** What we take from a verified Firebase ID token. */
export interface FirebaseIdentity {
  /** Firebase's stable user id. The join key — never the email, which people change. */
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** Present for phone sign-in; null for Google. Already E.164. */
  phone: string | null;
  name: string | null;
  /** `google.com`, `phone`, `password` … Recorded so we can tell how someone signed up. */
  provider: string | null;
}

/** Google's rotating public certificates for Firebase ID tokens. */
const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/**
 * Verifies Firebase ID tokens.
 *
 * Written against `node:crypto` rather than pulling in firebase-admin. The Admin SDK is
 * ~30 MB of transitive dependencies, most of it Google Cloud clients this app never calls,
 * and the part actually needed here is one RS256 signature check plus four claim
 * comparisons.
 *
 * Deliberately provider-agnostic. Google sign-in is what the store uses today; if phone
 * sign-in is ever enabled, the token arrives in exactly the same shape and nothing here
 * changes. That is the whole reason the API takes a Firebase token rather than a Google one.
 *
 * What a forged token has to defeat: an RS256 signature from a key only Google holds, an
 * issuer and audience pinned to this specific Firebase project, and an expiry. Skipping any
 * one of those turns "sign in as anyone" into a single crafted HTTP request — which is why
 * each check below is explicit rather than delegated.
 */
@Injectable()
export class FirebaseTokenVerifier {
  private readonly logger = new Logger(FirebaseTokenVerifier.name);
  private readonly projectId: string | undefined;

  /** kid → PEM, with the expiry Google's Cache-Control gave us. */
  private certs = new Map<string, string>();
  private certsExpireAt = 0;
  /** Single-flight, so a burst of sign-ins fetches the cert bundle once. */
  private refreshInFlight: Promise<void> | null = null;

  constructor() {
    this.projectId = loadEnv().FIREBASE_PROJECT_ID;
  }

  get isConfigured(): boolean {
    return this.projectId !== undefined;
  }

  async verify(idToken: string): Promise<FirebaseIdentity> {
    if (this.projectId === undefined) {
      throw new AppError(
        'INTERNAL',
        500,
        'Sign-in is not configured',
        'FIREBASE_PROJECT_ID is not set on the server.',
      );
    }

    const parts = idToken.split('.');
    if (parts.length !== 3) throw invalidToken();
    const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];

    const header = decodeSegment<{ alg?: string; kid?: string }>(rawHeader);
    if (header === null || header.alg !== 'RS256' || typeof header.kid !== 'string') {
      // `alg` is checked before anything else on purpose: accepting `none`, or letting the
      // token choose HS256 and be verified against a public key as a shared secret, is the
      // classic JWT forgery.
      throw invalidToken();
    }

    const pem = await this.certFor(header.kid);
    if (pem === null) throw invalidToken();

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${rawHeader}.${rawPayload}`);
    verifier.end();

    if (!verifier.verify(createPublicKey(pem), Buffer.from(rawSignature, 'base64url'))) {
      throw invalidToken();
    }

    const claims = decodeSegment<Record<string, unknown>>(rawPayload);
    if (claims === null) throw invalidToken();

    const now = Math.floor(Date.now() / 1000);
    // 60 seconds of leeway. Phones with a slightly fast clock are common enough that a
    // strict comparison rejects real users.
    const skew = 60;

    if (typeof claims.exp !== 'number' || claims.exp + skew < now) {
      throw new AppError('UNAUTHENTICATED', 401, 'Sign-in expired', 'Please sign in again.');
    }
    if (typeof claims.iat !== 'number' || claims.iat - skew > now) throw invalidToken();
    if (claims.aud !== this.projectId) throw invalidToken();
    if (claims.iss !== `https://securetoken.google.com/${this.projectId}`) throw invalidToken();

    const uid = typeof claims.sub === 'string' ? claims.sub : '';
    if (uid.length === 0) throw invalidToken();

    const firebase = (claims.firebase ?? {}) as { sign_in_provider?: unknown };

    return {
      uid,
      email: typeof claims.email === 'string' ? claims.email.toLowerCase() : null,
      emailVerified: claims.email_verified === true,
      phone: typeof claims.phone_number === 'string' ? claims.phone_number : null,
      name: typeof claims.name === 'string' && claims.name.trim() !== '' ? claims.name : null,
      provider:
        typeof firebase.sign_in_provider === 'string' ? firebase.sign_in_provider : null,
    };
  }

  private async certFor(kid: string): Promise<string | null> {
    if (Date.now() < this.certsExpireAt) {
      const cached = this.certs.get(kid);
      if (cached !== undefined) return cached;
    }

    await this.refreshCerts();
    return this.certs.get(kid) ?? null;
  }

  private refreshCerts(): Promise<void> {
    this.refreshInFlight ??= this.fetchCerts().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async fetchCerts(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(CERT_URL, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      // Keep whatever is cached rather than locking everyone out over a blip. If the cache
      // is empty this surfaces as a failed sign-in, which is the honest outcome.
      this.logger.error(
        `Could not fetch Google signing certificates: ${(error as Error).message}`,
      );
      return;
    }

    if (!response.ok) {
      this.logger.error(`Google signing certificates returned ${response.status}`);
      return;
    }

    const body = (await response.json()) as Record<string, string>;
    this.certs = new Map(Object.entries(body));

    // Honour Google's own rotation window. They publish max-age; falling back to an hour is
    // safe because a rotated-out kid simply misses the cache and triggers a refetch.
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1];
    this.certsExpireAt = Date.now() + (maxAge === undefined ? 3600 : Number(maxAge)) * 1000;
  }
}

function invalidToken(): AppError {
  return new AppError(
    'UNAUTHENTICATED',
    401,
    'Invalid sign-in',
    'That sign-in could not be verified. Please try again.',
  );
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
