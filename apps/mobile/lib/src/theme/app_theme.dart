import 'package:flutter/material.dart';

import 'reset_tokens.dart';

/// Themes built from the generated tokens.
///
/// Nothing here invents a colour. Every value comes from `packages/design-tokens`, so a
/// change to the brand moves the app, the website and the admin panel in the same commit.
class AppTheme {
  AppTheme._();

  static ThemeData light() => _build(
        brightness: Brightness.light,
        bg: ResetColorsLight.bg,
        surface: ResetColorsLight.surface,
        surface2: ResetColorsLight.surface2,
        border: ResetColorsLight.border,
        text: ResetColorsLight.text,
        textMuted: ResetColorsLight.textMuted,
        primary: ResetColorsLight.primary,
        primaryFg: ResetColorsLight.primaryFg,
        accent: ResetColorsLight.accent,
        danger: ResetColorsLight.danger,
      );

  static ThemeData dark() => _build(
        brightness: Brightness.dark,
        bg: ResetColorsDark.bg,
        surface: ResetColorsDark.surface,
        surface2: ResetColorsDark.surface2,
        border: ResetColorsDark.border,
        text: ResetColorsDark.text,
        textMuted: ResetColorsDark.textMuted,
        primary: ResetColorsDark.primary,
        primaryFg: ResetColorsDark.primaryFg,
        accent: ResetColorsDark.accent,
        danger: ResetColorsDark.danger,
      );

  static ThemeData _build({
    required Brightness brightness,
    required Color bg,
    required Color surface,
    required Color surface2,
    required Color border,
    required Color text,
    required Color textMuted,
    required Color primary,
    required Color primaryFg,
    required Color accent,
    required Color danger,
  }) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: primaryFg,
      secondary: accent,
      onSecondary: primaryFg,
      error: danger,
      onError: Colors.white,
      surface: surface,
      onSurface: text,
      surfaceContainerHighest: surface2,
      outline: border,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      textTheme: ResetTokens.textTheme.apply(
        bodyColor: text,
        displayColor: text,
      ),
      fontFamily: ResetTokens.fontBody,

      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: ResetTokens.h1.copyWith(color: text),
        iconTheme: IconThemeData(color: text),
      ),

      cardTheme: CardThemeData(
        color: surface,
        surfaceTintColor: Colors.transparent,
        // One soft shadow, straight down. Depth comes from surface tone; shadows are never
        // stacked. The reference casts its card shadow diagonally — ours does not, because
        // a diagonal shadow implies a light source the rest of the interface never commits
        // to. docs/08 §2.3.
        elevation: 2,
        shadowColor: Colors.black.withValues(alpha: 0.1),
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ResetTokens.radiusLg),
          side: BorderSide(color: border),
        ),
      ),

      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: primaryFg,
          // Every target clears the 44px minimum from docs/08 §2.3.
          minimumSize: const Size(0, ResetTokens.touchTarget),
          padding: const EdgeInsets.symmetric(horizontal: ResetTokens.spaceLg),
          textStyle: ResetTokens.body.copyWith(fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
          ),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: text,
          minimumSize: const Size(0, ResetTokens.touchTarget),
          padding: const EdgeInsets.symmetric(horizontal: ResetTokens.spaceLg),
          side: BorderSide(color: border),
          textStyle: ResetTokens.body.copyWith(fontWeight: FontWeight.w500),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
          ),
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: primary,
          minimumSize: const Size(0, ResetTokens.touchTarget),
          textStyle: ResetTokens.body,
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        hintStyle: ResetTokens.body.copyWith(color: textMuted),
        labelStyle: ResetTokens.bodySm.copyWith(color: textMuted),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: ResetTokens.spaceBase,
          vertical: ResetTokens.spaceMd,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
          borderSide: BorderSide(color: primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
          borderSide: BorderSide(color: danger),
        ),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: surface2,
        side: BorderSide(color: border),
        labelStyle: ResetTokens.caption.copyWith(color: text),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ResetTokens.radiusFull),
        ),
      ),

      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: primary.withValues(alpha: 0.14),
        height: ResetTokens.bottomNavHeight,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => ResetTokens.caption.copyWith(
            color: states.contains(WidgetState.selected) ? primary : textMuted,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected) ? primary : textMuted,
          ),
        ),
      ),

      dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: surface2,
        contentTextStyle: ResetTokens.bodySm.copyWith(color: text),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
        ),
      ),
    );
  }
}

/// Semantic colours that have no slot in [ColorScheme].
///
/// Amber is rewards-only. When the accent colour only ever means "you earned something",
/// the streak ring and the scratch card carry weight without needing an animation to
/// explain themselves.
extension ResetColors on ThemeData {
  Color get accentColor =>
      brightness == Brightness.dark ? ResetColorsDark.accent : ResetColorsLight.accent;

  Color get mutedColor =>
      brightness == Brightness.dark ? ResetColorsDark.textMuted : ResetColorsLight.textMuted;

  Color get borderColor =>
      brightness == Brightness.dark ? ResetColorsDark.border : ResetColorsLight.border;

  Color get surface2Color =>
      brightness == Brightness.dark ? ResetColorsDark.surface2 : ResetColorsLight.surface2;

  Color get successColor =>
      brightness == Brightness.dark ? ResetColorsDark.success : ResetColorsLight.success;

  Color get warningColor =>
      brightness == Brightness.dark ? ResetColorsDark.warning : ResetColorsLight.warning;
}
