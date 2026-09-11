import 'package:flutter_test/flutter_test.dart';
import 'package:reset_app/src/api/api_client.dart';
import 'package:reset_app/src/api/generated/reset_enums.dart';
import 'package:reset_app/src/api/models.dart';

/// Parsing, against the payloads the API actually sends.
///
/// Every fixture here is the shape the server produces, copied from the service that
/// produces it rather than from what the app hoped to receive. Four bugs in one week came
/// from a client declaring a field the API had never sent, and every one of them was
/// invisible until somebody opened the screen.
void main() {
  group('Booking', () {
    /// As `toDetailDto` in apps/api/src/booking/booking-lifecycle.service.ts returns it.
    Map<String, dynamic> payload({bool isPaid = false, String? checkinPayload}) => {
          'id': '9a1d4e7c-1111-2222-3333-444455556666',
          'publicId': 'RST2K8F4M',
          'status': 'CONFIRMED',
          'isPaid': isPaid,
          'serviceName': 'Head',
          'startsAt': '2026-09-10T10:00:00+05:30',
          'endsAt': '2026-09-10T10:10:00+05:30',
          'durationMinutes': 10,
          'payablePaise': 4900,
          'addons': [
            {'name': 'Hot towel', 'pricePaise': 2000},
          ],
          'canCancel': true,
          'checkinPayload': checkinPayload,
        };

    test('reads isPaid, which decides what the customer is told', () {
      expect(Booking.fromJson(payload(isPaid: true)).isPaid, isTrue);
      expect(Booking.fromJson(payload()).isPaid, isFalse);
    });

    test('an absent isPaid is unpaid, not paid', () {
      // A server older than the app, or a truncated body. "Awaiting confirmation" on a
      // settled booking is a wasted question; "you're booked" on an unsettled one sends
      // somebody to the counter expecting to walk in.
      final json = payload()..remove('isPaid');
      expect(Booking.fromJson(json).isPaid, isFalse);
    });

    test('survives the offline cache round trip with its payment state intact', () {
      // The cache writes with toCacheJson and reads back with fromJson. A field missing
      // from the writer defaults on the way back in — silently, and only when offline.
      final original = Booking.fromJson(payload(isPaid: true, checkinPayload: 'RST1.x.y'));
      final restored = Booking.fromJson(original.toCacheJson());

      expect(restored.isPaid, isTrue, reason: 'a paid booking must not read as unpaid offline');
      expect(restored.publicId, original.publicId);
      expect(restored.status, BookingStatus.confirmed);
      expect(restored.checkinPayload, 'RST1.x.y');
      expect(restored.addonNames, ['Hot towel']);
      expect(restored.payablePaise, 4900);
      expect(restored.canCancel, isTrue);
    });
  });

  group('Product', () {
    /// As `toDto` in apps/api/src/products/product.service.ts returns it.
    Map<String, dynamic> payload({int? mrpPaise, bool inStock = true}) => {
          'id': 'aaaa1111-2222-3333-4444-555566667777',
          'name': 'Beard oil',
          'slug': 'beard-oil',
          'description': 'Ten millilitres.',
          'images': <String>[],
          'pricePaise': 29900,
          'mrpPaise': mrpPaise,
          'inStock': inStock,
          'sku': 'BO-10',
        };

    test('parses the shelf', () {
      final product = Product.fromJson(payload(mrpPaise: 34900));
      expect(product.name, 'Beard oil');
      expect(product.pricePaise, 29900);
      expect(product.mrpPaise, 34900);
      expect(product.inStock, isTrue);
    });

    test('only strikes through a price that is actually higher', () {
      expect(Product.fromJson(payload(mrpPaise: 34900)).hasDiscount, isTrue);
      expect(Product.fromJson(payload(mrpPaise: 29900)).hasDiscount, isFalse,
          reason: 'an MRP equal to the price is not a discount');
      expect(Product.fromJson(payload(mrpPaise: 19900)).hasDiscount, isFalse,
          reason: 'an MRP below the price is bad data, not a discount');
      expect(Product.fromJson(payload()).hasDiscount, isFalse);
    });

    test('out of stock is a flag, and defaults to unavailable', () {
      expect(Product.fromJson(payload(inStock: false)).inStock, isFalse);
      final json = payload()..remove('inStock');
      expect(Product.fromJson(json).inStock, isFalse,
          reason: 'offering something the shelf may not have is the worse mistake');
    });
  });

  group('ProductOrder', () {
    Map<String, dynamic> payload(String status) => {
          'id': 'bbbb1111-2222-3333-4444-555566667777',
          'publicId': 'RSTORD01',
          'status': status,
          'totalPaise': 29900,
          'createdAt': '2026-09-03T09:00:00+05:30',
          'items': [
            {
              'productId': 'aaaa1111-2222-3333-4444-555566667777',
              'name': 'Beard oil',
              'unitPricePaise': 29900,
              'qty': 1,
              'linePaise': 29900,
            },
          ],
        };

    test('parses an order and its lines', () {
      final order = ProductOrder.fromJson(payload('PENDING'));
      expect(order.publicId, 'RSTORD01');
      expect(order.totalPaise, 29900);
      expect(order.items.single.name, 'Beard oil');
      expect(order.items.single.linePaise, 29900);
    });

    test('PENDING is the state where money is still owed', () {
      // Every order starts here and stays until the counter settles it — there is no
      // gateway. The screen turns this into "Pay at the store".
      expect(ProductOrder.fromJson(payload('PENDING')).awaitingPayment, isTrue);

      for (final settled in ['PAID', 'READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED']) {
        expect(ProductOrder.fromJson(payload(settled)).awaitingPayment, isFalse,
            reason: '$settled is not awaiting payment');
      }
    });

    test('a status this build does not know is null rather than a crash', () {
      final order = ProductOrder.fromJson(payload('SOMETHING_NEW'));
      expect(order.status, isNull);
      expect(order.awaitingPayment, isFalse);
    });
  });

  group('ResetApiException', () {
    ResetApiException phoneMissing() => ResetApiException(
          code: ErrorCode.validationFailed,
          status: 422,
          title: 'Add your phone number',
          detail: 'The store needs a number to confirm your booking and take payment.',
          meta: const {'field': 'phone'},
        );

    test('recognises the one validation failure the app can fix itself', () {
      // VALIDATION_FAILED covers a malformed date and a missing phone alike, so the code
      // alone cannot tell them apart. Only meta.field can.
      expect(phoneMissing().needsPhone, isTrue);
    });

    test('does not mistake another validation failure for a missing phone', () {
      final other = ResetApiException(
        code: ErrorCode.validationFailed,
        status: 422,
        title: 'That date is not valid',
        meta: const {'field': 'dateOfBirth'},
      );
      expect(other.needsPhone, isFalse);

      final bare = ResetApiException(
        code: ErrorCode.validationFailed,
        status: 422,
        title: 'Something else',
      );
      expect(bare.needsPhone, isFalse);
    });

    test('a slot clash carries the server sentence, which names the reason', () {
      // Two different situations share this code: somebody else took the slot, or it
      // overlaps a booking the customer already holds. Only the server knows which, so the
      // app shows its words rather than guessing.
      final clash = ResetApiException(
        code: ErrorCode.slotUnavailable,
        status: 409,
        title: 'You already have a booking then',
        detail: 'Premium overlaps this time (RST2K8F4M). Cancel it first, or pick another time.',
      );

      expect(clash.isSlotGone, isTrue);
      expect(clash.toString(), contains('RST2K8F4M'));
    });

    test('recognises Terms that changed under the customer', () {
      // As the hold endpoint in apps/api/src/booking/booking.controller.ts refuses a stale
      // version. Answerable in the app — show the new text and ask again.
      final stale = ResetApiException(
        code: ErrorCode.validationFailed,
        status: 422,
        title: 'Validation failed',
        detail: 'Our Terms & Conditions have been updated. Please read them again and '
            'tick the box to continue.',
        meta: const {'field': 'termsVersion', 'currentVersion': '2026-10-01'},
      );

      expect(stale.termsOutdated, isTrue);
      expect(stale.needsPhone, isFalse);
      expect(phoneMissing().termsOutdated, isFalse);
    });
  });

  group('ServiceSummary and ServiceDetail', () {
    /// As `getServices` and `getService` in apps/api/src/catalog/catalog.service.ts return
    /// them, after `display()` has cleaned the presentation fields.
    Map<String, dynamic> payload({
      Object? emoji = '💆‍♂️',
      Object? tagline = 'Head, Neck & Shoulder',
      Object? compareAt = 14900,
      Object? badge = 'BESTSELLER',
    }) =>
        {
          'id': 'svc-tension',
          'name': 'Tension Relief',
          'slug': 'tension-relief',
          'description': 'Ten minutes on the knots you carry.',
          'imageUrl': null,
          'pricePaise': 4900,
          'durationMinutes': 10,
          'categoryId': 'cat-quick',
          'emoji': emoji,
          'tagline': tagline,
          'compareAtPricePaise': compareAt,
          'badge': badge,
          'addonGroups': <Object>[],
        };

    List<ServicePresentation> both(Map<String, dynamic> json) =>
        [ServiceSummary.fromJson(json), ServiceDetail.fromJson(json)];

    test('read the menu presentation fields', () {
      for (final service in both(payload())) {
        expect(service.emoji, '💆‍♂️');
        expect(service.tagline, 'Head, Neck & Shoulder');
        expect(service.compareAtPricePaise, 14900);
        expect(service.badge, 'BESTSELLER');
        expect(service.wasPricePaise, 14900);
        expect(service.percentOff, 67);
      }
    });

    test('a server without them leaves the service exactly as it was', () {
      final json = payload()
        ..remove('emoji')
        ..remove('tagline')
        ..remove('compareAtPricePaise')
        ..remove('badge');

      for (final service in both(json)) {
        expect(service.emoji, isNull);
        expect(service.tagline, isNull);
        expect(service.badge, isNull);
        expect(service.wasPricePaise, isNull);
        expect(service.percentOff, 0);
      }
      expect(ServiceSummary.fromJson(json).name, 'Tension Relief');
    });

    test('blank text is absent, not an empty pill or line', () {
      for (final service in both(payload(emoji: '', tagline: '   ', badge: ''))) {
        expect(service.emoji, isNull);
        expect(service.tagline, isNull);
        expect(service.badge, isNull);
      }
    });

    test('never strikes through a "was" price at or below the price', () {
      for (final service in [...both(payload(compareAt: 4900)), ...both(payload(compareAt: 3900))]) {
        expect(service.wasPricePaise, isNull);
        expect(service.percentOff, 0);
      }
    });
  });

  group('HomeData', () {
    /// As `getHome` in apps/api/src/catalog/catalog.service.ts returns it.
    Map<String, dynamic> payload() => {
          'segments': <Object>[],
          'activeSegmentId': null,
          'categories': <Object>[],
          'services': <Object>[],
          'banners': [
            {
              'id': 'ban-1',
              'imageUrl': 'https://cdn.resetmen.in/banners/tension.jpg',
              'altText': 'Tension Relief — ₹49 this week',
              'serviceSlug': 'tension-relief',
            },
            {
              'id': 'ban-2',
              'imageUrl': 'https://cdn.resetmen.in/banners/hours.jpg',
              'altText': 'Open till 10pm',
              'serviceSlug': null,
            },
          ],
        };

    test('reads banners in order, with and without a service', () {
      final banners = HomeData.fromJson(payload()).banners;

      expect(banners.map((b) => b.id), ['ban-1', 'ban-2']);
      expect(banners.first.serviceSlug, 'tension-relief');
      expect(banners.first.altText, 'Tension Relief — ₹49 this week');
      expect(banners.last.serviceSlug, isNull);
    });

    test('a server without banners is an empty carousel, not a crash', () {
      final json = payload()..remove('banners');
      expect(HomeData.fromJson(json).banners, isEmpty);
    });

    test('drops a banner that has no picture', () {
      final json = payload();
      (json['banners'] as List).add({
        'id': 'ban-3',
        'imageUrl': '',
        'altText': 'Nothing to show',
        'serviceSlug': null,
      });
      expect(HomeData.fromJson(json).banners.map((b) => b.id), ['ban-1', 'ban-2']);
    });
  });

  group('Terms', () {
    test('parses the Terms as GET /catalog/terms serves them', () {
      // `TERMS` in packages/types/src/terms.ts, verbatim.
      final terms = Terms.fromJson(const {
        'version': '2026-09-11',
        'title': 'RESETMEN – Terms & Conditions',
        'clauses': [
          'RESETMEN provides non-medical wellness, relaxation and body-care services only. We do not provide medical treatment, diagnosis or physiotherapy.',
          'Customers must inform RESETMEN of any relevant health condition, injury, allergy, recent surgery or other circumstance that may affect their session.',
          'Services are provided without removal of clothing. No sexual, intimate or inappropriate services are provided.',
          'Bookings, cancellations, rescheduling and refunds are subject to the RESETMEN Cancellation & Refund Policy.',
          'Individual experiences and results may vary. RESETMEN does not guarantee any specific medical or physical outcome.',
          'By making payment, you confirm that you have read and agreed to these Terms & Conditions and the applicable policies.',
        ],
        'agreement': 'I agree to the Terms & Conditions and understand that RESETMEN '
            'provides non-medical wellness services only',
      });

      expect(terms.version, '2026-09-11');
      expect(terms.title, 'RESETMEN – Terms & Conditions');
      expect(terms.clauses, hasLength(6));
      expect(terms.clauses.first, startsWith('RESETMEN provides non-medical'));
      expect(terms.agreement, contains('Terms & Conditions'));
    });
  });

  group('Support', () {
    /// As `listForCustomer` and `getForCustomer` in apps/api/src/support/support.service.ts
    /// return them — instants via `toISOString()`, so in UTC.
    Map<String, dynamic> summary({
      String status = 'OPEN',
      String lastBy = 'STAFF',
      bool unread = true,
      bool booking = true,
    }) =>
        {
          'id': 'thr-1',
          'publicId': 'HLP-7Q2K4M',
          'subject': 'Moving my Saturday booking',
          'status': status,
          'lastMessageAt': '2026-09-11T05:00:00.000Z',
          'lastMessageBy': lastBy,
          'createdAt': '2026-09-11T04:00:00.000Z',
          'booking': booking
              ? {
                  'id': 'bk-1',
                  'publicId': 'RST-2K8F4M',
                  'startsAt': '2026-09-12T04:30:00.000Z',
                  'serviceName': 'Tension Relief',
                }
              : null,
          'unread': unread,
          'preview': 'Yes — we have moved you to 11am.',
        };

    test('parses a question in the list, with its booking', () {
      final thread = SupportThreadSummary.fromJson(summary());

      expect(thread.publicId, 'HLP-7Q2K4M');
      expect(thread.subject, 'Moving my Saturday booking');
      expect(thread.unread, isTrue);
      expect(thread.preview, 'Yes — we have moved you to 11am.');
      expect(thread.lastMessageAt, DateTime.utc(2026, 9, 11, 5));
      expect(thread.booking?.publicId, 'RST-2K8F4M');
      expect(thread.booking?.serviceName, 'Tension Relief');
      expect(thread.booking?.startsAt, DateTime.utc(2026, 9, 12, 4, 30));
    });

    test('a question about no booking has none', () {
      expect(SupportThreadSummary.fromJson(summary(booking: false)).booking, isNull);
    });

    test('knows whose turn it is', () {
      expect(SupportThreadSummary.fromJson(summary()).hasReply, isTrue);
      expect(SupportThreadSummary.fromJson(summary(lastBy: 'CUSTOMER')).hasReply, isFalse);

      final closed = SupportThreadSummary.fromJson(summary(status: 'CLOSED'));
      expect(closed.isClosed, isTrue);
      expect(closed.hasReply, isFalse, reason: 'a closed question is nobody\'s turn');
    });

    test('parses a conversation oldest first, and who wrote each message', () {
      final thread = SupportThread.fromJson({
        ...summary(unread: false, booking: false),
        'messages': [
          {
            'id': 'msg-1',
            'author': 'CUSTOMER',
            'body': 'Can I move Saturday to 11?',
            'createdAt': '2026-09-11T04:00:00.000Z',
          },
          {
            'id': 'msg-2',
            'author': 'STAFF',
            'body': 'Yes — we have moved you to 11am.',
            'createdAt': '2026-09-11T05:00:00.000Z',
          },
        ],
      });

      expect(thread.booking, isNull);
      expect(thread.messages.map((m) => m.id), ['msg-1', 'msg-2']);
      expect(thread.messages.first.fromStore, isFalse);
      expect(thread.messages.last.fromStore, isTrue);
      expect(thread.messages.last.body, 'Yes — we have moved you to 11am.');
      expect(thread.messages.first.createdAt, DateTime.utc(2026, 9, 11, 4));
    });

    test('a conversation without a messages key is empty, not a crash', () {
      expect(SupportThread.fromJson(summary()).messages, isEmpty);
    });
  });
}
