-- Store profile: the words the shop can change for itself.
--
-- Written to run against this project's production database, which was created with
-- `prisma db push` and so has no migration history: every statement is idempotent.

DO $$ BEGIN
  CREATE TYPE "StoreAudience" AS ENUM ('MEN_ONLY', 'EVERYONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "tagline" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "audience" "StoreAudience" NOT NULL DEFAULT 'MEN_ONLY';
