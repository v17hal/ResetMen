# 02 — Platforms & Technology Stack

## 1. Target platforms

| # | Platform | Audience | Delivery |
|---|---|---|---|
| 1 | **Android app** | Customers | Google Play, min SDK 24 (Android 7+) — covers ~99% of Indian devices |
| 2 | **Responsive web app** | Customers | Mobile-first PWA; identical feature set to the app; the acquisition surface (ads, QR posters, Google) |
| 3 | **Admin panel** | Owner, manager, counter staff | Web, desktop-first but must be fully usable on a counter tablet for QR scanning |
| 4 | *iOS app* | Customers | **Not in this phase.** Stack chosen so it's a build-and-publish step, not a rewrite. |

All four share **one backend and one database** — a booking made on web appears on the app
and admin panel instantly.

---

## 2. Stack decisions

Each decision below states the choice, the reason, and the runner-up it beat.

### 2.1 Backend — **NestJS (TypeScript) on Node 22**

- Same language as web, admin and mobile → one shared types package, one API client, one team.
- NestJS gives module boundaries, DI and validation pipes out of the box — this matters because the plan is a *modular monolith* that can be split later (see [doc 03](03-architecture.md)).
- Runner-up: Django/DRF (excellent admin scaffolding, but a second language and a weaker story for sharing types with the two Next.js front-ends).

### 2.2 Database — **PostgreSQL 16**

Not negotiable, and the reason is specific: Postgres `btree_gist` exclusion constraints let
the database itself guarantee that no station is ever double-booked:

```sql
EXCLUDE USING gist (
  station_id WITH =,
  tstzrange(starts_at, blocked_until, '[)') WITH &&
) WHERE (status IN ('HELD','CONFIRMED','CHECKED_IN','IN_PROGRESS'))
```

Every competing approach (MySQL, MongoDB, application-level mutexes) puts the correctness of
the product's single most important guarantee into application code, where a race, a retry,
or a future refactor can break it silently. Here, a double-booking is *physically impossible*
— the insert fails.

Also used: `timestamptz` throughout, `JSONB` for flexible config blobs, partial indexes,
`SELECT … FOR UPDATE` on reward redemption.

### 2.3 ORM — **Prisma 6**

Type-safe client generated from a single schema, shared with the whole TS codebase. The
exclusion constraint and a few GiST indexes ship as **raw SQL inside Prisma migrations** —
supported and version-controlled, just not expressible in the Prisma DSL.

### 2.4 Cache, queues, locks — **Redis 7 + BullMQ**

- Scheduled and retryable jobs: hold expiry, T-60/T-10 reminders, streak rollover, scratch-card expiry, nightly reports, payment reconciliation.
- Response caching for the catalog (invalidated on admin write).
- Rate limiting for OTP and booking endpoints.

### 2.5 Customer web — **Next.js 15 (App Router) + React 19 + TypeScript**

Server components give fast first paint and real SEO on category/service pages — the web app
is the top of the acquisition funnel, so indexability is a feature, not a nicety. Installable
as a PWA.

### 2.6 Admin panel — **Next.js 15, separate app in the same monorepo**

Shares the design system and API client with the customer web app. `noindex`, separate auth
realm, separate deployment. Desktop-first layout with a dedicated tablet-optimised
check-in screen.

### 2.7 Mobile — **Flutter 3.x (Dart), Android first, iOS-ready**

*Client decision.* Flutter gives the best UI fidelity and animation performance of the
options — the scratch-card reveal and streak ring will feel better here than in a JS bridge —
and a single codebase covers iOS the day the client wants it.

Because Dart doesn't share code with the TypeScript surfaces, the contract is kept honest by
**code generation instead of imports**:

| Concern | How the contract is preserved |
|---|---|
| API models & client | `openapi-generator` emits a Dart client from the backend's OpenAPI 3.1 spec into `apps/mobile/lib/api/generated/`. Regenerated in CI — a backend change that breaks the app fails the build, it doesn't fail in production. |
| Error codes | The `ErrorCode` union is emitted as a Dart enum from the same spec. |
| Design tokens | `packages/design-tokens` exports a Dart file alongside its TS/CSS output, so colours and spacing can't drift between app and web. |
| Business rules | Duration and price arithmetic stays **server-side** (`POST /bookings/quote`, `GET /availability/slots`). The app renders what the API computes rather than reimplementing it — this is what stops Dart and TypeScript disagreeing about a total. |

That last row is the important one. With a shared-TS stack you can afford client-side price
math; with two languages you cannot, so the API is designed to never require it.

**Key packages:** `flutter_riverpod` (state) · `go_router` (routing, deep links mirroring the
web routes) · `dio` + `retrofit` (HTTP) · `freezed` + `json_serializable` (models) ·
`razorpay_flutter` · `firebase_messaging` + `firebase_auth` · `qr_flutter` (display) ·
`flutter_secure_storage` · `intl`.

**Trade-off accepted:** roughly one extra phase of work versus a shared-TypeScript app, and
no over-the-air updates — every fix ships through Play review. Budgeted for in
[doc 09](09-delivery-plan.md).

### 2.8 Styling & UI — **Tailwind CSS + shadcn/ui (web & admin), Flutter Material 3 theme (mobile)**

Design tokens are defined once in `packages/design-tokens` and exported to **three** targets —
CSS custom properties, a TS object, and a Dart `ResetTokens` class — so brand colours,
spacing and radii stay identical across app and web.

### 2.9 Monorepo — **pnpm workspaces + Turborepo**

Shared packages (`types`, `api-client`, `ui`, `design-tokens`, `slot-engine-core`) with
cached builds and one `pnpm dev` to run everything.

---

## 3. Third-party services

| Concern | Choice | Why | Cost owner |
|---|---|---|---|
| **Payments** | **Razorpay** | Best Indian coverage (UPI, cards, netbanking, wallets), hosted checkout so no PCI scope, clean webhooks, instant refunds API. Runner-up: Cashfree. | Client (per-txn) |
| **Phone OTP auth** | **Firebase Phone Auth** at launch, behind an `AuthProvider` interface | Fastest to ship, free tier covers launch volume. The interface means swapping to MSG91/Twilio later is one adapter file. | Client above free tier |
| **Push notifications** | **Firebase Cloud Messaging** | Free, works for Android + web push + future iOS | Free |
| **SMS / WhatsApp** | **MSG91** (optional, P2) | Booking confirmations for customers who don't install the app | Client |
| **Object storage + CDN** | **Cloudflare R2 + Cloudflare CDN** | Zero egress fees, S3-compatible so AWS S3 is a drop-in swap | Client |
| **Error tracking** | **Sentry** | Backend + web + Flutter from one project | Free tier |
| **Uptime monitoring** | **BetterStack / UptimeRobot** | Alerts on booking-endpoint downtime | Free tier |
| **Transactional email** | **Resend** (optional) | Receipts, admin password resets | Free tier |
| **Analytics** | **PostHog** (self-host or cloud) | Funnel: view service → pick slot → pay → check in. This funnel is how pricing decisions get made. | Free tier |

### 3.1 Client-borne costs (proposal §7)

Google Play developer membership · Apple Developer Program (if iOS is added) · VPS/server
hosting · domain registration and renewal · payment gateway fees · SMS/push gateway charges.
We assist with setup and deployment on the client's own accounts; subscriptions and renewals
remain the client's responsibility.

**All third-party accounts are created in the client's name from day one.** Never ours,
never migrated later — migrating a live payment gateway account is painful and avoidable.

---

## 4. Environments

| Environment | Purpose | Data | Payments |
|---|---|---|---|
| `local` | Developer machines | Docker Compose: Postgres + Redis + MinIO, seeded catalog | Razorpay test keys |
| `staging` | Client UAT, app internal testing track | Anonymised copy of prod | Razorpay test keys |
| `production` | Live | Real | Razorpay live keys |

Secrets live in the platform's secret store, never in the repo. `.env.example` is committed;
`.env` never is.

---

## 5. Deployment topology

### Launch (single outlet, low traffic)

One VPS (4 vCPU / 8 GB, e.g. Hetzner or DigitalOcean Bangalore) running Docker Compose:

```
Caddy (TLS, reverse proxy)
├── api        (NestJS)
├── worker     (BullMQ jobs — same image, different entrypoint)
├── web        (Next.js customer)
├── admin      (Next.js admin)
├── postgres   (+ nightly pg_dump → R2, 30-day retention)
└── redis
```

Mobile app distributed via Google Play. Static assets and images via Cloudflare.

### Scale path

Deliberately boring, and none of it is a rewrite — see [doc 03 §6](03-architecture.md#6-scaling-plan).

1. Move Postgres to a managed instance with PITR.
2. Move `web` and `admin` to Vercel/Cloudflare Pages; keep `api` on the VPS.
3. Run 2+ `api` replicas behind the proxy (the app is already stateless).
4. Add a Postgres read replica for reports.

---

## 6. Engineering standards

| Concern | Standard |
|---|---|
| Language | TypeScript strict mode everywhere, `noUncheckedIndexedAccess` on |
| Validation | Zod schemas in `packages/types`, shared by API and all clients |
| Lint / format | ESLint + Prettier, enforced in CI |
| Testing | Vitest (unit) · Supertest (API integration against a real Postgres in Docker) · Playwright (web + admin E2E) · `flutter test` + `integration_test` (Android) |
| Non-negotiable test coverage | The slot & station engine ships with an exhaustive property-based and worked-example suite. Everything else is best-effort; this is not. |
| CI | GitHub Actions: lint → typecheck → unit → integration → build. Migrations run as a separate, reviewed deploy step. |
| Git | Trunk-based, short-lived branches, conventional commits, squash merge |
| API contract | OpenAPI 3.1 generated from NestJS decorators; **both** the TypeScript client (`packages/api-client`) and the Dart client (`apps/mobile/lib/api/generated`) are generated from it, in CI |
