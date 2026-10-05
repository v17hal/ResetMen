-- The shop's logo, shown above the greeting on both home screens.
--
-- Idempotent, like every migration here: this database was created with `prisma db push`
-- and has no migration history, so each statement has to be safe to run against a schema
-- that may already have it.

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
