'use client';

import { forwardRef, useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { cn } from '../cn.js';

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
}

/**
 * Label, hint and error wrapper shared by every input type.
 *
 * The wiring — `htmlFor`, `aria-describedby`, `aria-invalid`, `role="alert"` — is the part
 * that gets skipped when each form re-implements its own field, and it is the whole
 * difference between a form a screen reader can complete and one it cannot.
 */
function FieldShell({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldShellProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy =
    [error != null ? errorId : null, hint != null ? hintId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-xs', className)}>
      {label != null && (
        <label htmlFor={inputId} className="text-body-sm font-medium text-text">
          {label}
          {required === true && (
            <span className="text-danger" aria-hidden>
              {' '}
              *
            </span>
          )}
        </label>
      )}

      {children({ inputId, describedBy })}

      {hint != null && error == null && (
        <p id={hintId} className="text-caption text-text-muted">
          {hint}
        </p>
      )}

      {error != null && (
        // Announced when it appears — a validation message a screen reader never reads is a
        // form that silently refuses to submit.
        <p id={errorId} role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL = [
  'w-full min-h-touch rounded-md border bg-surface px-md text-body text-text',
  'placeholder:text-text-muted',
  'transition-[border-color,box-shadow] duration-micro ease-standard',
  'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-describedby'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, containerClassName, className, required, ...props },
  ref,
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      {({ inputId, describedBy }) => (
        <input
          ref={ref}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={error != null || undefined}
          required={required}
          className={cn(CONTROL, error != null ? 'border-danger' : 'border-border', className)}
          {...props}
        />
      )}
    </FieldShell>
  );
});

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'aria-describedby'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, containerClassName, className, required, rows = 3, ...props },
  ref,
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      {({ inputId, describedBy }) => (
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error != null || undefined}
          required={required}
          className={cn(
            CONTROL,
            'py-sm leading-normal',
            error != null ? 'border-danger' : 'border-border',
            className,
          )}
          {...props}
        />
      )}
    </FieldShell>
  );
});

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'aria-describedby'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  containerClassName?: string;
}

/**
 * A styled native `<select>`.
 *
 * Native rather than a custom listbox on purpose: the browser supplies keyboard handling,
 * type-ahead, and — on Android — a picker sized for a thumb. A custom control would have to
 * reimplement all three, and the admin forms have no requirement that needs it.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, containerClassName, className, required, children, ...props },
  ref,
) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      {({ inputId, describedBy }) => (
        <select
          ref={ref}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={error != null || undefined}
          required={required}
          className={cn(
            CONTROL,
            'appearance-none bg-no-repeat pr-xl',
            error != null ? 'border-danger' : 'border-border',
            className,
          )}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%236B7280' stroke-width='1.75' stroke-linecap='round'/%3E%3C/svg%3E\")",
            backgroundPosition: 'right 0.75rem center',
          }}
          {...props}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
});

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label: ReactNode;
  hint?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className, ...props },
  ref,
) {
  const id = useId();
  return (
    <div className="flex items-start gap-sm">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn(
          'mt-0.5 h-5 w-5 shrink-0 rounded-sm border-border text-primary',
          'focus:ring-2 focus:ring-primary focus:ring-offset-0',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
      <div className="flex flex-col">
        {/* The label is the tap target too — a 20px box alone is below the 44px minimum. */}
        <label htmlFor={id} className="text-body-sm text-text cursor-pointer select-none">
          {label}
        </label>
        {hint != null && <span className="text-caption text-text-muted">{hint}</span>}
      </div>
    </div>
  );
});
