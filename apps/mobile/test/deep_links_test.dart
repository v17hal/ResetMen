import 'package:flutter_test/flutter_test.dart';
import 'package:reset_app/src/services/deep_links.dart';

/// Every link here is one `apps/api/src/notifications/notification.service.ts` actually
/// puts on a push. A link that parses to nothing opens the app where it was, which is
/// harmless; one that parses to the wrong screen is not.
void main() {
  test('reads every link the API sends', () {
    expect(
      DeepLink.parse('reset://help/6f1c2d3e-aaaa-bbbb-cccc-111122223333'),
      isA<HelpThreadLink>().having(
          (l) => l.threadId, 'threadId', '6f1c2d3e-aaaa-bbbb-cccc-111122223333'),
    );
    expect(
      DeepLink.parse('reset://bookings/9a1d4e7c-1111-2222-3333-444455556666'),
      isA<BookingLink>().having(
          (l) => l.bookingId, 'bookingId', '9a1d4e7c-1111-2222-3333-444455556666'),
    );
    expect(DeepLink.parse('reset://rewards'), isA<RewardsLink>());
    expect(DeepLink.parse('reset://rewards/scratch'), isA<RewardsLink>());
    expect(DeepLink.parse('reset://orders/bbbb1111'), isA<OrdersLink>());
  });

  test('keeps an id exactly as it was sent', () {
    // The scheme's host is lower-cased by Uri; the path must not be.
    expect(
      DeepLink.parse('reset://help/AbC-123'),
      isA<HelpThreadLink>().having((l) => l.threadId, 'threadId', 'AbC-123'),
    );
  });

  test('the list of questions on its own', () {
    expect(DeepLink.parse('reset://help'), isA<HelpLink>());
  });

  test('ignores anything it does not recognise, rather than guessing', () {
    for (final raw in [
      '',
      'reset://',
      'reset://somewhere-new/1',
      'reset://help/a/b',
      'https://resetmen.in/help/abc',
    ]) {
      expect(DeepLink.parse(raw), isNull, reason: raw);
    }
  });
}
