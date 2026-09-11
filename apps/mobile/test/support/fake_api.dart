import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:reset_app/src/api/api_client.dart';
import 'package:reset_app/src/api/token_store.dart';
import 'package:reset_app/src/providers.dart';
import 'package:reset_app/src/theme/app_theme.dart';

/// The API, faked at the HTTP layer.
///
/// Below the repository rather than instead of it, so every widget test also runs the real
/// client and the real `fromJson` — the layer where a client declaring a field the API never
/// sends has bitten this project before. Routes are `METHOD /path`, without `/api/v1` or the
/// query string. Anything unrouted is a 404, which a test will notice.
class FakeApi {
  FakeApi(this.routes);

  final Map<String, FakeReply Function(http.Request request)> routes;
  final List<http.Request> requests = [];

  static String _route(http.BaseRequest request) =>
      '${request.method} ${request.url.path.replaceFirst('/api/v1', '')}';

  int calls(String route) => requests.where((r) => _route(r) == route).length;

  /// The JSON body of the most recent request to [route].
  Map<String, dynamic> lastBody(String route) =>
      jsonDecode(requests.lastWhere((r) => _route(r) == route).body)
          as Map<String, dynamic>;

  late final http.Client client = MockClient((request) async {
    requests.add(request);
    final handler = routes[_route(request)];
    final reply = handler == null
        ? problem(404, 'NOT_FOUND', 'No fake for ${_route(request)}')
        : handler(request);
    return http.Response.bytes(
      utf8.encode(jsonEncode(reply.body)),
      reply.status,
      headers: const {'content-type': 'application/json; charset=utf-8'},
    );
  });
}

typedef FakeReply = ({int status, Object? body});

FakeReply ok(Object? body, {int status = 200}) => (status: status, body: body);

/// An RFC 9457 problem, shaped as `AppError` renders one.
FakeReply problem(
  int status,
  String code,
  String detail, {
  Map<String, dynamic> meta = const {},
}) =>
    (
      status: status,
      body: {
        'type': 'about:blank',
        'code': code,
        'status': status,
        'title': 'Request failed',
        'detail': detail,
        'meta': meta,
      },
    );

/// As `/auth/me` returns a customer with everything filled in.
const userJson = {
  'id': 'user-1',
  'phone': '+919404491801',
  'name': 'Vikram',
  'email': 'vikram@example.com',
  'gender': 'MALE',
  'dateOfBirth': null,
};

/// Mounts [screen] the way the app does — its theme, a ProviderScope — against [api].
Future<void> pumpScreen(
  WidgetTester tester,
  Widget screen, {
  required FakeApi api,
  bool signedIn = false,
}) async {
  // A phone in portrait, not the harness's 800×600 landscape.
  tester.view.physicalSize = const Size(1200, 2700);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  FlutterSecureStorage.setMockInitialValues(
    signedIn
        ? {'reset.access': 'access-token', 'reset.refresh': 'refresh-token'}
        : <String, String>{},
  );
  final tokens = TokenStore();
  await tokens.load();

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        apiClientProvider.overrideWithValue(
          ResetApiClient(
            baseUrl: 'http://api.test',
            tokens: tokens,
            httpClient: api.client,
          ),
        ),
      ],
      child: MaterialApp(theme: AppTheme.light(), home: screen),
    ),
  );
  await settle(tester);
}

/// Lets requests land and frames draw.
///
/// Not `pumpAndSettle`: skeletons pulse forever, so it would never return while anything is
/// still loading — which looks exactly like a hung screen.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}
