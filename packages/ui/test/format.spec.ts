import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addDays,
  formatBookingCode,
  formatBytes,
  formatCountdown,
  formatDuration,
  formatMoney,
  formatPercent,
  formatPhone,
  formatRelativeDay,
  formatTime,
  formatTimeRange,
  rupeesToPaise,
  secondsUntil,
  toLocalDate,
} from '../src/format.js';

const IST = 'Asia/Kolkata';

describe('formatMoney', () => {
  it('drops the decimals on whole rupees — the whole catalog is priced this way', () => {
    expect(formatMoney(4900)).toBe('₹49');
    expect(formatMoney(0)).toBe('₹0');
  });

  it('keeps real paise rather than rounding a refund into a different number', () => {
    expect(formatMoney(4950)).toBe('₹49.50');
  });

  it('groups in lakhs, not thousands', () => {
    // ₹1,00,000 is what an Indian owner reads. ₹100,000 is not.
    expect(formatMoney(10_000_000)).toBe('₹1,00,000');
  });
});

describe('rupeesToPaise', () => {
  it('rounds rather than truncating a floating-point rupee', () => {
    // 49.5 * 100 is 4950.000000000001 in IEEE 754. Truncation would lose a paisa.
    expect(rupeesToPaise(49.5)).toBe(4950);
    expect(rupeesToPaise(0.07)).toBe(7);
  });
});

describe('formatDuration', () => {
  it('formats compactly enough to sit in a chip', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(125)).toBe('2h 5m');
  });
});

describe('time formatting', () => {
  it('renders in the store timezone, not the reader’s', () => {
    expect(formatTime('2026-08-10T20:15:00+05:30', IST)).toBe('8:15 pm');
    // Same instant, read from London. The store's evening slot must not become afternoon.
    expect(formatTime('2026-08-10T14:45:00Z', IST)).toBe('8:15 pm');
  });

  it('prints the meridiem once when a range does not cross noon', () => {
    expect(formatTimeRange('2026-08-10T20:15:00+05:30', '2026-08-10T21:00:00+05:30', IST)).toBe(
      '8:15 – 9:00 pm',
    );
  });

  it('prints both when the range crosses noon', () => {
    expect(formatTimeRange('2026-08-10T11:30:00+05:30', '2026-08-10T12:15:00+05:30', IST)).toBe(
      '11:30 am – 12:15 pm',
    );
  });

  it('returns a dash rather than "Invalid Date" for junk', () => {
    expect(formatTime('not-a-date', IST)).toBe('—');
  });
});

describe('formatRelativeDay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('compares calendar days, not elapsed hours', () => {
    // 23:30 IST. A booking three hours out is *tomorrow*, and calling it "today" sends
    // someone to the store on the wrong day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T18:00:00Z')); // 23:30 IST

    expect(formatRelativeDay('2026-08-10T23:45:00+05:30', IST)).toBe('Today');
    expect(formatRelativeDay('2026-08-11T02:30:00+05:30', IST)).toBe('Tomorrow');
  });

  it('falls back to a date beyond yesterday/tomorrow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T06:00:00Z'));
    expect(formatRelativeDay('2026-08-14T10:00:00+05:30', IST)).toBe('Fri 14 Aug');
  });
});

describe('countdown', () => {
  it('floors at zero rather than counting into negative time', () => {
    const now = new Date('2026-08-10T12:00:00Z');
    expect(secondsUntil('2026-08-10T11:59:00Z', now)).toBe(0);
    expect(secondsUntil('2026-08-10T12:01:35Z', now)).toBe(95);
  });

  it('pads the seconds', () => {
    expect(formatCountdown(95)).toBe('1:35');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-10)).toBe('0:00');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('does not drift across a DST boundary', () => {
    // Built in UTC deliberately. A local-time Date in a DST-observing zone would land on
    // the same calendar day twice.
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });
});

describe('toLocalDate', () => {
  it('reports the store’s calendar day, not the server’s', () => {
    // 19:00 UTC on the 10th is already 00:30 on the 11th in Kolkata.
    expect(toLocalDate(new Date('2026-08-10T19:00:00Z'), IST)).toBe('2026-08-11');
  });
});

describe('misc formatting', () => {
  it('groups an Indian phone number and leaves anything else alone', () => {
    expect(formatPhone('+919404491801')).toBe('+91 94044 91801');
    expect(formatPhone('+14155551234')).toBe('+14155551234');
  });

  it('hyphenates a booking code so it can be read aloud', () => {
    expect(formatBookingCode('RST2K8F4M')).toBe('RST-2K8F4M');
    expect(formatBookingCode('RST-2K8F4M')).toBe('RST-2K8F4M');
  });

  it('formats percentages and byte sizes', () => {
    expect(formatPercent(12)).toBe('12%');
    expect(formatPercent(12.53)).toBe('12.5%');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3_145_728)).toBe('3.0 MB');
  });
});
