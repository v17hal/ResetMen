-- Banners that move, and banners that belong somewhere.
--
-- Client request 05/10/2026: the same control as the home banner, inside a category and a
-- service, and able to hold a short video. Idempotent throughout: this database was created
-- with `prisma db push` and has no migration history.

DO $$ BEGIN
  CREATE TYPE "BannerMedia" AS ENUM ('IMAGE', 'VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BannerPlacement" AS ENUM ('HOME', 'CATEGORY', 'SERVICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "mediaType" "BannerMedia" NOT NULL DEFAULT 'IMAGE';
ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "placement" "BannerPlacement" NOT NULL DEFAULT 'HOME';
ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "placementCategoryId" UUID;
ALTER TABLE "banners" ADD COLUMN IF NOT EXISTS "placementServiceId" UUID;

-- Cascade, not SetNull: a banner that belongs to a deleted category or service has nowhere
-- left to appear, and a row with a dangling placement would simply never render.
DO $$ BEGIN
  ALTER TABLE "banners"
    ADD CONSTRAINT "banners_placementCategoryId_fkey"
    FOREIGN KEY ("placementCategoryId") REFERENCES "categories"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "banners"
    ADD CONSTRAINT "banners_placementServiceId_fkey"
    FOREIGN KEY ("placementServiceId") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "banners_placement_idx"
  ON "banners" ("storeId", "placement", "sortOrder");
