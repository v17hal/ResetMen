# RESET — Android app

Flutter 3.29, Riverpod, plain `http`. Nine screens: home, service detail, slot picker,
checkout, confirmation, visits, rewards, account, plus the sign-in sheet.

```bash
flutter pub get

# 10.0.2.2 is the emulator's route to the host machine. `localhost` is the emulator
# itself, which is the first thing everyone gets wrong.
flutter run --dart-define=API_URL=http://10.0.2.2:4000

flutter analyze
flutter test
```

`API_URL` is a compile-time define, not a runtime setting. A release build cannot be
pointed at a different server, and CI bakes the production origin into the artifact.

## What is deliberately not here

**Firebase / push notifications.** `firebase_core` needs `android/app/google-services.json`
**at build time** — adding the dependency before the client's Firebase project exists turns
a working build into a broken one. The server side is finished and degrades to logging, so
wiring this up later is: add the two packages, drop in the JSON, and call
`repository.registerDevice(token)` after sign-in.

**Bundled fonts.** The theme names Plus Jakarta Sans, Inter and JetBrains Mono. Until the
`.ttf` files are added under `assets/fonts/` and declared in `pubspec.yaml`, Flutter falls
back to the platform default — the app looks correct but not *branded*. The web surfaces
self-host the same three via `next/font`, so the files are already pinned to specific
weights; this is a copy-in, not a decision.

## Things worth knowing before changing anything

**Times are store-local, always.** `DateTime.parse('2026-08-10T20:15:00+05:30')` returns a
correct instant and **throws the offset away** — formatting it directly prints 2:45 pm for
an 8:15 pm slot. Every instant is parsed through `_instant()` in `models.dart`, which
records the store's offset on the way past, and the formatters shift back through it.
Never call `.toLocal()`: that renders in the *device's* timezone, so a customer abroad —
or one whose phone clock is simply wrong — sees a time nobody at the counter recognises.
The tests in `test/format_test.dart` pin this.

**The QR works offline.** Upcoming bookings are written to `shared_preferences` on every
successful load, and the visits screen falls back to that copy when the network fails. A
shop with thick walls is the normal case, not an edge case. The cache is cleared on sign
out — leaving it would show the next user someone else's booking.

**Tokens live in the keystore**, read once into memory at startup. `shared_preferences` is
plain XML that any app with root can read, and a refresh token is valid for 30 days.

**One refresh at a time.** Refresh tokens rotate, so six requests waking up behind an
expired access token must not fire six refreshes — the first succeeds and the rest are
rejected as replays, signing the user out mid-session. `ResetApiClient` shares one future.

**A refresh that fails on the network keeps its tokens.** Going through a tunnel is not a
reason to sign someone out. Only a refresh the *server* rejects clears them.

**Slot chips never animate in.** Every other list uses the staggered fade-and-rise from the
[Best-Flutter-UI-Templates](https://github.com/mitesh77/Best-Flutter-UI-Templates)
reference, capped at 8 items. The slot picker is the one screen where someone is scanning
for a specific time under mild pressure — see docs/08 §2.4.

**Enums are generated.** `lib/src/api/generated/reset_enums.dart` comes from the Zod
schemas via `pnpm gen:api`. Editing it by hand means the app and the server disagree about
a status, and the symptom is a blank screen rather than a compile error. `ResetTokens` is
generated too, by `pnpm gen:tokens`. CI fails if either has drifted.

## Release

`gradle.properties` caps the JVM at 2 GB. Flutter's template ships `-Xmx8G` plus 4 GB of
metaspace, which asks for 12 GB before the OS gets a look in — on an 8 GB machine the
daemon dies mid-R8 with a JVM crash whose message points nowhere near the cause.

Release builds are minified and shrunk. `proguard-rules.pro` keeps what Razorpay and
`flutter_secure_storage` resolve reflectively, and silences Flutter's dangling references
to the Play Core split-install API — this app has no deferred components, so those classes
genuinely are not there, and R8 treats the dangling references as a hard error.

Signing reads `android/key.properties`, which is gitignored, as is the keystore it points
at. When absent, release falls back to debug keys so the build still works — and Play
rejects it, which is the correct outcome: it cannot ship by accident.

**Losing the upload keystore means the app can never be updated under the same Play
listing.** It belongs in the client's password manager, with a base64 copy in CI secrets.
