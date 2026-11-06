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
import { Command } from '@/components/panelui/command';
import {
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
import { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react';

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
    label: 'Vulnerability KB',
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
    label: 'Status pages',
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

export function SearchModal({ onClose }: { onClose: () => void }) {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const router = useRouter();

  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [images, setImages] = useState<SearchImageResult[]>([]);
  const [scans, setScans] = useState<SearchScanResult[]>([]);
  const [vulns, setVulns] = useState<SearchVulnResult[]>([]);
  const [loading, setLoading] = useState(false);

  const isAdmin = getTokenType() === 'admin';
  const activeOrgId = workScope.kind === 'org' ? workScope.orgId : null;

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
        item.scope.kind === 'org' ? (item.scope.orgName ?? '') : 'personal',
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

  function go(item: ResultItem) {
    if (item.kind === 'page' || item.kind === 'action') {
      router.push(item.data.href);
    } else if (item.kind === 'workspace') {
      setWorkScope(item.data.scope);
    } else if (item.kind === 'image') {
      router.push(`/scans?image=${encodeURIComponent(item.data.image_name)}`);
    } else if (item.kind === 'scan') {
      router.push(`/scans/details/${item.data.id}`);
    } else {
      router.push(`/vulnkb?q=${encodeURIComponent(item.data.vuln_id)}`);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) onClose();
  }

  const hasResults =
    quickActions.length +
      pageCommands.length +
      workspaceItems.length +
      images.length +
      scans.length +
      vulns.length >
    0;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={handleOpenChange}
      hotkey={null}
      label="Command palette"
    >
      <Command
        filter={false}
        search={query}
        onSearchChange={setQuery}
        label="Command palette results"
      >
        <Command.Input placeholder="Go to a page, start an action, switch workspace, or search images and CVEs…" />
        <Command.List>
          {quickActions.length > 0 ? (
            <Command.Group heading="Quick actions">
              {quickActions.map((action) => {
                const Icon = action.Icon;
                return (
                  <Command.Item
                    key={action.id}
                    value={`action:${action.id}`}
                    icon={<Icon size={16} />}
                    subtitle={action.description}
                    kind="Action"
                    onSelect={() => go({ kind: 'action', data: action })}
                  >
                    {action.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ) : null}

          {pageCommands.length > 0 ? (
            <Command.Group heading="Jump to">
              {pageCommands.map((page) => {
                const Icon = page.Icon;
                return (
                  <Command.Item
                    key={page.id}
                    value={`page:${page.id}`}
                    icon={<Icon size={16} />}
                    subtitle={page.description}
                    kind="Page"
                    onSelect={() => go({ kind: 'page', data: page })}
                  >
                    {page.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ) : null}

          {workspaceItems.length > 0 ? (
            <Command.Group heading="Workspaces">
              {workspaceItems.map((workspace) => (
                <Command.Item
                  key={workspace.id}
                  value={`workspace:${workspace.id}`}
                  icon={
                    workspace.scope.kind === 'personal' ? (
                      <Search01Icon size={16} />
                    ) : (
                      <Building04Icon size={16} />
                    )
                  }
                  subtitle={workspace.description}
                  badge={workspace.isActive ? 'Active' : undefined}
                  kind="Workspace"
                  onSelect={() => go({ kind: 'workspace', data: workspace })}
                >
                  {workspace.label}
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          {images.length > 0 ? (
            <Command.Group heading="Images">
              {images.map((image) => (
                <Command.Item
                  key={image.image_name}
                  value={`image:${image.image_name}`}
                  icon={<Shield01Icon size={16} />}
                  subtitle={`${image.scan_count} scan${image.scan_count !== 1 ? 's' : ''}`}
                  kind="Image"
                  onSelect={() => go({ kind: 'image', data: image })}
                >
                  <span className="font-mono">{image.image_name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          {scans.length > 0 ? (
            <Command.Group heading="Scans">
              {scans.map((scan) => (
                <Command.Item
                  key={scan.id}
                  value={`scan:${scan.id}`}
                  icon={<TaskDone02Icon size={16} />}
                  subtitle={`${scan.status} · ${scan.critical_count} critical · ${scan.high_count} high`}
                  kind="Scan"
                  onSelect={() => go({ kind: 'scan', data: scan })}
                >
                  <span className="font-mono">{`${scan.image_name}:${scan.image_tag}`}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          {vulns.length > 0 ? (
            <Command.Group heading="CVEs & packages">
              {vulns.map((vuln) => (
                <Command.Item
                  key={`${vuln.vuln_id}-${vuln.pkg_name}`}
                  value={`vuln:${vuln.vuln_id}:${vuln.pkg_name}`}
                  icon={<ShieldKeyIcon size={16} />}
                  subtitle={vuln.pkg_name}
                  kind={
                    vuln.severity.charAt(0).toUpperCase() + vuln.severity.slice(1).toLowerCase()
                  }
                  onSelect={() => go({ kind: 'vuln', data: vuln })}
                >
                  <span className="font-mono">{vuln.vuln_id}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}

          {loading ? <Command.Loading>Searching…</Command.Loading> : null}
          {!loading && !hasResults ? (
            <Command.Empty>No commands or results for “{query}”.</Command.Empty>
          ) : null}
        </Command.List>
        <Command.Footer lead={<span>Scoped to your active workspace</span>}>
          <Command.FooterAction keys={['↵']}>Open</Command.FooterAction>
        </Command.Footer>
      </Command>
    </Command.Dialog>
  );
}
