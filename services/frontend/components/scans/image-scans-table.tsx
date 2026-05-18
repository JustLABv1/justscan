'use client';

import { OwnershipBadge, SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useWorkScope } from '@/hooks/use-work-scope';
import { ImageSummary, listScans, Scan } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { Button, Pagination, Table } from '@heroui/react';
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete01Icon,
  FileSearchIcon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface SharedChildProps {
  childRefreshKey: Record<string, number>;
  onCancel: (scanId: string, imageName: string) => Promise<void> | void;
  onDelete: (scanId: string, imageName: string) => Promise<void> | void;
  onSelectScan: (scanId: string, selected: boolean) => void;
  orgNamesById?: Record<string, string>;
  selectedScans: Set<string>;
}

interface ImageScansTableProps extends SharedChildProps {
  expanded: Set<string>;
  hasActiveFilters: boolean;
  images: ImageSummary[];
  loading: boolean;
  onClearFilters: () => void;
  onExpandedChange: (next: Set<string>) => void;
  onOpenCreateModal: () => void;
  onSelectedScansChange: (next: Set<string>) => void;
  onSelectImageScans?: (
    imageName: string,
    selected: boolean,
    latestScanId: string,
    visibleScanIds: string[]
  ) => Promise<void> | void;
}

interface ImageScansStackedChildrenProps extends SharedChildProps {
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

function toggleExpanded(current: Set<string>, imageName: string) {
  const next = new Set(current);
  if (next.has(imageName)) {
    next.delete(imageName);
  } else {
    next.add(imageName);
  }
  return next;
}

function ScanSelectionCheckbox({
  ariaLabel,
  isIndeterminate = false,
  isSelected,
  onChange,
}: ScanSelectionCheckboxProps) {
  const active = isSelected || isIndeterminate;

  return (
    <button
      aria-label={ariaLabel}
      aria-checked={isIndeterminate ? 'mixed' : isSelected}
      className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      role="checkbox"
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onChange(!isSelected);
      }}
    >
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-md border text-[10px] font-bold leading-none"
        style={{
          backgroundColor: active ? 'var(--accent)' : 'transparent',
          borderColor: active ? 'var(--accent)' : 'rgb(113 113 122)',
          color: '#fff',
        }}
      >
        {isIndeterminate ? '−' : isSelected ? '✓' : ''}
      </span>
    </button>
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

function useImageScanChildren(imageName: string, refreshToken: number) {
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
        const res = await listScans(nextPage, CHILD_LIMIT, imageName, undefined, true);
        setScans(res.data ?? []);
        setTotal(res.total);
      } finally {
        setLoading(false);
      }
    },
    [imageName]
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
  imageName,
  isImageSelected = false,
  childRefreshKey,
  onCancel,
  onDelete,
  onSelectScan,
  orgNamesById,
  selectedScans,
  onVisibleScanIdsChange,
}: ImageScansStackedChildrenProps) {
  const router = useRouter();
  const refreshToken = childRefreshKey[imageName] ?? 0;
  const { loading, page, scans, setPage, totalPages } = useImageScanChildren(
    imageName,
    refreshToken
  );

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
    onVisibleScanIdsChange?.(
      imageName,
      scans.map((scan) => scan.id)
    );
  }, [imageName, onVisibleScanIdsChange, scans]);

  return (
    <Table.Collection items={childRows}>
      {(row) => {
        if (row.kind === 'loading') {
          return (
            <Table.Row id={row.id} textValue={`Loading scans for ${imageName}`}>
              <Table.Cell colSpan={10}>
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
              <Table.Cell colSpan={10}>
                <div className="px-4 py-3 text-xs text-zinc-500">No scans yet.</div>
              </Table.Cell>
            </Table.Row>
          );
        }

        if (row.kind === 'pagination') {
          return (
            <Table.Row id={row.id} textValue={`Scan pages for ${imageName}`}>
              <Table.Cell colSpan={10}>
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

        const openScan = (event?: { stopPropagation?: () => void }) => {
          event?.stopPropagation?.();
          router.push(`/scans/${scan.id}`);
        };

        return (
          <Table.Row id={row.id} textValue={`:${scan.image_tag}`} className="cursor-pointer">
            <Table.Cell onClick={(event) => event.stopPropagation()}>
              <ScanSelectionCheckbox
                ariaLabel={`Select scan ${scan.image_tag}`}
                isSelected={isImageSelected || selectedScans.has(scan.id)}
                onChange={(selected) => onSelectScan(scan.id, selected)}
              />
            </Table.Cell>
            <Table.Cell onClick={openScan} />
            <Table.Cell onClick={openScan}>
              <span className="font-mono text-sm font-medium text-zinc-700 dark:text-zinc-200">
                :{scan.image_tag}
              </span>
            </Table.Cell>
            <Table.Cell onClick={openScan}>
              <div className="flex items-center gap-2">
                <StatusBadge status={scan.status} externalStatus={scan.external_status} />
                <OwnershipBadge
                  ownerType={scan.owner_type}
                  ownerOrgId={scan.owner_org_id}
                  orgNamesById={orgNamesById}
                />
              </div>
            </Table.Cell>
            <Table.Cell onClick={openScan}>
              <div className="min-w-0">
                <div
                  className="inline-block max-w-[96px] truncate font-mono text-xs text-zinc-500"
                  title="Open scan"
                >
                  {scan.id.slice(0, 8)}…
                </div>
                <div className="mt-1 text-xs text-zinc-500" title={fullDate(scan.created_at)}>
                  {timeAgo(scan.created_at)}
                </div>
              </div>
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <SevCount count={scan.critical_count} level="critical" />
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <SevCount count={scan.high_count} level="high" />
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <SevCount count={scan.medium_count} level="medium" />
            </Table.Cell>
            <Table.Cell className="text-center" onClick={openScan}>
              <SevCount count={scan.low_count} level="low" />
            </Table.Cell>
            <Table.Cell>
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
                    ...(scan.status === 'pending' || scan.status === 'running'
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
                    {
                      id: 'delete',
                      label: 'Delete scan',
                      icon: <Delete01Icon size={14} aria-hidden />,
                      variant: 'danger' as const,
                      onAction: () => {
                        void onDelete(scan.id, imageName);
                      },
                    },
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
  expanded,
  hasActiveFilters,
  images,
  loading,
  onCancel,
  onClearFilters,
  onDelete,
  onExpandedChange,
  onOpenCreateModal,
  onSelectedScansChange,
  onSelectImageScans,
  onSelectScan,
  orgNamesById,
  selectedScans,
  childRefreshKey,
}: ImageScansTableProps) {
  const tableRows = useMemo(() => images, [images]);
  const [selectedImageNames, setSelectedImageNames] = useState<Set<string>>(new Set());
  const [localSelectedScans, setLocalSelectedScans] = useState<Set<string>>(new Set());
  const [visibleScanIdsByImage, setVisibleScanIdsByImage] = useState<Record<string, string[]>>({});

  useEffect(() => {
    return deferEffect(() => {
      setLocalSelectedScans(new Set(selectedScans));
      if (selectedScans.size === 0) {
        setSelectedImageNames(new Set());
      }
    });
  }, [selectedScans]);

  const displaySelectedScans = localSelectedScans;

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

  const effectiveSelectedImageNames = useMemo(
    () => (displaySelectedScans.size === 0 ? new Set<string>() : selectedImageNames),
    [displaySelectedScans.size, selectedImageNames]
  );

  const setScanSelection = useCallback(
    (scanId: string, selected: boolean) => {
      setLocalSelectedScans((previous) => {
        const next = new Set(previous.size > 0 ? previous : selectedScans);
        if (selected) {
          next.add(scanId);
        } else {
          next.delete(scanId);
        }
        return next;
      });
      onSelectScan(scanId, selected);
    },
    [onSelectScan, selectedScans]
  );

  const setScanIdsSelection = useCallback(
    (scanIds: string[], selected: boolean) => {
      setLocalSelectedScans((previous) => {
        const next = new Set(previous.size > 0 ? previous : selectedScans);
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
    [selectedScans]
  );

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label="Scans by image"
          className="min-w-[980px]"
          expandedKeys={expanded}
          treeColumn="expander"
          onExpandedChange={(keys) => {
            onExpandedChange(new Set(Array.from(keys, (key) => String(key))));
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
                  onSelectedScansChange(
                    selected
                      ? new Set([...displaySelectedScans, ...allSelectableScanIds])
                      : new Set(
                          Array.from(displaySelectedScans).filter(
                            (scanId) => !allSelectableScanIds.includes(scanId)
                          )
                        )
                  );
                }}
              />
            </Table.Column>
            <Table.Column id="expander" className="w-8" />
            <Table.Column isRowHeader>Image</Table.Column>
            <Table.Column>Metadata</Table.Column>
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
                  <Table.Cell colSpan={10}>
                    <div className="px-4 py-3.5">
                      <div className="h-8 animate-pulse rounded-md" />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))
            ) : tableRows.length === 0 ? (
              <Table.Row id="empty">
                <Table.Cell colSpan={10}>
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
                          : { label: '+ New Scan', onClick: onOpenCreateModal }
                      }
                    />
                  </div>
                </Table.Cell>
              </Table.Row>
            ) : (
              <Table.Collection items={tableRows}>
                {(img) => {
                  const targetIds = getSelectableScanIds(img);
                  const isParentSelected =
                    effectiveSelectedImageNames.has(img.image_name) ||
                    (targetIds.length > 0 &&
                      targetIds.every((scanId) => displaySelectedScans.has(scanId)));
                  const isParentIndeterminate =
                    !isParentSelected &&
                    targetIds.some((scanId) => displaySelectedScans.has(scanId));

                  return (
                    <Table.Row id={img.image_name} textValue={img.image_name}>
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
                          onExpandedChange(toggleExpanded(expanded, img.image_name));
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
                          onExpandedChange(toggleExpanded(expanded, img.image_name));
                        }}
                      >
                        <ImageReferenceLabel imageName={img.image_name} />
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="font-mono text-xs text-zinc-400">:{img.latest_tag}</span>
                          <StatusBadge
                            status={img.latest_status}
                            externalStatus={img.latest_external_status}
                          />
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
                          onExpandedChange(toggleExpanded(expanded, img.image_name));
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
                          <OwnershipBadge
                            ownerType={img.owner_type}
                            ownerOrgId={img.owner_org_id}
                            orgNamesById={orgNamesById}
                          />
                        </div>
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
                          onExpandedChange(toggleExpanded(expanded, img.image_name));
                        }}
                      >
                        <SevCount count={img.critical_count} level="critical" />
                      </Table.Cell>
                      <Table.Cell
                        className="text-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          onExpandedChange(toggleExpanded(expanded, img.image_name));
                        }}
                      >
                        <SevCount count={img.high_count} level="high" />
                      </Table.Cell>
                      <Table.Cell
                        className="text-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          onExpandedChange(toggleExpanded(expanded, img.image_name));
                        }}
                      >
                        <SevCount count={img.medium_count} level="medium" />
                      </Table.Cell>
                      <Table.Cell
                        className="text-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          onExpandedChange(toggleExpanded(expanded, img.image_name));
                        }}
                      >
                        <SevCount count={img.low_count} level="low" />
                      </Table.Cell>
                      <Table.Cell className="text-right text-xs text-zinc-500" onClick={(event) => event.stopPropagation()}>
                        —
                      </Table.Cell>

                      <ImageScansTreeChildrenRows
                        childRefreshKey={childRefreshKey}
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
                          setVisibleScanIdsByImage((previous) => ({ ...previous, [name]: ids }));
                          if (
                            effectiveSelectedImageNames.has(name) &&
                            ids.some((scanId) => !displaySelectedScans.has(scanId))
                          ) {
                            const next = new Set([...displaySelectedScans, ...ids]);
                            setLocalSelectedScans(next);
                            onSelectedScansChange(next);
                          }
                        }}
                        orgNamesById={orgNamesById}
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
