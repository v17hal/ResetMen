-- The rest of the shop's details card, editable from the admin panel (client, 05/10/2026):
-- whether the phone number is shown, and the line under "Questions". Idempotent, as every
-- migration here must be.

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "showPhone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "contactNote" TEXT;
