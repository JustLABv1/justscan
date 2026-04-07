'use client';

import { clearToken, clearUser, getUser } from '@/lib/api';
import {
    AiContentGenerator01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Building04Icon,
    DashboardSquare01Icon,
    EyeIcon,
    FileExportIcon,
    GridTableIcon,
    Logout02Icon,
    Moon02Icon,
    PackageIcon,
    PlusSignIcon,
    Search01Icon,
    ServerStack01Icon,
    Settings01Icon,
    Shield01Icon,
    ShieldKeyIcon,
    Sun01Icon,
    Tag01Icon,
} from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Logo } from '@/components/logo';
import { SearchModal } from '@/components/search';
import { ToastProvider } from '@/components/toast';

const navGroups = [
  {
    label: 'Primary',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: DashboardSquare01Icon },
      { href: '/scans', label: 'Scans', Icon: Shield01Icon },
    ],
  },
  {
    label: 'Scanning',
    items: [
      { href: '/helm', label: 'Helm Scan', Icon: PackageIcon },
      { href: '/watchlist', label: 'Watchlist', Icon: AiContentGenerator01Icon },
    ],
  },
  {
    label: 'Security',
    items: [
      { href: '/vulnkb', label: 'Vuln KB', Icon: ShieldKeyIcon },
      { href: '/suppressions', label: 'Suppressions', Icon: GridTableIcon },
    ],
  },
  {
    label: 'Manage',
    items: [
      { href: '/status', label: 'Status Pages', Icon: EyeIcon },
      { href: '/registries', label: 'Registries', Icon: ServerStack01Icon },
      { href: '/tags', label: 'Tags', Icon: Tag01Icon },
      { href: '/orgs', label: 'Organizations', Icon: Building04Icon },
    ],
  },
];

interface AppShellProps {
  children: React.ReactNode;
  initialUser: { username?: string; email?: string; role?: string } | null;
}

export function AppShell({ children, initialUser }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [user, setUser] = useState(initialUser);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setUser(getUser() ?? initialUser);
  }, [initialUser, pathname]);

  useEffect(() => {
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  }

  function handleLogout() {
    clearToken();
    clearUser();
    router.replace('/login');
  }

  const initials = (user?.username ?? user?.email ?? 'U')[0]?.toUpperCase() ?? 'U';
  const isDark = resolvedTheme === 'dark';

  return (
    <ToastProvider>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      <div className="flex h-screen app-bg overflow-hidden">
        <aside
          className={`relative flex flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out sidebar-glass ${
            collapsed ? 'w-[68px]' : 'w-60'
          }`}
        >
          <div
            className="absolute -top-10 -left-10 w-40 h-40 rounded-full pointer-events-none"
            style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)' }}
          />
          <div className="absolute inset-x-0 top-0 h-px pointer-events-none bg-gradient-to-r from-transparent via-violet-400/20 to-transparent" />
          <div className="absolute inset-y-0 right-0 w-px pointer-events-none bg-gradient-to-b from-violet-500/10 via-transparent to-transparent" />

          <div
            className="flex items-center px-[18px] py-5 shrink-0"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                boxShadow: '0 0 12px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
            >
              <Logo size={16} className="text-white" />
            </div>
            <span
              className="ml-3 font-semibold text-[15px] tracking-tight whitespace-nowrap overflow-hidden transition-all duration-300"
              style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1, color: 'var(--text-primary)' }}
            >
              JustScan
            </span>
          </div>

          <div className="px-2 pb-2 space-y-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => setSearchOpen(true)}
              title="Search (⌘K)"
              aria-label="Open search"
              className={`w-full flex items-center rounded-xl px-3 py-2 text-sm transition-all duration-150 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 ${collapsed ? 'justify-center' : 'gap-2.5'}`}
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
              onMouseEnter={(event) => (event.currentTarget.style.borderColor = 'rgba(167,139,250,0.3)')}
              onMouseLeave={(event) => (event.currentTarget.style.borderColor = 'var(--glass-border)')}
            >
              <Search01Icon size={15} className="shrink-0" />
              <span
                className="flex-1 text-left overflow-hidden transition-all duration-300 text-xs"
                style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
              >
                Search…
              </span>
              {!collapsed && (
                <kbd className="text-[9px] font-mono px-1 py-0.5 rounded text-zinc-500"
                  style={{ background: 'var(--row-divider)', border: '1px solid var(--glass-border)' }}>
                  ⌘K
                </kbd>
              )}
            </button>

            <Link
              href="/scans?new=1"
              title={collapsed ? 'New Scan' : undefined}
              className={`w-full flex items-center rounded-xl transition-all duration-150 btn-primary-sm ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'}`}
            >
              <PlusSignIcon size={14} className="shrink-0" />
              <span
                className="overflow-hidden transition-all duration-300"
                style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
              >
                New Scan
              </span>
            </Link>
          </div>

          <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2">
            {[
              ...navGroups,
              ...(user?.role === 'admin'
                ? [{ label: 'System', items: [{ href: '/admin', label: 'Admin', Icon: Settings01Icon }] }]
                : []),
            ].map(({ label, items }) => (
              <div key={label} className="mb-1">
                <div
                  className="nav-section-label transition-all duration-300 overflow-hidden"
                  style={{ maxHeight: collapsed ? 0 : 28, opacity: collapsed ? 0 : 1, paddingTop: collapsed ? 0 : undefined, paddingBottom: collapsed ? 0 : undefined }}
                >
                  {label}
                </div>
                <div className="space-y-0.5">
                  {items.map(({ href, label: itemLabel, Icon }) => {
                    const active = pathname === href || pathname.startsWith(href + '/');
                    return (
                      <Link
                        key={href}
                        href={href}
                        title={collapsed ? itemLabel : undefined}
                        className={`relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 overflow-hidden whitespace-nowrap group ${active ? 'text-violet-600 dark:text-violet-200' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                        style={active ? {
                          background: 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
                          boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.2), 0 2px 8px rgba(124,58,237,0.08)',
                        } : undefined}
                      >
                        {!active && (
                          <span
                            className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                            style={{ background: 'var(--row-hover)' }}
                          />
                        )}
                        {active && (
                          <span
                            className="absolute left-0 inset-y-2 w-0.5 rounded-full"
                            style={{ background: 'linear-gradient(180deg, #a78bfa, #7c3aed)' }}
                          />
                        )}
                        <Icon size={18} className="shrink-0 relative z-10" />
                        <span
                          className="overflow-hidden transition-all duration-300 relative z-10"
                          style={{ maxWidth: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1 }}
                        >
                          {itemLabel}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="shrink-0 px-2 pb-3 pt-2 space-y-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className={`flex items-center ${collapsed ? 'flex-col gap-0.5' : 'gap-1'}`}>
              <button
                onClick={() => setTheme(isDark ? 'light' : 'dark')}
                className="flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-150 text-zinc-400 hover:text-violet-500 dark:text-zinc-500 dark:hover:text-violet-400 shrink-0"
                onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? <Sun01Icon size={15} /> : <Moon02Icon size={15} />}
              </button>

              <button
                onClick={toggleCollapsed}
                className={`flex items-center justify-center h-9 rounded-xl transition-all duration-150 text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300 shrink-0 ${collapsed ? 'w-9' : 'flex-1'}`}
                onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? <ArrowRight01Icon size={14} /> : <ArrowLeft01Icon size={14} />}
              </button>
            </div>

            <Link
              href="/swagger/index.html"
              target="_blank"
              rel="noreferrer"
              title="Open API docs"
              className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 rounded-xl px-2 py-2 text-xs font-medium transition-all duration-150 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100`}
              onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
            >
              <span className="flex items-center gap-2 overflow-hidden">
                <FileExportIcon size={14} className="shrink-0" />
                <span style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }} className="overflow-hidden transition-all duration-300 whitespace-nowrap">
                  API Docs
                </span>
              </span>
              {!collapsed && <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400">Swagger</span>}
            </Link>

            <Link
              href="/settings"
              title={collapsed ? `${user?.username ?? 'Settings'}` : undefined}
              className="flex items-center gap-2.5 px-2 py-2 rounded-xl transition-all duration-150 group overflow-hidden"
              onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
                style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.18)' }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0 overflow-hidden" style={{ maxWidth: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1 }}>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">{user?.username ?? user?.email ?? 'User'}</p>
                <p className="text-[11px] text-zinc-500 truncate">{user?.role ?? 'user'}</p>
              </div>
            </Link>

            <button
              onClick={handleLogout}
              className={`w-full flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 rounded-xl px-2 py-2 text-xs font-medium transition-all duration-150 text-zinc-500 hover:text-red-400`}
              onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
              title="Sign out"
            >
              <span className="flex items-center gap-2 overflow-hidden">
                <Logout02Icon size={14} className="shrink-0" />
                <span style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }} className="overflow-hidden transition-all duration-300 whitespace-nowrap">
                  Sign Out
                </span>
              </span>
            </button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </ToastProvider>
  );
}