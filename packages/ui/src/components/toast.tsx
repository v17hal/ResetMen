'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import { cn } from '../cn.js';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** Milliseconds. 0 keeps it until dismissed — use for anything the user must acknowledge. */
  duration: number;
}

interface ToastContextValue {
  show: (message: string, options?: { tone?: ToastTone; duration?: number }) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast must be used inside a <ToastProvider>.');
  }
  return context;
}

const TONES: Record<ToastTone, string> = {
  success: 'border-success/40 bg-success/10 text-text',
  error: 'border-danger/40 bg-danger/10 text-text',
  info: 'border-border bg-surface text-text',
};

/**
 * Transient messages.
 *
 * Hand-rolled rather than another dependency, because the accessible surface is small: an
 * `aria-live` region and a dismiss button. The two decisions worth knowing:
 *
 *  - **Errors are `assertive` and never auto-dismiss.** A failed refund that vanishes after
 *    four seconds is a failed refund nobody saw.
 *  - **Timers are cleared on unmount and on manual dismiss**, so a route change mid-toast
 *    does not leave a `setTimeout` holding a reference to a dead component.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  /** Never more than this many at once, oldest dropped first. */
  const MAX_VISIBLE = 3;

  const show = useCallback<ToastContextValue['show']>(
    (message, options = {}) => {
      const tone = options.tone ?? 'info';
      const duration = options.duration ?? (tone === 'error' ? 0 : 4000);
      const id = nextId.current++;

      setToasts((current) => {
        /**
         * The same message twice is one message.
         *
         * Errors never auto-dismiss, which is right for something like a failed refund that
         * nobody should be able to miss. On a form it was a trap: pressing Save four times
         * with a bad email produced four identical, permanent notices that stacked down the
         * screen and covered the very fields being corrected. A tester reported the form as
         * unusable, and they were right.
         *
         * Repeating a message that is already on screen tells the reader nothing they
         * cannot already see, so the existing one is kept and moved to the end instead.
         */
        const withoutDuplicate = current.filter((toast) => toast.message !== message);
        const next = [...withoutDuplicate, { id, tone, message, duration }];

        // A hard ceiling as well, for different messages in quick succession. Beyond three
        // the newest are the ones worth reading, and the screen is worth more than the
        // backlog.
        const dropped = next.slice(0, Math.max(0, next.length - MAX_VISIBLE));
        for (const toast of dropped) {
          const timer = timers.current.get(toast.id);
          if (timer !== undefined) {
            clearTimeout(timer);
            timers.current.delete(toast.id);
          }
        }

        return next.slice(-MAX_VISIBLE);
      });

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  const success = useCallback(
    (message: string) => show(message, { tone: 'success' }),
    [show],
  );
  const error = useCallback((message: string) => show(message, { tone: 'error' }), [show]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(
    () => ({ show, success, error, dismiss }),
    [show, success, error, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-sm p-base bottom-[calc(var(--reset-layout-bottom-nav-height,0px)+env(safe-area-inset-bottom))] sm:bottom-auto sm:right-0 sm:top-0 sm:items-end"
        // Two regions, because politeness cannot vary per message inside one.
        aria-live="polite"
      >
        {toasts
          .filter((toast) => toast.tone !== 'error')
          .map((toast) => (
            <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
      </div>
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-sm p-base bottom-[calc(var(--reset-layout-bottom-nav-height,0px)+env(safe-area-inset-bottom))] sm:bottom-auto sm:right-0 sm:top-0 sm:items-end"
        aria-live="assertive"
        role="alert"
      >
        {toasts
          .filter((toast) => toast.tone === 'error')
          .map((toast) => (
            <ToastRow key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-sm rounded-md border px-base py-sm shadow-raised',
        'animate-rise-in',
        TONES[toast.tone],
      )}
    >
      <p className="flex-1 text-body-sm">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="-mr-xs shrink-0 rounded-sm p-xs text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M12 4L4 12M4 4l8 8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
