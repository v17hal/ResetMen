import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:reset_app/src/screens/checkout_screen.dart';

import 'support/fake_api.dart';

/// Coupon codes at checkout — client request 06/11/2026.
///
/// The quote is faked the way `quote` in apps/api/src/booking/booking.service.ts prices a
/// ₹245 session, so these run the real repository and the real `Quote.fromJson`.
void main() {
  const reset20 = {
    'id': 'cpn-1',
    'code': 'RESET20',
    'label': '20% off',
    'discountPaise': 4900,
    'postVisitCreditPaise': 0,
  };

  const back50 = {
    'id': 'cpn-2',
    'code': 'BACK50',
    'label': '₹50 cashback',
    'discountPaise': 0,
    'postVisitCreditPaise': 5000,
  };

  const upgrade = {
    'id': 'rw-1',
    'label': 'Free upgrade',
    'discountPaise': 5000,
    'postVisitCreditPaise': 0,
  };

  Map<String, dynamic> quote({Map<String, dynamic>? reward, Map<String, dynamic>? coupon}) {
    final discount = ((reward ?? coupon)?['discountPaise'] as int?) ?? 0;
    return {
      'serviceId': 'svc-tension',
      'serviceName': 'Tension Relief',
      'durationMinutes': 10,
      'basePricePaise': 24500,
      'addonsPricePaise': 0,
      'discountPaise': discount,
      'payablePaise': 24500 - discount,
      'addons': <Object>[],
      'appliedReward': reward,
      'appliedCoupon': coupon,
    };
  }

  /// Prices like the server: normalises the code, refuses a reward and a code together, and
  /// does not recognise anything but the two codes above.
  FakeReply priced(http.Request request) {
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    final code = (body['couponCode'] as String?)?.replaceAll(RegExp(r'\s+'), '').toUpperCase();

    if (body['rewardId'] != null && code != null) {
      return problem(422, 'VALIDATION_FAILED', 'Use a reward or a code on this booking, not both.');
    }
    if (body['rewardId'] == 'rw-1') return ok(quote(reward: upgrade));
    return switch (code) {
      null => ok(quote()),
      'RESET20' => ok(quote(coupon: reset20)),
      'BACK50' => ok(quote(coupon: back50)),
      _ => problem(
          404,
          'COUPON_INVALID',
          'We do not recognise "$code". Check the spelling, or ask at the counter.',
        ),
    };
  }

  Map<String, FakeReply Function(http.Request)> routes({
    FakeReply Function(http.Request)? hold,
    List<Object> wallet = const [],
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
        'POST /bookings/quote': priced,
        'GET /catalog/terms': (_) => ok({
              'version': '2026-09-11',
              'title': 'RESETMEN – Terms & Conditions',
              'clauses': <String>[],
              'agreement': 'I agree to the Terms & Conditions and understand that RESETMEN '
                  'provides non-medical wellness services only',
            }),
        'GET /auth/me': (_) => ok(userJson),
        'GET /rewards/wallet': (_) => ok({'data': wallet}),
        if (hold != null) 'POST /bookings/hold': hold,
      };

  const screen = CheckoutScreen(
    serviceId: 'svc-tension',
    startsAt: '2026-11-07T10:00:00+05:30',
    addonIds: [],
  );

  VoidCallback? apply(WidgetTester tester) =>
      tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Apply')).onPressed;

  VoidCallback? book(WidgetTester tester) =>
      tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Book')).onPressed;

  String typed(WidgetTester tester) =>
      tester.widget<TextField>(find.byType(TextField)).controller!.text;

  Future<void> applyCode(WidgetTester tester, String code) async {
    await tester.tap(find.text('Have a coupon code?'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), code);
    await tester.pump();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Apply'));
    await settle(tester);
  }

  testWidgets('a code is priced on the total and sent with the booking', (tester) async {
    final api = FakeApi(routes(
      hold: (_) => problem(503, 'INTERNAL', 'Back in a moment.'),
    ));
    await pumpScreen(tester, screen, api: api, signedIn: true);

    expect(find.byType(TextField), findsNothing, reason: 'folded away until asked for');
    await tester.tap(find.text('Have a coupon code?'));
    await tester.pump();
    expect(apply(tester), isNull, reason: 'nothing to apply yet');

    await tester.enterText(find.byType(TextField), ' reset20 ');
    await tester.pump();
    expect(apply(tester), isNotNull);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Apply'));
    await settle(tester);

    expect(api.lastBody('POST /bookings/quote')['couponCode'], 'reset20');
    expect(api.lastBody('POST /bookings/quote')['rewardId'], isNull);
    expect(find.text('RESET20 · 20% off'), findsOneWidget, reason: 'the price line names it');
    expect(find.text('RESET20'), findsOneWidget);
    expect(find.text('20% off'), findsOneWidget);
    expect(find.text('−₹49'), findsNWidgets(2));
    expect(find.text('₹196'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Book'));
    await settle(tester);

    expect(api.lastBody('POST /bookings/hold')['couponCode'], 'RESET20',
        reason: 'as the server spelled it back');
    expect(api.lastBody('POST /bookings/hold')['rewardId'], isNull);
  });

  testWidgets('a refused code stays in the field with the reason under it', (tester) async {
    final api = FakeApi(routes());
    await pumpScreen(tester, screen, api: api, signedIn: true);

    await tester.tap(find.text('Have a coupon code?'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'RESET2O');
    // The keyboard's own button applies it.
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);

    expect(api.lastBody('POST /bookings/quote')['couponCode'], 'RESET2O');
    expect(
      find.text('We do not recognise "RESET2O". Check the spelling, or ask at the counter.'),
      findsOneWidget,
    );
    expect(typed(tester), 'RESET2O', reason: 'a typo is one letter to fix');
    expect(find.text('Remove'), findsNothing);
    expect(find.text('₹245'), findsNWidgets(2), reason: 'the price is as it was');
  });

  testWidgets('Remove takes the code off and prices the booking again', (tester) async {
    final api = FakeApi(routes());
    await pumpScreen(tester, screen, api: api, signedIn: true);
    await applyCode(tester, 'RESET20');
    expect(find.text('RESET20 · 20% off'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await settle(tester);

    expect(api.lastBody('POST /bookings/quote')['couponCode'], isNull);
    expect(find.text('RESET20 · 20% off'), findsNothing);
    expect(find.text('Have a coupon code?'), findsOneWidget);
    expect(find.text('₹245'), findsNWidgets(2));
  });

  testWidgets('a code and a reward replace each other', (tester) async {
    final api = FakeApi(routes(wallet: [
      {
        ...upgrade,
        'validTill': '2026-12-31T00:00:00.000Z',
        'status': 'ACTIVE',
        'applicable': true,
        'minOrderPaise': 0,
      },
    ]));
    await pumpScreen(tester, screen, api: api, signedIn: true);

    await tester.tap(find.text('Free upgrade'));
    await settle(tester);
    expect(api.lastBody('POST /bookings/quote')['rewardId'], 'rw-1');

    await applyCode(tester, 'RESET20');
    expect(api.lastBody('POST /bookings/quote')['couponCode'], 'RESET20');
    expect(api.lastBody('POST /bookings/quote')['rewardId'], isNull,
        reason: 'the API refuses the two together');
    expect(find.text('RESET20 · 20% off'), findsOneWidget);
    expect(find.text('Use a reward or a code on this booking, not both.'), findsNothing);

    await tester.tap(find.text('Free upgrade'));
    await settle(tester);
    expect(api.lastBody('POST /bookings/quote')['rewardId'], 'rw-1');
    expect(api.lastBody('POST /bookings/quote')['couponCode'], isNull);
    expect(find.text('RESET20'), findsNothing);
    expect(find.text('Have a coupon code?'), findsOneWidget);
  });

  testWidgets('a cashback code says what comes back rather than taking anything off',
      (tester) async {
    await pumpScreen(tester, screen, api: FakeApi(routes()), signedIn: true);
    await applyCode(tester, 'back50');

    expect(find.text('BACK50'), findsOneWidget);
    expect(find.text('₹50 cashback'), findsOneWidget);
    // On the total, the way a cashback reward is shown, and on the code itself.
    expect(find.text('₹50 back after your visit'), findsNWidgets(2));
    expect(find.textContaining('−'), findsNothing);
    expect(find.text('₹245'), findsNWidgets(2));
  });

  testWidgets('a code refused at booking comes off and the base price comes back',
      (tester) async {
    final api = FakeApi(routes(
      hold: (_) => problem(
        422,
        'COUPON_INVALID',
        'This code has been used up.',
        meta: const {'code': 'RESET20'},
      ),
    ));
    await pumpScreen(tester, screen, api: api, signedIn: true);
    await applyCode(tester, 'RESET20');

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Book'));
    await settle(tester);

    expect(api.lastBody('POST /bookings/hold')['couponCode'], 'RESET20');
    expect(find.text('This code has been used up.'), findsOneWidget);
    expect(api.lastBody('POST /bookings/quote')['couponCode'], isNull,
        reason: 'priced again without it');
    expect(find.text('RESET20 · 20% off'), findsNothing);
    expect(find.text('₹245'), findsNWidgets(2));
    expect(typed(tester), 'RESET20', reason: 'which code, beside why');
    expect(book(tester), isNotNull, reason: 'pressing again books without it');
  });

  testWidgets('a signed-out customer is asked to sign in before a code is checked',
      (tester) async {
    final api = FakeApi(routes());
    await pumpScreen(tester, screen, api: api);
    await applyCode(tester, 'RESET20');

    expect(find.text('So we can check the code against your account.'), findsOneWidget);
    expect(api.calls('POST /bookings/quote'), 1, reason: 'only the first price');
  });
}
