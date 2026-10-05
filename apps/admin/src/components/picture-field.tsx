'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload a picture, see it, replace it, remove it.
 *
 * The catalogue has carried `imageUrl` on segments, categories and services since the start
 * — the API returns it and both apps render it — but nothing in the admin panel could set
 * one, so every one of them was null and customers saw generated letters and gradients.
 * Client request 05/10/2026: "service icon and category icon from admin".
 *
 * Shows the shape the customer will see it in: a circle for a category chip, a wide card for
 * a service, so a portrait photo that will be cropped to a disc is obvious here rather than
 * on the shop floor.
 */
export function PictureField({
  label,
  value,
  onChange,
  shape = 'wide',
  fit = 'cover',
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  shape?: 'wide' | 'circle';
  /** "contain" for a logo, which must be seen whole rather than cropped to fill the box. */
  fit?: 'cover' | 'contain';
  hint?: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => adminClient().media.upload(file, file.name),
    onSuccess: (asset) => {
      onChange(asset.url);
      setError(null);
    },
    onError: (caught) => setError(errorMessage(caught, 'The picture did not upload.')),
  });

  return (
    <div className="flex flex-col gap-xs">
      <span className="text-body-sm font-medium">{label}</span>

      <div className="flex items-center gap-base">
        {value === null || value === '' ? (
          <span
            className={
              'flex shrink-0 items-center justify-center bg-surface2 text-caption text-text-muted ' +
              (shape === 'circle' ? 'h-16 w-16 rounded-full' : 'h-16 w-24 rounded-md')
            }
          >
            None
          </span>
        ) : (
          <img
            src={value}
            alt=""
            className={
              'shrink-0 bg-surface2 ' +
              (fit === 'contain' ? 'object-contain p-xs ' : 'object-cover ') +
              (shape === 'circle'
                ? 'h-16 w-16 rounded-full'
                : fit === 'contain'
                  ? 'h-16 w-48 rounded-md'
                  : 'h-16 w-24 rounded-md')
            }
          />
        )}

        <div className="flex flex-col gap-xs">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
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
            className="text-body-sm file:mr-sm file:rounded-md file:border file:border-border file:bg-surface file:px-md file:py-xs"
          />
          {upload.isPending && <span className="text-caption text-text-muted">Uploading…</span>}
          {value !== null && value !== '' && !upload.isPending && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setError(null);
              }}
              className="self-start text-caption text-danger underline underline-offset-2"
            >
              Remove picture
            </button>
          )}
        </div>
      </div>

      {hint !== undefined && <span className="text-caption text-text-muted">{hint}</span>}
      {error !== null && <span className="text-caption text-danger">{error}</span>}
    </div>
  );
}
