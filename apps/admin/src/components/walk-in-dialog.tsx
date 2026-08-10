'use client';

import { Button, Dialog, Input, Select, formatMoney, useToast } from '@reset/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth.js';
import { adminClient } from '@/lib/client.js';
import { keys, useServices } from '@/lib/queries.js';
import { isoToLocalInput, localInputToIso } from '@/lib/time.js';

export interface WalkInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled from a timeline click. A full instant with the store's offset. */
  defaultStartsAt?: string;
  date: string;
  /** The store's IANA zone, from the timeline response. */
  timeZone: string;
}

/**
 * Staff-created booking.
 *
 * Operationally the most important thing in the panel. If someone walks in, is served on
 * Station 2, and nothing is entered, the engine believes Station 2 is free and sells that
 * time to an app customer who arrives to an occupied station — see
 * docs/10-open-questions.md#q4.
 *
 * It goes through the same engine and the same exclusion constraint as a customer booking,
 * so a walk-in cannot double-book a station either. When the engine refuses, the refusal is
 * shown as-is rather than translated into "try again": the reason is the useful part.
 */
export function WalkInDialog({
  open,
  onOpenChange,
  defaultStartsAt,
  date,
  timeZone,
}: WalkInDialogProps) {
  const services = useServices();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [serviceId, setServiceId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed each time it opens. A dialog that remembers the previous walk-in's name is how
  // the wrong person ends up on the timeline.
  useEffect(() => {
    if (!open) return;
    setStartsAt(defaultStartsAt ?? '');
    setCustomerName('');
    setCustomerPhone('');
    setError(null);
  }, [open, defaultStartsAt]);

  const selected = services.data?.find((service) => service.id === serviceId);

  const create = useMutation({
    mutationFn: () =>
      adminClient().bookings.walkIn({
        serviceId,
        startsAt,
        addonOptionIds: [],
        rewardId: null,
        ...(customerName.trim() === '' ? {} : { customerName: customerName.trim() }),
        ...(customerPhone.trim() === '' ? {} : { customerPhone: customerPhone.trim() }),
      }),
    onSuccess: () => {
      toast.success('Walk-in added and confirmed.');
      void queryClient.invalidateQueries({ queryKey: keys.timeline(date) });
      void queryClient.invalidateQueries({ queryKey: keys.dashboard });
      onOpenChange(false);
    },
    onError: (caught) => setError(errorMessage(caught, 'Could not add the walk-in.')),
  });

  const canSubmit = serviceId !== '' && startsAt !== '' && !create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      variant="sheet"
      title="Add a walk-in"
      description="Confirmed immediately — a walk-in pays at the counter, so no payment is expected."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!canSubmit}
          >
            Add walk-in
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        <Select
          label="Service"
          required
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
          hint={
            selected === undefined
              ? undefined
              : `${selected.durationMinutes} min · ${formatMoney(selected.pricePaise)}`
          }
        >
          <option value="">Choose a service…</option>
          {(services.data ?? []).map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </Select>

        <Input
          label="Starts at"
          type="datetime-local"
          required
          value={isoToLocalInput(startsAt, timeZone)}
          onChange={(event) => setStartsAt(localInputToIso(event.target.value, timeZone))}
          hint="Store time. The engine picks a free station, or refuses if there is none."
        />

        <Input
          label="Customer name"
          placeholder="Optional"
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          hint="Leave blank and the timeline just shows “Walk-in”."
        />

        <Input
          label="Phone"
          type="tel"
          inputMode="tel"
          placeholder="+919404491801"
          value={customerPhone}
          onChange={(event) => setCustomerPhone(event.target.value)}
          error={error}
          hint="Optional. Adding it links the visit to their streak."
        />
      </div>
    </Dialog>
  );
}

