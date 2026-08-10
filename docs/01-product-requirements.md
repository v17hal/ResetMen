# 01 — Product Requirements

## 1. Product in one paragraph

RESET is a single-outlet (multi-outlet-ready) booking platform for short, walk-in wellness
sessions. A customer picks a service, sees only the time slots that are genuinely free,
pays online, receives a QR code, walks into the store at the reserved time, gets scanned in
at the counter, and earns streaks and scratch-card rewards that pull them back. The store
owner runs the whole catalog, pricing, capacity and reward economics from a web admin
panel with no code changes.

The system's defining constraint: **the store has a fixed number of physical stations, every
service has a different duration, and no two customers may ever occupy the same station at
overlapping times.**

---

## 2. Brand & terminology rules (hard constraint)

> Client, 01/08/2026: *"avoid spa, therapy, massage wording as our business focusing more on dry massage"*

This is not a cosmetic preference — it governs app copy, marketing text, and, critically, the
Google Play / App Store listing metadata.

### 2.1 Word substitution table

| ❌ Avoid in product chrome | ✅ Use instead |
|---|---|
| Spa | Studio, Outlet, RESET |
| Therapy / Therapist | Session / Attendant / Specialist |
| Massage (as a category or brand noun) | Reset, Relax, Stress Relief, Dry Relaxation |
| Massage bed / Table | **Station** (internal), never shown to customers |
| Treatment | Service, Session |
| Appointment | Booking, Slot |
| Client / Patient | Customer, Guest |

### 2.2 Scope of the rule

| Surface | Rule |
|---|---|
| App / web UI chrome, nav, buttons, empty states | Strictly enforced. Zero occurrences. |
| Play Store title, short & long description, keywords | Strictly enforced. See §2.3. |
| Category names | Client-authored, already compliant: *Stress Relief*, *Full Body Relax*, *Instant Glow* |
| Service names | Admin-controlled free text. If the owner types "Head Massage" it renders as typed — the system does not censor owner content. |
| Internal code, DB columns, docs | Unconstrained, but this repo uses `station` not `bed` for consistency. |

### 2.3 Store-listing note — worth flagging early

App stores apply extra review scrutiny to listings that pair "massage" with in-person
booking. Positioning the listing as **self-care / wellness / grooming session booking**
reduces review friction and matches the client's stated intent. Suggested Play Store
one-liner: *"RESET — book a 10-minute stress reset. Walk in refreshed."*

### 2.4 The word "station"

Customers **never** see station/bed language at all. The engine assigns a station silently
(proposal §4.3, "auto bed assignment"). The customer only ever sees a **time**.

---

## 3. Personas

| Persona | Who | Primary need | Where |
|---|---|---|---|
| **Guest** | First-time visitor, walking past the store or clicked an ad | Understand what a ₹49 / 10-min session is, and book it in under 60 seconds | Web (mobile browser), App |
| **Regular** | Visits 2–6×/month, often same service | Rebook in 2 taps, keep the streak alive, spend rewards | App |
| **Counter Staff** | At the desk during store hours | Scan QR, mark check-in, take a walk-in booking, see who's next | Admin (tablet/phone) |
| **Manager** | Runs the outlet day-to-day | Adjust capacity, push a service during a dead hour, block a station, see today's revenue | Admin (desktop) |
| **Owner** | Business owner, possibly multiple outlets later | Pricing, reward economics, reports | Admin (desktop) |

---

## 4. Catalog model

The handwritten menu drives a four-level dynamic catalog. Nothing below is hardcoded.

```
Segment          →  Category          →  Service                        →  Add-on Group  →  Add-on Option
(Men / Women)       (Stress Relief)      (Head Massage, ₹49, 10 min)       (Oil Choice)     (Almond, +₹30)
```

### 4.1 Why a Segment level

The menu photo is headed **MEN**. A women's menu with different services and pricing is the
obvious next step, and retrofitting a top-level split later means touching every catalog
query, every screen and every report. Segment is a first-class dynamic entity from day one;
if the client only launches MEN, the segment picker simply doesn't render when there's one
active segment.

### 4.2 Add-on groups

Add-on groups are **reusable and attached to many services** — the menu literally says
"same" against the second and third Stress Relief services. So the relationship is
many-to-many, not a per-service list.

Each group carries selection rules:

| Field | Purpose | Example |
|---|---|---|
| `min_select` / `max_select` | Optional single-pick, required single-pick, or multi-pick | Oil Choice: 0–1 |
| `price_delta` per option | Added to service price | Almond `+₹30` |
| `duration_delta` per option | Added to session duration (default 0) — feeds the engine | Usually `0` |

`duration_delta` matters: if a future add-on genuinely lengthens the session, the slot engine
must reserve the longer window. Modelling it now costs nothing; adding it later means a
migration plus an engine change.

### 4.3 Seed catalog — MEN (from the menu photos)

**Category: Stress Relief**

| Service | Price | Duration | Add-on group |
|---|---|---|---|
| Head Massage | ₹49 | 10 min | Oil Choice |
| Head + Neck + Shoulder | ₹99 | 15 min | Oil Choice |
| Head + Neck + Shoulder + Back | ₹149 | 20 min | Oil Choice |

**Add-on group: Oil Choice** — optional, choose at most 1

| Option | Price delta |
|---|---|
| Non-Sticky | +₹10 |
| Hair Fall (Bhringraj) | +₹20 |
| Almond | +₹30 |

**Category: Full Body Relax**

| Service | Price | Duration | Add-on group |
|---|---|---|---|
| Basic | ₹199 | 20 min | — |
| Premium | ₹299 | 30 min | Gel Choice |

**Add-on group: Gel Choice** — optional, choose at most 1

| Option | Price delta |
|---|---|
| Aloe Vera | +₹50 |
| Aloe Vera Mint Gel | +₹100 |

**Category: Instant Glow**

| Service | Price | Duration |
|---|---|---|
| Facial Mask | *TBD* |*TBD* |
| Face De-Tan | *TBD* | *TBD* |
| Scrub | *TBD* | *TBD* |

> ⚠️ Instant Glow pricing and durations are blank on the menu photo. Tracked in
> [10 — Open Questions](10-open-questions.md#q2). The engine needs a duration for every
> service, so these must be filled before Instant Glow goes live. The admin panel will
> refuse to publish a service with no duration.

> ⚠️ The `+1, +2` annotation beside each **Add** button is ambiguous — it reads as either a
> quantity stepper (book for 1 or 2 people) or two add-on tiers. Tracked as
> [Q1](10-open-questions.md#q1). Quantity is the more expensive interpretation because a
> party of 2 needs *two stations at the same time*, which changes the engine. Flagging now,
> not discovering it in week 6.

---

## 5. Feature list

Priority: **P0** = launch blocker · **P1** = launch scope, can slip a week · **P2** = fast follow · **P3** = later.

### 5.1 Customer — Android app & web app (identical feature set)

| # | Feature | Priority | Notes |
|---|---|---|---|
| C-01 | Phone-number OTP sign-in / sign-up | P0 | No password. Name + gender captured after first OTP. |
| C-02 | Home — segment, categories, featured services | P0 | Fully driven by admin catalog |
| C-03 | Category → service list with price, duration, description, image | P0 | |
| C-04 | Service detail + add-on selection with live price/duration recalc | P0 | |
| C-05 | Date picker (next N bookable days, admin-configured) | P0 | Respects weekly offs & holidays |
| C-06 | **Live slot list — only genuinely free times for the chosen duration** | P0 | The core. See [doc 05](05-slot-station-engine.md) |
| C-07 | Apply reward / coupon at checkout | P1 | From scratch cards & streaks |
| C-08 | Online payment via gateway with slot soft-lock during payment | P0 | Hold expires in 10 min |
| C-09 | Booking confirmed screen + push notification | P0 | |
| C-10 | Unique QR code per booking | P0 | Also available offline in Order History |
| C-11 | Order history — Upcoming / Completed / Cancelled, receipts | P0 | |
| C-12 | Cancel / reschedule within policy window | P1 | Policy configurable; refund rules in [Q5](10-open-questions.md#q5) |
| C-13 | Rebook in 2 taps from history | P2 | Big retention lever for the Regular persona |
| C-14 | Visit streak display + progress to next reward | P1 | Counts on check-in only |
| C-15 | Scratch cards — earn, scratch, reveal, wallet of rewards | P1 | |
| C-16 | Product storefront — browse, cart, pay, pick up at store | P2 | No delivery/logistics in scope |
| C-17 | Profile, saved preferences, delete-account request | P1 | Account deletion required by Play policy |
| C-18 | Reminder notification (T-60 min and T-10 min) | P1 | Directly reduces no-shows |
| C-19 | Store info — address, hours, map link, call | P1 | |

### 5.2 Admin panel

| # | Feature | Priority | Notes |
|---|---|---|---|
| A-01 | Staff login with roles (Owner / Manager / Counter Staff) | P0 | RBAC — staff cannot change pricing |
| A-02 | Segments, categories, services CRUD — price, duration, description, image, enable/disable, sort order | P0 | |
| A-03 | Add-on groups & options CRUD, attach to services | P0 | |
| A-04 | Stations: count, names, active/inactive | P0 | |
| A-05 | **Station→service designation** — which services a station may host | P0 | Client req 02/08: *"certain beds may be designated only for head massage"* |
| A-06 | **Time-boxed station allocation** — reserve N named stations exclusively for chosen services during a window, recurring or one-off | P0 | Client req 02/08: *"in the morning, I can push for ₹199 service"* |
| A-07 | Store hours, buffer time, slot granularity, booking horizon | P0 | |
| A-08 | Weekly offs, holidays, ad-hoc blocked windows (per-store or per-station) | P0 | |
| A-09 | Bookings — day calendar view **and station-wise timeline view** | P0 | The timeline view is how staff actually think |
| A-10 | QR scan → check-in | P0 | Camera scan in browser + manual code entry fallback |
| A-11 | **Walk-in booking creation by staff** | P0 | Without this the engine's picture of reality drifts within a day. See [Q4](10-open-questions.md#q4) |
| A-12 | Mark no-show / complete / cancel; refund initiation | P1 | |
| A-13 | Products CRUD — images, stock, price | P2 | |
| A-14 | Streak rules config — visits, window, reward | P1 | |
| A-15 | Scratch card config — reward pool, weights, stock caps, validity | P1 | |
| A-16 | Customers list, profile, booking history, block customer | P1 | |
| A-17 | Reports — revenue by day/service/category, utilisation %, no-show rate, new vs repeat | P1 | Utilisation % is the metric that justifies A-06 |
| A-18 | Coupons / promo codes | P2 | |
| A-19 | Audit log of admin actions | P1 | Pricing and capacity changes must be attributable |
| A-20 | Push notification broadcast / campaign | P3 | |

### 5.3 System / platform

| # | Feature | Priority | Notes |
|---|---|---|---|
| S-01 | Availability engine — duration-aware, buffer-aware, allocation-rule-aware | P0 | [doc 05](05-slot-station-engine.md) |
| S-02 | Database-enforced no-double-booking guarantee | P0 | Postgres exclusion constraint, not application logic |
| S-03 | Slot hold + automatic expiry | P0 | |
| S-04 | Payment gateway integration + signed webhook + idempotency + reconciliation job | P0 | |
| S-05 | Push notifications (FCM) | P0 | |
| S-06 | SMS / WhatsApp fallback for booking confirmation | P2 | Recurring cost — client's call |
| S-07 | Image upload, resize, CDN delivery | P0 | |
| S-08 | Scheduled jobs — hold expiry, reminders, streak rollover, card expiry, reports | P0 | |
| S-09 | Error tracking, structured logs, uptime monitoring | P1 | |
| S-10 | Automated DB backups + restore drill | P0 | Non-negotiable for a payments system |
| S-11 | Rate limiting on OTP and booking endpoints | P0 | OTP endpoints get abused within days of launch |
| S-12 | Multi-outlet-ready data model (`store_id` everywhere) | P0 | Cheap now, a rewrite later |

---

## 6. Non-functional requirements

| Area | Target |
|---|---|
| Slot query latency | p95 < 300 ms for a 14-day window |
| Booking confirm latency | p95 < 800 ms excluding gateway redirect |
| Double-booking rate | **Exactly zero**, enforced at the database layer |
| Availability | 99.5% monthly, measured on the booking endpoint |
| Scale target without re-architecture | 20 outlets · 20k MAU · 2,000 bookings/day |
| App cold start | < 2.5 s on a ₹10k Android device |
| Web Lighthouse (mobile) | Performance ≥ 85, Accessibility ≥ 95 |
| Time zone | All timestamps stored UTC (`timestamptz`); all slot math in store-local wall time (`Asia/Kolkata`) |
| Money | Stored as integer **paise**. No floats anywhere in the money path. |
| Card data | Never touches our servers — gateway-hosted checkout only |
| Privacy | DPDP Act 2023: explicit consent at signup, in-app account deletion, data export on request |
| Accessibility | WCAG 2.1 AA on web and admin; minimum 44×44 px touch targets |
| Localisation | English at launch; all UI strings externalised so Hindi/Gujarati can be added without code changes |

---

## 7. Explicitly out of scope

- iOS app (architecture supports it; publishing is a separate phase)
- At-home / doorstep service, therapist travel, or any logistics
- Product **delivery** — storefront is pickup-at-store only
- Multi-vendor marketplace (this is a single-brand store platform)
- Employee payroll, attendance, inventory beyond product stock counts
- Accounting-system integration (Tally/Zoho) — reports export as CSV
- Live chat support
- Third-party subscriptions and recurring charges (proposal §7 — client's responsibility)
