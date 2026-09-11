import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'help_thread_screen.dart';
import 'sign_in_sheet.dart';

/// Questions to the store — client request of 11/09/2026.
///
/// This is what replaced the phone number. A phone that rings mid-session is a phone nobody
/// answers, and a customer who cannot get through assumes the shop is shut. A written
/// question waits until somebody on the desk is free, and the answer comes back in the app
/// with a notification.
///
/// Signed-in only, because the API is: an answer has to be able to reach someone.
class HelpScreen extends ConsumerWidget {
  const HelpScreen({super.key});

  Future<void> _ask(BuildContext context, WidgetRef ref) async {
    final thread = await showAskSheet(context);
    if (thread == null || !context.mounted) return;
    await _open(context, ref, thread.id, initial: thread);
  }

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    String threadId, {
    SupportThread? initial,
  }) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HelpThreadScreen(threadId: threadId, initial: initial),
      ),
    );
    // Reading a conversation clears its dot on the server, and writing in it changes its
    // status — the list should say so when they come back to it.
    if (context.mounted) ref.invalidate(supportThreadsProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);

    if (session.valueOrNull == null && !session.isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('Help')),
        body: EmptyState(
          title: 'Sign in to ask us',
          message: 'Questions about a booking, a treatment or the shop? Sign in and write '
              'to us here — we reply in the app.',
          action: FilledButton(
            onPressed: () =>
                showSignInSheet(context, reason: 'So our reply comes back to you.'),
            child: const Text('Sign in'),
          ),
        ),
      );
    }

    final threads = ref.watch(supportThreadsProvider);

    final ask = FilledButton.icon(
      onPressed: () => _ask(context, ref),
      icon: const Icon(Icons.edit_outlined),
      label: const Text('Ask a question'),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Help')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(supportThreadsProvider),
        // Not `.when`, for the reason Home gives: a failed refresh keeps the list that is
        // already on screen rather than replacing it with an error.
        child: switch (threads) {
          AsyncValue(valueOrNull: final list?) when list.isEmpty => ListView(
              children: [
                SizedBox(height: MediaQuery.sizeOf(context).height * 0.15),
                EmptyState(
                  title: 'Ask us anything',
                  message: 'Questions about a booking, a treatment or the shop? Write to '
                      'us here and we will reply in the app.',
                  action: ask,
                ),
              ],
            ),
          AsyncValue(valueOrNull: final list?) => ListView(
              padding: const EdgeInsets.all(ResetTokens.gutter),
              children: [
                SizedBox(width: double.infinity, child: ask),
                const SizedBox(height: ResetTokens.spaceBase),
                for (final (index, thread) in list.indexed) ...[
                  if (index > 0) const SizedBox(height: ResetTokens.spaceSm),
                  StaggeredEntry(
                    index: index,
                    child: _ThreadTile(
                      thread: thread,
                      onTap: () => _open(context, ref, thread.id),
                    ),
                  ),
                ],
              ],
            ),
          AsyncValue(hasError: true, :final error?) => ListView(
              children: [
                SizedBox(height: MediaQuery.sizeOf(context).height * 0.25),
                ErrorView(
                  error: error,
                  onRetry: () => ref.invalidate(supportThreadsProvider),
                ),
              ],
            ),
          _ => ListView(
              padding: const EdgeInsets.only(top: ResetTokens.spaceBase),
              children: const [SkeletonList(rows: 4, height: 96)],
            ),
        },
      ),
    );
  }
}

class _ThreadTile extends StatelessWidget {
  const _ThreadTile({required this.thread, required this.onTap});

  final SupportThreadSummary thread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ResetCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (thread.unread) ...[
                Semantics(
                  label: 'New reply',
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
                const SizedBox(width: ResetTokens.spaceSm),
              ],
              Expanded(
                child: Text(
                  thread.subject,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: ResetTokens.body.copyWith(
                    fontWeight: thread.unread ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: ResetTokens.spaceSm),
              Text(
                formatMessageTime(thread.lastMessageAt),
                style: ResetTokens.caption.copyWith(
                  color: thread.unread ? theme.colorScheme.primary : theme.mutedColor,
                ),
              ),
            ],
          ),
          if (thread.preview.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              thread.preview,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
            ),
          ],
          const SizedBox(height: ResetTokens.spaceSm),
          _StatusBadge(thread: thread),
        ],
      ),
    );
  }
}

/// Says whose turn it is — which is the only thing anyone scanning this list wants to know.
///
/// "Waiting for reply" takes the same colour as a booking awaiting confirmation: both mean
/// "with the shop, nothing for you to do yet".
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.thread});

  final SupportThreadSummary thread;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final (label, color) = thread.isClosed
        ? ('Closed', theme.mutedColor)
        : thread.hasReply
            ? ('Replied', theme.colorScheme.primary)
            : ('Waiting for reply', theme.warningColor);

    return ResetBadge(label, color: color);
  }
}

/// "Ask a question", as a sheet over the list.
///
/// A sheet rather than a page so the list the customer came from stays where it was.
/// Returns the new conversation for the caller to open, or null if they backed out.
Future<SupportThread?> showAskSheet(BuildContext context) =>
    showModalBottomSheet<SupportThread>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (_) => const _AskSheet(),
    );

class _AskSheet extends ConsumerStatefulWidget {
  const _AskSheet();

  @override
  ConsumerState<_AskSheet> createState() => _AskSheetState();
}

class _AskSheetState extends ConsumerState<_AskSheet> {
  final TextEditingController _subject = TextEditingController();
  final TextEditingController _body = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Send follows the fields as they are typed, not only when one loses focus.
    _subject.addListener(_changed);
    _body.addListener(_changed);
  }

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  void _changed() => setState(() {});

  bool get _ready =>
      _subject.text.trim().isNotEmpty && _body.text.trim().isNotEmpty;

  Future<void> _send() async {
    setState(() {
      _sending = true;
      _error = null;
    });

    try {
      final thread = await ref.read(repositoryProvider).createSupportThread(
            subject: _subject.text.trim(),
            body: _body.text.trim(),
          );
      ref.invalidate(supportThreadsProvider);
      if (mounted) Navigator.of(context).pop(thread);
    } catch (error) {
      if (!mounted) return;
      // The server's own sentence — "give it a short subject", "you already have five open
      // questions" — is written for the customer and says what to do about it. Shown in
      // the sheet, under what they typed, rather than in a snackbar behind it.
      setState(() {
        _sending = false;
        _error = friendlyMessage(error, 'Not sent. Try again.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SingleChildScrollView(
      // Above the keyboard, which otherwise covers the field being typed in.
      padding: EdgeInsets.only(
        left: ResetTokens.gutter,
        right: ResetTokens.gutter,
        bottom: MediaQuery.of(context).viewInsets.bottom + ResetTokens.gutter,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Ask a question', style: ResetTokens.h2),
          const SizedBox(height: ResetTokens.spaceXs),
          Text(
            'We reply here in the app.',
            style: ResetTokens.caption.copyWith(color: theme.mutedColor),
          ),
          const SizedBox(height: ResetTokens.spaceBase),

          TextField(
            controller: _subject,
            autofocus: true,
            maxLength: 120,
            textCapitalization: TextCapitalization.sentences,
            textInputAction: TextInputAction.next,
            decoration: const InputDecoration(
              labelText: 'Subject',
              hintText: 'e.g. Moving my Saturday booking',
            ),
          ),
          const SizedBox(height: ResetTokens.spaceSm),

          TextField(
            controller: _body,
            minLines: 4,
            maxLines: 8,
            maxLength: 2000,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Message',
              alignLabelWithHint: true,
            ),
          ),

          if (_error != null) ...[
            const SizedBox(height: ResetTokens.spaceSm),
            Text(
              _error!,
              style: ResetTokens.bodySm.copyWith(color: theme.colorScheme.error),
            ),
          ],

          const SizedBox(height: ResetTokens.spaceBase),
          PrimaryButton(
            label: 'Send',
            loading: _sending,
            onPressed: _ready ? _send : null,
          ),
        ],
      ),
    );
  }
}
