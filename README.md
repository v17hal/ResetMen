# RESET — Booking Platform

> RESET represents a fresh start for the mind and body. Our mission is to help people reset
> from daily stress, fatigue, and mental exhaustion through professional wellness, dry
> massage, relaxation, and grooming services — enabling them to feel refreshed,
> re-energized, and confident.

A slot-and-station booking platform for a physical RESET outlet: customer books a time
slot, pays online, walks in, gets scanned in via QR, earns streaks and scratch-card rewards.

**Deliverables:** Android app · Responsive web app · Admin control panel — one backend, one database.

---

## Documentation index

| # | Document | What it covers |
|---|---|---|
| 01 | [Product Requirements](docs/01-product-requirements.md) | Brand & terminology rules, personas, catalog model, complete feature list with priorities, NFRs, out-of-scope |
| 02 | [Platforms & Tech Stack](docs/02-platforms-and-stack.md) | Target platforms, chosen stack with rationale, third-party services, cost ownership |
| 03 | [Technical Architecture](docs/03-architecture.md) | System diagram, module boundaries, request flows, scaling stages, security, observability |
| 04 | [Data Model](docs/04-data-model.md) | ERD, every table, constraints, indexes, seed catalog |
| 05 | [Slot & Station Engine](docs/05-slot-station-engine.md) | The core availability algorithm, allocation rules, concurrency safety, worked examples |
| 06 | [API Specification](docs/06-api-specification.md) | Every endpoint across customer / admin / webhook surfaces |
| 07 | [Folder Structure](docs/07-folder-structure.md) | Monorepo skeleton for backend, web, admin, mobile, shared packages |
| 08 | [UI/UX Design](docs/08-ui-ux-design.md) | Design tokens, component inventory, screen-by-screen wireframes, states |
| 09 | [Delivery Plan](docs/09-delivery-plan.md) | Milestones, sequencing, definition of done per phase |
| 10 | [Open Questions](docs/10-open-questions.md) | Decisions needed from the client before/during build |
| 11 | [**Scope changes, Aug 2026**](docs/11-scope-changes.md) | No payments, no SMS, Google sign-in. **Read this before 01–10** — where they disagree, 11 is what the code does |

## Reading order

- **Client / business review** → 01, 08, 09, 10
- **Engineering kickoff** → 02, 03, 04, 05, 06, 07
- **The single most important document** → [05 — Slot & Station Engine](docs/05-slot-station-engine.md). Everything else is standard CRUD; this is where the product lives or dies.

## Status

| Stage | State |
|---|---|
| Requirements captured | ✅ Done |
| Planning documents | ✅ Done — awaiting client sign-off |
| Monorepo scaffold | ✅ Done |
| **Slot & station engine** | ✅ Done — 63 tests green, incl. ~1,100 property-based runs |
| **Database schema + no-double-booking constraint** | ✅ Done — applied and verified against real Postgres |
| Seed data (MEN menu) | ✅ Done |
| Design tokens → CSS + TS + Dart | ✅ Done |
| `@reset/types` — shared Zod contract | ✅ Done |
| **API: catalog · availability · booking (full lifecycle)** | ✅ Done |
| **API: auth — Google via Firebase, JWT, admin login, RBAC** | ✅ Done — phone/OTP removed Aug 2026, see [doc 11](docs/11-scope-changes.md) |
| **API: admin capacity — designation, allocation rules + preview** | ✅ Done |
| **API: QR check-in, walk-ins, station timeline** | ✅ Done |
| **API: payments — Razorpay orders, signed webhook, refunds, reconciliation** | ✅ Built and tested, but **switched off** (`PAYMENTS_ENABLED=false`) — the store takes money at the counter |
| **API: rewards — wallet, streaks, scratch cards with stock caps** | ✅ Done |
| **API: notifications — FCM, device tokens, T-60 / T-10 reminders** | ✅ Done — logs instead of sending until Firebase is configured |
| **API: storefront — products, orders, stock** | ✅ Done |
| **API: admin — catalog CRUD, customers, staff, reports, CSV, audit log** | ✅ Done |
| **API: media upload** | ✅ Done — local disk behind an object-storage-shaped interface, WebP renditions |
| **SMS / WhatsApp / email delivery** | ✅ Adapters built; **no SMS account**, so these log instead of sending. Push is the live channel |
| **DPDP data retention** | ✅ Done — accounts anonymised 30 days after deletion, bookings preserved |
| **Idempotency-Key + Redis rate limiting** | ✅ Done |
| **Scheduled jobs** | ✅ Done — 15 jobs |
| `@reset/api-client` — typed client, single-flight refresh | ✅ Done |
| `@reset/ui` — primitives, formatting, motion, Tailwind preset | ✅ Done |
| **Admin panel** — 14 routes | ✅ Done — production build clean |
| **Customer web app** — 10 routes | ✅ Done — production build clean |
| **Flutter app** — 9 screens, offline QR cache | ✅ Done — analyze clean, release APK builds |
| **CI** — typecheck, tests, both Next builds, integration on real Postgres, Flutter | ✅ Done |
| **Infra** — Caddy/TLS, prod compose, nightly backups, restore rehearsal | ✅ Done |
| **Tests** | ✅ 229 — 63 engine · 31 API unit · **78 integration** · 24 client · 20 ui · 13 Flutter |
| Push notifications in the app | ⏳ Blocked — needs the client's Firebase project |
| Play Store submission | ⏳ Blocked — needs the client's Play Console |
| Load / soak test | ⏳ Phase 4 gate |

**Phase 1 exit gate — met.** 50 simultaneous holds on the last remaining slot produce
exactly one booking, 49 clean `409`s, and zero overlapping rows.

**Decisions taken so far** are logged in [docs/10 — Decisions log](docs/10-open-questions.md#decisions-log):
Flutter for Android · stations-only capacity · engine-first build order.

## Quick start

```bash
pnpm install
docker compose up -d              # postgres · redis · minio
cp .env.example apps/api/.env     # DATABASE_URL is all the API needs today
pnpm --filter @reset/api exec prisma migrate deploy
pnpm db:seed                      # loads the photographed MEN menu
pnpm test                         # 145 unit tests across the workspace
pnpm --filter @reset/api dev      # API on :4000, Swagger at /docs
```

Then whichever surface you are working on:

```bash
cp apps/web/.env.example apps/web/.env.local        # NEXT_PUBLIC_API_URL
cp apps/admin/.env.example apps/admin/.env.local

pnpm --filter @reset/web dev      # customer app on :3000
pnpm --filter @reset/admin dev    # admin panel on :3001

# The Flutter app. 10.0.2.2 is the emulator's route to the host — localhost is the
# emulator itself, which is the first thing everyone gets wrong.
cd apps/mobile && flutter run --dart-define=API_URL=http://10.0.2.2:4000
```

Deployment — one VPS, five containers behind Caddy — is in [infra/README.md](infra/README.md),
including the restore rehearsal that should be run before launch and quarterly after.

**Third-party integrations degrade to logging**, so every path is demonstrable today:

| Unconfigured | Behaviour | Production |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Sign-in fails | **Refuses to start** |
| `RAZORPAY_*` | Irrelevant while `PAYMENTS_ENABLED=false` | Refuses to start **only if** payments are on |
| SMS (`MSG91_*` / `TWILIO_*`) | SMS logged, not sent | Degrades — push is the live channel |
| `FCM_SERVICE_ACCOUNT_JSON` | Push logged | Degrades |
| `EMAIL_API_KEY` | Email logged | Degrades |
| `REDIS_URL` | Rate limits per-process | Degrades |

Only one refuses to boot, and it is the one where pretending is dangerous: an API that
looks healthy while nobody can sign in is worse than one that will not start. See
[doc 11](docs/11-scope-changes.md) for why the payment and SMS guards moved.

Verify the core guarantee for yourself — an overlapping booking is rejected by the database,
not by application code:

```bash
docker exec -i reset-postgres psql -U reset -d reset < apps/api/prisma/verify-constraint.sql
pnpm --filter @reset/api test:integration     # 73 tests against real Postgres
```

That suite covers the three other races where somebody loses something real: one reward
across two checkouts, one scratch prize across ten cards, and one tub of balm across five
carts. Each resolves to exactly one winner, and each is enforced by a conditional `UPDATE`
rather than by a read-then-write in application code.

Create a staff login (never seeded — a default admin password follows a project into
production and gets forgotten):

```bash
pnpm --filter @reset/api exec tsx prisma/seed/create-admin.ts owner@reset.app 'your-password' OWNER
```

### Two NestJS DI traps this project already hit

Both produce the same failure mode — the app boots, maps every route, logs nothing unusual,
and every injected dependency is `undefined`. Nest reads missing `design:paramtypes` metadata
as *"this class has no dependencies"* rather than as an error.

1. **Never run `apps/api` through tsx, esbuild-register, or any esbuild-based runner.** esbuild does not emit decorator metadata. Use `nest start` / `nest build` (tsc) for the app and SWC for tests; both are configured.
2. **Every `@Injectable()` needs its own explicit constructor.** A subclass that inherits its constructor from a base class gets no metadata emitted for it. Guards in particular are easy to write this way.

There is a third trap, with a different symptom — the app does not boot at all:

3. **Anything a controller in another module reaches for belongs in `CommonModule`, not `AppModule`.** `AuthModule` and `DatabaseModule` are their own (global) module contexts. When `RateLimitGuard` gained a `RedisService` dependency that lived only in `AppModule`, the guard on `/auth/otp/request` could no longer be constructed, and Nest reported it as a startup failure rather than a route-level one.

## Current source inputs

1. `massage-booking-app-proposal.md.pdf` — the signed proposal (scope, flow, bed engine, admin capabilities)
2. WhatsApp — 01/08/2026: terminology constraint + mission statement
3. WhatsApp — 02/08/2026: station reservation by service + time slot; station-to-service designation
4. Handwritten menu photos (MEN) — 3 categories, service list, pricing, durations, add-on structure
