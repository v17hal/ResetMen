import { z } from 'zod';

import { uuid } from './common.js';

/** E.164. India is the launch market, but the format is not India-specific. */
export const phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Expected an E.164 phone number, e.g. +919404491801');

export const otpRequest = z.object({ phone });
export type OtpRequest = z.infer<typeof otpRequest>;

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

export const otpVerify = z.object({
  phone,
  code: z.string().regex(/^\d{4,8}$/, 'Expected a numeric OTP'),
  deviceToken: z.string().optional(),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).optional(),
});
export type OtpVerify = z.infer<typeof otpVerify>;

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
