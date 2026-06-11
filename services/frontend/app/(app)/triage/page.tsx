'use client';

import { StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { useWorkScope } from '@/hooks/use-work-scope';
import { getTriage, type TriageItem, type TriageItemKind, type TriagePriority } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  Alert,
  Button,
  Card,
  Chip,
  Label,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Spinner,
  Table,
} from '@heroui/react';
import {
  AlertCircleIcon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  FilterIcon,
  PackageIcon,
  Shield01Icon,
  ShieldKeyIcon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

type TriageQueueView =
  | 'all'
  | 'critical_now'
  | 'fixable_first'
  | 'policy_blocked'
  | 'watchlist_stale'
  | 'custom';
type ChipTone = 'danger' | 'warning' | 'accent' | 'default';

const KIND_LABELS: Record<TriageItemKind | 'all', string> = {
  all: 'All work',
  scan: 'Scan state',
  policy: 'Policy',
  fix: 'Fixes',
  watchlist: 'Watchlist',
};

const PRIORITY_LABELS: Record<TriagePriority | 'all', string> = {
  all: 'All priorities',
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
};

const PRIORITY_COLORS: Record<TriagePriority, 'danger' | 'warning' | 'accent'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'accent',
};

const SIGNAL_COLORS: Record<string, 'danger' | 'warning' | 'success' | 'accent' | 'default'> = {
  blocked: 'warning',
  'blocked by xray policy': 'warning',
  completed: 'success',
  failed: 'danger',
  'policy failed': 'danger',
  fixable: 'accent',
  'xray blocked': 'warning',
};

const TRIAGE_VIEW_OPTIONS: Array<{
  id: Exclude<TriageQueueView, 'custom'>;
  label: string;
  description: string;
  tone: ChipTone;
}> = [
  {
    id: 'all',
    label: 'All queue',
    description:
      'Everything currently visible across scans, policy work, fixes, and watchlist follow-up.',
    tone: 'default',
  },
  {
    id: 'critical_now',
    label: 'Critical now',
    description: 'Start with critical-priority work items and blocked scan outcomes.',
    tone: 'danger',
  },
  {
    id: 'fixable_first',
    label: 'Fixable first',
    description: 'Focus the queue on findings that already have a clear remediation path.',
    tone: 'accent',
  },
  {
    id: 'policy_blocked',
    label: 'Policy blocked',
    description:
      'Review policy failures, Xray blocks, and compliance work that is stopping delivery.',
    tone: 'warning',
  },
  {
    id: 'watchlist_stale',
    label: 'Watchlist stale',
    description: 'Surface stale coverage, missing baselines, and failed watchlist schedules.',
    tone: 'warning',
  },
];

const TRIAGE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return TRIAGE_DATE_FORMATTER.format(date);
}

function severityTotal(item: TriageItem) {
  return item.severity_counts.critical + item.severity_counts.high;
}

function itemTarget(item: TriageItem) {
  if (item.scan) return `${item.scan.image_name}:${item.scan.image_tag}`;
  if (item.watchlist_item)
    return `${item.watchlist_item.image_name}:${item.watchlist_item.image_tag}`;
  return 'JustScan item';
}

function signalColor(signal: string) {
  return SIGNAL_COLORS[signal.toLowerCase()] ?? 'default';
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number;
  detail: string;
  icon?: ReactNode;
  tone?: ChipTone;
}) {
  return (
    <StatCard
      label={label}
      value={value.toLocaleString()}
      hint={detail}
      icon={icon}
      tone={tone}
      variant="stacked"
      className="h-full border border-divider/70"
      hintClassName="text-[11px] leading-4 text-muted"
    />
  );
}

function buildPaginationModel(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  const normalized = Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const result: Array<number | 'ellipsis'> = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const page = normalized[index]!;
    const prev = normalized[index - 1];
    if (typeof prev === 'number' && page - prev > 1) {
      result.push('ellipsis');
    }
    result.push(page);
  }

  return result;
}

function parseTriageParamsFromUrl(search: string) {
  const normalizedSearch = search.startsWith('?') ? search : `?${search}`;
  const params = new URLSearchParams(normalizedSearch);
  const rawKind = params.get('kind');
  const rawPriority = params.get('priority');
  const rawQuery = params.get('q') ?? '';
  const rawPage = Number(params.get('page') ?? '1');

  const kind: TriageItemKind | 'all' =
    rawKind === 'scan' || rawKind === 'policy' || rawKind === 'fix' || rawKind === 'watchlist'
      ? rawKind
      : 'all';
  const priority: TriagePriority | 'all' =
    rawPriority === 'critical' || rawPriority === 'high' || rawPriority === 'medium'
      ? rawPriority
      : 'all';
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  return { kind, priority, query: rawQuery, page };
}

function deriveQueueView(
  kind: TriageItemKind | 'all',
  priority: TriagePriority | 'all'
): TriageQueueView {
  if (kind === 'all' && priority === 'all') return 'all';
  if (kind === 'all' && priority === 'critical') return 'critical_now';
  if (kind === 'fix' && priority === 'all') return 'fixable_first';
  if (kind === 'policy' && priority === 'all') return 'policy_blocked';
  if (kind === 'watchlist' && priority === 'all') return 'watchlist_stale';
  return 'custom';
}

function countForQueueView(
  view: Exclude<TriageQueueView, 'custom'>,
  summary: {
    total: number;
    critical: number;
    fixable: number;
    policy_failures: number;
    watchlist: number;
  }
) {
  switch (view) {
    case 'critical_now':
      return summary.critical;
    case 'fixable_first':
      return summary.fixable;
    case 'policy_blocked':
      return summary.policy_failures;
    case 'watchlist_stale':
      return summary.watchlist;
    default:
      return summary.total;
  }
}

function getEmptyStateCopy(queueView: TriageQueueView, hasQuery: boolean) {
  if (hasQuery) {
    return {
      title: 'No triage items match your search',
      description: 'Try a broader query or clear the search to return to the full queue.',
    };
  }

  switch (queueView) {
    case 'critical_now':
      return {
        title: 'No critical items are visible',
        description: 'This workspace currently has no critical-priority triage work in view.',
      };
    case 'fixable_first':
      return {
        title: 'No fixable findings are queued',
        description: 'There are no fix-focused triage items visible in this workspace right now.',
      };
    case 'policy_blocked':
      return {
        title: 'No policy blockers are queued',
        description:
          'No policy-failure or Xray-blocked work is currently visible in this workspace.',
      };
    case 'watchlist_stale':
      return {
        title: 'No watchlist follow-up is queued',
        description:
          'No stale, failed, or missing-baseline watchlist items are currently visible in this workspace.',
      };
    case 'custom':
      return {
        title: 'No triage items match these filters',
        description: 'Try widening the advanced filters or return to a saved queue view.',
      };
    default:
      return {
        title: 'Queue is clear',
        description:
          'No urgent scan, policy, fix, or watchlist work is currently visible in this workspace.',
      };
  }
}

export default function TriagePage() {
  const searchParams = useSearchParams();
  const initialParams = parseTriageParamsFromUrl(searchParams.toString());
  const initialQueueView = deriveQueueView(initialParams.kind, initialParams.priority);
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const [items, setItems] = useState<TriageItem[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    fixable: 0,
    policy_failures: 0,
    watchlist: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState(initialParams.query);
  const [kindFilter, setKindFilter] = useState<TriageItemKind | 'all'>(initialParams.kind);
  const [priorityFilter, setPriorityFilter] = useState<TriagePriority | 'all'>(
    initialParams.priority
  );
  const [page, setPage] = useState(initialParams.page);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const pageSize = 25;
  const [total, setTotal] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const load = useCallback(
    (manual = false) => {
      if (manual) {
        setManualRefreshing(true);
      }
      setLoading(true);
      setError('');
      void getTriage({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        kind: kindFilter,
        priority: priorityFilter,
        query: query.trim() || undefined,
      })
        .then((response) => {
          setItems(response.items ?? []);
          setSummary(response.summary);
          setTotal(response.pagination?.total ?? 0);
        })
        .catch((err: Error) => {
          setItems([]);
          setTotal(0);
          setError(err.message || 'Failed to load triage queue');
        })
        .finally(() => {
          setLoading(false);
          if (manual) {
            setManualRefreshing(false);
          }
        });
    },
    [
      kindFilter,
      page,
      pageSize,
      priorityFilter,
      query,
      setError,
      setItems,
      setLoading,
      setManualRefreshing,
      setSummary,
      setTotal,
    ]
  );

  useEffect(() => deferEffect(() => load(false)), [load, scopeKey]);

  const queueView = useMemo(
    () => deriveQueueView(kindFilter, priorityFilter),
    [kindFilter, priorityFilter]
  );
  const hasSearch = query.trim() !== '';
  const hasManualFilters = queueView === 'custom';
  const hasActiveFilters = hasSearch || kindFilter !== 'all' || priorityFilter !== 'all';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageItems = buildPaginationModel(page, totalPages);
  const emptyState = getEmptyStateCopy(queueView, hasSearch);

  const applySavedView = (view: Exclude<TriageQueueView, 'custom'>) => {
    setPage(1);
    switch (view) {
      case 'critical_now':
        setKindFilter('all');
        setPriorityFilter('critical');
        break;
      case 'fixable_first':
        setKindFilter('fix');
        setPriorityFilter('all');
        break;
      case 'policy_blocked':
        setKindFilter('policy');
        setPriorityFilter('all');
        break;
      case 'watchlist_stale':
        setKindFilter('watchlist');
        setPriorityFilter('all');
        break;
      default:
        setKindFilter('all');
        setPriorityFilter('all');
        break;
    }
  };

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Triage"
        description="Canonical operator queue for scan failures, policy blockers, fixable findings, and watchlist follow-up."
        actions={
          <Button onPress={() => load(true)} variant="secondary" isDisabled={manualRefreshing}>
            {manualRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          label="Open items"
          value={summary.total}
          detail="visible now"
          icon={<ShieldKeyIcon size={16} />}
        />
        <SummaryCard
          label="Critical now"
          value={summary.critical}
          detail="highest-priority items"
          tone="danger"
          icon={<AlertCircleIcon size={16} />}
        />
        <SummaryCard
          label="Fixable first"
          value={summary.fixable}
          detail="remediation available"
          tone="accent"
          icon={<CheckmarkCircle02Icon size={16} />}
        />
        <SummaryCard
          label="Policy blocked"
          value={summary.policy_failures}
          detail="policy or Xray blocked"
          tone="warning"
          icon={<Shield01Icon size={16} />}
        />
        <SummaryCard
          label="Watchlist attention"
          value={summary.watchlist}
          detail="stale or failed coverage"
          tone="warning"
          icon={<Clock01Icon size={16} />}
        />
      </div>

      {error ? (
        <Alert status="danger" className="bg-danger-soft">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Triage failed to load</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <Card className="overflow-hidden">
        <Card.Content className="gap-3 border-b border-divider py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <SearchField name="triage-search" variant="secondary" className="w-full xl:max-w-sm">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Search image, policy, status, signal..."
                  value={query}
                  onChange={(event) => {
                    setPage(1);
                    setQuery(event.target.value);
                  }}
                />
                {query ? (
                  <SearchField.ClearButton
                    onPress={() => {
                      setPage(1);
                      setQuery('');
                    }}
                  />
                ) : null}
              </SearchField.Group>
            </SearchField>

            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Button
                size="sm"
                variant={showAdvancedFilters ? 'primary' : 'secondary'}
                onPress={() => setShowAdvancedFilters((current) => !current)}
              >
                <FilterIcon size={14} />
                Advanced filters
              </Button>
              {hasActiveFilters ? (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() => {
                    setPage(1);
                    setQuery('');
                    setKindFilter('all');
                    setPriorityFilter('all');
                    setShowAdvancedFilters(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {TRIAGE_VIEW_OPTIONS.map((option) => {
              const active = queueView !== 'custom' && queueView === option.id;
              return (
                <Button
                  key={option.id}
                  size="sm"
                  variant={active ? 'secondary' : 'ghost'}
                  onPress={() => applySavedView(option.id)}
                >
                  {option.label}
                  <Chip size="sm" variant="soft" color={option.tone}>
                    {countForQueueView(option.id, summary)}
                  </Chip>
                </Button>
              );
            })}
          </div>

          {showAdvancedFilters ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-muted">Type</Label>
                <Select
                  value={kindFilter}
                  onChange={(value) => {
                    setPage(1);
                    setKindFilter(String(value) as TriageItemKind | 'all');
                  }}
                >
                  <Select.Trigger className="bg-surface-secondary">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {Object.entries(KIND_LABELS).map(([id, label]) => (
                        <ListBox.Item key={id} id={id}>
                          {label}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-muted">Priority</Label>
                <Select
                  value={priorityFilter}
                  onChange={(value) => {
                    setPage(1);
                    setPriorityFilter(String(value) as TriagePriority | 'all');
                  }}
                >
                  <Select.Trigger className="bg-surface-secondary">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {Object.entries(PRIORITY_LABELS).map(([id, label]) => (
                        <ListBox.Item key={id} id={id}>
                          {label}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </div>
          ) : null}

          {hasManualFilters ? (
            <p className="text-xs text-muted">Advanced filters are overriding the saved view.</p>
          ) : null}
        </Card.Content>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Triage queue" className="min-w-[980px]">
              <Table.Header>
                <Table.Column isRowHeader>Work item</Table.Column>
                <Table.Column>Priority</Table.Column>
                <Table.Column>Signals</Table.Column>
                <Table.Column>Risk</Table.Column>
                <Table.Column>Updated</Table.Column>
                <Table.Column className="text-right">Action</Table.Column>
              </Table.Header>
              <Table.Body
                items={loading ? [] : items}
                renderEmptyState={() =>
                  loading ? (
                    <div className="flex items-center justify-center gap-3 py-14 text-sm text-muted">
                      <Spinner size="sm" /> Loading triage queue&hellip;
                    </div>
                  ) : (
                    <div className="p-6">
                      <EmptyState
                        icon={<Shield01Icon size={28} />}
                        title={emptyState.title}
                        description={emptyState.description}
                      />
                    </div>
                  )
                }
              >
                {(item) => (
                  <Table.Row id={item.id}>
                    <Table.Cell>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          {item.kind === 'watchlist' ? (
                            <PackageIcon className="shrink-0 text-muted" size={16} />
                          ) : (
                            <ShieldKeyIcon className="shrink-0 text-muted" size={16} />
                          )}
                          <span className="font-medium text-foreground">{item.title}</span>
                          <Chip size="sm" variant="soft" color="default">
                            {KIND_LABELS[item.kind]}
                          </Chip>
                        </div>
                        <p
                          className="max-w-xl truncate text-xs text-muted"
                          title={itemTarget(item)}
                        >
                          {itemTarget(item)}
                        </p>
                        <p
                          className="max-w-xl truncate text-xs text-muted"
                          title={item.description}
                        >
                          {item.description}
                        </p>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft" color={PRIORITY_COLORS[item.priority]}>
                        {PRIORITY_LABELS[item.priority]}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex max-w-xs flex-wrap gap-1.5">
                        {item.scan ? (
                          <StatusBadge
                            status={item.scan.status}
                            externalStatus={item.scan.external_status}
                          />
                        ) : null}
                        {item.signals.slice(0, 3).map((signal) => (
                          <Chip key={signal} size="sm" variant="soft" color={signalColor(signal)}>
                            {signal}
                          </Chip>
                        ))}
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="space-y-1 text-xs text-muted">
                        <p>
                          C/H:{' '}
                          <span className="font-semibold text-foreground">
                            {severityTotal(item)}
                          </span>
                        </p>
                        {item.fix_count > 0 ? <p>{item.fix_count} fixable total</p> : null}
                        {item.policy_names?.length ? (
                          <p>{item.policy_names.length} failed policy</p>
                        ) : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-muted">
                      {formatDate(item.updated_at)}
                    </Table.Cell>
                    <Table.Cell className="text-right">
                      <Link href={item.href}>
                        <Button size="sm" variant="secondary">
                          {item.primary_action}
                          <ArrowRight01Icon size={14} />
                        </Button>
                      </Link>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer>
            <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
              <p className="text-xs text-muted">
                Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, total)} of {total.toLocaleString()} items
              </p>
              <Pagination size="sm" className="justify-self-center">
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={loading || page <= 1}
                      onPress={() => setPage((current) => Math.max(1, current - 1))}
                    >
                      <Pagination.PreviousIcon />
                    </Pagination.Previous>
                  </Pagination.Item>
                  {pageItems.map((item, index) =>
                    item === 'ellipsis' ? (
                      <Pagination.Item key={`triage-ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={`triage-page-${item}`}>
                        <Pagination.Link isActive={item === page} onPress={() => setPage(item)}>
                          {item}
                        </Pagination.Link>
                      </Pagination.Item>
                    )
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={loading || page >= totalPages}
                      onPress={() => setPage((current) => Math.min(totalPages, current + 1))}
                    >
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
              <div aria-hidden="true" />
            </div>
          </Table.Footer>
        </Table>
      </Card>
    </div>
  );
}
