'use client';

import { WorkspaceOnboarding } from '@/components/workspace-onboarding';
import {
  clearToken,
  clearUser,
  getUser,
  getWorkScope,
  listMyOrgInvites,
  listOrgs,
  Org,
  setWorkScope,
  WorkScope,
} from '@/lib/api';
import {
  Avatar,
  Button,
  Card,
  Drawer,
  Dropdown,
  Header,
  Kbd,
  Label,
  Popover,
  Separator,
  Tooltip,
  useOverlayState,
} from '@heroui/react';
import {
  AiContentGenerator01Icon,
  ArrowDown01Icon,
  Building04Icon,
  DashboardSquare01Icon,
  EyeIcon,
  FileExportIcon,
  GridTableIcon,
  Logout02Icon,
  Menu01Icon,
  Moon02Icon,
  PackageIcon,
  Search01Icon,
  ServerStack01Icon,
  Settings01Icon,
  Shield01Icon,
  ShieldKeyIcon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  Sun01Icon,
  Tag01Icon,
} from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

import { AdminSidebarTree } from '@/components/admin-sidebar-tree';
import { Logo } from '@/components/logo';
import { SearchModal } from '@/components/search';
import { ToastProvider } from '@/components/toast';
import { BreadcrumbItem, PageHeaderConfig, PageHeaderContext } from '@/components/ui/page-header';
import {
  hasSeenWorkspaceOnboarding,
  markWorkspaceOnboardingSeen,
} from '@/lib/workspace-onboarding';

const navGroups = [
  {
    label: 'Primary',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: DashboardSquare01Icon },
      { href: '/assistant', label: 'Assistant', Icon: AiContentGenerator01Icon },
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

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

function titleFromPath(pathname: string) {
  const segment = pathname.split('/').filter(Boolean).pop();
  if (!segment) return 'Dashboard';

  return segment.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveFallbackHeader(
  pathname: string,
  items: Array<{ href: string; label: string }>
): PageHeaderConfig {
  const current = items.find((item) => isActiveRoute(pathname, item.href));
  const breadcrumbs: BreadcrumbItem[] = current ? [{ label: current.label }] : [];

  return {
    title: current?.label ?? titleFromPath(pathname),
    breadcrumbs,
  };
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
  const [onboardingStatus, setOnboardingStatus] = useState<'checking' | 'show' | 'done'>(
    'checking'
  );
  const mobileNav = useOverlayState();
  const [orgRefreshVersion, setOrgRefreshVersion] = useState(0);
  const [hoveredNavPopover, setHoveredNavPopover] = useState<string | null>(null);
  const [hoveredNavPopoverAnchor, setHoveredNavPopoverAnchor] = useState<{
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const [pageHeader, setPageHeader] = useState<PageHeaderConfig | null>(null);
  const navPopoverCloseTimer = useRef<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUser(getUser() ?? initialUser);
  }, [initialUser, pathname]);

  useEffect(() => {
    mobileNav.close();
  }, [mobileNav, pathname]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHoveredNavPopover(null);
    setHoveredNavPopoverAnchor(null);
  }, [pathname]);

  useEffect(
    () => () => {
      if (navPopoverCloseTimer.current !== null) {
        window.clearTimeout(navPopoverCloseTimer.current);
      }
    },
    []
  );

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
    const currentUser = (getUser() ?? user ?? initialUser) as {
      id?: string;
      email?: string;
      username?: string;
    } | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    return () =>
      window.removeEventListener(
        'justscan-work-scope-changed',
        handleScopeChanged as EventListener
      );
  }, []);

  useEffect(() => {
    function handleOrgMembershipChanged() {
      setOrgRefreshVersion((current) => current + 1);
    }

    window.addEventListener('justscan-org-membership-changed', handleOrgMembershipChanged);
    return () =>
      window.removeEventListener('justscan-org-membership-changed', handleOrgMembershipChanged);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrgsReady(false);
    Promise.allSettled([listOrgs(), listMyOrgInvites()])
      .then(([orgsResult, invitesResult]) => {
        const nextOrgs = orgsResult.status === 'fulfilled' ? orgsResult.value : [];
        setOrgs(nextOrgs);
        setPendingInviteCount(
          invitesResult.status === 'fulfilled' ? invitesResult.value.length : 0
        );
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
    const currentUser = (getUser() ?? user ?? initialUser) as {
      id?: string;
      email?: string;
      username?: string;
    } | null;
    markWorkspaceOnboardingSeen(currentUser);
    setWorkScopeState(nextScope);
    setWorkScope(nextScope);
    setOnboardingStatus('done');
    router.replace('/dashboard');
  }

  function skipOnboarding() {
    const currentUser = (getUser() ?? user ?? initialUser) as {
      id?: string;
      email?: string;
      username?: string;
    } | null;
    markWorkspaceOnboardingSeen(currentUser);
    const nextScope = resolveFallbackScope();
    setWorkScopeState(nextScope);
    setWorkScope(nextScope);
    setOnboardingStatus('done');
    router.replace('/dashboard');
  }

  const initials = (user?.username ?? user?.email ?? 'U')[0]?.toUpperCase() ?? 'U';
  const isDark = resolvedTheme === 'dark';
  const themeToggleTitle = !mounted
    ? 'Toggle theme'
    : isDark
      ? 'Switch to light mode'
      : 'Switch to dark mode';
  const scopeLabel =
    workScope.kind === 'org' ? (workScope.orgName ?? 'Organization') : 'Personal workspace';
  const workspaceTitle = `Workspace: ${scopeLabel}`;
  const isAdminRoute = Boolean(user?.role === 'admin' && isActiveRoute(pathname, '/admin'));
  const desktopCollapsed = collapsed;
  const workspaceMarkerStyle =
    workScope.kind === 'org'
      ? {
          background: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.65)',
        }
      : { background: 'rgba(113,113,122,0.72)', boxShadow: '0 0 0 1px rgba(255,255,255,0.5)' };
  const navigationGroups = isAdminRoute
    ? [
        ...navGroups,
        ...(user?.role === 'admin'
          ? [{ label: 'System', items: [{ href: '/admin', label: 'Admin', Icon: Settings01Icon }] }]
          : []),
      ]
    : [
        ...navGroups,
        ...(user?.role === 'admin'
          ? [{ label: 'System', items: [{ href: '/admin', label: 'Admin', Icon: Settings01Icon }] }]
          : []),
      ];
  const navItems = navigationGroups.flatMap((group) =>
    group.items.map(({ href, label }) => ({ href, label }))
  );
  const topbarHeader = pageHeader ?? resolveFallbackHeader(pathname, navItems);
  const pageHeaderContextValue = useMemo(() => ({ setHeader: setPageHeader }), []);

  function cancelNavPopoverClose() {
    if (navPopoverCloseTimer.current !== null) {
      window.clearTimeout(navPopoverCloseTimer.current);
      navPopoverCloseTimer.current = null;
    }
  }

  function openAnchoredNavPopover(key: string, rect: DOMRect) {
    cancelNavPopoverClose();
    const top = Math.max(12, rect.top - 8);
    const maxHeight = Math.max(240, window.innerHeight - top - 16);
    setHoveredNavPopover(key);
    setHoveredNavPopoverAnchor({
      top,
      left: rect.right,
      maxHeight,
    });
  }

  function scheduleNavPopoverClose() {
    cancelNavPopoverClose();
    navPopoverCloseTimer.current = window.setTimeout(() => {
      setHoveredNavPopover(null);
      setHoveredNavPopoverAnchor(null);
    }, 220);
  }

  function handleRowHoverEnter(event: MouseEvent<HTMLElement>) {
    event.currentTarget.style.background = 'var(--row-hover)';
  }

  function handleRowHoverLeave(event: MouseEvent<HTMLElement>) {
    event.currentTarget.style.background = 'transparent';
  }

  if (onboardingStatus === 'checking') {
    return (
      <ToastProvider>
        <div className="app-bg flex min-h-dvh items-center justify-center px-6 py-10">
          <div className="surface-card flex w-full max-w-md flex-col items-center rounded-[28px] px-8 py-10 text-center">
            <div
              className="flex size-12 items-center justify-center rounded-2xl"
              style={{
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                boxShadow: '0 0 20px rgba(124,58,237,0.28), inset 0 1px 0 rgba(255,255,255,0.18)',
              }}
            >
              <Logo size={20} className="text-white" />
            </div>
            <p className="mt-5 text-base font-semibold text-zinc-900 dark:text-white">
              Preparing your workspace view
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Checking your workspace setup before entering JustScan.
            </p>
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
      <PageHeaderContext.Provider value={pageHeaderContextValue}>
        {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
        <div className="flex h-dvh app-bg overflow-hidden">
          <Card
            className={`relative hidden rounded-none rounded-br-3xl bg-surface md:flex flex-col shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
              desktopCollapsed ? 'w-[68px]' : 'w-72'
            }`}
            style={{
              border: 'none',
              boxShadow: 'none',
            }}
          >
            <div className="absolute -top-10 -left-10 size-40 rounded-full pointer-events-none" />
            <div className="absolute inset-x-0 top-0 h-px pointer-events-none" />

            <div
              className={`flex min-h-12 items-center gap-2.5 py-2 shrink-0 ${desktopCollapsed ? 'justify-center px-0' : 'px-3'}`}
            >
              <div
                className="size-8 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  boxShadow: '0 0 12px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
              >
                <Logo size={16} className="text-white" />
              </div>
              <span
                className={`font-semibold text-[15px] tracking-tight whitespace-nowrap overflow-hidden transition-all duration-300 ${desktopCollapsed ? 'ml-0' : 'ml-3'}`}
                style={{
                  maxWidth: desktopCollapsed ? 0 : 120,
                  opacity: desktopCollapsed ? 0 : 1,
                  color: 'var(--text-primary)',
                }}
              >
                JustScan
              </span>
            </div>

            <nav
              className={`flex-1 overflow-y-auto overflow-x-hidden pb-2 pt-1.5${desktopCollapsed ? '' : ' px-2'}`}
            >
              {navigationGroups.map(({ label, items }) => (
                <div key={label} className="mb-1">
                  <div
                    className="nav-section-label px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.1em] leading-none transition-all duration-300 overflow-hidden"
                    style={{
                      maxHeight: desktopCollapsed ? 0 : 22,
                      opacity: desktopCollapsed ? 0 : 1,
                      color: 'var(--text-faint)',
                      paddingTop: desktopCollapsed ? 0 : undefined,
                      paddingBottom: desktopCollapsed ? 0 : undefined,
                    }}
                  >
                    {label}
                  </div>
                  <div className="space-y-0.5">
                    {items.map(({ href, label: itemLabel, Icon }) => {
                      const showAdminTree = href === '/admin';
                      const active = isActiveRoute(pathname, href);
                      const popoverKey = `desktop:${href}`;

                      if (showAdminTree && !desktopCollapsed) {
                        return <AdminSidebarTree key="admin-tree-desktop" showLabel={false} />;
                      }

                      if (desktopCollapsed && showAdminTree) {
                        return (
                          <div key={href}>
                            <Popover>
                              <Popover.Trigger aria-label={itemLabel} className="block w-full">
                                <button
                                  className={`relative flex w-full h-10 items-center justify-center rounded-xl text-sm font-medium transition-all duration-150 whitespace-nowrap group ${active ? 'text-violet-600 dark:text-violet-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                                  style={
                                    active
                                      ? {
                                          background:
                                            'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
                                          boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.28)',
                                        }
                                      : undefined
                                  }
                                >
                                  {!active && (
                                    <span
                                      className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                      style={{ background: 'var(--row-hover)' }}
                                    />
                                  )}
                                  <Icon
                                    size={18}
                                    className="shrink-0 relative z-10"
                                    style={{ color: active ? '#8b5cf6' : 'var(--text-faint)' }}
                                  />
                                </button>
                              </Popover.Trigger>
                              <Popover.Content
                                placement="right top"
                                className="bg-surface-secondary"
                              >
                                <Popover.Dialog>
                                  <div className="w-[260px] p-2">
                                    <p
                                      className="px-2 pb-1.5 text-[11px] uppercase tracking-[0.18em]"
                                      style={{ color: 'var(--text-faint)' }}
                                    >
                                      Admin
                                    </p>
                                    <AdminSidebarTree
                                      condensed
                                      showLabel={false}
                                      showRoot={false}
                                    />
                                  </div>
                                </Popover.Dialog>
                              </Popover.Content>
                            </Popover>
                          </div>
                        );
                      }

                      if (desktopCollapsed) {
                        return (
                          <div key={href}>
                            <Tooltip delay={0}>
                              <Tooltip.Trigger aria-label={itemLabel} className="block w-full">
                                <Link
                                  href={href}
                                  className={`relative flex w-full h-10 items-center justify-center rounded-xl text-sm font-medium transition-all duration-150 whitespace-nowrap group ${active ? 'text-violet-600 dark:text-violet-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                                  style={
                                    active
                                      ? {
                                          background:
                                            'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
                                          boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.28)',
                                        }
                                      : undefined
                                  }
                                >
                                  {!active && (
                                    <span
                                      className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                                      style={{ background: 'var(--row-hover)' }}
                                    />
                                  )}
                                  <Icon
                                    size={18}
                                    className="shrink-0 relative z-10"
                                    style={{ color: active ? '#8b5cf6' : 'var(--text-faint)' }}
                                  />
                                </Link>
                              </Tooltip.Trigger>
                              <Tooltip.Content placement="right">{itemLabel}</Tooltip.Content>
                            </Tooltip>
                          </div>
                        );
                      }

                      return (
                        <Link
                          key={href}
                          href={href}
                          className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 overflow-hidden whitespace-nowrap group ${active ? 'text-violet-600 dark:text-violet-100' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                          style={
                            active
                              ? {
                                  background:
                                    'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
                                  boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.18)',
                                }
                              : undefined
                          }
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
                          <Icon
                            size={18}
                            className="shrink-0 relative z-10"
                            style={{ color: active ? '#a78bfa' : 'var(--text-faint)' }}
                          />
                          <span
                            className="flex-1 overflow-hidden transition-all duration-300 relative z-10"
                            style={{
                              maxWidth: desktopCollapsed ? 0 : 160,
                              opacity: desktopCollapsed ? 0 : 1,
                            }}
                          >
                            {itemLabel}
                          </span>
                          {href === '/orgs' && pendingInviteCount > 0 && !desktopCollapsed && (
                            <span
                              className="relative z-10 ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200"
                              style={{ background: 'rgba(245, 158, 11, 0.16)' }}
                            >
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

            {desktopCollapsed &&
            hoveredNavPopover === 'desktop:/admin' &&
            hoveredNavPopoverAnchor ? (
              <div
                className="fixed z-[70] hidden pl-2 md:block"
                style={{ top: hoveredNavPopoverAnchor.top, left: hoveredNavPopoverAnchor.left }}
                onMouseEnter={cancelNavPopoverClose}
                onMouseLeave={scheduleNavPopoverClose}
              >
                <div
                  className="surface-modal w-[320px] overflow-hidden rounded-[24px] p-3"
                  style={{
                    borderColor: 'var(--modal-border)',
                    maxHeight: hoveredNavPopoverAnchor.maxHeight,
                  }}
                >
                  <div
                    className="space-y-2 overflow-y-auto pr-1"
                    style={{ maxHeight: hoveredNavPopoverAnchor.maxHeight - 32 }}
                  >
                    <p
                      className="px-1 text-[11px] uppercase tracking-[0.18em]"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      Admin
                    </p>
                    <AdminSidebarTree
                      condensed
                      showLabel={false}
                      showRoot={false}
                      onNavigate={() => {
                        setHoveredNavPopover(null);
                        setHoveredNavPopoverAnchor(null);
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <div
              className="shrink-0 px-2 pb-3 pt-2 space-y-1.5"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <Dropdown>
                <Dropdown.Trigger
                  className={`w-full flex items-center rounded-xl transition-all duration-150 outline-none ${desktopCollapsed ? 'justify-center py-2' : 'gap-2.5 p-2.5'}`}
                  style={{ background: 'transparent' }}
                  aria-label={workspaceTitle}
                  onMouseEnter={handleRowHoverEnter}
                  onMouseLeave={handleRowHoverLeave}
                >
                  <div
                    className="relative shrink-0"
                    title={desktopCollapsed ? workspaceTitle : undefined}
                  >
                    <div
                      className="flex size-8 items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-300"
                      style={{
                        background: 'rgba(124,58,237,0.08)',
                        border: '1px solid rgba(124,58,237,0.12)',
                      }}
                    >
                      <GridTableIcon size={16} />
                    </div>
                    <span
                      className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full"
                      style={workspaceMarkerStyle}
                    />
                  </div>
                  {!desktopCollapsed && (
                    <>
                      <div className="flex min-w-0 flex-1 flex-col justify-center pr-1 text-left">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          Workspace
                        </p>
                        <p className="mt-0.5 truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          {scopeLabel}
                        </p>
                      </div>
                      <ArrowDown01Icon size={14} className="shrink-0 text-zinc-500" />
                    </>
                  )}
                </Dropdown.Trigger>

                <Dropdown.Popover
                  className="min-w-[220px]"
                  placement={desktopCollapsed ? 'right bottom' : 'top start'}
                >
                  <Dropdown.Menu
                    onAction={(key) => handleScopeChange(key as string)}
                    selectionMode="single"
                    selectedKeys={
                      new Set([workScope.kind === 'org' ? workScope.orgId : 'personal'])
                    }
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
            </div>
          </Card>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="bg-surface rounded-br-3xl flex min-h-12 items-center gap-2.5 px-3 py-2">
              <Button
                onClick={toggleCollapsed}
                isIconOnly
                variant="ghost"
                aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {desktopCollapsed ? (
                  <SidebarRight01Icon size={24} />
                ) : (
                  <SidebarLeft01Icon size={24} />
                )}
              </Button>

              <Drawer state={mobileNav}>
                <Button
                  aria-label="Open navigation menu"
                  className="rounded-lg md:hidden"
                  isIconOnly
                  variant="secondary"
                >
                  <Menu01Icon size={16} />
                </Button>
                <Drawer.Backdrop className="md:hidden" variant="blur">
                  <Drawer.Content className="md:hidden" placement="left">
                    <Drawer.Dialog className="flex h-full w-[min(88vw,320px)] flex-col surface-sidebar">
                      <Drawer.Header
                        className="flex items-center justify-between p-4"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="size-9 rounded-xl flex items-center justify-center shrink-0"
                            style={{
                              background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                              boxShadow:
                                '0 0 12px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)',
                            }}
                          >
                            <Logo size={18} className="text-white" />
                          </div>
                          <div>
                            <Drawer.Heading
                              className="text-sm font-semibold"
                              style={{ color: 'var(--text-primary)' }}
                            >
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
                            <Dropdown.Trigger
                              className="w-full flex items-center justify-between rounded-xl p-3 text-sm transition-all duration-150 outline-none text-left"
                              style={{
                                background: 'var(--row-hover)',
                                border: '1px solid var(--surface-border)',
                              }}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                <div className="relative shrink-0">
                                  <div
                                    className="flex size-8 items-center justify-center rounded-xl text-zinc-500 dark:text-zinc-300"
                                    style={{
                                      background: 'rgba(124,58,237,0.08)',
                                      border: '1px solid rgba(124,58,237,0.12)',
                                    }}
                                  >
                                    <GridTableIcon size={16} />
                                  </div>
                                  <span
                                    className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full"
                                    style={workspaceMarkerStyle}
                                  />
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                                    Workspace
                                  </p>
                                  <span className="mt-0.5 truncate text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                                    {scopeLabel}
                                  </span>
                                </div>
                              </div>
                              <ArrowDown01Icon size={16} className="text-zinc-500 shrink-0 ml-2" />
                            </Dropdown.Trigger>
                            <Dropdown.Popover className="w-[min(80vw,300px)]">
                              <Dropdown.Menu
                                onAction={(key) => handleScopeChange(key as string)}
                                selectionMode="single"
                                selectedKeys={
                                  new Set([workScope.kind === 'org' ? workScope.orgId : 'personal'])
                                }
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

                          {pendingInviteCount > 0 && (
                            <Link
                              href="/orgs"
                              className="flex items-center justify-between rounded-xl p-3 text-sm font-medium text-zinc-700 dark:text-zinc-200"
                              onClick={() => mobileNav.close()}
                              style={{
                                background: 'rgba(245, 158, 11, 0.08)',
                                border: '1px solid rgba(245, 158, 11, 0.18)',
                              }}
                            >
                              <div>
                                <p>Pending invites</p>
                                <p className="text-xs font-normal text-zinc-500">
                                  Review organization access requests
                                </p>
                              </div>
                              <span
                                className="inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200"
                                style={{ background: 'rgba(245, 158, 11, 0.16)' }}
                              >
                                {pendingInviteCount}
                              </span>
                            </Link>
                          )}

                          {navigationGroups.map(({ label, items }) => (
                            <div key={label} className="space-y-1.5">
                              <p
                                className="px-2 text-[11px] uppercase tracking-[0.18em]"
                                style={{ color: 'var(--text-faint)' }}
                              >
                                {label}
                              </p>
                              <div className="space-y-1">
                                {items.map(({ href, label: itemLabel, Icon }) => {
                                  const showAdminTree = href === '/admin';
                                  const active = isActiveRoute(pathname, href);

                                  if (showAdminTree) {
                                    return (
                                      <AdminSidebarTree
                                        key="admin-tree-mobile"
                                        condensed
                                        onNavigate={() => mobileNav.close()}
                                        showLabel={false}
                                      />
                                    );
                                  }

                                  return (
                                    <Link
                                      key={href}
                                      href={href}
                                      className={`flex items-center gap-3 rounded-xl p-3 text-sm font-medium transition-all ${
                                        active
                                          ? 'text-violet-600 dark:text-violet-100'
                                          : 'text-zinc-700 dark:text-zinc-300'
                                      }`}
                                      onClick={() => mobileNav.close()}
                                      style={
                                        active
                                          ? {
                                              background:
                                                'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
                                              boxShadow: 'inset 0 0 0 1px rgba(167,139,250,0.18)',
                                            }
                                          : { background: 'var(--row-hover)' }
                                      }
                                    >
                                      <Icon
                                        size={18}
                                        className="shrink-0"
                                        style={{ color: active ? '#a78bfa' : 'var(--text-faint)' }}
                                      />
                                      <span className="flex-1">{itemLabel}</span>
                                      {href === '/orgs' && pendingInviteCount > 0 && (
                                        <span
                                          className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200"
                                          style={{ background: 'rgba(245, 158, 11, 0.16)' }}
                                        >
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
                        className="flex flex-col gap-2 p-3"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                      >
                        <Dropdown>
                          <Dropdown.Trigger
                            className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2 outline-none text-left"
                            style={{ background: 'var(--row-hover)' }}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div
                                className="size-10 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold"
                                style={{
                                  background: 'rgba(124,58,237,0.12)',
                                  color: '#a78bfa',
                                  border: '1px solid rgba(124,58,237,0.18)',
                                }}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-200">
                                  {user?.username ?? user?.email ?? 'User'}
                                </p>
                                <p className="truncate text-[11px] text-zinc-500">
                                  {user?.role ?? 'user'}
                                </p>
                              </div>
                            </div>
                            <Settings01Icon size={16} className="text-zinc-400 shrink-0" />
                          </Dropdown.Trigger>
                          <Dropdown.Popover className="w-[min(80vw,300px)]" placement="top end">
                            <Dropdown.Menu
                              onAction={(key) => {
                                if (key === 'settings') {
                                  router.push('/profile');
                                  mobileNav.close();
                                }
                                if (key === 'api-docs') {
                                  window.open('/swagger/index.html', '_blank');
                                  mobileNav.close();
                                }
                                if (key === 'theme') {
                                  setTheme(isDark ? 'light' : 'dark');
                                }
                                if (key === 'signout') {
                                  handleLogout();
                                  mobileNav.close();
                                }
                              }}
                            >
                              <Dropdown.Item key="settings" id="settings" textValue="Settings">
                                <div className="flex items-center gap-2">
                                  <Settings01Icon size={14} className="text-zinc-500" />
                                  <Label>Profile</Label>
                                </div>
                              </Dropdown.Item>
                              <Dropdown.Item key="theme" id="theme" textValue="Theme">
                                <div className="flex items-center justify-between w-full">
                                  <div className="flex items-center gap-2">
                                    {mounted ? (
                                      isDark ? (
                                        <Sun01Icon size={14} className="text-zinc-500" />
                                      ) : (
                                        <Moon02Icon size={14} className="text-zinc-500" />
                                      )
                                    ) : (
                                      <span aria-hidden className="block size-[14px]" />
                                    )}
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
                                <Dropdown.Item
                                  key="signout"
                                  id="signout"
                                  textValue="Sign Out"
                                  className="text-danger"
                                >
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
              <div className="min-w-0 flex-1 space-y-0.5">
                {topbarHeader.breadcrumbs && topbarHeader.breadcrumbs.length > 0 ? (
                  <nav
                    aria-label="Breadcrumb"
                    className="flex flex-wrap items-center gap-1 text-[10px] font-medium"
                  >
                    {topbarHeader.breadcrumbs.map((item, index) => {
                      const isCurrent = index === topbarHeader.breadcrumbs!.length - 1;

                      return (
                        <span
                          key={`${item.label}-${index}`}
                          className="inline-flex items-center gap-1.5"
                        >
                          {item.href && !isCurrent ? (
                            <Link
                              href={item.href}
                              className="transition-colors hover:text-zinc-900 dark:hover:text-white"
                              style={{ color: 'var(--text-faint)' }}
                            >
                              {item.label}
                            </Link>
                          ) : (
                            <span
                              aria-current={isCurrent ? 'page' : undefined}
                              style={{
                                color: isCurrent ? 'var(--text-primary)' : 'var(--text-faint)',
                              }}
                            >
                              {item.label}
                            </span>
                          )}
                          {!isCurrent ? (
                            <span style={{ color: 'var(--text-faint)' }}>/</span>
                          ) : null}
                        </span>
                      );
                    })}
                  </nav>
                ) : null}

                <div>
                  <h1 className="flex flex-wrap items-center gap-1 text-base font-semibold tracking-tight md:text-base">
                    {topbarHeader.title}
                    {topbarHeader.titleCom}
                  </h1>
                </div>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {topbarHeader.actions ? (
                  <div className="hidden items-center gap-1.5 md:flex">{topbarHeader.actions}</div>
                ) : null}
                <Button
                  aria-label="Open search"
                  className="rounded-full text-zinc-700 dark:text-zinc-200 md:hidden"
                  isIconOnly
                  onPress={() => setSearchOpen(true)}
                  variant="secondary"
                >
                  <Search01Icon size={14} className="text-current" />
                </Button>

                <Button onPress={() => setSearchOpen(true)} variant="tertiary">
                  <div className="flex items-center gap-2">
                    <Search01Icon size={14} />
                    <Label className="hidden md:inline-flex">Search...</Label>
                  </div>
                  <Kbd>
                    <Kbd.Abbr keyValue="command" />
                    <Kbd.Content>K</Kbd.Content>
                  </Kbd>
                </Button>

                <Dropdown>
                  <Dropdown.Trigger>
                    <Avatar variant="soft" color="accent">
                      <Avatar.Fallback>{initials}</Avatar.Fallback>
                    </Avatar>
                  </Dropdown.Trigger>

                  <Dropdown.Popover className="min-w-[200px]" placement="bottom end">
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === 'settings') router.push('/profile');
                        if (key === 'api-docs') window.open('/swagger/index.html', '_blank');
                        if (key === 'theme') setTheme(isDark ? 'light' : 'dark');
                        if (key === 'signout') handleLogout();
                      }}
                    >
                      <Dropdown.Item key="settings" id="settings" textValue="Settings">
                        <div className="flex items-center gap-2">
                          <Settings01Icon size={14} className="text-zinc-500" />
                          <Label>Profile</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item key="theme" id="theme" textValue="Theme">
                        <div className="flex items-center gap-2">
                          {mounted ? (
                            isDark ? (
                              <Sun01Icon size={14} className="text-zinc-500" />
                            ) : (
                              <Moon02Icon size={14} className="text-zinc-500" />
                            )
                          ) : (
                            <span aria-hidden className="block size-[14px]" />
                          )}
                          <Label>{themeToggleTitle}</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item key="api-docs" id="api-docs" textValue="API Docs">
                        <div className="flex items-center gap-2">
                          <FileExportIcon size={14} className="text-zinc-500" />
                          <Label>API Docs</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item
                        key="signout"
                        id="signout"
                        textValue="Sign Out"
                        className="text-danger flex items-center gap-2 mt-1 border-t border-zinc-200 dark:border-zinc-800 pt-1"
                      >
                        <div className="flex items-center gap-2">
                          <Logout02Icon size={14} />
                          <Label className="text-danger">Sign Out</Label>
                        </div>
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              </div>
            </div>

            <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
          </div>
        </div>
      </PageHeaderContext.Provider>
    </ToastProvider>
  );
}
