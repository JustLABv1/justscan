'use client';
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
import { FormField } from '@/components/ui/form-field';
import {
  heroSelectTriggerClassName,
  joinClassNames,
  nativeFieldClassName,
} from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RecentScanRowSkeleton } from '@/components/ui/skeleton';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useOrgNameMap } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  ArtifactoryRepository,
  cancelScan,
  createScans,
  createUploadedArchiveScan,
  deleteScan,
  getDefaultScannerCapabilities,
  getTokenType,
  getUserDetails,
  getWorkScope,
  ImageSummary,
  listArtifactoryRepositories,
  listOrgMembers,
  listOrgs,
  Org,
  listRegistriesWithCapabilities,
  listScanImages,
  listScans,
  listTags,
  RegistryWithHealth,
  Scan,
  ScannerCapabilities,
  Tag,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canMutateOrg } from '@/lib/org-permissions';
import {
  Autocomplete,
  Button,
  Card,
  Input,
  Label,
  ListBox,
  Modal,
  Pagination,
  Popover,
  Radio,
  RadioGroup,
  SearchField,
  Select,
  TextArea,
  useFilter,
  useOverlayState,
} from '@heroui/react';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FilterIcon,
  GitCompareIcon,
  PlusSignIcon,
  Shield01Icon,
} from 'hugeicons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Key } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

const STATUS_FILTER_OPTIONS = [
  { id: '', label: 'All latest states' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked_by_xray_policy', label: 'Blocked by Xray Policy' },
  {
    id: 'pending,running,waiting_for_xray,warming_artifactory_cache,indexing,queued,importing',
    label: 'In Flight',
  },
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

type ScanSourceKind = 'public' | 'private_registry' | 'artifactory_xray' | 'local_archive';
type ScansTimeRange = '' | RecentActivityRange;

const DEFAULT_ACTIVITY_RANGE: RecentActivityRange = '24h';

const SCAN_WIZARD_STEPS = [
  { id: 'source', label: 'Source' },
  { id: 'routing', label: 'Routing' },
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review & start' },
] as const;

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
}: {
  image?: string;
  status?: string;
  range?: ScansTimeRange;
  tag?: string;
  critical?: '' | 'yes' | 'no';
}) {
  const params = new URLSearchParams();

  if (image) params.set('image', image);
  if (status) params.set('status', status);
  if (range) params.set('range', range);
  if (tag) params.set('tag', tag);
  if (critical) params.set('critical', critical);

  const query = params.toString();
  return query ? `/scans?${query}` : '/scans';
}

function ScanWizardStep({
  active,
  complete,
  index,
  label,
}: {
  active: boolean;
  complete: boolean;
  index: number;
  label: string;
}) {
  return (
    <div
      className="rounded-2xl px-3 py-2.5 transition-all"
      style={{
        background: active
          ? 'linear-gradient(145deg, color-mix(in oklab, var(--accent) 20%, transparent) 0%, color-mix(in oklab, var(--accent) 10%, transparent) 100%)'
          : 'var(--surface-secondary)',
        border: active
          ? '1px solid color-mix(in oklab, var(--accent) 30%, transparent)'
          : '1px solid var(--surface-border)',
      }}
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
          style={{
            background: complete || active ? 'var(--accent-soft)' : 'rgba(148,163,184,0.12)',
            color: complete || active ? 'var(--accent-soft-foreground)' : '#94a3b8',
            border:
              complete || active
                ? '1px solid color-mix(in oklab, var(--accent) 24%, transparent)'
                : '1px solid rgba(148,163,184,0.18)',
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
  source,
  title,
}: {
  description: string;
  disabled?: boolean;
  eyebrow: string;
  source: ScanSourceKind;
  title: string;
}) {
  return (
    <Radio
      className="group w-full cursor-pointer rounded-[22px] border border-surface-tertiary bg-row-hover p-4 text-left transition-all duration-150 data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/10 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60"
      isDisabled={disabled}
      value={source}
    >
      <Radio.Content className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.2em] text-accent">{eyebrow}</p>
        <p className="mt-2 text-base font-semibold text-zinc-900 dark:text-white">{title}</p>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{description}</p>
      </Radio.Content>
      <Radio.Control
        className="ml-auto mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-slate-300/50 bg-slate-400/10 group-data-[selected=true]:border-accent/40 group-data-[selected=true]:bg-accent/20"
        aria-hidden
      >
        <Radio.Indicator className="text-[11px] font-semibold text-accent">
          {({ isSelected }) => (isSelected ? '✓' : null)}
        </Radio.Indicator>
      </Radio.Control>
    </Radio>
  );
}

function ScanWizardField({
  children,
  description,
  label,
  optional = false,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {label}{' '}
        {optional ? (
          <span className="font-normal text-zinc-400 dark:text-zinc-600">(optional)</span>
        ) : null}
      </Label>
      {children}
      {description ? <p className="text-xs text-zinc-500">{description}</p> : null}
    </div>
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
  const [activityRange, setActivityRange] = useState<ScansTimeRange>(
    normalizeScansTimeRange(searchParams.get('range'), searchParams.get('view'))
  );
  const [tagFilter, setTagFilter] = useState(searchParams.get('tag') ?? '');
  const [criticalFilter, setCriticalFilter] = useState<'' | 'yes' | 'no'>(
    normalizeCriticalFilter(searchParams.get('critical'))
  );
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
  const [scanUsersById, setScanUsersById] = useState<Record<string, { displayName: string }>>({});
  const [scopedOrgPolicy, setScopedOrgPolicy] = useState<Org | null>(null);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(
    getDefaultScannerCapabilities()
  );

  // New scan form
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [additionalImageDraft, setAdditionalImageDraft] = useState('');
  const [additionalImageEntries, setAdditionalImageEntries] = useState<string[]>([]);
  const [scanSource, setScanSource] = useState<ScanSourceKind | null>(null);
  const [scanStepIndex, setScanStepIndex] = useState(0);
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const [platform, setPlatform] = useState('');
  const [uploadedArchiveFile, setUploadedArchiveFile] = useState<File | null>(null);
  const [registryId, setRegistryId] = useState('');
  const [xrayRepository, setXrayRepository] = useState('');
  const [useManualXrayRepository, setUseManualXrayRepository] = useState(false);
  const [artifactoryRepositoriesByRegistry, setArtifactoryRepositoriesByRegistry] = useState<
    Record<string, ArtifactoryRepository[]>
  >({});
  const [artifactoryRepositoriesLoading, setArtifactoryRepositoriesLoading] = useState<
    string | null
  >(null);
  const [artifactoryRepositoriesErrorByRegistry, setArtifactoryRepositoriesErrorByRegistry] =
    useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const isPlatformAdmin = getTokenType() === 'admin';
  const LIMIT = 30;
  const hasRecentWindow = activityRange !== '';
  const resolvedActivityRange = activityRange || DEFAULT_ACTIVITY_RANGE;

  const loadImages = useCallback(
    async (p: number, img: string, status: string, options?: { silent?: boolean }) => {
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
    },
    []
  );

  const loadActivity = useCallback(
    async (p: number, img: string, range: RecentActivityRange, options?: { silent?: boolean }) => {
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
        void loadActivity(page, appliedImageFilter, resolvedActivityRange);
        return;
      }

      void loadImages(page, appliedImageFilter, statusFilter);
    });
  }, [
    appliedImageFilter,
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
    listTags()
      .then(setAvailableTags)
      .catch(() => {});
  }, [scopeKey]);
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

  useEffect(() => {
    let cancelled = false;

    const loadScanUsers = async () => {
      const [currentUserResult, orgMembers] = await Promise.all([
        getUserDetails().catch(() => null),
        workScope.kind === 'org' ? listOrgMembers(workScope.orgId).catch(() => []) : Promise.resolve([]),
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

  const selectableRegistries = registries.filter(
    (registry) => registry.scan_provider === 'artifactory_xray' || capabilities.enable_trivy
  );
  const privateRegistries = selectableRegistries.filter(
    (registry) => registry.scan_provider !== 'artifactory_xray'
  );
  const xrayRegistries = registries.filter(
    (registry) => registry.scan_provider === 'artifactory_xray'
  );

  const xrayOnlyWithoutRegistries = !capabilities.enable_trivy && selectableRegistries.length === 0;
  const canMutateCurrentScope =
    isPlatformAdmin ||
    workScope.kind !== 'org' ||
    !scopedOrgPolicy ||
    canMutateOrg(scopedOrgPolicy.current_user_role);
  const orgFeatureBlockMessage =
    workScope.kind !== 'org' || !scopedOrgPolicy
      ? ''
      : !scopedOrgPolicy.is_active
        ? 'Organization is suspended. Scan creation is disabled.'
        : scanSource === 'artifactory_xray'
          ? scopedOrgPolicy.allow_helm_scans
            ? ''
            : 'Helm/Xray scans are disabled for this organization.'
          : scopedOrgPolicy.allow_image_scans
            ? ''
            : 'Image scans are disabled for this organization.';
  const pendingAdditionalImages = parseImageReferences(additionalImageDraft);
  const primaryImage = imageName.trim()
    ? `${imageName.trim()}${imageTag.trim() ? `:${imageTag.trim()}` : ''}`
    : '';
  const requestedImages = mergeUniqueStringLists(
    primaryImage ? [primaryImage] : [],
    additionalImageEntries,
    pendingAdditionalImages
  );
  const selectedRegistry = registries.find((registry) => registry.id === registryId) ?? null;
  const selectedRegistryIsXray =
    scanSource === 'artifactory_xray' && selectedRegistry?.scan_provider === 'artifactory_xray';
  const selectedRegistryRepositories = selectedRegistry
    ? (artifactoryRepositoriesByRegistry[selectedRegistry.id] ?? [])
    : [];
  const selectedRegistryRepositoriesError = selectedRegistry
    ? (artifactoryRepositoriesErrorByRegistry[selectedRegistry.id] ?? '')
    : '';
  const xrayRepositoryAutocompleteValue =
    useManualXrayRepository ||
    (xrayRepository &&
      !selectedRegistryRepositories.some((repository) => repository.key === xrayRepository))
      ? '__manual__'
      : xrayRepository || '__none__';
  const detailsStepTitle =
    scanSource === 'local_archive'
      ? 'Upload an image archive'
      : scanSource === 'artifactory_xray'
        ? 'What image should Xray analyze?'
        : scanSource === 'private_registry'
          ? 'What image should JustScan pull?'
          : 'What image should JustScan scan?';
  const detailsStepDescription =
    scanSource === 'local_archive'
      ? 'Upload a docker/podman image archive (.tar, .tar.gz, .tgz). Display name and tag are optional.'
      : scanSource === 'artifactory_xray'
        ? 'Keep this step focused on the image reference. We will ask about registry routing and Artifactory repo in the next step.'
        : scanSource === 'private_registry'
          ? 'Enter the image reference first. The private registry routing comes in the next step.'
          : 'Enter the image reference first. Public scans do not need any registry routing after this.';
  const routingStepTitle =
    scanSource === 'local_archive'
      ? 'No routing setup is needed'
      : scanSource === 'artifactory_xray'
        ? 'Where inside Artifactory should this image resolve?'
        : scanSource === 'private_registry'
          ? 'Which private registry hosts this image?'
          : 'No routing setup is needed';
  const routingStepDescription =
    scanSource === 'local_archive'
      ? 'Uploaded archive scans run locally with Trivy and do not use a registry route.'
      : scanSource === 'artifactory_xray'
        ? 'Choose the Xray-backed registry first, then optionally override the Artifactory repo key for mirrors or remotes.'
        : scanSource === 'private_registry'
          ? 'Choose the configured private registry that should authenticate and pull this image.'
          : 'This image will be scanned directly from its public source.';
  const scanSourceOptions = [
    {
      description: capabilities.enable_trivy
        ? 'Scan public images like nginx or n8nio/n8n directly without choosing a registry first.'
        : 'Unavailable because local Trivy scanning is disabled in this deployment.',
      disabled: !capabilities.enable_trivy,
      eyebrow: 'Public',
      source: 'public' as const,
      title: 'Public / Docker Hub',
    },
    {
      description: capabilities.enable_trivy
        ? privateRegistries.length > 0
          ? 'Use one of your configured private registries and keep the image field focused on what you want to scan.'
          : 'Unavailable until you configure at least one private registry.'
        : 'Unavailable because local Trivy scanning is disabled in this deployment.',
      disabled: !capabilities.enable_trivy || privateRegistries.length === 0,
      eyebrow: 'Private',
      source: 'private_registry' as const,
      title: 'Private registry',
    },
    {
      description:
        xrayRegistries.length > 0
          ? 'Route scans through Artifactory Xray and add the Artifactory repo only when this path needs it.'
          : 'Unavailable until you configure at least one Artifactory Xray registry.',
      disabled: xrayRegistries.length === 0,
      eyebrow: 'Xray',
      source: 'artifactory_xray' as const,
      title: 'Artifactory Xray',
    },
    {
      description: capabilities.enable_trivy
        ? 'Upload a docker save/podman save archive and scan it before pushing to any registry.'
        : 'Unavailable because local Trivy scanning is disabled in this deployment.',
      disabled: !capabilities.enable_trivy,
      eyebrow: 'Local',
      source: 'local_archive' as const,
      title: 'Local archive upload',
    },
  ];
  const availableScanSourceOptions = scanSourceOptions.filter((option) => !option.disabled);

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
    setUploadedArchiveFile(null);
    setRegistryId('');
    setXrayRepository('');
    setUseManualXrayRepository(false);
  }

  function openCreateModal() {
    if (!canMutateCurrentScope) return;
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
      const nextRegistry =
        privateRegistries.find((registry) => registry.id === registryId) ??
        privateRegistries.find((registry) => registry.is_default) ??
        privateRegistries[0] ??
        null;
      setRegistryId(nextRegistry?.id ?? '');
      setXrayRepository('');
      setUseManualXrayRepository(false);
    } else {
      if (source === 'local_archive') {
        setRegistryId('');
        setXrayRepository('');
        setUseManualXrayRepository(false);
        setScanStepIndex(1);
        return;
      }
      const nextRegistry =
        xrayRegistries.find((registry) => registry.id === registryId) ??
        xrayRegistries.find((registry) => registry.is_default) ??
        xrayRegistries[0] ??
        null;
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
      if (scanSource === 'local_archive' && !capabilities.enable_trivy) {
        return 'Local archive scans are unavailable because Trivy scanning is disabled.';
      }
      return '';
    }

    if (stepIndex >= 1) {
      if (scanSource === 'local_archive') {
        return '';
      }
      if (scanSource === 'private_registry' && !registryId) {
        return 'Choose the private registry that hosts this image.';
      }
      if (scanSource === 'artifactory_xray' && !registryId) {
        return 'Choose the Artifactory registry that should route this scan.';
      }
    }

    if (stepIndex >= 2 && scanSource === 'local_archive' && !uploadedArchiveFile) {
      return 'Upload an OCI/Docker archive file to continue.';
    }

    if (stepIndex >= 2 && scanSource !== 'local_archive' && requestedImages.length === 0) {
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
    return deferEffect(() => {
      if (!selectedRegistryIsXray || !selectedRegistry) {
        setXrayRepository('');
        setUseManualXrayRepository(false);
        return;
      }

      setXrayRepository(selectedRegistry.xray_repository ?? '');
      setUseManualXrayRepository(false);

      if (
        artifactoryRepositoriesByRegistry[selectedRegistry.id] ||
        artifactoryRepositoriesErrorByRegistry[selectedRegistry.id] ||
        artifactoryRepositoriesLoading === selectedRegistry.id
      ) {
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
            [selectedRegistry.id]:
              repositoryError instanceof Error
                ? repositoryError.message
                : 'Failed to load Artifactory repositories',
          }));
        })
        .finally(() => {
          setArtifactoryRepositoriesLoading((current) =>
            current === selectedRegistry.id ? null : current
          );
        });
    });
  }, [
    artifactoryRepositoriesByRegistry,
    artifactoryRepositoriesErrorByRegistry,
    artifactoryRepositoriesLoading,
    selectedRegistry,
    selectedRegistryIsXray,
  ]);

  // Auto-open new scan modal when navigated from sidebar CTA (?new=1)
  useEffect(() => {
    return deferEffect(() => {
      if (searchParams.get('new') === '1') {
        openCreateModal();
        router.replace('/scans');
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshCurrentView = useCallback(
    (options?: { silent?: boolean }) => {
      if (hasRecentWindow) {
        return loadActivity(page, appliedImageFilter, resolvedActivityRange, options);
      }

      return loadImages(page, appliedImageFilter, statusFilter, options);
    },
    [
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
    }>
  ) {
    router.replace(
      buildScansRoute({
        image: next.image ?? appliedImageFilter,
        status: next.status ?? statusFilter,
        range: next.range ?? activityRange,
        tag: next.tag ?? tagFilter,
        critical: next.critical ?? criticalFilter,
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
    setTagFilter('');
    setCriticalFilter('');
    setPage(1);
    syncRoute({ image: '', status: '', range: '', tag: '', critical: '' });
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

  function handleCriticalFilterChange(value: '' | 'yes' | 'no') {
    clearPendingImageCommit();
    setCriticalFilter(value);
    setPage(1);
    syncRoute({ critical: value });
  }

  function toggleExpand(imageName: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(imageName)) next.delete(imageName);
      else next.add(imageName);
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
    if (!canMutateCurrentScope) return;
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      if (xrayOnlyWithoutRegistries) {
        setCreateError(
          'No Artifactory Xray registry is configured yet. Add one before starting scans.'
        );
        return;
      }
      if (orgFeatureBlockMessage) {
        setCreateError(orgFeatureBlockMessage);
        return;
      }

      const validationError = validateWizardStep(3);
      if (validationError) {
        setCreateError(validationError);
        return;
      }

      const currentScope = getWorkScope();
      let createdScans: Scan[] = [];
      if (scanSource === 'local_archive') {
        if (!uploadedArchiveFile) {
          setCreateError('Upload an OCI/Docker archive file to continue.');
          return;
        }
        const created = await createUploadedArchiveScan({
          archive: uploadedArchiveFile,
          imageName: imageName.trim() || undefined,
          imageTag: imageTag.trim() || undefined,
          platform: platform || undefined,
          orgId: currentScope.kind === 'org' ? currentScope.orgId : undefined,
        });
        createdScans = [created];
      } else {
        const result = await createScans(
          requestedImages,
          scanSource === 'public' ? undefined : registryId || undefined,
          undefined,
          platform || undefined,
          currentScope.kind === 'org' ? currentScope.orgId : undefined,
          selectedRegistryIsXray ? xrayRepository.trim() || undefined : undefined
        );
        createdScans = Array.isArray(result.scans) ? result.scans : [];
      }

      modal.close();
      resetCreateForm();
      toast.success(`${createdScans.length} image${createdScans.length === 1 ? '' : 's'} queued`);
      const firstCreatedScanId = createdScans[0]?.id;
      setExpanded((prev) => {
        const next = new Set(prev);
        createdScans.forEach((scan) => next.add(scan.image_name));
        return next;
      });
      setPage(1);
      await (hasRecentWindow
        ? loadActivity(1, appliedImageFilter, resolvedActivityRange)
        : loadImages(1, appliedImageFilter, statusFilter));
      if (firstCreatedScanId) {
        router.push(`/scans/${firstCreatedScanId}`);
      }
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create scan');
    } finally {
      setCreating(false);
    }
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
        const res = await listScans(1, 10, imageName, undefined, true);
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

  const visibleRows = hasRecentWindow ? filteredActivityScans.length : filteredImages.length;
  const hasClientSideFilters =
    Boolean(tagFilter) || Boolean(criticalFilter) || (hasRecentWindow && Boolean(statusFilter));
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
    Boolean(criticalFilter);
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
              onPress={openCreateModal}
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
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image</Label>
            <Input
              className={inputCls}
              placeholder={
                hasRecentWindow ? 'Filter recent activity by image name…' : 'Filter by image name…'
              }
              value={imageFilter}
              onChange={(e) => handleImageFilterChange(e.target.value)}
            />
          </div>

          <div className="min-w-[180px] space-y-1.5">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Time Window
            </Label>
            <Select
              value={activityRange || '__any__'}
              onChange={(value) => {
                const next = String(value === '__any__' ? '' : (value ?? ''));
                if (!next) {
                  handleActivityRangeClear();
                  return;
                }
                handleActivityRangeChange(next as RecentActivityRange);
              }}
              className="min-w-0"
            >
              <Select.Trigger className="bg-surface-secondary">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__any__">Any time</ListBox.Item>
                  {RECENT_ACTIVITY_RANGE_OPTIONS.map((option) => (
                    <ListBox.Item key={option.id} id={option.id}>
                      {option.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <div className="min-w-[220px] space-y-1.5">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Latest State
            </Label>
            <Select
              value={statusFilter || '__all__'}
              onChange={(value) =>
                handleStatusFilterChange(String(value === '__all__' ? '' : (value ?? '')))
              }
              className="min-w-0"
            >
              <Select.Trigger className="bg-surface-secondary">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">All latest states</ListBox.Item>
                  {STATUS_FILTER_OPTIONS.filter((option) => option.id !== '').map((option) => (
                    <ListBox.Item key={option.id} id={option.id}>
                      {option.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <div className="min-w-[180px] space-y-1.5">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</Label>
            <Select
              value={tagFilter || '__all__'}
              onChange={(value) =>
                handleTagFilterChange(String(value === '__all__' ? '' : (value ?? '')))
              }
              className="min-w-0"
            >
              <Select.Trigger className="bg-surface-secondary">
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
          </div>

          <div className="min-w-[180px] space-y-1.5">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              Has Critical
            </Label>
            <Select
              value={criticalFilter || '__all__'}
              onChange={(value) =>
                handleCriticalFilterChange(
                  (value === '__all__' ? '' : (value ?? '')) as '' | 'yes' | 'no'
                )
              }
              className="min-w-0"
            >
              <Select.Trigger className="bg-surface-secondary">
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
          </div>

          <div className="ml-auto flex min-w-[140px] items-end justify-end">
            {hasActiveFilters ? (
              <Button
                onClick={handleClearFilters}
                className="flex w-full items-center justify-center gap-1.5 md:w-auto"
                variant="secondary"
              >
                <FilterIcon size={12} />
                Clear Filters
              </Button>
            ) : (
              <p className="text-sm text-zinc-500 md:text-right">
                {totalForDisplay}{' '}
                {hasRecentWindow
                  ? `scan event${totalForDisplay !== 1 ? 's' : ''}`
                  : `image${totalForDisplay !== 1 ? 's' : ''}`}
              </p>
            )}
          </div>
        </div>
      </Card>

      {error ? <FormAlert description={error} title="Scan list failed to load" /> : null}

      {/* Bulk action toolbar */}
      {!hasRecentWindow && canMutateCurrentScope && selectedScans.size > 0 && (
        <Card className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {selectedScans.size} scan{selectedScans.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleGenerateReport}
              className="flex flex-1 min-w-[110px] items-center justify-center gap-1.5 sm:flex-none"
              variant="secondary"
            >
              Generate Report
            </Button>
            <Popover>
              <Popover.Trigger>
                <Button variant="secondary">Add Tag</Button>
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
            <Button
              onClick={() => setSelectedScans(new Set())}
              className="flex-1 min-w-[90px] sm:flex-none"
              variant="secondary"
            >
              Clear
            </Button>
            <Button
              onClick={handleBulkDelete}
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
                  hasActiveFilters
                    ? 'No recent scans match your filters'
                    : 'No recent scans in this window'
                }
                description={
                  hasActiveFilters
                    ? 'Try a different filter combination or clear filters.'
                    : 'Choose a wider time window or show all scans.'
                }
                action={{ label: 'Show all scans', onClick: handleClearFilters }}
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
          {/* Tree table */}
          <ImageScansTable
            childRefreshKey={childRefreshKey}
            expanded={expanded}
            hasActiveFilters={hasActiveFilters}
            images={filteredImages}
            loading={loading}
            onCancel={(scanId, imageName) => handleCancel(scanId, imageName)}
            onClearFilters={handleClearFilters}
            onDelete={(scanId, imageName) => handleDelete(scanId, imageName)}
            onExpandedChange={setExpanded}
            onOpenCreateModal={openCreateModal}
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

      {/* Create scan modal */}
      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="w-[min(94vw,72rem)] max-w-none rounded-2xl overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="font-semibold">New Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body>
                <form id="create-scan-form" onSubmit={handleCreate} className="space-y-4">
                  {createError ? (
                    <FormAlert description={createError} title="Scan creation failed" />
                  ) : null}
                  {!createError && orgFeatureBlockMessage ? (
                    <FormAlert
                      title="Scan creation disabled"
                      description={orgFeatureBlockMessage}
                      status="warning"
                    />
                  ) : null}
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
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                          Where is this image hosted?
                        </h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                          Start with the source, then JustScan will only ask for the routing details
                          that matter for that path.
                        </p>
                      </div>

                      <RadioGroup
                        className="grid gap-3 sm:grid-cols-2"
                        name="scan-source"
                        onChange={(value) => selectScanSource(value as ScanSourceKind)}
                        value={scanSource}
                      >
                        {availableScanSourceOptions.map((option) => (
                          <ScanSourceCard
                            key={option.source}
                            description={option.description}
                            eyebrow={option.eyebrow}
                            source={option.source}
                            title={option.title}
                          />
                        ))}
                      </RadioGroup>
                      {availableScanSourceOptions.length === 0 ? (
                        <Card className="bg-surface-secondary">
                          <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                            No scan sources are available yet. Configure an Artifactory Xray
                            registry or enable local Trivy scanning to continue.
                          </p>
                        </Card>
                      ) : null}
                    </div>
                  ) : null}

                  {scanStepIndex === 1 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                          {routingStepTitle}
                        </h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                          {routingStepDescription}
                        </p>
                      </div>

                      {scanSource === 'local_archive' ? (
                        <Card className="bg-surface-secondary">
                          <Label className="text-sm font-medium">Archive scan routing</Label>
                          <p className="text-base font-semibold text-zinc-900 dark:text-white">
                            Local Trivy input mode
                          </p>
                          <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                            JustScan scans the uploaded archive directly and does not route through
                            registry credentials.
                          </p>
                        </Card>
                      ) : null}

                      {scanSource === 'public' ? (
                        <Card className="bg-surface-secondary">
                          <Label className="text-sm font-medium">Public image</Label>
                          <p className="text-base font-semibold text-zinc-900 dark:text-white">
                            No registry or repo selection needed
                          </p>
                          <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                            JustScan will use the image reference from the next step exactly as
                            entered.
                          </p>
                        </Card>
                      ) : null}

                      {scanSource === 'private_registry' ? (
                        <ScanWizardField
                          description="Choose the configured registry that hosts this image so JustScan can authenticate and pull it correctly."
                          label="Private registry"
                        >
                          <Select
                            value={registryId || '__none__'}
                            onChange={(value) =>
                              setRegistryId(String(value === '__none__' ? '' : (value ?? '')))
                            }
                          >
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
                        </ScanWizardField>
                      ) : null}

                      {scanSource === 'artifactory_xray' ? (
                        <div className="space-y-4">
                          <ScanWizardField
                            description="Choose the Xray-backed registry that should resolve and analyze this image."
                            label="Artifactory registry"
                          >
                            <Select
                              value={registryId || '__none__'}
                              onChange={(value) =>
                                setRegistryId(String(value === '__none__' ? '' : (value ?? '')))
                              }
                            >
                              <Select.Trigger className="bg-surface-secondary">
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
                          </ScanWizardField>

                          <ScanWizardField
                            label="Artifactory Repo"
                            optional
                            description={
                              <>
                                Pick a repo like <span className="font-mono">docker-remote</span> so
                                you can scan <span className="font-mono">n8nio/n8n</span> instead of
                                typing <span className="font-mono">docker-remote/n8nio/n8n</span>.
                              </>
                            }
                          >
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
                              <Autocomplete.Trigger className="bg-surface-secondary">
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
                                  <ListBox
                                    renderEmptyState={() => (
                                      <div className="px-3 py-2 text-sm text-zinc-500">
                                        No matching repositories
                                      </div>
                                    )}
                                  >
                                    <ListBox.Item id="__none__" textValue="No repo override">
                                      No repo override
                                    </ListBox.Item>
                                    {selectedRegistryRepositories.map((repository) => (
                                      <ListBox.Item
                                        key={repository.key}
                                        id={repository.key}
                                        textValue={`${repository.key} ${repository.class ?? ''}`.trim()}
                                      >
                                        {repository.key}
                                        {repository.class ? ` · ${repository.class}` : ''}
                                      </ListBox.Item>
                                    ))}
                                    <ListBox.Item id="__manual__" textValue="Enter manually">
                                      Enter manually
                                    </ListBox.Item>
                                  </ListBox>
                                </Autocomplete.Filter>
                              </Autocomplete.Popover>
                            </Autocomplete>
                            {selectedRegistry &&
                            artifactoryRepositoriesLoading === selectedRegistry.id ? (
                              <p className="text-xs text-zinc-500">
                                Loading available Artifactory repos…
                              </p>
                            ) : null}
                            {selectedRegistryRepositoriesError ? (
                              <p className="text-xs" style={{ color: '#f59e0b' }}>
                                {selectedRegistryRepositoriesError}. You can still enter the repo
                                manually.
                              </p>
                            ) : null}
                            {useManualXrayRepository || !!selectedRegistryRepositoriesError ? (
                              <FormField
                                className="font-mono"
                                description="Manual fallback when the repo list is unavailable or you need a repo key that is not listed."
                                label="Manual Artifactory Repo"
                                onChange={(event) => setXrayRepository(event.target.value)}
                                placeholder="docker-remote"
                                value={xrayRepository}
                              />
                            ) : null}
                          </ScanWizardField>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {scanStepIndex === 2 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                          {detailsStepTitle}
                        </h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                          {detailsStepDescription}
                        </p>
                      </div>

                      {scanSource === 'local_archive' ? (
                        <ScanWizardField
                          label="Image archive"
                          description="Accepted formats: .tar, .tar.gz, .tgz. Maximum size: 5 GB."
                        >
                          <Input
                            className={inputCls}
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              setUploadedArchiveFile(file);
                            }}
                            type="file"
                            accept=".tar,.tar.gz,.tgz,application/x-tar,application/gzip"
                          />
                          {uploadedArchiveFile ? (
                            <p className="text-xs text-zinc-500">
                              Selected: {uploadedArchiveFile.name}
                            </p>
                          ) : null}
                        </ScanWizardField>
                      ) : null}

                      <FormField
                        className="bg-surface-secondary"
                        label={scanSource === 'local_archive' ? 'Display Name' : 'Image Name'}
                        onChange={(e) => setImageName(e.target.value)}
                        placeholder="nginx or n8nio/n8n"
                        required={scanSource !== 'local_archive'}
                        value={imageName}
                      />
                      <FormField
                        className="bg-surface-secondary"
                        label="Tag"
                        onChange={(e) => setImageTag(e.target.value)}
                        placeholder="latest"
                        required={scanSource !== 'local_archive'}
                        value={imageTag}
                      />

                      <div className="space-y-4 rounded-2xl border border-surface-border bg-surface-secondary p-4">
                        <div
                          aria-expanded={advancedOptionsOpen}
                          className="flex w-full items-start justify-between gap-4 text-left"
                        >
                          <div className="space-y-1">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                              Advanced options
                            </p>
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                              Optional scan settings for multiple images or platform-specific
                              artifacts.
                            </p>
                          </div>
                          <Button
                            onClick={() => setAdvancedOptionsOpen((current) => !current)}
                            variant="secondary"
                            className="mt-0.5 flex size-8 items-center justify-center rounded-full border border-zinc-200/50 dark:border-zinc-700/60"
                          >
                            {advancedOptionsOpen ? (
                              <ArrowDown01Icon size={16} />
                            ) : (
                              <ArrowRight01Icon size={16} />
                            )}
                          </Button>
                        </div>

                        {advancedOptionsOpen ? (
                          <div className="space-y-4">
                            {scanSource !== 'local_archive' ? (
                              <ScanWizardField
                                description="Paste one or many full image references, separated by commas or new lines. Anything still in this box is included when you continue."
                                label="Additional Images"
                                optional
                              >
                                <TextArea
                                  className={joinClassNames(
                                    inputCls,
                                    'min-h-24 bg-surface resize-y'
                                  )}
                                  placeholder={
                                    'Paste one or more full image references here\nExample: ghcr.io/example/api:1.2.3, registry.example.com/team/worker:latest'
                                  }
                                  value={additionalImageDraft}
                                  onChange={(e) => setAdditionalImageDraft(e.target.value)}
                                />
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    className="shrink-0"
                                    onClick={addAdditionalImagesFromDraft}
                                  >
                                    Add{' '}
                                    {pendingAdditionalImages.length > 1
                                      ? `${pendingAdditionalImages.length} refs`
                                      : 'to list'}
                                  </Button>
                                </div>
                                {additionalImageEntries.length > 0 ? (
                                  <div
                                    className="rounded-2xl p-3"
                                    style={{
                                      background: 'rgba(255,255,255,0.03)',
                                      border: '1px solid var(--surface-border)',
                                    }}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-xs font-medium text-zinc-500">
                                        Queued additional images
                                      </p>
                                      <span
                                        className="rounded-full px-2 py-0.5 text-xs font-medium text-zinc-500"
                                        style={{
                                          background: 'rgba(255,255,255,0.05)',
                                          border: '1px solid var(--surface-border)',
                                        }}
                                      >
                                        {additionalImageEntries.length}
                                      </span>
                                    </div>
                                    <div className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                                      {additionalImageEntries.map((image) => (
                                        <div
                                          key={image}
                                          className="flex items-start justify-between gap-3 rounded-xl px-3 py-2"
                                          style={{
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid var(--surface-border)',
                                          }}
                                        >
                                          <span className="min-w-0 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
                                            {image}
                                          </span>
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
                              </ScanWizardField>
                            ) : null}

                            <ScanWizardField label="Platform" optional>
                              <Select
                                value={platform || '__auto__'}
                                onChange={(value) =>
                                  setPlatform(String(value === '__auto__' ? '' : (value ?? '')))
                                }
                              >
                                <Select.Trigger>
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
                            </ScanWizardField>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-500">
                            Collapsed by default. Open this only if you want to queue more images or
                            force a platform.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {scanStepIndex === 3 ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                          Review &amp; start
                        </h2>
                        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                          Everything is ready. Start the scan and we will open its detail page right
                          away.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <Card className="bg-surface-secondary">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                            Source
                          </p>
                          <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                            {scanSource === 'artifactory_xray'
                              ? 'Artifactory Xray'
                              : scanSource === 'private_registry'
                                ? 'Private registry'
                                : scanSource === 'local_archive'
                                  ? 'Local archive'
                                  : 'Public / Docker Hub'}
                          </p>
                        </Card>

                        <Card className="bg-surface-secondary">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                            Target
                          </p>
                          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">
                            {scanSource === 'local_archive'
                              ? uploadedArchiveFile?.name || 'Archive upload'
                              : primaryImage || `${requestedImages.length} image targets`}
                          </p>
                        </Card>

                        <Card className="bg-surface-secondary">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                            Routing
                          </p>
                          <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                            {scanSource === 'public' || scanSource === 'local_archive'
                              ? 'Direct'
                              : selectedRegistry?.name || 'Registry selected'}
                          </p>
                        </Card>
                      </div>

                      <div className="relative flex min-h-56 items-center justify-center px-6 py-10">
                        <div className="flex flex-col items-center justify-center gap-5 text-center">
                          <p className="text-sm text-zinc-600 dark:text-zinc-300">
                            Start now and jump directly into live scan progress.
                          </p>
                          <div className="relative">
                            <Button
                              key="wizard-submit-inline"
                              type="submit"
                              form="create-scan-form"
                              isDisabled={
                                creating ||
                                !canMutateCurrentScope ||
                                xrayOnlyWithoutRegistries ||
                                Boolean(orgFeatureBlockMessage)
                              }
                              variant="primary"
                              className="group relative inline-flex min-w-52 items-center justify-center gap-2 overflow-hidden px-7 py-3 text-base font-semibold shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
                            >
                              {!creating ? (
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                                />
                              ) : null}
                              {creating ? (
                                <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <ArrowRight01Icon
                                  aria-hidden
                                  className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
                                />
                              )}
                              <span className="relative">
                                {creating ? 'Starting scan…' : 'Start Scan'}
                              </span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </form>
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-zinc-500">
                    Step {scanStepIndex + 1} of {SCAN_WIZARD_STEPS.length}
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <Button onClick={modal.close} variant="outline">
                      Cancel
                    </Button>
                    {scanStepIndex > 0 ? (
                      <Button onClick={handleWizardBack} variant="secondary">
                        Back
                      </Button>
                    ) : null}
                    {scanStepIndex < SCAN_WIZARD_STEPS.length - 1 ? (
                      <Button key="wizard-continue" onClick={handleWizardNext}>
                        Continue
                      </Button>
                    ) : scanStepIndex !== 3 ? (
                      <Button
                        key="wizard-submit"
                        type="submit"
                        form="create-scan-form"
                        isDisabled={
                          creating ||
                          !canMutateCurrentScope ||
                          xrayOnlyWithoutRegistries ||
                          Boolean(orgFeatureBlockMessage)
                        }
                        variant="primary"
                        className="inline-flex items-center gap-2"
                      >
                        {creating && (
                          <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        )}
                        Start Scan
                      </Button>
                    ) : null}
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
