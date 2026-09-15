# Play Console listing — what to upload, and the answers

Generated assets in this folder:

| File | Where it goes |
|---|---|
| `play-store-icon-512.png` | Store listing → App icon (512×512) |
| `play-feature-graphic-1024x500.png` | Store listing → Feature graphic |

Both are built from the client's logo colour (`#022D0F`). The launcher icon uses the
**R** alone: the logo is a wide wordmark, and "RESETMEN" at 48dp is an unreadable smudge.
The wordmark is used on the feature graphic, where there is room for it. If the client
exports the mark square at 1024×1024 from CorelDRAW, swapping both is one command.

Still needed from the client, and only they can provide them:

- **At least two phone screenshots** (1080×1920 or similar, PNG/JPEG). Take them from the
  app once it runs on a device: home, slots, confirmation with the QR, Help.
- Short description (80 characters) and full description (up to 4000).
- Category, contact email, and the content-rating questionnaire.

## Data safety — the answers that match the code

Data collected, all **linked to the user**, none of it used for advertising or tracking,
and all of it deletable in-app (**You → Delete my account**):

| Play category | What | Why | Optional? |
|---|---|---|---|
| Personal info → Name | From Google sign-in | App functionality, account management | No |
| Personal info → Email address | From Google sign-in | App functionality, account management | No |
| Personal info → Phone number | Typed by the customer | App functionality (being rung if late) | **Yes** |
| Personal info → Other (date of birth, gender) | Typed by the customer | Personalisation | **Yes** |
| Financial info → Purchase history | Bookings and counter payments | App functionality, records | No |
| Messages → Other in-app messages | Help conversations | Customer support | **Yes** |
| App activity → Other actions | Visits and check-ins | App functionality | No |

Answer **no** to: location, contacts, photos, files, health, calendar, SMS, call logs,
installed apps, device identifiers for advertising, and any analytics or crash SDK — none
are in the app. The only permissions are `INTERNET` and, if the customer agrees,
`POST_NOTIFICATIONS`.

Card details are **not** collected: money is taken at the counter. If online payment is
switched on later, Razorpay handles the card and this table gains a payment-info row.

Encryption in transit: **yes** (HTTPS only; cleartext is disabled in the release manifest).
Deletion: **yes**, in-app and at https://resetmen.in/account — policy at
https://resetmen.in/privacy.
