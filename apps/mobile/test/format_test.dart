import 'package:flutter_test/flutter_test.dart';
import 'package:reset_app/src/format.dart';

/// Formatting is the part of the app with real bugs in it, so it is the part with tests.
///
/// These mirror `packages/ui/test/format.spec.ts` case for case — the app and the website
/// must say the same thing about the same booking, and a divergence here is the kind that
/// only shows up when a customer compares their phone to the website and calls the store.
void main() {
  group('formatMoney', () {
    test('drops decimals on whole rupees — the whole catalog is priced this way', () {
      expect(formatMoney(4900), '₹49');
      expect(formatMoney(0), '₹0');
    });

    test('keeps real paise rather than rounding a refund into a different number', () {
      expect(formatMoney(4950), '₹49.50');
    });

    test('groups in lakhs, not thousands', () {
      // ₹1,00,000 is what an Indian owner reads. ₹100,000 is not.
      expect(formatMoney(10000000), '₹1,00,000');
    });
  });

  group('formatDuration', () {
    test('formats compactly enough to sit in a chip', () {
      expect(formatDuration(45), '45m');
      expect(formatDuration(60), '1h');
      expect(formatDuration(90), '1h 30m');
      expect(formatDuration(125), '2h 5m');
    });
  });

  group('formatTime', () {
    test('renders the instant in its own offset, not the device timezone', () {
      // The API emits every booking at the store's offset. Calling .toLocal() first would
      // show a customer abroad — or one with a wrong device clock — a time nobody at the
      // counter recognises.
      final slot = DateTime.parse('2026-08-10T20:15:00+05:30');
      expect(formatTime(slot), '8:15 pm');
    });
  });

  group('formatTimeRange', () {
    test('prints the meridiem once when the range does not cross noon', () {
      expect(
        formatTimeRange(
          DateTime.parse('2026-08-10T20:15:00+05:30'),
          DateTime.parse('2026-08-10T21:00:00+05:30'),
        ),
        '8:15 – 9:00 pm',
      );
    });

    test('prints both when it does', () {
      expect(
        formatTimeRange(
          DateTime.parse('2026-08-10T11:30:00+05:30'),
          DateTime.parse('2026-08-10T12:15:00+05:30'),
        ),
        '11:30 am – 12:15 pm',
      );
    });
  });

  group('formatRelativeDay', () {
    test('compares calendar days, not elapsed hours', () {
      // 23:30. A booking three hours out is *tomorrow*, and calling it "today" sends
      // someone to the store on the wrong day.
      final now = DateTime.parse('2026-08-10T23:30:00+05:30');

      expect(
        formatRelativeDay(DateTime.parse('2026-08-10T23:45:00+05:30'), now: now),
        'Today',
      );
      expect(
        formatRelativeDay(DateTime.parse('2026-08-11T02:30:00+05:30'), now: now),
        'Tomorrow',
      );
    });

    test('falls back to a date beyond yesterday and tomorrow', () {
      final now = DateTime.parse('2026-08-10T11:30:00+05:30');
      expect(
        formatRelativeDay(DateTime.parse('2026-08-14T10:00:00+05:30'), now: now),
        'Fri 14 Aug',
      );
    });
  });

  group('formatCountdown', () {
    test('pads the seconds and floors at zero', () {
      expect(formatCountdown(const Duration(seconds: 95)), '1:35');
      expect(formatCountdown(const Duration(seconds: 65)), '1:05');
      expect(formatCountdown(Duration.zero), '0:00');
      expect(formatCountdown(const Duration(seconds: -10)), '0:00');
    });
  });

  group('phone handling', () {
    test('accepts what people actually type', () {
      expect(toE164('9404491801'), '+919404491801');
      expect(toE164('+91 94044 91801'), '+919404491801');
      expect(toE164('094044 91801'), '+919404491801');
    });

    test('groups an Indian number and leaves anything else alone', () {
      expect(formatPhone('+919404491801'), '+91 94044 91801');
      expect(formatPhone('+14155551234'), '+14155551234');
    });
  });

  group('formatBookingCode', () {
    test('hyphenates so it can be read aloud at a counter', () {
      expect(formatBookingCode('RST2K8F4M'), 'RST-2K8F4M');
      expect(formatBookingCode('RST-2K8F4M'), 'RST-2K8F4M');
    });

    test('leaves a help code that already has its hyphen alone', () {
      expect(formatBookingCode('HLP-7Q2K4M'), 'HLP-7Q2K4M');
    });
  });

  group('discountPercent', () {
    test('matches the client menu, rounded to the nearest whole percent', () {
      expect(discountPercent(49, 149), 67);
      expect(discountPercent(99, 399), 75);
      expect(discountPercent(149, 699), 79);
      expect(discountPercent(199, 999), 80);
      expect(discountPercent(299, 1699), 82);
    });

    test('is the same in paise as in rupees', () {
      expect(discountPercent(4900, 14900), 67);
      expect(discountPercent(29900, 169900), 82);
    });

    test('is zero when there is nothing to compare against', () {
      expect(discountPercent(9900, 9900), 0);
      expect(discountPercent(19900, 9900), 0, reason: 'never a negative discount');
      expect(discountPercent(9900, 0), 0, reason: 'never a division by zero');
    });
  });

  group('formatMessageTime', () {
    // Friday 11 September 2026, 6 pm at the store.
    final now = DateTime.parse('2026-09-11T18:00:00+05:30');

    test('a time for today, a day otherwise', () {
      expect(formatMessageTime(DateTime.parse('2026-09-11T16:05:00+05:30'), now: now),
          '4:05 pm');
      expect(formatMessageTime(DateTime.parse('2026-09-10T09:00:00+05:30'), now: now),
          'Yesterday');
      expect(formatMessageTime(DateTime.parse('2026-09-08T09:00:00+05:30'), now: now),
          'Tue 8 Sep');
    });

    test('decides "today" in store time, not UTC', () {
      // 00:30 on the 11th in Pune is still the 10th in UTC.
      expect(formatMessageTime(DateTime.parse('2026-09-10T19:00:00.000Z'), now: now),
          '12:30 am');
    });
  });
}
