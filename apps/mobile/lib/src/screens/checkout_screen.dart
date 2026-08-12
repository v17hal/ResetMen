import 'dart:async';
import 'dart:math';

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
import 'sign_in_sheet.dart';

/// Confirm and pay.
///
/// The hold is created the moment this screen opens, not when Pay is pressed: deciding
/// whether to apply a reward should not cost someone the time they picked. Sign-in happens
/// in a sheet underneath the running countdown, so the hold survives it.
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
  String? _rewardId;
  String? _error;
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

    unawaited(_start());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _razorpay?.clear();
    super.dispose();
  }

  static String _randomKey(String prefix) {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return '$prefix-${bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
  }

  Future<void> _start() async {
    await _loadQuote();
    await _createHold();
  }

  Future<void> _loadQuote() async {
    try {
      final quote = await ref.read(repositoryProvider).quote(
            serviceId: widget.serviceId,
            addonOptionIds: widget.addonIds,
            rewardId: _rewardId,
          );
      if (mounted) setState(() => _quote = quote);
    } catch (error) {
      if (mounted) setState(() => _error = friendlyMessage(error));
    }
  }

  Future<void> _createHold() async {
    try {
      final hold = await ref.read(repositoryProvider).hold(
            serviceId: widget.serviceId,
            startsAt: widget.startsAt,
            addonOptionIds: widget.addonIds,
            rewardId: _rewardId,
            idempotencyKey: _holdKey,
          );
      if (mounted) setState(() => _hold = hold);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = friendlyMessage(error));

      // The slot went while they were deciding. Send them back to pick another rather than
      // leaving them staring at an error on a dead screen.
      if (error is ResetApiException && error.isSlotGone) {
        await Future<void>.delayed(const Duration(milliseconds: 2200));
        if (mounted) Navigator.of(context).pop();
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pay() async {
    final hold = _hold;
    if (hold == null) return;

    if (ref.read(sessionProvider).valueOrNull == null) {
      final signedIn = await showSignInSheet(
        context,
        reason: 'Your slot is held while you do this.',
      );
      if (!signedIn || !mounted) return;
    }

    setState(() {
      _paying = true;
      _error = null;
    });

    try {
      final repository = ref.read(repositoryProvider);
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
        _error = friendlyMessage(error, 'The payment did not go through.');
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
      _error = null;
    });
    await _loadQuote();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = ref.watch(sessionProvider);
    final quote = _quote;

    final wallet = session.valueOrNull == null
        ? const AsyncValue<List<WalletReward>>.data([])
        : ref.watch(basketWalletProvider(
            (serviceId: widget.serviceId, addonIds: widget.addonIds),
          ));

    return Scaffold(
      appBar: AppBar(title: const Text('Confirm and pay')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
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

                const SizedBox(height: ResetTokens.spaceXl),
                PrimaryButton(
                  label: quote == null
                      ? 'Pay'
                      : 'Pay ${formatMoney(quote.payablePaise)}',
                  loading: _paying,
                  onPressed: _hold == null ? null : _pay,
                ),

                const SizedBox(height: ResetTokens.spaceSm),
                Text(
                  'Free cancellation up to '
                  '${((ref.watch(storeProvider).valueOrNull?.cancellationWindowMinutes ?? 120) / 60).round()} '
                  'hours before your slot.',
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
                    applied?.label ?? 'Reward',
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
          // like a reward that did nothing.
          if (applied != null && applied.postVisitCreditPaise > 0) ...[
            const SizedBox(height: ResetTokens.spaceSm),
            ResetBadge(
              '${formatMoney(applied.postVisitCreditPaise)} back after your visit',
              color: theme.accentColor,
            ),
          ],
        ],
      ),
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
