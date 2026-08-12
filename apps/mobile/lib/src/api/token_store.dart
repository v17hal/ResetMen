import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the app keeps its tokens.
///
/// The keystore, not shared preferences: a refresh token is valid for 30 days, and
/// shared_preferences is plain XML that any app with root can read.
///
/// Reads are synchronous against an in-memory copy hydrated once at startup. Every request
/// needs the access token to set a header, and awaiting the keystore on each one is
/// measurable on a low-end device — and would make the whole client API async for no gain.
class TokenStore {
  TokenStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  static const _accessKey = 'reset.access';
  static const _refreshKey = 'reset.refresh';

  final FlutterSecureStorage _storage;

  String? _access;
  String? _refresh;

  String? get access => _access;
  String? get refresh => _refresh;

  /// Call once, before the first request. Safe to call again.
  Future<void> load() async {
    try {
      _access = await _storage.read(key: _accessKey);
      _refresh = await _storage.read(key: _refreshKey);
    } catch (_) {
      // A keystore that has been invalidated — by a fingerprint being added, or a restore
      // from a backup onto different hardware — throws rather than returning null. Treat it
      // as signed out; the alternative is an app that will not open at all.
      _access = null;
      _refresh = null;
      await clear();
    }
  }

  Future<void> save({required String access, required String refresh}) async {
    _access = access;
    _refresh = refresh;
    try {
      await _storage.write(key: _accessKey, value: access);
      await _storage.write(key: _refreshKey, value: refresh);
    } catch (_) {
      // In-memory copy still works for this session; the sign-in simply will not survive a
      // restart. Better than refusing to sign in at all.
    }
  }

  Future<void> clear() async {
    _access = null;
    _refresh = null;
    try {
      await _storage.delete(key: _accessKey);
      await _storage.delete(key: _refreshKey);
    } catch (_) {
      // Nothing useful to do. The in-memory copy is gone, which is what protects this
      // session; the stale ciphertext is unreadable anyway.
    }
  }
}
