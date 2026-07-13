'use client';
import { CollectionBadgeList } from '@/components/scans/collection-badge-list';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { ImageScansTable } from '@/components/scans/image-scans-table';
import {
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  RecentActivityRange,
  RecentActivityRow,
} from '@/components/scans/recent-activity';
import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RecentScanRowSkeleton } from '@/components/ui/skeleton';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useOrgNameMap } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  Collection,
  createCollection,
  cancelScan,
  deleteCollection,
  deleteScan,
  getTokenType,
  getUserDetails,
  ImageSummary,
  listCollections,
  listOrgMembers,
  listOrgs,
  Org,
  listScanImages,
  listScans,
  listTags,
  Scan,
  Tag,
  updateCollection,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canMutateOrg } from '@/lib/org-permissions';
import {
  Button,
  Card,
  Chip,
  Disclosure,
  Input,
  Label,
  ListBox,
  Modal,
  Pagination,
  Popover,
  SearchField,
  Select,
  Tabs,
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  FilterIcon,
  GitCompareIcon,
  PencilEdit01Icon,
  PlusSignIcon,
  Shield01Icon,
} from 'hugeicons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const inputCls = nativeFieldClassName;

const ACTIVE_SCAN_STATUS_FILTER =
  'pending,running,waiting_for_xray,warming_artifactory_cache,indexing,queued,importing';

const STATUS_FILTER_OPTIONS = [
  { id: '', label: 'All latest states' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked_by_xray_policy', label: 'Blocked by Xray Policy' },
  { id: 'pending', label: 'Pending' },
  { id: 'running', label: 'Running' },
  { id: 'waiting_for_xray', label: 'Waiting for Xray' },
  { id: 'warming_artifactory_cache', label: 'Warming Artifactory Cache' },
  { id: 'indexing', label: 'Indexing in Xray' },
  { id: 'queued', label: 'Queued in Xray' },
  { id: 'importing', label: 'Importing Findings' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;

const CRITICAL_FILTER_OPTIONS = [
  { id: '', label: 'Any critical count' },
  { id: 'yes', label: 'Has critical' },
  { id: 'no', label: 'No critical' },
] as const;

function splitImageReference(imageName: string) {
  const segments = imageName.split('/');
  const firstSegment = segments[0] ?? '';
  const hasRegistryHost =
    segments.length > 1 &&
    (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost');

  if (!hasRegistryHost) {
    return { registryHost: '', repositoryPath: imageName };
  }

  return { registryHost: firstSegment, repositoryPath: segments.slice(1).join('/') };
}

function ImageReferenceLabel({ imageName }: { imageName: string }) {
  const { registryHost, repositoryPath } = splitImageReference(imageName);

  return (
    <div className="min-w-0 max-w-full" title={imageName}>
      <span className="block font-mono text-sm font-medium leading-5 text-zinc-800 break-all dark:text-zinc-200">
        {repositoryPath}
      </span>
      {registryHost ? (
        <span className="mt-0.5 block font-mono text-[11px] leading-4 text-zinc-500 break-all dark:text-zinc-500">
          {registryHost}
        </span>
      ) : null}
    </div>
  );
}

function MobileSevStat({ label, count, tone }: { label: string; count: number; tone: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-center"
      style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: tone }}>
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {count || '—'}
      </p>
    </div>
  );
}

type ScansTimeRange = '' | RecentActivityRange;
type ScansGroupingMode = '' | 'collections';
type ScansView = 'images' | 'active' | 'recent';
type ScansViewState = {
  image: string;
  status: string;
  range: ScansTimeRange;
  tag: string;
  critical: '' | 'yes' | 'no';
  collection: string;
  group: ScansGroupingMode;
};

const DEFAULT_ACTIVITY_RANGE: RecentActivityRange = '24h';
const SCANS_VIEW_STORAGE_KEY_PREFIX = 'justscan:scans-view';

function normalizeScansTimeRange(
  value?: string | null,
  legacyView?: string | null
): ScansTimeRange {
  if (value === '6h' || value === '24h' || value === '7d' || value === '30d') {
    return value;
  }

  return legacyView === 'activity' ? DEFAULT_ACTIVITY_RANGE : '';
}

function normalizeCriticalFilter(value?: string | null): '' | 'yes' | 'no' {
  if (value === 'yes' || value === 'no') {
    return value;
  }

  return '';
}

function normalizeGroupingMode(value?: string | null): ScansGroupingMode {
  return value === 'collections' ? 'collections' : '';
}

function getScansView(status: string, range: ScansTimeRange): ScansView {
  if (range) return 'recent';
  return status === ACTIVE_SCAN_STATUS_FILTER ? 'active' : 'images';
}

function matchesStatusFilter(
  statusFilterValue: string,
  status: string,
  externalStatus?: string | null
): boolean {
  if (!statusFilterValue) return true;

  const expected = statusFilterValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (expected.length === 0) return true;

  return expected.some((candidate) => candidate === status || candidate === (externalStatus ?? ''));
}

function buildScansRoute({
  image,
  status,
  range,
  tag,
  critical,
  collection,
  group,
}: {
  image?: string;
  status?: string;
  range?: ScansTimeRange;
  tag?: string;
  critical?: '' | 'yes' | 'no';
  collection?: string;
  group?: ScansGroupingMode;
}) {
  const params = new URLSearchParams();

  if (image) params.set('image', image);
  if (status) params.set('status', status);
  if (range) params.set('range', range);
  if (tag) params.set('tag', tag);
  if (critical) params.set('critical', critical);
  if (collection) params.set('collection', collection);
  if (group) params.set('group', group);

  const query = params.toString();
  return query ? `/scans?${query}` : '/scans';
}

function readScansViewFromSearchParams(searchParams: {
  get(name: string): string | null;
}): ScansViewState {
  return {
    image: searchParams.get('image') ?? '',
    status: searchParams.get('status') ?? '',
    range: normalizeScansTimeRange(searchParams.get('range'), searchParams.get('view')),
    tag: searchParams.get('tag') ?? '',
    critical: normalizeCriticalFilter(searchParams.get('critical')),
    collection: searchParams.get('collection') ?? '',
    group: normalizeGroupingMode(searchParams.get('group')),
  };
}

function areScansViewStatesEqual(left: ScansViewState, right: ScansViewState) {
  return (
    left.image === right.image &&
    left.status === right.status &&
    left.range === right.range &&
    left.tag === right.tag &&
    left.critical === right.critical &&
    left.collection === right.collection &&
    left.group === right.group
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function ScansPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const orgNamesById = useOrgNameMap();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const savedViewStorageKey = `${SCANS_VIEW_STORAGE_KEY_PREFIX}:${scopeKey}`;
  const initialViewState = useMemo(
    () => readScansViewFromSearchParams(searchParams),
    [searchParams]
  );
  const searchParamsString = searchParams.toString();
  const didAttemptInitialRestoreRef = useRef(false);

  const [images, setImages] = useState<ImageSummary[]>([]);
  const [activityScans, setActivityScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [imageFilter, setImageFilter] = useState(initialViewState.image);
  const [appliedImageFilter, setAppliedImageFilter] = useState(initialViewState.image);
  const [statusFilter, setStatusFilter] = useState(initialViewState.status);
  const [activityRange, setActivityRange] = useState<ScansTimeRange>(initialViewState.range);
  const [tagFilter, setTagFilter] = useState(initialViewState.tag);
  const [collectionFilter, setCollectionFilter] = useState(initialViewState.collection);
  const [groupingMode, setGroupingMode] = useState<ScansGroupingMode>(initialViewState.group);
  const [criticalFilter, setCriticalFilter] = useState<'' | 'yes' | 'no'>(
    initialViewState.critical
  );
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which image rows are expanded; collection-grouped rows include their collection scope.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track refresh tokens per expanded image (incremented to force child reload after delete/cancel)
  const [childRefreshKey, setChildRefreshKey] = useState<Record<string, number>>({});

  // Multi-select state
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());

  // Available tags for bulk tagging
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [availableCollections, setAvailableCollections] = useState<Collection[]>([]);
  const [scanUsersById, setScanUsersById] = useState<Record<string, { displayName: string }>>({});
  const [scopedOrgPolicy, setScopedOrgPolicy] = useState<Org | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const collectionModal = useOverlayState();
  const [collectionName, setCollectionName] = useState('');
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [collectionSaving, setCollectionSaving] = useState(false);
  const isPlatformAdmin = getTokenType() === 'admin';
  const LIMIT = 30;
  const hasRecentWindow = activityRange !== '';
  const resolvedActivityRange = activityRange || DEFAULT_ACTIVITY_RANGE;

  const loadImages = useCallback(
    async (
      p: number,
      img: string,
      status: string,
      collection: string,
      options?: { silent?: boolean }
    ) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
        setError('');
      }
      try {
        const res = await listScanImages(
          p,
          LIMIT,
          img || undefined,
          status || undefined,
          collection || undefined
        );
        setImages(res.data ?? []);
        setTotal(res.total);
        if (silent) {
          setError('');
        }
      } catch (e: unknown) {
        if (!silent) {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    []
  );

  const loadActivity = useCallback(
    async (
      p: number,
      img: string,
      range: RecentActivityRange,
      collection: string,
      options?: { silent?: boolean }
    ) => {
      const silent = options?.silent ?? false;
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        const { from, to } = getRecentActivityBounds(range);
        const res = await listScans(
          p,
          LIMIT,
          img || undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          collection || undefined,
          from,
          to
        );
        setActivityScans(res.data ?? []);
        setTotal(res.total);
        if (silent) {
          setError('');
        }
      } catch (e: unknown) {
        if (!silent) {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    return deferEffect(() => {
      if (hasRecentWindow) {
        void loadActivity(page, appliedImageFilter, resolvedActivityRange, collectionFilter);
        return;
      }

      void loadImages(page, appliedImageFilter, statusFilter, collectionFilter);
    });
  }, [
    appliedImageFilter,
    collectionFilter,
    hasRecentWindow,
    loadActivity,
    loadImages,
    page,
    resolvedActivityRange,
    scopeKey,
    statusFilter,
  ]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  useEffect(() => {
    return deferEffect(() => {
      const nextViewState = readScansViewFromSearchParams(searchParams);
      const currentViewState: ScansViewState = {
        image: appliedImageFilter,
        status: statusFilter,
        range: activityRange,
        tag: tagFilter,
        critical: criticalFilter,
        collection: collectionFilter,
        group: groupingMode,
      };

      if (areScansViewStatesEqual(nextViewState, currentViewState)) {
        if (imageFilter !== nextViewState.image) {
          setImageFilter(nextViewState.image);
        }
        return;
      }

      clearPendingImageCommit();
      setImageFilter(nextViewState.image);
      setAppliedImageFilter(nextViewState.image);
      setStatusFilter(nextViewState.status);
      setActivityRange(nextViewState.range);
      setTagFilter(nextViewState.tag);
      setCollectionFilter(nextViewState.collection);
      setGroupingMode(nextViewState.group);
      setCriticalFilter(nextViewState.critical);
      setPage(1);
    });
  }, [
    activityRange,
    appliedImageFilter,
    collectionFilter,
    criticalFilter,
    groupingMode,
    imageFilter,
    searchParams,
    statusFilter,
    tagFilter,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (didAttemptInitialRestoreRef.current) return;

    didAttemptInitialRestoreRef.current = true;
    if (searchParamsString) return;

    const savedRoute = window.localStorage.getItem(savedViewStorageKey);
    if (!savedRoute || savedRoute === '/scans') return;

    router.replace(savedRoute);
  }, [router, savedViewStorageKey, searchParamsString]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.localStorage.setItem(
      savedViewStorageKey,
      buildScansRoute({
        image: appliedImageFilter,
        status: statusFilter,
        range: activityRange,
        tag: tagFilter,
        critical: criticalFilter,
        collection: collectionFilter,
        group: groupingMode,
      })
    );
  }, [
    activityRange,
    appliedImageFilter,
    collectionFilter,
    criticalFilter,
    groupingMode,
    savedViewStorageKey,
    statusFilter,
    tagFilter,
  ]);

  useEffect(() => {
    Promise.all([listTags().catch(() => []), listCollections().catch(() => [])])
      .then(([tags, collections]) => {
        setAvailableTags(tags);
        setAvailableCollections(collections);
      })
      .catch(() => {});
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;

    const loadScanUsers = async () => {
      const [currentUserResult, orgMembers] = await Promise.all([
        getUserDetails().catch(() => null),
        workScope.kind === 'org'
          ? listOrgMembers(workScope.orgId).catch(() => [])
          : Promise.resolve([]),
      ]);

      if (cancelled) return;

      const next: Record<string, { displayName: string }> = {};
      if (currentUserResult?.user?.id) {
        next[currentUserResult.user.id] = {
          displayName: currentUserResult.user.username || currentUserResult.user.email,
        };
      }

      orgMembers.forEach((member) => {
        if (!member.user_id) return;
        next[member.user_id] = {
          displayName: member.username || member.email || member.user_id,
        };
      });

      setScanUsersById(next);
    };

    void loadScanUsers();

    return () => {
      cancelled = true;
    };
  }, [scopeKey, workScope]);

  useEffect(() => {
    let cancelled = false;
    const loadScopedOrgPolicy = async () => {
      if (workScope.kind !== 'org') {
        await Promise.resolve();
        if (!cancelled) setScopedOrgPolicy(null);
        return;
      }
      listOrgs()
        .then((orgs) => {
          if (cancelled) return;
          setScopedOrgPolicy(orgs.find((org) => org.id === workScope.orgId) ?? null);
        })
        .catch(() => {
          if (cancelled) return;
          setScopedOrgPolicy(null);
        });
    };
    void loadScopedOrgPolicy();
    return () => {
      cancelled = true;
    };
  }, [scopeKey, workScope]);

  const canMutateCurrentScope =
    isPlatformAdmin ||
    workScope.kind !== 'org' ||
    !scopedOrgPolicy ||
    canMutateOrg(scopedOrgPolicy.current_user_role);
  function openCreatePage() {
    if (!canMutateCurrentScope) return;
    router.push('/scans/new');
  }

  // Preserve legacy deep-link behavior while moving creation to a dedicated route.
  useEffect(() => {
    return deferEffect(() => {
      if (searchParams.get('new') === '1') {
        router.replace('/scans/new');
      }
    });
  }, [router, searchParams]);

  const refreshCurrentView = useCallback(
    (options?: { silent?: boolean }) => {
      if (hasRecentWindow) {
        return loadActivity(
          page,
          appliedImageFilter,
          resolvedActivityRange,
          collectionFilter,
          options
        );
      }

      return loadImages(page, appliedImageFilter, statusFilter, collectionFilter, options);
    },
    [
      collectionFilter,
      appliedImageFilter,
      hasRecentWindow,
      loadActivity,
      loadImages,
      page,
      resolvedActivityRange,
      statusFilter,
    ]
  );

  useConditionalInterval(
    () => {
      void refreshCurrentView({ silent: true });
    },
    hasRecentWindow
      ? activityScans.some((scan) => scan.status === 'running' || scan.status === 'pending')
      : images.some(
          (image) => image.latest_status === 'running' || image.latest_status === 'pending'
        ),
    5000
  );

  function syncRoute(
    next: Partial<{
      image: string;
      status: string;
      range: ScansTimeRange;
      tag: string;
      critical: '' | 'yes' | 'no';
      collection: string;
      group: ScansGroupingMode;
    }>
  ) {
    router.replace(
      buildScansRoute({
        image: next.image ?? appliedImageFilter,
        status: next.status ?? statusFilter,
        range: next.range ?? activityRange,
        tag: next.tag ?? tagFilter,
        critical: next.critical ?? criticalFilter,
        collection: next.collection ?? collectionFilter,
        group: next.group ?? groupingMode,
      })
    );
  }

  function clearPendingImageCommit() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  function handleActivityRangeChange(nextRange: RecentActivityRange) {
    clearPendingImageCommit();
    setActivityRange(nextRange);
    setPage(1);
    syncRoute({ range: nextRange });
  }

  function handleViewChange(nextView: ScansView) {
    clearPendingImageCommit();

    if (nextView === 'images') {
      const nextStatus = statusFilter === ACTIVE_SCAN_STATUS_FILTER ? '' : statusFilter;
      setActivityRange('');
      setStatusFilter(nextStatus);
      setPage(1);
      syncRoute({ range: '', status: nextStatus });
      return;
    }

    if (nextView === 'active') {
      setActivityRange('');
      setStatusFilter(ACTIVE_SCAN_STATUS_FILTER);
      setPage(1);
      syncRoute({ range: '', status: ACTIVE_SCAN_STATUS_FILTER });
      return;
    }

    const nextRange = activityRange || DEFAULT_ACTIVITY_RANGE;
    const nextStatus = statusFilter === ACTIVE_SCAN_STATUS_FILTER ? '' : statusFilter;
    setActivityRange(nextRange);
    setStatusFilter(nextStatus);
    setGroupingMode('');
    setPage(1);
    syncRoute({ range: nextRange, status: nextStatus, group: '' });
  }

  function handleClearFilters() {
    clearPendingImageCommit();
    setImageFilter('');
    setAppliedImageFilter('');
    setStatusFilter('');
    setActivityRange('');
    setTagFilter('');
    setCollectionFilter('');
    setGroupingMode('');
    setCriticalFilter('');
    setPage(1);
    syncRoute({
      image: '',
      status: '',
      range: '',
      tag: '',
      critical: '',
      collection: '',
      group: '',
    });
  }

  function handleImageFilterChange(value: string) {
    setImageFilter(value);
    clearPendingImageCommit();
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setAppliedImageFilter(value);
      setPage(1);
      syncRoute({ image: value });
    }, 300);
  }

  function handleStatusFilterChange(value: string) {
    clearPendingImageCommit();
    setStatusFilter(value);
    setPage(1);
    syncRoute({ status: value });
  }

  function handleTagFilterChange(value: string) {
    clearPendingImageCommit();
    setTagFilter(value);
    setPage(1);
    syncRoute({ tag: value });
  }

  function handleCollectionFilterChange(value: string) {
    clearPendingImageCommit();
    setCollectionFilter(value);
    setPage(1);
    syncRoute({ collection: value });
  }

  function handleGroupingModeChange(value: ScansGroupingMode) {
    setGroupingMode(value);
    syncRoute({ group: value });
  }

  function handleCriticalFilterChange(value: '' | 'yes' | 'no') {
    clearPendingImageCommit();
    setCriticalFilter(value);
    setPage(1);
    syncRoute({ critical: value });
  }

  async function handleDelete(scanId: string, imageName: string) {
    if (!canMutateCurrentScope) return;
    const ok = await confirm({
      title: 'Delete scan?',
      message: 'This scan and all its vulnerability data will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteScan(scanId);
      toast.success('Scan deleted');
      setChildRefreshKey((prev) => ({ ...prev, [imageName]: (prev[imageName] ?? 0) + 1 }));
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function handleCancel(scanId: string, imageName: string) {
    if (!canMutateCurrentScope) return;
    const ok = await confirm({
      title: 'Cancel scan?',
      message: 'The scan will be stopped and marked as cancelled.',
      confirmLabel: 'Cancel scan',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await cancelScan(scanId);
      toast.success('Scan cancelled');
      setChildRefreshKey((prev) => ({ ...prev, [imageName]: (prev[imageName] ?? 0) + 1 }));
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    }
  }

  async function handleBulkDelete() {
    if (!canMutateCurrentScope) return;
    if (selectedScans.size === 0) return;
    const ok = await confirm({
      title: `Delete ${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''}?`,
      message: 'These scans and all their vulnerability data will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { bulkDeleteScans } = await import('@/lib/api');
      await bulkDeleteScans(Array.from(selectedScans));
      toast.success(`${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''} deleted`);
      setSelectedScans(new Set());
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete scans');
    }
  }

  async function handleBulkAddTag(tagId: string) {
    if (!canMutateCurrentScope) return;
    if (selectedScans.size === 0) return;
    try {
      const { bulkAddTagToScans } = await import('@/lib/api');
      await bulkAddTagToScans(tagId, Array.from(selectedScans));
      toast.success(
        `Tag added to ${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''}`
      );
      setSelectedScans(new Set());
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add tag');
    }
  }

  async function handleBulkAddCollection(collectionId: string) {
    if (!canMutateCurrentScope || selectedScans.size === 0) return;
    try {
      const { bulkAddCollectionToScans } = await import('@/lib/api');
      await bulkAddCollectionToScans(collectionId, Array.from(selectedScans));
      toast.success(
        `Collection added to ${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''}`
      );
      setSelectedScans(new Set());
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add collection');
    }
  }

  async function handleBulkRemoveCollection(collectionId: string) {
    if (!canMutateCurrentScope || selectedScans.size === 0) return;
    try {
      const { bulkRemoveCollectionFromScans } = await import('@/lib/api');
      await bulkRemoveCollectionFromScans(collectionId, Array.from(selectedScans));
      toast.success(
        `Collection removed from ${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''}`
      );
      setSelectedScans(new Set());
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove collection');
    }
  }

  function openCollectionModal(collection?: Collection) {
    setEditingCollection(collection ?? null);
    setCollectionName(collection?.name ?? '');
    collectionModal.open();
  }

  async function handleSaveCollection() {
    const trimmedName = collectionName.trim();
    if (!trimmedName) {
      toast.error('Collection name is required');
      return;
    }
    setCollectionSaving(true);
    try {
      if (editingCollection) {
        await updateCollection(editingCollection.id, trimmedName);
        toast.success('Collection updated');
      } else {
        await createCollection(trimmedName, workScope.kind === 'org' ? workScope.orgId : undefined);
        toast.success('Collection created');
      }
      const nextCollections = await listCollections();
      setAvailableCollections(nextCollections);
      collectionModal.close();
      setEditingCollection(null);
      setCollectionName('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save collection');
    } finally {
      setCollectionSaving(false);
    }
  }

  async function handleDeleteCollection(collection: Collection) {
    const ok = await confirm({
      title: `Delete ${collection.name}?`,
      message:
        'This removes the collection from scans and watchlist assignments in this workspace.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await deleteCollection(collection.id);
      toast.success('Collection deleted');
      const nextCollections = await listCollections();
      setAvailableCollections(nextCollections);
      if (collectionFilter === collection.id) {
        handleCollectionFilterChange('');
      } else {
        void refreshCurrentView();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete collection');
    }
  }

  function handleGenerateReport() {
    if (selectedScans.size === 0) return;
    const scanIds = Array.from(selectedScans).join(',');
    window.open(`/reports/print?scans=${scanIds}`, '_blank');
  }

  async function handleParentScanSelection(
    imageName: string,
    selected: boolean,
    latestScanId: string,
    visibleScanIds: string[]
  ) {
    let targetIds = visibleScanIds;

    // If child rows have not reported visible IDs yet, fetch only the first child page
    // so selection still maps to visible rows instead of selecting a hidden latest scan ID.
    if (targetIds.length === 0) {
      try {
        const res = await listScans(
          1,
          10,
          imageName,
          undefined,
          true,
          undefined,
          undefined,
          collectionFilter || undefined
        );
        targetIds = (res.data ?? []).map((scan) => scan.id);
      } catch {
        targetIds = [];
      }
    }

    if (targetIds.length === 0) {
      targetIds = [latestScanId];
    }

    setSelectedScans((previous) => {
      const next = new Set(previous);
      if (selected) {
        targetIds.forEach((id) => next.add(id));
      } else {
        targetIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  }

  const tagFilterOptions = useMemo(() => {
    const values = new Set<string>();

    images.forEach((image) => {
      if (image.latest_tag) values.add(image.latest_tag);
    });

    activityScans.forEach((scan) => {
      if (scan.image_tag) values.add(scan.image_tag);
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [activityScans, images]);

  const filteredActivityScans = useMemo(
    () =>
      activityScans.filter((scan) => {
        if (!matchesStatusFilter(statusFilter, scan.status, scan.external_status)) {
          return false;
        }

        if (tagFilter && scan.image_tag !== tagFilter) {
          return false;
        }

        if (criticalFilter === 'yes' && scan.critical_count <= 0) {
          return false;
        }

        if (criticalFilter === 'no' && scan.critical_count > 0) {
          return false;
        }

        return true;
      }),
    [activityScans, criticalFilter, statusFilter, tagFilter]
  );

  const filteredImages = useMemo(
    () =>
      images.filter((image) => {
        if (tagFilter && image.latest_tag !== tagFilter) {
          return false;
        }

        if (criticalFilter === 'yes' && image.critical_count <= 0) {
          return false;
        }

        if (criticalFilter === 'no' && image.critical_count > 0) {
          return false;
        }

        return true;
      }),
    [criticalFilter, images, tagFilter]
  );
  const selectedCollection = useMemo(
    () => availableCollections.find((collection) => collection.id === collectionFilter) ?? null,
    [availableCollections, collectionFilter]
  );
  const groupedImages = useMemo(() => {
    if (groupingMode !== 'collections') return [];

    const buckets = new Map<string, { key: string; label: string; images: ImageSummary[] }>();
    filteredImages.forEach((image) => {
      if (image.has_unassigned_scans || !image.collections || image.collections.length === 0) {
        const existing = buckets.get('__unassigned__') ?? {
          key: '__unassigned__',
          label: 'Unassigned',
          images: [],
        };
        existing.images.push(image);
        buckets.set(existing.key, existing);
      }

      image.collections?.forEach((collection) => {
        const existing = buckets.get(collection.id) ?? {
          key: collection.id,
          label: collection.name,
          images: [],
        };
        existing.images.push(image);
        buckets.set(existing.key, existing);
      });
    });

    return Array.from(buckets.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }, [filteredImages, groupingMode]);

  const visibleRows = hasRecentWindow ? filteredActivityScans.length : filteredImages.length;
  const hasClientSideFilters =
    Boolean(tagFilter) ||
    Boolean(collectionFilter) ||
    Boolean(criticalFilter) ||
    (hasRecentWindow && Boolean(statusFilter));
  const totalForDisplay = hasClientSideFilters ? visibleRows : total;
  const totalPages = hasClientSideFilters ? 1 : Math.max(1, Math.ceil(total / LIMIT));
  const activityRangeLabel =
    RECENT_ACTIVITY_RANGE_OPTIONS.find((option) => option.id === resolvedActivityRange)?.label ??
    'Last 24 hours';
  const hasActiveFilters =
    Boolean(imageFilter) ||
    Boolean(statusFilter) ||
    hasRecentWindow ||
    Boolean(tagFilter) ||
    Boolean(collectionFilter) ||
    Boolean(criticalFilter);
  const hasFilterBeyondView =
    Boolean(imageFilter) ||
    (Boolean(statusFilter) && statusFilter !== ACTIVE_SCAN_STATUS_FILTER) ||
    Boolean(tagFilter) ||
    Boolean(collectionFilter) ||
    Boolean(criticalFilter) ||
    Boolean(groupingMode);
  const scanView = getScansView(statusFilter, activityRange);
  const advancedFilterCount = [
    statusFilter && statusFilter !== ACTIVE_SCAN_STATUS_FILTER,
    tagFilter,
    collectionFilter,
    criticalFilter,
    groupingMode,
  ].filter(Boolean).length;
  const advancedFiltersActive = advancedFilterCount > 0;
  const headerDescription = hasRecentWindow
    ? totalForDisplay > 0
      ? `${totalForDisplay} scan event${totalForDisplay !== 1 ? 's' : ''} in ${activityRangeLabel.toLowerCase()}`
      : 'Chronological scan activity for the selected time window.'
    : totalForDisplay > 0
      ? `${totalForDisplay} image${totalForDisplay !== 1 ? 's' : ''}`
      : 'Search images, compare runs, and start new scans.';
  const visibleActivityImageCount = new Set(filteredActivityScans.map((scan) => scan.image_name))
    .size;
  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Scans"
        description={headerDescription}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onPress={() => {
                router.push('/scans/compare');
              }}
              variant="tertiary"
              className="flex flex-1 min-w-[130px] items-center justify-center gap-2 sm:flex-none"
            >
              <GitCompareIcon size={15} />
              Compare
            </Button>
            <Button
              onPress={openCreatePage}
              className="flex flex-1 min-w-[130px] items-center justify-center gap-2 sm:flex-none"
              isDisabled={!canMutateCurrentScope}
            >
              <PlusSignIcon size={15} />
              New Scan
            </Button>
          </div>
        }
      />

      <Card className="surface-panel rounded-2xl p-4">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              selectedKey={scanView}
              onSelectionChange={(key) => handleViewChange(String(key) as ScansView)}
              variant="secondary"
              className="[&_.tabs__list-container__scroll-next]:!hidden [&_.tabs__list-container__scroll-prev]:!hidden"
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="Scan views">
                  <Tabs.Tab className="whitespace-nowrap" id="images">
                    Images
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab className="whitespace-nowrap" id="active">
                    Active scans
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab className="whitespace-nowrap" id="recent">
                    Recent
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
              {(['images', 'active', 'recent'] as const).map((view) => (
                <Tabs.Panel key={view} className="hidden" id={view}>
                  <span className="sr-only">{view}</span>
                </Tabs.Panel>
              ))}
            </Tabs>
            <p className="text-sm text-muted">
              {totalForDisplay}{' '}
              {hasRecentWindow
                ? `scan event${totalForDisplay !== 1 ? 's' : ''}`
                : `image${totalForDisplay !== 1 ? 's' : ''}`}
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <SearchField
              aria-label="Search images"
              className="min-w-[220px] flex-1"
              value={imageFilter}
              onChange={handleImageFilterChange}
              variant="secondary"
            >
              <Label className="sr-only">Search images</Label>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder={
                    hasRecentWindow
                      ? 'Filter recent activity by image name…'
                      : 'Filter by image name…'
                  }
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            {scanView === 'recent' ? (
              <Select
                value={activityRange || DEFAULT_ACTIVITY_RANGE}
                onChange={(value) =>
                  handleActivityRangeChange(String(value) as RecentActivityRange)
                }
                variant="secondary"
              >
                <Label>Time range</Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {RECENT_ACTIVITY_RANGE_OPTIONS.map((option) => (
                      <ListBox.Item key={option.id} id={option.id}>
                        {option.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            ) : null}
          </div>

          <Disclosure
            isExpanded={advancedFiltersExpanded || advancedFiltersActive}
            onExpandedChange={setAdvancedFiltersExpanded}
            className="rounded-xl border border-surface-border bg-surface-secondary"
          >
            <Disclosure.Heading>
              <Disclosure.Trigger className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium text-foreground">
                <span className="flex items-center gap-2">
                  <FilterIcon size={15} />
                  Filters
                  {advancedFilterCount > 0 ? (
                    <Chip color="accent" size="sm" variant="soft">
                      {advancedFilterCount}
                    </Chip>
                  ) : null}
                </span>
                <Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="border-t border-surface-border p-3">
                <div className="flex flex-wrap items-end gap-3">
                  {scanView !== 'active' ? (
                    <Select
                      className="min-w-[200px] flex-1"
                      value={statusFilter || '__all__'}
                      onChange={(value) =>
                        handleStatusFilterChange(String(value === '__all__' ? '' : (value ?? '')))
                      }
                      variant="secondary"
                    >
                      <Label>{scanView === 'recent' ? 'Status' : 'Latest state'}</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__all__">All states</ListBox.Item>
                          {STATUS_FILTER_OPTIONS.filter((option) => option.id !== '').map(
                            (option) => (
                              <ListBox.Item key={option.id} id={option.id}>
                                {option.label}
                              </ListBox.Item>
                            )
                          )}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  ) : null}

                  <Select
                    className="min-w-[180px] flex-1"
                    value={tagFilter || '__all__'}
                    onChange={(value) =>
                      handleTagFilterChange(String(value === '__all__' ? '' : (value ?? '')))
                    }
                    variant="secondary"
                  >
                    <Label>Tag</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="__all__">All tags</ListBox.Item>
                        {tagFilterOptions.map((tagValue) => (
                          <ListBox.Item key={tagValue} id={tagValue}>
                            {tagValue}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  <Select
                    className="min-w-[200px] flex-1"
                    value={collectionFilter || '__all__'}
                    onChange={(value) =>
                      handleCollectionFilterChange(String(value === '__all__' ? '' : (value ?? '')))
                    }
                    variant="secondary"
                  >
                    <Label>Collection</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="__all__">All collections</ListBox.Item>
                        {availableCollections.map((collection) => (
                          <ListBox.Item key={collection.id} id={collection.id}>
                            {collection.name}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  <Select
                    className="min-w-[180px] flex-1"
                    value={criticalFilter || '__all__'}
                    onChange={(value) =>
                      handleCriticalFilterChange(
                        (value === '__all__' ? '' : (value ?? '')) as '' | 'yes' | 'no'
                      )
                    }
                    variant="secondary"
                  >
                    <Label>Critical findings</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {CRITICAL_FILTER_OPTIONS.map((option) => (
                          <ListBox.Item key={option.id || '__all__'} id={option.id || '__all__'}>
                            {option.label}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  {scanView !== 'recent' ? (
                    <Select
                      className="min-w-[180px] flex-1"
                      value={groupingMode || '__none__'}
                      onChange={(value) =>
                        handleGroupingModeChange(
                          (value === '__none__' ? '' : (value ?? '')) as ScansGroupingMode
                        )
                      }
                      variant="secondary"
                    >
                      <Label>Group by</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="__none__">No grouping</ListBox.Item>
                          <ListBox.Item id="collections">Collections</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button onPress={() => openCollectionModal()} variant="secondary">
                      Manage collections
                    </Button>
                    {hasActiveFilters ? (
                      <Button
                        className="inline-flex items-center gap-1.5"
                        onPress={handleClearFilters}
                        variant="secondary"
                      >
                        Clear filters
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        </div>
      </Card>

      {selectedCollection ? (
        <Card className="surface-panel rounded-2xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                Filtering by collection
              </p>
              <div className="mt-2">
                <CollectionBadgeList collections={[selectedCollection]} />
              </div>
            </div>
            <Button variant="secondary" onPress={() => handleCollectionFilterChange('')}>
              Show all collections
            </Button>
          </div>
        </Card>
      ) : null}

      {error ? <FormAlert description={error} title="Scan list failed to load" /> : null}

      {/* Bulk action toolbar */}
      {!hasRecentWindow && canMutateCurrentScope && selectedScans.size > 0 && (
        <Card className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {selectedScans.size} scan{selectedScans.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onPress={handleGenerateReport}
              className="flex flex-1 min-w-[110px] items-center justify-center gap-1.5 sm:flex-none"
              variant="secondary"
            >
              Generate Report
            </Button>
            <Popover>
              <Button variant="secondary">Add Tag</Button>
              <Popover.Content className="rounded-xl min-w-[160px]" placement="bottom end">
                <Popover.Dialog className="p-1">
                  {availableTags.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-500">No tags created yet</div>
                  ) : (
                    <ListBox
                      onAction={(key) => {
                        handleBulkAddTag(String(key));
                      }}
                    >
                      {availableTags.map((tag) => (
                        <ListBox.Item
                          key={tag.id}
                          id={tag.id}
                          className="px-3 py-1.5 text-sm rounded-lg cursor-pointer flex items-center gap-2"
                        >
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ background: tag.color }}
                          />
                          {tag.name}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  )}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <Popover>
              <Button variant="secondary">Add Collection</Button>
              <Popover.Content className="rounded-xl min-w-[180px]" placement="bottom end">
                <Popover.Dialog className="p-1">
                  {availableCollections.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-500">
                      No collections created yet
                    </div>
                  ) : (
                    <ListBox onAction={(key) => void handleBulkAddCollection(String(key))}>
                      {availableCollections.map((collection) => (
                        <ListBox.Item
                          key={collection.id}
                          id={collection.id}
                          className="px-3 py-1.5 text-sm rounded-lg cursor-pointer"
                        >
                          {collection.name}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  )}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <Popover>
              <Button variant="secondary">Remove Collection</Button>
              <Popover.Content className="rounded-xl min-w-[180px]" placement="bottom end">
                <Popover.Dialog className="p-1">
                  {availableCollections.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-500">
                      No collections created yet
                    </div>
                  ) : (
                    <ListBox onAction={(key) => void handleBulkRemoveCollection(String(key))}>
                      {availableCollections.map((collection) => (
                        <ListBox.Item
                          key={collection.id}
                          id={collection.id}
                          className="px-3 py-1.5 text-sm rounded-lg cursor-pointer"
                        >
                          {collection.name}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  )}
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
            <Button
              onPress={() => setSelectedScans(new Set())}
              className="flex-1 min-w-[90px] sm:flex-none"
              variant="secondary"
            >
              Clear
            </Button>
            <Button
              onPress={handleBulkDelete}
              className="flex-1 min-w-[90px] sm:flex-none"
              variant="danger-soft"
            >
              Delete
            </Button>
          </div>
        </Card>
      )}

      {hasRecentWindow ? (
        <Card className="surface-panel rounded-2xl overflow-hidden">
          <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Recent Activity
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Newest-first scan events for {activityRangeLabel.toLowerCase()}
              </p>
            </div>
            <p className="text-xs text-zinc-500">
              {totalForDisplay} scan event{totalForDisplay !== 1 ? 's' : ''}
              {filteredActivityScans.length > 0
                ? ` · ${visibleActivityImageCount} image${visibleActivityImageCount !== 1 ? 's' : ''} on this page`
                : ''}
            </p>
          </div>

          {loading ? (
            <div className="space-y-1.5 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <RecentScanRowSkeleton key={index} />
              ))}
            </div>
          ) : filteredActivityScans.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Shield01Icon size={28} />}
                title={
                  hasFilterBeyondView
                    ? 'No recent scans match your filters'
                    : 'No recent scans in this window'
                }
                description={
                  hasFilterBeyondView
                    ? 'Adjust or clear filters above to widen the results.'
                    : 'Choose a wider time window from the Recent view.'
                }
              />
            </div>
          ) : (
            <div className="space-y-1.5 p-3">
              {filteredActivityScans.map((scan) => (
                <RecentActivityRow key={scan.id} scan={scan} />
              ))}
            </div>
          )}
        </Card>
      ) : (
        <>
          {groupingMode === 'collections' ? (
            groupedImages.length === 0 && !loading ? (
              <ImageScansTable
                childRefreshKey={childRefreshKey}
                collectionFilter={collectionFilter}
                emptyState={
                  scanView === 'active'
                    ? {
                        title: 'No active scans',
                        description: 'Queued and running scans will appear here automatically.',
                      }
                    : undefined
                }
                expanded={expanded}
                hasActiveFilters={hasFilterBeyondView}
                images={filteredImages}
                loading={loading}
                onCancel={(scanId, imageName) => handleCancel(scanId, imageName)}
                onDelete={(scanId, imageName) => handleDelete(scanId, imageName)}
                onExpandedChange={setExpanded}
                allowMutationActions={canMutateCurrentScope}
                onSelectedScansChange={setSelectedScans}
                onSelectImageScans={(imageName, selected, latestScanId, visibleScanIds) =>
                  handleParentScanSelection(imageName, selected, latestScanId, visibleScanIds)
                }
                onSelectScan={(scanId, selected) => {
                  if (selected) {
                    setSelectedScans((previous) => new Set(previous).add(scanId));
                  } else {
                    setSelectedScans((previous) => {
                      const next = new Set(previous);
                      next.delete(scanId);
                      return next;
                    });
                  }
                }}
                scanUsersById={scanUsersById}
                selectedScans={selectedScans}
              />
            ) : (
              <div className="space-y-5">
                {groupedImages.map((group) => (
                  <Card key={group.key} className="surface-panel rounded-2xl p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {group.label}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {group.images.length} image{group.images.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <ImageScansTable
                      childRefreshKey={childRefreshKey}
                      collectionFilter={
                        collectionFilter ||
                        (group.key === '__unassigned__' ? '__none__' : group.key)
                      }
                      emptyState={
                        scanView === 'active'
                          ? {
                              title: 'No active scans',
                              description:
                                'Queued and running scans will appear here automatically.',
                            }
                          : undefined
                      }
                      expanded={expanded}
                      expansionScope={group.key}
                      hasActiveFilters={hasFilterBeyondView}
                      images={group.images}
                      loading={loading}
                      onCancel={(scanId, imageName) => handleCancel(scanId, imageName)}
                      onDelete={(scanId, imageName) => handleDelete(scanId, imageName)}
                      onExpandedChange={setExpanded}
                      allowMutationActions={canMutateCurrentScope}
                      onSelectedScansChange={setSelectedScans}
                      onSelectImageScans={(imageName, selected, latestScanId, visibleScanIds) =>
                        handleParentScanSelection(imageName, selected, latestScanId, visibleScanIds)
                      }
                      onSelectScan={(scanId, selected) => {
                        if (selected) {
                          setSelectedScans((previous) => new Set(previous).add(scanId));
                        } else {
                          setSelectedScans((previous) => {
                            const next = new Set(previous);
                            next.delete(scanId);
                            return next;
                          });
                        }
                      }}
                      scanUsersById={scanUsersById}
                      selectedScans={selectedScans}
                    />
                  </Card>
                ))}
              </div>
            )
          ) : (
            <ImageScansTable
              childRefreshKey={childRefreshKey}
              collectionFilter={collectionFilter}
              emptyState={
                scanView === 'active'
                  ? {
                      title: 'No active scans',
                      description: 'Queued and running scans will appear here automatically.',
                    }
                  : undefined
              }
              expanded={expanded}
              hasActiveFilters={hasFilterBeyondView}
              images={filteredImages}
              loading={loading}
              onCancel={(scanId, imageName) => handleCancel(scanId, imageName)}
              onDelete={(scanId, imageName) => handleDelete(scanId, imageName)}
              onExpandedChange={setExpanded}
              allowMutationActions={canMutateCurrentScope}
              onSelectedScansChange={setSelectedScans}
              onSelectImageScans={(imageName, selected, latestScanId, visibleScanIds) =>
                handleParentScanSelection(imageName, selected, latestScanId, visibleScanIds)
              }
              onSelectScan={(scanId, selected) => {
                if (selected) {
                  setSelectedScans((previous) => new Set(previous).add(scanId));
                } else {
                  setSelectedScans((previous) => {
                    const next = new Set(previous);
                    next.delete(scanId);
                    return next;
                  });
                }
              }}
              scanUsersById={scanUsersById}
              selectedScans={selectedScans}
            />
          )}
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <>
          <Pagination className="justify-center">
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous isDisabled={page === 1} onPress={() => setPage((p) => p - 1)}>
                  <Pagination.PreviousIcon />
                  <span>Previous</span>
                </Pagination.Previous>
              </Pagination.Item>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Pagination.Item key={p}>
                  <Pagination.Link isActive={p === page} onPress={() => setPage(p)}>
                    {p}
                  </Pagination.Link>
                </Pagination.Item>
              ))}
              <Pagination.Item>
                <Pagination.Next
                  isDisabled={page === totalPages}
                  onPress={() => setPage((p) => p + 1)}
                >
                  <span>Next</span>
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
        </>
      )}
      <Modal state={collectionModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="font-semibold">
                  {editingCollection ? 'Edit Collection' : 'Manage Collections'}
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="space-y-5 py-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {editingCollection ? 'Rename collection' : 'Create collection'}
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      className={inputCls}
                      placeholder="Production"
                      value={collectionName}
                      onChange={(event) => setCollectionName(event.target.value)}
                    />
                    <Button isDisabled={collectionSaving} onPress={handleSaveCollection}>
                      {editingCollection ? 'Save' : 'Create'}
                    </Button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Collections are scoped to the current workspace and can be assigned to multiple
                    scans.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Existing collections
                    </p>
                    {editingCollection ? (
                      <Button
                        variant="secondary"
                        onPress={() => {
                          setEditingCollection(null);
                          setCollectionName('');
                        }}
                      >
                        Cancel edit
                      </Button>
                    ) : null}
                  </div>
                  {availableCollections.length === 0 ? (
                    <p className="text-sm text-zinc-500">No collections in this workspace yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {availableCollections.map((collection) => (
                        <Card
                          key={collection.id}
                          className="rounded-xl border border-divider/70 px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-900 dark:text-white">
                                {collection.name}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {collection.owner_type === 'org'
                                  ? 'Organization collection'
                                  : 'Personal collection'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                isIconOnly
                                variant="secondary"
                                aria-label={`Edit ${collection.name}`}
                                onPress={() => openCollectionModal(collection)}
                              >
                                <PencilEdit01Icon size={14} />
                              </Button>
                              <Button
                                isIconOnly
                                variant="danger-soft"
                                aria-label={`Delete ${collection.name}`}
                                onPress={() => void handleDeleteCollection(collection)}
                              >
                                <Delete01Icon size={14} />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
