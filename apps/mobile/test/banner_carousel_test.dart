import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reset_app/src/api/models.dart';
import 'package:reset_app/src/theme/app_theme.dart';
import 'package:reset_app/src/theme/reset_tokens.dart';
import 'package:reset_app/src/widgets/banner_carousel.dart';

/// A picture that never finishes loading. The slide stays on its placeholder — all these
/// tests need — and nothing touches the network.
class _Pending extends ImageProvider<_Pending> {
  const _Pending();

  @override
  Future<_Pending> obtainKey(ImageConfiguration configuration) =>
      SynchronousFuture<_Pending>(this);

  @override
  ImageStreamCompleter loadImage(_Pending key, ImageDecoderCallback decode) =>
      OneFrameImageStreamCompleter(Completer<ImageInfo>().future);
}

/// A picture that fails, as a 404 from the CDN would.
class _Broken extends ImageProvider<_Broken> {
  const _Broken();

  @override
  Future<_Broken> obtainKey(ImageConfiguration configuration) =>
      SynchronousFuture<_Broken>(this);

  @override
  ImageStreamCompleter loadImage(_Broken key, ImageDecoderCallback decode) =>
      OneFrameImageStreamCompleter(Future<ImageInfo>.error(StateError('404')));
}

const _first = HomeBanner(
  id: 'b1',
  imageUrl: 'https://cdn.test/1.jpg',
  altText: 'Tension Relief at ₹49',
  serviceSlug: 'tension-relief',
);
const _second = HomeBanner(
  id: 'b2',
  imageUrl: 'https://cdn.test/2.jpg',
  altText: 'Back Reset at ₹99',
  serviceSlug: 'back-reset',
);
const _pictureOnly = HomeBanner(
  id: 'b3',
  imageUrl: 'https://cdn.test/3.jpg',
  altText: 'Open till 10pm',
  serviceSlug: null,
);

void main() {
  late List<String> opened;

  setUp(() => opened = []);

  Future<void> pump(
    WidgetTester tester,
    List<HomeBanner> banners, {
    ImageProvider image = const _Pending(),
    bool reduceMotion = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light(),
        home: Builder(
          builder: (context) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
            child: Scaffold(
              body: Padding(
                padding: const EdgeInsets.all(20),
                child: BannerCarousel(
                  banners: banners,
                  onOpen: opened.add,
                  image: (_) => image,
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  /// Lets a slide change run to the end.
  Future<void> finishSlide(WidgetTester tester) async {
    await tester.pump(ResetTokens.durationSlow);
    await tester.pump(const Duration(milliseconds: 100));
  }

  testWidgets('takes no space at all without banners', (tester) async {
    await pump(tester, const []);
    expect(find.byType(PageView), findsNothing);
  });

  testWidgets('shows dots only when there is more than one slide', (tester) async {
    await pump(tester, const [_first]);
    expect(find.byType(PageView), findsOneWidget);
    expect(find.byKey(const ValueKey('banner-dot-0')), findsNothing);

    await pump(tester, const [_first, _second]);
    expect(find.byKey(const ValueKey('banner-dot-0')), findsOneWidget);
    expect(find.byKey(const ValueKey('banner-dot-1')), findsOneWidget);
  });

  testWidgets('announces each slide by its alt text', (tester) async {
    final semantics = tester.ensureSemantics();
    await pump(tester, const [_first, _second]);

    expect(find.bySemanticsLabel('Tension Relief at ₹49'), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('a banner with a service opens it', (tester) async {
    await pump(tester, const [_first, _second]);

    await tester.tap(find.byType(PageView));
    expect(opened, ['tension-relief']);
  });

  testWidgets('a banner without a service takes no tap', (tester) async {
    await pump(tester, const [_pictureOnly]);

    expect(
      find.descendant(of: find.byType(BannerCarousel), matching: find.byType(InkWell)),
      findsNothing,
    );
    await tester.tap(find.byType(PageView));
    expect(opened, isEmpty);
  });

  testWidgets('moves on by itself every five seconds', (tester) async {
    await pump(tester, const [_first, _second]);

    await tester.pump(BannerCarousel.interval);
    await finishSlide(tester);

    await tester.tap(find.byType(PageView));
    expect(opened, ['back-reset']);
  });

  testWidgets('holds still under reduced motion', (tester) async {
    await pump(tester, const [_first, _second], reduceMotion: true);

    await tester.pump(BannerCarousel.interval * 2);
    await finishSlide(tester);

    await tester.tap(find.byType(PageView));
    expect(opened, ['tension-relief']);
  });

  testWidgets('holds still while a finger is on it', (tester) async {
    await pump(tester, const [_first, _second]);

    final gesture = await tester.startGesture(tester.getCenter(find.byType(PageView)));
    await gesture.moveBy(const Offset(-30, 0));
    await tester.pump(BannerCarousel.interval + const Duration(seconds: 1));
    await gesture.moveBy(const Offset(30, 0));
    await gesture.up();
    await finishSlide(tester);

    await tester.tap(find.byType(PageView));
    expect(opened, ['tension-relief'],
        reason: 'the slide under the finger must not be pulled away');
  });

  testWidgets('drops slides whose picture fails, and itself when none load',
      (tester) async {
    await pump(tester, const [_first, _second], image: const _Broken());
    await tester.pump();
    await tester.pump();

    expect(find.byType(PageView), findsNothing);
  });
}
