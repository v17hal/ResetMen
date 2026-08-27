import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';

/// Icon and colour for a service, chosen from its name.
///
/// Every `imageUrl` in the catalog is null, and the honest options were a letter in a box
/// or something that means what the row is selling. A tile reading "H" three times down a
/// list of head treatments is visibly a missing image; an icon of a head is a picture of
/// the thing. Urban Company runs its entire catalogue on illustration for the same reason.
///
/// Keyword-matched rather than stored on the service, so a category the client adds next
/// month still gets a sensible tile without a migration. Falls through to a spa mark, which
/// is wrong for nothing in this catalogue.
class ServiceLook {
  const ServiceLook(this.icon, this.from, this.to);

  final IconData icon;
  final Color from;
  final Color to;

  static const _fallback = ServiceLook(
    Icons.spa_outlined,
    Color(0xFF0E7C66),
    Color(0xFF12B886),
  );

  static const _rules = <(List<String>, ServiceLook)>[
    (
      ['back', 'spine'],
      ServiceLook(Icons.airline_seat_recline_normal, Color(0xFF1E5F74), Color(0xFF3AA3C9)),
    ),
    (
      ['neck', 'shoulder'],
      ServiceLook(Icons.accessibility_new, Color(0xFF35507A), Color(0xFF5B87C7)),
    ),
    (
      ['head', 'scalp'],
      ServiceLook(Icons.self_improvement, Color(0xFF4A3B6B), Color(0xFF7E68BE)),
    ),
    (
      ['premium', 'luxe', 'signature'],
      ServiceLook(Icons.auto_awesome, Color(0xFF7A4F1D), Color(0xFFE0A040)),
    ),
    (
      ['glow', 'facial', 'face', 'clean'],
      ServiceLook(Icons.face_retouching_natural, Color(0xFF8A3B5E), Color(0xFFD1719A)),
    ),
    (
      ['foot', 'leg'],
      ServiceLook(Icons.directions_walk, Color(0xFF2F5B3A), Color(0xFF62AF70)),
    ),
    (
      ['full body', 'body', 'relax', 'basic'],
      ServiceLook(Icons.spa, Color(0xFF0E7C66), Color(0xFF17C295)),
    ),
    (
      ['stress', 'relief'],
      ServiceLook(Icons.self_improvement, Color(0xFF4A3B6B), Color(0xFF7E68BE)),
    ),
  ];

  static ServiceLook of(String name) {
    final n = name.toLowerCase();
    for (final (keywords, look) in _rules) {
      for (final k in keywords) {
        if (n.contains(k)) return look;
      }
    }
    return _fallback;
  }
}

/// The square image tile on a service row.
///
/// Shows the real photo the moment one exists; until then an icon on the service's colour.
class ServiceImage extends StatelessWidget {
  const ServiceImage({
    super.key,
    required this.label,
    this.imageUrl,
    this.size = 112,
    this.height,
    this.radius,
  });

  final String label;
  final String? imageUrl;
  final double size;

  /// Square to [size] unless given, so the same widget serves a row tile and a page header.
  final double? height;
  final double? radius;

  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(radius ?? ResetTokens.radiusLg);
    final h = height ?? size;

    if (imageUrl != null) {
      return ClipRRect(
        borderRadius: r,
        child: Image.network(
          imageUrl!,
          width: size,
          height: h,
          fit: BoxFit.cover,
          errorBuilder: (context, _, __) => _icon(r, h),
        ),
      );
    }

    return _icon(r, h);
  }

  Widget _icon(BorderRadius r, double h) {
    final look = ServiceLook.of(label);
    // Scales off whichever edge is real — `size` is infinity on a full-width header.
    final glyph = (size.isFinite ? (size < h ? size : h) : h) * 0.44;

    return Container(
      width: size,
      height: h,
      decoration: BoxDecoration(
        borderRadius: r,
        gradient: LinearGradient(
          colors: [look.from, look.to],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      alignment: Alignment.center,
      child: Icon(look.icon, size: glyph, color: Colors.white),
    );
  }
}

/// Circular category tile in the strip under the search bar.
class CategoryBubble extends StatelessWidget {
  const CategoryBubble({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final look = ServiceLook.of(label);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
      child: SizedBox(
        width: 88,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: ResetTokens.durationMicro,
              curve: ResetTokens.easingStandard,
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: selected ? theme.colorScheme.primary : Colors.transparent,
                  width: 2.5,
                ),
              ),
              child: Container(
                width: 62,
                height: 62,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [look.from, look.to],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                child: Icon(look.icon, size: 28, color: Colors.white),
              ),
            ),
            const SizedBox(height: ResetTokens.spaceXs),
            Text(
              label,
              maxLines: 2,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: ResetTokens.caption.copyWith(
                color: selected ? theme.colorScheme.primary : theme.mutedColor,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Filters the catalogue as you type.
///
/// A real field rather than something that navigates: a control shaped like a search box
/// that opens a page instead of taking a query is worse than no search box, because the
/// person has already decided what it does before they touch it.
class SearchField extends StatelessWidget {
  const SearchField({
    super.key,
    required this.controller,
    required this.onChanged,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      height: 50,
      padding: const EdgeInsets.only(left: ResetTokens.spaceBase, right: ResetTokens.spaceSm),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(ResetTokens.radiusMd),
        border: Border.all(color: theme.borderColor),
        boxShadow: ResetTokens.cardShadow(Colors.black),
      ),
      child: Row(
        children: [
          Icon(Icons.search, size: 22, color: theme.colorScheme.primary),
          const SizedBox(width: ResetTokens.spaceSm),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              textInputAction: TextInputAction.search,
              style: ResetTokens.body.copyWith(color: theme.colorScheme.onSurface),
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: 'Search for a service',
                hintStyle: ResetTokens.body.copyWith(color: theme.mutedColor),
              ),
            ),
          ),
          if (controller.text.isNotEmpty)
            IconButton(
              icon: Icon(Icons.close, size: 20, color: theme.mutedColor),
              onPressed: () {
                controller.clear();
                onChanged('');
              },
            ),
        ],
      ),
    );
  }
}

/// Presses in slightly under the finger.
///
/// A ripple is the only feedback Material gives by default, and on a card the size of these
/// rows it is easy to miss. The scale is small on purpose — enough to feel the tap land,
/// not enough to notice as an effect. Disabled under reduced motion.
class PressableCard extends StatefulWidget {
  const PressableCard({super.key, required this.child, required this.onTap});

  final Widget child;
  final VoidCallback onTap;

  @override
  State<PressableCard> createState() => _PressableCardState();
}

class _PressableCardState extends State<PressableCard> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final still = MediaQuery.disableAnimationsOf(context);

    return GestureDetector(
      onTapDown: (_) => setState(() => _down = true),
      onTapUp: (_) => setState(() => _down = false),
      onTapCancel: () => setState(() => _down = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: _down && !still ? 0.97 : 1,
        duration: ResetTokens.durationMicro,
        curve: ResetTokens.easingStandard,
        child: widget.child,
      ),
    );
  }
}
