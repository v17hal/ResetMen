import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'src/api/token_store.dart';
import 'src/providers.dart';
import 'src/screens/app_shell.dart';
import 'src/services/booking_cache.dart';
import 'src/theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Both of these are read before the first frame, and only these two. The keystore
  // decides whether the app opens signed in, and the booking cache is what makes the QR
  // screen work with no signal — deferring either means a visible flash of the wrong state.
  final tokens = TokenStore();
  await tokens.load();
  final cache = await BookingCache.open();

  // Portrait only. The booking flow is a single column of forms and a slot grid; landscape
  // buys nothing and doubles the layouts that need testing before launch.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(
    ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(tokens),
        bookingCacheProvider.overrideWithValue(cache),
      ],
      child: const ResetApp(),
    ),
  );
}

class ResetApp extends StatelessWidget {
  const ResetApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RESET',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      // Follows the OS. The dark scheme is the one the brand was designed around — see the
      // note on ResetColorsDark in the generated tokens.
      themeMode: ThemeMode.system,
      builder: (context, child) {
        // Caps text scaling. Someone at 200% is a real user and the layout must hold, but
        // Android allows far more than that and the slot grid stops being usable well
        // before the top of the range.
        final scale = MediaQuery.textScalerOf(context).clamp(
          minScaleFactor: 0.85,
          maxScaleFactor: 2.0,
        );
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: scale),
          child: child ?? const SizedBox.shrink(),
        );
      },
      home: const AppShell(),
    );
  }
}
