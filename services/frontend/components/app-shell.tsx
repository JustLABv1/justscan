'use client';

import { NavRail, useNavRail } from '@/components/panelui/nav-rail';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
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
  Button,
  Dropdown,
  Label,
  Separator,
  Tooltip,
} from '@/components/ui';
import {
  AiContentGenerator01Icon,
  Activity01Icon,
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
import { ChevronsUpDown, Home, MoreHorizontal, Plus } from 'lucide-react';
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

type NavGroup = {
  id: string;
  /** Section heading. Omit for a flat, unlabeled list. */
  label?: string;
  /** Collapsible groups stay closed until opened, unless the current page lives inside. */
  collapsible?: boolean;
  items: { href: string; label: string; Icon: SidebarIcon }[];
};

const navGroups: NavGroup[] = [
  {
    id: 'primary',
    items: [
      { href: '/dashboard', label: 'Dashboard', Icon: DashboardSquare01Icon },
      { href: '/scans', label: 'Scans', Icon: Shield01Icon },
      { href: '/watchlist', label: 'Watchlist', Icon: Clock01Icon },
      { href: '/git-repositories', label: 'Git repositories', Icon: GitBranchIcon },
      { href: '/helm', label: 'Helm charts', Icon: PackageIcon },
      { href: '/vulnkb', label: 'Vulnerability KB', Icon: BookOpen01Icon },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    collapsible: true,
    items: [
      { href: '/registries', label: 'Registries', Icon: ServerStack01Icon },
      { href: '/helm-registry-credentials', label: 'Helm credentials', Icon: Key01Icon },
      { href: '/suppressions', label: 'Suppressions', Icon: GridTableIcon },
      { href: '/tags', label: 'Tags', Icon: Tag01Icon },
      { href: '/status', label: 'Status pages', Icon: EyeIcon },
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

const adminNavigationGroups: NavGroup[] = ADMIN_AREAS.map((area) => ({
  id: area.label,
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
  return pathname === href || (href !== '/admin' && pathname.startsWith(href + '/'));
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

type ShellNavigationProps = {
  user: AppShellProps['initialUser'];
  pathname: string;
  navigationGroups: NavGroup[];
  isAdminRoute: boolean;
  aiEnabled: boolean;
  scopeLabel: string;
  workspaceTitle: string;
  workScope: WorkScope;
  orgs: Org[];
  pendingInvites: OrgInvite[];
  pendingInviteCount: number;
  manageOpen: boolean;
  onManageChange: (open: boolean) => void;
  onScopeChange: (value: string) => void;
  onSearch: () => void;
  onLogout: () => void;
  onRetakeTour: () => void;
  isDark: boolean;
  mounted: boolean;
  setTheme: (theme: string) => void;
  themeToggleTitle: string;
  activityRef: (node: HTMLDivElement | null) => void;
};

function ShellActivityCenter({
  triggerContainer,
  collapsed,
}: {
  triggerContainer: HTMLDivElement | null;
  collapsed: boolean;
}) {
  const { isMobile, setMobileOpen } = useNavRail();
  return (
    <BackgroundProcessCenter
      collapsed={collapsed && !isMobile}
      triggerContainer={triggerContainer}
      onOpen={() => setMobileOpen(false)}
    />
  );
}

function ShellNavigation({
  user,
  pathname,
  navigationGroups,
  isAdminRoute,
  aiEnabled,
  scopeLabel,
  workspaceTitle,
  workScope,
  orgs,
  pendingInvites,
  pendingInviteCount,
  manageOpen,
  onManageChange,
  onScopeChange,
  onSearch,
  onLogout: handleLogout,
  onRetakeTour: handleRetakeWorkspaceTour,
  isDark,
  mounted,
  setTheme,
  themeToggleTitle,
  activityRef,
}: ShellNavigationProps) {
  const router = useRouter();
  const { collapsed: desktopCollapsed, isMobile, setMobileOpen } = useNavRail();
  const folded = desktopCollapsed && !isMobile;
  const initials = (user?.username ?? user?.email ?? 'U')[0]?.toUpperCase() ?? 'U';
  const accountName = user?.username ?? user?.email ?? 'Account';
  const accountDetail = user?.email && user.email !== accountName ? user.email : '';
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);
  const navItem = ({ href, label, Icon }: NavGroup['items'][number]) => (
    <NavRail.Item
      key={href}
      href={href}
      render={<Link href={href} />}
      label={label}
      active={isActiveRoute(pathname, href)}
      icon={<Icon size={18} aria-hidden />}
    >
      {label}
      {href === '/orgs' && pendingInviteCount > 0 ? (
        <NavRail.Badge>{pendingInviteCount}</NavRail.Badge>
      ) : null}
    </NavRail.Item>
  );
  return (
    <NavRail
      aria-label={isAdminRoute ? 'Administration sidebar' : 'Workspace sidebar'}
      expandedWidth="16rem"
      collapsedWidth="4rem"
      variant="tonal"
      className="md:my-2 md:ml-2 md:h-auto"
    >
      <NavRail.Header className="min-h-12">
        <NavRail.Brand
          href={isAdminRoute ? '/admin' : '/dashboard'}
          render={<Link href={isAdminRoute ? '/admin' : '/dashboard'} />}
          icon={<Logo size={32} />}
          label={isAdminRoute ? 'JustScan administration' : 'JustScan dashboard'}
        >
          {isAdminRoute ? 'Administration' : 'JustScan'}
        </NavRail.Brand>
        <ShellTooltip label="Search · ⌘K">
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="Open command palette"
            onPress={() => {
              setMobileOpen(false);
              onSearch();
            }}
          >
            <Search01Icon size={17} aria-hidden />
          </Button>
        </ShellTooltip>
        {isMobile ? (
          <NavRail.Trigger
            expandLabel="Open navigation menu"
            collapseLabel="Close navigation menu"
          />
        ) : null}
      </NavRail.Header>
      {isAdminRoute ? (
        <div
          className={cn(
            'mb-2 rounded-lg bg-muted/50',
            folded ? 'flex justify-center p-2' : 'px-3 py-2.5'
          )}
          aria-label="System scope: Platform control plane"
        >
          {folded ? (
            <Shield01Icon size={18} aria-hidden />
          ) : (
            <>
              <p className="text-xs font-medium text-muted-foreground">System scope</p>
              <p className="mt-0.5 text-sm font-medium">Platform control plane</p>
            </>
          )}
        </div>
      ) : (
        <div id="tour-workspace-section" className="pb-2" aria-label={workspaceTitle}>
          <WorkspaceSwitcher
            id="tour-workspace-switcher"
            collapsed={folded}
            scopeLabel={scopeLabel}
            scopeValue={workScope.kind === 'org' ? workScope.orgId : 'personal'}
            orgs={orgs}
            invites={pendingInvites}
            onScopeChange={(value) => {
              onScopeChange(value);
              setMobileOpen(false);
            }}
            onReviewInvite={() => {
              router.push('/orgs');
              setMobileOpen(false);
            }}
          />
        </div>
      )}
      <NavRail.Content id="tour-primary-navigation" className="flex-1 gap-2">
        {!isAdminRoute ? (
          <NavRail.Group>
            {navItem({ href: '/scans/new', label: 'New scan', Icon: Plus })}
            {aiEnabled
              ? navItem({ href: '/assistant', label: 'Assistant', Icon: AiContentGenerator01Icon })
              : null}
          </NavRail.Group>
        ) : null}
        {navigationGroups.map((group) =>
          group.collapsible ? (
            <NavRail.Group key={group.id}>
              <NavRail.Item
                icon={<MoreHorizontal size={18} aria-hidden />}
                label={group.label ?? 'Manage'}
              >
                {group.label}
                <NavRail.Sub
                  open={
                    manageOpen || group.items.some((item) => isActiveRoute(pathname, item.href))
                  }
                  onOpenChange={onManageChange}
                  heading
                >
                  {group.items.map(navItem)}
                </NavRail.Sub>
                {pendingInviteCount > 0 ? (
                  <NavRail.Badge>{pendingInviteCount}</NavRail.Badge>
                ) : null}
              </NavRail.Item>
            </NavRail.Group>
          ) : (
            <NavRail.Group key={group.id} label={group.label}>
              {group.items.map(navItem)}
            </NavRail.Group>
          )
        )}
      </NavRail.Content>
      <NavRail.Footer>
        {isAdminRoute
          ? navItem({
              href: '/dashboard',
              label: 'Exit administration',
              Icon: DashboardSquare01Icon,
            })
          : null}
        <div ref={activityRef} />
        <NavRail.Trigger
          className={cn(
            'h-8 w-full text-muted-foreground',
            folded ? 'justify-center' : 'justify-start gap-2.5 px-2.5'
          )}
          expandLabel="Expand sidebar"
          collapseLabel={isMobile ? 'Close navigation menu' : 'Collapse sidebar'}
        >
          {folded ? (
            <SidebarRight01Icon size={18} />
          ) : (
            <>
              <SidebarLeft01Icon size={18} />
              <span className="text-sm">{isMobile ? 'Close navigation' : 'Collapse'}</span>
            </>
          )}
        </NavRail.Trigger>
        <div className="mt-1 shrink-0 border-t border-border pt-2">
          <ShellTooltip label={`Account: ${accountName}`} enabled={folded}>
            <Dropdown>
              <Dropdown.Trigger
                aria-label="Open user menu"
                className={cn(
                  'flex h-12 w-full min-w-0 items-center gap-2.5 rounded-[10px] text-start outline-none transition-colors duration-150',
                  'hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  folded ? 'justify-center px-0' : 'px-1.5'
                )}
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
                >
                  {initials}
                </span>
                {!folded ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {accountName}
                    </span>
                    {accountDetail ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {accountDetail}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {!folded ? (
                  <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
              </Dropdown.Trigger>
              <Dropdown.Popover className="min-w-[220px]" placement="right bottom">
                <Dropdown.Menu
                  onAction={(key) => {
                    if (key !== 'theme') setMobileOpen(false);
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
      </NavRail.Footer>
      <NavRail.Rail />
    </NavRail>
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
  const [manageOpen, setManageOpen] = useState(false);
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
  const [activityTriggerContainer, setActivityTriggerContainer] = useState<HTMLDivElement | null>(
    null
  );
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
    if (localStorage.getItem('sidebar_manage_open') === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setManageOpen(true);
    }
  }, []);

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

  function handleCollapsedChange(next: boolean) {
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
  const desktopCollapsed = collapsed;
  const navigationGroups: NavGroup[] = isAdminRoute
    ? adminNavigationGroups
    : [
        ...navGroups,
        ...(user?.role === 'admin'
          ? [
              {
                id: 'admin',
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
        <NavRail.Provider
          collapsed={collapsed}
          onCollapsedChange={handleCollapsedChange}
          mobileBreakpoint="48rem"
          className="h-dvh min-h-0"
        >
          <div
            id="tour-main-shell"
            data-collapsed={desktopCollapsed}
            className="app-shell relative flex h-dvh w-full overflow-hidden"
          >
            <ShellNavigation
              user={user}
              pathname={pathname}
              navigationGroups={navigationGroups}
              isAdminRoute={isAdminRoute}
              aiEnabled={aiEnabled === true}
              scopeLabel={scopeLabel}
              workspaceTitle={workspaceTitle}
              workScope={workScope}
              orgs={orgs}
              pendingInvites={pendingInvites}
              pendingInviteCount={pendingInviteCount}
              manageOpen={manageOpen}
              onManageChange={(open) => {
                setManageOpen(open);
                localStorage.setItem('sidebar_manage_open', String(open));
              }}
              onScopeChange={handleScopeChange}
              onSearch={() => setSearchOpen(true)}
              onLogout={handleLogout}
              onRetakeTour={handleRetakeWorkspaceTour}
              isDark={isDark}
              mounted={mounted}
              setTheme={setTheme}
              themeToggleTitle={themeToggleTitle}
              activityRef={setActivityTriggerContainer}
            />

            <NavRail.Inset
              render={<div />}
              className="shell-content min-h-0 overflow-hidden rounded-none ring-0 md:m-2 md:rounded-xl"
            >
              <div
                className={`flex min-h-14 shrink-0 flex-wrap items-center gap-2.5 py-2 ${contentRailClass}`}
              >
                <NavRail.Trigger
                  className="md:hidden"
                  expandLabel="Open navigation menu"
                  collapseLabel="Close navigation menu"
                  render={<Button isIconOnly variant="secondary" />}
                />
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
                              <AiContentGenerator01Icon
                                size={14}
                                className="text-muted-foreground"
                              />
                              <Label>Retake Tour</Label>
                            </div>
                          </Dropdown.Item>
                          <Dropdown.Item
                            key="signout"
                            id="signout"
                            textValue="Sign Out"
                            className="text-destructive flex items-center gap-2 mt-1 border-t border-border dark:border-border pt-1"
                          >
                            <div className="flex items-center gap-2">
                              <Logout02Icon size={14} />
                              <Label className="text-destructive">Sign Out</Label>
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
            </NavRail.Inset>
          </div>
          <ShellActivityCenter
            triggerContainer={activityTriggerContainer}
            collapsed={desktopCollapsed}
          />
        </NavRail.Provider>
        {!isAssistantRoute && !isAdminRoute && aiEnabled === true ? (
          <Suspense fallback={null}>
            <LazyFloatingAIChat />
          </Suspense>
        ) : null}
      </ToastProvider>
    </DeferredWorkspaceTourProvider>
  );
}
