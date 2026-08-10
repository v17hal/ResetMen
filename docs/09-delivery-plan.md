# 09 — Delivery Plan

Sequenced so the riskiest thing is built first and the store can go live before the
nice-to-haves exist.

## Sequencing principle

The **slot & station engine is built and proven in Phase 1**, before any UI. It is the only
part of this system that can't be patched over later: if the engine is wrong, customers get
double-booked, staff lose trust in the panel, and no amount of polish elsewhere recovers it.
Everything else — rewards, products, scratch cards — is additive and can ship after launch.

---

## Phases

### Phase 0 — Foundation

| Deliverable | Detail |
|---|---|
| Monorepo scaffold | pnpm + Turbo, four apps, six packages, CI green |
| Docker dev environment | Postgres · Redis · MinIO, one-command boot |
| Prisma schema + migrations | Every table from [doc 04](04-data-model.md), including the `btree_gist` exclusion constraint |
| Seed data | The photographed MEN menu, 3 stations, 09:00–21:00, 5-min buffer |
| Auth | Phone OTP → JWT; admin login with RBAC |
| Design tokens + Storybook | Shared across web, admin, mobile |

**Exit:** `pnpm dev` boots everything, a seeded catalog is queryable, an admin can log in.

### Phase 1 — The engine ⭐

| Deliverable | Detail |
|---|---|
| `slot-engine-core` | Pure availability + station assignment |
| Full test suite | Proposal example · duration-awareness · buffer · store hours · allocation rules · designation · property-based |
| Concurrency integration test | 50 parallel holds on the last slot → exactly 1 wins, against real Postgres |
| Availability + booking APIs | `/availability/slots`, `/bookings/hold`, hold expiry job |
| Capacity admin APIs | Stations, designation matrix, allocation rules + preview, hours, blackouts |

**Exit — and these are hard gates:**
- ✅ The proposal's 9:15 example passes as an executable test.
- ✅ 50 concurrent holds produce exactly one booking and zero overlapping rows.
- ✅ An allocation rule visibly changes availability, and its preview matches the real result. *(`admin-capacity.spec.ts` — the preview's `Premium 9-12: 2 → 0 ← ELIMINATED` matches what the live availability call then returns.)*

**Two bugs this phase caught that would have been expensive later:**

1. **`resolve()` read outside the hold transaction.** Every hold consumed two pooled connections instead of one, and the recompute could not see the stale-hold sweep it had just performed. Under 50-way concurrency the pool exhausted and *every* attempt timed out — nobody booked anything. Found by the concurrency test, not by review.
2. **esbuild silently breaks NestJS DI.** Running the API under `tsx` produced a server that booted cleanly, mapped every route, and had `undefined` for every injected service, because esbuild does not emit `design:paramtypes` and Nest treats missing metadata as "no dependencies". Noted in the README; the app compiles with tsc, the tests with SWC.

### Phase 2 — Booking end-to-end

| Deliverable | Detail | Status |
|---|---|---|
| Razorpay integration | Order create · hosted checkout · signed webhook · idempotency · refunds | ✅ backend |
| Reconciliation job | Catches captured-payment-without-confirmed-booking | ✅ |
| QR check-in | Token issue, signed payload, single-use redemption, admin scanner | ✅ backend |
| Customer web app | Home → category → service + add-ons → slots → checkout → confirmation → history | ⬜ |
| Admin bookings | List, station timeline, walk-in creation, status transitions | ✅ backend |
| Notifications | FCM confirmation + T-60 / T-10 reminders | ✅ backend |

**Exit:** a real ₹1 payment produces a confirmed booking, a QR, a successful counter scan,
and a correctly blocked station on the timeline.

**Backend complete; the gate is not yet met**, and deliberately so — it needs the client's
Razorpay account for a real ₹1 transaction, and a UI to take it in. Until then the module runs
in **simulated mode**: orders and payment ids are fabricated locally and signed with a
development secret, so hold → order → capture → confirm → QR → scan is fully exercisable
(`payment-rewards.spec.ts`, 30 tests). Simulated mode refuses to start in production.

**One bug this phase caught:** the reward wallet was originally consumed at payment. Two
checkouts open in two tabs would each have shown the same single-use reward as applied, and
only one would have been charged the discounted price. Reservation moved to hold time, behind
a conditional UPDATE, with release on expiry and cancellation.

### Phase 3 — Android app

| Deliverable | Detail |
|---|---|
| Flutter app | Full parity with web. Dart API client and `ErrorCode` enum generated from the OpenAPI spec; all price/duration math server-side. |
| Push notifications | FCM registration and deep links |
| Offline QR cache | Check-in works with no signal (Hive-backed) |
| Play Store | Internal testing track, store listing, privacy policy, data-safety form, account deletion flow |

**Exit:** app installable from the internal track and able to complete a real booking.

> **Phase 3 is the longest phase**, because Flutter shares no code with the three TypeScript
> surfaces — the app is a full second implementation of the customer UI rather than a
> re-skin. Budget accordingly. The mitigations are codegen (Dart client + tokens + error
> codes emitted from the same sources as the web) and keeping all pricing and availability
> math server-side, so the app has UI to build but no business rules to duplicate.

### Phase 4 — Retention

| Deliverable | Detail | Status |
|---|---|---|
| Streaks | Rules config, accrual on check-in only, UI ring, milestone rewards | ✅ backend |
| Scratch cards | Campaigns, weighted server-side draw with stock caps, reveal animation | ✅ backend |
| Reward wallet | Ledger, checkout application, single-use guarantee | ✅ backend |
| Cancellation & reschedule | Policy window, refund rules | ✅ |
| Reports | Revenue, utilisation, no-show, new vs repeat, CSV export | ✅ backend |

Built ahead of its phase because it shares the payment and check-in transactions — retrofitting
reward application into a shipped checkout would have meant reopening the money path.

The single-use guarantee ended up as a conditional UPDATE rather than the `FOR UPDATE` the plan
called for: same guarantee, one statement, and no read beforehand that can go stale.

**One bug this phase caught:** cashback was unredeemable. The applicability check reported it
as blocked ("paid back after your visit, not at checkout"), and since a reward can only be
attached to a booking *through* that same check, the reward type could never be used at all.
It is now selectable with a zero checkout discount and a separately-reported
`postVisitCreditPaise`, credited on check-in.

### Phase 4b — Hardening

Not in the original plan. These are the gaps that stood between "the backend works" and "the
backend can be deployed", found by auditing the built surface against the spec.

| Deliverable | Detail |
|---|---|
| Real SMS | MSG91 (DLT templates) and Twilio adapters; the process refuses to start in production with neither |
| Data retention | DPDP purge job — anonymises accounts 30 days after deletion, keeps their bookings as financial records |
| Redis rate limiting | Shared across replicas, fails open to per-process counters |
| `Idempotency-Key` | Interceptor over the previously-unused table; covers order, product order, refund |
| Reschedule | In place, engine-backed, payment and QR preserved |
| Notification channels | SMS / WhatsApp as push fallbacks, email as an additive receipt |
| Cashback payout | Credited on check-in, not on payment |
| Image renditions | thumb / card / hero WebP, derived on upload |
| Blocked-customer enforcement | At booking, closing the ≤15-minute window a live access token left open |

**One bug this phase caught, and it was a boot failure:** `RateLimitGuard` gained a
`RedisService` dependency while Redis was provided only in `AppModule`. `AuthModule` is its own
module context, so the guard on `/auth/otp/request` could no longer be constructed — and Nest
reports that as a startup error, taking the whole API down rather than one route. Fixed with a
global `CommonModule`; anything a controller in another module reaches for now lives there.

### Phase 5 — Storefront & launch

| Deliverable | Detail |
|---|---|
| Products | Catalog, cart, pay, pickup-at-store, admin stock management — ✅ backend |
| Production deploy | VPS, Caddy/TLS, backups + a rehearsed restore, Sentry, uptime monitoring |
| Load & soak test | Simulated peak day against the engine |
| Play Store production | Review, release |
| Client training | Two sessions: daily counter operations, and capacity/pricing management |
| Handover | Runbook, credentials in the client's own accounts, admin user guide |

---

## Definition of done (every phase)

- [ ] TypeScript strict, zero `any` in the money or booking path
- [ ] Unit tests for logic, integration tests for anything touching the DB
- [ ] Endpoints documented in OpenAPI; the generated client regenerated
- [ ] Error states, loading states and empty states designed and implemented — not just the happy path
- [ ] Works on a 360 px viewport and a ₹10k Android device
- [ ] Accessibility pass: keyboard, labels, contrast
- [ ] Deployed to staging and accepted by the client

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| **Walk-in bookings not entered by staff** | Engine's picture of the store diverges from reality within a day; customers arrive to occupied stations | Walk-in creation is P0 in the admin panel, on the check-in screen where staff already are. Flagged as [Q4](10-open-questions.md#q4) — this is an operational commitment as much as a feature. |
| **Capacity is staff-bound, not station-bound** | 3 stations but 2 attendants on shift → the engine offers slots nobody can serve | [Q3](10-open-questions.md#q3) — must be answered before Phase 1 ends. The engine has a clean extension point for a second resource dimension; adding it later is a schema change. |
| Instant Glow has no pricing or durations | A whole category can't launch | Ships disabled; admin can't publish a service without a duration. [Q2](10-open-questions.md#q2). |
| `+1 / +2` on the menu means party-of-two booking | Changes the engine — two stations at the same time | [Q1](10-open-questions.md#q1), answer needed before Phase 1. |
| **Flutter app drifts from the web app** | Two implementations of the same UI diverge in copy, pricing display or states | Dart API client, `ErrorCode` enum and design tokens all generated from the same sources as the web; CI fails on a stale generated client. All price/duration math server-side so there is nothing to reimplement. |
| Payment webhook missed or delayed | Money taken, no booking | Reconciliation job + an alert that pages a human, not a weekly report |
| Play Store review friction on wellness/booking category | Launch slips | Terminology rules applied to the listing; account deletion and data-safety form prepared in Phase 3, not at submission |
| OTP cost/abuse | Bills and spam | Rate limits from day one; provider behind an interface so it can be swapped |
| Scope creep from "just one more admin toggle" | Timeline | Everything not in [doc 01 §5](01-product-requirements.md#5-feature-list) is a change request against the signed proposal |

---

## Client responsibilities (blocking if late)

| Item | Needed by |
|---|---|
| Razorpay account, KYC complete, live keys | Phase 2 |
| Google Play developer account | Phase 3 |
| Domain + DNS access | Phase 5 |
| VPS / hosting account | Phase 5 |
| Logo, brand assets, service photography | Phase 2 |
| Instant Glow pricing and durations | Phase 2 |
| Answers to [doc 10](10-open-questions.md) Q1–Q4 | **Phase 1** |
| Store address, hours, GST details for invoices | Phase 2 |
| Final legal copy: T&C, privacy policy, refund policy | Phase 5 |
