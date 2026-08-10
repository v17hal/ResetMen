'use client';

import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  ErrorState,
  Input,
  SkeletonList,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { AllocationRules } from '@/components/allocation-rules';
import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys, useServices, useStations } from '@/lib/queries';

type Tab = 'stations' | 'rules' | 'hours' | 'settings';

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
      ) : (
        <BookingSettings />
      )}
    </div>
  );
}

// ── Stations ────────────────────────────────────────────────────────────────

interface StationRow {
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

function Stations() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const stations = useStations();
  const [editing, setEditing] = useState<StationRow | 'new' | null>(null);
  const [designating, setDesignating] = useState<StationRow | null>(null);

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
    mutationFn: (station: StationRow) =>
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
        rows={(stations.data ?? []) as StationRow[]}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{
          title: 'No stations',
          description: 'Nothing can be booked until at least one station exists.',
        }}
        columns={[
          { key: 'name', header: 'Station', cell: (row) => row.name },
          {
            key: 'services',
            header: '',
            align: 'right',
            cell: (row) => (
              <Button variant="ghost" size="sm" onClick={() => setDesignating(row)}>
                Services
              </Button>
            ),
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
  station: StationRow | null;
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
    hint: 'How long before the slot a customer can still cancel for a full refund.',
    min: 0,
    max: 10080,
  },
];

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

      <Badge tone="neutral">Blackouts and one-off closures are set from the timeline.</Badge>
    </div>
  );
}
