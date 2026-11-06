'use client';

import type { NewBookingAlert } from '@reset/api-client';
import { Button, formatDateTime, useToast } from '@reset/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';
import { STORE_TIMEZONE } from '@/lib/time';

const STORAGE_KEY = 'reset.admin.bookingAlerts';

/** Ids already announced. Bounded, because the panel stays open all day. */
const SEEN_LIMIT = 200;

type Permission = NotificationPermission | 'unsupported';

/**
 * The new-booking bell, for the whole panel.
 *
 * Client report 06/11/2026: "after a booking I am not getting notifications". Nothing told the
 * shop at all — a booking made on someone's phone appeared on the timeline at the next
 * refresh, and only if somebody happened to be looking at it.
 *
 * Polls `confirmed-since` every 20 seconds, in the background too: the counter tablet is
 * usually showing something else when a booking comes in. The cursor is always the `now` the
 * server last answered with, never the browser's clock — a tablet whose clock is two minutes
 * fast would otherwise skip every booking made in those two minutes.
 *
 * Browsers allow sound and desktop pop-ups only after a click, so the switch is a button:
 * pressing it is the click. Any other click on the panel also wakes the sound, so after a
 * reload it rings again as soon as anyone touches the screen.
 */
export function NewBookingAlerts() {
  const toast = useToast();
  const queryClient = useQueryClient();

  // Mounted only once the session is known, which is after hydration, so storage can be
  // read up front without the server and the browser rendering different words.
  const [on, setOn] = useState(readStoredChoice);
  const [permission, setPermission] = useState<Permission>(currentPermission);

  const cursor = useRef<string | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);
  const onRef = useRef(on);

  useEffect(() => {
    onRef.current = on;
  }, [on]);

  /** Creates or wakes the audio context. Only succeeds inside a click, or after one. */
  const wakeAudio = useCallback((): AudioContext | null => {
    try {
      const Context: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Context === undefined) return null;

      audio.current ??= new Context();
      if (audio.current.state === 'suspended') void audio.current.resume().catch(() => undefined);
      return audio.current;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const unlock = (): void => {
      if (onRef.current) wakeAudio();
    };
    // `pointerup` rather than `pointerdown`: on a touch screen the browser only counts the
    // lift as the gesture, and on a mouse the press before it has already counted.
    window.addEventListener('pointerup', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerup', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [wakeAudio]);

  const announce = useCallback(
    (bookings: NewBookingAlert[]) => {
      // If nobody is looking, the toast stays until dismissed, so it is still there when they are.
      const duration = document.visibilityState === 'visible' ? 30_000 : 0;

      for (const booking of bookings) {
        const when = formatDateTime(booking.startsAt, STORE_TIMEZONE);
        toast.show(`New booking — ${booking.customerName}: ${booking.serviceName}, ${when}`, {
          tone: 'success',
          duration,
        });
        showDesktopNotification(booking, when);
      }

      // One chime per batch: three bookings in one poll is one ring, not a chord.
      const context = audio.current;
      if (context !== null && context.state === 'running') playChime(context);

      void queryClient.invalidateQueries({ queryKey: keys.dashboard });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
    },
    [toast, queryClient],
  );

  /**
   * The poll, on the same pattern as the Help-desk badge in the layout.
   *
   * No retries: the next tick is the retry. A failed poll leaves the cursor where it was, so
   * nothing confirmed in the meantime is lost — it arrives with the next answer.
   */
  useQuery({
    queryKey: keys.bookingAlerts,
    queryFn: async () => {
      const result = await adminClient().bookings.confirmedSince(cursor.current);
      // Switched off while this was in flight: drop it, or the cursor reset by the switch
      // would be overwritten and turning it back on would ring for the gap.
      if (!onRef.current) return result.now;
      cursor.current = result.now;

      // A second guard against announcing the same booking twice, should the server ever
      // hand one back across a page boundary.
      const fresh = result.bookings.filter((booking) => !seen.current.has(booking.id));
      for (const booking of fresh) seen.current.add(booking.id);
      for (const id of seen.current) {
        if (seen.current.size <= SEEN_LIMIT) break;
        seen.current.delete(id);
      }

      if (fresh.length > 0) announce(fresh);
      return result.now;
    },
    enabled: on,
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: false,
  });

  const askPermission = (): void => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    try {
      void Notification.requestPermission()
        .then(setPermission)
        .catch(() => undefined);
    } catch {
      // Very old Safari only takes a callback. Toast and sound still work.
    }
  };

  const toggle = (): void => {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      // Private mode. The choice lasts until the tab closes, which is better than nothing.
    }

    if (next) {
      askPermission();
      // Inside the click, so the browser lets it start — and a ring now is the proof it works.
      const context = wakeAudio();
      if (context !== null) {
        void context
          .resume()
          .then(() => playChime(context))
          .catch(() => undefined);
      }
    } else {
      // Turning it back on starts from then. Otherwise every booking made while it was off
      // would ring at once.
      cursor.current = undefined;
    }
  };

  const caption = !on
    ? 'Nothing rings when someone books.'
    : permission === 'granted'
      ? 'Rings and pops up on this computer when someone books.'
      : permission === 'denied'
        ? 'Rings when someone books. Desktop pop-ups are blocked in this browser’s settings.'
        : permission === 'unsupported'
          ? 'Rings when someone books. This browser cannot show desktop pop-ups.'
          : 'Rings when someone books.';

  return (
    <div className="mb-base flex flex-col gap-xs">
      <Button
        variant={on ? 'secondary' : 'ghost'}
        size="sm"
        fullWidth
        aria-pressed={on}
        onClick={toggle}
        leadingIcon={<BellIcon muted={!on} />}
        className="justify-start"
      >
        Booking alerts: {on ? 'On' : 'Off'}
      </Button>
      <p className="text-caption text-text-muted">{caption}</p>
      {on && permission === 'default' && (
        <button
          type="button"
          onClick={askPermission}
          className="self-start text-caption text-primary underline underline-offset-2"
        >
          Also show desktop pop-ups
        </button>
      )}
    </div>
  );
}

function readStoredChoice(): boolean {
  try {
    return typeof window === 'undefined' || localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // Unreadable storage: on, which is the default anyway.
    return true;
  }
}

function currentPermission(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** The same words as the toast, split into a title and a line. Clicking it brings the panel back. */
function showDesktopNotification(booking: NewBookingAlert, when: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(`New booking — ${booking.customerName}`, {
      body: `${booking.serviceName}, ${when}`,
      // One pop-up per booking, even if two tabs of the panel are open.
      tag: booking.id,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Chrome on Android refuses `new Notification()` outright. The toast and the chime
    // have already gone out.
  }
}

/**
 * A soft two-note chime, made on the spot — no sound file to fetch, cache or lose.
 *
 * E then A, a fourth apart and rising: reads as "something arrived" rather than "something
 * broke", and is short enough not to talk over a customer at the desk.
 */
function playChime(context: AudioContext): void {
  try {
    const start = context.currentTime + 0.02;

    for (const [frequency, offset] of [
      [659.25, 0],
      [880, 0.16],
    ] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + offset;

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      // A quick swell and a long fade; a hard start or stop on a sine wave clicks.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.75);
    }
  } catch {
    // No sound is better than a crashed panel.
  }
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2a4 4 0 0 0-4 4v2.5L2.75 11h10.5L12 8.5V6a4 4 0 0 0-4-4ZM6.5 13a1.5 1.5 0 0 0 3 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {muted && (
        <path d="M2.5 2.5l11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  );
}
