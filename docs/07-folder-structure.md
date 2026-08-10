# 07 — Folder Structure

pnpm workspaces + Turborepo for the TypeScript side; `apps/mobile` is a standalone Flutter
project living in the same repo but outside the pnpm workspace. Four applications, six shared
packages, one database schema.

```
ResetMen/
├── README.md
├── package.json                      # workspace root, turbo scripts
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── docker-compose.yml                # postgres · redis · minio (local dev)
├── .github/workflows/                # ci.yml · deploy-api.yml · build-android.yml
│
├── docs/                             # ← the documents you are reading
│
├── apps/
│   ├── api/                          # NestJS backend
│   ├── web/                          # Next.js customer web (PWA)
│   ├── admin/                        # Next.js admin panel
│   └── mobile/                       # Flutter Android app (outside the pnpm workspace)
│
├── packages/
│   ├── types/                        # Zod schemas + inferred TS types — the contract
│   ├── slot-engine-core/             # the pure availability engine
│   ├── api-client/                   # generated typed TS client + React Query hooks
│   ├── ui/                           # shared React components (web + admin)
│   ├── design-tokens/                # colours, type, spacing → CSS vars + TS + **Dart**
│   └── config/                       # eslint · tsconfig · tailwind presets
│
└── infra/
    ├── caddy/Caddyfile
    ├── docker/                       # production Dockerfiles
    └── scripts/                      # backup.sh · restore.sh · deploy.sh
```

---

## 1. `apps/api` — NestJS backend

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   │   └── 0002_station_overlap_constraint/migration.sql   # btree_gist EXCLUDE — hand-written
│   └── seed/
│       ├── index.ts
│       └── men-menu.ts               # the photographed MEN catalog
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── worker.ts                     # BullMQ entrypoint — same image, different command
│   │
│   ├── common/
│   │   ├── decorators/               # @CurrentUser @Roles @StoreId @Idempotent
│   │   ├── guards/                   # jwt-auth · admin-auth · roles · store-scope
│   │   ├── interceptors/             # logging · transform · idempotency
│   │   ├── filters/                  # problem+json exception filter
│   │   ├── pipes/                    # zod-validation.pipe
│   │   └── utils/                    # money.ts · time.ts · public-id.ts · interval.ts
│   │
│   ├── config/                       # env schema (zod) — process refuses to boot if invalid
│   ├── database/                     # prisma.service.ts · transaction.helper.ts
│   ├── redis/                        # redis.module · cache.service · lock.service
│   │
│   ├── modules/
│   │   ├── auth/                     # otp · jwt · providers/firebase-auth.provider.ts
│   │   ├── store/
│   │   ├── catalog/                  # segments · categories · services · addons
│   │   ├── capacity/                 # stations · station-services · allocation-rules
│   │   │                             #   · store-hours · blackouts · settings
│   │   │                             #   + allocation-rule-preview.service.ts
│   │   ├── availability/             # availability.service.ts — loads data, calls the engine
│   │   ├── booking/                  # hold · confirm · cancel · reschedule · walk-in
│   │   │                             #   + station-assignment.service.ts
│   │   ├── payment/                  # razorpay.provider · webhook.controller
│   │   │                             #   + reconciliation.service.ts
│   │   ├── checkin/                  # qr token issue + single-use redemption
│   │   ├── rewards/                  # streaks · scratch-cards · user-rewards ledger
│   │   ├── product/
│   │   ├── notification/             # fcm · sms · templates
│   │   ├── media/                    # r2 upload + sharp variants
│   │   ├── reporting/
│   │   ├── audit/
│   │   └── admin/                    # admin-facing controllers, thin — delegate to modules
│   │
│   └── jobs/
│       ├── expire-holds.job.ts               # every 30s
│       ├── booking-reminders.job.ts          # T-60 and T-10
│       ├── payment-reconciliation.job.ts     # every 15 min
│       ├── streak-window-rollover.job.ts     # nightly
│       ├── expire-scratch-cards.job.ts       # nightly
│       ├── mark-no-shows.job.ts              # every 15 min
│       └── daily-report.job.ts               # nightly
└── test/
    ├── integration/                  # supertest against real Postgres in Docker
    │   ├── booking-concurrency.spec.ts       # 50 parallel holds → exactly 1 wins
    │   ├── payment-webhook.spec.ts
    │   └── checkin.spec.ts
    └── fixtures/
```

**Module rule:** a module imports another module's **service**, never its repository or
Prisma models. An ESLint import-boundary rule enforces it in CI, so the boundaries don't
erode over six months of feature work.

---

## 2. `packages/slot-engine-core` — the pure engine

Its own package, zero dependencies on NestJS, Prisma, Redis or the clock. Pure functions in,
pure data out. This is what makes it exhaustively testable and portable.

```
packages/slot-engine-core/
├── src/
│   ├── index.ts
│   ├── types.ts                      # AvailabilityInput · Slot · ResolvedRule · Interval
│   ├── interval.ts                   # subtract · merge · overlaps · contains
│   ├── open-windows.ts               # store hours + blackouts → open intervals
│   ├── station-eligibility.ts        # static designation + allocation-rule evaluation
│   ├── candidate-times.ts            # grid ∪ station free-from moments
│   ├── compute-availability.ts       # the main entry point
│   └── assign-station.ts             # purpose → best-fit → specialised → sortOrder
└── test/
    ├── proposal-example.spec.ts      # asserts 9:15, from doc 05 §4
    ├── duration-awareness.spec.ts    # 20-min gap: Head yes, Full Body no
    ├── allocation-rules.spec.ts      # ₹199 morning push + 11:50 spillover
    ├── station-designation.spec.ts   # corner chair
    ├── buffer.spec.ts
    ├── store-hours.spec.ts           # split hours, buffer past closing
    └── properties.spec.ts            # fast-check — invariants over random schedules
```

---

## 3. `packages/types` — the contract

One Zod schema per concept, used to validate the request on the server **and** the form on
the client. A field can't drift between the two because there's only one definition.

```
packages/types/src/
├── common.ts          # Paise, Instant, LocalDate, Cursor, ProblemDetail
├── auth.ts            # OtpRequest · OtpVerify · User · AdminUser · Role
├── catalog.ts         # Segment · Category · Service · AddonGroup · AddonOption
├── capacity.ts        # Station · AllocationRule · Blackout · StoreHours · StoreSettings
├── availability.ts    # AvailabilityQuery · Slot
├── booking.ts         # HoldRequest · Booking · BookingStatus · Pricing
├── payment.ts
├── rewards.ts         # Streak · ScratchCard · UserReward
├── product.ts
├── reports.ts
└── errors.ts          # the ErrorCode union — clients switch on this
```

---

## 4. `apps/web` — customer web (Next.js)

```
apps/web/src/
├── app/
│   ├── layout.tsx · page.tsx                       # home
│   ├── s/[segment]/page.tsx                        # categories
│   ├── s/[segment]/[category]/page.tsx             # services
│   ├── service/[slug]/page.tsx                     # detail + add-ons
│   ├── book/[serviceId]/page.tsx                   # date + slot picker
│   ├── checkout/[bookingId]/page.tsx
│   ├── confirmed/[bookingId]/page.tsx              # QR
│   ├── bookings/page.tsx · bookings/[id]/page.tsx
│   ├── rewards/page.tsx                            # streak + scratch cards + wallet
│   ├── shop/ · profile/ · auth/
│   └── api/og/                                     # social share images
├── components/
│   ├── booking/     ServiceCard · AddonSelector · DateStrip · SlotGrid · PriceSummary
│   ├── rewards/     StreakRing · ScratchCard · RewardChip
│   └── layout/      Header · BottomNav · StoreBanner
├── hooks/           useAvailability · useHoldBooking · useRazorpay
└── lib/             analytics · pwa · seo
```

---

## 5. `apps/admin` — admin panel (Next.js)

```
apps/admin/src/
├── app/
│   ├── (auth)/login/
│   └── (dashboard)/
│       ├── page.tsx                    # today at a glance
│       ├── checkin/                    # ← full-screen tablet QR scanner
│       ├── bookings/
│       │   ├── page.tsx                # list
│       │   ├── timeline/               # ← station-wise day timeline
│       │   └── walk-in/                # counter booking
│       ├── catalog/segments · categories · services · addon-groups
│       ├── capacity/
│       │   ├── stations/               # incl. per-station service designation
│       │   ├── allocation-rules/       # incl. the preview dry-run
│       │   ├── hours/ · blackouts/
│       ├── rewards/streaks · scratch-cards
│       ├── products/ · customers/ · reports/ · staff/ · audit/ · settings/
├── components/
│   ├── timeline/    StationTimeline · BookingBlock · NowIndicator
│   ├── scanner/     QrScanner · ManualCodeEntry · CheckinResultCard
│   └── forms/       AllocationRuleForm · ServiceForm · StationServiceMatrix
└── lib/
```

---

## 6. `apps/mobile` — Android app (Flutter)

A standard Flutter project, feature-first rather than layer-first so each feature owns its
screens, widgets and controllers.

```
apps/mobile/
├── pubspec.yaml
├── analysis_options.yaml               # very_good_analysis lints
├── build.yaml                          # freezed / json_serializable / retrofit codegen
├── openapi-generator-config.yaml       # ← Dart client generated from the API's OpenAPI spec
├── android/ · ios/                     # ios/ present but unpublished
└── lib/
    ├── main.dart
    ├── app.dart                        # MaterialApp.router + theme
    ├── core/
    │   ├── theme/                      # reset_tokens.dart (generated) · app_theme.dart
    │   ├── router/                     # go_router — routes mirror the web 1:1
    │   ├── network/                    # dio client · auth interceptor · problem+json mapper
    │   ├── storage/                    # secure_storage (tokens) · hive (offline QR cache)
    │   ├── error/                      # ErrorCode enum (generated) → user-facing copy
    │   └── utils/                      # money.dart · date_time.dart
    ├── api/
    │   └── generated/                  # ← openapi-generator output. Never hand-edited.
    ├── features/
    │   ├── auth/                       # otp_request · otp_verify · profile_setup
    │   ├── home/                       # segments · categories · streak card
    │   ├── catalog/                    # service_list · service_detail · addon_selector
    │   ├── booking/
    │   │   ├── presentation/           # date_strip · slot_grid · slot_chip · hold_timer
    │   │   ├── controller/             # riverpod notifiers
    │   │   └── data/                   # repository over the generated client
    │   ├── checkout/                   # razorpay_flutter integration
    │   ├── confirmation/               # qr_flutter ticket + offline cache
    │   ├── bookings/                   # order history, receipts, cancel, rebook
    │   ├── rewards/                    # streak ring · scratch card canvas · wallet
    │   ├── shop/                       # products (P2)
    │   └── profile/
    └── shared/widgets/                 # buttons · chips · skeletons · empty/error states
└── test/                               # unit + widget
└── integration_test/                   # end-to-end booking smoke
```

**Two rules that keep Dart and TypeScript honest:**

1. `lib/api/generated/` is written by `openapi-generator` and never hand-edited. CI regenerates it and fails on a diff, so a backend contract change can't silently rot the app.
2. **No price or duration arithmetic in Dart.** Totals come from `POST /bookings/quote`; slot lists and durations come from `GET /availability/slots`. The app renders server-computed values. This is the single discipline that prevents the app and the web showing different totals for the same basket.

Routes mirror the web deliberately: a deep link, a QR poster URL and a push payload all
resolve to the same path on both surfaces.

---

## 7. Local development

```bash
pnpm install
docker compose up -d              # postgres · redis · minio
pnpm db:migrate && pnpm db:seed   # loads the MEN menu
pnpm dev                          # api :4000 · web :3000 · admin :3001

cd apps/mobile                    # Flutter, separate toolchain
flutter pub get
dart run build_runner build       # freezed · json_serializable · retrofit
flutter run                       # against http://10.0.2.2:4000 on the emulator
```

| Script | Does |
|---|---|
| `pnpm dev` | All web services in parallel via Turbo |
| `pnpm db:seed` | Full browsable store: 3 stations, 3 categories, priced services, add-ons |
| `pnpm test` | Unit + engine tests |
| `pnpm test:integration` | Boots Postgres in Docker, runs the concurrency suite |
| `pnpm gen:api` | Regenerates **both** clients from the OpenAPI spec — `packages/api-client` (TS) and `apps/mobile/lib/api/generated` (Dart) |
| `pnpm gen:tokens` | Regenerates design tokens to CSS vars, TS and `reset_tokens.dart` |
| `pnpm simulate` | Replays a synthetic booking day against the engine — useful for tuning buffer and station count before opening |
