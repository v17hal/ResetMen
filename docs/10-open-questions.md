# 10 — Open Questions

Everything that needs a decision from the client. Each carries a **recommended default** so
work is never blocked — if no answer comes, we build the default and it stays changeable.

**Blocking questions are Q1–Q4.** They change the data model or the slot engine, and are
expensive to retrofit after Phase 1.

---

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 07/08/2026 | **Mobile = Flutter**, not React Native | Client preference. Best UI/animation fidelity, one codebase for future iOS. Cost: no code sharing with the TS surfaces — mitigated by codegen and server-side pricing ([doc 02 §2.7](02-platforms-and-stack.md#27-mobile--flutter-3x-dart-android-first-ios-ready)) |
| 07/08/2026 | **Capacity = stations only** (Q3) | Matches the signed proposal. Extension point retained for a staff dimension. |
| 07/08/2026 | Build order = **scaffold + slot engine first**, before any UI | The engine is the only part that can't be patched later ([doc 09](09-delivery-plan.md)) |

---

## 🔴 Blocking

### Q1 — What does `+1, +2` mean on the menu? {#q1}

Every "Add" button on the handwritten menu has `+1, +2` beside it.

| Interpretation | Impact |
|---|---|
| **(a) Quantity — book for 1 or 2 people** | **Large.** Two people at the same time means two stations simultaneously. The engine must find a time where *N* stations are free together, and one booking maps to multiple station assignments. Affects `bookings` schema, the engine, and the slot UI. |
| **(b) Two add-on tiers** | Small — already covered by the add-on group model. |
| **(c) A shorthand for the add-on list below it** | None. |

**Recommended default:** (b/c) — build the add-on group model as specified, no party
booking. If (a) is correct, party-of-N support is a scoped change to the engine and booking
schema, best done in Phase 1 rather than after launch.

**Needed by:** before Phase 1 ends.

### Q2 — Instant Glow pricing and durations {#q2}

Facial Mask, Face De-Tan and Scrub have no price or duration on the menu photo. The engine
requires a duration for every bookable service.

**Recommended default:** seed all three as **inactive** placeholders. The category is
invisible to customers until the owner fills in price and duration in the admin panel, which
refuses to publish a service with no duration.

**Needed by:** Phase 2 (before the category goes live).

### Q3 — Is capacity limited by stations, or by staff on shift? {#q3}

> ✅ **Decided 07/08/2026 — (a) stations only.** The engine ships with a clean extension point
> for a second resource dimension; adding staff later is additive. The rest of this entry is
> kept as the rationale, and the risk in [doc 09](09-delivery-plan.md#risk-register) stands:
> if the shop ever runs a shift with fewer attendants than active stations, revisit it.


The proposal models capacity purely as stations. But if the store has 3 stations and only 2
attendants on the evening shift, the engine will happily offer 3 simultaneous slots that
nobody can serve — and the failure shows up as an angry customer at the counter, not as an
error in a log.

| Option | Cost |
|---|---|
| **(a) Stations only** — assume staff ≥ stations at all times | Zero. Matches the signed proposal exactly. |
| **(b) Staff as a second capacity dimension** — shift roster, a booking consumes a station *and* an attendant | Moderate: `staff`, `staff_shifts` tables, a second resource axis in the engine, roster UI in admin. |

**Recommended default:** (a) for launch, because it's what was signed — but the engine is
written with a clean extension point for a second resource dimension, so (b) is an additive
change rather than a rewrite. Worth deciding consciously rather than by omission: if the shop
ever runs a short-staffed shift, (b) becomes necessary.

**Needed by:** before Phase 1 ends.

### Q4 — Will staff enter walk-in customers into the system? {#q4}

This is an **operational commitment, not just a feature**. If someone walks in off the street,
is served on Station 2, and nothing is entered, the engine believes Station 2 is free and will
sell that time to an app customer who then arrives to an occupied station.

The admin panel will have one-tap walk-in creation on the same screen staff already use for
check-in. But the process has to actually be followed.

**Recommended default:** yes — walk-in entry is P0, placed directly on the check-in screen,
and covered explicitly in staff training. If the client expects a high walk-in volume, we
should also discuss a "block this station now" panic button for the counter.

**Needed by:** before Phase 1 ends.

---

## 🟡 Important, not blocking

### Q5 — Cancellation and refund policy {#q5}

- How long before the slot can a customer cancel?
- Full refund, partial, or store credit?
- Are refunds automatic or manually approved by the manager?

**Recommended default:** free cancellation up to **2 hours** before, full auto-refund via
Razorpay. Inside 2 hours, no refund but one free reschedule. All values admin-configurable.

### Q6 — No-show handling

Does a no-show forfeit the payment? Does it break the streak?

**Recommended default:** payment forfeited (the station was held and unsellable), streak
unaffected — punishing a streak for one miss is a strong reason to stop using the app.
Auto-marked `NO_SHOW` 15 minutes after the slot start if not checked in.

### Q7 — Women's segment at launch?

The menu photo is headed MEN, and the project folder is `ResetMen`.

**Recommended default:** build the segment model, launch with **Men** only. The segment
switcher hides itself when only one segment is active, so adding Women later is a catalog
entry, not a release.

### Q8 — Pay-at-store option?

The proposal is online-payment-only. A "book now, pay at counter" option raises conversion
but invites no-shows on unpaid slots.

**Recommended default:** online-only at launch, matching the proposal. Revisit with real
no-show data after 4–6 weeks.

### Q9 — GST and invoicing

Is the business GST-registered? Do receipts need a GSTIN, HSN/SAC codes and a tax breakdown?

**Recommended default:** simple receipts at launch, with a GST-compliant invoice template
ready to switch on once the client confirms registration details.

### Q10 — Streak and scratch-card economics

Actual numbers: visits per streak, window length, reward values, win probabilities, monthly
reward budget.

**Recommended default:** seed with 5 visits in 30 days → ₹100 off, and a scratch pool of
60% "₹20 off", 25% "₹50 off", 10% "free add-on", 5% "free Head Massage". Everything is
admin-configurable, so these are starting values to tune against real data, not commitments.

### Q11 — Multiple outlets on the roadmap?

The schema is multi-outlet-ready regardless (`store_id` everywhere), and this costs nothing
now. But knowing the answer changes admin UX: a store switcher, per-store pricing and
consolidated reports are only worth building if a second outlet is real.

**Recommended default:** schema ready, single-outlet UI. Multi-outlet admin UX is a Phase 6
conversation.

### Q12 — Product storefront fulfilment

Pickup at store only, or delivery later?

**Recommended default:** pickup at store. Delivery means addresses, shipping, logistics and
returns — a separate project, explicitly out of scope in [doc 01 §7](01-product-requirements.md#7-explicitly-out-of-scope).

---

## 🟢 Low priority

| # | Question | Default |
|---|---|---|
| Q13 | Languages beyond English? | English at launch; all strings externalised so Hindi/Gujarati is a translation file, not a rebuild |
| Q14 | WhatsApp confirmations in addition to push? | Push + optional SMS; WhatsApp is a recurring cost the client owns |
| Q15 | Referral programme? | Not in scope; the reward ledger already supports it when wanted |
| Q16 | Loyalty points alongside streaks? | Streaks + scratch cards only — three parallel reward mechanics confuse customers and dilute all three |
| Q17 | Customer reviews / ratings? | Post-visit 1-tap rating in a later phase; useful signal, no UI cost |
| Q18 | Membership or package plans (e.g. 10 sessions prepaid)? | Not in scope. Genuinely valuable for this business model — worth a separate conversation after launch. |
