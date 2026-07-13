'use client';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { StatusAlert } from '@/components/ui/form-alert';
import {
  filterDisclosureBodyClassName,
  FilterDisclosureTrigger,
} from '@/components/ui/filter-toolbar';
import { PageHeader } from '@/components/ui/page-header';
import { getKBEntry, listKBEntries, VulnKBEntry } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  Button,
  Card,
  Chip,
  Disclosure,
  Drawer,
  Label,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Spinner,
  Switch,
  Table,
  useOverlayState,
} from '@heroui/react';
import { InformationCircleIcon, Shield01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const selectTriggerCls = heroSelectTriggerClassName;

function severityColor(severity: string): 'danger' | 'warning' | 'accent' | 'default' {
  switch (severity.toUpperCase()) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'accent';
    default:
      return 'default';
  }
}

function SevBadge({ severity }: { severity: string }) {
  return (
    <Chip color={severityColor(severity)} size="sm" variant="soft" className="capitalize">
      {severity || 'Unknown'}
    </Chip>
  );
}

function ScorePill({ score }: { score: number }) {
  return <span className="font-mono text-sm font-semibold">{score ? score.toFixed(1) : '-'}</span>;
}

function detailSummary(value?: string) {
  return (
    value
      ?.replace(/```[\s\S]*?```/g, 'Code example available in details.')
      .replace(/#{1,6}\s*/g, '')
      .replace(/[>*_`\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || '-'
  );
}

function DetailDrawer({
  entry,
  state,
}: {
  entry: VulnKBEntry;
  state: ReturnType<typeof useOverlayState>;
}) {
  return (
    <Drawer.Backdrop
      isDismissable
      isOpen={state.isOpen}
      onOpenChange={state.setOpen}
      variant="blur"
    >
      <Drawer.Content placement="right">
        <Drawer.Dialog className="flex h-full w-[min(100vw,42rem)] flex-col">
          <Drawer.Header>
            <div className="min-w-0 space-y-2">
              <Drawer.Heading className="font-mono text-lg">{entry.vuln_id}</Drawer.Heading>
              <div className="flex flex-wrap items-center gap-2">
                <SevBadge severity={entry.severity} />
                <ScorePill score={entry.cvss_score} />
                {entry.exploit_available ? (
                  <Chip color="danger" size="sm" variant="soft">
                    Exploit available
                  </Chip>
                ) : null}
              </div>
            </div>
            <Drawer.CloseTrigger />
          </Drawer.Header>
          <Drawer.Body className="space-y-6">
            <div className="text-sm text-muted">
              {entry.published_date
                ? `Published ${new Date(entry.published_date).toLocaleDateString()}`
                : 'Unknown publish date'}
              {entry.cvss_vector ? (
                <span className="ml-3 font-mono">{entry.cvss_vector}</span>
              ) : null}
            </div>
            {entry.description ? (
              <section>
                <h3 className="text-sm font-semibold">Description</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">
                  {entry.description}
                </p>
              </section>
            ) : null}
            {entry.references?.length ? (
              <section>
                <h3 className="text-sm font-semibold">References</h3>
                <ul className="mt-2 space-y-2">
                  {entry.references.map((reference) => (
                    <li key={`${reference.url}-${reference.source ?? ''}`} className="text-sm">
                      <a
                        href={reference.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-accent hover:underline"
                      >
                        {reference.url}
                      </a>
                      {reference.source ? (
                        <span className="ml-2 text-muted">({reference.source})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </Drawer.Body>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

const LIMIT = 10;

const CVSS_OPTIONS = [
  { id: '0', label: 'Any CVSS' },
  { id: '4', label: '≥ 4.0 (Medium+)' },
  { id: '7', label: '≥ 7.0 (High+)' },
  { id: '9', label: '≥ 9.0 (Critical)' },
];

const SEV_OPTIONS = [
  { id: '', label: 'All Severities' },
  { id: 'CRITICAL', label: 'Critical' },
  { id: 'HIGH', label: 'High' },
  { id: 'MEDIUM', label: 'Medium' },
  { id: 'LOW', label: 'Low' },
];

const PUBLISHED_OPTIONS = [
  { id: '', label: 'Any Time' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: '1y', label: 'Last year' },
];

function publishedAfterDate(value: string): string | undefined {
  if (!value) return undefined;
  const now = new Date();
  if (value === '30d') {
    now.setDate(now.getDate() - 30);
    return now.toISOString();
  }
  if (value === '90d') {
    now.setDate(now.getDate() - 90);
    return now.toISOString();
  }
  if (value === '1y') {
    now.setFullYear(now.getFullYear() - 1);
    return now.toISOString();
  }
  return undefined;
}

export default function VulnKBPage() {
  const [entries, setEntries] = useState<VulnKBEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [severity, setSeverity] = useState('');
  const [minCvss, setMinCvss] = useState('0');
  const [exploitOnly, setExploitOnly] = useState(false);
  const [publishedRange, setPublishedRange] = useState('');
  const [detail, setDetail] = useState<VulnKBEntry | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const detailDrawer = useOverlayState();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const paginationItems = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items: Array<number | 'ellipsis'> = [1];
    if (page > 3) items.push('ellipsis');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i += 1) items.push(i);
    if (page < totalPages - 2) items.push('ellipsis');
    items.push(totalPages);
    return items;
  }, [page, totalPages]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listKBEntries(
        query || undefined,
        severity || undefined,
        page,
        LIMIT,
        exploitOnly || undefined,
        Number(minCvss) || undefined,
        publishedAfterDate(publishedRange)
      );
      setEntries(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load KB');
    } finally {
      setLoading(false);
    }
  }, [query, severity, page, exploitOnly, minCvss, publishedRange]);

  useEffect(() => {
    return deferEffect(load);
  }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(queryInput);
      setPage(1);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queryInput]);

  useEffect(() => {
    return deferEffect(() => {
      setPage(1);
    });
  }, [severity, minCvss, exploitOnly, publishedRange]);

  function handleRowClick(entry: VulnKBEntry) {
    setDetail(entry);
    detailDrawer.open();
    void getKBEntry(entry.vuln_id)
      .then(setDetail)
      .catch(() => {});
  }

  const activeFilters = [
    severity,
    minCvss !== '0' ? `CVSS ≥ ${minCvss}` : '',
    exploitOnly ? 'Exploit Only' : '',
    publishedRange ? PUBLISHED_OPTIONS.find((o) => o.id === publishedRange)?.label : '',
  ].filter(Boolean);
  const clearFilters = () => {
    setSeverity('');
    setMinCvss('0');
    setExploitOnly(false);
    setPublishedRange('');
    setPage(1);
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Vulnerability Knowledge Base"
        description="Enriched CVE data from NVD, GHSA, OSV, and other sources via Trivy."
      />

      <Card className="space-y-4">
        <Disclosure isExpanded={showFilters} onExpandedChange={setShowFilters} className="contents">
          <div className="space-y-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <SearchField name="cve-search" variant="secondary" className="w-full xl:max-w-md">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="CVE ID or description..."
                    value={queryInput}
                    onChange={(event) => setQueryInput(event.target.value)}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={severity}
                  onChange={(value) => setSeverity(String(value ?? ''))}
                  className="w-full sm:w-[180px]"
                  placeholder="All Severities"
                  variant="secondary"
                >
                  <Select.Trigger className={selectTriggerCls}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {SEV_OPTIONS.map((o) => (
                        <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
                          {o.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <FilterDisclosureTrigger activeCount={activeFilters.length} />
                {activeFilters.length > 0 ? (
                  <Button variant="tertiary" onPress={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </div>

            <Disclosure.Content>
              <Disclosure.Body className={`${filterDisclosureBodyClassName} md:grid-cols-3`}>
                <Select
                  value={minCvss}
                  onChange={(value) => setMinCvss(String(value ?? '0'))}
                  placeholder="Any CVSS"
                  variant="secondary"
                >
                  <Select.Trigger className={selectTriggerCls}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {CVSS_OPTIONS.map((o) => (
                        <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
                          {o.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select
                  value={publishedRange}
                  onChange={(value) => setPublishedRange(String(value ?? ''))}
                  placeholder="Any time"
                  variant="secondary"
                >
                  <Select.Trigger className={selectTriggerCls}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {PUBLISHED_OPTIONS.map((o) => (
                        <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
                          {o.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Switch isSelected={exploitOnly} onChange={setExploitOnly}>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>Exploit available only</Switch.Content>
                </Switch>
              </Disclosure.Body>
            </Disclosure.Content>

            {activeFilters.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {activeFilters.map((f) => (
                  <Chip key={f} color="accent" size="sm" variant="soft">
                    {f}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </Disclosure>

        {error ? (
          <StatusAlert
            status="danger"
            title="Vulnerability knowledge base failed to load"
            description={error}
          />
        ) : null}

        <div className="overflow-hidden">
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Vulnerability KB entries" className="min-w-[860px]">
                <Table.Header>
                  <Table.Column isRowHeader>CVE ID</Table.Column>
                  <Table.Column>Severity</Table.Column>
                  <Table.Column className="text-right">CVSS</Table.Column>
                  <Table.Column>Published</Table.Column>
                  <Table.Column>Description</Table.Column>
                  <Table.Column className="text-center">Exploit</Table.Column>
                </Table.Header>
                <Table.Body>
                  {loading ? (
                    <Table.Row key="loading" id="loading">
                      <Table.Cell colSpan={6}>
                        <div className="flex justify-center py-16">
                          <Spinner color="accent" size="sm" />
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ) : entries.length === 0 ? (
                    <Table.Row key="empty" id="empty">
                      <Table.Cell colSpan={6}>
                        <div className="py-16 text-center">
                          <div className="flex flex-col items-center gap-3">
                            <Shield01Icon size={32} className="text-zinc-400 dark:text-zinc-600" />
                            <p className="text-sm text-zinc-500">No KB entries found.</p>
                            <p className="text-xs text-zinc-400">
                              Try adjusting your filters or the KB is populated when vulnerabilities
                              are found in scans.
                            </p>
                          </div>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    entries.map((e) => (
                      <Table.Row
                        key={e.vuln_id}
                        id={e.vuln_id}
                        className="cursor-pointer hover:bg-[var(--row-hover)]"
                        onAction={() => handleRowClick(e)}
                      >
                        <Table.Cell>
                          <span className="font-mono text-xs text-accent dark:text-accent">
                            {e.vuln_id}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <SevBadge severity={e.severity} />
                        </Table.Cell>
                        <Table.Cell className="text-right">
                          <ScorePill score={e.cvss_score} />
                        </Table.Cell>
                        <Table.Cell className="text-xs text-zinc-500">
                          {e.published_date ? new Date(e.published_date).toLocaleDateString() : '-'}
                        </Table.Cell>
                        <Table.Cell className="text-xs text-zinc-600 dark:text-zinc-400 max-w-xs">
                          <span className="line-clamp-2">{detailSummary(e.description)}</span>
                        </Table.Cell>
                        <Table.Cell className="text-center">
                          {e.exploit_available ? (
                            <Chip color="danger" size="sm" variant="soft">
                              Yes
                            </Chip>
                          ) : (
                            <span className="text-xs text-zinc-400">-</span>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ))
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
            {totalPages > 1 ? (
              <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 gap-3">
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  Showing {total === 0 ? 0 : (page - 1) * LIMIT + 1}-{Math.min(page * LIMIT, total)}{' '}
                  of {total.toLocaleString()}
                </span>
                <Pagination size="sm" className="justify-self-center">
                  <Pagination.Content>
                    <Pagination.Item>
                      <Pagination.Previous
                        isDisabled={page === 1}
                        onPress={() => setPage((previous) => Math.max(1, previous - 1))}
                      >
                        <Pagination.PreviousIcon />
                        <span>Previous</span>
                      </Pagination.Previous>
                    </Pagination.Item>
                    {paginationItems.map((item, index) =>
                      item === 'ellipsis' ? (
                        <Pagination.Item key={`vulnkb-ellipsis-${index}`}>
                          <Pagination.Ellipsis />
                        </Pagination.Item>
                      ) : (
                        <Pagination.Item key={`vulnkb-page-${item}`}>
                          <Pagination.Link isActive={item === page} onPress={() => setPage(item)}>
                            {item}
                          </Pagination.Link>
                        </Pagination.Item>
                      )
                    )}
                    <Pagination.Item>
                      <Pagination.Next
                        isDisabled={page === totalPages}
                        onPress={() => setPage((previous) => Math.min(totalPages, previous + 1))}
                      >
                        <span>Next</span>
                        <Pagination.NextIcon />
                      </Pagination.Next>
                    </Pagination.Item>
                  </Pagination.Content>
                </Pagination>
                <div />
              </Table.Footer>
            ) : null}
          </Table>
        </div>
      </Card>

      <p className="text-xs text-zinc-400 flex items-center gap-1.5">
        <InformationCircleIcon size={13} />
        The KB is populated automatically from scan data - sources include NVD, GHSA, OSV, Red Hat,
        Debian, and more.
      </p>

      {detail ? <DetailDrawer entry={detail} state={detailDrawer} /> : null}
    </div>
  );
}
