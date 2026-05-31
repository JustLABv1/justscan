'use client';

import {
  getTokenType,
  listOrgs,
  type Org,
  search,
  SearchImageResult,
  SearchScanResult,
  SearchVulnResult,
  setWorkScope,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  Badge,
  Button,
  Chip,
  Kbd,
  Modal,
  SearchField,
  Spinner,
  useOverlayState,
} from '@heroui/react';
import {
  ArrowRight01Icon,
  Building04Icon,
  DashboardSquare01Icon,
  GitCompareIcon,
  PackageIcon,
  PlusSignIcon,
  Search01Icon,
  ServerStack01Icon,
  Settings01Icon,
  Shield01Icon,
  ShieldKeyIcon,
  Tag01Icon,
  TaskDone02Icon,
  ViewIcon,
} from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SidebarIcon = ComponentType<{ size?: number; className?: string }>;

type CommandDescriptor = {
  description: string;
  href: string;
  id: string;
  Icon: SidebarIcon;
  keywords: string[];
  label: string;
};

type WorkspaceResult = {
  description: string;
  id: string;
  isActive: boolean;
  label: string;
  scope: { kind: 'personal' } | { kind: 'org'; orgId: string; orgName?: string };
};

type ResultItem =
  | { kind: 'action'; data: CommandDescriptor }
  | { kind: 'page'; data: CommandDescriptor }
  | { kind: 'workspace'; data: WorkspaceResult }
  | { kind: 'image'; data: SearchImageResult }
  | { kind: 'scan'; data: SearchScanResult }
  | { kind: 'vuln'; data: SearchVulnResult };

type SeverityColor = 'default' | 'accent' | 'warning' | 'danger';

const SEV_CHIP_COLOR: Record<string, SeverityColor> = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'accent',
  UNKNOWN: 'default',
};

const QUICK_ACTIONS: CommandDescriptor[] = [
  {
    id: 'new-scan',
    label: 'Start New Scan',
    description: 'Open the dedicated scan creation flow.',
    href: '/scans/new',
    Icon: PlusSignIcon,
    keywords: ['create', 'scan', 'start', 'new'],
  },
  {
    id: 'triage',
    label: 'Open Triage',
    description: 'Review items that need action now.',
    href: '/triage',
    Icon: ShieldKeyIcon,
    keywords: ['queue', 'critical', 'review', 'triage'],
  },
  {
    id: 'compare-scans',
    label: 'Compare Scans',
    description: 'Open the diff view for two scan runs.',
    href: '/scans/compare',
    Icon: GitCompareIcon,
    keywords: ['compare', 'diff', 'baseline'],
  },
  {
    id: 'watchlist',
    label: 'Review Watchlist',
    description: 'Check recurring monitored images and stale coverage.',
    href: '/watchlist',
    Icon: ViewIcon,
    keywords: ['watchlist', 'coverage', 'stale', 'monitor'],
  },
];

const PAGE_COMMANDS: CommandDescriptor[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Operator overview for current risk and coverage.',
    href: '/dashboard',
    Icon: DashboardSquare01Icon,
    keywords: ['overview', 'home', 'summary'],
  },
  {
    id: 'scans',
    label: 'Scans',
    description: 'Inbox, activity, and recent scan history.',
    href: '/scans',
    Icon: Shield01Icon,
    keywords: ['images', 'history', 'activity'],
  },
  {
    id: 'helm',
    label: 'Helm Scan',
    description: 'Inspect chart scan runs and scan Helm sources.',
    href: '/helm',
    Icon: PackageIcon,
    keywords: ['chart', 'helm', 'kubernetes'],
  },
  {
    id: 'vulnkb',
    label: 'Vuln KB',
    description: 'Research CVEs, affected packages, and remediation context.',
    href: '/vulnkb',
    Icon: ShieldKeyIcon,
    keywords: ['cve', 'vulnerability', 'osv', 'nvd'],
  },
  {
    id: 'suppressions',
    label: 'Suppressions',
    description: 'Review accepted risk and ignore rules.',
    href: '/suppressions',
    Icon: TaskDone02Icon,
    keywords: ['ignore', 'accepted risk', 'policy'],
  },
  {
    id: 'status',
    label: 'Status Pages',
    description: 'Manage public reporting pages and visibility.',
    href: '/status',
    Icon: ViewIcon,
    keywords: ['public', 'status', 'reporting'],
  },
  {
    id: 'registries',
    label: 'Registries',
    description: 'Manage registry connectivity and scan routing.',
    href: '/registries',
    Icon: ServerStack01Icon,
    keywords: ['registry', 'xray', 'artifactory'],
  },
  {
    id: 'tags',
    label: 'Tags',
    description: 'Manage shared scan labels and organization.',
    href: '/tags',
    Icon: Tag01Icon,
    keywords: ['labels', 'categorize', 'tags'],
  },
  {
    id: 'orgs',
    label: 'Organizations',
    description: 'Review org membership, policy, and configuration.',
    href: '/orgs',
    Icon: Building04Icon,
    keywords: ['workspace', 'team', 'organizations'],
  },
  {
    id: 'profile',
    label: 'Profile',
    description: 'Open account preferences and personal settings.',
    href: '/profile',
    Icon: Settings01Icon,
    keywords: ['profile', 'settings', 'account'],
  },
];

const ADMIN_COMMAND: CommandDescriptor = {
  id: 'admin',
  label: 'Admin',
  description: 'Open the administrative control plane.',
  href: '/admin',
  Icon: Settings01Icon,
  keywords: ['admin', 'control plane', 'platform'],
};

function matchesQuery(query: string, values: string[]) {
  if (!query) return true;
  const normalized = query.trim().toLowerCase();
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function PaletteSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
      {children}
    </p>
  );
}

function PaletteRow({
  active,
  badge,
  description,
  icon,
  id,
  label,
  monoLabel = false,
  onMouseEnter,
  onPress,
  trailing,
}: {
  active: boolean;
  badge?: React.ReactNode;
  description: React.ReactNode;
  icon: React.ReactNode;
  id: string;
  label: React.ReactNode;
  monoLabel?: boolean;
  onMouseEnter: () => void;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onClick={onPress}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'
      }`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-divider bg-surface text-muted">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p
            className={`truncate text-sm font-medium text-foreground ${monoLabel ? 'font-mono' : ''}`}
          >
            {label}
          </p>
          {badge}
        </div>
        <p className="truncate text-xs text-muted">{description}</p>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </button>
  );
}

export function SearchModal({ onClose }: { onClose: () => void }) {
  const modal = useOverlayState({
    defaultOpen: true,
    onOpenChange: (isOpen) => {
      if (!isOpen) onClose();
    },
  });
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const allItemsRef = useRef<ResultItem[]>([]);
  const activeIdxRef = useRef(-1);

  const [query, setQuery] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [images, setImages] = useState<SearchImageResult[]>([]);
  const [scans, setScans] = useState<SearchScanResult[]>([]);
  const [vulns, setVulns] = useState<SearchVulnResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const isAdmin = getTokenType() === 'admin';
  const activeOrgId = workScope.kind === 'org' ? workScope.orgId : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listOrgs()
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }, []);

  const pageCommands = useMemo(() => {
    const commands = isAdmin ? [...PAGE_COMMANDS, ADMIN_COMMAND] : PAGE_COMMANDS;
    return commands.filter((command) =>
      matchesQuery(query, [command.label, command.description, command.href, ...command.keywords])
    );
  }, [isAdmin, query]);

  const quickActions = useMemo(
    () =>
      QUICK_ACTIONS.filter((action) =>
        matchesQuery(query, [action.label, action.description, action.href, ...action.keywords])
      ),
    [query]
  );

  const workspaceItems = useMemo(() => {
    const items: WorkspaceResult[] = [
      {
        id: 'workspace-personal',
        label: 'Personal workspace',
        description: 'Use your personal JustScan scope.',
        scope: { kind: 'personal' },
        isActive: workScope.kind === 'personal',
      },
      ...orgs.map((org) => ({
        id: `workspace-${org.id}`,
        label: org.name,
        description: org.description?.trim() || 'Organization workspace',
        scope: { kind: 'org' as const, orgId: org.id, orgName: org.name },
        isActive: workScope.kind === 'org' && activeOrgId === org.id,
      })),
    ];

    return items.filter((item) =>
      matchesQuery(query, [
        item.label,
        item.description,
        'workspace',
        item.scope.kind,
        item.scope.kind === 'org' ? item.scope.orgName ?? '' : 'personal',
      ])
    );
  }, [activeOrgId, orgs, query, workScope.kind]);

  const doSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setImages([]);
      setScans([]);
      setVulns([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await search(trimmed);
      setImages(result.images ?? []);
      setScans(result.scans ?? []);
      setVulns(result.vulns ?? []);
    } catch {
      setImages([]);
      setScans([]);
      setVulns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(() => {
      const timeoutId = window.setTimeout(() => {
        void doSearch(query);
      }, 220);

      return () => {
        window.clearTimeout(timeoutId);
      };
    });
  }, [doSearch, query, scopeKey]);

  const allItems: ResultItem[] = useMemo(
    () => [
      ...quickActions.map((data) => ({ kind: 'action' as const, data })),
      ...pageCommands.map((data) => ({ kind: 'page' as const, data })),
      ...workspaceItems.map((data) => ({ kind: 'workspace' as const, data })),
      ...images.map((data) => ({ kind: 'image' as const, data })),
      ...scans.map((data) => ({ kind: 'scan' as const, data })),
      ...vulns.map((data) => ({ kind: 'vuln' as const, data })),
    ],
    [images, pageCommands, quickActions, scans, vulns, workspaceItems]
  );

  useEffect(() => {
    allItemsRef.current = allItems;
    activeIdxRef.current = activeIdx;
  }, [activeIdx, allItems]);

  useEffect(() => {
    if (activeIdx < 0) return;
    document.getElementById(`search-item-${activeIdx}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const navigate = useCallback(
    (item: ResultItem) => {
      if (item.kind === 'page' || item.kind === 'action') {
        router.push(item.data.href);
      } else if (item.kind === 'workspace') {
        setWorkScope(item.data.scope);
      } else if (item.kind === 'image') {
        router.push(`/scans?image=${encodeURIComponent(item.data.image_name)}`);
      } else if (item.kind === 'scan') {
        router.push(`/scans/${item.data.id}`);
      } else {
        router.push(`/vulnkb?q=${encodeURIComponent(item.data.vuln_id)}`);
      }

      modal.close();
    },
    [modal, router]
  );

  const handleKeyNavigation = useCallback(
    (event: Pick<KeyboardEvent, 'key' | 'preventDefault'>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        modal.close();
        return;
      }

      const items = allItemsRef.current;
      if (items.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIdx((current) => {
          const next = current < 0 ? 0 : Math.min(current + 1, items.length - 1);
          activeIdxRef.current = next;
          return next;
        });
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIdx((current) => {
          const next = current < 0 ? items.length - 1 : Math.max(current - 1, 0);
          activeIdxRef.current = next;
          return next;
        });
      } else if (event.key === 'Enter') {
        const current = activeIdxRef.current;
        if (current >= 0 && current < items.length) {
          event.preventDefault();
          navigate(items[current]!);
        }
      }
    },
    [modal, navigate]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      handleKeyNavigation(event);
    }

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleKeyNavigation]);

  const showEmpty = query.trim().length >= 2 && allItems.length === 0 && !loading;

  const sectionStarts = useMemo(() => {
    const starts = {
      quickActions: 0,
      pages: quickActions.length,
      workspaces: quickActions.length + pageCommands.length,
      images: quickActions.length + pageCommands.length + workspaceItems.length,
      scans: quickActions.length + pageCommands.length + workspaceItems.length + images.length,
      vulns:
        quickActions.length +
        pageCommands.length +
        workspaceItems.length +
        images.length +
        scans.length,
    };
    return starts;
  }, [images.length, pageCommands.length, quickActions.length, scans.length, workspaceItems.length]);

  return (
    <Modal.Backdrop
      isOpen={modal.isOpen}
      onOpenChange={modal.setOpen}
      variant="blur"
      isDismissable
      className="bg-black/45"
    >
      <Modal.Container placement="top" size="cover" className="pt-[8vh]">
        <Modal.Dialog
          aria-label="Command palette"
          className="mx-auto w-full max-w-4xl overflow-hidden rounded-3xl"
        >
          <Modal.CloseTrigger />
          <Modal.Body className="p-0">
            <div className="border-b border-divider px-4 py-4">
              <SearchField name="global-command-search" variant="secondary" value={query} onChange={setQuery}>
                <SearchField.Group className="h-12">
                  {loading ? <Spinner size="sm" /> : <SearchField.SearchIcon />}
                  <SearchField.Input
                    ref={inputRef}
                    placeholder="Go to pages, start actions, switch workspace, or search images and CVEs..."
                    onKeyDown={handleKeyNavigation}
                    autoComplete="off"
                    spellCheck={false}
                    aria-autocomplete="list"
                    aria-controls="search-results"
                    aria-activedescendant={activeIdx >= 0 ? `search-item-${activeIdx}` : undefined}
                  />
                  {query.length > 0 ? <SearchField.ClearButton onPress={() => setQuery('')} /> : null}
                </SearchField.Group>
              </SearchField>
              <p className="mt-2 text-xs text-muted">
                Use this command surface for quick navigation, workspace switching, and scoped search.
              </p>
            </div>

            <div id="search-results" role="listbox" aria-label="Command palette results">
              {showEmpty ? (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  No commands or search results for{' '}
                  <span className="font-medium text-foreground">&ldquo;{query}&rdquo;</span>.
                </p>
              ) : (
                <div className="max-h-[68vh] overflow-y-auto py-2">
                  {quickActions.length > 0 ? (
                    <div>
                      <PaletteSectionLabel>Quick Actions</PaletteSectionLabel>
                      {quickActions.map((action, index) => {
                        const globalIdx = sectionStarts.quickActions + index;
                        const Icon = action.Icon;
                        return (
                          <PaletteRow
                            key={action.id}
                            id={`search-item-${globalIdx}`}
                            active={activeIdx === globalIdx}
                            icon={<Icon size={16} />}
                            label={action.label}
                            description={action.description}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onPress={() => navigate({ kind: 'action', data: action })}
                          />
                        );
                      })}
                    </div>
                  ) : null}

                  {pageCommands.length > 0 ? (
                    <div className={quickActions.length > 0 ? 'mt-1' : ''}>
                      <PaletteSectionLabel>Jump To</PaletteSectionLabel>
                      {pageCommands.map((page, index) => {
                        const globalIdx = sectionStarts.pages + index;
                        const Icon = page.Icon;
                        return (
                          <PaletteRow
                            key={page.id}
                            id={`search-item-${globalIdx}`}
                            active={activeIdx === globalIdx}
                            icon={<Icon size={16} />}
                            label={page.label}
                            description={page.description}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onPress={() => navigate({ kind: 'page', data: page })}
                            trailing={<span className="text-[11px] text-muted">{page.href}</span>}
                          />
                        );
                      })}
                    </div>
                  ) : null}

                  {workspaceItems.length > 0 ? (
                    <div className={quickActions.length > 0 || pageCommands.length > 0 ? 'mt-1' : ''}>
                      <PaletteSectionLabel>Workspaces</PaletteSectionLabel>
                      {workspaceItems.map((workspace, index) => {
                        const globalIdx = sectionStarts.workspaces + index;
                        return (
                          <PaletteRow
                            key={workspace.id}
                            id={`search-item-${globalIdx}`}
                            active={activeIdx === globalIdx}
                            icon={
                              workspace.scope.kind === 'personal' ? (
                                <Search01Icon size={16} />
                              ) : (
                                <Building04Icon size={16} />
                              )
                            }
                            label={workspace.label}
                            description={workspace.description}
                            badge={
                              workspace.isActive ? (
                                <Badge color="accent" variant="soft" size="sm">
                                  Active
                                </Badge>
                              ) : undefined
                            }
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onPress={() => navigate({ kind: 'workspace', data: workspace })}
                          />
                        );
                      })}
                    </div>
                  ) : null}

                  {images.length > 0 ? (
                    <div
                      className={
                        quickActions.length > 0 || pageCommands.length > 0 || workspaceItems.length > 0
                          ? 'mt-1'
                          : ''
                      }
                    >
                      <PaletteSectionLabel>Images</PaletteSectionLabel>
                      {images.map((image, index) => {
                        const globalIdx = sectionStarts.images + index;
                        return (
                          <PaletteRow
                            key={image.image_name}
                            id={`search-item-${globalIdx}`}
                            active={activeIdx === globalIdx}
                            icon={<Shield01Icon size={16} />}
                            label={image.image_name}
                            monoLabel
                            description="Open filtered scan history for this image."
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onPress={() => navigate({ kind: 'image', data: image })}
                            trailing={
                              <Chip size="sm" variant="soft" color="accent" className="font-mono">
                                {image.scan_count} scan{image.scan_count !== 1 ? 's' : ''}
                              </Chip>
                            }
                          />
                        );
                      })}
                    </div>
                  ) : null}

                  {scans.length > 0 ? (
                    <div
                      className={
                        quickActions.length > 0 ||
                        pageCommands.length > 0 ||
                        workspaceItems.length > 0 ||
                        images.length > 0
                          ? 'mt-1'
                          : ''
                      }
                    >
                      <PaletteSectionLabel>Scans</PaletteSectionLabel>
                      {scans.map((scan, index) => {
                        const globalIdx = sectionStarts.scans + index;
                        return (
                          <PaletteRow
                            key={scan.id}
                            id={`search-item-${globalIdx}`}
                            active={activeIdx === globalIdx}
                            icon={<TaskDone02Icon size={16} />}
                            label={`${scan.image_name}:${scan.image_tag}`}
                            monoLabel
                            description={`${scan.status} · ${scan.critical_count} critical · ${scan.high_count} high`}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onPress={() => navigate({ kind: 'scan', data: scan })}
                          />
                        );
                      })}
                    </div>
                  ) : null}

                  {vulns.length > 0 ? (
                    <div
                      className={
                        quickActions.length > 0 ||
                        pageCommands.length > 0 ||
                        workspaceItems.length > 0 ||
                        images.length > 0 ||
                        scans.length > 0
                          ? 'mt-1'
                          : ''
                      }
                    >
                      <PaletteSectionLabel>CVEs &amp; Packages</PaletteSectionLabel>
                      {vulns.map((vuln, index) => {
                        const globalIdx = sectionStarts.vulns + index;
                        const sevColor = SEV_CHIP_COLOR[vuln.severity] ?? SEV_CHIP_COLOR.UNKNOWN;
                        return (
                          <PaletteRow
                            key={`${vuln.vuln_id}-${vuln.pkg_name}`}
                            id={`search-item-${globalIdx}`}
                            active={activeIdx === globalIdx}
                            icon={<ShieldKeyIcon size={16} />}
                            label={vuln.vuln_id}
                            monoLabel
                            description={vuln.pkg_name}
                            onMouseEnter={() => setActiveIdx(globalIdx)}
                            onPress={() => navigate({ kind: 'vuln', data: vuln })}
                            trailing={
                              <Chip size="sm" variant="soft" color={sevColor} className="font-mono">
                                {vuln.severity.charAt(0).toUpperCase() +
                                  vuln.severity.slice(1).toLowerCase()}
                              </Chip>
                            }
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </Modal.Body>

          <Modal.Footer className="flex items-center justify-between border-t border-divider px-4 py-2">
            <p className="text-[11px] text-muted">Scoped to your active workspace.</p>
            <div className="flex items-center gap-3 text-[10px] text-muted">
              <span className="inline-flex items-center gap-1">
                <Kbd>
                  <Kbd.Abbr keyValue="up" />
                </Kbd>
                <Kbd>
                  <Kbd.Abbr keyValue="down" />
                </Kbd>
                navigate
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>
                  <Kbd.Abbr keyValue="enter" />
                </Kbd>
                open
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>
                  <Kbd.Abbr keyValue="escape" />
                </Kbd>
                close
              </span>
            </div>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
