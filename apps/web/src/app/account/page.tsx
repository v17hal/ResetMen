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
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED'>('UNDISCLOSED');
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    // Shown without the +91 the API stores, so the prefix in the field is not doubled.
    setPhone(user?.phone?.replace(/^\+91/, '') ?? '');
    setDateOfBirth(user?.dateOfBirth ?? '');
    setGender(user?.gender ?? 'UNDISCLOSED');
  }, [user]);

  const orders = useQuery({
    queryKey: ['product-orders'],
    queryFn: () => api().products.orders(),
    enabled: hasToken,
  });

  const save = useMutation({
    mutationFn: () => {
      const digits = phone.replace(/\D/g, '');

      /**
       * A cleared number used to be dropped from the request.
       *
       * The comment said it was so "I'd rather not give my number" did not become a
       * validation error — but a booking cannot be made without one, so the number is no
       * longer optional. Dropping it meant the field emptied, the request omitted it, the
       * server kept the old value and answered 200, and the screen said Saved. The customer
       * believed the number was gone, then booked anyway, and reported both as bugs.
       *
       * It now refuses, and says why.
       */
      if (digits.length === 0 && (user?.phone ?? '') !== '') {
        throw new Error(
          'A mobile number is needed to book. Replace it rather than clearing it.',
        );
      }

      // Ten digits starting 6-9 is every Indian mobile. Checked here so a typo costs a
      // keystroke instead of a round trip, and rejected the same way by the server.
      if (digits.length > 0 && !/^[6-9]\d{9}$/.test(digits.slice(-10))) {
        throw new Error('Enter a 10-digit Indian mobile number.');
      }

      return api().auth.updateProfile({
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(email.trim() === '' ? {} : { email: email.trim() }),
        ...(digits.length === 0 ? {} : { phone: `+91${digits.slice(-10)}` }),
        ...(dateOfBirth === '' ? {} : { dateOfBirth }),
        gender,
      });
    },
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
          hint="From your Google account."
        />

        {/* Asked for, never required. Google sign-in gives no phone number, and the counter
            needs one to link a walk-in or ring someone who is running late. */}
        <Input
          label="Mobile number"
          type="tel"
          inputMode="numeric"
          value={phone}
          // Ten digits is the whole of an Indian mobile; the extra room is for spaces
          // someone pastes in. Stops fifty digits reaching the server to be rejected.
          maxLength={14}
          onChange={(event) => setPhone(event.target.value)}
          autoComplete="tel"
          placeholder="94044 91801"
          hint="Optional — lets the store reach you about your booking."
        />

        <Input
          label="Date of birth"
          type="date"
          value={dateOfBirth}
          onChange={(event) => setDateOfBirth(event.target.value)}
          autoComplete="bday"
          // No future birthdays, and nobody under 13 — the age below which consent is a
          // parent's to give under the DPDP Act.
          max={new Date(new Date().setFullYear(new Date().getFullYear() - 13))
            .toISOString()
            .slice(0, 10)}
          hint="Optional — the store sends a birthday treat."
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
        description="This cannot be undone. Cancel any upcoming bookings first so the store knows not to expect you."
        confirmLabel="Delete my account"
        cancelLabel="Keep my account"
        destructive
        loading={deleteAccount.isPending}
        onConfirm={() => deleteAccount.mutate()}
      />
    </div>
  );
}
