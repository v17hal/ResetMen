import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

/// Cancelled by the customer — a decision, not a failure.
///
/// Distinguished from every other error because the UI must stay silent for it. Telling
/// someone their sign-in failed when they simply backed out is both wrong and alarming.
class SignInCancelled implements Exception {
  const SignInCancelled();
}

/// Google sign-in, returning the Firebase ID token the API verifies.
///
/// The token — not the Google profile — is what crosses to our server. Anything the client
/// asserts about who it is can be forged; a Firebase ID token cannot, because the server
/// checks its signature against Google's public keys and pins the audience to this project.
class GoogleSignInService {
  GoogleSignInService({GoogleSignIn? google, FirebaseAuth? auth})
      : _google = google ?? GoogleSignIn(scopes: const ['email']),
        _auth = auth ?? FirebaseAuth.instance;

  final GoogleSignIn _google;
  final FirebaseAuth _auth;

  Future<String> signIn() async {
    // Sign the previous account out first. Without this the picker is skipped and the
    // phone silently reuses whoever signed in last — which on a shared device books one
    // customer's slot under another's account.
    await _google.signOut();

    final GoogleSignInAccount? account = await _google.signIn();
    if (account == null) throw const SignInCancelled();

    final auth = await account.authentication;
    final credential = GoogleAuthProvider.credential(
      idToken: auth.idToken,
      accessToken: auth.accessToken,
    );

    final result = await _auth.signInWithCredential(credential);
    final token = await result.user?.getIdToken();

    if (token == null || token.isEmpty) {
      throw Exception('Google sign-in did not return a token.');
    }
    return token;
  }

  /// Clears both sessions.
  ///
  /// Our own JWT is what authorises API calls, but leaving Firebase and Google signed in
  /// means the next "Sign in" reuses the same account with no picker — which looks broken
  /// to anyone trying to switch.
  Future<void> signOut() async {
    try {
      await _google.signOut();
      await _auth.signOut();
    } catch (_) {
      // Never signed in, or Firebase was not configured. Our session is cleared regardless.
    }
  }
}
