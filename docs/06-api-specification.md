# 06 — API Specification

REST over HTTPS · JSON · base path `/api/v1` · OpenAPI 3.1 generated from NestJS decorators ·
typed client generated into `packages/api-client` and consumed by web, admin and mobile.

## Conventions

| Concern | Convention |
|---|---|
| Auth | `Authorization: Bearer <jwt>`. Customer and admin tokens carry different audiences and are not interchangeable. |
| Store scoping | `X-Store-Id` header. Single-outlet installs default it server-side. |
| Money | Integer paise in every field named `*_paise`. |
| Time | ISO-8601 with offset: `2026-08-08T09:15:00+05:30`. |
| Idempotency | `Idempotency-Key: <uuid>` on every POST that creates money or capacity — see below. |
| Pagination | `?cursor=&limit=` → `{ data, nextCursor }`. |
| Errors | RFC 9457 `application/problem+json` with a stable machine-readable `code`. |
| Versioning | Path-versioned. `/v1` is supported for 12 months after `/v2` ships. |

### Error shape

```json
{
  "type": "https://api.reset.app/errors/slot-taken",
  "title": "Slot no longer available",
  "status": 409,
  "code": "SLOT_TAKEN",
  "detail": "Someone booked this time while you were deciding.",
  "instance": "/api/v1/bookings/hold",
  "meta": { "refreshedSlots": ["09:35", "09:50", "10:05"] }
}
```

Clients switch on `code`, never on `title` or `detail` — those are display copy and will change.

### Idempotency

Carried by `POST /payments/order`, `POST /orders`, and `POST /admin/payments/:id/refund` — the
three routes where a lost response and a retry would otherwise cost somebody money.

| Situation | Result |
|---|---|
| First use of a key | Handler runs; its response is stored against the key for 24 h |
| Replay, same payload | Stored response returned; the handler does **not** run again |
| Replay, different payload | `409 IDEMPOTENT_REPLAY_MISMATCH` |
| Handler failed | Key is released, so an immediate retry can succeed |
| No key sent | Request proceeds normally, without the replay guarantee |

The key row is written **before** the handler runs, so two concurrent requests carrying the
same key cannot both proceed. Payload hashing sorts object keys first, because clients and
proxies do not preserve key order and should not have to.

### Rate limiting

Fixed-window, backed by Redis when `REDIS_URL` is set so several API replicas enforce one
limit rather than one each. It **fails open**: if Redis is unreachable the guard degrades to
per-process counters and logs once. A rate limiter that 500s when its store blinks turns a
minor infrastructure problem into an outage, and the thing it protects against is nuisance
traffic.

### Error codes

| Code | Status | Meaning |
|---|---|---|
| `UNAUTHENTICATED` / `FORBIDDEN` | 401 / 403 | |
| `VALIDATION_FAILED` | 422 | `meta.fields` lists field-level messages |
| `OTP_RATE_LIMITED` | 429 | `meta.retryAfterSeconds` |
| `SLOT_TAKEN` | 409 | Lost the race; `meta.refreshedSlots` included |
| `SLOT_UNAVAILABLE` | 409 | Requested time was never bookable (stale client, closed day, past horizon) |
| `HOLD_EXPIRED` | 410 | Payment attempted after the hold window |
| `SERVICE_UNAVAILABLE_AT_TIME` | 409 | Blocked by an allocation rule or station designation |
| `PAYMENT_FAILED` | 402 / 422 / 502 | Gateway rejected, unreachable, or a bad checkout signature |
| `PAYMENT_NOT_REFUNDABLE` | 409 / 422 | Nothing captured, already refunded, or over the remaining balance |
| `WEBHOOK_SIGNATURE_INVALID` | 400 | HMAC over the raw body did not match |
| `BOOKING_NOT_CANCELLABLE` | 409 | Outside the cancellation window |
| `REWARD_INVALID` | 404 / 409 / 422 | Not yours, expired, already used, under `minOrderPaise`, or the campaign is out of prizes |
| `SCRATCH_ALREADY_USED` | 409 / 410 | Card already scratched, or expired |
| `OUT_OF_STOCK` | 409 | Not enough units left; `meta.productId` included |
| `CUSTOMER_BLOCKED` | 403 | Reserved for the blocked-customer path |
| `CHECKIN_INVALID` / `CHECKIN_ALREADY_USED` | 400 / 409 | |
| `IDEMPOTENT_REPLAY_MISMATCH` | 409 | Same key, different payload |
| `RATE_LIMITED` | 429 | |

---

## 1. Auth — `/api/v1/auth`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/otp/request` | — | `{ phone }` → sends OTP. Rate limited 3/phone/hr, 10/IP/hr. |
| POST | `/otp/verify` | — | `{ phone, code, deviceToken? }` → `{ accessToken, refreshToken, user, isNewUser }` |
| POST | `/refresh` | refresh | Rotating refresh token |
| POST | `/logout` | customer | Revokes refresh token, unregisters device |
| GET | `/me` | customer | Current profile |
| PATCH | `/me` | customer | `{ name, gender, email, dateOfBirth, preferredSegmentId }` |
| POST | `/me/delete-request` | customer | DPDP / Play Store account deletion. Soft-delete + 30-day purge. |
| POST | `/devices` | customer | Register FCM token |

---

## 2. Catalog — `/api/v1/catalog`

Public, no auth, aggressively cached (Redis + `Cache-Control`, invalidated on admin write).

| Method | Path | Purpose |
|---|---|---|
| GET | `/store` | Store profile, hours, timezone, booking horizon, buffer, address, lat/lng |
| GET | `/segments` | Active segments |
| GET | `/categories?segmentId=` | Categories in a segment |
| GET | `/services?categoryId=` | Services with price, duration, image, description |
| GET | `/services/:idOrSlug` | Service detail **including its add-on groups and options** |
| GET | `/home?segmentId=` | One call for the whole home screen — banners, categories, featured services. Saves 4 round-trips on a cold app open. |

**`GET /catalog/services/:id`**

```json
{
  "id": "svc_9f2a",
  "name": "Head + Neck + Shoulder",
  "slug": "head-neck-shoulder",
  "description": "Loosen up the whole upper body in 15 minutes.",
  "imageUrl": "https://cdn.reset.app/svc/hns.webp",
  "pricePaise": 9900,
  "durationMinutes": 15,
  "categoryId": "cat_stress_relief",
  "addonGroups": [
    {
      "id": "grp_oil",
      "name": "Oil Choice",
      "minSelect": 0,
      "maxSelect": 1,
      "options": [
        { "id": "opt_ns",     "name": "Non-Sticky",           "priceDeltaPaise": 1000, "durationDeltaMinutes": 0 },
        { "id": "opt_bhring", "name": "Hair Fall (Bhringraj)", "priceDeltaPaise": 2000, "durationDeltaMinutes": 0 },
        { "id": "opt_almond", "name": "Almond",                "priceDeltaPaise": 3000, "durationDeltaMinutes": 0 }
      ]
    }
  ]
}
```

---

## 3. Availability — `/api/v1/availability`

| Method | Path | Purpose |
|---|---|---|
| GET | `/days?serviceId=&from=&to=` | Which dates are bookable at all — powers the date strip without N calls |
| GET | `/slots?serviceId=&date=&addonOptionIds=` | The slot list for one date |

**`GET /availability/slots?serviceId=svc_9f2a&date=2026-08-08&addonOptionIds=opt_almond`**

```json
{
  "date": "2026-08-08",
  "timezone": "Asia/Kolkata",
  "serviceId": "svc_9f2a",
  "totalDurationMinutes": 15,
  "payablePaise": 12900,
  "slots": [
    { "startsAt": "2026-08-08T09:15:00+05:30", "endsAt": "2026-08-08T09:30:00+05:30", "stationsAvailable": 1 },
    { "startsAt": "2026-08-08T09:35:00+05:30", "endsAt": "2026-08-08T09:50:00+05:30", "stationsAvailable": 2 }
  ],
  "computedAt": "2026-08-08T09:05:12+05:30"
}
```

`stationsAvailable` drives the "only 1 left" cue. `computedAt` lets the client show a
staleness hint and auto-refresh after ~60 s. No station identity is ever exposed.

---

## 4. Bookings — `/api/v1/bookings`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/quote` | customer | Price preview: service + add-ons + reward → breakdown. No side effects. |
| POST | `/hold` | customer | Creates a `HELD` booking, assigns a station, opens a Razorpay order |
| POST | `/:id/confirm` | customer | Client-side confirm after checkout returns. Webhook is authoritative; this only speeds up the UI. |
| POST | `/:id/cancel` | customer | Within the cancellation window |
| GET | `/` | customer | `?status=upcoming\|completed\|cancelled&cursor=` |
| GET | `/:id` | customer | Full detail + QR payload + receipt URL |
| GET | `/:id/qr` | customer | PNG/SVG QR (also cached client-side for offline use at the counter) |
| POST | `/:id/reschedule` | customer | ✅ `{ startsAt }` — moves a confirmed booking in place |

**Reschedule is not cancel-and-rebook.** That would refund and re-charge, break the payment
link, void the QR already on the customer's phone, and — the part that matters — release the
old slot before the new one is secured, so someone moving between two busy hours could end up
with neither.

Instead the row is updated in place inside the same three-layer defence a hold uses, with the
booking itself excluded from the availability recompute (otherwise a five-minute shift
collides with its own trailing buffer). The exclusion constraint is what makes it safe: if the
target time is taken, the UPDATE is rejected and the original booking is untouched.

Price is **not** recomputed. A service that got more expensive since the booking was made must
not silently produce a bill at the counter, and one that got cheaper is not a refund this
endpoint should decide on.

Customers are held to the cancellation window; `POST /admin/bookings/:id/reschedule` is not,
because staff taking a phone call are exactly who that policy should not obstruct.

**`POST /bookings/hold`**

```jsonc
// Request — Idempotency-Key required
{
  "serviceId": "svc_9f2a",
  "startsAt": "2026-08-08T09:15:00+05:30",
  "addonOptionIds": ["opt_almond"],
  "rewardId": null
}
```

```jsonc
// 201
{
  "bookingId": "bkg_7c1e",
  "publicId": "RST-2K8F4M",
  "status": "HELD",
  "startsAt": "2026-08-08T09:15:00+05:30",
  "endsAt":   "2026-08-08T09:30:00+05:30",
  "holdExpiresAt": "2026-08-08T09:15:12+05:30",
  "pricing": {
    "basePricePaise": 9900,
    "addonsPricePaise": 3000,
    "discountPaise": 0,
    "payablePaise": 12900
  },
  "payment": {
    "gateway": "RAZORPAY",
    "orderId": "order_QxAbc123",
    "keyId": "rzp_live_xxx",
    "amountPaise": 12900,
    "currency": "INR"
  }
}
```

```jsonc
// 409 SLOT_TAKEN — the client re-renders the list in place; no manual retry
{
  "code": "SLOT_TAKEN",
  "status": 409,
  "meta": { "refreshedSlots": [ { "startsAt": "...", "stationsAvailable": 2 } ] }
}
```

Note what is **absent** from every response: `stationId`. Customers never see it.

---

## 5. Payments — `/api/v1/payments` ✅

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/order` | customer | `{ bookingId }` **or** `{ productOrderId }` → Razorpay order + publishable key. Amount comes from the stored row, never the request. |
| POST | `/verify` | customer | Browser handshake after checkout returns. Verifies `HMAC(order_id\|payment_id)`. |
| GET | `/:id` | customer | Payment status with refunded total |
| POST | `/:id/simulate-success` | customer | **Non-production only.** Completes a payment with no gateway. |
| POST | `/webhooks/razorpay` | **signature** | Authoritative. Verifies HMAC over the raw body, dedupes on `X-Razorpay-Event-Id`, transitions the booking. |

The webhook is the source of truth. `/verify` only makes the success screen appear a second
sooner; if it never fires, the webhook still confirms the booking, and if the webhook is lost
the reconciliation job catches it.

Three things worth knowing about this module:

- **Simulated mode.** With no `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` configured, orders and
  payment ids are fabricated locally and signed with a development secret. That is what makes
  the whole checkout path runnable before the client's Razorpay account exists. It **refuses
  to start in production**, so a live deployment can never silently accept fake payments.
- **Calling `/order` twice returns the same order** while one is still open, so a customer who
  taps *Pay* twice does not end up with two orders against one slot.
- **A capture that lands after the hold expired is refunded automatically.** The slot may
  already belong to someone else, so the booking is not resurrected — the money goes back
  without anyone having to notice.

Webhook handling always answers 2xx once a delivery is accepted. Razorpay retries on any
non-2xx, and since deliveries are deduped by event id, a retry after a processing failure
could never succeed — so failures are recorded on the event row and surfaced at
`GET /admin/payments/webhook-failures` instead.

---

## 6. Rewards — `/api/v1/rewards` ✅

| Method | Path | Purpose |
|---|---|---|
| GET | `/wallet` | `?serviceId=&addonOptionIds=` — every reward priced against that basket, each with `applicable`, `discountPaise` and a `blockedReason` when it cannot be used |
| GET | `/streak` | `{ currentCount, bestCount, totalVisits, goal: { requiredVisits, remaining, rewardLabel, windowEndsAt } }` |
| GET | `/scratch-cards` | Issued and scratched cards; `reward` is `null` until scratched |
| POST | `/scratch-cards/:id/scratch` | Server draws inside a transaction and returns the prize. One-shot. |

Applying a reward is not a separate call — pass `rewardId` to `POST /bookings/quote` and
`POST /bookings/hold`. A reward that cannot be used **throws** rather than being silently
ignored, because a customer who picks one and sees the total unchanged will assume the app is
broken.

**Cashback is the exception, and it is deliberate.** It is selectable, discounts nothing at
checkout, and credits the wallet on **check-in** — a `FLAT_OFF` reward, which is what every
Indian app these customers already use means by the word. Paying on check-in rather than on
payment means someone who books, pays and never turns up earns nothing; the alternative makes
no-shows profitable. `walletEntry.postVisitCreditPaise` is reported separately from
`discountPaise` so a client can never add the two together, and so the checkout screen can say
*"₹50 back after your visit"* instead of showing a reward that appears to do nothing.

**Single use is enforced by a conditional UPDATE at hold time**, not at payment: two checkouts
racing on the same reward produce one winner and one clean 409. An abandoned hold gives the
reward back when it expires or is cancelled.

The draw consumes stock with a compare-and-increment in SQL. When every prize is exhausted the
card is **returned to `ISSUED`** rather than burned — the owner can restock and the customer
keeps their card.

---

## 7. Products — `/api/v1/products` ✅

| Method | Path | Purpose |
|---|---|---|
| GET | `/products` | Storefront listing. Stock is exposed as `inStock: boolean`, never a count. |
| GET | `/products/:slug` | Detail |
| POST | `/orders` | Create a pending order. Stock is decremented here, not at payment. |
| GET | `/orders` · `/orders/:id` | History and detail |

Payment goes through `POST /payments/order` with the returned `productOrderId` — the same
gateway path bookings use, so there is one checkout implementation rather than two.

Stock is taken at order time for the same reason a slot is held rather than sold at checkout:
two people buying the last tub must not both reach the payment screen. An order that is never
paid for returns its stock after 30 minutes.

---

## 7b. Notifications — `/api/v1/notifications` ✅

| Method | Path | Purpose |
|---|---|---|
| POST | `/devices` | `{ token, platform }` — call on **every app start**, not only first grant; FCM rotates tokens silently |
| DELETE | `/devices` | Unregister on sign-out |
| GET | `/` | Notification history for the in-app inbox |

Copy lives server-side so it can be corrected without a Play Store release — and so it stays
inside the client's vocabulary rules (never *spa*, *therapy* or *massage*). Reminders fire at
T-60 and T-10, deduped against the notification log.

**Push first, then fall back.** Four channels are wired — push, SMS, WhatsApp, email — but
they are not alternatives to each other:

| Channel | When |
|---|---|
| **Push** | Always. Free, and it deep-links into the app. |
| **SMS** | Only when push reached nobody, and only for templates the customer would be materially harmed by missing: confirmation, cancellation, reschedule, order-ready. |
| **WhatsApp** | Alongside the SMS fallback, when the client has configured a sender number. |
| **Email** | Additive, not a fallback. Booking confirmations only — a record worth having. |

SMS is billed per message and paid for by your client. Sending every notification on every
channel would double their bill to tell people something they already read on a lock screen,
so a scratch card never triggers one.

Transactional SMS to an Indian number must match a **DLT-registered template** or the operator
drops it silently — which is why the SMS and WhatsApp adapters send a template id and
variables rather than a message body. That wording lives in MSG91's console under your
client's DLT entity, not in this repository.

Unconfigured providers log instead of sending, so every path is exercisable before your
client's accounts exist.

---

## 8. Admin — `/api/v1/admin`

All routes require an admin JWT. `[O]` Owner · `[M]` Manager · `[S]` Staff.

### 8.1 Auth & staff ✅
| Method | Path | Role |
|---|---|---|
| POST | `/auth/login` · `/auth/refresh` | — |
| GET/POST/PUT/DELETE | `/staff` | `[O]` |
| POST | `/staff/:id/password` | `[O]` |

Deactivating or demoting the **last active owner** is refused. That failure — a store with no
working owner login — cannot be fixed from inside the product. Accounts are deactivated, never
deleted, because the audit log and check-in records point at them.

### 8.2 Catalog ✅
| Method | Path | Role |
|---|---|---|
| CRUD | `/catalog/segments` · `/catalog/categories` · `/catalog/services` | `[O][M]` |
| POST | `/catalog/services/:id/active` | `[O][M]` — publish toggle; refuses a service with no duration |
| CRUD | `/catalog/addon-groups` · `/catalog/addon-groups/:id/options` | `[O][M]` |
| PUT | `/catalog/services/:id/addon-groups` | `[O][M]` — attach reusable groups |
| POST | `/catalog/reorder/:entity` | `[O][M]` — bulk sort order in one transaction |
| POST/GET/DELETE | `/media` | `[O][M]` — upload, list, delete |

Deletes are **soft** throughout: bookings snapshot names and prices but still carry
`serviceId`, and reports group by it. Deleting a service with future bookings is refused
outright — deactivate it instead, and existing bookings are still honoured.

Uploads are capped at 5 MB, restricted to JPEG/PNG/WebP/AVIF, and checked against the file's
leading bytes rather than its declared content-type. Keys are opaque random strings; the
uploaded filename never reaches the filesystem.

Every upload also yields three WebP renditions — `thumb` 200px, `card` 600px, `hero` 1200px —
returned as URLs alongside the original, never upscaled. This is for the Flutter app more than
the web: a catalog scrolling twenty full-size phone photos over patchy 4G is slow enough that
customers give up, and the data is theirs to pay for.

### 8.3 Capacity — the client's 02/08 requirements
| Method | Path | Role | Purpose |
|---|---|---|---|
| CRUD | `/stations` | `[O][M]` | Count, names, active |
| PUT | `/stations/:id/services` | `[O][M]` | **Station→service designation.** `{ allowsAllServices, serviceIds[] }` |
| CRUD | `/allocation-rules` | `[O][M]` | **Time-boxed exclusive reservation.** Body below. |
| POST | `/allocation-rules/preview` | `[O][M]` | Dry-run: what a rule does to tomorrow's availability, and which existing bookings it would conflict with — **before** saving |
| CRUD | `/blackouts` | `[O][M]` | Holidays, maintenance windows |
| GET/PUT | `/store-hours` · `/settings` | `[O][M]` | Hours, buffer, granularity, horizon, hold TTL, cancellation window |

**`POST /admin/allocation-rules`**

```jsonc
{
  "name": "Morning ₹199 push",
  "mode": "EXCLUSIVE_TO",
  "recurrence": "WEEKLY",
  "daysOfWeek": [1,2,3,4,5,6],
  "startsAtLocal": "09:00",
  "endsAtLocal": "12:00",
  "dateFrom": "2026-08-10",
  "dateTo": null,
  "stationIds": ["stn_2", "stn_3"],
  "serviceIds": ["svc_fullbody_basic"],
  "priority": 100,
  "isActive": true
}
```

`/preview` is deliberately part of P0. A rule that silently strands existing bookings, or
wipes out tomorrow's Head Massage availability, is exactly the kind of mistake an owner makes
once and never trusts the system again afterwards.

### 8.4 Bookings & check-in
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/bookings` | `[O][M][S]` | Filter by date, status, service, customer |
| GET | `/bookings/calendar?date=` | `[O][M][S]` | **Station-wise timeline** — the view staff actually use |
| POST | `/bookings/walk-in` | `[O][M][S]` | Staff creates a booking at the counter. Same engine, `source=ADMIN_WALKIN`. |
| POST | `/bookings/:id/status` | `[O][M][S]` | `CHECKED_IN` / `IN_PROGRESS` / `COMPLETED` / `NO_SHOW` / `CANCELLED` |
| POST | `/bookings/:id/reassign-station` | `[O][M]` | Manual override; validated against the exclusion constraint |
| POST | `/checkins` | `[O][M][S]` | `{ token }` from the QR scanner → returns customer, service, add-ons, station, duration |
| POST | `/checkins/manual` | `[O][M][S]` | `{ publicId }` fallback when a camera fails — it will |
| POST | `/bookings/:id/reschedule` | `[O][M][S]` | Counter-side move; not held to the cancellation window |

Refunds live at `POST /admin/payments/:id/refund` rather than under the booking: a payment can
also belong to a product order, and one refund implementation is better than two.

### 8.5 Rewards, products, customers, reports ✅
| Method | Path | Role |
|---|---|---|
| CRUD | `/rewards/streak-rules` | `[O][M]` |
| CRUD | `/rewards/campaigns` | `[O][M]` |
| GET | `/rewards/campaigns/:id/stats` | `[O][M]` — **expected cost per card**, win chances, stock remaining |
| POST | `/rewards/grants` · `/rewards/grants/:id/revoke` | `[O][M]` — manual goodwill reward |
| CRUD | `/products` | `[O][M]` |
| POST | `/products/:id/stock` | `[O][M][S]` — signed **delta**, never an absolute |
| GET | `/products/orders/all` · POST `/products/orders/:id/status` | `[O][M][S]` |
| GET | `/customers` · `/customers/:id` | `[O][M][S]` |
| POST | `/customers/:id/block` | `[O][M]` |
| GET | `/payments` · POST `/payments/:id/refund` | `[O][M]` |
| GET | `/payments/webhook-failures` | `[O][M]` |
| GET | `/reports/dashboard` | `[O][M]` — today at a glance |
| GET | `/reports/revenue?from=&to=` | `[O][M]` — gross, discount, net, refunded, by day, by service |
| GET | `/reports/utilisation?from=&to=` | `[O][M]` — **booked station-minutes ÷ open station-minutes**, per station and per hour |
| GET | `/reports/no-show` · `/reports/retention` | `[O][M]` |
| GET | `/reports/export?report=&from=&to=` | `[O][M]` — CSV, audited |
| GET | `/audit` | `[O]` |

Three deliberate choices in the reporting layer:

- **Realised revenue excludes `CONFIRMED`.** That is money taken for a visit that has not
  happened yet. Counting it would make today's figure move *backwards* when someone fails to
  turn up, and a report that revises itself downwards is a report nobody trusts.
- **Buffer minutes are reported separately from booked minutes.** "Why is utilisation only
  70%?" is answered by showing the cleaning time rather than arguing about it.
- **"New" means their first realised visit fell in the window**, not that their account was
  created in it. Someone who signed up in March and first came in June was acquired in June.

Campaign stats exist because weights are not intuitive: *"1-in-10 wins ₹500"* is easy to write
and expensive to mean. `expectedCostPerCardPaise` is the weighted mean payout of one scratch,
valued against the store's own average booking.

CSV exports are audited — an export is a copy of customer names and phone numbers leaving the
system, and under the DPDP Act the store needs to be able to say who took one and when. The
file is written with a UTF-8 BOM so Excel does not mangle ₹ and non-ASCII names.

The utilisation report is what tells the owner whether the morning ₹199 push actually worked
or just starved the ₹299 Premium. It's the feedback loop for every capacity decision the
admin panel enables.

---

## 9. System

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness — process up |
| GET | `/health/ready` | Readiness — Postgres + Redis reachable |
| GET | `/media/:storeId/:file` | Public image read — originals and renditions |
| GET | `/docs` | Swagger UI (non-production only) |
| GET | `/openapi.json` | Spec — the source for the generated client |
