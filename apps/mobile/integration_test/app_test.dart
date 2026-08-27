// End-to-end tests, driven on a real device against the real API.
//
//   flutter test integration_test/app_test.dart -d <device> \
//     --dart-define=API_URL=https://api.resetmen.in
//
// These are read-only on purpose. Booking through the UI would leave confirmed rows in the
// production database that take a station through the exclusion constraint, and a suite
// nobody dares re-run is worse than no suite. The booking write path is covered against the
// API directly, where the rows can be cleaned up.
//
// `pumpAndSettle` is avoided while anything is loading. Skeleton pulses with `repeat()`, so
// the frame queue never drains and settle would sit there until it times out — which looks
// exactly like a hung app. [waitFor] polls instead.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reset_app/main.dart' as app;

/// Pumps until [finder] matches, or fails with something that says what was on screen.
Future<void> waitFor(
  WidgetTester tester,
  Finder finder, {
  Duration timeout = const Duration(seconds: 30),
  String? because,
}) async {
  final deadline = DateTime.now().add(timeout);

  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 200));
    if (finder.evaluate().isNotEmpty) return;
  }

  final visible = tester
      .widgetList<Text>(find.byType(Text))
      .map((t) => t.data)
      .whereType<String>()
      .take(15)
      .join(' | ');

  fail(
    'Timed out after ${timeout.inSeconds}s waiting for: ${finder.describeMatch(Plurality.one)}'
    '${because == null ? '' : '\n  expected because: $because'}'
    '\n  text on screen: $visible',
  );
}

/// Taps a bottom-navigation destination by its label.
Future<void> tapTab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).last);
  await tester.pump(const Duration(milliseconds: 600));
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('shell and navigation', () {
    testWidgets('opens on Book with all four destinations', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));

      for (final label in ['Book', 'Visits', 'Rewards', 'You']) {
        expect(
          find.text(label),
          findsWidgets,
          reason: '$label destination missing from the shell',
        );
      }
    });

    testWidgets('every tab opens without throwing', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));

      for (final label in ['Visits', 'Rewards', 'You', 'Book']) {
        await tapTab(tester, label);
        expect(
          tester.takeException(),
          isNull,
          reason: 'opening $label threw',
        );
      }
    });

    testWidgets('each tab keeps its own stack', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));

      // Open a service, leave the tab, come back. The service should still be there:
      // switching tabs mid-browse must not throw away where someone was.
      await waitFor(tester, find.text('Head'), because: 'the live menu should list Head');
      await tester.tap(find.text('Head').first);
      await tester.pump(const Duration(seconds: 2));

      await tapTab(tester, 'Rewards');
      await tapTab(tester, 'Book');

      expect(
        find.text('Book your reset'),
        findsNothing,
        reason: 'returning to Book should land back on the service, not the root',
      );
    });
  });

  group('back button', () {
    testWidgets('back inside a tab pops that stack, not the app', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));

      await waitFor(tester, find.text('Head'));
      await tester.tap(find.text('Head').first);
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('Book your reset'), findsNothing);

      await tester.pageBack();
      await tester.pump(const Duration(seconds: 1));

      expect(
        find.text('Book your reset'),
        findsOneWidget,
        reason: 'back from a service should return to the menu',
      );
    });

    testWidgets('back from another tab returns to Book', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));

      await tapTab(tester, 'Rewards');
      expect(find.text('Book your reset'), findsNothing);

      // The shell handles this itself: at the root of a non-first tab, back goes to Book
      // rather than dropping out of the app.
      final popped = await tester.binding.handlePopRoute();
      await tester.pump(const Duration(milliseconds: 800));

      expect(popped, isTrue);
      expect(
        find.text('Book your reset'),
        findsOneWidget,
        reason: 'back at the root of Rewards should land on Book, not exit',
      );
    });
  });

  group('live catalog', () {
    testWidgets('renders categories and services from the API', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));

      await waitFor(
        tester,
        find.text('Stress Relief'),
        because: 'the seeded catalog exposes a Stress Relief category',
      );

      expect(find.text('Head'), findsWidgets);
      expect(
        find.textContaining('₹'),
        findsWidgets,
        reason: 'service rows show a price',
      );
    });

    testWidgets('service detail opens and shows the service', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));
      await waitFor(tester, find.text('Head'));

      await tester.tap(find.text('Head').first);
      await tester.pump(const Duration(seconds: 3));

      expect(tester.takeException(), isNull);
      expect(
        find.textContaining('₹'),
        findsWidgets,
        reason: 'the detail screen prices the service',
      );
    });
  });

  group('signed out', () {
    testWidgets('Visits, Rewards and You render without a session', (tester) async {
      app.main();
      await waitFor(tester, find.text('Book your reset'));

      for (final label in ['Visits', 'Rewards', 'You']) {
        await tapTab(tester, label);
        await tester.pump(const Duration(seconds: 2));

        expect(
          tester.takeException(),
          isNull,
          reason: '$label threw while signed out',
        );
        expect(
          find.byType(Scaffold),
          findsWidgets,
          reason: '$label rendered nothing while signed out',
        );
      }
    });
  });
}
