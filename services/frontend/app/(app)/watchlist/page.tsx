'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { OwnershipTransfer } from '@/components/ownership-transfer';
import { useToast } from '@/components/toast';
import { OwnershipBadge, StatusBadge } from '@/components/ui/badges';
import { IntelligenceSummaryChip } from '@/components/vulnerability-intelligence-status';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { StatusAlert } from '@/components/ui/form-alert';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import {
  filterDisclosureBodyClassName,
  FilterDisclosureTrigger,
} from '@/components/ui/filter-toolbar';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createWatchlistItem,
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
  transferWatchlistItemOwnership,
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
  watchlistNeedsIntelligenceConfirmation,
  watchlistNeedsPolicyAttention,
  type WatchlistPosture,
} from '@/lib/watchlist-posture';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Disclosure,
  Dropdown,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Spinner,
  Switch,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  BiometricAccessIcon,
  Clock01Icon,
  Delete01Icon,
  EyeIcon,
  PencilEdit01Icon,
  PlayIcon,
  PlusSignIcon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
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

type WatchlistFocus = 'all' | 'attention' | 'intelligence' | 'stale' | 'healthy' | 'never_scanned';

function parseWatchlistFocus(value: string | null): WatchlistFocus {
  switch (value) {
    case 'attention':
    case 'intelligence':
    case 'stale':
    case 'healthy':
    case 'never_scanned':
      return value;
    default:
      return 'all';
  }
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
  intelligencePendingCount,
  neverScannedCount,
  staleCount,
}: {
  activeCount: number;
  attentionCount: number;
  intelligencePendingCount: number;
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
    if (intelligencePendingCount > 0) {
      return {
        label: 'Confirmation pending',
        title: 'CVE intelligence changed on the watchlist',
        description:
          'The stored policy result is preserved until the next scheduled scan confirms the current CVE state. Use Scan now for an immediate confirmation.',
        tone: 'warning',
      };
    }
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
      description: 'Some scheduled items are stale or still missing a baseline scan result.',
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
      href={`/scans/details/${item.last_scan_id}`}
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
  const criticalCount = item.last_scan?.critical_count ?? 0;
  const highCount = item.last_scan?.high_count ?? 0;
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
      {posture.kind !== 'intelligence_pending' ? (
        <IntelligenceSummaryChip compact summary={item.intelligence_summary} />
      ) : null}
      {criticalCount > 0 || highCount > 0 ? (
        <Chip color="default" variant="soft" size="sm">
          {criticalCount} critical · {highCount} high
        </Chip>
      ) : null}
    </div>
  );
}

export default function WatchlistPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
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
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [triggering, setTriggering] = useState('');
  const [shareTarget, setShareTarget] = useState<WatchlistItem | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [transferOrgId, setTransferOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const focusFilter = parseWatchlistFocus(searchParams.get('focus'));
  const [showFilters, setShowFilters] = useState(false);
  const [postureNow] = useState(() => Date.now());
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const isPlatformAdmin = getTokenType() === 'admin';
  const orgRoleById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.current_user_role] as const)),
    [orgs]
  );
  const canMutateActiveScope =
    isPlatformAdmin || workScope.kind !== 'org' || canMutateOrg(orgRoleById.get(workScope.orgId));
  const manageableOrgIds = new Set(
    orgs.filter((org) => canManageOrg(org.current_user_role)).map((org) => org.id)
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

  const updateFocusFilter = useCallback(
    (focus: WatchlistFocus) => {
      const params = new URLSearchParams(searchParams.toString());
      if (focus === 'all') {
        params.delete('focus');
      } else {
        params.set('focus', focus);
      }
      router.replace(params.size ? `/watchlist?${params.toString()}` : '/watchlist', {
        scroll: false,
      });
    },
    [router, searchParams]
  );

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
    setTransferOrgId('');
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

  async function handleTransferOwnership() {
    if (
      !shareTarget ||
      !transferOrgId ||
      shareTarget.owner_type !== 'org' ||
      !canManageAccess(shareTarget)
    )
      return;
    const destination =
      orgs.find((org) => org.id === transferOrgId)?.name ?? 'the selected organization';
    const ok = await confirm({
      title: `Transfer watchlist ownership to ${destination}?`,
      message: 'The current owner will retain shared access.',
      confirmLabel: 'Transfer',
      variant: 'danger',
    });
    if (!ok) return;
    setShareSaving(true);
    setShareError('');
    try {
      await transferWatchlistItemOwnership(shareTarget.id, transferOrgId);
      toast.success('Watchlist ownership transferred');
      shareModal.close();
      await load();
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to transfer ownership');
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
  const transferTargets =
    shareTarget?.owner_type === 'org'
      ? orgs.filter(
          (org) =>
            (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id
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
          (focusFilter === 'intelligence' && watchlistNeedsIntelligenceConfirmation(item)) ||
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
          if (kind === 'intelligence_pending') return 3;
          if (kind === 'never_scanned') return 4;
          if (kind === 'running') return 5;
          return 6;
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
  const intelligencePendingItems = activeItems.filter(watchlistNeedsIntelligenceConfirmation);
  const healthyItems = activeItems.filter((item) => isHealthyWatchlistItem(item, postureNow));
  const overviewSummary = getWatchlistOverviewSummary({
    activeCount: activeItems.length,
    attentionCount: attentionItems.length,
    intelligencePendingCount: intelligencePendingItems.length,
    neverScannedCount,
    staleCount,
  });
  const focusCounts: Record<WatchlistFocus, number> = {
    all: items.length,
    attention: attentionItems.length,
    intelligence: intelligencePendingItems.length,
    stale: staleItems.length,
    healthy: healthyItems.length,
    never_scanned: neverScannedCount,
  };
  const hasFilters =
    searchQuery.trim().length > 0 || statusFilter !== 'all' || focusFilter !== 'all';

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Watchlist"
        description="Recurring image monitoring, freshness tracking, and policy follow-up for your active workspace."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown>
              <Button variant="secondary">View settings</Button>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label="Watchlist view settings"
                  selectionMode="single"
                  selectedKeys={new Set([hourCycle])}
                  onAction={(key) => setHourCycle(String(key) as HourCyclePreference)}
                >
                  <Dropdown.Section>
                    <Label>Hour format</Label>
                    <Dropdown.Item id="locale" textValue="Locale">
                      <Label>Locale</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                    <Dropdown.Item id="12" textValue="12-hour clock">
                      <Label>12-hour clock</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                    <Dropdown.Item id="24" textValue="24-hour clock">
                      <Label>24-hour clock</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  </Dropdown.Section>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            <Button
              onPress={openCreate}
              className="inline-flex items-center gap-2"
              isDisabled={!canMutateActiveScope}
              variant="primary"
            >
              <PlusSignIcon size={15} /> Add Image
            </Button>
          </div>
        }
      />

      {items.length > 0 ? (
        <StatusAlert
          status={overviewSummary.tone === 'neutral' ? 'default' : overviewSummary.tone}
          title={overviewSummary.title}
          description={overviewSummary.description}
        />
      ) : null}

      {error ? (
        <StatusAlert status="danger" title="Watchlist failed to load" description={error} />
      ) : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={<EyeIcon size={28} />}
          title="No images being watched"
          description="Add a Docker image to scan it on a recurring schedule and receive follow-up when its posture changes."
          action={canMutateActiveScope ? { label: 'Add Image', onClick: openCreate } : undefined}
        />
      ) : (
        <>
          <Card className="p-3">
            <Disclosure
              isExpanded={showFilters}
              onExpandedChange={setShowFilters}
              className="contents"
            >
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <SearchField name="watchlist-search" variant="secondary" className="min-w-0 flex-1">
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
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label="Watchlist focus"
                    value={focusFilter}
                    onChange={(value) =>
                      updateFocusFilter(parseWatchlistFocus(String(value ?? 'all')))
                    }
                    variant="secondary"
                    className="min-w-[180px]"
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {[
                          { id: 'all', label: 'All' },
                          { id: 'attention', label: 'Attention' },
                          { id: 'intelligence', label: 'CVE confirmation' },
                          { id: 'stale', label: 'Stale' },
                          { id: 'never_scanned', label: 'Never scanned' },
                          { id: 'healthy', label: 'Healthy' },
                        ].map((option) => (
                          <ListBox.Item key={option.id} id={option.id}>
                            {option.label} ({focusCounts[option.id as WatchlistFocus]})
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <FilterDisclosureTrigger activeCount={statusFilter === 'all' ? 0 : 1} />
                  {hasFilters ? (
                    <Button
                      variant="tertiary"
                      onPress={() => {
                        setSearchQuery('');
                        setStatusFilter('all');
                        updateFocusFilter('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              </div>
              <Disclosure.Content>
                <Disclosure.Body className="mt-2 grid grid-cols-1 gap-2 border-t border-divider pt-2 sm:grid-cols-[minmax(0,14rem)]">
                  <Select
                    aria-label="Watchlist status"
                    value={statusFilter}
                    onChange={(value) =>
                      setStatusFilter(
                        value === 'disabled' ? 'disabled' : value === 'active' ? 'active' : 'all'
                      )
                    }
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
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          </Card>

          <Card className="overflow-hidden">
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Watchlist images" className="min-w-[900px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Image</Table.Column>
                    <Table.Column>Schedule</Table.Column>
                    <Table.Column>Latest scan</Table.Column>
                    <Table.Column>Coverage</Table.Column>
                    <Table.Column className="flex justify-end">Actions</Table.Column>
                  </Table.Header>
                  <Table.Body
                    items={loading ? [] : filteredItems}
                    renderEmptyState={() =>
                      loading ? (
                        <div className="flex min-h-48 items-center justify-center">
                          <Spinner color="accent" size="sm" />
                        </div>
                      ) : (
                        <EmptyState
                          icon={<EyeIcon size={24} />}
                          title="No watchlist items match your filters"
                          description="Try a different search or clear the current filters."
                          action={{
                            label: 'Clear filters',
                            onClick: () => {
                              setSearchQuery('');
                              setStatusFilter('all');
                              updateFocusFilter('all');
                            },
                          }}
                        />
                      )
                    }
                  >
                    {(item) => {
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
                                    <Spinner color="accent" size="sm" />
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
                        <Table.Row
                          key={item.id}
                          id={item.id}
                          className="hover:bg-[var(--row-hover)]"
                        >
                          <Table.Cell>
                            <div className="space-y-1.5">
                              <p className="font-mono text-xs text-zinc-700 dark:text-zinc-200">
                                {item.image_name}:{item.image_tag}
                              </p>
                              <p className="text-xs text-muted">
                                {reg?.name ?? 'Direct image source'}
                              </p>
                              <OwnershipBadge
                                ownerType={item.owner_type}
                                ownerOrgId={item.owner_org_id}
                                orgNamesById={orgNamesById}
                              />
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <div className="space-y-1.5" title={item.schedule}>
                              <div className="flex items-center gap-1.5 text-xs text-accent">
                                <Clock01Icon size={12} className="shrink-0" />
                                {cronToHuman(item.schedule ?? '', {
                                  timezone: item.timezone,
                                  hourCycle,
                                })}
                              </div>
                              <p className="font-mono text-xs text-muted">
                                {item.timezone || 'UTC'}
                              </p>
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <LastScanState item={item} hourCycle={hourCycle} />
                          </Table.Cell>
                          <Table.Cell>
                            <div className="space-y-2">
                              <Chip
                                color={item.enabled ? 'success' : 'default'}
                                size="sm"
                                variant="soft"
                              >
                                {item.enabled ? 'Scheduled' : 'Paused'}
                              </Chip>
                              <PolicyPostureCell posture={posture} item={item} />
                            </div>
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
                    }}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>
        </>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="overflow-hidden">
              <Modal.Header>
                <div className="flex min-w-0 items-center gap-3">
                  <Modal.Icon
                    className={editing ? 'bg-default text-foreground' : 'bg-accent/10 text-accent'}
                  >
                    {editing ? <PencilEdit01Icon size={18} /> : <PlusSignIcon size={18} />}
                  </Modal.Icon>
                  <Modal.Heading className="font-semibold">
                    {editing ? 'Edit Watchlist Item' : 'Add to Watchlist'}
                  </Modal.Heading>
                </div>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5">
                <form id="watchlist-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError ? (
                    <StatusAlert
                      status="danger"
                      title="Watchlist item could not be saved"
                      description={formError}
                    />
                  ) : null}
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
                  <Switch isSelected={enabled} onChange={setEnabled}>
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <span className="text-sm">Enabled</span>
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
                <div className="flex min-w-0 items-center gap-3">
                  <Modal.Icon className="bg-default text-foreground">
                    <BiometricAccessIcon size={18} />
                  </Modal.Icon>
                  <Modal.Heading className="font-semibold">Manage Watchlist Access</Modal.Heading>
                </div>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {shareError ? (
                  <StatusAlert
                    status="danger"
                    title="Access update failed"
                    description={shareError}
                  />
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
                <OwnershipTransfer
                  ownerOrgId={shareTarget?.owner_type === 'org' ? shareTarget.owner_org_id : null}
                  organizations={transferTargets}
                  selectedOrgId={transferOrgId}
                  onSelectedOrgIdChange={setTransferOrgId}
                  onTransfer={() => void handleTransferOwnership()}
                  isSaving={shareSaving}
                  warning="The current owner will retain shared access after transfer."
                />
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
