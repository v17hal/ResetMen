'use client';

import type { AdminCategoryRow, AdminSegmentRow, AdminServiceRow } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
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

type Tab = 'services' | 'categories' | 'segments';

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
        {(['services', 'categories', 'segments'] as const).map((id) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setTab(id)}
          >
            {id[0]!.toUpperCase() + id.slice(1)}
          </Button>
        ))}
      </div>

      {tab === 'services' ? <Services /> : tab === 'categories' ? <Categories /> : <Segments />}
    </div>
  );
}

// ── Services ────────────────────────────────────────────────────────────────

function Services() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminServiceRow | 'new' | null>(null);

  const services = useQuery({
    queryKey: keys.services,
    queryFn: () => adminClient().catalog.services(),
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

  const uncovered = (services.data ?? []).filter(
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
        rows={services.data ?? []}
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
        ]}
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

  const [form, setForm] = useState({
    name: '',
    slug: '',
    categoryId: '',
    description: '',
    price: '',
    duration: '60',
  });
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

      return isNew
        ? adminClient().catalog.createService(input)
        : adminClient().catalog.updateService(existing!.id, input);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Service created — publish it when it is ready.' : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.services });
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
      </div>
    </Dialog>
  );
}

// ── Categories ──────────────────────────────────────────────────────────────

function Categories() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminCategoryRow | 'new' | null>(null);

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
        rows={categories.data ?? []}
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
        ]}
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
  const [form, setForm] = useState({ name: '', slug: '' });
  const [error, setError] = useState<string | null>(null);

  const segments = useQuery({
    queryKey: keys.segments,
    queryFn: () => adminClient().catalog.segments(),
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
        rows={segments.data ?? []}
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
        ]}
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

/** Matches the server's slug rule: lowercase alphanumerics joined by single hyphens. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
