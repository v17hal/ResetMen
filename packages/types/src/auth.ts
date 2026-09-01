import { z } from 'zod';

import { uuid } from './common.js';

/**
 * An Indian mobile number, in E.164.
 *
 * Was plain E.164, which permits eight to fifteen digits anywhere in the world and so
 * accepted `+911234567890123` as a customer's number. The store rings these to confirm
 * bookings and take payment, so a number that cannot be dialled is the same as no number —
 * and the customer only finds out when nobody calls.
 *
 * Narrow on purpose. One store, one country, and every mobile here is `+91` followed by ten
 * digits starting 6 to 9. When a second market opens, this is the line that changes, and a
 * failing test is a better way to discover that than a customer nobody can reach.
 */
export const phone = z
  .string()
  .regex(
    /^\+91[6-9]\d{9}$/,
    'Expected an Indian mobile number, e.g. +919404491801',
  );

/**
 * Sign in with a Firebase ID token.
 *
 * Deliberately not "sign in with Google": the server verifies a *Firebase* token, so the
 * same request works unchanged if phone or email sign-in is enabled later. Which provider
 * produced it is Firebase's business, not this contract's.
 */
export const firebaseSignIn = z.object({
  idToken: z.string().min(20),
  /** FCM registration token, so push works from the first session. */
  deviceToken: z.string().optional(),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).optional(),
});
export type FirebaseSignIn = z.infer<typeof firebaseSignIn>;

export const gender = z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']);

export const userProfile = z.object({
  id: uuid,
  /**
   * Nullable since sign-in moved to Google, which yields an email and no phone number.
   * Asked for afterwards and never required to book — see the note on `User.phone`.
   */
  phone: phone.nullable(),
  name: z.string().nullable(),
  gender,
  email: z.string().email().nullable(),
  /**
   * `YYYY-MM-DD`, not an instant — a birthday has no time of day, and serialising it as
   * one shifts it a day either side of midnight depending on the reader's timezone.
   */
  dateOfBirth: z.string().date().nullable(),
  preferredSegmentId: uuid.nullable(),
});
export type UserProfile = z.infer<typeof userProfile>;

export const updateProfile = z.object({
  name: z.string().min(1).max(80).optional(),
  gender: gender.optional(),
  email: z.string().email().optional(),
  /**
   * Added after signing in, never required to book.
   *
   * Google sign-in yields no phone number, and two things at the counter need one: linking
   * a walk-in to an existing customer, and ringing someone who is late. Asking for it once,
   * dismissibly, is the trade — a required field here would cost bookings.
   */
  phone: phone.optional(),
  dateOfBirth: z.string().date().optional(),
  preferredSegmentId: uuid.optional(),
});
export type UpdateProfile = z.infer<typeof updateProfile>;

export const authTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userProfile,
  isNewUser: z.boolean(),
});
export type AuthTokens = z.infer<typeof authTokens>;

export const adminRole = z.enum(['OWNER', 'MANAGER', 'STAFF']);
export type AdminRole = z.infer<typeof adminRole>;

export const adminLogin = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type AdminLogin = z.infer<typeof adminLogin>;

export const refreshRequest = z.object({ refreshToken: z.string().min(1) });
