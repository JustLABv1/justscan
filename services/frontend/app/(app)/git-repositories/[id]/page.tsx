'use client';

import { DiscoveryReviewTable } from '@/components/git-repositories/discovery-review-table';

import {
  Accordion,
  buttonVariants,
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Dropdown,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Spinner,
  TextArea,
  Tabs,
  Table,
  useOverlayState,
} from '@/components/ui';
import {
  Cancel01Icon,
  Clock01Icon,
  Delete01Icon,
  Download01Icon,
  Folder01Icon,
  GitBranchIcon,
  MoreVerticalIcon,
  PackageIcon,
  Search01Icon,
  Settings02Icon,
} from 'hugeicons-react';
import { FileCode2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { StatCard } from '@/components/ui/stat-card';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import {
  cancelGitRepositoryRun,
  createGitRepositoryDiscoveryRule,
  createGitRepositoryHelmSource,
  createGitRepositoryImageExclusion,
  deleteGitRepositoryHelmSource,
  deleteGitRepositoryImageExclusion,
  deleteGitRepositoryImageRegistryOverride,
  deleteGitRepositoryImageRegistryOverrideRule,
  discoverGitRepository,
  exportGitRepositoryDiscoveryRules,
  getGitRepository,
  getGitRepositoryRun,
  listGitRepositories,
  listGitRepositoryCandidates,
  listGitRepositoryHelmSources,
  listGitRepositoryImageExclusions,
  listGitRepositoryImageRegistryOverrides,
  listGitRepositoryImageRegistryOverrideRules,
  listGitRepositoryLatestImageScans,
  listGitRepositoryRuns,
  listHelmRegistryCredentials,
  listRegistries,
  runGitRepository,
  setGitRepositoryImageRegistryOverride,
  setGitRepositoryImageRegistryOverrideRule,
  updateGitRepositoryHelmSource,
  type GitRepository,
  type GitRepositoryDiscoveryMode,
  type GitRepositoryHelmSource,
  type GitRepositoryHelmSourceInput,
  type GitRepositoryImageExclusion,
  type GitRepositoryImageRegistryOverride,
  type GitRepositoryImageRegistryOverrideRule,
  type GitRepositoryLatestImageScan,
  type GitRepositoryRun,
  type GitRepositoryRunCandidate,
  type GitRepositoryRunImage,
  type HelmRegistryCredential,
  type Registry,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';

type Preview = { run: GitRepositoryRun; images: GitRepositoryRunImage[] };

type HelmSourceMode = 'local' | 'repository' | 'url';

function HelmCredentialSelect({
  credentials,
  value,
  onChange,
}: {
  credentials: HelmRegistryCredential[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label="Helm registry credential"
      value={value || 'automatic'}
      onChange={(nextValue) => onChange(nextValue === 'automatic' ? '' : String(nextValue))}
      variant="secondary"
    >
      <Label>Helm registry credential</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="automatic">Automatic matching</ListBox.Item>
          {credentials.map((credential) => (
            <ListBox.Item id={credential.id} key={credential.id} textValue={credential.name}>
              <div className="flex min-w-0 flex-col items-start gap-0.5">
                <Label>{credential.name}</Label>
                <Description className="!block break-all">
                  {credential.protocol.toUpperCase()} · {credential.url}
                </Description>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <Description>
        Select a Helm-only credential, or use automatic matching. Image registries are never used.
      </Description>
    </Select>
  );
}

function ImageRegistrySelect({
  registries,
  value,
  onChange,
  isDisabled,
}: {
  registries: Registry[];
  value: string | null;
  onChange: (value: string | null) => void;
  isDisabled?: boolean;
}) {
  return (
    <Select
      aria-label="Image registry and credential"
      className="w-full sm:max-w-xl"
      isDisabled={isDisabled}
      value={value ?? 'automatic'}
      onChange={(nextValue) =>
        onChange(nextValue && String(nextValue) !== 'automatic' ? String(nextValue) : null)
      }
      variant="secondary"
    >
      <Label>Image registry / credential</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="automatic" textValue="Automatic matching">
            <div className="flex min-w-0 flex-col items-start gap-0.5">
              <Label>Automatic matching</Label>
              <Description className="!block">
                Match a configured image host; leave an unconfigured host as entered.
              </Description>
            </div>
            <ListBox.ItemIndicator />
          </ListBox.Item>
          {registries.map((registry) => (
            <ListBox.Item
              id={registry.id}
              key={registry.id}
              textValue={`${registry.name} ${registry.url}`}
            >
              <div className="flex min-w-0 flex-col items-start gap-0.5">
                <Label>{registry.name}</Label>
                <Description className="!block break-all">
                  {registry.url} ·{' '}
                  {registry.scan_provider === 'artifactory_xray' ? 'Xray' : 'Trivy'}
                </Description>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <Description>
        Choose another configured registry entry when this image needs a different endpoint or
        token. This selector uses saved JustScan entries; add a new credential from Registries.
      </Description>
    </Select>
  );
}

function imageRepositoryRegistryPattern(fullRef: string) {
  const digestIndex = fullRef.indexOf('@');
  const taggedRef = digestIndex >= 0 ? fullRef.slice(0, digestIndex) : fullRef;
  const lastSlash = taggedRef.lastIndexOf('/');
  const lastColon = taggedRef.lastIndexOf(':');
  const repository = lastColon > lastSlash ? taggedRef.slice(0, lastColon) : taggedRef;
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escapedRepository}(?::[^/]+|@.+)?$`;
}

function imageRegistryRuleMatches(pattern: string, fullRef: string) {
  try {
    return new RegExp(pattern).test(fullRef);
  } catch {
    return false;
  }
}

function imageRegistryHost(imageRef: string): string | null {
  const trimmed = imageRef.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed.includes('/')) return null;
  const firstSegment = trimmed.split('/')[0]?.toLowerCase() ?? '';
  if (
    !firstSegment ||
    (firstSegment !== 'localhost' && !firstSegment.includes('.') && !firstSegment.includes(':'))
  ) {
    return null;
  }
  return firstSegment;
}

function RegistryResolutionSummary({
  image,
  override,
  overrideRegistry,
  inferredRegistry,
}: {
  image: GitRepositoryRunImage;
  override?: GitRepositoryImageRegistryOverride;
  overrideRegistry?: Registry;
  inferredRegistry?: Registry;
}) {
  const host = imageRegistryHost(image.full_ref);

  if (override) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip className="shrink-0" color="accent" size="sm" variant="soft">
            Configured override
          </Chip>
          {host ? <code className="truncate text-xs text-muted-foreground">{host}</code> : null}
        </div>
        <Description className="!block">
          {overrideRegistry
            ? `This image is pinned to the configured ${overrideRegistry.name} registry entry.`
            : 'This image has an override for a registry entry that is not available in the current workspace.'}
        </Description>
      </div>
    );
  }

  if (image.registry_id) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            className="shrink-0"
            color={inferredRegistry ? 'accent' : 'warning'}
            size="sm"
            variant="soft"
          >
            {inferredRegistry ? 'Configured match' : 'Configured match unavailable'}
          </Chip>
          {host ? <code className="truncate text-xs text-muted-foreground">{host}</code> : null}
        </div>
        <Description className="!block">
          {inferredRegistry
            ? `Automatic matching selected the configured ${inferredRegistry.name} registry entry${host ? ` for ${host}` : ''}.`
            : 'Automatic matching found a configured registry entry, but it is not available in the current workspace view.'}
        </Description>
      </div>
    );
  }

  if (host) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip className="shrink-0" color="warning" size="sm" variant="soft">
            Custom / unconfigured host
          </Chip>
          <code className="truncate text-xs text-muted-foreground">{host}</code>
        </div>
        <Description className="!block">
          No JustScan registry entry matches this host. Automatic matching keeps the original host;
          add a registry entry from Registries if this image needs credentials.
        </Description>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Chip className="shrink-0" size="sm" variant="soft">
        Default matching
      </Chip>
      <Description className="!block">
        This image reference has no explicit registry host. Automatic matching uses the default
        Docker Hub behavior when a matching entry is available.
      </Description>
    </div>
  );
}

function locationsFor(image: GitRepositoryRunImage) {
  return image.locations?.items ?? [];
}

function discoveryModeLabel(mode: GitRepositoryDiscoveryMode) {
  switch (mode) {
    case 'kustomize':
      return 'Kustomize entrypoints';
    case 'manifests':
      return 'Plain Kubernetes manifests';
    case 'registry':
      return 'Registry references';
    case 'gitlab_ci':
      return 'GitLab CI configuration';
    default:
      return 'Automatic discovery';
  }
}

function registryDiscoverySource(repository: GitRepository, registries: Registry[]) {
  if (repository.discovery_registry_id) {
    const registry = registries.find((item) => item.id === repository.discovery_registry_id);
    if (registry) return `configured registry “${registry.name}” (${registry.url})`;
    return 'a configured registry that is not available in this workspace';
  }
  if (repository.discovery_registry?.trim()) {
    return `custom registry prefix “${repository.discovery_registry.trim()}”`;
  }
  return 'an unconfigured registry source';
}

function targetGroup(
  target: string,
  discoveryMode?: GitRepositoryDiscoveryMode,
  locationKind?: string
) {
  if (target.startsWith('Helm chart ')) {
    return { label: 'Helm', path: target.slice('Helm chart '.length) };
  }
  if (target.startsWith('Helm values ')) {
    return { label: 'Helm', path: target.slice('Helm values '.length) };
  }
  if (discoveryMode === 'registry' || /registry/i.test(locationKind ?? '')) {
    return { label: 'Registry references', path: target };
  }
  if (/kustomization\.ya?ml$/i.test(target)) {
    return { label: 'Kustomize', path: target };
  }
  if (discoveryMode === 'gitlab_ci' || locationKind === 'GitLabCI') {
    return { label: 'GitLab CI', path: target };
  }
  return { label: 'Manifests', path: target };
}

export default function GitRepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detailView, setDetailView] = useState('images');
  const router = useRouter();
  const [repository, setRepository] = useState<GitRepository | null>(null);
  const [runs, setRuns] = useState<GitRepositoryRun[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [candidates, setCandidates] = useState<GitRepositoryRunCandidate[]>([]);
  const [reviewing, setReviewing] = useState<GitRepositoryRunCandidate | null>(null);
  const [resolution, setResolution] = useState<'helm' | 'kustomize' | 'manifests' | 'ignore'>(
    'helm'
  );
  const [chart, setChart] = useState('');
  const [values, setValues] = useState('');
  const [helmSourceType, setHelmSourceType] = useState<HelmSourceMode>('local');
  const [chartRepositoryID, setChartRepositoryID] = useState('');
  const [chartCloneURL, setChartCloneURL] = useState('');
  const [chartRef, setChartRef] = useState('HEAD');
  const [chartAuthType, setChartAuthType] = useState<'none' | 'token' | 'basic'>('none');
  const [chartUsername, setChartUsername] = useState('');
  const [chartCredential, setChartCredential] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const [helmRegistryCredentialID, setHelmRegistryCredentialID] = useState<string | null>(null);
  const helmCredentialSelectionTouched = useRef(false);
  const [imageSearch, setImageSearch] = useState('');
  const [helmSources, setHelmSources] = useState<GitRepositoryHelmSource[]>([]);
  const [availableRepositories, setAvailableRepositories] = useState<GitRepository[]>([]);
  const [availableHelmCredentials, setAvailableHelmCredentials] = useState<
    HelmRegistryCredential[]
  >([]);
  const [editingHelmSource, setEditingHelmSource] = useState<GitRepositoryHelmSource | null>(null);
  const [selectedCandidateIDs, setSelectedCandidateIDs] = useState<Set<string>>(new Set());
  const [selectedImageRefs, setSelectedImageRefs] = useState<Set<string>>(new Set());
  const [imageExclusions, setImageExclusions] = useState<GitRepositoryImageExclusion[]>([]);
  const [imageRegistryOverrides, setImageRegistryOverrides] = useState<
    GitRepositoryImageRegistryOverride[]
  >([]);
  const [imageRegistryOverrideRules, setImageRegistryOverrideRules] = useState<
    GitRepositoryImageRegistryOverrideRule[]
  >([]);
  const [registryRulePattern, setRegistryRulePattern] = useState('');
  const [registryRuleRegistryID, setRegistryRuleRegistryID] = useState('');
  const [registryRuleError, setRegistryRuleError] = useState('');
  const [savingRegistryRule, setSavingRegistryRule] = useState(false);
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [latestImageScans, setLatestImageScans] = useState<GitRepositoryLatestImageScan[]>([]);
  const reviewOverlay = useOverlayState();
  const helmSourceOverlay = useOverlayState();
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [ignoringCandidates, setIgnoringCandidates] = useState(false);
  const [startingScan, setStartingScan] = useState(false);
  const [cancellingRun, setCancellingRun] = useState(false);
  const [updatingImageExclusions, setUpdatingImageExclusions] = useState(false);
  const [savingImageRegistryRef, setSavingImageRegistryRef] = useState<string | null>(null);
  const [savingHelmSource, setSavingHelmSource] = useState(false);
  const { success, error } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        nextRepository,
        nextRuns,
        nextExclusions,
        nextImageRegistryOverrides,
        nextImageRegistryOverrideRules,
        nextRegistries,
        nextLatestImageScans,
        nextHelmSources,
        nextCredentials,
      ] = await Promise.all([
        getGitRepository(id),
        listGitRepositoryRuns(id),
        listGitRepositoryImageExclusions(id),
        listGitRepositoryImageRegistryOverrides(id),
        listGitRepositoryImageRegistryOverrideRules(id),
        listRegistries().catch(() => []),
        listGitRepositoryLatestImageScans(id),
        listGitRepositoryHelmSources(id),
        listHelmRegistryCredentials().catch(() => []),
      ]);
      setRepository(nextRepository);
      setRuns(nextRuns);
      setImageExclusions(nextExclusions);
      setImageRegistryOverrides(nextImageRegistryOverrides);
      setImageRegistryOverrideRules(nextImageRegistryOverrideRules);
      setRegistries(nextRegistries);
      setLatestImageScans(nextLatestImageScans);
      setHelmSources(nextHelmSources);
      setAvailableHelmCredentials(nextCredentials);
      const latestDryRun = nextRuns.find((run) => run.trigger === 'dry_run');
      if (latestDryRun) {
        const [nextPreview, nextCandidates] = await Promise.all([
          getGitRepositoryRun(id, latestDryRun.id),
          listGitRepositoryCandidates(id, latestDryRun.id),
        ]);
        setPreview(nextPreview);
        setCandidates(nextCandidates);
      }
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not load Git repository.');
    } finally {
      setLoading(false);
    }
  }, [error, id]);

  useEffect(() => deferEffect(() => void load()), [load]);

  const activeRun = runs.find((run) => ['queued', 'discovering', 'scanning'].includes(run.status));
  const hasActiveRun = Boolean(activeRun);

  useEffect(() => {
    if (!hasActiveRun) return;
    const refresh = () => {
      void Promise.all([listGitRepositoryRuns(id), listGitRepositoryLatestImageScans(id)])
        .then(([nextRuns, nextLatestImageScans]) => {
          setRuns(nextRuns);
          setLatestImageScans(nextLatestImageScans);
        })
        .catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(interval);
  }, [hasActiveRun, id]);

  async function discover() {
    setDiscovering(true);
    try {
      const result = await discoverGitRepository(id);
      setPreview({
        run: result.run,
        images: (result.images ?? []).map((image) => ({
          ...image,
          id: image.full_ref,
          run_id: result.run.id,
          locations: { items: image.locations },
          state: 'discovered',
        })),
      });
      setRuns((current) => [result.run, ...current]);
      setCandidates(await listGitRepositoryCandidates(id, result.run.id));
      setLatestImageScans(await listGitRepositoryLatestImageScans(id));
      setSelectedCandidateIDs(new Set());
      success(`Dry run completed: ${(result.images ?? []).length} images discovered.`);
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Dry run failed.');
    } finally {
      setDiscovering(false);
    }
  }

  function review(candidate: GitRepositoryRunCandidate) {
    setReviewing(candidate);
    setResolution(candidate.detected_type.startsWith('helm') ? 'helm' : 'manifests');
    setChart('');
    setValues(candidate.detected_type === 'helm_values' ? candidate.path : '');
    setHelmSourceType('local');
    setChartRepositoryID('');
    setChartCloneURL('');
    setChartRef('HEAD');
    setChartAuthType('none');
    setChartUsername('');
    setChartCredential('');
    setHelmRegistryCredentialID(null);
    helmCredentialSelectionTouched.current = false;
    setReleaseName('');
    void Promise.all([listGitRepositories(), listHelmRegistryCredentials().catch(() => [])])
      .then(([nextRepositories, nextCredentials]) => {
        setAvailableRepositories(nextRepositories);
        setAvailableHelmCredentials(nextCredentials);
      })
      .catch(() => undefined);
    reviewOverlay.open();
  }

  async function saveResolution() {
    if (!reviewing) return;
    if (resolution === 'helm' && !chart.trim()) {
      error('Enter the local Helm chart path before saving this rule.');
      return;
    }
    const config =
      resolution === 'kustomize' || resolution === 'manifests' ? { paths: [reviewing.path] } : {};
    try {
      if (resolution === 'helm') {
        const source = helmSourcePayload();
        await createGitRepositoryHelmSource(id, source);
        setHelmSources(await listGitRepositoryHelmSources(id));
      } else {
        await createGitRepositoryDiscoveryRule(id, {
          path_pattern: reviewing.path,
          resolution,
          config,
        });
      }
      reviewOverlay.close();
      success(
        resolution === 'helm'
          ? 'Helm source saved. Running a new dry discovery.'
          : 'Discovery rule saved. Running a new dry discovery.'
      );
      await discover();
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not save discovery rule.');
    }
  }

  function helmSourcePayload(): GitRepositoryHelmSourceInput {
    const source: GitRepositoryHelmSourceInput = {
      source_type: helmSourceType,
      chart_path: chart.trim(),
      values: values
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
      release_name: releaseName.trim(),
      helm_registry_credential_id:
        editingHelmSource?.dependency_registry_id && !helmCredentialSelectionTouched.current
          ? undefined
          : helmRegistryCredentialID,
    };
    if (helmSourceType === 'repository') source.chart_repository_id = chartRepositoryID;
    if (helmSourceType === 'url') {
      source.clone_url = chartCloneURL.trim();
      source.ref = chartRef.trim() || 'HEAD';
      source.auth_type = chartAuthType;
      source.username = chartUsername.trim();
      if (chartCredential) source.credential = chartCredential;
    }
    return source;
  }

  async function openHelmSourceEditor(source?: GitRepositoryHelmSource) {
    setEditingHelmSource(source ?? null);
    setHelmSourceType(source?.source_type ?? 'local');
    setChartRepositoryID(source?.chart_repository_id ?? '');
    setChartCloneURL(source?.clone_url ?? '');
    setChartRef(source?.ref ?? 'HEAD');
    setChartAuthType(source?.auth_type ?? 'none');
    setChartUsername(source?.username ?? '');
    setChartCredential('');
    setHelmRegistryCredentialID(
      source?.helm_registry_credential_id ?? (source?.dependency_registry_id ? null : null)
    );
    helmCredentialSelectionTouched.current = false;
    setChart(source?.chart_path ?? '');
    setValues(source?.values.join('\n') ?? '');
    setReleaseName(source?.release_name ?? '');
    try {
      const [nextRepositories, nextCredentials] = await Promise.all([
        listGitRepositories(),
        listHelmRegistryCredentials().catch(() => []),
      ]);
      setAvailableRepositories(nextRepositories);
      setAvailableHelmCredentials(nextCredentials);
      helmSourceOverlay.open();
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not load chart repositories.');
    }
  }

  async function saveHelmSource() {
    if (!chart.trim()) {
      error('Enter the Helm chart path before saving this source.');
      return;
    }
    if (helmSourceType === 'repository' && !chartRepositoryID) {
      error('Select the registered chart repository.');
      return;
    }
    if (helmSourceType === 'url' && !chartCloneURL.trim()) {
      error('Enter the chart repository URL.');
      return;
    }
    setSavingHelmSource(true);
    try {
      const source = helmSourcePayload();
      if (editingHelmSource) {
        await updateGitRepositoryHelmSource(id, editingHelmSource.id, source);
      } else {
        await createGitRepositoryHelmSource(id, source);
      }
      setHelmSources(await listGitRepositoryHelmSources(id));
      helmSourceOverlay.close();
      success('Helm source saved. Run a dry discovery to apply it.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not save Helm source.');
    } finally {
      setSavingHelmSource(false);
    }
  }

  async function removeHelmSource(source: GitRepositoryHelmSource) {
    const confirmed = await confirm({
      title: 'Remove Helm source?',
      message: `This stops discovering workloads rendered by ${source.chart_path}.`,
      confirmLabel: 'Remove source',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteGitRepositoryHelmSource(id, source.id);
      setHelmSources((current) => current.filter((item) => item.id !== source.id));
      success('Helm source removed.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not remove Helm source.');
    }
  }

  function toggleCandidate(candidateID: string, isSelected: boolean) {
    setSelectedCandidateIDs((current) => {
      const next = new Set(current);
      if (isSelected) next.add(candidateID);
      else next.delete(candidateID);
      return next;
    });
  }

  function toggleAllPending(
    isSelected: boolean,
    ids = pendingCandidates.map((candidate) => candidate.id)
  ) {
    setSelectedCandidateIDs((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (isSelected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleImage(imageRef: string, isSelected: boolean) {
    setSelectedImageRefs((current) => {
      const next = new Set(current);
      if (isSelected) next.add(imageRef);
      else next.delete(imageRef);
      return next;
    });
  }

  function toggleAllImages(isSelected: boolean) {
    setSelectedImageRefs((current) => {
      const next = new Set(current);
      for (const image of filteredSelectableImages) {
        if (isSelected) next.add(image.full_ref);
        else next.delete(image.full_ref);
      }
      return next;
    });
  }

  async function ignoreSelectedCandidates() {
    const selected = pendingCandidates.filter((candidate) =>
      selectedCandidateIDs.has(candidate.id)
    );
    if (selected.length === 0) return;
    setIgnoringCandidates(true);
    try {
      await Promise.all(
        selected.map((candidate) =>
          createGitRepositoryDiscoveryRule(id, {
            path_pattern: candidate.path,
            resolution: 'ignore',
            config: {},
          })
        )
      );
      setSelectedCandidateIDs(new Set());
      success(`${selected.length} paths ignored. Running one new dry discovery.`);
      await discover();
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not ignore the selected paths.');
    } finally {
      setIgnoringCandidates(false);
    }
  }

  async function startScan(selectedImages?: string[]) {
    if (selectedImages && selectedImages.length === 0) return;
    setStartingScan(true);
    try {
      const run = await runGitRepository(id, { policy: 'all', selected_images: selectedImages });
      setRuns((current) => [run, ...current]);
      setSelectedImageRefs(new Set());
      success(
        selectedImages
          ? `${selectedImages.length} selected image scans queued.`
          : 'Full repository scan queued.'
      );
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not start repository scan.');
    } finally {
      setStartingScan(false);
    }
  }

  async function cancelActiveRun() {
    if (!activeRun) return;
    const confirmed = await confirm({
      title: 'Cancel repository scan?',
      message:
        'This stops the repository run and cancels any queued or running image scans. Completed scans remain available.',
      confirmLabel: 'Cancel scan',
      variant: 'danger',
    });
    if (!confirmed) return;
    setCancellingRun(true);
    try {
      const cancelled = await cancelGitRepositoryRun(id, activeRun.id);
      setRuns((current) => current.map((run) => (run.id === cancelled.id ? cancelled : run)));
      setLatestImageScans(await listGitRepositoryLatestImageScans(id));
      success('Repository scan cancelled.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not cancel repository scan.');
    } finally {
      setCancellingRun(false);
    }
  }

  async function excludeImages(refs: string[]) {
    if (refs.length === 0) return;
    setUpdatingImageExclusions(true);
    try {
      await Promise.all(refs.map((ref) => createGitRepositoryImageExclusion(id, ref)));
      setImageExclusions(await listGitRepositoryImageExclusions(id));
      setSelectedImageRefs(new Set());
      success(
        `${refs.length} image${refs.length === 1 ? '' : 's'} excluded from future repository scans.`
      );
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not exclude the selected images.');
    } finally {
      setUpdatingImageExclusions(false);
    }
  }

  async function reenableImage(exclusion: GitRepositoryImageExclusion) {
    setUpdatingImageExclusions(true);
    try {
      await deleteGitRepositoryImageExclusion(id, exclusion.id);
      setImageExclusions((current) => current.filter((item) => item.id !== exclusion.id));
      success('Image re-enabled for future repository scans.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not re-enable this image.');
    } finally {
      setUpdatingImageExclusions(false);
    }
  }

  async function updateImageRegistry(imageRef: string, registryID: string | null) {
    const current = imageRegistryOverrides.find((override) => override.full_ref === imageRef);
    const matchingRule = imageRegistryOverrideRules.find((rule) =>
      imageRegistryRuleMatches(rule.pattern, imageRef)
    );
    if (!registryID && !current && !matchingRule) return;
    if (!registryID && matchingRule) {
      const matchedImageCount = (preview?.images ?? []).filter((image) =>
        imageRegistryRuleMatches(matchingRule.pattern, image.full_ref)
      ).length;
      if (
        matchedImageCount > 1 &&
        !(await confirm({
          title: 'Remove registry pattern?',
          message: `This pattern currently matches ${matchedImageCount} discovered images. Removing it clears the registry override for all of them and future matching refs.`,
          confirmLabel: 'Remove pattern',
          variant: 'danger',
        }))
      ) {
        return;
      }
    }
    setSavingImageRegistryRef(imageRef);
    try {
      if (registryID) {
        const pattern = imageRepositoryRegistryPattern(imageRef);
        const [override, rule] = await Promise.all([
          setGitRepositoryImageRegistryOverride(id, imageRef, registryID),
          setGitRepositoryImageRegistryOverrideRule(id, pattern, registryID),
        ]);
        setImageRegistryOverrides((overrides) => [
          override,
          ...overrides.filter((item) => item.full_ref !== imageRef),
        ]);
        setImageRegistryOverrideRules((rules) => [
          rule,
          ...rules.filter((item) => item.pattern !== pattern),
        ]);
        success('Registry override saved for this image and future tags.');
      } else {
        if (current) {
          await deleteGitRepositoryImageRegistryOverride(id, current.id);
          setImageRegistryOverrides((overrides) =>
            overrides.filter((item) => item.id !== current.id)
          );
        }
        if (matchingRule) {
          await deleteGitRepositoryImageRegistryOverrideRule(id, matchingRule.id);
          setImageRegistryOverrideRules((rules) =>
            rules.filter((item) => item.id !== matchingRule.id)
          );
        }
        success('Image registry override cleared.');
      }
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not update the image registry.');
      void load();
    } finally {
      setSavingImageRegistryRef(null);
    }
  }

  async function saveImageRegistryOverrideRule(event: React.FormEvent) {
    event.preventDefault();
    const pattern = registryRulePattern.trim();
    if (!pattern || !registryRuleRegistryID) {
      setRegistryRuleError('Enter a pattern and choose a registry.');
      return;
    }
    try {
      new RegExp(pattern);
    } catch {
      setRegistryRuleError('Enter a valid regular expression.');
      return;
    }
    setSavingRegistryRule(true);
    setRegistryRuleError('');
    try {
      const rule = await setGitRepositoryImageRegistryOverrideRule(
        id,
        pattern,
        registryRuleRegistryID
      );
      setImageRegistryOverrideRules((rules) => [
        rule,
        ...rules.filter((item) => item.pattern !== pattern),
      ]);
      setRegistryRulePattern('');
      success('Registry pattern saved.');
    } catch (caught) {
      setRegistryRuleError(
        caught instanceof Error ? caught.message : 'Could not save the registry pattern.'
      );
    } finally {
      setSavingRegistryRule(false);
    }
  }

  async function removeImageRegistryOverrideRule(rule: GitRepositoryImageRegistryOverrideRule) {
    const matchedImageCount = (preview?.images ?? []).filter((image) =>
      imageRegistryRuleMatches(rule.pattern, image.full_ref)
    ).length;
    if (
      matchedImageCount > 1 &&
      !(await confirm({
        title: 'Remove registry pattern?',
        message: `This pattern currently matches ${matchedImageCount} discovered images. Removing it clears the registry override for all of them and future matching refs.`,
        confirmLabel: 'Remove pattern',
        variant: 'danger',
      }))
    ) {
      return;
    }
    setSavingRegistryRule(true);
    try {
      await deleteGitRepositoryImageRegistryOverrideRule(id, rule.id);
      setImageRegistryOverrideRules((rules) => rules.filter((item) => item.id !== rule.id));
      success('Registry pattern removed.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not remove the registry pattern.');
    } finally {
      setSavingRegistryRule(false);
    }
  }

  async function exportRules() {
    try {
      const yaml = await exportGitRepositoryDiscoveryRules(id);
      const url = URL.createObjectURL(new Blob([yaml], { type: 'application/x-yaml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = '.justscan.yaml';
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not export discovery rules.');
    }
  }

  const files = useMemo(() => {
    const grouped = new Map<string, { file: string; kind?: string; refs: string[] }>();
    for (const image of preview?.images ?? []) {
      for (const location of locationsFor(image)) {
        const source = location.target || location.file;
        const key = `${location.kind ?? ''}\u0000${source}`;
        const item = grouped.get(key) ?? { file: source, kind: location.kind, refs: [] };
        item.refs.push(image.full_ref);
        grouped.set(key, item);
      }
    }
    return [...grouped.values()].sort(
      (left, right) =>
        left.file.localeCompare(right.file) || (left.kind ?? '').localeCompare(right.kind ?? '')
    );
  }, [preview]);

  const filesByDeploymentType = useMemo(() => {
    const groups = new Map<string, Array<[string, string[]]>>();
    for (const { file, kind, refs } of files) {
      const group = targetGroup(file, repository?.discovery_mode, kind);
      const items = groups.get(group.label) ?? [];
      items.push([group.path, refs]);
      groups.set(group.label, items);
    }
    return ['Kustomize', 'Helm', 'GitLab CI', 'Registry references', 'Manifests']
      .map((label) => [label, groups.get(label) ?? []] as const)
      .filter(([, items]) => items.length > 0);
  }, [files, repository?.discovery_mode]);

  const previewImages = preview?.images ?? [];
  const exclusionByRef = useMemo(
    () => new Map(imageExclusions.map((exclusion) => [exclusion.full_ref, exclusion])),
    [imageExclusions]
  );
  const imageRegistryOverrideByRef = useMemo(
    () => new Map(imageRegistryOverrides.map((override) => [override.full_ref, override])),
    [imageRegistryOverrides]
  );
  const registryByID = useMemo(
    () => new Map(registries.map((registry) => [registry.id, registry])),
    [registries]
  );
  const latestScanByRef = useMemo(
    () => new Map(latestImageScans.map((scan) => [scan.full_ref, scan])),
    [latestImageScans]
  );
  const selectableChartRepositories = useMemo(() => {
    const result: GitRepository[] = [];
    for (const item of availableRepositories) {
      if (item.id !== id) result.push(item);
    }
    return result;
  }, [availableRepositories, id]);
  const helmCredentialByID = useMemo(
    () => new Map(availableHelmCredentials.map((credential) => [credential.id, credential])),
    [availableHelmCredentials]
  );
  const normalizedImageSearch = imageSearch.trim().toLowerCase();
  const filteredPreviewImages = previewImages.filter(
    (image) =>
      !normalizedImageSearch || image.full_ref.toLowerCase().includes(normalizedImageSearch)
  );
  const selectableImages = previewImages.filter((image) => !exclusionByRef.has(image.full_ref));
  const filteredSelectableImages = filteredPreviewImages.filter(
    (image) => !exclusionByRef.has(image.full_ref)
  );
  const selectedFilteredImageCount = filteredSelectableImages.filter((image) =>
    selectedImageRefs.has(image.full_ref)
  ).length;
  const pendingCandidates = candidates.filter((candidate) => candidate.status === 'unresolved');
  const handledCandidates = candidates
    .filter((candidate) => candidate.status !== 'unresolved')
    .sort(
      (left, right) =>
        Number(left.status === 'ignored') - Number(right.status === 'ignored') ||
        left.path.localeCompare(right.path)
    );

  if (loading) {
    return (
      <PageContainer>
        <Card>
          <Card.Content className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Spinner size="sm" /> Loading repository…
          </Card.Content>
        </Card>
      </PageContainer>
    );
  }
  if (!repository) {
    return (
      <PageContainer>
        <EmptyState
          icon={<GitBranchIcon />}
          title="Git repository not found"
          description="It may have been removed or you may no longer have access."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle
        title={repository.name}
        icon={<GitBranchIcon />}
        breadcrumbs={[
          { label: 'Git repositories', href: '/git-repositories' },
          { label: repository.name },
        ]}
        description={`${repository.clone_url} · ${repository.ref} · ${discoveryModeLabel(repository.discovery_mode)}${repository.discovery_mode === 'registry' ? ` · ${registryDiscoverySource(repository, registries)}` : ''}${repository.owner_type === 'org' ? ' · Scans appear in the organization workspace.' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {activeRun ? (
              <Button
                isPending={cancellingRun}
                onPress={() => void cancelActiveRun()}
                variant="danger"
              >
                <Cancel01Icon size={16} /> Cancel active scan
              </Button>
            ) : (
              <Button isPending={discovering} onPress={() => void discover()}>
                <Search01Icon size={16} /> Dry run discovery
              </Button>
            )}
            <Dropdown>
              <Dropdown.Trigger
                aria-label="Open repository actions"
                className={buttonVariants({ isIconOnly: true, variant: 'secondary' })}
              >
                <MoreVerticalIcon size={16} />
              </Dropdown.Trigger>
              <Dropdown.Popover className="min-w-[220px]" placement="bottom end">
                <Dropdown.Menu
                  onAction={(key) => {
                    if (key === 'scan-all' && !hasActiveRun) void startScan();
                    if (key === 'discover' && !hasActiveRun) void discover();
                    if (key === 'export') void exportRules();
                  }}
                >
                  <Dropdown.Item
                    id="scan-all"
                    isDisabled={hasActiveRun || startingScan}
                    textValue="Start full scan"
                  >
                    <div className="flex items-center gap-2">
                      <GitBranchIcon size={14} />
                      <Label>Start full scan</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item
                    id="discover"
                    isDisabled={hasActiveRun || discovering}
                    textValue="Dry run discovery"
                  >
                    <div className="flex items-center gap-2">
                      <Search01Icon size={14} />
                      <Label>Dry run discovery</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="export" textValue="Export .justscan.yaml">
                    <div className="flex items-center gap-2">
                      <Download01Icon size={14} />
                      <Label>Export .justscan.yaml</Label>
                    </div>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Needs review"
          onPress={() => setDetailView('review')}
          value={String(candidates.filter((candidate) => candidate.status === 'unresolved').length)}
          detail="ambiguous deployment markers"
        />
        <MetricCard
          title="Latest discovery"
          onPress={() => setDetailView('images')}
          value={String(previewImages.length)}
          detail="unique image references"
        />
        <MetricCard
          title={
            repository.discovery_mode === 'manifests'
              ? 'Files with images'
              : repository.discovery_mode === 'registry'
                ? 'Registry reference files'
                : repository.discovery_mode === 'gitlab_ci'
                  ? 'CI config files'
                  : 'Deployment targets'
          }
          onPress={() => setDetailView('tree')}
          value={String(files.length)}
          detail={
            repository.discovery_mode === 'manifests'
              ? 'manifest files represented'
              : repository.discovery_mode === 'registry'
                ? 'files with matching image references'
                : repository.discovery_mode === 'gitlab_ci'
                  ? 'GitLab CI image declarations represented'
                  : 'rendered entrypoints represented'
          }
        />
        <MetricCard
          title="Latest commit"
          value={preview?.run.commit_sha || '—'}
          detail={preview?.run.completed_at ? fullDate(preview.run.completed_at) : 'No dry run yet'}
          mono
        />
      </div>

      <Tabs
        selectedKey={detailView}
        onSelectionChange={(key) => setDetailView(String(key))}
        className="gap-4"
      >
        <Tabs.ListContainer className="overflow-x-auto border-b border-border">
          <Tabs.List
            aria-label="Repository views"
            className="h-10 min-w-max gap-4 rounded-none bg-transparent p-0"
          >
            {[
              { id: 'images', label: 'Images' },
              { id: 'review', label: 'Discovery review' },
              { id: 'tree', label: 'Source tree' },
              { id: 'configuration', label: 'Configuration' },
              { id: 'activity', label: 'Activity' },
            ].map((tab) => (
              <Tabs.Tab
                key={tab.id}
                id={tab.id}
                className="h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-0 data-[selected]:border-foreground data-[selected]:bg-transparent data-[selected]:shadow-none dark:data-[selected]:bg-transparent"
              >
                {tab.label}
                {tab.id === 'review' && pendingCandidates.length > 0 ? (
                  <span className="ml-1 rounded bg-warning/10 px-1.5 text-xs tabular-nums text-warning-foreground">
                    {pendingCandidates.length}
                  </span>
                ) : null}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="configuration" className="space-y-4 outline-none">
          <Card className="gap-3">
            <Card.Header>
              <Card.Title>Repository configuration</Card.Title>
              <Card.Description>Connection, discovery, and scheduling context</Card.Description>
            </Card.Header>
            <Card.Content>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Clone URL</dt>
                  <dd className="mt-1 break-all font-mono text-sm">{repository.clone_url}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Git ref</dt>
                  <dd className="mt-1 break-all font-mono text-sm">{repository.ref}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Discovery mode</dt>
                  <dd className="mt-1 text-sm">{discoveryModeLabel(repository.discovery_mode)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Schedule</dt>
                  <dd className="mt-1 text-sm">
                    {repository.enabled
                      ? `${repository.schedule} · ${repository.timezone}`
                      : 'Manual scanning'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Rescan policy</dt>
                  <dd className="mt-1 text-sm">
                    {repository.rescan_policy === 'all' ? 'All images' : 'Changed images only'}
                  </dd>
                </div>
              </dl>
            </Card.Content>
          </Card>

          {repository.discovery_excludes?.length ? (
            <Card>
              <Card.Header>
                <Card.Title>Ignored discovery paths</Card.Title>
                <Card.Description>
                  These repository-relative globs are skipped before automatic discovery scans.
                </Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-wrap gap-2">
                {repository.discovery_excludes.map((path) => (
                  <Chip key={path} size="sm" variant="soft">
                    <code>{path}</code>
                  </Chip>
                ))}
              </Card.Content>
            </Card>
          ) : null}

          <Card className="overflow-hidden gap-0 py-0">
            <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border p-4">
              <div className="flex min-w-0 items-start gap-3">
                <PackageIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <Card.Title>Managed Helm sources</Card.Title>
                  <Card.Description>
                    Render local or external Git charts with values from this deployment repository.
                  </Card.Description>
                </div>
              </div>
              <Button size="sm" variant="secondary" onPress={() => void openHelmSourceEditor()}>
                Add Helm source
              </Button>
            </Card.Header>
            <Card.Content className="p-0">
              <div className="divide-y divide-border">
                {helmSources.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    Add a source when a chart lives outside this repository or needs explicit Helm
                    values.
                  </p>
                ) : (
                  helmSources.map((source) => {
                    const credential = source.helm_registry_credential_id
                      ? helmCredentialByID.get(source.helm_registry_credential_id)
                      : null;
                    return (
                      <div
                        key={source.id}
                        className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <code className="break-all text-xs font-medium text-foreground">
                              {source.chart_path}
                            </code>
                            <Chip size="sm" variant="soft">
                              {source.source_type === 'local'
                                ? 'This repository'
                                : source.source_type === 'repository'
                                  ? 'Registered repository'
                                  : 'Direct Git URL'}
                            </Chip>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {source.values.length > 0
                              ? `Values: ${source.values.join(', ')}`
                              : 'Chart defaults only'}
                            {source.release_name ? ` · Release: ${source.release_name}` : ''}
                          </p>
                          <div className="text-xs text-muted-foreground">
                            <p>
                              Dependency credentials:{' '}
                              {credential?.name ??
                                (source.dependency_registry_id
                                  ? 'Legacy image registry'
                                  : 'Automatic matching')}
                            </p>
                            {credential ? (
                              <p className="mt-0.5 break-all text-muted-foreground/80">
                                {credential.protocol.toUpperCase()} · {credential.url}
                              </p>
                            ) : null}
                            {source.dependency_registry_id ? (
                              <p className="mt-1 text-warning-foreground">
                                Legacy registry link — edit and select a Helm credential to migrate
                                it.
                              </p>
                            ) : null}
                          </div>
                          {source.source_type === 'url' ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {source.clone_url} · {source.ref}
                            </p>
                          ) : null}
                        </div>
                        <RowActionsMenu
                          label={`Actions for Helm source ${source.chart_path}`}
                          items={[
                            {
                              id: 'edit',
                              label: 'Edit source',
                              icon: <Settings02Icon size={14} />,
                              onAction: () => void openHelmSourceEditor(source),
                            },
                            {
                              id: 'remove',
                              label: 'Remove source',
                              icon: <Delete01Icon size={14} />,
                              variant: 'danger',
                              onAction: () => void removeHelmSource(source),
                            },
                          ]}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </Card.Content>
          </Card>
        </Tabs.Panel>
        <Tabs.Panel id="images" className="space-y-4 outline-none">
          {!preview ? (
            <EmptyState
              icon={<Search01Icon />}
              title="No discovery preview yet"
              description="Run a dry discovery to inspect images and their source locations before creating a scan."
              action={{ label: 'Run dry discovery', onClick: () => void discover() }}
            />
          ) : (
            <Card className="overflow-hidden gap-0 py-0">
              <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <PackageIcon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <Card.Title>Discovered images</Card.Title>
                    <Card.Description>
                      {repository.discovery_mode === 'registry'
                        ? `This discovery searches ${registryDiscoverySource(repository, registries)} and keeps each matching image reference tied to its source file. Review the results, then scan only the workloads you want to track.`
                        : repository.discovery_mode === 'gitlab_ci'
                          ? 'Images and service declarations found in GitLab CI YAML. Review the results, then scan only the workloads you want to track.'
                          : 'Review the images found in this dry run, then scan only the workloads you want to track.'}
                    </Card.Description>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Chip size="sm" variant="soft">
                    {preview.run.image_count} images
                  </Chip>
                  <Chip size="sm" variant="soft">
                    {timeAgo(preview.run.created_at)}
                  </Chip>
                </div>
              </Card.Header>
              <Card.Content className="p-0">
                <Accordion className="border-b border-border">
                  <Accordion.Item id="registry-patterns">
                    <Accordion.Heading>
                      <Accordion.Trigger className="px-4 py-3">
                        <span>Registry override patterns</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {imageRegistryOverrideRules.length} configured
                        </span>
                        <Accordion.Indicator />
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body>
                        <div className="space-y-4 px-4 pb-4">
                          <p className="max-w-3xl text-sm text-muted-foreground">
                            Route matching images to a registry using RE2 patterns. Exact image
                            overrides take priority; otherwise, the most recently updated matching
                            pattern wins.
                          </p>
                          {imageRegistryOverrideRules.length > 0 ? (
                            <div className="space-y-2">
                              {imageRegistryOverrideRules.map((rule) => {
                                const ruleRegistry = registryByID.get(rule.registry_id);
                                const matchCount = previewImages.filter((image) =>
                                  imageRegistryRuleMatches(rule.pattern, image.full_ref)
                                ).length;
                                return (
                                  <div
                                    key={rule.id}
                                    className="flex min-w-0 items-center gap-3 border-b border-border py-3 last:border-b-0"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <code className="block break-all text-xs text-foreground">
                                        {rule.pattern}
                                      </code>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {ruleRegistry?.name ?? 'Registry unavailable'} · matches{' '}
                                        {matchCount}{' '}
                                        {matchCount === 1
                                          ? 'discovered image'
                                          : 'discovered images'}
                                      </p>
                                    </div>
                                    <Button
                                      aria-label={`Remove registry pattern ${rule.pattern}`}
                                      isDisabled={savingRegistryRule}
                                      isIconOnly
                                      size="sm"
                                      variant="tertiary"
                                      onPress={() => void removeImageRegistryOverrideRule(rule)}
                                    >
                                      <Delete01Icon size={16} />
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                          <form
                            onSubmit={saveImageRegistryOverrideRule}
                            className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)_auto]"
                          >
                            <div className="space-y-2">
                              <FormField
                                label="Image reference pattern"
                                placeholder="^ghcr\\.io/team/api(:.*)?$"
                                value={registryRulePattern}
                                onChange={(event) => setRegistryRulePattern(event.target.value)}
                              />
                            </div>
                            <Select
                              aria-label="Registry for image ref pattern"
                              isDisabled={savingRegistryRule || registries.length === 0}
                              value={registryRuleRegistryID || '__none__'}
                              onChange={(value) =>
                                setRegistryRuleRegistryID(
                                  String(value === '__none__' ? '' : (value ?? ''))
                                )
                              }
                              variant="secondary"
                            >
                              <Label>Registry</Label>
                              <Select.Trigger>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  <ListBox.Item id="__none__">Choose a registry</ListBox.Item>
                                  {registries.map((registry) => (
                                    <ListBox.Item
                                      key={registry.id}
                                      id={registry.id}
                                      textValue={registry.name}
                                    >
                                      {registry.name}
                                    </ListBox.Item>
                                  ))}
                                </ListBox>
                              </Select.Popover>
                            </Select>
                            <Button
                              isDisabled={!registryRulePattern.trim() || !registryRuleRegistryID}
                              isPending={savingRegistryRule}
                              type="submit"
                              variant="secondary"
                            >
                              Save pattern
                            </Button>
                            <p className="text-xs text-muted-foreground md:col-span-3">
                              Patterns match the full image reference, including its tag or digest.
                              Changing an image’s registry below saves a pattern across its tags.
                            </p>
                            {registryRuleError ? (
                              <p className="text-xs text-danger md:col-span-3">
                                {registryRuleError}
                              </p>
                            ) : null}
                          </form>
                        </div>
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <SearchField
                    aria-label="Search discovered images"
                    className="min-w-0 flex-1 basis-64 sm:max-w-md"
                    value={imageSearch}
                    onChange={setImageSearch}
                    variant="secondary"
                  >
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="Search image name, tag, or digest" />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  <Checkbox
                    aria-label="Select all visible scan-enabled images"
                    className="sm:ml-auto"
                    isDisabled={filteredSelectableImages.length === 0}
                    isIndeterminate={
                      selectedFilteredImageCount > 0 &&
                      selectedFilteredImageCount < filteredSelectableImages.length
                    }
                    isSelected={
                      filteredSelectableImages.length > 0 &&
                      selectedFilteredImageCount === filteredSelectableImages.length
                    }
                    onChange={toggleAllImages}
                    variant="secondary"
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <span className="text-sm">Select visible</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        ({filteredSelectableImages.length})
                      </span>
                    </Checkbox.Content>
                  </Checkbox>
                  {selectedImageRefs.size > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        aria-label="Clear image selection"
                        size="sm"
                        variant="tertiary"
                        onPress={() => setSelectedImageRefs(new Set())}
                      >
                        Clear
                      </Button>
                      <Button
                        isDisabled={selectedImageRefs.size === 0}
                        isPending={startingScan}
                        size="sm"
                        variant="primary"
                        onPress={() => void startScan([...selectedImageRefs])}
                      >
                        Scan selected
                        {selectedImageRefs.size > 0 ? ` (${selectedImageRefs.size})` : ''}
                      </Button>
                      <Button
                        isDisabled={selectedImageRefs.size === 0}
                        isPending={updatingImageExclusions}
                        size="sm"
                        variant="tertiary"
                        onPress={() => void excludeImages([...selectedImageRefs])}
                      >
                        Exclude selected
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="border-t border-border">
                  {filteredPreviewImages.map((image) => {
                    const locations = locationsFor(image);
                    const exclusion = exclusionByRef.get(image.full_ref);
                    const registryOverride = imageRegistryOverrideByRef.get(image.full_ref);
                    const registryOverrideRule = imageRegistryOverrideRules.find((rule) =>
                      imageRegistryRuleMatches(rule.pattern, image.full_ref)
                    );
                    const selectedRegistryID =
                      registryOverride?.registry_id ?? registryOverrideRule?.registry_id;
                    const selectedRegistry = selectedRegistryID
                      ? registryByID.get(selectedRegistryID)
                      : undefined;
                    const inferredRegistry = image.registry_id
                      ? registryByID.get(image.registry_id)
                      : undefined;
                    const imageHost = imageRegistryHost(image.full_ref);
                    const latestScan = latestScanByRef.get(image.full_ref);
                    return (
                      <div
                        key={image.id}
                        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 transition-colors hover:bg-secondary"
                      >
                        <Checkbox
                          aria-label={`Select ${image.full_ref}`}
                          className="mt-2 shrink-0"
                          isDisabled={Boolean(exclusion)}
                          isSelected={selectedImageRefs.has(image.full_ref)}
                          onChange={(next) => toggleImage(image.full_ref, next)}
                          variant="secondary"
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                        <Accordion className="min-w-0 flex-1" hideSeparator>
                          <Accordion.Item id={image.id}>
                            <Accordion.Heading>
                              <Accordion.Trigger className="min-w-0 flex-wrap gap-y-2 py-0 hover:no-underline">
                                <span className="flex min-w-0 flex-1 items-start gap-3 text-left">
                                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    <PackageIcon size={16} />
                                  </span>
                                  <span className="min-w-0 flex-1 space-y-1.5">
                                    <code className="block truncate text-xs font-medium text-foreground">
                                      {image.full_ref}
                                    </code>
                                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                      <span>
                                        {locations.length} deployment{' '}
                                        {locations.length === 1 ? 'location' : 'locations'}
                                      </span>
                                      {latestScan ? (
                                        <span>Last scanned {timeAgo(latestScan.created_at)}</span>
                                      ) : (
                                        <span>Not scanned yet</span>
                                      )}
                                    </span>
                                  </span>
                                </span>
                                {exclusion ? (
                                  <Chip
                                    className="shrink-0"
                                    color="warning"
                                    size="sm"
                                    variant="soft"
                                  >
                                    Excluded
                                  </Chip>
                                ) : null}
                                {registryOverride || registryOverrideRule ? (
                                  <Chip
                                    className="shrink-0"
                                    color="accent"
                                    size="sm"
                                    variant="soft"
                                  >
                                    {selectedRegistry?.name ?? 'Configured override'}
                                    {!registryOverride && registryOverrideRule ? ' · regex' : ''}
                                  </Chip>
                                ) : image.registry_id ? (
                                  <Chip
                                    className="shrink-0"
                                    color={inferredRegistry ? 'accent' : 'warning'}
                                    size="sm"
                                    variant="soft"
                                  >
                                    {inferredRegistry
                                      ? `Matched: ${inferredRegistry.name}`
                                      : 'Configured match unavailable'}
                                  </Chip>
                                ) : imageHost ? (
                                  <Chip
                                    className="shrink-0"
                                    color="warning"
                                    size="sm"
                                    variant="soft"
                                  >
                                    Custom host: {imageHost}
                                  </Chip>
                                ) : null}
                                {latestScan ? (
                                  <span className="shrink-0">
                                    <StatusBadge
                                      status={latestScan.status}
                                      externalStatus={latestScan.external_status}
                                    />
                                  </span>
                                ) : null}
                                <Accordion.Indicator className="shrink-0" />
                              </Accordion.Trigger>
                            </Accordion.Heading>
                            <Accordion.Panel>
                              <Accordion.Body className="mt-3 border-t border-border pt-3">
                                <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
                                  <RegistryResolutionSummary
                                    image={image}
                                    inferredRegistry={inferredRegistry}
                                    override={registryOverride}
                                    overrideRegistry={selectedRegistry}
                                  />
                                  <div className="mt-4 border-t border-border pt-4">
                                    <ImageRegistrySelect
                                      registries={registries}
                                      value={selectedRegistryID ?? null}
                                      isDisabled={savingImageRegistryRef === image.full_ref}
                                      onChange={(value) =>
                                        void updateImageRegistry(image.full_ref, value)
                                      }
                                    />
                                  </div>
                                </div>
                                <p className="mb-2 text-xs font-medium text-muted-foreground">
                                  Deployment locations
                                </p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {locations.map((location) => (
                                    <div
                                      key={`${location.file}:${location.path}`}
                                      className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs"
                                    >
                                      <p className="truncate font-mono text-foreground">
                                        {location.target
                                          ? `Rendered from ${location.target}`
                                          : location.file}
                                      </p>
                                      <p className="mt-1 truncate text-muted-foreground">
                                        {location.path}
                                      </p>
                                      <p className="mt-1.5 text-muted-foreground">
                                        {location.kind ?? 'Manifest'}
                                        {location.name ? `/${location.name}` : ''}
                                        {location.namespace ? ` · ${location.namespace}` : ''}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                                {latestScan ? (
                                  <Button
                                    className="mt-3"
                                    size="sm"
                                    variant="secondary"
                                    onPress={() =>
                                      router.push(`/scans/details/${latestScan.scan_id}`)
                                    }
                                  >
                                    Open latest scan · {timeAgo(latestScan.created_at)}
                                  </Button>
                                ) : null}
                              </Accordion.Body>
                            </Accordion.Panel>
                          </Accordion.Item>
                        </Accordion>
                        {exclusion ? (
                          <Button
                            className="mt-2 shrink-0"
                            isPending={updatingImageExclusions}
                            size="sm"
                            variant="secondary"
                            onPress={() => void reenableImage(exclusion)}
                          >
                            Re-enable
                          </Button>
                        ) : (
                          <Button
                            className="mt-2 shrink-0"
                            isPending={updatingImageExclusions}
                            size="sm"
                            variant="outline"
                            onPress={() => void excludeImages([image.full_ref])}
                          >
                            Exclude
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {filteredPreviewImages.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No discovered images match “{imageSearch}”.
                    </p>
                  ) : null}
                </div>
              </Card.Content>
            </Card>
          )}
        </Tabs.Panel>
        <Tabs.Panel id="review" className="outline-none">
          {!preview ? (
            <EmptyState
              icon={<Search01Icon />}
              title="No discovery preview yet"
              description="Run a dry discovery to inspect images and deployment markers before creating a scan."
              action={{ label: 'Run dry discovery', onClick: () => void discover() }}
            />
          ) : (
            <DiscoveryReviewTable
              pending={pendingCandidates}
              handled={handledCandidates}
              selectedIds={selectedCandidateIDs}
              busy={ignoringCandidates}
              onSelect={toggleCandidate}
              onSelectMany={toggleAllPending}
              onClear={() => toggleAllPending(false)}
              onIgnoreSelected={() => void ignoreSelectedCandidates()}
              onReview={review}
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel id="tree" className="space-y-4 outline-none">
          {!preview ? (
            <EmptyState
              icon={<Search01Icon />}
              title="No discovery preview yet"
              description="Run a dry discovery to inspect images and their source locations before creating a scan."
              action={{ label: 'Run dry discovery', onClick: () => void discover() }}
            />
          ) : (
            <Card className="overflow-hidden gap-0 py-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
                <div>
                  <h2 className="text-sm font-medium">Source tree</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Expand a source to inspect its image references.
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {files.length} {files.length === 1 ? 'source' : 'sources'}
                </span>
              </div>
              {filesByDeploymentType.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    icon={<FileCode2 className="size-6" />}
                    title="No source paths found"
                    description="Source files appear here after discovery identifies image references."
                  />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filesByDeploymentType.map(([deploymentType, items]) => (
                    <section key={deploymentType}>
                      <div className="flex items-center justify-between gap-2 bg-muted/20 px-4 py-2">
                        <h3 className="text-xs font-medium text-muted-foreground">
                          {deploymentType}
                        </h3>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {items.length} {items.length === 1 ? 'source' : 'sources'}
                        </span>
                      </div>
                      <Accordion allowsMultipleExpanded className="divide-y divide-border">
                        {items.map(([file, refs]) => (
                          <Accordion.Item
                            key={`${deploymentType}:${file}`}
                            id={`${deploymentType}:${file}`}
                          >
                            <Accordion.Heading>
                              <Accordion.Trigger className="gap-3 px-4 py-3 font-normal hover:bg-muted/30 hover:no-underline">
                                <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                                <span
                                  className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                                  title={file}
                                >
                                  {file}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                  {new Set(refs).size}{' '}
                                  {new Set(refs).size === 1 ? 'image' : 'images'}
                                </span>
                                <Accordion.Indicator />
                              </Accordion.Trigger>
                            </Accordion.Heading>
                            <Accordion.Panel>
                              <Accordion.Body className="border-t border-border bg-muted/10 px-4 py-2 pl-11">
                                <ul className="divide-y divide-border">
                                  {[...new Set(refs)].map((ref) => (
                                    <li key={ref} className="flex min-w-0 items-start gap-2 py-2">
                                      <PackageIcon
                                        size={14}
                                        className="mt-0.5 shrink-0 text-muted-foreground"
                                      />
                                      <Button
                                        variant="link"
                                        className="h-auto min-w-0 justify-start whitespace-normal break-all p-0 text-left font-mono text-xs"
                                        onPress={() => {
                                          setImageSearch(ref);
                                          setDetailView('images');
                                        }}
                                      >
                                        {ref}
                                      </Button>
                                    </li>
                                  ))}
                                </ul>
                              </Accordion.Body>
                            </Accordion.Panel>
                          </Accordion.Item>
                        ))}
                      </Accordion>
                    </section>
                  ))}
                </div>
              )}
            </Card>
          )}
        </Tabs.Panel>
        <Tabs.Panel id="activity" className="outline-none">
          <Card className="overflow-hidden gap-0 py-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
              <div>
                <h2 className="text-sm font-medium">Recent activity</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Latest discovery and scan runs for this repository
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{Math.min(runs.length, 6)} runs</span>
            </div>
            <Table>
              <Table.ScrollContainer className="rounded-none border-0">
                <Table.Content
                  aria-label="Repository run history"
                  className="min-w-[960px] table-fixed [&_td]:whitespace-normal [&_td]:px-4 [&_td]:py-3 [&_th]:px-4"
                >
                  <Table.Header>
                    <Table.Column isRowHeader className="w-auto">
                      Run
                    </Table.Column>
                    <Table.Column className="w-36">State</Table.Column>
                    <Table.Column className="w-28">Images</Table.Column>
                    <Table.Column className="w-28">Scans</Table.Column>
                    <Table.Column className="w-36">Commit</Table.Column>
                    <Table.Column className="w-40">Started</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {runs.length === 0 ? (
                      <Table.Row id="empty-runs">
                        <Table.Cell colSpan={6}>
                          <div className="space-y-2 py-12 text-center">
                            <Clock01Icon size={24} className="mx-auto text-muted-foreground" />
                            <p className="text-sm font-medium">No runs yet</p>
                            <p className="text-xs text-muted-foreground">
                              Discover images to start recording repository activity.
                            </p>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      runs.slice(0, 6).map((run) => (
                        <Table.Row key={run.id} id={run.id}>
                          <Table.Cell>
                            <p className="text-sm font-medium">
                              {run.trigger === 'dry_run'
                                ? 'Discovery preview'
                                : run.trigger.replaceAll('_', ' ')}
                            </p>
                            <code className="mt-1 block truncate text-xs text-muted-foreground">
                              {run.ref}
                            </code>
                            {run.error_message ? (
                              <p className="mt-1 break-words text-xs text-destructive">
                                {run.error_message}
                              </p>
                            ) : null}
                          </Table.Cell>
                          <Table.Cell>
                            <Chip
                              size="sm"
                              variant="soft"
                              color={
                                run.status === 'failed'
                                  ? 'danger'
                                  : run.status === 'completed'
                                    ? 'success'
                                    : run.status === 'partial' || run.status === 'cancelled'
                                      ? 'warning'
                                      : 'accent'
                              }
                            >
                              {run.status}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell className="tabular-nums">{run.image_count}</Table.Cell>
                          <Table.Cell className="tabular-nums">{run.scan_count}</Table.Cell>
                          <Table.Cell>
                            <code className="text-xs text-muted-foreground" title={run.commit_sha}>
                              {run.commit_sha ? run.commit_sha.slice(0, 8) : '—'}
                            </code>
                          </Table.Cell>
                          <Table.Cell>
                            <span
                              className="text-xs text-muted-foreground"
                              title={fullDate(run.created_at)}
                            >
                              {timeAgo(run.created_at)}
                            </span>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>
        </Tabs.Panel>
      </Tabs>

      <Modal>
        <Modal.Backdrop
          isDismissable={false}
          isOpen={reviewOverlay.isOpen}
          onOpenChange={reviewOverlay.setOpen}
        >
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Resolve {reviewing?.path}</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="grid gap-4">
                <Select
                  aria-label="Resolution"
                  value={resolution}
                  onChange={(value) => setResolution(String(value) as typeof resolution)}
                  variant="secondary"
                >
                  <Label>Use this path as</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="helm">Helm values or chart</ListBox.Item>
                      <ListBox.Item id="kustomize">Kustomize entrypoint</ListBox.Item>
                      <ListBox.Item id="manifests">Plain manifests</ListBox.Item>
                      <ListBox.Item id="ignore">Ignore</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                {resolution === 'helm' ? (
                  <>
                    <Select
                      aria-label="Chart location"
                      value={helmSourceType}
                      onChange={(value) => setHelmSourceType(String(value) as HelmSourceMode)}
                      variant="secondary"
                    >
                      <Label>Chart location</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="local">This repository</ListBox.Item>
                          <ListBox.Item id="repository">Registered Git repository</ListBox.Item>
                          <ListBox.Item id="url">Direct Git URL</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {helmSourceType === 'repository' ? (
                      <Select
                        aria-label="Chart repository"
                        value={chartRepositoryID || null}
                        onChange={(value) => setChartRepositoryID(String(value ?? ''))}
                        placeholder="Select a repository"
                        variant="secondary"
                      >
                        <Label>Registered chart repository</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {selectableChartRepositories.map((item) => (
                              <ListBox.Item id={item.id} key={item.id}>
                                {item.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    ) : null}
                    {helmSourceType === 'url' ? (
                      <>
                        <FormField
                          label="Chart repository URL"
                          value={chartCloneURL}
                          onChange={(event) => setChartCloneURL(event.target.value)}
                          placeholder="https://git.example.com/team/chart.git"
                        />
                        <FormField
                          label="Chart repository ref"
                          value={chartRef}
                          onChange={(event) => setChartRef(event.target.value)}
                          placeholder="main"
                        />
                        <Select
                          aria-label="Chart repository authentication"
                          value={chartAuthType}
                          onChange={(value) =>
                            setChartAuthType(String(value) as typeof chartAuthType)
                          }
                          variant="secondary"
                        >
                          <Label>Chart repository authentication</Label>
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="none">No authentication</ListBox.Item>
                              <ListBox.Item id="token">Token</ListBox.Item>
                              <ListBox.Item id="basic">Username and password</ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        {chartAuthType !== 'none' ? (
                          <>
                            <FormField
                              label="Git username"
                              value={chartUsername}
                              onChange={(event) => setChartUsername(event.target.value)}
                            />
                            <FormField
                              label="Git credential"
                              type="password"
                              value={chartCredential}
                              onChange={(event) => setChartCredential(event.target.value)}
                            />
                          </>
                        ) : null}
                      </>
                    ) : null}
                    <HelmCredentialSelect
                      credentials={availableHelmCredentials}
                      value={helmRegistryCredentialID ?? ''}
                      onChange={(value) => {
                        helmCredentialSelectionTouched.current = true;
                        setHelmRegistryCredentialID(value || null);
                      }}
                    />
                    <FormField
                      label="Chart path"
                      value={chart}
                      onChange={(event) => setChart(event.target.value)}
                      placeholder={helmSourceType === 'local' ? 'charts/app2' : 'charts/app2'}
                    />
                    <div className="grid gap-2">
                      <Label htmlFor="value-paths">Values files</Label>
                      <TextArea
                        id="value-paths"
                        value={values}
                        onChange={(event) => setValues(event.target.value)}
                        rows={3}
                        variant="secondary"
                      />
                    </div>
                    <FormField
                      label="Release name"
                      value={releaseName}
                      onChange={(event) => setReleaseName(event.target.value)}
                      placeholder="Optional; defaults to the chart directory name"
                    />
                  </>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button onPress={() => void saveResolution()}>Save and rediscover</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal>
        <Modal.Backdrop
          isDismissable={false}
          isOpen={helmSourceOverlay.isOpen}
          onOpenChange={helmSourceOverlay.setOpen}
        >
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  {editingHelmSource ? 'Edit Helm source' : 'Add Helm source'}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="grid gap-4">
                <Select
                  aria-label="Chart location"
                  value={helmSourceType}
                  onChange={(value) => setHelmSourceType(String(value) as HelmSourceMode)}
                  variant="secondary"
                >
                  <Label>Chart location</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="local">This repository</ListBox.Item>
                      <ListBox.Item id="repository">Registered Git repository</ListBox.Item>
                      <ListBox.Item id="url">Direct Git URL</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                {helmSourceType === 'repository' ? (
                  <Select
                    aria-label="Chart repository"
                    value={chartRepositoryID || null}
                    onChange={(value) => setChartRepositoryID(String(value ?? ''))}
                    placeholder="Select a repository"
                    variant="secondary"
                  >
                    <Label>Registered chart repository</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {selectableChartRepositories.map((item) => (
                          <ListBox.Item id={item.id} key={item.id}>
                            {item.name}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : null}
                {helmSourceType === 'url' ? (
                  <>
                    <FormField
                      label="Chart repository URL"
                      value={chartCloneURL}
                      onChange={(event) => setChartCloneURL(event.target.value)}
                      placeholder="https://git.example.com/team/chart.git"
                    />
                    <FormField
                      label="Chart repository ref"
                      value={chartRef}
                      onChange={(event) => setChartRef(event.target.value)}
                      placeholder="main"
                    />
                    <Select
                      aria-label="Chart repository authentication"
                      value={chartAuthType}
                      onChange={(value) => setChartAuthType(String(value) as typeof chartAuthType)}
                      variant="secondary"
                    >
                      <Label>Chart repository authentication</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="none">No authentication</ListBox.Item>
                          <ListBox.Item id="token">Token</ListBox.Item>
                          <ListBox.Item id="basic">Username and password</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    {chartAuthType !== 'none' ? (
                      <>
                        <FormField
                          label="Git username"
                          value={chartUsername}
                          onChange={(event) => setChartUsername(event.target.value)}
                        />
                        <FormField
                          label={
                            editingHelmSource?.credential_configured
                              ? 'New Git credential (optional)'
                              : 'Git credential'
                          }
                          type="password"
                          value={chartCredential}
                          onChange={(event) => setChartCredential(event.target.value)}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}
                <HelmCredentialSelect
                  credentials={availableHelmCredentials}
                  value={helmRegistryCredentialID ?? ''}
                  onChange={(value) => {
                    helmCredentialSelectionTouched.current = true;
                    setHelmRegistryCredentialID(value || null);
                  }}
                />
                <FormField
                  label="Chart path"
                  value={chart}
                  onChange={(event) => setChart(event.target.value)}
                  placeholder="apps/litellm"
                />
                <div className="grid gap-2">
                  <Label htmlFor="managed-value-paths">Values files</Label>
                  <TextArea
                    id="managed-value-paths"
                    value={values}
                    onChange={(event) => setValues(event.target.value)}
                    placeholder="envs/ki/dev/litellm/values.yaml"
                    rows={3}
                    variant="secondary"
                  />
                  <Description>
                    One deployment-repository path per line. Values are applied in order.
                  </Description>
                </div>
                <FormField
                  label="Release name"
                  value={releaseName}
                  onChange={(event) => setReleaseName(event.target.value)}
                  placeholder="Optional; defaults to the chart directory name"
                />
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button isPending={savingHelmSource} onPress={() => void saveHelmSource()}>
                  Save Helm source
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </PageContainer>
  );
}

function MetricCard({
  title,
  value,
  detail,
  mono = false,
  onPress,
}: {
  title: string;
  value: string;
  detail: string;
  mono?: boolean;
  onPress?: () => void;
}) {
  return (
    <StatCard
      onPress={onPress}
      label={title}
      value={mono && value !== '—' ? value.slice(0, 8) : value}
      hint={detail}
      valueClassName={mono ? 'truncate font-mono' : undefined}
    />
  );
}
