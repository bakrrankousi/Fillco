'use client';

import { createUserSchema, ROLE_CODES, type RoleDto, type UserDto } from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '@/components/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormGrid, Input } from '@/components/ui/form';
import { ErrorBox, Loading } from '@/components/ui/misc';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useForm, validate } from '@/lib/forms';
import { dateTime, humanize } from '@/lib/format';

function UserDialog({ user, open, onClose }: { user: UserDto | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const f = useForm({
    email: '',
    fullName: '',
    phone: '',
    password: '',
    roleCodes: [] as string[],
    isActive: true,
  });
  useEffect(() => {
    if (open)
      f.reset({
        email: user?.email ?? '',
        fullName: user?.fullName ?? '',
        phone: user?.phone ?? '',
        password: '',
        roleCodes: user?.roles ?? [],
        isActive: user?.isActive ?? true,
      });
  }, [open, user]);
  const v = f.values;
  const save = async () => {
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, {
          fullName: v.fullName,
          phone: v.phone || null,
          roleCodes: v.roleCodes,
          isActive: v.isActive,
          version: user.version,
        });
      } else {
        const body = { ...v, phone: v.phone || null };
        const check = validate(createUserSchema, body);
        if (!check.ok) return f.setErrors(check.errors);
        await api.post('/users', body);
      }
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User saved');
      onClose();
    } catch (err) {
      f.fail(err);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? `Edit ${user.fullName}` : 'Invite user'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <FormGrid columns={2}>
        <Field label="Full name" required error={f.errors.fullName}>
          <Input value={v.fullName} onChange={(e) => f.set('fullName', e.target.value)} autoFocus />
        </Field>
        <Field label="E-mail" required error={f.errors.email}>
          <Input
            type="email"
            value={v.email}
            disabled={!!user}
            onChange={(e) => f.set('email', e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <Input value={v.phone} onChange={(e) => f.set('phone', e.target.value)} />
        </Field>
        {!user && (
          <Field
            label="Initial password"
            required
            error={f.errors.password}
            hint="They must change it at first sign-in"
          >
            <Input
              type="password"
              value={v.password}
              onChange={(e) => f.set('password', e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        )}
      </FormGrid>
      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-medium text-slate-700">Roles</legend>
        <div className="grid grid-cols-2 gap-2">
          {ROLE_CODES.map((r) => (
            <Checkbox
              key={r}
              label={humanize(r)}
              checked={v.roleCodes.includes(r)}
              onChange={(e) =>
                f.set(
                  'roleCodes',
                  e.target.checked ? [...v.roleCodes, r] : v.roleCodes.filter((x) => x !== r),
                )
              }
            />
          ))}
        </div>
        {f.errors.roleCodes && <p className="mt-1 text-xs text-red-700">{f.errors.roleCodes[0]}</p>}
      </fieldset>
      {user && (
        <Checkbox
          className="mt-4"
          label="Active (can sign in)"
          checked={v.isActive}
          onChange={(e) => f.set('isActive', e.target.checked)}
        />
      )}
      <ErrorBox error={f.formError} className="mt-3" />
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setPw('');
    setError(null);
  }, [user]);
  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={`Reset password for ${user?.fullName}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api.post(`/users/${user!.id}/reset-password`, { newPassword: pw });
                toast.success('Password reset; the user must change it at next sign-in');
                onClose();
              } catch (err) {
                setError(err);
              }
            }}
          >
            Reset
          </Button>
        </>
      }
    >
      <Field
        label="Temporary password"
        hint="At least 10 characters with letters and numbers. All their sessions are signed out."
      >
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <ErrorBox error={error} className="mt-3" />
    </Dialog>
  );
}

export function UsersSettings() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserDto[]>('/users') });
  const [editing, setEditing] = useState<UserDto | null | 'new'>(null);
  const [reset, setReset] = useState<UserDto | null>(null);
  return (
    <Card>
      <CardHeader
        title="Users"
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Invite user
          </Button>
        }
      />
      {!users.data ? (
        users.error ? (
          <ErrorBox error={users.error} className="m-4" />
        ) : (
          <Loading />
        )
      ) : (
        <DataTable
          rows={users.data}
          rowKey={(u) => u.id}
          columns={[
            {
              key: 'n',
              header: 'Name',
              cell: (u) => (
                <button className="font-medium text-brand-700 hover:underline" onClick={() => setEditing(u)}>
                  {u.fullName}
                </button>
              ),
            },
            { key: 'e', header: 'E-mail', cell: (u) => u.email },
            { key: 'r', header: 'Roles', cell: (u) => u.roles.map(humanize).join(', ') },
            {
              key: 's',
              header: 'Status',
              cell: (u) =>
                u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="muted">Inactive</Badge>,
            },
            { key: 'l', header: 'Last sign-in', cell: (u) => dateTime(u.lastLoginAt) },
            {
              key: 'a',
              header: '',
              align: 'right',
              cell: (u) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReset(u)}
                  aria-label={`Reset password for ${u.fullName}`}
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
              ),
            },
          ]}
        />
      )}
      <UserDialog
        user={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <ResetDialog user={reset} onClose={() => setReset(null)} />
    </Card>
  );
}

export function RolesSettings() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleDto[]>('/roles') });
  if (!roles.data) return roles.error ? <ErrorBox error={roles.error} /> : <Loading />;
  const all = [...new Set(roles.data.flatMap((r) => r.permissions))].sort();
  const order = ['ADMIN', 'MANAGEMENT', 'SALES', 'PURCHASING', 'LOGISTICS', 'FINANCE', 'VIEWER'];
  const sorted = [...roles.data].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  return (
    <Card>
      <CardHeader
        title="Roles & permissions"
        subtitle="Default system roles. Assign one or more roles to each user."
      />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-slate-50 text-left">
              <th className="px-3 py-2 font-medium text-muted">Permission</th>
              {sorted.map((r) => (
                <th key={r.id} className="px-2 py-2 text-center font-medium" title={r.description ?? ''}>
                  {r.name}
                  <span className="block font-normal text-muted">{r.userCount} users</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((p) => (
              <tr key={p} className="border-b border-line">
                <td className="px-3 py-1.5 font-mono">{p}</td>
                {sorted.map((r) => (
                  <td key={r.id} className="px-2 py-1.5 text-center">
                    {r.permissions.includes(p as never) ? (
                      <span className="text-emerald-600">●</span>
                    ) : (
                      <span className="text-slate-300">·</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
