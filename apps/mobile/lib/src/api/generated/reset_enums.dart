// GENERATED — do not edit.
//
// Source: packages/types/src/*.ts (Zod schemas)
// Regenerate: pnpm gen:api
//
// These are the values the API actually sends. Editing this file by hand means the app and
// the server disagree about a status or an error code, and the symptom shows up as a blank
// screen rather than as a compile error.
//
// 19 enums, 100 values.

enum AdminRole {
  owner('OWNER'),
  manager('MANAGER'),
  staff('STAFF');

  const AdminRole(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static AdminRole? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in AdminRole.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum AllocationMode {
  exclusiveTo('EXCLUSIVE_TO'),
  excludeFrom('EXCLUDE_FROM');

  const AllocationMode(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static AllocationMode? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in AllocationMode.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum AllocationRecurrence {
  oneOff('ONE_OFF'),
  weekly('WEEKLY');

  const AllocationRecurrence(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static AllocationRecurrence? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in AllocationRecurrence.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum BookingSource {
  app('APP'),
  web('WEB'),
  adminWalkin('ADMIN_WALKIN');

  const BookingSource(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static BookingSource? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in BookingSource.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum BookingStatus {
  held('HELD'),
  confirmed('CONFIRMED'),
  checkedIn('CHECKED_IN'),
  inProgress('IN_PROGRESS'),
  completed('COMPLETED'),
  cancelled('CANCELLED'),
  noShow('NO_SHOW'),
  expired('EXPIRED');

  const BookingStatus(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static BookingStatus? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in BookingStatus.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum DevicePlatform {
  android('ANDROID'),
  ios('IOS'),
  web('WEB');

  const DevicePlatform(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static DevicePlatform? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in DevicePlatform.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum ErrorCode {
  unauthenticated('UNAUTHENTICATED'),
  forbidden('FORBIDDEN'),
  notFound('NOT_FOUND'),
  validationFailed('VALIDATION_FAILED'),
  otpRateLimited('OTP_RATE_LIMITED'),
  slotTaken('SLOT_TAKEN'),
  slotUnavailable('SLOT_UNAVAILABLE'),
  holdExpired('HOLD_EXPIRED'),
  serviceUnavailableAtTime('SERVICE_UNAVAILABLE_AT_TIME'),
  paymentFailed('PAYMENT_FAILED'),
  paymentNotRefundable('PAYMENT_NOT_REFUNDABLE'),
  webhookSignatureInvalid('WEBHOOK_SIGNATURE_INVALID'),
  bookingNotCancellable('BOOKING_NOT_CANCELLABLE'),
  rewardInvalid('REWARD_INVALID'),
  scratchAlreadyUsed('SCRATCH_ALREADY_USED'),
  outOfStock('OUT_OF_STOCK'),
  customerBlocked('CUSTOMER_BLOCKED'),
  checkinInvalid('CHECKIN_INVALID'),
  checkinAlreadyUsed('CHECKIN_ALREADY_USED'),
  idempotentReplayMismatch('IDEMPOTENT_REPLAY_MISMATCH'),
  storeClosed('STORE_CLOSED'),
  rateLimited('RATE_LIMITED'),
  internal('INTERNAL');

  const ErrorCode(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static ErrorCode? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in ErrorCode.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum Gender {
  male('MALE'),
  female('FEMALE'),
  other('OTHER'),
  undisclosed('UNDISCLOSED');

  const Gender(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static Gender? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in Gender.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum NotificationChannel {
  push('PUSH'),
  sms('SMS'),
  email('EMAIL'),
  whatsapp('WHATSAPP');

  const NotificationChannel(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static NotificationChannel? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in NotificationChannel.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum NotificationStatus {
  queued('QUEUED'),
  sent('SENT'),
  failed('FAILED');

  const NotificationStatus(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static NotificationStatus? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in NotificationStatus.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum NotificationTemplate {
  bookingConfirmed('booking_confirmed'),
  bookingReminder60('booking_reminder_60'),
  bookingReminder10('booking_reminder_10'),
  bookingCancelled('booking_cancelled'),
  bookingRescheduled('booking_rescheduled'),
  rewardEarned('reward_earned'),
  scratchCardIssued('scratch_card_issued'),
  streakMilestone('streak_milestone'),
  cashbackCredited('cashback_credited'),
  productOrderReady('product_order_ready');

  const NotificationTemplate(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static NotificationTemplate? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in NotificationTemplate.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum PaymentStatus {
  created('CREATED'),
  authorized('AUTHORIZED'),
  captured('CAPTURED'),
  failed('FAILED'),
  refunded('REFUNDED'),
  partiallyRefunded('PARTIALLY_REFUNDED');

  const PaymentStatus(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static PaymentStatus? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in PaymentStatus.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum ProductOrderStatus {
  pending('PENDING'),
  paid('PAID'),
  readyForPickup('READY_FOR_PICKUP'),
  pickedUp('PICKED_UP'),
  cancelled('CANCELLED');

  const ProductOrderStatus(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static ProductOrderStatus? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in ProductOrderStatus.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum ReportKind {
  revenue('revenue'),
  utilisation('utilisation'),
  noShow('no-show'),
  retention('retention'),
  bookings('bookings');

  const ReportKind(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static ReportKind? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in ReportKind.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum RewardSource {
  scratchCard('SCRATCH_CARD'),
  streak('STREAK'),
  promo('PROMO'),
  manual('MANUAL');

  const RewardSource(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static RewardSource? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in RewardSource.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum RewardStatus {
  active('ACTIVE'),
  redeemed('REDEEMED'),
  expired('EXPIRED'),
  revoked('REVOKED');

  const RewardStatus(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static RewardStatus? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in RewardStatus.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum RewardType {
  percentOff('PERCENT_OFF'),
  flatOff('FLAT_OFF'),
  freeService('FREE_SERVICE'),
  freeAddon('FREE_ADDON'),
  cashback('CASHBACK');

  const RewardType(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static RewardType? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in RewardType.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum ScratchCardStatus {
  issued('ISSUED'),
  scratched('SCRATCHED'),
  expired('EXPIRED');

  const ScratchCardStatus(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static ScratchCardStatus? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in ScratchCardStatus.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}

enum ScratchTrigger {
  onCheckin('ON_CHECKIN'),
  onNthBooking('ON_NTH_BOOKING'),
  onStreakComplete('ON_STREAK_COMPLETE');

  const ScratchTrigger(this.wire);

  /// The exact string the API sends and expects.
  final String wire;

  /// Parses a wire value.
  ///
  /// Returns null for anything unrecognised rather than throwing: a server newer than this
  /// build will send values that did not exist when it shipped, and a crash on an unknown
  /// status is a worse outcome than a row the app renders plainly.
  static ScratchTrigger? tryParse(String? value) {
    if (value == null) return null;
    for (final entry in ScratchTrigger.values) {
      if (entry.wire == value) return entry;
    }
    return null;
  }
}
