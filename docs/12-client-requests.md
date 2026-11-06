# 12 — Client requests log

Requests that arrive over WhatsApp, transcribed with their date so they are not lost in a
chat history. Newest first. Earlier decisions are in [11 — Scope changes](11-scope-changes.md).

---

## 06/11/2026

> **9:55 am** — Vishal bhai aaj app final kar dena, aur video call pe coupon code, cashback
> bataa dena.
>
> *Finalise the app today, and walk me through coupon code and cashback on a video call.*

> **9:57 am** — Aur booking hone ke baad mujhe notifications nhi aa raha.
>
> *And I am not getting notifications after a booking is made.*

| # | Request | Status |
|---|---|---|
| 1 | Finalise the app | Open: release 1.1.0 not yet built |
| 2 | Explain coupon code and cashback | There was no coupon code to explain: built, then a recorded walkthrough instead of a call |
| 3 | No notification after a booking | Three separate gaps, below |

**Coupon codes.** RESET had rewards (streaks, scratch cards, staff grants) picked from a wallet
at checkout, but nothing a customer could type. Added: Admin → Rewards → *Coupon codes*, where
the shop creates a code (percent or ₹ off, cashback, free session or add-on), an optional
minimum booking, dates, a total limit and a per-customer limit (one by default). Customers type it
under *Have a coupon code?* at checkout, on the website and in the app. One discount per booking:
a code or a reward. A cashback code pays back at check-in as a ₹-off voucher for the next visit,
valid 90 days, exactly like a cashback reward. A cancelled or expired booking gives its use back.

**Notifications.** What the shop owner saw had three causes:

1. A booking paid at the counter sent the customer no "Booking confirmed" at all. Only an
   online payment did. Fixed: every way a booking is confirmed now sends it.
2. Nothing ever told the *shop* about a booking. Added: the admin panel chimes and pops up for
   each new customer booking while it is open (*Booking alerts: On* in the sidebar), and an
   email to `STORE_ALERT_EMAIL` for every booking.
3. Delivery was never configured on the server. Push to the Android app needs
   `FCM_SERVICE_ACCOUNT_JSON` from Firebase project `reset-booking-52ee0`. Email (the shop's
   alert, and confirmations for customers who book on the website, which has no push) needs a
   Resend account with `resetmen.in` verified (`EMAIL_API_KEY`, `EMAIL_FROM`). SMS stays off by the
   decision of 17/08/2026.

Found on the way and fixed: the *Checked in* button on a booking in the admin panel awarded no
streak visit, scratch card or cashback (only the Check in page did); the scratch-campaign
*Figures* dialog showed blanks and ₹NaN; the customer wallet never offered *Revoke*; *Manual
grant* asked for a customer id shown nowhere (now a search by name or phone); and "On their nth
booking" scratch cards never fired for counter bookings.
