import type {
  AddonGroupInput,
  AddonOptionInput,
  AdminRole,
  AdminStatusChange,
  AllocationRuleInput,
  AllocationRulePreview,
  BlackoutInput,
  BlockCustomerInput,
  BookingDetail,
  CategoryInput,
  CustomerSummary,
  GrantRewardInput,
  NoShowReport,
  PaymentStatus,
  ProductInput,
  ProductOrderStatus,
  RescheduleResult,
  RetentionReport,
  RevenueReport,
  ScratchCampaignInput,
  SegmentInput,
  ServiceInput,
  StaffInput,
  StaffSummary,
  StationInput,
  StationServices,
  StockAdjustment,
  StoreHourInput,
  StoreSettingsInput,
  StreakRuleInput,
  UtilisationReport,
  WalkInRequest,
} from '@reset/types';

import type { HttpClient } from '../http.js';
import type {
  AdminAddonGroupRow,
  AdminAddonOptionRow,
  AdminBlackoutRow,
  AdminCampaignRow,
  AdminCategoryRow,
  AdminCustomerDetail,
  AdminLoginResponse,
  AdminPaymentRow,
  AdminProductOrderRow,
  AdminSegmentRow,
  AdminServiceRow,
  AuditEntry,
  DashboardDto,
  HoldResponse,
  MediaAsset,
  Page,
  TimelineDto,
} from '../models.js';

/** Counter screen result — everything staff need to greet the person in front of them. */
export interface CheckinResult {
  bookingId: string;
  publicId: string;
  customerName: string | null;
  customerPhone: string | null;
  serviceName: string;
  addons: string[];
  stationName: string;
  startsAt: string;
  durationMinutes: number;
  streak: {
    current: number;
    required: number | null;
    milestoneReached: boolean;
    rewardLabel: string | null;
  } | null;
}

export class AdminAuthResource {
  constructor(private readonly http: HttpClient) {}

  async login(email: string, password: string): Promise<AdminLoginResponse> {
    const result = await this.http.post<AdminLoginResponse>('/admin/auth/login', {
      body: { email, password },
      anonymous: true,
    });
    this.http.setTokens({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return result;
  }

  signOut(): void {
    this.http.setTokens(null);
  }
}

export class AdminBookingsResource {
  constructor(private readonly http: HttpClient) {}

  /** One store-day, by station. The screen the counter lives on. */
  timeline(date: string, signal?: AbortSignal): Promise<TimelineDto> {
    return this.http.get('/admin/bookings/timeline', { query: { date }, signal });
  }

  /**
   * Staff-created booking, confirmed immediately — a walk-in pays at the counter, so no
   * payment webhook is ever coming.
   *
   * Goes through the same engine and the same exclusion constraint as a customer booking:
   * a walk-in cannot double-book a station either.
   */
  walkIn(input: WalkInRequest): Promise<HoldResponse & { status: 'CONFIRMED' }> {
    return this.http.post('/admin/bookings/walk-in', { body: input });
  }

  setStatus(id: string, input: AdminStatusChange): Promise<BookingDetail> {
    return this.http.post(`/admin/bookings/${encodeURIComponent(id)}/status`, { body: input });
  }

  /**
   * Records money taken at the counter. Idempotent — a second press returns the first
   * payment rather than doubling the day's takings.
   */
  markPaid(
    id: string,
    input: { method: 'CASH' | 'UPI' | 'CARD' | 'OTHER'; note?: string },
  ): Promise<{ paymentId: string; amountPaise: number; alreadyRecorded: boolean }> {
    return this.http.post(`/admin/bookings/${encodeURIComponent(id)}/mark-paid`, {
      body: input,
    });
  }

  /** Moves a booking to a different station at the same time — the engine still validates it. */
  reassignStation(id: string, stationId: string): Promise<BookingDetail> {
    return this.http.post(`/admin/bookings/${encodeURIComponent(id)}/reassign-station`, {
      body: { stationId },
    });
  }

  reschedule(id: string, startsAt: string): Promise<RescheduleResult> {
    return this.http.post(`/admin/bookings/${encodeURIComponent(id)}/reschedule`, {
      body: { startsAt },
    });
  }
}

export class AdminCheckinResource {
  constructor(private readonly http: HttpClient) {}

  /** Redeems a scanned QR payload. Single-use — a second scan is rejected. */
  scan(token: string): Promise<CheckinResult> {
    return this.http.post('/admin/checkins', { body: { token } });
  }

  /** Camera failed, screen cracked, battery dead. The queue does not stop. */
  manual(publicId: string): Promise<CheckinResult> {
    return this.http.post('/admin/checkins/manual', { body: { publicId } });
  }
}

/**
 * Catalog CRUD.
 *
 * Every list here is wrapped in `{ data }` by the controller, and unwrapped on the way out
 * so callers get an array. The write endpoints return the row directly, unwrapped — the
 * asymmetry is the server's, and this is where it stops.
 */
export class AdminCatalogResource {
  constructor(private readonly http: HttpClient) {}

  // Segments
  async segments(): Promise<AdminSegmentRow[]> {
    const { data } = await this.http.get<{ data: AdminSegmentRow[] }>(
      '/admin/catalog/segments',
    );
    return data;
  }
  createSegment(input: SegmentInput): Promise<AdminSegmentRow> {
    return this.http.post('/admin/catalog/segments', { body: input });
  }
  updateSegment(id: string, input: SegmentInput): Promise<AdminSegmentRow> {
    return this.http.put(`/admin/catalog/segments/${encodeURIComponent(id)}`, { body: input });
  }
  deleteSegment(id: string): Promise<{ deleted: boolean }> {
    return this.http.delete(`/admin/catalog/segments/${encodeURIComponent(id)}`);
  }

  // Categories
  async categories(): Promise<AdminCategoryRow[]> {
    const { data } = await this.http.get<{ data: AdminCategoryRow[] }>(
      '/admin/catalog/categories',
    );
    return data;
  }
  createCategory(input: CategoryInput): Promise<AdminCategoryRow> {
    return this.http.post('/admin/catalog/categories', { body: input });
  }
  updateCategory(id: string, input: CategoryInput): Promise<AdminCategoryRow> {
    return this.http.put(`/admin/catalog/categories/${encodeURIComponent(id)}`, { body: input });
  }
  deleteCategory(id: string): Promise<{ deleted: boolean }> {
    return this.http.delete(`/admin/catalog/categories/${encodeURIComponent(id)}`);
  }

  // Services
  async services(): Promise<AdminServiceRow[]> {
    const { data } = await this.http.get<{ data: AdminServiceRow[] }>(
      '/admin/catalog/services',
    );
    return data;
  }
  createService(input: ServiceInput): Promise<AdminServiceRow> {
    return this.http.post('/admin/catalog/services', { body: input });
  }
  updateService(id: string, input: ServiceInput): Promise<AdminServiceRow> {
    return this.http.put(`/admin/catalog/services/${encodeURIComponent(id)}`, { body: input });
  }
  /**
   * Publish or unpublish. Publishing fails without a duration — which is what keeps the
   * unpriced Instant Glow placeholders invisible to customers.
   */
  setServiceActive(id: string, isActive: boolean): Promise<AdminServiceRow> {
    return this.http.post(`/admin/catalog/services/${encodeURIComponent(id)}/active`, {
      body: { isActive },
    });
  }
  deleteService(id: string): Promise<{ deleted: boolean }> {
    return this.http.delete(`/admin/catalog/services/${encodeURIComponent(id)}`);
  }
  setServiceAddonGroups(id: string, addonGroupIds: readonly string[]): Promise<unknown> {
    return this.http.put(`/admin/catalog/services/${encodeURIComponent(id)}/addon-groups`, {
      body: { addonGroupIds },
    });
  }

  // Add-on groups and options
  async addonGroups(): Promise<AdminAddonGroupRow[]> {
    const { data } = await this.http.get<{ data: AdminAddonGroupRow[] }>(
      '/admin/catalog/addon-groups',
    );
    return data;
  }
  createAddonGroup(input: AddonGroupInput): Promise<AdminAddonGroupRow> {
    return this.http.post('/admin/catalog/addon-groups', { body: input });
  }
  updateAddonGroup(id: string, input: AddonGroupInput): Promise<AdminAddonGroupRow> {
    return this.http.put(`/admin/catalog/addon-groups/${encodeURIComponent(id)}`, { body: input });
  }
  addAddonOption(groupId: string, input: AddonOptionInput): Promise<AdminAddonOptionRow> {
    return this.http.post(`/admin/catalog/addon-groups/${encodeURIComponent(groupId)}/options`, {
      body: input,
    });
  }
  updateAddonOption(id: string, input: AddonOptionInput): Promise<AdminAddonOptionRow> {
    return this.http.put(`/admin/catalog/addon-options/${encodeURIComponent(id)}`, { body: input });
  }
  deleteAddonOption(id: string): Promise<{ deleted: boolean }> {
    return this.http.delete(`/admin/catalog/addon-options/${encodeURIComponent(id)}`);
  }

  /**
   * Ordering. One call for the whole list, not one per moved row.
   *
   * The entity names are singular and camel-cased because that is the enum the route
   * validates against. This signature previously offered plurals and an `addon-options`
   * that the server has never accepted, so every call it invited would have been rejected
   * before reaching a handler.
   */
  reorder(
    entity: 'segment' | 'category' | 'service' | 'addonGroup',
    items: ReadonlyArray<{ id: string; sortOrder: number }>,
  ): Promise<{ updated: number }> {
    return this.http.post(`/admin/catalog/reorder/${entity}`, { body: { items } });
  }
}

export class AdminCapacityResource {
  constructor(private readonly http: HttpClient) {}

  stations(): Promise<Array<{ id: string; name: string; isActive: boolean; sortOrder: number }>> {
    return this.http.get('/admin/stations');
  }
  createStation(input: StationInput): Promise<unknown> {
    return this.http.post('/admin/stations', { body: input });
  }
  updateStation(id: string, input: StationInput): Promise<unknown> {
    return this.http.put(`/admin/stations/${encodeURIComponent(id)}`, { body: input });
  }
  /** Station → service designation. A restricted station with no services can never be booked. */
  setStationServices(id: string, input: StationServices): Promise<unknown> {
    return this.http.put(`/admin/stations/${encodeURIComponent(id)}/services`, { body: input });
  }
  /** Which services no station can perform — the config error nobody notices until a refund. */
  coverage(): Promise<unknown> {
    return this.http.get('/admin/stations/coverage');
  }

  allocationRules(): Promise<unknown[]> {
    return this.http.get('/admin/allocation-rules');
  }
  createAllocationRule(input: AllocationRuleInput): Promise<unknown> {
    return this.http.post('/admin/allocation-rules', { body: input });
  }
  updateAllocationRule(id: string, input: AllocationRuleInput): Promise<unknown> {
    return this.http.put(`/admin/allocation-rules/${encodeURIComponent(id)}`, { body: input });
  }
  deleteAllocationRule(id: string): Promise<void> {
    return this.http.delete(`/admin/allocation-rules/${encodeURIComponent(id)}`);
  }

  /**
   * Dry-run. Always call this before saving a rule.
   *
   * Reserving two stations for a morning push can quietly wipe out all availability for a
   * more expensive service — the opposite of what the owner intended, and invisible until a
   * customer complains they cannot book.
   */
  previewAllocationRule(
    input: AllocationRuleInput & { date: string },
  ): Promise<AllocationRulePreview> {
    return this.http.post('/admin/allocation-rules/preview', { body: input });
  }

  storeHours(): Promise<StoreHourInput[]> {
    return this.http.get('/admin/store-hours');
  }
  setStoreHours(hours: readonly StoreHourInput[]): Promise<StoreHourInput[]> {
    return this.http.put('/admin/store-hours', { body: { hours } });
  }

  blackouts(): Promise<AdminBlackoutRow[]> {
    return this.http.get('/admin/blackouts');
  }
  createBlackout(input: BlackoutInput): Promise<AdminBlackoutRow> {
    return this.http.post('/admin/blackouts', { body: input });
  }
  deleteBlackout(id: string): Promise<void> {
    return this.http.delete(`/admin/blackouts/${encodeURIComponent(id)}`);
  }

  settings(): Promise<Required<StoreSettingsInput>> {
    return this.http.get('/admin/settings');
  }
  updateSettings(input: StoreSettingsInput): Promise<Required<StoreSettingsInput>> {
    return this.http.put('/admin/settings', { body: input });
  }

  /** What customers would see, for a service on a date, without opening the customer app. */
  availabilityPreview(params: { serviceId: string; date: string }): Promise<unknown> {
    return this.http.get('/admin/availability-preview', { query: { ...params } });
  }
}

export class AdminCustomersResource {
  constructor(private readonly http: HttpClient) {}

  list(params: {
    q?: string;
    blocked?: boolean;
    cursor?: string;
    limit?: number;
  } = {}): Promise<Page<CustomerSummary>> {
    return this.http.get('/admin/customers', { query: { ...params } });
  }

  /**
   * One customer, with their recent bookings and their wallet.
   *
   * This used to be typed `CustomerSummary & { bookings: BookingDetail[] }`, which the
   * endpoint has never returned — the counters are nested under `stats`, the bookings are a
   * reduced shape, and the rewards were not declared at all. Nothing called it, so nothing
   * caught it.
   */
  get(id: string): Promise<AdminCustomerDetail> {
    return this.http.get(`/admin/customers/${encodeURIComponent(id)}`);
  }

  /** Reversible, and always with a reason — an unexplained block is a support call. */
  setBlocked(id: string, input: BlockCustomerInput): Promise<CustomerSummary> {
    return this.http.post(`/admin/customers/${encodeURIComponent(id)}/block`, { body: input });
  }
}

export class AdminStaffResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<StaffSummary[]> {
    const { data } = await this.http.get<{ data: StaffSummary[] }>('/admin/staff');
    return data;
  }
  create(input: StaffInput & { password: string }): Promise<StaffSummary> {
    return this.http.post('/admin/staff', { body: input });
  }
  update(id: string, input: StaffInput): Promise<StaffSummary> {
    return this.http.put(`/admin/staff/${encodeURIComponent(id)}`, { body: input });
  }
  setPassword(id: string, password: string): Promise<void> {
    return this.http.post(`/admin/staff/${encodeURIComponent(id)}/password`, {
      body: { password },
    });
  }
  deactivate(id: string): Promise<void> {
    return this.http.delete(`/admin/staff/${encodeURIComponent(id)}`);
  }
}

export class AdminRewardsResource {
  constructor(private readonly http: HttpClient) {}

  async streakRules(): Promise<unknown[]> {
    const { data } = await this.http.get<{ data: unknown[] }>('/admin/rewards/streak-rules');
    return data;
  }
  createStreakRule(input: StreakRuleInput): Promise<unknown> {
    return this.http.post('/admin/rewards/streak-rules', { body: input });
  }
  updateStreakRule(id: string, input: StreakRuleInput): Promise<unknown> {
    return this.http.put(`/admin/rewards/streak-rules/${encodeURIComponent(id)}`, { body: input });
  }
  deleteStreakRule(id: string): Promise<void> {
    return this.http.delete(`/admin/rewards/streak-rules/${encodeURIComponent(id)}`);
  }

  async campaigns(): Promise<AdminCampaignRow[]> {
    const { data } = await this.http.get<{ data: AdminCampaignRow[] }>(
      '/admin/rewards/campaigns',
    );
    return data;
  }
  /** Issued, scratched, cost per card — the numbers that decide whether to keep running it. */
  campaignStats(id: string): Promise<unknown> {
    return this.http.get(`/admin/rewards/campaigns/${encodeURIComponent(id)}/stats`);
  }
  createCampaign(input: ScratchCampaignInput): Promise<AdminCampaignRow> {
    return this.http.post('/admin/rewards/campaigns', { body: input });
  }
  updateCampaign(id: string, input: ScratchCampaignInput): Promise<AdminCampaignRow> {
    return this.http.put(`/admin/rewards/campaigns/${encodeURIComponent(id)}`, { body: input });
  }
  /**
   * Stops a campaign. Named for the verb on the route, not the effect.
   *
   * The handler deactivates rather than deletes: cards already issued point at it, and a
   * card whose campaign has vanished cannot be scratched or explained.
   */
  stopCampaign(id: string): Promise<{ deactivated: boolean }> {
    return this.http.delete(`/admin/rewards/campaigns/${encodeURIComponent(id)}`);
  }

  /** The "sorry about the wait" lever every counter needs. Audited. */
  grant(input: GrantRewardInput): Promise<unknown> {
    return this.http.post('/admin/rewards/grants', { body: input });
  }
  /**
   * Takes a reward back out of someone's wallet. Audited against whoever did it.
   *
   * No reason is sent because the route accepts no body — the parameter this used to take
   * was dropped on the floor by the handler, so asking staff for one would have been asking
   * them to type into nothing.
   */
  revokeGrant(id: string): Promise<unknown> {
    return this.http.post(`/admin/rewards/grants/${encodeURIComponent(id)}/revoke`);
  }
}

export class AdminPaymentsResource {
  constructor(private readonly http: HttpClient) {}

  list(params: { status?: PaymentStatus; limit?: number } = {}): Promise<{
    data: AdminPaymentRow[];
  }> {
    return this.http.get('/admin/payments', { query: { ...params } });
  }

  /**
   * Idempotent, and this is the route that needs it most: a manager whose browser times out
   * mid-refund will click again, and the second click must not send the money twice. Pass a
   * key generated when the dialog opened.
   */
  refund(
    id: string,
    input: { amountPaise?: number; reason?: string },
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.http.post(`/admin/payments/${encodeURIComponent(id)}/refund`, {
      body: input,
      idempotencyKey,
    });
  }

  /** Webhooks that arrived but could not be processed. Should normally be empty. */
  async webhookFailures(): Promise<unknown[]> {
    const { data } = await this.http.get<{ data: unknown[] }>(
      '/admin/payments/webhook-failures',
    );
    return data;
  }
}

export class AdminProductsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<unknown[]> {
    const { data } = await this.http.get<{ data: unknown[] }>('/admin/products');
    return data;
  }
  create(input: ProductInput): Promise<unknown> {
    return this.http.post('/admin/products', { body: input });
  }
  update(id: string, input: ProductInput): Promise<unknown> {
    return this.http.put(`/admin/products/${encodeURIComponent(id)}`, { body: input });
  }
  /** Signed delta, not an absolute — two staff adjusting stock must not clobber each other. */
  adjustStock(id: string, input: StockAdjustment): Promise<unknown> {
    return this.http.post(`/admin/products/${encodeURIComponent(id)}/stock`, { body: input });
  }
  remove(id: string): Promise<void> {
    return this.http.delete(`/admin/products/${encodeURIComponent(id)}`);
  }

  orders(params: { status?: ProductOrderStatus; limit?: number } = {}): Promise<{
    data: AdminProductOrderRow[];
  }> {
    return this.http.get('/admin/products/orders/all', { query: { ...params } });
  }
  setOrderStatus(
    id: string,
    input: { status: 'READY_FOR_PICKUP' | 'PICKED_UP' | 'CANCELLED'; reason?: string },
  ): Promise<unknown> {
    return this.http.post(`/admin/products/orders/${encodeURIComponent(id)}/status`, {
      body: input,
    });
  }
}

export class AdminReportsResource {
  constructor(private readonly http: HttpClient) {}

  dashboard(): Promise<DashboardDto> {
    return this.http.get('/admin/reports/dashboard');
  }
  revenue(range: { from: string; to: string }): Promise<RevenueReport> {
    return this.http.get('/admin/reports/revenue', { query: { ...range } });
  }
  utilisation(range: { from: string; to: string }): Promise<UtilisationReport> {
    return this.http.get('/admin/reports/utilisation', { query: { ...range } });
  }
  noShow(range: { from: string; to: string }): Promise<NoShowReport> {
    return this.http.get('/admin/reports/no-show', { query: { ...range } });
  }
  retention(range: { from: string; to: string }): Promise<RetentionReport> {
    return this.http.get('/admin/reports/retention', { query: { ...range } });
  }

  /**
   * CSV text, not a blob. Audited server-side — an export is customer names and phone
   * numbers leaving the system, and the DPDP Act requires knowing who took one.
   */
  exportCsv(params: {
    report: 'revenue' | 'utilisation' | 'no-show' | 'retention' | 'bookings';
    from: string;
    to: string;
  }): Promise<string> {
    return this.http.get('/admin/reports/export', {
      query: { ...params },
      headers: { Accept: 'text/csv' },
    });
  }
}

export class AdminMediaResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Multipart upload under field `file`, 5 MB cap.
   *
   * The server validates magic bytes rather than trusting the filename or the declared
   * type, and derives thumb / card / hero WebP renditions before responding.
   */
  upload(file: Blob, filename = 'upload'): Promise<MediaAsset> {
    const form = new FormData();
    form.append('file', file, filename);
    return this.http.post('/admin/media', { body: form });
  }

  list(limit?: number): Promise<{ data: MediaAsset[] }> {
    return this.http.get('/admin/media', { query: { limit } });
  }

  remove(id: string): Promise<void> {
    return this.http.delete(`/admin/media/${encodeURIComponent(id)}`);
  }
}

export class AdminAuditResource {
  constructor(private readonly http: HttpClient) {}

  /** OWNER only. */
  list(params: {
    entityType?: string;
    entityId?: string;
    cursor?: string;
    limit?: number;
  } = {}): Promise<Page<AuditEntry>> {
    return this.http.get('/admin/audit', { query: { ...params } });
  }
}

export type { AdminRole };
