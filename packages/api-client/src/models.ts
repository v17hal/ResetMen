import type {
  AdminRole,
  BookingStatus,
  PaymentStatus,
  ProductOrderStatus,
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
