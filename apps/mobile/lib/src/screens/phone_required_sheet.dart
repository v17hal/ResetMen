import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';

/// Asks for the mobile number a booking cannot be made without.
///
/// The store has no gateway: a booking is confirmed unpaid and somebody rings the customer
/// to settle it. So the API refuses a booking from an account with no number, with a 422
/// naming the field. Until now the app showed that sentence and stopped — the customer was
/// told what was wrong and given nothing to do about it, on the screen where they were
/// trying to book.
///
/// Returns true when a number was saved and the booking should be retried. Deliberately not
/// dismissible by tapping away: this is the one thing standing between the customer and
/// their booking, and losing the sheet by mistake looks like the app refusing to work.
Future<bool> showPhoneRequiredSheet(BuildContext context, {String? reason}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    useSafeArea: true,
    builder: (_) => _PhoneRequiredSheet(reason: reason),
  );
  return saved ?? false;
}

class _PhoneRequiredSheet extends ConsumerStatefulWidget {
  const _PhoneRequiredSheet({this.reason});

  final String? reason;

  @override
  ConsumerState<_PhoneRequiredSheet> createState() => _PhoneRequiredSheetState();
}

class _PhoneRequiredSheetState extends ConsumerState<_PhoneRequiredSheet> {
  final TextEditingController _phone = TextEditingController();
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final digits = _phone.text.replaceAll(RegExp(r'\D'), '');

    // The same rule the account screen applies and the server enforces. Checked here so a
    // typo costs a keystroke rather than a round trip.
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(digits)) {
      setState(() => _error = 'Enter a 10-digit Indian mobile number.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      await ref.read(repositoryProvider).updateProfile(phone: toE164(digits));
      ref.invalidate(sessionProvider);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = friendlyMessage(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      // Above the keyboard, which otherwise covers the field it is there to fill.
      padding: EdgeInsets.only(
        left: ResetTokens.gutter,
        right: ResetTokens.gutter,
        top: ResetTokens.gutter,
        bottom: MediaQuery.of(context).viewInsets.bottom + ResetTokens.gutter,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Your mobile number', style: ResetTokens.h2),
          const SizedBox(height: ResetTokens.spaceXs),
          Text(
            widget.reason ??
                'The store rings this number to confirm your booking and take payment. '
                    'It is not shared with anyone else.',
            style: ResetTokens.caption.copyWith(color: theme.mutedColor),
          ),
          const SizedBox(height: ResetTokens.spaceBase),

          TextField(
            controller: _phone,
            autofocus: true,
            keyboardType: TextInputType.phone,
            // Ten digits and nothing else. A paste carrying "+91 " or spaces is stripped
            // rather than rejected — the customer did not type the mistake.
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(10),
            ],
            decoration: InputDecoration(
              labelText: 'Mobile number',
              prefixText: '+91 ',
              errorText: _error,
              helperText: 'Ten digits, starting 6 to 9.',
            ),
            onSubmitted: (_) => _saving ? null : _save(),
          ),

          const SizedBox(height: ResetTokens.spaceBase),
          PrimaryButton(
            label: 'Save and continue',
            loading: _saving,
            onPressed: _save,
          ),
          const SizedBox(height: ResetTokens.spaceXs),
          TextButton(
            onPressed: _saving ? null : () => Navigator.of(context).pop(false),
            child: const Text('Not now'),
          ),
        ],
      ),
    );
  }
}
