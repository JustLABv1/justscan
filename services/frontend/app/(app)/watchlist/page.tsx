'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { OwnershipTransfer } from '@/components/ownership-transfer';
import { CollectionBadgeList } from '@/components/scans/collection-badge-list';
import { useToast } from '@/components/toast';
import { OwnershipBadge, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  Collection,
  createWatchlistItem,
  deleteWatchlistItem,
  getDefaultScannerCapabilities,
  getTokenType,
  getWorkScope,
  listCollections,
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
  Tabs,
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
  const [transferOrgId, setTransferOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [focusFilter, setFocusFilter] = useState<WatchlistFocus>('all');
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
      message:
        'The current owner will retain shared access. Collection assignments will be removed because collections are organization-scoped.',
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
  const focusCounts: Record<WatchlistFocus, number> = {
    all: items.length,
    attention: attentionItems.length,
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
          items.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {attentionItems.length > 0 ? (
                <Link href={buildWatchlistTriageHref()}>
                  <Button variant="secondary">Review triage</Button>
                </Link>
              ) : null}
              <Dropdown>
                <Dropdown.Trigger>
                  <Button variant="secondary">View settings</Button>
                </Dropdown.Trigger>
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
          ) : undefined
        }
      />

      {items.length > 0 ? (
        <Card>
          <Card.Content className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Chip color={postureChipColor[overviewSummary.tone]} size="sm" variant="soft">
                {overviewSummary.label}
              </Chip>
              <h2 className="mt-2 text-sm font-semibold text-foreground">
                {overviewSummary.title}
              </h2>
              <p className="mt-1 text-sm text-muted">{overviewSummary.description}</p>
            </div>
          </Card.Content>
        </Card>
      ) : null}

      {error ? (
        <Alert status="danger" className="bg-danger-soft">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{error}</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : null}

      {!loading && items.length === 0 ? (
        <EmptyState
          icon={<EyeIcon size={28} />}
          title="No images being watched"
          description="Add a Docker image to scan it on a recurring schedule and receive follow-up when its posture changes."
          action={canMutateActiveScope ? { label: 'Add Image', onClick: openCreate } : undefined}
        />
      ) : (
        <Card className="overflow-hidden">
          <Card.Content className="gap-4 border-b border-divider py-4">
            <Tabs
              variant="secondary"
              selectedKey={focusFilter}
              onSelectionChange={(key) => setFocusFilter(String(key) as WatchlistFocus)}
            >
              <Tabs.ListContainer className="overflow-x-auto">
                <Tabs.List aria-label="Watchlist focus" className="min-w-max gap-1">
                  {[
                    { id: 'all' as const, label: 'All' },
                    { id: 'attention' as const, label: 'Attention' },
                    { id: 'stale' as const, label: 'Stale' },
                    { id: 'never_scanned' as const, label: 'Never scanned' },
                    { id: 'healthy' as const, label: 'Healthy' },
                  ].map((option) => (
                    <Tabs.Tab key={option.id} id={option.id}>
                      {option.label}
                      <Chip size="sm" variant="soft" className="ml-1 font-mono">
                        {focusCounts[option.id]}
                      </Chip>
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>

            <Disclosure
              isExpanded={showFilters}
              onExpandedChange={setShowFilters}
              className="contents"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <SearchField
                  name="watchlist-search"
                  variant="secondary"
                  className="w-full sm:max-w-sm"
                >
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
                <div className="flex items-center gap-2">
                  <Disclosure.Heading>
                    <Disclosure.Trigger className="inline-flex h-10 items-center gap-2 rounded-xl border border-divider bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                      Filters
                      {statusFilter !== 'all' ? (
                        <Chip size="sm" variant="soft" color="accent">
                          1
                        </Chip>
                      ) : null}
                      <Disclosure.Indicator />
                    </Disclosure.Trigger>
                  </Disclosure.Heading>
                  {hasFilters ? (
                    <Button
                      variant="tertiary"
                      onPress={() => {
                        setSearchQuery('');
                        setStatusFilter('all');
                        setFocusFilter('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : null}
                </div>
              </div>
              <Disclosure.Content>
                <Disclosure.Body className="mt-3 grid gap-3 rounded-xl border border-divider bg-surface-secondary p-3 sm:max-w-xs">
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
          </Card.Content>

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
                            setFocusFilter('all');
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
                      <Table.Row key={item.id} id={item.id} className="hover:bg-[var(--row-hover)]">
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
                            <CollectionBadgeList
                              collections={item.collections ?? []}
                              emptyLabel="No collections"
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
                            <p className="font-mono text-xs text-muted">{item.timezone || 'UTC'}</p>
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
                      <p className="text-sm text-zinc-500">
                        No collections available in this workspace yet.
                      </p>
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
                                <Checkbox.Content>
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                </Checkbox.Content>
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
                <OwnershipTransfer
                  ownerOrgId={shareTarget?.owner_type === 'org' ? shareTarget.owner_org_id : null}
                  organizations={transferTargets}
                  selectedOrgId={transferOrgId}
                  onSelectedOrgIdChange={setTransferOrgId}
                  onTransfer={() => void handleTransferOwnership()}
                  isSaving={shareSaving}
                  warning="Collection assignments will be removed during transfer."
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
