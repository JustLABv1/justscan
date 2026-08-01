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
  OrgInvite,
  setWorkScope,
  updateWorkspaceTourState,
  WorkScope,
} from '@/lib/api';
import {
  Avatar,
  Badge,
  Button,
  buttonVariants,
  Chip,
  Drawer,
  Description,
  Dropdown,
  Header,
  Kbd,
  Label,
  Separator,
  Surface,
  Tooltip,
} from '@heroui/react';
import {
  AiContentGenerator01Icon,
  ArrowDown01Icon,
  Building04Icon,
  BookOpen01Icon,
  Clock01Icon,
  DashboardSquare01Icon,
  DatabaseSyncIcon,
  EyeIcon,
  FileExportIcon,
  GridTableIcon,
	GitBranchIcon,
  Key01Icon,
  LinkSquare02Icon,
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

import {
  AIContextBridgeProvider,
  useAIContextBridge,
} from '@/components/assistant/ai-context-bridge';
import { ADMIN_AREAS, type AdminTab } from '@/app/(app)/admin/_components/admin-tabs';
import { FloatingAIChat } from '@/components/assistant/floating-ai-chat';
import { Logo } from '@/components/logo';
import { SearchModal } from '@/components/search';
import { ToastProvider } from '@/components/toast';

type SidebarIcon = ComponentType<{
  size?: number;
  className?: string;
  style?: CSSProperties;
  'aria-hidden'?: boolean;
}>;

type WorkspaceAvatarColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const workspaceColors: WorkspaceAvatarColor[] = ['accent', 'success', 'warning', 'danger'];

function workspaceColorFor(kind: 'personal' | 'org', name: string): WorkspaceAvatarColor {
  if (kind === 'personal') return 'default';

  const nameHash = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return workspaceColors[nameHash % workspaceColors.length];
}

const navGroups = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', Icon: DashboardSquare01Icon }],
  },
  {
    label: 'Scanning',
    items: [
      { href: '/scans', label: 'Scans', Icon: Shield01Icon },
      { href: '/git-repositories', label: 'Git repositories', Icon: GitBranchIcon },
      { href: '/helm', label: 'Helm', Icon: PackageIcon },
    ],
  },
  {
    label: 'Research & intelligence',
    items: [
      { href: '/watchlist', label: 'Watchlist', Icon: Clock01Icon },
      { href: '/vulnkb', label: 'Vuln KB', Icon: BookOpen01Icon },
    ],
  },
  {
    label: 'Govern & share',
    items: [
      { href: '/suppressions', label: 'Suppressions', Icon: GridTableIcon },
      { href: '/status', label: 'Status Pages', Icon: EyeIcon },
    ],
  },
  {
    label: 'Workspace setup',
    items: [
      { href: '/registries', label: 'Registries', Icon: ServerStack01Icon },
      { href: '/helm-registry-credentials', label: 'Helm credentials', Icon: Key01Icon },
      { href: '/tags', label: 'Tags', Icon: Tag01Icon },
      { href: '/orgs', label: 'Organizations', Icon: Building04Icon },
    ],
  },
];

const adminItemIcons: Record<AdminTab, SidebarIcon> = {
  overview: DashboardSquare01Icon,
  scans: Shield01Icon,
  scanner: ServerStack01Icon,
  'vulnerability-intelligence': DatabaseSyncIcon,
  autotags: Tag01Icon,
  users: Building04Icon,
  organizations: Building04Icon,
  tokens: ShieldKeyIcon,
  identity: Key01Icon,
  notifications: LinkSquare02Icon,
  registries: ServerStack01Icon,
  ai: AiContentGenerator01Icon,
  audit: FileExportIcon,
  insights: EyeIcon,
  settings: Settings01Icon,
};

const adminNavigationGroups = ADMIN_AREAS.map((area) => ({
  label: area.label,
  items: area.tabs.map((tab) => ({
    href: tab.href,
    label: tab.label,
    Icon: adminItemIcons[tab.value],
  })),
}));

interface AppShellProps {
  children: React.ReactNode;
  initialUser: { id?: string; username?: string; email?: string; role?: string } | null;
}

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}

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
  const variant = active ? 'secondary' : 'ghost';

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={iconOnly ? itemLabel : undefined}
      className={buttonVariants({
        variant,
        size: 'md',
        className: iconOnly
          ? 'group relative h-10 w-full justify-center rounded-xl px-0'
          : `group relative w-full justify-start gap-3 rounded-xl ${
              isMobile ? 'h-11 px-3' : 'h-10 overflow-hidden px-3 whitespace-nowrap'
            }`,
      })}
      onClick={onNavigate}
    >
      <Icon
        size={18}
        className="shrink-0"
      />
      {showCollapsedInviteBadge ? (
        <Badge className="pointer-events-none right-1" color="warning" size="sm" />
      ) : null}
      {!iconOnly ? (
        <span className={`flex-1 ${isMobile ? '' : 'truncate'}`}>{itemLabel}</span>
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
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');
  const isAssistantRoute = pathname.startsWith('/assistant');
  const { resolvedTheme, setTheme } = useTheme();
  const [user, setUser] = useState(initialUser);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [pendingInvites, setPendingInvites] = useState<OrgInvite[]>([]);
  const [pendingInviteCount, setPendingInviteCount] = useState(0);
  const [workScope, setWorkScopeState] = useState<WorkScope>(() => getWorkScope());
  const [workspaceTourCompleted, setWorkspaceTourCompleted] = useState(true);
  const [workspaceTourPendingStart, setWorkspaceTourPendingStart] = useState(false);
  const [workspaceTourStartSignal, setWorkspaceTourStartSignal] = useState(0);
  const workspaceTourStateSavedRef = useRef(false);
  const sidebarExpandedForTourRef = useRef(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [orgRefreshVersion, setOrgRefreshVersion] = useState(0);
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
    const closeAfterNavigation = window.setTimeout(() => setMobileNavOpen(false), 0);
    return () => window.clearTimeout(closeAfterNavigation);
  }, [pathname]);

  useEffect(() => {
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
      collapsedRef.current = true;
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
          if (collapsedRef.current) {
            sidebarExpandedForTourRef.current = true;
            collapsedRef.current = false;
            setCollapsed(false);
          }
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
        const nextInvites = invitesResult.status === 'fulfilled' ? invitesResult.value : [];
        setOrgs(nextOrgs);
        setPendingInvites(nextInvites);
        setPendingInviteCount(nextInvites.length);
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
        setPendingInvites([]);
        setPendingInviteCount(0);
      });
  }, [orgRefreshVersion, pathname]);

  function toggleCollapsed() {
    const next = !collapsed;
    collapsedRef.current = next;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', String(next));
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
      setMobileNavOpen(false);
      return;
    }

    const matchedOrg = orgs.find((org) => org.id === value);
    if (!matchedOrg) return;

    const nextScope: WorkScope = { kind: 'org', orgId: matchedOrg.id, orgName: matchedOrg.name };
    setWorkScopeState(nextScope);
    setWorkScope(nextScope);
    setMobileNavOpen(false);
  }

  function handleWorkspaceTourFinished() {
    if (workspaceTourStateSavedRef.current) {
      return;
    }

    if (sidebarExpandedForTourRef.current) {
      sidebarExpandedForTourRef.current = false;
      collapsedRef.current = true;
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
    if (collapsedRef.current) {
      sidebarExpandedForTourRef.current = true;
      collapsedRef.current = false;
      setCollapsed(false);
    }
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
  const activeWorkspaceColor = workspaceColorFor(
    workScope.kind,
    workScope.kind === 'org' ? (workScope.orgName ?? workScope.orgId) : 'personal'
  );
  const desktopCollapsed = isAdminRoute ? false : collapsed;
  const navigationGroups = isAdminRoute
    ? adminNavigationGroups
    : [
        ...navGroups,
        ...(user?.role === 'admin'
          ? [{ label: 'Admin', items: [{ href: '/admin', label: 'Administration', Icon: Settings01Icon }] }]
          : []),
      ];
  const contentRailClass = 'px-4 md:px-6';

  function renderWorkspaceMenu() {
    return (
      <Dropdown.Menu
        onAction={(key) => {
          const value = key as string;
          if (value.startsWith('invite:')) {
            setMobileNavOpen(false);
            router.push('/orgs');
            return;
          }
          handleScopeChange(value);
        }}
        selectionMode="single"
        selectedKeys={new Set([workScope.kind === 'org' ? workScope.orgId : 'personal'])}
      >
        <Dropdown.Item id="personal" textValue="Personal workspace">
          <div className="flex items-center gap-2">
            <Avatar className="size-6 rounded-lg" color="default" variant="soft">
              <Avatar.Fallback>P</Avatar.Fallback>
            </Avatar>
            <Label>Personal workspace</Label>
          </div>
        </Dropdown.Item>
        {orgs.length > 0 ? (
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
        ) : null}
        {pendingInvites.length > 0 ? (
          <Dropdown.Section>
            <Header>Pending invitations</Header>
            {pendingInvites.map((invite) => (
              <Dropdown.Item
                key={invite.id}
                id={`invite:${invite.id}`}
                textValue={`Review invitation to ${invite.org_name || 'organization'}`}
              >
                <div className="flex items-center gap-2">
                  <Avatar className="size-6 rounded-lg" color="warning" variant="soft">
                    <Avatar.Fallback>
                      {(invite.org_name || 'O').trim().charAt(0).toUpperCase() || 'O'}
                    </Avatar.Fallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col">
                    <Label>{invite.org_name || 'Organization'}</Label>
                    <Description>Invitation awaiting acceptance · Review and accept</Description>
                  </div>
                </div>
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        ) : null}
      </Dropdown.Menu>
    );
  }

  return (
    <WorkspaceTourProvider
      includeAssistant={aiEnabled === true}
      startSignal={workspaceTourCompleted ? 0 : workspaceTourStartSignal}
      onFinish={handleWorkspaceTourFinished}
    >
      <ToastProvider>
        {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
          <div id="tour-main-shell" className="flex h-dvh app-bg overflow-hidden">
            <Surface
              className={`relative hidden border-r border-border md:flex shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out ${
                desktopCollapsed ? 'w-20' : 'w-72'
              }`}
              variant="default"
            >
              <div className={`flex shrink-0 items-center gap-3 px-3 py-3 ${desktopCollapsed ? 'justify-center' : ''}`}>
                <Link
                  href={isAdminRoute ? '/admin' : '/dashboard'}
                  aria-label={isAdminRoute ? 'JustScan administration' : 'JustScan dashboard'}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Logo size={36} className="shrink-0" />
                  {!desktopCollapsed ? (
                    <span className="truncate text-base font-semibold tracking-tight">
                      {isAdminRoute ? 'Administration' : 'JustScan'}
                    </span>
                  ) : null}
                </Link>
              </div>

              {isAdminRoute ? (
                <div className="mx-3 mb-3 rounded-xl bg-surface-secondary px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                    System scope
                  </p>
                  <p className="mt-0.5 text-sm font-medium">Platform control plane</p>
                </div>
              ) : (
                <div id="tour-workspace-section" className={`shrink-0 ${desktopCollapsed ? 'px-2' : 'px-3 pb-2'}`}>
                  <Dropdown>
                  <Dropdown.Trigger
                    id="tour-workspace-switcher"
                    aria-label={`${workspaceTitle}${pendingInviteCount > 0 ? `, ${pendingInviteCount} pending organization invite${pendingInviteCount === 1 ? '' : 's'}` : ''}`}
                    className={`flex w-full items-center rounded-xl bg-surface-secondary p-2 outline-none transition-colors hover:bg-surface-tertiary focus-visible:ring-2 focus-visible:ring-accent ${
                      desktopCollapsed ? 'justify-center' : 'gap-2.5'
                    }`}
                  >
                    <Badge.Anchor>
                      <Avatar className="size-7 shrink-0 rounded-lg" color={activeWorkspaceColor} variant="soft">
                        <Avatar.Fallback>{workspaceInitial}</Avatar.Fallback>
                      </Avatar>
                      {pendingInviteCount > 0 ? <Badge color="warning" size="sm" /> : null}
                    </Badge.Anchor>
                    {!desktopCollapsed ? (
                      <div className="min-w-0 flex-1 text-left">
                        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Workspace</p>
                        <p className="truncate text-sm font-medium">{scopeLabel}</p>
                      </div>
                    ) : null}
                    {!desktopCollapsed ? <ArrowDown01Icon aria-hidden size={14} className="shrink-0 text-muted" /> : null}
                  </Dropdown.Trigger>
                  <Dropdown.Popover className="min-w-[240px]" placement="right top">
                    {renderWorkspaceMenu()}
                  </Dropdown.Popover>
                  </Dropdown>
                </div>
              )}

              {!isAdminRoute ? (
                <div className={`shrink-0 ${desktopCollapsed ? 'px-2 pb-2' : 'px-3 pb-3'}`}>
                <Tooltip isDisabled={!desktopCollapsed}>
                  <Tooltip.Trigger className="block w-full">
                    <Link
                      href="/scans/new"
                      aria-label="New scan"
                      className={buttonVariants({
                        variant: 'primary',
                        size: 'md',
                        className: desktopCollapsed ? 'size-10 w-full rounded-xl px-0' : 'w-full justify-center rounded-xl',
                      })}
                    >
                      <Shield01Icon aria-hidden size={17} />
                      {!desktopCollapsed ? <span>New scan</span> : null}
                    </Link>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="right">New scan</Tooltip.Content>
                </Tooltip>
                {aiEnabled ? (
                  <div className="mt-1.5">
                    <Tooltip isDisabled={!desktopCollapsed}>
                      <Tooltip.Trigger className="block w-full">
                        <SidebarNavLink
                          href="/assistant"
                          itemLabel="Assistant"
                          Icon={AiContentGenerator01Icon}
                          mode={desktopCollapsed ? 'collapsed' : 'desktop'}
                          active={isActiveRoute(pathname, '/assistant')}
                          inviteCount={pendingInviteCount}
                        />
                      </Tooltip.Trigger>
                      <Tooltip.Content placement="right">Assistant</Tooltip.Content>
                    </Tooltip>
                  </div>
                ) : null}
                </div>
              ) : null}

              <nav
                id="tour-primary-navigation"
                className={`flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-2 ${desktopCollapsed ? 'px-2' : 'px-3'}`}
              >
                {navigationGroups.map(({ label, items }) => (
                  <div
                    key={label}
                    className="mb-2 pb-1 last:mb-0"
                  >
                    <div
                      className="nav-section-label px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.1em] leading-none transition-all duration-200 overflow-hidden text-muted"
                      style={{
                        maxHeight: desktopCollapsed ? 0 : 22,
                        opacity: desktopCollapsed ? 0 : 1,
                        paddingTop: desktopCollapsed ? 0 : undefined,
                        paddingBottom: desktopCollapsed ? 0 : undefined,
                      }}
                    >
                      {label}
                    </div>
                    <div className="space-y-0.5">
                      {items.map(({ href, label: itemLabel, Icon }) => {
                        const active = isActiveRoute(pathname, href);

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

              {isAdminRoute ? (
                <div className="shrink-0 px-3 pb-3">
                  <SidebarNavLink
                    href="/dashboard"
                    itemLabel="Exit administration"
                    Icon={DashboardSquare01Icon}
                    mode="desktop"
                    active={false}
                    inviteCount={0}
                  />
                </div>
              ) : null}

              <div className={`flex shrink-0 items-center gap-2 border-t border-border p-3 ${desktopCollapsed ? 'flex-col' : ''}`}>
                <Dropdown>
                  <Dropdown.Trigger
                    aria-label="Open user menu"
                    className={`flex min-w-0 flex-1 items-center rounded-xl p-2 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent ${desktopCollapsed ? 'justify-center' : 'gap-2.5'}`}
                  >
                    <Avatar variant="soft" color="accent" className="size-7 shrink-0">
                      <Avatar.Fallback>{initials}</Avatar.Fallback>
                    </Avatar>
                    {!desktopCollapsed ? (
                      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
                        {user?.username ?? user?.email ?? 'User'}
                      </span>
                    ) : null}
                  </Dropdown.Trigger>
                  <Dropdown.Popover className="min-w-[220px]" placement="right bottom">
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === 'settings') router.push('/profile');
                        if (key === 'documentation') window.open('/docs', '_blank', 'noopener,noreferrer');
                        if (key === 'theme') setTheme(isDark ? 'light' : 'dark');
                        if (key === 'retake-tour') handleRetakeWorkspaceTour();
                        if (key === 'signout') handleLogout();
                      }}
                    >
                      <Dropdown.Item id="settings" textValue="Profile">
                        <div className="flex items-center gap-2">
                          <Settings01Icon size={14} className="text-muted" />
                          <Label>Profile</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item id="theme" textValue={themeToggleTitle}>
                        <div className="flex items-center gap-2">
                          {mounted ? (isDark ? <Sun01Icon size={14} className="text-muted" /> : <Moon02Icon size={14} className="text-muted" />) : <span aria-hidden className="block size-[14px]" />}
                          <Label>{themeToggleTitle}</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item id="documentation" textValue="Documentation">
                        <div className="flex items-center gap-2">
                          <FileExportIcon size={14} className="text-muted" />
                          <Label>Documentation</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item id="retake-tour" textValue="Retake tour">
                        <div className="flex items-center gap-2">
                          <AiContentGenerator01Icon size={14} className="text-muted" />
                          <Label>Retake tour</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Section>
                        <Separator className="my-1" />
                        <Dropdown.Item id="signout" textValue="Sign out" variant="danger">
                          <div className="flex items-center gap-2">
                            <Logout02Icon size={14} />
                            <Label>Sign out</Label>
                          </div>
                        </Dropdown.Item>
                      </Dropdown.Section>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
                {!isAdminRoute ? (
                  <Tooltip isDisabled={!desktopCollapsed}>
                  <Tooltip.Trigger>
                    <Button
                      isIconOnly
                      onPress={toggleCollapsed}
                      variant="tertiary"
                      aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                      {desktopCollapsed ? <SidebarRight01Icon size={18} /> : <SidebarLeft01Icon size={18} />}
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="right">Expand sidebar</Tooltip.Content>
                  </Tooltip>
                ) : null}
              </div>
            </Surface>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div
                className={`bg-surface rounded-br-3xl flex min-h-11 items-center gap-2.5 py-1.5 ${contentRailClass}`}
              >
                <>
                  <Button
                    aria-label="Open navigation menu"
                    className="rounded-lg md:hidden"
                    isIconOnly
                    onPress={() => setMobileNavOpen(true)}
                    variant="secondary"
                  >
                    <Menu01Icon size={16} />
                  </Button>
                  <Drawer.Backdrop
                    className="md:hidden"
                    isOpen={mobileNavOpen}
                    onOpenChange={setMobileNavOpen}
                    variant="blur"
                  >
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
                                {isAdminRoute ? 'Administration' : 'JustScan'}
                              </Drawer.Heading>
                              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {isAdminRoute ? 'Platform control plane' : 'Scan, watch, and manage'}
                              </p>
                            </div>
                          </div>
                          <Drawer.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
                        </Drawer.Header>
                        <Drawer.Body className="flex-1 overflow-y-auto px-2 py-3">
                          <div className="space-y-4">
                            {!isAdminRoute ? (
                              <Dropdown>
                              <Dropdown.Trigger
                                className="w-full flex items-center justify-between rounded-xl p-3 text-sm transition-all duration-150 outline-none text-left"
                                style={{
                                  background: 'var(--row-hover)',
                                  border: '1px solid var(--surface-border)',
                                }}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                  <Badge.Anchor className="shrink-0">
                                    <Avatar
                                      className="size-8 rounded-xl"
                                      color={activeWorkspaceColor}
                                      variant="soft"
                                    >
                                      <Avatar.Fallback>{workspaceInitial}</Avatar.Fallback>
                                    </Avatar>
                                    {pendingInviteCount > 0 ? <Badge color="warning" size="sm" /> : null}
                                  </Badge.Anchor>
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
                                {renderWorkspaceMenu()}
                              </Dropdown.Popover>
                              </Dropdown>
                            ) : (
                              <div className="rounded-xl bg-surface-secondary px-3 py-2.5">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
                                  System scope
                                </p>
                                <p className="mt-1 text-sm font-medium">Platform control plane</p>
                              </div>
                            )}

                            {!isAdminRoute ? (
                              <Link
                              href="/scans/new"
                              className={buttonVariants({
                                variant: 'primary',
                                size: 'md',
                                className: 'w-full justify-center rounded-xl',
                              })}
                              onClick={() => setMobileNavOpen(false)}
                            >
                              <Shield01Icon aria-hidden size={17} />
                              New scan
                              </Link>
                            ) : null}

                            {!isAdminRoute && aiEnabled ? (
                              <SidebarNavLink
                                href="/assistant"
                                itemLabel="Assistant"
                                Icon={AiContentGenerator01Icon}
                                mode="mobile"
                                active={isActiveRoute(pathname, '/assistant')}
                                inviteCount={pendingInviteCount}
                                onNavigate={() => setMobileNavOpen(false)}
                              />
                            ) : null}

                            {!isAdminRoute && pendingInviteCount > 0 && (
                              <Link
                                href="/orgs"
                                className="flex items-center justify-between rounded-xl p-3 text-sm font-medium text-zinc-700 dark:text-zinc-200"
                                onClick={() => setMobileNavOpen(false)}
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
                                <p className="px-2 text-[11px] uppercase tracking-[0.18em] text-muted">
                                  {label}
                                </p>
                                <div className="space-y-1">
                                  {items.map(({ href, label: itemLabel, Icon }) => {
                                    return (
                                      <SidebarNavLink
                                        key={href}
                                        href={href}
                                        itemLabel={itemLabel}
                                        Icon={Icon}
                                        mode="mobile"
                                        active={isActiveRoute(pathname, href)}
                                        inviteCount={pendingInviteCount}
                                        onNavigate={() => setMobileNavOpen(false)}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            ))}

                            {isAdminRoute ? (
                              <SidebarNavLink
                                href="/dashboard"
                                itemLabel="Exit administration"
                                Icon={DashboardSquare01Icon}
                                mode="mobile"
                                active={false}
                                inviteCount={0}
                                onNavigate={() => setMobileNavOpen(false)}
                              />
                            ) : null}
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
                                    setMobileNavOpen(false);
                                  }
                                  if (key === 'documentation') {
                                    window.open('/docs', '_blank', 'noopener,noreferrer');
                                    setMobileNavOpen(false);
                                  }
                                  if (key === 'theme') {
                                    setTheme(isDark ? 'light' : 'dark');
                                  }
                                  if (key === 'retake-tour') {
                                    handleRetakeWorkspaceTour();
                                    setMobileNavOpen(false);
                                  }
                                  if (key === 'signout') {
                                    handleLogout();
                                    setMobileNavOpen(false);
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
                                <Dropdown.Item key="documentation" id="documentation" textValue="Documentation">
                                  <div className="flex items-center gap-2">
                                    <FileExportIcon size={14} className="text-zinc-500" />
                                    <Label>Documentation</Label>
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
                </>
                <div
                  id="tour-topbar-actions"
                  className="ml-auto flex shrink-0 items-center gap-1.5"
                >
                  <Button
                    aria-label="Open command palette"
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
                      <Label className="inline-flex">Go to or search...</Label>
                    </div>
                    <Kbd>
                      <Kbd.Abbr keyValue="command" />
                      <Kbd.Content>K</Kbd.Content>
                    </Kbd>
                  </Button>

                  <div className="md:hidden">
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
                          if (key === 'documentation') window.open('/docs', '_blank', 'noopener,noreferrer');
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
                        <Dropdown.Item key="documentation" id="documentation" textValue="Documentation">
                          <div className="flex items-center gap-2">
                            <FileExportIcon size={14} className="text-zinc-500" />
                            <Label>Documentation</Label>
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
              </div>

              <main
                className={`min-h-0 flex-1 overflow-x-hidden ${
                  isAssistantRoute ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'
                }`}
              >
                <div className={isAssistantRoute ? 'min-h-0 flex-1 overflow-hidden' : ''}>
                  {children}
                </div>
              </main>
            </div>
          </div>
          {!isAssistantRoute && !isAdminRoute ? <FloatingAIChat /> : null}
      </ToastProvider>
    </WorkspaceTourProvider>
  );
}
