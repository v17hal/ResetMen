// GENERATED FILE — do not edit by hand.
// Source: packages/design-tokens/src/tokens.ts
// Regenerate: pnpm gen:tokens
// ignore_for_file: constant_identifier_names

import 'package:flutter/material.dart';

/// Colours for the light scheme.
class ResetColorsLight {
  ResetColorsLight._();

  static const Color bg = Color(0xFFF8F6F2);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surface2 = Color(0xFFF1EDE6);
  static const Color border = Color(0xFFE4DED4);
  static const Color text = Color(0xFF0B0F14);
  static const Color textMuted = Color(0xFF6B7280);
  static const Color primary = Color(0xFF0E9F76);
  static const Color primaryFg = Color(0xFFFFFFFF);
  static const Color accent = Color(0xFFD97706);
  static const Color success = Color(0xFF0E9F76);
  static const Color warning = Color(0xFFB45309);
  static const Color danger = Color(0xFFDC2626);
  static const Color info = Color(0xFF2563EB);
}

/// Colours for the dark scheme. Men-segment-first, so this is the default look.
class ResetColorsDark {
  ResetColorsDark._();

  static const Color bg = Color(0xFF0B0F14);
  static const Color surface = Color(0xFF12181F);
  static const Color surface2 = Color(0xFF1A222B);
  static const Color border = Color(0xFF252F3A);
  static const Color text = Color(0xFFF3F5F7);
  static const Color textMuted = Color(0xFF9AA6B2);
  static const Color primary = Color(0xFF12B886);
  static const Color primaryFg = Color(0xFF05100C);
  static const Color accent = Color(0xFFF59E0B);
  static const Color success = Color(0xFF12B886);
  static const Color warning = Color(0xFFF59E0B);
  static const Color danger = Color(0xFFF87171);
  static const Color info = Color(0xFF60A5FA);
}

/// Type, spacing, radius, elevation and motion.
///
/// Shaped as a static class with a named [TextTheme], following the convention in the
/// Best-Flutter-UI-Templates reference — it keeps every style reachable without a
/// BuildContext, which matters inside painters and custom clippers.
class ResetTokens {
  ResetTokens._();

  static const String fontDisplay = 'Plus Jakarta Sans';
  static const String fontBody = 'Inter';
  static const String fontMono = 'JetBrains Mono';

  static const TextStyle display = TextStyle(
    fontFamily: fontDisplay,
    fontSize: 32,
    height: 1.188,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.4,
  );
  static const TextStyle h1 = TextStyle(
    fontFamily: fontDisplay,
    fontSize: 24,
    height: 1.250,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.3,
  );
  static const TextStyle h2 = TextStyle(
    fontFamily: fontDisplay,
    fontSize: 20,
    height: 1.300,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
  );
  static const TextStyle body = TextStyle(
    fontFamily: fontBody,
    fontSize: 16,
    height: 1.500,
    fontWeight: FontWeight.w400,
    letterSpacing: 0,
  );
  static const TextStyle bodySm = TextStyle(
    fontFamily: fontBody,
    fontSize: 14,
    height: 1.429,
    fontWeight: FontWeight.w400,
    letterSpacing: 0,
  );
  static const TextStyle caption = TextStyle(
    fontFamily: fontBody,
    fontSize: 12,
    height: 1.333,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.2,
  );
  static const TextStyle mono = TextStyle(
    fontFamily: fontMono,
    fontSize: 16,
    height: 1.250,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.5,
  );

  static const TextTheme textTheme = TextTheme(
    displaySmall: display,
    headlineMedium: h1,
    titleLarge: h2,
    bodyLarge: body,
    bodyMedium: bodySm,
    labelSmall: caption,
  );

  static const double spaceXs = 4;
  static const double spaceSm = 8;
  static const double spaceMd = 12;
  static const double spaceBase = 16;
  static const double spaceLg = 20;
  static const double spaceXl = 24;
  static const double space2xl = 32;
  static const double space3xl = 40;
  static const double space4xl = 56;
  static const double space5xl = 72;

  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 16;
  static const double radiusXl = 24;
  static const double radiusFull = 999;

  /// Straight-down soft shadow. Depth comes from surface tone, not stacked shadows.
  static List<BoxShadow> cardShadow(Color base) => <BoxShadow>[
    BoxShadow(
      color: base.withValues(alpha: 0.1),
      offset: const Offset(0, 4),
      blurRadius: 16,
      spreadRadius: 0,
    ),
  ];
  static List<BoxShadow> raisedShadow(Color base) => <BoxShadow>[
    BoxShadow(
      color: base.withValues(alpha: 0.12),
      offset: const Offset(0, 8),
      blurRadius: 24,
      spreadRadius: 0,
    ),
  ];
  static List<BoxShadow> overlayShadow(Color base) => <BoxShadow>[
    BoxShadow(
      color: base.withValues(alpha: 0.18),
      offset: const Offset(0, 16),
      blurRadius: 40,
      spreadRadius: 0,
    ),
  ];

  static const Duration durationMicro = Duration(milliseconds: 150);
  static const Duration durationBase = Duration(milliseconds: 250);
  static const Duration durationSlow = Duration(milliseconds: 600);

  /// Matches motion.easing.standard on the web side.
  static const Curve easingStandard = Curves.fastOutSlowIn;
  static const Curve easingDecelerate = Curves.decelerate;

  /// How far a list item rises as it fades in.
  static const double staggerRiseDistance = 40;

  /// Beyond this many items, entry is a plain fade with no per-item delay — a 40-item
  /// stagger gives each item an imperceptible slice of the timeline and delays the last
  /// items past the point the user has already scrolled.
  static const int staggerMaxItems = 8;

  static const double touchTarget = 44;
  static const double touchTargetAdmin = 48;
  static const double gutter = 20;
  static const double contentMaxWidth = 1120;
  static const double bottomNavHeight = 62;
}
