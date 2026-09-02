'use client';

import type { AdminBlackoutRow, AdminStationRow } from '@reset/api-client';
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
  SkeletonList,
  formatDateTime,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { AllocationRules } from '@/components/allocation-rules';
import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys, useServices, useStations } from '@/lib/queries';
import { STORE_TIMEZONE, localDateIn, localInputToIso } from '@/lib/time';

type Tab = 'stations' | 'rules' | 'hours' | 'closures' | 'settings';

export default function CapacityPage() {
  const [tab, setTab] = useState<Tab>('stations');

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Capacity</h1>
        <p className="text-body-sm text-text-muted">
          How many people can be served, when, and on what.
        </p>
      </header>

      <div role="tablist" className="flex flex-wrap gap-xs">
        {(
          [
            ['stations', 'Stations'],
            ['rules', 'Allocation rules'],
            ['hours', 'Opening hours'],
            ['closures', 'Closures'],
            ['settings', 'Booking settings'],
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

      {tab === 'stations' ? (
        <Stations />
      ) : tab === 'rules' ? (
        <AllocationRules />
      ) : tab === 'hours' ? (
        <OpeningHours />
      ) : tab === 'closures' ? (
        <Closures />
      ) : (
        <BookingSettings />
      )}
    </div>
  );
}

// ── Stations ────────────────────────────────────────────────────────────────

function Stations() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const stations = useStations();
  const [editing, setEditing] = useState<AdminStationRow | 'new' | null>(null);
  const [designating, setDesignating] = useState<AdminStationRow | null>(null);

  // To turn the designated service ids into names in the table. Cached for five minutes by
  // `useServices`, so this costs nothing that the Catalog screen has not already paid.
  const services = useServices();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const existing = editing === 'new' || editing === null ? null : editing;

  useEffect(() => {
    setName(existing?.name ?? '');
    setError(null);
  }, [existing, editing]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        isActive: existing?.isActive ?? true,
        sortOrder: existing?.sortOrder ?? 0,
      };
      return existing === null
        ? adminClient().capacity.createStation(input)
        : adminClient().capacity.updateStation(existing.id, input);
    },
    onSuccess: () => {
      toast.success('Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.stations });
      setEditing(null);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  const toggle = useMutation({
    mutationFn: (station: AdminStationRow) =>
      adminClient().capacity.updateStation(station.id, {
        name: station.name,
        isActive: !station.isActive,
        sortOrder: station.sortOrder,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.stations });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (stations.isError) {
    return (
      <ErrorState description={errorMessage(stations.error)} onRetry={() => void stations.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        A station is a bed or a chair — one customer at a time. Deactivating one removes it
        from future availability; bookings already on it are untouched, so move them first.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Add station</Button>
      </div>

      <DataTable
        loading={stations.isPending}
        rows={stations.data ?? []}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{
          title: 'No stations',
          description: 'Nothing can be booked until at least one station exists.',
        }}
        columns={[
          { key: 'name', header: 'Station', cell: (row) => row.name },
          {
            /**
             * What the station is actually designated for.
             *
             * This column was a ghost button reading "Services" under a blank header, which
             * on a dark table is indistinguishable from a label. Staff reported there was no
             * way to assign a service to a station and were right about what they could see:
             * the only thing on screen was the word itself.
             *
             * The designation was in the response the whole time — `allowsAllServices` and
             * `serviceIds` — and both the client type and this screen threw it away.
             */
            key: 'can-perform',
            header: 'Can perform',
            cell: (row) => {
              if (row.allowsAllServices) {
                return <span className="text-text-muted">Every service</span>;
              }

              if (row.serviceIds.length === 0) {
                return (
                  <Badge tone="danger">Nothing — nobody can book this station</Badge>
                );
              }

              const named = row.serviceIds
                .map((id) => services.data?.find((service) => service.id === id)?.name)
                .filter((name): name is string => name !== undefined);

              return named.join(', ');
            },
          },
          {
            key: 'active',
            header: '',
            align: 'right',
            cell: (row) => (
              <Button
                variant={row.isActive ? 'ghost' : 'secondary'}
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(row)}
              >
                {row.isActive ? 'Active' : 'Inactive'}
              </Button>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (row) => (
              <Button variant="secondary" size="sm" onClick={() => setDesignating(row)}>
                Change services
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
        title={existing === null ? 'Add station' : existing.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={name.trim() === ''}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={error}
          hint="What staff call it out loud — “Bed 2”, “Chair by the window”."
        />
      </Dialog>

      <StationServicesDialog station={designating} onClose={() => setDesignating(null)} />
    </div>
  );
}

/**
 * Station → service designation.
 *
 * From the client's 02/08/2026 requirement: certain beds may be designated only for head
 * massage, because of space. A restricted station with nothing ticked can never be booked,
 * so the save is blocked rather than letting someone quietly remove a station from service.
 */
function StationServicesDialog({
  station,
  onClose,
}: {
  station: AdminStationRow | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const services = useServices();

  const [allowsAll, setAllowsAll] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const coverage = useQuery({
    queryKey: keys.coverage,
    queryFn: () => adminClient().capacity.coverage(),
    enabled: station !== null,
  });

  useEffect(() => {
    // The list endpoint does not return each station's designation, so this opens permissive
    // rather than guessing. Saving is what writes the truth.
    setAllowsAll(true);
    setSelected(new Set());
    setError(null);
  }, [station]);

  const save = useMutation({
    mutationFn: () =>
      adminClient().capacity.setStationServices(station!.id, {
        allowsAllServices: allowsAll,
        serviceIds: allowsAll ? [] : [...selected],
      }),
    onSuccess: () => {
      toast.success('Designation saved.');
      void queryClient.invalidateQueries({ queryKey: keys.stations });
      void queryClient.invalidateQueries({ queryKey: keys.services });
      void queryClient.invalidateQueries({ queryKey: keys.coverage });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (station === null) return null;

  const invalid = !allowsAll && selected.size === 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={`${station.name} — services`}
      description="Which services this station can be used for."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        <Checkbox
          label="Any service"
          hint="The usual case. Untick to restrict this station."
          checked={allowsAll}
          onChange={(event) => setAllowsAll(event.target.checked)}
        />

        {!allowsAll && (
          <fieldset className="flex flex-col gap-sm">
            <legend className="text-body-sm font-medium">Allowed services</legend>
            {(services.data ?? []).map((service) => (
              <Checkbox
                key={service.id}
                label={service.name}
                checked={selected.has(service.id)}
                onChange={(event) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(service.id);
                    else next.delete(service.id);
                    return next;
                  })
                }
              />
            ))}
            {invalid && (
              <p role="alert" className="text-caption text-danger">
                Pick at least one, or this station can never be booked.
              </p>
            )}
          </fieldset>
        )}

        {error !== null && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}

        {coverage.data !== undefined && (
          <p className="text-caption text-text-muted">
            Coverage across all stations is shown under Catalog — a published service that no
            station can perform offers no times at all.
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ── Opening hours ───────────────────────────────────────────────────────────

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function OpeningHours() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const hours = useQuery({
    queryKey: keys.storeHours,
    queryFn: () => adminClient().capacity.storeHours(),
  });

  const [draft, setDraft] = useState<
    Array<{ dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hours.data === undefined) return;
    // Fill every day, so a day the store has never configured still gets a row.
    setDraft(
      DAYS.map((_, dayOfWeek) => {
        const found = hours.data.find((hour) => hour.dayOfWeek === dayOfWeek);
        return {
          dayOfWeek,
          opensAt: found?.opensAt ?? '10:00',
          closesAt: found?.closesAt ?? '21:00',
          isClosed: found?.isClosed ?? false,
        };
      }),
    );
  }, [hours.data]);

  const save = useMutation({
    mutationFn: () => adminClient().capacity.setStoreHours(draft),
    onSuccess: () => {
      toast.success('Opening hours saved.');
      void queryClient.invalidateQueries({ queryKey: keys.storeHours });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (hours.isError) {
    return <ErrorState description={errorMessage(hours.error)} onRetry={() => void hours.refetch()} />;
  }
  if (hours.isPending) return <SkeletonList rows={7} />;

  const invalid = draft.some((day) => !day.isClosed && day.closesAt <= day.opensAt);

  return (
    <div className="flex flex-col gap-base">
      <Card className="flex flex-col gap-sm">
        {draft.map((day, index) => (
          <div key={day.dayOfWeek} className="flex flex-wrap items-end gap-sm border-b border-border pb-sm last:border-0">
            <span className="w-24 text-body-sm font-medium">{DAYS[day.dayOfWeek]}</span>

            <Checkbox
              label="Closed"
              checked={day.isClosed}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((entry, i) =>
                    i === index ? { ...entry, isClosed: event.target.checked } : entry,
                  ),
                )
              }
            />

            {!day.isClosed && (
              <>
                <Input
                  label="Opens"
                  type="time"
                  value={day.opensAt}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, opensAt: event.target.value } : entry,
                      ),
                    )
                  }
                  containerClassName="w-32"
                />
                <Input
                  label="Closes"
                  type="time"
                  value={day.closesAt}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, closesAt: event.target.value } : entry,
                      ),
                    )
                  }
                  containerClassName="w-32"
                  error={day.closesAt <= day.opensAt ? 'Must be after opening.' : null}
                />
              </>
            )}
          </div>
        ))}
      </Card>

      {error !== null && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
          Save hours
        </Button>
      </div>
    </div>
  );
}

// ── Booking settings ────────────────────────────────────────────────────────

const SETTINGS: ReadonlyArray<{
  key:
    | 'bufferMinutes'
    | 'slotGranularityMinutes'
    | 'bookingHorizonDays'
    | 'minLeadMinutes'
    | 'holdTtlMinutes'
    | 'cancellationWindowMinutes';
  label: string;
  hint: string;
  min: number;
  max: number;
}> = [
  {
    key: 'bufferMinutes',
    label: 'Buffer between sessions (min)',
    hint: 'Cleaning and turnaround. Blocks the station but is not part of the session.',
    min: 0,
    max: 120,
  },
  {
    key: 'slotGranularityMinutes',
    label: 'Slot granularity (min)',
    hint: 'How far apart offered start times are. 15 gives four choices an hour.',
    min: 1,
    max: 60,
  },
  {
    key: 'bookingHorizonDays',
    label: 'Booking horizon (days)',
    hint: 'How far ahead customers can book.',
    min: 1,
    max: 90,
  },
  {
    key: 'minLeadMinutes',
    label: 'Minimum lead time (min)',
    hint: 'How close to now a booking is still accepted. Stops someone booking as they walk in.',
    min: 0,
    max: 1440,
  },
  {
    key: 'holdTtlMinutes',
    label: 'Hold time (min)',
    hint: 'How long a slot is reserved during checkout before it goes back on sale.',
    min: 1,
    max: 60,
  },
  {
    key: 'cancellationWindowMinutes',
    label: 'Free cancellation window (min)',
    hint: 'How long before the slot a customer can still cancel it themselves.',
    min: 0,
    max: 10080,
  },
];

// ── Closures ────────────────────────────────────────────────────────────────

/**
 * Holidays, half-days and a station out of action.
 *
 * The API has always had these and no screen has ever created one, while Booking settings
 * told staff to go and set them "from the timeline" — which draws them and cannot make one.
 * So the only way to close the shop for a day was to not have it in the database at all.
 *
 * Only closures that have not finished yet are listed. One that ended last month is history
 * and nothing on this screen can act on it.
 */
function Closures() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AdminBlackoutRow | null>(null);

  const blackouts = useQuery({
    queryKey: keys.blackouts,
    queryFn: () => adminClient().capacity.blackouts(),
  });

  const remove = useMutation({
    mutationFn: (blackout: AdminBlackoutRow) =>
      adminClient().capacity.deleteBlackout(blackout.id),
    onSuccess: () => {
      toast.success('Closure lifted — those times can be booked again.');
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: keys.blackouts });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (blackouts.isError) {
    return (
      <ErrorState
        description={errorMessage(blackouts.error)}
        onRetry={() => void blackouts.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        A closure takes times off the app. Close the whole store for a holiday, or one station
        while a chair is being repaired. Bookings already taken inside the window are not
        touched — the store refuses the closure and names them instead, so nobody is stranded
        by a change made after they booked.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setAdding(true)}>+ Add closure</Button>
      </div>

      <DataTable
        loading={blackouts.isPending}
        rows={blackouts.data ?? []}
        rowKey={(row) => row.id}
        empty={{
          title: 'Nothing closed',
          description: 'The store is open to its normal hours for the whole booking window.',
        }}
        columns={[
          {
            key: 'when',
            header: 'When',
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-medium">{formatDateTime(row.startsAt, STORE_TIMEZONE)}</span>
                <span className="text-caption text-text-muted">
                  until {formatDateTime(row.endsAt, STORE_TIMEZONE)}
                </span>
              </div>
            ),
          },
          {
            key: 'what',
            header: 'Closed',
            cell: (row) =>
              row.stationId === null ? (
                <Badge tone="danger">Whole store</Badge>
              ) : (
                <Badge>{row.station?.name ?? 'One station'}</Badge>
              ),
          },
          {
            key: 'reason',
            header: 'Reason',
            hideOnMobile: true,
            cell: (row) => row.reason ?? <span className="text-text-muted">—</span>,
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (row) => (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                onClick={() => setRemoving(row)}
              >
                Lift
              </Button>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Lift this closure?"
        description="Those times go back on sale in the app immediately."
        confirmLabel="Yes, lift it"
        cancelLabel="Leave it closed"
        destructive
        loading={remove.isPending}
        onConfirm={() => removing !== null && remove.mutate(removing)}
      />

      <ClosureDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function ClosureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const stations = useStations();

  const [form, setForm] = useState({
    wholeDay: true,
    date: '',
    from: '',
    to: '',
    stationId: '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      wholeDay: true,
      date: localDateIn(STORE_TIMEZONE),
      from: '',
      to: '',
      stationId: '',
      reason: '',
    });
    setError(null);
  }, [open]);

  const save = useMutation({
    mutationFn: () => {
      /**
       * A whole day is midnight to the next midnight, not 00:00–23:59.
       *
       * The window is compared as start < end and end > start, so an appointment running to
       * 23:45 has to fall inside it. Stopping a minute short would leave the last slot of
       * the day quietly bookable on a day the store is shut.
       */
      const { startsAt, endsAt } = form.wholeDay
        ? {
            startsAt: localInputToIso(`${form.date}T00:00`, STORE_TIMEZONE),
            endsAt: localInputToIso(`${nextDay(form.date)}T00:00`, STORE_TIMEZONE),
          }
        : {
            startsAt: localInputToIso(form.from, STORE_TIMEZONE),
            endsAt: localInputToIso(form.to, STORE_TIMEZONE),
          };

      return adminClient().capacity.createBlackout({
        stationId: form.stationId === '' ? null : form.stationId,
        startsAt,
        endsAt,
        reason: form.reason.trim() === '' ? undefined : form.reason.trim(),
      });
    },
    onSuccess: () => {
      toast.success('Closed. Those times are off the app.');
      void queryClient.invalidateQueries({ queryKey: keys.blackouts });
      onClose();
    },
    // The store refuses when bookings fall inside the window and says how many. Shown as it
    // arrives — a count this screen does not have and could not work out.
    onError: (caught) => setError(errorMessage(caught)),
  });

  const canSave = form.wholeDay
    ? form.date !== ''
    : form.from !== '' && form.to !== '' && form.to > form.from;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      variant="sheet"
      title="Add a closure"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
            Close these times
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        <Checkbox
          label="Closed for the whole day"
          hint="Turn off for a half-day, or a couple of hours."
          checked={form.wholeDay}
          onChange={(event) => setForm((c) => ({ ...c, wholeDay: event.target.checked }))}
        />

        {form.wholeDay ? (
          <Input
            label="Date"
            type="date"
            required
            value={form.date}
            min={localDateIn(STORE_TIMEZONE)}
            onChange={(event) => setForm((c) => ({ ...c, date: event.target.value }))}
          />
        ) : (
          <div className="flex flex-col gap-base sm:flex-row">
            <Input
              label="From"
              type="datetime-local"
              required
              value={form.from}
              onChange={(event) => setForm((c) => ({ ...c, from: event.target.value }))}
              containerClassName="flex-1"
            />
            <Input
              label="Until"
              type="datetime-local"
              required
              value={form.to}
              onChange={(event) => setForm((c) => ({ ...c, to: event.target.value }))}
              containerClassName="flex-1"
              error={
                form.from !== '' && form.to !== '' && form.to <= form.from
                  ? 'Has to be after the start.'
                  : undefined
              }
            />
          </div>
        )}

        <Select
          label="What is closed"
          value={form.stationId}
          onChange={(event) => setForm((c) => ({ ...c, stationId: event.target.value }))}
        >
          <option value="">The whole store</option>
          {(stations.data ?? []).map((station) => (
            <option key={station.id} value={station.id}>
              {station.name} only
            </option>
          ))}
        </Select>

        <Input
          label="Reason"
          value={form.reason}
          onChange={(event) => setForm((c) => ({ ...c, reason: event.target.value }))}
          hint="For the staff who look at this later. Customers never see it."
          error={error}
        />
      </div>
    </Dialog>
  );
}

/** The calendar day after a `YYYY-MM-DD`, computed in UTC so no timezone can shift it. */
function nextDay(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

// ── Booking settings ────────────────────────────────────────────────────────

function BookingSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: keys.settings,
    queryFn: () => adminClient().capacity.settings(),
  });

  const [draft, setDraft] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data !== undefined) setDraft({ ...settings.data } as Record<string, number>);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => adminClient().capacity.updateSettings(draft),
    onSuccess: () => {
      toast.success('Settings saved. New bookings use these immediately.');
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (settings.isError) {
    return (
      <ErrorState description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
    );
  }
  if (settings.isPending) return <SkeletonList rows={4} />;

  return (
    <div className="flex flex-col gap-base">
      <Card className="grid gap-base sm:grid-cols-2">
        {SETTINGS.map((setting) => (
          <Input
            key={setting.key}
            label={setting.label}
            type="number"
            min={setting.min}
            max={setting.max}
            value={draft[setting.key] ?? ''}
            onChange={(event) =>
              setDraft((current) => ({ ...current, [setting.key]: Number(event.target.value) }))
            }
            hint={setting.hint}
          />
        ))}
      </Card>

      {error !== null && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-base">
        <p className="text-caption text-text-muted">
          Existing bookings keep the settings they were made under. Only new ones change.
        </p>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save settings
        </Button>
      </div>

      <Badge tone="neutral">Holidays and one-off closures are set under Closures.</Badge>
    </div>
  );
}
