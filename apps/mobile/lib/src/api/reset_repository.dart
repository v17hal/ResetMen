import 'api_client.dart';
import 'models.dart';

/// Every endpoint the app uses, in one place.
///
/// Screens never touch [ResetApiClient] directly — they get typed models and nothing else,
/// so a change in the wire shape is one file's problem.
class ResetRepository {
  ResetRepository(this._api);

  final ResetApiClient _api;

  bool get isAuthenticated => _api.isAuthenticated;

  // ── Auth ────────────────────────────────────────────────────────────────

  Future<int> requestOtp(String phone) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/auth/otp/request',
      body: {'phone': phone},
      anonymous: true,
    );
    return (json['expiresInSeconds'] as num?)?.toInt() ?? 300;
  }

  Future<UserProfile> verifyOtp({
    required String phone,
    required String code,
    String? deviceToken,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/auth/otp/verify',
      body: {
        'phone': phone,
        'code': code,
        'platform': 'ANDROID',
        if (deviceToken != null) 'deviceToken': deviceToken,
      },
      anonymous: true,
    );

    await _api.tokens.save(
      access: json['accessToken'] as String,
      refresh: json['refreshToken'] as String,
    );

    return UserProfile.fromJson(json['user'] as Map<String, dynamic>);
  }

  /// Exchanges a Firebase ID token for a RESET session.
  ///
  /// Provider-agnostic by design: Google produces the token today, and a phone-auth token
  /// would arrive in exactly the same shape. Enabling another provider is a Firebase
  /// console change, not a release.
  Future<UserProfile> signInWithFirebase({
    required String idToken,
    String? deviceToken,
  }) async {
    final json = await _api.post<Map<String, dynamic>>(
      '/auth/firebase',
      body: {
        'idToken': idToken,
        'platform': 'ANDROID',
        if (deviceToken != null) 'deviceToken': deviceToken,
      },
      anonymous: true,
    );

    await _api.tokens.save(
      access: json['accessToken'] as String,
      refresh: json['refreshToken'] as String,
    );

    return UserProfile.fromJson(json['user'] as Map<String, dynamic>);
  }

  Future<UserProfile> me() async =>
      UserProfile.fromJson(await _api.get<Map<String, dynamic>>('/auth/me'));

  Future<UserProfile> updateProfile({
    String? name,
    String? email,
    String? gender,
    String? phone,
  }) async =>
      UserProfile.fromJson(await _api.patch<Map<String, dynamic>>(
        '/auth/me',
        body: {
          if (name != null) 'name': name,
          if (email != null) 'email': email,
          if (gender != null) 'gender': gender,
          if (phone != null) 'phone': phone,
        },
      ));

  /// Required by Play Store policy and the DPDP Act.
  Future<void> deleteAccount() => _api.delete<Map<String, dynamic>?>('/auth/me');

  Future<void> signOut() => _api.tokens.clear();

  // ── Catalog ─────────────────────────────────────────────────────────────

  Future<StoreInfo> store() async =>
      StoreInfo.fromJson(await _api.get<Map<String, dynamic>>('/catalog/store'));

  Future<HomeData> home({String? segmentId}) async => HomeData.fromJson(
      await _api.get<Map<String, dynamic>>('/catalog/home',
          query: {'segmentId': segmentId}));

  Future<ServiceDetail> service(String idOrSlug) async =>
      ServiceDetail.fromJson(await _api
          .get<Map<String, dynamic>>('/catalog/services/$idOrSlug'));

  // ── Availability ────────────────────────────────────────────────────────

  Future<Availability> slots({
    required String serviceId,
    required String date,
    List<String> addonOptionIds = const [],
  }) async =>
      Availability.fromJson(await _api.get<Map<String, dynamic>>(
        '/availability/slots',
        query: {
          'serviceId': serviceId,
          'date': date,
          'addonOptionIds': addonOptionIds,
        },
      ));

  Future<List<DayAvailability>> days({
    required String serviceId,
    required String from,
    required String to,
    List<String> addonOptionIds = const [],
  }) async {
    final json = await _api.get<List<dynamic>>(
      '/availability/days',
      query: {
        'serviceId': serviceId,
        'from': from,
        'to': to,
        'addonOptionIds': addonOptionIds,
      },
    );
    return json
        .whereType<Map<String, dynamic>>()
        .map(DayAvailability.fromJson)
        .toList();
  }

  // ── Booking ─────────────────────────────────────────────────────────────

  Future<Quote> quote({
    required String serviceId,
    List<String> addonOptionIds = const [],
    String? rewardId,
  }) async =>
      Quote.fromJson(await _api.post<Map<String, dynamic>>(
        '/bookings/quote',
        body: {
          'serviceId': serviceId,
          'addonOptionIds': addonOptionIds,
          'rewardId': rewardId,
        },
      ));

  /// Locks a station. Pass a key generated once for the checkout, not per tap — a retry
  /// carrying a fresh key is not idempotent at all.
  Future<Hold> hold({
    required String serviceId,
    required String startsAt,
    List<String> addonOptionIds = const [],
    String? rewardId,
    required String idempotencyKey,
  }) async =>
      Hold.fromJson(await _api.post<Map<String, dynamic>>(
        '/bookings/hold',
        body: {
          'serviceId': serviceId,
          'startsAt': startsAt,
          'addonOptionIds': addonOptionIds,
          'rewardId': rewardId,
        },
        idempotencyKey: idempotencyKey,
      ));

  Future<List<Booking>> bookings({String status = 'upcoming'}) async {
    final json = await _api
        .get<Map<String, dynamic>>('/bookings', query: {'status': status});
    return ((json['data'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(Booking.fromJson)
        .toList();
  }

  Future<Booking> booking(String id) async =>
      Booking.fromJson(await _api.get<Map<String, dynamic>>('/bookings/$id'));

  Future<Booking> cancelBooking(String id, {String? reason}) async =>
      Booking.fromJson(await _api.post<Map<String, dynamic>>(
        '/bookings/$id/cancel',
        body: {if (reason != null) 'reason': reason},
      ));

  Future<void> reschedule(String id, String startsAt) =>
      _api.post<Map<String, dynamic>>('/bookings/$id/reschedule',
          body: {'startsAt': startsAt});

  // ── Payments ────────────────────────────────────────────────────────────

  Future<PaymentOrder> createOrder({
    required String bookingId,
    required String idempotencyKey,
  }) async =>
      PaymentOrder.fromJson(await _api.post<Map<String, dynamic>>(
        '/payments/order',
        body: {'bookingId': bookingId},
        idempotencyKey: idempotencyKey,
      ));

  /// Advisory. The webhook is authoritative — a failure here is not a failed booking.
  Future<void> verifyPayment({
    required String orderId,
    required String paymentId,
    required String signature,
  }) =>
      _api.post<Map<String, dynamic>>('/payments/verify', body: {
        'razorpayOrderId': orderId,
        'razorpayPaymentId': paymentId,
        'razorpaySignature': signature,
      });

  /// Only exists while the API runs in simulated mode, which it refuses to do in production.
  Future<void> simulateSuccess(String paymentId) =>
      _api.post<Map<String, dynamic>>('/payments/$paymentId/simulate-success');

  // ── Rewards ─────────────────────────────────────────────────────────────

  Future<List<WalletReward>> wallet({
    String? serviceId,
    List<String> addonOptionIds = const [],
  }) async {
    final json = await _api.get<List<dynamic>>('/rewards/wallet', query: {
      'serviceId': serviceId,
      'addonOptionIds': addonOptionIds,
    });
    return json
        .whereType<Map<String, dynamic>>()
        .map(WalletReward.fromJson)
        .toList();
  }

  Future<Streak> streak() async =>
      Streak.fromJson(await _api.get<Map<String, dynamic>>('/rewards/streak'));

  Future<List<ScratchCard>> scratchCards() async {
    final json = await _api.get<List<dynamic>>('/rewards/scratch-cards');
    return json
        .whereType<Map<String, dynamic>>()
        .map(ScratchCard.fromJson)
        .toList();
  }

  Future<ScratchCard> scratch(String id) async => ScratchCard.fromJson(
      await _api.post<Map<String, dynamic>>('/rewards/scratch-cards/$id/scratch'));

  // ── Notifications ───────────────────────────────────────────────────────

  Future<void> registerDevice(String token) => _api.post<Map<String, dynamic>>(
        '/notifications/devices',
        body: {'token': token, 'platform': 'ANDROID'},
      );

  /// Call on sign-out, or the phone keeps getting the previous user's reminders.
  Future<void> unregisterDevice(String token) =>
      _api.delete<Map<String, dynamic>?>('/notifications/devices',
          body: {'token': token});
}
