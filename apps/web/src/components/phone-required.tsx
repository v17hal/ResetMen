'use client';

import { Button, Card, useToast } from '@reset/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

/**
 * Collects the mobile number a booking cannot be made without.
 *
 * The API refuses a hold from an account with no phone, because with no gateway every
 * booking is settled by someone from the store ringing the customer — a confirmed slot
 * attached to nobody reachable is not a booking. So this has to be asked before the slot
 * is taken, not nudged at afterwards.
 *
 * Asked here rather than by sending someone to /account. They arrived with a time picked
 * and a hold counting down; a link away from that is a lost booking, and coming back means
 * choosing a slot again.
 */
export function PhoneRequired({ onSaved }: { onSaved?: () => void }) {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (value: string) => api().auth.updateProfile({ phone: value }),
    onSuccess: () => {
      refresh();
      toast.success('Number saved.');
      onSaved?.();
    },
    onError: (caught) => setError(errorMessage(caught, 'Could not save that number.')),
  });

  if (user === null || (user.phone ?? '').trim() !== '') return null;

  function submit(): void {
    const trimmed = phone.trim();

    // Checked here as well as by the server so a typo costs a keystroke, not a round trip
    // and a rejected booking.
    if (trimmed.replace(/\D/g, '').length < 10) {
      setError('Enter a 10-digit mobile number.');
      return;
    }

    setError(null);
    save.mutate(trimmed.startsWith('+') ? trimmed : `+91${trimmed.replace(/\D/g, '')}`);
  }

  return (
    <Card className="flex flex-col gap-sm border-accent/40 bg-accent/[0.08]">
      <h2 className="font-display text-h2">One more thing</h2>
      <p className="text-body-sm text-text-muted">
        The store calls you to confirm your booking and take payment, so we need a mobile
        number before we can hold your slot.
      </p>

      <label className="flex flex-col gap-xs">
        <span className="sr-only">Mobile number</span>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="98765 43210"
          className="min-h-touch w-full rounded-md border border-border bg-surface px-base text-body text-text placeholder:text-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </label>

      {error !== null && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}

      <Button fullWidth loading={save.isPending} onClick={submit}>
        Save and continue
      </Button>
    </Card>
  );
}
