'use client';

import { Button, Card, Input } from '@reset/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { errorMessage, useAuth } from '@/lib/auth.js';

export default function LoginPage() {
  const { session, loading, signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && session !== null) router.replace('/');
  }, [loading, session, router]);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/');
    } catch (caught) {
      // Deliberately not "no such user" vs "wrong password" — the API already equalises the
      // timing of the two, and a different message here would undo that.
      setError(errorMessage(caught, 'Could not sign in.'));
      setSubmitting(false);
    }
  }

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-base">
      <Card elevated className="w-full max-w-sm">
        <form onSubmit={onSubmit} className="flex flex-col gap-base">
          <div className="flex flex-col gap-xs">
            <h1 className="font-display text-h1">RESET Admin</h1>
            <p className="text-body-sm text-text-muted">Sign in to manage the outlet.</p>
          </div>

          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error}
          />

          <Button type="submit" loading={submitting} fullWidth size="lg">
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  );
}
