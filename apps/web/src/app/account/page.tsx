'use client';

import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Select,
  SkeletonList,
  formatDateTime,
  formatMoney,
  formatPhone,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { SignIn } from '@/components/sign-in';
import { errorMessage, useAuth } from '@/lib/auth';
import { api } from '@/lib/client';

export default function AccountPage() {
  const { user, hasToken, loading, signOut, refresh } = useAuth();
  const toast = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED'>('UNDISCLOSED');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setGender(user?.gender ?? 'UNDISCLOSED');
  }, [user]);

  const orders = useQuery({
    queryKey: ['product-orders'],
    queryFn: () => api().products.orders(),
    enabled: hasToken,
  });

  const save = useMutation({
    mutationFn: () =>
      api().auth.updateProfile({
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(email.trim() === '' ? {} : { email: email.trim() }),
        gender,
      }),
    onSuccess: () => {
      toast.success('Saved.');
      refresh();
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  const deleteAccount = useMutation({
    mutationFn: () => api().auth.deleteAccount(),
    onSuccess: () => {
      toast.success('Your account will be deleted. You have been signed out.');
      setDeleteOpen(false);
      signOut();
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  if (!hasToken) {
    return (
      <div className="flex flex-col gap-base p-base">
        <h1 className="font-display text-h1">You</h1>
        <Card>
          <SignIn reason="Sign in with your mobile number. No password to remember." />
        </Card>
      </div>
    );
  }

  if (loading || user === null) return <SkeletonList rows={3} className="p-base" />;

  return (
    <div className="flex flex-col gap-lg p-base">
      <header className="flex flex-col gap-xs">
        <h1 className="font-display text-h1">{user.name ?? 'Your account'}</h1>
        {/* Google sign-in gives an email and no phone, so this is the account's identity
            line only when they have actually given us a number. */}
        <p className="text-body-sm text-text-muted">
          {user.phone !== null ? formatPhone(user.phone) : (user.email ?? 'Signed in')}
        </p>
      </header>

      <Card className="flex flex-col gap-base">
        <h2 className="font-display text-h2">Details</h2>

        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          hint="What we call you at the counter."
        />

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          hint="Optional. Only used for booking receipts."
        />

        <Select
          label="Gender"
          value={gender}
          onChange={(event) => setGender(event.target.value as typeof gender)}
        >
          <option value="UNDISCLOSED">Prefer not to say</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
          <option value="OTHER">Other</option>
        </Select>

        <Button loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </Card>

      {orders.data !== undefined && orders.data.length > 0 && (
        <section className="flex flex-col gap-sm">
          <h2 className="font-display text-h2">Shop orders</h2>
          <ul className="flex flex-col gap-sm">
            {orders.data.map((order) => (
              <li key={order.id}>
                <Card className="flex items-center gap-base">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-body-sm">{order.publicId}</p>
                    <p className="text-caption text-text-muted">
                      {formatDateTime(order.createdAt)} ·{' '}
                      {order.items.map((item) => `${item.qty}× ${item.name}`).join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-xs">
                    <span className="font-mono text-body-sm">
                      {formatMoney(order.totalPaise)}
                    </span>
                    <Badge tone={order.status === 'READY_FOR_PICKUP' ? 'success' : 'neutral'}>
                      {order.status.toLowerCase().replace(/_/g, ' ')}
                    </Badge>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card className="flex flex-col gap-sm">
        <h2 className="font-display text-h2">Account</h2>

        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>

        <Button variant="ghost" className="text-danger" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>

        {/*
          Required by Play Store policy and the DPDP Act. Says plainly what survives: past
          bookings are financial records and are kept, but with the person detached from them.
        */}
        <p className="text-caption text-text-muted">
          Deleting removes your name, number and contact details after a short grace period.
          Records of past payments are kept for tax purposes, without you attached to them.
        </p>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete your account?"
        description="This cannot be undone. Any upcoming bookings should be cancelled first if you want a refund."
        confirmLabel="Delete my account"
        cancelLabel="Keep my account"
        destructive
        loading={deleteAccount.isPending}
        onConfirm={() => deleteAccount.mutate()}
      />
    </div>
  );
}
