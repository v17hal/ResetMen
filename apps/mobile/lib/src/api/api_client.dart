import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'generated/reset_enums.dart';
import 'token_store.dart';

/// Every non-2xx response the API returns, as RFC 9457 problem+json.
///
/// UI switches on [code] and nothing else. `title` and `detail` are written for a human
/// reading a log; they are not a contract and they will be reworded.
class ResetApiException implements Exception {
  ResetApiException({
    required this.code,
    required this.status,
    required this.title,
    this.detail,
  });

  final ErrorCode? code;
  final int status;
  final String title;
  final String? detail;

  bool get isSlotGone =>
      code == ErrorCode.slotTaken || code == ErrorCode.slotUnavailable;

  bool get isAuthFailure => code == ErrorCode.unauthenticated;

  bool get isRetryable => status >= 500 || code == ErrorCode.rateLimited;

  @override
  String toString() => detail ?? title;
}

/// The request never reached the API: offline, DNS, TLS, or a timeout we imposed.
class ResetNetworkException implements Exception {
  ResetNetworkException(this.message, {this.timedOut = false});

  final String message;
  final bool timedOut;

  @override
  String toString() => message;
}

/// The RESET API over `http`.
///
/// Mirrors `packages/api-client` deliberately closely — same refresh semantics, same error
/// shape — so a bug fixed on one side is findable on the other. What it cannot share is the
/// types: Dart cannot import Zod, so the enums come from `pnpm gen:api` and the models are
/// hand-written next to the screens that use them.
class ResetApiClient {
  ResetApiClient({
    required this.baseUrl,
    required TokenStore tokens,
    http.Client? httpClient,
    this.onAuthFailure,
    this.timeout = const Duration(seconds: 20),
  })  : _tokens = tokens,
        _http = httpClient ?? http.Client();

  static const String _prefix = '/api/v1';

  final String baseUrl;
  final TokenStore _tokens;
  final http.Client _http;
  final void Function()? onAuthFailure;
  final Duration timeout;

  /// The in-flight refresh, shared by every request that 401s while it runs.
  ///
  /// Refresh tokens rotate: the server issues a new pair and invalidates the old one. Six
  /// requests waking up together behind an expired access token would otherwise fire six
  /// refreshes with the same token — the first succeeds and the rest are rejected as
  /// replays, signing the user out mid-session. One future, shared.
  Future<bool>? _refreshInFlight;

  /// Exposed so the repository can persist tokens after a sign-in, which is the one place
  /// outside this class that legitimately writes them.
  TokenStore get tokens => _tokens;

  bool get isAuthenticated => _tokens.access != null;

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) =>
      _send<T>('GET', path, query: query);

  Future<T> post<T>(
    String path, {
    Object? body,
    String? idempotencyKey,
    bool anonymous = false,
  }) =>
      _send<T>('POST', path,
          body: body, idempotencyKey: idempotencyKey, anonymous: anonymous);

  Future<T> patch<T>(String path, {Object? body}) =>
      _send<T>('PATCH', path, body: body);

  Future<T> delete<T>(String path, {Object? body}) =>
      _send<T>('DELETE', path, body: body);

  Future<T> _send<T>(
    String method,
    String path, {
    Map<String, dynamic>? query,
    Object? body,
    String? idempotencyKey,
    bool anonymous = false,
    bool isRetry = false,
  }) async {
    final uri = _buildUri(path, query);
    final headers = <String, String>{
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
      if (idempotencyKey != null) 'Idempotency-Key': idempotencyKey,
      if (!anonymous && _tokens.access != null)
        'Authorization': 'Bearer ${_tokens.access}',
    };

    late final http.Response response;
    try {
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) request.body = jsonEncode(body);

      final streamed = await _http.send(request).timeout(timeout);
      response = await http.Response.fromStream(streamed);
    } on TimeoutException {
      throw ResetNetworkException('The request timed out.', timedOut: true);
    } catch (_) {
      throw ResetNetworkException('Could not reach RESET. Check your connection.');
    }

    if (response.statusCode == 401 && !anonymous && !isRetry) {
      final refreshed = await _refresh();
      if (refreshed) {
        return _send<T>(method, path,
            query: query,
            body: body,
            idempotencyKey: idempotencyKey,
            anonymous: anonymous,
            isRetry: true);
      }
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (response.statusCode == 204 || response.bodyBytes.isEmpty) {
        return null as T;
      }
      // utf8.decode, not response.body — the latter guesses latin-1 when the server omits
      // a charset, which turns ₹ into mojibake on every price in the app.
      return jsonDecode(utf8.decode(response.bodyBytes)) as T;
    }

    throw _problemFrom(response);
  }

  ResetApiException _problemFrom(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) {
        return ResetApiException(
          // Null for a code this build does not know — a server newer than the app must
          // not crash it, and `null` is something the UI can fall through on.
          code: ErrorCode.tryParse(decoded['code'] as String?),
          status: (decoded['status'] as num?)?.toInt() ?? response.statusCode,
          title: decoded['title'] as String? ?? 'Request failed',
          detail: decoded['detail'] as String?,
        );
      }
    } catch (_) {
      // A proxy's HTML error page, or a truncated body. Fall through.
    }

    return ResetApiException(
      code: _statusToCode(response.statusCode),
      status: response.statusCode,
      title: 'Request failed',
    );
  }

  static ErrorCode? _statusToCode(int status) => switch (status) {
        401 => ErrorCode.unauthenticated,
        403 => ErrorCode.forbidden,
        404 => ErrorCode.notFound,
        429 => ErrorCode.rateLimited,
        _ => status >= 500 ? ErrorCode.internal : ErrorCode.validationFailed,
      };

  Future<bool> _refresh() {
    return _refreshInFlight ??= _performRefresh().whenComplete(() {
      _refreshInFlight = null;
    });
  }

  Future<bool> _performRefresh() async {
    final refreshToken = _tokens.refresh;
    if (refreshToken == null) {
      await _failAuth();
      return false;
    }

    try {
      final response = await _http
          .post(
            _buildUri('/auth/refresh', null),
            headers: const {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'refreshToken': refreshToken}),
          )
          .timeout(timeout);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        await _failAuth();
        return false;
      }

      final decoded =
          jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
      await _tokens.save(
        access: decoded['accessToken'] as String,
        refresh: decoded['refreshToken'] as String,
      );
      return true;
    } catch (_) {
      // The network failed rather than the token being rejected. Keep the tokens: they may
      // be perfectly valid, and discarding them signs someone out for going through a
      // tunnel. The original request still surfaces its own error.
      return false;
    }
  }

  Future<void> _failAuth() async {
    await _tokens.clear();
    onAuthFailure?.call();
  }

  Uri _buildUri(String path, Map<String, dynamic>? query) {
    final normalised = path.startsWith('/') ? path : '/$path';
    final uri = Uri.parse('$baseUrl$_prefix$normalised');

    if (query == null || query.isEmpty) return uri;

    final params = <String, dynamic>{};
    query.forEach((key, value) {
      if (value == null) return;
      if (value is Iterable) {
        final items = value.map((v) => v.toString()).toList();
        if (items.isNotEmpty) params[key] = items;
      } else {
        params[key] = value.toString();
      }
    });

    return uri.replace(queryParameters: params.isEmpty ? null : params);
  }

  void close() => _http.close();
}
