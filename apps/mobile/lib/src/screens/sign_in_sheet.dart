import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';

/// Phone + OTP, as a bottom sheet.
///
/// A sheet rather than a route so an in-progress checkout keeps its hold and its countdown
/// while the customer signs in. Returns true when they did.
Future<bool> showSignInSheet(BuildContext context, {String? reason}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => Padding(
      // Lifts the sheet above the keyboard, which otherwise covers the code field on a
      // short phone — the single most common way an OTP screen becomes unusable.
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: _SignInSheet(reason: reason),
    ),
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
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _codeFocus = FocusNode();

  bool _codeStep = false;
  bool _busy = false;
  String? _error;
  int _resendIn = 0;
  Timer? _resendTimer;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _codeFocus.dispose();
    _resendTimer?.cancel();
    super.dispose();
  }

  void _startResendCountdown(int seconds) {
    _resendTimer?.cancel();
    setState(() => _resendIn = seconds.clamp(0, 60));
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return timer.cancel();
      setState(() => _resendIn = (_resendIn - 1).clamp(0, 60));
      if (_resendIn == 0) timer.cancel();
    });
  }

  Future<void> _requestOtp() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final expiresIn =
          await ref.read(repositoryProvider).requestOtp(toE164(_phone.text));
      if (!mounted) return;
      setState(() {
        _codeStep = true;
        _busy = false;
      });
      _startResendCountdown(expiresIn);
      _codeFocus.requestFocus();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = friendlyMessage(error, 'Could not send the code.');
      });
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await ref.read(repositoryProvider).verifyOtp(
            phone: toE164(_phone.text),
            code: _code.text.trim(),
          );
      // The session provider re-reads /auth/me, which is what every other screen watches.
      ref.invalidate(sessionProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = friendlyMessage(error, 'That code did not work.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final phoneValid = _phone.text.replaceAll(RegExp(r'\D'), '').length >= 10;

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
          Text(_codeStep ? 'Enter the code' : 'Sign in', style: ResetTokens.h1),
          if (widget.reason != null) ...[
            const SizedBox(height: ResetTokens.spaceXs),
            Text(
              widget.reason!,
              style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
            ),
          ],
          const SizedBox(height: ResetTokens.spaceLg),

          if (!_codeStep) ...[
            TextField(
              controller: _phone,
              autofocus: true,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.done,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => phoneValid ? _requestOtp() : null,
              decoration: InputDecoration(
                labelText: 'Mobile number',
                prefixText: '+91 ',
                errorText: _error,
                helperText: 'We will text you a code.',
              ),
            ),
            const SizedBox(height: ResetTokens.spaceBase),
            PrimaryButton(
              label: 'Send code',
              loading: _busy,
              onPressed: phoneValid ? _requestOtp : null,
            ),
          ] else ...[
            TextField(
              controller: _code,
              focusNode: _codeFocus,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.done,
              // Lets Android offer the code straight from the SMS.
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(8),
              ],
              style: ResetTokens.mono.copyWith(fontSize: 22, letterSpacing: 8),
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _code.text.length >= 4 ? _verify() : null,
              decoration: InputDecoration(
                labelText: 'Code',
                errorText: _error,
                helperText: 'Sent to +91 ${_phone.text}',
              ),
            ),
            const SizedBox(height: ResetTokens.spaceBase),
            PrimaryButton(
              label: 'Verify and continue',
              loading: _busy,
              onPressed: _code.text.trim().length >= 4 ? _verify : null,
            ),
            const SizedBox(height: ResetTokens.spaceSm),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                TextButton(
                  onPressed: () => setState(() {
                    _codeStep = false;
                    _code.clear();
                    _error = null;
                  }),
                  child: const Text('Change number'),
                ),
                TextButton(
                  onPressed: _resendIn > 0 || _busy ? null : _requestOtp,
                  child: Text(
                    _resendIn > 0 ? 'Resend in ${_resendIn}s' : 'Resend code',
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
