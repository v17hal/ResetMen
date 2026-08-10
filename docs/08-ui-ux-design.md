# 08 — UI/UX Design

## 1. Design principles

| # | Principle | What it means in practice |
|---|---|---|
| 1 | **Booking in under 60 seconds** | Home → service → slot → pay is four screens. Nothing optional sits on the critical path. |
| 2 | **Time is the only unit the customer thinks in** | Never show a station, never show "bed 2", never show internal capacity language. |
| 3 | **Compliant vocabulary everywhere** | No *spa*, *therapy*, *therapist*, or *massage* in app chrome. See [doc 01 §2](01-product-requirements.md#2-brand--terminology-rules-hard-constraint). |
| 4 | **Price is never a surprise** | Every add-on updates the total and the duration live, in the same frame. |
| 5 | **Calm, not clinical** | The product sells a *reset*. Generous spacing, low-contrast surfaces, one confident accent — not a medical booking form. |
| 6 | **Staff screens are for a busy counter** | Big targets, one primary action per screen, works on a tablet with wet hands and bad Wi-Fi. |

---

## 2. Design tokens

Defined once in `packages/design-tokens` and emitted to three targets — CSS custom
properties (web/admin), a TS object, and a Dart `ResetTokens` class (Flutter) — so the app and
the website are visually identical and cannot drift.

### 2.1 Colour

The brand is a *fresh start* — so a deep, calm base with one energising mint accent.
Men's-segment-first, hence the darker default.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#F8F6F2` | `#0B0F14` | Page background |
| `surface` | `#FFFFFF` | `#12181F` | Cards, sheets |
| `surface-2` | `#F1EDE6` | `#1A222B` | Nested surfaces, inputs |
| `border` | `#E4DED4` | `#252F3A` | Hairlines |
| `text` | `#0B0F14` | `#F3F5F7` | Primary text |
| `text-muted` | `#6B7280` | `#9AA6B2` | Secondary text |
| `primary` | `#0E9F76` | `#12B886` | **Reset Mint** — CTAs, active slot, brand |
| `primary-fg` | `#FFFFFF` | `#05100C` | Text on primary |
| `accent` | `#D97706` | `#F59E0B` | **Reward Amber** — streaks, scratch cards only |
| `success` | `#0E9F76` | `#12B886` | Confirmed |
| `warning` | `#B45309` | `#F59E0B` | Hold expiring |
| `danger` | `#DC2626` | `#F87171` | Cancelled, errors |
| `info` | `#2563EB` | `#60A5FA` | Neutral notices |

**Amber is reserved for rewards.** When the accent colour only ever means "you earned
something", the streak ring and scratch card carry weight without needing an animation.

Contrast: every text/background pair meets WCAG AA (4.5:1 body, 3:1 large). Status is never
communicated by colour alone — always colour + icon + label.

### 2.2 Typography

| Token | Font | Size / Line | Use |
|---|---|---|---|
| `display` | Plus Jakarta Sans 700 | 32 / 38 | Screen titles |
| `h1` | Plus Jakarta Sans 700 | 24 / 30 | Section headers |
| `h2` | Plus Jakarta Sans 600 | 20 / 26 | Card titles |
| `body` | Inter 400 | 16 / 24 | Default |
| `body-sm` | Inter 400 | 14 / 20 | Secondary |
| `caption` | Inter 500 | 12 / 16 | Labels, badges |
| `mono` | JetBrains Mono 600 | 16 / 20 | Booking codes (`RST-2K8F4M`), times, prices |

Both display and body fonts are free and self-hosted (no external font CDN — it's a
render-blocking third-party dependency on the critical path).

### 2.3 Spacing, radius, elevation

- Spacing scale: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 · 72`
- Radius: `sm 8 · md 12 · **lg 16 (the card default)** · xl 24 · full 999`
- Elevation: four steps (`none · card · raised · overlay`), all straight-down and low-opacity. Depth comes from surface tone; shadows are never stacked.
- Touch targets: minimum 44×44 px, 48×48 on admin

### 2.4 Motion & composition

The reference for the app's feel is
[Best-Flutter-UI-Templates](https://github.com/mitesh77/Best-Flutter-UI-Templates) — the
Fitness and Hotel Booking templates in particular. Four patterns are worth taking, and two
places where we deliberately depart from it.

**Taken:**

| Pattern | What it is | Where we use it |
|---|---|---|
| **Staggered fade-and-rise** | Each list item fades in while translating up ~40 px, each successive item starting slightly later, on `fastOutSlowIn`. | Category tiles, service cards, booking history, rewards |
| **Soft elevated cards with clipped hero images** | 16 px radius, wide low-opacity shadow, image clipped to the card's corner radius at a fixed aspect ratio | ServiceCard, BookingCard, product tiles |
| **Theme as a static class** | Named colours plus a named `TextTheme`, reachable without a `BuildContext` | Generated `ResetTokens` / `ResetColorsDark` in `packages/design-tokens` |
| **Screen = a scroll of self-contained cards** | Each section owns its own animation controller and renders independently | Home, Rewards, admin Today |

**Departed from, on purpose:**

1. **The stagger is capped at 8 items.** The reference computes each item's interval as `(1 / count) * index`, so a 40-item list gives every item a 2.5% slice of the timeline — imperceptible individually, and the last items land well after the user has begun scrolling. Past the cap we fall back to a plain fade.

2. **Slot chips never stagger, ever.** The slot picker is the one screen where the user is scanning for a specific time under mild time pressure. Animating sixty chips in sequence delays the only information they came for. It renders at once.

Shadow offset is another small change: the reference casts its card shadow diagonally at
`(4, 4)`; ours drops straight down, because a diagonal shadow implies a light source the
rest of the interface never commits to.

**Durations:** 150 ms micro (press, toggle) · 250 ms base (screens, sheets, card entry) ·
600 ms slow (scratch reveal, streak ring fill). Standard curve is `cubic-bezier(.4,0,.2,1)`,
which is `Curves.fastOutSlowIn` on the Flutter side — the same motion on both platforms.

Every value above lives in `packages/design-tokens/src/tokens.ts` and is emitted to CSS
custom properties, a TypeScript object and `reset_tokens.dart`. All motion is suppressed
under `prefers-reduced-motion` and `MediaQuery.disableAnimations`.

---

## 3. Component inventory

| Group | Components |
|---|---|
| Primitives | Button (primary/secondary/ghost/danger) · Input · Select · Checkbox · Radio · Switch · Badge · Chip · Avatar · Skeleton · Toast · Sheet · Dialog · Tabs · Accordion |
| Catalog | SegmentSwitcher · CategoryTile · ServiceCard · ServiceHero · AddonGroup · AddonOption · PriceRow |
| Booking | DateStrip · SlotGrid · SlotChip · DurationPill · PriceSummary · HoldTimer · BookingStatusBadge · BookingCard · QrTicket |
| Rewards | StreakRing · StreakMilestone · ScratchCard · RewardChip · RewardWallet |
| Admin | StationTimeline · BookingBlock · NowIndicator · QrScanner · CheckinResultCard · StationServiceMatrix · AllocationRuleForm · RulePreviewDiff · StatTile · DataTable · DateRangePicker |
| Feedback | EmptyState · ErrorState · LoadingState · OfflineBanner |

---

## 4. Customer screens

Wireframes below are mobile (app and web are the same layout; web adds a max-width container
and a top nav on desktop).

### 4.1 Home

```
┌──────────────────────────────────────┐
│  RESET                      ⟳  👤    │
│  ────────────────────────────────    │
│  Good evening, Vishal                │
│  Ready for your reset?               │
│                                      │
│  ┌─ 🔥 3-visit streak ─────────────┐ │
│  │ ███████░░░  2 more to unlock    │ │
│  │ ₹100 off · expires in 12 days   │ │
│  └─────────────────────────────────┘ │
│                                      │
│  [  Men  ]   Women                   │   ← hidden if only 1 segment
│                                      │
│  What do you need today?             │
│  ┌────────────┐ ┌────────────┐       │
│  │  🧘        │ │  💆        │       │
│  │ Stress     │ │ Full Body  │       │
│  │ Relief     │ │ Relax      │       │
│  │ from ₹49   │ │ from ₹199  │       │
│  └────────────┘ └────────────┘       │
│  ┌────────────┐                      │
│  │  ✨ Instant Glow    from ₹—  │    │
│  └────────────┘                      │
│                                      │
│  Book again                          │
│  ┌─────────────────────────────────┐ │
│  │ Head + Neck + Shoulder          │ │
│  │ ₹99 · 15 min      [ Rebook ]    │ │
│  └─────────────────────────────────┘ │
│                                      │
│  📍 RESET Satellite · Open till 9 PM │
├──────────────────────────────────────┤
│  🏠      📋      🎁      🛍      👤   │
│ Home  Bookings Rewards Shop Profile  │
└──────────────────────────────────────┘
```

The streak card sits above the fold on purpose — it's the single strongest repeat-visit lever
in the product, and it's worthless below a scroll.

### 4.2 Service detail + add-ons

```
┌──────────────────────────────────────┐
│  ←   Head + Neck + Shoulder          │
│  ┌─────────────────────────────────┐ │
│  │        [ service image ]        │ │
│  └─────────────────────────────────┘ │
│  ₹99  ·  ⏱ 15 min                    │
│  Loosen up the whole upper body.     │
│                                      │
│  Oil choice            Optional      │
│  ○ None                        ₹0    │
│  ○ Non-Sticky                +₹10    │
│  ○ Hair Fall (Bhringraj)     +₹20    │
│  ● Almond                    +₹30    │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ Total    ₹129   ·   15 min      │ │
│  │ [     Choose a time      ]      │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

The total bar is sticky and animates on every change, so price and duration are always
visible at the moment of choice.

### 4.3 Date & slot picker — the most important screen

```
┌──────────────────────────────────────┐
│  ←   Pick a time                     │
│  Head + Neck + Shoulder · Almond     │
│  ₹129 · 15 min                       │
│                                      │
│  ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐      │
│  │TDY││FRI││SAT││SUN││MON││TUE│  →   │
│  │ 8 ││ 9 ││10 ││11 ││12 ││13 │      │
│  └───┘└───┘└───┘└───┘└───┘└───┘      │
│    ●              ✕ closed           │
│                                      │
│  Morning                             │
│  ┌──────┐┌──────┐┌──────┐            │
│  │ 9:15 ││ 9:35 ││ 9:50 │            │
│  └──────┘└──────┘└──────┘            │
│  ┌──────┐┌──────┐                    │
│  │10:05 ││10:20 │  ⚡ only 1 left    │
│  └──────┘└──────┘                    │
│                                      │
│  Afternoon                           │
│  ┌──────┐┌──────┐┌──────┐            │
│  │ 2:00 ││ 2:15 ││ 2:30 │            │
│  └──────┘└──────┘└──────┘            │
│                                      │
│  Evening                             │
│  ┌──────┐  ← selected (mint fill)    │
│  │ 6:30 │                            │
│  └──────┘                            │
│                                      │
│  Updated just now · tap ⟳ to refresh │
│  ┌─────────────────────────────────┐ │
│  │ Today 6:30 PM · ₹129            │ │
│  │ [        Continue        ]      │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

Design decisions that matter here:

- **Only free times are rendered.** No greyed-out unavailable slots — a wall of disabled chips reads as "this place is always full". If a period has nothing, its section shows a one-line empty state instead.
- **Grouped Morning / Afternoon / Evening.** A flat list of 90 chips is unscannable.
- **`⚡ only 1 left`** appears when `stationsAvailable === 1`. Honest urgency, straight from the API.
- **Staleness is visible.** `computedAt` drives "Updated just now"; auto-refresh after 60 s idle, plus a manual refresh. Availability is live, so the UI says so.
- **Empty day** → *"Fully booked on Sat 10. Next available: Sun 11, 9:15 AM →"* with a jump button. Never a dead end.

### 4.4 Checkout

```
┌──────────────────────────────────────┐
│  ←   Confirm & pay      ⏳ 9:42 left │  ← hold countdown, amber under 2 min
│                                      │
│  Head + Neck + Shoulder              │
│  Today, 8 Aug · 6:30 PM · 15 min     │
│  Almond oil                          │
│                                      │
│  ┌─ Rewards ──────────────────────┐  │
│  │ 🎁 ₹50 off  ·  expires 14 Aug  │  │
│  │                     [ Apply ]  │  │
│  └────────────────────────────────┘  │
│                                      │
│  Service                     ₹99     │
│  Almond oil                  ₹30     │
│  Reward                     −₹50     │
│  ─────────────────────────────────   │
│  To pay                      ₹79     │
│                                      │
│  [        Pay ₹79        ]           │
│  🔒 Secured by Razorpay              │
│  Free cancellation up to 2 hrs before│
└──────────────────────────────────────┘
```

The hold countdown is shown, not hidden. A silently expiring hold that fails at the payment
screen is the worst failure in the flow; a visible timer turns it into an understood
constraint. At `0:00` the screen converts to *"Your slot was released — here are the next
available times"* with the list already loaded.

### 4.5 Confirmation + QR

```
┌──────────────────────────────────────┐
│         ✓  You're booked             │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │  ███ ██  ███ █ ███   ██ ███     │ │
│  │  █ █ ███ █ █ ███ █ ███ █ █      │ │
│  │      [  QR CODE  ]              │ │
│  │  ███ █ ████ ██  █ ███ ████      │ │
│  │                                 │ │
│  │        RST-2K8F4M               │ │
│  └─────────────────────────────────┘ │
│  Show this at the counter            │
│                                      │
│  Head + Neck + Shoulder · Almond     │
│  Today, 8 Aug · 6:30 PM · 15 min     │
│  Paid ₹79                            │
│                                      │
│  📍 RESET Satellite, Satellite Road  │
│  [ Directions ]      [ Call store ]  │
│                                      │
│  [ Add to calendar ]  [ View booking]│
└──────────────────────────────────────┘
```

The QR and code are **cached on device**. A customer standing at the counter on 2G with no
signal must still be able to check in — and the manual `RST-2K8F4M` fallback exists for when
the screen is cracked or the battery died.

### 4.6 Order history

Tabs: **Upcoming · Completed · Cancelled**

```
┌──────────────────────────────────────┐
│  Bookings                            │
│  [ Upcoming ] Completed  Cancelled   │
│                                      │
│  ┌─────────────────────────────────┐ │
│  │ ● Confirmed                     │ │
│  │ Head + Neck + Shoulder          │ │
│  │ Today · 6:30 PM · 15 min        │ │
│  │ ₹79 paid                        │ │
│  │ [ Show QR ]  [ Cancel ]         │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ ● Completed        12 Jul       │ │
│  │ Full Body Relax — Basic         │ │
│  │ ₹199 · Receipt ↓   [ Rebook ]   │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 4.7 Rewards

```
┌──────────────────────────────────────┐
│  Rewards                             │
│                                      │
│        ╭───────────╮                 │
│       │    3 / 5    │  streak ring   │
│        ╰───────────╯                 │
│   2 more visits before 20 Aug        │
│   Unlocks: ₹100 off                  │
│                                      │
│  Scratch cards                       │
│  ┌────────┐ ┌────────┐ ┌────────┐    │
│  │ ▒▒▒▒▒▒ │ │ ₹50    │ │ ▒▒▒▒▒▒ │    │
│  │ Scratch│ │ off    │ │ Scratch│    │
│  │  me!   │ │ ✓ used │ │  me!   │    │
│  └────────┘ └────────┘ └────────┘    │
│                                      │
│  My rewards                          │
│  🎁 ₹50 off · expires 14 Aug         │
│  🎁 Free almond oil · expires 30 Aug │
└──────────────────────────────────────┘
```

The scratch interaction is a real drag-to-reveal on a canvas mask. The reward is drawn
**server-side** when the scratch begins — the client never holds the outcome before the
animation, so the result can't be inspected or re-rolled.

### 4.8 Cross-cutting states

| State | Treatment |
|---|---|
| Loading | Skeletons matching final layout. Never a centred spinner on a full screen. |
| Empty — no slots on a date | Illustration + next available date with a jump button |
| Empty — no bookings | *"Your first reset is 60 seconds away"* + a primary CTA |
| Offline | Persistent banner; cached QR and booking list stay readable |
| Hold expired | In-place conversion to a fresh slot list, not a dead-end error |
| Payment failed | Retry with the hold still alive if time remains; otherwise re-pick |
| Store closed today | Banner with next opening time, browsing still allowed |

---

## 5. Admin screens

Desktop-first, except check-in which is tablet-first.

### 5.1 Today (landing)

```
┌────────────────────────────────────────────────────────────────┐
│ RESET Admin      Satellite ▾                    Vishal (Owner) │
├──────────┬─────────────────────────────────────────────────────┤
│ Today    │  Friday, 8 Aug 2026                                 │
│ Bookings │  ┌────────┐┌────────┐┌────────┐┌────────┐           │
│ Check-in │  │ 24     ││ ₹4,720 ││ 68%    ││ 2      │           │
│ Catalog  │  │Bookings││Revenue ││Utilise ││No-show │           │
│ Capacity │  └────────┘└────────┘└────────┘└────────┘           │
│ Rewards  │                                                     │
│ Products │  Next up                                            │
│ Customers│  6:30 PM  Vishal M.  Head+Neck+Shoulder  Stn 1      │
│ Reports  │  6:45 PM  Rahul S.   Full Body Basic     Stn 2      │
│ Staff    │  7:00 PM  Amit K.    Head Massage        Stn 3      │
│ Settings │                                                     │
└──────────┴─────────────────────────────────────────────────────┘
```

### 5.2 Station timeline — the view staff actually live in

```
┌────────────────────────────────────────────────────────────────┐
│  Bookings — Timeline    ◀  Fri 8 Aug  ▶    [List] [+ Walk-in]  │
│                                                                │
│        9:00   9:30  10:00  10:30  11:00  11:30  12:00          │
│        │      │      │      │      │      │      │             │
│ Stn 1  ▓▓▓░  ░░░░  ▓▓▓▓▓▓░  ░░░░░░░░░░  ▓▓▓▓▓▓▓▓░              │
│        Head        Full Body            Full Body              │
│                                                                │
│ Stn 2  ▓▓▓▓▓▓▓▓░  ▓▓▓▓▓▓▓▓░  ░░░░░░░░  ▓▓▓░                    │
│        ╞══════ reserved: ₹199 Basic, 9–12 ══════╡              │
│                                                                │
│ Stn 3  ▓▓▓▓▓▓▓▓░  ░░░░  ▓▓▓░  ████████████████                 │
│        Full Body       Head   Blackout — maintenance           │
│                                              ▲ now             │
│  ▓ booked   ░ buffer   █ blocked   ╞═╡ allocation rule         │
└────────────────────────────────────────────────────────────────┘
```

Buffer is rendered as its own visual band. When the owner asks *"why can't I book 9:10 when
the 9:00 head massage ends at 9:10?"*, this screen answers it without anyone explaining
anything.

### 5.3 Check-in (tablet)

```
┌────────────────────────────────────────────┐
│              Check-in                      │
│  ┌──────────────────────────────────────┐  │
│  │                                      │  │
│  │        [ live camera view ]          │  │
│  │        ┌────────────────┐            │  │
│  │        │                │            │  │
│  │        │  scan the QR   │            │  │
│  │        └────────────────┘            │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  Or enter code:  [ RST-______ ]  [ Go ]    │
│                                            │
│  ┌─ ✓ Checked in ─────────────────────────┐│
│  │  Vishal Mishra                         ││
│  │  Head + Neck + Shoulder · Almond oil   ││
│  │  6:30 PM · 15 min  →  Station 1        ││
│  │  🔥 Streak 4/5 · scratch card unlocked ││
│  └────────────────────────────────────────┘│
└────────────────────────────────────────────┘
```

The result card is deliberately large and readable across the counter. It shows the
**station** — this is the one screen where station identity is surfaced, because it's the
instruction staff act on. Manual code entry is always visible, not hidden behind a "camera
not working?" link.

### 5.4 Allocation rule form (the 02/08 requirement)

```
┌────────────────────────────────────────────────────────────────┐
│  Capacity → Allocation rules → New rule                        │
│                                                                │
│  Name         [ Morning ₹199 push                            ] │
│                                                                │
│  Mode         ● Reserve stations exclusively for these services│
│               ○ Block these services from these stations       │
│                                                                │
│  When         ● Every week  ○ One-off                          │
│               [M][T][W][T][F][S] [ ]S                          │
│               From [ 09:00 ]  to [ 12:00 ]                     │
│               Valid [ 10 Aug 2026 ] → [ no end date ]          │
│                                                                │
│  Stations     ☐ Station 1   ☑ Station 2   ☑ Station 3          │
│               2 of 3 stations reserved                         │
│                                                                │
│  Services     ☑ Full Body Relax — Basic (₹199)                 │
│               ☐ Full Body Relax — Premium                      │
│               ☐ Head Massage  ☐ Head+Neck+Shoulder             │
│                                                                │
│  ┌─ Preview — effect on Mon 11 Aug ────────────────────────┐   │
│  │ Basic (₹199)          9–12: 3 stations   (no change)    │   │
│  │ Head Massage          9–12: 3 → 1 station               │   │
│  │ Full Body Premium     9–12: 3 → 1 station               │   │
│  │ ⚠ 2 existing bookings conflict with this rule:          │   │
│  │   Mon 11 Aug 10:15 Head Massage · Stn 2  [ Reassign ]   │   │
│  │   Mon 11 Aug 11:00 Premium      · Stn 3  [ Reassign ]   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                    [ Cancel ]  [ Save rule ]   │
└────────────────────────────────────────────────────────────────┘
```

**The preview panel is the most valuable thing on this screen.** Capacity rules have
non-obvious second-order effects — reserving two stations for a ₹199 push can quietly
eliminate all morning availability for the ₹299 Premium, which is the opposite of what the
owner intended. Showing the before/after per service, plus any bookings the rule would
strand, turns a risky action into an informed one.

### 5.5 Station→service designation

```
┌────────────────────────────────────────────────────────────────┐
│  Capacity → Stations                              [ + Station ]│
│                                                                │
│              │ Head │ H+N+S │ H+N+S+B │ Basic │ Premium │ Glow │
│  ────────────┼──────┼───────┼─────────┼───────┼─────────┼──────│
│  Station 1   │  ☑   │   ☑   │    ☑    │   ☑   │    ☑    │  ☑   │
│  Station 2   │  ☑   │   ☑   │    ☑    │   ☑   │    ☑    │  ☑   │
│  Station 3   │  ☑   │   ☑   │    ☐    │   ☐   │    ☐    │  ☐   │
│  (corner chair — space constrained)                            │
│                                                                │
│  ⚠ Full Body Premium can only be booked on 2 of 3 stations.    │
└────────────────────────────────────────────────────────────────┘
```

A matrix rather than a per-station form: the question the owner is answering is *"which
services can go where"*, and a grid answers it at a glance while surfacing coverage warnings.

---

## 6. Accessibility

- WCAG 2.1 AA on web and admin.
- Full keyboard navigation in admin, including the timeline (arrow keys move between bookings).
- Visible focus rings, never `outline: none`.
- Every icon-only button has an `aria-label`; slot chips announce as *"9:15 AM, available, 1 station left"*.
- Status conveyed by colour **and** icon **and** text.
- `prefers-reduced-motion` disables the scratch-card and streak-ring animations, replacing them with instant reveals.
- Dynamic type support on mobile up to 200% without layout breakage.

---

## 7. Deliverables & design workflow

| Deliverable | Format | When |
|---|---|---|
| Design tokens | `packages/design-tokens` → CSS vars + TS object + `reset_tokens.dart` | With the scaffold |
| Component library | Storybook on the `ui` package (web/admin) · Widgetbook on `apps/mobile` | Alongside build |
| Hi-fi screens | Figma — customer (14 screens), admin (12 screens) | Before front-end build starts |
| Prototype | Figma clickable — the full booking flow | For client sign-off |
| App icon, splash, Play Store assets | Figma → exported | Before Play submission |

Figma is the source of truth for visuals; `packages/design-tokens` is the source of truth for
values. Tokens are exported from Figma variables so the two cannot drift.
