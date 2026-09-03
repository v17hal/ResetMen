import '../format.dart';
import 'generated/reset_enums.dart';

/// Hand-written models over the API's JSON.
///
/// Not generated: this API validates with Zod pipes rather than class DTOs, so its OpenAPI
/// document is rich in paths and thin in schemas — generating from it would produce
/// `Object` everywhere. The enums *are* generated (`pnpm gen:api`), because a status the
/// app does not recognise is a blank screen, and that is the part that must never drift.
///
/// Every `fromJson` is defensive about nulls the server may add later. A field this build
/// has never heard of is ignored; a field that goes missing falls back rather than throwing,
/// because a crash on the home screen is worse than a missing subtitle.

int _int(Object? value) => (value as num?)?.toInt() ?? 0;
String _str(Object? value, [String fallback = '']) => value as String? ?? fallback;

/// Parses an API instant, and records the store's offset on the way through.
///
/// `DateTime.parse` returns a correct instant but discards the offset, which is fine for
/// comparisons and wrong for display — see the note on `storeOffset` in format.dart. Every
/// instant from this API carries the store's offset, so capturing it here means the
/// formatters know how to shift back without a timezone database on the device.
DateTime _instant(Object? value, {DateTime? fallback}) {
  final raw = value as String?;
  if (raw == null) return fallback ?? DateTime.now();

  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return fallback ?? DateTime.now();

  rememberStoreOffset(raw);
  return parsed;
}

class StoreInfo {
  StoreInfo({
    required this.id,
    required this.name,
    required this.timezone,
    required this.address,
    required this.phone,
    required this.bookingHorizonDays,
    required this.cancellationWindowMinutes,
    required this.paymentsEnabled,
  });

  final String id;
  final String name;
  final String timezone;
  final String? address;
  final String? phone;
  final int bookingHorizonDays;
  final int cancellationWindowMinutes;

  /// Whether the store charges online.
  ///
  /// False today: there is no gateway and every booking is settled at the counter. The API
  /// has always sent this; it simply was not read, so the app told people they had paid.
  final bool paymentsEnabled;

  factory StoreInfo.fromJson(Map<String, dynamic> json) => StoreInfo(
        id: _str(json['id']),
        name: _str(json['name'], 'RESET'),
        // Falling back to the launch market's zone rather than the device's: showing a slot
        // in the phone's timezone is how someone arrives an hour late.
        timezone: _str(json['timezone'], 'Asia/Kolkata'),
        address: json['address'] as String?,
        phone: json['phone'] as String?,
        bookingHorizonDays: _int(json['bookingHorizonDays']),
        cancellationWindowMinutes: _int(json['cancellationWindowMinutes']),
        // Absent means the old behaviour: assume a gateway.
        paymentsEnabled: json['paymentsEnabled'] as bool? ?? true,
      );
}

class Segment {
  Segment({required this.id, required this.name, required this.imageUrl});

  final String id;
  final String name;
  final String? imageUrl;

  factory Segment.fromJson(Map<String, dynamic> json) => Segment(
        id: _str(json['id']),
        name: _str(json['name']),
        imageUrl: json['imageUrl'] as String?,
      );
}

class Category {
  Category({
    required this.id,
    required this.name,
    required this.description,
    required this.serviceCount,
    required this.fromPricePaise,
  });

  final String id;
  final String name;
  final String? description;
  final int serviceCount;
  final int? fromPricePaise;

  factory Category.fromJson(Map<String, dynamic> json) => Category(
        id: _str(json['id']),
        name: _str(json['name']),
        description: json['description'] as String?,
        serviceCount: _int(json['serviceCount']),
        fromPricePaise: (json['fromPricePaise'] as num?)?.toInt(),
      );
}

class ServiceSummary {
  ServiceSummary({
    required this.id,
    required this.name,
    required this.slug,
    required this.description,
    required this.imageUrl,
    required this.pricePaise,
    required this.durationMinutes,
    required this.categoryId,
  });

  final String id;
  final String name;
  final String slug;
  final String? description;
  final String? imageUrl;
  final int pricePaise;
  final int durationMinutes;
  final String categoryId;

  factory ServiceSummary.fromJson(Map<String, dynamic> json) => ServiceSummary(
        id: _str(json['id']),
        name: _str(json['name']),
        slug: _str(json['slug']),
        description: json['description'] as String?,
        imageUrl: json['imageUrl'] as String?,
        pricePaise: _int(json['pricePaise']),
        durationMinutes: _int(json['durationMinutes']),
        categoryId: _str(json['categoryId']),
      );
}

class HomeData {
  HomeData({
    required this.segments,
    required this.activeSegmentId,
    required this.categories,
    required this.services,
  });

  final List<Segment> segments;
  final String? activeSegmentId;
  final List<Category> categories;
  final List<ServiceSummary> services;

  factory HomeData.fromJson(Map<String, dynamic> json) => HomeData(
        segments: _list(json['segments'], Segment.fromJson),
        activeSegmentId: json['activeSegmentId'] as String?,
        categories: _list(json['categories'], Category.fromJson),
        services: _list(json['services'], ServiceSummary.fromJson),
      );

  List<ServiceSummary> servicesIn(String categoryId) =>
      services.where((service) => service.categoryId == categoryId).toList();
}

class AddonOption {
  AddonOption({
    required this.id,
    required this.name,
    required this.priceDeltaPaise,
    required this.durationDeltaMinutes,
  });

  final String id;
  final String name;
  final int priceDeltaPaise;
  final int durationDeltaMinutes;

  factory AddonOption.fromJson(Map<String, dynamic> json) => AddonOption(
        id: _str(json['id']),
        name: _str(json['name']),
        priceDeltaPaise: _int(json['priceDeltaPaise']),
        durationDeltaMinutes: _int(json['durationDeltaMinutes']),
      );
}

class AddonGroup {
  AddonGroup({
    required this.id,
    required this.name,
    required this.minSelect,
    required this.maxSelect,
    required this.options,
  });

  final String id;
  final String name;
  final int minSelect;
  final int maxSelect;
  final List<AddonOption> options;

  bool get isSingleSelect => maxSelect == 1;

  factory AddonGroup.fromJson(Map<String, dynamic> json) => AddonGroup(
        id: _str(json['id']),
        name: _str(json['name']),
        minSelect: _int(json['minSelect']),
        maxSelect: (json['maxSelect'] as num?)?.toInt() ?? 1,
        options: _list(json['options'], AddonOption.fromJson),
      );
}

class ServiceDetail {
  ServiceDetail({
    required this.id,
    required this.name,
    required this.description,
    required this.imageUrl,
    required this.pricePaise,
    required this.durationMinutes,
    required this.addonGroups,
  });

  final String id;
  final String name;
  final String? description;
  final String? imageUrl;
  final int pricePaise;
  final int durationMinutes;
  final List<AddonGroup> addonGroups;

  factory ServiceDetail.fromJson(Map<String, dynamic> json) => ServiceDetail(
        id: _str(json['id']),
        name: _str(json['name']),
        description: json['description'] as String?,
        imageUrl: json['imageUrl'] as String?,
        pricePaise: _int(json['pricePaise']),
        durationMinutes: _int(json['durationMinutes']),
        addonGroups: _list(json['addonGroups'], AddonGroup.fromJson),
      );
}

class Slot {
  Slot({
    required this.startsAt,
    required this.endsAt,
    required this.stationsAvailable,
  });

  final DateTime startsAt;
  final DateTime endsAt;
  final int stationsAvailable;

  factory Slot.fromJson(Map<String, dynamic> json) => Slot(
        startsAt: _instant(json['startsAt']),
        endsAt: _instant(json['endsAt']),
        stationsAvailable: _int(json['stationsAvailable']),
      );

  /// The exact string the server sent, needed verbatim when holding the slot.
  String get startsAtIso => startsAt.toIso8601String();
}

class Availability {
  Availability({
    required this.date,
    required this.timezone,
    required this.totalDurationMinutes,
    required this.payablePaise,
    required this.slots,
    required this.computedAt,
  });

  final String date;
  final String timezone;
  final int totalDurationMinutes;
  final int payablePaise;
  final List<Slot> slots;
  final DateTime computedAt;

  factory Availability.fromJson(Map<String, dynamic> json) => Availability(
        date: _str(json['date']),
        timezone: _str(json['timezone'], 'Asia/Kolkata'),
        totalDurationMinutes: _int(json['totalDurationMinutes']),
        payablePaise: _int(json['payablePaise']),
        slots: _list(json['slots'], Slot.fromJson),
        computedAt: _instant(json['computedAt']),
      );
}

class DayAvailability {
  DayAvailability({
    required this.date,
    required this.isOpen,
    required this.slotCount,
  });

  final String date;
  final bool isOpen;
  final int slotCount;

  factory DayAvailability.fromJson(Map<String, dynamic> json) => DayAvailability(
        date: _str(json['date']),
        isOpen: json['isOpen'] as bool? ?? false,
        slotCount: _int(json['slotCount']),
      );
}

class AppliedReward {
  AppliedReward({
    required this.id,
    required this.label,
    required this.discountPaise,
    required this.postVisitCreditPaise,
  });

  final String id;
  final String label;
  final int discountPaise;

  /// Cashback only, and zero for every other type. Credited on check-in rather than taken
  /// off the total, so it is shown as "back after your visit" and never added to the
  /// discount.
  final int postVisitCreditPaise;

  factory AppliedReward.fromJson(Map<String, dynamic> json) => AppliedReward(
        id: _str(json['id']),
        label: _str(json['label']),
        discountPaise: _int(json['discountPaise']),
        postVisitCreditPaise: _int(json['postVisitCreditPaise']),
      );
}

class Quote {
  Quote({
    required this.serviceId,
    required this.serviceName,
    required this.durationMinutes,
    required this.basePricePaise,
    required this.addonsPricePaise,
    required this.discountPaise,
    required this.payablePaise,
    required this.addons,
    required this.appliedReward,
  });

  final String serviceId;
  final String serviceName;
  final int durationMinutes;
  final int basePricePaise;
  final int addonsPricePaise;
  final int discountPaise;
  final int payablePaise;
  final List<({String id, String name, int pricePaise})> addons;
  final AppliedReward? appliedReward;

  factory Quote.fromJson(Map<String, dynamic> json) => Quote(
        serviceId: _str(json['serviceId']),
        serviceName: _str(json['serviceName']),
        durationMinutes: _int(json['durationMinutes']),
        basePricePaise: _int(json['basePricePaise']),
        addonsPricePaise: _int(json['addonsPricePaise']),
        discountPaise: _int(json['discountPaise']),
        payablePaise: _int(json['payablePaise']),
        addons: ((json['addons'] as List?) ?? [])
            .whereType<Map<String, dynamic>>()
            .map((a) => (
                  id: _str(a['id']),
                  name: _str(a['name']),
                  pricePaise: _int(a['pricePaise']),
                ))
            .toList(),
        appliedReward: json['appliedReward'] == null
            ? null
            : AppliedReward.fromJson(
                json['appliedReward'] as Map<String, dynamic>),
      );
}

class Hold {
  Hold({
    required this.bookingId,
    required this.publicId,
    required this.startsAt,
    required this.holdExpiresAt,
    required this.payablePaise,
    required this.paymentRequired,
  });

  final String bookingId;
  final String publicId;
  final DateTime startsAt;
  final DateTime holdExpiresAt;
  final int payablePaise;

  /// False while the store takes payment at the counter.
  ///
  /// The hold then comes back already CONFIRMED and there is nothing to charge. Dropping
  /// this field meant checkout asked for a payment order anyway and the API answered "this
  /// booking is already paid for" — the customer could not finish a booking that had, in
  /// fact, already succeeded.
  final bool paymentRequired;

  factory Hold.fromJson(Map<String, dynamic> json) {
    final pricing = (json['pricing'] as Map<String, dynamic>?) ?? const {};
    return Hold(
      bookingId: _str(json['bookingId']),
      publicId: _str(json['publicId']),
      startsAt: _instant(json['startsAt']),
      holdExpiresAt: _instant(json['holdExpiresAt']),
      payablePaise: _int(pricing['payablePaise']),
      // Absent means the old behaviour: charge for it.
      paymentRequired: json['paymentRequired'] as bool? ?? true,
    );
  }
}

class PaymentOrder {
  PaymentOrder({
    required this.paymentId,
    required this.gatewayOrderId,
    required this.keyId,
    required this.amountPaise,
    required this.currency,
    required this.simulated,
    required this.prefillName,
    required this.prefillContact,
    required this.prefillEmail,
  });

  final String paymentId;
  final String gatewayOrderId;

  /// A publishable key. The secret never leaves the server.
  final String keyId;
  final int amountPaise;
  final String currency;

  /// True in development, where no Razorpay credentials are configured.
  final bool simulated;
  final String? prefillName;
  final String? prefillContact;
  final String? prefillEmail;

  factory PaymentOrder.fromJson(Map<String, dynamic> json) {
    final prefill = (json['prefill'] as Map<String, dynamic>?) ?? const {};
    return PaymentOrder(
      paymentId: _str(json['paymentId']),
      gatewayOrderId: _str(json['gatewayOrderId']),
      keyId: _str(json['keyId']),
      amountPaise: _int(json['amountPaise']),
      currency: _str(json['currency'], 'INR'),
      simulated: json['simulated'] as bool? ?? false,
      prefillName: prefill['name'] as String?,
      prefillContact: prefill['contact'] as String?,
      prefillEmail: prefill['email'] as String?,
    );
  }
}

class Booking {
  Booking({
    required this.id,
    required this.publicId,
    required this.status,
    required this.isPaid,
    required this.serviceName,
    required this.startsAt,
    required this.endsAt,
    required this.durationMinutes,
    required this.payablePaise,
    required this.addonNames,
    required this.canCancel,
    required this.checkinPayload,
  });

  final String id;
  final String publicId;
  final BookingStatus? status;

  /// Whether the store has taken the money yet.
  ///
  /// There is no gateway, so a booking is made unpaid and settled at the counter. The API
  /// has always sent this and the app has never read it, so an unpaid booking was shown
  /// exactly like a settled one — no prompt to pay, and nothing explaining why the entry
  /// code had not appeared.
  final bool isPaid;
  final String serviceName;
  final DateTime startsAt;
  final DateTime endsAt;
  final int durationMinutes;
  final int payablePaise;
  final List<String> addonNames;
  final bool canCancel;

  /// `RST1.<publicId>.<hmac>` — what the counter scans. Null until confirmed.
  final String? checkinPayload;

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
        id: _str(json['id']),
        publicId: _str(json['publicId']),
        status: BookingStatus.tryParse(json['status'] as String?),
        isPaid: json['isPaid'] as bool? ?? false,
        serviceName: _str(json['serviceName']),
        startsAt: _instant(json['startsAt']),
        endsAt: _instant(json['endsAt']),
        durationMinutes: _int(json['durationMinutes']),
        payablePaise: _int(json['payablePaise']),
        addonNames: ((json['addons'] as List?) ?? [])
            .whereType<Map<String, dynamic>>()
            .map((a) => _str(a['name']))
            .toList(),
        canCancel: json['canCancel'] as bool? ?? false,
        checkinPayload: json['checkinPayload'] as String?,
      );

  /// Written to the offline cache and read back through [Booking.fromJson].
  ///
  /// Every field the constructor requires has to be here. `isPaid` defaults to false when
  /// absent, so leaving it out would make a settled booking read as unpaid the moment the
  /// phone lost signal — and tell the customer to go and pay for something they had
  /// already paid for.
  Map<String, dynamic> toCacheJson() => {
        'id': id,
        'publicId': publicId,
        'status': status?.wire,
        'isPaid': isPaid,
        'serviceName': serviceName,
        'startsAt': startsAt.toIso8601String(),
        'endsAt': endsAt.toIso8601String(),
        'durationMinutes': durationMinutes,
        'payablePaise': payablePaise,
        'addons': addonNames.map((name) => {'name': name}).toList(),
        'canCancel': canCancel,
        'checkinPayload': checkinPayload,
      };
}

class UserProfile {
  UserProfile({
    required this.id,
    required this.phone,
    required this.name,
    required this.email,
    required this.gender,
    required this.dateOfBirth,
  });

  final String id;

  /// Null for anyone who signed in with Google and has not added one. Asked for on the
  /// account screen, never required to book.
  final String? phone;
  final String? name;
  final String? email;
  final Gender? gender;

  /// `YYYY-MM-DD`. Kept as a string, not a DateTime: a birthday has no time of day, and
  /// parsing it into one shifts it a day either side of midnight in some timezones.
  final String? dateOfBirth;

  /// What the profile prompt is trying to fill in. Name and phone are what the counter
  /// actually needs — the rest is nice to have.
  bool get isComplete =>
      (name?.trim().isNotEmpty ?? false) && (phone?.trim().isNotEmpty ?? false);

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: _str(json['id']),
        phone: json['phone'] as String?,
        name: json['name'] as String?,
        email: json['email'] as String?,
        gender: Gender.tryParse(json['gender'] as String?),
        dateOfBirth: json['dateOfBirth'] as String?,
      );
}

class WalletReward {
  WalletReward({
    required this.id,
    required this.label,
    required this.validTill,
    required this.status,
    required this.applicable,
    required this.blockedReason,
    required this.discountPaise,
    required this.postVisitCreditPaise,
    required this.minOrderPaise,
  });

  final String id;
  final String label;
  final DateTime validTill;
  final RewardStatus? status;

  /// Decided server-side against the exact basket, so the app never re-implements
  /// minimum-order rules — it greys out the row and prints the reason it was given.
  final bool applicable;
  final String? blockedReason;
  final int discountPaise;
  final int postVisitCreditPaise;
  final int minOrderPaise;

  factory WalletReward.fromJson(Map<String, dynamic> json) => WalletReward(
        id: _str(json['id']),
        label: _str(json['label']),
        validTill: _instant(json['validTill']),
        status: RewardStatus.tryParse(json['status'] as String?),
        applicable: json['applicable'] as bool? ?? false,
        blockedReason: json['blockedReason'] as String?,
        discountPaise: _int(json['discountPaise']),
        postVisitCreditPaise: _int(json['postVisitCreditPaise']),
        minOrderPaise: _int(json['minOrderPaise']),
      );
}

class StreakGoal {
  StreakGoal({
    required this.name,
    required this.requiredVisits,
    required this.rewardLabel,
    required this.remaining,
  });

  final String name;
  final int requiredVisits;
  final String rewardLabel;
  final int remaining;

  factory StreakGoal.fromJson(Map<String, dynamic> json) => StreakGoal(
        name: _str(json['name']),
        requiredVisits: _int(json['requiredVisits']),
        rewardLabel: _str(json['rewardLabel']),
        remaining: _int(json['remaining']),
      );
}

class Streak {
  Streak({
    required this.currentCount,
    required this.bestCount,
    required this.totalVisits,
    required this.goal,
  });

  final int currentCount;
  final int bestCount;
  final int totalVisits;
  final StreakGoal? goal;

  double get progress =>
      goal == null || goal!.requiredVisits == 0
          ? 0
          : (currentCount / goal!.requiredVisits).clamp(0, 1).toDouble();

  factory Streak.fromJson(Map<String, dynamic> json) => Streak(
        currentCount: _int(json['currentCount']),
        bestCount: _int(json['bestCount']),
        totalVisits: _int(json['totalVisits']),
        goal: json['goal'] == null
            ? null
            : StreakGoal.fromJson(json['goal'] as Map<String, dynamic>),
      );
}

class ScratchCard {
  ScratchCard({
    required this.id,
    required this.campaignName,
    required this.status,
    required this.rewardLabel,
  });

  final String id;
  final String campaignName;
  final ScratchCardStatus? status;

  /// Null until the card is scratched — the whole point of the mechanic.
  final String? rewardLabel;

  factory ScratchCard.fromJson(Map<String, dynamic> json) {
    final reward = json['reward'] as Map<String, dynamic>?;
    return ScratchCard(
      id: _str(json['id']),
      campaignName: _str(json['campaignName']),
      status: ScratchCardStatus.tryParse(json['status'] as String?),
      rewardLabel: reward == null ? null : _str(reward['label']),
    );
  }
}

List<T> _list<T>(Object? raw, T Function(Map<String, dynamic>) fromJson) =>
    ((raw as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(fromJson)
        .toList();

// ── Shop ────────────────────────────────────────────────────────────────────
//
// The retail shelf. Mirrors `packages/types/src/products.ts` field for field — the app had
// no shop at all, so every one of these is new rather than adjusted.

/// One item on the shelf.
class Product {
  const Product({
    required this.id,
    required this.name,
    required this.slug,
    required this.description,
    required this.images,
    required this.pricePaise,
    required this.mrpPaise,
    required this.inStock,
    required this.sku,
  });

  final String id;
  final String name;
  final String slug;
  final String? description;
  final List<String> images;
  final int pricePaise;

  /// The struck-through price, when there is one to strike through.
  final int? mrpPaise;

  /// A flag, not a count. The API deliberately does not expose how many are left — a
  /// competitor should not be able to read the shelf.
  final bool inStock;
  final String? sku;

  bool get hasDiscount => mrpPaise != null && mrpPaise! > pricePaise;

  factory Product.fromJson(Map<String, dynamic> json) => Product(
        id: _str(json['id']),
        name: _str(json['name']),
        slug: _str(json['slug']),
        description: json['description'] as String?,
        images: ((json['images'] as List?) ?? const [])
            .whereType<String>()
            .toList(),
        pricePaise: _int(json['pricePaise']),
        mrpPaise: (json['mrpPaise'] as num?)?.toInt(),
        inStock: json['inStock'] as bool? ?? false,
        sku: json['sku'] as String?,
      );
}

/// One line of an order, priced as it was when the order was placed.
class ProductOrderLine {
  const ProductOrderLine({
    required this.productId,
    required this.name,
    required this.unitPricePaise,
    required this.qty,
    required this.linePaise,
  });

  final String productId;
  final String name;
  final int unitPricePaise;
  final int qty;
  final int linePaise;

  factory ProductOrderLine.fromJson(Map<String, dynamic> json) => ProductOrderLine(
        productId: _str(json['productId']),
        name: _str(json['name']),
        unitPricePaise: _int(json['unitPricePaise']),
        qty: _int(json['qty']),
        linePaise: _int(json['linePaise']),
      );
}

/// An order placed in the app and collected at the counter.
class ProductOrder {
  const ProductOrder({
    required this.id,
    required this.publicId,
    required this.status,
    required this.totalPaise,
    required this.createdAt,
    required this.items,
  });

  final String id;
  final String publicId;
  final ProductOrderStatus? status;
  final int totalPaise;
  final DateTime createdAt;
  final List<ProductOrderLine> items;

  /// Placed and not yet paid for. There is no gateway, so this is where every order starts
  /// and where it stays until somebody settles it at the counter.
  bool get awaitingPayment => status == ProductOrderStatus.pending;

  factory ProductOrder.fromJson(Map<String, dynamic> json) => ProductOrder(
        id: _str(json['id']),
        publicId: _str(json['publicId']),
        status: ProductOrderStatus.tryParse(json['status'] as String?),
        totalPaise: _int(json['totalPaise']),
        createdAt: _instant(json['createdAt']),
        items: _list(json['items'], ProductOrderLine.fromJson),
      );
}
