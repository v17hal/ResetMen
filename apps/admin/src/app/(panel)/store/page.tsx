'use client';

import type { AdminStoreProfile } from '@reset/api-client';
import { DEFAULT_TAGLINE, type StoreAudience } from '@reset/types';
import {
  Button,
  Card,
  Checkbox,
  ErrorState,
  Input,
  Select,
  SkeletonList,
  Textarea,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PictureField } from '@/components/picture-field';
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
  // Shown here so every line of the customer's details card is visible on one page; edited
  // under Capacity, where the booking engine reads them.
  const hours = useQuery({
    queryKey: ['admin-store-hours'],
    queryFn: () => adminClient().capacity.storeHours(),
  });

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
        logoUrl: profile.logoUrl,
        showPhone: profile.showPhone,
        contactNote: blankToNull(profile.contactNote),
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

        <PictureField
          label="Logo"
          fit="contain"
          value={form.logoUrl}
          onChange={(logoUrl) => setForm({ ...form, logoUrl })}
          hint="Shown above “Book your reset” on the website and in the app. A wide mark on a transparent or white background works best; it is drawn about 120 pixels across."
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

        {/* A full box, not one line: the address is long enough that a single-line field
            cut it off, which made it look as if it could not be edited. */}
        <Textarea
          label="Address"
          rows={2}
          value={form.address ?? ''}
          maxLength={200}
          onChange={(event) => set('address', event.target.value)}
        />
        <div className="flex flex-wrap gap-sm">
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
          label="Phone"
          value={form.phone ?? ''}
          maxLength={20}
          placeholder="+91 73500 24824"
          onChange={(event) => set('phone', event.target.value)}
        />
        <Checkbox
          label="Show the phone number to customers"
          checked={form.showPhone}
          onChange={(event) => set('showPhone', event.target.checked)}
        />
        <p className="-mt-sm text-caption text-text-muted">
          Off, customers are sent to Help and you reply in writing. On, the number appears in
          the details card at the foot of the website and in the app, as a tap-to-call link.
        </p>

        <Input
          label="The line under Questions"
          value={form.contactNote ?? ''}
          maxLength={120}
          placeholder="Ask us — we reply in writing"
          onChange={(event) => set('contactNote', event.target.value)}
          hint="It links to Help. Leave it empty for the standard wording shown in grey."
        />

        <div className="flex flex-col gap-xs rounded-md border border-border p-sm">
          <span className="text-body-sm font-medium">Opening hours</span>
          <span className="text-body-sm text-text-muted">{hoursLine(hours.data)}</span>
          <Link
            href="/capacity"
            className="self-start text-caption text-primary underline underline-offset-2"
          >
            Change them under Capacity → Opening hours
          </Link>
        </div>
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
        {/* The rest of the card, in the order the website shows it. */}
        <div className="mt-sm flex flex-col gap-sm text-body-sm sm:flex-row sm:gap-2xl">
          <div className="flex flex-col">
            <span className="text-caption uppercase tracking-wide text-text-muted">Where</span>
            <span className="whitespace-pre-line">{form.address ?? '—'}</span>
            {form.city !== null && form.city.trim() !== '' && <span>{form.city}</span>}
          </div>
          <div className="flex flex-col">
            <span className="text-caption uppercase tracking-wide text-text-muted">Questions</span>
            {form.showPhone && form.phone !== null && form.phone.trim() !== '' && (
              <span>Call {form.phone}</span>
            )}
            <span className="underline underline-offset-2">
              {form.contactNote === null || form.contactNote.trim() === ''
                ? 'Ask us — we reply in writing'
                : form.contactNote}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-caption uppercase tracking-wide text-text-muted">Open</span>
            <span>{hoursLine(hours.data)}</span>
          </div>
        </div>
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

/** "08:00 – 21:30 · closed Monday", from the hours the booking engine uses. */
function hoursLine(
  rows:
    | ReadonlyArray<{ dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean }>
    | undefined,
): string {
  if (rows === undefined) return '…';
  const open = rows.filter((row) => !row.isClosed);
  if (open.length === 0) return 'No opening hours set';
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const closed = rows.filter((row) => row.isClosed).map((row) => days[row.dayOfWeek]);
  const first = open[0]!;
  const span = first.opensAt.slice(0, 5) + ' – ' + first.closesAt.slice(0, 5);
  return closed.length === 0 ? span : span + ' · closed ' + closed.join(', ');
}

const blankToNull = (value: string | null): string | null =>
  value === null || value.trim() === '' ? null : value.trim();
