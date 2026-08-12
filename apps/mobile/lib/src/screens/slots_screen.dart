import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'checkout_screen.dart';

/// The slot picker.
///
/// Availability is never cached, on either side. A stale slot list means picking a time that
/// has already gone and finding out during payment — the worst possible moment. This
/// refetches every 60 seconds and says when it last did.
class SlotsScreen extends ConsumerStatefulWidget {
  const SlotsScreen({
    super.key,
    required this.serviceId,
    required this.serviceName,
    required this.addonIds,
  });

  final String serviceId;
  final String serviceName;
  final List<String> addonIds;

  @override
  ConsumerState<SlotsScreen> createState() => _SlotsScreenState();
}

class _SlotsScreenState extends ConsumerState<SlotsScreen> {
  late String _date = formatIsoDate(DateTime.now());
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _refresh = Timer.periodic(const Duration(seconds: 60), (_) {
      if (mounted) ref.invalidate(slotsProvider(_query));
    });
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  SlotQuery get _query =>
      (serviceId: widget.serviceId, date: _date, addonIds: widget.addonIds);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final store = ref.watch(storeProvider);
    final horizon = store.valueOrNull?.bookingHorizonDays ?? 7;

    final today = DateTime.now();
    final days = List.generate(horizon, (i) => today.add(Duration(days: i)));

    final dayInfo = ref.watch(daysProvider((
      serviceId: widget.serviceId,
      from: formatIsoDate(today),
      to: formatIsoDate(today.add(Duration(days: horizon - 1))),
      addonIds: widget.addonIds,
    )));

    final slots = ref.watch(slotsProvider(_query));

    return Scaffold(
      appBar: AppBar(title: Text(widget.serviceName)),
      body: Column(
        children: [
          // Date strip. Scrolls inside itself; the page never does.
          SizedBox(
            height: 84,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
              itemCount: days.length,
              separatorBuilder: (_, __) => const SizedBox(width: ResetTokens.spaceSm),
              itemBuilder: (context, index) {
                final day = days[index];
                final iso = formatIsoDate(day);

                final matches = dayInfo.valueOrNull
                        ?.where((entry) => entry.date == iso)
                        .toList() ??
                    const [];
                final info = matches.isEmpty ? null : matches.first;

                final closed = info != null && !info.isOpen;
                final hasSlots = info != null && info.isOpen && info.slotCount > 0;

                return _DayChip(
                  day: day,
                  active: iso == _date,
                  closed: closed,
                  hasSlots: hasSlots,
                  onTap: closed ? null : () => setState(() => _date = iso),
                );
              },
            ),
          ),

          Expanded(
            child: slots.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => ErrorView(
                error: error,
                onRetry: () => ref.invalidate(slotsProvider(_query)),
              ),
              data: (availability) {
                if (availability.slots.isEmpty) {
                  return const EmptyState(
                    title: 'Nothing free on this day',
                    message:
                        'Try another date — the dots above show which days have times.',
                  );
                }

                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: ResetTokens.gutter,
                        vertical: ResetTokens.spaceSm,
                      ),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          '${formatDuration(availability.totalDurationMinutes)} · ${formatMoney(availability.payablePaise)}',
                          style:
                              ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                        ),
                      ),
                    ),

                    Expanded(
                      child: GridView.builder(
                        padding: const EdgeInsets.symmetric(
                          horizontal: ResetTokens.gutter,
                        ),
                        gridDelegate:
                            const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 3,
                          mainAxisSpacing: ResetTokens.spaceSm,
                          crossAxisSpacing: ResetTokens.spaceSm,
                          childAspectRatio: 2.2,
                        ),
                        itemCount: availability.slots.length,
                        // Slot chips never stagger. This is the one screen where someone is
                        // scanning for a specific time under mild pressure, and animating
                        // sixty chips in sequence delays the only information they came
                        // for. docs/08 §2.4.
                        itemBuilder: (context, index) {
                          final slot = availability.slots[index];

                          return OutlinedButton(
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => CheckoutScreen(
                                  serviceId: widget.serviceId,
                                  startsAt: slot.startsAtIso,
                                  addonIds: widget.addonIds,
                                ),
                              ),
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  formatTime(slot.startsAt),
                                  style: ResetTokens.mono.copyWith(fontSize: 15),
                                ),
                                if (slot.stationsAvailable == 1)
                                  Text(
                                    'only 1 left',
                                    style: ResetTokens.caption
                                        .copyWith(color: theme.warningColor),
                                  ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),

                    Padding(
                      padding: const EdgeInsets.all(ResetTokens.spaceSm),
                      child: Text(
                        'Times update automatically. Last checked ${formatTime(availability.computedAt)}.',
                        style:
                            ResetTokens.caption.copyWith(color: theme.mutedColor),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip({
    required this.day,
    required this.active,
    required this.closed,
    required this.hasSlots,
    this.onTap,
  });

  final DateTime day;
  final bool active;
  final bool closed;
  final bool hasSlots;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Opacity(
      opacity: closed ? 0.4 : 1,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
        child: Container(
          width: 64,
          padding: const EdgeInsets.symmetric(vertical: ResetTokens.spaceSm),
          decoration: BoxDecoration(
            color: active ? theme.colorScheme.primary : theme.colorScheme.surface,
            border: Border.all(
              color: active ? theme.colorScheme.primary : theme.borderColor,
            ),
            borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                formatDate(day).split(' ').first,
                style: ResetTokens.caption.copyWith(
                  color: active ? theme.colorScheme.onPrimary : theme.mutedColor,
                ),
              ),
              Text(
                '${day.day}',
                style: ResetTokens.body.copyWith(
                  fontWeight: FontWeight.w600,
                  color: active
                      ? theme.colorScheme.onPrimary
                      : theme.colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 2),
              Container(
                width: 4,
                height: 4,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: !hasSlots
                      ? Colors.transparent
                      : active
                          ? theme.colorScheme.onPrimary
                          : theme.colorScheme.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
