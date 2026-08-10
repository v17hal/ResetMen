'use client';

import { Skeleton } from '@reset/ui';
import { useEffect, useState } from 'react';

/**
 * The QR the counter scans.
 *
 * Rendered to a data URI on the client rather than fetched as an image, so it works with no
 * signal — the payload is already in the booking the app is holding, and a customer standing
 * in a basement with no bars still gets scanned in.
 *
 * Deliberately high error correction and a white quiet zone: this gets scanned off a
 * cracked screen at an angle, in a shop, by a tablet camera.
 */
export function QrTicket({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { toDataURL } = await import('qrcode');
        const url = await toDataURL(payload, {
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 512,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        if (!cancelled) setDataUrl(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (failed) {
    return (
      <p className="text-body-sm text-text-muted">
        Could not draw the code. Show your booking code at the counter instead — it works
        just as well.
      </p>
    );
  }

  if (dataUrl === null) return <Skeleton className="aspect-square w-full max-w-[280px]" />;

  return (
    // Always on white, never on the themed surface: a dark-mode QR is unscannable, and this
    // is the one element that must survive the theme.
    <div className="w-full max-w-[280px] rounded-lg bg-white p-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt="Your check-in QR code"
        className="h-auto w-full"
        // Hint to the browser to keep it crisp when scaled.
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
