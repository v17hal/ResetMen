/// Where a tapped notification wants to take someone.
///
/// The API puts a `deepLink` on every push (`apps/api/src/notifications/notification.service.ts`):
/// `reset://bookings/<id>`, `reset://rewards`, `reset://rewards/scratch`,
/// `reset://orders/<id>` and `reset://help/<threadId>`. Parsed here into something the tab
/// shell can switch on, and kept free of Flutter so it can be tested without a device.
///
/// Anything unrecognised is null rather than an error. A server newer than the app will one
/// day send a link this build has never heard of, and the right response to that is simply
/// to open the app where it was.
sealed class DeepLink {
  const DeepLink();

  static DeepLink? parse(String raw) {
    final uri = Uri.tryParse(raw.trim());
    if (uri == null || uri.scheme != 'reset') return null;

    // `reset://help/abc` puts "help" in the host and only the id in the path.
    final segments = [uri.host, ...uri.pathSegments]
        .where((segment) => segment.isNotEmpty)
        .toList(growable: false);

    return switch (segments) {
      ['bookings', final id] => BookingLink(id),
      ['rewards'] || ['rewards', 'scratch'] => const RewardsLink(),
      // There is no order detail screen — orders are listed on the Shop tab — so the id
      // takes nobody anywhere a plain Shop link would not.
      ['orders'] || ['orders', _] => const OrdersLink(),
      ['help'] => const HelpLink(),
      ['help', final id] => HelpThreadLink(id),
      _ => null,
    };
  }
}

/// Confirmations and reminders.
final class BookingLink extends DeepLink {
  const BookingLink(this.bookingId);
  final String bookingId;
}

/// Streak progress, a new scratch card, cashback landing.
final class RewardsLink extends DeepLink {
  const RewardsLink();
}

/// "Your order is ready to collect."
final class OrdersLink extends DeepLink {
  const OrdersLink();
}

/// The list of questions.
final class HelpLink extends DeepLink {
  const HelpLink();
}

/// "RESET replied" — the store answered a question.
final class HelpThreadLink extends DeepLink {
  const HelpThreadLink(this.threadId);
  final String threadId;
}
