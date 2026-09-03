import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'account_screen.dart';
import 'bookings_screen.dart';
import 'home_screen.dart';
import 'rewards_screen.dart';
import 'shop_screen.dart';

/// The tab shell.
///
/// Five destinations, each with its own [Navigator] so pushing a service and then switching
/// tabs does not lose the stack — someone who taps Rewards mid-browse comes back to exactly
/// where they were.
///
/// Shop sits between Visits and Rewards. The website has had one throughout and the app had
/// none, so the shelf was simply unreachable on Android.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _index = 0;
  final _navigators = List.generate(5, (_) => GlobalKey<NavigatorState>());

  static const _destinations = [
    NavigationDestination(
      icon: Icon(Icons.calendar_today_outlined),
      selectedIcon: Icon(Icons.calendar_today),
      label: 'Book',
    ),
    NavigationDestination(
      icon: Icon(Icons.confirmation_number_outlined),
      selectedIcon: Icon(Icons.confirmation_number),
      label: 'Visits',
    ),
    NavigationDestination(
      icon: Icon(Icons.shopping_bag_outlined),
      selectedIcon: Icon(Icons.shopping_bag),
      label: 'Shop',
    ),
    NavigationDestination(
      icon: Icon(Icons.card_giftcard_outlined),
      selectedIcon: Icon(Icons.card_giftcard),
      label: 'Rewards',
    ),
    NavigationDestination(
      icon: Icon(Icons.person_outline),
      selectedIcon: Icon(Icons.person),
      label: 'You',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Back inside a tab pops that tab's stack. Only a back press at the root of the
      // first tab leaves the app — anything else would drop someone out mid-booking.
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;

        final navigator = _navigators[_index].currentState;
        if (navigator != null && navigator.canPop()) {
          navigator.pop();
        } else if (_index != 0) {
          setState(() => _index = 0);
        } else {
          Navigator.of(context).maybePop();
        }
      },
      child: Scaffold(
        body: IndexedStack(
          index: _index,
          children: [
            _TabNavigator(navigatorKey: _navigators[0], child: const HomeScreen()),
            _TabNavigator(navigatorKey: _navigators[1], child: const BookingsScreen()),
            _TabNavigator(navigatorKey: _navigators[2], child: const ShopScreen()),
            _TabNavigator(navigatorKey: _navigators[3], child: const RewardsScreen()),
            _TabNavigator(navigatorKey: _navigators[4], child: const AccountScreen()),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          destinations: _destinations,
          onDestinationSelected: (next) {
            // Tapping the tab you are already on pops that tab to its root — the standard
            // gesture for "take me back to the top of this section".
            if (next == _index) {
              _navigators[next].currentState?.popUntil((route) => route.isFirst);
            } else {
              setState(() => _index = next);
            }
          },
        ),
      ),
    );
  }
}

class _TabNavigator extends StatelessWidget {
  const _TabNavigator({required this.navigatorKey, required this.child});

  final GlobalKey<NavigatorState> navigatorKey;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Navigator(
      key: navigatorKey,
      onGenerateRoute: (settings) => MaterialPageRoute<void>(
        settings: settings,
        builder: (_) => child,
      ),
    );
  }
}
