import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers.dart';
import '../services/google_sign_in_service.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';

/// Sign in with Google, as a bottom sheet.
///
/// A sheet rather than a route so an in-progress checkout keeps its place — on the payment
/// screen a hold may be counting down, and pushing a full-screen route to sign in would
/// make it look like the booking was lost.
///
/// Returns true when the customer signed in.
Future<bool> showSignInSheet(BuildContext context, {String? reason}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => _SignInSheet(reason: reason),
  );
  return result ?? false;
}

class _SignInSheet extends ConsumerStatefulWidget {
  const _SignInSheet({this.reason});

  final String? reason;

  @override
  ConsumerState<_SignInSheet> createState() => _SignInSheetState();
}

class _SignInSheetState extends ConsumerState<_SignInSheet> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final idToken = await ref.read(googleSignInProvider).signIn();
      await ref.read(repositoryProvider).signInWithFirebase(idToken: idToken);

      // Everything else in the app watches this.
      ref.invalidate(sessionProvider);

      if (mounted) Navigator.of(context).pop(true);
    } on SignInCancelled {
      // Backing out is a decision, not a failure. Close quietly.
      if (mounted) setState(() => _busy = false);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = friendlyMessage(error, 'Could not sign in. Please try again.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        ResetTokens.gutter,
        0,
        ResetTokens.gutter,
        ResetTokens.spaceXl,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Sign in', style: ResetTokens.h1),
          if (widget.reason != null) ...[
            const SizedBox(height: ResetTokens.spaceXs),
            Text(
              widget.reason!,
              style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
            ),
          ],
          const SizedBox(height: ResetTokens.spaceLg),

          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _busy ? null : _signIn,
              icon: _busy
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    )
                  : const _GoogleMark(),
              label: const Text('Continue with Google'),
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
          Text(
            'We only use your name and email to hold your booking. You can delete your '
            'account at any time from the You tab.',
            style: ResetTokens.caption.copyWith(color: theme.mutedColor),
          ),
        ],
      ),
    );
  }
}

/// Google's mark at its brand colours — recolouring it breaks their branding guidelines.
class _GoogleMark extends StatelessWidget {
  const _GoogleMark();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 18,
      height: 18,
      child: CustomPaint(painter: _GooglePainter()),
    );
  }
}

class _GooglePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 18;
    final paint = Paint()..style = PaintingStyle.fill;

    void path(String _, Color color, List<Offset> points) {
      paint.color = color;
      final p = Path()..addPolygon(points.map((o) => o * s).toList(), true);
      canvas.drawPath(p, paint);
    }

    // A simplified four-quadrant mark: the real logo is a licensed asset, and an
    // approximation drawn in code is the honest compromise for a button glyph.
    path('blue', const Color(0xFF4285F4), const [
      Offset(9, 7.36), Offset(17.64, 7.36), Offset(17.64, 10.84), Offset(9, 10.84),
    ]);
    path('green', const Color(0xFF34A853), const [
      Offset(3, 13.5), Offset(15, 13.5), Offset(15, 18), Offset(3, 18),
    ]);
    path('yellow', const Color(0xFFFBBC05), const [
      Offset(0, 5), Offset(4, 5), Offset(4, 13), Offset(0, 13),
    ]);
    path('red', const Color(0xFFEA4335), const [
      Offset(3, 0), Offset(15, 0), Offset(15, 4.5), Offset(3, 4.5),
    ]);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
