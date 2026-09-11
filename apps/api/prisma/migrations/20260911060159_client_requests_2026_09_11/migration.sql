-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportAuthor" AS ENUM ('CUSTOMER', 'STAFF');

-- AlterEnum
--
-- COUNTER was added to the schema with the counter-payment work of 07/09/2026 but never
-- given a migration. Production has it anyway, because production is built with
-- `db push` (see infra/README.md) — so this has to be a no-op there and real everywhere
-- else. IF NOT EXISTS is what makes one file correct for both.
ALTER TYPE "PaymentGateway" ADD VALUE IF NOT EXISTS 'COUNTER';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "termsAcceptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "termsVersion" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "badge" TEXT,
ADD COLUMN     "compareAtPricePaise" INTEGER,
ADD COLUMN     "emoji" TEXT,
ADD COLUMN     "tagline" TEXT;

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "altText" TEXT NOT NULL,
    "serviceId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_threads" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "storeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "bookingId" UUID,
    "subject" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageBy" "SupportAuthor" NOT NULL DEFAULT 'CUSTOMER',
    "unreadByCustomer" BOOLEAN NOT NULL DEFAULT false,
    "unreadByStaff" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "author" "SupportAuthor" NOT NULL,
    "adminUserId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banners_storeId_isActive_sortOrder_idx" ON "banners"("storeId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "support_threads_publicId_key" ON "support_threads"("publicId");

-- CreateIndex
CREATE INDEX "support_threads_storeId_status_lastMessageAt_idx" ON "support_threads"("storeId", "status", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "support_threads_userId_lastMessageAt_idx" ON "support_threads"("userId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "support_messages_threadId_createdAt_idx" ON "support_messages"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "support_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
