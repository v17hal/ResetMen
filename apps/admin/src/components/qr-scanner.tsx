'use client';

import { Spinner } from '@reset/ui';
import { useEffect, useRef, useState } from 'react';

/** The subset of the Barcode Detection API this uses. Not yet in lib.dom. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

export interface QrScannerProps {
  onDetect: (token: string) => void;
  onError: (message: string) => void;
  /** Pauses detection while a check-in request is in flight. */
  busy?: boolean;
}

/**
 * Camera QR scanning via the platform `BarcodeDetector`.
 *
 * No decoding library. The panel runs on an Android tablet at a counter, where Chrome has
 * shipped `BarcodeDetector` for years; carrying a WASM decoder for every other browser would
 * cost more than it earns when manual entry already sits next to this on the same screen.
 * Where the API is missing, that is said plainly rather than showing a camera that never
 * resolves anything.
 *
 * Two things worth knowing:
 *
 *  - **The stream is stopped on every exit path.** A `getUserMedia` track left running keeps
 *    the camera light on, which at a counter reads as the shop recording customers.
 *  - **The same code is not fired twice.** Detection runs continuously and a QR stays in
 *    frame for many frames; without the guard, one scan sends a dozen requests and the
 *    customer sees `CHECKIN_ALREADY_USED` for their own booking.
 */
export function QrScanner({ onDetect, onError, busy = false }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [starting, setStarting] = useState(true);

  // Refs, not state: the detection loop must read the current values without restarting.
  const busyRef = useRef(busy);
  const lastValue = useRef<string | null>(null);
  busyRef.current = busy;

  useEffect(() => {
    const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

    if (Detector === undefined) {
      /**
       * Name the actual requirement.
       *
       * `BarcodeDetector` ships in Chrome on Android and ChromeOS and not on desktop, so
       * this fires on every laptop. The old wording — "open the panel in Chrome" — was read
       * by someone already in Chrome, which makes the panel look broken rather than the
       * feature unavailable. Manual entry is right there and works everywhere, so say that
       * first and explain second.
       */
      onError(
        'Type the booking code on the right — it works on any device. Camera scanning ' +
          'needs Chrome on a phone or tablet; desktop browsers cannot do it.',
      );
      return;
    }

    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelled = false;

    const stop = (): void => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera on a tablet. `ideal` rather than `exact` so a laptop with only a
          // front camera still works instead of throwing.
          video: { facingMode: { ideal: 'environment' } },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const video = videoRef.current;
        if (video === null) return;

        video.srcObject = stream;
        await video.play();
        setStarting(false);

        const detector = new Detector({ formats: ['qr_code'] });

        const tick = async (): Promise<void> => {
          if (cancelled) return;

          if (!busyRef.current && video.readyState === video.HAVE_ENOUGH_DATA) {
            try {
              const codes = await detector.detect(video);
              const value = codes[0]?.rawValue;
              if (value !== undefined && value !== lastValue.current) {
                lastValue.current = value;
                onDetect(value);
              }
            } catch {
              // A single failed frame is normal — motion blur, a hand across the lens.
              // Retrying next frame is the whole recovery strategy.
            }
          }

          frame = requestAnimationFrame(() => void tick());
        };

        frame = requestAnimationFrame(() => void tick());
      } catch (caught) {
        stop();
        const denied =
          caught instanceof DOMException &&
          (caught.name === 'NotAllowedError' || caught.name === 'SecurityError');
        onError(
          denied
            ? 'Camera access was blocked. Allow it in the browser’s site settings, or use the booking code.'
            : 'Could not start the camera. Use the booking code instead.',
        );
      }
    })();

    return stop;
    // Deliberately mount-only. Re-running this on every render of the parent would restart
    // the camera each time a keystroke lands in the manual-entry field beside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        playsInline
        muted
        // Nothing here is meaningful to a screen reader; the result card carries the outcome.
        aria-hidden
      />

      {/* Aiming frame. Purely a hint about where to hold the phone. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="h-1/2 w-1/2 rounded-lg border-2 border-white/70" />
      </div>

      {(starting || busy) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <Spinner className="h-8 w-8 text-white" label={busy ? 'Checking in' : 'Starting camera'} />
        </div>
      )}
    </div>
  );
}
