import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'service_screen.dart';

/// Home.
///
/// One request — `/catalog/home` — rather than segments, then categories, then services.
/// Four round-trips on a cold open is the difference between the app feeling instant and
/// feeling like a website.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  String? _segmentId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final home = ref.watch(homeProvider(_segmentId));

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(homeProvider(_segmentId)),
          child: home.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => ListView(
              children: [
                SizedBox(height: MediaQuery.sizeOf(context).height * 0.3),
                ErrorView(
                  error: error,
                  onRetry: () => ref.invalidate(homeProvider(_segmentId)),
                ),
              ],
            ),
            data: (data) => CustomScrollView(
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    ResetTokens.gutter,
                    ResetTokens.spaceLg,
                    ResetTokens.gutter,
                    ResetTokens.spaceBase,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Book your reset', style: ResetTokens.display),
                        const SizedBox(height: ResetTokens.spaceXs),
                        Text(
                          'Pick a service, choose a time, walk straight in.',
                          style: ResetTokens.body.copyWith(color: theme.mutedColor),
                        ),
                      ],
                    ),
                  ),
                ),

                // Hides itself when only one segment is live, so adding Women later is a
                // catalog entry rather than a release.
                if (data.segments.length > 1)
                  SliverToBoxAdapter(
                    child: SizedBox(
                      height: 48,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(
                          horizontal: ResetTokens.gutter,
                        ),
                        itemCount: data.segments.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(width: ResetTokens.spaceSm),
                        itemBuilder: (context, index) {
                          final segment = data.segments[index];
                          final active =
                              (_segmentId ?? data.activeSegmentId) == segment.id;

                          return ChoiceChip(
                            label: Text(segment.name),
                            selected: active,
                            onSelected: (_) =>
                                setState(() => _segmentId = segment.id),
                          );
                        },
                      ),
                    ),
                  ),

                for (final category in data.categories)
                  ..._categorySlivers(context, data, category),

                if (data.categories.isEmpty)
                  const SliverFillRemaining(
                    hasScrollBody: false,
                    child: EmptyState(
                      title: 'Nothing bookable yet',
                      message: 'Please call the store to make a booking.',
                    ),
                  ),

                const SliverToBoxAdapter(
                  child: SizedBox(height: ResetTokens.space3xl),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _categorySlivers(
    BuildContext context,
    HomeData data,
    Category category,
  ) {
    final theme = Theme.of(context);
    final services = data.servicesIn(category.id);
    if (services.isEmpty) return const [];

    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(
          ResetTokens.gutter,
          ResetTokens.spaceXl,
          ResetTokens.gutter,
          ResetTokens.spaceSm,
        ),
        sliver: SliverToBoxAdapter(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(child: Text(category.name, style: ResetTokens.h1)),
              if (category.fromPricePaise != null)
                Text(
                  'from ${formatMoney(category.fromPricePaise!)}',
                  style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                ),
            ],
          ),
        ),
      ),
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
        sliver: SliverList.separated(
          itemCount: services.length,
          separatorBuilder: (_, __) => const SizedBox(height: ResetTokens.spaceSm),
          itemBuilder: (context, index) => StaggeredEntry(
            index: index,
            child: _ServiceRow(service: services[index]),
          ),
        ),
      ),
    ];
  }
}

class _ServiceRow extends StatelessWidget {
  const _ServiceRow({required this.service});

  final ServiceSummary service;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ResetCard(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ServiceScreen(idOrSlug: service.slug),
        ),
      ),
      child: Row(
        children: [
          if (service.imageUrl != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
              child: Image.network(
                service.imageUrl!,
                width: 64,
                height: 64,
                fit: BoxFit.cover,
                // A missing image must never take the row with it.
                errorBuilder: (_, __, ___) => Container(
                  width: 64,
                  height: 64,
                  color: theme.surface2Color,
                ),
              ),
            ),
            const SizedBox(width: ResetTokens.spaceBase),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  service.name,
                  style: ResetTokens.h2,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (service.description != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    service.description!,
                    style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: ResetTokens.spaceSm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(formatMoney(service.pricePaise), style: ResetTokens.mono),
              const SizedBox(height: ResetTokens.spaceXs),
              ResetBadge(formatDuration(service.durationMinutes)),
            ],
          ),
        ],
      ),
    );
  }
}
