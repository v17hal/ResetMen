import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../api/generated/reset_enums.dart';
import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';

/// The screen someone holds up at the counter.
///
/// Polls briefly on arrival because the booking is confirmed by the payment *webhook*, not
/// by the app — the customer can land here a second before the server has heard from
/// Razorpay. Rather than showing "pending" and leaving them to pull-to-refresh, it waits.
class ConfirmationScreen extends ConsumerStatefulWidget {
  const ConfirmationScreen({super.key, required this.bookingId});

  final String bookingId;

  @override
  ConsumerState<ConfirmationScreen> createState() => _ConfirmationScreenState();
}

class _ConfirmationScreenState extends ConsumerState<ConfirmationScreen> {
  Booking? _booking;
  Object? _error;
  Timer? _poll;
  int _attempts = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _poll = Timer.periodic(const Duration(seconds: 2), (timer) {
      // Give up after ~40s. If the webhook has not arrived by then it is not a timing
      // problem, and the reconciliation job will resolve it — the booking is safe either
      // way, so the screen stops spinning and shows what it has.
      if (!mounted || _attempts > 20 || _booking?.status != BookingStatus.held) {
        timer.cancel();
        return;
      }
      unawaited(_load());
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    _attempts++;
    try {
      final booking = await ref.read(repositoryProvider).booking(widget.bookingId);
      if (!mounted) return;
      setState(() {
        _booking = booking;
        _error = null;
      });
      if (booking.status != BookingStatus.held) {
        // Refresh the list so the cached copy — the one that works offline — is current.
        ref.invalidate(bookingsProvider('upcoming'));
      }
    } catch (error) {
      if (mounted && _booking == null) setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final booking = _booking;
    final store = ref.watch(storeProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        actions: [
          TextButton(
            onPressed: () =>
                Navigator.of(context).popUntil((route) => route.isFirst),
            child: const Text('Done'),
          ),
        ],
      ),
      body: booking == null
          ? (_error != null
              ? ErrorView(error: _error!, onRetry: _load)
              : const Center(child: CircularProgressIndicator()))
          : ListView(
              padding: const EdgeInsets.all(ResetTokens.gutter),
              children: [
                if (booking.status == BookingStatus.held) ...[
                  const Center(child: CircularProgressIndicator()),
                  const SizedBox(height: ResetTokens.spaceBase),
                  Text(
                    'Confirming your payment…',
                    style: ResetTokens.h1,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: ResetTokens.spaceXs),
                  Text(
                    'This usually takes a second or two. You can stay on this screen.',
                    style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                    textAlign: TextAlign.center,
                  ),
                ] else ...[
                  Center(
                    child: Container(
                      width: 56,
                      height: 56,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: theme.successColor.withValues(alpha: 0.15),
                      ),
                      child: Icon(Icons.check, color: theme.successColor, size: 30),
                    ),
                  ),
                  const SizedBox(height: ResetTokens.spaceBase),
                  Text(
                    "You're booked",
                    style: ResetTokens.display,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: ResetTokens.spaceXs),
                  Text(
                    'Show this at the counter when you arrive.',
                    style: ResetTokens.body.copyWith(color: theme.mutedColor),
                    textAlign: TextAlign.center,
                  ),
                ],

                const SizedBox(height: ResetTokens.spaceXl),

                if (booking.checkinPayload != null)
                  Center(child: _QrTicket(payload: booking.checkinPayload!)),

                const SizedBox(height: ResetTokens.spaceXl),

                ResetCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(booking.serviceName, style: ResetTokens.h2),
                          ),
                          BookingStatusBadge(booking.status),
                        ],
                      ),
                      const SizedBox(height: ResetTokens.spaceXs),
                      Text(formatDateTime(booking.startsAt), style: ResetTokens.body),
                      Text(
                        '${formatDuration(booking.durationMinutes)} · ${formatMoney(booking.payablePaise)} paid',
                        style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                      ),
                      if (booking.addonNames.isNotEmpty) ...[
                        const SizedBox(height: ResetTokens.spaceSm),
                        Wrap(
                          spacing: ResetTokens.spaceXs,
                          runSpacing: ResetTokens.spaceXs,
                          children: [
                            for (final name in booking.addonNames) ResetBadge(name),
                          ],
                        ),
                      ],
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: ResetTokens.spaceMd),
                        child: Divider(),
                      ),
                      Text(
                        'Booking code',
                        style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                      ),
                      Text(formatBookingCode(booking.publicId), style: ResetTokens.h2),
                      const SizedBox(height: ResetTokens.spaceXs),
                      Text(
                        'If the camera will not read the code, read this out instead.',
                        style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                      ),
                    ],
                  ),
                ),

                if (store?.address != null) ...[
                  const SizedBox(height: ResetTokens.spaceBase),
                  ResetCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Where',
                          style:
                              ResetTokens.caption.copyWith(color: theme.mutedColor),
                        ),
                        Text(store!.address!, style: ResetTokens.body),
                      ],
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}

/// The QR the counter scans.
///
/// Always on white, never on the themed surface: a dark-mode QR is unscannable, and this is
/// the one element that must survive the theme. High error correction because it gets
/// scanned off a cracked screen at an angle, in a shop.
class _QrTicket extends StatelessWidget {
  const _QrTicket({required this.payload});

  final String payload;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(ResetTokens.spaceMd),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(ResetTokens.radiusLg),
      ),
      child: QrImageView(
        data: payload,
        version: QrVersions.auto,
        size: 240,
        errorCorrectionLevel: QrErrorCorrectLevel.H,
        backgroundColor: Colors.white,
        eyeStyle: const QrEyeStyle(
          eyeShape: QrEyeShape.square,
          color: Colors.black,
        ),
        dataModuleStyle: const QrDataModuleStyle(
          dataModuleShape: QrDataModuleShape.square,
          color: Colors.black,
        ),
      ),
    );
  }
}
