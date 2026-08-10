/**
 * `@reset/api-client` — the typed HTTP client for the RESET API.
 *
 * Hand-written over `@reset/types` rather than generated from OpenAPI. The contract already
 * exists as TypeScript; round-tripping it through a JSON schema would lose the refinements,
 * the defaults and the doc comments, and hand back weaker types than the ones we started
 * with. The Flutter app *is* generated from OpenAPI, because Dart cannot import Zod.
 *
 * ```ts
 * import { ResetClient, isResetApiError } from '@reset/api-client';
 *
 * const reset = new ResetClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL! });
 *
 * try {
 *   await reset.bookings.hold({ serviceId, startsAt, addonOptionIds: [], rewardId: null });
 * } catch (error) {
 *   if (isResetApiError(error) && error.isSlotGone) showPickAnotherTime();
 *   else throw error;
 * }
 * ```
 */

export { ResetClient, ResetAdminClient } from './client.js';
export { HttpClient, buildQuery } from './http.js';
export type { HttpClientOptions, RequestOptions, Query, QueryValue } from './http.js';

export {
  ResetApiError,
  ResetNetworkError,
  isResetApiError,
  isResetNetworkError,
  problemFromResponse,
} from './errors.js';

export { memoryTokenStore, browserTokenStore } from './tokens.js';
export type { TokenPair, TokenStore } from './tokens.js';

export * from './models.js';
export type { CheckinResult } from './resources/admin.js';

// Re-exported so a consuming app needs one dependency, not two, to type an API call.
export type {
  AdminRole,
  AllocationRuleInput,
  AllocationRulePreview,
  AuthTokens,
  BlackoutInput,
  BookingDetail,
  BookingStatus,
  BookingSummary,
  CustomerSummary,
  ErrorCode,
  NoShowReport,
  NotificationDto,
  OrderResponse,
  PaymentStatus,
  PaymentSummary,
  Pricing,
  ProblemDetail,
  ProductDto,
  ProductOrderDto,
  ProductOrderStatus,
  RescheduleResult,
  RetentionReport,
  RevenueReport,
  RewardType,
  ScratchCardDto,
  Slot,
  ScratchCampaignInput,
  StaffSummary,
  StationServices,
  StoreHourInput,
  StoreSettingsInput,
  StreakDto,
  StreakRuleInput,
  UserProfile,
  UtilisationReport,
  VerifyPaymentRequest,
  WalletEntry,
} from '@reset/types';
