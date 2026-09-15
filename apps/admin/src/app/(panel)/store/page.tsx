'use client';

import type { AdminStoreProfile } from '@reset/api-client';
import { DEFAULT_TAGLINE, type StoreAudience } from '@reset/types';
import { Button, Card, ErrorState, Input, Select, SkeletonList, Textarea, useToast } from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';

/**
 * Shop details — client request 14/09/2026.
 *
 * Two things the shop could not change for itself. The sentence under its name was written
 * into the website's code, so "we also do women now" or a change of opening promise meant a
 * release. And there was nowhere at all to say who the shop serves — the question the client
 * actually asked ("how do I turn the female option on later").
 *
 * Deliberately not a settings dump: hours live under Capacity, prices under Catalog. This is
 * the words, and it shows them as the customer will read them before they are saved.
 */
export default function StorePage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const store = useQuery({ queryKey: ['admin-store'], queryFn: () => adminClient().store.get() });

  const [form, setForm] = useState<AdminStoreProfile | null>(null);
  // Loaded once into the form; refetches must not overwrite half-typed edits.
  useEffect(() => {
    if (store.data !== undefined && form === null) setForm(store.data);
  }, [store.data, form]);

  const save = useMutation({
    mutationFn: (profile: AdminStoreProfile) =>
      adminClient().store.update({
        name: profile.name.trim(),
        // Blank means "use the standard wording", which is what null means to the website.
        tagline: profile.tagline === null || profile.tagline.trim() === '' ? null : profile.tagline.trim(),
        address: blankToNull(profile.address),
        city: blankToNull(profile.city),
        pincode: blankToNull(profile.pincode),
        phone: blankToNull(profile.phone),
        audience: profile.audience,
      }),
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.setQueryData(['admin-store'], saved);
      toast.success('Saved. The website and the app show this within a minute.');
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (store.isError) {
    return <ErrorState description={errorMessage(store.error)} onRetry={() => void store.refetch()} />;
  }
  if (form === null) return <SkeletonList rows={3} />;

  const set = <K extends keyof AdminStoreProfile>(key: K, value: AdminStoreProfile[K]) =>
    setForm({ ...form, [key]: value });

  const shown = form.tagline === null || form.tagline.trim() === '' ? DEFAULT_TAGLINE[form.audience] : form.tagline;
  const tooShort = form.tagline !== null && form.tagline.trim() !== '' && form.tagline.trim().length < 10;

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Shop details</h1>
        <p className="text-body-sm text-text-muted">
          The name, the line under it, and where you are — as customers and Google read them.
          Opening hours are under Capacity; prices are under Catalog.
        </p>
      </header>

      <Card className="flex flex-col gap-base">
        <Input
          label="Name"
          required
          value={form.name}
          maxLength={60}
          onChange={(event) => set('name', event.target.value)}
        />

        <div className="flex flex-col gap-xs">
          <Textarea
            label="The line under the name"
            rows={3}
            maxLength={200}
            value={form.tagline ?? ''}
            placeholder={DEFAULT_TAGLINE[form.audience]}
            onChange={(event) => set('tagline', event.target.value)}
            error={tooShort ? 'A line customers read — ten characters at least.' : undefined}
          />
          <p className="text-caption text-text-muted">
            Leave it empty to use the standard wording for who you serve, shown in grey above.
          </p>
        </div>

        <div className="flex flex-col gap-xs">
          <Select
            label="Who we serve"
            value={form.audience}
            onChange={(event) => set('audience', event.target.value as StoreAudience)}
          >
            <option value="MEN_ONLY">Men only</option>
            <option value="EVERYONE">Men and women</option>
          </Select>
          <p className="text-caption text-text-muted">
            Changes the wording on the website, in the app and in what Google reads. It does not
            change your services, your stations or who can book — set those in Catalog and Capacity.
          </p>
        </div>

        <div className="flex flex-wrap gap-sm">
          <Input
            label="Address"
            className="min-w-[16rem] flex-1"
            value={form.address ?? ''}
            maxLength={200}
            onChange={(event) => set('address', event.target.value)}
          />
          <Input
            label="City"
            value={form.city ?? ''}
            maxLength={60}
            onChange={(event) => set('city', event.target.value)}
          />
          <Input
            label="PIN code"
            value={form.pincode ?? ''}
            maxLength={12}
            onChange={(event) => set('pincode', event.target.value)}
          />
        </div>

        <Input
          label="Phone (not shown to customers)"
          value={form.phone ?? ''}
          maxLength={20}
          onChange={(event) => set('phone', event.target.value)}
        />
        <p className="-mt-sm text-caption text-text-muted">
          Kept for Google and for your own records. Customers are sent to Help, as you asked.
        </p>
      </Card>

      {/* What they are about to publish, in the shape the website renders it. */}
      <Card className="flex flex-col gap-xs">
        <span className="text-caption uppercase tracking-wide text-text-muted">
          How it reads on the website
        </span>
        <p className="font-display text-h3">
          {form.name}
          {form.city !== null && form.city.trim() !== '' ? ` ${form.city.trim()}` : ''}
        </p>
        <p className={form.tagline === null || form.tagline.trim() === '' ? 'text-text-muted' : ''}>{shown}</p>
      </Card>

      <div className="flex justify-end gap-sm">
        <Button
          variant="secondary"
          onClick={() => setForm(store.data ?? form)}
          disabled={save.isPending}
        >
          Undo changes
        </Button>
        <Button
          loading={save.isPending}
          disabled={form.name.trim().length < 2 || tooShort}
          onClick={() => save.mutate(form)}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

const blankToNull = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : value.trim();
