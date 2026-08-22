'use client';

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
  useOverlayState,
} from '@heroui/react';
import {
  Cancel01Icon,
  Clock01Icon,
  Download01Icon,
  Folder01Icon,
  GitBranchIcon,
  MoreVerticalIcon,
  PackageIcon,
  Search01Icon,
  Settings02Icon,
} from 'hugeicons-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import {
  cancelGitRepositoryRun,
  createGitRepositoryDiscoveryRule,
  createGitRepositoryHelmSource,
  createGitRepositoryImageExclusion,
  deleteGitRepositoryHelmSource,
  deleteGitRepositoryImageExclusion,
  deleteGitRepositoryImageRegistryOverride,
  discoverGitRepository,
  exportGitRepositoryDiscoveryRules,
  getGitRepository,
  getGitRepositoryRun,
  listGitRepositories,
  listGitRepositoryCandidates,
  listGitRepositoryHelmSources,
  listGitRepositoryImageExclusions,
  listGitRepositoryImageRegistryOverrides,
  listGitRepositoryLatestImageScans,
  listGitRepositoryRuns,
  listHelmRegistryCredentials,
  listRegistries,
  runGitRepository,
  setGitRepositoryImageRegistryOverride,
  updateGitRepositoryHelmSource,
  type GitRepository,
  type GitRepositoryHelmSource,
  type GitRepositoryHelmSourceInput,
  type GitRepositoryImageExclusion,
  type GitRepositoryImageRegistryOverride,
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
              <Description className="!block">Match the image host or use the default.</Description>
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
        token. Create a second entry with the same URL for a second credential.
      </Description>
    </Select>
  );
}

function locationsFor(image: GitRepositoryRunImage) {
  return image.locations?.items ?? [];
}

function targetGroup(target: string) {
  if (target.startsWith('Helm chart ')) {
    return { label: 'Helm', path: target.slice('Helm chart '.length) };
  }
  if (target.startsWith('Helm values ')) {
    return { label: 'Helm', path: target.slice('Helm values '.length) };
  }
  if (/kustomization\.ya?ml$/i.test(target)) {
    return { label: 'Kustomize', path: target };
  }
  return { label: 'Manifests', path: target };
}

export default function GitRepositoryDetailPage() {
  const { id } = useParams<{ id: string }>();
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
        nextRegistries,
        nextLatestImageScans,
        nextHelmSources,
        nextCredentials,
      ] = await Promise.all([
        getGitRepository(id),
        listGitRepositoryRuns(id),
        listGitRepositoryImageExclusions(id),
        listGitRepositoryImageRegistryOverrides(id),
        listRegistries().catch(() => []),
        listGitRepositoryLatestImageScans(id),
        listGitRepositoryHelmSources(id),
        listHelmRegistryCredentials().catch(() => []),
      ]);
      setRepository(nextRepository);
      setRuns(nextRuns);
      setImageExclusions(nextExclusions);
      setImageRegistryOverrides(nextImageRegistryOverrides);
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

  async function ignoreCandidate(candidate: GitRepositoryRunCandidate) {
    try {
      await createGitRepositoryDiscoveryRule(id, {
        path_pattern: candidate.path,
        resolution: 'ignore',
        config: {},
      });
      success('Path ignored. Running a new dry discovery.');
      await discover();
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not ignore this path.');
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

  function toggleAllPending(isSelected: boolean) {
    setSelectedCandidateIDs(
      isSelected ? new Set(pendingCandidates.map((candidate) => candidate.id)) : new Set()
    );
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
    if (!registryID && !current) return;
    setSavingImageRegistryRef(imageRef);
    try {
      if (registryID) {
        const override = await setGitRepositoryImageRegistryOverride(id, imageRef, registryID);
        setImageRegistryOverrides((overrides) => [
          override,
          ...overrides.filter((item) => item.full_ref !== imageRef),
        ]);
        success('Image registry override saved.');
      } else if (current) {
        await deleteGitRepositoryImageRegistryOverride(id, current.id);
        setImageRegistryOverrides((overrides) =>
          overrides.filter((item) => item.id !== current.id)
        );
        success('Image registry override cleared.');
      }
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not update the image registry.');
    } finally {
      setSavingImageRegistryRef(null);
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
    const grouped = new Map<string, string[]>();
    for (const image of preview?.images ?? []) {
      for (const location of locationsFor(image)) {
        const source = location.target || location.file;
        const refs = grouped.get(source) ?? [];
        refs.push(image.full_ref);
        grouped.set(source, refs);
      }
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [preview]);

  const filesByDeploymentType = useMemo(() => {
    const groups = new Map<string, Array<[string, string[]]>>();
    for (const [file, refs] of files) {
      const group = targetGroup(file);
      const items = groups.get(group.label) ?? [];
      items.push([group.path, refs]);
      groups.set(group.label, items);
    }
    return ['Kustomize', 'Helm', 'Manifests']
      .map((label) => [label, groups.get(label) ?? []] as const)
      .filter(([, items]) => items.length > 0);
  }, [files]);

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
          <Card.Content className="flex items-center gap-2 py-12 text-sm text-foreground/60">
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
        description={`${repository.clone_url} · ${repository.ref}${repository.owner_type === 'org' ? ' · Scans appear in the organization workspace.' : ''}`}
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

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard
          title="Needs review"
          value={String(candidates.filter((candidate) => candidate.status === 'unresolved').length)}
          detail="ambiguous deployment markers"
        />
        <MetricCard
          title="Latest discovery"
          value={String(previewImages.length)}
          detail="unique image references"
        />
        <MetricCard
          title={
            repository.discovery_mode === 'manifests' ? 'Files with images' : 'Deployment targets'
          }
          value={String(files.length)}
          detail={
            repository.discovery_mode === 'manifests'
              ? 'manifest files represented'
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

      <Card className="overflow-hidden">
        <Card.Header className="!flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
              <PackageIcon size={17} />
            </span>
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
          <Accordion hideSeparator variant="surface">
            <Accordion.Item id="managed-helm-sources">
              <Accordion.Heading>
                <Accordion.Trigger className="px-5 py-3 hover:bg-surface-secondary">
                  <span className="text-sm font-medium">Configured sources</span>
                  <Chip size="sm" variant="soft">
                    {helmSources.length}
                  </Chip>
                  <Accordion.Indicator />
                </Accordion.Trigger>
              </Accordion.Heading>
              <Accordion.Panel>
                <Accordion.Body className="space-y-3 px-5 pb-5">
                  {helmSources.length === 0 ? (
                    <p className="text-sm text-muted">
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
                          className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-divider/70 bg-surface-secondary px-3 py-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <code className="text-xs font-medium text-foreground">
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
                            <p className="text-xs text-muted">
                              {source.values.length > 0
                                ? `Values: ${source.values.join(', ')}`
                                : 'Chart defaults only'}
                              {source.release_name ? ` · Release: ${source.release_name}` : ''}
                            </p>
                            <div className="text-xs text-muted">
                              <p>
                                Dependency credentials:{' '}
                                {credential?.name ??
                                  (source.dependency_registry_id
                                    ? 'Legacy image registry'
                                    : 'Automatic matching')}
                              </p>
                              {credential ? (
                                <p className="mt-0.5 break-all text-muted/80">
                                  {credential.protocol.toUpperCase()} · {credential.url}
                                </p>
                              ) : null}
                              {source.dependency_registry_id ? (
                                <p className="mt-1 text-warning">
                                  Legacy registry link — edit and select a Helm credential to
                                  migrate it.
                                </p>
                              ) : null}
                            </div>
                            {source.source_type === 'url' ? (
                              <p className="truncate text-xs text-muted">
                                {source.clone_url} · {source.ref}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              variant="tertiary"
                              onPress={() => void openHelmSourceEditor(source)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="danger-soft"
                              onPress={() => void removeHelmSource(source)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Card.Content>
      </Card>

      {!preview ? (
        <EmptyState
          icon={<Search01Icon />}
          title="No discovery preview yet"
          description="Run a dry discovery to inspect every image and its Git location before creating a scan."
          action={{ label: 'Run dry discovery', onClick: () => void discover() }}
        />
      ) : (
        <>
          {candidates.length > 0 ? (
            <Card>
              <Card.Header className="!flex-row items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
                  <Search01Icon size={17} />
                </span>
                <div>
                  <Card.Title>Discovery review</Card.Title>
                  <Card.Description>
                    JustScan found deployment markers it cannot safely classify on its own. Ignore a
                    marker when it is not a deployment input.
                  </Card.Description>
                </div>
              </Card.Header>
              <Card.Content>
                <Accordion
                  defaultExpandedKeys={pendingCandidates.length > 0 ? ['pending'] : []}
                  variant="surface"
                >
                  <Accordion.Item id="pending">
                    <Accordion.Heading>
                      <Accordion.Trigger>
                        <span>Needs review</span>
                        <Chip
                          size="sm"
                          color={pendingCandidates.length > 0 ? 'warning' : 'success'}
                          variant="soft"
                        >
                          {pendingCandidates.length}
                        </Chip>
                        <Accordion.Indicator />
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body className="space-y-2">
                        {pendingCandidates.length === 0 ? (
                          <p className="text-sm text-foreground/60">Nothing needs a decision.</p>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
                              <Checkbox
                                isIndeterminate={
                                  selectedCandidateIDs.size > 0 &&
                                  selectedCandidateIDs.size < pendingCandidates.length
                                }
                                isSelected={selectedCandidateIDs.size === pendingCandidates.length}
                                onChange={toggleAllPending}
                                variant="secondary"
                              >
                                <Checkbox.Content>
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                  <Label>Select all pending</Label>
                                </Checkbox.Content>
                              </Checkbox>
                              <Button
                                isDisabled={selectedCandidateIDs.size === 0}
                                isPending={ignoringCandidates}
                                size="sm"
                                variant="secondary"
                                onPress={() => void ignoreSelectedCandidates()}
                              >
                                Ignore selected
                                {selectedCandidateIDs.size > 0
                                  ? ` (${selectedCandidateIDs.size})`
                                  : ''}
                              </Button>
                            </div>
                            {pendingCandidates.map((candidate) => (
                              <CandidateRow
                                key={candidate.id}
                                candidate={candidate}
                                isSelected={selectedCandidateIDs.has(candidate.id)}
                                onIgnore={ignoreCandidate}
                                onReview={review}
                                onSelectedChange={toggleCandidate}
                              />
                            ))}
                          </>
                        )}
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                  {handledCandidates.length > 0 ? (
                    <Accordion.Item id="handled">
                      <Accordion.Heading>
                        <Accordion.Trigger>
                          <span>Resolved and ignored</span>
                          <Chip size="sm" variant="soft">
                            {handledCandidates.length}
                          </Chip>
                          <Accordion.Indicator />
                        </Accordion.Trigger>
                      </Accordion.Heading>
                      <Accordion.Panel>
                        <Accordion.Body className="space-y-2">
                          {handledCandidates.map((candidate) => (
                            <CandidateRow key={candidate.id} candidate={candidate} />
                          ))}
                        </Accordion.Body>
                      </Accordion.Panel>
                    </Accordion.Item>
                  ) : null}
                </Accordion>
              </Card.Content>
            </Card>
          ) : null}
          <Card className="overflow-hidden">
            <Card.Header className="!flex-row items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
                  <PackageIcon size={17} />
                </span>
                <div className="min-w-0">
                  <Card.Title>Discovered images</Card.Title>
                  <Card.Description>
                    Review the images found in this dry run, then scan only the workloads you want
                    to track.
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
              <div className="m-4 mb-0">
                <SearchField
                  aria-label="Search discovered images"
                  className="w-full sm:max-w-md"
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
              </div>
              <div className="m-4 flex flex-wrap items-end gap-4 rounded-xl border border-divider/70 bg-surface-secondary px-3 py-2.5">
                <Checkbox
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
                    <div className="flex flex-col gap-0.5">
                      <Label>Select all scan-enabled images</Label>
                      <Description>
                        {filteredSelectableImages.length}
                        {normalizedImageSearch
                          ? ` of ${selectableImages.length} matching`
                          : ''}{' '}
                        ready to add to a scan
                      </Description>
                    </div>
                  </Checkbox.Content>
                </Checkbox>
                <div className="ml-auto flex shrink-0 flex-wrap gap-2">
                  <Button
                    isDisabled={selectedImageRefs.size === 0}
                    isPending={startingScan}
                    size="sm"
                    variant="primary"
                    onPress={() => void startScan([...selectedImageRefs])}
                  >
                    Scan selected{selectedImageRefs.size > 0 ? ` (${selectedImageRefs.size})` : ''}
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
              </div>
              <div className="border-t border-divider/70">
                {filteredPreviewImages.map((image) => {
                  const locations = locationsFor(image);
                  const exclusion = exclusionByRef.get(image.full_ref);
                  const registryOverride = imageRegistryOverrideByRef.get(image.full_ref);
                  const selectedRegistry = registryOverride
                    ? registryByID.get(registryOverride.registry_id)
                    : undefined;
                  const latestScan = latestScanByRef.get(image.full_ref);
                  return (
                    <div
                      key={image.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-divider/70 px-4 py-3 last:border-b-0 transition-colors hover:bg-surface-hovered"
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
                            <Accordion.Trigger className="min-w-0 py-0">
                              <span className="flex min-w-0 flex-1 items-start gap-3 text-left">
                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-muted">
                                  <PackageIcon size={16} />
                                </span>
                                <span className="min-w-0 flex-1 space-y-1.5">
                                  <code className="block truncate text-xs font-medium text-foreground">
                                    {image.full_ref}
                                  </code>
                                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
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
                                <Chip className="shrink-0" color="warning" size="sm" variant="soft">
                                  Excluded
                                </Chip>
                              ) : null}
                              {registryOverride ? (
                                <Chip className="shrink-0" color="accent" size="sm" variant="soft">
                                  {selectedRegistry?.name ?? 'Custom registry'}
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
                            <Accordion.Body className="mt-3 border-t border-divider/70 pt-3">
                              <div className="mb-4 rounded-lg border border-divider/70 bg-surface-secondary p-3">
                                <ImageRegistrySelect
                                  registries={registries}
                                  value={registryOverride?.registry_id ?? null}
                                  isDisabled={savingImageRegistryRef === image.full_ref}
                                  onChange={(value) =>
                                    void updateImageRegistry(image.full_ref, value)
                                  }
                                />
                              </div>
                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
                                Deployment locations
                              </p>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {locations.map((location) => (
                                  <div
                                    key={`${location.file}:${location.path}`}
                                    className="rounded-lg border border-divider/70 bg-surface-secondary px-3 py-2.5 text-xs"
                                  >
                                    <p className="truncate font-mono text-foreground">
                                      {location.target
                                        ? `Rendered from ${location.target}`
                                        : location.file}
                                    </p>
                                    <p className="mt-1 truncate text-muted">{location.path}</p>
                                    <p className="mt-1.5 text-muted">
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
                  <p className="px-4 py-8 text-center text-sm text-muted">
                    No discovered images match “{imageSearch}”.
                  </p>
                ) : null}
              </div>
            </Card.Content>
          </Card>
          <Card className="overflow-hidden p-0">
            <Accordion hideSeparator>
              <Accordion.Item id="repository-tree">
                <Accordion.Heading>
                  <Accordion.Trigger>
                    <span className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
                        <Folder01Icon size={17} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-foreground">
                          Repository tree
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {repository.discovery_mode === 'manifests'
                            ? 'Source manifests and their detected image references'
                            : 'Rendered deployment targets and their detected image references'}
                        </span>
                      </span>
                    </span>
                    <Chip className="shrink-0" size="sm" variant="soft">
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </Chip>
                    <Accordion.Indicator className="shrink-0" />
                  </Accordion.Trigger>
                </Accordion.Heading>
                <Accordion.Panel>
                  <Accordion.Body className="border-t border-divider/70 px-4 py-4">
                    <div className="space-y-5">
                      {filesByDeploymentType.map(([deploymentType, items]) => (
                        <section key={deploymentType}>
                          <div className="mb-2 flex items-center gap-2">
                            <p className="text-sm font-medium">{deploymentType}</p>
                            <Chip size="sm" variant="soft">
                              {items.length} targets
                            </Chip>
                          </div>
                          <Accordion variant="surface">
                            {items.map(([file, refs]) => (
                              <Accordion.Item
                                key={`${deploymentType}:${file}`}
                                id={`${deploymentType}:${file}`}
                              >
                                <Accordion.Heading>
                                  <Accordion.Trigger>
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                      <Folder01Icon className="shrink-0" size={16} />
                                      <span className="truncate font-mono text-xs">{file}</span>
                                    </span>
                                    <Chip size="sm" variant="soft">
                                      {new Set(refs).size} images
                                    </Chip>
                                    <Accordion.Indicator />
                                  </Accordion.Trigger>
                                </Accordion.Heading>
                                <Accordion.Panel>
                                  <Accordion.Body className="flex flex-wrap gap-2">
                                    {[...new Set(refs)].map((ref) => (
                                      <Chip key={ref} size="sm" variant="soft">
                                        {ref}
                                      </Chip>
                                    ))}
                                  </Accordion.Body>
                                </Accordion.Panel>
                              </Accordion.Item>
                            ))}
                          </Accordion>
                        </section>
                      ))}
                    </div>
                  </Accordion.Body>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Card>
        </>
      )}

      <Card>
        <Card.Header className="!flex-row items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
            <Clock01Icon size={17} />
          </span>
          <div>
            <Card.Title>Recent activity</Card.Title>
            <Card.Description>Latest discovery and scan runs for this repository.</Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="space-y-2">
          {runs.slice(0, 6).map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-3 text-sm">
              <div>
                <Chip
                  size="sm"
                  variant="soft"
                  color={run.trigger === 'dry_run' ? 'accent' : 'default'}
                >
                  {run.trigger === 'dry_run' ? 'Dry run' : run.trigger}
                </Chip>
                <Chip
                  className="ml-2"
                  color={
                    run.status === 'failed'
                      ? 'danger'
                      : run.status === 'completed'
                        ? 'success'
                        : run.status === 'partial'
                          ? 'warning'
                          : 'accent'
                  }
                  size="sm"
                  variant="soft"
                >
                  {run.status}
                </Chip>
                <span className="ml-2">
                  {run.image_count} images · {run.scan_count} scans
                </span>
              </div>
              <span className="text-foreground/60">{timeAgo(run.created_at)}</span>
            </div>
          ))}
        </Card.Content>
      </Card>

      <Modal>
        <Modal.Backdrop isOpen={reviewOverlay.isOpen} onOpenChange={reviewOverlay.setOpen}>
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
        <Modal.Backdrop isOpen={helmSourceOverlay.isOpen} onOpenChange={helmSourceOverlay.setOpen}>
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
}: {
  title: string;
  value: string;
  detail: string;
  mono?: boolean;
}) {
  return (
    <StatCard
      label={title}
      value={value}
      hint={detail}
      variant="stacked"
      className="h-full"
      valueClassName={mono ? 'truncate font-mono text-sm font-semibold' : undefined}
    />
  );
}

function CandidateRow({
  candidate,
  isSelected = false,
  onIgnore,
  onReview,
  onSelectedChange,
}: {
  candidate: GitRepositoryRunCandidate;
  isSelected?: boolean;
  onIgnore?: (candidate: GitRepositoryRunCandidate) => Promise<void>;
  onReview?: (candidate: GitRepositoryRunCandidate) => void;
  onSelectedChange?: (candidateID: string, isSelected: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-divider/70 p-3">
      <div className="flex min-w-0 items-center gap-3">
        {candidate.status === 'unresolved' && onSelectedChange ? (
          <Checkbox
            aria-label={`Select ${candidate.path}`}
            isSelected={isSelected}
            onChange={(next) => onSelectedChange(candidate.id, next)}
            variant="secondary"
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox.Content>
          </Checkbox>
        ) : null}
        <div>
          <p className="font-mono text-xs">{candidate.path}</p>
          <p className="mt-1 text-xs text-foreground/60">
            {candidate.detected_type.replace('_', ' ')} · {candidate.confidence}
          </p>
        </div>
      </div>
      {candidate.status === 'unresolved' && onIgnore && onReview ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="tertiary" onPress={() => void onIgnore(candidate)}>
            Ignore
          </Button>
          <Button size="sm" variant="secondary" onPress={() => onReview(candidate)}>
            <Settings02Icon size={15} /> Resolve
          </Button>
        </div>
      ) : (
        <Chip
          size="sm"
          color={candidate.status === 'ignored' ? 'default' : 'success'}
          variant="soft"
        >
          {candidate.status.replace('_', ' ')}
        </Chip>
      )}
    </div>
  );
}
