import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../api/models.dart';

/// The offline copy of upcoming bookings.
///
/// Exists for one screen: the QR at the counter. A shop with thick walls and no signal is
/// the normal case, not an edge case, and a customer who cannot show their code because the
/// app is spinning is a customer the staff have to look up by hand.
///
/// Deliberately small — upcoming bookings only, rewritten wholesale on each successful
/// load. There is no merge logic because there is no offline mutation: everything the app
/// can change needs the server anyway.
class BookingCache {
  BookingCache(this._prefs);

  static const _key = 'reset.bookings.upcoming';
  static const _stampKey = 'reset.bookings.savedAt';

  final SharedPreferences _prefs;

  static Future<BookingCache> open() async =>
      BookingCache(await SharedPreferences.getInstance());

  Future<void> save(List<Booking> bookings) async {
    try {
      final payload = jsonEncode(bookings.map((b) => b.toCacheJson()).toList());
      await _prefs.setString(_key, payload);
      await _prefs.setString(_stampKey, DateTime.now().toIso8601String());
    } catch (_) {
      // A full disk should not break the screen that is working fine online.
    }
  }

  List<Booking> read() {
    try {
      final raw = _prefs.getString(_key);
      if (raw == null) return const [];

      return (jsonDecode(raw) as List)
          .whereType<Map<String, dynamic>>()
          .map(Booking.fromJson)
          .where((booking) => booking.endsAt.isAfter(DateTime.now()))
          .toList();
    } catch (_) {
      // Written by an older build with a different shape. Treat as empty rather than
      // crashing the one screen that has to work when everything else has failed.
      return const [];
    }
  }

  DateTime? get savedAt {
    final raw = _prefs.getString(_stampKey);
    return raw == null ? null : DateTime.tryParse(raw);
  }

  Future<void> clear() async {
    await _prefs.remove(_key);
    await _prefs.remove(_stampKey);
  }
}
