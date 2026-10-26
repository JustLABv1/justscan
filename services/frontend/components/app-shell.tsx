'use client';

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
} from '@/components/ui';
import {
  AiContentGenerator01Icon,
  Activity01Icon,
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
import { Home, MoreHorizontal, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  lazy,
  Suspense,
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
import { openBackgroundProcessCenter } from '@/lib/api/background-jobs';
import { BackgroundProcessCenter } from '@/components/background-process-center';
import {
  PageHeaderSlotsProvider,
  PageHeadingSlot,
  PageActionsSlot,
} from '@/components/ui/page-header-slots';
import { Logo } from '@/components/logo';
import { ToastProvider } from '@/components/toast';

const LazyWorkspaceTourProvider = lazy(() =>
  import('@/components/workspace-tour').then((module) => ({
    default: module.WorkspaceTourProvider,
  }))
);
const LazyFloatingAIChat = lazy(() =>
  import('@/components/assistant/floating-ai-chat').then((module) => ({
    default: module.FloatingAIChat,
  }))
);
const LazySearchModal = lazy(() =>
  import('@/components/search').then((module) => ({ default: module.SearchModal }))
);

type WorkspaceTourProviderProps = {
  children: React.ReactNode;
  includeAssistant: boolean;
  startSignal: number;
  onFinish: () => void;
};

function DeferredWorkspaceTourProvider(props: WorkspaceTourProviderProps) {
  return (
    <Suspense fallback={props.children}>
      <LazyWorkspaceTourProvider {...props} />
    </Suspense>
  );
}
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
  mcp: Activity01Icon,
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
      className={`relative z-10 min-w-6 justify-center px-2 text-xs font-semibold ${className}`}
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
      className={cn(
        'shell-nav-link group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        iconOnly ? 'justify-center px-0' : 'justify-start',
        isMobile && 'min-h-11'
      )}
      onClick={onNavigate}
    >
      <Icon size={18} className="shrink-0" />
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

function ShellTooltip({
  label,
  enabled = true,
  children,
}: {
  label: string;
  enabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip isDisabled={!enabled} delay={250}>
      <Tooltip.Trigger className="block min-w-0">{children}</Tooltip.Trigger>
      <Tooltip.Content placement="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}

export function AppShell({ children, initialUser }: AppShellProps) {
  return (
    <AIContextBridgeProvider>
      <PageHeaderSlotsProvider>
        <AppShellInner initialUser={initialUser}>{children}</AppShellInner>
      </PageHeaderSlotsProvider>
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
  const workspaceAvatarClasses: Record<WorkspaceAvatarColor, string> = {
    default: 'bg-secondary text-foreground',
    accent: 'bg-primary/15 text-primary',
    success: 'bg-success/15 text-success-foreground',
    warning: 'bg-warning/15 text-warning-foreground',
    danger: 'bg-destructive/15 text-destructive',
  };
  const workspaceAvatarClassName =
    workspaceAvatarClasses[workspaceColorFor(workScope.kind, scopeLabel)];
  const desktopCollapsed = collapsed;
  const navigationGroups = isAdminRoute
    ? adminNavigationGroups
    : [
        ...navGroups,
        ...(user?.role === 'admin'
          ? [
              {
                label: 'Admin',
                items: [{ href: '/admin', label: 'Administration', Icon: Settings01Icon }],
              },
            ]
          : []),
      ];
  const contentRailClass = 'px-4 md:px-5';
  const currentSection =
    navigationGroups
      .flatMap((group) => group.items.map(({ href, label }) => ({ href, label })))
      .filter((item) => isActiveRoute(pathname, item.href))
      .sort((a, b) => b.href.length - a.href.length)[0]?.label ??
    (isAssistantRoute ? 'Assistant' : pathname.startsWith('/profile') ? 'Profile' : 'Workspace');

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
    <DeferredWorkspaceTourProvider
      includeAssistant={aiEnabled === true}
      startSignal={workspaceTourCompleted ? 0 : workspaceTourStartSignal}
      onFinish={handleWorkspaceTourFinished}
    >
      <ToastProvider>
        {searchOpen ? (
          <Suspense fallback={null}>
            <LazySearchModal onClose={() => setSearchOpen(false)} />
          </Suspense>
        ) : null}
        <div
          id="tour-main-shell"
          data-collapsed={desktopCollapsed}
          className="app-shell relative flex h-dvh overflow-hidden"
        >
          <Surface
            aria-label={isAdminRoute ? 'Administration sidebar' : 'Workspace sidebar'}
            className={cn(
              'shell-sidebar relative hidden shrink-0 flex-col md:flex',
              desktopCollapsed ? 'w-16' : 'w-64'
            )}
          >
            <div
              className={cn(
                'shell-sidebar-header flex shrink-0 px-4 pt-4 pb-4',
                desktopCollapsed ? 'flex-col items-center gap-3' : 'items-center gap-2'
              )}
            >
              <ShellTooltip
                label={isAdminRoute ? 'Administration home' : 'Dashboard'}
                enabled={desktopCollapsed}
              >
                <Link
                  href={isAdminRoute ? '/admin' : '/dashboard'}
                  aria-label={isAdminRoute ? 'JustScan administration' : 'JustScan dashboard'}
                  className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Logo size={32} className="shrink-0" />
                  {!desktopCollapsed && (
                    <span className="truncate text-sm font-semibold tracking-tight">
                      {isAdminRoute ? 'Administration' : 'JustScan'}
                    </span>
                  )}
                </Link>
              </ShellTooltip>
              <div className={desktopCollapsed ? '' : 'ml-auto'}>
                <ShellTooltip label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    onPress={toggleCollapsed}
                    aria-label={desktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    className=" "
                  >
                    {desktopCollapsed ? (
                      <SidebarRight01Icon size={17} />
                    ) : (
                      <SidebarLeft01Icon size={17} />
                    )}
                  </Button>
                </ShellTooltip>
              </div>
            </div>
            {isAdminRoute && (
              <ShellTooltip label="System scope: Platform control plane" enabled={desktopCollapsed}>
                <div
                  className={cn(
                    'mx-3 mb-2 rounded-lg bg-surface-secondary',
                    desktopCollapsed ? 'flex justify-center p-2' : 'px-3 py-2.5'
                  )}
                  aria-label="System scope: Platform control plane"
                >
                  {desktopCollapsed ? (
                    <Shield01Icon size={18} aria-hidden />
                  ) : (
                    <>
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        System scope
                      </p>
                      <p className="mt-0.5 text-sm font-medium">Platform control plane</p>
                    </>
                  )}
                </div>
              </ShellTooltip>
            )}
            <div
              className={cn(
                'flex shrink-0 gap-2 pb-4',
                desktopCollapsed ? 'flex-col px-3' : 'items-center px-4'
              )}
            >
              {!isAdminRoute && (
                <div id="tour-workspace-section" className="shrink-0">
                  <ShellTooltip label={workspaceTitle}>
                    <Dropdown>
                      <Dropdown.Trigger
                        id="tour-workspace-switcher"
                        aria-label={`${workspaceTitle}${pendingInviteCount > 0 ? `, ${pendingInviteCount} pending organization invite${pendingInviteCount === 1 ? '' : 's'}` : ''}`}
                        className="flex size-10 items-center justify-center rounded-full outline-none transition-shadow hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <Badge.Anchor>
                          <Avatar className={cn('size-10 rounded-full', workspaceAvatarClassName)}>
                            <Avatar.Fallback className="text-sm font-semibold">
                              {workspaceInitial}
                            </Avatar.Fallback>
                          </Avatar>
                          {pendingInviteCount > 0 && <Badge color="warning" size="sm" />}
                        </Badge.Anchor>
                      </Dropdown.Trigger>
                      <Dropdown.Popover className="min-w-[240px]" placement="bottom start">
                        {renderWorkspaceMenu()}
                      </Dropdown.Popover>
                    </Dropdown>
                  </ShellTooltip>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <ShellTooltip label="Search · ⌘K" enabled={desktopCollapsed}>
                  <Button
                    aria-label="Open command palette"
                    onPress={() => setSearchOpen(true)}
                    variant="ghost"
                    className={cn(
                      'shell-search w-full border border-border ',
                      desktopCollapsed ? '' : 'justify-start '
                    )}
                  >
                    <Search01Icon aria-hidden size={16} />
                    {!desktopCollapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate text-left text-sm">Search...</span>
                        <Kbd className="border-0 bg-transparent p-0 text-xs text-muted-foreground">
                          <Kbd.Abbr keyValue="command" />
                          <Kbd.Content>K</Kbd.Content>
                        </Kbd>
                      </>
                    )}
                  </Button>
                </ShellTooltip>
              </div>
            </div>
            {!isAdminRoute ? (
              <div className={`shrink-0 ${desktopCollapsed ? 'px-3 pb-2' : 'px-4 pb-1'}`}>
                <Tooltip isDisabled={!desktopCollapsed}>
                  <Tooltip.Trigger className="block w-full">
                    <Link
                      href="/scans/new"
                      aria-label="New scan"
                      className={buttonVariants({
                        variant: 'primary',
                        size: 'md',
                        className: desktopCollapsed
                          ? 'size-10 w-full rounded-lg px-0'
                          : 'w-full justify-center rounded-lg px-3 shadow-sm',
                      })}
                    >
                      <Plus aria-hidden className="size-4" />
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
              aria-label="Primary navigation"
              className={`flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-2 ${desktopCollapsed ? 'px-3' : 'px-4'}`}
            >
              {navigationGroups.map(({ label, items }) => (
                <div key={label} className={desktopCollapsed ? 'mb-2 last:mb-0' : 'mb-4 last:mb-0'}>
                  {!desktopCollapsed && (
                    <div className="px-2.5 pb-2 pt-2 text-xs font-medium text-muted-foreground">
                      {label}
                    </div>
                  )}
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
                <ShellTooltip label="Exit administration" enabled={desktopCollapsed}>
                  <SidebarNavLink
                    href="/dashboard"
                    itemLabel="Exit administration"
                    Icon={DashboardSquare01Icon}
                    mode={desktopCollapsed ? 'collapsed' : 'desktop'}
                    active={false}
                    inviteCount={0}
                  />
                </ShellTooltip>
              </div>
            ) : null}

            <div className={cn('shrink-0 pb-2', desktopCollapsed ? 'px-3' : 'px-4')}>
              <ShellTooltip label="Background activity" enabled={desktopCollapsed}>
                <BackgroundProcessCenter collapsed={desktopCollapsed} />
              </ShellTooltip>
            </div>

            <div
              className={cn(
                'shrink-0 border-t border-border pt-2 pb-3',
                desktopCollapsed ? 'px-3' : 'px-4'
              )}
            >
              <ShellTooltip
                label={`Account: ${user?.username ?? user?.email ?? 'User'}`}
                enabled={desktopCollapsed}
              >
                <Dropdown>
                  <Dropdown.Trigger
                    aria-label="Open user menu"
                    className={`flex w-full min-w-0 items-center rounded-lg p-2 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-primary ${desktopCollapsed ? 'justify-center' : 'gap-2.5'}`}
                  >
                    <Avatar variant="soft" color="accent" className="size-7 shrink-0">
                      <Avatar.Fallback>{initials}</Avatar.Fallback>
                    </Avatar>
                    {!desktopCollapsed ? (
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-xs font-medium text-muted-foreground">
                          Account
                        </span>
                        <span className="block truncate text-sm font-medium">
                          {user?.username ?? user?.email ?? 'User'}
                        </span>
                      </span>
                    ) : null}
                    {!desktopCollapsed && (
                      <MoreHorizontal
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                  </Dropdown.Trigger>
                  <Dropdown.Popover className="min-w-[220px]" placement="right bottom">
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === 'settings') router.push('/profile');
                        if (key === 'documentation')
                          window.open('/docs', '_blank', 'noopener,noreferrer');
                        if (key === 'theme') setTheme(isDark ? 'light' : 'dark');
                        if (key === 'retake-tour') handleRetakeWorkspaceTour();
                        if (key === 'signout') handleLogout();
                      }}
                    >
                      <Dropdown.Item id="settings" textValue="Profile">
                        <div className="flex items-center gap-2">
                          <Settings01Icon size={14} className="text-muted-foreground" />
                          <Label>Profile</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item id="theme" textValue={themeToggleTitle}>
                        <div className="flex items-center gap-2">
                          {mounted ? (
                            isDark ? (
                              <Sun01Icon size={14} className="text-muted-foreground" />
                            ) : (
                              <Moon02Icon size={14} className="text-muted-foreground" />
                            )
                          ) : (
                            <span aria-hidden className="block size-[14px]" />
                          )}
                          <Label>{themeToggleTitle}</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item id="documentation" textValue="Documentation">
                        <div className="flex items-center gap-2">
                          <FileExportIcon size={14} className="text-muted-foreground" />
                          <Label>Documentation</Label>
                        </div>
                      </Dropdown.Item>
                      <Dropdown.Item id="retake-tour" textValue="Retake tour">
                        <div className="flex items-center gap-2">
                          <AiContentGenerator01Icon size={14} className="text-muted-foreground" />
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
              </ShellTooltip>
            </div>
          </Surface>

          <div className="shell-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:my-2 md:mr-2 md:rounded-xl">
            <div
              className={`flex min-h-14 shrink-0 flex-wrap items-center gap-2.5 py-2 ${contentRailClass}`}
            >
              <>
                <Button
                  aria-label="Open navigation menu"
                  className=" md:hidden"
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
                        <Drawer.CloseTrigger className="text-muted-foreground hover:text-foreground dark:hover:text-foreground" />
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
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-secondary">
                                      <Building04Icon aria-hidden size={18} />
                                    </span>
                                    {pendingInviteCount > 0 ? (
                                      <Badge color="warning" size="sm" />
                                    ) : null}
                                  </Badge.Anchor>
                                  <div className="flex flex-col min-w-0 flex-1">
                                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                      Workspace
                                    </p>
                                    <span className="mt-0.5 truncate text-xs font-medium text-foreground">
                                      {scopeLabel}
                                    </span>
                                  </div>
                                </div>
                                <ArrowDown01Icon
                                  size={16}
                                  className="text-muted-foreground shrink-0 ml-2"
                                />
                              </Dropdown.Trigger>
                              <Dropdown.Popover className="w-[min(80vw,300px)]">
                                {renderWorkspaceMenu()}
                              </Dropdown.Popover>
                            </Dropdown>
                          ) : (
                            <div className="rounded-xl bg-surface-secondary px-3 py-2.5">
                              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
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
                              <Plus aria-hidden className="size-4" />
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
                              className="flex items-center justify-between rounded-xl p-3 text-sm font-medium text-foreground"
                              onClick={() => setMobileNavOpen(false)}
                              style={{
                                background: 'color-mix(in oklab, var(--warning) 10%, transparent)',
                                border:
                                  '1px solid color-mix(in oklab, var(--warning) 24%, transparent)',
                              }}
                            >
                              <div>
                                <p>Pending invites</p>
                                <p className="text-xs font-normal text-muted-foreground">
                                  Review organization access requests
                                </p>
                              </div>
                              <InviteCountChip count={pendingInviteCount} />
                            </Link>
                          )}

                          {navigationGroups.map(({ label, items }) => (
                            <div key={label} className="space-y-1.5">
                              <p className="px-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
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
                        <Button
                          fullWidth
                          variant="ghost"
                          className="justify-start gap-2 text-muted-foreground"
                          onPress={() => {
                            setMobileNavOpen(false);
                            openBackgroundProcessCenter();
                          }}
                        >
                          <Activity01Icon aria-hidden size={17} />
                          Activity
                        </Button>
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
                                    'color-mix(in oklab, var(--primary) 12%, transparent)',
                                  color: 'var(--accent-soft-foreground)',
                                  border:
                                    '1px solid color-mix(in oklab, var(--primary) 18%, transparent)',
                                }}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {user?.username ?? user?.email ?? 'User'}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {user?.role ?? 'user'}
                                </p>
                              </div>
                            </div>
                            <Settings01Icon size={16} className="text-muted-foreground shrink-0" />
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
                                  <Settings01Icon size={14} className="text-muted-foreground" />
                                  <Label>Profile</Label>
                                </div>
                              </Dropdown.Item>
                              <Dropdown.Item key="theme" id="theme" textValue="Theme">
                                <div className="flex items-center justify-between w-full">
                                  <div className="flex items-center gap-2">
                                    {mounted ? (
                                      isDark ? (
                                        <Sun01Icon size={14} className="text-muted-foreground" />
                                      ) : (
                                        <Moon02Icon size={14} className="text-muted-foreground" />
                                      )
                                    ) : (
                                      <span aria-hidden className="block size-[14px]" />
                                    )}
                                    <Label>Theme</Label>
                                  </div>
                                </div>
                              </Dropdown.Item>
                              <Dropdown.Item
                                key="documentation"
                                id="documentation"
                                textValue="Documentation"
                              >
                                <div className="flex items-center gap-2">
                                  <FileExportIcon size={14} className="text-muted-foreground" />
                                  <Label>Documentation</Label>
                                </div>
                              </Dropdown.Item>
                              <Dropdown.Item
                                key="retake-tour"
                                id="retake-tour"
                                textValue="Retake Tour"
                              >
                                <div className="flex items-center gap-2">
                                  <AiContentGenerator01Icon
                                    size={14}
                                    className="text-muted-foreground"
                                  />
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
              <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
                <Link
                  href="/dashboard"
                  aria-label="Dashboard home"
                  className="flex shrink-0 items-center gap-1.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Home aria-hidden className="size-4" />
                  <span className="hidden sm:inline">Home</span>
                </Link>
                <span aria-hidden className="text-muted-foreground">
                  —
                </span>
                <PageHeadingSlot
                  fallback={currentSection === 'Dashboard' ? 'Overview' : currentSection}
                />
              </nav>
              <div
                id="tour-topbar-actions"
                className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
              >
                <PageActionsSlot />
                <Button
                  aria-label="Open command palette"
                  className=" md:hidden"
                  isIconOnly
                  onPress={() => setSearchOpen(true)}
                  variant="ghost"
                >
                  <Search01Icon size={16} />
                </Button>
                <div className="md:hidden">
                  <Dropdown>
                    <Dropdown.Trigger id="tour-user-menu" aria-label="Open user menu">
                      <Avatar variant="soft" color="accent" className="size-9">
                        <Avatar.Fallback>{initials}</Avatar.Fallback>
                      </Avatar>
                    </Dropdown.Trigger>

                    <Dropdown.Popover className="min-w-[200px]" placement="bottom end">
                      <Dropdown.Menu
                        onAction={(key) => {
                          if (key === 'settings') router.push('/profile');
                          if (key === 'documentation')
                            window.open('/docs', '_blank', 'noopener,noreferrer');
                          if (key === 'theme') setTheme(isDark ? 'light' : 'dark');
                          if (key === 'retake-tour') handleRetakeWorkspaceTour();
                          if (key === 'signout') handleLogout();
                        }}
                      >
                        <Dropdown.Item key="settings" id="settings" textValue="Settings">
                          <div className="flex items-center gap-2">
                            <Settings01Icon size={14} className="text-muted-foreground" />
                            <Label>Profile</Label>
                          </div>
                        </Dropdown.Item>
                        <Dropdown.Item key="theme" id="theme" textValue="Theme">
                          <div className="flex items-center gap-2">
                            {mounted ? (
                              isDark ? (
                                <Sun01Icon size={14} className="text-muted-foreground" />
                              ) : (
                                <Moon02Icon size={14} className="text-muted-foreground" />
                              )
                            ) : (
                              <span aria-hidden className="block size-[14px]" />
                            )}
                            <Label>{themeToggleTitle}</Label>
                          </div>
                        </Dropdown.Item>
                        <Dropdown.Item
                          key="documentation"
                          id="documentation"
                          textValue="Documentation"
                        >
                          <div className="flex items-center gap-2">
                            <FileExportIcon size={14} className="text-muted-foreground" />
                            <Label>Documentation</Label>
                          </div>
                        </Dropdown.Item>
                        <Dropdown.Item key="retake-tour" id="retake-tour" textValue="Retake Tour">
                          <div className="flex items-center gap-2">
                            <AiContentGenerator01Icon size={14} className="text-muted-foreground" />
                            <Label>Retake Tour</Label>
                          </div>
                        </Dropdown.Item>
                        <Dropdown.Item
                          key="signout"
                          id="signout"
                          textValue="Sign Out"
                          className="text-danger flex items-center gap-2 mt-1 border-t border-border dark:border-border pt-1"
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
        {!isAssistantRoute && !isAdminRoute && aiEnabled === true ? (
          <Suspense fallback={null}>
            <LazyFloatingAIChat />
          </Suspense>
        ) : null}
      </ToastProvider>
    </DeferredWorkspaceTourProvider>
  );
}
