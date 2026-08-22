'use client';

import { ScanTagBadgeList } from '@/components/scans/scan-tag-badge-list';
import { IntelligenceSummaryChip } from '@/components/vulnerability-intelligence-status';
import { SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useWorkScope } from '@/hooks/use-work-scope';
import { useToast } from '@/components/toast';
import { ArtifactSummary, listScans, Scan } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { Button, Checkbox, Chip, Pagination, Table } from '@heroui/react';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete01Icon,
  FileSearchIcon,
  LinkSquare02Icon,
  Refresh01Icon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type Key,
  type SetStateAction,
} from 'react';

const HISTORY_LIMIT = 10;
const ARTIFACT_SELECTION_PAGE_SIZE = 100;

type ArtifactScansTableProps = {
  allowHistoryDelete?: boolean;
  allowMutationActions?: boolean;
  artifacts: ArtifactSummary[];
  childRefreshKey: Record<string, number>;
  historyRefreshKey?: number;
  emptyState?: { description: string; title: string };
  expanded: Set<string>;
  hasActiveFilters: boolean;
  loading: boolean;
  onCancel: (scanId: string, artifactKey: string) => Promise<void> | void;
  onDelete: (scanId: string, artifactKey: string) => Promise<void> | void;
  onDeleteArtifact?: (artifact: ArtifactSummary) => void;
  onDeleteHistoryScan?: (scan: Scan) => void;
  onRetry: (scanId: string, artifactKey: string) => Promise<void> | void;
  onExpandedChange: (next: Set<string>) => void;
  onSelectedScansChange: Dispatch<SetStateAction<Set<string>>>;
  onShareToWorkspace: (scanIds: string[]) => void;
  onTransferToWorkspace: (scanIds: string[]) => void;
  selectedScans: Set<string>;
  hideImageName?: boolean;
  queuedArtifactKeys?: ReadonlySet<string>;
};

function artifactKey(imageName: string, imageTag: string) {
  return JSON.stringify([imageName, imageTag]);
}

function splitImageReference(imageName: string) {
  const segments = imageName.split('/');
  const firstSegment = segments[0] ?? '';
  const hasRegistryHost =
    segments.length > 1 &&
    (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost');

  return hasRegistryHost
    ? { registryHost: firstSegment, repositoryPath: segments.slice(1).join('/') }
    : { registryHost: '', repositoryPath: imageName };
}

function ArtifactReference({
  image_name: imageName,
  image_tag: imageTag,
  scan_count: scanCount,
  hideImageName = false,
  deletionQueued = false,
}: ArtifactSummary & { hideImageName?: boolean; deletionQueued?: boolean }) {
  const { registryHost, repositoryPath } = splitImageReference(imageName);
  const reference = `${imageName}:${imageTag}`;

  return (
    <div className="min-w-0 max-w-[32rem]" title={reference}>
      <p className="break-all font-mono text-sm font-medium leading-5 text-zinc-800 dark:text-zinc-100">
        {hideImageName ? (
          <span>{imageTag}</span>
        ) : (
          <>
            {repositoryPath}
            <span className="text-accent">:{imageTag}</span>
          </>
        )}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        {!hideImageName && registryHost ? (
          <span className="break-all font-mono text-[11px] text-zinc-500">{registryHost}</span>
        ) : null}
        <Chip className="text-[10px] font-semibold" color="accent" size="sm" variant="soft">
          {scanCount} run{scanCount === 1 ? '' : 's'}
        </Chip>
        {deletionQueued ? (
          <Chip className="text-[10px] font-semibold" color="warning" size="sm" variant="soft">
            Deletion queued
          </Chip>
        ) : null}
      </div>
    </div>
  );
}

function PolicyFailureChip({
  summary,
}: {
  summary?: ArtifactSummary['compliance_summary'] | Scan['compliance_summary'] | null;
}) {
  const failedPolicies = summary?.failed_policy_names?.filter(Boolean) ?? [];
  if (failedPolicies.length === 0) return null;

  return (
    <Chip color="danger" size="sm" title={failedPolicies.join(', ')} variant="soft">
      Policy failed
    </Chip>
  );
}

function ScanSelectionCheckbox({
  ariaLabel,
  isDisabled = false,
  isSelected,
  onChange,
}: {
  ariaLabel: string;
  isDisabled?: boolean;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
}) {
  return (
    <Checkbox
      aria-label={ariaLabel}
      isDisabled={isDisabled}
      isSelected={isSelected}
      slot={null}
      variant="secondary"
      onChange={onChange}
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Content>
    </Checkbox>
  );
}

function useArtifactHistory(imageName: string, imageTag: string, refreshToken: number) {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const [page, setPage] = useState(1);
  const [scans, setScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        const response = await listScans(
          nextPage,
          HISTORY_LIMIT,
          imageName,
          undefined,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          imageTag
        );
        setScans(response.data ?? []);
        setTotal(response.total);
      } finally {
        setLoading(false);
      }
    },
    [imageName, imageTag]
  );

  useEffect(() => {
    return deferEffect(() => setPage(1));
  }, [imageName, imageTag, refreshToken, scopeKey]);

  useEffect(() => {
    return deferEffect(() => {
      void load(page);
    });
  }, [load, page, refreshToken, scopeKey]);

  useConditionalInterval(
    () => {
      void load(page);
    },
    scans.some((scan) => scan.status === 'pending' || scan.status === 'running'),
    5000
  );

  return {
    loading,
    page,
    scans,
    setPage,
    totalPages: Math.max(1, Math.ceil(total / HISTORY_LIMIT)),
  };
}

function ArtifactHistoryRows({
  allowHistoryDelete,
  allowMutationActions,
  artifact,
  refreshToken,
  onCancel,
  onDelete,
  onDeleteHistoryScan,
  onRetry,
  onSelectScan,
  onShareToWorkspace,
  onTransferToWorkspace,
  selectedScans,
}: {
  allowHistoryDelete: boolean;
  allowMutationActions: boolean;
  artifact: ArtifactSummary;
  refreshToken: number;
  onCancel: (scanId: string) => void;
  onDelete: (scanId: string) => void;
  onDeleteHistoryScan?: (scan: Scan) => void;
  onRetry: (scanId: string) => void;
  onSelectScan: (scanId: string, selected: boolean) => void;
  onShareToWorkspace: (scanIds: string[]) => void;
  onTransferToWorkspace: (scanIds: string[]) => void;
  selectedScans: Set<string>;
}) {
  const router = useRouter();
  const { loading, page, scans, setPage, totalPages } = useArtifactHistory(
    artifact.image_name,
    artifact.image_tag,
    refreshToken
  );
  type HistoryRow =
    | { id: string; kind: 'loading' | 'empty' | 'pagination'; scan?: never }
    | { id: string; kind: 'scan'; scan: Scan };
  const rows = useMemo<HistoryRow[]>(() => {
    if (loading && scans.length === 0) return [{ id: 'loading', kind: 'loading' as const }];
    if (!loading && scans.length === 0) return [{ id: 'empty', kind: 'empty' as const }];
    const scanRows = scans.map((scan) => ({ id: scan.id, kind: 'scan' as const, scan }));
    return totalPages > 1
      ? [...scanRows, { id: 'pagination', kind: 'pagination' as const }]
      : scanRows;
  }, [loading, scans, totalPages]);

  return (
    <Table.Collection items={rows} dependencies={[selectedScans]}>
      {(row) => {
        if (row.kind === 'loading' || row.kind === 'empty') {
          return (
            <Table.Row
              id={`${artifact.latest_scan_id}-${row.id}`}
              textValue={`${row.kind} scan history`}
            >
              <Table.Cell colSpan={8}>
                <div className="px-4 py-3 text-xs text-zinc-500">
                  {row.kind === 'loading' ? 'Loading scan history…' : 'No scan history found.'}
                </div>
              </Table.Cell>
            </Table.Row>
          );
        }
        if (row.kind === 'pagination') {
          return (
            <Table.Row
              id={`${artifact.latest_scan_id}-history-pages`}
              textValue="Scan history pages"
            >
              <Table.Cell colSpan={8}>
                <div className="flex justify-center px-2 py-2">
                  <Pagination size="sm">
                    <Pagination.Content>
                      <Pagination.Item>
                        <Pagination.Previous
                          isDisabled={page === 1}
                          onPress={() => setPage((value) => value - 1)}
                        >
                          <Pagination.PreviousIcon />
                          <span>Previous</span>
                        </Pagination.Previous>
                      </Pagination.Item>
                      {Array.from({ length: totalPages }, (_, index) => index + 1).map(
                        (historyPage) => (
                          <Pagination.Item key={historyPage}>
                            <Pagination.Link
                              isActive={historyPage === page}
                              onPress={() => setPage(historyPage)}
                            >
                              {historyPage}
                            </Pagination.Link>
                          </Pagination.Item>
                        )
                      )}
                      <Pagination.Item>
                        <Pagination.Next
                          isDisabled={page === totalPages}
                          onPress={() => setPage((value) => value + 1)}
                        >
                          <span>Next</span>
                          <Pagination.NextIcon />
                        </Pagination.Next>
                      </Pagination.Item>
                    </Pagination.Content>
                  </Pagination>
                </div>
              </Table.Cell>
            </Table.Row>
          );
        }

        const scan = row.scan;
        if (!scan) return null;
        const openScan = () => router.push(`/scans/details/${scan.id}`);
        return (
          <Table.Row
            id={scan.id}
            className="cursor-pointer bg-surface-secondary/30"
            textValue={`${scan.image_name}:${scan.image_tag}`}
            onClick={openScan}
          >
            <Table.Cell onClick={(event) => event.stopPropagation()}>
              <ScanSelectionCheckbox
                ariaLabel={`Select scan ${scan.id}`}
                isSelected={selectedScans.has(scan.id)}
                onChange={(selected) => onSelectScan(scan.id, selected)}
              />
            </Table.Cell>
            <Table.Cell />
            <Table.Cell>
              <Link
                className="font-mono text-xs text-zinc-500 hover:text-accent"
                href={`/scans/details/${scan.id}`}
                onClick={(event) => event.stopPropagation()}
              >
                {scan.id.slice(0, 8)}…
              </Link>
            </Table.Cell>
            <Table.Cell>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  currentStep={scan.current_step}
                  status={scan.status}
                  externalStatus={scan.external_status}
                />
                <PolicyFailureChip summary={scan.compliance_summary} />
                <IntelligenceSummaryChip compact summary={scan.intelligence_summary} />
              </div>
              <p className="mt-1 text-xs text-zinc-500" title={fullDate(scan.created_at)}>
                {timeAgo(scan.created_at)}
              </p>
            </Table.Cell>
            <Table.Cell>
              <div className="flex items-center gap-1.5">
                <SevCount count={scan.critical_count} level="critical" />
                <SevCount count={scan.high_count} level="high" />
                <SevCount count={scan.medium_count} level="medium" />
                <SevCount count={scan.low_count} level="low" />
              </div>
            </Table.Cell>
            <Table.Cell>
              <ScanTagBadgeList tags={scan.tags} />
            </Table.Cell>
            <Table.Cell onClick={(event) => event.stopPropagation()}>
              <div className="flex justify-end">
                <RowActionsMenu
                  label={`Open actions menu for scan ${scan.id}`}
                  items={[
                    {
                      id: 'open',
                      label: 'Open scan',
                      icon: <FileSearchIcon size={14} aria-hidden />,
                      onAction: openScan,
                    },
                    {
                      id: 'open-new-tab',
                      label: 'Open in new tab',
                      icon: <LinkSquare02Icon size={14} aria-hidden />,
                      onAction: () =>
                        window.open(`/scans/details/${scan.id}`, '_blank', 'noopener,noreferrer'),
                    },
                    ...(allowMutationActions &&
                    (scan.status === 'pending' || scan.status === 'running')
                      ? [
                          {
                            id: 'cancel',
                            label: 'Cancel scan',
                            icon: <Cancel01Icon size={14} aria-hidden />,
                            onAction: () => onCancel(scan.id),
                          },
                        ]
                      : []),
                    ...(allowMutationActions && scan.status === 'failed'
                      ? [
                          {
                            id: 'retry',
                            label: 'Retry failed scan',
                            icon: <Refresh01Icon size={14} aria-hidden />,
                            onAction: () => onRetry(scan.id),
                          },
                        ]
                      : []),
                    ...(allowMutationActions
                      ? [
                          {
                            id: 'share-workspace',
                            label: 'Share with workspace',
                            icon: <Shield01Icon size={14} aria-hidden />,
                            onAction: () => onShareToWorkspace([scan.id]),
                          },
                          {
                            id: 'transfer-workspace',
                            label: 'Transfer ownership',
                            icon: <ArrowRight01Icon size={14} aria-hidden />,
                            onAction: () => onTransferToWorkspace([scan.id]),
                          },
                        ]
                      : []),
                    ...(allowMutationActions || allowHistoryDelete
                      ? [
                          {
                            id: 'delete',
                            label: 'Delete scan history item',
                            icon: <Delete01Icon size={14} aria-hidden />,
                            variant: 'danger' as const,
                            onAction: () =>
                              onDeleteHistoryScan ? onDeleteHistoryScan(scan) : onDelete(scan.id),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </Table.Cell>
          </Table.Row>
        );
      }}
    </Table.Collection>
  );
}

export function ArtifactScansTable({
  allowHistoryDelete = false,
  allowMutationActions = true,
  artifacts,
  childRefreshKey,
  historyRefreshKey,
  emptyState,
  expanded,
  hasActiveFilters,
  loading,
  onCancel,
  onDelete,
  onDeleteArtifact,
  onDeleteHistoryScan,
  onRetry,
  onExpandedChange,
  onSelectedScansChange,
  onShareToWorkspace,
  onTransferToWorkspace,
  selectedScans,
  hideImageName = false,
  queuedArtifactKeys,
}: ArtifactScansTableProps) {
  const router = useRouter();
  const toast = useToast();
  const [selectingArtifactKeys, setSelectingArtifactKeys] = useState<Set<string>>(new Set());
  const artifactKeys = useMemo(
    () =>
      new Set(artifacts.map((artifact) => artifactKey(artifact.image_name, artifact.image_tag))),
    [artifacts]
  );
  const expandedKeys = useMemo(
    () => new Set(Array.from(expanded).filter((key) => artifactKeys.has(key))),
    [artifactKeys, expanded]
  );
  const latestScanIDs = useMemo(
    () => artifacts.map((artifact) => artifact.latest_scan_id),
    [artifacts]
  );
  const allLatestSelected =
    latestScanIDs.length > 0 && latestScanIDs.every((scanId) => selectedScans.has(scanId));

  const setScanSelection = useCallback(
    (scanId: string, selected: boolean) => {
      onSelectedScansChange((current) => {
        const next = new Set(current);
        if (selected) next.add(scanId);
        else next.delete(scanId);
        return next;
      });
    },
    [onSelectedScansChange]
  );

  const setArtifactSelection = useCallback(
    async (artifact: ArtifactSummary, selected: boolean) => {
      const key = artifactKey(artifact.image_name, artifact.image_tag);
      setSelectingArtifactKeys((current) => new Set(current).add(key));
      try {
        const scanIDs = new Set<string>();
        let nextPage = 1;
        let total = 0;

        do {
          const response = await listScans(
            nextPage,
            ARTIFACT_SELECTION_PAGE_SIZE,
            artifact.image_name,
            undefined,
            true,
            undefined,
            undefined,
            undefined,
            undefined,
            artifact.image_tag
          );
          total = response.total;
          const scans = response.data ?? [];
          scans.forEach((scan) => scanIDs.add(scan.id));
          if (scans.length === 0) break;
          nextPage += 1;
        } while (scanIDs.size < total);

        onSelectedScansChange((current) => {
          const next = new Set(current);
          scanIDs.forEach((scanID) => {
            if (selected) next.add(scanID);
            else next.delete(scanID);
          });
          return next;
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to update scan selection');
      } finally {
        setSelectingArtifactKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [onSelectedScansChange, toast]
  );

  const setExpandedKeys = useCallback(
    (keys: Iterable<Key>) => {
      onExpandedChange(new Set(Array.from(keys, String)));
    },
    [onExpandedChange]
  );

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label="Latest scans by image and tag"
          className={hideImageName ? 'min-w-[760px] table-auto' : 'min-w-[980px] table-auto'}
          expandedKeys={expandedKeys}
          treeColumn="expander"
          onExpandedChange={setExpandedKeys}
        >
          <Table.Header>
            <Table.Column className="w-8 pr-0">
              <ScanSelectionCheckbox
                ariaLabel="Select all latest scans on this page"
                isSelected={allLatestSelected}
                onChange={(selected) => {
                  onSelectedScansChange((current) => {
                    const next = new Set(current);
                    latestScanIDs.forEach((scanId) =>
                      selected ? next.add(scanId) : next.delete(scanId)
                    );
                    return next;
                  });
                }}
              />
            </Table.Column>
            <Table.Column id="expander" className="w-9" />
            <Table.Column isRowHeader>{hideImageName ? 'Tag' : 'Image & tag'}</Table.Column>
            <Table.Column>Latest scan</Table.Column>
            <Table.Column>Findings</Table.Column>
            <Table.Column>Labels</Table.Column>
            <Table.Column>Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {loading ? (
              Array.from({ length: 5 }, (_, index) => (
                <Table.Row id={`loading-${index}`} key={`loading-${index}`}>
                  <Table.Cell colSpan={7}>
                    <div className="h-16 animate-pulse rounded-md" />
                  </Table.Cell>
                </Table.Row>
              ))
            ) : artifacts.length === 0 ? (
              <Table.Row id="empty">
                <Table.Cell colSpan={7}>
                  <div className="py-5">
                    <EmptyState
                      icon={<Shield01Icon size={28} />}
                      title={
                        emptyState?.title ??
                        (hasActiveFilters ? 'No image tags match your filters' : 'No scans yet')
                      }
                      description={
                        emptyState?.description ??
                        (hasActiveFilters
                          ? 'Adjust or clear filters above to widen the results.'
                          : 'Scan a Docker image to discover vulnerabilities, SBOMs, and more.')
                      }
                    />
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : (
              <Table.Collection
                items={artifacts}
                dependencies={[selectedScans, queuedArtifactKeys]}
              >
                {(artifact) => {
                  const key = artifactKey(artifact.image_name, artifact.image_tag);
                  const deletionQueued = queuedArtifactKeys?.has(key) ?? false;
                  const openLatestScan = () =>
                    router.push(`/scans/details/${artifact.latest_scan_id}`);
                  return (
                    <Table.Row
                      id={key}
                      className="cursor-pointer"
                      textValue={`${artifact.image_name}:${artifact.image_tag}`}
                      onClick={openLatestScan}
                    >
                      <Table.Cell onClick={(event) => event.stopPropagation()}>
                        <ScanSelectionCheckbox
                          ariaLabel={`Select all scans for ${artifact.image_name}:${artifact.image_tag}`}
                          isDisabled={selectingArtifactKeys.has(key)}
                          isSelected={selectedScans.has(artifact.latest_scan_id)}
                          onChange={(selected) => void setArtifactSelection(artifact, selected)}
                        />
                      </Table.Cell>
                      <Table.Cell onClick={(event) => event.stopPropagation()}>
                        {({ hasChildItems, isDisabled, isExpanded, isTreeColumn }) =>
                          hasChildItems && isTreeColumn ? (
                            <Button
                              isIconOnly
                              aria-label={
                                isExpanded
                                  ? `Collapse history for ${artifact.image_name}:${artifact.image_tag}`
                                  : `Expand history for ${artifact.image_name}:${artifact.image_tag}`
                              }
                              isDisabled={isDisabled}
                              size="sm"
                              slot="chevron"
                              variant="ghost"
                            >
                              {isExpanded ? (
                                <ArrowDown01Icon size={14} className="text-accent" />
                              ) : (
                                <ArrowRight01Icon size={14} />
                              )}
                            </Button>
                          ) : null
                        }
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          aria-label={`Open latest scan for ${artifact.image_name}:${artifact.image_tag}`}
                          className="block -mx-2 -my-1 rounded-md px-2 py-1 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          href={`/scans/details/${artifact.latest_scan_id}`}
                        >
                          <ArtifactReference
                            {...artifact}
                            deletionQueued={deletionQueued}
                            hideImageName={hideImageName}
                          />
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          aria-label={`Open latest scan ${artifact.latest_scan_id}`}
                          className="block -mx-2 -my-1 rounded-md px-2 py-1 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          href={`/scans/details/${artifact.latest_scan_id}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              currentStep={artifact.latest_current_step}
                              status={artifact.latest_status}
                              externalStatus={artifact.latest_external_status}
                            />
                            <PolicyFailureChip summary={artifact.compliance_summary} />
                            <IntelligenceSummaryChip
                              compact
                              summary={artifact.intelligence_summary}
                            />
                          </div>
                          <p className="mt-1 font-mono text-xs text-zinc-500">
                            {artifact.latest_scan_id.slice(0, 8)}…{' '}
                            <span className="font-sans" title={fullDate(artifact.latest_scan_at)}>
                              · {timeAgo(artifact.latest_scan_at)}
                            </span>
                          </p>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          aria-label={`Open findings for ${artifact.image_name}:${artifact.image_tag}`}
                          className="block -mx-2 -my-1 rounded-md px-2 py-1 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          href={`/scans/details/${artifact.latest_scan_id}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <SevCount count={artifact.critical_count} level="critical" />
                            <SevCount count={artifact.high_count} level="high" />
                            <SevCount count={artifact.medium_count} level="medium" />
                            <SevCount count={artifact.low_count} level="low" />
                          </div>
                        </Link>
                      </Table.Cell>
                      <Table.Cell>
                        <Link
                          aria-label={`Open latest scan labels for ${artifact.image_name}:${artifact.image_tag}`}
                          className="block -mx-2 -my-1 rounded-md px-2 py-1 hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                          href={`/scans/details/${artifact.latest_scan_id}`}
                        >
                          <ScanTagBadgeList tags={artifact.tags} />
                        </Link>
                      </Table.Cell>
                      <Table.Cell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end">
                          <RowActionsMenu
                            label={`Open actions menu for ${artifact.image_name}:${artifact.image_tag}`}
                            items={[
                              {
                                id: 'open',
                                label: 'Open latest scan',
                                icon: <FileSearchIcon size={14} aria-hidden />,
                                onAction: openLatestScan,
                              },
                              {
                                id: 'open-new-tab',
                                label: 'Open in new tab',
                                icon: <LinkSquare02Icon size={14} aria-hidden />,
                                onAction: () =>
                                  window.open(
                                    `/scans/details/${artifact.latest_scan_id}`,
                                    '_blank',
                                    'noopener,noreferrer'
                                  ),
                              },
                              ...(allowMutationActions &&
                              (artifact.latest_status === 'pending' ||
                                artifact.latest_status === 'running')
                                ? [
                                    {
                                      id: 'cancel',
                                      label: 'Cancel latest scan',
                                      icon: <Cancel01Icon size={14} aria-hidden />,
                                      onAction: () => onCancel(artifact.latest_scan_id, key),
                                    },
                                  ]
                                : []),
                              ...(allowMutationActions && artifact.latest_status === 'failed'
                                ? [
                                    {
                                      id: 'retry',
                                      label: 'Retry failed scan',
                                      icon: <Refresh01Icon size={14} aria-hidden />,
                                      onAction: () => onRetry(artifact.latest_scan_id, key),
                                    },
                                  ]
                                : []),
                              ...(onDeleteArtifact
                                ? [
                                    {
                                      id: 'delete-artifact',
                                      label: deletionQueued
                                        ? 'Deletion queued'
                                        : 'Delete tag history',
                                      icon: <Delete01Icon size={14} aria-hidden />,
                                      variant: 'danger' as const,
                                      disabled: deletionQueued,
                                      onAction: () => onDeleteArtifact(artifact),
                                    },
                                  ]
                                : allowMutationActions
                                  ? [
                                      {
                                        id: 'share-workspace',
                                        label: 'Share with workspace',
                                        icon: <Shield01Icon size={14} aria-hidden />,
                                        onAction: () =>
                                          onShareToWorkspace([artifact.latest_scan_id]),
                                      },
                                      {
                                        id: 'transfer-workspace',
                                        label: 'Transfer ownership',
                                        icon: <ArrowRight01Icon size={14} aria-hidden />,
                                        onAction: () =>
                                          onTransferToWorkspace([artifact.latest_scan_id]),
                                      },
                                      {
                                        id: 'delete',
                                        label: 'Delete latest scan',
                                        icon: <Delete01Icon size={14} aria-hidden />,
                                        variant: 'danger' as const,
                                        onAction: () => onDelete(artifact.latest_scan_id, key),
                                      },
                                    ]
                                  : []),
                            ]}
                          />
                        </div>
                      </Table.Cell>
                      <ArtifactHistoryRows
                        allowHistoryDelete={allowHistoryDelete}
                        allowMutationActions={allowMutationActions}
                        artifact={artifact}
                        refreshToken={childRefreshKey[key] ?? historyRefreshKey ?? 0}
                        onCancel={(scanId) => onCancel(scanId, key)}
                        onDelete={(scanId) => onDelete(scanId, key)}
                        onDeleteHistoryScan={onDeleteHistoryScan}
                        onRetry={(scanId) => onRetry(scanId, key)}
                        onSelectScan={setScanSelection}
                        onShareToWorkspace={onShareToWorkspace}
                        onTransferToWorkspace={onTransferToWorkspace}
                        selectedScans={selectedScans}
                      />
                    </Table.Row>
                  );
                }}
              </Table.Collection>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
