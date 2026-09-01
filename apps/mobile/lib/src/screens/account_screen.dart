import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/reset_enums.dart';
import '../format.dart';
import '../providers.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';
import '../widgets/common.dart';
import 'sign_in_sheet.dart';

class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});

  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  DateTime? _dob;
  Gender _gender = Gender.undisclosed;
  bool _saving = false;
  bool _seeded = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final phone = _phone.text.trim();
      final digits = phone.replaceAll(RegExp(r'\D'), '');
      final existing = ref.read(sessionProvider).valueOrNull?.phone ?? '';

      // A cleared number used to be dropped from the request so that "I didn't want to give
      // my number" was not a validation error. A booking cannot be made without one now, so
      // dropping it meant the field emptied, the server kept the old value, and the screen
      // said Saved — while the number was still there and bookings still worked.
      if (digits.isEmpty && existing.isNotEmpty) {
        throw const FormatException(
          'A mobile number is needed to book. Replace it rather than clearing it.',
        );
      }

      // Ten digits starting 6-9 is every Indian mobile. Checked here so a typo costs a
      // keystroke rather than a round trip, and rejected the same way by the server.
      if (digits.isNotEmpty &&
          !RegExp(r'^[6-9]\d{9}$').hasMatch(
            digits.substring(digits.length > 10 ? digits.length - 10 : 0),
          )) {
        throw const FormatException('Enter a 10-digit Indian mobile number.');
      }

      await ref.read(repositoryProvider).updateProfile(
            name: _name.text.trim().isEmpty ? null : _name.text.trim(),
            email: _email.text.trim().isEmpty ? null : _email.text.trim(),
            gender: _gender.wire,
            phone: digits.isEmpty ? null : toE164(phone),
            dateOfBirth: _dob == null ? null : formatIsoDate(_dob!),
          );
      ref.invalidate(sessionProvider);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Saved.')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyMessage(error))));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _signOut() async {
    final repository = ref.read(repositoryProvider);
    await repository.signOut();
    // Also clear Google and Firebase. Leaving them signed in means the next "Sign in"
    // reuses the same account with no picker, which looks broken to anyone switching.
    await ref.read(googleSignInProvider).signOut();
    // The cached QR belongs to the person who just left. Leaving it on the device would
    // show the next user someone else's booking.
    await ref.read(bookingCacheProvider).clear();
    ref.invalidate(sessionProvider);
    _seeded = false;
  }

  Future<void> _deleteAccount() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text(
          'This cannot be undone. Cancel any upcoming bookings first so the store knows '
          'not to expect you.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep my account'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await ref.read(repositoryProvider).deleteAccount();
      await _signOut();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Your account will be deleted.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(friendlyMessage(error))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final session = ref.watch(sessionProvider);
    final user = session.valueOrNull;

    // Seed the fields once, not on every rebuild — otherwise typing is overwritten the
    // moment any provider this screen watches emits.
    if (user != null && !_seeded) {
      _name.text = user.name ?? '';
      _email.text = user.email ?? '';
      _phone.text = user.phone ?? '';
      _dob = user.dateOfBirth == null ? null : DateTime.tryParse(user.dateOfBirth!);
      _gender = user.gender ?? Gender.undisclosed;
      _seeded = true;
    }

    if (user == null && !session.isLoading) {
      return Scaffold(
        appBar: AppBar(title: const Text('You')),
        body: EmptyState(
          title: 'Sign in',
          message: 'Your mobile number is all you need. No password to remember.',
          action: FilledButton(
            onPressed: () => showSignInSheet(context),
            child: const Text('Sign in'),
          ),
        ),
      );
    }

    if (user == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('You')),
        body: const SkeletonList(
          rows: 4,
          padding: EdgeInsets.fromLTRB(
            ResetTokens.gutter,
            ResetTokens.spaceLg,
            ResetTokens.gutter,
            0,
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text(user.name ?? 'Your account')),
      body: ListView(
        padding: const EdgeInsets.all(ResetTokens.gutter),
        children: [
          // Identity line: the phone number when they have given one, otherwise the Google
          // address they signed in with.
          Text(
            user.phone != null
                ? formatPhone(user.phone!)
                : (user.email ?? 'Signed in'),
            style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
          ),
          const SizedBox(height: ResetTokens.spaceLg),

          ResetCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Details', style: ResetTokens.h2),
                const SizedBox(height: ResetTokens.spaceBase),

                TextField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Name',
                    helperText: 'What we call you at the counter.',
                  ),
                ),
                const SizedBox(height: ResetTokens.spaceBase),

                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(
                    labelText: 'Email',
                    helperText: 'From your Google account.',
                  ),
                ),
                const SizedBox(height: ResetTokens.spaceBase),

                // Asked for, never required. Google sign-in gives no phone number, and the
                // counter needs one for two things: linking a walk-in to an existing
                // customer, and ringing someone who is running late.
                TextField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'Mobile number',
                    prefixText: '+91 ',
                    helperText: 'Optional — lets the store reach you about your booking.',
                  ),
                ),
                const SizedBox(height: ResetTokens.spaceBase),

                // A date picker rather than a text field: typing a birthday invites every
                // ambiguity between DD/MM and MM/DD, and the picker cannot produce one.
                InkWell(
                  onTap: () async {
                    final now = DateTime.now();
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _dob ?? DateTime(now.year - 25),
                      firstDate: DateTime(now.year - 100),
                      // No future birthdays, and nobody under 13 — the age below which
                      // consent is a parent's to give under the DPDP Act.
                      lastDate: DateTime(now.year - 13, now.month, now.day),
                      helpText: 'Date of birth',
                    );
                    if (picked != null) setState(() => _dob = picked);
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Date of birth',
                      helperText: 'Optional — the store sends a birthday treat.',
                    ),
                    child: Text(
                      _dob == null ? 'Not set' : formatDate(_dob!),
                      style: _dob == null
                          ? ResetTokens.body.copyWith(color: theme.mutedColor)
                          : ResetTokens.body,
                    ),
                  ),
                ),
                const SizedBox(height: ResetTokens.spaceBase),

                DropdownButtonFormField<Gender>(
                  initialValue: _gender,
                  decoration: const InputDecoration(labelText: 'Gender'),
                  items: const [
                    DropdownMenuItem(
                      value: Gender.undisclosed,
                      child: Text('Prefer not to say'),
                    ),
                    DropdownMenuItem(value: Gender.male, child: Text('Male')),
                    DropdownMenuItem(value: Gender.female, child: Text('Female')),
                    DropdownMenuItem(value: Gender.other, child: Text('Other')),
                  ],
                  onChanged: (value) =>
                      setState(() => _gender = value ?? Gender.undisclosed),
                ),
                const SizedBox(height: ResetTokens.spaceBase),

                PrimaryButton(label: 'Save', loading: _saving, onPressed: _save),
              ],
            ),
          ),

          const SizedBox(height: ResetTokens.spaceBase),

          ResetCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Account', style: ResetTokens.h2),
                const SizedBox(height: ResetTokens.spaceSm),

                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: _signOut,
                    child: const Text('Sign out'),
                  ),
                ),
                const SizedBox(height: ResetTokens.spaceSm),

                SizedBox(
                  width: double.infinity,
                  child: TextButton(
                    onPressed: _deleteAccount,
                    child: Text(
                      'Delete my account',
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ),
                ),

                // Required by Play Store policy and the DPDP Act. Says plainly what
                // survives: bookings are financial records, kept without the person.
                Text(
                  'Deleting removes your name, number and contact details after a short '
                  'grace period. Records of past payments are kept for tax purposes, '
                  'without you attached to them.',
                  style: ResetTokens.caption.copyWith(color: theme.mutedColor),
                ),
              ],
            ),
          ),

          const SizedBox(height: ResetTokens.spaceXl),
          Center(
            child: Text(
              'RESET · v1.0.0',
              style: ResetTokens.caption.copyWith(color: theme.mutedColor),
            ),
          ),
        ],
      ),
    );
  }
}
