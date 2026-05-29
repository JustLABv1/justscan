'use client';

import { StatusBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader } from '@/components/ui/page-header';
import { useWorkScope } from '@/hooks/use-work-scope';
import { getTriage, type TriageItem, type TriageItemKind, type TriagePriority } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { Button, Card, Chip, Label, ListBox, Pagination, SearchField, Select, Spinner, Table, Toolbar } from '@heroui/react';
import { ArrowRight01Icon, FilterIcon, PackageIcon, Shield01Icon, ShieldKeyIcon } from 'hugeicons-react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

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
  if (item.watchlist_item) return `${item.watchlist_item.image_name}:${item.watchlist_item.image_tag}`;
  return 'JustScan item';
}

function signalColor(signal: string) {
  return SIGNAL_COLORS[signal.toLowerCase()] ?? 'default';
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card className="h-auto min-h-0 p-0" variant="secondary">
      <Card.Content className="gap-1 px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
        <p className="text-2xl font-semibold tabular-nums" style={{ color: tone }}>
          {value.toLocaleString()}
        </p>
      </Card.Content>
    </Card>
  );
}

function buildPaginationModel(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
  const normalized = Array.from(pages).filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const result: Array<number | 'ellipsis'> = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const page = normalized[index]!;
    const prev = normalized[index - 1];
    if (typeof prev === 'number' && page-prev > 1) {
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

export default function TriagePage() {
  const searchParams = useSearchParams();
  const initialParams = parseTriageParamsFromUrl(searchParams.toString());
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
  const [priorityFilter, setPriorityFilter] = useState<TriagePriority | 'all'>(initialParams.priority);
  const [page, setPage] = useState(initialParams.page);
  const pageSize = 25;
  const [total, setTotal] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const load = useCallback((manual = false) => {
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
  }, [kindFilter, page, pageSize, priorityFilter, query]);

  useEffect(() => deferEffect(() => load(false)), [load, scopeKey]);

  const hasActiveFilters = query.trim() !== '' || kindFilter !== 'all' || priorityFilter !== 'all';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageItems = buildPaginationModel(page, totalPages);

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Triage"
        description="Prioritized security work across scans, policy failures, fixes, and watchlist coverage."
        actions={
          <Button onPress={() => load(true)} variant="secondary" isDisabled={manualRefreshing}>
            {manualRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <SummaryCard label="Open items" value={summary.total} />
        <SummaryCard label="Critical" value={summary.critical} tone="var(--color-danger)" />
        <SummaryCard label="High" value={summary.high} tone="var(--color-warning)" />
        <SummaryCard label="Medium" value={summary.medium} tone="var(--color-accent)" />
        <SummaryCard label="Fixable" value={summary.fixable} />
        <SummaryCard label="Watchlist" value={summary.watchlist} />
      </div>

      <Card className="p-4">
        <Toolbar aria-label="Triage filters" className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label className="text-sm font-medium text-muted">Search queue</Label>
            <SearchField name="triage-search" variant="secondary">
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
                {query ? <SearchField.ClearButton onPress={() => {
                  setPage(1);
                  setQuery('');
                }} /> : null}
              </SearchField.Group>
            </SearchField>
          </div>

          <div className="min-w-[180px] space-y-1.5">
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

          <div className="min-w-[180px] space-y-1.5">
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

          {hasActiveFilters ? (
            <Button
              className="lg:mb-0"
              variant="secondary"
              onPress={() => {
                setPage(1);
                setQuery('');
                setKindFilter('all');
                setPriorityFilter('all');
              }}
            >
              <FilterIcon size={14} />
              Clear filters
            </Button>
          ) : null}
        </Toolbar>
      </Card>

      {error ? <FormAlert description={error} title="Triage failed to load" /> : null}

      <Card className="overflow-hidden">
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
                        title={hasActiveFilters ? 'No triage items match your filters' : 'Queue is clear'}
                        description={
                          hasActiveFilters
                            ? 'Try widening the filters or searching for a different image, policy, or signal.'
                            : 'No urgent scan, policy, fix, or watchlist work is currently visible in this workspace.'
                        }
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
                        <p className="max-w-xl truncate text-xs text-muted" title={itemTarget(item)}>
                          {itemTarget(item)}
                        </p>
                        <p className="max-w-xl truncate text-xs text-muted" title={item.description}>
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
                          <StatusBadge status={item.scan.status} externalStatus={item.scan.external_status} />
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
                          C/H: <span className="font-semibold text-foreground">{severityTotal(item)}</span>
                        </p>
                        {item.fix_count > 0 ? <p>{item.fix_count} fixable total</p> : null}
                        {item.policy_names?.length ? <p>{item.policy_names.length} failed policy</p> : null}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-muted">{formatDate(item.updated_at)}</Table.Cell>
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
                Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total.toLocaleString()} items
              </p>
              <Pagination size="sm" className="justify-self-center">
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous isDisabled={loading || page <= 1} onPress={() => setPage((current) => Math.max(1, current - 1))}>
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
