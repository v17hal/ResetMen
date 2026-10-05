import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../theme/app_theme.dart';
import '../theme/reset_tokens.dart';

const _dayNames = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/// The shop's details at the foot of the home screen — the same card the website shows.
///
/// Client request 05/10/2026: every line of it editable from the admin panel. Name, the
/// line under it, the address, whether the phone number appears and what the "Questions"
/// line says all come from Admin → Shop details; the hours from Capacity → Opening hours.
/// Nothing here is written into the app, so a change in the admin panel reaches every phone
/// without an update.
class ShopDetailsCard extends StatelessWidget {
  const ShopDetailsCard({super.key, required this.store, required this.onAsk});

  final StoreInfo store;

  /// Opens Help. The "Questions" line leads there whether or not the number is shown.
  final VoidCallback onAsk;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final city = store.city?.trim();
    final address = store.address?.trim();
    final phone = store.phone?.trim();
    final note = store.contactNote?.trim();
    final open = store.hours.where((h) => !h.isClosed).toList(growable: false);
    final closed = store.hours.where((h) => h.isClosed).toList(growable: false);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(ResetTokens.gutter),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(top: BorderSide(color: theme.borderColor)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            city == null || city.isEmpty ? store.name : '${store.name} $city',
            style: ResetTokens.h2,
          ),
          const SizedBox(height: ResetTokens.spaceXs),
          Text(
            store.displayTagline,
            style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
          ),
          if (address != null && address.isNotEmpty) ...[
            const SizedBox(height: ResetTokens.spaceBase),
            _Label('Where', theme: theme),
            Text(address, style: ResetTokens.bodySm),
            if (city != null && city.isNotEmpty) Text(city, style: ResetTokens.bodySm),
          ],
          const SizedBox(height: ResetTokens.spaceBase),
          _Label('Questions', theme: theme),
          if (store.showPhone && phone != null && phone.isNotEmpty)
            _Link(
              'Call $phone',
              onTap: () => unawaited(launchUrl(
                Uri(scheme: 'tel', path: phone.replaceAll(' ', '')),
                mode: LaunchMode.externalApplication,
              )),
            ),
          _Link(
            note == null || note.isEmpty ? 'Ask us — we reply in writing' : note,
            onTap: onAsk,
          ),
          if (open.isNotEmpty) ...[
            const SizedBox(height: ResetTokens.spaceBase),
            _Label('Open', theme: theme),
            Text(
              '${open.first.opensAt} – ${open.first.closesAt}',
              style: ResetTokens.bodySm,
            ),
            if (closed.isNotEmpty)
              Text(
                // "Closed on Mondays" — a standing weekly closure, not one shut Monday.
                'Closed on ${closed.map((h) => '${_dayNames[h.dayOfWeek % 7]}s').join(', ')}',
                style: ResetTokens.bodySm.copyWith(color: theme.mutedColor),
              ),
          ],
        ],
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text, {required this.theme});

  final String text;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 2),
        child: Text(
          text.toUpperCase(),
          style: ResetTokens.caption.copyWith(
            color: theme.mutedColor,
            letterSpacing: 0.8,
          ),
        ),
      );
}

/// Underlined and tappable, with a target tall enough for a thumb.
class _Link extends StatelessWidget {
  const _Link(this.text, {required this.onTap});

  final String text;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: ResetTokens.spaceXs),
          child: Text(
            text,
            style: ResetTokens.bodySm.copyWith(decoration: TextDecoration.underline),
          ),
        ),
      );
}
