'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Container, Tag, ScanLine } from 'lucide-react';
import { IntelligenceSummaryChip } from '@/components/vulnerability-intelligence-status';
import { SevCount, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { Button, Chip, Spinner, Table } from '@/components/ui';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  listScanArtifacts,
  listScans,
  type ArtifactSummary,
  type ImageOverview,
  type Scan,
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Delete01Icon, Shield01Icon } from 'hugeicons-react';

type Props = {
  toolbar?: ReactNode;
  images: ImageOverview[];
  loading: boolean;
  hasActiveFilters: boolean;
  onDeleteImage: (image: ImageOverview) => void;
  queuedImageNames?: ReadonlySet<string>;
};
type Branch<T> = {
  data: T[];
  total: number;
  page: number;
  loading: boolean;
  error?: string;
  requestedPage?: number;
};
type Row =
  | { id: string; kind: 'image'; image: ImageOverview }
  | { id: string; kind: 'tag'; tag: ArtifactSummary }
  | { id: string; kind: 'scan'; scan: Scan }
  | { id: string; kind: 'branch'; parent: string; image: string; tag?: string };
const LIMIT = 20;
const imageKey = (image: string) => JSON.stringify([image]);
const tagKey = (image: string, tag: string) => JSON.stringify([image, tag]);

export function ImageOverviewTable(props: Props) {
  const scope = useWorkScope();
  return <ScanTreeTable key={scope.kind === 'org' ? scope.orgId : 'personal'} {...props} />;
}

function Findings({
  critical,
  high,
  medium,
  low,
}: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <SevCount count={critical} level="critical" />
      <SevCount count={high} level="high" />
      <SevCount count={medium} level="medium" />
      <SevCount count={low} level="low" />
    </div>
  );
}

function useScanTreeData(images: ImageOverview[]) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [tags, setTags] = useState<Record<string, Branch<ArtifactSummary>>>({});
  const [runs, setRuns] = useState<Record<string, Branch<Scan>>>({});

  async function loadBranch(image: string, tag?: string, page = 1) {
    const key = tag === undefined ? imageKey(image) : tagKey(image, tag);
    const pending = <T,>(current: Record<string, Branch<T>>) => ({
      ...current,
      [key]: {
        data: current[key]?.data ?? [],
        total: current[key]?.total ?? 0,
        page: current[key]?.page ?? 0,
        loading: true,
        requestedPage: page,
      },
    });
    if (tag === undefined) setTags(pending);
    else setRuns(pending);
    try {
      if (tag === undefined) {
        const result = await listScanArtifacts(
          page,
          LIMIT,
          undefined,
          undefined,
          undefined,
          undefined,
          image
        );
        setTags((current) => ({
          ...current,
          [key]: {
            data: page === 1 ? result.data : [...(current[key]?.data ?? []), ...result.data],
            total: result.total,
            page,
            loading: false,
          },
        }));
      } else {
        const result = await listScans(
          page,
          LIMIT,
          image,
          undefined,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          tag
        );
        setRuns((current) => ({
          ...current,
          [key]: {
            data: page === 1 ? result.data : [...(current[key]?.data ?? []), ...result.data],
            total: result.total,
            page,
            loading: false,
          },
        }));
      }
    } catch (error) {
      const failed = <T,>(current: Record<string, Branch<T>>) => ({
        ...current,
        [key]: {
          ...current[key],
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load scans',
        },
      });
      if (tag === undefined) setTags(failed);
      else setRuns(failed);
    }
  }

  function toggle(image: string, tag?: string) {
    const key = tag === undefined ? imageKey(image) : tagKey(image, tag);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!expanded.has(key) && !(tag === undefined ? tags[key] : runs[key])?.loading)
      void loadBranch(image, tag);
  }

  return {
    expanded,
    tags,
    runs,
    loadBranch,
    toggle,
    rows: buildRows(images, tags, runs, expanded),
    setExpanded,
  };
}

function buildRows(
  images: ImageOverview[],
  tags: Record<string, Branch<ArtifactSummary>>,
  runs: Record<string, Branch<Scan>>,
  expanded: Set<string>
) {
  const rows: Row[] = [];
  for (const image of images) {
    const key = imageKey(image.image_name);
    rows.push({ id: key, kind: 'image', image });
    if (!expanded.has(key)) continue;
    for (const tag of tags[key]?.data ?? []) {
      const childKey = tagKey(tag.image_name, tag.image_tag);
      rows.push({ id: childKey, kind: 'tag', tag });
      if (!expanded.has(childKey)) continue;
      for (const scan of runs[childKey]?.data ?? [])
        rows.push({ id: `scan:${scan.id}`, kind: 'scan', scan });
      const branch = runs[childKey];
      if (
        !branch ||
        branch.loading ||
        branch.error ||
        branch.data.length < branch.total ||
        branch.total === 0
      )
        rows.push({
          id: `more:${childKey}`,
          kind: 'branch',
          parent: childKey,
          image: tag.image_name,
          tag: tag.image_tag,
        });
    }
    const branch = tags[key];
    if (
      !branch ||
      branch.loading ||
      branch.error ||
      branch.data.length < branch.total ||
      branch.total === 0
    )
      rows.push({ id: `more:${key}`, kind: 'branch', parent: key, image: image.image_name });
  }

  return rows;
}

function ScanTreeTable({
  toolbar,
  images,
  loading,
  hasActiveFilters,
  onDeleteImage,
  queuedImageNames,
}: Props) {
  const tree = useScanTreeData(images);
  const { expanded, setExpanded, rows } = tree;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-medium">Scanned images</h2>
          <p className="text-xs text-muted-foreground">
            Expand an image to browse tags and scan history.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          isDisabled={expanded.size === 0}
          onPress={() => setExpanded(new Set())}
        >
          Collapse all
        </Button>
      </div>
      {toolbar}
      <Table>
        <Table.ScrollContainer className="rounded-none border-0">
          <Table.Content
            aria-label="Scanned images, tags and scan history"
            className="min-w-[1152px] table-fixed [&_td]:px-3 [&_th]:px-3"
          >
            <Table.Header>
              <Table.Column isRowHeader className="w-auto">
                Image / tag / scan
              </Table.Column>
              <Table.Column className="w-[216px]">Status</Table.Column>
              <Table.Column className="w-[216px]">Findings</Table.Column>
              <Table.Column className="w-[144px]">History</Table.Column>
              <Table.Column className="w-[144px]">Scanned</Table.Column>
              <Table.Column className="w-14">
                <span className="sr-only">Actions</span>
              </Table.Column>
            </Table.Header>
            <Table.Body>
              {loading ? (
                Array.from({ length: 5 }, (_, i) => (
                  <Table.Row key={i} id={`loading:${i}`}>
                    <Table.Cell colSpan={6}>
                      <div className="h-10 animate-pulse rounded bg-muted" />
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : images.length === 0 ? (
                <Table.Row id="empty">
                  <Table.Cell colSpan={6}>
                    <div className="py-8">
                      <EmptyState
                        icon={<Shield01Icon size={28} />}
                        title={hasActiveFilters ? 'No images match your filters' : 'No scans yet'}
                        description={
                          hasActiveFilters
                            ? 'Adjust or clear the filters to widen the results.'
                            : 'Run a scan to start tracking image health.'
                        }
                      />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ) : (
                <Table.Collection items={rows}>
                  {(row) => renderTreeRow(row, tree, onDeleteImage, queuedImageNames)}
                </Table.Collection>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  );
}

function renderTreeRow(
  row: Row,
  tree: ReturnType<typeof useScanTreeData>,
  onDeleteImage: Props['onDeleteImage'],
  queuedImageNames: Props['queuedImageNames']
) {
  const { tags, runs, loadBranch, expanded, toggle } = tree;

  if (row.kind === 'branch') {
    const branch = row.tag === undefined ? tags[row.parent] : runs[row.parent];
    return (
      <Table.Row id={row.id}>
        <Table.Cell colSpan={6}>
          <div
            className={`flex items-center gap-3 py-1 ${row.tag === undefined ? 'pl-12' : 'pl-20'}`}
          >
            {!branch || branch.loading ? (
              <>
                <Spinner size="sm" />
                <span className="text-xs text-muted-foreground">
                  Loading {row.tag === undefined ? 'tags' : 'scans'}…
                </span>
              </>
            ) : branch.error ? (
              <>
                <span role="alert" className="text-xs text-destructive">
                  {branch.error}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => void loadBranch(row.image, row.tag, branch.requestedPage ?? 1)}
                >
                  Retry
                </Button>
              </>
            ) : branch.total === 0 ? (
              <span className="text-xs text-muted-foreground">
                No {row.tag === undefined ? 'tags' : 'scans'} available.
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => void loadBranch(row.image, row.tag, branch.page + 1)}
              >
                Load more {row.tag === undefined ? 'tags' : 'scans'} ({branch.data.length} of{' '}
                {branch.total})
              </Button>
            )}
          </div>
        </Table.Cell>
      </Table.Row>
    );
  }
  const image = row.kind === 'image' ? row.image : undefined;
  const tag = row.kind === 'tag' ? row.tag : undefined;
  const scan = row.kind === 'scan' ? row.scan : undefined;
  const name = image?.image_name ?? tag?.image_tag ?? `Run ${scan!.id.slice(0, 8)}`;
  const date = image?.latest_scan_at ?? tag?.latest_scan_at ?? scan!.created_at;
  const status = image?.health_status ?? tag?.latest_status ?? scan!.status;
  const isExpanded = expanded.has(row.id);
  const Icon = image ? Container : tag ? Tag : ScanLine;
  const queued = image && queuedImageNames?.has(image.image_name);
  return (
    <Table.Row id={row.id} className={image ? 'bg-muted/20' : ''} textValue={name}>
      <Table.Cell>
        <div
          className={`flex min-w-0 items-center gap-2 py-2 ${tag ? 'pl-6' : scan ? 'pl-14' : ''}`}
        >
          {scan ? null : (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${name}`}
              aria-expanded={isExpanded}
              onPress={() => toggle(image?.image_name ?? tag!.image_name, tag?.image_tag)}
            >
              {isExpanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </Button>
          )}
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
            <Icon className="size-3.5 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            {scan ? (
              <Link
                href={`/scans/details/${scan.id}`}
                className="block truncate text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {name}
              </Link>
            ) : (
              <Button
                variant="link"
                className="h-auto min-w-0 max-w-full justify-start truncate p-0 text-left font-mono text-sm font-medium"
                onPress={() => toggle(image?.image_name ?? tag!.image_name, tag?.image_tag)}
                aria-expanded={isExpanded}
                title={name}
              >
                {name}
              </Button>
            )}
            {queued ? (
              <Chip color="warning" size="sm" variant="soft">
                Deletion queued
              </Chip>
            ) : scan ? (
              <span className="text-xs text-muted-foreground">{scan.scan_provider}</span>
            ) : null}
          </div>
        </div>
      </Table.Cell>
      <Table.Cell>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            status={status}
            externalStatus={
              image?.health_external_status ?? tag?.latest_external_status ?? scan?.external_status
            }
          />
          <IntelligenceSummaryChip
            compact
            summary={
              image?.intelligence_summary ?? tag?.intelligence_summary ?? scan?.intelligence_summary
            }
          />
          {image?.health_policy_failed ||
          tag?.compliance_summary?.failed_policy_names?.length ||
          scan?.compliance_summary?.failed_policy_names?.length ? (
            <Chip color="danger" size="sm" variant="soft">
              Policy failed
            </Chip>
          ) : null}
        </div>
      </Table.Cell>
      <Table.Cell>
        <Findings
          critical={image?.health_critical_count ?? tag?.critical_count ?? scan!.critical_count}
          high={image?.health_high_count ?? tag?.high_count ?? scan!.high_count}
          medium={image?.health_medium_count ?? tag?.medium_count ?? scan!.medium_count}
          low={image?.health_low_count ?? tag?.low_count ?? scan!.low_count}
        />
      </Table.Cell>
      <Table.Cell>
        <span className="text-xs text-muted-foreground">
          {image
            ? `${image.tag_count} tags · ${image.scan_count} runs`
            : tag
              ? `${tag.scan_count} runs`
              : 'Scan run'}
        </span>
      </Table.Cell>
      <Table.Cell>
        <span className="whitespace-nowrap text-xs text-muted-foreground" title={fullDate(date)}>
          {timeAgo(date)}
        </span>
      </Table.Cell>
      <Table.Cell>
        {image ? (
          <RowActionsMenu
            label={`Actions for ${name}`}
            items={[
              {
                id: 'delete',
                label: queued ? 'Deletion queued' : 'Delete image group',
                icon: <Delete01Icon size={14} />,
                variant: 'danger',
                disabled: Boolean(queued),
                onAction: () => onDeleteImage(image),
              },
            ]}
          />
        ) : (
          <Link
            aria-label={`Open ${name}`}
            href={`/scans/details/${tag?.latest_scan_id ?? scan!.id}`}
            className="inline-flex rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-4" />
          </Link>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
