'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { ImageChildren } from '@/components/scans/image-children';
import { getRecentActivityBounds, RECENT_ACTIVITY_RANGE_OPTIONS, RecentActivityRange, RecentActivityRangePicker, RecentActivityRow } from '@/components/scans/recent-activity';
import { useToast } from '@/components/toast';
import { OwnershipBadge, SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName, joinClassNames, nativeFieldClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { ImageRowSkeleton, RecentScanRowSkeleton } from '@/components/ui/skeleton';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useOrgNameMap } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
    ArtifactoryRepository,
    cancelScan,
    createScans,
    deleteScan,
    getDefaultScannerCapabilities,
    getWorkScope,
    ImageSummary,
    listArtifactoryRepositories,
    listRegistriesWithCapabilities,
    listScanImages,
    listScans,
    listTags,
    RegistryWithHealth,
    Scan,
    ScannerCapabilities,
    Tag
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Autocomplete, Checkbox, ListBox, Modal, Popover, SearchField, Select, useFilter, useOverlayState } from '@heroui/react';
import {
    ArrowDown01Icon,
    ArrowRight01Icon,
    Cancel01Icon,
    FilterIcon,
    GitCompareIcon,
    PlusSignIcon,
    Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Key } from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

const PROVIDER_LABEL: Record<string, string> = {
  trivy: 'Trivy',
  artifactory_xray: 'Artifactory Xray',
};

const STATUS_FILTER_OPTIONS = [
  { id: '', label: 'All latest states' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked_by_xray_policy', label: 'Blocked by Xray Policy' },
  { id: 'pending,running,waiting_for_xray,warming_artifactory_cache,indexing,queued,importing', label: 'In Flight' },
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

function parseImageReferences(value: string) {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeUniqueStringLists(...groups: string[][]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  groups.flat().forEach((value) => {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  });

  return merged;
}

function splitImageReference(imageName: string) {
  const segments = imageName.split('/');
  const firstSegment = segments[0] ?? '';
  const hasRegistryHost = segments.length > 1 && (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost');

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
    <div className="rounded-xl px-3 py-2 text-center" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
      <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: tone }}>{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-zinc-700 dark:text-zinc-200">{count || '—'}</p>
    </div>
  );
}

type ScanSourceKind = 'public' | 'private_registry' | 'artifactory_xray';
type ScansTimeRange = '' | RecentActivityRange;

const DEFAULT_ACTIVITY_RANGE: RecentActivityRange = '24h';

const SCAN_WIZARD_STEPS = [
  { id: 'source', label: 'Source' },
  { id: 'routing', label: 'Routing' },
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review & start' },
] as const;

function normalizeScansTimeRange(value?: string | null, legacyView?: string | null): ScansTimeRange {
  if (value === '6h' || value === '24h' || value === '7d' || value === '30d') {
    return value;
  }

  return legacyView === 'activity' ? DEFAULT_ACTIVITY_RANGE : '';
}

function buildScansRoute({
  image,
  status,
  range,
}: {
  image?: string;
  status?: string;
  range?: ScansTimeRange;
}) {
  const params = new URLSearchParams();

  if (image) params.set('image', image);

  if (range) {
    params.set('range', range);
  } else if (status) {
    params.set('status', status);
  }

  const query = params.toString();
  return query ? `/scans?${query}` : '/scans';
}

function ScanWizardStep({ active, complete, index, label }: { active: boolean; complete: boolean; index: number; label: string }) {
  return (
    <div
      className="rounded-2xl px-3 py-2.5 transition-all"
      style={{
        background: active ? 'linear-gradient(145deg, rgba(124,58,237,0.14) 0%, rgba(124,58,237,0.08) 100%)' : 'var(--row-hover)',
        border: active ? '1px solid rgba(167,139,250,0.3)' : '1px solid var(--surface-border)',
        boxShadow: active ? '0 10px 26px rgba(124,58,237,0.12)' : 'none',
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{
            background: complete || active ? 'rgba(124,58,237,0.18)' : 'rgba(148,163,184,0.12)',
            color: complete || active ? '#8b5cf6' : '#94a3b8',
            border: complete || active ? '1px solid rgba(167,139,250,0.28)' : '1px solid rgba(148,163,184,0.18)',
          }}
        >
          {complete ? '✓' : index + 1}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Step {index + 1}</p>
          <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</p>
        </div>
      </div>
    </div>
  );
}

function ScanSourceCard({
  description,
  disabled = false,
  eyebrow,
  onClick,
  selected,
  title,
}: {
  description: string;
  disabled?: boolean;
  eyebrow: string;
  onClick: () => void;
  selected: boolean;
  title: string;
}) {
  return (
    <button
      aria-pressed={selected}
      className="rounded-[22px] p-4 text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type="button"
      style={{
        background: selected ? 'linear-gradient(145deg, rgba(124,58,237,0.16) 0%, rgba(124,58,237,0.08) 100%)' : 'var(--row-hover)',
        border: selected ? '1px solid rgba(167,139,250,0.32)' : '1px solid var(--surface-border)',
        boxShadow: selected ? '0 12px 28px rgba(124,58,237,0.12)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-violet-500">{eyebrow}</p>
          <p className="mt-2 text-base font-semibold text-zinc-900 dark:text-white">{title}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{description}</p>
        </div>
        <span
          className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{
            background: selected ? 'rgba(124,58,237,0.18)' : 'rgba(148,163,184,0.12)',
            color: selected ? '#8b5cf6' : '#94a3b8',
            border: selected ? '1px solid rgba(167,139,250,0.28)' : '1px solid rgba(148,163,184,0.18)',
          }}
        >
          {selected ? '✓' : ''}
        </span>
      </div>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────
export default function ScansPage() {
  const { contains } = useFilter({ sensitivity: 'base' });
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const orgNamesById = useOrgNameMap();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';

  const [images, setImages] = useState<ImageSummary[]>([]);
  const [activityScans, setActivityScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [imageFilter, setImageFilter] = useState(searchParams.get('image') ?? '');
  const [appliedImageFilter, setAppliedImageFilter] = useState(searchParams.get('image') ?? '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '');
  const [activityRange, setActivityRange] = useState<ScansTimeRange>(normalizeScansTimeRange(searchParams.get('range'), searchParams.get('view')));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which image names are expanded
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track refresh tokens per expanded image (incremented to force child reload after delete/cancel)
  const [childRefreshKey, setChildRefreshKey] = useState<Record<string, number>>({});

  // Multi-select state
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());

  // Available tags for bulk tagging
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(getDefaultScannerCapabilities());

  // New scan form
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [additionalImageDraft, setAdditionalImageDraft] = useState('');
  const [additionalImageEntries, setAdditionalImageEntries] = useState<string[]>([]);
  const [scanSource, setScanSource] = useState<ScanSourceKind | null>(null);
  const [scanStepIndex, setScanStepIndex] = useState(0);
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const [platform, setPlatform] = useState('');
  const [registryId, setRegistryId] = useState('');
  const [xrayRepository, setXrayRepository] = useState('');
  const [useManualXrayRepository, setUseManualXrayRepository] = useState(false);
  const [artifactoryRepositoriesByRegistry, setArtifactoryRepositoriesByRegistry] = useState<Record<string, ArtifactoryRepository[]>>({});
  const [artifactoryRepositoriesLoading, setArtifactoryRepositoriesLoading] = useState<string | null>(null);
  const [artifactoryRepositoriesErrorByRegistry, setArtifactoryRepositoriesErrorByRegistry] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const LIMIT = 30;
  const hasRecentWindow = activityRange !== '';
  const resolvedActivityRange = activityRange || DEFAULT_ACTIVITY_RANGE;

  const loadImages = useCallback(async (p: number, img: string, status: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const res = await listScanImages(p, LIMIT, img || undefined, status || undefined);
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
  }, []);

  const loadActivity = useCallback(async (p: number, img: string, range: RecentActivityRange, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const { from, to } = getRecentActivityBounds(range);
      const res = await listScans(p, LIMIT, img || undefined, undefined, undefined, undefined, undefined, from, to);
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
  }, []);

  useEffect(() => {
    if (hasRecentWindow) {
      loadActivity(page, appliedImageFilter, resolvedActivityRange);
      return;
    }

    loadImages(page, appliedImageFilter, statusFilter);
  }, [appliedImageFilter, hasRecentWindow, loadActivity, loadImages, page, resolvedActivityRange, scopeKey, statusFilter]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => { listTags().then(setAvailableTags).catch(() => {}); }, [scopeKey]);
  useEffect(() => {
    listRegistriesWithCapabilities()
      .then((response) => {
        setRegistries(response.data);
        setCapabilities(response.capabilities);
        const defaultReg = response.data.find((r) => r.is_default);
        if (defaultReg) setRegistryId((prev) => prev || defaultReg.id);
      })
      .catch(() => {});
  }, [scopeKey]);

  const selectableRegistries = registries.filter((registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy);
  const privateRegistries = selectableRegistries.filter((registry) => registry.scan_provider !== 'artifactory_xray');
  const xrayRegistries = registries.filter((registry) => registry.scan_provider === 'artifactory_xray');

  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;
  const pendingAdditionalImages = parseImageReferences(additionalImageDraft);
  const primaryImage = imageName.trim() ? `${imageName.trim()}${imageTag.trim() ? `:${imageTag.trim()}` : ''}` : '';
  const requestedImages = mergeUniqueStringLists(
    primaryImage ? [primaryImage] : [],
    additionalImageEntries,
    pendingAdditionalImages,
  );
  const selectedRegistry = registries.find((registry) => registry.id === registryId) ?? null;
  const selectedRegistryIsXray = scanSource === 'artifactory_xray' && selectedRegistry?.scan_provider === 'artifactory_xray';
  const selectedRegistryRepositories = selectedRegistry ? artifactoryRepositoriesByRegistry[selectedRegistry.id] ?? [] : [];
  const selectedRegistryRepositoriesError = selectedRegistry ? artifactoryRepositoriesErrorByRegistry[selectedRegistry.id] ?? '' : '';
  const xrayRepositoryAutocompleteValue = useManualXrayRepository || (xrayRepository && !selectedRegistryRepositories.some((repository) => repository.key === xrayRepository))
    ? '__manual__'
    : xrayRepository || '__none__';
  const detailsStepTitle = scanSource === 'artifactory_xray'
    ? 'What image should Xray analyze?'
    : scanSource === 'private_registry'
      ? 'What image should JustScan pull?'
      : 'What image should JustScan scan?';
  const detailsStepDescription = scanSource === 'artifactory_xray'
    ? 'Keep this step focused on the image reference. We will ask about registry routing and Artifactory repo in the next step.'
    : scanSource === 'private_registry'
      ? 'Enter the image reference first. The private registry routing comes in the next step.'
      : 'Enter the image reference first. Public scans do not need any registry routing after this.';
  const routingStepTitle = scanSource === 'artifactory_xray'
    ? 'Where inside Artifactory should this image resolve?'
    : scanSource === 'private_registry'
      ? 'Which private registry hosts this image?'
      : 'No routing setup is needed';
  const routingStepDescription = scanSource === 'artifactory_xray'
    ? 'Choose the Xray-backed registry first, then optionally override the Artifactory repo key for mirrors or remotes.'
    : scanSource === 'private_registry'
      ? 'Choose the configured private registry that should authenticate and pull this image.'
      : 'This image will be scanned directly from its public source.';

  function resetCreateForm() {
    setScanSource(null);
    setScanStepIndex(0);
    setCreateError('');
    setCreating(false);
    setImageName('');
    setImageTag('latest');
    setAdditionalImageDraft('');
    setAdditionalImageEntries([]);
    setAdvancedOptionsOpen(false);
    setPlatform('');
    setRegistryId('');
    setXrayRepository('');
    setUseManualXrayRepository(false);
  }

  function openCreateModal() {
    resetCreateForm();
    modal.open();
  }

  function selectScanSource(source: ScanSourceKind) {
    setScanSource(source);
    setCreateError('');
    if (source === 'public') {
      setRegistryId('');
      setXrayRepository('');
      setUseManualXrayRepository(false);
    } else if (source === 'private_registry') {
      const nextRegistry = privateRegistries.find((registry) => registry.id === registryId)
        ?? privateRegistries.find((registry) => registry.is_default)
        ?? privateRegistries[0]
        ?? null;
      setRegistryId(nextRegistry?.id ?? '');
      setXrayRepository('');
      setUseManualXrayRepository(false);
    } else {
      const nextRegistry = xrayRegistries.find((registry) => registry.id === registryId)
        ?? xrayRegistries.find((registry) => registry.is_default)
        ?? xrayRegistries[0]
        ?? null;
      setRegistryId(nextRegistry?.id ?? '');
      setXrayRepository(nextRegistry?.xray_repository ?? '');
      setUseManualXrayRepository(false);
    }
    setScanStepIndex(1);
  }

  function validateWizardStep(stepIndex: number) {
    if (stepIndex === 0) {
      if (!scanSource) {
        return 'Choose where this image is hosted to continue.';
      }
      if (scanSource === 'public' && !capabilities.enable_trivy) {
        return 'Public Docker Hub scans are unavailable in this deployment.';
      }
      if (scanSource === 'private_registry' && !capabilities.enable_trivy) {
        return 'Private registry scans are unavailable because local Trivy scanning is disabled.';
      }
      if (scanSource === 'private_registry' && privateRegistries.length === 0) {
        return 'Add a private registry first, or choose a different source.';
      }
      if (scanSource === 'artifactory_xray' && xrayRegistries.length === 0) {
        return 'Add an Artifactory Xray registry first, or choose a different source.';
      }
      return '';
    }

    if (stepIndex >= 1) {
      if (scanSource === 'private_registry' && !registryId) {
        return 'Choose the private registry that hosts this image.';
      }
      if (scanSource === 'artifactory_xray' && !registryId) {
        return 'Choose the Artifactory registry that should route this scan.';
      }
    }

    if (stepIndex >= 2 && requestedImages.length === 0) {
      return 'Provide at least one image to scan.';
    }

    return '';
  }

  function handleWizardNext() {
    const validationError = validateWizardStep(scanStepIndex);
    if (validationError) {
      setCreateError(validationError);
      return;
    }
    setCreateError('');
    setScanStepIndex((current) => Math.min(current + 1, SCAN_WIZARD_STEPS.length - 1));
  }

  function handleWizardBack() {
    setCreateError('');
    setScanStepIndex((current) => Math.max(current - 1, 0));
  }

  useEffect(() => {
    if (!selectedRegistryIsXray || !selectedRegistry) {
      setXrayRepository('');
      setUseManualXrayRepository(false);
      return;
    }

    setXrayRepository(selectedRegistry.xray_repository ?? '');
    setUseManualXrayRepository(false);

    if (artifactoryRepositoriesByRegistry[selectedRegistry.id] || artifactoryRepositoriesLoading === selectedRegistry.id) {
      return;
    }

    setArtifactoryRepositoriesLoading(selectedRegistry.id);
    setArtifactoryRepositoriesErrorByRegistry((previous) => {
      const next = { ...previous };
      delete next[selectedRegistry.id];
      return next;
    });

    void listArtifactoryRepositories(selectedRegistry.id)
      .then((repositories) => {
        setArtifactoryRepositoriesByRegistry((previous) => ({
          ...previous,
          [selectedRegistry.id]: repositories,
        }));
      })
      .catch((repositoryError: unknown) => {
        setArtifactoryRepositoriesErrorByRegistry((previous) => ({
          ...previous,
          [selectedRegistry.id]: repositoryError instanceof Error ? repositoryError.message : 'Failed to load Artifactory repositories',
        }));
      })
      .finally(() => {
        setArtifactoryRepositoriesLoading((current) => (current === selectedRegistry.id ? null : current));
      });
  }, [artifactoryRepositoriesByRegistry, artifactoryRepositoriesLoading, selectedRegistry, selectedRegistryIsXray]);

  // Auto-open new scan modal when navigated from sidebar CTA (?new=1)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openCreateModal();
      router.replace('/scans');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshCurrentView = useCallback((options?: { silent?: boolean }) => {
    if (hasRecentWindow) {
      return loadActivity(page, appliedImageFilter, resolvedActivityRange, options);
    }

    return loadImages(page, appliedImageFilter, statusFilter, options);
  }, [appliedImageFilter, hasRecentWindow, loadActivity, loadImages, page, resolvedActivityRange, statusFilter]);

  useConditionalInterval(() => {
    void refreshCurrentView({ silent: true });
  }, hasRecentWindow
    ? activityScans.some((scan) => scan.status === 'running' || scan.status === 'pending')
    : images.some((image) => image.latest_status === 'running' || image.latest_status === 'pending'), 5000);

  function syncRoute(next: Partial<{ image: string; status: string; range: ScansTimeRange }>) {
    router.replace(buildScansRoute({
      image: next.image ?? appliedImageFilter,
      status: next.status ?? statusFilter,
      range: next.range ?? activityRange,
    }));
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
    setStatusFilter('');
    setPage(1);
    syncRoute({ range: nextRange, status: '' });
  }

  function handleActivityRangeClear() {
    clearPendingImageCommit();
    setActivityRange('');
    setPage(1);
    syncRoute({ range: '' });
  }

  function handleClearFilters() {
    clearPendingImageCommit();
    setImageFilter('');
    setAppliedImageFilter('');
    setStatusFilter('');
    setActivityRange('');
    setPage(1);
    syncRoute({ image: '', status: '', range: '' });
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
    syncRoute({ status: value, range: '' });
  }

  function toggleExpand(imageName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(imageName)) next.delete(imageName); else next.add(imageName);
      return next;
    });
  }

  function addAdditionalImagesFromDraft() {
    const parsedImages = parseImageReferences(additionalImageDraft);
    if (parsedImages.length === 0) return;

    setAdditionalImageEntries((previous) => mergeUniqueStringLists(previous, parsedImages));
    setAdditionalImageDraft('');
  }

  function removeAdditionalImageEntry(image: string) {
    setAdditionalImageEntries((previous) => previous.filter((entry) => entry !== image));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(''); setCreating(true);
    try {
      if (xrayOnlyWithoutRegistries) {
        setCreateError('No Artifactory Xray registry is configured yet. Add one before starting scans.');
        return;
      }

      const validationError = validateWizardStep(3);
      if (validationError) {
        setCreateError(validationError);
        return;
      }

      const currentScope = getWorkScope();
      const result = await createScans(
        requestedImages,
        scanSource === 'public' ? undefined : registryId || undefined,
        undefined,
        platform || undefined,
        currentScope.kind === 'org' ? currentScope.orgId : undefined,
        selectedRegistryIsXray ? xrayRepository.trim() || undefined : undefined,
      );
      const createdScans = Array.isArray(result.scans) ? result.scans : [];

      modal.close();
      resetCreateForm();
      toast.success(`${createdScans.length} image${createdScans.length === 1 ? '' : 's'} queued`);
      setExpanded(prev => {
        const next = new Set(prev);
        createdScans.forEach(scan => next.add(scan.image_name));
        return next;
      });
      setPage(1);
      await (hasRecentWindow
        ? loadActivity(1, appliedImageFilter, resolvedActivityRange)
        : loadImages(1, appliedImageFilter, statusFilter));
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create scan');
    } finally { setCreating(false); }
  }

  async function handleDelete(scanId: string, imageName: string) {
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
      setChildRefreshKey(prev => ({ ...prev, [imageName]: (prev[imageName] ?? 0) + 1 }));
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  async function handleCancel(scanId: string, imageName: string) {
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
      setChildRefreshKey(prev => ({ ...prev, [imageName]: (prev[imageName] ?? 0) + 1 }));
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    }
  }

  async function handleBulkDelete() {
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
    if (selectedScans.size === 0) return;
    try {
      const { bulkAddTagToScans } = await import('@/lib/api');
      await bulkAddTagToScans(tagId, Array.from(selectedScans));
      toast.success(`Tag added to ${selectedScans.size} scan${selectedScans.size !== 1 ? 's' : ''}`);
      setSelectedScans(new Set());
      refreshCurrentView();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to add tag');
    }
  }

  function handleGenerateReport() {
    if (selectedScans.size === 0) return;
    const scanIds = Array.from(selectedScans).join(',');
    window.open(`/reports/print?scans=${scanIds}`, '_blank');
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const activityRangeLabel = RECENT_ACTIVITY_RANGE_OPTIONS.find((option) => option.id === resolvedActivityRange)?.label ?? 'Last 24 hours';
  const hasActiveFilters = Boolean(imageFilter) || Boolean(statusFilter) || hasRecentWindow;
  const headerDescription = hasRecentWindow
    ? (total > 0
        ? `${total} scan event${total !== 1 ? 's' : ''} in ${activityRangeLabel.toLowerCase()}`
        : 'Chronological scan activity for the selected time window.')
    : (total > 0
        ? `${total} image${total !== 1 ? 's' : ''}`
        : 'Search images, compare runs, and start new scans.');
  const visibleActivityImageCount = new Set(activityScans.map((scan) => scan.image_name)).size;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        eyebrow="Scan operations"
        title="Scans"
        description={headerDescription}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/scans/compare"
              className="btn-secondary flex flex-1 min-w-[130px] items-center justify-center gap-2 sm:flex-none"
            >
              <GitCompareIcon size={15} />
              Compare
            </Link>
            <button
              onClick={openCreateModal}
              className="btn-primary flex flex-1 min-w-[130px] items-center justify-center gap-2 sm:flex-none"
            >
              <PlusSignIcon size={15} />
              New Scan
            </button>
          </div>
        )}
      />

      <div className="surface-panel rounded-2xl p-4 space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Time Window</label>
            <RecentActivityRangePicker
              value={activityRange || null}
              onChange={handleActivityRangeChange}
              allowClear
              clearLabel="Any time"
              onClear={handleActivityRangeClear}
            />
          </div>

          <p className="max-w-xl text-sm text-zinc-500 xl:text-right">
            {hasRecentWindow
              ? 'Recent windows switch the results to raw scan events so repeated scans stay visible.'
              : 'Use a recent window when you want chronological scan activity instead of one latest row per image.'}
          </p>
        </div>

        {hasRecentWindow ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image</label>
              <input
                className={inputCls}
                placeholder="Filter recent activity by image name…"
                value={imageFilter}
                onChange={e => handleImageFilterChange(e.target.value)}
              />
            </div>
            <div className="flex items-end md:justify-end">
              {hasActiveFilters ? (
                <button
                  onClick={handleClearFilters}
                  className="btn-secondary flex w-full items-center justify-center gap-1.5 md:w-auto"
                  type="button"
                >
                  <FilterIcon size={12} />
                  Clear Filters
                </button>
              ) : (
                <p className="text-sm text-zinc-500 md:text-right">{total} scan event{total !== 1 ? 's' : ''}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_280px_auto] xl:items-end">
            <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image</label>
              <input
                className={inputCls}
                placeholder="Filter by image name…"
                value={imageFilter}
                onChange={e => handleImageFilterChange(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Latest State</label>
              <Select value={statusFilter || '__all__'} onChange={value => handleStatusFilterChange(String(value === '__all__' ? '' : value ?? ''))} className="min-w-0">
                <Select.Trigger className={selectTriggerCls}>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__all__">All latest states</ListBox.Item>
                    {STATUS_FILTER_OPTIONS.filter((option) => option.id !== '').map((option) => (
                      <ListBox.Item key={option.id} id={option.id}>{option.label}</ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <div className="flex items-end md:col-span-2 xl:col-span-1 xl:justify-end">
              {hasActiveFilters ? (
                <button
                  onClick={handleClearFilters}
                  className="btn-secondary flex w-full items-center justify-center gap-1.5 md:w-auto"
                  type="button"
                >
                  <FilterIcon size={12} />
                  Clear Filters
                </button>
              ) : (
                <p className="text-sm text-zinc-500 md:text-right">{total} image{total !== 1 ? 's' : ''}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {error ? <FormAlert description={error} title="Scan list failed to load" /> : null}

      {/* Bulk action toolbar */}
      {!hasRecentWindow && selectedScans.size > 0 && (
        <div className="surface-panel rounded-2xl px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {selectedScans.size} scan{selectedScans.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerateReport}
              className="btn-secondary flex flex-1 min-w-[110px] items-center justify-center gap-1.5 sm:flex-none"
              type="button"
              title="Generate report for selected scans"
            >
              Report
            </button>
            <Popover>
              <Popover.Trigger
                className="btn-secondary"
              >
                Add Tag
              </Popover.Trigger>
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
                      {availableTags.map(tag => (
                        <ListBox.Item key={tag.id} id={tag.id} className="px-3 py-1.5 text-sm rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2">
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
            <button
              onClick={() => setSelectedScans(new Set())}
              className="btn-secondary flex-1 min-w-[90px] sm:flex-none"
              type="button"
            >
              Clear
            </button>
            <button
              onClick={handleBulkDelete}
              className="btn-danger flex-1 min-w-[90px] sm:flex-none"
              type="button"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {hasRecentWindow ? (
        <div className="surface-panel rounded-2xl overflow-hidden">
          <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: 'var(--surface-border)' }}>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Recent Activity</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Newest-first scan events for {activityRangeLabel.toLowerCase()}
              </p>
            </div>
            <p className="text-xs text-zinc-500">
              {total} scan event{total !== 1 ? 's' : ''}{activityScans.length > 0 ? ` · ${visibleActivityImageCount} image${visibleActivityImageCount !== 1 ? 's' : ''} on this page` : ''}
            </p>
          </div>

          {loading ? (
            <div className="space-y-1.5 p-4">
              {Array.from({ length: 6 }).map((_, index) => <RecentScanRowSkeleton key={index} />)}
            </div>
          ) : activityScans.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Shield01Icon size={28} />}
                title={imageFilter ? 'No recent scans match your filters' : 'No recent scans in this window'}
                description={imageFilter ? 'Try a different image filter or show all scans.' : 'Choose a wider time window or show all scans.'}
                action={{ label: 'Show all scans', onClick: handleClearFilters }}
              />
            </div>
          ) : (
            <div className="space-y-1.5 p-3">
              {activityScans.map((scan) => <RecentActivityRow key={scan.id} scan={scan} />)}
            </div>
          )}
        </div>
      ) : (
        <>
      {/* Mobile list */}
      <div className="space-y-3 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface-panel rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="size-4 rounded border border-zinc-400/50 mt-1" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 rounded skeleton" />
                  <div className="h-3 w-28 rounded skeleton" />
                </div>
                <div className="size-8 rounded-lg skeleton" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((__, sevIndex) => <div key={sevIndex} className="h-14 rounded-xl skeleton" />)}
              </div>
            </div>
          ))
        ) : images.length === 0 ? (
          <EmptyState
            icon={<Shield01Icon size={28} />}
            title={imageFilter ? 'No images match your filter' : 'No scans yet'}
            description={imageFilter ? 'Try a different search term or clear the filter.' : 'Scan a Docker image to discover vulnerabilities, SBOMs, and more.'}
            action={imageFilter ? undefined : { label: '+ New Scan', onClick: openCreateModal }}
          />
        ) : (
          images.map((img) => {
            const isOpen = expanded.has(img.image_name);
            return (
              <div key={img.image_name} className="surface-panel rounded-2xl overflow-hidden">
                <div className="p-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="pt-1" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        isSelected={selectedScans.has(img.latest_scan_id)}
                        onChange={(checked: boolean) => {
                          if (checked) {
                            setSelectedScans((previous) => new Set(previous).add(img.latest_scan_id));
                          } else {
                            setSelectedScans((previous) => {
                              const next = new Set(previous);
                              next.delete(img.latest_scan_id);
                              return next;
                            });
                          }
                        }}
                      >
                        <Checkbox.Control className="border border-zinc-500/50 data-[selected=true]:border-violet-500 data-[selected=true]:bg-violet-600">
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <ImageReferenceLabel imageName={img.image_name} />
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-zinc-400">:{img.latest_tag}</span>
                            <StatusBadge status={img.latest_status} externalStatus={img.latest_external_status} />
                            <OwnershipBadge ownerType={img.owner_type} ownerOrgId={img.owner_org_id} orgNamesById={orgNamesById} />
                          </div>
                        </div>
                        <span
                          className="shrink-0 text-xs px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
                        >
                          {img.scan_count} scan{img.scan_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                        <span title={fullDate(img.latest_scan_at)}>{timeAgo(img.latest_scan_at)}</span>
                        <Link className="font-mono text-violet-500 hover:text-violet-400" href={`/scans/${img.latest_scan_id}`}>
                          {img.latest_scan_id.slice(0, 8)}…
                        </Link>
                      </div>
                    </div>
                    <button
                      aria-label={isOpen ? `Collapse ${img.image_name}` : `Expand ${img.image_name}`}
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl transition-all"
                      onClick={() => toggleExpand(img.image_name)}
                      style={{ background: isOpen ? 'rgba(124,58,237,0.12)' : 'var(--row-hover)', border: '1px solid var(--surface-border)', color: 'var(--text-muted)' }}
                      type="button"
                    >
                      {isOpen ? <ArrowDown01Icon size={15} className="text-violet-400" /> : <ArrowRight01Icon size={15} />}
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <MobileSevStat count={img.critical_count} label="Critical" tone="rgba(239,68,68,0.78)" />
                    <MobileSevStat count={img.high_count} label="High" tone="rgba(249,115,22,0.78)" />
                    <MobileSevStat count={img.medium_count} label="Medium" tone="rgba(234,179,8,0.82)" />
                    <MobileSevStat count={img.low_count} label="Low" tone="rgba(59,130,246,0.82)" />
                  </div>
                </div>

                {isOpen ? (
                  <div className="px-4 pb-4">
                    <ImageChildren
                      imageName={img.image_name}
                      key={`${img.image_name}-${childRefreshKey[img.image_name] ?? 0}-stacked`}
                      mode="stacked"
                      orgNamesById={orgNamesById}
                      onCancel={(scanId) => handleCancel(scanId, img.image_name)}
                      onDelete={(scanId) => handleDelete(scanId, img.image_name)}
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
                      selectedScans={selectedScans}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Tree table */}
      <div className="hidden md:block surface-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="w-8 p-3" />
                <th className="w-8 p-3" />
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Metadata</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Latest</th>
                <th className="text-center p-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }}>C</th>
                <th className="text-center p-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }}>H</th>
                <th className="text-center p-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }}>M</th>
                <th className="text-center p-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }}>L</th>
              </tr>
            </thead>
            <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <ImageRowSkeleton key={i} />)
            ) : images.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-4">
                  <EmptyState
                    icon={<Shield01Icon size={28} />}
                    title={imageFilter ? 'No images match your filter' : 'No scans yet'}
                    description={imageFilter ? 'Try a different search term or clear the filter.' : 'Scan a Docker image to discover vulnerabilities, SBOMs, and more.'}
                    action={imageFilter ? undefined : { label: '+ New Scan', onClick: openCreateModal }}
                  />
                </td>
              </tr>
            ) : images.map((img, i) => {
              const isOpen = expanded.has(img.image_name);
              return (
                <Fragment key={img.image_name}>
                  {/* Image summary row */}
                  <tr
                    className="cursor-pointer transition-colors"
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onClick={() => toggleExpand(img.image_name)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Checkbox for selecting image's latest scan */}
                    <td className="p-3.5 w-8" onClick={e => e.stopPropagation()}>
                      <Checkbox
                        isSelected={selectedScans.has(img.latest_scan_id)}
                        onChange={(checked: boolean) => {
                          if (checked) {
                            setSelectedScans(prev => new Set(prev).add(img.latest_scan_id));
                          } else {
                            setSelectedScans(prev => {
                              const next = new Set(prev);
                              next.delete(img.latest_scan_id);
                              return next;
                            });
                          }
                        }}
                      >
                        <Checkbox.Control className="border border-zinc-500/50 data-[selected=true]:border-violet-500 data-[selected=true]:bg-violet-600">
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox>
                    </td>
                    <td className="p-3.5 w-8">
                      <span
                        className="flex items-center justify-center size-5 rounded-md transition-all duration-150"
                        style={{ color: 'var(--text-muted)', background: isOpen ? 'rgba(124,58,237,0.12)' : undefined }}
                      >
                        {isOpen
                          ? <ArrowDown01Icon size={13} className="text-violet-400" />
                          : <ArrowRight01Icon size={13} />}
                      </span>
                    </td>

                    {/* Image name + meta */}
                    <td className="px-4 py-3.5">
                      <ImageReferenceLabel imageName={img.image_name} />
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="font-mono text-xs text-zinc-400">:{img.latest_tag}</span>
                        <StatusBadge status={img.latest_status} externalStatus={img.latest_external_status} />
                        <span className="text-xs text-zinc-500" title={fullDate(img.latest_scan_at)}>
                          {timeAgo(img.latest_scan_at)}
                        </span>
                      </div>
                    </td>

                    {/* Meta info column (Scan count + Ownership) */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div
                          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider whitespace-nowrap"
                          style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
                        >
                          {img.scan_count} scan{img.scan_count !== 1 ? 's' : ''}
                        </div>
                        <OwnershipBadge ownerType={img.owner_type} ownerOrgId={img.owner_org_id} orgNamesById={orgNamesById} />
                      </div>
                    </td>

                    {/* Latest scan link */}
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/scans/${img.latest_scan_id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-zinc-500 hover:text-violet-400 transition-colors font-mono truncate max-w-[96px] inline-block"
                        title="Open latest scan"
                      >
                        {img.latest_scan_id.slice(0, 8)}…
                      </Link>
                    </td>

                    {/* Severity from latest scan */}
                    <td className="p-3.5 text-center"><SevCount count={img.critical_count} level="critical" /></td>
                    <td className="p-3.5 text-center"><SevCount count={img.high_count}    level="high"     /></td>
                    <td className="p-3.5 text-center"><SevCount count={img.medium_count}  level="medium"   /></td>
                    <td className="p-3.5 text-center"><SevCount count={img.low_count}     level="low"      /></td>
                  </tr>

                  {/* Expanded children */}
                  {isOpen && (
                    <ImageChildren
                      key={`${img.image_name}-${childRefreshKey[img.image_name] ?? 0}`}
                      imageName={img.image_name}
                      mode="table"
                      orgNamesById={orgNamesById}
                      onDelete={scanId => handleDelete(scanId, img.image_name)}
                      onCancel={scanId => handleCancel(scanId, img.image_name)}
                      selectedScans={selectedScans}
                      onSelectScan={(scanId, selected) => {
                        if (selected) {
                          setSelectedScans(prev => new Set(prev).add(scanId));
                        } else {
                          setSelectedScans(prev => {
                            const next = new Set(prev);
                            next.delete(scanId);
                            return next;
                          });
                        }
                      }}
                    />
                  )}
                </Fragment>
              );
            })}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{total} {hasRecentWindow ? `scan event${total !== 1 ? 's' : ''}` : `image${total !== 1 ? 's' : ''}`}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="btn-secondary"
            >← Prev</button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="btn-secondary"
            >Next →</button>
          </div>
        </div>
      )}

      {/* Create scan modal */}
      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="surface-modal w-[min(94vw,72rem)] max-w-none rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">New Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="create-scan-form" onSubmit={handleCreate} className="space-y-4">
                  {createError ? <FormAlert description={createError} title="Scan creation failed" /> : null}
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {SCAN_WIZARD_STEPS.map((step, index) => (
                      <ScanWizardStep
                        key={step.id}
                        active={index === scanStepIndex}
                        complete={index < scanStepIndex}
                        index={index}
                        label={step.label}
                      />
                    ))}
                  </div>

                  {scanStepIndex === 0 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-violet-500">Step 1</p>
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Where is this image hosted?</h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                          Start with the source, then JustScan will only ask for the routing details that matter for that path.
                        </p>
                      </div>

                      <div className="grid gap-3">
                        <ScanSourceCard
                          description={capabilities.enable_trivy ? 'Scan public images like nginx or n8nio/n8n directly without choosing a registry first.' : 'Unavailable because local Trivy scanning is disabled in this deployment.'}
                          disabled={!capabilities.enable_trivy}
                          eyebrow="Public"
                          onClick={() => selectScanSource('public')}
                          selected={scanSource === 'public'}
                          title="Public / Docker Hub"
                        />
                        <ScanSourceCard
                          description={capabilities.enable_trivy ? (privateRegistries.length > 0 ? 'Use one of your configured private registries and keep the image field focused on what you want to scan.' : 'Unavailable until you configure at least one private registry.') : 'Unavailable because local Trivy scanning is disabled in this deployment.'}
                          disabled={!capabilities.enable_trivy || privateRegistries.length === 0}
                          eyebrow="Private"
                          onClick={() => selectScanSource('private_registry')}
                          selected={scanSource === 'private_registry'}
                          title="Private registry"
                        />
                        <ScanSourceCard
                          description={xrayRegistries.length > 0 ? 'Route scans through Artifactory Xray and add the Artifactory repo only when this path needs it.' : 'Unavailable until you configure at least one Artifactory Xray registry.'}
                          disabled={xrayRegistries.length === 0}
                          eyebrow="Xray"
                          onClick={() => selectScanSource('artifactory_xray')}
                          selected={scanSource === 'artifactory_xray'}
                          title="Artifactory Xray"
                        />
                      </div>
                    </div>
                  ) : null}

                  {scanStepIndex === 1 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-violet-500">Step 2</p>
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">{routingStepTitle}</h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">{routingStepDescription}</p>
                      </div>

                      <div className="rounded-[24px] p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-violet-500">Selected source</p>
                        <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {scanSource === 'artifactory_xray' ? 'Artifactory Xray' : scanSource === 'private_registry' ? 'Private registry' : 'Public / Docker Hub'}
                        </p>
                      </div>

                      {scanSource === 'public' ? (
                        <div className="rounded-[24px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-violet-500">Public image</p>
                          <p className="mt-2 text-base font-semibold text-zinc-900 dark:text-white">No registry or repo selection needed</p>
                          <p className="mt-2 text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                            JustScan will use the image reference from the next step exactly as entered.
                          </p>
                        </div>
                      ) : null}

                      {scanSource === 'private_registry' ? (
                        <div className="space-y-1.5 rounded-[24px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Private registry</label>
                          <Select value={registryId || '__none__'} onChange={value => setRegistryId(String(value === '__none__' ? '' : value ?? ''))}>
                            <Select.Trigger className={selectTriggerCls}>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {privateRegistries.map((registry) => (
                                  <ListBox.Item key={registry.id} id={registry.id}>
                                    {registry.name}
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                          <p className="text-xs text-zinc-500">Choose the configured registry that hosts this image so JustScan can authenticate and pull it correctly.</p>
                        </div>
                      ) : null}

                      {scanSource === 'artifactory_xray' ? (
                        <div className="space-y-4">
                          <div className="space-y-1.5 rounded-[24px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Artifactory registry</label>
                            <Select value={registryId || '__none__'} onChange={value => setRegistryId(String(value === '__none__' ? '' : value ?? ''))}>
                              <Select.Trigger className={selectTriggerCls}>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  {xrayRegistries.map((registry) => (
                                    <ListBox.Item key={registry.id} id={registry.id}>
                                      {registry.name}
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                            <p className="text-xs text-zinc-500">Choose the Xray-backed registry that should resolve and analyze this image.</p>
                          </div>

                          <div className="space-y-1.5 rounded-[24px] p-5" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                              Artifactory Repo <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional override)</span>
                            </label>
                            <Autocomplete
                              value={xrayRepositoryAutocompleteValue}
                              onChange={(key: Key | null) => {
                                const value = String(key ?? '__none__');
                                if (value === '__manual__') {
                                  setUseManualXrayRepository(true);
                                  return;
                                }
                                setUseManualXrayRepository(false);
                                setXrayRepository(value === '__none__' ? '' : value);
                              }}
                            >
                              <Autocomplete.Trigger className={selectTriggerCls}>
                                <Autocomplete.Value />
                                <Autocomplete.ClearButton />
                                <Autocomplete.Indicator />
                              </Autocomplete.Trigger>
                              <Autocomplete.Popover>
                                <Autocomplete.Filter filter={contains}>
                                  <SearchField name="artifactory-repo-search" variant="secondary">
                                    <SearchField.Group>
                                      <SearchField.SearchIcon />
                                      <SearchField.Input placeholder="Search Artifactory repos..." />
                                      <SearchField.ClearButton />
                                    </SearchField.Group>
                                  </SearchField>
                                  <ListBox renderEmptyState={() => <div className="px-3 py-2 text-sm text-zinc-500">No matching repositories</div>}>
                                    <ListBox.Item id="__none__" textValue="No repo override">
                                      No repo override
                                    </ListBox.Item>
                                    {selectedRegistryRepositories.map((repository) => (
                                      <ListBox.Item key={repository.key} id={repository.key} textValue={`${repository.key} ${repository.class ?? ''}`.trim()}>
                                        {repository.key}{repository.class ? ` · ${repository.class}` : ''}
                                      </ListBox.Item>
                                    ))}
                                    <ListBox.Item id="__manual__" textValue="Enter manually">
                                      Enter manually
                                    </ListBox.Item>
                                  </ListBox>
                                </Autocomplete.Filter>
                              </Autocomplete.Popover>
                            </Autocomplete>
                            <p className="text-xs text-zinc-500">
                              Pick a repo like <span className="font-mono">docker-remote</span> so you can scan <span className="font-mono">n8nio/n8n</span> instead of typing <span className="font-mono">docker-remote/n8nio/n8n</span>.
                            </p>
                            {selectedRegistry && artifactoryRepositoriesLoading === selectedRegistry.id ? (
                              <p className="text-xs text-zinc-500">Loading available Artifactory repos…</p>
                            ) : null}
                            {selectedRegistryRepositoriesError ? (
                              <p className="text-xs" style={{ color: '#f59e0b' }}>
                                {selectedRegistryRepositoriesError}. You can still enter the repo manually.
                              </p>
                            ) : null}
                            {(useManualXrayRepository || !!selectedRegistryRepositoriesError) ? (
                              <FormField
                                className="font-mono"
                                description="Manual fallback when the repo list is unavailable or you need a repo key that is not listed."
                                label="Manual Artifactory Repo"
                                onChange={(event) => setXrayRepository(event.target.value)}
                                placeholder="docker-remote"
                                value={xrayRepository}
                              />
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {scanStepIndex === 2 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-violet-500">Step 3</p>
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">{detailsStepTitle}</h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">{detailsStepDescription}</p>
                      </div>

                      <div className="rounded-[24px] p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-violet-500">Selected source</p>
                        <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {scanSource === 'artifactory_xray' ? 'Artifactory Xray' : scanSource === 'private_registry' ? 'Private registry' : 'Public / Docker Hub'}
                        </p>
                      </div>

                      <FormField className="font-mono" label="Image Name" onChange={e => setImageName(e.target.value)} placeholder="nginx or n8nio/n8n" value={imageName} />
                      <FormField className="font-mono" label="Tag" onChange={e => setImageTag(e.target.value)} placeholder="latest" required value={imageTag} />

                      <div className="rounded-[24px] p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                        <button
                          aria-expanded={advancedOptionsOpen}
                          className="flex w-full items-start justify-between gap-4 text-left"
                          onClick={() => setAdvancedOptionsOpen((current) => !current)}
                          type="button"
                        >
                          <div className="space-y-1">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Advanced options</p>
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">Optional scan settings for multiple images or platform-specific artifacts.</p>
                          </div>
                          <span className="mt-0.5 flex size-8 items-center justify-center rounded-full border border-zinc-200/50 text-zinc-500 dark:border-zinc-700/60 dark:text-zinc-300">
                            {advancedOptionsOpen ? <ArrowDown01Icon size={16} /> : <ArrowRight01Icon size={16} />}
                          </span>
                        </button>

                        {advancedOptionsOpen ? (
                          <div className="mt-4 space-y-4">
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                                Additional Images <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span>
                              </label>
                              <textarea
                                className={joinClassNames(inputCls, 'min-h-24 font-mono resize-y')}
                                placeholder={'Paste one or more full image references here\nExample: ghcr.io/example/api:1.2.3, registry.example.com/team/worker:latest'}
                                value={additionalImageDraft}
                                onChange={e => setAdditionalImageDraft(e.target.value)}
                              />
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-zinc-500">
                                  Paste one or many full image references, separated by commas or new lines. Anything still in this box is included when you continue.
                                </p>
                                <button
                                  className="btn-secondary-sm shrink-0"
                                  onClick={addAdditionalImagesFromDraft}
                                  type="button"
                                >
                                  Add {pendingAdditionalImages.length > 1 ? `${pendingAdditionalImages.length} refs` : 'to list'}
                                </button>
                              </div>
                              {additionalImageEntries.length > 0 ? (
                                <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--surface-border)' }}>
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">Queued additional images</p>
                                    <span className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--surface-border)' }}>
                                      {additionalImageEntries.length}
                                    </span>
                                  </div>
                                  <div className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                                    {additionalImageEntries.map((image) => (
                                      <div key={image} className="flex items-start justify-between gap-3 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--surface-border)' }}>
                                        <span className="min-w-0 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">{image}</span>
                                        <button
                                          aria-label={`Remove ${image}`}
                                          className="btn-icon-subtle size-8 shrink-0 rounded-lg"
                                          onClick={() => removeAdditionalImageEntry(image)}
                                          type="button"
                                        >
                                          <Cancel01Icon aria-hidden size={14} />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                                Platform <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span>
                              </label>
                              <Select value={platform || '__auto__'} onChange={value => setPlatform(String(value === '__auto__' ? '' : value ?? ''))}>
                                <Select.Trigger className={selectTriggerCls}>
                                  <Select.Value />
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    <ListBox.Item id="__auto__">Auto-detect</ListBox.Item>
                                    <ListBox.Item id="linux/amd64">linux/amd64</ListBox.Item>
                                    <ListBox.Item id="linux/arm64">linux/arm64</ListBox.Item>
                                    <ListBox.Item id="linux/arm/v7">linux/arm/v7</ListBox.Item>
                                    <ListBox.Item id="linux/arm/v6">linux/arm/v6</ListBox.Item>
                                    <ListBox.Item id="linux/386">linux/386</ListBox.Item>
                                    <ListBox.Item id="linux/s390x">linux/s390x</ListBox.Item>
                                    <ListBox.Item id="linux/ppc64le">linux/ppc64le</ListBox.Item>
                                    <ListBox.Item id="windows/amd64">windows/amd64</ListBox.Item>
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-4 text-xs text-zinc-500">
                            Collapsed by default. Open this only if you want to queue more images or force a platform.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {scanStepIndex === 3 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-violet-500">Step 4</p>
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Review &amp; start</h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                          Confirm the scan target and routing details before JustScan queues the work.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-[24px] p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Source</p>
                          <p className="mt-2 text-base font-semibold text-zinc-900 dark:text-white">
                            {scanSource === 'artifactory_xray' ? 'Artifactory Xray' : scanSource === 'private_registry' ? 'Private registry' : 'Public / Docker Hub'}
                          </p>
                          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                            {scanSource === 'artifactory_xray'
                              ? 'JustScan will route this scan through your selected Xray-backed Artifactory registry.'
                              : scanSource === 'private_registry'
                                ? 'JustScan will authenticate against the selected private registry before scanning.'
                                : 'JustScan will scan the public image directly.'}
                          </p>
                        </div>

                        <div className="rounded-[24px] p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Images</p>
                          <p className="mt-2 text-base font-semibold text-zinc-900 dark:text-white">{requestedImages.length} target{requestedImages.length === 1 ? '' : 's'}</p>
                          <p className="mt-2 break-all font-mono text-sm text-zinc-600 dark:text-zinc-300">{primaryImage || 'No primary image provided'}</p>
                          {requestedImages.length > 1 ? (
                            <p className="mt-2 text-xs text-zinc-500">Includes {requestedImages.length - 1} additional image{requestedImages.length - 1 === 1 ? '' : 's'}.</p>
                          ) : null}
                        </div>

                        {scanSource !== 'public' ? (
                          <div className="rounded-[24px] p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Registry routing</p>
                            <p className="mt-2 text-base font-semibold text-zinc-900 dark:text-white">{selectedRegistry?.name ?? '—'}</p>
                            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{selectedRegistry?.url ?? 'No registry selected.'}</p>
                          </div>
                        ) : null}

                        {selectedRegistryIsXray ? (
                          <div className="rounded-[24px] p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Artifactory repo</p>
                            <p className="mt-2 text-base font-semibold text-zinc-900 dark:text-white">{xrayRepository.trim() || 'Use image path as-is'}</p>
                            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Override the repo when the image lives behind a remote or mirror key like docker-remote.</p>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-[24px] p-4" style={{ background: 'linear-gradient(145deg, rgba(124,58,237,0.1) 0%, rgba(124,58,237,0.04) 100%)', border: '1px solid rgba(167,139,250,0.18)' }}>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-violet-500">Platform</p>
                            <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">{platform || 'Auto-detect'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.18em] text-violet-500">Additional images</p>
                            <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">{requestedImages.length > 1 ? `${requestedImages.length - 1} queued` : 'None added'}</p>
                          </div>
                        </div>
                        <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-300">Tags can be added from the scan detail page after creation.</p>
                      </div>
                    </div>
                  ) : null}
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-zinc-500">Step {scanStepIndex + 1} of {SCAN_WIZARD_STEPS.length}</div>
                  <div className="flex items-center justify-end gap-3">
                    <button
                      onClick={modal.close}
                      className="btn-secondary"
                      type="button"
                    >
                      Cancel
                    </button>
                    {scanStepIndex > 0 ? (
                      <button
                        onClick={handleWizardBack}
                        className="btn-secondary"
                        type="button"
                      >
                        Back
                      </button>
                    ) : null}
                    {scanStepIndex < SCAN_WIZARD_STEPS.length - 1 ? (
                      <button
                        key="wizard-continue"
                        onClick={handleWizardNext}
                        className="btn-primary"
                        type="button"
                      >
                        Continue
                      </button>
                    ) : (
                      <button
                        key="wizard-submit"
                        type="submit" form="create-scan-form" disabled={creating || xrayOnlyWithoutRegistries}
                        className="btn-primary inline-flex items-center gap-2"
                      >
                        {creating && <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        Start Scan
                      </button>
                    )}
                  </div>
                </div>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
