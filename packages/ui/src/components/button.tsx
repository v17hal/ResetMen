'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../cn.js';
import { Spinner } from './spinner.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks. Keeps its width so the layout does not jump. */
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90 active:opacity-80',
  secondary:
    'bg-surface text-text border border-border hover:bg-surface2 active:bg-surface2',
  ghost: 'bg-transparent text-text hover:bg-surface2 active:bg-surface2',
  danger: 'bg-danger text-white hover:opacity-90 active:opacity-80',
};

const SIZES: Record<ButtonSize, string> = {
  // Every size clears the 44px minimum tap target from docs/08 §2.3, including `sm` —
  // a button that is only comfortable on a mouse is a button the counter staff will miss.
  sm: 'min-h-touch px-md text-body-sm rounded-md gap-xs',
  md: 'min-h-touch px-base text-body rounded-md gap-sm',
  lg: 'min-h-touch-admin px-lg text-body rounded-lg gap-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    className,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Defaults to "button". A bare <button> inside a form submits it, which is how a
      // "Cancel" next to "Save" ends up saving.
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-body font-medium',
        'transition-[opacity,background-color] duration-micro ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="h-4 w-4" /> : leadingIcon}
      {children}
      {loading ? null : trailingIcon}
    </button>
  );
});
