'use client';

import type {
  AdminAddonGroupRow,
  AdminAddonOptionRow,
  AdminCategoryRow,
  AdminSegmentRow,
  AdminServiceRow,
} from '@reset/api-client';
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
  formatDuration,
  formatMoney,
  paiseToRupees,
  rupeesToPaise,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

type Tab = 'services' | 'categories' | 'segments' | 'addons';

/** Labels are written out rather than derived, because "Addons" is not how it is spelt. */
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'services', label: 'Services' },
  { id: 'categories', label: 'Categories' },
  { id: 'segments', label: 'Segments' },
  { id: 'addons', label: 'Add-ons' },
];

export default function CatalogPage() {
  const [tab, setTab] = useState<Tab>('services');

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Catalog</h1>
        <p className="text-body-sm text-text-muted">
          What customers can book, and how it is grouped.
        </p>
      </header>

      <div role="tablist" className="flex flex-wrap gap-xs">
        {TABS.map(({ id, label }) => (
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

      {tab === 'services' ? (
        <Services />
      ) : tab === 'categories' ? (
        <Categories />
      ) : tab === 'segments' ? (
        <Segments />
      ) : (
        <Addons />
      )}
    </div>
  );
}

// ── Services ────────────────────────────────────────────────────────────────

function Services() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminServiceRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminServiceRow | null>(null);

  const services = useQuery({
    queryKey: keys.services,
    queryFn: () => adminClient().catalog.services(),
  });

  const rows = services.data ?? [];
  const move = useReorder('service', rows, keys.services);

  /**
   * Removing a service.
   *
   * The API refuses while upcoming bookings exist, and says how many. That refusal is
   * shown as it arrives rather than pre-empted here: it is a count this screen does not
   * have, and it is the same answer whoever asks.
   */
  const remove = useMutation({
    mutationFn: (service: AdminServiceRow) => adminClient().catalog.deleteService(service.id),
    onSuccess: (_result, service) => {
      toast.success(`${service.name} removed.`);
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: keys.services });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminClient().catalog.setServiceActive(id, isActive),
    onSuccess: (_, { isActive }) => {
      toast.success(isActive ? 'Published.' : 'Hidden from customers.');
      void queryClient.invalidateQueries({ queryKey: keys.services });
    },
    // The API refuses to publish a service with no duration. That refusal is the whole
    // reason the unpriced Instant Glow placeholders stay invisible, so it is shown as-is.
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (services.isError) {
    return (
      <ErrorState description={errorMessage(services.error)} onRetry={() => void services.refetch()} />
    );
  }

  const uncovered = rows.filter(
    (service) => service.isActive && service._count.stationServices === 0,
  );

  return (
    <div className="flex flex-col gap-base">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Add service</Button>
      </div>

      {/* The configuration error nobody notices until a customer cannot find a slot. */}
      {uncovered.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <p className="text-body font-medium">
            {uncovered.length} published service{uncovered.length === 1 ? '' : 's'} no station
            can perform.
          </p>
          <p className="text-body-sm text-text-muted">
            {uncovered.map((service) => service.name).join(', ')} — these show in the app and
            then offer no times at all. Fix under Capacity → station services.
          </p>
        </Card>
      )}

      <DataTable
        loading={services.isPending}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{ title: 'No services yet', description: 'Add one to make it bookable.' }}
        columns={[
          {
            key: 'name',
            header: 'Service',
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-medium">{row.name}</span>
                <span className="text-caption text-text-muted">
                  {row.category.segment.name} · {row.category.name}
                </span>
              </div>
            ),
          },
          {
            key: 'price',
            header: 'Price',
            align: 'right',
            cell: (row) => formatMoney(row.pricePaise),
          },
          {
            key: 'duration',
            header: 'Duration',
            align: 'right',
            hideOnMobile: true,
            cell: (row) => formatDuration(row.durationMinutes),
          },
          {
            key: 'stations',
            header: 'Stations',
            align: 'right',
            hideOnMobile: true,
            cell: (row) =>
              row._count.stationServices === 0 ? (
                <Badge tone="warning">none</Badge>
              ) : (
                row._count.stationServices
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
                onClick={() => toggle.mutate({ id: row.id, isActive: !row.isActive })}
              >
                {row.isActive ? 'Published' : 'Hidden'}
              </Button>
            ),
          },
          {
            key: 'order',
            header: 'Order',
            align: 'right',
            hideOnMobile: true,
            cell: (row) => <OrderButtons row={row} rows={rows} label={row.name} move={move} />,
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            /**
             * Named buttons rather than only a clickable row.
             *
             * Editing worked all along, as `onRowClick`, with nothing on screen saying so.
             * Deleting existed on the API and was never offered at all, so a service the
             * store stopped doing stayed in the catalog for ever.
             */
            cell: (row) => (
              <div className="flex justify-end gap-xs">
                <Button variant="secondary" size="sm" onClick={() => setEditing(row)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setDeleting(row)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Remove this service?"
        description={
          deleting === null
            ? undefined
            : `${deleting.name} stops appearing in the app. Bookings already taken for it keep ` +
              'their record and are still honoured. This is refused while any of them are ' +
              'still to come.'
        }
        confirmLabel="Yes, remove it"
        cancelLabel="Keep it"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting !== null && remove.mutate(deleting)}
      />

      <ServiceDialog service={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ServiceDialog({
  service,
  onClose,
}: {
  service: AdminServiceRow | 'new' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isNew = service === 'new';
  const existing = service === 'new' || service === null ? null : service;

  const categories = useQuery({
    queryKey: keys.categories,
    queryFn: () => adminClient().catalog.categories(),
  });
  const addonGroups = useQuery({
    queryKey: keys.addonGroups,
    queryFn: () => adminClient().catalog.addonGroups(),
  });

  const [form, setForm] = useState({
    name: '',
    slug: '',
    categoryId: '',
    description: '',
    price: '',
    duration: '60',
  });
  /** Which add-on groups this service offers. Saved as a second call, after the service. */
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      slug: existing?.slug ?? '',
      categoryId: existing?.categoryId ?? '',
      description: existing?.description ?? '',
      price: existing === null ? '' : String(paiseToRupees(existing.pricePaise)),
      duration: existing === null ? '60' : String(existing.durationMinutes),
    });
    setGroupIds((existing?.addonGroups ?? []).map((link) => link.addonGroup.id));
    setError(null);
  }, [existing, isNew]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim() === '' ? null : form.description.trim(),
        imageUrl: existing?.imageUrl ?? null,
        pricePaise: rupeesToPaise(Number(form.price)),
        durationMinutes: Number(form.duration),
        bufferOverrideMinutes: existing?.bufferOverrideMinutes ?? null,
        maxPerSlot: existing?.maxPerSlot ?? null,
        sortOrder: existing?.sortOrder ?? 0,
        // New services start hidden. Publishing is a separate, deliberate action once the
        // price, duration and station coverage are all right.
        isActive: existing?.isActive ?? false,
      };

      /**
       * Two calls, in order.
       *
       * Add-on attachment is a separate endpoint, so the service has to exist before it can
       * be attached to anything. Doing it here rather than in a second screen means a new
       * service arrives complete: staff pick the groups in the same form that sets the price.
       */
      return (async () => {
        const saved = isNew
          ? await adminClient().catalog.createService(input)
          : await adminClient().catalog.updateService(existing!.id, input);
        await adminClient().catalog.setServiceAddonGroups(saved.id, groupIds);
        return saved;
      })();
    },
    onSuccess: () => {
      toast.success(isNew ? 'Service created — publish it when it is ready.' : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.services });
      // The group rows carry the services attached to them, so they are stale too.
      void queryClient.invalidateQueries({ queryKey: keys.addonGroups });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (service === null) return null;

  const canSave =
    form.name.trim() !== '' &&
    form.slug.trim() !== '' &&
    form.categoryId !== '' &&
    Number(form.duration) >= 1 &&
    form.price !== '';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={isNew ? 'Add service' : existing!.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
            {isNew ? 'Create' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(event) => {
            const name = event.target.value;
            setForm((current) => ({
              ...current,
              name,
              // Auto-slug only while creating. Changing a live slug breaks any link to it.
              slug: isNew ? slugify(name) : current.slug,
            }));
          }}
        />

        <Input
          label="Slug"
          required
          value={form.slug}
          onChange={(event) => setForm((c) => ({ ...c, slug: event.target.value }))}
          hint="Lowercase words with hyphens. Appears in the customer app's URL."
        />

        <Select
          label="Category"
          required
          value={form.categoryId}
          onChange={(event) => setForm((c) => ({ ...c, categoryId: event.target.value }))}
        >
          <option value="">Choose a category…</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.id}>
              {category.segment.name} · {category.name}
            </option>
          ))}
        </Select>

        <div className="flex gap-base">
          <Input
            label="Price (₹)"
            type="number"
            min={0}
            step="1"
            required
            value={form.price}
            onChange={(event) => setForm((c) => ({ ...c, price: event.target.value }))}
            containerClassName="flex-1"
          />
          <Input
            label="Duration (min)"
            type="number"
            min={1}
            max={480}
            required
            value={form.duration}
            onChange={(event) => setForm((c) => ({ ...c, duration: event.target.value }))}
            containerClassName="flex-1"
            hint="The engine cannot schedule without it."
          />
        </div>

        <Textarea
          label="Description"
          rows={3}
          value={form.description}
          onChange={(event) => setForm((c) => ({ ...c, description: event.target.value }))}
          error={error}
        />

        <fieldset className="flex flex-col gap-sm">
          <legend className="text-body-sm font-medium">Add-ons offered</legend>
          <p className="text-caption text-text-muted">
            Each group a customer is asked about while booking this service. Add-ons change
            the price and the length of the appointment, so the slot engine reserves the
            longer time. Groups themselves are built under the Add-ons tab.
          </p>

          {(addonGroups.data ?? []).length === 0 ? (
            <p className="text-caption text-text-muted">
              No add-on groups exist yet. Nothing to offer until one is created.
            </p>
          ) : (
            (addonGroups.data ?? []).map((group) => (
              <Checkbox
                key={group.id}
                label={group.name}
                hint={`Choose ${group.minSelect}–${group.maxSelect} · ${group.options.length} option${group.options.length === 1 ? '' : 's'}`}
                checked={groupIds.includes(group.id)}
                onChange={(event) =>
                  setGroupIds((current) =>
                    event.target.checked
                      ? [...current, group.id]
                      : current.filter((id) => id !== group.id),
                  )
                }
              />
            ))
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}

// ── Categories ──────────────────────────────────────────────────────────────

function Categories() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminCategoryRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminCategoryRow | null>(null);

  const categories = useQuery({
    queryKey: keys.categories,
    queryFn: () => adminClient().catalog.categories(),
  });
  const segments = useQuery({
    queryKey: keys.segments,
    queryFn: () => adminClient().catalog.segments(),
  });

  const [form, setForm] = useState({ name: '', slug: '', segmentId: '' });
  const [error, setError] = useState<string | null>(null);
  const existing = editing === 'new' || editing === null ? null : editing;

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      slug: existing?.slug ?? '',
      segmentId: existing?.segmentId ?? segments.data?.[0]?.id ?? '',
    });
    setError(null);
  }, [existing, editing, segments.data]);

  const rows = categories.data ?? [];
  const move = useReorder('category', rows, keys.categories);

  /** Refused while the category still holds services — the API says how many. */
  const remove = useMutation({
    mutationFn: (category: AdminCategoryRow) =>
      adminClient().catalog.deleteCategory(category.id),
    onSuccess: (_result, category) => {
      toast.success(`${category.name} removed.`);
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: keys.categories });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const save = useMutation({
    mutationFn: () => {
      const input = {
        segmentId: form.segmentId,
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: existing?.description ?? null,
        imageUrl: existing?.imageUrl ?? null,
        sortOrder: existing?.sortOrder ?? 0,
        isActive: existing?.isActive ?? true,
      };
      return existing === null
        ? adminClient().catalog.createCategory(input)
        : adminClient().catalog.updateCategory(existing.id, input);
    },
    onSuccess: () => {
      toast.success('Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.categories });
      setEditing(null);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (categories.isError) {
    return (
      <ErrorState
        description={errorMessage(categories.error)}
        onRetry={() => void categories.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-base">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Add category</Button>
      </div>

      <DataTable
        loading={categories.isPending}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{ title: 'No categories yet' }}
        columns={[
          {
            key: 'name',
            header: 'Category',
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-medium">{row.name}</span>
                <span className="text-caption text-text-muted">{row.segment.name}</span>
              </div>
            ),
          },
          {
            key: 'services',
            header: 'Services',
            align: 'right',
            cell: (row) => row._count.services,
          },
          {
            key: 'active',
            header: '',
            align: 'right',
            cell: (row) => (row.isActive ? null : <Badge>Hidden</Badge>),
          },
          {
            key: 'order',
            header: 'Order',
            align: 'right',
            hideOnMobile: true,
            cell: (row) => <OrderButtons row={row} rows={rows} label={row.name} move={move} />,
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setDeleting(row)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Remove this category?"
        description={
          deleting === null
            ? undefined
            : `${deleting.name} disappears from the grouping customers browse. It has to be ` +
              'emptied of services first — move them elsewhere and try again.'
        }
        confirmLabel="Yes, remove it"
        cancelLabel="Keep it"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting !== null && remove.mutate(deleting)}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        variant="sheet"
        title={existing === null ? 'Add category' : existing.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={form.name.trim() === '' || form.slug.trim() === '' || form.segmentId === ''}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-base">
          <Select
            label="Segment"
            required
            value={form.segmentId}
            onChange={(event) => setForm((c) => ({ ...c, segmentId: event.target.value }))}
          >
            {(segments.data ?? []).map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.name}
              </option>
            ))}
          </Select>
          <Input
            label="Name"
            required
            value={form.name}
            onChange={(event) =>
              setForm((c) => ({
                ...c,
                name: event.target.value,
                slug: existing === null ? slugify(event.target.value) : c.slug,
              }))
            }
          />
          <Input
            label="Slug"
            required
            value={form.slug}
            onChange={(event) => setForm((c) => ({ ...c, slug: event.target.value }))}
            error={error}
          />
        </div>
      </Dialog>
    </div>
  );
}

// ── Segments ────────────────────────────────────────────────────────────────

function Segments() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminSegmentRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminSegmentRow | null>(null);
  const [form, setForm] = useState({ name: '', slug: '' });
  const [error, setError] = useState<string | null>(null);

  const segments = useQuery({
    queryKey: keys.segments,
    queryFn: () => adminClient().catalog.segments(),
  });

  const rows = segments.data ?? [];
  const move = useReorder('segment', rows, keys.segments);

  /** Refused while the segment still holds categories — the API says how many. */
  const remove = useMutation({
    mutationFn: (segment: AdminSegmentRow) => adminClient().catalog.deleteSegment(segment.id),
    onSuccess: (_result, segment) => {
      toast.success(`${segment.name} removed.`);
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: keys.segments });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const existing = editing === 'new' || editing === null ? null : editing;

  useEffect(() => {
    setForm({ name: existing?.name ?? '', slug: existing?.slug ?? '' });
    setError(null);
  }, [existing, editing]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        imageUrl: existing?.imageUrl ?? null,
        sortOrder: existing?.sortOrder ?? 0,
        isActive: existing?.isActive ?? true,
      };
      return existing === null
        ? adminClient().catalog.createSegment(input)
        : adminClient().catalog.updateSegment(existing.id, input);
    },
    onSuccess: () => {
      toast.success('Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.segments });
      setEditing(null);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        Segments are the top-level split — Men, Women. The switcher hides itself in the
        customer app when only one is active, so adding Women later is a catalog entry rather
        than a release.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Add segment</Button>
      </div>

      <DataTable
        loading={segments.isPending}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{ title: 'No segments yet' }}
        columns={[
          { key: 'name', header: 'Segment', cell: (row) => row.name },
          {
            key: 'categories',
            header: 'Categories',
            align: 'right',
            cell: (row) => row._count.categories,
          },
          {
            key: 'active',
            header: '',
            align: 'right',
            cell: (row) => (row.isActive ? null : <Badge>Hidden</Badge>),
          },
          {
            key: 'order',
            header: 'Order',
            align: 'right',
            hideOnMobile: true,
            cell: (row) => <OrderButtons row={row} rows={rows} label={row.name} move={move} />,
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  onClick={() => setDeleting(row)}
                >
                  Delete
                </Button>
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Remove this segment?"
        description={
          deleting === null
            ? undefined
            : `${deleting.name} disappears from the switcher in the app. It has to be emptied ` +
              'of categories first — move them elsewhere and try again.'
        }
        confirmLabel="Yes, remove it"
        cancelLabel="Keep it"
        destructive
        loading={remove.isPending}
        onConfirm={() => deleting !== null && remove.mutate(deleting)}
      />

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        variant="sheet"
        title={existing === null ? 'Add segment' : existing.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={form.name.trim() === '' || form.slug.trim() === ''}
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
            onChange={(event) =>
              setForm((c) => ({
                ...c,
                name: event.target.value,
                slug: existing === null ? slugify(event.target.value) : c.slug,
              }))
            }
          />
          <Input
            label="Slug"
            required
            value={form.slug}
            onChange={(event) => setForm((c) => ({ ...c, slug: event.target.value }))}
            error={error}
          />
        </div>
      </Dialog>
    </div>
  );
}

// ── Ordering ────────────────────────────────────────────────────────────────

/**
 * Move one row up or down and tell the server the new order.
 *
 * The endpoint takes the whole list rather than the row that moved, so the positions are
 * renumbered from zero on every move. That is deliberate: seed data and hand-edits leave
 * gaps and duplicate positions behind, and a list that renumbers itself cannot drift into
 * an order nobody chose.
 *
 * Nothing called this endpoint before, and the client's own signature offered entity names
 * — plurals, and an `addon-options` — that the route has never accepted. Any call it
 * invited would have been rejected before reaching a handler.
 */
function useReorder<Row extends { id: string }>(
  entity: 'segment' | 'category' | 'service' | 'addonGroup',
  rows: readonly Row[],
  queryKey: readonly unknown[],
) {
  const toast = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, by }: { id: string; by: -1 | 1 }): Promise<unknown> => {
      const order = [...rows];
      const from = order.findIndex((row) => row.id === id);
      const to = from + by;
      if (from < 0 || to < 0 || to >= order.length) return Promise.resolve(null);

      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved!);

      return adminClient().catalog.reorder(
        entity,
        order.map((row, index) => ({ id: row.id, sortOrder: index })),
      );
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (caught) => toast.error(errorMessage(caught)),
  });
}

/**
 * The two arrows that drive it.
 *
 * Labelled for screen readers with the row's own name, because "up" on its own says nothing
 * about which of twenty rows is about to move.
 */
function OrderButtons<Row extends { id: string }>({
  row,
  rows,
  label,
  move,
}: {
  row: Row;
  rows: readonly Row[];
  label: string;
  move: { mutate: (variables: { id: string; by: -1 | 1 }) => void; isPending: boolean };
}) {
  const index = rows.findIndex((candidate) => candidate.id === row.id);

  return (
    <div className="flex justify-end gap-3xs">
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Move ${label} up`}
        disabled={index <= 0 || move.isPending}
        onClick={() => move.mutate({ id: row.id, by: -1 })}
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Move ${label} down`}
        disabled={index < 0 || index >= rows.length - 1 || move.isPending}
        onClick={() => move.mutate({ id: row.id, by: 1 })}
      >
        ↓
      </Button>
    </div>
  );
}

// ── Add-ons ─────────────────────────────────────────────────────────────────

/**
 * Add-on groups and the options inside them.
 *
 * The whole add-on system existed on the API with no screen anywhere, so the add-ons a
 * customer was offered were whatever the database had been seeded with and could never be
 * changed, priced or retired.
 *
 * A group is the question — "Hot towel?" — and an option is an answer. `minSelect` and
 * `maxSelect` decide whether answering is optional and how many answers are allowed.
 * Which services ask which questions is set on the service, not here; the services already
 * using a group are listed read-only so it is obvious what a change touches.
 */
function Addons() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [editingGroup, setEditingGroup] = useState<AdminAddonGroupRow | 'new' | null>(null);
  const [editingOption, setEditingOption] = useState<
    { groupId: string; groupName: string; option: AdminAddonOptionRow | null } | null
  >(null);
  const [removing, setRemoving] = useState<AdminAddonOptionRow | null>(null);

  const groups = useQuery({
    queryKey: keys.addonGroups,
    queryFn: () => adminClient().catalog.addonGroups(),
  });

  const rows = groups.data ?? [];
  const move = useReorder('addonGroup', rows, keys.addonGroups);

  /**
   * Retiring an option.
   *
   * The endpoint deactivates rather than erases, and the row stays in this list — priced
   * add-ons appear on past bookings and those records have to keep meaning something. The
   * dialog says so, because a "Delete" that leaves the row on screen otherwise reads as a
   * failure.
   */
  const removeOption = useMutation({
    mutationFn: (option: AdminAddonOptionRow) =>
      adminClient().catalog.deleteAddonOption(option.id),
    onSuccess: (_result, option) => {
      toast.success(`${option.name} is no longer offered.`);
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: keys.addonGroups });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (groups.isError) {
    return (
      <ErrorState description={errorMessage(groups.error)} onRetry={() => void groups.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        Add-ons are the extras offered while booking — a hot towel, a longer massage. They
        change both the price and the length of the appointment, and the slot engine reserves
        the longer time, so an add-on that adds fifteen minutes takes fifteen minutes of the
        station.
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setEditingGroup('new')}>+ Add group</Button>
      </div>

      {groups.isPending ? (
        <Card className="text-body-sm text-text-muted">Loading…</Card>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-body font-medium">No add-on groups yet</p>
          <p className="text-body-sm text-text-muted">
            Create one, add the options customers can pick, then attach it to a service from
            the Services tab.
          </p>
        </Card>
      ) : (
        rows.map((group) => (
          <Card key={group.id} className="flex flex-col gap-sm">
            <div className="flex flex-wrap items-start justify-between gap-sm">
              <div className="flex flex-col">
                <span className="flex items-center gap-xs font-medium">
                  {group.name}
                  {!group.isActive && <Badge>Hidden</Badge>}
                </span>
                <span className="text-caption text-text-muted">
                  {group.minSelect === 0
                    ? `Optional · up to ${group.maxSelect}`
                    : `Choose ${group.minSelect}–${group.maxSelect}`}
                  {' · '}
                  {group.services.length === 0
                    ? 'no services use this'
                    : group.services.map((link) => link.service.name).join(', ')}
                </span>
              </div>

              <div className="flex items-center gap-xs">
                <OrderButtons row={group} rows={rows} label={group.name} move={move} />
                <Button variant="secondary" size="sm" onClick={() => setEditingGroup(group)}>
                  Edit group
                </Button>
              </div>
            </div>

            {/* No station covers this, so nothing is bookable through it either. */}
            {group.services.length === 0 && group.isActive && (
              <p className="text-caption text-warning">
                Attached to no service, so no customer will ever be asked this. Attach it from
                the Services tab.
              </p>
            )}

            <ul className="flex flex-col divide-y divide-border border-t border-border">
              {group.options.length === 0 && (
                <li className="py-sm text-body-sm text-text-muted">
                  No options yet — the group is a question with no answers, and is skipped.
                </li>
              )}

              {group.options.map((option) => (
                <li key={option.id} className="flex items-center justify-between gap-sm py-sm">
                  <div className="flex flex-col">
                    <span className="flex items-center gap-xs text-body-sm">
                      {option.name}
                      {!option.isActive && <Badge>Not offered</Badge>}
                    </span>
                    <span className="text-caption text-text-muted">
                      {option.pricePaise === 0 ? 'No extra charge' : `+ ${formatMoney(option.pricePaise)}`}
                      {option.durationDeltaMinutes > 0 &&
                        ` · + ${formatDuration(option.durationDeltaMinutes)}`}
                    </span>
                  </div>

                  <div className="flex shrink-0 gap-xs">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setEditingOption({ groupId: group.id, groupName: group.name, option })
                      }
                    >
                      Edit
                    </Button>
                    {option.isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() => setRemoving(option)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setEditingOption({ groupId: group.id, groupName: group.name, option: null })
                }
              >
                + Add option
              </Button>
            </div>
          </Card>
        ))
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Stop offering this add-on?"
        description={
          removing === null
            ? undefined
            : `${removing.name} will not be offered on new bookings. It stays in this list, ` +
              'marked "not offered", because bookings already taken with it have to keep ' +
              'their record of what was charged. Editing it turns it back on.'
        }
        confirmLabel="Yes, stop offering it"
        cancelLabel="Keep offering it"
        destructive
        loading={removeOption.isPending}
        onConfirm={() => removing !== null && removeOption.mutate(removing)}
      />

      <AddonGroupDialog group={editingGroup} onClose={() => setEditingGroup(null)} />
      <AddonOptionDialog target={editingOption} onClose={() => setEditingOption(null)} />
    </div>
  );
}

function AddonGroupDialog({
  group,
  onClose,
}: {
  group: AdminAddonGroupRow | 'new' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isNew = group === 'new';
  const existing = group === 'new' || group === null ? null : group;

  const [form, setForm] = useState({ name: '', min: '0', max: '1', isActive: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      min: String(existing?.minSelect ?? 0),
      max: String(existing?.maxSelect ?? 1),
      isActive: existing?.isActive ?? true,
    });
    setError(null);
  }, [existing, isNew]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: form.name.trim(),
        minSelect: Number(form.min),
        maxSelect: Number(form.max),
        sortOrder: existing?.sortOrder ?? 0,
        isActive: form.isActive,
      };
      return isNew
        ? adminClient().catalog.createAddonGroup(input)
        : adminClient().catalog.updateAddonGroup(existing!.id, input);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Group created — add its options next.' : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.addonGroups });
      void queryClient.invalidateQueries({ queryKey: keys.services });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (group === null) return null;

  const min = Number(form.min);
  const max = Number(form.max);
  const canSave =
    form.name.trim() !== '' && Number.isInteger(min) && Number.isInteger(max) && max >= Math.max(min, 1);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={isNew ? 'Add add-on group' : existing!.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
            {isNew ? 'Create' : 'Save'}
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
          hint="The question the customer is asked. “Hot towel”, “Extra time”."
        />

        <div className="flex gap-base">
          <Input
            label="Minimum picks"
            type="number"
            min={0}
            value={form.min}
            onChange={(event) => setForm((c) => ({ ...c, min: event.target.value }))}
            containerClassName="flex-1"
            hint="0 makes it optional."
          />
          <Input
            label="Maximum picks"
            type="number"
            min={1}
            value={form.max}
            onChange={(event) => setForm((c) => ({ ...c, max: event.target.value }))}
            containerClassName="flex-1"
            hint="1 makes it a single choice."
          />
        </div>

        {max < min && (
          <p className="text-caption text-danger">
            The maximum cannot be below the minimum, or nothing satisfies it.
          </p>
        )}

        <Checkbox
          label="Offered to customers"
          hint="Turn off to retire the whole group without deleting what it has recorded."
          checked={form.isActive}
          onChange={(event) => setForm((c) => ({ ...c, isActive: event.target.checked }))}
        />

        {error !== null && <p className="text-caption text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function AddonOptionDialog({
  target,
  onClose,
}: {
  target: { groupId: string; groupName: string; option: AdminAddonOptionRow | null } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const existing = target?.option ?? null;

  const [form, setForm] = useState({ name: '', price: '0', minutes: '0', isActive: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      // The row comes back as `pricePaise` and goes out as `priceDeltaPaise`. The server
      // renames it on the way in; this is the only place that has to know.
      price: existing === null ? '0' : String(paiseToRupees(existing.pricePaise)),
      minutes: String(existing?.durationDeltaMinutes ?? 0),
      isActive: existing?.isActive ?? true,
    });
    setError(null);
  }, [existing, target]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: form.name.trim(),
        priceDeltaPaise: rupeesToPaise(Number(form.price)),
        durationDeltaMinutes: Number(form.minutes),
        sortOrder: existing?.sortOrder ?? 0,
        isActive: form.isActive,
      };
      return existing === null
        ? adminClient().catalog.addAddonOption(target!.groupId, input)
        : adminClient().catalog.updateAddonOption(existing.id, input);
    },
    onSuccess: () => {
      toast.success('Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.addonGroups });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (target === null) return null;

  const minutes = Number(form.minutes);
  const canSave =
    form.name.trim() !== '' &&
    form.price !== '' &&
    Number(form.price) >= 0 &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= 120;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={existing === null ? `Add option to ${target.groupName}` : existing.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
            {existing === null ? 'Add' : 'Save'}
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
        />

        <div className="flex gap-base">
          <Input
            label="Extra charge (₹)"
            type="number"
            min={0}
            step="1"
            required
            value={form.price}
            onChange={(event) => setForm((c) => ({ ...c, price: event.target.value }))}
            containerClassName="flex-1"
            hint="0 for a free extra."
          />
          <Input
            label="Extra time (min)"
            type="number"
            min={0}
            max={120}
            required
            value={form.minutes}
            onChange={(event) => setForm((c) => ({ ...c, minutes: event.target.value }))}
            containerClassName="flex-1"
            hint="Held on the station as well as charged."
          />
        </div>

        <Checkbox
          label="Offered to customers"
          checked={form.isActive}
          onChange={(event) => setForm((c) => ({ ...c, isActive: event.target.checked }))}
        />

        {error !== null && <p className="text-caption text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

/** Matches the server's slug rule: lowercase alphanumerics joined by single hyphens. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
