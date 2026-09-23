'use client';

import { changePasswordSchema } from '@fillco/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { ErrorBox, KeyValues, Notice, PageHeader } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { humanize } from '@/lib/format';
import { useForm, validate } from '@/lib/forms';

export default function AccountPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const f = useForm({ currentPassword: '', newPassword: '', confirm: '' });
  const v = f.values;
  const save = async () => {
    if (v.newPassword !== v.confirm) return f.setErrors({ confirm: ['Passwords do not match'] });
    const check = validate(changePasswordSchema, {
      currentPassword: v.currentPassword,
      newPassword: v.newPassword,
    });
    if (!check.ok) return f.setErrors(check.errors);
    try {
      await api.post('/auth/change-password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      f.reset({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed. Other sessions were signed out.');
      if (me?.mustChangePassword) router.replace('/');
    } catch (err) {
      f.fail(err);
    }
  };
  return (
    <>
      <PageHeader title="My account" />
      {me?.mustChangePassword && (
        <Notice tone="warning" className="mb-4">
          Please choose a new password before continuing.
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <KeyValues
              columns={2}
              items={[
                ['Name', me?.fullName],
                ['E-mail', me?.email],
                ['Roles', me?.roles.map(humanize).join(', ')],
                ['Company', me?.company.name],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <CardBody className="space-y-3">
            <Field label="Current password" error={f.errors.currentPassword}>
              <Input
                type="password"
                autoComplete="current-password"
                value={v.currentPassword}
                onChange={(e) => f.set('currentPassword', e.target.value)}
              />
            </Field>
            <Field
              label="New password"
              error={f.errors.newPassword}
              hint="At least 10 characters with letters and numbers"
            >
              <Input
                type="password"
                autoComplete="new-password"
                value={v.newPassword}
                onChange={(e) => f.set('newPassword', e.target.value)}
              />
            </Field>
            <Field label="Repeat new password" error={f.errors.confirm}>
              <Input
                type="password"
                autoComplete="new-password"
                value={v.confirm}
                onChange={(e) => f.set('confirm', e.target.value)}
              />
            </Field>
            <ErrorBox error={f.formError} />
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => void save()}>
                Change password
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
