import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../providers.dart';
import '../services/deep_links.dart';
import 'account_screen.dart';
import 'bookings_screen.dart';
import 'confirmation_screen.dart';
import 'help_screen.dart';
import 'help_thread_screen.dart';
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

  /// Whom this device is registered for, so that a later sign-in on the same run —
  /// somebody else picking up the phone — registers it again for them.
  String? _pushUserId;
  StreamSubscription<String>? _tokenRefresh;

  @override
  void initState() {
    super.initState();

    // Push starts once somebody is signed in: the permission prompt comes after sign-in
    // rather than on first launch (see PushService), and a device is registered against an
    // account, not against nobody.
    ref.listenManual<AsyncValue<UserProfile?>>(
      sessionProvider,
      (_, next) {
        final user = next.valueOrNull;
        if (user == null) {
          if (!next.isLoading) _pushUserId = null;
          return;
        }
        if (user.id != _pushUserId) {
          _pushUserId = user.id;
          unawaited(_startPush());
        }
      },
      fireImmediately: true,
    );
  }

  @override
  void dispose() {
    _tokenRefresh?.cancel();
    super.dispose();
  }

  /// Registers this device for reminders and replies, and routes taps on them.
  ///
  /// Nothing called `PushService.start` before this, so no notification the API sent could
  /// open anything, and no device was ever registered to receive one — the "RESET replied"
  /// push for Help depends on both. Never fatal: push is additive, and a phone that cannot
  /// reach FCM (or has no Firebase at all) must still book.
  Future<void> _startPush() async {
    try {
      final push = ref.read(pushProvider);
      final repository = ref.read(repositoryProvider);

      final token = await push.start(onOpen: _openDeepLink);
      if (token != null) await repository.registerDevice(token);

      _tokenRefresh ??= push.tokenRefreshes.listen((fresh) {
        if (!repository.isAuthenticated) return;
        unawaited(repository.registerDevice(fresh).catchError((Object _) {}));
      });
    } catch (error) {
      debugPrint('Push not started: $error');
    }
  }

  /// Takes a tapped notification to its screen, on the tab it belongs to.
  ///
  /// Each tab keeps its own stack, so the screen goes onto that tab's navigator and the tab
  /// is selected — Back then returns to wherever that tab already was, rather than out of
  /// the app. Whatever the notification is about is refetched on the way, because it is by
  /// definition newer than anything on screen.
  void _openDeepLink(String raw) {
    final link = DeepLink.parse(raw);
    if (link == null || !mounted) return;

    final (int, Widget?) target = switch (link) {
      BookingLink(:final bookingId) => (1, ConfirmationScreen(bookingId: bookingId)),
      OrdersLink() => (2, null),
      RewardsLink() => (3, null),
      HelpLink() => (4, const HelpScreen()),
      HelpThreadLink(:final threadId) => (4, HelpThreadScreen(threadId: threadId)),
    };

    switch (link) {
      case BookingLink():
        ref.invalidate(bookingsProvider('upcoming'));
      case OrdersLink():
        ref.invalidate(productOrdersProvider);
      case RewardsLink():
        ref.invalidate(streakProvider);
        ref.invalidate(scratchCardsProvider);
        ref.invalidate(walletProvider);
      case HelpLink() || HelpThreadLink():
        ref.invalidate(supportThreadsProvider);
    }

    final (tab, screen) = target;
    setState(() => _index = tab);
    if (screen == null) return;

    // After the frame, so a notification that launched the app finds the tab's navigator
    // built before anything is pushed onto it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _navigators[tab].currentState?.push(
            MaterialPageRoute<void>(builder: (_) => screen),
          );
    });
  }

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
