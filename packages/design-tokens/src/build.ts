/**
 * Emits the tokens to CSS custom properties and Dart.
 *
 * Run with `pnpm gen:tokens`. The generated files are committed so a fresh clone builds
 * without a codegen step, and so a token change shows up as a reviewable diff on all three
 * platforms at once.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  colors,
  elevation,
  fonts,
  layout,
  motion,
  radius,
  spacing,
  typography,
} from './tokens.js';
import type { ColorToken, TypeStyle } from './tokens.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'generated');

const BANNER_LINES = [
  'GENERATED FILE — do not edit by hand.',
  'Source: packages/design-tokens/src/tokens.ts',
  'Regenerate: pnpm gen:tokens',
];

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** '#12B886' → '0xFF12B886' */
function dartColor(hex: string): string {
  return `0xFF${hex.replace('#', '').toUpperCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CSS
// ─────────────────────────────────────────────────────────────────────────────

function colorBlock(scheme: 'light' | 'dark'): string {
  return (Object.keys(colors[scheme]) as ColorToken[])
    .map((token) => `  --reset-color-${kebab(token)}: ${colors[scheme][token]};`)
    .join('\n');
}

function buildCss(): string {
  const lines: string[] = [
    `/*\n * ${BANNER_LINES.join('\n * ')}\n */`,
    '',
    ':root {',
    colorBlock('light'),
    '',
    ...Object.entries(spacing).map(([k, v]) => `  --reset-space-${k}: ${v}px;`),
    '',
    ...Object.entries(radius).map(([k, v]) => `  --reset-radius-${k}: ${v}px;`),
    '',
    ...Object.entries(fonts).map(([k, v]) => `  --reset-font-${k}: '${v}';`),
    '',
    ...Object.entries(typography).flatMap(([k, s]) => [
      `  --reset-type-${kebab(k)}-size: ${s.size}px;`,
      `  --reset-type-${kebab(k)}-line: ${s.lineHeight}px;`,
      `  --reset-type-${kebab(k)}-weight: ${s.weight};`,
      `  --reset-type-${kebab(k)}-tracking: ${s.letterSpacing}px;`,
    ]),
    '',
    ...Object.entries(elevation).map(
      ([k, e]) =>
        `  --reset-elevation-${k}: ${e.x}px ${e.y}px ${e.blur}px ${e.spread}px rgb(0 0 0 / ${e.opacity});`,
    ),
    '',
    ...Object.entries(motion.duration).map(([k, v]) => `  --reset-duration-${k}: ${v}ms;`),
    ...Object.entries(motion.easing).map(([k, v]) => `  --reset-easing-${kebab(k)}: ${v};`),
    `  --reset-stagger-rise: ${motion.staggerRiseDistance}px;`,
    '',
    ...Object.entries(layout).map(([k, v]) => `  --reset-layout-${kebab(k)}: ${v}px;`),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    colorBlock('dark').replace(/^ {2}/gm, '    '),
    '  }',
    '}',
    '',
    '/* The theme toggle stamps data-theme on the root and must win over the media query. */',
    ':root[data-theme="light"] {',
    colorBlock('light'),
    '}',
    '',
    ':root[data-theme="dark"] {',
    colorBlock('dark'),
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    '    --reset-duration-micro: 0ms;',
    '    --reset-duration-base: 0ms;',
    '    --reset-duration-slow: 0ms;',
    '    --reset-stagger-rise: 0px;',
    '  }',
    '}',
    '',
  ];

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Dart
// ─────────────────────────────────────────────────────────────────────────────

function dartTextStyle(name: string, style: TypeStyle): string {
  return [
    `  static const TextStyle ${name} = TextStyle(`,
    `    fontFamily: font${style.font[0]!.toUpperCase()}${style.font.slice(1)},`,
    `    fontSize: ${style.size},`,
    `    height: ${(style.lineHeight / style.size).toFixed(3)},`,
    `    fontWeight: FontWeight.w${style.weight},`,
    `    letterSpacing: ${style.letterSpacing},`,
    '  );',
  ].join('\n');
}

function dartColorClass(name: string, scheme: 'light' | 'dark'): string {
  const entries = (Object.keys(colors[scheme]) as ColorToken[])
    .map((token) => `  static const Color ${token} = Color(${dartColor(colors[scheme][token])});`)
    .join('\n');

  return [`class ${name} {`, `  ${name}._();`, '', entries, '}'].join('\n');
}

function buildDart(): string {
  return [
    `// ${BANNER_LINES.join('\n// ')}`,
    '// ignore_for_file: constant_identifier_names',
    '',
    "import 'package:flutter/material.dart';",
    '',
    '/// Colours for the light scheme.',
    dartColorClass('ResetColorsLight', 'light'),
    '',
    '/// Colours for the dark scheme. Men-segment-first, so this is the default look.',
    dartColorClass('ResetColorsDark', 'dark'),
    '',
    '/// Type, spacing, radius, elevation and motion.',
    '///',
    '/// Shaped as a static class with a named [TextTheme], following the convention in the',
    '/// Best-Flutter-UI-Templates reference — it keeps every style reachable without a',
    '/// BuildContext, which matters inside painters and custom clippers.',
    'class ResetTokens {',
    '  ResetTokens._();',
    '',
    ...Object.entries(fonts).map(
      ([k, v]) =>
        `  static const String font${k[0]!.toUpperCase()}${k.slice(1)} = '${v}';`,
    ),
    '',
    ...Object.entries(typography).map(([k, s]) => dartTextStyle(k, s)),
    '',
    '  static const TextTheme textTheme = TextTheme(',
    '    displaySmall: display,',
    '    headlineMedium: h1,',
    '    titleLarge: h2,',
    '    bodyLarge: body,',
    '    bodyMedium: bodySm,',
    '    labelSmall: caption,',
    '  );',
    '',
    ...Object.entries(spacing).map(
      ([k, v]) => `  static const double space${k.replace(/[^a-zA-Z0-9]/g, '').replace(/^./, (c) => c.toUpperCase())} = ${v};`,
    ),
    '',
    ...Object.entries(radius).map(
      ([k, v]) => `  static const double radius${k[0]!.toUpperCase()}${k.slice(1)} = ${v};`,
    ),
    '',
    '  /// Straight-down soft shadow. Depth comes from surface tone, not stacked shadows.',
    ...Object.entries(elevation)
      .filter(([k]) => k !== 'none')
      .map(([k, e]) =>
        [
          `  static List<BoxShadow> ${k}Shadow(Color base) => <BoxShadow>[`,
          `    BoxShadow(`,
          `      color: base.withValues(alpha: ${e.opacity}),`,
          `      offset: const Offset(${e.x}, ${e.y}),`,
          `      blurRadius: ${e.blur},`,
          `      spreadRadius: ${e.spread},`,
          `    ),`,
          `  ];`,
        ].join('\n'),
      ),
    '',
    ...Object.entries(motion.duration).map(
      ([k, v]) =>
        `  static const Duration duration${k[0]!.toUpperCase()}${k.slice(1)} = Duration(milliseconds: ${v});`,
    ),
    '',
    '  /// Matches motion.easing.standard on the web side.',
    '  static const Curve easingStandard = Curves.fastOutSlowIn;',
    '  static const Curve easingDecelerate = Curves.decelerate;',
    '',
    `  /// How far a list item rises as it fades in.`,
    `  static const double staggerRiseDistance = ${motion.staggerRiseDistance};`,
    '',
    '  /// Beyond this many items, entry is a plain fade with no per-item delay — a 40-item',
    '  /// stagger gives each item an imperceptible slice of the timeline and delays the last',
    '  /// items past the point the user has already scrolled.',
    `  static const int staggerMaxItems = ${motion.staggerMaxItems};`,
    '',
    ...Object.entries(layout).map(
      ([k, v]) => `  static const double ${k} = ${v};`,
    ),
    '}',
    '',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tokens.css'), buildCss(), 'utf8');
writeFileSync(join(outDir, 'reset_tokens.dart'), buildDart(), 'utf8');

console.log('▸ design tokens emitted');
console.log(`  ${join('generated', 'tokens.css')}`);
console.log(`  ${join('generated', 'reset_tokens.dart')}`);
