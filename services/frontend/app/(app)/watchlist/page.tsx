'use client';
import { CollectionBadgeList } from '@/components/scans/collection-badge-list';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { OwnershipBadge, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  Collection,
  createWatchlistItem,
  listCollections,
  deleteWatchlistItem,
  getDefaultScannerCapabilities,
  getTokenType,
  getWorkScope,
  listRegistriesWithCapabilities,
  listWatchlist,
  listWatchlistShares,
  RegistryWithHealth,
  ResourceShare,
  ScannerCapabilities,
  shareWatchlistItem,
  triggerWatchlistScan,
  unshareWatchlistItem,
  updateWatchlistItem,
  WatchlistItem,
} from '@/lib/api';
import { cronToHuman, type HourCyclePreference } from '@/lib/cron';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import { fullDate, timeAgo } from '@/lib/time';
import {
  getWatchlistPolicyAttentionItems,
  getWatchlistPosture,
  watchlistNeedsPolicyAttention,
  type WatchlistPosture,
} from '@/lib/watchlist-posture';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Switch,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  ArrowRight01Icon,
  BiometricAccessIcon,
  Clock01Icon,
  Delete01Icon,
  EyeIcon,
  PencilEdit01Icon,
  PlayIcon,
  PlusSignIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

const selectTriggerCls = heroSelectTriggerClassName;
const TIMEZONE_OPTIONS =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC'];

function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

const postureChipColor: Record<
  WatchlistPosture['tone'],
  'success' | 'warning' | 'danger' | 'accent' | 'default'
> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  accent: 'accent',
  neutral: 'default',
};

type WatchlistFocus = 'all' | 'attention' | 'stale' | 'healthy' | 'never_scanned';

function buildWatchlistScansHref(imageName: string) {
  return `/scans?image=${encodeURIComponent(imageName)}`;
}

function buildWatchlistTriageHref(imageName?: string) {
  const params = new URLSearchParams({ kind: 'watchlist' });
  if (imageName) params.set('q', imageName);
  return `/triage?${params.toString()}`;
}

function isNeverScannedItem(item: WatchlistItem) {
  return item.enabled && !item.last_scan_id;
}

function isStaleWatchlistItem(item: WatchlistItem, now: number) {
  if (!item.enabled || !item.last_scanned_at || now === 0) return false;
  const scannedAt = Date.parse(item.last_scanned_at);
  return !Number.isNaN(scannedAt) && now - scannedAt > 7 * 24 * 60 * 60 * 1000;
}

function isHealthyWatchlistItem(item: WatchlistItem, now: number) {
  const posture = getWatchlistPosture(item);
  return (
    item.enabled &&
    !watchlistNeedsPolicyAttention(item) &&
    !isNeverScannedItem(item) &&
    !isStaleWatchlistItem(item, now) &&
    posture.kind !== 'running'
  );
}

function getWatchlistOverviewSummary({
  activeCount,
  attentionCount,
  neverScannedCount,
  staleCount,
}: {
  activeCount: number;
  attentionCount: number;
  neverScannedCount: number;
  staleCount: number;
}): {
  description: string;
  label: string;
  title: string;
  tone: 'success' | 'warning' | 'danger' | 'accent' | 'neutral';
} {
  if (activeCount === 0) {
    return {
      label: 'Idle',
      title: 'No active watchlist coverage is running',
      description: 'Enable a recurring image schedule to start building watchlist coverage.',
      tone: 'neutral',
    };
  }

  if (attentionCount > 0) {
    return {
      label: 'Needs action',
      title: 'Policy or scan failures need review',
      description:
        'Blocked, failed, or non-compliant watchlist items should be reviewed before treating coverage as healthy.',
      tone: 'danger',
    };
  }

  if (staleCount > 0 || neverScannedCount > 0) {
    return {
      label: 'Coverage gaps',
      title: 'Watchlist freshness needs review',
      description:
        'Some scheduled items are stale or still missing a baseline scan result.',
      tone: 'warning',
    };
  }

  return {
    label: 'Healthy',
    title: 'Watchlist coverage is current',
    description:
      'Recurring scans are up to date and there are no current policy or failure signals.',
    tone: 'success',
  };
}

function WatchlistPostureSummary({
  activeCount,
  attentionCount,
  healthyCount,
  neverScannedCount,
  staleCount,
}: {
  activeCount: number;
  attentionCount: number;
  healthyCount: number;
  neverScannedCount: number;
  staleCount: number;
}) {
  const cards = [
    {
      label: 'Active schedules',
      value: activeCount,
      detail: 'images monitored automatically',
      hintClassName: 'text-muted-foreground',
    },
    {
      label: 'Need policy attention',
      value: attentionCount,
      detail: 'blocked, failed, or non-compliant',
      hintClassName: attentionCount > 0 ? 'text-danger' : 'text-muted-foreground',
    },
    {
      label: 'Healthy coverage',
      value: healthyCount,
      detail: 'current and not attention-bound',
      hintClassName: healthyCount > 0 ? 'text-success' : 'text-muted-foreground',
    },
    {
      label: 'Never scanned',
      value: neverScannedCount,
      detail: 'no baseline result yet',
      hintClassName: neverScannedCount > 0 ? 'text-warning' : 'text-muted-foreground',
    },
    {
      label: 'Stale',
      value: staleCount,
      detail: 'last scan older than 7 days',
      hintClassName: staleCount > 0 ? 'text-warning' : 'text-muted-foreground',
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label} variant="default" className="h-full border border-divider/70">
          <Card.Content className="gap-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {card.label}
            </p>
            <p className="text-2xl font-bold tabular-nums tracking-tight">
              {card.value.toLocaleString()}
            </p>
            <p className={`text-xs ${card.hintClassName}`}>{card.detail}</p>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

function WatchlistNarrativeCard({
  triageHref,
  summary,
  activeCount,
  onShowHealthy,
}: {
  triageHref: string;
  summary: ReturnType<typeof getWatchlistOverviewSummary>;
  activeCount: number;
  onShowHealthy: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Watchlist posture</p>
          <p className="mt-1 text-base font-medium text-foreground">{summary.title}</p>
        </div>
        <Chip color={postureChipColor[summary.tone]} variant="soft" size="sm">
          {summary.label}
        </Chip>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">
        {summary.description}{' '}
        {activeCount > 0 ? (
          <>
            <span className="font-medium text-foreground">{activeCount}</span> active schedules are
            currently contributing to watchlist coverage.
          </>
        ) : null}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={triageHref}>
          <Button variant="secondary">Open triage</Button>
        </Link>
        <Button variant="tertiary" onPress={onShowHealthy}>
          Show healthy items
        </Button>
      </div>
    </Card>
  );
}

type WatchlistQueueEntry = {
  description: string;
  href: string;
  id: string;
  image: string;
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'accent' | 'neutral';
};

function WatchlistActionQueue({
  items,
  onShowAttention,
  onShowStale,
  onShowNeverScanned,
}: {
  items: WatchlistQueueEntry[];
  onShowAttention: () => void;
  onShowStale: () => void;
  onShowNeverScanned: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Needs attention</p>
          <p className="mt-1 text-xs text-muted">
            Review the next watchlist items that need scan or policy follow-up.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="tertiary" size="sm" onPress={onShowAttention}>
            Attention
          </Button>
          <Button variant="tertiary" size="sm" onPress={onShowStale}>
            Stale
          </Button>
          <Button variant="tertiary" size="sm" onPress={onShowNeverScanned}>
            Never scanned
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-success/20 bg-success/8 px-4 py-5">
          <p className="text-sm font-medium text-success">No urgent watchlist items right now.</p>
          <p className="mt-1 text-xs text-muted">
            Attention, stale schedules, and missing baseline scans will surface here first.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-start justify-between gap-3 rounded-xl border border-divider bg-surface px-3 py-3 transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color={postureChipColor[item.tone]} variant="soft" size="sm">
                    {item.label}
                  </Chip>
                  <p className="truncate font-mono text-sm font-medium text-foreground">
                    {item.image}
                  </p>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{item.description}</p>
              </div>
              <ArrowRight01Icon size={16} className="mt-1 shrink-0 text-muted" />
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function LastScanState({
  item,
  hourCycle,
}: {
  item: WatchlistItem;
  hourCycle: HourCyclePreference;
}) {
  if (!item.last_scan_id) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-700">Never scanned</span>;
  }

  const timestamp =
    item.last_scanned_at ?? item.last_scan?.completed_at ?? item.last_scan?.created_at;
  return (
    <Link
      href={`/scans/${item.last_scan_id}`}
      className="inline-flex max-w-fit flex-col gap-1.5 px-2 py-1 transition-colors hover:bg-zinc-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 dark:hover:bg-zinc-800/60"
      title={fullDate(timestamp, {
        hourCycle,
        timeZone: item.timezone,
      })}
      aria-label={`Open scan details from ${timeAgo(timestamp, {
        hourCycle,
        timeZone: item.timezone,
      })}`}
    >
      {item.last_scan ? (
        <StatusBadge
          status={item.last_scan.status}
          externalStatus={item.last_scan.external_status}
        />
      ) : (
        <Chip color="default" variant="soft" size="sm">
          Unknown
        </Chip>
      )}
      <span className="text-xs text-zinc-500">
        {timeAgo(timestamp, {
          hourCycle,
          timeZone: item.timezone,
        })}
      </span>
    </Link>
  );
}

function PolicyPostureCell({ posture, item }: { posture: WatchlistPosture; item: WatchlistItem }) {
  const failedPolicies = item.compliance_summary?.failed_policy_names ?? [];
  const allPolicies = item.compliance_summary?.policy_names ?? [];
  const policyTitle =
    failedPolicies.length > 0
      ? failedPolicies.join(', ')
      : allPolicies.length > 0
        ? allPolicies.join(', ')
        : posture.description;

  return (
    <div className="max-w-[240px] space-y-1.5">
      <Chip color={postureChipColor[posture.tone]} variant="soft" size="sm">
        {posture.label}
      </Chip>
      <p className="truncate text-xs text-zinc-500" title={policyTitle}>
        {posture.description}
      </p>
    </div>
  );
}

export default function WatchlistPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [availableCollections, setAvailableCollections] = useState<Collection[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(() =>
    getDefaultScannerCapabilities()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [schedule, setSchedule] = useState('0 2 * * *');
  const [timezone, setTimezone] = useState(getBrowserTimezone());
  const [hourCycle, setHourCycle] = useState<HourCyclePreference>('locale');
  const [enabled, setEnabled] = useState(true);
  const [registryId, setRegistryId] = useState('');
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [triggering, setTriggering] = useState('');
  const [shareTarget, setShareTarget] = useState<WatchlistItem | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [focusFilter, setFocusFilter] = useState<WatchlistFocus>('all');
  const [postureNow] = useState(() => Date.now());
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const isPlatformAdmin = getTokenType() === 'admin';
  const orgRoleById = useMemo(
    () =>
      new Map(
        orgs.map((org) => [org.id, org.current_user_role] as const)
      ),
    [orgs]
  );
  const canMutateActiveScope =
    isPlatformAdmin ||
    workScope.kind !== 'org' ||
    canMutateOrg(orgRoleById.get(workScope.orgId));
  const manageableOrgIds = new Set(
    orgs
      .filter((org) => canManageOrg(org.current_user_role))
      .map((org) => org.id)
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listWatchlist());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return deferEffect(() => {
      void load();
      void listCollections()
        .then(setAvailableCollections)
        .catch(() => {});
      void listRegistriesWithCapabilities()
        .then((response) => {
          setRegistries(response.data);
          setCapabilities(response.capabilities);
          const defaultReg = response.data.find((registry) => registry.is_default);
          if (defaultReg) setRegistryId((prev) => prev || defaultReg.id);
        })
        .catch(() => {});
    });
  }, [load, scopeKey]);

  const selectableRegistries = registries.filter(
    (registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy
  );
  const registryOptions = registries.filter(
    (registry) =>
      registry.scan_provider === 'artifactory_xray' ||
      capabilities.enable_trivy ||
      registry.id === registryId
  );
  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;
  const defaultRegistryId = registries.find((registry) => registry.is_default)?.id ?? '';

  function openCreate() {
    if (!canMutateActiveScope) return;
    setEditing(null);
    setImageName('');
    setImageTag('latest');
    setSchedule('0 2 * * *');
    setTimezone(getBrowserTimezone());
    setEnabled(true);
    setRegistryId(defaultRegistryId);
    setSelectedCollectionIds([]);
    setFormError('');
    modal.open();
  }
  function openEdit(item: WatchlistItem) {
    if (!canMutateItem(item)) return;
    setEditing(item);
    setImageName(item.image_name);
    setImageTag(item.image_tag);
    setSchedule(item.schedule ?? '0 2 * * *');
    setEnabled(item.enabled);
    setTimezone(item.timezone || getBrowserTimezone());
    setRegistryId(item.registry_id ?? '');
    setSelectedCollectionIds(item.collection_ids ?? []);
    setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    if (!canMutateActiveScope) return;
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (xrayOnlyWithoutRegistries) {
        setFormError('No Artifactory Xray registry is configured yet.');
        return;
      }
      const currentScope = getWorkScope();
      const data = {
        image_name: imageName,
        image_tag: imageTag,
        schedule,
        timezone,
        enabled,
        registry_id: registryId || null,
        collection_ids: selectedCollectionIds,
        ...(currentScope.kind === 'org' ? { org_id: currentScope.orgId } : {}),
      };
      if (editing) {
        await updateWatchlistItem(editing.id, data);
        toast.success('Watchlist item updated');
      } else {
        await createWatchlistItem(data);
        toast.success('Added to watchlist');
      }
      modal.close();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }
  async function handleDelete(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (item && !canMutateItem(item)) return;
    const ok = await confirm({
      title: 'Remove from watchlist?',
      message: 'This image will no longer be automatically scanned on a schedule.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteWatchlistItem(id).catch(() => {});
    toast.success('Removed from watchlist');
    load();
  }
  async function handleTrigger(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (item && !canMutateItem(item)) return;
    setTriggering(id);
    try {
      await triggerWatchlistScan(id);
      toast.success('Scan triggered');
    } catch {
      /* ignore */
    } finally {
      setTriggering('');
      load();
    }
  }

  function canMutateItem(item: WatchlistItem) {
    if (isPlatformAdmin) return true;
    if (item.owner_type === 'org' && item.owner_org_id) {
      return canMutateOrg(orgRoleById.get(item.owner_org_id));
    }
    return true;
  }

  function canManageAccess(item: WatchlistItem) {
    if (isPlatformAdmin) return true;
    if (item.owner_type === 'org' && item.owner_org_id) {
      return canManageOrg(orgRoleById.get(item.owner_org_id));
    }
    return true;
  }

  async function loadShares(itemId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listWatchlistShares(itemId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(item: WatchlistItem) {
    if (!canManageAccess(item)) return;
    setShareTarget(item);
    setShares([]);
    setShareOrgId('');
    setShareError('');
    shareModal.open();
    void loadShares(item.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId || !canManageAccess(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareWatchlistItem(shareTarget.id, shareOrgId);
      toast.success('Watchlist access granted');
      setShareOrgId('');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleRevokeShare(orgId: string) {
    if (!shareTarget || !canManageAccess(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unshareWatchlistItem(shareTarget.id, orgId);
      toast.success('Watchlist access revoked');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setShareSaving(false);
    }
  }

  const availableShareTargets = shareTarget
    ? orgs.filter(
        (org) =>
          (isPlatformAdmin || manageableOrgIds.has(org.id)) &&
          org.id !== shareTarget.owner_org_id &&
          !shares.some((share) => share.org_id === org.id)
      )
    : [];

  const schedulePreview = cronToHuman(schedule, { timezone, hourCycle });
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items
      .filter((item) => {
        const statusMatches =
          statusFilter === 'all' || (statusFilter === 'active' ? item.enabled : !item.enabled);
        if (!statusMatches) return false;
        const focusMatches =
          focusFilter === 'all' ||
          (focusFilter === 'attention' && item.enabled && watchlistNeedsPolicyAttention(item)) ||
          (focusFilter === 'stale' && isStaleWatchlistItem(item, postureNow)) ||
          (focusFilter === 'healthy' && isHealthyWatchlistItem(item, postureNow)) ||
          (focusFilter === 'never_scanned' && isNeverScannedItem(item));
        if (!focusMatches) return false;
        if (!query) return true;
        return [item.image_name, item.image_tag]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(query));
      })
      .sort((left, right) => {
        const rank = (item: WatchlistItem) => {
          const kind = getWatchlistPosture(item).kind;
          if (kind === 'blocked') return 0;
          if (kind === 'policy_failed') return 1;
          if (kind === 'scan_failed') return 2;
          if (kind === 'never_scanned') return 3;
          if (kind === 'running') return 4;
          return 5;
        };
        const rankDiff = rank(left) - rank(right);
        if (rankDiff !== 0) return rankDiff;
        return Date.parse(right.created_at) - Date.parse(left.created_at);
      });
  }, [focusFilter, items, postureNow, searchQuery, statusFilter]);
  const attentionItems = getWatchlistPolicyAttentionItems(items);
  const activeItems = items.filter((item) => item.enabled);
  const neverScannedCount = activeItems.filter((item) => !item.last_scan_id).length;
  const staleItems = activeItems.filter((item) => isStaleWatchlistItem(item, postureNow));
  const staleCount = staleItems.length;
  const healthyItems = activeItems.filter((item) => isHealthyWatchlistItem(item, postureNow));
  const overviewSummary = getWatchlistOverviewSummary({
    activeCount: activeItems.length,
    attentionCount: attentionItems.length,
    neverScannedCount,
    staleCount,
  });
  const actionQueueItems: WatchlistQueueEntry[] = [
    ...attentionItems.map((item) => {
      const posture = getWatchlistPosture(item);
      return {
        id: `attention-${item.id}`,
        image: `${item.image_name}:${item.image_tag}`,
        label: posture.label,
        description: posture.description,
        href: item.last_scan_id ? `/scans/${item.last_scan_id}` : buildWatchlistTriageHref(item.image_name),
        tone: posture.tone,
      };
    }),
    ...staleItems
      .filter((item) => !attentionItems.some((candidate) => candidate.id === item.id))
      .map((item) => ({
        id: `stale-${item.id}`,
        image: `${item.image_name}:${item.image_tag}`,
        label: 'Stale schedule',
        description: item.last_scanned_at
          ? `Last scan ${timeAgo(item.last_scanned_at, {
              hourCycle,
              timeZone: item.timezone,
            })}`
          : 'Scheduled item has no recent scan result.',
        href: buildWatchlistScansHref(item.image_name),
        tone: 'warning' as const,
      })),
    ...activeItems
      .filter((item) => isNeverScannedItem(item))
      .filter((item) => !attentionItems.some((candidate) => candidate.id === item.id))
      .map((item) => ({
        id: `never-${item.id}`,
        image: `${item.image_name}:${item.image_tag}`,
        label: 'Never scanned',
        description: 'No baseline scan result exists for this scheduled image yet.',
        href: buildWatchlistScansHref(item.image_name),
        tone: 'warning' as const,
      })),
  ].slice(0, 5);
  const focusCounts: Record<WatchlistFocus, number> = {
    all: items.length,
    attention: attentionItems.length,
    stale: staleItems.length,
    healthy: healthyItems.length,
    never_scanned: neverScannedCount,
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Watchlist"
        description="Recurring image monitoring, freshness tracking, and policy follow-up for your active workspace."
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <SegmentedControl
              ariaLabel="Hour format"
              options={[
                { id: 'locale', label: 'Locale' },
                { id: '12', label: '12h' },
                { id: '24', label: '24h' },
              ]}
              value={hourCycle}
              onChange={(next) => setHourCycle(next as HourCyclePreference)}
              size="sm"
            />
            <Link href={buildWatchlistTriageHref()}>
              <Button variant="secondary">Open Triage</Button>
            </Link>
            <Button
              onPress={openCreate}
              className="btn-primary inline-flex items-center gap-2"
              isDisabled={!canMutateActiveScope}
              variant="primary"
            >
              <PlusSignIcon size={15} /> Add Image
            </Button>
          </div>
        }
      />

      <WatchlistPostureSummary
        activeCount={activeItems.length}
        attentionCount={attentionItems.length}
        healthyCount={healthyItems.length}
        neverScannedCount={neverScannedCount}
        staleCount={staleCount}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <WatchlistNarrativeCard
          triageHref={buildWatchlistTriageHref()}
          summary={overviewSummary}
          activeCount={activeItems.length}
          onShowHealthy={() => setFocusFilter('healthy')}
        />
        <WatchlistActionQueue
          items={actionQueueItems}
          onShowAttention={() => setFocusFilter('attention')}
          onShowStale={() => setFocusFilter('stale')}
          onShowNeverScanned={() => setFocusFilter('never_scanned')}
        />
      </div>

      {error ? (
        <Alert status="danger" className="bg-danger-soft">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{error}</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchField name="watchlist-search" variant="secondary" className="w-full sm:max-w-sm">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search image or tag..."
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Select
            value={statusFilter}
            onChange={(value) =>
              setStatusFilter(
                value === 'disabled' ? 'disabled' : value === 'active' ? 'active' : 'all'
              )
            }
            className="w-full sm:w-[160px]"
            variant="secondary"
          >
            <Select.Trigger className={selectTriggerCls}>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all">All statuses</ListBox.Item>
                <ListBox.Item id="active">Active</ListBox.Item>
                <ListBox.Item id="disabled">Disabled</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all' as const, label: 'All' },
            { id: 'attention' as const, label: 'Attention' },
            { id: 'stale' as const, label: 'Stale' },
            { id: 'never_scanned' as const, label: 'Never scanned' },
            { id: 'healthy' as const, label: 'Healthy' },
          ].map((option) => (
            <Button
              key={option.id}
              variant={focusFilter === option.id ? 'secondary' : 'tertiary'}
              size="sm"
              onPress={() => setFocusFilter(option.id)}
            >
              {option.label}
              <Chip
                size="sm"
                variant="soft"
                color={focusFilter === option.id ? 'accent' : 'default'}
                className="ml-1 font-mono"
              >
                {focusCounts[option.id]}
              </Chip>
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="surface-panel rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Image
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Schedule
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Timezone
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Registry
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Last Scan State
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    Policy Posture
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 4 }).map((_, i) => (
                  <TableRowSkeleton key={i} cols={8} />
                ))}
              </tbody>
            </table>
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<EyeIcon size={28} />}
            title={
              items.length > 0 ? 'No watchlist items match your filters' : 'No images being watched'
            }
            description={
              items.length > 0
                ? 'Try a different search or status filter.'
                : focusFilter !== 'all'
                  ? 'Try a different focus view or clear the filters.'
                : 'Add a Docker image to auto-scan it on a recurring schedule and get notified when new vulnerabilities appear.'
            }
            action={
              items.length > 0
                ? {
                    label: 'Clear filters',
                    onClick: () => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setFocusFilter('all');
                    },
                  }
                : canMutateActiveScope
                  ? { label: '+ Add Image', onClick: openCreate }
                  : undefined
            }
          />
        ) : (
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Watchlist images" className="min-w-[1200px]">
                <Table.Header>
                  <Table.Column isRowHeader>Image</Table.Column>
                  <Table.Column>Schedule</Table.Column>
                  <Table.Column>Timezone</Table.Column>
                  <Table.Column>Registry</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column>Last Scan State</Table.Column>
                  <Table.Column>Policy Posture</Table.Column>
                  <Table.Column className="justify-end flex">Actions</Table.Column>
                </Table.Header>
                <Table.Body>
                  {filteredItems.map((item) => {
                    const reg = registries.find((r) => r.id === item.registry_id);
                    const posture = getWatchlistPosture(item);
                    const canMutate = canMutateItem(item);
                    const canManageItemAccess = canManageAccess(item);
                    const actions = [
                      ...(canMutate
                        ? [
                            {
                              id: 'scan-now',
                              label: triggering === item.id ? 'Scanning…' : 'Scan now',
                              icon:
                                triggering === item.id ? (
                                  <div className="size-3.5 border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-400 rounded-full animate-spin" />
                                ) : (
                                  <PlayIcon size={15} />
                                ),
                              disabled: triggering === item.id,
                              onAction: () => {
                                void handleTrigger(item.id);
                              },
                            },
                            {
                              id: 'edit',
                              label: 'Edit watchlist item',
                              icon: <PencilEdit01Icon size={15} />,
                              onAction: () => openEdit(item),
                            },
                          ]
                        : []),
                      ...(canManageItemAccess
                        ? [
                            {
                              id: 'share',
                              label: 'Manage access',
                              icon: <BiometricAccessIcon size={15} />,
                              onAction: () => openShareModal(item),
                            },
                          ]
                        : []),
                      ...(canMutate
                        ? [
                            {
                              id: 'delete',
                              label: 'Delete watchlist item',
                              icon: <Delete01Icon size={15} />,
                              variant: 'danger' as const,
                              onAction: () => {
                                void handleDelete(item.id);
                              },
                            },
                          ]
                        : []),
                    ];
                    return (
                      <Table.Row key={item.id} id={item.id} className="hover:bg-[var(--row-hover)]">
                        <Table.Cell>
                          <div className="space-y-1">
                            <p className="font-mono text-xs text-zinc-700 dark:text-zinc-200">
                              {item.image_name}:{item.image_tag}
                            </p>
                            <OwnershipBadge
                              ownerType={item.owner_type}
                              ownerOrgId={item.owner_org_id}
                              orgNamesById={orgNamesById}
                            />
                            <CollectionBadgeList
                              collections={item.collections ?? []}
                              emptyLabel="No collections"
                            />
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div
                            className="flex items-center gap-1.5 text-xs"
                            style={{ color: 'color-mix(in srgb, var(--accent) 80%, transparent)' }}
                            title={item.schedule}
                          >
                            <Clock01Icon
                              size={12}
                              color="rgba(113,113,122,0.7)"
                              className="shrink-0"
                            />
                            {cronToHuman(item.schedule ?? '', {
                              timezone: item.timezone,
                              hourCycle,
                            })}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-xs text-zinc-500 font-mono">
                            {item.timezone || 'UTC'}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-xs text-zinc-500">
                            {reg?.name ?? (
                              <span className="text-zinc-400 dark:text-zinc-700">-</span>
                            )}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span
                            className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                            style={
                              item.enabled
                                ? {
                                    color: '#34d399',
                                    background: 'rgba(16,185,129,0.12)',
                                    border: '1px solid rgba(16,185,129,0.22)',
                                  }
                                : {
                                    color: '#71717a',
                                    background: 'rgba(113,113,122,0.08)',
                                    border: '1px solid rgba(113,113,122,0.15)',
                                  }
                            }
                          >
                            <span
                              className={`size-1.5 rounded-full bg-current ${item.enabled ? 'animate-pulse' : ''}`}
                            />
                            {item.enabled ? 'Active' : 'Disabled'}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <LastScanState item={item} hourCycle={hourCycle} />
                        </Table.Cell>
                        <Table.Cell>
                          <PolicyPostureCell posture={posture} item={item} />
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex justify-end">
                            {actions.length > 0 ? (
                              <RowActionsMenu
                                label={`Open actions menu for ${item.image_name}:${item.image_tag}`}
                                items={actions}
                              />
                            ) : (
                              <span className="text-xs text-zinc-400">No actions</span>
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </Card>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="font-semibold">
                  {editing ? 'Edit Watchlist Item' : 'Add to Watchlist'}
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5">
                <form id="watchlist-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <Alert status="danger" className="bg-danger-soft">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{formError}</Alert.Title>
                      </Alert.Content>
                    </Alert>
                  )}
                  <div className="flex gap-3">
                    <FormField
                      label="Image Name"
                      placeholder="nginx"
                      value={imageName}
                      onChange={(e) => setImageName(e.target.value)}
                      required
                      className="bg-surface-secondary"
                      containerClassName="flex-1"
                    />
                    <FormField
                      label="Tag"
                      placeholder="latest"
                      value={imageTag}
                      onChange={(e) => setImageTag(e.target.value)}
                      required
                      className="bg-surface-secondary"
                      containerClassName="w-28"
                    />
                  </div>
                  <FormField
                    label="Schedule (cron)"
                    placeholder="0 2 * * *"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    required
                    className="bg-surface-secondary"
                    description="e.g. 0 2 * * * = daily at 2:00 in the selected timezone"
                  />
                  <p
                    className="text-xs font-medium"
                    style={{ color: 'color-mix(in srgb, var(--accent) 88%, transparent)' }}
                  >
                    Preview: {schedulePreview}
                  </p>
                  <div className="space-y-2">
                    <FormField
                      label="Timezone"
                      list="watchlist-timezone-options"
                      placeholder="Europe/Berlin"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      required
                      className="bg-surface-secondary"
                    />
                    <datalist id="watchlist-timezone-options">
                      {TIMEZONE_OPTIONS.map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                    </datalist>
                    <p className="text-xs text-zinc-500">
                      Use an IANA timezone like{' '}
                      <code className="text-zinc-400 dark:text-zinc-500">UTC</code>,{' '}
                      <code className="text-zinc-400 dark:text-zinc-500">Europe/Berlin</code>, or{' '}
                      <code className="text-zinc-400 dark:text-zinc-500">America/New_York</code>.
                    </p>
                  </div>
                  {registryOptions.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">
                        Registry{' '}
                        <span className="text-zinc-400 dark:text-zinc-600 font-normal">
                          (optional)
                        </span>
                      </label>
                      <Select
                        value={registryId || '__none__'}
                        onChange={(value) =>
                          setRegistryId(String(value === '__none__' ? '' : (value ?? '')))
                        }
                        className="pt-1"
                      >
                        <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Public / Docker Hub</ListBox.Item>
                            {registryOptions.map((r) => (
                              <ListBox.Item
                                key={r.id}
                                id={r.id}
                                isDisabled={
                                  !capabilities.enable_trivy &&
                                  r.scan_provider !== 'artifactory_xray' &&
                                  r.id !== registryId
                                }
                              >
                                {r.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      {xrayOnlyWithoutRegistries && (
                        <p className="text-xs" style={{ color: '#f59e0b' }}>
                          No Artifactory Xray registry is configured yet.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="space-y-2">
                    <div>
                      <Label className="text-sm font-medium">Collections</Label>
                      <p className="mt-1 text-xs text-zinc-500">
                        New scans created from this watchlist item will inherit these collections.
                      </p>
                    </div>
                    {availableCollections.length === 0 ? (
                      <p className="text-sm text-zinc-500">No collections available in this workspace yet.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {availableCollections.map((collection) => {
                          const isSelected = selectedCollectionIds.includes(collection.id);
                          return (
                            <label
                              key={collection.id}
                              className="flex items-center gap-3 rounded-xl border border-divider/70 bg-surface-secondary px-3 py-2"
                            >
                              <Checkbox
                                aria-label={`Assign ${collection.name}`}
                                isSelected={isSelected}
                                onChange={(selected) =>
                                  setSelectedCollectionIds((previous) =>
                                    selected
                                      ? [...previous, collection.id]
                                      : previous.filter((id) => id !== collection.id)
                                  )
                                }
                              >
                                <Checkbox.Control>
                                  <Checkbox.Indicator />
                                </Checkbox.Control>
                              </Checkbox>
                              <span className="text-sm text-zinc-800 dark:text-zinc-200">
                                {collection.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <Switch isSelected={enabled} onChange={setEnabled}>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Switch.Content>
                      <Label className="text-sm">Enabled</Label>
                    </Switch.Content>
                  </Switch>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={modal.close} variant="secondary">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="watchlist-form"
                  isDisabled={saving || xrayOnlyWithoutRegistries}
                  variant="primary"
                >
                  {saving && (
                    <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {editing ? 'Save' : 'Add'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="font-semibold">Manage Watchlist Access</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {shareError ? (
                  <Alert status="danger" className="bg-danger-soft">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>{shareError}</Alert.Title>
                    </Alert.Content>
                  </Alert>
                ) : null}
                {shareTarget ? (
                  <div className="bg-surface-secondary rounded-xl px-4 py-3">
                    <p className="font-mono text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {shareTarget.image_name}:{shareTarget.image_tag}
                    </p>
                    <div className="mt-2">
                      <OwnershipBadge
                        ownerType={shareTarget.owner_type}
                        ownerOrgId={shareTarget.owner_org_id}
                        orgNamesById={orgNamesById}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold">Current access</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Organizations listed here can trigger or manage this watchlist item.
                    </p>
                  </div>
                  {sharesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
                    </div>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div
                          key={share.org_id}
                          className="flex items-start justify-between gap-3 rounded-xl px-4 py-3 bg-surface-secondary"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{share.org_name}</p>
                            <p className="text-xs mt-0.5">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium">Locked</span>
                          ) : (
                            <Button
                              onPress={() => {
                                void handleRevokeShare(share.org_id);
                              }}
                              isDisabled={shareSaving}
                              isIconOnly
                              variant="danger-soft"
                            >
                              <Delete01Icon size={15} />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold">Grant access</h3>
                    <p className="text-xs mt-0.5">
                      Share this watchlist item with another organization you manage.
                    </p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex gap-2 items-center">
                      <Select
                        value={shareOrgId || '__none__'}
                        onChange={(value) =>
                          setShareOrgId(String(value === '__none__' ? '' : (value ?? '')))
                        }
                        className="flex-1"
                      >
                        <Select.Trigger className={selectTriggerCls + ' bg-surface-secondary'}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Select an organization</ListBox.Item>
                            {availableShareTargets.map((org) => (
                              <ListBox.Item key={org.id} id={org.id}>
                                {org.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button
                        onPress={() => {
                          void handleGrantShare();
                        }}
                        isDisabled={!shareOrgId || shareSaving}
                        variant="primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button
                  onPress={shareModal.close}
                  className="btn-secondary"
                  type="button"
                  variant="secondary"
                >
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
