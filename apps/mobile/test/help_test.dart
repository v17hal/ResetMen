import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:reset_app/src/screens/help_screen.dart';
import 'package:reset_app/src/screens/help_thread_screen.dart';

import 'support/fake_api.dart';

/// Help — client request of 11/09/2026 — against the shapes
/// apps/api/src/support/support.service.ts returns.
void main() {
  const conversation = [
    {
      'id': 'msg-1',
      'author': 'CUSTOMER',
      'body': 'Can I move Saturday to 11?',
      'createdAt': '2026-09-11T04:00:00.000Z',
    },
    {
      'id': 'msg-2',
      'author': 'STAFF',
      'body': 'Yes — we have moved you to 11am.',
      'createdAt': '2026-09-11T05:00:00.000Z',
    },
  ];

  Map<String, dynamic> thread({
    String id = 'thr-1',
    String subject = 'Moving my Saturday booking',
    String status = 'OPEN',
    String lastBy = 'STAFF',
    bool unread = false,
    bool booking = false,
    List<Map<String, dynamic>>? messages,
  }) =>
      {
        'id': id,
        'publicId': 'HLP-7Q2K4M',
        'subject': subject,
        'status': status,
        'lastMessageAt': '2026-09-11T05:00:00.000Z',
        'lastMessageBy': lastBy,
        'createdAt': '2026-09-11T04:00:00.000Z',
        'unread': unread,
        'preview': 'Yes — we have moved you to 11am.',
        'booking': booking
            ? {
                'id': 'bk-1',
                'publicId': 'RST-2K8F4M',
                'startsAt': '2026-09-12T04:30:00.000Z',
                'serviceName': 'Tension Relief',
              }
            : null,
        if (messages != null) 'messages': messages,
      };

  group('HelpScreen', () {
    testWidgets('asks a visitor to sign in, and asks the API for nothing', (tester) async {
      final api = FakeApi({});
      await pumpScreen(tester, const HelpScreen(), api: api);

      expect(find.text('Sign in to ask us'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Sign in'), findsOneWidget);
      expect(api.calls('GET /support/threads'), 0);
    });

    testWidgets('with no questions yet, invites one', (tester) async {
      await pumpScreen(
        tester,
        const HelpScreen(),
        signedIn: true,
        api: FakeApi({
          'GET /auth/me': (_) => ok(userJson),
          'GET /support/threads': (_) => ok({'data': <Object>[]}),
        }),
      );

      expect(find.text('Ask us anything'), findsOneWidget);
      expect(
        find.text('Questions about a booking, a treatment or the shop? Write to us here '
            'and we will reply in the app.'),
        findsOneWidget,
      );
      expect(find.text('Ask a question'), findsOneWidget);
    });

    testWidgets('says whose turn it is on every question', (tester) async {
      await pumpScreen(
        tester,
        const HelpScreen(),
        signedIn: true,
        api: FakeApi({
          'GET /auth/me': (_) => ok(userJson),
          'GET /support/threads': (_) => ok({
                'data': [
                  thread(unread: true),
                  thread(id: 'thr-2', subject: 'Is parking free?', lastBy: 'CUSTOMER'),
                  thread(id: 'thr-3', subject: 'Receipt please', status: 'CLOSED'),
                ],
              }),
        }),
      );

      expect(find.text('Replied'), findsOneWidget);
      expect(find.text('Waiting for reply'), findsOneWidget);
      expect(find.text('Closed'), findsOneWidget);

      FontWeight? weight(String subject) =>
          tester.widget<Text>(find.text(subject)).style?.fontWeight;
      expect(weight('Moving my Saturday booking'), FontWeight.w700,
          reason: 'an unread reply stands out');
      expect(weight('Is parking free?'), FontWeight.w500);
    });

    testWidgets('Send waits for both fields, and a refusal is shown in the sheet',
        (tester) async {
      await pumpScreen(
        tester,
        const HelpScreen(),
        signedIn: true,
        api: FakeApi({
          'GET /auth/me': (_) => ok(userJson),
          'GET /support/threads': (_) => ok({'data': <Object>[]}),
          'POST /support/threads': (_) => problem(
                422,
                'VALIDATION_FAILED',
                'Give it a short subject — three characters at least.',
              ),
        }),
      );

      await tester.tap(find.text('Ask a question'));
      await settle(tester);

      VoidCallback? send() =>
          tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Send')).onPressed;
      expect(send(), isNull);

      await tester.enterText(find.widgetWithText(TextField, 'Subject'), 'Hi');
      await tester.pump();
      expect(send(), isNull);

      await tester.enterText(find.widgetWithText(TextField, 'Message'), 'Is Sunday open?');
      await tester.pump();
      expect(send(), isNotNull);

      await tester.tap(find.widgetWithText(FilledButton, 'Send'));
      await settle(tester);

      expect(find.text('Give it a short subject — three characters at least.'),
          findsOneWidget);
      expect(find.widgetWithText(TextField, 'Subject'), findsOneWidget,
          reason: 'the sheet stays open with what they typed');
    });

    testWidgets('a question that is sent opens straight onto its conversation',
        (tester) async {
      final created = thread(
        lastBy: 'CUSTOMER',
        messages: [conversation.first],
      );
      await pumpScreen(
        tester,
        const HelpScreen(),
        signedIn: true,
        api: FakeApi({
          'GET /auth/me': (_) => ok(userJson),
          'GET /support/threads': (_) => ok({'data': <Object>[]}),
          'POST /support/threads': (_) => ok(created, status: 201),
          'GET /support/threads/thr-1': (_) => ok(created),
        }),
      );

      await tester.tap(find.text('Ask a question'));
      await settle(tester);
      await tester.enterText(
          find.widgetWithText(TextField, 'Subject'), 'Moving my Saturday booking');
      await tester.enterText(
          find.widgetWithText(TextField, 'Message'), 'Can I move Saturday to 11?');
      await tester.pump();
      await tester.tap(find.widgetWithText(FilledButton, 'Send'));
      await settle(tester);

      expect(find.byType(HelpThreadScreen), findsOneWidget);
      expect(find.text('Can I move Saturday to 11?'), findsOneWidget);
    });
  });

  group('HelpThreadScreen', () {
    Map<String, FakeReply Function(http.Request)> routes(Map<String, dynamic> detail) => {
          'GET /auth/me': (_) => ok(userJson),
          'GET /support/threads': (_) => ok({'data': <Object>[]}),
          'GET /support/threads/thr-1': (_) => ok(detail),
        };

    testWidgets('the store signs as RESET team, and the booking is named up top',
        (tester) async {
      await pumpScreen(
        tester,
        const HelpThreadScreen(threadId: 'thr-1'),
        signedIn: true,
        api: FakeApi(routes(thread(booking: true, messages: conversation))),
      );

      expect(find.text('Moving my Saturday booking'), findsOneWidget);
      expect(find.text('HLP-7Q2K4M'), findsOneWidget);
      expect(find.text('About RST-2K8F4M · Tension Relief · Sat 12 Sep'), findsOneWidget);
      expect(find.text('RESET team'), findsOneWidget);

      final mine = tester.getCenter(find.text('Can I move Saturday to 11?')).dx;
      final theirs = tester.getCenter(find.text('Yes — we have moved you to 11am.')).dx;
      expect(mine, greaterThan(theirs), reason: 'the customer on the right, the store on the left');

      await tester.tap(find.byTooltip('More'));
      await settle(tester);
      expect(find.text('Mark as solved'), findsOneWidget);
    });

    testWidgets('a closed question says that writing again reopens it', (tester) async {
      await pumpScreen(
        tester,
        const HelpThreadScreen(threadId: 'thr-1'),
        signedIn: true,
        api: FakeApi(routes(thread(status: 'CLOSED', messages: conversation))),
      );

      expect(find.text('This question is closed. Writing again will reopen it.'),
          findsOneWidget);
      expect(find.byTooltip('More'), findsNothing);
    });

    testWidgets('Send is disabled while the box is empty', (tester) async {
      await pumpScreen(
        tester,
        const HelpThreadScreen(threadId: 'thr-1'),
        signedIn: true,
        api: FakeApi(routes(thread(messages: conversation))),
      );

      VoidCallback? send() =>
          tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.send)).onPressed;
      expect(send(), isNull);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.pump();
      expect(send(), isNull);

      await tester.enterText(find.byType(TextField), 'Thanks!');
      await tester.pump();
      expect(send(), isNotNull);
    });

    testWidgets('a message that fails to send stays in the box', (tester) async {
      await pumpScreen(
        tester,
        const HelpThreadScreen(threadId: 'thr-1'),
        signedIn: true,
        api: FakeApi({
          ...routes(thread(messages: conversation)),
          'POST /support/threads/thr-1/messages': (_) =>
              problem(503, 'INTERNAL', 'The desk is unreachable.'),
        }),
      );

      await tester.enterText(find.byType(TextField), 'Is Sunday open?');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await settle(tester);

      expect(find.text('The desk is unreachable.'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
          'Is Sunday open?');
    });

    testWidgets('a sent message appears and the box empties', (tester) async {
      final after = thread(
        lastBy: 'CUSTOMER',
        messages: [
          ...conversation,
          {
            'id': 'msg-3',
            'author': 'CUSTOMER',
            'body': 'Is Sunday open?',
            'createdAt': '2026-09-11T06:00:00.000Z',
          },
        ],
      );
      var sent = false;
      await pumpScreen(
        tester,
        const HelpThreadScreen(threadId: 'thr-1'),
        signedIn: true,
        api: FakeApi({
          ...routes(thread(messages: conversation)),
          'GET /support/threads/thr-1': (_) =>
              ok(sent ? after : thread(messages: conversation)),
          'POST /support/threads/thr-1/messages': (_) {
            sent = true;
            return ok(after);
          },
        }),
      );

      await tester.enterText(find.byType(TextField), 'Is Sunday open?');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await settle(tester);

      expect(find.text('Is Sunday open?'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
    });

    testWidgets('checks for replies every twenty seconds while on screen', (tester) async {
      final api = FakeApi(routes(thread(messages: conversation)));
      await pumpScreen(
        tester,
        const HelpThreadScreen(threadId: 'thr-1'),
        signedIn: true,
        api: api,
      );
      expect(api.calls('GET /support/threads/thr-1'), 1);

      await tester.pump(HelpThreadScreen.pollInterval);
      await settle(tester);
      expect(api.calls('GET /support/threads/thr-1'), 2);
    });
  });
}
