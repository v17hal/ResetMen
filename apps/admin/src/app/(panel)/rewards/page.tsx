'use client';

import type { RewardType } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Input,
  Select,
  Textarea,
  formatMoney,
  formatPercent,
  rupeesToPaise,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

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

interface CampaignRow {
  id: string;
  name: string;
  trigger: string;
  isActive: boolean;
  rewards?: Array<{ label: string; weight: number; stockTotal: number | null; stockUsed: number }>;
}

function Campaigns() {
  const [statsFor, setStatsFor] = useState<CampaignRow | null>(null);

  const campaigns = useQuery({
    queryKey: keys.campaigns,
    queryFn: () => adminClient().rewards.campaigns() as Promise<CampaignRow[]>,
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
          { key: 'name', header: 'Campaign', cell: (row) => row.name },
          {
            key: 'trigger',
            header: 'Issued on',
            cell: (row) => row.trigger.toLowerCase().replace(/_/g, ' '),
          },
          {
            key: 'active',
            header: '',
            align: 'right',
            cell: (row) => (row.isActive ? <Badge tone="success">Running</Badge> : <Badge>Off</Badge>),
          },
        ]}
      />

      <CampaignStats campaign={statsFor} onClose={() => setStatsFor(null)} />
    </div>
  );
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
  campaign: CampaignRow | null;
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
