'use client';

import type { AdminCampaignRow, RewardType, ScratchTrigger } from '@reset/api-client';
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
  paiseToRupees,
  rupeesToPaise,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';
import { STORE_TIMEZONE, isoToLocalInput, localInputToIso } from '@/lib/time';

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
  const [tab, setTab] = useState<'streaks' | 'campaigns' | 'grants'>('streaks');

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Rewards</h1>
        <p className="text-body-sm text-text-muted">
          Streaks reward coming back. Scratch cards reward turning up.
        </p>
      </header>

      <div role="tablist" className="flex flex-wrap gap-xs">
        {(
          [
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

      {tab === 'streaks' ? <StreakRules /> : tab === 'campaigns' ? <Campaigns /> : <Grant />}
    </div>
  );
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
      toast.success('Rule deleted.');
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
            cell: (row) => (
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDeleting(row)}>
                Delete
              </Button>
            ),
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
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="Rewards already earned under it are kept. Nobody new can earn it."
        confirmLabel="Delete"
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

interface CampaignStatsDto {
  issued: number;
  scratched: number;
  redeemed: number;
  costPaise: number;
  costPerCardPaise: number;
  byReward?: Array<{ label: string; won: number; stockTotal: number | null }>;
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
      description="What this campaign has cost, and what it has produced."
    >
      {stats.isError ? (
        <ErrorState description={errorMessage(stats.error)} />
      ) : stats.isPending ? (
        <p className="text-body-sm text-text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-base">
          <dl className="grid grid-cols-2 gap-base text-body-sm">
            <div>
              <dt className="text-text-muted">Cards issued</dt>
              <dd className="font-medium">{stats.data.issued}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Scratched</dt>
              <dd className="font-medium">
                {stats.data.scratched}
                {stats.data.issued > 0 && (
                  <span className="ml-xs text-caption text-text-muted">
                    {formatPercent((stats.data.scratched / stats.data.issued) * 100)}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Redeemed</dt>
              <dd className="font-medium">{stats.data.redeemed}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Cost per card</dt>
              <dd className="font-medium">{formatMoney(stats.data.costPerCardPaise)}</dd>
            </div>
          </dl>

          <p className="text-caption text-text-muted">
            Cost counts rewards actually <em>redeemed</em>, not issued. An unscratched card
            costs nothing.
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
 * Audited, and deliberately a little slow to use: it takes a customer id rather than a name
 * search, so it cannot be fired off by accident.
 */
function Grant() {
  const toast = useToast();
  const [form, setForm] = useState({
    userId: '',
    rewardType: 'FLAT_OFF' as RewardType,
    rewardValue: '100',
    validityDays: '30',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () =>
      adminClient().rewards.grant({
        userId: form.userId.trim(),
        rewardType: form.rewardType,
        rewardValue:
          form.rewardType === 'PERCENT_OFF'
            ? Number(form.rewardValue)
            : rupeesToPaise(Number(form.rewardValue)),
        minOrderPaise: 0,
        validityDays: Number(form.validityDays),
        ...(form.reason.trim() === '' ? {} : { reason: form.reason.trim() }),
      }),
    onSuccess: () => {
      toast.success('Reward granted. It is in their wallet now.');
      setForm((c) => ({ ...c, userId: '', reason: '' }));
      setError(null);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const unit = REWARD_TYPES.find((type) => type.value === form.rewardType)?.unit ?? '';

  return (
    <Card className="flex max-w-lg flex-col gap-base">
      <p className="text-body-sm text-text-muted">
        Find the customer under Customers, copy their id from the address bar, and paste it
        here. Every grant is recorded in the audit log with whoever made it.
      </p>

      <Input
        label="Customer id"
        required
        value={form.userId}
        onChange={(event) => setForm((c) => ({ ...c, userId: event.target.value }))}
        className="font-mono"
      />

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
        disabled={form.userId.trim() === ''}
        onClick={() => grant.mutate()}
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
