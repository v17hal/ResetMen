import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reset_app/src/screens/rewards_screen.dart';

import 'support/fake_api.dart';

/// The Rewards tab, against the envelope the API actually sends.
///
/// Both lists arrive as `{"data": [...]}`; the app read them as bare arrays, so the cast
/// threw and the screen said "Could not load your cards" and "Could not load your wallet"
/// with nothing wrong on the server. Nothing caught it: the models were tested with the
/// right shape, and no test put the repository in front of the screen. Found on a phone.
void main() {
  Map<String, dynamic> card() => {
        'id': 'card-1',
        'campaignName': 'Monsoon scratch',
        'status': 'ISSUED',
        'reward': {'label': '₹50 off your next visit'},
      };

  Map<String, dynamic> walletReward() => {
        'id': 'rw-1',
        'label': 'Free upgrade',
        'validTill': '2026-12-31T00:00:00.000Z',
        'status': 'ACTIVE',
        'applicable': true,
        'discountPaise': 5000,
        'postVisitCreditPaise': 0,
        'minOrderPaise': 0,
      };

  FakeApi apiWith({required Object cards, required Object wallet}) => FakeApi({
        'GET /auth/me': (_) => ok(userJson),
        'GET /rewards/streak': (_) =>
            ok({'currentCount': 2, 'bestCount': 3, 'totalVisits': 9}),
        'GET /rewards/scratch-cards': (_) => ok(cards),
        'GET /rewards/wallet': (_) => ok(wallet),
      });

  testWidgets('reads the cards and the wallet out of the data envelope', (tester) async {
    await pumpScreen(
      tester,
      const RewardsScreen(),
      signedIn: true,
      api: apiWith(cards: {'data': [card()]}, wallet: {'data': [walletReward()]}),
    );
    await settle(tester);

    expect(find.text('Could not load your cards.'), findsNothing);
    expect(find.text('Could not load your wallet.'), findsNothing);
    expect(find.text('Monsoon scratch'), findsOneWidget);

    // The wallet sits below the cards, and the list builds lazily: without scrolling, its
    // rows are never created and the assertion tests nothing.
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -700));
    await settle(tester);
    expect(find.text('Free upgrade'), findsOneWidget);
  });

  testWidgets('an empty envelope is empty, not an error', (tester) async {
    await pumpScreen(
      tester,
      const RewardsScreen(),
      signedIn: true,
      api: apiWith(cards: {'data': <Object>[]}, wallet: {'data': <Object>[]}),
    );
    await settle(tester);

    expect(find.text('Could not load your cards.'), findsNothing);
    expect(find.text('Could not load your wallet.'), findsNothing);
    expect(find.text('No rewards yet'), findsOneWidget);
  });
}
