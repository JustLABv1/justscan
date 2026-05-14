'use client';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { getKBEntry, listKBEntries, VulnKBEntry } from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  Card,
  Label,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Switch,
  Table,
} from '@heroui/react';
import { InformationCircleIcon, Shield01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

const SEV_STYLE: Record<string, React.CSSProperties> = {
  CRITICAL: {
    color: '#f87171',
    background: 'rgba(239,68,68,0.10)',
    border: '1px solid rgba(239,68,68,0.22)',
  },
  HIGH: {
    color: '#fb923c',
    background: 'rgba(249,115,22,0.10)',
    border: '1px solid rgba(249,115,22,0.22)',
  },
  MEDIUM: {
    color: '#facc15',
    background: 'rgba(234,179,8,0.10)',
    border: '1px solid rgba(234,179,8,0.22)',
  },
  LOW: {
    color: '#60a5fa',
    background: 'rgba(59,130,246,0.10)',
    border: '1px solid rgba(59,130,246,0.22)',
  },
  UNKNOWN: {
    color: '#a1a1aa',
    background: 'rgba(161,161,170,0.08)',
    border: '1px solid rgba(161,161,170,0.18)',
  },
};

function SevBadge({ severity }: { severity: string }) {
  const s = SEV_STYLE[severity?.toUpperCase()] ?? SEV_STYLE.UNKNOWN;
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize" style={s}>
      {severity || 'Unknown'}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const color =
    score >= 9 ? '#f87171' : score >= 7 ? '#fb923c' : score >= 4 ? '#facc15' : '#60a5fa';
  return (
    <span className="font-mono text-sm font-semibold" style={{ color }}>
      {score ? score.toFixed(1) : '-'}
    </span>
  );
}

function DetailPanel({ entry, onClose }: { entry: VulnKBEntry; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl p-6 space-y-5"
        style={{
          background: 'var(--modal-bg)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold font-mono text-zinc-900 dark:text-white">
                {entry.vuln_id}
              </h2>
              <SevBadge severity={entry.severity} />
              <ScorePill score={entry.cvss_score} />
              {entry.exploit_available && (
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    color: '#f87171',
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid rgba(239,68,68,0.3)',
                  }}
                >
                  Exploit Available
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {entry.published_date
                ? `Published ${new Date(entry.published_date).toLocaleDateString()}`
                : 'Unknown publish date'}
              {entry.cvss_vector && <span className="ml-3 font-mono">{entry.cvss_vector}</span>}
            </p>
          </div>
          <button
            aria-label="Close vulnerability details"
            className="btn-icon-subtle shrink-0"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {entry.description && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Description
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {entry.description}
            </p>
          </div>
        )}

        {entry.references && entry.references.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              References
            </p>
            <ul className="space-y-1">
              {entry.references.map((r, i) => (
                <li key={i}>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-violet-500 dark:text-violet-400 hover:underline break-all"
                  >
                    {r.url}
                  </a>
                  {r.source && <span className="text-xs text-zinc-500 ml-2">({r.source})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
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

  async function handleRowClick(entry: VulnKBEntry) {
    try {
      const full = await getKBEntry(entry.vuln_id);
      setDetail(full);
    } catch {
      setDetail(entry);
    }
  }

  const activeFilters = [
    severity,
    minCvss !== '0' ? `CVSS ≥ ${minCvss}` : '',
    exploitOnly ? 'Exploit Only' : '',
    publishedRange ? PUBLISHED_OPTIONS.find((o) => o.id === publishedRange)?.label : '',
  ].filter(Boolean);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Vulnerability Knowledge Base"
        description="Enriched CVE data from NVD, GHSA, OSV, and other sources via Trivy."
      />

      <Card className="space-y-4">
        <div className="space-y-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            {/* Search */}
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {/* Severity Select */}
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

              {/* CVSS Select */}
              <Select
                value={minCvss}
                onChange={(value) => setMinCvss(String(value ?? '0'))}
                className="w-full sm:w-[180px]"
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

              {/* Published Range Select */}
              <Select
                value={publishedRange}
                onChange={(value) => setPublishedRange(String(value ?? ''))}
                className="w-full sm:w-[180px]"
                placeholder="Any Time"
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

              {/* Exploit Only Toggle */}
              <Switch
                isSelected={exploitOnly}
                onChange={setExploitOnly}
                className="h-[38px] flex items-center"
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label className="text-sm text-zinc-600 dark:text-zinc-300">Exploit Only</Label>
                </Switch.Content>
              </Switch>
            </div>
          </div>

          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFilters.map((f, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: 'rgba(124,58,237,0.12)',
                    color: '#a78bfa',
                    border: '1px solid rgba(167,139,250,0.25)',
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.18)',
              color: '#f87171',
            }}
          >
            {error}
          </div>
        )}

        <div className="overflow-hidden">
          <Table>
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
                        <div className="py-16 text-center">
                          <div className="flex justify-center">
                            <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                          </div>
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
                        onClick={() => handleRowClick(e)}
                      >
                        <Table.Cell>
                          <span className="font-mono text-xs text-violet-500 dark:text-violet-400">
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
                          <span className="line-clamp-2">{e.description || '-'}</span>
                        </Table.Cell>
                        <Table.Cell className="text-center">
                          {e.exploit_available ? (
                            <span
                              className="text-xs font-semibold px-2 py-0.5 rounded-full"
                              style={{
                                color: '#f87171',
                                background: 'rgba(239,68,68,0.12)',
                                border: '1px solid rgba(239,68,68,0.2)',
                              }}
                            >
                              Yes
                            </span>
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

      {detail && <DetailPanel entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
