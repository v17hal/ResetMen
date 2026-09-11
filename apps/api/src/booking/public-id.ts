import { randomInt } from 'node:crypto';

/**
 * Booking codes are read aloud across a counter, so the alphabet excludes every character
 * pair that gets misheard or misread: no O/0, no I/1/L, no U (heard as "you"), no S/5.
 */
const ALPHABET = '23456789ACDEFGHJKMNPQRTVWXYZ';

/** A speakable code with the given prefix, e.g. `HLP-7Q2K4M` for a help-desk question. */
export function generateCode(prefix: string): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${prefix}-${code}`;
}

/** e.g. `RST-2K8F4M` */
export function generatePublicId(): string {
  return generateCode('RST');
}
