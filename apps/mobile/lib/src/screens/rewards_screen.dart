import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/reset_enums.dart';
import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'sign_in_sheet.dart';

class RewardsScreen extends ConsumerWidget {
  const RewardsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final session = ref.watch(sessionProvider);

    if (session.valueOrNull == null && !session.isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Rewards')),
        body: EmptyState(
          title: 'Sign in to see your rewards',
          message: 'Your streak, your wallet and your scratch cards.',
          action: FilledButton(
            onPressed: () => showSignInSheet(context),
            child: const Text('Sign in'),
          ),
        ),
      );
    }

    final streak = ref.watch(streakProvider);
    final cards = ref.watch(scratchCardsProvider);
    final wallet = ref.watch(walletProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Rewards')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(streakProvider);
          ref.invalidate(scratchCardsProvider);
          ref.invalidate(walletProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(ResetTokens.gutter),
          children: [
            streak.when(
              loading: () => const Skeleton(
                height: 220,
                radius: ResetTokens.radiusLg,
              ),
              error: (error, _) => ErrorView(
                error: error,
                onRetry: () => ref.invalidate(streakProvider),
              ),
              data: (data) => _StreakCard(streak: data),
            ),

            const SizedBox(height: ResetTokens.spaceXl),
            Text('Scratch cards', style: ResetTokens.h2),
            const SizedBox(height: ResetTokens.spaceSm),

            cards.when(
              loading: () => const Skeleton(
                height: 80,
                radius: ResetTokens.radiusLg,
              ),
              error: (_, __) => Text(
                'Could not load your cards.',
                style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
              ),
              data: (data) => data.isEmpty
                  ? ResetCard(
                      child: Text(
                        'You earn these by turning up. Your next visit might bring one.',
                        style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                      ),
                    )
                  : GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: ResetTokens.spaceSm,
                      crossAxisSpacing: ResetTokens.spaceSm,
                      childAspectRatio: 0.85,
                      children: [
                        for (final card in data) _ScratchCardTile(card: card),
                      ],
                    ),
            ),

            const SizedBox(height: ResetTokens.spaceXl),
            Text('Your wallet', style: ResetTokens.h2),
            const SizedBox(height: ResetTokens.spaceSm),

            wallet.when(
              loading: () => const Skeleton(
                height: 60,
                radius: ResetTokens.radiusLg,
              ),
              error: (_, __) => Text(
                'Could not load your wallet.',
                style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
              ),
              data: (data) => data.isEmpty
                  ? const EmptyState(
                      title: 'No rewards yet',
                      message:
                          'Complete a streak or scratch a card and they will appear here.',
                    )
                  : Column(
                      children: [
                        for (final reward in data)
                          Padding(
                            padding:
                                const EdgeInsets.only(bottom: ResetTokens.spaceSm),
                            child: ResetCard(
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(reward.label, style: ResetTokens.body),
                                        Text(
                                          'Valid until ${formatDate(reward.validTill)}'
                                          '${reward.minOrderPaise > 0 ? ' · on orders over ${formatMoney(reward.minOrderPaise)}' : ''}',
                                          style: ResetTokens.caption
                                              .copyWith(color: theme.mutedColor),
                                        ),
                                      ],
                                    ),
                                  ),
                                  ResetBadge(
                                    reward.status == RewardStatus.active
                                        ? 'Ready'
                                        : (reward.status?.wire.toLowerCase() ?? '—'),
                                    color: reward.status == RewardStatus.active
                                        ? theme.accentColor
                                        : null,
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The streak ring.
///
/// An arc rather than a bar because the milestone is the point, and a ring that visibly
/// closes reads as "nearly there" in a way a bar does not.
class _StreakCard extends StatelessWidget {
  const _StreakCard({required this.streak});

  final Streak streak;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final goal = streak.goal;

    return ResetCard(
      child: Row(
        children: [
          SizedBox(
            width: 116,
            height: 116,
            child: Stack(
              alignment: Alignment.center,
              children: [
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: streak.progress),
                  duration: MediaQuery.disableAnimationsOf(context)
                      ? Duration.zero
                      : ResetTokens.durationSlow,
                  curve: ResetTokens.easingStandard,
                  builder: (context, value, _) => SizedBox(
                    width: 116,
                    height: 116,
                    child: CircularProgressIndicator(
                      value: value,
                      strokeWidth: 10,
                      strokeCap: StrokeCap.round,
                      backgroundColor: theme.surface2Color,
                      valueColor: AlwaysStoppedAnimation(theme.accentColor),
                    ),
                  ),
                ),
                Text('${streak.currentCount}', style: ResetTokens.display),
              ],
            ),
          ),
          const SizedBox(width: ResetTokens.spaceLg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (goal == null) ...[
                  Text('${streak.totalVisits} visits', style: ResetTokens.h2),
                  Text(
                    'Keep coming back — rewards for regulars are on the way.',
                    style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                  ),
                ] else ...[
                  Text(goal.name, style: ResetTokens.h2),
                  Text(
                    goal.remaining == 0
                        ? 'Your next visit completes it.'
                        : '${goal.remaining} more visit${goal.remaining == 1 ? '' : 's'} to go.',
                    style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                  ),
                  const SizedBox(height: ResetTokens.spaceXs),
                  ResetBadge(goal.rewardLabel, color: theme.accentColor),
                ],
                const SizedBox(height: ResetTokens.spaceXs),
                Text(
                  'Best ${streak.bestCount} · ${streak.totalVisits} all time',
                  style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ScratchCardTile extends ConsumerStatefulWidget {
  const _ScratchCardTile({required this.card});

  final ScratchCard card;

  @override
  ConsumerState<_ScratchCardTile> createState() => _ScratchCardTileState();
}

class _ScratchCardTileState extends ConsumerState<_ScratchCardTile> {
  bool _busy = false;

  Future<void> _scratch() async {
    setState(() => _busy = true);
    try {
      final result = await ref.read(repositoryProvider).scratch(widget.card.id);
      ref.invalidate(scratchCardsProvider);
      ref.invalidate(walletProvider);

      if (mounted && result.rewardLabel != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('You won ${result.rewardLabel}!')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyMessage(error))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final card = widget.card;
    final revealed =
        card.status == ScratchCardStatus.scratched && card.rewardLabel != null;
    final ready = card.status == ScratchCardStatus.issued;

    return ResetCard(
      onTap: ready && !_busy ? _scratch : null,
      color: revealed
          ? theme.accentColor.withValues(alpha: 0.1)
          : ready
              ? theme.accentColor.withValues(alpha: 0.18)
              : theme.surface2Color,
      borderColor: ready || revealed ? theme.accentColor : theme.borderColor,
      child: Center(
        child: _busy
            ? const CircularProgressIndicator()
            : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (revealed) ...[
                    Text(
                      card.rewardLabel!,
                      style: ResetTokens.h2.copyWith(color: theme.accentColor),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: ResetTokens.spaceXs),
                    Text(
                      'In your wallet',
                      style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                    ),
                  ] else if (ready) ...[
                    Icon(Icons.card_giftcard, size: 32, color: theme.accentColor),
                    const SizedBox(height: ResetTokens.spaceXs),
                    Text('Tap to scratch', style: ResetTokens.bodySm),
                    Text(
                      card.campaignName,
                      style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ] else
                    Text(
                      'Expired',
                      style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                    ),
                ],
              ),
      ),
    );
  }
}
