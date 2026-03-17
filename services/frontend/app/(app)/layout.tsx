'use client';
import { clearToken, clearUser, getToken, getUser } from '@/lib/api';
import {
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

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    setUser(getUser());
    setAuthReady(true);
  }, [router]);

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
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col bg-zinc-900 border-r border-zinc-800 shrink-0">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
              <Shield01Icon size={16} color="white" />
            </div>
            <span className="font-semibold text-base text-white tracking-tight">JustScan</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {navItems.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-violet-600/20 text-violet-300'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                }`}
              >
                <Icon size={18} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-zinc-800">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
            <div className="w-7 h-7 rounded-full bg-violet-600/30 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-violet-400">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">{user?.username ?? user?.email ?? 'User'}</p>
              <p className="text-xs text-zinc-500 capitalize">{user?.role ?? 'user'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-zinc-500 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <Logout02Icon size={17} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-zinc-950">{children}</main>
    </div>
  );
}
