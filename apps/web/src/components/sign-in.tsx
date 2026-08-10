'use client';

import { Button, Input } from '@reset/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

export interface SignInProps {
  /** Shown above the phone field, so the reason for asking is always visible. */
  reason?: string;
  onSignedIn?: () => void;
}

/**
 * Phone + OTP.
 *
 * Two steps in one component rather than two routes, so an in-progress checkout keeps its
 * hold and its countdown while the customer signs in.
 */
export function SignIn({ reason, onSignedIn }: SignInProps) {
  const { refresh } = useAuth();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const request = useMutation({
    mutationFn: () => api().auth.requestOtp(toE164(phone)),
    onSuccess: (result) => {
      setStep('code');
      setError(null);
      setResendIn(result.expiresInSeconds > 0 ? Math.min(result.expiresInSeconds, 60) : 60);
      // Focus after the render that swaps the step, or the ref is still null.
      setTimeout(() => codeRef.current?.focus(), 0);
    },
    onError: (caught) => setError(errorMessage(caught, 'Could not send the code.')),
  });

  const verify = useMutation({
    mutationFn: () =>
      api().auth.verifyOtp({ phone: toE164(phone), code: code.trim(), platform: 'WEB' }),
    onSuccess: () => {
      refresh();
      onSignedIn?.();
    },
    onError: (caught) => setError(errorMessage(caught, 'That code did not work.')),
  });

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    if (step === 'phone') request.mutate();
    else verify.mutate();
  }

  const phoneValid = /^\d{10}$/.test(phone.replace(/\D/g, ''));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-base">
      {reason !== undefined && <p className="text-body-sm text-text-muted">{reason}</p>}

      {step === 'phone' ? (
        <>
          <Input
            label="Mobile number"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            required
            autoFocus
            placeholder="94044 91801"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={error}
            hint="We will text you a code. Indian numbers only for now."
          />
          <Button type="submit" size="lg" loading={request.isPending} disabled={!phoneValid}>
            Send code
          </Button>
        </>
      ) : (
        <>
          <Input
            ref={codeRef}
            label="Code"
            type="text"
            inputMode="numeric"
            // Lets Android and iOS offer the code straight from the SMS.
            autoComplete="one-time-code"
            pattern="\d*"
            maxLength={8}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            error={error}
            hint={`Sent to +91 ${phone.replace(/\D/g, '')}`}
            className="font-mono text-h2 tracking-[0.3em]"
          />

          <Button
            type="submit"
            size="lg"
            loading={verify.isPending}
            disabled={code.trim().length < 4}
          >
            Verify and continue
          </Button>

          <div className="flex items-center justify-between text-body-sm">
            <button
              type="button"
              className="text-primary underline underline-offset-4"
              onClick={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
            >
              Change number
            </button>

            <button
              type="button"
              disabled={resendIn > 0 || request.isPending}
              className="text-primary underline underline-offset-4 disabled:text-text-muted disabled:no-underline"
              onClick={() => request.mutate()}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

/**
 * Accepts what people actually type — `9404491801`, `+91 94044 91801`, `094044 91801` —
 * and produces the E.164 the API requires.
 */
function toE164(input: string): string {
  const digits = input.replace(/\D/g, '');
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return `+91${national}`;
}
