-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('EXCLUSIVE_TO', 'EXCLUDE_FROM');

-- CreateEnum
CREATE TYPE "AllocationRecurrence" AS ENUM ('ONE_OFF', 'WEEKLY');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('APP', 'WEB', 'ADMIN_WALKIN');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('PERCENT_OFF', 'FLAT_OFF', 'FREE_SERVICE', 'FREE_ADDON', 'CASHBACK');

-- CreateEnum
CREATE TYPE "RewardSource" AS ENUM ('SCRATCH_CARD', 'STREAK', 'PROMO', 'MANUAL');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ScratchTrigger" AS ENUM ('ON_CHECKIN', 'ON_NTH_BOOKING', 'ON_STREAK_COMPLETE');

-- CreateEnum
CREATE TYPE "ScratchCardStatus" AS ENUM ('ISSUED', 'SCRATCHED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProductOrderStatus" AS ENUM ('PENDING', 'PAID', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "address" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "phone" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_settings" (
    "storeId" UUID NOT NULL,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 5,
    "slotGranularityMinutes" INTEGER NOT NULL DEFAULT 5,
    "bookingHorizonDays" INTEGER NOT NULL DEFAULT 7,
    "minLeadMinutes" INTEGER NOT NULL DEFAULT 0,
    "holdTtlMinutes" INTEGER NOT NULL DEFAULT 10,
    "cancellationWindowMinutes" INTEGER NOT NULL DEFAULT 120,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "allowsAllServices" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_services" (
    "stationId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,

    CONSTRAINT "station_services_pkey" PRIMARY KEY ("stationId","serviceId")
);

-- CreateTable
CREATE TABLE "store_hours" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opensAt" TIME(0) NOT NULL,
    "closesAt" TIME(0) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "store_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blackouts" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "stationId" UUID,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rules" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "AllocationMode" NOT NULL,
    "recurrence" "AllocationRecurrence" NOT NULL DEFAULT 'WEEKLY',
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dateFrom" DATE,
    "dateTo" DATE,
    "startsAtLocal" TIME(0) NOT NULL,
    "endsAtLocal" TIME(0) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rule_stations" (
    "ruleId" UUID NOT NULL,
    "stationId" UUID NOT NULL,

    CONSTRAINT "allocation_rule_stations_pkey" PRIMARY KEY ("ruleId","stationId")
);

-- CreateTable
CREATE TABLE "allocation_rule_services" (
    "ruleId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,

    CONSTRAINT "allocation_rule_services_pkey" PRIMARY KEY ("ruleId","serviceId")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "pricePaise" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "bufferOverrideMinutes" INTEGER,
    "maxPerSlot" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_groups" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addon_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_addon_groups" (
    "serviceId" UUID NOT NULL,
    "addonGroupId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_addon_groups_pkey" PRIMARY KEY ("serviceId","addonGroupId")
);

-- CreateTable
CREATE TABLE "addon_options" (
    "id" UUID NOT NULL,
    "addonGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_paise" INTEGER NOT NULL,
    "durationDeltaMinutes" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addon_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "gender" "Gender" NOT NULL DEFAULT 'UNDISCLOSED',
    "email" TEXT,
    "dateOfBirth" DATE,
    "preferredSegmentId" UUID,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "lastLoginAt" TIMESTAMPTZ(3),
    "consentAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "storeId" UUID,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'STAFF',
    "totpSecret" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "userId" UUID,
    "serviceId" UUID NOT NULL,
    "stationId" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'HELD',
    "source" "BookingSource" NOT NULL DEFAULT 'APP',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "blockedUntil" TIMESTAMPTZ(3) NOT NULL,
    "totalDurationMinutes" INTEGER NOT NULL,
    "holdExpiresAt" TIMESTAMPTZ(3),
    "serviceNameSnapshot" TEXT NOT NULL,
    "basePricePaise" INTEGER NOT NULL,
    "addonsPricePaise" INTEGER NOT NULL DEFAULT 0,
    "discountPaise" INTEGER NOT NULL DEFAULT 0,
    "payablePaise" INTEGER NOT NULL,
    "appliedRewardId" UUID,
    "idempotencyKey" TEXT,
    "notes" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "checkedInAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_addons" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "addonOptionId" UUID NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "durationDeltaMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "bookingId" UUID,
    "productOrderId" UUID,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'RAZORPAY',
    "gatewayOrderId" TEXT NOT NULL,
    "gatewayPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "method" TEXT,
    "failureReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "gatewayRefundId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "initiatedBy" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'RAZORPAY',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkin_tokens" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMPTZ(3),
    "usedByAdminId" UUID,

    CONSTRAINT "checkin_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streak_rules" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "requiredVisits" INTEGER NOT NULL,
    "withinDays" INTEGER NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "rewardValue" INTEGER NOT NULL,
    "rewardServiceId" UUID,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "streak_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_streaks" (
    "userId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "bestCount" INTEGER NOT NULL DEFAULT 0,
    "totalVisits" INTEGER NOT NULL DEFAULT 0,
    "lastCheckinAt" TIMESTAMPTZ(3),
    "windowStartedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_streaks_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "scratch_campaigns" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "ScratchTrigger" NOT NULL,
    "triggerValue" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scratch_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scratch_rewards" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "rewardValue" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "stockTotal" INTEGER,
    "stockUsed" INTEGER NOT NULL DEFAULT 0,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scratch_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scratch_cards" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "bookingId" UUID,
    "status" "ScratchCardStatus" NOT NULL DEFAULT 'ISSUED',
    "scratchRewardId" UUID,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scratchedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),

    CONSTRAINT "scratch_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_rewards" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "source" "RewardSource" NOT NULL,
    "sourceId" UUID,
    "rewardType" "RewardType" NOT NULL,
    "rewardValue" INTEGER NOT NULL,
    "minOrderPaise" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTill" TIMESTAMPTZ(3) NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'ACTIVE',
    "redeemedBookingId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "pricePaise" INTEGER NOT NULL,
    "mrpPaise" INTEGER,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "sku" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_orders" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ProductOrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_order_items" (
    "id" UUID NOT NULL,
    "productOrderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "product_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_attempts" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "otp_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "variants" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "storeId" UUID,
    "adminUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE INDEX "stations_storeId_isActive_idx" ON "stations"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "store_hours_storeId_dayOfWeek_idx" ON "store_hours"("storeId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "blackouts_storeId_startsAt_endsAt_idx" ON "blackouts"("storeId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "allocation_rules_storeId_isActive_idx" ON "allocation_rules"("storeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "segments_storeId_slug_key" ON "segments"("storeId", "slug");

-- CreateIndex
CREATE INDEX "categories_segmentId_sortOrder_idx" ON "categories"("segmentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "categories_storeId_slug_key" ON "categories"("storeId", "slug");

-- CreateIndex
CREATE INDEX "services_categoryId_sortOrder_idx" ON "services"("categoryId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "services_storeId_slug_key" ON "services"("storeId", "slug");

-- CreateIndex
CREATE INDEX "addon_options_addonGroupId_sortOrder_idx" ON "addon_options"("addonGroupId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_publicId_key" ON "bookings"("publicId");

-- CreateIndex
CREATE INDEX "bookings_storeId_startsAt_idx" ON "bookings"("storeId", "startsAt");

-- CreateIndex
CREATE INDEX "bookings_userId_startsAt_idx" ON "bookings"("userId", "startsAt" DESC);

-- CreateIndex
CREATE INDEX "bookings_stationId_startsAt_idx" ON "bookings"("stationId", "startsAt");

-- CreateIndex
CREATE INDEX "bookings_status_holdExpiresAt_idx" ON "bookings"("status", "holdExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_storeId_idempotencyKey_key" ON "bookings"("storeId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "booking_addons_bookingId_idx" ON "booking_addons"("bookingId");

-- CreateIndex
CREATE INDEX "booking_status_history_bookingId_createdAt_idx" ON "booking_status_history"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_productOrderId_key" ON "payments"("productOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayPaymentId_key" ON "payments"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "payments_storeId_status_createdAt_idx" ON "payments"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payments_gatewayOrderId_idx" ON "payments"("gatewayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_gatewayRefundId_key" ON "refunds"("gatewayRefundId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_eventId_key" ON "payment_events"("eventId");

-- CreateIndex
CREATE INDEX "payment_events_eventType_createdAt_idx" ON "payment_events"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_tokens_bookingId_key" ON "checkin_tokens"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "checkin_tokens_token_key" ON "checkin_tokens"("token");

-- CreateIndex
CREATE INDEX "streak_rules_storeId_isActive_idx" ON "streak_rules"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "scratch_campaigns_storeId_isActive_idx" ON "scratch_campaigns"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "scratch_rewards_campaignId_isActive_idx" ON "scratch_rewards"("campaignId", "isActive");

-- CreateIndex
CREATE INDEX "scratch_cards_userId_status_idx" ON "scratch_cards"("userId", "status");

-- CreateIndex
CREATE INDEX "user_rewards_userId_status_validTill_idx" ON "user_rewards"("userId", "status", "validTill");

-- CreateIndex
CREATE UNIQUE INDEX "products_storeId_slug_key" ON "products"("storeId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "product_orders_publicId_key" ON "product_orders"("publicId");

-- CreateIndex
CREATE INDEX "product_orders_storeId_status_createdAt_idx" ON "product_orders"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "product_order_items_productOrderId_idx" ON "product_order_items"("productOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

-- CreateIndex
CREATE INDEX "notification_log_userId_createdAt_idx" ON "notification_log"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "otp_attempts_phone_key" ON "otp_attempts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_key_key" ON "media_assets"("key");

-- CreateIndex
CREATE INDEX "audit_log_storeId_createdAt_idx" ON "audit_log"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_entityType_entityId_idx" ON "audit_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- AddForeignKey
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_services" ADD CONSTRAINT "station_services_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_services" ADD CONSTRAINT "station_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_hours" ADD CONSTRAINT "store_hours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blackouts" ADD CONSTRAINT "blackouts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blackouts" ADD CONSTRAINT "blackouts_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rule_stations" ADD CONSTRAINT "allocation_rule_stations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "allocation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rule_stations" ADD CONSTRAINT "allocation_rule_stations_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rule_services" ADD CONSTRAINT "allocation_rule_services_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "allocation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rule_services" ADD CONSTRAINT "allocation_rule_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_groups" ADD CONSTRAINT "addon_groups_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_addon_groups" ADD CONSTRAINT "service_addon_groups_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_addon_groups" ADD CONSTRAINT "service_addon_groups_addonGroupId_fkey" FOREIGN KEY ("addonGroupId") REFERENCES "addon_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_options" ADD CONSTRAINT "addon_options_addonGroupId_fkey" FOREIGN KEY ("addonGroupId") REFERENCES "addon_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_preferredSegmentId_fkey" FOREIGN KEY ("preferredSegmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_appliedRewardId_fkey" FOREIGN KEY ("appliedRewardId") REFERENCES "user_rewards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_addons" ADD CONSTRAINT "booking_addons_addonOptionId_fkey" FOREIGN KEY ("addonOptionId") REFERENCES "addon_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_productOrderId_fkey" FOREIGN KEY ("productOrderId") REFERENCES "product_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_tokens" ADD CONSTRAINT "checkin_tokens_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_tokens" ADD CONSTRAINT "checkin_tokens_usedByAdminId_fkey" FOREIGN KEY ("usedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streak_rules" ADD CONSTRAINT "streak_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streak_rules" ADD CONSTRAINT "streak_rules_rewardServiceId_fkey" FOREIGN KEY ("rewardServiceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_streaks" ADD CONSTRAINT "user_streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_streaks" ADD CONSTRAINT "user_streaks_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_campaigns" ADD CONSTRAINT "scratch_campaigns_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_rewards" ADD CONSTRAINT "scratch_rewards_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "scratch_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_cards" ADD CONSTRAINT "scratch_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_cards" ADD CONSTRAINT "scratch_cards_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "scratch_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_cards" ADD CONSTRAINT "scratch_cards_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scratch_cards" ADD CONSTRAINT "scratch_cards_scratchRewardId_fkey" FOREIGN KEY ("scratchRewardId") REFERENCES "scratch_rewards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_rewards" ADD CONSTRAINT "user_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_rewards" ADD CONSTRAINT "user_rewards_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_orders" ADD CONSTRAINT "product_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_order_items" ADD CONSTRAINT "product_order_items_productOrderId_fkey" FOREIGN KEY ("productOrderId") REFERENCES "product_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_order_items" ADD CONSTRAINT "product_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
