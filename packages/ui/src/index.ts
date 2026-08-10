/**
 * `@reset/ui` — primitives, formatting and motion shared by the web and admin apps.
 *
 * Consumed as TypeScript source rather than as a build artifact: both consumers are Next
 * apps that already compile TypeScript, and a build step here would mean rebuilding the
 * package on every component edit for no gain.
 *
 * Domain components deliberately live in the app that owns them. SlotGrid is customer-only,
 * StationTimeline is admin-only, and putting either here would create a shared dependency
 * on a screen only one surface has.
 */

export { cn } from './cn.js';

export {
  addDays,
  formatBookingCode,
  formatBytes,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatPercent,
  formatPhone,
  formatRelativeDay,
  formatTime,
  formatTimeRange,
  paiseToRupees,
  rupeesToPaise,
  secondsUntil,
  toLocalDate,
  todayLocal,
} from './format.js';

export { stagger, staggerStyle, useReducedMotion } from './motion.js';

export { Button } from './components/button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button.js';

export { Spinner } from './components/spinner.js';
export type { SpinnerProps } from './components/spinner.js';

export { Checkbox, Input, Select, Textarea } from './components/field.js';
export type {
  CheckboxProps,
  InputProps,
  SelectProps,
  TextareaProps,
} from './components/field.js';

export { Card, StatTile } from './components/card.js';
export type { CardProps, StatTileProps } from './components/card.js';

export { Badge, BookingStatusBadge, PaymentStatusBadge } from './components/badge.js';
export type { BadgeProps, BadgeTone } from './components/badge.js';

export {
  EmptyState,
  ErrorState,
  LoadingState,
  Skeleton,
  SkeletonList,
} from './components/states.js';
export type {
  EmptyStateProps,
  ErrorStateProps,
  LoadingStateProps,
  SkeletonProps,
} from './components/states.js';

export { ConfirmDialog, Dialog } from './components/dialog.js';
export type { ConfirmDialogProps, DialogProps } from './components/dialog.js';

export { ToastProvider, useToast } from './components/toast.js';
export type { Toast, ToastTone } from './components/toast.js';

export { DataTable } from './components/table.js';
export type { Column, DataTableProps } from './components/table.js';
