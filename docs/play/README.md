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

## Automating the upload

`.github/workflows/release.yml` builds the signed bundle on every `v*` tag and, once the
secret below exists, uploads it to the **internal testing** track with the R8 mapping file
and the release notes in `distribution/whatsnew/`. Without the secret the job still builds
and attaches the bundle as an artifact — a missing Play account never fails a release.

**Two things the API cannot do**, both one-time and both in the Console by hand:

1. **Create the app.** There is no API for it.
2. **The first upload of a new package.** Google requires one manual upload before the API
   will accept that package. Everything after it can be automated.

Store listing, Data safety, content rating and pricing are Console-only too, but they are
set once and rarely touched.

### One-time setup

1. **Google Cloud** — in the project linked to the Play account, enable the
   **Google Play Android Developer API**. Create a service account, then a **JSON key**.
2. **Play Console** → Users and permissions → **Invite new user**, paste the service
   account's email, and grant it, for this app only: *View app information*,
   *Manage testing tracks and releases*, and *Release to production* if you ever want the
   workflow to publish rather than stage.
3. **GitHub** → repository secrets → add `PLAY_SERVICE_ACCOUNT_JSON`, the whole JSON key.
   The signing secrets are already needed by the same job: `ANDROID_KEYSTORE_BASE64`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
4. Optional: repository **variable** `PLAY_TRACK` (`internal`, `alpha`, `beta`,
   `production`). It defaults to `internal` deliberately — a track that reaches testers in
   minutes and customers never.

### Releasing after that

```bash
git tag v1.2.0 && git push origin v1.2.0
```

The tag becomes the version name; `versionCode` comes from the run number, so it always
increases and can never be forgotten. Edit `distribution/whatsnew/whatsnew-en-IN.txt`
first — it is what customers read on the Play listing, and a stale one says the wrong
thing about a new build.

**Permissions the service account must NOT have:** account-level admin. It needs app-level
release rights and nothing else; a leaked key with admin rights can change payouts.
