-- Phone + OTP sign-in is gone. Customers authenticate through Firebase.
--
-- Dropped rather than left dormant. These two tables hold nothing but credentials and
-- rate-limit counters for a flow that no longer exists, and an unused table full of
-- authentication material is a liability that quietly outlives whoever remembers why it
-- is there. The DPDP Act's minimisation principle says the same thing.
--
-- Nothing references them: no foreign keys point here, and the code that read them was
-- removed in the same commit. If phone sign-in ever returns it comes back through
-- Firebase, which stores none of this on our side.

DROP TABLE IF EXISTS "otp_codes";
DROP TABLE IF EXISTS "otp_attempts";
