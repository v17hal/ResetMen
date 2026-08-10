'use client';

import type { AdminRole, StaffSummary } from '@reset/api-client';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorState,
  Input,
  Select,
  formatDate,
  useToast,
} from '@reset/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { errorMessage, useAuth } from '@/lib/auth';
import { adminClient } from '@/lib/client';
import { keys } from '@/lib/queries';

const ROLE_HELP: Record<AdminRole, string> = {
  STAFF: 'Counter work: the timeline, check-in, walk-ins and customer lookup.',
  MANAGER: 'Everything staff can do, plus catalog, capacity, rewards, refunds and reports.',
  OWNER: 'Everything, including staff accounts and the audit log.',
};

export default function StaffPage() {
  const { session } = useAuth();
  const [editing, setEditing] = useState<StaffSummary | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<StaffSummary | null>(null);

  const staff = useQuery({
    queryKey: keys.staff,
    queryFn: () => adminClient().staff.list(),
  });

  const queryClient = useQueryClient();
  const toast = useToast();

  const deactivate = useMutation({
    mutationFn: (id: string) => adminClient().staff.deactivate(id),
    onSuccess: () => {
      toast.success('Account deactivated.');
      void queryClient.invalidateQueries({ queryKey: keys.staff });
      setDeactivating(null);
    },
    onError: (caught) => toast.error(errorMessage(caught)),
  });

  return (
    <div className="flex flex-col gap-base">
      <header className="flex flex-wrap items-end justify-between gap-sm">
        <div>
          <h1 className="font-display text-h1">Staff</h1>
          <p className="text-body-sm text-text-muted">
            Who can sign in, and what they can reach.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>+ Add staff</Button>
      </header>

      {staff.isError ? (
        <ErrorState description={errorMessage(staff.error)} onRetry={() => void staff.refetch()} />
      ) : (
        <DataTable
          loading={staff.isPending}
          rows={staff.data ?? []}
          rowKey={(row) => row.id}
          onRowClick={setEditing}
          empty={{ title: 'No staff accounts' }}
          columns={[
            {
              key: 'name',
              header: 'Name',
              cell: (row) => (
                <div className="flex flex-col">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-caption text-text-muted">{row.email}</span>
                </div>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              cell: (row) => <Badge>{row.role.toLowerCase()}</Badge>,
            },
            {
              key: 'lastLogin',
              header: 'Last signed in',
              hideOnMobile: true,
              cell: (row) =>
                row.lastLoginAt === null ? (
                  <span className="text-text-muted">Never</span>
                ) : (
                  formatDate(row.lastLoginAt)
                ),
            },
            {
              key: 'status',
              header: '',
              align: 'right',
              cell: (row) =>
                row.isActive ? null : <Badge tone="neutral">Deactivated</Badge>,
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              cell: (row) =>
                // Deactivating your own account signs you out and, if you are the only
                // OWNER, locks everyone out of staff management permanently.
                row.id === session?.id || !row.isActive ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeactivating(row)}
                    className="text-danger"
                  >
                    Deactivate
                  </Button>
                ),
            },
          ]}
        />
      )}

      <StaffDialog staff={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        title={`Deactivate ${deactivating?.name ?? ''}?`}
        description="They will not be able to sign in. Their past actions stay in the audit log."
        confirmLabel="Deactivate"
        destructive
        loading={deactivate.isPending}
        onConfirm={() => deactivating !== null && deactivate.mutate(deactivating.id)}
      />
    </div>
  );
}

function StaffDialog({
  staff,
  onClose,
}: {
  staff: StaffSummary | 'new' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const isNew = staff === 'new';
  const existing = staff === 'new' || staff === null ? null : staff;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('STAFF');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(existing?.name ?? '');
    setEmail(existing?.email ?? '');
    setRole(existing?.role ?? 'STAFF');
    setPassword('');
    setError(null);
  }, [existing, isNew]);

  const save = useMutation({
    mutationFn: async () => {
      const client = adminClient();
      if (isNew) {
        return client.staff.create({ name, email, role, password, isActive: true });
      }
      const updated = await client.staff.update(existing!.id, {
        name,
        email,
        role,
        isActive: existing!.isActive,
      });
      // The password route is separate on purpose — an update that silently reset a
      // password every time it saved would be a very quiet way to lock someone out.
      if (password !== '') await client.staff.setPassword(existing!.id, password);
      return updated;
    },
    onSuccess: () => {
      toast.success(isNew ? 'Staff account created.' : 'Saved.');
      void queryClient.invalidateQueries({ queryKey: keys.staff });
      onClose();
    },
    onError: (caught) => setError(errorMessage(caught)),
  });

  if (staff === null) return null;

  const passwordTooShort = password !== '' && password.length < 10;
  const canSave =
    name.trim() !== '' &&
    email.trim() !== '' &&
    !passwordTooShort &&
    (!isNew || password.length >= 10);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      title={isNew ? 'Add staff' : existing!.name}
      description={ROLE_HELP[role]}
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
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label="Email"
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Select
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as AdminRole)}
        >
          <option value="STAFF">Staff</option>
          <option value="MANAGER">Manager</option>
          <option value="OWNER">Owner</option>
        </Select>
        <Input
          label={isNew ? 'Password' : 'New password'}
          type="password"
          autoComplete="new-password"
          required={isNew}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={
            error ??
            (passwordTooShort ? 'At least 10 characters.' : null)
          }
          hint={
            isNew
              ? 'At least 10 characters. Give it to them directly, not over WhatsApp.'
              : 'Leave blank to keep the current password.'
          }
        />
      </div>
    </Dialog>
  );
}
