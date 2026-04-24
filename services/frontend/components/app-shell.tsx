'use client';

import { clearToken, clearUser, getUser, getWorkScope, listMyOrgInvites, listOrgs, Org, setWorkScope, WorkScope } from '@/lib/api';
import { WorkspaceOnboarding } from '@/components/workspace-onboarding';
import { Button, Drawer, Dropdown, Header, Label, Separator, useOverlayState } from '@heroui/react';
import {
    AiContentGenerator01Icon,
    ArrowDown01Icon,
    ArrowLeft01Icon,
    ArrowRight01Icon,
    Building04Icon,
    DashboardSquare01Icon,
    EyeIcon,
    FileExportIcon,
    GridTableIcon,
    Logout02Icon,
    Menu01Icon,
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
import { hasSeenWorkspaceOnboarding, markWorkspaceOnboardingSeen } from '@/lib/workspace-onboarding';

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
  initialUser: { id?: string; username?: string; email?: string; role?: string } | null;
}

function WorkspaceScopeHelp({
  open,
  currentScopeLabel,
  onDismiss,
  onToggle,
}: {
  open: boolean;
  currentScopeLabel: string;
  onDismiss: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
        style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
        onClick={onToggle}
      >
        What changes with workspace?
      </button>
      {open && (
        <div className="rounded-xl px-3 py-3 text-xs leading-5 text-zinc-600 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          <p className="font-medium text-zinc-800 dark:text-zinc-100">Current view: {currentScopeLabel}</p>
          <p className="mt-2">Switch workspace to change the dashboard and lists you are viewing.</p>
          <p className="mt-1">Scans, registries, tags, suppressions, and watchlist items belong to a workspace. Shared items can appear here without changing their original owner.</p>
          <button type="button" className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 transition-colors hover:text-zinc-800 dark:hover:text-zinc-100" onClick={onDismiss}>
            Hide
          </button>
        </div>
      )}
    </div>
  );
}

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppShell({ children, initialUser }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [user, setUser] = useState(initialUser);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgsReady, setOrgsReady] = useState(false);
  const [pendingInviteCount, setPendingInviteCount] = useState(0);
  const [workScope, setWorkScopeState] = useState<WorkScope>(() => getWorkScope());
  const [workspaceHelpOpen, setWorkspaceHelpOpen] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState<'checking' | 'show' | 'done'>('checking');
  const mobileNav = useOverlayState();
  const [orgRefreshVersion, setOrgRefreshVersion] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(getUser() ?? initialUser);
  }, [initialUser, pathname]);

  useEffect(() => {
    mobileNav.close();
  }, [mobileNav, pathname]);

  useEffect(() => {
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const currentUser = (getUser() ?? user ?? initialUser) as { id?: string; email?: string; username?: string } | null;
    setOnboardingStatus(hasSeenWorkspaceOnboarding(currentUser) ? 'done' : 'show');
  }, [initialUser, mounted, user]);

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

  useEffect(() => {
    function handleScopeChanged(event: Event) {
      const detail = (event as CustomEvent<WorkScope>).detail;
      setWorkScopeState(detail ?? getWorkScope());
    }

    window.addEventListener('justscan-work-scope-changed', handleScopeChanged as EventListener);
    return () => window.removeEventListener('justscan-work-scope-changed', handleScopeChanged as EventListener);
  }, []);

  useEffect(() => {
    function handleOrgMembershipChanged() {
      setOrgRefreshVersion((current) => current + 1);
    }

    window.addEventListener('justscan-org-membership-changed', handleOrgMembershipChanged);
    return () => window.removeEventListener('justscan-org-membership-changed', handleOrgMembershipChanged);
  }, []);

  useEffect(() => {
    setOrgsReady(false);
    Promise.allSettled([listOrgs(), listMyOrgInvites()])
      .then(([orgsResult, invitesResult]) => {
        const nextOrgs = orgsResult.status === 'fulfilled' ? orgsResult.value : [];
        setOrgs(nextOrgs);
        setPendingInviteCount(invitesResult.status === 'fulfilled' ? invitesResult.value.length : 0);
        const current = getWorkScope();
        if (current.kind !== 'org') {
          return;
        }
        const match = nextOrgs.find((org) => org.id === current.orgId);
        if (!match) {
          setWorkScope({ kind: 'personal' });
          return;
        }
        if (current.orgName !== match.name) {
          setWorkScope({ kind: 'org', orgId: match.id, orgName: match.name });
        }
      })
      .catch(() => {
        setOrgs([]);
        setPendingInviteCount(0);
      })
      .finally(() => {
        setOrgsReady(true);
      });
  }, [orgRefreshVersion, pathname]);

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

  function handleScopeChange(value: string) {
    if (value === 'personal') {
      const nextScope: WorkScope = { kind: 'personal' };
      setWorkScopeState(nextScope);
      setWorkScope(nextScope);
      return;
    }

    const matchedOrg = orgs.find((org) => org.id === value);
    if (!matchedOrg) return;

    const nextScope: WorkScope = { kind: 'org', orgId: matchedOrg.id, orgName: matchedOrg.name };
    setWorkScopeState(nextScope);
    setWorkScope(nextScope);
  }

  function resolveFallbackScope(): WorkScope {
    const current = getWorkScope();
    if (current.kind !== 'org') return current;

    const matchedOrg = orgs.find((org) => org.id === current.orgId);
    if (!matchedOrg && orgsReady) return { kind: 'personal' };
    if (!matchedOrg) return current;
    return { kind: 'org', orgId: matchedOrg.id, orgName: matchedOrg.name };
  }

  function finishOnboarding(nextScope: WorkScope) {
    const currentUser = (getUser() ?? user ?? initialUser) as { id?: string; email?: string; username?: string } | null;
    markWorkspaceOnboardingSeen(currentUser);
    setWorkScopeState(nextScope);
    setWorkScope(nextScope);
    setWorkspaceHelpOpen(true);
    setOnboardingStatus('done');
    router.replace('/dashboard');
  }

  function skipOnboarding() {
    const currentUser = (getUser() ?? user ?? initialUser) as { id?: string; email?: string; username?: string } | null;
    markWorkspaceOnboardingSeen(currentUser);
    const nextScope = resolveFallbackScope();
    setWorkScopeState(nextScope);
    setWorkScope(nextScope);
    setOnboardingStatus('done');
    router.replace('/dashboard');
  }

  const initials = (user?.username ?? user?.email ?? 'U')[0]?.toUpperCase() ?? 'U';
  const isDark = resolvedTheme === 'dark';
  const themeToggleTitle = !mounted ? 'Toggle theme' : isDark ? 'Switch to light mode' : 'Switch to dark mode';
  const scopeLabel = workScope.kind === 'org' ? workScope.orgName ?? 'Organization' : 'Personal workspace';
  const navigationGroups = [
    ...navGroups,
    ...(user?.role === 'admin'
      ? [{ label: 'System', items: [{ href: '/admin', label: 'Admin', Icon: Settings01Icon }] }]
      : []),
  ];

  if (onboardingStatus === 'checking') {
    return (
      <ToastProvider>
        <div className="app-bg flex min-h-dvh items-center justify-center px-6 py-10">
          <div className="glass-panel flex w-full max-w-md flex-col items-center rounded-[28px] px-8 py-10 text-center">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                boxShadow: '0 0 20px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.18)',
              }}
            >
              <Logo size={20} className="text-white" />
            </div>
            <p className="mt-5 text-base font-semibold text-zinc-900 dark:text-white">Preparing your workspace view</p>
            <p className="mt-2 text-sm text-zinc-500">Checking your workspace setup before entering JustScan.</p>
          </div>
        </div>
      </ToastProvider>
    );
  }

  if (onboardingStatus === 'show') {
    return (
      <ToastProvider>
        <WorkspaceOnboarding
          user={user}
          orgs={orgs}
          orgsReady={orgsReady}
          initialScope={resolveFallbackScope()}
          onComplete={finishOnboarding}
          onSkip={skipOnboarding}
        />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      <div className="flex h-dvh app-bg overflow-hidden">
        <aside
          className={`relative hidden md:flex flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out sidebar-glass ${
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

          <div className="px-2 pt-3 pb-2 space-y-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            {!collapsed && (
              <>
                <Dropdown>
                  <Dropdown.Trigger className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all duration-150 outline-none text-left"
                    style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                    onMouseEnter={(event: any) => (event.currentTarget.style.borderColor = 'rgba(167,139,250,0.3)')}
                    onMouseLeave={(event: any) => (event.currentTarget.style.borderColor = 'var(--glass-border)')}
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Workspace</p>
                      <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200 truncate mt-0.5">{scopeLabel}</span>
                    </div>
                    <ArrowDown01Icon size={14} className="text-zinc-500 shrink-0 ml-2" />
                  </Dropdown.Trigger>
                  <Dropdown.Popover className="min-w-[200px]" placement="bottom start">
                    <Dropdown.Menu
                      onAction={(key) => handleScopeChange(key as string)}
                      selectionMode="single"
                      selectedKeys={new Set([workScope.kind === 'org' ? workScope.orgId : 'personal'])}
                    >
                      <Dropdown.Item id="personal" textValue="Personal workspace">
                        <Label>Personal workspace</Label>
                      </Dropdown.Item>
                      {orgs.length > 0 && (
                        <Dropdown.Section>
                          <Header>Organizations</Header>
                          {orgs.map((org) => (
                            <Dropdown.Item key={org.id} id={org.id} textValue={org.name}>
                              <Label>{org.name}</Label>
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Section>
                      )}
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
                <WorkspaceScopeHelp
                  open={workspaceHelpOpen}
                  currentScopeLabel={scopeLabel}
                  onDismiss={() => setWorkspaceHelpOpen(false)}
                  onToggle={() => setWorkspaceHelpOpen((current) => !current)}
                />
              </>
            )}

            <button
              onClick={() => setSearchOpen(true)}
              title="Search (⌘K)"
              aria-label="Open search"
              className={`w-full flex items-center rounded-xl px-3 py-2.5 text-sm transition-all duration-150 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 ${collapsed ? 'justify-center' : 'gap-2.5'}`}
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
              className={`w-full flex items-center rounded-xl transition-all duration-150 btn-primary-sm py-2.5 ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'}`}
            >
              <PlusSignIcon size={14} className="shrink-0" />
              <span
                className="overflow-hidden transition-all duration-300"
                style={{ maxWidth: collapsed ? 0 : 120, opacity: collapsed ? 0 : 1 }}
              >
                New Scan
              </span>
            </Link>

            {!collapsed && pendingInviteCount > 0 && (
              <Link
                href="/orgs"
                className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-all duration-150 text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.18)' }}
              >
                <div>
                  <p className="font-medium text-amber-600 dark:text-amber-400">Pending invites</p>
                  <p className="text-xs text-zinc-500">Review organization access requests</p>
                </div>
                <span className="inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-300"
                  style={{ background: 'rgba(245, 158, 11, 0.16)' }}>
                  {pendingInviteCount}
                </span>
              </Link>
            )}
          </div>

          <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2">
            {navigationGroups.map(({ label, items }) => (
              <div key={label} className="mb-1">
                <div
                  className="nav-section-label transition-all duration-300 overflow-hidden"
                  style={{ maxHeight: collapsed ? 0 : 28, opacity: collapsed ? 0 : 1, paddingTop: collapsed ? 0 : undefined, paddingBottom: collapsed ? 0 : undefined }}
                >
                  {label}
                </div>
                <div className="space-y-0.5">
                  {items.map(({ href, label: itemLabel, Icon }) => {
                    const active = isActiveRoute(pathname, href);
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
                        {href === '/orgs' && pendingInviteCount > 0 && !collapsed && (
                          <span className="relative z-10 ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200"
                            style={{ background: 'rgba(245, 158, 11, 0.16)' }}>
                            {pendingInviteCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="shrink-0 px-2 pb-3 pt-2 space-y-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button
              onClick={toggleCollapsed}
              className={`w-full flex items-center justify-center h-9 rounded-xl transition-all duration-150 text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300`}
              onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ArrowRight01Icon size={14} /> : <ArrowLeft01Icon size={14} />}
            </button>

            <Dropdown>
              <Dropdown.Trigger className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2.5 px-2'} py-2 rounded-xl transition-all duration-150 outline-none`}
                style={{ background: 'transparent' }}
                onMouseEnter={(event: any) => (event.currentTarget.style.background = 'var(--row-hover)')}
                onMouseLeave={(event: any) => (event.currentTarget.style.background = 'transparent')}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
                  style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.18)' }}
                >
                  {initials}
                </div>
                {!collapsed && (
                   <div className="flex-1 flex flex-col justify-center min-w-0 pl-1.5 pr-1">
                     <div className="flex items-center justify-between w-full">
                       <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate">{user?.username ?? user?.email ?? 'User'}</p>
                     </div>
                     <p className="text-[11px] text-zinc-500 truncate text-left">{user?.role ?? 'user'}</p>
                   </div>
                )}
              </Dropdown.Trigger>

              <Dropdown.Popover className="min-w-[200px]" placement="right bottom">
                <Dropdown.Menu onAction={(key) => {
                   if (key === 'settings') router.push('/settings');
                   if (key === 'api-docs') window.open('/swagger/index.html', '_blank');
                   if (key === 'theme') setTheme(isDark ? 'light' : 'dark');
                   if (key === 'signout') handleLogout();
                }}>
                  <Dropdown.Item id="settings" textValue="Settings">
                    <div className="flex items-center gap-2">
                       <Settings01Icon size={14} className="text-zinc-500" />
                       <Label>Settings</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="theme" textValue="Theme">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        {mounted ? (isDark ? <Sun01Icon size={14} className="text-zinc-500" /> : <Moon02Icon size={14} className="text-zinc-500" />) : <span aria-hidden className="block h-[14px] w-[14px]" />}
                        <Label>Theme</Label>
                      </div>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="api-docs" textValue="API Docs">
                    <div className="flex items-center gap-2">
                      <FileExportIcon size={14} className="text-zinc-500" />
                      <Label>API Docs</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="signout" textValue="Sign Out" className="text-danger flex items-center gap-2 mt-1 border-t border-zinc-200 dark:border-zinc-800 pt-1">
                    <div className="flex items-center gap-2">
                      <Logout02Icon size={14} />
                      <Label className="text-danger">Sign Out</Label>
                    </div>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className="sticky top-0 z-20 flex items-center gap-2 px-4 py-3 md:hidden"
            style={{
              background: isDark ? 'rgba(9,9,11,0.82)' : 'rgba(244,244,245,0.88)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <Drawer state={mobileNav}>
              <Button aria-label="Open navigation menu" className="rounded-xl" isIconOnly variant="secondary">
                <Menu01Icon size={18} />
              </Button>
              <Drawer.Backdrop className="md:hidden" variant="blur">
                <Drawer.Content className="md:hidden" placement="left">
                  <Drawer.Dialog className="flex h-full w-[min(88vw,320px)] flex-col sidebar-glass">
                    <Drawer.Header
                      className="flex items-center justify-between px-4 py-4"
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{
                            background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                            boxShadow: '0 0 12px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                          }}
                        >
                          <Logo size={18} className="text-white" />
                        </div>
                        <div>
                          <Drawer.Heading className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            JustScan
                          </Drawer.Heading>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Scan, watch, and manage
                          </p>
                        </div>
                      </div>
                      <Drawer.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Drawer.Header>
                    <Drawer.Body className="flex-1 overflow-y-auto px-2 py-3">
                      <div className="space-y-4">
                        <Dropdown>
                          <Dropdown.Trigger className="w-full flex items-center justify-between rounded-xl px-3 py-3 text-sm transition-all duration-150 outline-none text-left"
                            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                          >
                            <div className="flex flex-col min-w-0 flex-1">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Workspace</p>
                              <span className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200 mt-0.5 truncate">{scopeLabel}</span>
                            </div>
                            <ArrowDown01Icon size={16} className="text-zinc-500 shrink-0 ml-2" />
                          </Dropdown.Trigger>
                          <Dropdown.Popover className="w-[min(80vw,300px)]">
                            <Dropdown.Menu
                              onAction={(key) => handleScopeChange(key as string)}
                              selectionMode="single"
                              selectedKeys={new Set([workScope.kind === 'org' ? workScope.orgId : 'personal'])}
                            >
                              <Dropdown.Item id="personal" textValue="Personal workspace">
                                <Label>Personal workspace</Label>
                              </Dropdown.Item>
                              {orgs.length > 0 && (
                                <Dropdown.Section>
                                  <Header>Organizations</Header>
                                  {orgs.map((org) => (
                                    <Dropdown.Item key={org.id} id={org.id} textValue={org.name}>
                                      <Label>{org.name}</Label>
                                    </Dropdown.Item>
                                  ))}
                                </Dropdown.Section>
                              )}
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                        <WorkspaceScopeHelp
                          open={workspaceHelpOpen}
                          currentScopeLabel={scopeLabel}
                          onDismiss={() => setWorkspaceHelpOpen(false)}
                          onToggle={() => setWorkspaceHelpOpen((current) => !current)}
                        />

                        {pendingInviteCount > 0 && (
                          <Link
                            href="/orgs"
                            className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200"
                            onClick={() => mobileNav.close()}
                            style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.18)' }}
                          >
                            <div>
                              <p>Pending invites</p>
                              <p className="text-xs font-normal text-zinc-500">Review organization access requests</p>
                            </div>
                            <span className="inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200"
                              style={{ background: 'rgba(245, 158, 11, 0.16)' }}>
                              {pendingInviteCount}
                            </span>
                          </Link>
                        )}

                        {navigationGroups.map(({ label, items }) => (
                          <div key={label} className="space-y-1.5">
                            <p className="px-2 text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>
                              {label}
                            </p>
                            <div className="space-y-1">
                              {items.map(({ href, label: itemLabel, Icon }) => {
                                const active = isActiveRoute(pathname, href);
                                return (
                                  <Link
                                    key={href}
                                    href={href}
                                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all ${
                                      active ? 'text-violet-600 dark:text-violet-200' : 'text-zinc-700 dark:text-zinc-300'
                                    }`}
                                    onClick={() => mobileNav.close()}
                                    style={active
                                      ? {
                                          background: 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
                                          boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.2), 0 2px 8px rgba(124,58,237,0.08)',
                                        }
                                      : { background: 'var(--row-hover)' }}
                                  >
                                    <Icon size={18} className="shrink-0" />
                                    <span>{itemLabel}</span>
                                    {href === '/orgs' && pendingInviteCount > 0 && (
                                      <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200"
                                        style={{ background: 'rgba(245, 158, 11, 0.16)' }}>
                                        {pendingInviteCount}
                                      </span>
                                    )}
                                  </Link>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Drawer.Body>
                    <Drawer.Footer
                      className="flex flex-col gap-2 px-3 py-3"
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <Dropdown>
                        <Dropdown.Trigger className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 outline-none text-left" style={{ background: 'var(--row-hover)' }}>
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.18)' }}
                            >
                              {initials}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">{user?.username ?? user?.email ?? 'User'}</p>
                              <p className="truncate text-[11px] text-zinc-500">{user?.role ?? 'user'}</p>
                            </div>
                          </div>
                          <Settings01Icon size={16} className="text-zinc-400 shrink-0" />
                        </Dropdown.Trigger>
                        <Dropdown.Popover className="w-[min(80vw,300px)]" placement="top end">
                          <Dropdown.Menu onAction={(key) => {
                             if (key === 'settings') { router.push('/settings'); mobileNav.close(); }
                             if (key === 'api-docs') { window.open('/swagger/index.html', '_blank'); mobileNav.close(); }
                             if (key === 'theme') { setTheme(isDark ? 'light' : 'dark'); }
                             if (key === 'signout') { handleLogout(); mobileNav.close(); }
                          }}>
                            <Dropdown.Item key="settings" id="settings" textValue="Settings">
                              <div className="flex items-center gap-2">
                                 <Settings01Icon size={14} className="text-zinc-500" />
                                 <Label>Settings</Label>
                              </div>
                            </Dropdown.Item>
                            <Dropdown.Item key="theme" id="theme" textValue="Theme">
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-2">
                                  {mounted ? (isDark ? <Sun01Icon size={14} className="text-zinc-500" /> : <Moon02Icon size={14} className="text-zinc-500" />) : <span aria-hidden className="block h-[14px] w-[14px]" />}
                                  <Label>Theme</Label>
                                </div>
                              </div>
                            </Dropdown.Item>
                            <Dropdown.Item key="api-docs" id="api-docs" textValue="API Docs">
                              <div className="flex items-center gap-2">
                                <FileExportIcon size={14} className="text-zinc-500" />
                                <Label>API Docs</Label>
                              </div>
                            </Dropdown.Item>
                            <Dropdown.Section>
                              <Separator className="my-1" />
                              <Dropdown.Item key="signout" id="signout" textValue="Sign Out" className="text-danger">
                                <div className="flex items-center gap-2">
                                  <Logout02Icon size={14} />
                                  <Label className="text-danger">Sign Out</Label>
                                </div>
                              </Dropdown.Item>
                            </Dropdown.Section>
                          </Dropdown.Menu>
                        </Dropdown.Popover>
                      </Dropdown>
                    </Drawer.Footer>
                  </Drawer.Dialog>
                </Drawer.Content>
              </Drawer.Backdrop>
            </Drawer>

            <Link className="flex items-center gap-2 min-w-0" href="/dashboard">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  boxShadow: '0 0 12px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
              >
                <Logo size={18} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>JustScan</p>
                <p className="truncate text-[11px]" style={{ color: 'var(--text-faint)' }}>Security workflow hub</p>
              </div>
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <Button className="rounded-xl" onPress={() => setSearchOpen(true)} variant="secondary">
                <Search01Icon size={15} />
                Search
              </Button>
              <Link className="btn-primary-sm h-10 px-3" href="/scans?new=1">
                <PlusSignIcon size={14} className="shrink-0" />
                <span>New</span>
              </Link>
            </div>
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}