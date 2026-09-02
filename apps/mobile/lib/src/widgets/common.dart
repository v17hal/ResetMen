import 'package:flutter/material.dart';

import '../api/api_client.dart';
import '../api/generated/reset_enums.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';

/// The signature entry motion: fade in while translating up.
///
/// Two departures from the Best-Flutter-UI-Templates reference this is taken from:
///
///  1. The delay is capped at [ResetTokens.staggerMaxItems]. The reference computes each
///     item's interval as `(1 / count) * index`, so a 40-item list gives every item a 2.5%
///     slice of the timeline — imperceptible individually, and the last items land well
///     after the user has started scrolling.
///  2. Slot chips never use it at all. The slot picker is the one screen where someone is
///     scanning for a specific time under mild pressure.
///
/// Suppressed entirely when the OS asks for reduced motion.
class StaggeredEntry extends StatefulWidget {
  const StaggeredEntry({super.key, required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  State<StaggeredEntry> createState() => _StaggeredEntryState();
}

class _StaggeredEntryState extends State<StaggeredEntry>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: ResetTokens.durationBase,
  );

  @override
  void initState() {
    super.initState();
    final capped = widget.index.clamp(0, ResetTokens.staggerMaxItems);
    final step = ResetTokens.durationBase.inMilliseconds ~/ ResetTokens.staggerMaxItems;

    Future<void>.delayed(Duration(milliseconds: capped * step), () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return widget.child;

    final curved = CurvedAnimation(
      parent: _controller,
      curve: ResetTokens.easingDecelerate,
    );

    return AnimatedBuilder(
      animation: curved,
      builder: (context, child) => Opacity(
        opacity: curved.value,
        child: Transform.translate(
          offset: Offset(0, ResetTokens.staggerRiseDistance * (1 - curved.value)),
          child: child,
        ),
      ),
      child: widget.child,
    );
  }
}

/// A loading placeholder shaped like the content that will replace it.
///
/// Ported from the web `Skeleton`, down to the pulse: a spinner says "something is
/// happening", a skeleton says "a list of cards is about to be here", and the second is
/// what stops the screen jumping when the data lands.
///
/// Hidden from screen readers — announcing six grey rectangles is worse than silence.
/// Falls back to a static block under reduced motion, matching [StaggeredEntry].
class Skeleton extends StatefulWidget {
  const Skeleton({
    super.key,
    this.width = double.infinity,
    this.height = 80,
    this.radius = ResetTokens.radiusMd,
  });

  final double width;
  final double height;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  // 1000ms each way, matching Tailwind's animate-pulse on the web side.
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1000),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final block = Container(
      width: widget.width,
      height: widget.height,
      decoration: BoxDecoration(
        color: theme.surface2Color,
        borderRadius: BorderRadius.circular(widget.radius),
      ),
    );

    if (MediaQuery.disableAnimationsOf(context)) {
      return ExcludeSemantics(child: block);
    }

    return ExcludeSemantics(
      child: FadeTransition(
        opacity: Tween<double>(begin: 1, end: 0.5).animate(
          CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
        ),
        child: block,
      ),
    );
  }
}

/// A stack of skeleton rows sized like list items. The default shape for a loading list.
class SkeletonList extends StatelessWidget {
  const SkeletonList({
    super.key,
    this.rows = 3,
    this.height = 80,
    this.padding = const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
  });

  final int rows;
  final double height;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (int i = 0; i < rows; i++) ...<Widget>[
            if (i > 0) const SizedBox(height: ResetTokens.spaceSm),
            Skeleton(height: height),
          ],
        ],
      ),
    );
  }
}

/// One service row, before it has a service.
///
/// Shaped like the real thing — text block left, square tile right — so the catalogue does
/// not jump when it lands. A stack of plain bars would settle and then reflow.
class SkeletonServiceRow extends StatelessWidget {
  const SkeletonServiceRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: ResetTokens.spaceMd),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Skeleton(width: 180, height: 20, radius: ResetTokens.radiusSm),
                SizedBox(height: ResetTokens.spaceSm),
                Skeleton(width: 110, height: 16, radius: ResetTokens.radiusSm),
                SizedBox(height: ResetTokens.spaceSm),
                Skeleton(height: 14, radius: ResetTokens.radiusSm),
                SizedBox(height: ResetTokens.spaceXs),
                Skeleton(width: 200, height: 14, radius: ResetTokens.radiusSm),
              ],
            ),
          ),
          const SizedBox(width: ResetTokens.spaceBase),
          Skeleton(
            width: 112,
            height: 112,
            radius: ResetTokens.radiusLg,
          ),
        ],
      ),
    );
  }
}

/// The catalogue mid-load: header, search, category circles, then service rows.
class SkeletonPage extends StatelessWidget {
  const SkeletonPage({super.key, this.rows = 4});

  final int rows;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.only(top: ResetTokens.spaceBase),
      children: <Widget>[
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Skeleton(width: 220, height: 28, radius: ResetTokens.radiusSm),
              SizedBox(height: ResetTokens.spaceSm),
              Skeleton(width: 280, height: 16, radius: ResetTokens.radiusSm),
              SizedBox(height: ResetTokens.spaceBase),
              Skeleton(height: 50, radius: ResetTokens.radiusMd),
            ],
          ),
        ),
        const SizedBox(height: ResetTokens.spaceBase),
        SizedBox(
          height: 100,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
            itemCount: 4,
            separatorBuilder: (_, __) => const SizedBox(width: ResetTokens.spaceMd),
            itemBuilder: (_, __) => const Column(
              children: <Widget>[
                Skeleton(width: 62, height: 62, radius: ResetTokens.radiusFull),
                SizedBox(height: ResetTokens.spaceXs),
                Skeleton(width: 60, height: 12, radius: ResetTokens.radiusSm),
              ],
            ),
          ),
        ),
        const SizedBox(height: ResetTokens.spaceLg),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: ResetTokens.gutter),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Skeleton(width: 170, height: 22, radius: ResetTokens.radiusSm),
              for (int i = 0; i < rows; i++) const SkeletonServiceRow(),
            ],
          ),
        ),
      ],
    );
  }
}

/// Soft elevated card with the token radius. The default container for everything.
class ResetCard extends StatelessWidget {
  const ResetCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(ResetTokens.spaceBase),
    this.color,
    this.borderColor,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final Color? color;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final radius = BorderRadius.circular(ResetTokens.radiusLg);

    return Material(
      color: color ?? theme.colorScheme.surface,
      elevation: 2,
      shadowColor: Colors.black.withValues(alpha: 0.1),
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: radius,
            border: Border.all(color: borderColor ?? theme.borderColor),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// A small status pill. Colour is always paired with the word — "cancelled" and "completed"
/// must be distinguishable without seeing colour at all.
class ResetBadge extends StatelessWidget {
  const ResetBadge(this.label, {super.key, this.color});

  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tone = color ?? theme.mutedColor;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: ResetTokens.spaceSm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(ResetTokens.radiusFull),
      ),
      child: Text(
        label,
        style: ResetTokens.caption.copyWith(color: tone),
      ),
    );
  }
}

/// Booking status as a badge, with the mapping in one place so a booking never reads as
/// green on one screen and grey on another.
class BookingStatusBadge extends StatelessWidget {
  const BookingStatusBadge(this.status, {super.key});

  final BookingStatus? status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final (label, color) = switch (status) {
      BookingStatus.held => ('Holding', theme.warningColor),
      BookingStatus.confirmed => ('Confirmed', theme.successColor),
      BookingStatus.checkedIn => ('Checked in', theme.colorScheme.primary),
      BookingStatus.inProgress => ('In progress', theme.colorScheme.primary),
      BookingStatus.completed => ('Completed', theme.mutedColor),
      BookingStatus.cancelled => ('Cancelled', theme.mutedColor),
      BookingStatus.noShow => ('Missed', theme.colorScheme.error),
      BookingStatus.expired => ('Expired', theme.mutedColor),
      null => ('—', theme.mutedColor),
    };

    return ResetBadge(label, color: color);
  }
}

/// Nothing here — and that is not an error. Always says what to do next.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    this.message,
    this.action,
  });

  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(ResetTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(title, style: ResetTokens.h2, textAlign: TextAlign.center),
            if (message != null) ...[
              const SizedBox(height: ResetTokens.spaceSm),
              Text(
                message!,
                style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
                textAlign: TextAlign.center,
              ),
            ],
            if (action != null) ...[
              const SizedBox(height: ResetTokens.spaceBase),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// Something failed. Retry is offered only when there is something worth retrying.
class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final retryable = error is! ResetApiException || (error as ResetApiException).isRetryable;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(ResetTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, color: theme.colorScheme.error, size: 40),
            const SizedBox(height: ResetTokens.spaceSm),
            Text(
              friendlyMessage(error),
              style: ResetTokens.body,
              textAlign: TextAlign.center,
            ),
            if (onRetry != null && retryable) ...[
              const SizedBox(height: ResetTokens.spaceBase),
              OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ],
        ),
      ),
    );
  }
}

/// Turns anything thrown into something worth showing a customer.
///
/// Never a raw error code: someone mid-checkout needs to know what to do next, not what
/// went wrong internally.
String friendlyMessage(Object error, [String fallback = 'Something went wrong.']) {
  if (error is ResetNetworkException) {
    return error.timedOut
        ? 'That took too long. Check your connection and try again.'
        : 'No connection. Check your network and try again.';
  }

  if (error is ResetApiException) {
    return switch (error.code) {
      // The server's own words first. This code covers two situations and only one of them
      // is "somebody else got there": the other is a clash with a booking the customer
      // already holds, where the server names the service and the code it overlaps. Replacing
      // that blamed a stranger for the customer's own booking and hid the thing they could
      // act on.
      ErrorCode.slotTaken || ErrorCode.slotUnavailable =>
        error.detail ??
            'That time has just been taken. Pick another and we will hold it for you.',
      ErrorCode.holdExpired =>
        'Your slot was released because checkout took too long. Choose a time again.',
      ErrorCode.customerBlocked =>
        'This account cannot book online. Please call the store.',
      ErrorCode.rewardInvalid =>
        error.detail ?? 'That reward cannot be used on this booking.',
      ErrorCode.scratchAlreadyUsed => 'That card has already been scratched.',
      ErrorCode.outOfStock => 'That has just sold out.',
      ErrorCode.rateLimited =>
        'Too many attempts. Wait a minute and try again.',
      ErrorCode.storeClosed => 'The store is closed then. Try another day.',
      ErrorCode.checkinAlreadyUsed => 'This booking has already been checked in.',
      ErrorCode.unauthenticated => 'Please sign in again.',
      _ => error.detail ?? fallback,
    };
  }

  return fallback;
}

/// A full-width primary action, sized for a thumb.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton(
        onPressed: loading ? null : onPressed,
        child: loading
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2.5),
              )
            : Text(label),
      ),
    );
  }
}
