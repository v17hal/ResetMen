# 11 — Scope changes, August 2026

Three client decisions arrived after the platform was built. Each removed something the
design had assumed, and each had load-bearing consequences rather than being a config flip.

Documents 01–10 describe the system **as designed**. Where they disagree with this page,
this page is what the code does.

---

## Decisions

| Date | Decision | Raised by |
|---|---|---|
| 17/08/2026 | **No payment gateway** — money is taken at the counter | Client |
| 17/08/2026 | **No SMS** — no MSG91 account, no DLT templates | Client |
| 17/08/2026 | **Google sign-in** via Firebase, replacing phone + OTP | Client |
| 17/08/2026 | **OTP removed entirely**, not merely disabled | Client |

---

## 1. Online payment is off

`PAYMENTS_ENABLED=false`.

A booking is **confirmed the moment it is made**. This is not cosmetic: a hold exists to
keep a slot while somebody pays, and with nobody paying, a booking left in `HELD` would be
cancelled by the expiry job ten minutes later — the customer would have been told they were
booked, and would arrive to nothing.

Confirmation runs through the same two-step the walk-in endpoint already used, so it gets
the identical lifecycle, notifications and QR issuance.

**The Razorpay path is kept, not deleted.** It still compiles and is still covered by the
integration suite. "Can we add online payment?" is the most common thing a shop asks six
months in, and tests are what stop that code rotting while it is switched off. Turning it
back on is one environment variable plus the client's keys.

### Consequence that needs a decision

**A booking now costs nothing to make and nothing to break.** Q6 said a no-show forfeits
payment; there is no payment to forfeit. Nothing prevents one person reserving every slot
in a day.

The usual remedies are an automatic block after *N* no-shows, or a cap on open bookings per
customer. Neither is built. **This is the open question with the shortest fuse.**

---

## 2. Sign-in is Google, through Firebase

`POST /auth/firebase` takes a **Firebase ID token** — deliberately not a Google one.

Google is the only enabled provider today, but a phone-auth or email token arrives in
exactly the same shape and lands in the same code path. Enabling another provider is a
Firebase console change rather than a release. That indirection cost nothing and is the
reason a future DLT approval does not mean re-doing this work.

Verification is hand-written over `node:crypto` rather than `firebase-admin`: the Admin SDK
is roughly 30 MB of transitive Google Cloud clients for what is one RS256 signature check
and four claim comparisons. `alg` is validated first — accepting `none`, or letting a token
choose HS256 and be verified against a public key as though it were a shared secret, is the
classic JWT forgery.

### Identity model

`users.firebaseUid` is the anchor. **Not** the email: people change addresses, and Google
reissues a deleted Workspace address to a different human.

Matching order on sign-in is uid → *verified* email → phone. An unverified email is not
honoured; it is an assertion by whoever typed it, and trusting it would be account takeover
by typing. The order is what stops one person acquiring two accounts, and two streaks,
because they signed in differently the second time.

### `users.phone` is now optional

Google yields an email and no phone number. Two things at the counter degrade without one:

- a walk-in cannot be linked to an existing customer
- nobody can be rung when they are running late

It is therefore **asked for, never required** — a banner on the home screen that names what
is missing and reappears until filled. A mandatory form between "I want to book" and "I
have booked" costs bookings, and the store would rather have a customer with a missing
number than no customer.

---

## 3. OTP is gone

Removed, not disabled: the provider, both endpoints, the service methods, the Zod
contracts, both clients' methods, the `OTP_RATE_LIMITED` error code, the hourly purge job,
and the `otp_codes` and `otp_attempts` tables.

The tables were dropped rather than left dormant. They held nothing but credentials and
rate-limit counters for a flow that no longer exists, and an unused table full of
authentication material is a liability that outlives whoever remembers why it is there. The
DPDP Act's minimisation principle points the same way.

**One guard was deliberately not weakened.** `ConsoleOtpProvider` refused to run in
production because an OTP printed to a log is an authentication bypass for anyone who can
read logs. Rather than relaxing it, the whole class went with the rest of the flow.

---

## What this changes about the boot guards

The API used to refuse to start in production without Razorpay keys and an SMS provider.
Both were correct when payment and OTP were on the critical path. Now:

| Required in production | Why |
|---|---|
| `FIREBASE_PROJECT_ID` | Without it nobody can sign in at all |
| `RAZORPAY_*` | **Only** when `PAYMENTS_ENABLED=true` |

---

## Superseded by this document

- **doc 01 §Auth**, **doc 03 §Auth flow** — phone + OTP is described throughout; read as
  Google via Firebase.
- **doc 04 §users** — `phone` is documented as required and unique; it is now optional.
  `firebaseUid` is new. `otp_codes` and `otp_attempts` no longer exist.
- **doc 06** — `POST /auth/otp/request` and `/auth/otp/verify` are gone, replaced by
  `POST /auth/firebase`. The live document is `docs/openapi.json` (99 paths).
- **doc 09** — the Phase 2 exit gate is "a real ₹1 payment". There is no payment; the
  equivalent gate is a real booking made, confirmed and scanned in at the counter.
- **doc 10 Q8** — "pay at store?" was answered *online-only*. It is now the opposite.

## Still open from doc 10

- **Q1** — what `+1, +2` means on the handwritten menu. Unanswered since day one. If it
  means booking for two people it changes the engine and the booking schema, and it is far
  cheaper before launch than after.
- **Q2** — Instant Glow pricing and durations. Three services stay invisible until answered.
- **Q4** — will staff actually enter walk-ins. Unchanged, and still an operational
  commitment rather than a feature.
