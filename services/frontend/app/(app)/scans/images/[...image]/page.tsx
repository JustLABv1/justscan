'use client';

import { ArtifactScansTable } from '@/components/scans/artifact-scans-table';
import {
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  type RecentActivityRange,
} from '@/components/scans/recent-activity';
import { useToast } from '@/components/toast';
import {
  BACKGROUND_JOB_FINISHED_EVENT,
  announceBackgroundJobEnqueued,
  isScanGroupDeletionJob,
  openBackgroundProcessCenter,
} from '@/lib/api/background-jobs';
import type { BackgroundJob } from '@/lib/api/types/background-jobs';
import {
  filterDisclosureBodyClassName,
  FilterDisclosureTrigger,
} from '@/components/ui/filter-toolbar';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  deleteScan,
  deleteScanArtifactGroup,
  deleteScanImageGroup,
  getScanImageStats,
  listScanArtifacts,
  type ArtifactSummary,
  type ImageStats,
  type Scan,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  AlertDialog,
  Button,
  Card,
  Disclosure,
  Label,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Skeleton,
  Spinner,
} from '@heroui/react';
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Delete01Icon,
  GitCompareIcon,
  Shield01Icon,
  UnhappyIcon,
} from 'hugeicons-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

type MetricTone = 'neutral' | 'danger' | 'success';

type PendingDelete =
  { kind: 'image' } | { kind: 'tag'; artifact: ArtifactSummary } | { kind: 'scan'; scan: Scan };

type QueuedDeletion = {
  jobId: string;
  kind: 'image' | 'tag';
  imageName: string;
  imageTag?: string;
};

const STATUS_OPTIONS = [
  { id: '', label: 'Any state' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked_by_xray_policy', label: 'Blocked by policy' },
  { id: 'running', label: 'Running' },
  { id: 'pending', label: 'Queued' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

const ARTIFACT_PAGE_SIZE = 30;

function decodeImage(parts: string[] | undefined) {
  return (parts ?? [])
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join('/');
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function visiblePageNumbers(totalPages: number, currentPage: number) {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

function pendingDeleteScanCount(
  pendingDelete: PendingDelete | null,
  imageScanCount: number | undefined
) {
  if (!pendingDelete) return 0;
  if (pendingDelete.kind === 'scan') return 1;
  if (pendingDelete.kind === 'tag') return pendingDelete.artifact.scan_count;
  return imageScanCount ?? 0;
}

function artifactKey(imageName: string, imageTag: string) {
  return JSON.stringify([imageName, imageTag]);
}

function Metric({
  label,
  value,
  description,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  description?: string;
  icon: ReactNode;
  tone?: MetricTone;
}) {
  return (
    <StatCard
      className="h-full"
      hint={description}
      icon={icon}
      iconTone={tone === 'neutral' ? 'default' : tone}
      label={label}
      tone={tone}
      value={value}
      valueClassName="text-lg font-semibold tabular-nums"
      variant="compact"
    />
  );
}

export default function ImageScansPage() {
  const params = useParams<{ image?: string[] }>();
  const router = useRouter();
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const imageName = useMemo(() => decodeImage(params.image), [params.image]);
  const [stats, setStats] = useState<ImageStats | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [artifactPage, setArtifactPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [critical, setCritical] = useState<'' | 'yes' | 'no'>('');
  const [policy, setPolicy] = useState<'' | 'fail'>('');
  const [range, setRange] = useState<'' | RecentActivityRange>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedScans, setSelectedScans] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [queuedDeletions, setQueuedDeletions] = useState<Map<string, QueuedDeletion>>(
    () => new Map()
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();
  const bounds = useMemo(() => (range ? getRecentActivityBounds(range) : null), [range]);
  const filterCount = [policy, range].filter(Boolean).length;
  const hasFilters = Boolean(query || status || critical || policy || range);
  const artifactTotalPages = Math.max(1, Math.ceil(total / ARTIFACT_PAGE_SIZE));
  const pendingScanCount = pendingDeleteScanCount(pendingDelete, stats?.total_scans);
  const queuedImageDeletion = useMemo(
    () => Array.from(queuedDeletions.values()).some((deletion) => deletion.kind === 'image'),
    [queuedDeletions]
  );
  const queuedArtifactKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const deletion of queuedDeletions.values()) {
      if (deletion.kind === 'tag' && deletion.imageTag) {
        keys.add(artifactKey(deletion.imageName, deletion.imageTag));
      }
      if (deletion.kind === 'image') {
        artifacts.forEach((artifact) =>
          keys.add(artifactKey(artifact.image_name, artifact.image_tag))
        );
      }
    }
    return keys;
  }, [artifacts, queuedDeletions]);

  useEffect(() => {
    function handleFinished(event: Event) {
      const job = (event as CustomEvent<{ job?: BackgroundJob }>).detail?.job;
      if (!job) return;

      const matching = Array.from(queuedDeletions.entries()).filter(([, deletion]) => {
        if (job.id !== deletion.jobId) return false;
        return isScanGroupDeletionJob(job, deletion.imageName, deletion.imageTag);
      });
      if (matching.length === 0) return;

      const hasImageDeletion = matching.some(([, deletion]) => deletion.kind === 'image');
      setQueuedDeletions((current) => {
        const next = new Map(current);
        matching.forEach(([jobId]) => next.delete(jobId));
        return next;
      });

      const succeeded = job.status === 'succeeded' || job.status === 'completed';
      if (hasImageDeletion && succeeded) {
        router.replace('/scans');
      } else {
        setRefreshKey((current) => current + 1);
      }
    }

    window.addEventListener(BACKGROUND_JOB_FINISHED_EVENT, handleFinished);
    return () => window.removeEventListener(BACKGROUND_JOB_FINISHED_EVENT, handleFinished);
  }, [queuedDeletions, router]);

  useEffect(
    () =>
      deferEffect(() => {
        if (!imageName) return;
        let cancelled = false;
        setStats(null);
        setStatsLoading(true);
        void getScanImageStats(imageName)
          .then((value) => {
            if (!cancelled) setStats(value);
          })
          .catch((reason) => {
            if (!cancelled)
              setError(
                reason instanceof Error ? reason.message : 'Failed to load image statistics'
              );
          })
          .finally(() => {
            if (!cancelled) setStatsLoading(false);
          });
        return () => {
          cancelled = true;
        };
      }),
    [imageName, refreshKey, scopeKey]
  );

  useEffect(
    () =>
      deferEffect(() => {
        if (!imageName) return;
        let cancelled = false;
        setArtifacts([]);
        setTotal(0);
        setLoading(true);
        setError('');
        void listScanArtifacts(
          artifactPage,
          ARTIFACT_PAGE_SIZE,
          query || undefined,
          status || undefined,
          critical,
          policy,
          imageName,
          bounds?.from,
          bounds?.to
        )
          .then((response) => {
            if (!cancelled) {
              setArtifacts(response.data ?? []);
              setTotal(response.total);
            }
          })
          .catch((reason) => {
            if (!cancelled)
              setError(reason instanceof Error ? reason.message : 'Failed to load image scans');
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
        return () => {
          cancelled = true;
        };
      }),
    [
      artifactPage,
      bounds?.from,
      bounds?.to,
      critical,
      imageName,
      policy,
      query,
      refreshKey,
      scopeKey,
      status,
    ]
  );

  useEffect(
    () =>
      deferEffect(() => {
        setArtifactPage(1);
      }),
    [bounds?.from, bounds?.to, critical, imageName, policy, query, scopeKey, status]
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'scan') {
        await deleteScan(pendingDelete.scan.id);
        toast.success('Deleted scan history item');
        setPendingDelete(null);
        setSelectedScans((current) => {
          const next = new Set(current);
          next.delete(pendingDelete.scan.id);
          return next;
        });
        setRefreshKey((current) => current + 1);
        return;
      }

      const deleteTarget = pendingDelete;
      const result =
        deleteTarget.kind === 'image'
          ? await deleteScanImageGroup(imageName)
          : await deleteScanArtifactGroup(imageName, deleteTarget.artifact.image_tag);
      const queuedDeletion: QueuedDeletion =
        deleteTarget.kind === 'image'
          ? { jobId: result.job.id, kind: 'image', imageName }
          : {
              jobId: result.job.id,
              kind: 'tag',
              imageName,
              imageTag: deleteTarget.artifact.image_tag,
            };
      announceBackgroundJobEnqueued(result.job);
      setQueuedDeletions((current) => {
        const next = new Map(current);
        next.set(result.job.id, queuedDeletion);
        return next;
      });
      setPendingDelete(null);
      setSelectedScans(new Set());
      setExpanded(new Set());
      toast.success(
        deleteTarget.kind === 'image' ? 'Image deletion queued' : 'Tag history deletion queued',
        {
          description: 'The cleanup will finish in the background.',
          action: { label: 'View progress', onPress: openBackgroundProcessCenter },
        }
      );
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Failed to delete scan group');
    } finally {
      setDeleting(false);
    }
  }

  if (!imageName)
    return (
      <PageContainer>
        <Card className="p-6 text-sm text-danger">This image reference is invalid.</Card>
      </PageContainer>
    );

  return (
    <PageContainer>
      <PageTitle
        title={imageName}
        icon={<Shield01Icon size={18} />}
        description="Tag-level scan history and health for this image. Statistics cover all visible history."
        breadcrumbs={[{ label: 'Scans', href: '/scans' }, { label: imageName }]}
        actions={
          <>
            <Button onPress={() => router.push('/scans')} variant="secondary">
              <ArrowLeft01Icon size={16} />
              All images
            </Button>
            <Button
              isDisabled={queuedImageDeletion}
              onPress={() => setPendingDelete({ kind: 'image' })}
              variant="danger"
            >
              <Delete01Icon size={16} />
              {queuedImageDeletion ? 'Deletion queued' : 'Delete image'}
            </Button>
          </>
        }
      />
      <AlertDialog
        isOpen={Boolean(pendingDelete)}
        onOpenChange={(isOpen) => {
          if (!isOpen && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialog.Backdrop variant="blur">
          <AlertDialog.Container placement="center">
            <AlertDialog.Dialog className="sm:max-w-[440px]">
              {!deleting ? <AlertDialog.CloseTrigger /> : null}
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>
                  {deleting
                    ? 'Deleting scan history…'
                    : pendingDelete?.kind === 'image'
                      ? 'Delete image scan group?'
                      : pendingDelete?.kind === 'tag'
                        ? 'Delete tag scan history?'
                        : 'Delete scan history item?'}
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {deleting ? (
                  <div
                    aria-busy="true"
                    aria-live="polite"
                    className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-3"
                    role="status"
                  >
                    <Spinner aria-label="Deleting scan history" color="danger" size="md" />
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Deleting {pendingScanCount} scan {pendingScanCount === 1 ? 'run' : 'runs'}…
                      </p>
                      <p className="text-sm leading-6 text-muted">
                        Large histories can take a little while. Keep this window open until the
                        deletion finishes.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-muted">
                    {pendingDelete?.kind === 'image' ? (
                      <>
                        This removes <strong>{imageName}</strong>, including every tag and scan run
                        in this workspace. This cannot be undone.
                      </>
                    ) : pendingDelete?.kind === 'tag' ? (
                      <>
                        This removes <strong>{pendingDelete?.artifact.image_tag}</strong> and all{' '}
                        {pendingDelete?.artifact.scan_count ?? 0} of its historical scan runs. This
                        cannot be undone.
                      </>
                    ) : (
                      <>
                        This removes scan <strong>{pendingDelete?.scan.id.slice(0, 8)}…</strong>{' '}
                        from{' '}
                        <strong>
                          {imageName}:{pendingDelete?.scan.image_tag}
                        </strong>
                        . This cannot be undone.
                      </>
                    )}
                  </p>
                )}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                {!deleting ? (
                  <Button slot="close" variant="tertiary">
                    Cancel
                  </Button>
                ) : null}
                <Button
                  isDisabled={deleting}
                  isPending={deleting}
                  onPress={() => void confirmDelete()}
                  variant="danger"
                >
                  {deleting ? 'Deleting scan history…' : 'Delete'}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
      {queuedDeletions.size > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/30 bg-warning/5 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Spinner aria-hidden className="mt-0.5 shrink-0" color="warning" size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Deletion queued</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                This page stays available while cleanup runs. The row will refresh when it finishes.
              </p>
            </div>
          </div>
          <Button onPress={openBackgroundProcessCenter} size="sm" variant="secondary">
            View progress
          </Button>
        </Card>
      ) : null}
      {statsLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="p-3">
              <Skeleton className="h-10 rounded-lg" />
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <Metric label="Total scans" value={stats.total_scans} icon={<Shield01Icon size={17} />} />
          <Metric
            label="Completed"
            value={stats.completed_scans}
            icon={<CheckmarkCircle02Icon size={17} />}
            tone="success"
          />
          <Metric
            label="Failed executions"
            value={stats.failed_scans}
            icon={<UnhappyIcon size={17} />}
            tone={stats.failed_scans > 0 ? 'danger' : 'neutral'}
          />
          {stats.policy_available && stats.policy_evaluated_scans > 0 ? (
            <>
              <Metric
                label="Policy passed"
                value={stats.policy_passed_scans}
                description={`${stats.policy_evaluated_scans} evaluated`}
                icon={<CheckmarkCircle02Icon size={17} />}
                tone="success"
              />
              <Metric
                label="Policy failed"
                value={stats.policy_failed_scans}
                description={`${stats.policy_evaluated_scans} evaluated`}
                icon={<Shield01Icon size={17} />}
                tone={stats.policy_failed_scans > 0 ? 'danger' : 'neutral'}
              />
            </>
          ) : null}
          <Metric
            label="Average duration"
            value={formatDuration(stats.average_duration_ms)}
            icon={<Clock01Icon size={17} />}
          />
        </div>
      ) : null}
      <Card className="p-3">
        <Disclosure className="w-full">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <SearchField
              aria-label="Search tags or labels"
              className="min-w-0 flex-1"
              value={query}
              onChange={setQuery}
              variant="secondary"
            >
              <Label className="sr-only">Search tags or labels</Label>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search tags or labels…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Select
              aria-label="Latest state"
              className="min-w-[180px]"
              value={status || '__all__'}
              onChange={(value) => setStatus(value === '__all__' ? '' : String(value ?? ''))}
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {STATUS_OPTIONS.map((option) => (
                    <ListBox.Item id={option.id || '__all__'} key={option.id || '__all__'}>
                      {option.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="Current risk"
              className="min-w-[170px]"
              value={critical || '__all__'}
              onChange={(value) =>
                setCritical((value === '__all__' ? '' : (value ?? '')) as '' | 'yes' | 'no')
              }
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">Any risk</ListBox.Item>
                  <ListBox.Item id="yes">Has critical</ListBox.Item>
                  <ListBox.Item id="no">No critical</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="Policy result"
              className="min-w-[180px]"
              value={policy || '__all__'}
              onChange={(value) =>
                setPolicy((value === '__all__' ? '' : (value ?? '')) as '' | 'fail')
              }
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">Any policy result</ListBox.Item>
                  <ListBox.Item id="fail">Policy failed</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <FilterDisclosureTrigger activeCount={filterCount} label="More filters" />
          </div>
          <Disclosure.Content>
            <Disclosure.Body className={filterDisclosureBodyClassName}>
              <Select
                aria-label="Time range"
                className="min-w-[180px] flex-1"
                value={range || '__all__'}
                onChange={(value) =>
                  setRange((value === '__all__' ? '' : (value ?? '')) as '' | RecentActivityRange)
                }
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__all__">All time</ListBox.Item>
                    {RECENT_ACTIVITY_RANGE_OPTIONS.map((option) => (
                      <ListBox.Item id={option.id} key={option.id}>
                        {option.label}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              {hasFilters ? (
                <Button
                  onPress={() => {
                    setQuery('');
                    setStatus('');
                    setCritical('');
                    setPolicy('');
                    setRange('');
                  }}
                  size="sm"
                  variant="tertiary"
                >
                  Clear filters
                </Button>
              ) : null}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      </Card>
      {error ? <Card className="border-danger/40 p-4 text-sm text-danger">{error}</Card> : null}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Tags</h2>
            <p className="mt-1 text-xs text-muted">
              {total} tag{total === 1 ? '' : 's'} matching this view
            </p>
          </div>
          {selectedScans.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">{selectedScans.size} selected</span>
              <Button
                isDisabled={selectedScans.size !== 2}
                onPress={() => {
                  const ids = Array.from(selectedScans);
                  router.push(`/scans/compare?a=${ids[0]}&b=${ids[1]}`);
                }}
                size="sm"
                variant="secondary"
              >
                <GitCompareIcon size={14} />
                Compare
              </Button>
              <Button onPress={() => setSelectedScans(new Set())} size="sm" variant="tertiary">
                Clear
              </Button>
            </div>
          ) : null}
        </div>
        <ArtifactScansTable
          allowHistoryDelete
          allowMutationActions={false}
          artifacts={artifacts}
          childRefreshKey={{}}
          expanded={expanded}
          hasActiveFilters={hasFilters}
          historyRefreshKey={refreshKey}
          hideImageName
          loading={loading}
          onCancel={() => {}}
          onDelete={() => {}}
          onDeleteArtifact={(artifact) => setPendingDelete({ kind: 'tag', artifact })}
          onDeleteHistoryScan={(scan) => setPendingDelete({ kind: 'scan', scan })}
          onRetry={() => {}}
          onExpandedChange={setExpanded}
          onSelectedScansChange={setSelectedScans}
          onShareToWorkspace={() => {}}
          onTransferToWorkspace={() => {}}
          queuedArtifactKeys={queuedArtifactKeys}
          selectedScans={selectedScans}
        />
      </Card>
      {total > 0 ? (
        <Pagination size="sm" className="flex-wrap justify-between gap-3">
          <Pagination.Summary className="text-xs text-muted">
            Showing {(artifactPage - 1) * ARTIFACT_PAGE_SIZE + 1}-
            {Math.min(artifactPage * ARTIFACT_PAGE_SIZE, total)} of {total} tags
          </Pagination.Summary>
          {artifactTotalPages > 1 ? (
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous
                  isDisabled={artifactPage === 1}
                  onPress={() => setArtifactPage((current) => Math.max(1, current - 1))}
                >
                  <Pagination.PreviousIcon />
                  <span>Previous</span>
                </Pagination.Previous>
              </Pagination.Item>
              {visiblePageNumbers(artifactTotalPages, artifactPage).map((value) => (
                <Pagination.Item key={value}>
                  <Pagination.Link
                    isActive={value === artifactPage}
                    onPress={() => setArtifactPage(value)}
                  >
                    {value}
                  </Pagination.Link>
                </Pagination.Item>
              ))}
              <Pagination.Item>
                <Pagination.Next
                  isDisabled={artifactPage === artifactTotalPages}
                  onPress={() =>
                    setArtifactPage((current) => Math.min(artifactTotalPages, current + 1))
                  }
                >
                  <span>Next</span>
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          ) : null}
        </Pagination>
      ) : null}
    </PageContainer>
  );
}
