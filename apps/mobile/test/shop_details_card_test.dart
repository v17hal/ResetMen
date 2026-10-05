import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reset_app/src/api/models.dart';
import 'package:reset_app/src/widgets/shop_details_card.dart';

import 'support/fake_api.dart';

/// The shop's details card — client request 05/10/2026: every line editable from the admin
/// panel. Built from the JSON the API sends, so a field the app forgets to read fails here
/// rather than on a customer's phone.
void main() {
  Map<String, dynamic> storeJson({
    bool showPhone = false,
    String? contactNote,
    String? tagline,
    String audience = 'EVERYONE',
  }) =>
      {
        'id': 'store-1',
        'name': 'RESET',
        'timezone': 'Asia/Kolkata',
        'address': 'Shreenad Apartment, 3rd Floor, Opposite Vijay Sales, Tilak Road',
        'city': 'Pune',
        'phone': '+91 73500 24824',
        'showPhone': showPhone,
        'contactNote': contactNote,
        'tagline': tagline,
        'audience': audience,
        'bookingHorizonDays': 7,
        'cancellationWindowMinutes': 120,
        'paymentsEnabled': false,
        'hours': [
          for (var day = 0; day < 7; day++)
            {
              'dayOfWeek': day,
              'opensAt': '08:00',
              'closesAt': '21:30',
              'isClosed': day == 1,
            },
        ],
      };

  Future<void> pumpCard(WidgetTester tester, Map<String, dynamic> json, {VoidCallback? onAsk}) =>
      pumpScreen(
        tester,
        Scaffold(
          body: SingleChildScrollView(
            child: ShopDetailsCard(store: StoreInfo.fromJson(json), onAsk: onAsk ?? () {}),
          ),
        ),
        api: FakeApi({}),
      );

  testWidgets('reads every line from the store, as the admin panel set it', (tester) async {
    await pumpCard(tester, storeJson());

    expect(find.text('RESET Pune'), findsOneWidget);
    expect(find.textContaining('Opposite Vijay Sales'), findsOneWidget);
    expect(find.text('08:00 – 21:30'), findsOneWidget);
    expect(find.text('Closed on Mondays'), findsOneWidget);
    // No tagline written, serving everyone: the standard wording, without "for men".
    expect(find.textContaining('Quick dry massage and wellness —'), findsOneWidget);
  });

  testWidgets('keeps the phone number off the card until the shop switches it on',
      (tester) async {
    await pumpCard(tester, storeJson());
    expect(find.textContaining('Call '), findsNothing);
    expect(find.text('Ask us — we reply in writing'), findsOneWidget);

    await pumpCard(tester, storeJson(showPhone: true, contactNote: 'Or message us on Help'));
    expect(find.text('Call +91 73500 24824'), findsOneWidget);
    expect(find.text('Or message us on Help'), findsOneWidget);
  });

  testWidgets('the Questions line opens Help', (tester) async {
    var asked = 0;
    await pumpCard(tester, storeJson(), onAsk: () => asked++);

    await tester.tap(find.text('Ask us — we reply in writing'));
    expect(asked, 1);
  });

  testWidgets("the shop's own line replaces the standard wording", (tester) async {
    await pumpCard(tester, storeJson(tagline: 'Ten minutes, straight back to work.'));
    expect(find.text('Ten minutes, straight back to work.'), findsOneWidget);
    expect(find.textContaining('Quick dry massage'), findsNothing);
  });
}
