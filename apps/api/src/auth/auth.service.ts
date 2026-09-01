import { Injectable, Logger } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { AppError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { FirebaseTokenVerifier } from './firebase-token.verifier.js';
import { TokenService } from './token.service.js';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly firebase: FirebaseTokenVerifier,
  ) {}

  /**
   * Sign in with a Firebase ID token.
   *
   * Provider-agnostic on purpose. Google is what the store uses today; a phone-auth token
   * arrives in the same shape and lands in the same branch below, so enabling it later is a
   * console change rather than a release.
   *
   * Matching is by Firebase uid first, then by verified email, then by phone. That order
   * matters: it is what stops one person ending up with two accounts — and two streaks —
   * because they signed in a different way the second time.
   */
  async signInWithFirebase(params: {
    idToken: string;
    deviceToken?: string;
    platform?: 'ANDROID' | 'IOS' | 'WEB';
  }) {
    const identity = await this.firebase.verify(params.idToken);

    let user = await this.prisma.user.findUnique({
      where: { firebaseUid: identity.uid },
    });
    let isNewUser = false;

    if (user === null && identity.email !== null && identity.emailVerified) {
      // An existing account being claimed by a first Firebase sign-in. Only trusted when
      // Google says the address is verified — an unverified email is an assertion by
      // whoever typed it, and honouring it would be account takeover by typing.
      user = await this.prisma.user.findUnique({ where: { email: identity.email } });
    }

    if (user === null && identity.phone !== null) {
      user = await this.prisma.user.findUnique({ where: { phone: identity.phone } });
    }

    if (user === null) {
      isNewUser = true;
      user = await this.prisma.user.create({
        data: {
          firebaseUid: identity.uid,
          email: identity.email,
          phone: identity.phone,
          name: identity.name,
          // DPDP Act 2023 — signing in is the consent event, and it is recorded here
          // rather than inferred later from createdAt.
          consentAt: new Date(),
        },
      });
    } else {
      /**
       * Signing in again withdraws a deletion request.
       *
       * Deletion is a soft-delete with a thirty-day purge, and sign-in never filtered on
       * it — so a returning customer was found, updated and issued a perfectly good token,
       * and then `getProfile` threw `notFound` because the row was still marked deleted.
       * From the outside that is simply "I cannot log in any more", with no way out: the
       * account cannot be deleted again, and a new one cannot be made because the email and
       * the Firebase uid are both taken.
       *
       * Coming back inside the grace period is the clearest possible statement that they no
       * longer want the account gone, so it is restored. After the purge there is no row
       * left to find and this branch never runs — they arrive as a new customer, which is
       * the honest outcome once the data is actually gone.
       */
      const reviving = user.deletedAt !== null;

      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          firebaseUid: identity.uid,
          // Only ever fill blanks. Overwriting a name the customer set in this app with
          // whatever their Google profile says would undo their own edit on every login.
          email: user.email ?? identity.email,
          phone: user.phone ?? identity.phone,
          name: user.name ?? identity.name,
          consentAt: user.consentAt ?? new Date(),
          lastLoginAt: new Date(),
          ...(reviving ? { deletedAt: null } : {}),
        },
      });

      if (reviving) {
        this.logger.log(`Restored deleted account ${user.id} on sign-in`);
      }
    }

    if (user.isBlocked) {
      throw new AppError('CUSTOMER_BLOCKED', 403, 'Account blocked', user.blockedReason ?? undefined);
    }

    if (params.deviceToken !== undefined) {
      await this.prisma.deviceToken.upsert({
        where: { token: params.deviceToken },
        create: {
          userId: user.id,
          token: params.deviceToken,
          platform: params.platform ?? 'ANDROID',
        },
        update: { userId: user.id, lastSeenAt: new Date() },
      });
    }

    const claims = { sub: user.id, aud: 'customer' as const };

    return {
      accessToken: this.tokens.issueAccess(claims),
      refreshToken: this.tokens.issueRefresh(claims),
      isNewUser,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        gender: user.gender,
        email: user.email,
        preferredSegmentId: user.preferredSegmentId,
      },
    };
  }

  async refresh(refreshToken: string) {
    const claims = this.tokens.verifyRefresh(refreshToken);

    if (claims.aud === 'customer') {
      const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
      if (user === null || user.deletedAt !== null || user.isBlocked) {
        throw new AppError('UNAUTHENTICATED', 401, 'Session no longer valid');
      }
    }

    const next = { sub: claims.sub, aud: claims.aud, role: claims.role, storeId: claims.storeId };
    return {
      accessToken: this.tokens.issueAccess(next),
      refreshToken: this.tokens.issueRefresh(next),
    };
  }

  async adminLogin(email: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });

    // Verify against a dummy hash when the account is missing, so a wrong email and a wrong
    // password take the same time and the endpoint cannot be used to enumerate staff.
    const hash = admin?.passwordHash ?? DUMMY_HASH;
    const ok = await verifyPassword(password, hash);

    if (admin === null || !ok || !admin.isActive) {
      throw new AppError('UNAUTHENTICATED', 401, 'Invalid email or password');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const claims = {
      sub: admin.id,
      aud: 'admin' as const,
      role: admin.role,
      storeId: admin.storeId,
    };

    return {
      accessToken: this.tokens.issueAccess(claims),
      refreshToken: this.tokens.issueRefresh(claims),
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role as AdminRole,
        storeId: admin.storeId,
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user === null || user.deletedAt !== null) throw AppError.notFound('User');

    return {
      id: user.id,
      phone: user.phone,
      name: user.name,
      gender: user.gender,
      email: user.email,
      // `YYYY-MM-DD`, not an instant. A birthday has no time of day, and serialising it as
      // one shifts it a day either side of midnight depending on the reader's timezone.
      dateOfBirth: user.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      preferredSegmentId: user.preferredSegmentId,
    };
  }

  async updateProfile(userId: string, data: Record<string, unknown>) {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(typeof data.name === 'string' ? { name: data.name } : {}),
          ...(typeof data.email === 'string' ? { email: data.email } : {}),
          ...(typeof data.phone === 'string' ? { phone: data.phone } : {}),
          ...(typeof data.gender === 'string'
            ? { gender: data.gender as 'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED' }
            : {}),
          ...(typeof data.dateOfBirth === 'string'
            ? { dateOfBirth: new Date(data.dateOfBirth) }
            : {}),
          ...(typeof data.preferredSegmentId === 'string'
            ? { preferredSegmentId: data.preferredSegmentId }
            : {}),
        },
      });
    } catch (error) {
      /**
       * Phone and email are unique, so this is somebody typing a number that already
       * belongs to another account — usually their own older one from before Google
       * sign-in existed.
       *
       * Deliberately not merged automatically. An unverified phone number is a claim, and
       * honouring it would let anyone absorb another customer's bookings and rewards by
       * typing their number. The counter can merge after checking ID.
       */
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        const field = (error as { meta?: { target?: string[] } }).meta?.target?.[0] ?? 'detail';
        throw new AppError(
          'VALIDATION_FAILED',
          409,
          'Already in use',
          field.includes('phone')
            ? 'That number is already on another account. Ask at the counter and we will merge them.'
            : 'That email is already on another account.',
        );
      }
      throw error;
    }

    return this.getProfile(userId);
  }

  /**
   * Account deletion. Required by Play Store policy and the DPDP Act 2023.
   *
   * Soft-delete now, purge after 30 days — bookings and payments are financial records and
   * cannot simply vanish, so the user row is anonymised rather than dropped.
   */
  async requestDeletion(userId: string): Promise<{ scheduledFor: string }> {
    const purgeAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });
    return { scheduledFor: purgeAt.toISOString() };
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const derived = await scrypt(password, salt, expected.length);

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** A real-looking hash for a password that will never match. */
const DUMMY_HASH =
  'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);
