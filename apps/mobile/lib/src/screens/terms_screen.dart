import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';

/// The Terms & Conditions in full — client request of 11/09/2026, and a legal one.
///
/// Reached from the checkbox at checkout and from You. It reads the same provider the
/// checkbox does, so the text opened from the checkbox is the text whose version goes out
/// with the booking.
///
/// The cancellation paragraph is not one of the client's six clauses. Clause 4 refers to a
/// Cancellation & Refund Policy, and this says what that policy is in practice — using the
/// store's own cancellation window, so the number here cannot drift from the one the Visits
/// screen enforces.
class TermsScreen extends ConsumerWidget {
  const TermsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final terms = ref.watch(termsProvider);
    final minutes =
        ref.watch(storeProvider).valueOrNull?.cancellationWindowMinutes ?? 120;
    final hours = (minutes / 60).round();

    return Scaffold(
      appBar: AppBar(title: const Text('')),
      body: terms.when(
        loading: () => const SkeletonList(
          rows: 6,
          height: 56,
          padding: EdgeInsets.all(ResetTokens.gutter),
        ),
        error: (error, _) => ErrorView(
          error: error,
          onRetry: () => ref.invalidate(termsProvider),
        ),
        data: (data) => ListView(
          padding: const EdgeInsets.fromLTRB(
            ResetTokens.gutter,
            0,
            ResetTokens.gutter,
            ResetTokens.space2xl,
          ),
          children: [
            Text(data.title, style: ResetTokens.h1),
            const SizedBox(height: ResetTokens.spaceLg),

            for (final (index, clause) in data.clauses.indexed) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 28,
                    child: Text(
                      '${index + 1}.',
                      style: ResetTokens.body.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  Expanded(child: Text(clause, style: ResetTokens.body)),
                ],
              ),
              const SizedBox(height: ResetTokens.spaceMd),
            ],

            const SizedBox(height: ResetTokens.spaceMd),
            Text('Cancellation & refunds', style: ResetTokens.h2),
            const SizedBox(height: ResetTokens.spaceSm),
            Text(
              'Free cancellation up to $hours ${hours == 1 ? 'hour' : 'hours'} before your '
              'slot, from Visits in the app. Payment is taken at the counter, and any '
              'refund is made at the counter.',
              style: ResetTokens.body,
            ),

            const SizedBox(height: ResetTokens.spaceXl),
            Text(
              'Version ${data.version}',
              style: ResetTokens.caption.copyWith(color: theme.mutedColor),
            ),
          ],
        ),
      ),
    );
  }
}
