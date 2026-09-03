import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/reset_enums.dart';
import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'confirmation_screen.dart';
import 'sign_in_sheet.dart';

class BookingsScreen extends ConsumerStatefulWidget {
  const BookingsScreen({super.key});

  @override
  ConsumerState<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends ConsumerState<BookingsScreen> {
  String _filter = 'upcoming';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = ref.watch(sessionProvider);

    if (session.valueOrNull == null && !session.isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Your visits')),
        body: EmptyState(
          title: 'Sign in to see your visits',
          message: 'Your bookings and QR codes live here.',
          action: FilledButton(
            onPressed: () => showSignInSheet(context),
            child: const Text('Sign in'),
          ),
        ),
      );
    }

    final bookings = ref.watch(bookingsProvider(_filter));
    final cache = ref.read(bookingCacheProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Your visits')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
            child: Row(
              children: [
                for (final option in const ['upcoming', 'completed', 'cancelled'])
                  Padding(
                    padding: const EdgeInsets.only(right: ResetTokens.spaceSm),
                    child: ChoiceChip(
                      label: Text(
                        '${option[0].toUpperCase()}${option.substring(1)}',
                      ),
                      selected: _filter == option,
                      onSelected: (_) => setState(() => _filter = option),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: ResetTokens.spaceSm),

          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(bookingsProvider(_filter)),
              child: bookings.when(
                loading: () => ListView(
                  padding: const EdgeInsets.only(top: ResetTokens.spaceSm),
                  children: const <Widget>[SkeletonList(rows: 4, height: 112)],
                ),
                error: (error, _) {
                  // Offline: fall back to the cached copy rather than an error screen. The
                  // QR is the whole reason this screen exists, and it is already on the
                  // device.
                  final cached = _filter == 'upcoming' ? cache.read() : const <Booking>[];
                  if (cached.isEmpty) {
                    return ListView(
                      children: [
                        SizedBox(height: MediaQuery.sizeOf(context).height * 0.25),
                        ErrorView(
                          error: error,
                          onRetry: () => ref.invalidate(bookingsProvider(_filter)),
                        ),
                      ],
                    );
                  }

                  return _BookingList(
                    bookings: cached,
                    filter: _filter,
                    banner: 'Showing your saved copy — you appear to be offline.',
                  );
                },
                data: (data) => data.isEmpty
                    ? ListView(
                        children: [
                          SizedBox(height: MediaQuery.sizeOf(context).height * 0.2),
                          EmptyState(
                            title: switch (_filter) {
                              'upcoming' => 'Nothing booked yet',
                              'completed' => 'No past visits',
                              _ => 'Nothing cancelled',
                            },
                            message: _filter == 'upcoming'
                                ? 'Pick a service and we will hold you a time.'
                                : null,
                          ),
                        ],
                      )
                    : _BookingList(bookings: data, filter: _filter),
              ),
            ),
          ),
        ],
      ),
      backgroundColor: theme.scaffoldBackgroundColor,
    );
  }
}

class _BookingList extends ConsumerWidget {
  const _BookingList({
    required this.bookings,
    required this.filter,
    this.banner,
  });

  final List<Booking> bookings;
  final String filter;
  final String? banner;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return ListView.separated(
      padding: const EdgeInsets.all(ResetTokens.gutter),
      itemCount: bookings.length + (banner == null ? 0 : 1),
      separatorBuilder: (_, __) => const SizedBox(height: ResetTokens.spaceSm),
      itemBuilder: (context, index) {
        if (banner != null && index == 0) {
          return ResetCard(
            color: theme.warningColor.withValues(alpha: 0.08),
            borderColor: theme.warningColor.withValues(alpha: 0.4),
            child: Text(banner!, style: ResetTokens.bodySm),
          );
        }

        final booking = bookings[index - (banner == null ? 0 : 1)];

        return StaggeredEntry(
          index: index,
          child: ResetCard(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ConfirmationScreen(bookingId: booking.id),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            booking.serviceName,
                            style: ResetTokens.h2,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            '${formatRelativeDay(booking.startsAt)} · ${formatTime(booking.startsAt)}',
                            style: ResetTokens.bodySm
                                .copyWith(color: theme.mutedColor),
                          ),
                        ],
                      ),
                    ),
                    // An unpaid booking is CONFIRMED as far as the slot is concerned, so
                    // the status badge alone said "Confirmed" on something the store had
                    // not settled and would not honour yet. The same distinction the web
                    // list makes.
                    if (booking.isPaid || booking.status == BookingStatus.cancelled)
                      BookingStatusBadge(booking.status)
                    else
                      ResetBadge('Awaiting confirmation',
                          color: Theme.of(context).warningColor),
                  ],
                ),
                const SizedBox(height: ResetTokens.spaceSm),
                Wrap(
                  spacing: ResetTokens.spaceSm,
                  runSpacing: ResetTokens.spaceXs,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      formatDuration(booking.durationMinutes),
                      style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                    ),
                    Text(formatMoney(booking.payablePaise), style: ResetTokens.bodySm),
                    for (final name in booking.addonNames) ResetBadge(name),
                  ],
                ),

                if (filter == 'upcoming' && booking.canCancel) ...[
                  const SizedBox(height: ResetTokens.spaceSm),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: () => _confirmCancel(context, ref, booking),
                      child: Text(
                        'Cancel',
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ),
                  ),
                ],

                // `canCancel` is decided server-side against the store's window, so the
                // reason it is missing is worth saying rather than just hiding a button.
                if (filter == 'upcoming' && !booking.canCancel)
                  Padding(
                    padding: const EdgeInsets.only(top: ResetTokens.spaceXs),
                    child: Text(
                      'Too close to your slot to cancel in the app — call the store.',
                      style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmCancel(
    BuildContext context,
    WidgetRef ref,
    Booking booking,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this booking?'),
        content: Text(
          '${booking.serviceName}, ${formatDateTime(booking.startsAt)}. '
          // No card was charged — the store takes payment at the counter — so promising
          // a refund to one tells the customer something that cannot happen.
          'The slot goes back for someone else to book.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Yes, cancel'),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;

    try {
      await ref.read(repositoryProvider).cancelBooking(booking.id);
      ref.invalidate(bookingsProvider('upcoming'));
      ref.invalidate(bookingsProvider('cancelled'));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cancelled. The slot is free again.')),
        );
      }
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyMessage(error))));
      }
    }
  }
}
