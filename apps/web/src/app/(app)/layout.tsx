'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { AppShell } from '@/components/shell';
import { Loading } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !me)
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [loading, me, router]);
  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
