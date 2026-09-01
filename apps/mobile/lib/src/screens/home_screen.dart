import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import '../widgets/complete_profile_banner.dart';
import '../widgets/service_tile.dart';
import 'service_screen.dart';

/// Home.
///
/// One request — `/catalog/home` — rather than segments, then categories, then services.
/// Four round-trips on a cold open is the difference between the app feeling instant and
/// feeling like a website.
///
/// Laid out the way a food-delivery menu is: search, a strip of categories, then rows that
/// lead with the price and carry their own action. The previous version put a title, a grey
/// description and a price in three identical columns on every row, which scanned as a
/// spreadsheet — nothing pulled the eye to the thing being sold.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  String? _segmentId;
  String? _categoryId;
  final _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  /// Whether any service is named for the current query.
  ///
  /// Decides between the two modes in [_matches]. Computed once per build from the loaded
  /// catalogue rather than per row.
  bool _anyNamed(HomeData data) {
    final q = _query.toLowerCase();
    return data.services.any((s) => s.name.toLowerCase().contains(q));
  }

  /// Names first, descriptions only as a fallback.
  ///
  /// Searching both at once is surprising: "head" matched a full-body service because its
  /// description reads "twenty minutes, head to toe", and the result looked like the filter
  /// was broken. Names are what people type; a description match is a rescue for when
  /// nothing is named that way, not a peer of it.
  bool _matches(ServiceSummary service, {required bool namedHits}) {
    if (_query.isEmpty) return true;
    final q = _query.toLowerCase();
    if (service.name.toLowerCase().contains(q)) return true;
    return !namedHits && (service.description?.toLowerCase().contains(q) ?? false);
  }

  void _open(ServiceSummary service) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => ServiceScreen(idOrSlug: service.slug)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final home = ref.watch(homeProvider(_segmentId));

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(homeProvider(_segmentId)),
          // Not `home.when`: that shows the error screen the moment a refresh fails, even
          // though the catalogue already on screen is perfectly readable. Someone who loses
          // signal was shown the menu as if nothing had happened, and reported the silence
          // as the bug. Stale data is kept and labelled instead.
          child: switch (home) {
            AsyncValue(:final value?) => _catalog(
                context,
                theme,
                value,
                stale: home.hasError,
              ),
            AsyncValue(hasError: true, :final error?) => ListView(
                children: [
                  SizedBox(height: MediaQuery.sizeOf(context).height * 0.3),
                  ErrorView(
                    error: error,
                    onRetry: () => ref.invalidate(homeProvider(_segmentId)),
                  ),
                ],
              ),
            _ => const SkeletonPage(rows: 5),
          },
        ),
      ),
    );
  }

  Widget _catalog(
    BuildContext context,
    ThemeData theme,
    HomeData data, {
    bool stale = false,
  }) {
    // Categories with nothing bookable are dropped rather than shown empty — an inert
    // heading reads as something that failed to load.
    final live = data.categories
        .where((c) => data.servicesIn(c.id).isNotEmpty)
        .toList(growable: false);

    final selected = live.any((c) => c.id == _categoryId) ? _categoryId : null;

    // A search spans the whole catalogue: someone typing "back" wants the treatment, not
    // to be told the category they happen to have selected does not contain it.
    final scoped = _query.isNotEmpty || selected == null
        ? live
        : live.where((c) => c.id == selected).toList(growable: false);

    final namedHits = _anyNamed(data);
    final shown = scoped
        .where((c) =>
            data.servicesIn(c.id).any((s) => _matches(s, namedHits: namedHits)))
        .toList(growable: false);

    return CustomScrollView(
      slivers: [
        if (stale)
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(
              ResetTokens.gutter,
              ResetTokens.spaceBase,
              ResetTokens.gutter,
              0,
            ),
            sliver: SliverToBoxAdapter(
              child: ResetCard(
                color: theme.warningColor.withValues(alpha: 0.08),
                borderColor: theme.warningColor.withValues(alpha: 0.4),
                child: Text(
                  'You are offline. Prices and times may have changed since this was '
                  'saved — pull down to try again.',
                  style: ResetTokens.bodySm,
                ),
              ),
            ),
          ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            ResetTokens.gutter,
            ResetTokens.spaceBase,
            ResetTokens.gutter,
            ResetTokens.spaceMd,
          ),
          sliver: SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Book your reset', style: ResetTokens.h1),
                const SizedBox(height: 2),
                Text(
                  'Pick a service, choose a time, walk straight in.',
                  style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                ),
                const SizedBox(height: ResetTokens.spaceBase),
                SearchField(
                  controller: _search,
                  onChanged: (value) => setState(() => _query = value.trim()),
                ),
                const CompleteProfileBanner(),
              ],
            ),
          ),
        ),

        // Segment switch stays hidden while only one is live, so adding Women later is a
        // catalog entry rather than a release.
        if (data.segments.length > 1)
          SliverToBoxAdapter(
            child: SizedBox(
              height: 44,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
                itemCount: data.segments.length,
                separatorBuilder: (_, __) => const SizedBox(width: ResetTokens.spaceSm),
                itemBuilder: (context, index) {
                  final segment = data.segments[index];
                  final active = (_segmentId ?? data.activeSegmentId) == segment.id;

                  return ChoiceChip(
                    label: Text(segment.name),
                    selected: active,
                    onSelected: (_) => setState(() {
                      _segmentId = segment.id;
                      _categoryId = null;
                    }),
                  );
                },
              ),
            ),
          ),

        if (live.length > 1)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.only(top: ResetTokens.spaceXs),
              child: SizedBox(
                // Sized to the bubble, not padded around it. The strip previously reserved
                // room for a two-line label every category had on one line, which opened a
                // band of nothing between the circles and the first heading.
                height: 100,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
                  itemCount: live.length,
                  separatorBuilder: (_, __) => const SizedBox(width: ResetTokens.spaceMd),
                  itemBuilder: (context, index) {
                    final category = live[index];
                    return CategoryBubble(
                      label: category.name,
                      selected: selected == category.id,
                      // Tapping the active category clears the filter — the same gesture
                      // that narrowed the list widens it again.
                      onTap: () => setState(
                        () => _categoryId = selected == category.id ? null : category.id,
                      ),
                    );
                  },
                ),
              ),
            ),
          ),

        for (final category in shown)
          ..._categorySlivers(context, theme, data, category, namedHits),

        if (shown.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: _query.isEmpty
                ? const EmptyState(
                    title: 'Nothing bookable yet',
                    message: 'Please call the store to make a booking.',
                  )
                : EmptyState(
                    title: 'No match for "$_query"',
                    message: 'Try a shorter word — "head", "back", "full body".',
                  ),
          ),

        const SliverToBoxAdapter(child: SizedBox(height: ResetTokens.space3xl)),
      ],
    );
  }

  List<Widget> _categorySlivers(
    BuildContext context,
    ThemeData theme,
    HomeData data,
    Category category,
    bool namedHits,
  ) {
    final services = data
        .servicesIn(category.id)
        .where((s) => _matches(s, namedHits: namedHits))
        .toList(growable: false);
    if (services.isEmpty) return const [];

    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(
          ResetTokens.gutter,
          ResetTokens.spaceBase,
          ResetTokens.gutter,
          ResetTokens.spaceSm,
        ),
        sliver: SliverToBoxAdapter(
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '${category.name}  ·  ${services.length}',
                  style: ResetTokens.h2,
                ),
              ),
              if (category.fromPricePaise != null)
                Text(
                  'from ${formatMoney(category.fromPricePaise!)}',
                  style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                ),
            ],
          ),
        ),
      ),
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
        sliver: SliverList.separated(
          itemCount: services.length,
          separatorBuilder: (_, __) => Divider(
            height: ResetTokens.spaceXl,
            thickness: 1,
            color: theme.borderColor.withValues(alpha: 0.6),
          ),
          itemBuilder: (context, index) => StaggeredEntry(
            index: index,
            child: _ServiceRow(
              service: services[index],
              onTap: () => _open(services[index]),
            ),
          ),
        ),
      ),
    ];
  }
}

/// One service.
///
/// Price first and largest — it is the thing people compare. The image carries the BOOK
/// button on its lower edge, so the action sits where the eye already is instead of
/// requiring the whole row to be treated as a target.
class _ServiceRow extends StatelessWidget {
  const _ServiceRow({required this.service, required this.onTap});

  final ServiceSummary service;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return PressableCard(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: ResetTokens.spaceXs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    service.name,
                    style: ResetTokens.h2.copyWith(fontSize: 17),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: ResetTokens.spaceXs),
                  Row(
                    children: [
                      Text(
                        formatMoney(service.pricePaise),
                        style: ResetTokens.h2.copyWith(fontSize: 18),
                      ),
                      const SizedBox(width: ResetTokens.spaceSm),
                      Icon(Icons.schedule, size: 13, color: theme.mutedColor),
                      const SizedBox(width: 3),
                      Text(
                        formatDuration(service.durationMinutes),
                        style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                      ),
                    ],
                  ),
                  if (service.description != null) ...[
                    const SizedBox(height: ResetTokens.spaceXs),
                    Text(
                      service.description!,
                      style: ResetTokens.caption.copyWith(
                        color: theme.mutedColor,
                        height: 1.45,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: ResetTokens.spaceBase),

            // The button hangs off the bottom of the tile, so the tile needs room beneath
            // it and the stack must not clip.
            SizedBox(
              width: 112,
              height: 112 + 14,
              child: Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.topCenter,
                children: [
                  // Carries into the detail screen, so the tile grows into place rather
                  // than the page cutting to a new one.
                  Hero(
                    tag: 'service-${service.id}',
                    child: ServiceImage(
                      label: service.name,
                      imageUrl: service.imageUrl,
                    ),
                  ),
                  Positioned(
                    bottom: 0,
                    child: _BookButton(onTap: onTap),
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

class _BookButton extends StatelessWidget {
  const _BookButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      color: theme.colorScheme.surface,
      elevation: 3,
      shadowColor: Colors.black.withValues(alpha: 0.25),
      borderRadius: BorderRadius.circular(ResetTokens.radiusSm),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(ResetTokens.radiusSm),
        child: Container(
          width: 84,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(ResetTokens.radiusSm),
            border: Border.all(color: theme.colorScheme.primary, width: 1.4),
          ),
          child: Text(
            'BOOK',
            style: ResetTokens.caption.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
            ),
          ),
        ),
      ),
    );
  }
}
