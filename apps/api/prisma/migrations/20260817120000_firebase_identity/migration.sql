-- Customers now sign in through Firebase (Google), not phone + OTP.
--
-- Three changes, all widening. Every existing row keeps its phone number and stays valid;
-- nothing is dropped and nothing needs backfilling.

-- 1. The identity anchor. Firebase's uid rather than the email, because people change
--    email addresses and Google reissues a deleted Workspace address to a different human.
ALTER TABLE "users" ADD COLUMN "firebaseUid" TEXT;
CREATE UNIQUE INDEX "users_firebaseUid_key" ON "users"("firebaseUid");

-- 2. Phone becomes optional. Google sign-in yields an email and no phone number, so a
--    NOT NULL here would make the new sign-in path impossible.
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;

-- 3. Email becomes unique where present. Postgres allows many NULLs under a unique index,
--    so customers with no email do not collide with each other. This is what stops two
--    accounts forming for one person if they ever sign in a second way.
--
--    Guarded: if the seed or an import ever produced duplicates, this fails loudly at
--    migrate time rather than silently letting the index creation abort mid-deploy.
DO $$
DECLARE
  duplicates INT;
BEGIN
  SELECT count(*) INTO duplicates
  FROM (
    SELECT lower(email) FROM "users"
    WHERE email IS NOT NULL
    GROUP BY lower(email) HAVING count(*) > 1
  ) AS d;

  IF duplicates > 0 THEN
    RAISE EXCEPTION
      'Cannot add a unique index on users.email: % address(es) are used by more than one row. Merge them first.',
      duplicates;
  END IF;
END $$;

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
