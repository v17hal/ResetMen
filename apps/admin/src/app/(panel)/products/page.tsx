'use client';

import type { AdminProductOrderRow, ProductOrderStatus } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  ErrorState,
  Input,
  Textarea,
  formatDateTime,
  formatMoney,
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

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pricePaise: number;
  mrpPaise: number | null;
  stockQty: number;
  sku: string | null;
  isActive: boolean;
  sortOrder: number;
  images: string[];
}

export default function ProductsPage() {
  const [tab, setTab] = useState<'catalog' | 'orders'>('catalog');

  return (
    <div className="flex flex-col gap-base">
      <header>
        <h1 className="font-display text-h1">Products</h1>
        <p className="text-body-sm text-text-muted">
          Retail shelf. Paid online, collected at the counter.
        </p>
      </header>

      <div role="tablist" className="flex gap-xs">
        {(
          [
            ['catalog', 'Catalog'],
            ['orders', 'Orders'],
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

      {tab === 'catalog' ? <Catalog /> : <Orders />}
    </div>
  );
}

function Catalog() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<ProductRow | null>(null);

  const products = useQuery({
    queryKey: keys.products,
    queryFn: () => adminClient().products.list() as Promise<ProductRow[]>,
  });

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    price: '',
    mrp: '',
    sku: '',
    stock: '0',
  });
  const [error, setError] = useState<string | null>(null);
  const existing = editing === 'new' || editing === null ? null : editing;

  useEffect(() => {
    setForm({
      name: existing?.name ?? '',
      slug: existing?.slug ?? '',
      description: existing?.description ?? '',
      price: existing === null ? '' : String(paiseToRupees(existing.pricePaise)),
      mrp: existing?.mrpPaise == null ? '' : String(paiseToRupees(existing.mrpPaise)),
      sku: existing?.sku ?? '',
      stock: String(existing?.stockQty ?? 0),
    });
    setError(null);
  }, [existing, editing]);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim() === '' ? null : form.description.trim(),
        images: existing?.images ?? [],
        pricePaise: rupeesToPaise(Number(form.price)),
        mrpPaise: form.mrp === '' ? null : rupeesToPaise(Number(form.mrp)),
        // Stock is only set on create. Afterwards it moves by signed delta, so two staff
        // counting the same shelf cannot clobber each other with absolutes.
        stockQty: existing === null ? Number(form.stock) : existing.stockQty,
        sku: form.sku.trim() === '' ? null : form.sku.trim(),
        isActive: existing?.isActive ?? true,
        sortOrder: existing?.sortOrder ?? 0,
      };
      return existing === null
        ? adminClient().products.create(input)
        : adminClient().products.update(existing.id, input);
    },
    onSuccess: () => {
      toast.success('Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.products });
      setEditing(null);
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (products.isError) {
    return (
      <ErrorState description={errorMessage(products.error)} onRetry={() => void products.refetch()} />
    );
  }

  return (
    <div className="flex flex-col gap-base">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}>+ Add product</Button>
      </div>

      <DataTable
        loading={products.isPending}
        rows={products.data ?? []}
        rowKey={(row) => row.id}
        onRowClick={setEditing}
        empty={{ title: 'No products yet' }}
        columns={[
          {
            key: 'name',
            header: 'Product',
            cell: (row) => (
              <div className="flex flex-col">
                <span className="font-medium">{row.name}</span>
                {row.sku !== null && (
                  <span className="font-mono text-caption text-text-muted">{row.sku}</span>
                )}
              </div>
            ),
          },
          {
            key: 'price',
            header: 'Price',
            align: 'right',
            cell: (row) => (
              <div className="flex flex-col items-end">
                <span>{formatMoney(row.pricePaise)}</span>
                {row.mrpPaise !== null && row.mrpPaise > row.pricePaise && (
                  <span className="text-caption text-text-muted line-through">
                    {formatMoney(row.mrpPaise)}
                  </span>
                )}
              </div>
            ),
          },
          {
            key: 'stock',
            header: 'Stock',
            align: 'right',
            cell: (row) =>
              row.stockQty === 0 ? (
                <Badge tone="danger">Out</Badge>
              ) : row.stockQty <= 3 ? (
                <Badge tone="warning">{row.stockQty}</Badge>
              ) : (
                row.stockQty
              ),
          },
          {
            key: 'adjust',
            header: '',
            align: 'right',
            cell: (row) => (
              <Button variant="ghost" size="sm" onClick={() => setAdjusting(row)}>
                Adjust
              </Button>
            ),
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
        title={existing === null ? 'Add product' : existing.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              loading={save.isPending}
              disabled={form.name.trim() === '' || form.slug.trim() === '' || form.price === ''}
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
                slug:
                  existing === null
                    ? event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-+|-+$/g, '')
                    : c.slug,
              }))
            }
          />
          <Input
            label="Slug"
            required
            value={form.slug}
            onChange={(event) => setForm((c) => ({ ...c, slug: event.target.value }))}
          />
          <div className="flex gap-base">
            <Input
              label="Price (₹)"
              type="number"
              min={0}
              required
              value={form.price}
              onChange={(event) => setForm((c) => ({ ...c, price: event.target.value }))}
              containerClassName="flex-1"
            />
            <Input
              label="MRP (₹)"
              type="number"
              min={0}
              value={form.mrp}
              onChange={(event) => setForm((c) => ({ ...c, mrp: event.target.value }))}
              containerClassName="flex-1"
              hint="Optional. Shown struck through."
            />
          </div>
          <div className="flex gap-base">
            <Input
              label="SKU"
              value={form.sku}
              onChange={(event) => setForm((c) => ({ ...c, sku: event.target.value }))}
              containerClassName="flex-1"
            />
            {existing === null && (
              <Input
                label="Opening stock"
                type="number"
                min={0}
                value={form.stock}
                onChange={(event) => setForm((c) => ({ ...c, stock: event.target.value }))}
                containerClassName="flex-1"
              />
            )}
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

      <StockDialog product={adjusting} onClose={() => setAdjusting(null)} />
    </div>
  );
}

function StockDialog({ product, onClose }: { product: ProductRow | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [delta, setDelta] = useState('0');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDelta('0');
    setReason('');
    setError(null);
  }, [product]);

  const adjust = useMutation({
    mutationFn: () =>
      adminClient().products.adjustStock(product!.id, {
        delta: Number(delta),
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      }),
    onSuccess: () => {
      toast.success('Stock adjusted.');
      void queryClient.invalidateQueries({ queryKey: keys.products });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (product === null) return null;

  const next = product.stockQty + Number(delta || 0);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${product.name} — stock`}
      description={`Currently ${product.stockQty}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={adjust.isPending}
            disabled={Number(delta) === 0 || next < 0}
            onClick={() => adjust.mutate()}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-base">
        <Input
          label="Change by"
          type="number"
          value={delta}
          onChange={(event) => setDelta(event.target.value)}
          // A signed delta, not an absolute: two staff counting the same shelf at once must
          // not overwrite each other's count.
          hint={`Positive to add, negative to remove. New total: ${next}.`}
          error={next < 0 ? 'That would take stock below zero.' : null}
        />
        <Textarea
          label="Reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={error}
          hint="Delivery, damage, stock count."
        />
      </div>
    </Dialog>
  );
}

const ORDER_STATUSES: ReadonlyArray<ProductOrderStatus | 'ALL'> = [
  'ALL',
  'PAID',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'CANCELLED',
];

function Orders() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ProductOrderStatus | 'ALL'>('PAID');

  const filter = status === 'ALL' ? undefined : status;

  const orders = useQuery({
    queryKey: keys.productOrders(filter),
    queryFn: () =>
      adminClient().products.orders({ ...(filter === undefined ? {} : { status: filter }), limit: 100 }),
  });

  const setOrderStatus = useMutation({
    mutationFn: ({
      id,
      next,
    }: {
      id: string;
      next: 'READY_FOR_PICKUP' | 'PICKED_UP' | 'CANCELLED';
    }) => adminClient().products.setOrderStatus(id, { status: next }),
    onSuccess: () => {
      toast.success('Order updated.');
      void queryClient.invalidateQueries({ queryKey: ['products', 'orders'] });
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (orders.isError) {
    return <ErrorState description={errorMessage(orders.error)} onRetry={() => void orders.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-base">
      <Card className="text-body-sm text-text-muted">
        Marking an order ready sends the customer a notification. Pickup at the store only —
        delivery is out of scope.
      </Card>

      <div className="flex flex-wrap gap-xs">
        {ORDER_STATUSES.map((option) => (
          <Button
            key={option}
            variant={status === option ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setStatus(option)}
          >
            {option === 'ALL' ? 'All' : option.toLowerCase().replace(/_/g, ' ')}
          </Button>
        ))}
      </div>

      <DataTable
        loading={orders.isPending}
        rows={orders.data?.data ?? []}
        rowKey={(row) => row.id}
        empty={{ title: 'No orders in this view' }}
        columns={[
          {
            key: 'order',
            header: 'Order',
            cell: (row: AdminProductOrderRow) => (
              <div className="flex flex-col">
                <span className="font-mono text-body-sm">{row.publicId}</span>
                <span className="text-caption text-text-muted">
                  {row.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}
                </span>
              </div>
            ),
          },
          {
            key: 'customer',
            header: 'Customer',
            hideOnMobile: true,
            cell: (row: AdminProductOrderRow) => (
              <div className="flex flex-col">
                <span>{row.customerName}</span>
                <span className="text-caption text-text-muted">
                  {formatPhone(row.customerPhone)}
                </span>
              </div>
            ),
          },
          {
            key: 'total',
            header: 'Total',
            align: 'right',
            cell: (row: AdminProductOrderRow) => formatMoney(row.totalPaise),
          },
          {
            key: 'created',
            header: 'Placed',
            hideOnMobile: true,
            cell: (row: AdminProductOrderRow) => formatDateTime(row.createdAt),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row: AdminProductOrderRow) => (
              <Badge
                tone={
                  row.status === 'PICKED_UP'
                    ? 'success'
                    : row.status === 'CANCELLED'
                      ? 'neutral'
                      : 'info'
                }
              >
                {row.status.toLowerCase().replace(/_/g, ' ')}
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (row: AdminProductOrderRow) =>
              row.status === 'PAID' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={setOrderStatus.isPending}
                  onClick={() => setOrderStatus.mutate({ id: row.id, next: 'READY_FOR_PICKUP' })}
                >
                  Mark ready
                </Button>
              ) : row.status === 'READY_FOR_PICKUP' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={setOrderStatus.isPending}
                  onClick={() => setOrderStatus.mutate({ id: row.id, next: 'PICKED_UP' })}
                >
                  Collected
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
