'use client';

import { Suspense } from 'react';
import { CompanySettings } from '@/components/settings/company';
import {
  CatalogSettings,
  ExchangeRatesSettings,
  PaymentTermsSettings,
  PortsSettings,
} from '@/components/settings/master-data';
import { RolesSettings, UsersSettings } from '@/components/settings/users';
import { Loading, PageHeader } from '@/components/ui/misc';
import { Tabs } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { useUrlState } from '@/lib/queries';

type Tab = 'company' | 'users' | 'roles' | 'rates' | 'terms' | 'ports' | 'catalog';

function SettingsInner() {
  const { can } = useAuth();
  const [state, set] = useUrlState({ tab: 'company' });
  const tab = state.tab as Tab;
  return (
    <>
      <PageHeader title="Settings" subtitle="Company, users and the master data every document relies on" />
      <Tabs<Tab>
        active={tab}
        onChange={(t) => set({ tab: t })}
        tabs={[
          { key: 'company', label: 'Company' },
          { key: 'users', label: 'Users', hidden: !can('users.manage') },
          { key: 'roles', label: 'Roles & permissions', hidden: !can('roles.view', 'users.manage') },
          { key: 'rates', label: 'Exchange rates' },
          { key: 'terms', label: 'Payment terms' },
          { key: 'ports', label: 'Ports' },
          { key: 'catalog', label: 'Product specifications', hidden: !can('product.view') },
        ]}
      />
      {tab === 'company' && <CompanySettings />}
      {tab === 'users' && <UsersSettings />}
      {tab === 'roles' && <RolesSettings />}
      {tab === 'rates' && <ExchangeRatesSettings />}
      {tab === 'terms' && <PaymentTermsSettings />}
      {tab === 'ports' && <PortsSettings />}
      {tab === 'catalog' && <CatalogSettings />}
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsInner />
    </Suspense>
  );
}
