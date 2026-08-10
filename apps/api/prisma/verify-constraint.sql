-- Proves the no-double-booking guarantee is enforced by the database, not by hope.
--
-- Run:  docker exec -i reset-postgres psql -U reset -d reset -f -  < verify-constraint.sql
--
-- Expected: booking 1 and 3 insert, booking 2 is REJECTED with SQLSTATE 23P01, and the
-- final count is 2.

-- Each statement runs in its own transaction (autocommit) on purpose: a failed statement
-- inside an explicit transaction would abort it and every later statement with it, hiding
-- the fact that booking 3 is legal.
\set ON_ERROR_STOP off

CREATE TEMP TABLE ids AS
SELECT
  (SELECT id FROM stores   LIMIT 1) AS store_id,
  (SELECT id FROM stations WHERE name = 'Station 1' LIMIT 1) AS station_id,
  (SELECT id FROM services WHERE slug = 'head' LIMIT 1) AS service_id;

-- 1. A 10-minute session at 09:00, blocking until 09:15 (10 min + 5 min buffer).
INSERT INTO bookings (
  id, "publicId", "storeId", "serviceId", "stationId", status, source,
  "startsAt", "endsAt", "blockedUntil", "totalDurationMinutes",
  "serviceNameSnapshot", "basePricePaise", "addonsPricePaise", "discountPaise", "payablePaise",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), 'RST-TEST01', store_id, service_id, station_id, 'CONFIRMED', 'APP',
  '2026-08-08 03:30:00+00', '2026-08-08 03:40:00+00', '2026-08-08 03:45:00+00', 10,
  'Head', 4900, 0, 0, 4900, now(), now()
FROM ids;

\echo '→ booking 1 (09:00-09:10, blocks to 09:15) inserted'

-- 2. An overlapping session at 09:10 on the SAME station. This must fail: 09:10 falls
--    inside the first booking's buffer.
INSERT INTO bookings (
  id, "publicId", "storeId", "serviceId", "stationId", status, source,
  "startsAt", "endsAt", "blockedUntil", "totalDurationMinutes",
  "serviceNameSnapshot", "basePricePaise", "addonsPricePaise", "discountPaise", "payablePaise",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), 'RST-TEST02', store_id, service_id, station_id, 'HELD', 'WEB',
  '2026-08-08 03:40:00+00', '2026-08-08 03:50:00+00', '2026-08-08 03:55:00+00', 10,
  'Head', 4900, 0, 0, 4900, now(), now()
FROM ids;

\echo '→ booking 2 (09:10, inside the buffer) — must have been REJECTED above'

-- 3. The same station at 09:15 — exactly when the buffer ends. Must succeed.
INSERT INTO bookings (
  id, "publicId", "storeId", "serviceId", "stationId", status, source,
  "startsAt", "endsAt", "blockedUntil", "totalDurationMinutes",
  "serviceNameSnapshot", "basePricePaise", "addonsPricePaise", "discountPaise", "payablePaise",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), 'RST-TEST03', store_id, service_id, station_id, 'CONFIRMED', 'APP',
  '2026-08-08 03:45:00+00', '2026-08-08 03:55:00+00', '2026-08-08 04:00:00+00', 10,
  'Head', 4900, 0, 0, 4900, now(), now()
FROM ids;

\echo '→ booking 3 (09:15, exactly at buffer end) inserted'

SELECT count(*) AS bookings_that_survived FROM bookings;

-- Clean up the fixtures.
DELETE FROM bookings WHERE "publicId" LIKE 'RST-TEST%';
