'use client';
import { clearToken, clearUser, getToken, getUser } from '@/lib/api';
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Building04Icon,
  DashboardSquare01Icon,
  EyeIcon,
  Logout02Icon,
  ServerStack01Icon,
  Shield01Icon,
  Tag01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', Icon: DashboardSquare01Icon },
  { href: '/scans', label: 'Scans', Icon: Shield01Icon },
  { href: '/watchlist', label: 'Watchlist', Icon: EyeIcon },
  { href: '/registries', label: 'Registries', Icon: ServerStack01Icon },
  { href: '/tags', label: 'Tags', Icon: Tag01Icon },
  { href: '/orgs', label: 'Organizations', Icon: Building04Icon },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ username?: string; email?: string; role?: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setAuthReady(true);
    if (localStorage.getItem('sidebar_collapsed') === 'true') setCollapsed(true);
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
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  const initials = (user?.username ?? user?.email ?? 'U')[0].toUpperCase();

  return (
    <div className="flex h-screen bg-zinc-950 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`relative flex flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
        style={{
          background: 'linear-gradient(160deg, rgba(39,32,74,0.55) 0%, rgba(9,9,11,0.75) 50%, rgba(15,10,30,0.65) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          borderRight: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.4), inset -1px 0 0 rgba(124,58,237,0.06)',
        }}
      >
        {/* Ambient violet glow in top-left corner */}
        <div
          className="absolute -top-10 -left-10 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)' }}
        />
        {/* Top edge shimmer */}
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none bg-gradient-to-r from-transparent via-violet-400/25 to-transparent" />
        {/* Right edge inner highlight */}
        <div className="absolute inset-y-0 right-0 w-px pointer-events-none bg-gradient-to-b from-violet-500/10 via-transparent to-transparent" />

        {/* Brand */}
        <div
          className="flex items-center px-[18px] py-5 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
              boxShadow: '0 0 12px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
          >
            <Shield01Icon size={15} color="white" />
          </div>
          <span
            className="ml-3 font-semibold text-[15px] text-white tracking-tight whitespace-nowrap overflow-hidden transition-all duration-300"
            style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
          >
            JustScan
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5">
          {navItems.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-150 overflow-hidden whitespace-nowrap group
                  ${active ? 'text-violet-200' : 'text-zinc-400 hover:text-zinc-100'}`}
                style={active ? {
                  background: 'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(109,40,217,0.15) 100%)',
                  boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.2), 0 2px 8px rgba(124,58,237,0.15)',
                } : undefined}
              >
                {/* Hover background for inactive */}
                {!active && (
                  <span
                    className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                  />
                )}
                {/* Active left accent bar */}
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

        {/* Footer: user + collapse toggle */}
        <div
          className="shrink-0 p-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          {/* User row */}
          <div className="flex items-center gap-2 px-2 py-2 rounded-xl overflow-hidden">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(135deg, rgba(124,58,237,0.4), rgba(109,40,217,0.2))',
                boxShadow: '0 0 0 1px rgba(167,139,250,0.25)',
              }}
            >
              <span className="text-xs font-bold text-violet-300">{initials}</span>
            </div>
            <div
              className="flex-1 min-w-0 overflow-hidden transition-all duration-300"
              style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
            >
              <p className="text-xs font-medium text-zinc-200 truncate">{user?.username ?? user?.email ?? 'User'}</p>
              <p className="text-xs text-zinc-500 capitalize">{user?.role ?? 'user'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="shrink-0 text-zinc-500 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <Logout02Icon size={16} />
            </button>
          </div>

          {/* Collapse toggle */}
          <button
            onClick={toggleCollapsed}
            className="mt-1 w-full flex items-center justify-center py-2 rounded-xl text-zinc-600 hover:text-zinc-300 transition-all duration-150"
            style={{ background: 'transparent' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed
              ? <ArrowRight01Icon size={14} />
              : <ArrowLeft01Icon size={14} />
            }
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-zinc-950">{children}</main>
    </div>
  );
}
