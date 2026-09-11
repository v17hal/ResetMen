'use client';

import { cn } from '@reset/ui';

/**
 * An on/off switch that says which it is.
 *
 * The allocation-rule list used to show an "Off" badge on a paused rule and nothing at all
 * on a running one — so a running rule looked like a rule with a missing control, and the
 * owner reported that there was no way to switch rules on or off. There wasn't. This is it,
 * with the state written next to the switch rather than left to the colour.
 *
 * Stops the click from reaching the row, which opens the edit dialog.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Read by screen readers: "Morning ₹199 push". The state is announced separately. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'inline-flex min-h-touch items-center gap-sm rounded-full px-xs',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-micro',
          checked ? 'bg-primary' : 'bg-border',
        )}
      >
        {/* Pinned with an explicit `left`. Left to its automatic position, the browser put
            the knob 22px in *and then* translated it another 22px — measured — so "on"
            parked it outside the track, over the word "On". */}
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-card transition-transform duration-micro',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
      <span className={cn('text-caption font-medium', checked ? 'text-primary' : 'text-text-muted')}>
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  );
}
