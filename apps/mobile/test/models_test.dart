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
  });
}
