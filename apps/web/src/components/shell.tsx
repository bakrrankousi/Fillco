'use client';

import type { Permission, SearchResultDto } from '@fillco/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  Banknote,
  BarChart3,
  Boxes,
  ClipboardList,
  Coins,
  Factory,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Package,
  ReceiptText,
  Search,
  Settings,
  Ship,
  ShoppingCart,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { humanize } from '@/lib/format';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  /** Modules scheduled for later phases are listed so the roadmap stays visible. */
  phase?: number;
}

const NAV: { section: string; items: NavItem[] }[] = [
  { section: '', items: [{ label: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  {
    section: 'Commercial',
    items: [
      { label: 'Customers', href: '/customers', icon: Users, permission: 'customer.view' },
      { label: 'Quotations', href: '/quotations', icon: FileText, permission: 'quotation.view' },
      { label: 'Sales Orders', href: '/sales-orders', icon: ShoppingCart, permission: 'sales_order.view' },
    ],
  },
  {
    section: 'Supply',
    items: [
      { label: 'Suppliers', href: '/suppliers', icon: Factory, permission: 'supplier.view' },
      { label: 'Purchases', href: '/purchases', icon: ClipboardList, permission: 'purchase_order.view' },
      { label: 'Products', href: '/products', icon: Package, permission: 'product.view' },
      { label: 'Shipments', href: '#', icon: Ship, phase: 2 },
      { label: 'Inventory', href: '#', icon: Boxes, phase: 2 },
      { label: 'Documents', href: '#', icon: FolderOpen, phase: 2 },
    ],
  },
  {
    section: 'Finance',
    items: [
      { label: 'Invoices', href: '#', icon: ReceiptText, phase: 2 },
      { label: 'Receivables', href: '#', icon: Wallet, phase: 3 },
      { label: 'Payables', href: '#', icon: Banknote, phase: 3 },
      { label: 'Cash Flow', href: '#', icon: Coins, phase: 3 },
      { label: 'Profitability', href: '#', icon: TrendingUp, phase: 3 },
    ],
  },
  {
    section: 'Work',
    items: [
      { label: 'Tasks', href: '#', icon: ListChecks, phase: 4 },
      { label: 'Reports', href: '#', icon: BarChart3, phase: 4 },
    ],
  },
  {
    section: 'Admin',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings },
      { label: 'Audit log', href: '/audit', icon: FileSpreadsheet, permission: 'audit.view' },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = useAuth();
  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-3 py-4" aria-label="Main">
      <Link href="/" className="flex items-center gap-2 px-2" onClick={onNavigate}>
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">
          F
        </span>
        <span className="font-semibold tracking-tight text-white">Fillco</span>
      </Link>
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || can(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.section || 'main'}>
            {group.section && (
              <p className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                {group.section}
              </p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active =
                  item.href === '/' ? pathname === '/' : item.href !== '#' && pathname.startsWith(item.href);
                const Icon = item.icon;
                if (item.phase) {
                  return (
                    <li key={item.label}>
                      <span
                        className="flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-500"
                        title={`Planned for Phase ${item.phase}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{item.label}</span>
                        <span className="rounded bg-slate-800 px-1.5 text-[10px] font-medium text-slate-400">
                          P{item.phase}
                        </span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

const TYPE_LABEL: Record<SearchResultDto['type'], string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  product: 'Product',
  quotation: 'Quotation',
  sales_order: 'Sales order',
  purchase_order: 'Purchase order',
  contact: 'Contact',
};

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResultDto[]>('/search', { q: debounced }),
    enabled: debounced.length >= 2,
  });
  const items = results.data ?? [];

  const go = (r: SearchResultDto) => {
    setOpen(false);
    setQ('');
    router.push(r.href);
  };

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, items.length - 1));
          if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
          if (e.key === 'Enter' && items[cursor]) go(items[cursor]!);
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Search orders, customers, suppliers, phones…"
        aria-label="Global search"
        className="h-9 w-full rounded-md border border-line bg-slate-50 pr-14 pl-8 text-sm focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100 focus:outline-none"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-line bg-white px-1.5 text-[10px] text-muted">
        Ctrl K
      </kbd>
      {open && debounced.length >= 2 && (
        <div className="absolute top-11 right-0 left-0 z-40 max-h-96 overflow-y-auto rounded-md border border-line bg-white py-1 shadow-lg">
          {results.isLoading && <p className="px-3 py-2 text-sm text-muted">Searching…</p>}
          {!results.isLoading && items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted">No results for “{debounced}”.</p>
          )}
          {items.map((r, i) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(r)}
              className={cn(
                'flex w-full items-start gap-3 px-3 py-2 text-left text-sm',
                i === cursor ? 'bg-brand-50' : 'hover:bg-slate-50',
              )}
            >
              <span className="mt-0.5 w-24 shrink-0 text-xs text-muted">{TYPE_LABEL[r.type]}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{r.title}</span>
                {r.subtitle && <span className="block truncate text-xs text-muted">{r.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 bg-slate-900 lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar />
        </div>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-slate-900">
            <button
              className="absolute top-3 right-3 text-slate-400"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3">
            <Link href="/account" className="hidden text-right sm:block">
              <span className="block text-sm leading-tight font-medium text-ink">{me?.fullName}</span>
              <span className="block text-xs leading-tight text-muted">
                {me?.roles.map(humanize).join(', ')}
              </span>
            </Link>
            <button
              onClick={() => void signOut()}
              className="rounded-md p-2 text-muted hover:bg-slate-100 hover:text-ink"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}

/** Wraps content that needs a permission; shows a friendly message otherwise. */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission | Permission[];
  children: ReactNode;
}) {
  const { can } = useAuth();
  const list = Array.isArray(permission) ? permission : [permission];
  if (!can(...list)) {
    return (
      <p className="rounded-md border border-line bg-white p-6 text-sm text-muted">
        You do not have access to this page.
      </p>
    );
  }
  return <>{children}</>;
}
