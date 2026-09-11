import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';

/// One question and its answers, as a chat.
///
/// Polls every twenty seconds while it is actually on screen. Answers come from a person at
/// a desk, not a bot, so a slower poll would do — but somebody who has just asked tends to
/// sit and watch, and a reply that turns up only after they give up and leave looks like no
/// reply at all. It stops while the screen is covered, while another tab is showing, and
/// while the app is in the background: nobody is watching then, and the push notification
/// covers the gap.
class HelpThreadScreen extends ConsumerStatefulWidget {
  const HelpThreadScreen({super.key, required this.threadId, this.initial});

  final String threadId;

  /// The conversation as a write has just returned it, so a question sent a moment ago
  /// opens straight onto its message rather than onto a skeleton.
  final SupportThread? initial;

  static const pollInterval = Duration(seconds: 20);

  @override
  ConsumerState<HelpThreadScreen> createState() => _HelpThreadScreenState();
}

class _HelpThreadScreenState extends ConsumerState<HelpThreadScreen> {
  final TextEditingController _composer = TextEditingController();
  final ScrollController _scroll = ScrollController();
  Timer? _poll;

  /// What the last write returned, shown until the next read lands — a round trip sooner
  /// than waiting for the refetch, which is the difference between a message appearing
  /// as it is sent and appearing a beat later.
  SupportThread? _written;
  bool _sending = false;
  String? _sendError;

  /// Messages already on screen, so only a genuinely new one scrolls the view.
  int _shown = 0;
  bool _listRefreshed = false;

  @override
  void initState() {
    super.initState();

    final initial = widget.initial;
    if (initial != null) {
      _written = initial;
      _followNew(initial);
    }

    ref.listenManual<AsyncValue<SupportThread>>(
      supportThreadProvider(widget.threadId),
      (_, next) {
        if (next.isLoading || !next.hasValue) return;
        final thread = next.requireValue;
        // A fresh read supersedes whatever the last write returned.
        if (_written != null) setState(() => _written = null);
        _followNew(thread);

        // The read cleared this conversation's dot on the server. The list and the dots on
        // Home and You should agree — after the frame, because this can run while the tree
        // is still being built, where invalidating another provider is not allowed.
        if (!_listRefreshed) {
          _listRefreshed = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) ref.invalidate(supportThreadsProvider);
          });
        }
      },
      fireImmediately: true,
    );

    _poll = Timer.periodic(HelpThreadScreen.pollInterval, (_) => _refreshIfWatched());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _refreshIfWatched() {
    if (!mounted || _sending) return;

    final lifecycle = WidgetsBinding.instance.lifecycleState;
    final backgrounded = lifecycle != null && lifecycle != AppLifecycleState.resumed;

    // Covered by another route, or on a tab that is not selected — the shell's IndexedStack
    // keeps those alive and marks them invisible rather than unmounting them.
    final covered =
        !(ModalRoute.of(context)?.isCurrent ?? true) || !Visibility.of(context);

    if (backgrounded || covered) return;
    ref.invalidate(supportThreadProvider(widget.threadId));
  }

  /// Keeps the newest message in view when one arrives — and only then, so a poll that
  /// brings nothing new does not drag someone back down while they are reading up.
  void _followNew(SupportThread thread) {
    if (thread.messages.length == _shown) return;
    final first = _shown == 0;
    _shown = thread.messages.length;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      final end = _scroll.position.maxScrollExtent;
      if (first || MediaQuery.disableAnimationsOf(context)) {
        _scroll.jumpTo(end);
      } else {
        _scroll.animateTo(
          end,
          duration: ResetTokens.durationBase,
          curve: ResetTokens.easingStandard,
        );
      }
    });
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    if (text.isEmpty || _sending) return;

    setState(() {
      _sending = true;
      _sendError = null;
    });

    try {
      final updated =
          await ref.read(repositoryProvider).replyToSupportThread(widget.threadId, text);
      if (!mounted) return;

      _composer.clear();
      setState(() {
        _written = updated;
        _sending = false;
      });
      _followNew(updated);

      ref.invalidate(supportThreadProvider(widget.threadId));
      ref.invalidate(supportThreadsProvider);
    } catch (error) {
      if (!mounted) return;
      // The words stay in the box. Retyping a long message because a tunnel ate the
      // request is how people give up on writing in at all.
      setState(() {
        _sending = false;
        _sendError = friendlyMessage(error, 'Not sent. Try again.');
      });
    }
  }

  Future<void> _close() async {
    try {
      final updated =
          await ref.read(repositoryProvider).closeSupportThread(widget.threadId);
      if (!mounted) return;

      setState(() => _written = updated);
      ref.invalidate(supportThreadProvider(widget.threadId));
      ref.invalidate(supportThreadsProvider);
      showMessage(context, 'Marked as solved. Write again any time to reopen it.');
    } catch (error) {
      if (mounted) showMessage(context, friendlyMessage(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final async = ref.watch(supportThreadProvider(widget.threadId));
    final thread = _written ?? async.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: thread == null
            ? const Text('Help')
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    thread.subject,
                    style: ResetTokens.h2,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    formatBookingCode(thread.publicId),
                    style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                  ),
                ],
              ),
        actions: [
          if (thread != null && !thread.isClosed)
            PopupMenuButton<void>(
              tooltip: 'More',
              itemBuilder: (_) => [
                PopupMenuItem<void>(
                  onTap: () => unawaited(_close()),
                  child: const Text('Mark as solved'),
                ),
              ],
            ),
        ],
      ),
      body: thread == null
          ? (async.hasError && !async.isLoading
              ? ErrorView(
                  error: async.error!,
                  onRetry: () => ref.invalidate(supportThreadProvider(widget.threadId)),
                )
              : const SkeletonList(
                  rows: 3,
                  height: 72,
                  padding: EdgeInsets.all(ResetTokens.gutter),
                ))
          : Column(
              children: [
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () async =>
                        ref.invalidate(supportThreadProvider(widget.threadId)),
                    child: ListView(
                      controller: _scroll,
                      // A two-message conversation is shorter than the screen, and pull to
                      // refresh has to work on it all the same.
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(ResetTokens.gutter),
                      children: [
                        if (thread.booking != null) ...[
                          _BookingNote(booking: thread.booking!),
                          const SizedBox(height: ResetTokens.spaceBase),
                        ],
                        for (final message in thread.messages) _Bubble(message: message),
                      ],
                    ),
                  ),
                ),
                _composerBar(theme, thread),
              ],
            ),
    );
  }

  Widget _composerBar(ThemeData theme, SupportThread thread) {
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(top: BorderSide(color: theme.borderColor)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            ResetTokens.gutter,
            ResetTokens.spaceSm,
            ResetTokens.spaceSm,
            ResetTokens.spaceSm,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Said where they are about to type, not at the top of a long conversation.
              if (thread.isClosed)
                Padding(
                  padding: const EdgeInsets.only(bottom: ResetTokens.spaceSm),
                  child: Text(
                    'This question is closed. Writing again will reopen it.',
                    style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                  ),
                ),
              if (_sendError != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: ResetTokens.spaceXs),
                  child: Text(
                    _sendError!,
                    style: ResetTokens.caption.copyWith(color: theme.colorScheme.error),
                  ),
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _composer,
                      minLines: 1,
                      maxLines: 5,
                      keyboardType: TextInputType.multiline,
                      textCapitalization: TextCapitalization.sentences,
                      // The API's limit, enforced as they type rather than as a refusal
                      // after they press send.
                      inputFormatters: [LengthLimitingTextInputFormatter(2000)],
                      decoration: const InputDecoration(hintText: 'Write a message'),
                    ),
                  ),
                  const SizedBox(width: ResetTokens.spaceXs),
                  ValueListenableBuilder<TextEditingValue>(
                    valueListenable: _composer,
                    builder: (context, value, _) => IconButton.filled(
                      tooltip: 'Send',
                      onPressed:
                          value.text.trim().isEmpty || _sending ? null : _send,
                      icon: _sending
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "About RST-2K8F4M · Tension Relief · Sat 13 Sep" — the booking the question is about.
class _BookingNote extends StatelessWidget {
  const _BookingNote({required this.booking});

  final SupportBookingRef booking;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ResetCard(
      color: theme.surface2Color,
      padding: const EdgeInsets.symmetric(
        horizontal: ResetTokens.spaceMd,
        vertical: ResetTokens.spaceSm,
      ),
      child: Row(
        children: [
          Icon(Icons.event_note_outlined, size: 18, color: theme.mutedColor),
          const SizedBox(width: ResetTokens.spaceSm),
          Expanded(
            child: Text(
              'About ${formatBookingCode(booking.publicId)} · ${booking.serviceName} · '
              '${formatDate(booking.startsAt)}',
              style: ResetTokens.bodySm,
            ),
          ),
        ],
      ),
    );
  }
}

/// One message.
///
/// The customer's own on the right in the brand tint; the store's on the left on a card,
/// signed "RESET team". Never a staff name — the API does not send one, deliberately, and
/// the customer is talking to the shop rather than to whoever was on the desk.
class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final SupportMessage message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final mine = !message.fromStore;
    const round = Radius.circular(ResetTokens.radiusLg);
    const tail = Radius.circular(ResetTokens.spaceXs);

    final day = formatRelativeDay(message.createdAt);
    final time = formatTime(message.createdAt);
    final stamp = day == 'Today' ? time : '$day, $time';

    return Padding(
      padding: const EdgeInsets.only(bottom: ResetTokens.spaceMd),
      child: Align(
        alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
          // Read as one unit — who, what, when — rather than three stops.
          child: MergeSemantics(
            child: Column(
              crossAxisAlignment:
                  mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                if (!mine)
                  Padding(
                    padding: const EdgeInsets.only(left: ResetTokens.spaceXs, bottom: 2),
                    child: Text(
                      'RESET team',
                      style: ResetTokens.caption.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: ResetTokens.spaceMd,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: mine
                        ? theme.colorScheme.primary.withValues(alpha: 0.12)
                        : theme.colorScheme.surface,
                    border: Border.all(
                      color: mine
                          ? theme.colorScheme.primary.withValues(alpha: 0.25)
                          : theme.borderColor,
                    ),
                    borderRadius: BorderRadius.only(
                      topLeft: round,
                      topRight: round,
                      bottomLeft: mine ? round : tail,
                      bottomRight: mine ? tail : round,
                    ),
                  ),
                  child: Text(message.body, style: ResetTokens.body),
                ),
                const SizedBox(height: 2),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: ResetTokens.spaceXs),
                  child: Text(
                    stamp,
                    style: ResetTokens.caption.copyWith(
                      color: theme.mutedColor,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
