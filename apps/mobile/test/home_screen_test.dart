import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reset_app/src/screens/home_screen.dart';
import 'package:reset_app/src/widgets/common.dart';

import 'support/fake_api.dart';

/// The menu, against the shape `getHome` in apps/api/src/catalog/catalog.service.ts sends.
void main() {
  // The client's own example: "💆‍♂️ Tension Relief — Head, Neck & Shoulder — ₹49, was ₹149".
  const dressed = {
    'id': 'svc-tension',
    'name': 'Tension Relief',
    'slug': 'tension-relief',
    'description': 'Ten minutes on the knots you carry.',
    'imageUrl': null,
    'pricePaise': 4900,
    'durationMinutes': 10,
    'categoryId': 'cat-quick',
    'emoji': '💆‍♂️',
    'tagline': 'Head, Neck & Shoulder',
    'compareAtPricePaise': 14900,
    'badge': 'Bestseller',
  };

  // A service nobody has dressed up. Its description mentions "head" on purpose.
  const plain = {
    'id': 'svc-back',
    'name': 'Back Reset',
    'slug': 'back-reset',
    'description': 'Twenty minutes, head to toe.',
    'imageUrl': null,
    'pricePaise': 9900,
    'durationMinutes': 20,
    'categoryId': 'cat-quick',
    'emoji': null,
    'tagline': null,
    'compareAtPricePaise': null,
    'badge': null,
  };

  Map<String, dynamic> home(List<Map<String, dynamic>> services) => {
        'segments': [
          {'id': 'seg-men', 'name': 'Men', 'imageUrl': null},
        ],
        'activeSegmentId': 'seg-men',
        'banners': <Object>[],
        'categories': [
          {
            'id': 'cat-quick',
            'name': 'Quick relief',
            'description': null,
            'serviceCount': services.length,
            'fromPricePaise': 4900,
          },
        ],
        'services': services,
      };

  FakeApi api(Map<String, dynamic> body) =>
      FakeApi({'GET /catalog/home': (_) => ok(body)});

  testWidgets('dresses a service the way the client writes the menu', (tester) async {
    await pumpScreen(tester, const HomeScreen(), api: api(home([dressed, plain])));

    expect(find.textContaining('💆‍♂️ Tension Relief'), findsOneWidget);
    expect(find.text('BESTSELLER'), findsOneWidget,
        reason: 'the badge is drawn in capitals whatever the admin typed');
    expect(find.text('Head, Neck & Shoulder'), findsOneWidget);
    expect(find.text('₹49'), findsOneWidget);
    expect(find.text('67% OFF'), findsOneWidget);

    final was = tester.widget<Text>(find.text('₹149'));
    expect(was.style?.decoration, TextDecoration.lineThrough);
  });

  testWidgets('an undressed service looks as it did before', (tester) async {
    await pumpScreen(tester, const HomeScreen(), api: api(home([plain])));

    expect(find.text('Back Reset'), findsOneWidget);
    expect(find.text('₹99'), findsOneWidget);
    expect(find.text('20m'), findsOneWidget);
    expect(find.textContaining('% OFF'), findsNothing);
    expect(find.textContaining('BESTSELLER'), findsNothing);
  });

  testWidgets('searching "head" finds the service whose tagline says head', (tester) async {
    await pumpScreen(tester, const HomeScreen(), api: api(home([dressed, plain])));

    await tester.enterText(find.byType(TextField), 'head');
    await settle(tester);

    expect(find.textContaining('Tension Relief'), findsOneWidget);
    expect(find.text('Back Reset'), findsNothing,
        reason: '"head to toe" in a description is a fallback, not a peer of a name');
  });

  testWidgets('with nothing bookable, points to Help rather than a phone', (tester) async {
    await pumpScreen(tester, const HomeScreen(), api: api(home([])));

    expect(find.text('Ask us through Help and we will sort it out.'), findsOneWidget);
    expect(find.textContaining('call the store'), findsNothing);
  });

  testWidgets('the help button opens Help, which asks a visitor to sign in', (tester) async {
    await pumpScreen(tester, const HomeScreen(), api: api(home([plain])));

    await tester.tap(find.byTooltip('Help'));
    await settle(tester);

    expect(find.text('Sign in to ask us'), findsOneWidget);
  });

  testWidgets('the help button carries a dot when the store has replied', (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      signedIn: true,
      api: FakeApi({
        'GET /catalog/home': (_) => ok(home([plain])),
        'GET /auth/me': (_) => ok(userJson),
        'GET /support/threads': (_) => ok({
              'data': [
                {
                  'id': 'thr-1',
                  'publicId': 'HLP-7Q2K4M',
                  'subject': 'Moving my Saturday booking',
                  'status': 'OPEN',
                  'lastMessageAt': '2026-09-11T05:00:00.000Z',
                  'lastMessageBy': 'STAFF',
                  'createdAt': '2026-09-11T04:00:00.000Z',
                  'unread': true,
                  'preview': 'Yes — we have moved you to 11am.',
                  'booking': null,
                },
              ],
            }),
      }),
    );

    expect(find.byTooltip('Help — new reply'), findsOneWidget);
  });

  testWidgets('a menu that fails on a cold start shows the error, not a crash',
      (tester) async {
    await pumpScreen(
      tester,
      const HomeScreen(),
      api: FakeApi({
        'GET /catalog/home': (_) => problem(503, 'INTERNAL', 'Back in a moment.'),
      }),
    );

    expect(tester.takeException(), isNull);
    expect(find.byType(ErrorView), findsOneWidget);
  });
}
