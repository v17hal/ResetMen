import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/api_client.dart';
import 'api/models.dart';
import 'api/reset_repository.dart';
import 'api/token_store.dart';
import 'services/booking_cache.dart';

/// Overridden in `main()` once the keystore has been read. Reading tokens is the one thing
/// that must finish before the first frame, because the app decides which screen to show
/// based on whether it has any.
final tokenStoreProvider = Provider<TokenStore>((ref) {
  throw UnimplementedError('tokenStoreProvider must be overridden in main().');
});

final bookingCacheProvider = Provider<BookingCache>((ref) {
  throw UnimplementedError('bookingCacheProvider must be overridden in main().');
});

/// The API base URL, from `--dart-define=API_URL=...`.
///
/// A compile-time define rather than a runtime setting: a release build must not be able to
/// be pointed at a different server, and the value is baked into the APK CI produces.
const apiBaseUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://10.0.2.2:4000',
);

/// Explicit variable types on these three, not just on the `Provider<...>` call.
///
/// The client's `onAuthFailure` invalidates the session, the session reads the repository,
/// and the repository reads the client — a legitimate runtime cycle that Dart cannot infer
/// its way around. Annotating the variables breaks the inference loop without breaking the
/// wiring.
final Provider<ResetApiClient> apiClientProvider = Provider<ResetApiClient>((ref) {
  final client = ResetApiClient(
    baseUrl: apiBaseUrl,
    tokens: ref.watch(tokenStoreProvider),
    onAuthFailure: () => ref.invalidate(sessionProvider),
  );
  ref.onDispose(client.close);
  return client;
});

final Provider<ResetRepository> repositoryProvider = Provider<ResetRepository>(
  (ref) => ResetRepository(ref.watch(apiClientProvider)),
);

/// The signed-in customer, or null.
///
/// Fetched rather than cached from sign-in: `/auth/me` is cheap, and it means a token the
/// server has stopped accepting is discovered on launch rather than during checkout.
final FutureProvider<UserProfile?> sessionProvider =
    FutureProvider<UserProfile?>((ref) async {
  final repository = ref.watch(repositoryProvider);
  if (!repository.isAuthenticated) return null;

  try {
    return await repository.me();
  } catch (_) {
    // A rejected token is a signed-out user, not a broken app.
    return null;
  }
});

final storeProvider = FutureProvider<StoreInfo>(
  (ref) => ref.watch(repositoryProvider).store(),
);

final homeProvider =
    FutureProvider.family<HomeData, String?>((ref, segmentId) async {
  return ref.watch(repositoryProvider).home(segmentId: segmentId);
});

final serviceProvider = FutureProvider.family<ServiceDetail, String>(
  (ref, idOrSlug) => ref.watch(repositoryProvider).service(idOrSlug),
);

typedef SlotQuery = ({String serviceId, String date, List<String> addonIds});

/// Availability, never cached.
///
/// A stale slot list means picking a time that has already gone and finding out during
/// payment — the worst possible moment. `autoDispose` so leaving the screen drops it.
final slotsProvider =
    FutureProvider.autoDispose.family<Availability, SlotQuery>((ref, query) {
  return ref.watch(repositoryProvider).slots(
        serviceId: query.serviceId,
        date: query.date,
        addonOptionIds: query.addonIds,
      );
});

typedef DaysQuery = ({String serviceId, String from, String to, List<String> addonIds});

final daysProvider =
    FutureProvider.autoDispose.family<List<DayAvailability>, DaysQuery>((ref, query) {
  return ref.watch(repositoryProvider).days(
        serviceId: query.serviceId,
        from: query.from,
        to: query.to,
        addonOptionIds: query.addonIds,
      );
});

/// Upcoming bookings, written through to the offline cache on every successful load.
///
/// The cache is what makes check-in work in a basement with no signal — the QR payload is
/// already on the device by the time it is needed.
final bookingsProvider =
    FutureProvider.family<List<Booking>, String>((ref, status) async {
  final bookings = await ref.watch(repositoryProvider).bookings(status: status);
  if (status == 'upcoming') {
    await ref.read(bookingCacheProvider).save(bookings);
  }
  return bookings;
});

final streakProvider = FutureProvider<Streak>(
  (ref) => ref.watch(repositoryProvider).streak(),
);

final scratchCardsProvider = FutureProvider<List<ScratchCard>>(
  (ref) => ref.watch(repositoryProvider).scratchCards(),
);

final walletProvider = FutureProvider<List<WalletReward>>(
  (ref) => ref.watch(repositoryProvider).wallet(),
);

typedef BasketQuery = ({String serviceId, List<String> addonIds});

final basketWalletProvider =
    FutureProvider.autoDispose.family<List<WalletReward>, BasketQuery>((ref, query) {
  return ref.watch(repositoryProvider).wallet(
        serviceId: query.serviceId,
        addonOptionIds: query.addonIds,
      );
});
