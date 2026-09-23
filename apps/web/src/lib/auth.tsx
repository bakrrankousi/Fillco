'use client';

import type { MeDto, Permission } from '@fillco/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from './api';

interface AuthState {
  me: MeDto | null;
  loading: boolean;
  can: (...permissions: Permission[]) => boolean;
  signIn: (email: string, password: string) => Promise<MeDto>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<MeDto>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const me = meQuery.data ?? null;

  useEffect(() => {
    setCsrfToken(me?.csrfToken ?? null);
  }, [me]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null);
      if (!window.location.pathname.startsWith('/login')) {
        router.replace(
          `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [qc, router]);

  const can = useCallback(
    (...permissions: Permission[]) => !!me && permissions.some((p) => me.permissions.includes(p)),
    [me],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api.post<MeDto>('/auth/login', { email, password });
      setCsrfToken(result.csrfToken);
      // Drop data cached for a previous user, but keep the observed "me" query alive.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], result);
      return result;
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setCsrfToken(null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], null);
      router.replace('/login');
    }
  }, [qc, router]);

  const value = useMemo<AuthState>(
    () => ({ me, loading: meQuery.isLoading, can, signIn, signOut }),
    [me, meQuery.isLoading, can, signIn, signOut],
  );

  // Force a password change before anything else.
  useEffect(() => {
    if (me?.mustChangePassword && pathname !== '/account' && !pathname.startsWith('/login'))
      router.replace('/account');
  }, [me, pathname, router]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
