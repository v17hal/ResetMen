'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

import { cn } from '../cn.js';
import { Button } from './button.js';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** On mobile a sheet slides up from the bottom; on desktop both render centred. */
  variant?: 'dialog' | 'sheet';
  className?: string;
}

/**
 * Modal dialog, and the bottom sheet variant, over Radix.
 *
 * Radix rather than hand-rolled because the invisible parts are the hard parts: focus moves
 * into the dialog and is trapped there, Escape and the overlay close it, focus returns to
 * whatever opened it, the page behind stops scrolling, and the rest of the tree is hidden
 * from screen readers. Each is a separate bug when written by hand, and each is invisible
 * until someone who needs it hits it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = 'dialog',
  className,
}: DialogProps) {
  const isSheet = variant === 'sheet';

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-fade-in',
          )}
        />
        <RadixDialog.Content
          className={cn(
            'fixed z-50 flex flex-col gap-base bg-surface shadow-overlay focus:outline-none',
            // Wraps rather than overflowing, whatever is in the description.
            'break-words',
            /**
             * Centred by `m-auto` inside a full-viewport inset, never by `transform`.
             *
             * The obvious way to centre a fixed box is `top-1/2 left-1/2` with a
             * `-translate-1/2` to pull it back by half its own size. That is what this did,
             * and it did not work, because `animate-scale-in` sets `transform: scale(...)`
             * with `animation-fill-mode: both`. Transform is one property: the animation's
             * value replaces the translate outright rather than combining with it, and the
             * fill mode makes that permanent. So the box kept `left: 50%; top: 50%` with
             * nothing pulling it back, and every centred dialog in the panel hung down and
             * to the right from the middle of the screen with its footer off the bottom.
             *
             * A tall form made it obvious — the Save button was unreachable, and shrinking
             * the window appeared to fix it because less of the box then fell below the
             * fold. Capping the height was a real fix for a real second problem and did
             * nothing about this one: a shorter box hanging from the centre is still
             * hanging from the centre.
             *
             * `inset-0` + `m-auto` + `h-fit` centres on both axes using margins, which no
             * transform can interfere with. The animation is then free to scale the box
             * about its own middle, which is all it was ever meant to do.
             */
            isSheet
              ? [
                  'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl p-lg',
                  'data-[state=open]:animate-slide-up',
                  // Above the tab bar, and clear of the home indicator on a gesture phone.
                  'pb-[max(1.25rem,env(safe-area-inset-bottom))]',
                  'sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[calc(100dvh-2rem)]',
                  'sm:w-full sm:max-w-md sm:rounded-lg sm:data-[state=open]:animate-scale-in',
                ]
              : [
                  // `max-w-[min(...)]` as well as the width: a long unbroken word — a
                  // booking code, an email — was widening the box past the viewport and
                  // pushing half the dialog and both buttons off the right of a phone.
                  'inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)]',
                  'w-[calc(100%-2rem)] max-w-[min(28rem,calc(100vw-2rem))]',
                  'rounded-lg p-lg data-[state=open]:animate-scale-in',
                ],
            className,
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-base">
            <div className="flex flex-col gap-xs">
              <RadixDialog.Title className="font-display text-h2 text-text">
                {title}
              </RadixDialog.Title>
              {description != null && (
                <RadixDialog.Description className="text-body-sm text-text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="sm" aria-label="Close" className="-mr-sm -mt-sm px-sm">
                <CloseIcon />
              </Button>
            </RadixDialog.Close>
          </div>

          {/* `min-h-0` is what lets this shrink inside the flex column; without it the
              body claims its full height and pushes the footer out of the box again. */}
          {children != null && (
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          )}

          {footer != null && (
            <div className="flex shrink-0 flex-col-reverse gap-sm sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

/**
 * "Are you sure?" for anything that cannot be undone.
 *
 * The confirm button is never focused on open — the default focus lands on Cancel, so an
 * Enter keypress already in flight does not confirm a refund.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      // A bottom sheet on a phone: full width, nothing to run off the edge, and the buttons
      // land under the thumb rather than in the middle of the screen. Reverts to a centred
      // box from `sm` upwards.
      variant="sheet"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M12 4L4 12M4 4l8 8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
