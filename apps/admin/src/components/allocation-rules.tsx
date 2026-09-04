'use client';

import type { AdminAllocationRuleRow, AllocationRulePreview } from '@reset/api-client';
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
  formatTime,
  todayLocal,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys, useServices, useStations } from '@/lib/queries';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Time-boxed station reservations — the client's 02/08/2026 morning ₹199 push.
 *
 * Stations are listed explicitly rather than by count. "Reserve 2 beds" is ambiguous, and
 * resolving *which* two differently on each query produces slot lists that flicker between
 * page loads.
 */
export function AllocationRules() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminAllocationRuleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminAllocationRuleRow | null>(null);

  const rules = useQuery({
    queryKey: keys.allocationRules,
    queryFn: () => adminClient().capacity.allocationRules(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminClient().capacity.deleteAllocationRule(id),
    onSuccess: () => {
      toast.success('Rule deleted.');
      void queryClient.invalidateQueries({ queryKey: keys.allocationRules });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
      setDeleting(null);
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (rules.isError) {
    return <ErrorState description={errorMessage(rules.error)} onRetry={() => void rules.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        A rule reserves specific stations for specific services during a window — or keeps
        them clear of it. Always preview before saving: reserving two stations for a morning
        push can quietly wipe out availability for a more expensive service, which is
        invisible until a customer complains they cannot book.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Add rule</Button>
      </div>

      <DataTable
        loading={rules.isPending}
        rows={rules.data ?? []}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{
          title: 'No allocation rules',
          description: 'Every station is available for every service it is designated for.',
        }}
        columns={[
          {
            key: 'name',
            header: 'Rule',
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-medium">{row.name}</span>
                <span className="text-caption text-text-muted">
                  {row.mode === 'EXCLUSIVE_TO' ? 'Reserved for' : 'Kept clear of'}{' '}
                  {row.services.map((service) => service.name).join(', ')}
                </span>
              </div>
            ),
          },
          {
            key: 'when',
            header: 'When',
            cell: (row) => (
              <div className="flex flex-col">
                <span>
                  {row.startsAtLocal}–{row.endsAtLocal}
                </span>
                <span className="text-caption text-text-muted">
                  {row.recurrence === 'WEEKLY'
                    ? row.daysOfWeek.map((day) => DAY_LABELS[day]).join(' ')
                    : (row.dateFrom ?? 'one-off')}
                </span>
              </div>
            ),
          },
          {
            key: 'stations',
            header: 'Stations',
            align: 'right',
            hideOnMobile: true,
            cell: (row) => row.stations.map((station) => station.name).join(', '),
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

      <RuleDialog rule={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="Availability returns to normal immediately. Existing bookings are untouched."
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting !== null && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function RuleDialog({ rule, onClose }: { rule: AdminAllocationRuleRow | 'new' | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const stations = useStations();
  const services = useServices();

  const isNew = rule === 'new';
  const existing = rule === 'new' || rule === null ? null : rule;

  const [form, setForm] = useState({
    name: '',
    mode: 'EXCLUSIVE_TO' as AdminAllocationRuleRow['mode'],
    recurrence: 'WEEKLY' as AdminAllocationRuleRow['recurrence'],
    daysOfWeek: [] as number[],
    dateFrom: '',
    startsAtLocal: '10:00',
    endsAtLocal: '13:00',
    stationIds: [] as string[],
    serviceIds: [] as string[],
  });
  const [preview, setPreview] = useState<AllocationRulePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      mode: existing?.mode ?? 'EXCLUSIVE_TO',
      recurrence: existing?.recurrence ?? 'WEEKLY',
      daysOfWeek: existing?.daysOfWeek ?? [],
      dateFrom: existing?.dateFrom ?? todayLocal(),
      startsAtLocal: existing?.startsAtLocal ?? '10:00',
      endsAtLocal: existing?.endsAtLocal ?? '13:00',
      // The row carries named objects; the request wants ids. Editing a rule used to read
      // `existing.stationIds`, which is not a field the API sends, so every saved edit
      // silently dropped the rule's stations and services.
      stationIds: (existing?.stations ?? []).map((station) => station.id),
      serviceIds: (existing?.services ?? []).map((service) => service.id),
    });
    setPreview(null);
    setError(null);
  }, [existing, isNew]);

  const payload = {
    name: form.name.trim(),
    mode: form.mode,
    recurrence: form.recurrence,
    daysOfWeek: form.recurrence === 'WEEKLY' ? form.daysOfWeek : [],
    dateFrom: form.recurrence === 'ONE_OFF' ? form.dateFrom : null,
    dateTo: null,
    startsAtLocal: form.startsAtLocal,
    endsAtLocal: form.endsAtLocal,
    stationIds: form.stationIds,
    serviceIds: form.serviceIds,
    priority: existing?.priority ?? 100,
    isActive: existing?.isActive ?? true,
  };

  const runPreview = useMutation({
    mutationFn: () =>
      adminClient().capacity.previewAllocationRule({
        ...payload,
        date: form.recurrence === 'ONE_OFF' ? form.dateFrom : todayLocal(),
      }),
    onSuccess: setPreview,
    onError: (caught) => setError(errorMessage(caught)),
  });

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? adminClient().capacity.createAllocationRule(payload)
        : adminClient().capacity.updateAllocationRule(existing!.id, payload),
    onSuccess: () => {
      toast.success('Rule saved.');
      void queryClient.invalidateQueries({ queryKey: keys.allocationRules });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (rule === null) return null;

  const valid =
    form.name.trim() !== '' &&
    form.stationIds.length > 0 &&
    form.serviceIds.length > 0 &&
    form.endsAtLocal > form.startsAtLocal &&
    (form.recurrence === 'ONE_OFF' ? form.dateFrom !== '' : form.daysOfWeek.length > 0);

  /**
   * Why Save is greyed out, in words.
   *
   * Staff reported the Save button as broken. It was doing exactly what it was written to
   * do — the name field is above the fold and Save additionally waits for a preview — and
   * the screen said none of that. A disabled control with no explanation is
   * indistinguishable from a bug, and it gets reported as one, which is what happened.
   *
   * The preview requirement is worth keeping: reserving stations can wipe out availability
   * for a service nobody was thinking about, and this is the only place that is visible
   * before customers find it. It just has to say so.
   */
  const blocker =
    form.name.trim() === ''
      ? 'Give the rule a name — the field is at the top of this form.'
      : form.stationIds.length === 0
        ? 'Pick at least one station.'
        : form.serviceIds.length === 0
          ? 'Pick at least one service.'
          : form.endsAtLocal <= form.startsAtLocal
            ? 'The window has to end after it starts.'
            : form.recurrence === 'ONE_OFF' && form.dateFrom === ''
              ? 'Pick the date this rule applies to.'
              : form.daysOfWeek.length === 0 && form.recurrence !== 'ONE_OFF'
                ? 'Pick at least one day of the week.'
                : preview === null
                  ? 'Press Preview first. A rule can quietly remove availability for a ' +
                    'service you were not thinking about, and this is the only place that ' +
                    'shows up before a customer finds it.'
                  : null;

  const conflicts = preview?.conflicts ?? [];
  const wipeouts = (preview?.effects ?? []).filter(
    (effect) => effect.slotsBefore > 0 && effect.slotsAfter === 0,
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={isNew ? 'New allocation rule' : existing!.name}
      className="sm:max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            loading={runPreview.isPending}
            disabled={!valid}
            onClick={() => runPreview.mutate()}
          >
            Preview
          </Button>
          <Button
            loading={save.isPending}
            // Preview is required before the first save. The second-order effects of a
            // capacity rule are not guessable from the form, and this is the only place they
            // are visible before customers find them.
            disabled={!valid || preview === null}
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
          hint="What it is for — “Morning ₹199 push”."
        />

        <Select
          label="Mode"
          value={form.mode}
          onChange={(event) =>
            setForm((c) => ({ ...c, mode: event.target.value as AdminAllocationRuleRow['mode'] }))
          }
          hint={
            form.mode === 'EXCLUSIVE_TO'
              ? 'These stations serve only these services during the window.'
              : 'These stations will not serve these services during the window.'
          }
        >
          <option value="EXCLUSIVE_TO">Reserve for</option>
          <option value="EXCLUDE_FROM">Keep clear of</option>
        </Select>

        <Select
          label="Repeats"
          value={form.recurrence}
          onChange={(event) =>
            setForm((c) => ({
              ...c,
              recurrence: event.target.value as AdminAllocationRuleRow['recurrence'],
            }))
          }
        >
          <option value="WEEKLY">Every week</option>
          <option value="ONE_OFF">One day only</option>
        </Select>

        {form.recurrence === 'WEEKLY' ? (
          <fieldset className="flex flex-col gap-xs">
            <legend className="text-body-sm font-medium">Days</legend>
            <div className="flex flex-wrap gap-xs">
              {DAY_LABELS.map((label, day) => (
                <Button
                  key={day}
                  size="sm"
                  variant={form.daysOfWeek.includes(day) ? 'primary' : 'secondary'}
                  onClick={() =>
                    setForm((c) => ({
                      ...c,
                      daysOfWeek: c.daysOfWeek.includes(day)
                        ? c.daysOfWeek.filter((d) => d !== day)
                        : [...c.daysOfWeek, day].sort(),
                    }))
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </fieldset>
        ) : (
          <Input
            label="Date"
            type="date"
            required
            value={form.dateFrom}
            onChange={(event) => setForm((c) => ({ ...c, dateFrom: event.target.value }))}
          />
        )}

        <div className="flex gap-base">
          <Input
            label="From"
            type="time"
            value={form.startsAtLocal}
            onChange={(event) => setForm((c) => ({ ...c, startsAtLocal: event.target.value }))}
            containerClassName="flex-1"
          />
          <Input
            label="To"
            type="time"
            value={form.endsAtLocal}
            onChange={(event) => setForm((c) => ({ ...c, endsAtLocal: event.target.value }))}
            containerClassName="flex-1"
            error={form.endsAtLocal <= form.startsAtLocal ? 'Must be after the start.' : null}
          />
        </div>

        <fieldset className="flex flex-col gap-xs">
          <legend className="text-body-sm font-medium">Stations</legend>
          {((stations.data ?? []) as Array<{ id: string; name: string }>).map((station) => (
            <Checkbox
              key={station.id}
              label={station.name}
              checked={form.stationIds.includes(station.id)}
              onChange={(event) =>
                setForm((c) => ({
                  ...c,
                  stationIds: event.target.checked
                    ? [...c.stationIds, station.id]
                    : c.stationIds.filter((id) => id !== station.id),
                }))
              }
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-xs">
          <legend className="text-body-sm font-medium">Services</legend>
          {(services.data ?? []).map((service) => (
            <Checkbox
              key={service.id}
              label={service.name}
              checked={form.serviceIds.includes(service.id)}
              onChange={(event) =>
                setForm((c) => ({
                  ...c,
                  serviceIds: event.target.checked
                    ? [...c.serviceIds, service.id]
                    : c.serviceIds.filter((id) => id !== service.id),
                }))
              }
            />
          ))}
        </fieldset>

        {error !== null && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}

        {/* Says what is standing between this form and a saved rule. */}
        {blocker !== null && error === null && (
          <p className="text-body-sm text-text-muted">{blocker}</p>
        )}

        {preview !== null && (
          <section className="flex flex-col gap-sm border-t border-border pt-base">
            <h3 className="text-body-sm font-medium">Effect on {preview.date}</h3>

            {wipeouts.length > 0 && (
              <Card className="border-danger/40 bg-danger/5">
                <p className="text-body-sm font-medium text-danger">
                  This removes all availability for {wipeouts.map((w) => w.serviceName).join(', ')}.
                </p>
              </Card>
            )}

            <ul className="flex flex-col gap-xs">
              {preview.effects.map((effect) => (
                <li
                  key={effect.serviceId}
                  className="flex items-baseline justify-between gap-sm text-body-sm"
                >
                  <span>{effect.serviceName}</span>
                  <span
                    className={
                      effect.slotsAfter < effect.slotsBefore ? 'text-danger' : 'text-text-muted'
                    }
                  >
                    {effect.slotsBefore} → {effect.slotsAfter} slots
                  </span>
                </li>
              ))}
            </ul>

            {conflicts.length > 0 && (
              <Card className="border-warning/40 bg-warning/5">
                <p className="text-body-sm font-medium">
                  {conflicts.length} existing booking{conflicts.length === 1 ? '' : 's'} sit
                  inside this window.
                </p>
                <ul className="mt-xs flex flex-col gap-0.5 text-caption text-text-muted">
                  {conflicts.map((conflict) => (
                    <li key={conflict.bookingId}>
                      {formatTime(conflict.startsAt)} · {conflict.serviceName} ·{' '}
                      {conflict.stationName} ({conflict.publicId})
                    </li>
                  ))}
                </ul>
                <p className="mt-xs text-caption text-text-muted">
                  They are not cancelled. The rule only affects what is offered from now on.
                </p>
              </Card>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
