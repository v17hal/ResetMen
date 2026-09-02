/**
 * Wall-clock ↔ instant conversion, in the *store's* timezone.
 *
 * The recurring trap here is `new Date('2026-08-10T20:15')`. That parses in the browser's
 * timezone, so a counter tablet accidentally set to UTC would book everything five and a
 * half hours out from what the person typed — and it would look right on their screen while
 * doing it. Nothing in this file goes through the browser's zone.
 */

/**
 * The store's timezone.
 *
 * Most screens read it off a response that happens to carry it. The ones that fetch nothing
 * carrying it — closures, campaign windows — use this. The store is in Indore, and a date
 * typed as "the 14th" has to mean the 14th there whatever the tablet is set to.
 */
export const STORE_TIMEZONE = 'Asia/Kolkata';

/**
 * The UTC offset a timezone is at on a given instant, as `+05:30`.
 *
 * Read from `Intl` rather than hard-coded, so the platform stays correct if it is ever
 * deployed somewhere that observes DST.
 */
export function offsetFor(timeZone: string, at: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;

  // Intl reports UTC itself as plain "GMT", with no offset to strip.
  const offset = (name ?? 'GMT').replace('GMT', '');
  return offset === '' ? '+00:00' : offset;
}

/**
 * `2026-08-10T20:15` typed into a `datetime-local` input → `2026-08-10T20:15:00+05:30`.
 *
 * The offset is resolved at approximately the target instant rather than at "now", so a
 * booking taken in October for a date in March gets March's offset.
 */
export function localInputToIso(value: string, timeZone: string): string {
  if (value === '') return '';

  const [datePart, timePart = '00:00'] = value.split('T');
  if (datePart === undefined) return '';

  // Probe in UTC first to land within a few hours of the real instant — close enough that
  // the offset is only ever wrong within hours of a DST transition, which India does not have.
  const probe = new Date(`${datePart}T${timePart}:00Z`);
  return `${datePart}T${timePart.slice(0, 5)}:00${offsetFor(timeZone, probe)}`;
}

/** An instant → the `datetime-local` string showing that moment in the store's timezone. */
export function isoToLocalInput(iso: string, timeZone: string): string {
  if (iso === '') return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';

  // `en-CA` renders midnight as 24 rather than 00 in some engines.
  const hour = get('hour') === '24' ? '00' : get('hour');

  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/**
 * Store-local minutes past midnight → an instant on that date.
 *
 * Rounded to five minutes, because this comes from a click position on the timeline and
 * nobody means 14:37 when they tap. The engine refuses anything it cannot schedule, so this
 * only has to be a sensible default.
 */
export function isoAtMinute(date: string, timeZone: string, minutesFromMidnight: number): string {
  const rounded = Math.max(0, Math.round(minutesFromMidnight / 5) * 5);
  const hh = String(Math.floor(rounded / 60) % 24).padStart(2, '0');
  const mm = String(rounded % 60).padStart(2, '0');
  return localInputToIso(`${date}T${hh}:${mm}`, timeZone);
}

/** Hours-with-fraction of an instant, read in a timezone. `20:15` → `20.25`. */
export function hourIn(iso: string, timeZone: string): number {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

  const [h, m] = formatted.split(':').map(Number);
  return (h ?? 0) + (m ?? 0) / 60;
}

/** Today in a timezone, as `YYYY-MM-DD`. */
export function localDateIn(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
