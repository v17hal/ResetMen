import 'dart:async';
import 'dart:math';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'confirmation_screen.dart';
import 'phone_required_sheet.dart';
import 'sign_in_sheet.dart';
import 'terms_screen.dart';

/// Confirm and book.
///
/// Nothing is booked until the button is pressed. The hold used to be created the moment
/// this screen opened, on the theory that deciding about a reward should not cost someone
/// their slot. With payment at the counter that reasoning inverts: the API confirms the
/// booking outright, so opening the screen *was* booking. A customer who signed in, entered
/// their number and then thought better of it already had an appointment, and only found
/// out by reloading. The same fault was reported on the web checkout and fixed there.
///
/// It also left signed-out customers stuck. The API refuses an anonymous booking when
/// payments are off, so the hold failed with a 401 before the sign-in sheet was ever
/// offered, and the button stayed disabled because it required a hold that could never
/// exist.
///
/// So the order is: sign in, give a number if the store has none, then book.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({
    super.key,
    required this.serviceId,
    required this.startsAt,
    required this.addonIds,
  });

  final String serviceId;
  final String startsAt;
  final List<String> addonIds;

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  /// One key per checkout, generated on mount and reused across retries. The value of an
  /// idempotency key is that a *retry* carries the same one; regenerating per tap protects
  /// nothing.
  final String _holdKey = _randomKey('hold');
  final String _orderKey = _randomKey('order');

  Razorpay? _razorpay;
  Completer<void>? _payment;

  Quote? _quote;
  Hold? _hold;

  /// Online or at the counter — client request 28/10/2026. The counter is preselected: it is
  /// how this shop has always worked and the path every regular knows.
  String _method = 'COUNTER';
  String? _rewardId;

  /// The coupon code on this booking, as the server spelled it back — client request
  /// 06/11/2026.
  ///
  /// Set only once a quote has accepted it, so the hold never sends a code the customer has
  /// not seen priced. One discount per booking: a code replaces a reward and a reward
  /// replaces a code, because the API refuses the two together.
  String? _couponCode;
  final TextEditingController _code = TextEditingController();
  bool _codeOpen = false;
  bool _applyingCode = false;

  /// Shown under the code field rather than in the card below, beside what was typed.
  String? _codeError;
  String? _error;

  /// The version of the Terms the box was ticked against, or null while unticked.
  ///
  /// A version rather than a bool: agreement is to a particular text. When the Terms change
  /// under the customer the box empties by itself, because what they ticked is no longer
  /// what is on offer — and the version is what the booking records.
  String? _agreedVersion;
  bool _loading = true;
  bool _paying = false;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay()
      ..on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess)
      ..on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError)
      ..on(Razorpay.EVENT_EXTERNAL_WALLET, (_) {});

    // Re-renders the countdown once a second without refetching anything.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _hold != null) setState(() {});
    });

    unawaited(_loadQuote());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _razorpay?.clear();
    _code.dispose();
    super.dispose();
  }

  static String _randomKey(String prefix) {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return '$prefix-${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
  }

  Future<void> _loadQuote() async {
    try {
      final quote = await ref.read(repositoryProvider).quote(
            serviceId: widget.serviceId,
            addonOptionIds: widget.addonIds,
            rewardId: _rewardId,
            couponCode: _couponCode,
          );
      if (mounted) setState(() => _quote = quote);
    } on ResetApiException catch (error) {
      if (!mounted) return;
      // A code that priced a moment ago can stop qualifying — the basket no longer meets
      // its minimum, or it was used up. Kept, it would fail this quote and every one after,
      // and the screen would have no price to show.
      if (error.isCouponInvalid && _couponCode != null) {
        await _dropCode(error);
        return;
      }
      setState(() => _error = friendlyMessage(error));
    } catch (error) {
      if (mounted) setState(() => _error = friendlyMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Creates the booking. Returns null when it could not be created.
  ///
  /// Re-entrant on purpose: a hold already taken is returned rather than a second one made,
  /// so a customer who is asked for a phone number and comes back does not end up with two
  /// appointments.
  Future<Hold?> _createHold() async {
    final existing = _hold;
    if (existing != null) return existing;

    try {
      final hold = await ref.read(repositoryProvider).hold(
            serviceId: widget.serviceId,
            startsAt: widget.startsAt,
            addonOptionIds: widget.addonIds,
            rewardId: _rewardId,
            couponCode: _couponCode,
            termsVersion: _agreedVersion,
            // Only offered while the store has online payment switched on.
            paymentMethod: (ref.read(storeProvider).valueOrNull?.paymentsEnabled ?? false)
                ? _method
                : 'COUNTER',
            idempotencyKey: _holdKey,
          );
      if (mounted) setState(() => _hold = hold);
      return hold;
    } on ResetApiException catch (error) {
      if (!mounted) return null;

      // The store has no number for this account. Answerable right here, so ask rather than
      // showing the sentence and stopping.
      if (error.needsPhone) {
        final saved = await showPhoneRequiredSheet(context, reason: error.detail);
        if (!saved || !mounted) {
          setState(() => _error = friendlyMessage(error));
          return null;
        }
        return _createHold();
      }

      // The Terms changed while they were on this screen, and a booking recorded against
      // text they never saw would make the tick meaningless, so the API refuses it. Empty
      // the box, fetch the new text, and let the server's sentence say why. Retrying with the
      // same hold key is safe: a refused attempt releases its key rather than replaying.
      if (error.termsOutdated) {
        setState(() {
          _agreedVersion = null;
          _error = friendlyMessage(error);
        });
        ref.invalidate(termsProvider);
        return null;
      }

      // The code was good when it was applied and is not now — used up by other customers,
      // or expired while they were deciding. Sent again it would be refused on every press,
      // so it comes off and the booking is priced without it. Nothing is booked: the total
      // has just changed, and they should see the new one before pressing again.
      if (error.isCouponInvalid && _couponCode != null) {
        await _dropCode(error);
        return null;
      }

      setState(() => _error = friendlyMessage(error));

      // The slot went while they were deciding — either to somebody else, or to a booking
      // of their own that overlaps it. `friendlyMessage` shows the server's own words,
      // which say which. Either way the answer is another time.
      if (error.isSlotGone) {
        await Future<void>.delayed(const Duration(milliseconds: 2200));
        if (mounted) Navigator.of(context).pop();
      }
      return null;
    } catch (error) {
      if (mounted) setState(() => _error = friendlyMessage(error));
      return null;
    }
  }

  Future<void> _book() async {
    // Signing in first, not after. With payment at the counter the API refuses an anonymous
    // booking outright, so attempting one and then offering the sheet meant the customer
    // met a 401 they had done nothing to deserve.
    if (ref.read(sessionProvider).valueOrNull == null) {
      final signedIn = await showSignInSheet(
        context,
        reason: 'So we can send you your booking and your entry code.',
      );
      if (!signedIn || !mounted) return;
    }

    setState(() {
      _paying = true;
      _error = null;
    });

    try {
      final repository = ref.read(repositoryProvider);

      // Everything up to here was reversible. This is the line that books.
      final hold = await _createHold();
      if (hold == null || !mounted) {
        setState(() => _paying = false);
        return;
      }

      // Nothing to charge: the store takes money at the counter, so the hold came back
      // already CONFIRMED. Asking for a payment order here is what produced "this booking
      // is already paid for" on a booking that had just been made successfully.
      if (!hold.paymentRequired) {
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) => ConfirmationScreen(bookingId: hold.bookingId),
          ),
        );
        return;
      }

      // They chose online, the payment did not go through, and they switched to the
      // counter. The held booking is converted rather than a second one made beside it —
      // on a single-station service the second would find the first in its way.
      if (_method == 'COUNTER') {
        await repository.payAtCounter(hold.bookingId);
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) => ConfirmationScreen(bookingId: hold.bookingId),
          ),
        );
        return;
      }

      final order = await repository.createOrder(
        bookingId: hold.bookingId,
        idempotencyKey: _orderKey,
      );

      if (order.simulated) {
        // No gateway exists locally, so the server completes the charge itself.
        await repository.simulateSuccess(order.paymentId);
      } else {
        _payment = Completer<void>();
        _razorpay!.open({
          'key': order.keyId,
          'amount': order.amountPaise,
          'currency': order.currency,
          'name': ref.read(storeProvider).valueOrNull?.name ?? 'RESET',
          'description': _quote?.serviceName ?? 'Booking',
          'order_id': order.gatewayOrderId,
          'prefill': {
            if (order.prefillContact != null) 'contact': order.prefillContact,
            if (order.prefillEmail != null) 'email': order.prefillEmail,
          },
          'retry': {'enabled': false},
        });
        await _payment!.future;
      }

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => ConfirmationScreen(bookingId: hold.bookingId),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _paying = false;
        _error = friendlyMessage(error, 'The booking did not go through.');
      });
    }
  }

  void _onPaymentSuccess(PaymentSuccessResponse response) {
    // Advisory only — the webhook is authoritative, so a failure here is not a failed
    // booking and is deliberately swallowed.
    unawaited(
      ref
          .read(repositoryProvider)
          .verifyPayment(
            orderId: response.orderId ?? '',
            paymentId: response.paymentId ?? '',
            signature: response.signature ?? '',
          )
          .catchError((_) {}),
    );
    _payment?.complete();
  }

  void _onPaymentError(PaymentFailureResponse response) {
    // Code 2 is "cancelled by user" — a decision, not a failure. The hold survives and they
    // can simply press Pay again.
    final cancelled = response.code == Razorpay.PAYMENT_CANCELLED;
    _payment?.completeError(
      cancelled
          ? const _PaymentCancelled()
          : Exception(response.message ?? 'The payment was declined.'),
    );
  }

  Future<void> _applyReward(String? rewardId) async {
    setState(() {
      _rewardId = rewardId;
      // One discount per booking: choosing a reward takes the code off.
      _couponCode = null;
      _error = null;
    });
    await _loadQuote();
  }

  /// Prices the booking with the typed code, and applies it only if the server accepts it.
  ///
  /// Asked without the reward, because the API refuses the two together; the reward is let
  /// go only once the code is in. A refusal leaves everything as it was, with the server's
  /// reason under the field and what they typed still in it, so a typo is one letter to fix.
  Future<void> _applyCode() async {
    final typed = _code.text.trim();
    if (typed.isEmpty || _applyingCode) return;

    // The server counts uses per customer, so it refuses a code from a signed-out one. Book
    // is the only other way to sign in on this screen, and it books — asked here, they see
    // the new price before deciding.
    if (ref.read(sessionProvider).valueOrNull == null) {
      final signedIn = await showSignInSheet(
        context,
        reason: 'So we can check the code against your account.',
      );
      if (!signedIn || !mounted) return;
    }

    setState(() {
      _applyingCode = true;
      _codeError = null;
      _error = null;
    });

    try {
      final quote = await ref.read(repositoryProvider).quote(
            serviceId: widget.serviceId,
            addonOptionIds: widget.addonIds,
            couponCode: typed,
          );
      if (!mounted) return;
      final coupon = quote.appliedCoupon;
      setState(() {
        _applyingCode = false;
        if (coupon == null) {
          // A server from before codes ignores the field and prices without it. Showing
          // that as applied would promise a discount nobody is giving.
          _codeError = 'This code could not be applied.';
        } else {
          _quote = quote;
          _couponCode = coupon.code;
          _rewardId = null;
          _codeOpen = false;
          _code.clear();
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _applyingCode = false;
        _codeError = friendlyMessage(error);
      });
    }
  }

  Future<void> _removeCode() async {
    setState(() {
      _couponCode = null;
      _codeError = null;
      _error = null;
    });
    await _loadQuote();
  }

  /// Takes off a code that has stopped qualifying, says why, and prices the booking without
  /// it — so the base price shows and Book works, rather than every attempt failing on the
  /// same code. It goes back in the field with the reason under it, so the customer can see
  /// which code and why.
  Future<void> _dropCode(ResetApiException error) async {
    setState(() {
      _code.text = _couponCode ?? _code.text;
      _couponCode = null;
      _codeOpen = true;
      _codeError = friendlyMessage(error);
    });
    await _loadQuote();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = ref.watch(sessionProvider);
    final quote = _quote;

    /// Read from the store, not from a hold. The hold no longer exists when this is first
    /// painted, and defaulting it to "payments on" put the price on a button that takes no
    /// money and promised a checkout that never comes.
    final paymentsEnabled = ref.watch(storeProvider).valueOrNull?.paymentsEnabled ?? false;

    final termsAsync = ref.watch(termsProvider);
    final terms = termsAsync.valueOrNull;
    final agreed = terms != null && _agreedVersion == terms.version;

    final wallet = session.valueOrNull == null
        ? const AsyncValue<List<WalletReward>>.data([])
        : ref.watch(basketWalletProvider(
            (serviceId: widget.serviceId, addonIds: widget.addonIds),
          ));

    return Scaffold(
      appBar: AppBar(title: const Text('Confirm and pay')),
      body: _loading
          ? const SkeletonList(
              rows: 4,
              height: 96,
              padding: EdgeInsets.all(ResetTokens.gutter),
            )
          : ListView(
              padding: const EdgeInsets.all(ResetTokens.gutter),
              children: [
                if (_hold != null) _HoldCountdown(expiresAt: _hold!.holdExpiresAt),
                const SizedBox(height: ResetTokens.spaceBase),

                if (quote != null) _QuoteCard(quote: quote, startsAt: widget.startsAt),

                if (wallet.valueOrNull?.isNotEmpty ?? false) ...[
                  const SizedBox(height: ResetTokens.spaceXl),
                  Text('Your rewards', style: ResetTokens.h2),
                  const SizedBox(height: ResetTokens.spaceSm),
                  for (final reward in wallet.value!)
                    Padding(
                      padding: const EdgeInsets.only(bottom: ResetTokens.spaceSm),
                      child: _RewardTile(
                        reward: reward,
                        selected: _rewardId == reward.id,
                        onTap: () => _applyReward(
                          _rewardId == reward.id ? null : reward.id,
                        ),
                      ),
                    ),
                ],

                // Offered whether or not there are rewards above it: a code is something the
                // customer was handed, not something the app already knows about.
                const SizedBox(height: ResetTokens.spaceSm),
                _CouponCode(
                  controller: _code,
                  applied: _couponCode == null ? null : quote?.appliedCoupon,
                  open: _codeOpen,
                  applying: _applyingCode,
                  error: _codeError,
                  onOpen: () => setState(() => _codeOpen = true),
                  onApply: _applyCode,
                  onRemove: _removeCode,
                ),

                if (_error != null) ...[
                  const SizedBox(height: ResetTokens.spaceBase),
                  ResetCard(
                    color: theme.colorScheme.error.withValues(alpha: 0.08),
                    borderColor: theme.colorScheme.error.withValues(alpha: 0.4),
                    child: Text(
                      _error!,
                      style: ResetTokens.body.copyWith(color: theme.colorScheme.error),
                    ),
                  ),
                ],

                if (paymentsEnabled) ...[
                  const SizedBox(height: ResetTokens.spaceXl),
                  _PaymentChoice(
                    value: _method,
                    onChanged: (value) => setState(() {
                      _method = value;
                      _error = null;
                    }),
                  ),
                ],

                const SizedBox(height: ResetTokens.spaceXl),
                _TermsAgreement(
                  terms: termsAsync,
                  agreed: agreed,
                  onChanged: (value) =>
                      setState(() => _agreedVersion = value ? terms?.version : null),
                  onRetry: () => ref.invalidate(termsProvider),
                ),
                const SizedBox(height: ResetTokens.spaceBase),
                PrimaryButton(
                  // "Pay" only when money is taken here. Paying at the counter, the
                  // button books and charges nothing.
                  label: switch ((paymentsEnabled && _method == 'ONLINE', quote)) {
                    (false, _) => 'Book',
                    (true, null) => 'Pay',
                    (true, final q?) => 'Pay ${formatMoney(q.payablePaise)}',
                  },
                  loading: _paying,
                  // Enabled once there is something to book and the Terms are ticked. It
                  // used to require a hold, which is the thing this button now creates — so
                  // while the hold was failing, the only control that could recover was
                  // disabled.
                  onPressed: quote == null || !agreed ? null : _book,
                ),

                const SizedBox(height: ResetTokens.spaceSm),
                Text(
                  [
                    // Said before confirming, not after. Someone expecting to pay in the
                    // app should learn otherwise while they can still change their mind.
                    if (paymentsEnabled && _method == 'ONLINE')
                      'Paid securely through Razorpay.'
                    else
                      'Pay at the counter.',
                    'Free cancellation up to '
                        '${((ref.watch(storeProvider).valueOrNull?.cancellationWindowMinutes ?? 120) / 60).round()} '
                        'hours before your slot.',
                  ].join(' '),
                  style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
    );
  }
}

class _PaymentCancelled implements Exception {
  const _PaymentCancelled();
}

/// Online now, or at the counter on arrival — the customer's choice.
class _PaymentChoice extends StatelessWidget {
  const _PaymentChoice({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const options = [
      (
        'ONLINE',
        'Pay online now',
        'UPI, card or netbanking. Your entry QR is ready straight away.',
      ),
      (
        'COUNTER',
        'Pay at the counter',
        'Pay when you arrive. Your entry QR is issued once you have paid.',
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('How would you like to pay?', style: ResetTokens.h2),
        const SizedBox(height: ResetTokens.spaceSm),
        for (final (method, title, detail) in options)
          Padding(
            padding: const EdgeInsets.only(bottom: ResetTokens.spaceSm),
            child: Semantics(
              inMutuallyExclusiveGroup: true,
              checked: value == method,
              child: InkWell(
                onTap: () => onChanged(method),
                borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
                child: Container(
                  padding: const EdgeInsets.all(ResetTokens.spaceMd),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
                    border: Border.all(
                      color: value == method
                          ? theme.colorScheme.primary
                          : theme.borderColor,
                      width: value == method ? 2 : 1,
                    ),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        value == method
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked,
                        color: value == method
                            ? theme.colorScheme.primary
                            : theme.mutedColor,
                      ),
                      const SizedBox(width: ResetTokens.spaceMd),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(title, style: ResetTokens.body),
                            Text(
                              detail,
                              style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// The Terms checkbox — client request of 11/09/2026, and a legal one.
///
/// Unticked to begin with, and required: a box ticked on somebody's behalf is not
/// agreement, and the booking records which version was accepted. The words "Terms &
/// Conditions" open the full text; the rest of the line ticks the box, because a label that
/// ignores a tap is the commonest complaint about checkboxes on a phone.
///
/// Until the text has loaded there is nothing to agree to, so no box is offered — a retry
/// is, and Book stays disabled.
class _TermsAgreement extends StatefulWidget {
  const _TermsAgreement({
    required this.terms,
    required this.agreed,
    required this.onChanged,
    required this.onRetry,
  });

  final AsyncValue<Terms> terms;
  final bool agreed;
  final ValueChanged<bool> onChanged;
  final VoidCallback onRetry;

  @override
  State<_TermsAgreement> createState() => _TermsAgreementState();
}

class _TermsAgreementState extends State<_TermsAgreement> {
  late final TapGestureRecognizer _link = TapGestureRecognizer()
    ..onTap = () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const TermsScreen()),
        );

  @override
  void dispose() {
    _link.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final terms = widget.terms.valueOrNull;

    if (terms == null) {
      final failed = widget.terms.hasError && !widget.terms.isLoading;

      return Row(
        children: [
          if (failed)
            Icon(Icons.error_outline, size: 18, color: theme.mutedColor)
          else
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          const SizedBox(width: ResetTokens.spaceSm),
          Expanded(
            child: Text(
              failed
                  ? 'Could not load the Terms & Conditions.'
                  : 'Loading the Terms & Conditions…',
              style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
            ),
          ),
          if (failed)
            TextButton(onPressed: widget.onRetry, child: const Text('Try again')),
        ],
      );
    }

    const phrase = 'Terms & Conditions';
    final text = terms.agreement;
    final at = text.indexOf(phrase);
    final link = TextSpan(
      text: phrase,
      recognizer: _link,
      style: TextStyle(
        color: theme.colorScheme.primary,
        fontWeight: FontWeight.w600,
        decoration: TextDecoration.underline,
        decorationColor: theme.colorScheme.primary,
      ),
    );

    return InkWell(
      onTap: () => widget.onChanged(!widget.agreed),
      borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Checkbox(
            value: widget.agreed,
            onChanged: (value) => widget.onChanged(value ?? false),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 14, right: ResetTokens.spaceXs),
              child: Text.rich(
                TextSpan(
                  children: at < 0
                      // Reworded without the phrase. The way to the full text must survive
                      // whatever the client writes next.
                      ? [TextSpan(text: '$text. Read the '), link, const TextSpan(text: '.')]
                      : [
                          TextSpan(text: text.substring(0, at)),
                          link,
                          TextSpan(text: text.substring(at + phrase.length)),
                        ],
                ),
                style: ResetTokens.bodySm,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The hold countdown.
///
/// Measured against the server's expiry instant rather than counting down from a duration,
/// so a backgrounded app does not come back showing time that has already gone.
class _HoldCountdown extends StatelessWidget {
  const _HoldCountdown({required this.expiresAt});

  final DateTime expiresAt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final remaining = expiresAt.difference(DateTime.now());

    if (remaining.isNegative) {
      return Text(
        'Your hold has expired. Choose a time again.',
        style: ResetTokens.bodySm.copyWith(color: theme.colorScheme.error),
      );
    }

    final urgent = remaining.inSeconds < 120;

    return Row(
      children: [
        Icon(
          Icons.timer_outlined,
          size: 16,
          color: urgent ? theme.colorScheme.error : theme.mutedColor,
        ),
        const SizedBox(width: ResetTokens.spaceXs),
        Text(
          'Slot held for ${formatCountdown(remaining)}',
          style: ResetTokens.bodySm.copyWith(
            color: urgent ? theme.colorScheme.error : theme.mutedColor,
          ),
        ),
      ],
    );
  }
}

class _QuoteCard extends StatelessWidget {
  const _QuoteCard({required this.quote, required this.startsAt});

  final Quote quote;
  final String startsAt;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final applied = quote.appliedReward;
    final coupon = quote.appliedCoupon;
    final postVisitCreditPaise =
        applied?.postVisitCreditPaise ?? coupon?.postVisitCreditPaise ?? 0;

    return ResetCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(quote.serviceName, style: ResetTokens.h2)),
              Text(formatMoney(quote.basePricePaise), style: ResetTokens.mono),
            ],
          ),
          const SizedBox(height: ResetTokens.spaceXs),
          Text(
            '${formatDateTime(DateTime.parse(startsAt))} · ${formatDuration(quote.durationMinutes)}',
            style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
          ),

          for (final addon in quote.addons) ...[
            const SizedBox(height: ResetTokens.spaceSm),
            Row(
              children: [
                Expanded(
                  child: Text(
                    addon.name,
                    style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                  ),
                ),
                Text(formatMoney(addon.pricePaise), style: ResetTokens.bodySm),
              ],
            ),
          ],

          if (quote.discountPaise > 0) ...[
            const SizedBox(height: ResetTokens.spaceSm),
            Row(
              children: [
                Expanded(
                  child: Text(
                    // The code as well as what it does: "RESET20 · 20% off".
                    coupon != null
                        ? '${coupon.code} · ${coupon.label}'
                        : applied?.label ?? 'Reward',
                    style: ResetTokens.bodySm
                        .copyWith(color: theme.colorScheme.primary),
                  ),
                ),
                Text(
                  '−${formatMoney(quote.discountPaise)}',
                  style: ResetTokens.bodySm
                      .copyWith(color: theme.colorScheme.primary),
                ),
              ],
            ),
          ],

          const Padding(
            padding: EdgeInsets.symmetric(vertical: ResetTokens.spaceMd),
            child: Divider(),
          ),

          Row(
            children: [
              Expanded(child: Text('Total', style: ResetTokens.h2)),
              Text(formatMoney(quote.payablePaise), style: ResetTokens.h1),
            ],
          ),

          // Cashback discounts nothing now, so it is stated separately rather than looking
          // like a reward that did nothing. A cashback code is shown the same way.
          if (postVisitCreditPaise > 0) ...[
            const SizedBox(height: ResetTokens.spaceSm),
            ResetBadge(
              '${formatMoney(postVisitCreditPaise)} back after your visit',
              color: theme.accentColor,
            ),
          ],
        ],
      ),
    );
  }
}

/// A code the shop handed out — client request 06/11/2026.
///
/// Folded behind one line until asked for: most customers have no code, and an empty box at
/// checkout reads as a discount everybody else is getting. Once applied it says what the
/// code does, the way a chosen reward does, with a way to take it off.
class _CouponCode extends StatelessWidget {
  const _CouponCode({
    required this.controller,
    required this.applied,
    required this.open,
    required this.applying,
    required this.error,
    required this.onOpen,
    required this.onApply,
    required this.onRemove,
  });

  final TextEditingController controller;
  final AppliedCoupon? applied;
  final bool open;
  final bool applying;
  final String? error;
  final VoidCallback onOpen;
  final VoidCallback onApply;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final coupon = applied;

    if (coupon != null) {
      return ResetCard(
        color: theme.accentColor.withValues(alpha: 0.1),
        borderColor: theme.accentColor,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    coupon.code,
                    style: ResetTokens.body.copyWith(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    coupon.label,
                    style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                  ),
                  // Cashback takes nothing off now, so it says when the money comes.
                  if (coupon.discountPaise > 0)
                    Text(
                      '−${formatMoney(coupon.discountPaise)}',
                      style: ResetTokens.bodySm
                          .copyWith(color: theme.colorScheme.primary),
                    )
                  else if (coupon.postVisitCreditPaise > 0)
                    Text(
                      '${formatMoney(coupon.postVisitCreditPaise)} back after your visit',
                      style: ResetTokens.bodySm
                          .copyWith(color: theme.colorScheme.primary),
                    ),
                ],
              ),
            ),
            TextButton(onPressed: onRemove, child: const Text('Remove')),
          ],
        ),
      );
    }

    if (!open) {
      return Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          onPressed: onOpen,
          child: const Text('Have a coupon code?'),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                autofocus: true,
                // Codes are printed in capitals. The server upper-cases them anyway; this
                // only makes what is typed look like what is on the poster.
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                enableSuggestions: false,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(hintText: 'Enter code'),
                onSubmitted: (value) {
                  if (value.trim().isNotEmpty && !applying) onApply();
                },
              ),
            ),
            const SizedBox(width: ResetTokens.spaceSm),
            ValueListenableBuilder<TextEditingValue>(
              valueListenable: controller,
              builder: (context, value, _) => OutlinedButton(
                onPressed: value.text.trim().isEmpty || applying ? null : onApply,
                child: applying
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Apply'),
              ),
            ),
          ],
        ),

        // The server's own sentence — "This code has expired", "needs a booking of ₹300 or
        // more" — says what to do about it, so it is shown as it is.
        if (error != null) ...[
          const SizedBox(height: ResetTokens.spaceSm),
          Text(
            error!,
            style: ResetTokens.bodySm.copyWith(color: theme.colorScheme.error),
          ),
        ],
      ],
    );
  }
}

class _RewardTile extends StatelessWidget {
  const _RewardTile({
    required this.reward,
    required this.selected,
    required this.onTap,
  });

  final WalletReward reward;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Opacity(
      opacity: reward.applicable ? 1 : 0.5,
      child: ResetCard(
        onTap: reward.applicable ? onTap : null,
        color: selected
            ? theme.accentColor.withValues(alpha: 0.1)
            : theme.colorScheme.surface,
        borderColor: selected ? theme.accentColor : theme.borderColor,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(reward.label, style: ResetTokens.body),
                  // The server decides applicability; the app prints its reason.
                  if (reward.blockedReason != null)
                    Text(
                      reward.blockedReason!,
                      style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                    ),
                ],
              ),
            ),
            Text(
              reward.discountPaise > 0
                  ? '−${formatMoney(reward.discountPaise)}'
                  : reward.postVisitCreditPaise > 0
                      ? '${formatMoney(reward.postVisitCreditPaise)} back'
                      : '',
              style: ResetTokens.bodySm,
            ),
          ],
        ),
      ),
    );
  }
}
