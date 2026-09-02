import type {
  AdminRole,
  BookingStatus,
  PaymentStatus,
  ProductOrderStatus,
  RewardType,
  ScratchTrigger,
  Slot,
} from '@reset/types';

/**
 * Response shapes the API returns that `@reset/types` does not yet define.
 *
 * `@reset/types` holds the *request* contract — the schemas that validate a body on the way
 * in and a form on the way out. Several read endpoints assemble their response from Prisma
 * selects rather than from a Zod schema, so their shape lives here, mirrored by hand from
 * the service that produces it.
 *
 * Each one names its source. When a service changes its select list, this file is what has
 * to change with it — a typecheck will not catch the drift, so the citation is the only
 * thing keeping the two honest.
 */

// ── Admin auth — apps/api/src/auth/auth.service.ts ───────────────────────────

/**
 * Staff sign-in.
 *
 * Deliberately not the customer `AuthTokens` shape: the staff record comes back under
 * `admin`, carries a `role`, and has no `isNewUser`. The role here is for rendering only —
 * every admin route re-checks the JWT, so hiding a nav item is a convenience, not a control.
 */
export interface AdminLoginResponse {
  accessToken: string;
  refreshToken: string;
  admin: {
    id: string;
    name: string;
    email: string;
    role: AdminRole;
    storeId: string;
  };
}

// ── Catalog — apps/api/src/catalog/catalog.service.ts ────────────────────────

export interface StoreHours {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

export interface StoreDto {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  bookingHorizonDays: number;
  cancellationWindowMinutes: number;
  hours: StoreHours[];
  /**
   * Whether the store charges online.
   *
   * False today: there is no gateway and every booking is settled at the counter. The API
   * has always sent this; it simply was not declared, so the clients could not tell the
   * customer whether money had changed hands and defaulted to saying it had.
   */
  paymentsEnabled: boolean;
}

export interface SegmentDto {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  segmentId: string;
}

export interface ServiceListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  pricePaise: number;
  durationMinutes: number;
  categoryId: string;
}

export interface AddonOptionDto {
  id: string;
  name: string;
  priceDeltaPaise: number;
  durationDeltaMinutes: number;
}

export interface AddonGroupDto {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: AddonOptionDto[];
}

export interface ServiceDetail extends ServiceListItem {
  addonGroups: AddonGroupDto[];
}

/** One request instead of four on a cold app open. */
export interface HomeDto {
  segments: SegmentDto[];
  activeSegmentId: string | null;
  categories: Array<
    CategoryDto & {
      serviceCount: number;
      /** null when the category has no services yet. */
      fromPricePaise: number | null;
    }
  >;
  services: ServiceListItem[];
}

// ── Admin catalog — apps/api/src/admin/admin-catalog.service.ts ──────────────
//
// These are Prisma rows, so they carry every column plus the relations the service
// includes. Only the fields the admin UI actually uses are declared; the rest are real but
// undeclared, which is safer than guessing at Prisma's exact nullability for each one.

export interface AdminSegmentRow {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  _count: { categories: number };
}

export interface AdminCategoryRow {
  id: string;
  segmentId: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  segment: { name: string };
  _count: { services: number };
}

export interface AdminServiceRow {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  pricePaise: number;
  durationMinutes: number;
  bufferOverrideMinutes: number | null;
  maxPerSlot: number | null;
  sortOrder: number;
  isActive: boolean;
  category: { name: string; segment: { name: string } };
  addonGroups: Array<{ addonGroup: { id: string; name: string } }>;
  /** How many stations are designated for this service. Zero means it can never be booked. */
  _count: { stationServices: number };
}

export interface AdminAddonOptionRow {
  id: string;
  addonGroupId: string;
  name: string;
  pricePaise: number;
  durationDeltaMinutes: number;
  sortOrder: number;
  isActive: boolean;
}

export interface AdminAddonGroupRow {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  options: AdminAddonOptionRow[];
  services: Array<{ service: { id: string; name: string } }>;
}

/**
 * A scratch campaign as the admin list returns it, prizes and all.
 *
 * `stockRemaining` is computed by the server rather than subtracted here, and `stockUsed`
 * is why a prize table is edited in place: reducing a prize's stock below what has already
 * been won is refused, and recreating the row would lose the count that refusal depends on.
 */
export interface AdminCampaignReward {
  id: string;
  campaignId: string;
  label: string;
  rewardType: RewardType;
  rewardValue: number;
  weight: number;
  stockTotal: number | null;
  stockUsed: number;
  stockRemaining: number | null;
  validityDays: number;
  isActive: boolean;
}

export interface AdminCampaignRow {
  id: string;
  name: string;
  trigger: ScratchTrigger;
  triggerValue: number | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  cardsIssued: number;
  rewards: AdminCampaignReward[];
}

/**
 * One customer, in full.
 *
 * The counters live under `stats` rather than on the row itself, which is why this is its
 * own interface: the endpoint has never returned a `CustomerSummary`, and typing it as one
 * meant `lifetimeValuePaise` read as a number and arrived undefined.
 */
export interface AdminCustomerDetail {
  id: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  preferredSegment: string | null;
  isBlocked: boolean;
  blockedReason: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  stats: {
    completedVisits: number;
    lifetimeValuePaise: number;
    noShowCount: number;
    currentStreak: number;
    bestStreak: number;
    totalVisits: number;
  };
  bookings: Array<{
    id: string;
    publicId: string;
    status: BookingStatus;
    serviceName: string;
    startsAt: string;
    payablePaise: number;
    addons: string[];
  }>;
  rewards: Array<{
    id: string;
    label: string;
    source: string;
    status: 'AVAILABLE' | 'USED' | 'EXPIRED' | 'REVOKED';
    validTill: string;
  }>;
}

/**
 * A one-off closure. The whole store when `stationId` is null, otherwise one station.
 *
 * The list endpoint only returns closures that have not finished yet — a shop closed last
 * Diwali is history, not something staff need to scroll past.
 */
export interface AdminBlackoutRow {
  id: string;
  stationId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  station: { name: string } | null;
}

// ── Availability — apps/api/src/availability/availability.service.ts ─────────

export interface AvailabilityDto {
  date: string;
  timezone: string;
  serviceId: string;
  totalDurationMinutes: number;
  payablePaise: number;
  slots: Slot[];
  /** Drives the "updated just now" hint. Availability is never cached server-side. */
  computedAt: string;
}

export interface DayAvailabilityDto {
  date: string;
  isOpen: boolean;
  slotCount: number;
}

// ── Booking — apps/api/src/booking/booking.service.ts ────────────────────────

export interface QuoteResponse {
  serviceId: string;
  serviceName: string;
  /** Service duration plus every selected add-on's delta. What the engine actually books. */
  durationMinutes: number;
  basePricePaise: number;
  addonsPricePaise: number;
  discountPaise: number;
  payablePaise: number;
  addons: Array<{ id: string; name: string; pricePaise: number }>;
  appliedReward: {
    id: string;
    label: string;
    discountPaise: number;
    /** Cashback only. Credited on check-in, so it is never subtracted from `payablePaise`. */
    postVisitCreditPaise: number;
  } | null;
}

export interface HoldResponse {
  bookingId: string;
  publicId: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  /** The hold dies at this instant unless payment completes. Drives the countdown. */
  holdExpiresAt: string;
  pricing: {
    basePricePaise: number;
    addonsPricePaise: number;
    discountPaise: number;
    payablePaise: number;
  };
  /**
   * False while the store takes payment at the counter.
   *
   * The hold then comes back already CONFIRMED and there is nothing to charge. A client
   * that asks for a payment order anyway is told the booking is already paid for — on a
   * booking that has, in fact, just succeeded.
   */
  paymentRequired?: boolean;
}

// ── Admin timeline — apps/api/src/booking/booking-lifecycle.service.ts ───────

export interface TimelineBooking {
  id: string;
  publicId: string;
  status: BookingStatus;
  source: string;
  /** "Walk-in" for a booking with no account, `Guest 1801` for one with no name saved. */
  customerName: string;
  customerPhone: string | null;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  /** Cleaning time runs to here. Its own visual band — occupied, but not the session. */
  bufferEndsAt: string;
  payablePaise: number;
  /**
   * Whether the money has been taken.
   *
   * With no gateway configured every booking arrives unpaid and is settled in person, so
   * this is what the counter is scanning the day for.
   */
  isPaid: boolean;
  /** How it was settled — CASH, UPI, CARD, OTHER — or null while unpaid. */
  paidMethod: string | null;
}

export interface TimelineBlackout {
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface TimelineStation {
  id: string;
  name: string;
  bookings: TimelineBooking[];
  /** Store-wide blackouts appear on every station. */
  blackouts: TimelineBlackout[];
}

export interface TimelineDto {
  date: string;
  timezone: string;
  stations: TimelineStation[];
}

// ── Reports — apps/api/src/admin/reports.service.ts ──────────────────────────

export interface DashboardDto {
  date: string;
  revenueTodayPaise: number;
  sessionsToday: number;
  utilisationPercent: number;
  /** Confirmed and still ahead of now — includes days beyond today. */
  upcomingConfirmed: number;
  unscratchedCards: number;
}

// ── Payments ────────────────────────────────────────────────────────────────

export interface AdminPaymentRow {
  id: string;
  status: PaymentStatus;
  amountPaise: number;
  /** Sum of non-failed refunds. A partially refunded payment still shows its full amount. */
  refundedPaise: number;
  method: string | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  failureReason: string | null;
  /** Booking or product-order public id — what the counter would be shown by a customer. */
  reference: string | null;
  description: string;
  createdAt: string;
}

// ── Media — apps/api/src/media/media.service.ts ──────────────────────────────

export interface MediaAsset {
  id: string;
  /** Opaque. Never a filesystem path — the storage layout must stay swappable. */
  key: string;
  url: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** `thumb` / `card` / `hero` WebP renditions derived on upload. */
  variants: Record<string, string>;
  createdAt: string;
}

// ── Products — apps/api/src/admin/admin-products.service.ts ──────────────────

export interface AdminProductOrderRow {
  id: string;
  publicId: string;
  status: ProductOrderStatus;
  totalPaise: number;
  /** null when no payment row exists yet. */
  paymentStatus: PaymentStatus | null;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  items: Array<{ name: string; qty: number; unitPricePaise: number }>;
}

// ── Audit — apps/api/src/common/audit.service.ts ─────────────────────────────

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  /** `"system"` for anything a job did rather than a person. */
  actor: string;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

// ── Shared envelope ─────────────────────────────────────────────────────────

/** Matches `paginated()` in @reset/types. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
