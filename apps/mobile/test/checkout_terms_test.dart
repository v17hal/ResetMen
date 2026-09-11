import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:reset_app/src/screens/checkout_screen.dart';

import 'support/fake_api.dart';

/// The Terms checkbox at checkout — a legal requirement from the client, 11/09/2026.
void main() {
  const staleDetail = 'Our Terms & Conditions have been updated. Please read them again '
      'and tick the box to continue.';

  /// `TERMS` in packages/types/src/terms.ts, as `GET /catalog/terms` serves it.
  Map<String, dynamic> terms({String version = '2026-09-11'}) => {
        'version': version,
        'title': 'RESETMEN – Terms & Conditions',
        'clauses': [
          'RESETMEN provides non-medical wellness, relaxation and body-care services only. We do not provide medical treatment, diagnosis or physiotherapy.',
          'Customers must inform RESETMEN of any relevant health condition, injury, allergy, recent surgery or other circumstance that may affect their session.',
          'Services are provided without removal of clothing. No sexual, intimate or inappropriate services are provided.',
          'Bookings, cancellations, rescheduling and refunds are subject to the RESETMEN Cancellation & Refund Policy.',
          'Individual experiences and results may vary. RESETMEN does not guarantee any specific medical or physical outcome.',
          'By making payment, you confirm that you have read and agreed to these Terms & Conditions and the applicable policies.',
        ],
        'agreement': 'I agree to the Terms & Conditions and understand that RESETMEN '
            'provides non-medical wellness services only',
      };

  Map<String, FakeReply Function(http.Request)> routes({
    FakeReply Function(http.Request)? termsRoute,
    FakeReply Function(http.Request)? hold,
  }) =>
      {
        'GET /catalog/store': (_) => ok({
              'id': 'store-1',
              'name': 'RESET',
              'timezone': 'Asia/Kolkata',
              'address': null,
              'phone': null,
              'bookingHorizonDays': 14,
              'cancellationWindowMinutes': 120,
              'paymentsEnabled': false,
            }),
        'POST /bookings/quote': (_) => ok({
              'serviceId': 'svc-tension',
              'serviceName': 'Tension Relief',
              'durationMinutes': 10,
              'basePricePaise': 4900,
              'addonsPricePaise': 0,
              'discountPaise': 0,
              'payablePaise': 4900,
              'addons': <Object>[],
              'appliedReward': null,
            }),
        'GET /catalog/terms': termsRoute ?? (_) => ok(terms()),
        'GET /auth/me': (_) => ok(userJson),
        'GET /rewards/wallet': (_) => ok(<Object>[]),
        if (hold != null) 'POST /bookings/hold': hold,
      };

  const screen = CheckoutScreen(
    serviceId: 'svc-tension',
    startsAt: '2026-09-12T10:00:00+05:30',
    addonIds: [],
  );

  VoidCallback? book(WidgetTester tester) =>
      tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Book')).onPressed;

  bool? ticked(WidgetTester tester) => tester.widget<Checkbox>(find.byType(Checkbox)).value;

  testWidgets('Book stays disabled until the Terms are ticked', (tester) async {
    await pumpScreen(tester, screen, api: FakeApi(routes()));

    expect(find.textContaining('non-medical wellness services only'), findsOneWidget);
    expect(ticked(tester), isFalse, reason: 'a box ticked on their behalf is not agreement');
    expect(book(tester), isNull);

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    expect(book(tester), isNotNull);

    // The words beside the box tick it too — only "Terms & Conditions" is a link.
    await tester.tapAt(
      tester.getBottomRight(find.textContaining('non-medical wellness')) -
          const Offset(4, 4),
    );
    await tester.pump();
    expect(ticked(tester), isFalse);
    expect(book(tester), isNull);
  });

  testWidgets('"Terms & Conditions" opens the full text without ticking the box',
      (tester) async {
    await pumpScreen(tester, screen, api: FakeApi(routes()));

    await tester.tapOnText(find.textRange.ofSubstring('Terms & Conditions'));
    await settle(tester);

    expect(find.text('RESETMEN – Terms & Conditions'), findsOneWidget);
    expect(find.textContaining('without removal of clothing'), findsOneWidget);
    // The list is lazy: clause 6 and the policy sit below the fold and are not built
    // until scrolled to, so looking for them straight away failed on a correct screen.
    await tester.scrollUntilVisible(find.text('6.'), 200, scrollable: find.byType(Scrollable).last);
    expect(find.text('6.'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Cancellation & refunds'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Cancellation & refunds'), findsOneWidget);
    expect(
      find.text('Free cancellation up to 2 hours before your slot, from Visits in the '
          'app. Payment is taken at the counter, and any refund is made at the counter.'),
      findsOneWidget,
    );

    await tester.pageBack();
    await settle(tester);
    expect(ticked(tester), isFalse);
  });

  testWidgets('Terms that fail to load offer a retry, and Book stays disabled',
      (tester) async {
    var attempts = 0;
    await pumpScreen(
      tester,
      screen,
      api: FakeApi(routes(
        termsRoute: (_) => ++attempts == 1
            ? problem(503, 'INTERNAL', 'Back in a moment.')
            : ok(terms()),
      )),
    );

    expect(find.byType(Checkbox), findsNothing);
    expect(find.text('Could not load the Terms & Conditions.'), findsOneWidget);
    expect(book(tester), isNull);

    await tester.tap(find.widgetWithText(TextButton, 'Try again'));
    await settle(tester);

    expect(find.byType(Checkbox), findsOneWidget);
    expect(book(tester), isNull, reason: 'loading the text is not agreeing to it');
  });

  testWidgets('a booking refused for out-of-date Terms unticks the box and says why',
      (tester) async {
    var fetches = 0;
    final api = FakeApi(routes(
      termsRoute: (_) =>
          ok(terms(version: ++fetches == 1 ? '2026-09-11' : '2026-10-01')),
      hold: (_) => problem(
        422,
        'VALIDATION_FAILED',
        staleDetail,
        meta: const {'field': 'termsVersion', 'currentVersion': '2026-10-01'},
      ),
    ));
    await pumpScreen(tester, screen, api: api, signedIn: true);

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Book'));
    await settle(tester);

    expect(api.lastBody('POST /bookings/hold')['termsVersion'], '2026-09-11',
        reason: 'the booking says which text was agreed to');
    expect(find.text(staleDetail), findsOneWidget);
    expect(ticked(tester), isFalse);
    expect(book(tester), isNull);
    expect(api.calls('GET /catalog/terms'), 2, reason: 'the new text is fetched');

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    expect(book(tester), isNotNull);
  });
}
