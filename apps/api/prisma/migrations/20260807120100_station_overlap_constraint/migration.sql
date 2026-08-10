-- ═══════════════════════════════════════════════════════════════════════════════
--  The most important statement in this codebase.
--
--  The product's core promise is that a station can never be double-booked. That promise
--  is kept HERE, by the database, and not in application code — because application code
--  can be raced, retried, refactored, or run on a second API replica, and any of those can
--  reintroduce the bug silently. A GiST exclusion constraint cannot be bypassed: the INSERT
--  simply fails with SQLSTATE 23P01, which the API translates into 409 SLOT_TAKEN plus a
--  freshly computed slot list.
--
--  Applies to docs/05-slot-station-engine.md §7.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- The range is [starts_at, blocked_until) — blocked_until already includes the booking's
-- trailing buffer, so the cleaning gap is protected by the same constraint that protects
-- the session itself.
--
-- Only statuses that actually occupy a station participate. HELD is included on purpose:
-- a slot held during payment must be unavailable to everyone else. EXPIRED, CANCELLED,
-- NO_SHOW and COMPLETED release the station.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_station_overlap"
  EXCLUDE USING gist (
    "stationId" WITH =,
    tstzrange("startsAt", "blockedUntil", '[)') WITH &&
  )
  WHERE (
    "status" IN ('HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS')
  );

-- Range-overlap lookups for the availability query ("what is busy on this station today").
CREATE INDEX IF NOT EXISTS "bookings_station_range_idx"
  ON "bookings"
  USING gist ("stationId", tstzrange("startsAt", "blockedUntil", '[)'));

-- The hold-expiry sweep runs every 30 seconds; keep it on a partial index so it never
-- scans the full bookings table.
CREATE INDEX IF NOT EXISTS "bookings_active_hold_idx"
  ON "bookings" ("holdExpiresAt")
  WHERE "status" = 'HELD';

-- Day views (customer availability, admin timeline) never care about released bookings.
CREATE INDEX IF NOT EXISTS "bookings_store_day_active_idx"
  ON "bookings" ("storeId", "startsAt")
  WHERE "status" NOT IN ('CANCELLED', 'EXPIRED', 'NO_SHOW');

-- ── Money sanity ───────────────────────────────────────────────────────────────
-- Every amount is integer paise. These make an entire class of pricing bug impossible to
-- persist rather than merely unlikely.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_amounts_non_negative"
  CHECK (
    "basePricePaise"   >= 0 AND
    "addonsPricePaise" >= 0 AND
    "discountPaise"    >= 0 AND
    "payablePaise"     >= 0
  );

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_payable_is_consistent"
  CHECK ("payablePaise" = "basePricePaise" + "addonsPricePaise" - "discountPaise");

-- ── Time sanity ────────────────────────────────────────────────────────────────
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_ordering"
  CHECK ("endsAt" > "startsAt" AND "blockedUntil" >= "endsAt");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_duration_positive"
  CHECK ("totalDurationMinutes" > 0);

-- A service with no duration cannot be scheduled, so it cannot be stored either.
ALTER TABLE "services"
  ADD CONSTRAINT "services_duration_positive"
  CHECK ("durationMinutes" > 0);

ALTER TABLE "services"
  ADD CONSTRAINT "services_price_non_negative"
  CHECK ("pricePaise" >= 0);

-- ── Blackout & allocation-rule sanity ──────────────────────────────────────────
ALTER TABLE "blackouts"
  ADD CONSTRAINT "blackouts_time_ordering"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "allocation_rules"
  ADD CONSTRAINT "allocation_rules_time_ordering"
  CHECK ("endsAtLocal" > "startsAtLocal");

-- ── Add-on group selection rules ───────────────────────────────────────────────
ALTER TABLE "addon_groups"
  ADD CONSTRAINT "addon_groups_select_bounds"
  CHECK ("minSelect" >= 0 AND "maxSelect" >= "minSelect");
