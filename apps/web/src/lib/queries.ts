'use client';

import type { LookupsDto, Page } from '@fillco/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { api } from './api';

/** Dropdown data (currencies, ports, terms, users …), cached for the session. */
export function useLookups() {
  return useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<LookupsDto>('/lookups'),
    staleTime: 10 * 60_000,
  });
}

/** List state kept in the URL so filters survive reloads and can be shared. */
export function useUrlState(defaults: Record<string, string> = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo(() => {
    const out: Record<string, string> = { ...defaults };
    params.forEach((v, k) => (out[k] = v));
    return out;
  }, [params]); // defaults are static per page
  const set = useCallback(
    (patch: Record<string, string | null | undefined>, resetPage = true) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      if (resetPage && !('page' in patch)) next.delete('page');
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return [state, set] as const;
}

export function usePagedList<T>(endpoint: string, query: Record<string, string | undefined>) {
  return useQuery({
    queryKey: [endpoint, query],
    queryFn: () => api.get<Page<T>>(endpoint, { pageSize: 50, ...query }),
    placeholderData: keepPreviousData,
  });
}

/** Mutation that refreshes the listed query keys afterwards. */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  invalidate: unknown[][] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key })));
    },
  });
}
