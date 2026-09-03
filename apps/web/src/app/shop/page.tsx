'use client';

import type { ProductDto } from '@reset/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  SkeletonList,
  formatMoney,
  stagger,
  useReducedMotion,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { SignIn } from '@/components/sign-in';
import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';
import { PaymentCancelled, openRazorpayCheckout } from '@/lib/razorpay';

/**
 * The retail shelf. Pickup at the store only — delivery is explicitly out of scope.
 *
 * The cart lives in component state rather than storage: it is a handful of items bought on
 * the way out, and a cart that survives a week only ever surprises someone with a stale
 * price at checkout.
 */
export default function ShopPage() {
  const { hasToken } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const reduced = useReducedMotion();

  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [signInOpen, setSignInOpen] = useState(false);
  const orderKey = useRef(`order-${crypto.randomUUID()}`);

  const products = useQuery({ queryKey: ['products'], queryFn: () => api().products.list() });
  const store = useQuery({ queryKey: ['store'], queryFn: () => api().catalog.store() });

  const lines = useMemo(
    () =>
      [...cart.entries()]
        .map(([productId, qty]) => ({
          product: products.data?.find((p) => p.id === productId),
          qty,
        }))
        .filter((line): line is { product: ProductDto; qty: number } => line.product !== undefined),
    [cart, products.data],
  );

  const total = lines.reduce((sum, line) => sum + line.product.pricePaise * line.qty, 0);

  const checkout = useMutation({
    mutationFn: async () => {
      const order = await api().products.createOrder(
        { items: lines.map((line) => ({ productId: line.product.id, qty: line.qty })) },
        orderKey.current,
      );

      /**
       * With payment at the counter there is no checkout to open.
       *
       * This used to run the payment path unconditionally. In production that meant: the
       * order was created and the stock came off the shelf, the payment endpoint reported
       * itself simulated because no Razorpay keys exist, and `simulateSuccess` — which
       * refuses to run in production, correctly — returned a 500. The customer was shown an
       * error for an order that had in fact been placed, and the shelf was short by
       * whatever they had bought.
       *
       * The booking flow has always skipped payment the same way. This is that.
       */
      if (store.data?.paymentsEnabled !== true) return order;

      const payment = await api().payments.createOrder(
        { productOrderId: order.id },
        `${orderKey.current}-pay`,
      );

      if (payment.simulated) {
        await api().payments.simulateSuccess(payment.paymentId);
        return order;
      }

      const result = await openRazorpayCheckout({
        order: payment,
        name: store.data?.name ?? 'RESET',
        description: `${lines.length} item${lines.length === 1 ? '' : 's'}`,
      });

      await api()
        .payments.verify(result)
        .catch(() => undefined);

      return order;
    },
    onSuccess: () => {
      toast.success(
        store.data?.paymentsEnabled === true
          ? 'Paid. We will text you when it is ready to collect.'
          : 'Ordered. Pay at the store when you collect it.',
      );
      setCart(new Map());
      // A fresh key, or a second order would replay the first one's response.
      orderKey.current = `order-${crypto.randomUUID()}`;
      router.push('/account');
    },
    onError: (caught) => {
      if (caught instanceof PaymentCancelled) return;
      toast.error(errorMessage(caught, 'Could not complete the order.'));
    },
  });

  function setQty(product: ProductDto, qty: number): void {
    setCart((current) => {
      const next = new Map(current);
      if (qty <= 0) next.delete(product.id);
      else next.set(product.id, Math.min(qty, 20));
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-base p-base">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-h1">Shop</h1>
        <p className="text-body-sm text-text-muted">Pay online, collect at the counter.</p>
      </header>

      {products.isError ? (
        <ErrorState
          description={errorMessage(products.error)}
          onRetry={() => void products.refetch()}
        />
      ) : products.isPending ? (
        <SkeletonList rows={3} />
      ) : products.data.length === 0 ? (
        <EmptyState title="Nothing in the shop yet" />
      ) : (
        <ul className="flex flex-col gap-sm">
          {products.data.map((product, index) => {
            const qty = cart.get(product.id) ?? 0;

            return (
              <li key={product.id} {...stagger(index, reduced)}>
                <Card elevated className="flex items-center gap-base">
                  {product.images[0] !== undefined && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.images[0]}
                      alt=""
                      className="h-16 w-16 shrink-0 rounded-md object-cover"
                      loading="lazy"
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">{product.name}</p>
                    <div className="flex items-baseline gap-xs">
                      <span className="font-mono text-body-sm">
                        {formatMoney(product.pricePaise)}
                      </span>
                      {product.mrpPaise !== null && product.mrpPaise > product.pricePaise && (
                        <span className="text-caption text-text-muted line-through">
                          {formatMoney(product.mrpPaise)}
                        </span>
                      )}
                    </div>
                    {!product.inStock && <Badge tone="danger">Out of stock</Badge>}
                  </div>

                  {product.inStock &&
                    (qty === 0 ? (
                      <Button size="sm" variant="secondary" onClick={() => setQty(product, 1)}>
                        Add
                      </Button>
                    ) : (
                      <div className="flex items-center gap-xs">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Remove one ${product.name}`}
                          onClick={() => setQty(product, qty - 1)}
                        >
                          −
                        </Button>
                        <span className="w-6 text-center font-mono tabular-nums">{qty}</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Add one ${product.name}`}
                          onClick={() => setQty(product, qty + 1)}
                        >
                          +
                        </Button>
                      </div>
                    ))}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="sticky bottom-[calc(var(--reset-layout-bottom-nav-height)+env(safe-area-inset-bottom)+0.5rem)] z-20 sm:bottom-base">
          {!hasToken && signInOpen ? (
            <Card>
              <SignIn
                reason="Sign in to pay and collect."
                onSignedIn={() => setSignInOpen(false)}
              />
            </Card>
          ) : (
            <Button
              size="lg"
              fullWidth
              loading={checkout.isPending}
              onClick={() => (hasToken ? checkout.mutate() : setSignInOpen(true))}
            >
              Pay {formatMoney(total)} · {lines.reduce((sum, line) => sum + line.qty, 0)} item
              {lines.reduce((sum, line) => sum + line.qty, 0) === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
