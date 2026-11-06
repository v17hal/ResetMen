'use client';

import type {
  AdminCampaignRow,
  AdminCouponRow,
  CustomerSummary,
  RewardType,
  ScratchTrigger,
} from '@reset/api-client';
import type { CouponInput } from '@reset/types';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Input,
  Select,
  Textarea,
  formatMoney,
  formatPercent,
  formatPhone,
  paiseToRupees,
  rupeesToPaise,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';
import {
  STORE_TIMEZONE,
  isoToLocalInput,
  localDateIn,
  localDateToIso,
  localInputToIso,
} from '@/lib/time';
import { useDebounced } from '@/lib/use-debounced';

const TRIGGERS: ReadonlyArray<{ value: ScratchTrigger; label: string; hint: string }> = [
  { value: 'ON_CHECKIN', label: 'Every check-in', hint: 'A card each time someone arrives.' },
  {
    value: 'ON_NTH_BOOKING',
    label: 'On their nth booking',
    hint: 'One card, at the booking number set below.',
  },
  {
    value: 'ON_STREAK_COMPLETE',
    label: 'When a streak completes',
    hint: 'A card when a streak rule pays out.',
  },
];

const REWARD_TYPES: ReadonlyArray<{ value: RewardType; label: string; unit: string }> = [
  { value: 'PERCENT_OFF', label: 'Percent off', unit: '%' },
  { value: 'FLAT_OFF', label: 'Flat amount off', unit: '₹' },
  { value: 'FREE_SERVICE', label: 'Free service', unit: '₹ cap (0 = uncapped)' },
  { value: 'FREE_ADDON', label: 'Free add-on', unit: '₹ cap (0 = uncapped)' },
  { value: 'CASHBACK', label: 'Cashback after the visit', unit: '₹' },
];

export default function RewardsPage() {
  // Codes first: they are the newest lever (client request 06/11/2026) and the one that
  // changes with every promotion. Streak rules are set once and left alone.
  const [tab, setTab] = useState<'coupons' | 'streaks' | 'campaigns' | 'grants'>('coupons');

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Rewards</h1>
        <p className="text-body-sm text-text-muted">
          Codes are for promotions. Streaks reward coming back. Scratch cards reward turning up.
        </p>
      </header>

      <div role="tablist" className="flex flex-wrap gap-xs">
        {(
          [
            ['coupons', 'Coupon codes'],
            ['streaks', 'Streak rules'],
            ['campaigns', 'Scratch campaigns'],
            ['grants', 'Manual grant'],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === 'coupons' ? (
        <Coupons />
      ) : tab === 'streaks' ? (
        <StreakRules />
      ) : tab === 'campaigns' ? (
        <Campaigns />
      ) : (
        <Grant />
      )}
    </div>
  );
}

// ── Coupon codes ────────────────────────────────────────────────────────────

/**
 * Codes customers type at checkout — RESET20 on a poster. Client request 06/11/2026.
 *
 * There is no delete, on the server or here: bookings keep pointing at the code they used,
 * and its uses column is the record of what a promotion cost. Turning one off is an update
 * with `isActive: false` that sends the rest of the row back unchanged.
 */
function Coupons() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminCouponRow | 'new' | null>(null);
  const [turningOff, setTurningOff] = useState<AdminCouponRow | null>(null);

  const coupons = useQuery({
    queryKey: keys.coupons,
    queryFn: () => adminClient().rewards.coupons(),
  });

  const setRunning = useMutation({
    mutationFn: ({ coupon, isActive }: { coupon: AdminCouponRow; isActive: boolean }) =>
      adminClient().rewards.updateCoupon(coupon.id, { ...couponInputFrom(coupon), isActive }),
    onSuccess: (_result, { coupon, isActive }) => {
      toast.success(
        isActive
          ? `${coupon.code} is on. Customers can use it again.`
          : `${coupon.code} turned off. Customers can no longer use it.`,
      );
      setTurningOff(null);
      void queryClient.invalidateQueries({ queryKey: keys.coupons });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (coupons.isError) {
    return (
      <ErrorState description={errorMessage(coupons.error)} onRetry={() => void coupons.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        Customers type the code at checkout on the website and in the app. A booking takes one
        code or one wallet reward, never both. Cashback codes take nothing off at checkout —
        the amount comes back after the visit, as a voucher in their wallet.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ New code</Button>
      </div>

      <DataTable
        loading={coupons.isPending}
        rows={coupons.data ?? []}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{
          title: 'No codes yet',
          description: 'Make one for a poster or a post — RESET20, DIWALI.',
        }}
        columns={[
          {
            key: 'code',
            header: 'Code',
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-mono font-medium">{row.code}</span>
                {row.note !== null && row.note !== '' && (
                  <span className="text-caption text-text-muted">{row.note}</span>
                )}
              </div>
            ),
          },
          {
            key: 'gives',
            header: 'Gives',
            cell: (row) => (
              <div className="flex flex-col">
                <span>{row.label}</span>
                {row.minOrderPaise > 0 && (
                  <span className="text-caption text-text-muted">
                    min {formatMoney(row.minOrderPaise)}
                  </span>
                )}
              </div>
            ),
          },
          { key: 'valid', header: 'Valid', cell: (row) => validWindow(row) },
          {
            key: 'used',
            header: 'Used',
            align: 'right',
            cell: (row) => (
              <div className="flex flex-col items-end">
                <span>{row.maxUses === null ? row.uses : `${row.uses} of ${row.maxUses}`}</span>
                {row.maxUsesPerCustomer !== null && (
                  <span className="text-caption text-text-muted">
                    {row.maxUsesPerCustomer} per customer
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'active',
            header: '',
            align: 'right',
            cell: (row) => (row.isActive ? <Badge tone="success">Running</Badge> : <Badge>Off</Badge>),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (row) => (
              <div className="flex justify-end gap-xs">
                <Button variant="secondary" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                {row.isActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => setTurningOff(row)}
                  >
                    Turn off
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={setRunning.isPending && setRunning.variables?.coupon.id === row.id}
                    onClick={() => setRunning.mutate({ coupon: row, isActive: true })}
                  >
                    Turn on
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={turningOff !== null}
        onOpenChange={(open) => {
          if (!open) setTurningOff(null);
        }}
        title={`Turn off ${turningOff?.code ?? ''}?`}
        description={
          'Customers who type it at checkout will be told it is no longer active. Bookings ' +
          'already made with it keep their discount, and a cashback code still pays out after ' +
          'the visit. It stays in this list and can be turned back on.'
        }
        confirmLabel="Yes, turn it off"
        cancelLabel="Leave it on"
        destructive
        loading={setRunning.isPending}
        onConfirm={() =>
          turningOff !== null && setRunning.mutate({ coupon: turningOff, isActive: false })
        }
      />

      <CouponDialog coupon={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** The coupon form, as strings, because inputs hold strings. Empty means none or unlimited. */
interface CouponDraft {
  code: string;
  rewardType: RewardType;
  rewardValue: string;
  minOrder: string;
  /** `YYYY-MM-DD`, a day in the store. */
  validFrom: string;
  validTill: string;
  maxUses: string;
  maxUsesPerCustomer: string;
  note: string;
  isActive: boolean;
}

function draftFrom(coupon: AdminCouponRow | null): CouponDraft {
  if (coupon === null) {
    return {
      code: '',
      rewardType: 'PERCENT_OFF',
      rewardValue: '20',
      minOrder: '',
      validFrom: '',
      validTill: '',
      maxUses: '',
      // One each is what a code usually means, and the server's own default.
      maxUsesPerCustomer: '1',
      note: '',
      isActive: true,
    };
  }

  return {
    code: coupon.code,
    rewardType: coupon.rewardType,
    // Money is stored in paise and typed in rupees; percentages are neither.
    rewardValue: String(
      isMoney(coupon.rewardType) ? paiseToRupees(coupon.rewardValue) : coupon.rewardValue,
    ),
    minOrder: coupon.minOrderPaise === 0 ? '' : String(paiseToRupees(coupon.minOrderPaise)),
    validFrom:
      coupon.validFrom === null ? '' : localDateIn(STORE_TIMEZONE, new Date(coupon.validFrom)),
    validTill:
      coupon.validTill === null ? '' : localDateIn(STORE_TIMEZONE, new Date(coupon.validTill)),
    maxUses: coupon.maxUses === null ? '' : String(coupon.maxUses),
    maxUsesPerCustomer:
      coupon.maxUsesPerCustomer === null ? '' : String(coupon.maxUsesPerCustomer),
    note: coupon.note ?? '',
    isActive: coupon.isActive,
  };
}

function CouponDialog({
  coupon,
  onClose,
}: {
  coupon: AdminCouponRow | 'new' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isNew = coupon === 'new';
  const existing = coupon === 'new' || coupon === null ? null : coupon;

  const [form, setForm] = useState<CouponDraft>(() => draftFrom(null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(draftFrom(existing));
    setError(null);
  }, [existing, isNew]);

  const save = useMutation({
    mutationFn: () => {
      const input: CouponInput = {
        code: form.code,
        note: form.note.trim() === '' ? null : form.note.trim(),
        rewardType: form.rewardType,
        rewardValue: isMoney(form.rewardType)
          ? rupeesToPaise(Number(form.rewardValue))
          : Number(form.rewardValue),
        minOrderPaise: form.minOrder.trim() === '' ? 0 : rupeesToPaise(Number(form.minOrder)),
        // Whole days in the store: from the first minute of the start day to the last
        // second of the end day, so "until the 30th" includes the 30th.
        validFrom:
          form.validFrom === '' ? null : localDateToIso(form.validFrom, STORE_TIMEZONE, 'start'),
        validTill:
          form.validTill === '' ? null : localDateToIso(form.validTill, STORE_TIMEZONE, 'end'),
        maxUses: form.maxUses.trim() === '' ? null : Number(form.maxUses),
        maxUsesPerCustomer:
          form.maxUsesPerCustomer.trim() === '' ? null : Number(form.maxUsesPerCustomer),
        isActive: form.isActive,
      };

      return isNew
        ? adminClient().rewards.createCoupon(input)
        : adminClient().rewards.updateCoupon(existing!.id, input);
    },
    onSuccess: (saved) => {
      toast.success(isNew ? `${saved.code} created.` : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.coupons });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (coupon === null) return null;

  const unit = REWARD_TYPES.find((type) => type.value === form.rewardType)?.unit ?? '';
  const value = Number(form.rewardValue);

  // The server checks all of this too, mostly in these words. Checking first keeps Create
  // greyed out until the form can actually succeed.
  const problem = !/^[A-Z0-9]{3,20}$/.test(form.code)
    ? 'A code is 3 to 20 letters or digits.'
    : form.rewardValue.trim() === '' || !Number.isFinite(value) || value < 0
      ? 'Say what the code gives.'
      : form.rewardType === 'PERCENT_OFF' && (!Number.isInteger(value) || value < 1 || value > 100)
        ? 'A percentage is a whole number from 1 to 100.'
        : (form.rewardType === 'FLAT_OFF' || form.rewardType === 'CASHBACK') && value === 0
          ? 'A code worth ₹0 gives nothing.'
          : form.minOrder.trim() !== '' &&
              (!Number.isFinite(Number(form.minOrder)) || Number(form.minOrder) < 0)
            ? 'The minimum booking is an amount in rupees, or empty for none.'
            : !isBlankOrCount(form.maxUses)
              ? 'Total uses is a whole number, or empty for unlimited.'
              : !isBlankOrCount(form.maxUsesPerCustomer)
                ? 'Uses per customer is a whole number, or empty for unlimited.'
                : form.validFrom !== '' && form.validTill !== '' && form.validFrom > form.validTill
                  ? 'The code must start before it ends.'
                  : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={isNew ? 'New code' : 'Edit code'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={problem !== null}
            onClick={() => save.mutate()}
          >
            {isNew ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        <Input
          label="Code"
          required
          value={form.code}
          maxLength={20}
          autoComplete="off"
          // Shown as it will be stored: the server upper-cases it and drops spaces anyway.
          onChange={(event) =>
            setForm((c) => ({ ...c, code: event.target.value.replace(/\s+/g, '').toUpperCase() }))
          }
          className="font-mono"
          hint="Letters and digits, e.g. RESET20. Customers can type it in any case."
        />

        <div className="flex flex-col gap-base sm:flex-row">
          <Select
            label="Gives"
            value={form.rewardType}
            onChange={(event) =>
              setForm((c) => ({ ...c, rewardType: event.target.value as RewardType }))
            }
            containerClassName="flex-1"
          >
            {REWARD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
          <Input
            label={`Value (${unit})`}
            type="number"
            min={0}
            value={form.rewardValue}
            onChange={(event) => setForm((c) => ({ ...c, rewardValue: event.target.value }))}
            containerClassName="flex-1"
          />
        </div>

        <Input
          label="Minimum booking (₹)"
          type="number"
          min={0}
          value={form.minOrder}
          onChange={(event) => setForm((c) => ({ ...c, minOrder: event.target.value }))}
          hint="Leave empty for no minimum."
        />

        <div className="flex flex-col gap-base sm:flex-row">
          <Input
            label="Starts (optional)"
            type="date"
            value={form.validFrom}
            onChange={(event) => setForm((c) => ({ ...c, validFrom: event.target.value }))}
            containerClassName="flex-1"
            hint="Leave empty to work as soon as it is on."
          />
          <Input
            label="Ends (optional)"
            type="date"
            value={form.validTill}
            onChange={(event) => setForm((c) => ({ ...c, validTill: event.target.value }))}
            containerClassName="flex-1"
            hint="Works until the end of that day. Empty runs until turned off."
          />
        </div>

        <div className="flex flex-col gap-base sm:flex-row">
          <Input
            label="Total uses"
            type="number"
            min={1}
            value={form.maxUses}
            onChange={(event) => setForm((c) => ({ ...c, maxUses: event.target.value }))}
            containerClassName="flex-1"
            hint="Across everyone. Empty for unlimited. A cancelled booking gives its use back."
          />
          <Input
            label="Uses per customer"
            type="number"
            min={1}
            value={form.maxUsesPerCustomer}
            onChange={(event) =>
              setForm((c) => ({ ...c, maxUsesPerCustomer: event.target.value }))
            }
            containerClassName="flex-1"
            hint="Empty for unlimited."
          />
        </div>

        <Input
          label="Note for staff"
          value={form.note}
          maxLength={120}
          onChange={(event) => setForm((c) => ({ ...c, note: event.target.value }))}
          hint="Optional, e.g. “Diwali poster”. Customers never see it."
        />

        <Checkbox
          label="Running"
          hint="Off means anyone who types it is told it is no longer active."
          checked={form.isActive}
          onChange={(event) => setForm((c) => ({ ...c, isActive: event.target.checked }))}
        />

        {problem !== null && <p className="text-caption text-danger">{problem}</p>}
        {error !== null && <p className="text-caption text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/** A listed code, sent back as it is — how Turn off and Turn on change one field and no other. */
function couponInputFrom(coupon: AdminCouponRow): CouponInput {
  return {
    code: coupon.code,
    note: coupon.note,
    rewardType: coupon.rewardType,
    rewardValue: coupon.rewardValue,
    minOrderPaise: coupon.minOrderPaise,
    validFrom: coupon.validFrom,
    validTill: coupon.validTill,
    maxUses: coupon.maxUses,
    maxUsesPerCustomer: coupon.maxUsesPerCustomer,
    isActive: coupon.isActive,
  };
}

/** Empty, or a whole number of at least one — the two things a uses limit can be. */
function isBlankOrCount(value: string): boolean {
  if (value.trim() === '') return true;
  const count = Number(value);
  return Number.isInteger(count) && count >= 1;
}

/** "Until 30 Nov", "From 1 Dec", "Always" — when a code works, in the store's days. */
function validWindow({ validFrom, validTill }: AdminCouponRow): string {
  const now = Date.now();

  if (validTill !== null && new Date(validTill).getTime() < now) {
    return `Ended ${dayMonth(validTill)}`;
  }
  if (validFrom !== null && new Date(validFrom).getTime() > now) {
    return validTill === null
      ? `From ${dayMonth(validFrom)}`
      : `${dayMonth(validFrom)} – ${dayMonth(validTill)}`;
  }
  return validTill === null ? 'Always' : `Until ${dayMonth(validTill)}`;
}

/** `30 Nov`, read in the store's timezone whatever the tablet is set to. */
function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: STORE_TIMEZONE,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

// ── Streak rules ────────────────────────────────────────────────────────────

interface StreakRuleRow {
  id: string;
  name: string;
  requiredVisits: number;
  withinDays: number;
  rewardType: RewardType;
  rewardValue: number;
  validityDays: number;
  isActive: boolean;
}

function StreakRules() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StreakRuleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StreakRuleRow | null>(null);

  const rules = useQuery({
    queryKey: keys.streakRules,
    queryFn: () => adminClient().rewards.streakRules() as Promise<StreakRuleRow[]>,
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminClient().rewards.deleteStreakRule(id),
    onSuccess: () => {
      toast.success('Rule turned off. Nobody new can earn it.');
      void queryClient.invalidateQueries({ queryKey: keys.streakRules });
      setDeleting(null);
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const [form, setForm] = useState({
    name: '',
    requiredVisits: '5',
    withinDays: '30',
    rewardType: 'FLAT_OFF' as RewardType,
    rewardValue: '100',
    validityDays: '30',
  });
  const [error, setError] = useState<string | null>(null);
  const existing = editing === 'new' || editing === null ? null : editing;

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      requiredVisits: String(existing?.requiredVisits ?? 5),
      withinDays: String(existing?.withinDays ?? 30),
      rewardType: existing?.rewardType ?? 'FLAT_OFF',
      rewardValue: String(
        existing === null
          ? 100
          : existing.rewardType === 'PERCENT_OFF'
            ? existing.rewardValue
            : existing.rewardValue / 100,
      ),
      validityDays: String(existing?.validityDays ?? 30),
    });
    setError(null);
  }, [existing, editing]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: form.name.trim(),
        requiredVisits: Number(form.requiredVisits),
        withinDays: Number(form.withinDays),
        rewardType: form.rewardType,
        // Percent is a plain number; every other type is money, and money is paise.
        rewardValue:
          form.rewardType === 'PERCENT_OFF'
            ? Number(form.rewardValue)
            : rupeesToPaise(Number(form.rewardValue)),
        rewardServiceId: null,
        validityDays: Number(form.validityDays),
        isActive: existing?.isActive ?? true,
      };
      return existing === null
        ? adminClient().rewards.createStreakRule(input)
        : adminClient().rewards.updateStreakRule(existing.id, input);
    },
    onSuccess: () => {
      toast.success('Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.streakRules });
      setEditing(null);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (rules.isError) {
    return <ErrorState description={errorMessage(rules.error)} onRetry={() => void rules.refetch()} />;
  }

  const unit = REWARD_TYPES.find((type) => type.value === form.rewardType)?.unit ?? '';

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        A streak counts <strong>check-ins</strong>, not bookings — turning up is the thing
        being rewarded. A missed visit does not break it; punishing one miss is a strong
        reason to stop using the app.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Add rule</Button>
      </div>

      <DataTable
        loading={rules.isPending}
        rows={rules.data ?? []}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{ title: 'No streak rules', description: 'Customers see no streak goal yet.' }}
        columns={[
          { key: 'name', header: 'Rule', cell: (row) => row.name },
          {
            key: 'goal',
            header: 'Goal',
            cell: (row) => `${row.requiredVisits} visits in ${row.withinDays} days`,
          },
          {
            key: 'reward',
            header: 'Reward',
            align: 'right',
            cell: (row) => <RewardValue type={row.rewardType} value={row.rewardValue} />,
          },
          {
            key: 'active',
            header: '',
            align: 'right',
            cell: (row) => (row.isActive ? null : <Badge>Off</Badge>),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            /**
             * "Turn off", because that is what the button does.
             *
             * It was labelled Delete and the rule stayed in the list afterwards, marked
             * Off — so it read as a button that did nothing, and was reported as one. The
             * behaviour is right: rewards already earned point at this rule, and erasing it
             * would leave them describing nothing. Only the word was wrong.
             */
            cell: (row) =>
              row.isActive ? (
                <Button variant="ghost" size="sm" onClick={() => setDeleting(row)}>
                  Turn off
                </Button>
              ) : null,
          },
        ]}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        variant="sheet"
        title={existing === null ? 'New streak rule' : existing.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={form.name.trim() === ''}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-base">
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            hint="Shown to customers as their goal."
          />
          <div className="flex gap-base">
            <Input
              label="Visits needed"
              type="number"
              min={2}
              max={100}
              value={form.requiredVisits}
              onChange={(event) => setForm((c) => ({ ...c, requiredVisits: event.target.value }))}
              containerClassName="flex-1"
            />
            <Input
              label="Within (days)"
              type="number"
              min={1}
              max={365}
              value={form.withinDays}
              onChange={(event) => setForm((c) => ({ ...c, withinDays: event.target.value }))}
              containerClassName="flex-1"
            />
          </div>
          <Select
            label="Reward"
            value={form.rewardType}
            onChange={(event) =>
              setForm((c) => ({ ...c, rewardType: event.target.value as RewardType }))
            }
          >
            {REWARD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
          <div className="flex gap-base">
            <Input
              label={`Value (${unit})`}
              type="number"
              min={0}
              value={form.rewardValue}
              onChange={(event) => setForm((c) => ({ ...c, rewardValue: event.target.value }))}
              containerClassName="flex-1"
            />
            <Input
              label="Valid for (days)"
              type="number"
              min={1}
              max={365}
              value={form.validityDays}
              onChange={(event) => setForm((c) => ({ ...c, validityDays: event.target.value }))}
              containerClassName="flex-1"
              error={error}
            />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Turn off "${deleting?.name ?? ''}"?`}
        description={
          'Nobody new can earn it. Rewards already earned under it are kept, and the rule ' +
          'stays in this list marked Off so those rewards still make sense — edit it to turn ' +
          'it back on.'
        }
        confirmLabel="Yes, turn it off"
        cancelLabel="Leave it on"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting !== null && remove.mutate(deleting.id)}
      />
    </div>
  );
}

// ── Scratch campaigns ───────────────────────────────────────────────────────

function Campaigns() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [statsFor, setStatsFor] = useState<AdminCampaignRow | null>(null);
  const [editing, setEditing] = useState<AdminCampaignRow | 'new' | null>(null);
  const [stopping, setStopping] = useState<AdminCampaignRow | null>(null);

  const campaigns = useQuery({
    queryKey: keys.campaigns,
    queryFn: () => adminClient().rewards.campaigns(),
  });

  /**
   * Stopping a campaign.
   *
   * The route deactivates rather than deletes, so the row stays here with its figures. Cards
   * already issued point at it, and a card whose campaign has vanished cannot be scratched
   * or explained to the person holding it.
   */
  const stop = useMutation({
    mutationFn: (campaign: AdminCampaignRow) => adminClient().rewards.stopCampaign(campaign.id),
    onSuccess: (_result, campaign) => {
      toast.success(`${campaign.name} stopped. No new cards will be issued.`);
      setStopping(null);
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (campaigns.isError) {
    return (
      <ErrorState description={errorMessage(campaigns.error)} onRetry={() => void campaigns.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        The draw happens server-side, once per card, and respects each prize&rsquo;s stock cap.
        A card whose campaign has run out is returned unscratched rather than burned — the
        customer keeps their card.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ New campaign</Button>
      </div>

      <DataTable
        loading={campaigns.isPending}
        rows={campaigns.data ?? []}
        rowKey={(row) => row.id}
        onRowClick={setStatsFor}
        empty={{
          title: 'No campaigns',
          description: 'Without one, no scratch cards are issued.',
        }}
        columns={[
          {
            key: 'name',
            header: 'Campaign',
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-medium">{row.name}</span>
                <span className="text-caption text-text-muted">
                  {row.rewards.filter((reward) => reward.isActive).length} prize
                  {row.rewards.filter((reward) => reward.isActive).length === 1 ? '' : 's'}
                </span>
              </div>
            ),
          },
          {
            key: 'trigger',
            header: 'Issued on',
            cell: (row) =>
              row.trigger === 'ON_NTH_BOOKING'
                ? `Booking number ${row.triggerValue ?? '?'}`
                : (TRIGGERS.find((t) => t.value === row.trigger)?.label ?? row.trigger),
          },
          {
            key: 'issued',
            header: 'Cards issued',
            align: 'right',
            hideOnMobile: true,
            cell: (row) => row.cardsIssued,
          },
          {
            key: 'active',
            header: '',
            align: 'right',
            cell: (row) => (row.isActive ? <Badge tone="success">Running</Badge> : <Badge>Off</Badge>),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (row) => (
              <div className="flex justify-end gap-xs">
                <Button variant="ghost" size="sm" onClick={() => setStatsFor(row)}>
                  Figures
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                {row.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() => setStopping(row)}
                  >
                    Stop
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={stopping !== null}
        onOpenChange={(open) => {
          if (!open) setStopping(null);
        }}
        title="Stop this campaign?"
        description={
          stopping === null
            ? undefined
            : `No new cards will be issued for ${stopping.name}. Cards already in wallets stay ` +
              'there and can still be scratched. It stays in this list and can be turned back ' +
              'on by editing it.'
        }
        confirmLabel="Yes, stop it"
        cancelLabel="Keep it running"
        destructive
        loading={stop.isPending}
        onConfirm={() => stopping !== null && stop.mutate(stopping)}
      />

      <CampaignDialog campaign={editing} onClose={() => setEditing(null)} />
      <CampaignStats campaign={statsFor} onClose={() => setStatsFor(null)} />
    </div>
  );
}

/** One row of the prize table while it is being edited. Strings, because inputs hold strings. */
interface PrizeDraft {
  label: string;
  rewardType: RewardType;
  rewardValue: string;
  weight: string;
  /** Empty means unlimited, which is what the API calls `null`. */
  stock: string;
  validityDays: string;
  isActive: boolean;
  /** Already won this many times. Read-only, and the floor the stock cannot go below. */
  stockUsed: number;
}

const BLANK_PRIZE: PrizeDraft = {
  label: '',
  rewardType: 'PERCENT_OFF',
  rewardValue: '10',
  weight: '1',
  stock: '',
  validityDays: '30',
  isActive: true,
  stockUsed: 0,
};

/**
 * Building and editing a scratch campaign.
 *
 * The whole thing was read-only: campaigns could be looked at and costed, and the only way
 * to make one was to write rows into the database by hand. So the prizes customers could win
 * were whatever had been seeded, for ever.
 *
 * Prizes are matched by label when saving, and the server updates them in place so their
 * win counts survive an edit. Renaming a prize therefore creates a new one and retires the
 * old — worth knowing, and said on the form.
 */
function CampaignDialog({
  campaign,
  onClose,
}: {
  campaign: AdminCampaignRow | 'new' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isNew = campaign === 'new';
  const existing = campaign === 'new' || campaign === null ? null : campaign;

  const [form, setForm] = useState({
    name: '',
    trigger: 'ON_CHECKIN' as ScratchTrigger,
    triggerValue: '5',
    isActive: true,
    startsAt: '',
    endsAt: '',
  });
  const [prizes, setPrizes] = useState<PrizeDraft[]>([BLANK_PRIZE]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      trigger: existing?.trigger ?? 'ON_CHECKIN',
      triggerValue: String(existing?.triggerValue ?? 5),
      isActive: existing?.isActive ?? true,
      startsAt: existing?.startsAt == null ? '' : isoToLocalInput(existing.startsAt, STORE_TIMEZONE),
      endsAt: existing?.endsAt == null ? '' : isoToLocalInput(existing.endsAt, STORE_TIMEZONE),
    });
    setPrizes(
      existing === null || existing.rewards.length === 0
        ? [BLANK_PRIZE]
        : existing.rewards.map((reward) => ({
            label: reward.label,
            rewardType: reward.rewardType,
            // Money prizes are stored in paise and typed in rupees; percentages are neither.
            rewardValue: String(
              isMoney(reward.rewardType) ? paiseToRupees(reward.rewardValue) : reward.rewardValue,
            ),
            weight: String(reward.weight),
            stock: reward.stockTotal === null ? '' : String(reward.stockTotal),
            validityDays: String(reward.validityDays),
            isActive: reward.isActive,
            stockUsed: reward.stockUsed,
          })),
    );
    setError(null);
  }, [existing, isNew]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: form.name.trim(),
        trigger: form.trigger,
        triggerValue: form.trigger === 'ON_NTH_BOOKING' ? Number(form.triggerValue) : null,
        isActive: form.isActive,
        startsAt: form.startsAt === '' ? null : localInputToIso(form.startsAt, STORE_TIMEZONE),
        endsAt: form.endsAt === '' ? null : localInputToIso(form.endsAt, STORE_TIMEZONE),
        rewards: prizes.map((prize) => ({
          label: prize.label.trim(),
          rewardType: prize.rewardType,
          rewardValue: isMoney(prize.rewardType)
            ? rupeesToPaise(Number(prize.rewardValue))
            : Number(prize.rewardValue),
          weight: Number(prize.weight),
          stockTotal: prize.stock === '' ? null : Number(prize.stock),
          validityDays: Number(prize.validityDays),
          isActive: prize.isActive,
        })),
      };

      return isNew
        ? adminClient().rewards.createCampaign(input)
        : adminClient().rewards.updateCampaign(existing!.id, input);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Campaign created.' : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (campaign === null) return null;

  const drawable = prizes.filter((prize) => prize.isActive && Number(prize.weight) > 0);
  const totalWeight = drawable.reduce((sum, prize) => sum + Number(prize.weight), 0);

  const problem =
    form.name.trim() === ''
      ? 'The campaign needs a name.'
      : prizes.some((prize) => prize.label.trim() === '')
        ? 'Every prize needs a label — it is what the customer reads on the card.'
        : new Set(prizes.map((p) => p.label.trim().toLowerCase())).size !== prizes.length
          ? 'Two prizes share a label. The server matches them by label, so they would collide.'
          : drawable.length === 0
            ? 'At least one prize has to be on with a weight above zero, or nothing can be won.'
            : form.trigger === 'ON_NTH_BOOKING' && Number(form.triggerValue) < 1
              ? 'Say which booking number issues the card.'
              : prizes.find((prize) => prize.stock !== '' && Number(prize.stock) < prize.stockUsed)
                ? 'A prize cannot be capped below the number already won.'
                : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={isNew ? 'New campaign' : existing!.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={problem !== null}
            onClick={() => save.mutate()}
          >
            {isNew ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-lg">
        <div className="flex flex-col gap-base">
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
            hint="For staff. Customers see the prize, not the campaign."
          />

          <Select
            label="Issue a card"
            value={form.trigger}
            onChange={(event) =>
              setForm((c) => ({ ...c, trigger: event.target.value as ScratchTrigger }))
            }
            hint={TRIGGERS.find((t) => t.value === form.trigger)?.hint}
          >
            {TRIGGERS.map((trigger) => (
              <option key={trigger.value} value={trigger.value}>
                {trigger.label}
              </option>
            ))}
          </Select>

          {form.trigger === 'ON_NTH_BOOKING' && (
            <Input
              label="Which booking"
              type="number"
              min={1}
              required
              value={form.triggerValue}
              onChange={(event) => setForm((c) => ({ ...c, triggerValue: event.target.value }))}
              hint="5 means the card is issued on their fifth booking."
            />
          )}

          <div className="flex flex-col gap-base sm:flex-row">
            <Input
              label="Starts (optional)"
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) => setForm((c) => ({ ...c, startsAt: event.target.value }))}
              containerClassName="flex-1"
              hint="Leave empty to start as soon as it is on."
            />
            <Input
              label="Ends (optional)"
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) => setForm((c) => ({ ...c, endsAt: event.target.value }))}
              containerClassName="flex-1"
              hint="Leave empty to run until stopped."
            />
          </div>

          <Checkbox
            label="Running"
            hint="Off means no cards are issued. Cards already in wallets are unaffected."
            checked={form.isActive}
            onChange={(event) => setForm((c) => ({ ...c, isActive: event.target.checked }))}
          />
        </div>

        <section className="flex flex-col gap-base border-t border-border pt-base">
          <div>
            <h3 className="text-body-sm font-medium">Prizes</h3>
            <p className="text-caption text-text-muted">
              Weight is relative, not a percentage — a prize weighted 1 against one weighted 9
              is drawn a tenth as often. The chance shown is worked out from the weights below.
            </p>
          </div>

          {prizes.map((prize, index) => (
            <Card key={index} className="flex flex-col gap-sm">
              <div className="flex items-start justify-between gap-sm">
                <span className="text-caption font-medium text-text-muted">
                  Prize {index + 1}
                  {prize.isActive && Number(prize.weight) > 0 && totalWeight > 0 && (
                    <>
                      {' · '}
                      {formatPercent((Number(prize.weight) / totalWeight) * 100)} of draws
                    </>
                  )}
                  {prize.stockUsed > 0 && ` · won ${prize.stockUsed} time${prize.stockUsed === 1 ? '' : 's'}`}
                </span>

                {prizes.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger"
                    onClick={() =>
                      setPrizes((current) => current.filter((_, at) => at !== index))
                    }
                  >
                    Remove
                  </Button>
                )}
              </div>

              <Input
                label="Label"
                required
                value={prize.label}
                onChange={(event) => updatePrize(setPrizes, index, { label: event.target.value })}
                hint={
                  prize.stockUsed > 0
                    ? 'Renaming this retires it and starts a new prize — the win count stays with the old name.'
                    : 'What the customer reads when they scratch. “20% off your next visit”.'
                }
              />

              <div className="flex flex-col gap-base sm:flex-row">
                <Select
                  label="Prize"
                  value={prize.rewardType}
                  onChange={(event) =>
                    updatePrize(setPrizes, index, {
                      rewardType: event.target.value as RewardType,
                    })
                  }
                  containerClassName="flex-1"
                >
                  {REWARD_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
                <Input
                  label={`Value (${REWARD_TYPES.find((t) => t.value === prize.rewardType)?.unit ?? ''})`}
                  type="number"
                  min={0}
                  value={prize.rewardValue}
                  onChange={(event) =>
                    updatePrize(setPrizes, index, { rewardValue: event.target.value })
                  }
                  containerClassName="flex-1"
                />
              </div>

              <div className="flex flex-col gap-base sm:flex-row">
                <Input
                  label="Weight"
                  type="number"
                  min={0}
                  value={prize.weight}
                  onChange={(event) => updatePrize(setPrizes, index, { weight: event.target.value })}
                  containerClassName="flex-1"
                />
                <Input
                  label="Stock"
                  type="number"
                  min={prize.stockUsed}
                  value={prize.stock}
                  onChange={(event) => updatePrize(setPrizes, index, { stock: event.target.value })}
                  containerClassName="flex-1"
                  hint="Empty for unlimited."
                  error={
                    prize.stock !== '' && Number(prize.stock) < prize.stockUsed
                      ? `Already won ${prize.stockUsed} times.`
                      : undefined
                  }
                />
                <Input
                  label="Valid for (days)"
                  type="number"
                  min={1}
                  max={365}
                  value={prize.validityDays}
                  onChange={(event) =>
                    updatePrize(setPrizes, index, { validityDays: event.target.value })
                  }
                  containerClassName="flex-1"
                />
              </div>

              <Checkbox
                label="In the draw"
                checked={prize.isActive}
                onChange={(event) =>
                  updatePrize(setPrizes, index, { isActive: event.target.checked })
                }
              />
            </Card>
          ))}

          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPrizes((current) => [...current, { ...BLANK_PRIZE }])}
            >
              + Add prize
            </Button>
          </div>
        </section>

        {problem !== null && <p className="text-caption text-danger">{problem}</p>}
        {error !== null && <p className="text-caption text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function updatePrize(
  setPrizes: (updater: (current: PrizeDraft[]) => PrizeDraft[]) => void,
  index: number,
  patch: Partial<PrizeDraft>,
): void {
  setPrizes((current) =>
    current.map((prize, at) => (at === index ? { ...prize, ...patch } : prize)),
  );
}

/** Which prize values are money, and therefore typed in rupees and stored in paise. */
function isMoney(type: RewardType): boolean {
  return type !== 'PERCENT_OFF';
}

/**
 * What `GET /admin/rewards/campaigns/:id/stats` returns — `campaignStats` in
 * apps/api/src/admin/admin-rewards.service.ts.
 *
 * This used to declare `issued`, `scratched`, `redeemed` and `costPerCardPaise`, none of which
 * the server has ever sent, so the dialog showed blanks and ₹NaN. There is no redeemed count
 * at all: the cost figures are expectations worked out from the prize weights, not a tally.
 */
interface CampaignStatsDto {
  campaignId: string;
  name: string;
  isActive: boolean;
  cardsIssued: number;
  cardsScratched: number;
  /** What percent-off and free-session prizes are valued against. */
  averageBookingPaise: number;
  /** The weighted mean payout of one scratch. */
  expectedCostPerCardPaise: number;
  /** `expectedCostPerCardPaise` × every card issued so far, scratched or not. */
  projectedCostAtCurrentVolumePaise: number;
  /** Only the prizes still in the draw: on, weighted above zero and in stock. */
  slices: Array<{
    label: string;
    rewardType: RewardType;
    rewardValue: number;
    weight: number;
    chancePercent: number;
    estimatedValuePaise: number;
    stockTotal: number | null;
    stockUsed: number;
    stockRemaining: number | null;
  }>;
  /** Nothing left to win — cards cannot be scratched until a prize is restocked. */
  exhausted: boolean;
}

function CampaignStats({
  campaign,
  onClose,
}: {
  campaign: AdminCampaignRow | null;
  onClose: () => void;
}) {
  const stats = useQuery({
    queryKey: ['rewards', 'campaigns', campaign?.id, 'stats'],
    queryFn: () => adminClient().rewards.campaignStats(campaign!.id) as Promise<CampaignStatsDto>,
    enabled: campaign !== null,
  });

  if (campaign === null) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={campaign.name}
      description="How many cards have gone out, and what each one is expected to cost."
    >
      {stats.isError ? (
        <ErrorState description={errorMessage(stats.error)} />
      ) : stats.isPending ? (
        <p className="text-body-sm text-text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-base">
          {stats.data.exhausted && (
            <Card className="text-body-sm text-warning">
              Nothing left to win — every prize is off or out of stock. Cards stay unscratched
              in wallets until you edit the campaign and restock or add a prize.
            </Card>
          )}

          <dl className="grid grid-cols-2 gap-base text-body-sm">
            <div>
              <dt className="text-text-muted">Cards issued</dt>
              <dd className="font-medium">{stats.data.cardsIssued}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Scratched</dt>
              <dd className="font-medium">
                {stats.data.cardsScratched}
                {stats.data.cardsIssued > 0 && (
                  <span className="ml-xs text-caption text-text-muted">
                    {formatPercent((stats.data.cardsScratched / stats.data.cardsIssued) * 100)}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Expected cost per card</dt>
              <dd className="font-medium">{formatMoney(stats.data.expectedCostPerCardPaise)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Expected cost of cards issued</dt>
              <dd className="font-medium">
                {formatMoney(stats.data.projectedCostAtCurrentVolumePaise)}
              </dd>
            </div>
          </dl>

          {stats.data.slices.length > 0 && (
            <section className="flex flex-col gap-sm border-t border-border pt-base">
              <h3 className="text-body-sm font-medium">In the draw now</h3>
              <ul className="flex flex-col divide-y divide-border">
                {stats.data.slices.map((slice, index) => (
                  <li
                    key={`${index}-${slice.label}`}
                    className="flex items-center justify-between gap-sm py-sm"
                  >
                    <div className="flex flex-col">
                      <span className="text-body-sm">{slice.label}</span>
                      <span className="text-caption text-text-muted">
                        {formatPercent(slice.chancePercent)} of draws · won {slice.stockUsed}
                        {slice.stockTotal === null ? '' : ` of ${slice.stockTotal}`}
                      </span>
                    </div>
                    <span className="shrink-0 text-body-sm tabular-nums">
                      ≈ {formatMoney(slice.estimatedValuePaise)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-caption text-text-muted">
            These are expectations from the prize weights, not a tally of what has been
            redeemed. Percent-off and free-session prizes are valued against the average booking
            of {formatMoney(stats.data.averageBookingPaise)}, because what they cost depends on
            what people book. The second figure assumes every card issued gets scratched.
          </p>
        </div>
      )}
    </Dialog>
  );
}

// ── Manual grant ────────────────────────────────────────────────────────────

/**
 * The "sorry about the wait" lever every counter needs.
 *
 * Audited. It used to ask for a customer id copied "from the address bar", but the customer
 * pop-up never puts one there and the id is shown nowhere, so nobody could use it. Now the
 * customer is picked from a search, and their name stays on screen until the grant is made —
 * a reward cannot land on someone nobody looked at.
 */
function Grant() {
  const toast = useToast();
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    rewardType: 'FLAT_OFF' as RewardType,
    rewardValue: '100',
    validityDays: '30',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  // The Customers page's own search: name or phone, one request per pause in typing.
  const query = useDebounced(search, 300).trim();
  const params = { q: query, limit: 8 };

  const matches = useQuery({
    queryKey: keys.customers(params),
    queryFn: () => adminClient().customers.list(params),
    enabled: customer === null && query !== '',
  });

  const grant = useMutation({
    mutationFn: (target: CustomerSummary) =>
      adminClient().rewards.grant({
        userId: target.id,
        rewardType: form.rewardType,
        rewardValue:
          form.rewardType === 'PERCENT_OFF'
            ? Number(form.rewardValue)
            : rupeesToPaise(Number(form.rewardValue)),
        minOrderPaise: 0,
        validityDays: Number(form.validityDays),
        ...(form.reason.trim() === '' ? {} : { reason: form.reason.trim() }),
      }),
    onSuccess: (_result, target) => {
      toast.success(`Reward granted to ${target.name ?? 'the customer'}. It is in their wallet now.`);
      setCustomer(null);
      setSearch('');
      setForm((c) => ({ ...c, reason: '' }));
      setError(null);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const unit = REWARD_TYPES.find((type) => type.value === form.rewardType)?.unit ?? '';

  return (
    <Card className="flex max-w-lg flex-col gap-base">
      <p className="text-body-sm text-text-muted">
        Search for the customer by name or phone and pick them from the list. Every grant is
        recorded in the audit log with whoever made it.
      </p>

      {customer === null ? (
        <div className="flex flex-col gap-xs">
          <Input
            label="Customer"
            required
            placeholder="Name or phone"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            autoComplete="off"
            hint="Type part of their name or phone number, then pick them below."
          />

          {query !== '' &&
            (matches.isError ? (
              <p className="text-caption text-danger">{errorMessage(matches.error)}</p>
            ) : matches.isPending ? (
              <p className="text-caption text-text-muted">Searching…</p>
            ) : matches.data.data.length === 0 ? (
              <p className="text-caption text-text-muted">
                Nobody matches that. Only customers who have booked at least once can be found.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {matches.data.data.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomer(row);
                        setError(null);
                      }}
                      className="flex min-h-touch-admin w-full flex-col items-start justify-center rounded-md px-sm py-xs text-left hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="text-body-sm font-medium">{row.name ?? 'Guest'}</span>
                      <span className="text-caption text-text-muted">
                        {row.phone === null ? 'No phone on file' : formatPhone(row.phone)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      ) : (
        <div className="flex flex-col gap-xs">
          <span className="text-body-sm font-medium text-text">Customer</span>
          <div className="flex items-center justify-between gap-sm rounded-md border border-border px-sm py-xs">
            <div className="flex flex-col">
              <span className="text-body-sm font-medium">{customer.name ?? 'Guest'}</span>
              <span className="text-caption text-text-muted">
                {customer.phone === null ? 'No phone on file' : formatPhone(customer.phone)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setCustomer(null)}
              className="shrink-0 text-caption text-primary underline underline-offset-2"
            >
              Change
            </button>
          </div>
        </div>
      )}

      <Select
        label="Reward"
        value={form.rewardType}
        onChange={(event) => setForm((c) => ({ ...c, rewardType: event.target.value as RewardType }))}
      >
        {REWARD_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </Select>

      <div className="flex gap-base">
        <Input
          label={`Value (${unit})`}
          type="number"
          min={0}
          value={form.rewardValue}
          onChange={(event) => setForm((c) => ({ ...c, rewardValue: event.target.value }))}
          containerClassName="flex-1"
        />
        <Input
          label="Valid for (days)"
          type="number"
          min={1}
          max={365}
          value={form.validityDays}
          onChange={(event) => setForm((c) => ({ ...c, validityDays: event.target.value }))}
          containerClassName="flex-1"
        />
      </div>

      <Textarea
        label="Reason"
        rows={2}
        value={form.reason}
        onChange={(event) => setForm((c) => ({ ...c, reason: event.target.value }))}
        error={error}
      />

      <Button
        loading={grant.isPending}
        disabled={customer === null}
        onClick={() => customer !== null && grant.mutate(customer)}
      >
        Grant reward
      </Button>
    </Card>
  );
}

function RewardValue({ type, value }: { type: RewardType; value: number }) {
  if (type === 'PERCENT_OFF') return <>{value}% off</>;
  if (type === 'CASHBACK') return <>{formatMoney(value)} back</>;
  if (type === 'FREE_SERVICE') return <>Free service</>;
  if (type === 'FREE_ADDON') return <>Free add-on</>;
  return <>{formatMoney(value)} off</>;
}
