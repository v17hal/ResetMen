import 'package:intl/intl.dart';

/// Display formatting.
///
/// Mirrors `packages/ui/src/format.ts` so the app and the website say the same thing about
/// the same booking. Nothing here does arithmetic on money beyond dividing by 100 to show
/// it: every total is computed server-side, and a client that recomputes one will
/// eventually disagree with what was charged.

final _inr = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _inrPaise = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);

/// The store's UTC offset.
///
/// Dart has no timezone database in the core library, and — the trap this exists for —
/// `DateTime.parse('2026-08-10T20:15:00+05:30')` returns a *UTC* DateTime and throws the
/// offset away. Formatting that directly prints 2:45 pm for a 8:15 pm slot.
///
/// Every instant the API sends already carries the store's offset, so it is captured from
/// the first one parsed and used to shift instants back to store wall-clock for display.
/// Comparisons still use the true instant, which is what `isAfter` and `difference` need.
///
/// A single mutable value is right here because there is exactly one store. It defaults to
/// IST so the very first frame, before any response has landed, is not an hour wrong.
Duration _storeOffset = const Duration(hours: 5, minutes: 30);

Duration get storeOffset => _storeOffset;

/// Records the offset carried by an API instant. Called from model parsing.
void rememberStoreOffset(String iso) {
  final match = RegExp(r'([+-])(\d{2}):?(\d{2})$').firstMatch(iso);
  if (match == null) return;

  final sign = match.group(1) == '-' ? -1 : 1;
  _storeOffset = Duration(
    hours: sign * int.parse(match.group(2)!),
    minutes: sign * int.parse(match.group(3)!),
  );
}

/// An instant shifted into the store's wall-clock, ready for the field-based formatters.
DateTime _inStoreTime(DateTime instant) => instant.toUtc().add(_storeOffset);

/// `4900` → `₹49`. Prices here are whole rupees, so trailing `.00` is noise — but a refund
/// of ₹49.50 keeps its paise rather than being rounded into a different number.
String formatMoney(int paise) {
  final rupees = paise / 100;
  return rupees == rupees.roundToDouble()
      ? _inr.format(rupees)
      : _inrPaise.format(rupees);
}

/// `90` → `1h 30m`. Compact, because it sits inside chips and list rows.
String formatDuration(int minutes) {
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  return rest == 0 ? '${hours}h' : '${hours}h ${rest}m';
}

/// `8:15 pm`, in store time.
///
/// Never `.toLocal()`: that renders in the *device's* timezone, so a customer abroad — or
/// one whose phone clock is simply wrong — sees a time nobody at the counter recognises.
String formatTime(DateTime instant) {
  return DateFormat('h:mm a')
      .format(_inStoreTime(instant))
      .replaceAll('AM', 'am')
      .replaceAll('PM', 'pm');
}

/// `Mon 10 Aug`, in store time.
String formatDate(DateTime instant) =>
    DateFormat('EEE d MMM').format(_inStoreTime(instant));

String formatDateTime(DateTime instant) =>
    '${formatDate(instant)}, ${formatTime(instant)}';

/// `8:15 – 9:00 pm`. The meridiem appears once when both ends share it.
String formatTimeRange(DateTime start, DateTime end) {
  final a = formatTime(start);
  final b = formatTime(end);
  return a.substring(a.length - 2) == b.substring(b.length - 2)
      ? '${a.substring(0, a.length - 3)} – $b'
      : '$a – $b';
}

/// `Today` / `Tomorrow` / `Mon 10 Aug`, resolved in store time.
///
/// Compared as calendar dates rather than by hours elapsed: at 23:30 a booking three hours
/// away is tomorrow, and calling it "today" sends someone in on the wrong day. Both sides
/// are shifted into store time first, so the comparison is between two store-local dates
/// rather than one store date and one device date.
String formatRelativeDay(DateTime instant, {DateTime? now}) {
  final target = _inStoreTime(instant);
  final base = _inStoreTime(now ?? DateTime.now());

  final diff = DateTime(target.year, target.month, target.day)
      .difference(DateTime(base.year, base.month, base.day))
      .inDays;

  return switch (diff) {
    0 => 'Today',
    1 => 'Tomorrow',
    -1 => 'Yesterday',
    _ => formatDate(instant),
  };
}

/// `YYYY-MM-DD` in store time — the format every date query wants.
String formatIsoDate(DateTime date) =>
    DateFormat('yyyy-MM-dd').format(_inStoreTime(date));

/// `95` → `1:35`. Always two digits of seconds.
String formatCountdown(Duration remaining) {
  final total = remaining.isNegative ? 0 : remaining.inSeconds;
  final minutes = total ~/ 60;
  final seconds = total % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

/// `+919404491801` → `+91 94044 91801`. Anything not Indian is returned untouched rather
/// than grouped wrongly.
String formatPhone(String e164) {
  final match = RegExp(r'^\+91(\d{5})(\d{5})$').firstMatch(e164);
  return match == null ? e164 : '+91 ${match.group(1)} ${match.group(2)}';
}

/// `RST2K8F4M` → `RST-2K8F4M`, so it can be read aloud at a counter.
String formatBookingCode(String publicId) {
  if (publicId.contains('-')) return publicId;
  return publicId.replaceFirstMapped(
    RegExp(r'^([A-Z]{3})(.+)$'),
    (m) => '${m.group(1)}-${m.group(2)}',
  );
}

/// Accepts what people type — `9404491801`, `+91 94044 91801`, `094044 91801` — and
/// produces the E.164 the API requires.
String toE164(String input) {
  final digits = input.replaceAll(RegExp(r'\D'), '');
  final national = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
  return '+91$national';
}
