import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Push notifications.
///
/// Three of the four templates are time-critical — the T-60 and T-10 reminders and the
/// booking confirmation — so this is the difference between a customer arriving and a
/// station sitting empty.
///
/// Every failure path here is swallowed deliberately. Push is additive: a customer who
/// denies the permission, or whose device cannot reach FCM, must still be able to book.
class PushService {
  PushService({FirebaseMessaging? messaging, FlutterLocalNotificationsPlugin? local})
      : _messaging = messaging ?? FirebaseMessaging.instance,
        _local = local ?? FlutterLocalNotificationsPlugin();

  final FirebaseMessaging _messaging;
  final FlutterLocalNotificationsPlugin _local;

  /// Android 13+ posts nothing without this channel existing first.
  static const _channel = AndroidNotificationChannel(
    'reset_bookings',
    'Bookings and reminders',
    description: 'Confirmations, reminders before your slot, and rewards.',
    importance: Importance.high,
  );

  /// Called after sign-in. Returns the FCM token to register with the API, or null.
  Future<String?> start({required void Function(String deepLink) onOpen}) async {
    try {
      // Asked for after sign-in rather than on first launch. A permission prompt before
      // anyone knows what the app does is the fastest way to get it denied permanently.
      final settings = await _messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return null;

      await _local.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
        onDidReceiveNotificationResponse: (response) {
          final payload = response.payload;
          if (payload != null && payload.isNotEmpty) onOpen(payload);
        },
      );

      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(_channel);

      // Foreground messages are not shown by the system, so they are drawn here. Without
      // this, a reminder that arrives while the app is open is silently dropped.
      FirebaseMessaging.onMessage.listen(_show);

      // Tapped while the app was backgrounded.
      FirebaseMessaging.onMessageOpenedApp.listen((message) {
        final link = message.data['deepLink'];
        if (link is String && link.isNotEmpty) onOpen(link);
      });

      // Tapped while the app was closed entirely — this is the message that launched it.
      final initial = await _messaging.getInitialMessage();
      final link = initial?.data['deepLink'];
      if (link is String && link.isNotEmpty) onOpen(link);

      return await _messaging.getToken();
    } catch (error) {
      debugPrint('Push unavailable: $error');
      return null;
    }
  }

  /// Fires when FCM rotates the token — roughly on reinstall or app-data clear. The server
  /// must be told, or reminders start going to a device that no longer exists.
  Stream<String> get tokenRefreshes => _messaging.onTokenRefresh;

  Future<void> _show(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;

    await _local.show(
      notification.hashCode,
      notification.title,
      notification.body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
      payload: message.data['deepLink'] as String?,
    );
  }
}
