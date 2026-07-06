'use client';

import { CollectionBadgeList } from '@/components/scans/collection-badge-list';
import { SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useWorkScope } from '@/hooks/use-work-scope';
import { ImageSummary, listScans, Scan } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { Avatar, Button, Checkbox, Chip, Pagination, Popover, Table, Tooltip } from '@heroui/react';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete01Icon,
  FileSearchIcon,
  LinkSquare02Icon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type Key,
  type ReactNode,
  type SetStateAction,
} from 'react';

interface SharedChildProps {
  childRefreshKey: Record<string, number>;
  onCancel: (scanId: string, imageName: string) => Promise<void> | void;
  onDelete: (scanId: string, imageName: string) => Promise<void> | void;
  onSelectScan: (scanId: string, selected: boolean) => void;
  scanUsersById?: Record<string, { displayName: string }>;
  selectedScans: Set<string>;
}

interface ImageScansTableProps extends SharedChildProps {
  allowMutationActions?: boolean;
  collectionFilter?: string;
  expanded: Set<string>;
  expansionScope?: string;
  hasActiveFilters: boolean;
  images: ImageSummary[];
  loading: boolean;
  onClearFilters: () => void;
  onExpandedChange: (next: Set<string>) => void;
  onOpenCreateModal: () => void;
  onSelectedScansChange: Dispatch<SetStateAction<Set<string>>>;
  onSelectImageScans?: (
    imageName: string,
    selected: boolean,
    latestScanId: string,
    visibleScanIds: string[]
  ) => Promise<void> | void;
}

interface ImageScansStackedChildrenProps extends SharedChildProps {
  allowMutationActions: boolean;
  collectionFilter?: string;
  isImageSelected?: boolean;
  imageName: string;
  onVisibleScanIdsChange?: (imageName: string, scanIds: string[]) => void;
}

interface ScanSelectionCheckboxProps {
  ariaLabel: string;
  isIndeterminate?: boolean;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
}

const CHILD_LIMIT = 10;

type ComplianceSummary = Scan['compliance_summary'] | ImageSummary['compliance_summary'];

function failedPolicyNames(summary?: ComplianceSummary | null) {
  return (summary?.failed_policy_names ?? []).map((name) => name.trim()).filter(Boolean);
}

function failedPolicyDetails(summary?: ComplianceSummary | null) {
  const details =
    summary?.failed_policies
      ?.map((policy) => ({
        name: policy.name?.trim() ?? '',
        ruleSummaries: (policy.rule_summaries ?? []).map((rule) => rule.trim()).filter(Boolean),
      }))
      .filter((policy) => policy.name) ?? [];

  if (details.length > 0) {
    return details;
  }

  return failedPolicyNames(summary).map((name) => ({ name, ruleSummaries: [] as string[] }));
}

function PolicyFailureIndicator({
  summary,
}: {
  summary?: ComplianceSummary | null;
}) {
  const failedPolicies = failedPolicyDetails(summary);
  if (failedPolicies.length === 0) {
    return null;
  }

  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger className="inline-flex">
        <Chip color="danger" size="sm" variant="soft">
          Policy failed
        </Chip>
      </Tooltip.Trigger>
      <Tooltip.Content placement="top" showArrow>
        <div className="max-w-xs space-y-2 p-0.5">
          {failedPolicies.map((policy) => (
            <div key={policy.name} className="space-y-1">
              <p className="text-xs font-semibold text-zinc-100">{policy.name}</p>
              {policy.ruleSummaries.length > 0 ? (
                <div className="space-y-0.5">
                  {policy.ruleSummaries.map((rule) => (
                    <p key={`${policy.name}-${rule}`} className="text-[11px] text-zinc-300">
                      {rule}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Tooltip.Content>
    </Tooltip>
  );
}

function scanUserInitials(displayName: string | undefined, ownerUserId: string | undefined) {
  const source = displayName?.trim() || ownerUserId?.trim() || '';
  if (!source) return '—';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function TriggeredByAvatar({
  ownerUserId,
  scanUsersById,
}: {
  ownerUserId?: string | null;
  scanUsersById?: Record<string, { displayName: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (!ownerUserId) {
    return <span className="text-xs text-zinc-500">—</span>;
  }

  const displayName = scanUsersById?.[ownerUserId]?.displayName;
  const label = displayName || ownerUserId;

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Popover.Trigger>
        <button
          type="button"
          aria-label={`Triggered by ${label}`}
          className="inline-flex rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          onClick={(event) => event.stopPropagation()}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          <Avatar size="sm" variant="soft" color="default">
            <Avatar.Fallback>{scanUserInitials(displayName, ownerUserId)}</Avatar.Fallback>
          </Avatar>
        </button>
      </Popover.Trigger>
      <Popover.Content
        placement="top"
        className="rounded-lg"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        <Popover.Dialog className="px-2 py-1 text-xs text-zinc-700 dark:text-zinc-200">
          {label}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

function imageExpansionKey(imageName: string, expansionScope?: string) {
  return expansionScope ? JSON.stringify([expansionScope, imageName]) : imageName;
}

function toggleExpanded(current: Set<string>, expansionKey: string) {
  const next = new Set(current);
  if (next.has(expansionKey)) {
    next.delete(expansionKey);
  } else {
    next.add(expansionKey);
  }
  return next;
}

function ScanSelectionCheckbox({
  ariaLabel,
  isIndeterminate = false,
  isSelected,
  onChange,
}: ScanSelectionCheckboxProps) {
  return (
    <Checkbox
      aria-label={ariaLabel}
      isIndeterminate={isIndeterminate}
      isSelected={isSelected}
      slot={null}
      variant="secondary"
      onChange={onChange}
    >
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator>
            {isIndeterminate ? (
              <svg aria-hidden className="size-3 text-accent-foreground" fill="none" viewBox="0 0 24 24">
                <line
                  x1="21"
                  x2="3"
                  y1="12"
                  y2="12"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="3"
                />
              </svg>
            ) : isSelected ? (
              <svg
                aria-hidden
                className="size-2.5 text-accent-foreground"
                fill="none"
                viewBox="0 0 17 18"
              >
                <polyline
                  points="1 9 7 14 15 4"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                />
              </svg>
            ) : null}
          </Checkbox.Indicator>
        </Checkbox.Control>
      </Checkbox.Content>
    </Checkbox>
  );
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
      <span className="block break-all font-mono text-sm font-medium leading-5 text-zinc-800 dark:text-zinc-200">
        {repositoryPath}
      </span>
      {registryHost ? (
        <span className="mt-0.5 block break-all font-mono text-[11px] leading-4 text-zinc-500 dark:text-zinc-500">
          {registryHost}
        </span>
      ) : null}
    </div>
  );
}

function ScanLink({
  ariaLabel,
  children,
  className,
  scanId,
  title = 'Open scan',
}: {
  ariaLabel?: string;
  children?: ReactNode;
  className?: string;
  scanId: string;
  title?: string;
}) {
  return (
    <Link
      aria-label={ariaLabel}
      href={`/scans/${scanId}`}
      className={className}
      title={title}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  );
}

function useImageScanChildren(imageName: string, refreshToken: number, collectionFilter?: string) {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const [scans, setScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        const res = await listScans(
          nextPage,
          CHILD_LIMIT,
          imageName,
          undefined,
          true,
          undefined,
          undefined,
          collectionFilter
        );
        setScans(res.data ?? []);
        setTotal(res.total);
      } finally {
        setLoading(false);
      }
    },
    [collectionFilter, imageName]
  );

  useEffect(() => {
    return deferEffect(() => {
      setPage(1);
    });
  }, [imageName, refreshToken, scopeKey]);

  useEffect(() => {
    return deferEffect(() => {
      void load(page);
    });
  }, [load, page, refreshToken, scopeKey]);

  useConditionalInterval(
    () => {
      void load(page);
    },
    scans.some((scan) => scan.status === 'running' || scan.status === 'pending'),
    5000
  );

  return {
    loading,
    page,
    scans,
    setPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / CHILD_LIMIT)),
  };
}

function ImageScansTreeChildrenRows({
  allowMutationActions,
  imageName,
  isImageSelected = false,
  childRefreshKey,
  collectionFilter,
  onCancel,
  onDelete,
  onSelectScan,
  scanUsersById,
  selectedScans,
  onVisibleScanIdsChange,
}: ImageScansStackedChildrenProps) {
  const router = useRouter();
  const refreshToken = childRefreshKey[imageName] ?? 0;
  const { loading, page, scans, setPage, totalPages } = useImageScanChildren(
    imageName,
    refreshToken,
    collectionFilter
  );
  const onVisibleScanIdsChangeRef = useRef(onVisibleScanIdsChange);

  const childRows: Array<{
    id: string;
    kind: 'loading' | 'scan' | 'empty' | 'pagination';
    scan?: Scan;
  }> = [];

  if (loading && scans.length === 0) {
    childRows.push({ id: `${imageName}-loading`, kind: 'loading' });
  } else if (!loading && scans.length === 0) {
    childRows.push({ id: `${imageName}-empty`, kind: 'empty' });
  } else {
    scans.forEach((scan) => {
      childRows.push({ id: scan.id, kind: 'scan', scan });
    });
  }

  if (totalPages > 1) {
    childRows.push({ id: `${imageName}-pagination`, kind: 'pagination' });
  }

  useEffect(() => {
    onVisibleScanIdsChangeRef.current = onVisibleScanIdsChange;
  }, [onVisibleScanIdsChange]);

  useEffect(() => {
    onVisibleScanIdsChangeRef.current?.(
      imageName,
      scans.map((scan) => scan.id)
    );
  }, [imageName, scans]);

  return (
    <Table.Collection items={childRows} dependencies={[selectedScans, isImageSelected]}>
      {(row) => {
        if (row.kind === 'loading') {
          return (
            <Table.Row id={row.id} textValue={`Loading scans for ${imageName}`}>
              <Table.Cell colSpan={11}>
                <div className="px-4 py-3.5">
                  <div className="h-7 animate-pulse rounded-md" />
                </div>
              </Table.Cell>
            </Table.Row>
          );
        }

        if (row.kind === 'empty') {
          return (
            <Table.Row id={row.id} textValue={`No scans for ${imageName}`}>
              <Table.Cell colSpan={11}>
                <div className="px-4 py-3 text-xs text-zinc-500">No scans yet.</div>
              </Table.Cell>
            </Table.Row>
          );
        }

        if (row.kind === 'pagination') {
          return (
            <Table.Row id={row.id} textValue={`Scan pages for ${imageName}`}>
              <Table.Cell colSpan={11}>
                <div className="justify-self-center px-2 py-2">
                  <Pagination size="sm">
                    <Pagination.Content>
                      <Pagination.Item>
                        <Pagination.Previous
                          isDisabled={page === 1}
                          onPress={() => setPage((previous) => previous - 1)}
                        >
                          <Pagination.PreviousIcon />
                          <span>Previous</span>
                        </Pagination.Previous>
                      </Pagination.Item>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                        <Pagination.Item key={`${row.id}-${p}`}>
                          <Pagination.Link isActive={p === page} onPress={() => setPage(p)}>
                            {p}
                          </Pagination.Link>
                        </Pagination.Item>
                      ))}
                      <Pagination.Item>
                        <Pagination.Next
                          isDisabled={page === totalPages}
                          onPress={() => setPage((previous) => previous + 1)}
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
        if (!scan) {
          return null;
        }

        const openScan = (event?: {
          ctrlKey?: boolean;
          metaKey?: boolean;
          stopPropagation?: () => void;
        }) => {
          event?.stopPropagation?.();
          const href = `/scans/${scan.id}`;

          if (event?.ctrlKey || event?.metaKey) {
            window.open(href, '_blank', 'noopener,noreferrer');
            return;
          }

          router.push(href);
        };

        return (
          <Table.Row
            id={row.id}
            textValue={`:${scan.image_tag}`}
            className="cursor-pointer"
            onClick={openScan}
          >
            <Table.Cell onClick={(event) => event.stopPropagation()}>
              <ScanSelectionCheckbox
                ariaLabel={`Select scan ${scan.image_tag}`}
                isSelected={isImageSelected || selectedScans.has(scan.id)}
                onChange={(selected) => onSelectScan(scan.id, selected)}
              />
            </Table.Cell>
            <Table.Cell onClick={openScan}>
              <ScanLink
                ariaLabel={`Open scan ${scan.id}`}
                className="block min-h-5"
                scanId={scan.id}
              />
            </Table.Cell>
            <Table.Cell onClick={openScan}>
              <ScanLink
                className="font-mono text-sm font-medium text-zinc-700 transition-colors hover:text-accent dark:text-zinc-200"
                scanId={scan.id}
              >
                :{scan.image_tag}
              </ScanLink>
            </Table.Cell>
            <Table.Cell onClick={openScan}>
              <div className="flex items-center gap-2">
                <StatusBadge status={scan.status} externalStatus={scan.external_status} />
                <PolicyFailureIndicator summary={scan.compliance_summary} />
              </div>
              <div className="mt-1.5">
                <CollectionBadgeList collections={scan.collections} />
              </div>
            </Table.Cell>
            <Table.Cell onClick={openScan}>
              <TriggeredByAvatar ownerUserId={scan.owner_user_id} scanUsersById={scanUsersById} />
            </Table.Cell>
            <Table.Cell onClick={openScan}>
              <div className="min-w-0">
                <ScanLink
                  className="inline-block max-w-[96px] truncate font-mono text-xs text-zinc-500"
                  scanId={scan.id}
                >
                  {scan.id.slice(0, 8)}…
                </ScanLink>
                <div className="mt-1 text-xs text-zinc-500" title={fullDate(scan.created_at)}>
                  {timeAgo(scan.created_at)}
                </div>
              </div>
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <ScanLink className="inline-block" scanId={scan.id}>
                <SevCount count={scan.critical_count} level="critical" />
              </ScanLink>
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <ScanLink className="inline-block" scanId={scan.id}>
                <SevCount count={scan.high_count} level="high" />
              </ScanLink>
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <ScanLink className="inline-block" scanId={scan.id}>
                <SevCount count={scan.medium_count} level="medium" />
              </ScanLink>
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <ScanLink className="inline-block" scanId={scan.id}>
                <SevCount count={scan.low_count} level="low" />
              </ScanLink>
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
                      onAction: () => {
                        router.push(`/scans/${scan.id}`);
                      },
                    },
                    {
                      id: 'open-new-tab',
                      label: 'Open in new tab',
                      icon: <LinkSquare02Icon size={14} aria-hidden />,
                      onAction: () => {
                        window.open(`/scans/${scan.id}`, '_blank', 'noopener,noreferrer');
                      },
                    },
                    ...(allowMutationActions &&
                    (scan.status === 'pending' || scan.status === 'running')
                      ? [
                          {
                            id: 'cancel',
                            label: 'Cancel scan',
                            icon: <Cancel01Icon size={14} aria-hidden />,
                            onAction: () => {
                              void onCancel(scan.id, imageName);
                            },
                          },
                        ]
                      : []),
                    ...(allowMutationActions
                      ? [
                          {
                            id: 'delete',
                            label: 'Delete scan',
                            icon: <Delete01Icon size={14} aria-hidden />,
                            variant: 'danger' as const,
                            onAction: () => {
                              void onDelete(scan.id, imageName);
                            },
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

export function ImageScansTable({
  allowMutationActions = true,
  expanded,
  expansionScope,
  hasActiveFilters,
  images,
  loading,
  collectionFilter,
  onCancel,
  onClearFilters,
  onDelete,
  onExpandedChange,
  onOpenCreateModal,
  onSelectedScansChange,
  onSelectImageScans,
  onSelectScan,
  scanUsersById,
  selectedScans,
  childRefreshKey,
}: ImageScansTableProps) {
  const tableRows = useMemo(() => images, [images]);
  const expansionKeys = useMemo(
    () => new Set(tableRows.map((image) => imageExpansionKey(image.image_name, expansionScope))),
    [expansionScope, tableRows]
  );
  const tableExpandedKeys = useMemo(
    () => new Set(Array.from(expanded).filter((key) => expansionKeys.has(key))),
    [expanded, expansionKeys]
  );
  const [selectedImageNames, setSelectedImageNames] = useState<Set<string>>(new Set());
  const [visibleScanIdsByImage, setVisibleScanIdsByImage] = useState<Record<string, string[]>>({});
  const displaySelectedScans = selectedScans;
  const previousSelectedCountRef = useRef(selectedScans.size);

  useEffect(() => {
    // Only clear explicit parent selections when the global scan selection transitions to empty.
    // This avoids clearing a freshly selected parent row during async selection updates.
    const previousCount = previousSelectedCountRef.current;
    if (previousCount > 0 && selectedScans.size === 0) {
      setSelectedImageNames(new Set());
    }
    previousSelectedCountRef.current = selectedScans.size;
  }, [selectedScans.size]);

  const getSelectableScanIds = useCallback(
    (image: ImageSummary) => {
      const visibleScanIds = visibleScanIdsByImage[image.image_name] ?? [];

      return Array.from(new Set([image.latest_scan_id, ...visibleScanIds]));
    },
    [visibleScanIdsByImage]
  );

  const allSelectableScanIds = useMemo(
    () => tableRows.flatMap((image) => getSelectableScanIds(image)),
    [getSelectableScanIds, tableRows]
  );

  const isAllSelected =
    allSelectableScanIds.length > 0 &&
    allSelectableScanIds.every((scanId) => displaySelectedScans.has(scanId));

  const isPartiallySelected =
    !isAllSelected && allSelectableScanIds.some((scanId) => displaySelectedScans.has(scanId));

  const setScanSelection = useCallback(
    (scanId: string, selected: boolean) => {
      onSelectedScansChange((previous) => {
        const next = new Set(previous);
        if (selected) {
          next.add(scanId);
        } else {
          next.delete(scanId);
        }
        return next;
      });
    },
    [onSelectedScansChange]
  );

  const setScanIdsSelection = useCallback(
    (scanIds: string[], selected: boolean) => {
      onSelectedScansChange((previous) => {
        const next = new Set(previous);
        for (const scanId of scanIds) {
          if (selected) {
            next.add(scanId);
          } else {
            next.delete(scanId);
          }
        }
        return next;
      });
    },
    [onSelectedScansChange]
  );

  const setTableExpandedKeys = useCallback(
    (keys: Iterable<Key>) => {
      const next = new Set(Array.from(expanded).filter((key) => !expansionKeys.has(key)));
      for (const key of keys) {
        next.add(String(key));
      }
      onExpandedChange(next);
    },
    [expanded, expansionKeys, onExpandedChange]
  );

  const toggleImageExpanded = useCallback(
    (imageName: string) => {
      onExpandedChange(toggleExpanded(expanded, imageExpansionKey(imageName, expansionScope)));
    },
    [expanded, expansionScope, onExpandedChange]
  );

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label="Scans by image"
          className="min-w-[980px]"
          expandedKeys={tableExpandedKeys}
          treeColumn="expander"
          onExpandedChange={(keys) => {
            setTableExpandedKeys(keys);
          }}
        >
          <Table.Header>
            <Table.Column className="w-8 pr-0">
              <ScanSelectionCheckbox
                ariaLabel="Select all visible scans"
                isIndeterminate={isPartiallySelected}
                isSelected={isAllSelected}
                onChange={(selected) => {
                  setSelectedImageNames(
                    selected ? new Set(tableRows.map((image) => image.image_name)) : new Set()
                  );
                  setScanIdsSelection(allSelectableScanIds, selected);
                }}
              />
            </Table.Column>
            <Table.Column id="expander" className="w-8" />
            <Table.Column isRowHeader>Image</Table.Column>
            <Table.Column>Metadata</Table.Column>
            <Table.Column>Triggered by</Table.Column>
            <Table.Column>Latest</Table.Column>
            <Table.Column className="text-center" style={{ color: 'rgba(239,68,68,0.7)' }}>
              C
            </Table.Column>
            <Table.Column className="text-center" style={{ color: 'rgba(249,115,22,0.7)' }}>
              H
            </Table.Column>
            <Table.Column className="text-center" style={{ color: 'rgba(234,179,8,0.7)' }}>
              M
            </Table.Column>
            <Table.Column className="text-center" style={{ color: 'rgba(59,130,246,0.7)' }}>
              L
            </Table.Column>
            <Table.Column>Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Table.Row key={`loading-${i}`} id={`loading-${i}`}>
                  <Table.Cell colSpan={11}>
                    <div className="px-4 py-3.5">
                      <div className="h-8 animate-pulse rounded-md" />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            ) : tableRows.length === 0 ? (
              <Table.Row id="empty">
                <Table.Cell colSpan={11}>
                  <div className="py-4">
                    <EmptyState
                      icon={<Shield01Icon size={28} />}
                      title={hasActiveFilters ? 'No images match your filters' : 'No scans yet'}
                      description={
                        hasActiveFilters
                          ? 'Try a different filter combination or clear filters.'
                          : 'Scan a Docker image to discover vulnerabilities, SBOMs, and more.'
                      }
                      action={
                        hasActiveFilters
                          ? { label: 'Clear Filters', onClick: onClearFilters }
                          : allowMutationActions
                            ? { label: '+ New Scan', onClick: onOpenCreateModal }
                            : undefined
                      }
                    />
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : (
              <Table.Collection
                items={tableRows}
                dependencies={[displaySelectedScans, selectedImageNames, visibleScanIdsByImage]}
              >
                {(img) => {
                  const targetIds = getSelectableScanIds(img);
                  const isParentSelected =
                    selectedImageNames.has(img.image_name) ||
                    (targetIds.length > 0 &&
                      targetIds.every((scanId) => displaySelectedScans.has(scanId)));
                  const isParentIndeterminate =
                    !isParentSelected &&
                    targetIds.some((scanId) => displaySelectedScans.has(scanId));

                  return (
                    <Table.Row
                      id={imageExpansionKey(img.image_name, expansionScope)}
                      textValue={img.image_name}
                    >
                      <Table.Cell onClick={(e) => e.stopPropagation()}>
                        <ScanSelectionCheckbox
                          ariaLabel={`Select scans for ${img.image_name}`}
                          isIndeterminate={isParentIndeterminate}
                          isSelected={isParentSelected}
                          onChange={(selected) => {
                            setSelectedImageNames((previous) => {
                              const next = new Set(previous);
                              if (selected) {
                                next.add(img.image_name);
                              } else {
                                next.delete(img.image_name);
                              }
                              return next;
                            });
                            setScanIdsSelection(targetIds, selected);

                            if (onSelectImageScans) {
                              void onSelectImageScans(
                                img.image_name,
                                selected,
                                img.latest_scan_id,
                                visibleScanIdsByImage[img.image_name] ?? []
                              );
                              return;
                            }

                            setScanSelection(img.latest_scan_id, selected);
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        {({ hasChildItems, isDisabled, isExpanded, isTreeColumn }) =>
                          hasChildItems && isTreeColumn ? (
                            <Button
                              isIconOnly
                              aria-label={
                                isExpanded
                                  ? `Collapse ${img.image_name}`
                                  : `Expand ${img.image_name}`
                              }
                              isDisabled={isDisabled}
                              size="sm"
                              slot="chevron"
                              variant="ghost"
                            >
                              {isExpanded ? (
                                <ArrowDown01Icon size={13} className="text-accent" />
                              ) : (
                                <ArrowRight01Icon size={13} />
                              )}
                            </Button>
                          ) : null
                        }
                      </Table.Cell>

                      <Table.Cell
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        <ImageReferenceLabel imageName={img.image_name} />
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="font-mono text-xs text-zinc-400">:{img.latest_tag}</span>
                          <StatusBadge
                            status={img.latest_status}
                            externalStatus={img.latest_external_status}
                          />
                          <PolicyFailureIndicator summary={img.compliance_summary} />
                          <span
                            className="text-xs text-zinc-500"
                            title={fullDate(img.latest_scan_at)}
                          >
                            {timeAgo(img.latest_scan_at)}
                          </span>
                        </div>
                      </Table.Cell>

                      <Table.Cell
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                              color: 'color-mix(in srgb, var(--accent) 78%, white)',
                              borderColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
                            }}
                          >
                            {img.scan_count} scan{img.scan_count !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div className="mt-2">
                          <CollectionBadgeList collections={img.collections} emptyLabel="No collections" />
                        </div>
                      </Table.Cell>
                      <Table.Cell
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        <TriggeredByAvatar
                          ownerUserId={img.owner_user_id}
                          scanUsersById={scanUsersById}
                        />
                      </Table.Cell>

                      <Table.Cell onClick={(event) => event.stopPropagation()}>
                        <Link
                          href={`/scans/${img.latest_scan_id}`}
                          className="inline-block max-w-[96px] truncate font-mono text-xs text-zinc-500 transition-colors hover:text-accent"
                          title="Open latest scan"
                        >
                          {img.latest_scan_id.slice(0, 8)}…
                        </Link>
                      </Table.Cell>

                      <Table.Cell
                        className="text-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        <SevCount count={img.critical_count} level="critical" />
                      </Table.Cell>
                      <Table.Cell
                        className="text-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        <SevCount count={img.high_count} level="high" />
                      </Table.Cell>
                      <Table.Cell
                        className="text-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        <SevCount count={img.medium_count} level="medium" />
                      </Table.Cell>
                      <Table.Cell
                        className="text-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleImageExpanded(img.image_name);
                        }}
                      >
                        <SevCount count={img.low_count} level="low" />
                      </Table.Cell>
                      <Table.Cell
                        className="text-right text-xs text-zinc-500"
                        onClick={(event) => event.stopPropagation()}
                      >
                        —
                      </Table.Cell>

                      <ImageScansTreeChildrenRows
                        allowMutationActions={allowMutationActions}
                        childRefreshKey={childRefreshKey}
                        collectionFilter={collectionFilter}
                        imageName={img.image_name}
                        isImageSelected={isParentSelected}
                        onCancel={onCancel}
                        onDelete={onDelete}
                        onSelectScan={(scanId, selected) => {
                          if (!selected) {
                            setSelectedImageNames((previous) => {
                              const next = new Set(previous);
                              next.delete(img.image_name);
                              return next;
                            });
                          }
                          setScanSelection(scanId, selected);
                        }}
                        onVisibleScanIdsChange={(name, ids) => {
                          setVisibleScanIdsByImage((previous) => {
                            const currentIds = previous[name] ?? [];
                            const unchanged =
                              currentIds.length === ids.length &&
                              currentIds.every((id, index) => id === ids[index]);
                            if (unchanged) {
                              return previous;
                            }
                            return { ...previous, [name]: ids };
                          });
                          if (
                            selectedImageNames.has(name) &&
                            ids.some((scanId) => !displaySelectedScans.has(scanId))
                          ) {
                            onSelectedScansChange((previous) => {
                              const next = new Set(previous);
                              ids.forEach((scanId) => next.add(scanId));
                              return next;
                            });
                          }
                        }}
                        scanUsersById={scanUsersById}
                        selectedScans={displaySelectedScans}
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
