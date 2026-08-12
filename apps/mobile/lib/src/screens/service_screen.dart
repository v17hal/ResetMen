import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'slots_screen.dart';

/// Service detail and add-on selection.
///
/// The running total here is a local sum of catalog prices, purely so the number moves as
/// options are ticked. It is never what gets charged — the server re-prices the basket at
/// `/bookings/quote` and again at hold, and that figure is the one on the checkout screen.
class ServiceScreen extends ConsumerStatefulWidget {
  const ServiceScreen({super.key, required this.idOrSlug});

  final String idOrSlug;

  @override
  ConsumerState<ServiceScreen> createState() => _ServiceScreenState();
}

class _ServiceScreenState extends ConsumerState<ServiceScreen> {
  final Set<String> _selected = {};

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final service = ref.watch(serviceProvider(widget.idOrSlug));

    return Scaffold(
      appBar: AppBar(title: const Text('')),
      body: service.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorView(
          error: error,
          onRetry: () => ref.invalidate(serviceProvider(widget.idOrSlug)),
        ),
        data: (data) {
          final chosen = data.addonGroups
              .expand((group) => group.options)
              .where((option) => _selected.contains(option.id))
              .toList();

          // `fold<int>`, not bare `fold` — the inferred type is `num`, and the difference
          // only surfaces where the result is passed to something that wants an int.
          final totalPaise = data.pricePaise +
              chosen.fold<int>(0, (sum, o) => sum + o.priceDeltaPaise);
          final totalMinutes = data.durationMinutes +
              chosen.fold<int>(0, (sum, o) => sum + o.durationDeltaMinutes);

          final unmet = data.addonGroups.where((group) {
            final count = group.options
                .where((option) => _selected.contains(option.id))
                .length;
            return count < group.minSelect || count > group.maxSelect;
          }).toList();

          return Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(
                    ResetTokens.gutter,
                    0,
                    ResetTokens.gutter,
                    ResetTokens.spaceXl,
                  ),
                  children: [
                    if (data.imageUrl != null)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(ResetTokens.radiusLg),
                        child: AspectRatio(
                          aspectRatio: 16 / 9,
                          child: Image.network(
                            data.imageUrl!,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) =>
                                Container(color: theme.surface2Color),
                          ),
                        ),
                      ),
                    const SizedBox(height: ResetTokens.spaceBase),

                    Text(data.name, style: ResetTokens.display),
                    const SizedBox(height: ResetTokens.spaceSm),
                    Row(
                      children: [
                        Text(formatMoney(data.pricePaise), style: ResetTokens.h2),
                        const SizedBox(width: ResetTokens.spaceSm),
                        ResetBadge(formatDuration(data.durationMinutes)),
                      ],
                    ),

                    if (data.description != null) ...[
                      const SizedBox(height: ResetTokens.spaceSm),
                      Text(
                        data.description!,
                        style: ResetTokens.body.copyWith(color: theme.mutedColor),
                      ),
                    ],

                    for (final group in data.addonGroups) ...[
                      const SizedBox(height: ResetTokens.spaceXl),
                      _AddonGroupSection(
                        group: group,
                        selected: _selected,
                        onToggle: (option) => setState(() {
                          if (group.isSingleSelect) {
                            // Behaves like a radio: picking one clears the rest of the
                            // group rather than silently exceeding maxSelect.
                            final wasSelected = _selected.contains(option.id);
                            for (final o in group.options) {
                              _selected.remove(o.id);
                            }
                            if (!wasSelected) _selected.add(option.id);
                          } else if (_selected.contains(option.id)) {
                            _selected.remove(option.id);
                          } else {
                            final count = group.options
                                .where((o) => _selected.contains(o.id))
                                .length;
                            if (count < group.maxSelect) _selected.add(option.id);
                          }
                        }),
                      ),
                    ],
                  ],
                ),
              ),

              _StickySummary(
                totalPaise: totalPaise,
                totalMinutes: totalMinutes,
                label: unmet.isEmpty ? 'Choose a time' : 'Choose ${unmet.first.name}',
                onPressed: unmet.isEmpty
                    ? () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => SlotsScreen(
                              serviceId: data.id,
                              serviceName: data.name,
                              addonIds: _selected.toList(),
                            ),
                          ),
                        )
                    : null,
              ),
            ],
          );
        },
      ),
    );
  }
}

class _AddonGroupSection extends StatelessWidget {
  const _AddonGroupSection({
    required this.group,
    required this.selected,
    required this.onToggle,
  });

  final AddonGroup group;
  final Set<String> selected;
  final void Function(AddonOption) onToggle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final count = group.options.where((o) => selected.contains(o.id)).length;

    final hint = group.minSelect > 0
        ? 'Choose ${group.minSelect == group.maxSelect ? group.minSelect : '${group.minSelect}–${group.maxSelect}'}'
        : group.isSingleSelect
            ? 'Optional'
            : 'Up to ${group.maxSelect}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(child: Text(group.name, style: ResetTokens.h2)),
            Text(hint, style: ResetTokens.caption.copyWith(color: theme.mutedColor)),
          ],
        ),
        const SizedBox(height: ResetTokens.spaceSm),
        for (final option in group.options) ...[
          _AddonTile(
            option: option,
            selected: selected.contains(option.id),
            single: group.isSingleSelect,
            atLimit: !group.isSingleSelect &&
                !selected.contains(option.id) &&
                count >= group.maxSelect,
            onTap: () => onToggle(option),
          ),
          const SizedBox(height: ResetTokens.spaceSm),
        ],
      ],
    );
  }
}

class _AddonTile extends StatelessWidget {
  const _AddonTile({
    required this.option,
    required this.selected,
    required this.single,
    required this.atLimit,
    required this.onTap,
  });

  final AddonOption option;
  final bool selected;
  final bool single;
  final bool atLimit;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Semantics(
      inMutuallyExclusiveGroup: single,
      checked: selected,
      child: Opacity(
        opacity: atLimit ? 0.5 : 1,
        child: ResetCard(
          onTap: atLimit ? null : onTap,
          color: selected
              ? theme.colorScheme.primary.withValues(alpha: 0.1)
              : theme.colorScheme.surface,
          borderColor: selected ? theme.colorScheme.primary : theme.borderColor,
          padding: const EdgeInsets.symmetric(
            horizontal: ResetTokens.spaceBase,
            vertical: ResetTokens.spaceMd,
          ),
          child: Row(
            children: [
              Icon(
                single
                    ? (selected
                        ? Icons.radio_button_checked
                        : Icons.radio_button_unchecked)
                    : (selected ? Icons.check_box : Icons.check_box_outline_blank),
                color: selected ? theme.colorScheme.primary : theme.mutedColor,
                size: 22,
              ),
              const SizedBox(width: ResetTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(option.name, style: ResetTokens.body),
                    if (option.durationDeltaMinutes > 0)
                      Text(
                        '+${option.durationDeltaMinutes} min',
                        style:
                            ResetTokens.caption.copyWith(color: theme.mutedColor),
                      ),
                  ],
                ),
              ),
              Text(
                option.priceDeltaPaise == 0
                    ? 'Free'
                    : '+${formatMoney(option.priceDeltaPaise)}',
                style: ResetTokens.bodySm,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StickySummary extends StatelessWidget {
  const _StickySummary({
    required this.totalPaise,
    required this.totalMinutes,
    required this.label,
    this.onPressed,
  });

  final int totalPaise;
  final int totalMinutes;
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(top: BorderSide(color: theme.borderColor)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(ResetTokens.spaceBase),
          child: Row(
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(formatMoney(totalPaise), style: ResetTokens.h2),
                  Text(
                    '${formatDuration(totalMinutes)} total',
                    style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                  ),
                ],
              ),
              const SizedBox(width: ResetTokens.spaceBase),
              Expanded(
                child: FilledButton(onPressed: onPressed, child: Text(label)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
