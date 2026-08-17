import type {
  AuthTokens,
  BookingDetail,
  BookingSummary,
  CreateOrderRequest,
  CreateProductOrderRequest,
  HoldRequest,
  NotificationDto,
  OrderResponse,
  PaymentSummary,
  ProductDto,
  ProductOrderDto,
  QuoteRequest,
  RegisterDeviceRequest,
  RescheduleResult,
  ScratchCardDto,
  StreakDto,
  UpdateProfile,
  UserProfile,
  VerifyPaymentRequest,
  WalletEntry,
} from '@reset/types';

import type { HttpClient } from '../http.js';
import type {
  AvailabilityDto,
  CategoryDto,
  DayAvailabilityDto,
  HomeDto,
  HoldResponse,
  Page,
  QuoteResponse,
  SegmentDto,
  ServiceDetail,
  ServiceListItem,
  StoreDto,
} from '../models.js';

export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Exchanges a Firebase ID token for a RESET session.
   *
   * Deliberately not "signInWithGoogle": the server verifies a *Firebase* token, so this
   * same call works unchanged if phone or email sign-in is enabled later. Which provider
   * produced the token is Firebase's business.
   */
  async signInWithFirebase(input: {
    idToken: string;
    deviceToken?: string;
    platform?: 'ANDROID' | 'IOS' | 'WEB';
  }): Promise<AuthTokens> {
    const tokens = await this.http.post<AuthTokens>('/auth/firebase', {
      body: input,
      anonymous: true,
    });
    this.http.setTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    return tokens;
  }

  me(): Promise<UserProfile> {
    return this.http.get('/auth/me');
  }

  updateProfile(input: UpdateProfile): Promise<UserProfile> {
    return this.http.patch('/auth/me', { body: input });
  }

  /**
   * Starts account deletion. Required by Play Store policy and the DPDP Act.
   *
   * The account is anonymised after the retention window rather than deleted outright —
   * bookings are financial records and survive without the person attached to them.
   */
  deleteAccount(): Promise<{ scheduledFor: string }> {
    return this.http.delete('/auth/me');
  }

  /** Local only. The server has no session to end — access tokens are short-lived JWTs. */
  signOut(): void {
    this.http.setTokens(null);
  }
}

export class CatalogResource {
  constructor(private readonly http: HttpClient) {}

  store(): Promise<StoreDto> {
    return this.http.get('/catalog/store');
  }

  segments(): Promise<SegmentDto[]> {
    return this.http.get('/catalog/segments');
  }

  categories(segmentId?: string): Promise<CategoryDto[]> {
    return this.http.get('/catalog/categories', { query: { segmentId } });
  }

  services(categoryId?: string): Promise<ServiceListItem[]> {
    return this.http.get('/catalog/services', { query: { categoryId } });
  }

  /** Service plus its add-on groups in one call, so the detail screen never waterfalls. */
  service(idOrSlug: string): Promise<ServiceDetail> {
    return this.http.get(`/catalog/services/${encodeURIComponent(idOrSlug)}`);
  }

  /** Everything the home screen needs. One request instead of four on a cold open. */
  home(segmentId?: string): Promise<HomeDto> {
    return this.http.get('/catalog/home', { query: { segmentId } });
  }
}

export class AvailabilityResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Free times for one service on one date.
   *
   * Never cached — client-side either. A stale slot list means the customer picks a time
   * that has already gone and discovers it during payment.
   */
  slots(params: {
    serviceId: string;
    date: string;
    addonOptionIds?: readonly string[];
    signal?: AbortSignal;
  }): Promise<AvailabilityDto> {
    return this.http.get('/availability/slots', {
      query: {
        serviceId: params.serviceId,
        date: params.date,
        addonOptionIds: params.addonOptionIds,
      },
      signal: params.signal,
    });
  }

  /** Which days in a range have anything at all — drives the date strip's dots. */
  days(params: {
    serviceId: string;
    from: string;
    to: string;
    addonOptionIds?: readonly string[];
    signal?: AbortSignal;
  }): Promise<DayAvailabilityDto[]> {
    return this.http.get('/availability/days', {
      query: {
        serviceId: params.serviceId,
        from: params.from,
        to: params.to,
        addonOptionIds: params.addonOptionIds,
      },
      signal: params.signal,
    });
  }
}

export class BookingsResource {
  constructor(private readonly http: HttpClient) {}

  /** Prices a basket. Works signed-out; a reward can only be applied when signed in. */
  quote(input: QuoteRequest): Promise<QuoteResponse> {
    return this.http.post('/bookings/quote', { body: input });
  }

  /**
   * Locks a station for `holdTtlMinutes`.
   *
   * Pass a stable `idempotencyKey` — generate it once when the checkout screen mounts, not
   * per click. Without one, a double-tap on a slow connection creates two holds and the
   * second consumes capacity nobody is paying for.
   */
  hold(input: HoldRequest, idempotencyKey?: string): Promise<HoldResponse> {
    return this.http.post('/bookings/hold', { body: input, idempotencyKey });
  }

  list(params: {
    status?: 'upcoming' | 'completed' | 'cancelled';
    cursor?: string;
    limit?: number;
  } = {}): Promise<Page<BookingSummary>> {
    return this.http.get('/bookings', { query: { ...params } });
  }

  detail(id: string): Promise<BookingDetail> {
    return this.http.get(`/bookings/${encodeURIComponent(id)}`);
  }

  /** Moves a confirmed booking. The payment, the price and the QR all survive. */
  reschedule(id: string, startsAt: string): Promise<RescheduleResult> {
    return this.http.post(`/bookings/${encodeURIComponent(id)}/reschedule`, {
      body: { startsAt },
    });
  }

  cancel(id: string, reason?: string): Promise<BookingDetail> {
    return this.http.post(`/bookings/${encodeURIComponent(id)}/cancel`, {
      body: { reason },
    });
  }

  /**
   * Advisory confirmation after checkout returns.
   *
   * The webhook is authoritative. This only makes the success screen appear sooner, so a
   * failure here is not a failed booking and should not be surfaced as one.
   */
  confirm(id: string): Promise<{ booking: BookingDetail }> {
    return this.http.post(`/bookings/${encodeURIComponent(id)}/confirm`);
  }
}

export class PaymentsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Opens a checkout. The amount comes from the held booking, never from the client.
   *
   * Idempotent: retrying with the same key returns the same order rather than opening a
   * second one against the same booking.
   */
  createOrder(input: CreateOrderRequest, idempotencyKey?: string): Promise<OrderResponse> {
    return this.http.post('/payments/order', { body: input, idempotencyKey });
  }

  /** Posts the signature Razorpay handed the browser. Advisory — the webhook decides. */
  verify(input: VerifyPaymentRequest): Promise<{ verified: boolean; bookingId: string | null }> {
    return this.http.post('/payments/verify', { body: input });
  }

  get(id: string): Promise<PaymentSummary> {
    return this.http.get(`/payments/${encodeURIComponent(id)}`);
  }

  /**
   * Completes a checkout with no gateway. Only exists while the API runs in simulated mode,
   * which it refuses to do in production.
   */
  simulateSuccess(id: string): Promise<{ status: string; bookingId: string | null }> {
    return this.http.post(`/payments/${encodeURIComponent(id)}/simulate-success`);
  }
}

export class RewardsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * The wallet, priced against a basket when one is supplied.
   *
   * Applicability is decided server-side, so the UI greys out a row and prints the reason it
   * was given rather than re-implementing minimum-order rules.
   */
  wallet(params: {
    serviceId?: string;
    addonOptionIds?: readonly string[];
    includeUsed?: boolean;
  } = {}): Promise<WalletEntry[]> {
    return this.http.get('/rewards/wallet', {
      query: {
        serviceId: params.serviceId,
        addonOptionIds: params.addonOptionIds,
        includeUsed: params.includeUsed,
      },
    });
  }

  streak(): Promise<StreakDto> {
    return this.http.get('/rewards/streak');
  }

  scratchCards(): Promise<ScratchCardDto[]> {
    return this.http.get('/rewards/scratch-cards');
  }

  /**
   * Reveals a card. The draw happens here, server-side and once — a second call returns
   * `SCRATCH_ALREADY_USED` rather than drawing again.
   */
  scratch(id: string): Promise<ScratchCardDto> {
    return this.http.post(`/rewards/scratch-cards/${encodeURIComponent(id)}/scratch`);
  }
}

export class ProductsResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<ProductDto[]> {
    return this.http.get('/products');
  }

  get(slug: string): Promise<ProductDto> {
    return this.http.get(`/products/${encodeURIComponent(slug)}`);
  }

  /** Pickup at store. Stock is claimed here, so a sold-out line fails now, not at the counter. */
  createOrder(
    input: CreateProductOrderRequest,
    idempotencyKey?: string,
  ): Promise<ProductOrderDto> {
    return this.http.post('/orders', { body: input, idempotencyKey });
  }

  orders(): Promise<ProductOrderDto[]> {
    return this.http.get('/orders');
  }

  order(id: string): Promise<ProductOrderDto> {
    return this.http.get(`/orders/${encodeURIComponent(id)}`);
  }
}

export class NotificationsResource {
  constructor(private readonly http: HttpClient) {}

  registerDevice(input: RegisterDeviceRequest): Promise<{ registered: boolean }> {
    return this.http.post('/notifications/devices', { body: input });
  }

  /** Call on sign-out, or the phone keeps receiving the previous user's reminders. */
  unregisterDevice(token: string): Promise<void> {
    return this.http.delete('/notifications/devices', { body: { token } });
  }

  list(): Promise<NotificationDto[]> {
    return this.http.get('/notifications');
  }
}
