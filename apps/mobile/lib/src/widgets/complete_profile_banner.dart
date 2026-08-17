import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../screens/account_screen.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import 'common.dart';

/// Nudges a signed-in customer to fill in the details the counter needs.
///
/// Google sign-in gives a name and an email and nothing else. Two things at the counter
/// need more: linking a walk-in to an existing customer, and ringing someone who is late.
///
/// A banner rather than a required step at sign-up, deliberately. A mandatory form between
/// "I want to book" and "I have booked" costs bookings, and the store would rather have a
/// customer with a missing phone number than no customer. It reappears until filled, which
/// is the pressure that works without ever blocking anyone.
class CompleteProfileBanner extends ConsumerWidget {
  const CompleteProfileBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final user = ref.watch(sessionProvider).valueOrNull;

    // Nothing to nudge about when signed out, or when it is already done.
    if (user == null || user.isComplete) return const SizedBox.shrink();

    final missing = <String>[
      if (user.name?.trim().isEmpty ?? true) 'your name',
      if (user.phone?.trim().isEmpty ?? true) 'a mobile number',
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: ResetTokens.spaceBase),
      child: ResetCard(
        color: theme.accentColor.withValues(alpha: 0.08),
        borderColor: theme.accentColor.withValues(alpha: 0.4),
        onTap: () => Navigator.of(context, rootNavigator: true).push(
          MaterialPageRoute<void>(builder: (_) => const AccountScreen()),
        ),
        child: Row(
          children: [
            Icon(Icons.person_outline, color: theme.accentColor),
            const SizedBox(width: ResetTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Finish your profile', style: ResetTokens.body),
                  Text(
                    'We still need ${missing.join(' and ')} so the store can reach you '
                    'about your booking.',
                    style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: theme.mutedColor),
          ],
        ),
      ),
    );
  }
}
