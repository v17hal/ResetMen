/**
 * Display formatting shared by the web and admin apps.
 *
 * Everything here takes the wire representation the API actually sends — integer paise, an
 * ISO instant with an offset, an IANA timezone from the store — and returns a string. None
 * of it does arithmetic on money beyond dividing by 100 for display: every total the user
 * sees is computed server-side, and a client that recomputes one will eventually disagree
 * with the amount that was charged.
 */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const INR_WITH_PAISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * `4900` → `₹49`. Prices in this catalog are whole rupees, so trailing `.00` is noise.
 *
 * Anything with real paise keeps them rather than rounding — a refund of ₹49.50 must not
 * be shown as ₹50, and `en-IN` grouping means ₹1,00,000 rather than ₹100,000.
 */
export function formatMoney(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? INR.format(rupees) : INR_WITH_PAISE.format(rupees);
}

/** `4900` → `49`. For inputs and CSV cells, where a currency symbol is in the way. */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** `49.5` → `4950`. Rounds, because floating-point rupees do not divide cleanly. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * `90` → `1h 30m`, `45` → `45m`.
 *
 * Compact because it sits inside chips and table cells where "1 hour 30 minutes" wraps.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function parts(
  iso: string,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { ...options, ...(timeZone ? { timeZone } : {}) })
    .format(date);
}

/**
 * `2026-08-10T20:15:00+05:30` → `8:15 pm`.
 *
 * Pass the store's IANA timezone. The API already emits instants at the store's offset, so
 * omitting it is usually harmless — but only until a customer opens the app abroad, at which
 * point every slot silently shifts. Pass it.
 */
export function formatTime(iso: string, timeZone?: string): string {
  return parts(iso, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(' AM', ' am')
    .replace(' PM', ' pm');
}

/**
 * `Mon 10 Aug`.
 *
 * `en-IN` renders this as "Mon, 10 Aug". The comma is dropped so `formatDateTime` reads
 * "Mon 10 Aug, 8:15 pm" rather than carrying two commas in one short string.
 */
export function formatDate(iso: string, timeZone?: string): string {
  return parts(iso, timeZone, { weekday: 'short', day: 'numeric', month: 'short' }).replace(
    ',',
    '',
  );
}

/** `Mon 10 Aug, 8:15 pm`. */
export function formatDateTime(iso: string, timeZone?: string): string {
  return `${formatDate(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

/** `8:15 – 9:00 pm`. The meridiem appears once when both ends share it. */
export function formatTimeRange(startIso: string, endIso: string, timeZone?: string): string {
  const start = formatTime(startIso, timeZone);
  const end = formatTime(endIso, timeZone);
  const startMeridiem = start.slice(-2);
  return startMeridiem === end.slice(-2)
    ? `${start.slice(0, -3)} – ${end}`
    : `${start} – ${end}`;
}

/**
 * `today` / `tomorrow` / `Mon 10 Aug`, resolved in the store's timezone.
 *
 * Compared as calendar dates rather than by hours elapsed: at 23:30 a booking three hours
 * away is tomorrow, and calling it "today" sends someone to the store on the wrong day.
 */
export function formatRelativeDay(iso: string, timeZone?: string): string {
  const dayKey = (date: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(timeZone ? { timeZone } : {}),
    }).format(date);

  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '—';

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const yesterday = new Date(now.getTime() - 86_400_000);

  const key = dayKey(target);
  if (key === dayKey(now)) return 'Today';
  if (key === dayKey(tomorrow)) return 'Tomorrow';
  if (key === dayKey(yesterday)) return 'Yesterday';
  return formatDate(iso, timeZone);
}

/**
 * Seconds remaining until an instant, floored at zero.
 *
 * Used by the hold countdown. Returns a number rather than a string so the caller decides
 * how to render nothing-left — a "00:00" that lingers reads as a broken timer.
 */
export function secondsUntil(iso: string, now: Date = new Date()): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.floor((target - now.getTime()) / 1000));
}

/** `95` → `1:35`. Always two digits of seconds. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * `+919404491801` → `+91 94044 91801`.
 *
 * Indian numbers only; anything else is returned untouched rather than grouped wrongly.
 */
export function formatPhone(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match === null ? e164 : `+91 ${match[1]} ${match[2]}`;
}

/** `RST2K8F4M` → `RST-2K8F4M`. Grouped so it can be read aloud at a counter. */
export function formatBookingCode(publicId: string): string {
  return publicId.includes('-') ? publicId : publicId.replace(/^([A-Z]{3})(.+)$/, '$1-$2');
}

/** `12.5` → `12.5%`, `12` → `12%`. */
export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** `1536` → `1.5 KB`. For the media library. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `YYYY-MM-DD` for a Date, in the given timezone. The format every date query wants. */
export function toLocalDate(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** Today in the store's timezone, as `YYYY-MM-DD`. */
export function todayLocal(timeZone?: string): string {
  return toLocalDate(new Date(), timeZone);
}

/** Shifts a `YYYY-MM-DD` by whole days without going through a timezone at all. */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  // Built in UTC deliberately: a local-time Date would shift across a DST boundary and
  // "tomorrow" would occasionally be the same day again.
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
