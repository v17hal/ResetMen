import { z } from 'zod';

import { uuid } from './common.js';

/** E.164. India is the launch market, but the format is not India-specific. */
export const phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Expected an E.164 phone number, e.g. +919404491801');

export const otpRequest = z.object({ phone });
export type OtpRequest = z.infer<typeof otpRequest>;

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
  phone,
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
