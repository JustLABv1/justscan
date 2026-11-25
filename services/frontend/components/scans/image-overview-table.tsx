'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Container, Tag, ScanLine } from 'lucide-react';
import { IntelligenceSummaryChip } from '@/components/vulnerability-intelligence-status';
import { SeverityCounts, StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { Button, Chip, Spinner } from '@/components/ui';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  listScanArtifacts,
  listScans,
  type ArtifactSummary,
  type ImageOverview,
  type Scan,
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { labelFor, pluralize, SCAN_PROVIDER_LABELS, splitImageRef } from '@/lib/labels';
import { Delete01Icon, Shield01Icon } from 'hugeicons-react';

/** The list filters, applied to expanded tags and scans so they match their image row. */
export type ScanTreeFilters = {
  query?: string;
  status?: string;
  critical?: '' | 'yes' | 'no';
  policy?: '' | 'fail';
  intelligence?: 'changed' | 'confirmation_pending' | '';
  from?: string;
  to?: string;
};

type Props = {
  filters?: ScanTreeFilters;
  toolbar?: ReactNode;
  /** Bumps whenever the list is refreshed, so expanded branches reload with it. */
  revision?: number;
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

function useScanTreeData(images: ImageOverview[], revision: number, filters: ScanTreeFilters = {}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [tags, setTags] = useState<Record<string, Branch<ArtifactSummary>>>({});
  const [runs, setRuns] = useState<Record<string, Branch<Scan>>>({});

  // Read the latest filters inside async loads without re-creating loadBranch.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  async function loadBranch(image: string, tag?: string, page = 1, silent = false) {
    const f = filtersRef.current;
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
    if (!silent) {
      if (tag === undefined) setTags(pending);
      else setRuns(pending);
    }
    try {
      if (tag === undefined) {
        const result = await listScanArtifacts(
          page,
          LIMIT,
          f.query || undefined,
          f.status || undefined,
          f.critical,
          f.policy,
          image,
          f.from,
          f.to,
          f.intelligence || undefined
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
          f.status || undefined,
          true,
          undefined,
          undefined,
          f.from,
          f.to,
          tag,
          f.query || undefined,
          f.intelligence || undefined,
          f.critical,
          f.policy
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

  useEffect(() => {
    if (revision === 0) return;
    // Keep what is already expanded current as the list refreshes.
    for (const key of expanded) {
      const [image, tag] = JSON.parse(key) as [string, string | undefined];
      void loadBranch(image, tag, 1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // A changed filter must also refresh branches that are already open.
  const filtersKey = JSON.stringify(filters);
  const firstFiltersKey = useRef(filtersKey);
  useEffect(() => {
    if (firstFiltersKey.current === filtersKey) return;
    firstFiltersKey.current = filtersKey;
    for (const key of expanded) {
      const [image, tag] = JSON.parse(key) as [string, string | undefined];
      void loadBranch(image, tag, 1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);

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

/** Shared column template so image, tag and scan rows line up on wide screens. */
const ROW_GRID =
  'grid grid-cols-1 gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_13rem_13rem_7rem_2.5rem] lg:items-center lg:gap-4';

function ScanTreeTable({
  filters,
  toolbar,
  revision = 0,
  images,
  loading,
  hasActiveFilters,
  onDeleteImage,
  queuedImageNames,
}: Props) {
  const tree = useScanTreeData(images, revision, filters);
  const { expanded, setExpanded, rows } = tree;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-medium">Scanned images</h2>
          <p className="text-xs text-muted-foreground">
            Expand an image to browse its tags and scan history.
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
      <div
        aria-hidden
        className="hidden border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[minmax(0,1fr)_13rem_13rem_7rem_2.5rem] lg:gap-4"
      >
        <span>Image</span>
        <span>Status</span>
        <span>Findings</span>
        <span>Last scan</span>
        <span />
      </div>
      {loading ? (
        <ul className="divide-y divide-border" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="px-4 py-3">
              <div className="h-10 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      ) : images.length === 0 ? (
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
      ) : (
        <ul aria-label="Scanned images, tags and scan history" className="divide-y divide-border">
          {rows.map((row) => renderTreeRow(row, tree, onDeleteImage, queuedImageNames))}
        </ul>
      )}
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
    const noun = row.tag === undefined ? 'tags' : 'scans';
    return (
      <li
        key={row.id}
        className={`flex items-center gap-3 py-2 pr-4 ${row.tag === undefined ? 'pl-12' : 'pl-20'}`}
      >
        {!branch || branch.loading ? (
          <>
            <Spinner size="sm" />
            <span className="text-xs text-muted-foreground">Loading {noun}…</span>
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
            No {noun} match the current filters.
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => void loadBranch(row.image, row.tag, branch.page + 1)}
          >
            Show more {noun} ({branch.data.length} of {branch.total})
          </Button>
        )}
      </li>
    );
  }

  const image = row.kind === 'image' ? row.image : undefined;
  const tag = row.kind === 'tag' ? row.tag : undefined;
  const scan = row.kind === 'scan' ? row.scan : undefined;
  const imageParts = image ? splitImageRef(image.image_name) : undefined;
  const date = image?.latest_scan_at ?? tag?.latest_scan_at ?? scan!.created_at;
  const name = image ? imageParts!.name : tag ? tag.image_tag : `Scan ${timeAgo(scan!.created_at)}`;
  const fullName = image?.image_name ?? tag?.image_tag ?? fullDate(scan!.created_at);
  const status = image?.health_status ?? tag?.latest_status ?? scan!.status;
  const isExpanded = expanded.has(row.id);
  const Icon = image ? Container : tag ? Tag : ScanLine;
  const queued = image && queuedImageNames?.has(image.image_name);
  const needsAttention = Boolean(
    image && (image.health_policy_failed || image.health_critical_count > 0)
  );
  const subtitle = image
    ? [imageParts!.host, pluralize(image.tag_count, 'tag'), pluralize(image.scan_count, 'scan')]
        .filter(Boolean)
        .join(' · ')
    : tag
      ? pluralize(tag.scan_count, 'scan')
      : labelFor(SCAN_PROVIDER_LABELS, scan!.scan_provider);
  const indent = tag ? 'lg:pl-10 pl-8' : scan ? 'lg:pl-20 pl-14' : '';
  const findingsFailed = status === 'failed';

  return (
    <li
      key={row.id}
      className={`${ROW_GRID} ${image ? 'bg-muted/20' : ''} ${
        needsAttention ? 'shadow-[inset_3px_0_0_0_var(--destructive)]' : ''
      }`}
    >
      <div className={`flex min-w-0 items-center gap-2 ${indent}`}>
        {scan ? null : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${fullName}`}
            aria-expanded={isExpanded}
            onPress={() => toggle(image?.image_name ?? tag!.image_name, tag?.image_tag)}
          >
            {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        )}
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
          <Icon className="size-3.5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          {scan ? (
            <Link
              href={`/scans/details/${scan.id}`}
              className="block truncate text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              title={fullName}
            >
              {name}
            </Link>
          ) : (
            <button
              type="button"
              className="block max-w-full truncate text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => toggle(image?.image_name ?? tag!.image_name, tag?.image_tag)}
              aria-expanded={isExpanded}
              title={fullName}
            >
              {name}
            </button>
          )}
          {queued ? (
            <Chip color="warning" size="sm" variant="soft">
              Deletion queued
            </Chip>
          ) : (
            <span className="block truncate text-xs text-muted-foreground" title={subtitle}>
              {subtitle}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-9 lg:pl-0">
        {image && (image.active_tags ?? 0) > 0 ? (
          <Chip color="info" size="sm" variant="soft" className="gap-1.5 text-xs font-medium">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
            {image.active_tags} in progress
          </Chip>
        ) : null}
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
      <div className="pl-9 lg:pl-0">
        <SeverityCounts
          critical={image?.health_critical_count ?? tag?.critical_count ?? scan!.critical_count}
          high={image?.health_high_count ?? tag?.high_count ?? scan!.high_count}
          medium={image?.health_medium_count ?? tag?.medium_count ?? scan!.medium_count}
          low={image?.health_low_count ?? tag?.low_count ?? scan!.low_count}
          emptyLabel={findingsFailed ? 'No results' : 'No findings'}
        />
      </div>
      <span
        className="whitespace-nowrap pl-9 text-xs text-muted-foreground lg:pl-0"
        title={fullDate(date)}
      >
        {timeAgo(date)}
      </span>
      <div className="flex justify-end">
        {image ? (
          <RowActionsMenu
            label={`Actions for ${fullName}`}
            items={[
              {
                id: 'delete',
                label: queued ? 'Deletion queued' : 'Delete image and its scans',
                icon: <Delete01Icon size={14} />,
                variant: 'danger',
                disabled: Boolean(queued),
                onAction: () => onDeleteImage(image),
              },
            ]}
          />
        ) : (
          <Link
            aria-label={`Open ${fullName}`}
            href={`/scans/details/${tag?.latest_scan_id ?? scan!.id}`}
            className="inline-flex rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
    </li>
  );
}
