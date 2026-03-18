'use client';
import { clearToken, clearUser, getToken, getUser, listScans, Scan } from '@/lib/api';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Building04Icon,
  DashboardSquare01Icon,
  EyeIcon,
  GridTableIcon,
  Logout02Icon,
  Moon02Icon,
  Notification02Icon,
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

const navItems = [
  { href: '/dashboard', label: 'Dashboard', Icon: DashboardSquare01Icon },
  { href: '/scans', label: 'Scans', Icon: Shield01Icon },
  { href: '/watchlist', label: 'Watchlist', Icon: EyeIcon },
  { href: '/registries', label: 'Registries', Icon: ServerStack01Icon },
  { href: '/tags', label: 'Tags', Icon: Tag01Icon },
  { href: '/orgs', label: 'Organizations', Icon: Building04Icon },
  { href: '/vulnkb', label: 'Vuln KB', Icon: ShieldKeyIcon },
  { href: '/suppressions', label: 'Suppressions', Icon: GridTableIcon },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [user, setUser] = useState<{ username?: string; email?: string; role?: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [recentScans, setRecentScans] = useState<Scan[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLastSeen, setNotifLastSeen] = useState('');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(getUser());
    setAuthReady(true);
    if (localStorage.getItem('sidebar_collapsed') === 'true') setCollapsed(true);
    const seen = localStorage.getItem('notif_last_seen') ?? '';
    setNotifLastSeen(seen);
    const fetchScans = () => {
      listScans(1, 10).then(res => setRecentScans(res.data ?? [])).catch(() => {});
    };
    fetchScans();
    const iv = setInterval(fetchScans, 60_000);
    return () => clearInterval(iv);
  }, [router]);

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  }

  function handleLogout() {
    clearToken();
    clearUser();
    router.replace('/login');
  }

  if (!authReady) {
    return (
      <div className="flex h-screen items-center justify-center app-bg">
        <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  const initials = (user?.username ?? user?.email ?? 'U')[0].toUpperCase();
  const isDark = resolvedTheme === 'dark';

  const finishedScans = recentScans.filter(s => s.status === 'completed' || s.status === 'failed');
  const unreadCount = notifLastSeen
    ? finishedScans.filter(s => new Date(s.created_at) > new Date(notifLastSeen)).length
    : 0;

  function openNotifications() {
    setNotifOpen(o => !o);
    const now = new Date().toISOString();
    setNotifLastSeen(now);
    localStorage.setItem('notif_last_seen', now);
  }

  return (
    <div className="flex h-screen app-bg overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`relative flex flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out sidebar-glass ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
      >
        {/* Ambient violet glow */}
        <div
          className="absolute -top-10 -left-10 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)' }}
        />
        {/* Top edge shimmer */}
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none bg-gradient-to-r from-transparent via-violet-400/20 to-transparent" />
        {/* Right edge inner highlight */}
        <div className="absolute inset-y-0 right-0 w-px pointer-events-none bg-gradient-to-b from-violet-500/10 via-transparent to-transparent" />

        {/* Brand */}
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

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5">
          {[...navItems, ...(user?.role === 'admin' ? [{ href: '/admin', label: 'Admin', Icon: Settings01Icon }] : [])].map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-150 overflow-hidden whitespace-nowrap group
                  ${active ? 'text-violet-600 dark:text-violet-200' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
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
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="shrink-0 px-2 pb-3 pt-2 space-y-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>

          {/* Notification panel — renders inside sidebar flow so it can't be clipped */}
          {notifOpen && (
            <div
              className="rounded-xl overflow-hidden mb-1"
              style={{
                background: 'var(--modal-bg)',
                border: '1px solid var(--glass-border)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
              }}
            >
              <div className="px-3 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider"
                style={{ borderBottom: '1px solid var(--row-divider)' }}>
                Recent Activity
              </div>
              {finishedScans.length === 0 ? (
                <div className="px-3 py-4 text-xs text-zinc-500 text-center flex flex-col items-center gap-1.5">
                  <AlertCircleIcon size={16} className="text-zinc-400" />
                  No recent activity
                </div>
              ) : finishedScans.slice(0, 5).map((s, i) => {
                const isNew = notifLastSeen ? new Date(s.created_at) > new Date(notifLastSeen) : false;
                return (
                  <Link
                    key={s.id}
                    href={`/scans/${s.id}`}
                    onClick={() => setNotifOpen(false)}
                    className="flex items-start gap-2.5 px-3 py-2 text-xs transition-colors"
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span
                      className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: s.status === 'completed' ? '#34d399' : '#f87171', marginTop: 4 }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono truncate text-zinc-700 dark:text-zinc-300">
                        {s.image_name}:{s.image_tag}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span style={{ color: s.status === 'completed' ? '#34d399' : '#f87171' }}>{s.status}</span>
                        {isNew && <span className="px-1 py-px rounded text-[9px] font-bold bg-violet-500/20 text-violet-400">NEW</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Settings + bell row (collapsed: just icons stacked) */}
          <div className={`flex items-center ${collapsed ? 'flex-col gap-0.5' : 'gap-1'}`}>
            {/* Theme toggle */}
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-150 text-zinc-400 hover:text-violet-500 dark:text-zinc-500 dark:hover:text-violet-400 shrink-0"
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun01Icon size={15} /> : <Moon02Icon size={15} />}
            </button>

            {/* Notification bell */}
            <button
              onClick={openNotifications}
              className="relative flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-150 text-zinc-400 hover:text-violet-500 dark:text-zinc-500 dark:hover:text-violet-400 shrink-0"
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              title="Recent activity"
            >
              <Notification02Icon size={15} />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full text-[8px] font-bold flex items-center justify-center text-white"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Collapse toggle — grows to fill remaining space when expanded */}
            <button
              onClick={toggleCollapsed}
              className={`flex items-center justify-center h-9 rounded-xl transition-all duration-150 text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300 shrink-0 ${collapsed ? 'w-9' : 'flex-1'}`}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ArrowRight01Icon size={14} /> : <ArrowLeft01Icon size={14} />}
            </button>
          </div>

          {/* User row */}
          <Link
            href="/settings"
            title={collapsed ? `${user?.username ?? 'Settings'}` : undefined}
            className="flex items-center gap-2.5 px-2 py-2 rounded-xl transition-all duration-150 group overflow-hidden"
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {/* Avatar */}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all group-hover:ring-2 group-hover:ring-violet-500/30"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.5), rgba(109,40,217,0.3))',
                boxShadow: '0 0 0 1px rgba(167,139,250,0.2)',
              }}
            >
              <span className="text-[11px] font-bold text-violet-200">{initials}</span>
            </div>
            {/* Name + role */}
            <div
              className="flex-1 min-w-0 overflow-hidden transition-all duration-300"
              style={{ maxWidth: collapsed ? 0 : 140, opacity: collapsed ? 0 : 1 }}
            >
              <p className="text-xs font-medium truncate leading-tight" style={{ color: 'var(--text-secondary)' }}>
                {user?.username ?? user?.email ?? 'User'}
              </p>
              <p className="text-[10px] capitalize leading-tight mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {user?.role ?? 'user'}
              </p>
            </div>
            {/* Logout */}
            <button
              onClick={e => { e.preventDefault(); handleLogout(); }}
              className="shrink-0 text-zinc-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
              title="Sign out"
              style={{ maxWidth: collapsed ? 0 : undefined, overflow: 'hidden' }}
            >
              <Logout02Icon size={14} />
            </button>
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto app-bg">{children}</main>
    </div>
  );
}
