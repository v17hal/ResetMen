'use client';

import { Button } from '@reset/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

export interface SignInProps {
  /** Shown above the button, so the reason for asking is always visible. */
  reason?: string;
  onSignedIn?: () => void;
}

/**
 * Sign in with Google.
 *
 * One button, no password, no OTP wait. The store has no SMS provider, so this is the
 * whole of authentication — and it is also the fastest of the options, which matters most
 * on the checkout screen where a hold is already counting down.
 *
 * The Firebase SDK is imported dynamically: it is ~200 kB and most visits never sign in.
 */
export function SignIn({ reason, onSignedIn }: SignInProps) {
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const signIn = useMutation({
    mutationFn: async () => {
      const { signInWithGoogle } = await import('@/lib/firebase');
      const idToken = await signInWithGoogle();
      return api().auth.signInWithFirebase({ idToken, platform: 'WEB' });
    },
    onSuccess: () => {
      refresh();
      onSignedIn?.();
    },
    onError: (caught) => {
      // Closing the popup is a decision, not a failure — saying "sign-in failed" to
      // someone who changed their mind is both wrong and alarming.
      const code = (caught as { code?: string }).code;
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/user-cancelled'
      ) {
        return;
      }

      /**
       * Name the cause.
       *
       * "Could not sign in. Please try again." is true of every failure here and useful
       * for none of them: retrying does not add a missing OAuth origin or enable a
       * provider. Each of these is a specific piece of configuration, and saying which one
       * is the difference between a five-minute fix and an afternoon.
       *
       * The raw code is appended for anything unrecognised, because the alternative is
       * asking someone to open the browser console to find out what went wrong.
       */
      const known: Record<string, string> = {
        'auth/popup-blocked':
          'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
        'auth/unauthorized-domain':
          'This site is not on the Firebase authorised-domain list. Add it in Firebase console → Authentication → Settings → Authorised domains.',
        'auth/operation-not-allowed':
          'Google sign-in is switched off for this project. Enable it in Firebase console → Authentication → Sign-in method.',
        'auth/invalid-api-key':
          'The Firebase API key is wrong for this project. Check NEXT_PUBLIC_FIREBASE_API_KEY is the web key, not the Android one.',
        'auth/api-key-not-valid':
          'The Firebase API key is wrong or restricted. Check its HTTP-referrer restrictions in Google Cloud console include this domain.',
        // Nearly always the Content-Security-Policy on this site rather than anything in
        // the Firebase console. The SDK calls identitytoolkit and opens an iframe on the
        // project's authDomain; a CSP that lists neither blocks both, and the SDK reports
        // only this. See the web block in infra/Caddyfile.
        'auth/internal-error':
          'Sign-in was blocked by this site, not by Google. The content-security-policy needs to allow identitytoolkit.googleapis.com and the Firebase auth domain.',
        'auth/network-request-failed':
          'Could not reach Firebase. Check the connection and try again.',
      };

      setError(
        known[code ?? ''] ??
          errorMessage(
            caught,
            code === undefined
              ? 'Could not sign in. Please try again.'
              : `Could not sign in (${code}).`,
          ),
      );
    },
  });

  return (
    <div className="flex flex-col gap-base">
      {reason !== undefined && <p className="text-body-sm text-text-muted">{reason}</p>}

      <Button
        size="lg"
        variant="secondary"
        fullWidth
        loading={signIn.isPending}
        onClick={() => {
          setError(null);
          signIn.mutate();
        }}
        leadingIcon={<GoogleMark />}
      >
        Continue with Google
      </Button>

      {error !== null && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}

      <p className="text-caption text-text-muted">
        We only use your name and email to hold your booking. You can delete your account at
        any time from the You tab.
      </p>
    </div>
  );
}

/** Google's mark, kept at its brand colours — a recoloured one breaks their guidelines. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
