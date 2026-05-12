'use client';

import { OwnershipBadge, SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useWorkScope } from '@/hooks/use-work-scope';
import { ImageSummary, listScans, Scan } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import { Button, Checkbox, Pagination, Table, type Selection } from '@heroui/react';
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
      slot="selection"
      onChange={onChange}
    >
      {({ isIndeterminate: controlIndeterminate, isSelected: controlSelected }) => (
        <Checkbox.Control
          className="border border-zinc-500"
          style={
            controlSelected || controlIndeterminate
              ? {
                  backgroundColor: 'var(--accent)',
                  borderColor: 'var(--accent)',
                }
              : undefined
          }
        >
          <Checkbox.Indicator className="text-white" />
        </Checkbox.Control>
      )}
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
              <Checkbox
                aria-label={`Select scan ${scan.image_tag}`}
                slot="selection"
                variant="secondary"
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
              </Checkbox>
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
                <div className="flex flex-wrap items-center gap-1">
                  {(scan.tags ?? []).map((tag) => (
                    <span
                      key={tag.id}
                      className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        background: `${tag.color}22`,
                        color: tag.color,
                        border: `1px solid ${tag.color}44`,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {(scan.tags ?? []).length === 0 ? (
                    <span className="text-xs text-zinc-500">No tags</span>
                  ) : null}
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
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  onPress={() => {
                    router.push(`/scans/${scan.id}`);
                  }}
                >
                  <FileSearchIcon size={14} aria-hidden />
                  Open
                </Button>
                {(scan.status === 'pending' || scan.status === 'running') && (
                  <Button
                    variant="danger-soft"
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCancel(scan.id, imageName);
                    }}
                  >
                    <Cancel01Icon size={14} aria-hidden />
                    Cancel scan
                  </Button>
                )}
                <Button
                  variant="danger-soft"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDelete(scan.id, imageName);
                  }}
                >
                  <Delete01Icon size={14} aria-hidden />
                </Button>
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
  const [visibleScanIdsByImage, setVisibleScanIdsByImage] = useState<Record<string, string[]>>({});

  const visibleChildScanIds = useMemo(
    () => Array.from(new Set(Object.values(visibleScanIdsByImage).flat())),
    [visibleScanIdsByImage]
  );

  const getSelectableScanIds = useCallback(
    (image: ImageSummary) => {
      const visibleScanIds = visibleScanIdsByImage[image.image_name] ?? [];

      return visibleScanIds.length > 0 ? visibleScanIds : [image.latest_scan_id];
    },
    [visibleScanIdsByImage]
  );

  const selectedTableKeys = useMemo(() => {
    const next = new Set<string>();

    for (const scanId of visibleChildScanIds) {
      if (selectedScans.has(scanId)) {
        next.add(scanId);
      }
    }

    return next;
  }, [selectedScans, visibleChildScanIds]);

  const handleSelectionChange = useCallback(
    (keys: Selection) => {
      const nextKeySet =
        keys === 'all'
          ? new Set(visibleChildScanIds)
          : new Set(Array.from(keys, (key) => String(key)));

      const nextSelectedScans = new Set<string>();

      for (const scanId of selectedScans) {
        if (!visibleChildScanIds.includes(scanId)) {
          nextSelectedScans.add(scanId);
        }
      }

      for (const scanId of visibleChildScanIds) {
        if (nextKeySet.has(scanId)) {
          nextSelectedScans.add(scanId);
        }
      }

      onSelectedScansChange(nextSelectedScans);
    },
    [onSelectedScansChange, selectedScans, visibleChildScanIds]
  );

  const allSelectableScanIds = useMemo(
    () => tableRows.flatMap((image) => getSelectableScanIds(image)),
    [getSelectableScanIds, tableRows]
  );

  const isAllSelected =
    allSelectableScanIds.length > 0 &&
    allSelectableScanIds.every((scanId) => selectedScans.has(scanId));

  const isPartiallySelected =
    !isAllSelected && allSelectableScanIds.some((scanId) => selectedScans.has(scanId));

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content
          aria-label="Scans by image"
          className="min-w-[980px]"
          expandedKeys={expanded}
          selectedKeys={selectedTableKeys}
          selectionMode="multiple"
          treeColumn="expander"
          onExpandedChange={(keys) => {
            onExpandedChange(new Set(Array.from(keys, (key) => String(key))));
          }}
          onSelectionChange={handleSelectionChange}
        >
          <Table.Header>
            <Table.Column className="w-8 pr-0">
              <ScanSelectionCheckbox
                ariaLabel="Select all visible scans"
                isIndeterminate={isPartiallySelected}
                isSelected={isAllSelected}
                onChange={(selected) => {
                  onSelectedScansChange(
                    selected
                      ? new Set([...selectedScans, ...allSelectableScanIds])
                      : new Set(
                          Array.from(selectedScans).filter(
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
                    targetIds.length > 0 && targetIds.every((scanId) => selectedScans.has(scanId));
                  const isParentIndeterminate =
                    !isParentSelected && targetIds.some((scanId) => selectedScans.has(scanId));

                  return (
                    <Table.Row id={img.image_name} textValue={img.image_name}>
                      <Table.Cell onClick={(e) => e.stopPropagation()}>
                        <ScanSelectionCheckbox
                          ariaLabel={`Select scans for ${img.image_name}`}
                          isIndeterminate={isParentIndeterminate}
                          isSelected={isParentSelected}
                          onChange={(selected) => {
                            if (onSelectImageScans) {
                              void onSelectImageScans(
                                img.image_name,
                                selected,
                                img.latest_scan_id,
                                visibleScanIdsByImage[img.image_name] ?? []
                              );
                              return;
                            }

                            onSelectScan(img.latest_scan_id, selected);
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell>
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
                                <ArrowDown01Icon size={13} className="text-violet-400" />
                              ) : (
                                <ArrowRight01Icon size={13} />
                              )}
                            </Button>
                          ) : null
                        }
                      </Table.Cell>

                      <Table.Cell>
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

                      <Table.Cell>
                        <div className="flex items-center gap-3">
                          <div
                            className="shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              background: 'rgba(124,58,237,0.1)',
                              color: '#a78bfa',
                              borderColor: 'rgba(167,139,250,0.2)',
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

                      <Table.Cell>
                        <Link
                          href={`/scans/${img.latest_scan_id}`}
                          className="inline-block max-w-[96px] truncate font-mono text-xs text-zinc-500 transition-colors hover:text-violet-400"
                          title="Open latest scan"
                        >
                          {img.latest_scan_id.slice(0, 8)}…
                        </Link>
                      </Table.Cell>

                      <Table.Cell className="text-center">
                        <SevCount count={img.critical_count} level="critical" />
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <SevCount count={img.high_count} level="high" />
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <SevCount count={img.medium_count} level="medium" />
                      </Table.Cell>
                      <Table.Cell className="text-center">
                        <SevCount count={img.low_count} level="low" />
                      </Table.Cell>
                      <Table.Cell className="text-right text-xs text-zinc-500">—</Table.Cell>

                      <ImageScansTreeChildrenRows
                        childRefreshKey={childRefreshKey}
                        imageName={img.image_name}
                        onCancel={onCancel}
                        onDelete={onDelete}
                        onSelectScan={onSelectScan}
                        onVisibleScanIdsChange={(name, ids) => {
                          setVisibleScanIdsByImage((previous) => ({ ...previous, [name]: ids }));
                        }}
                        orgNamesById={orgNamesById}
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
