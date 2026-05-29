'use client';

import { WorkspaceTourProvider } from '@/components/workspace-tour';
import {
  clearToken,
  clearUser,
  getAISettings,
  getUser,
  getWorkScope,
  getWorkspaceTourState,
  listMyOrgInvites,
  listOrgs,
  Org,
  setWorkScope,
  updateWorkspaceTourState,
  WorkScope,
} from '@/lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Drawer,
  Dropdown,
  Header,
  Kbd,
  Label,
  Popover,
  Separator,
  Tooltip,
  Typography,
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
import {
  type ComponentType,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { AdminSidebarTree } from '@/components/admin-sidebar-tree';
import {
  AIContextBridgeProvider,
  useAIContextBridge,
} from '@/components/assistant/ai-context-bridge';
import { FloatingAIChat } from '@/components/assistant/floating-ai-chat';
import { Logo } from '@/components/logo';
import { SearchModal } from '@/components/search';
import { ToastProvider } from '@/components/toast';
import { BreadcrumbItem, PageHeaderConfig, PageHeaderContext } from '@/components/ui/page-header';

const navGroups = [
  {
    label: 'Primary',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: DashboardSquare01Icon },
      { href: '/triage', label: 'Triage', Icon: ShieldKeyIcon },
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

type SidebarIcon = ComponentType<{
  size?: number;
  className?: string;
  style?: CSSProperties;
}>;

const activeNavStyle = {
  color: 'var(--accent-soft-foreground)',
  background:
    'linear-gradient(135deg, color-mix(in oklab, var(--accent) 22%, transparent) 0%, color-mix(in oklab, var(--accent) 12%, transparent) 100%)',
  boxShadow:
    'inset 0 0 0 1px color-mix(in oklab, var(--accent) 34%, transparent), 0 0 0 1px color-mix(in oklab, var(--accent) 12%, transparent)',
} as const;

function InviteCountChip({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;

  return (
    <Chip
      className={`relative z-10 min-w-6 justify-center px-2 text-[11px] font-semibold ${className}`}
      color="warning"
      size="sm"
      variant="soft"
    >
      {count}
    </Chip>
  );
}

function SidebarNavLink({
  href,
  itemLabel,
  Icon,
  mode,
  active,
  inviteCount,
  onNavigate,
}: {
  href: string;
  itemLabel: string;
  Icon: SidebarIcon;
  mode: 'desktop' | 'collapsed' | 'mobile';
  active: boolean;
  inviteCount: number;
  onNavigate?: () => void;
}) {
  const iconOnly = mode === 'collapsed';
  const isMobile = mode === 'mobile';
  const showCollapsedInviteBadge = href === '/orgs' && iconOnly && inviteCount > 0;

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={iconOnly ? itemLabel : undefined}
      className={
        iconOnly
          ? `group relative flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? '' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`
          : `group relative flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isMobile ? 'p-3' : 'overflow-hidden px-3 py-2.5 whitespace-nowrap'} ${active ? '' : 'text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100'}`
      }
      onClick={onNavigate}
      style={active ? activeNavStyle : isMobile ? { background: 'var(--row-hover)' } : undefined}
    >
      {!active && !isMobile ? (
        <span
          className="absolute inset-0 rounded-xl opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={{ background: 'var(--row-hover)' }}
        />
      ) : null}
      {active && !iconOnly && !isMobile ? (
        <span
          className="absolute left-0 inset-y-2 w-1 rounded-r-full"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in oklab, var(--accent) 52%, white), var(--accent))',
          }}
        />
      ) : null}
      <Icon
        size={18}
        className="relative z-10 shrink-0"
        style={{ color: active ? 'var(--accent-soft-foreground)' : 'var(--text-faint)' }}
      />
      {showCollapsedInviteBadge ? (
        <Badge className="pointer-events-none right-1" color="warning" size="sm" />
      ) : null}
      {!iconOnly ? (
        <span className={`relative z-10 flex-1 ${isMobile ? '' : 'truncate'}`}>{itemLabel}</span>
      ) : null}
      {href === '/orgs' && !iconOnly ? (
        <InviteCountChip count={inviteCount} className="ml-auto" />
      ) : null}
    </Link>
  );
}

export function AppShell({ children, initialUser }: AppShellProps) {
  return (
    <AIContextBridgeProvider>
      <AppShellInner initialUser={initialUser}>{children}</AppShellInner>
    </AIContextBridgeProvider>
  );
}

function AppShellInner({ children, initialUser }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { setRouteContext } = useAIContextBridge();
  const isAssistantRoute = pathname.startsWith('/assistant');
  const { resolvedTheme, setTheme } = useTheme();
  const [user, setUser] = useState(initialUser);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [pendingInviteCount, setPendingInviteCount] = useState(0);
  const [workScope, setWorkScopeState] = useState<WorkScope>(() => getWorkScope());
  const [workspaceTourCompleted, setWorkspaceTourCompleted] = useState(true);
  const [workspaceTourPendingStart, setWorkspaceTourPendingStart] = useState(false);
  const [workspaceTourStartSignal, setWorkspaceTourStartSignal] = useState(0);
  const workspaceTourStateSavedRef = useRef(false);
  const sidebarExpandedForTourRef = useRef(false);
  const mobileNav = useOverlayState();
  const [orgRefreshVersion, setOrgRefreshVersion] = useState(0);
  const [pageHeader, setPageHeader] = useState<PageHeaderConfig | null>(null);
  const [aiEnabled, setAIEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const scanMatch = pathname.match(/^\/scans\/([^/]+)/);
    if (scanMatch?.[1]) {
      setRouteContext({
        scopeType: 'scan',
        scopeRef: decodeURIComponent(scanMatch[1]),
        title: 'Scan scope',
        description: 'Current scan details',
      });
      return;
    }

    setRouteContext({
      scopeType: 'global',
      scopeRef: '',
      title: 'Global workspace context',
      description: 'General JustScan routes and workflows.',
    });
  }, [pathname, setRouteContext]);

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
    if (!mounted) {
      return;
    }

    let cancelled = false;
    workspaceTourStateSavedRef.current = false;

    void getWorkspaceTourState()
      .then((state) => {
        if (cancelled) {
          return;
        }
        setWorkspaceTourCompleted(state.completed);
        if (!state.completed) {
          setCollapsed((current) => {
            if (current) {
              sidebarExpandedForTourRef.current = true;
              return false;
            }
            return current;
          });
          setWorkspaceTourPendingStart(true);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        // Fall back to not auto-starting when state cannot be resolved.
        setWorkspaceTourCompleted(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mounted, user?.id, user?.email, user?.username]);

  useEffect(() => {
    if (!mounted || workspaceTourCompleted || !workspaceTourPendingStart || aiEnabled === null) {
      return;
    }

    if (pathname !== '/dashboard') {
      router.push('/dashboard');
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setWorkspaceTourPendingStart(false);
      setWorkspaceTourStartSignal((current) => current + 1);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [aiEnabled, mounted, pathname, router, workspaceTourCompleted, workspaceTourPendingStart]);

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
    let cancelled = false;

    void getAISettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setAIEnabled(settings.enabled);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAIEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
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

  function handleWorkspaceTourFinished() {
    if (workspaceTourStateSavedRef.current) {
      return;
    }

    if (sidebarExpandedForTourRef.current) {
      sidebarExpandedForTourRef.current = false;
      setCollapsed(true);
    }

    workspaceTourStateSavedRef.current = true;
    setWorkspaceTourCompleted(true);
    void updateWorkspaceTourState(true).catch(() => {
      // Ignore save failures so normal navigation is not interrupted.
    });
  }

  function handleRetakeWorkspaceTour() {
    workspaceTourStateSavedRef.current = false;
    setCollapsed((current) => {
      if (current) {
        sidebarExpandedForTourRef.current = true;
        return false;
      }
      return current;
    });
    setWorkspaceTourCompleted(false);
    setWorkspaceTourPendingStart(true);
    void updateWorkspaceTourState(false).catch(() => {
      // Ignore save failures and still allow in-session retake.
    });
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
  const workspaceInitial = scopeLabel.trim().charAt(0).toUpperCase() || 'W';
  type WorkspaceAvatarColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';
  const workspaceColors: WorkspaceAvatarColor[] = ['accent', 'success', 'warning', 'danger'];
  const hashWorkspaceName = (name: string) =>
    Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const workspaceColorFor = (kind: 'personal' | 'org', name: string): WorkspaceAvatarColor =>
    kind === 'personal'
      ? 'default'
      : workspaceColors[hashWorkspaceName(name) % workspaceColors.length];
  const activeWorkspaceColor = workspaceColorFor(
    workScope.kind,
    workScope.kind === 'org' ? (workScope.orgName ?? workScope.orgId) : 'personal'
  );
  const desktopCollapsed = collapsed;
  const filteredNavGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.href !== '/assistant' || aiEnabled !== false),
  }));
  const navigationGroups = [
    ...filteredNavGroups,
    ...(user?.role === 'admin'
      ? [{ label: 'System', items: [{ href: '/admin', label: 'Admin', Icon: Settings01Icon }] }]
      : []),
  ];
  const navItems = navigationGroups.flatMap((group) =>
    group.items.map(({ href, label }) => ({ href, label }))
  );
  const topbarHeader = pageHeader ?? resolveFallbackHeader(pathname, navItems);
  const contentRailClass = 'px-4 md:px-6';
  const pageHeaderContextValue = useMemo(() => ({ setHeader: setPageHeader }), []);

  return (
    <WorkspaceTourProvider
      includeAssistant={aiEnabled === true}
      startSignal={workspaceTourCompleted ? 0 : workspaceTourStartSignal}
      onFinish={handleWorkspaceTourFinished}
    >
      <ToastProvider>
        <PageHeaderContext.Provider value={pageHeaderContextValue}>
          {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
          <div id="tour-main-shell" className="flex h-dvh app-bg overflow-hidden">
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

              <div id="tour-workspace-section" className="shrink-0 px-2 pb-1 pt-2">
                <Dropdown>
                  <Dropdown.Trigger
                    id="tour-workspace-switcher"
                    className={`group w-full flex items-center rounded-xl transition-all duration-150 outline-none ${desktopCollapsed ? 'justify-center py-1.5' : 'gap-2 px-2 py-1.5'}`}
                    style={{
                      background: desktopCollapsed
                        ? undefined
                        : 'linear-gradient(135deg, color-mix(in oklab, var(--accent) 12%, transparent) 0%, color-mix(in oklab, var(--accent) 5%, transparent) 100%)',
                      border: desktopCollapsed
                        ? 'none'
                        : '1px solid color-mix(in oklab, var(--accent) 24%, transparent)',
                      boxShadow: desktopCollapsed ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.05)',
                    }}
                    aria-label={workspaceTitle}
                  >
                    <div
                      className="relative shrink-0"
                      title={desktopCollapsed ? workspaceTitle : undefined}
                    >
                      <Avatar
                        className="size-7 rounded-lg"
                        color={activeWorkspaceColor}
                        variant="soft"
                      >
                        <Avatar.Fallback>{workspaceInitial}</Avatar.Fallback>
                      </Avatar>
                    </div>
                    {!desktopCollapsed ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-zinc-700 dark:text-zinc-100">
                          {scopeLabel}
                        </p>
                        <ArrowDown01Icon
                          size={14}
                          className="shrink-0 text-zinc-500 transition-transform duration-150 group-data-[pressed=true]:translate-y-[1px]"
                        />
                      </div>
                    ) : null}
                  </Dropdown.Trigger>

                  <Dropdown.Popover
                    className="min-w-[220px]"
                    placement={desktopCollapsed ? 'right top' : 'bottom start'}
                  >
                    <Dropdown.Menu
                      onAction={(key) => handleScopeChange(key as string)}
                      selectionMode="single"
                      selectedKeys={
                        new Set([workScope.kind === 'org' ? workScope.orgId : 'personal'])
                      }
                    >
                      <Dropdown.Item id="personal" textValue="Personal workspace">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-6 rounded-lg" color="default" variant="soft">
                            <Avatar.Fallback>P</Avatar.Fallback>
                          </Avatar>
                          <Label>Personal workspace</Label>
                        </div>
                      </Dropdown.Item>
                      {orgs.length > 0 && (
                        <Dropdown.Section>
                          <Header>Organizations</Header>
                          {orgs.map((org) => (
                            <Dropdown.Item key={org.id} id={org.id} textValue={org.name}>
                              <div className="flex items-center gap-2">
                                <Avatar
                                  className="size-6 rounded-lg"
                                  color={workspaceColorFor('org', org.name)}
                                  variant="soft"
                                >
                                  <Avatar.Fallback>
                                    {org.name.trim().charAt(0).toUpperCase() || 'O'}
                                  </Avatar.Fallback>
                                </Avatar>
                                <Label>{org.name}</Label>
                              </div>
                            </Dropdown.Item>
                          ))}
                        </Dropdown.Section>
                      )}
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              </div>

              <nav
                id="tour-primary-navigation"
                className={`flex-1 overflow-y-auto overflow-x-hidden pb-2 pt-1.5${desktopCollapsed ? '' : ' px-2'}`}
              >
                {navigationGroups.map(({ label, items }) => (
                  <div
                    key={label}
                    className="mb-1 border-b border-white/5 pb-2 last:border-b-0 last:pb-0"
                  >
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

                        if (showAdminTree && !desktopCollapsed) {
                          return <AdminSidebarTree key="admin-tree-desktop" showLabel={false} />;
                        }

                        if (desktopCollapsed && showAdminTree) {
                          return (
                            <div key={href}>
                              <Popover>
                                <Popover.Trigger aria-label={itemLabel} className="block w-full">
                                  <Button
                                    aria-current={active ? 'page' : undefined}
                                    aria-label={itemLabel}
                                    className={`group relative h-10 w-full rounded-xl ${active ? '' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
                                    isIconOnly
                                    style={active ? activeNavStyle : undefined}
                                    variant="ghost"
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
                                      style={{
                                        color: active
                                          ? 'var(--accent-soft-foreground)'
                                          : 'var(--text-faint)',
                                      }}
                                    />
                                  </Button>
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
                                  <SidebarNavLink
                                    href={href}
                                    itemLabel={itemLabel}
                                    Icon={Icon}
                                    mode="collapsed"
                                    active={active}
                                    inviteCount={pendingInviteCount}
                                  />
                                </Tooltip.Trigger>
                                <Tooltip.Content placement="right">{itemLabel}</Tooltip.Content>
                              </Tooltip>
                            </div>
                          );
                        }

                        return (
                          <SidebarNavLink
                            key={href}
                            href={href}
                            itemLabel={itemLabel}
                            Icon={Icon}
                            mode="desktop"
                            active={active}
                            inviteCount={pendingInviteCount}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              <div
                className={`flex min-h-12 items-center gap-2.5 py-2 shrink-0 ${desktopCollapsed ? 'justify-center px-0' : 'px-3'}`}
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Logo size={40} className="shrink-0" />
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
            </Card>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className={`bg-surface rounded-br-3xl flex min-h-11 items-center gap-2.5 py-1.5 ${contentRailClass}`}
              >
                <Button
                  isIconOnly
                  onPress={toggleCollapsed}
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
                            <Logo size={36} className="shrink-0" />
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
                                    <Avatar
                                      className="size-8 rounded-xl"
                                      color={activeWorkspaceColor}
                                      variant="soft"
                                    >
                                      <Avatar.Fallback>{workspaceInitial}</Avatar.Fallback>
                                    </Avatar>
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
                                <ArrowDown01Icon
                                  size={16}
                                  className="text-zinc-500 shrink-0 ml-2"
                                />
                              </Dropdown.Trigger>
                              <Dropdown.Popover className="w-[min(80vw,300px)]">
                                <Dropdown.Menu
                                  onAction={(key) => handleScopeChange(key as string)}
                                  selectionMode="single"
                                  selectedKeys={
                                    new Set([
                                      workScope.kind === 'org' ? workScope.orgId : 'personal',
                                    ])
                                  }
                                >
                                  <Dropdown.Item id="personal" textValue="Personal workspace">
                                    <div className="flex items-center gap-2">
                                      <Avatar
                                        className="size-6 rounded-lg"
                                        color="default"
                                        variant="soft"
                                      >
                                        <Avatar.Fallback>P</Avatar.Fallback>
                                      </Avatar>
                                      <Label>Personal workspace</Label>
                                    </div>
                                  </Dropdown.Item>
                                  {orgs.length > 0 && (
                                    <Dropdown.Section>
                                      <Header>Organizations</Header>
                                      {orgs.map((org) => (
                                        <Dropdown.Item
                                          key={org.id}
                                          id={org.id}
                                          textValue={org.name}
                                        >
                                          <div className="flex items-center gap-2">
                                            <Avatar
                                              className="size-6 rounded-lg"
                                              color={workspaceColorFor('org', org.name)}
                                              variant="soft"
                                            >
                                              <Avatar.Fallback>
                                                {org.name.trim().charAt(0).toUpperCase() || 'O'}
                                              </Avatar.Fallback>
                                            </Avatar>
                                            <Label>{org.name}</Label>
                                          </div>
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
                                  background:
                                    'color-mix(in oklab, var(--warning) 10%, transparent)',
                                  border:
                                    '1px solid color-mix(in oklab, var(--warning) 24%, transparent)',
                                }}
                              >
                                <div>
                                  <p>Pending invites</p>
                                  <p className="text-xs font-normal text-zinc-500">
                                    Review organization access requests
                                  </p>
                                </div>
                                <InviteCountChip count={pendingInviteCount} />
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
                                      <SidebarNavLink
                                        key={href}
                                        href={href}
                                        itemLabel={itemLabel}
                                        Icon={Icon}
                                        mode="mobile"
                                        active={isActiveRoute(pathname, href)}
                                        inviteCount={pendingInviteCount}
                                        onNavigate={() => mobileNav.close()}
                                      />
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
                                    background:
                                      'color-mix(in oklab, var(--accent) 12%, transparent)',
                                    color: 'var(--accent-soft-foreground)',
                                    border:
                                      '1px solid color-mix(in oklab, var(--accent) 18%, transparent)',
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
                                  if (key === 'retake-tour') {
                                    handleRetakeWorkspaceTour();
                                    mobileNav.close();
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
                                <Dropdown.Item
                                  key="retake-tour"
                                  id="retake-tour"
                                  textValue="Retake Tour"
                                >
                                  <div className="flex items-center gap-2">
                                    <AiContentGenerator01Icon size={14} className="text-zinc-500" />
                                    <Label>Retake Tour</Label>
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
                <div
                  id="tour-topbar-actions"
                  className="ml-auto flex shrink-0 items-center gap-1.5"
                >
                  <Button
                    aria-label="Open search"
                    className="rounded-full text-zinc-700 dark:text-zinc-200 md:hidden"
                    isIconOnly
                    onPress={() => setSearchOpen(true)}
                    variant="secondary"
                  >
                    <Search01Icon size={14} className="text-current" />
                  </Button>

                  <Button
                    onPress={() => setSearchOpen(true)}
                    variant="tertiary"
                    className="hidden md:flex md:w-[250px] lg:w-[280px] justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Search01Icon size={14} />
                      <Label className="inline-flex">Search...</Label>
                    </div>
                    <Kbd>
                      <Kbd.Abbr keyValue="command" />
                      <Kbd.Content>K</Kbd.Content>
                    </Kbd>
                  </Button>

                  <Dropdown>
                    <Dropdown.Trigger id="tour-user-menu">
                      <Avatar variant="soft" color="accent" className="size-9">
                        <Avatar.Fallback>{initials}</Avatar.Fallback>
                      </Avatar>
                    </Dropdown.Trigger>

                    <Dropdown.Popover className="min-w-[200px]" placement="bottom end">
                      <Dropdown.Menu
                        onAction={(key) => {
                          if (key === 'settings') router.push('/profile');
                          if (key === 'api-docs') window.open('/swagger/index.html', '_blank');
                          if (key === 'theme') setTheme(isDark ? 'light' : 'dark');
                          if (key === 'retake-tour') handleRetakeWorkspaceTour();
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
                        <Dropdown.Item key="retake-tour" id="retake-tour" textValue="Retake Tour">
                          <div className="flex items-center gap-2">
                            <AiContentGenerator01Icon size={14} className="text-zinc-500" />
                            <Label>Retake Tour</Label>
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

              <main
                className={`min-h-0 flex-1 overflow-x-hidden ${
                  isAssistantRoute ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
                }`}
              >
                {!isAssistantRoute ? (
                  <div className={`border-b border-white/5 py-1.5 md:py-2 ${contentRailClass}`}>
                    <div
                      id="tour-page-header"
                      className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <h1 className="flex flex-wrap items-center gap-1.5 text-lg font-semibold tracking-tight md:text-xl">
                          {topbarHeader.title}
                          {topbarHeader.titleCom}
                        </h1>
                        {topbarHeader.description ? (
                          <Typography.Paragraph className="mt-0.5" color="muted" size="xs">
                            {topbarHeader.description}
                          </Typography.Paragraph>
                        ) : null}
                        {topbarHeader.breadcrumbs && topbarHeader.breadcrumbs.length > 1 ? (
                          <nav
                            aria-label="Breadcrumb"
                            className="mt-1 flex flex-wrap items-center gap-1 text-[11px] font-medium"
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
                                        color: isCurrent
                                          ? 'var(--text-muted)'
                                          : 'var(--text-faint)',
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
                      </div>

                      {topbarHeader.actions ? (
                        <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
                          {topbarHeader.actions}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className={isAssistantRoute ? 'min-h-0 flex-1 overflow-hidden' : ''}>
                  {children}
                </div>
              </main>
            </div>
          </div>
          {!isAssistantRoute ? <FloatingAIChat /> : null}
        </PageHeaderContext.Provider>
      </ToastProvider>
    </WorkspaceTourProvider>
  );
}
