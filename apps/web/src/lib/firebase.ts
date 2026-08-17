'use client';

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut as firebaseSignOut,
  type Auth,
} from 'firebase/auth';

/**
 * Firebase, loaded lazily and only for sign-in.
 *
 * The SDK is ~200 kB and most visits never sign in — someone browsing the menu should not
 * pay for it. Everything here is behind a dynamic import from the sign-in button, so it
 * lands in its own chunk rather than the shared bundle.
 *
 * None of these values are secret. The API key ships in every client that talks to
 * Firebase and is restricted by domain in the Google Cloud console, which is where that
 * restriction belongs — not in a build variable.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_SENDER_ID,
};

let app: FirebaseApp | null = null;

function firebaseApp(): FirebaseApp {
  if (config.apiKey === undefined || config.projectId === undefined) {
    throw new Error(
      'Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* in .env.local — see .env.example.',
    );
  }

  // getApps() guards against Next's fast refresh re-running this module and Firebase
  // throwing "app/duplicate-app" on the second initialize.
  app ??= getApps()[0] ?? initializeApp(config);
  return app;
}

export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}

/**
 * Google sign-in, returning the Firebase ID token for the API to verify.
 *
 * The token — not the Google profile — is what crosses to our server. Anything the client
 * asserts about who it is can be forged; a Firebase ID token cannot, because the server
 * checks its signature against Google's public keys.
 */
export async function signInWithGoogle(): Promise<string> {
  const auth = firebaseAuth();

  const provider = new GoogleAuthProvider();
  // Always show the chooser. Without this, a shared laptop silently reuses whichever
  // Google account signed in last — and the second customer books as the first.
  provider.setCustomParameters({ prompt: 'select_account' });

  const credential = await signInWithPopup(auth, provider);
  return credential.user.getIdToken();
}

/**
 * Clears the Firebase session.
 *
 * Separate from our own sign-out: our JWT is what authorises API calls, but leaving the
 * Firebase session behind means the next "Sign in" silently reuses the same account and
 * looks broken to anyone trying to switch.
 */
export async function signOutOfFirebase(): Promise<void> {
  try {
    await firebaseSignOut(firebaseAuth());
  } catch {
    // Never configured, or already signed out. Our own session is what matters.
  }
}
