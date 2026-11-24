'use client';

import {
  AdminDateRangeField,
  dateRangeToIso,
  type AdminDateRange,
} from '@/components/admin/admin-filters';
import { TelemetryRetentionPanel } from '@/components/admin/telemetry-retention-panel';
import { FilterDisclosureTrigger } from '@/components/ui/filter-toolbar';
import { StatusAlert } from '@/components/ui/form-alert';
import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import { StatusTag, type StatusDotTone } from '@/components/ui/status-dot';
import {
  adminListGlobalRegistries,
  getAPIUsageStats,
  getXRayUsageStats,
  listAdminScans,
  listAPIRequestLogs,
  listXRayRequestLogs,
} from '@/lib/api/admin';
import { getScan } from '@/lib/api/scans';
import type {
  APIRequestLog,
  APIRequestLogFilters,
  APIUsageStats,
  AdminXRayRequestLog,
  XRayRequestLogFilters,
  XRayUsageStats,
} from '@/lib/api/types/admin';
import type { RegistryWithHealth } from '@/lib/api/types/registries';
import { deferEffect } from '@/lib/defer-effect';
import { displayUser, summarizeError } from '@/lib/labels';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  DescriptionList,
  Disclosure,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  SearchableSelect,
  Select,
  Table,
  TablePager,
  Tabs,
  TextField,
  useOverlayState,
} from '@/components/ui';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 25;

type Section = 'api' | 'xray';

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: string[]) {
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function statusTone(statusCode: number): StatusDotTone {
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode >= 400 && statusCode < 500) return 'warning';
  if (statusCode >= 500 || statusCode <= 0) return 'danger';
  return 'neutral';
}

function statusText(statusCode: number) {
  return statusCode <= 0 ? 'No response' : String(statusCode);
}

function errorRate(errors: number, total: number) {
  return total > 0 ? `${((errors / total) * 100).toFixed(1)}%` : '0%';
}

function UsageStrip({
  stats,
  noun,
}: {
  stats: APIUsageStats | XRayUsageStats | null;
  noun: string;
}) {
  if (!stats) return null;
  return (
    <StatStrip className="lg:grid-cols-4">
      <StatStripItem label={noun} value={stats.total_requests.toLocaleString()} />
      <StatStripItem
        label="Error rate"
        value={errorRate(stats.error_requests, stats.total_requests)}
        hint={`${stats.error_requests.toLocaleString()} failed`}
        tone={stats.error_requests > 0 ? 'warning' : undefined}
      />
      <StatStripItem label="Average time" value={`${stats.avg_duration_ms.toFixed(0)} ms`} />
      <StatStripItem
        label="Slowest 5%"
        value={`${stats.p95_duration_ms.toFixed(0)} ms`}
        hint="95th percentile"
      />
    </StatStrip>
  );
}

function StatusSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select
      aria-label="Response status"
      value={value || '__all__'}
      onChange={(next) => onChange(next === '__all__' ? '' : String(next))}
      variant="secondary"
      className="w-full md:w-40"
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          <ListBox.Item id="__all__">All statuses</ListBox.Item>
          <ListBox.Item id="2xx">Successful (2xx)</ListBox.Item>
          <ListBox.Item id="4xx">Client errors (4xx)</ListBox.Item>
          <ListBox.Item id="5xx">Server errors (5xx)</ListBox.Item>
          <ListBox.Item id="error">Any error</ListBox.Item>
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

/* -------------------------------------------------------------------------- */
/* API requests                                                               */
/* -------------------------------------------------------------------------- */

function ApiLogs() {
  const [logs, setLogs] = useState<APIRequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<APIUsageStats | null>(null);
  const [filters, setFilters] = useState({ method: '', path: '', user: '', status: '' });
  const [dateRange, setDateRange] = useState<AdminDateRange>(null);

  const range = useMemo(() => dateRangeToIso(dateRange), [dateRange]);
  const requestFilters: APIRequestLogFilters = useMemo(
    () => ({
      method: filters.method || undefined,
      path: filters.path || undefined,
      user: filters.user || undefined,
      status: filters.status || undefined,
      ...range,
    }),
    [filters, range]
  );

  function updateFilter(patch: Partial<typeof filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listAPIRequestLogs(page, PAGE_SIZE, requestFilters);
      setLogs(result.data ?? []);
      setTotal(result.total ?? 0);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load API logs');
    } finally {
      setLoading(false);
    }
  }, [page, requestFilters]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await getAPIUsageStats(range.from, range.to));
    } catch {
      setStats(null);
    }
  }, [range]);

  useEffect(() => deferEffect(load), [load]);
  useEffect(() => deferEffect(loadStats), [loadStats]);

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const rows: APIRequestLog[] = [];
      let exportPage = 1;
      let exportTotal = 0;
      do {
        const result = await listAPIRequestLogs(exportPage, 500, requestFilters);
        rows.push(...(result.data ?? []));
        exportTotal = result.total ?? 0;
        exportPage += 1;
      } while (rows.length < exportTotal);

      downloadCsv(`justscan-api-logs-${new Date().toISOString().slice(0, 19)}.csv`, [
        ['created_at', 'method', 'path', 'status_code', 'duration_ms', 'username', 'email'].join(
          ','
        ),
        ...rows.map((entry) =>
          [
            escapeCsv(entry.created_at),
            escapeCsv(entry.method),
            escapeCsv(entry.path),
            entry.status_code,
            entry.duration_ms,
            escapeCsv(entry.username ?? ''),
            escapeCsv(entry.email ?? ''),
          ].join(',')
        ),
      ]);
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const moreCount = [filters.user, dateRange].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <UsageStrip stats={stats} noun="Requests" />

      <Card className="gap-0 overflow-hidden py-0">
        <Disclosure className="border-b border-border p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchField
              aria-label="Filter by path"
              name="insights-api-path"
              variant="secondary"
              className="min-w-0 flex-1"
              value={filters.path}
              onChange={(value) => updateFilter({ path: value })}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Filter by path, e.g. /api/v1/scans" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <StatusSelect value={filters.status} onChange={(status) => updateFilter({ status })} />
            <Select
              aria-label="Request method"
              value={filters.method || '__all__'}
              onChange={(value) =>
                updateFilter({ method: value === '__all__' ? '' : String(value) })
              }
              variant="secondary"
              className="w-full md:w-36"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">All methods</ListBox.Item>
                  <ListBox.Item id="GET">GET</ListBox.Item>
                  <ListBox.Item id="POST">POST</ListBox.Item>
                  <ListBox.Item id="PUT">PUT</ListBox.Item>
                  <ListBox.Item id="PATCH">PATCH</ListBox.Item>
                  <ListBox.Item id="DELETE">DELETE</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <FilterDisclosureTrigger activeCount={moreCount} />
            <Button
              variant="secondary"
              onPress={handleExport}
              isDisabled={exporting || total === 0}
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          </div>
          <Disclosure.Content>
            <Disclosure.Body className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-3">
              <TextField value={filters.user} onChange={(user) => updateFilter({ user })}>
                <Label className="mb-1.5 text-xs font-medium text-muted-foreground">User</Label>
                <Input variant="secondary" placeholder="Username or email" />
              </TextField>
              <AdminDateRangeField
                value={dateRange}
                onChange={(value) => {
                  setDateRange(value);
                  setPage(1);
                }}
              />
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>

        {error ? (
          <StatusAlert
            className="m-4"
            status="danger"
            title="API logs failed to load"
            description={error}
          />
        ) : null}

        <Table variant="secondary">
          <Table.ScrollContainer className="rounded-none border-0">
            <Table.Content aria-label="API request logs" aria-busy={loading}>
              <Table.Header>
                <Table.Column isRowHeader className="px-4">
                  Request
                </Table.Column>
                <Table.Column className="hidden md:table-cell">User</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column className="hidden sm:table-cell">Time taken</Table.Column>
                <Table.Column className="px-4 text-right">When</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {loading ? 'Loading API logs...' : 'No API requests match your filters.'}
                  </div>
                )}
              >
                {logs.map((log) => (
                  <Table.Row key={log.id} id={log.id}>
                    <Table.Cell className="max-w-0 px-4 sm:w-1/2">
                      <span
                        className="block truncate font-mono text-xs"
                        title={`${log.method} ${log.path}`}
                      >
                        <span className="font-medium text-foreground">{log.method}</span>{' '}
                        <span className="text-muted-foreground">{log.path}</span>
                      </span>
                    </Table.Cell>
                    <Table.Cell className="hidden max-w-48 md:table-cell">
                      <span
                        className="block truncate text-muted-foreground"
                        title={log.email || undefined}
                      >
                        {displayUser(log, log.user_id ? 'Unknown user' : 'Public visitor')}
                      </span>
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap">
                      <StatusTag tone={statusTone(log.status_code)}>
                        {statusText(log.status_code)}
                      </StatusTag>
                    </Table.Cell>
                    <Table.Cell className="hidden whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                      {log.duration_ms.toLocaleString()} ms
                    </Table.Cell>
                    <Table.Cell className="whitespace-nowrap px-4 text-right text-muted-foreground">
                      <span title={fullDate(log.created_at)}>{timeAgo(log.created_at)}</span>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
        <TablePager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          noun="requests"
        />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Xray calls                                                                 */
/* -------------------------------------------------------------------------- */

type ScanRef = { label: string; title: string };

function XrayLogs() {
  const [logs, setLogs] = useState<AdminXRayRequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<XRayUsageStats | null>(null);
  const [filters, setFilters] = useState({
    scan_id: '',
    registry_id: '',
    endpoint: '',
    status: '',
  });
  const [dateRange, setDateRange] = useState<AdminDateRange>(null);
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [scanRefs, setScanRefs] = useState<Record<string, ScanRef>>({});
  const [selectedLog, setSelectedLog] = useState<AdminXRayRequestLog | null>(null);
  const detailModal = useOverlayState();

  const range = useMemo(() => dateRangeToIso(dateRange), [dateRange]);
  const requestFilters: XRayRequestLogFilters = useMemo(
    () => ({
      scan_id: filters.scan_id || undefined,
      registry_id: filters.registry_id || undefined,
      endpoint: filters.endpoint || undefined,
      status: filters.status || undefined,
      ...range,
    }),
    [filters, range]
  );

  function updateFilter(patch: Partial<typeof filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listXRayRequestLogs(page, PAGE_SIZE, requestFilters);
      setLogs(result.data ?? []);
      setTotal(result.total ?? 0);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Xray logs');
    } finally {
      setLoading(false);
    }
  }, [page, requestFilters]);

  const loadStats = useCallback(async () => {
    try {
      setStats(await getXRayUsageStats(range.from, range.to));
    } catch {
      setStats(null);
    }
  }, [range]);

  // Registry and recent-scan names for the filters and for readable scan links.
  const loadLookups = useCallback(async () => {
    const [registryResult, scanResult] = await Promise.allSettled([
      adminListGlobalRegistries(),
      listAdminScans(1, 100),
    ]);
    if (registryResult.status === 'fulfilled') setRegistries(registryResult.value.data);
    if (scanResult.status === 'fulfilled') {
      const refs: Record<string, ScanRef> = {};
      for (const scan of scanResult.value.data ?? []) {
        const label = `${scan.image_name}:${scan.image_tag}`;
        refs[scan.id] = { label, title: `${label} · ${fullDate(scan.created_at)}` };
      }
      setScanRefs((current) => ({ ...refs, ...current }));
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);
  useEffect(() => deferEffect(loadStats), [loadStats]);
  useEffect(() => deferEffect(loadLookups), [loadLookups]);

  // Resolve scans on this page that are not among the recent ones.
  useEffect(() => {
    const missing = Array.from(
      new Set(logs.map((log) => log.scan_id).filter((id): id is string => Boolean(id)))
    ).filter((id) => !scanRefs[id]);
    if (missing.length === 0) return undefined;
    let cancelled = false;
    void Promise.allSettled(missing.map((id) => getScan(id))).then((results) => {
      if (cancelled) return;
      const refs: Record<string, ScanRef> = {};
      results.forEach((result, index) => {
        const id = missing[index];
        if (result.status === 'fulfilled') {
          const label = `${result.value.image_name}:${result.value.image_tag}`;
          refs[id] = { label, title: label };
        } else {
          refs[id] = { label: 'Unavailable scan', title: 'Scan details could not be loaded' };
        }
      });
      setScanRefs((current) => ({ ...current, ...refs }));
    });
    return () => {
      cancelled = true;
    };
  }, [logs, scanRefs]);

  const registryNames = useMemo(
    () => Object.fromEntries(registries.map((registry) => [registry.id, registry.name])),
    [registries]
  );
  const scanItems = useMemo(
    () =>
      Object.entries(scanRefs)
        .filter(([, ref]) => ref.label !== 'Unavailable scan')
        .map(([value, ref]) => ({ value, label: ref.label, description: ref.title })),
    [scanRefs]
  );

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const rows: AdminXRayRequestLog[] = [];
      let exportPage = 1;
      let exportTotal = 0;
      do {
        const result = await listXRayRequestLogs(exportPage, 500, requestFilters);
        rows.push(...(result.data ?? []));
        exportTotal = result.total ?? 0;
        exportPage += 1;
      } while (rows.length < exportTotal);

      downloadCsv(`justscan-xray-logs-${new Date().toISOString().slice(0, 19)}.csv`, [
        [
          'created_at',
          'scan_id',
          'registry_id',
          'method',
          'endpoint',
          'status_code',
          'duration_ms',
          'error',
        ].join(','),
        ...rows.map((entry) =>
          [
            escapeCsv(entry.created_at),
            escapeCsv(entry.scan_id ?? ''),
            escapeCsv(entry.registry_id ?? ''),
            escapeCsv(entry.method),
            escapeCsv(entry.endpoint),
            entry.status_code,
            entry.duration_ms,
            escapeCsv(entry.error ?? ''),
          ].join(',')
        ),
      ]);
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  function openDetails(log: AdminXRayRequestLog) {
    setSelectedLog(log);
    detailModal.open();
  }

  const moreCount = [filters.scan_id, dateRange].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <UsageStrip stats={stats} noun="Calls" />

      <Card className="gap-0 overflow-hidden py-0">
        <Disclosure className="border-b border-border p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchField
              aria-label="Filter by endpoint"
              name="insights-xray-endpoint"
              variant="secondary"
              className="min-w-0 flex-1"
              value={filters.endpoint}
              onChange={(value) => updateFilter({ endpoint: value })}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Filter by endpoint..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <StatusSelect value={filters.status} onChange={(status) => updateFilter({ status })} />
            <Select
              aria-label="Registry"
              value={filters.registry_id || '__all__'}
              onChange={(value) =>
                updateFilter({ registry_id: value === '__all__' ? '' : String(value) })
              }
              variant="secondary"
              className="w-full md:w-48"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">All registries</ListBox.Item>
                  {registries.map((registry) => (
                    <ListBox.Item key={registry.id} id={registry.id}>
                      {registry.name}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <FilterDisclosureTrigger activeCount={moreCount} />
            <Button
              variant="secondary"
              onPress={handleExport}
              isDisabled={exporting || total === 0}
            >
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          </div>
          <Disclosure.Content>
            <Disclosure.Body className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Scan</span>
                <SearchableSelect
                  aria-label="Scan"
                  items={scanItems}
                  value={filters.scan_id || null}
                  onValueChange={(value) => updateFilter({ scan_id: value ?? '' })}
                  placeholder="Search by image..."
                  emptyText="No recent scans match"
                  clearable
                />
              </div>
              <AdminDateRangeField
                value={dateRange}
                onChange={(value) => {
                  setDateRange(value);
                  setPage(1);
                }}
              />
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>

        {error ? (
          <StatusAlert
            className="m-4"
            status="danger"
            title="Xray logs failed to load"
            description={error}
          />
        ) : null}

        <Table variant="secondary">
          <Table.ScrollContainer className="rounded-none border-0">
            <Table.Content aria-label="Xray request logs" aria-busy={loading}>
              <Table.Header>
                <Table.Column isRowHeader className="px-4">
                  Request
                </Table.Column>
                <Table.Column className="hidden md:table-cell">Scan</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column className="hidden sm:table-cell">Time taken</Table.Column>
                <Table.Column className="text-right">When</Table.Column>
                <Table.Column className="px-4">
                  <span className="sr-only">Details</span>
                </Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {loading ? 'Loading Xray logs...' : 'No Xray calls match your filters.'}
                  </div>
                )}
              >
                {logs.map((log) => {
                  const scanRef = log.scan_id ? scanRefs[log.scan_id] : undefined;
                  return (
                    <Table.Row key={log.id} id={log.id}>
                      <Table.Cell className="max-w-0 px-4 sm:w-[40%]">
                        <span
                          className="block truncate font-mono text-xs"
                          title={`${log.method} ${log.endpoint}`}
                        >
                          <span className="font-medium text-foreground">{log.method}</span>{' '}
                          <span className="text-muted-foreground">{log.endpoint}</span>
                        </span>
                        {log.error ? (
                          <span
                            className="mt-0.5 block truncate text-xs text-destructive"
                            title={summarizeError(log.error, 400)}
                          >
                            {summarizeError(log.error)}
                          </span>
                        ) : null}
                      </Table.Cell>
                      <Table.Cell className="hidden max-w-48 md:table-cell">
                        {log.scan_id ? (
                          <Link
                            href={`/scans/details/${log.scan_id}`}
                            className="block truncate text-primary hover:underline"
                            title={scanRef?.title}
                          >
                            {scanRef?.label ?? 'Open scan'}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap">
                        <StatusTag tone={statusTone(log.status_code)}>
                          {statusText(log.status_code)}
                        </StatusTag>
                      </Table.Cell>
                      <Table.Cell className="hidden whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
                        {log.duration_ms.toLocaleString()} ms
                      </Table.Cell>
                      <Table.Cell className="whitespace-nowrap text-right text-muted-foreground">
                        <span title={fullDate(log.created_at)}>{timeAgo(log.created_at)}</span>
                      </Table.Cell>
                      <Table.Cell className="px-4 text-right">
                        <Button size="sm" variant="ghost" onPress={() => openDetails(log)}>
                          Details
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
        <TablePager
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          noun="calls"
        />
      </Card>

      <Modal state={detailModal}>
        <Modal.Backdrop>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Xray call</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="space-y-4">
                {selectedLog ? (
                  <>
                    <DescriptionList
                      items={[
                        {
                          label: 'Request',
                          value: `${selectedLog.method} ${selectedLog.endpoint}`,
                          mono: true,
                          wide: true,
                        },
                        { label: 'Status', value: statusText(selectedLog.status_code) },
                        {
                          label: 'Time taken',
                          value: `${selectedLog.duration_ms.toLocaleString()} ms`,
                        },
                        { label: 'When', value: fullDate(selectedLog.created_at) },
                        {
                          label: 'Registry',
                          value: selectedLog.registry_id
                            ? (registryNames[selectedLog.registry_id] ?? 'Workspace registry')
                            : 'None',
                        },
                        {
                          label: 'Scan',
                          value: selectedLog.scan_id ? (
                            <Link
                              href={`/scans/details/${selectedLog.scan_id}`}
                              className="text-primary hover:underline"
                            >
                              {scanRefs[selectedLog.scan_id]?.label ?? 'Open scan'}
                            </Link>
                          ) : (
                            'None'
                          ),
                          hidden: !selectedLog.scan_id,
                        },
                      ]}
                    />
                    {selectedLog.error ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Error</p>
                        <pre className="max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {selectedLog.error}
                        </pre>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

export function InsightsTab() {
  const [section, setSection] = useState<Section>('api');

  return (
    <div className="space-y-4">
      <Tabs selectedKey={section} onSelectionChange={(key) => setSection(String(key) as Section)}>
        <Tabs.List aria-label="Request logs">
          <Tabs.Tab id="api">API requests</Tabs.Tab>
          <Tabs.Tab id="xray">Xray calls</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="api" className="hidden">
          <span className="sr-only">API requests</span>
        </Tabs.Panel>
        <Tabs.Panel id="xray" className="hidden">
          <span className="sr-only">Xray calls</span>
        </Tabs.Panel>
      </Tabs>

      {/* Both logs stay mounted so filters and pages survive switching tabs. */}
      <div hidden={section !== 'api'}>
        <ApiLogs />
      </div>
      <div hidden={section !== 'xray'}>
        <XrayLogs />
      </div>

      <TelemetryRetentionPanel />
    </div>
  );
}
