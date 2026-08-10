/**
 * Emits the Dart enums the Flutter app switches on, from the Zod schemas that define them.
 *
 * Why not from OpenAPI: this API validates with Zod pipes rather than class DTOs, so the
 * OpenAPI document has 127 operations and almost no component schemas. Generating models
 * from it would produce `Object` everywhere. The Zod schemas are the real contract, so this
 * reads them directly — importing the built package and inspecting each export, rather than
 * pattern-matching the TypeScript source, so a reformat can never change the output.
 *
 * Enums only, deliberately. Dart models are hand-written next to `json_serializable` in the
 * app, because a generated model needs nullability and naming decisions that a script gets
 * wrong often enough to cost more than it saves. Enums are the part that must never drift:
 * a `status` the app does not recognise is a crash or a blank screen, and `ErrorCode` is
 * what every error path switches on.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const outFile = resolve(repoRoot, 'apps/mobile/lib/src/api/generated/reset_enums.dart');

const types = await import('@reset/types');

/** Zod 3 tags every schema on `_def.typeName`. */
function isZodEnum(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    value._def?.typeName === 'ZodEnum' &&
    Array.isArray(value.options)
  );
}

/** `bookingStatus` → `BookingStatus` */
function toPascal(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * `booking_confirmed` → `bookingConfirmed`, `no-show` → `noShow`, `HELD` → `held`.
 *
 * Dart enum values must be lowerCamelCase identifiers, but the wire value is whatever the
 * server sends. Both are kept — the mapping is explicit rather than reconstructed by
 * lower-casing at runtime, which would break on `no-show`.
 */
function toDartIdentifier(wire) {
  const parts = wire.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
  if (parts.length === 0) throw new Error(`Cannot derive a Dart identifier from "${wire}"`);
  const [first, ...rest] = parts;
  const identifier = first + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  // A leading digit is not a legal identifier, and `default`/`in`/`is` are reserved.
  return /^[0-9]/.test(identifier) || RESERVED.has(identifier) ? `${identifier}_` : identifier;
}

const RESERVED = new Set([
  'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'covariant', 'default', 'deferred', 'do', 'dynamic', 'else', 'enum', 'export',
  'extends', 'extension', 'external', 'factory', 'false', 'final', 'finally', 'for', 'function',
  'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is', 'late', 'library',
  'mixin', 'new', 'null', 'on', 'operator', 'part', 'required', 'rethrow', 'return', 'set',
  'show', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef', 'var',
  'void', 'while', 'with', 'yield',
]);

const enums = Object.entries(types)
  .filter(([, value]) => isZodEnum(value))
  .map(([name, schema]) => ({ name: toPascal(name), values: schema.options }))
  .sort((a, b) => a.name.localeCompare(b.name));

if (enums.length === 0) {
  throw new Error(
    'No Zod enums found in @reset/types. Has the package been built? Run `pnpm --filter @reset/types build`.',
  );
}

function renderEnum({ name, values }) {
  const members = values
    .map((wire) => `  ${toDartIdentifier(wire)}('${wire}')`)
    .join(',\n');

  return `enum ${name} {
${members};

  const ${name}(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static ${name}? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in ${name}.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}`;
}

const body = enums.map(renderEnum).join('\n\n');

const header = `// GENERATED — do not edit.
//
// Source: packages/types/src/*.ts (Zod schemas)
// Regenerate: pnpm gen:api
//
// These are the values the API actually sends. Editing this file by hand means the app and
// the server disagree about a status or an error code, and the symptom shows up as a blank
// screen rather than as a compile error.
//
// ${enums.length} enums, ${enums.reduce((sum, e) => sum + e.values.length, 0)} values.

`;

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${header}${body}\n`, 'utf8');

console.log(
  `Dart enums written to apps/mobile/lib/src/api/generated/reset_enums.dart — ` +
    `${enums.length} enums: ${enums.map((e) => e.name).join(', ')}`,
);
