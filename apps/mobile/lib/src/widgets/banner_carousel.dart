import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../api/models.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';

/// The offers carousel at the top of Home — client request of 11/09/2026, "like the Yes
/// Madam app".
///
/// Moves on by itself every five seconds, because a carousel that only moves when swiped is
/// a single banner to most people — they never find out there is a second. It holds still
/// while a finger is on it (the slide being read must not be pulled away), starts the count
/// again when the finger lifts, and never moves by itself when the OS asks for reduced
/// motion.
///
/// A slide whose picture fails to load is dropped rather than left as a grey box, and the
/// whole carousel goes if none of them load. An empty frame at the top of the menu reads as
/// the app being broken; a missing offer is simply not noticed.
class BannerCarousel extends StatefulWidget {
  const BannerCarousel({
    super.key,
    required this.banners,
    required this.onOpen,
    this.image = _network,
    this.padding = EdgeInsets.zero,
  });

  final List<HomeBanner> banners;

  /// Applied only while there is something to show, so a carousel whose every picture
  /// failed leaves no gap behind it.
  final EdgeInsets padding;

  /// Called with the banner's service slug. Never called for a banner without one.
  final ValueChanged<String> onOpen;

  /// Where a picture comes from — the network, in the app. Tests hand in an in-memory image
  /// because the test harness answers every HTTP request with a 400, and the carousel would,
  /// correctly, drop every slide.
  final ImageProvider Function(String url) image;

  static ImageProvider _network(String url) => NetworkImage(url);

  /// How long each slide stays before the next.
  static const interval = Duration(seconds: 5);

  @override
  State<BannerCarousel> createState() => _BannerCarouselState();
}

class _BannerCarouselState extends State<BannerCarousel> {
  final PageController _controller = PageController();

  /// Slides whose picture would not load. Kept by id so a refresh that returns the same
  /// banners does not bring a broken one back.
  final Set<String> _failed = <String>{};
  Timer? _timer;
  int _page = 0;
  bool _dragging = false;

  List<HomeBanner> get _visible => widget.banners
      .where((banner) => !_failed.contains(banner.id))
      .toList(growable: false);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Here rather than in initState: reduced motion comes from MediaQuery, and it can be
    // switched on while the app is open.
    _restart();
  }

  @override
  void didUpdateWidget(covariant BannerCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.banners != widget.banners) {
      _page = _page.clamp(0, max(0, _visible.length - 1));
      _restart();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  /// Starts the count from zero, so after a swipe the next slide is a whole interval away
  /// rather than whatever was left of the last one.
  void _restart() {
    _timer?.cancel();
    _timer = null;
    if (_visible.length < 2 || MediaQuery.disableAnimationsOf(context)) return;
    _timer = Timer.periodic(BannerCarousel.interval, (_) => _advance());
  }

  void _advance() {
    final count = _visible.length;
    if (!mounted || _dragging || count < 2 || !_controller.hasClients) return;
    _controller.animateToPage(
      (_page + 1) % count,
      duration: ResetTokens.durationSlow,
      curve: ResetTokens.easingStandard,
    );
  }

  /// Reached from the image's error builder, which runs in the middle of a build — so the
  /// slide goes on the next frame rather than through a setState that would throw.
  void _drop(String id) {
    if (_failed.contains(id)) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_failed.add(id)) return;
      setState(() => _page = _page.clamp(0, max(0, _visible.length - 1)));
      _restart();
    });
  }

  bool _onScroll(ScrollNotification notification) {
    // Only a drag counts. The carousel's own animation also starts and ends a scroll, and
    // treating that as the user would stop it after its first move.
    if (notification is ScrollStartNotification &&
        notification.dragDetails != null) {
      _dragging = true;
      _timer?.cancel();
    } else if (notification is ScrollEndNotification && _dragging) {
      _dragging = false;
      _restart();
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final visible = _visible;
    if (visible.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: widget.padding,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AspectRatio(
            aspectRatio: 16 / 10,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(ResetTokens.radiusLg),
              child: NotificationListener<ScrollNotification>(
                onNotification: _onScroll,
                child: PageView.builder(
                  controller: _controller,
                  itemCount: visible.length,
                  onPageChanged: (page) => setState(() => _page = page),
                  itemBuilder: (context, index) =>
                      _slide(theme, visible[index]),
                ),
              ),
            ),
          ),
          if (visible.length > 1) ...[
            const SizedBox(height: ResetTokens.spaceSm),
            // Position is visual only; each slide already announces itself.
            ExcludeSemantics(
              child: _Dots(
                count: visible.length,
                current: _page.clamp(0, visible.length - 1),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _slide(ThemeData theme, HomeBanner banner) {
    final placeholder = ColoredBox(color: theme.surface2Color);

    final picture = banner.isVideo
        ? _BannerVideo(
            url: banner.imageUrl,
            placeholder: placeholder,
            onFailed: () => _drop(banner.id),
          )
        : Image(
            image: widget.image(banner.imageUrl),
            fit: BoxFit.cover,
            width: double.infinity,
            height: double.infinity,
            // The frame holds its final size from the start, so nothing below it jumps when the
            // picture lands.
            frameBuilder: (context, child, frame, synchronous) =>
                synchronous || frame != null ? child : placeholder,
            errorBuilder: (context, error, stackTrace) {
              _drop(banner.id);
              return placeholder;
            },
          );

    final slug = banner.serviceSlug;

    return Semantics(
      label: banner.altText,
      image: true,
      button: slug != null,
      onTap: slug == null ? null : () => widget.onOpen(slug),
      excludeSemantics: true,
      child: slug == null
          // A picture with nowhere to go takes no tap — a ripple that leads nowhere is a
          // promise the app does not keep.
          ? picture
          : Stack(
              fit: StackFit.expand,
              children: [
                picture,
                Material(
                  type: MaterialType.transparency,
                  child: InkWell(onTap: () => widget.onOpen(slug)),
                ),
              ],
            ),
    );
  }
}

class _Dots extends StatelessWidget {
  const _Dots({required this.count, required this.current});

  final int count;
  final int current;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < count; i++)
          AnimatedContainer(
            key: ValueKey('banner-dot-$i'),
            duration: ResetTokens.durationMicro,
            curve: ResetTokens.easingStandard,
            margin: const EdgeInsets.symmetric(horizontal: 3),
            width: i == current ? 16 : 6,
            height: 6,
            decoration: BoxDecoration(
              color: i == current
                  ? theme.colorScheme.primary
                  : theme.borderColor,
              borderRadius: BorderRadius.circular(ResetTokens.radiusFull),
            ),
          ),
      ],
    );
  }
}

/// A banner that moves — client request 05/10/2026.
///
/// Muted, looping and inline, exactly as the website plays it. Sound is never turned on: an
/// advert that starts talking when a customer opens the app is the fastest way to be closed,
/// and the phone may be in a quiet shop.
///
/// Holds the surface colour until the first frame is decoded, so the strip never collapses
/// and springs back, and gives up quietly if the file will not play — the same treatment a
/// picture that fails to load already gets.
class _BannerVideo extends StatefulWidget {
  const _BannerVideo({
    required this.url,
    required this.placeholder,
    required this.onFailed,
  });

  final String url;
  final Widget placeholder;
  final VoidCallback onFailed;

  @override
  State<_BannerVideo> createState() => _BannerVideoState();
}

class _BannerVideoState extends State<_BannerVideo> {
  VideoPlayerController? _controller;

  @override
  void initState() {
    super.initState();
    final controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller = controller;
    controller
        .initialize()
        .then((_) async {
          await controller.setLooping(true);
          await controller.setVolume(0);
          await controller.play();
          if (mounted) setState(() {});
        })
        .catchError((Object _) {
          if (mounted) widget.onFailed();
        });
  }

  @override
  void dispose() {
    // The controller holds a platform player; leaking one leaves the codec running after
    // the screen is gone.
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      return widget.placeholder;
    }

    // Cover, not contain: the frame is a fixed 16:10 band and letterboxing inside it would
    // read as a mistake rather than as a choice.
    return FittedBox(
      fit: BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: SizedBox(
        width: controller.value.size.width,
        height: controller.value.size.height,
        child: VideoPlayer(controller),
      ),
    );
  }
}
