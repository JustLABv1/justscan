'use client';

import {
  Accordion,
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import {
  ArrowLeft01Icon,
  Clock01Icon,
  Download01Icon,
  Folder01Icon,
  GitBranchIcon,
  PackageIcon,
  Search01Icon,
  Settings02Icon,
} from 'hugeicons-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useToast } from '@/components/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import {
  createGitRepositoryDiscoveryRule,
  createGitRepositoryImageExclusion,
  deleteGitRepositoryImageExclusion,
  discoverGitRepository,
  exportGitRepositoryDiscoveryRules,
  getGitRepository,
  getGitRepositoryRun,
  listGitRepositoryCandidates,
  listGitRepositoryImageExclusions,
  listGitRepositoryLatestImageScans,
  listGitRepositoryRuns,
  runGitRepository,
  type GitRepository,
  type GitRepositoryImageExclusion,
  type GitRepositoryLatestImageScan,
  type GitRepositoryRun,
  type GitRepositoryRunCandidate,
  type GitRepositoryRunImage,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';

type Preview = { run: GitRepositoryRun; images: GitRepositoryRunImage[] };

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
  const [selectedCandidateIDs, setSelectedCandidateIDs] = useState<Set<string>>(new Set());
  const [selectedImageRefs, setSelectedImageRefs] = useState<Set<string>>(new Set());
  const [imageExclusions, setImageExclusions] = useState<GitRepositoryImageExclusion[]>([]);
  const [latestImageScans, setLatestImageScans] = useState<GitRepositoryLatestImageScan[]>([]);
  const reviewOverlay = useOverlayState();
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [ignoringCandidates, setIgnoringCandidates] = useState(false);
  const [startingScan, setStartingScan] = useState(false);
  const [updatingImageExclusions, setUpdatingImageExclusions] = useState(false);
  const { success, error } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRepository, nextRuns, nextExclusions, nextLatestImageScans] = await Promise.all([
        getGitRepository(id),
        listGitRepositoryRuns(id),
        listGitRepositoryImageExclusions(id),
        listGitRepositoryLatestImageScans(id),
      ]);
      setRepository(nextRepository);
      setRuns(nextRuns);
      setImageExclusions(nextExclusions);
      setLatestImageScans(nextLatestImageScans);
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

  const hasActiveRun = runs.some((run) =>
    ['queued', 'discovering', 'scanning'].includes(run.status)
  );

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
    reviewOverlay.open();
  }

  async function saveResolution() {
    if (!reviewing) return;
    if (resolution === 'helm' && !chart.trim()) {
      error('Enter the local Helm chart path before saving this rule.');
      return;
    }
    const config =
      resolution === 'helm'
        ? {
            chart,
            values: values
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : resolution === 'kustomize' || resolution === 'manifests'
          ? { paths: [reviewing.path] }
          : {};
    try {
      await createGitRepositoryDiscoveryRule(id, {
        path_pattern: reviewing.path,
        resolution,
        config,
      });
      reviewOverlay.close();
      success('Discovery rule saved. Running a new dry discovery.');
      await discover();
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not save discovery rule.');
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
    setSelectedImageRefs(
      isSelected ? new Set(selectableImages.map((image) => image.full_ref)) : new Set()
    );
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
  const latestScanByRef = useMemo(
    () => new Map(latestImageScans.map((scan) => [scan.full_ref, scan])),
    [latestImageScans]
  );
  const selectableImages = previewImages.filter((image) => !exclusionByRef.has(image.full_ref));
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
          <>
            <Button onPress={() => router.push('/git-repositories')} variant="tertiary">
              <ArrowLeft01Icon size={16} /> All repositories
            </Button>
            <Button onPress={() => void exportRules()} variant="secondary">
              <Download01Icon size={16} /> Export .justscan.yaml
            </Button>
            <Button isPending={startingScan} onPress={() => void startScan()} variant="secondary">
              Start full scan
            </Button>
            <Button isPending={discovering} onPress={() => void discover()}>
              <Search01Icon size={16} /> Dry run discovery
            </Button>
          </>
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
            <Card.Header className="!flex-row items-start justify-between gap-4 border-b border-divider/70">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
                  <PackageIcon size={17} />
                </span>
                <div className="min-w-0">
                  <Card.Title>Discovered images</Card.Title>
                  <Card.Description>
                    Review the images found in this dry run, then scan only the workloads you want to track.
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
              <div className="m-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-divider/70 bg-surface-secondary px-3 py-2.5">
                <Checkbox
                  isDisabled={selectableImages.length === 0}
                  isIndeterminate={
                    selectedImageRefs.size > 0 && selectedImageRefs.size < selectableImages.length
                  }
                  isSelected={
                    selectableImages.length > 0 &&
                    selectedImageRefs.size === selectableImages.length
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
                        {selectableImages.length} ready to add to a scan
                      </Description>
                    </div>
                  </Checkbox.Content>
                </Checkbox>
                <div className="flex flex-wrap gap-2">
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
                {previewImages.map((image) => {
                  const locations = locationsFor(image);
                  const exclusion = exclusionByRef.get(image.full_ref);
                  const latestScan = latestScanByRef.get(image.full_ref);
                  return (
                    <div
                      key={image.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-divider/70 px-4 py-3 last:border-b-0 transition-colors hover:bg-surface-secondary"
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
                                      {locations.length} deployment {locations.length === 1 ? 'location' : 'locations'}
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
                              {latestScan ? (
                                <Chip
                                  className="shrink-0"
                                  color={latestScan.status === 'failed' ? 'danger' : latestScan.status === 'completed' ? 'success' : 'accent'}
                                  size="sm"
                                  variant="soft"
                                >
                                  {latestScan.status}
                                </Chip>
                              ) : null}
                              <Accordion.Indicator className="shrink-0" />
                            </Accordion.Trigger>
                          </Accordion.Heading>
                          <Accordion.Panel>
                            <Accordion.Body className="mt-3 border-t border-divider/70 pt-3">
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
                                      {location.target ? `Rendered from ${location.target}` : location.file}
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
                                  onPress={() => router.push(`/scans/details/${latestScan.scan_id}`)}
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
                        <span className="block text-sm font-semibold text-foreground">Repository tree</span>
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
                  color={run.status === 'failed' ? 'danger' : run.status === 'completed' ? 'success' : run.status === 'partial' ? 'warning' : 'accent'}
                  size="sm"
                  variant="soft"
                >
                  {run.status}
                </Chip>
                <span className="ml-2">{run.image_count} images · {run.scan_count} scans</span>
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
                    <FormField
                      label="Local chart path"
                      value={chart}
                      onChange={(event) => setChart(event.target.value)}
                      placeholder="charts/app2"
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
