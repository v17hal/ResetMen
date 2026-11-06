-- Coupon codes a customer types at checkout.
--
-- Client request 06/11/2026. Idempotent throughout: this database was created with
-- `prisma db push` and has no migration history.

CREATE TABLE IF NOT EXISTS "coupons" (
  "id"                 UUID           NOT NULL,
  "storeId"            UUID           NOT NULL,
  "code"               TEXT           NOT NULL,
  "note"               TEXT,
  "rewardType"         "RewardType"   NOT NULL,
  "rewardValue"        INTEGER        NOT NULL,
  "minOrderPaise"      INTEGER        NOT NULL DEFAULT 0,
  "validFrom"          TIMESTAMPTZ(3),
  "validTill"          TIMESTAMPTZ(3),
  "maxUses"            INTEGER,
  "maxUsesPerCustomer" INTEGER        DEFAULT 1,
  "isActive"           BOOLEAN        NOT NULL DEFAULT true,
  "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "coupons_storeId_code_key" ON "coupons" ("storeId", "code");

DO $$ BEGIN
  ALTER TABLE "coupons"
    ADD CONSTRAINT "coupons_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "appliedCouponId" UUID;

-- SET NULL, Prisma's default for an optional relation. The admin panel never deletes a code,
-- it only turns one off, so this matters only to a DELETE run by hand.
DO $$ BEGIN
  ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_appliedCouponId_fkey"
    FOREIGN KEY ("appliedCouponId") REFERENCES "coupons"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Counting a code's uses reads bookings by coupon.
CREATE INDEX IF NOT EXISTS "bookings_appliedCouponId_idx" ON "bookings" ("appliedCouponId");
