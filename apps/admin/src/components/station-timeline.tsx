'use client';

import type { TimelineDto } from '@reset/api-client';
import { cn, formatTime } from '@reset/ui';
import { useEffect, useState } from 'react';

import { hourIn, isoAtMinute, localDateIn } from '@/lib/time.js';

/** Pixels per hour. Wide enough that a 15-minute booking is still a readable block. */
const HOUR_HEIGHT = 96;
const MINUTE_HEIGHT = HOUR_HEIGHT / 60;

export interface StationTimelineProps {
  data: TimelineDto;
  onSelectBooking: (bookingId: string) => void;
  /** Clicking empty space on a station starts a walk-in at that time. */
  onSelectSlot?: (params: { stationId: string; startsAt: string }) => void;
}

/**
 * The day, by station.
 *
 * A vertical scale rather than horizontal: stations are few and the day is long, so columns
 * for stations and rows for time keeps every station visible without sideways scrolling on
 * a counter tablet.
 *
 * Buffer time is drawn as a separate hatched band below each booking. It is not bookable and
 * it is not the session — showing it as either produces an argument about why a station
 * "looks free" when it is being wiped down.
 */
export function StationTimeline({ data, onSelectBooking, onSelectSlot }: StationTimelineProps) {
  const zone = data.timezone;
  const bounds = dayBounds(data);
  const nowOffset = useNowOffset(data.date, zone, bounds);

  const hours = Array.from(
    { length: bounds.endHour - bounds.startHour + 1 },
    (_, i) => bounds.startHour + i,
  );

  const height = (bounds.endHour - bounds.startHour) * HOUR_HEIGHT;

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <div className="flex min-w-max">
        {/* Hour gutter */}
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border bg-surface">
          <div className="h-10 border-b border-border" />
          <div className="relative" style={{ height }}>
            {hours.slice(0, -1).map((hour, index) => (
              <div
                key={hour}
                className="absolute right-sm text-caption tabular-nums text-text-muted"
                style={{ top: index * HOUR_HEIGHT - 6 }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>
        </div>

        {data.stations.map((station) => (
          <div key={station.id} className="w-44 shrink-0 border-r border-border last:border-r-0">
            <div className="flex h-10 items-center justify-center border-b border-border px-sm">
              <span className="truncate text-body-sm font-medium">{station.name}</span>
            </div>

            <div className="relative" style={{ height }}>
              {/* Hour lines */}
              {hours.slice(0, -1).map((hour, index) => (
                <div
                  key={hour}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: index * HOUR_HEIGHT }}
                />
              ))}

              {/* Clicking empty space starts a walk-in at that time. */}
              {onSelectSlot !== undefined && (
                <button
                  type="button"
                  aria-label={`Add a walk-in on ${station.name}`}
                  className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    const minutes = (event.clientY - box.top) / MINUTE_HEIGHT;
                    onSelectSlot({
                      stationId: station.id,
                      startsAt: isoAtMinute(data.date, zone, bounds.startHour * 60 + minutes),
                    });
                  }}
                />
              )}

              {station.blackouts.map((blackout, index) => {
                const top = offsetMinutes(blackout.startsAt, zone, bounds) * MINUTE_HEIGHT;
                const bottom = offsetMinutes(blackout.endsAt, zone, bounds) * MINUTE_HEIGHT;
                return (
                  <div
                    key={index}
                    title={blackout.reason ?? 'Closed'}
                    className="pointer-events-none absolute inset-x-1 rounded-sm bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgb(0_0_0/0.08)_6px,rgb(0_0_0/0.08)_12px)]"
                    style={{ top, height: Math.max(4, bottom - top) }}
                  />
                );
              })}

              {station.bookings.map((booking) => {
                const start = offsetMinutes(booking.startsAt, zone, bounds);
                const end = offsetMinutes(booking.endsAt, zone, bounds);
                const bufferEnd = offsetMinutes(booking.bufferEndsAt, zone, bounds);

                return (
                  <div key={booking.id}>
                    {bufferEnd > end && (
                      <div
                        aria-hidden
                        title="Cleaning time"
                        className="pointer-events-none absolute inset-x-1 rounded-b-sm border border-t-0 border-border bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgb(0_0_0/0.06)_4px,rgb(0_0_0/0.06)_8px)]"
                        style={{
                          top: end * MINUTE_HEIGHT,
                          height: (bufferEnd - end) * MINUTE_HEIGHT,
                        }}
                      />
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectBooking(booking.id)}
                      className={cn(
                        'absolute inset-x-1 overflow-hidden rounded-sm border px-xs py-0.5 text-left',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        STATUS_STYLES[booking.status] ?? STATUS_STYLES.CONFIRMED,
                      )}
                      style={{
                        top: start * MINUTE_HEIGHT,
                        height: Math.max(20, (end - start) * MINUTE_HEIGHT - 1),
                      }}
                    >
                      <span className="block truncate text-caption font-medium">
                        {formatTime(booking.startsAt, zone)} {booking.customerName}
                      </span>
                      <span className="block truncate text-caption opacity-80">
                        {booking.serviceName}
                      </span>
                    </button>
                  </div>
                );
              })}

              {/* Now line. Only drawn when the viewed day is actually today. */}
              {nowOffset !== null && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger"
                  style={{ top: nowOffset * MINUTE_HEIGHT }}
                >
                  <span className="absolute -top-1.5 -left-1 h-2.5 w-2.5 rounded-full bg-danger" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  HELD: 'border-warning/40 bg-warning/15 text-text',
  CONFIRMED: 'border-primary/40 bg-primary/15 text-text',
  CHECKED_IN: 'border-info/50 bg-info/20 text-text',
  IN_PROGRESS: 'border-info/50 bg-info/25 text-text',
  COMPLETED: 'border-border bg-surface2 text-text-muted',
  NO_SHOW: 'border-danger/40 bg-danger/10 text-text-muted line-through',
};

/**
 * The vertical extent of the grid.
 *
 * Derived from what is actually on the day rather than from store hours, so a booking that
 * runs past closing — or a blackout that starts before opening — is still visible. A
 * timeline that silently clips a real booking is worse than one that scrolls.
 */
function dayBounds(data: TimelineDto): { startHour: number; endHour: number } {
  const instants = data.stations.flatMap((station) => [
    ...station.bookings.flatMap((b) => [b.startsAt, b.bufferEndsAt]),
    ...station.blackouts.flatMap((b) => [b.startsAt, b.endsAt]),
  ]);

  if (instants.length === 0) return { startHour: 9, endHour: 22 };

  const hours = instants.map((iso) => hourIn(iso, data.timezone));
  const startHour = Math.max(0, Math.floor(Math.min(...hours)));
  const endHour = Math.min(24, Math.ceil(Math.max(...hours)) + 1);

  return { startHour, endHour: Math.max(endHour, startHour + 1) };
}

function offsetMinutes(
  iso: string,
  timeZone: string,
  bounds: { startHour: number },
): number {
  return Math.max(0, (hourIn(iso, timeZone) - bounds.startHour) * 60);
}

function formatHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? 'am' : 'pm'}`;
}

/** Minutes from the top of the grid to now, or null when the viewed day is not today. */
function useNowOffset(
  date: string,
  timeZone: string,
  bounds: { startHour: number; endHour: number },
): number | null {
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const compute = (): void => {
      const now = new Date();
      if (localDateIn(timeZone, now) !== date) {
        setOffset(null);
        return;
      }

      const hour = hourIn(now.toISOString(), timeZone);
      setOffset(
        hour < bounds.startHour || hour > bounds.endHour
          ? null
          : (hour - bounds.startHour) * 60,
      );
    };

    compute();
    // A minute is enough. The line moves 1.6px per minute at this scale.
    const timer = setInterval(compute, 60_000);
    return () => clearInterval(timer);
  }, [date, timeZone, bounds.startHour, bounds.endHour]);

  return offset;
}
