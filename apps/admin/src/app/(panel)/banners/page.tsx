'use client';

import type { AdminBannerRow } from '@reset/api-client';
import {
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Select,
  SkeletonList,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Toggle } from '@/components/toggle';
import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys, useServices } from '@/lib/queries';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Home banners — client request 11/09/2026.
 *
 * The pictures across the top of the website and app home screens, like the delivery
 * apps. Managed here rather than shipped in the app, so changing a promotion is a minute's
 * work and never an app update.
 */
export default function BannersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminBannerRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminBannerRow | null>(null);

  const banners = useQuery({ queryKey: keys.banners, queryFn: () => adminClient().banners.list() });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.banners });

  const update = useMutation({
    mutationFn: ({ banner, patch }: { banner: AdminBannerRow; patch: Partial<AdminBannerRow> }) =>
      adminClient().banners.update(banner.id, {
        imageUrl: banner.imageUrl,
        altText: banner.altText,
        serviceId: banner.serviceId,
        sortOrder: banner.sortOrder,
        isActive: banner.isActive,
        ...patch,
      }),
    onSuccess: refresh,
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  /** Swaps two neighbours' positions. Two writes; the list is short enough not to care. */
  const move = useMutation({
    mutationFn: async ({ a, b }: { a: AdminBannerRow; b: AdminBannerRow }) => {
      const base = (row: AdminBannerRow) => ({
        imageUrl: row.imageUrl,
        altText: row.altText,
        serviceId: row.serviceId,
        isActive: row.isActive,
      });
      // Positions, not the stored numbers: every banner created on one day can share
      // sortOrder 0, and swapping two zeros changes nothing.
      const rows = banners.data ?? [];
      const ia = rows.findIndex((row) => row.id === a.id);
      const ib = rows.findIndex((row) => row.id === b.id);
      await adminClient().banners.update(a.id, { ...base(a), sortOrder: ib });
      await adminClient().banners.update(b.id, { ...base(b), sortOrder: ia });
    },
    onSuccess: refresh,
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminClient().banners.remove(id),
    onSuccess: () => {
      toast.success('Banner deleted.');
      setDeleting(null);
      refresh();
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const rows = banners.data ?? [];

  return (
    <div className="flex flex-col gap-base">
      <header className="flex flex-wrap items-end justify-between gap-sm">
        <div>
          <h1 className="font-display text-h1">Home banners</h1>
          <p className="text-body-sm text-text-muted">
            The pictures across the top of the website and the app. They rotate every few
            seconds, in this order.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>+ Add banner</Button>
      </header>

      <Card className="text-body-sm text-text-muted">
        Use a wide picture — about 16 : 10, at least 1200 pixels across, JPEG, PNG or WebP
        under 5 MB. On a phone the banner is only about 350 pixels wide, so any words in the
        artwork need to be large.
      </Card>

      {banners.isError ? (
        <ErrorState description={errorMessage(banners.error)} onRetry={() => void banners.refetch()} />
      ) : banners.isPending ? (
        <SkeletonList rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No banners yet"
          description="The home screen starts with the search box until one is added."
          action={{ label: '+ Add banner', onClick: () => setEditing('new') }}
        />
      ) : (
        <ul className="grid gap-base sm:grid-cols-2">
          {rows.map((banner, index) => (
            <li key={banner.id}>
              <Card padded={false} className="overflow-hidden">
                <img
                  src={banner.imageUrl}
                  alt={banner.altText}
                  className="aspect-[16/10] w-full bg-surface2 object-cover"
                />
                <div className="flex flex-col gap-sm p-base">
                  <p className="text-body-sm">{banner.altText}</p>
                  <p className="text-caption text-text-muted">
                    {banner.service === null ? 'Not a link' : `Opens ${banner.service.name}`}
                  </p>
                  <div className="flex flex-wrap items-center gap-xs">
                    <Toggle
                      checked={banner.isActive}
                      label={banner.altText}
                      disabled={update.isPending}
                      onChange={(isActive) => update.mutate({ banner, patch: { isActive } })}
                    />
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Move earlier"
                      disabled={index === 0 || move.isPending}
                      onClick={() => move.mutate({ a: banner, b: rows[index - 1]! })}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Move later"
                      disabled={index === rows.length - 1 || move.isPending}
                      onClick={() => move.mutate({ a: banner, b: rows[index + 1]! })}
                    >
                      ↓
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditing(banner)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => setDeleting(banner)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <BannerDialog banner={editing} nextSortOrder={rows.length} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this banner?"
        description="It comes off the home screen straight away. The picture itself stays in the media library."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting !== null && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function BannerDialog({
  banner,
  nextSortOrder,
  onClose,
}: {
  banner: AdminBannerRow | 'new' | null;
  nextSortOrder: number;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const services = useServices();
  const isNew = banner === 'new';
  const existing = banner === 'new' || banner === null ? null : banner;

  const [imageUrl, setImageUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setImageUrl(existing?.imageUrl ?? '');
    setAltText(existing?.altText ?? '');
    setServiceId(existing?.serviceId ?? '');
    setIsActive(existing?.isActive ?? true);
    setError(null);
  }, [existing, isNew]);

  const upload = useMutation({
    mutationFn: (file: File) => adminClient().media.upload(file, file.name),
    onSuccess: (asset) => {
      setImageUrl(asset.url);
      setError(null);
    },
    onError: (caught) => setError(errorMessage(caught, 'The picture did not upload.')),
  });

  const save = useMutation({
    mutationFn: () => {
      const input = {
        imageUrl,
        altText: altText.trim(),
        serviceId: serviceId === '' ? null : serviceId,
        sortOrder: existing?.sortOrder ?? nextSortOrder,
        isActive,
      };
      return isNew
        ? adminClient().banners.create(input)
        : adminClient().banners.update(existing!.id, input);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Banner added.' : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.banners });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (banner === null) return null;

  const published = (services.data ?? []).filter((service) => service.isActive);
  const canSave = imageUrl !== '' && altText.trim().length >= 3 && !upload.isPending;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={isNew ? 'Add banner' : 'Edit banner'}
      className="sm:max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
            {isNew ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        {imageUrl !== '' && (
          <img
            src={imageUrl}
            alt=""
            className="aspect-[16/10] w-full rounded-md bg-surface2 object-cover"
          />
        )}

        <label className="flex flex-col gap-xs text-body-sm font-medium">
          {imageUrl === '' ? 'Picture' : 'Replace the picture'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file === undefined) return;
              if (file.size > MAX_BYTES) {
                setError('That picture is over 5 MB. Export it smaller and try again.');
                return;
              }
              upload.mutate(file);
            }}
            className="text-body-sm font-normal file:mr-sm file:rounded-md file:border file:border-border file:bg-surface file:px-md file:py-xs"
          />
          {upload.isPending && <span className="font-normal text-text-muted">Uploading…</span>}
        </label>

        <Input
          label="What the picture says"
          required
          value={altText}
          maxLength={160}
          onChange={(event) => setAltText(event.target.value)}
          hint="In words — screen readers and Google cannot read the artwork. “Head and neck massage at RESET, Sadashiv Peth”."
        />

        <Select
          label="Tapping it opens"
          value={serviceId}
          onChange={(event) => setServiceId(event.target.value)}
          hint="Only published services are offered — a banner must never lead to a page that does not exist."
        >
          <option value="">Nothing — just a picture</option>
          {published.map((service) => (
            <option key={service.id} value={service.id}>
              {service.emoji === null ? '' : `${service.emoji} `}
              {service.name} · {service.category.name}
            </option>
          ))}
        </Select>

        <Checkbox
          label="Show on the home screen"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />

        {error !== null && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
