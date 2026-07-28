'use client';

import { ArtifactScansTable } from '@/components/scans/artifact-scans-table';
import {
  getRecentActivityBounds,
  RECENT_ACTIVITY_RANGE_OPTIONS,
  type RecentActivityRange,
} from '@/components/scans/recent-activity';
import {
  FilterDisclosureTrigger,
  filterDisclosureBodyClassName,
} from '@/components/ui/filter-toolbar';
import { PageContainer, PageTitle } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  deleteScanArtifactGroup,
  deleteScanImageGroup,
  getScanImageStats,
  listScanArtifacts,
  type ArtifactSummary,
  type ImageStats,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { useToast } from '@/components/toast';
import {
  AlertDialog,
  Button,
  Card,
  Disclosure,
  Label,
  ListBox,
  SearchField,
  Select,
  Skeleton,
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

type MetricTone = 'default' | 'danger' | 'success';

type PendingGroupDelete = { kind: 'image' } | { kind: 'tag'; artifact: ArtifactSummary };

const STATUS_OPTIONS = [
  { id: '', label: 'Any state' },
  { id: 'failed', label: 'Failed' },
  { id: 'blocked_by_xray_policy', label: 'Blocked by policy' },
  { id: 'running', label: 'Running' },
  { id: 'pending', label: 'Queued' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

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

function Metric({
  label,
  value,
  description,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  description?: string;
  icon: ReactNode;
  tone?: MetricTone;
}) {
  return <StatCard label={label} value={value} hint={description} icon={icon} tone={tone} />;
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
  const [pendingDelete, setPendingDelete] = useState<PendingGroupDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();
  const bounds = useMemo(() => (range ? getRecentActivityBounds(range) : null), [range]);
  const filterCount = [policy, range].filter(Boolean).length;
  const hasFilters = Boolean(query || status || critical || policy || range);

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
          1,
          100,
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
    [bounds?.from, bounds?.to, critical, imageName, policy, query, refreshKey, scopeKey, status]
  );

  async function confirmDeleteGroup() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const result =
        pendingDelete.kind === 'image'
          ? await deleteScanImageGroup(imageName)
          : await deleteScanArtifactGroup(imageName, pendingDelete.artifact.image_tag);
      toast.success(
        pendingDelete.kind === 'image'
          ? `Deleted ${result.deleted} scan${result.deleted === 1 ? '' : 's'} and all tags`
          : `Deleted ${result.deleted} scan${result.deleted === 1 ? '' : 's'} for ${pendingDelete.artifact.image_tag}`
      );
      setPendingDelete(null);
      setSelectedScans(new Set());
      setExpanded(new Set());
      if (pendingDelete.kind === 'image' || (!hasFilters && total === 1)) {
        router.replace('/scans');
      } else {
        setRefreshKey((current) => current + 1);
      }
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
            <Button onPress={() => setPendingDelete({ kind: 'image' })} variant="danger">
              <Delete01Icon size={16} />
              Delete image
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
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>
                  {pendingDelete?.kind === 'image'
                    ? 'Delete image scan group?'
                    : 'Delete tag scan history?'}
                </AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm leading-6 text-muted">
                  {pendingDelete?.kind === 'image' ? (
                    <>
                      This removes <strong>{imageName}</strong>, including every tag and scan run in
                      this workspace. This cannot be undone.
                    </>
                  ) : (
                    <>
                      This removes <strong>{pendingDelete?.artifact.image_tag}</strong> and all{' '}
                      {pendingDelete?.artifact.scan_count ?? 0} of its historical scan runs. This
                      cannot be undone.
                    </>
                  )}
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button isDisabled={deleting} slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button
                  isPending={deleting}
                  onPress={() => void confirmDeleteGroup()}
                  variant="danger"
                >
                  Delete
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
      {statsLoading ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Card key={index} className="p-3">
              <Skeleton className="h-14 rounded-lg" />
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2">
          <Metric label="Total scans" value={stats.total_scans} icon={<Shield01Icon size={17} />} />
          <Metric
            label="Completed"
            value={stats.completed_scans}
            description="Scanner completed successfully"
            icon={<CheckmarkCircle02Icon size={17} />}
            tone="success"
          />
          <Metric
            label="Failed executions"
            value={stats.failed_scans}
            description="Historical runs; not necessarily the latest"
            icon={<UnhappyIcon size={17} />}
            tone="danger"
          />
          {stats.policy_available ? (
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
                tone="danger"
              />
            </>
          ) : null}
          <Metric
            label="Average duration"
            value={formatDuration(stats.average_duration_ms)}
            description="Completed runs with timing data"
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
          allowMutationActions={false}
          artifacts={artifacts}
          childRefreshKey={{}}
          expanded={expanded}
          hasActiveFilters={hasFilters}
          hideImageName
          loading={loading}
          onCancel={() => {}}
          onDelete={() => {}}
          onDeleteArtifact={(artifact) => setPendingDelete({ kind: 'tag', artifact })}
          onRetry={() => {}}
          onExpandedChange={setExpanded}
          onSelectedScansChange={setSelectedScans}
          onShareToWorkspace={() => {}}
          onTransferToWorkspace={() => {}}
          selectedScans={selectedScans}
        />
      </Card>
    </PageContainer>
  );
}
