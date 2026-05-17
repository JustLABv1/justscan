'use client';

import {
  getAPIUsageStats,
  getXRayUsageStats,
  listAPIRequestLogs,
  listXRayRequestLogs,
} from '@/lib/api/admin';
import type {
  APIRequestLog,
  APIRequestLogFilters,
  APIUsageStats,
  AdminXRayRequestLog,
  XRayRequestLogFilters,
  XRayUsageStats,
} from '@/lib/api/types/admin';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  Input,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Table,
} from '@heroui/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SegmentedControl } from '../ui/segmented-control';

const PAGE_SIZE = 25;

function toIsoOrUndefined(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function statusColor(statusCode: number): 'success' | 'warning' | 'danger' | 'default' {
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode >= 400 && statusCode < 500) return 'warning';
  if (statusCode >= 500 || statusCode <= 0) return 'danger';
  return 'default';
}

function pagerItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items: Array<number | 'ellipsis'> = [1];
  if (page > 3) items.push('ellipsis');
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  for (let i = start; i <= end; i += 1) items.push(i);
  if (page < totalPages - 2) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

export function InsightsTab() {
  const [section, setSection] = useState<'api' | 'xray'>('api');

  const [apiLogs, setApiLogs] = useState<APIRequestLog[]>([]);
  const [apiTotal, setApiTotal] = useState(0);
  const [apiPage, setApiPage] = useState(1);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [apiExporting, setApiExporting] = useState(false);
  const [apiStats, setApiStats] = useState<APIUsageStats | null>(null);
  const [apiStatsLoading, setApiStatsLoading] = useState(true);
  const [apiFilters, setApiFilters] = useState({
    method: '',
    path: '',
    user: '',
    status: '',
    from: '',
    to: '',
  });

  const [xrayLogs, setXrayLogs] = useState<AdminXRayRequestLog[]>([]);
  const [xrayTotal, setXrayTotal] = useState(0);
  const [xrayPage, setXrayPage] = useState(1);
  const [xrayLoading, setXrayLoading] = useState(true);
  const [xrayError, setXrayError] = useState('');
  const [xrayExporting, setXrayExporting] = useState(false);
  const [xrayStats, setXrayStats] = useState<XRayUsageStats | null>(null);
  const [xrayStatsLoading, setXrayStatsLoading] = useState(true);
  const [xrayFilters, setXrayFilters] = useState({
    scan_id: '',
    registry_id: '',
    endpoint: '',
    status: '',
    from: '',
    to: '',
  });

  const apiRequestFilters: APIRequestLogFilters = useMemo(
    () => ({
      method: apiFilters.method || undefined,
      path: apiFilters.path || undefined,
      user: apiFilters.user || undefined,
      status: apiFilters.status || undefined,
      from: toIsoOrUndefined(apiFilters.from),
      to: toIsoOrUndefined(apiFilters.to),
    }),
    [apiFilters]
  );

  const xrayRequestFilters: XRayRequestLogFilters = useMemo(
    () => ({
      scan_id: xrayFilters.scan_id || undefined,
      registry_id: xrayFilters.registry_id || undefined,
      endpoint: xrayFilters.endpoint || undefined,
      status: xrayFilters.status || undefined,
      from: toIsoOrUndefined(xrayFilters.from),
      to: toIsoOrUndefined(xrayFilters.to),
    }),
    [xrayFilters]
  );

  const loadApiLogs = useCallback(async () => {
    setApiLoading(true);
    setApiError('');
    try {
      const result = await listAPIRequestLogs(apiPage, PAGE_SIZE, apiRequestFilters);
      setApiLogs(result.data ?? []);
      setApiTotal(result.total ?? 0);
    } catch (error: unknown) {
      setApiError(error instanceof Error ? error.message : 'Failed to load API logs');
    } finally {
      setApiLoading(false);
    }
  }, [apiPage, apiRequestFilters]);

  const loadXrayLogs = useCallback(async () => {
    setXrayLoading(true);
    setXrayError('');
    try {
      const result = await listXRayRequestLogs(xrayPage, PAGE_SIZE, xrayRequestFilters);
      setXrayLogs(result.data ?? []);
      setXrayTotal(result.total ?? 0);
    } catch (error: unknown) {
      setXrayError(error instanceof Error ? error.message : 'Failed to load xRay logs');
    } finally {
      setXrayLoading(false);
    }
  }, [xrayPage, xrayRequestFilters]);

  const loadApiStats = useCallback(async () => {
    setApiStatsLoading(true);
    try {
      setApiStats(
        await getAPIUsageStats(toIsoOrUndefined(apiFilters.from), toIsoOrUndefined(apiFilters.to))
      );
    } finally {
      setApiStatsLoading(false);
    }
  }, [apiFilters.from, apiFilters.to]);

  const loadXrayStats = useCallback(async () => {
    setXrayStatsLoading(true);
    try {
      setXrayStats(
        await getXRayUsageStats(
          toIsoOrUndefined(xrayFilters.from),
          toIsoOrUndefined(xrayFilters.to)
        )
      );
    } finally {
      setXrayStatsLoading(false);
    }
  }, [xrayFilters.from, xrayFilters.to]);

  useEffect(() => deferEffect(loadApiLogs), [loadApiLogs]);
  useEffect(() => deferEffect(loadApiStats), [loadApiStats]);
  useEffect(() => deferEffect(loadXrayLogs), [loadXrayLogs]);
  useEffect(() => deferEffect(loadXrayStats), [loadXrayStats]);

  async function handleApiExport() {
    setApiExporting(true);
    setApiError('');
    try {
      const rows: APIRequestLog[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = await listAPIRequestLogs(page, 500, apiRequestFilters);
        rows.push(...(result.data ?? []));
        total = result.total ?? 0;
        page += 1;
      } while (rows.length < total);

      const csv = [
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
            escapeCsv(entry.username ?? entry.user_id ?? ''),
            escapeCsv(entry.email ?? ''),
          ].join(',')
        ),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `justscan-api-logs-${new Date().toISOString().slice(0, 19)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setApiError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setApiExporting(false);
    }
  }

  async function handleXrayExport() {
    setXrayExporting(true);
    setXrayError('');
    try {
      const rows: AdminXRayRequestLog[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = await listXRayRequestLogs(page, 500, xrayRequestFilters);
        rows.push(...(result.data ?? []));
        total = result.total ?? 0;
        page += 1;
      } while (rows.length < total);

      const csv = [
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
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `justscan-xray-logs-${new Date().toISOString().slice(0, 19)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setXrayError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setXrayExporting(false);
    }
  }

  const apiTotalPages = Math.max(1, Math.ceil(apiTotal / PAGE_SIZE));
  const xrayTotalPages = Math.max(1, Math.ceil(xrayTotal / PAGE_SIZE));
  const apiPagination = pagerItems(apiPage, apiTotalPages);
  const xrayPagination = pagerItems(xrayPage, xrayTotalPages);

  return (
    <div className="space-y-4">
      <SegmentedControl
        options={[
          { id: 'api', label: 'API Requests' },
          { id: 'xray', label: 'xRay Calls' },
        ]}
        value={section}
        onChange={setSection}
        ariaLabel="Insights section"
      />

      {section === 'api' && (
        <div className="space-y-4">
          {!apiStatsLoading && apiStats && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">Total Requests</p>
                  <p className="text-2xl font-semibold">
                    {apiStats.total_requests.toLocaleString()}
                  </p>
                </Card.Content>
              </Card>
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">Error Rate</p>
                  <p className="text-2xl font-semibold">
                    {apiStats.total_requests > 0
                      ? `${((apiStats.error_requests / apiStats.total_requests) * 100).toFixed(1)}%`
                      : '0%'}
                  </p>
                </Card.Content>
              </Card>
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">Avg Duration</p>
                  <p className="text-2xl font-semibold">{apiStats.avg_duration_ms.toFixed(0)} ms</p>
                </Card.Content>
              </Card>
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">p95 Duration</p>
                  <p className="text-2xl font-semibold">{apiStats.p95_duration_ms.toFixed(0)} ms</p>
                </Card.Content>
              </Card>
            </div>
          )}
          <Card className="space-y-4">
            {apiError && <p className="text-sm text-danger">{apiError}</p>}
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
              <Select
                value={apiFilters.method || '__all__'}
                onChange={(v) => {
                  setApiFilters((p) => ({ ...p, method: v === '__all__' ? '' : String(v) }));
                  setApiPage(1);
                }}
                variant="secondary"
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
              <SearchField name="insights-api-path" variant="secondary" className="xl:col-span-2">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="Path filter"
                    value={apiFilters.path}
                    onChange={(e) => {
                      setApiFilters((p) => ({ ...p, path: e.target.value }));
                      setApiPage(1);
                    }}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <SearchField name="insights-api-user" variant="secondary">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="User or email"
                    value={apiFilters.user}
                    onChange={(e) => {
                      setApiFilters((p) => ({ ...p, user: e.target.value }));
                      setApiPage(1);
                    }}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Select
                value={apiFilters.status || '__all__'}
                onChange={(v) => {
                  setApiFilters((p) => ({ ...p, status: v === '__all__' ? '' : String(v) }));
                  setApiPage(1);
                }}
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__all__">All statuses</ListBox.Item>
                    <ListBox.Item id="2xx">2xx</ListBox.Item>
                    <ListBox.Item id="4xx">4xx</ListBox.Item>
                    <ListBox.Item id="5xx">5xx</ListBox.Item>
                    <ListBox.Item id="error">Any Error</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Button
                variant="secondary"
                onPress={handleApiExport}
                isDisabled={apiExporting || apiTotal === 0}
              >
                {apiExporting ? 'Exporting...' : 'Export CSV'}
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <Input
                type="datetime-local"
                variant="secondary"
                value={apiFilters.from}
                onChange={(e) => {
                  setApiFilters((p) => ({ ...p, from: e.target.value }));
                  setApiPage(1);
                }}
              />
              <Input
                type="datetime-local"
                variant="secondary"
                value={apiFilters.to}
                onChange={(e) => {
                  setApiFilters((p) => ({ ...p, to: e.target.value }));
                  setApiPage(1);
                }}
              />
            </div>

            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="API request logs" className="min-w-[1100px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Time</Table.Column>
                    <Table.Column>User</Table.Column>
                    <Table.Column>Method</Table.Column>
                    <Table.Column>Path</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Duration</Table.Column>
                  </Table.Header>
                  <Table.Body
                    renderEmptyState={() => (
                      <div className="py-10 text-center text-sm text-zinc-500">
                        {apiLoading ? 'Loading API logs...' : 'No API logs found.'}
                      </div>
                    )}
                  >
                    {apiLogs.map((log) => (
                      <Table.Row key={log.id} id={log.id} className="hover:bg-[var(--row-hover)]">
                        <Table.Cell className="text-xs text-zinc-500">
                          <span title={fullDate(log.created_at)}>{timeAgo(log.created_at)}</span>
                        </Table.Cell>
                        <Table.Cell className="text-xs text-zinc-500">
                          {log.username || log.email || log.user_id?.slice(0, 8) || 'anon'}
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" className="font-mono">
                            {log.method}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="font-mono text-xs text-zinc-500">
                          {log.path}
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" color={statusColor(log.status_code)}>
                            {log.status_code}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="text-xs text-zinc-500">
                          {log.duration_ms} ms
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
              <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
                <span className="text-xs text-zinc-500">
                  Showing {apiTotal === 0 ? 0 : (apiPage - 1) * PAGE_SIZE + 1}-
                  {Math.min(apiPage * PAGE_SIZE, apiTotal)} of {apiTotal}
                </span>
                <Pagination size="sm">
                  <Pagination.Content>
                    <Pagination.Item>
                      <Pagination.Previous
                        isDisabled={apiPage === 1}
                        onPress={() => setApiPage((p) => Math.max(1, p - 1))}
                      >
                        <Pagination.PreviousIcon />
                        <span>Previous</span>
                      </Pagination.Previous>
                    </Pagination.Item>
                    {apiPagination.map((item, index) =>
                      item === 'ellipsis' ? (
                        <Pagination.Item key={`api-ellipsis-${index}`}>
                          <Pagination.Ellipsis />
                        </Pagination.Item>
                      ) : (
                        <Pagination.Item key={`api-page-${item}`}>
                          <Pagination.Link
                            isActive={item === apiPage}
                            onPress={() => setApiPage(item)}
                          >
                            {item}
                          </Pagination.Link>
                        </Pagination.Item>
                      )
                    )}
                    <Pagination.Item>
                      <Pagination.Next
                        isDisabled={apiPage === apiTotalPages}
                        onPress={() => setApiPage((p) => Math.min(apiTotalPages, p + 1))}
                      >
                        <span>Next</span>
                        <Pagination.NextIcon />
                      </Pagination.Next>
                    </Pagination.Item>
                  </Pagination.Content>
                </Pagination>
                <div />
              </Table.Footer>
            </Table>
          </Card>
        </div>
      )}

      {section === 'xray' && (
        <div className="space-y-4">
          {!xrayStatsLoading && xrayStats && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">Total Calls</p>
                  <p className="text-2xl font-semibold">
                    {xrayStats.total_requests.toLocaleString()}
                  </p>
                </Card.Content>
              </Card>
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">Error Rate</p>
                  <p className="text-2xl font-semibold">
                    {xrayStats.total_requests > 0
                      ? `${((xrayStats.error_requests / xrayStats.total_requests) * 100).toFixed(1)}%`
                      : '0%'}
                  </p>
                </Card.Content>
              </Card>
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">Avg Duration</p>
                  <p className="text-2xl font-semibold">
                    {xrayStats.avg_duration_ms.toFixed(0)} ms
                  </p>
                </Card.Content>
              </Card>
              <Card>
                <Card.Content>
                  <p className="text-xs text-zinc-500">p95 Duration</p>
                  <p className="text-2xl font-semibold">
                    {xrayStats.p95_duration_ms.toFixed(0)} ms
                  </p>
                </Card.Content>
              </Card>
            </div>
          )}
          <Card className="space-y-4">
            {xrayError && <p className="text-sm text-danger">{xrayError}</p>}

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
              <SearchField name="insights-xray-scan" variant="secondary">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="Scan ID"
                    value={xrayFilters.scan_id}
                    onChange={(e) => {
                      setXrayFilters((p) => ({ ...p, scan_id: e.target.value }));
                      setXrayPage(1);
                    }}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <SearchField
                name="insights-xray-endpoint"
                variant="secondary"
                className="xl:col-span-2"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="Endpoint"
                    value={xrayFilters.endpoint}
                    onChange={(e) => {
                      setXrayFilters((p) => ({ ...p, endpoint: e.target.value }));
                      setXrayPage(1);
                    }}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Select
                value={xrayFilters.status || '__all__'}
                onChange={(v) => {
                  setXrayFilters((p) => ({ ...p, status: v === '__all__' ? '' : String(v) }));
                  setXrayPage(1);
                }}
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="__all__">All statuses</ListBox.Item>
                    <ListBox.Item id="2xx">2xx</ListBox.Item>
                    <ListBox.Item id="4xx">4xx</ListBox.Item>
                    <ListBox.Item id="5xx">5xx</ListBox.Item>
                    <ListBox.Item id="error">Any Error</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <SearchField name="insights-xray-registry" variant="secondary">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="Registry ID"
                    value={xrayFilters.registry_id}
                    onChange={(e) => {
                      setXrayFilters((p) => ({ ...p, registry_id: e.target.value }));
                      setXrayPage(1);
                    }}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Button
                variant="secondary"
                onPress={handleXrayExport}
                isDisabled={xrayExporting || xrayTotal === 0}
              >
                {xrayExporting ? 'Exporting...' : 'Export CSV'}
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <Input
                type="datetime-local"
                variant="secondary"
                value={xrayFilters.from}
                onChange={(e) => {
                  setXrayFilters((p) => ({ ...p, from: e.target.value }));
                  setXrayPage(1);
                }}
              />
              <Input
                type="datetime-local"
                variant="secondary"
                value={xrayFilters.to}
                onChange={(e) => {
                  setXrayFilters((p) => ({ ...p, to: e.target.value }));
                  setXrayPage(1);
                }}
              />
            </div>

            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="XRay request logs" className="min-w-[1200px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Time</Table.Column>
                    <Table.Column>Scan</Table.Column>
                    <Table.Column>Method</Table.Column>
                    <Table.Column>Endpoint</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Duration</Table.Column>
                    <Table.Column>Error</Table.Column>
                  </Table.Header>
                  <Table.Body
                    renderEmptyState={() => (
                      <div className="py-10 text-center text-sm text-zinc-500">
                        {xrayLoading ? 'Loading xRay logs...' : 'No xRay logs found.'}
                      </div>
                    )}
                  >
                    {xrayLogs.map((log) => (
                      <Table.Row key={log.id} id={log.id} className="hover:bg-[var(--row-hover)]">
                        <Table.Cell className="text-xs text-zinc-500">
                          <span title={fullDate(log.created_at)}>{timeAgo(log.created_at)}</span>
                        </Table.Cell>
                        <Table.Cell className="text-xs">
                          {log.scan_id ? (
                            <Link
                              href={`/scans/${log.scan_id}`}
                              className="font-mono text-violet-400 hover:underline"
                            >
                              {log.scan_id.slice(0, 8)}…
                            </Link>
                          ) : (
                            '—'
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" className="font-mono">
                            {log.method}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="font-mono text-xs text-zinc-500">
                          {log.endpoint}
                        </Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant="soft" color={statusColor(log.status_code)}>
                            {log.status_code <= 0 ? 'ERR' : log.status_code}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell className="text-xs text-zinc-500">
                          {log.duration_ms} ms
                        </Table.Cell>
                        <Table.Cell className="max-w-[280px] whitespace-pre-wrap break-words text-xs text-danger">
                          {log.error || '—'}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
              <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
                <span className="text-xs text-zinc-500">
                  Showing {xrayTotal === 0 ? 0 : (xrayPage - 1) * PAGE_SIZE + 1}-
                  {Math.min(xrayPage * PAGE_SIZE, xrayTotal)} of {xrayTotal}
                </span>
                <Pagination size="sm">
                  <Pagination.Content>
                    <Pagination.Item>
                      <Pagination.Previous
                        isDisabled={xrayPage === 1}
                        onPress={() => setXrayPage((p) => Math.max(1, p - 1))}
                      >
                        <Pagination.PreviousIcon />
                        <span>Previous</span>
                      </Pagination.Previous>
                    </Pagination.Item>
                    {xrayPagination.map((item, index) =>
                      item === 'ellipsis' ? (
                        <Pagination.Item key={`xray-ellipsis-${index}`}>
                          <Pagination.Ellipsis />
                        </Pagination.Item>
                      ) : (
                        <Pagination.Item key={`xray-page-${item}`}>
                          <Pagination.Link
                            isActive={item === xrayPage}
                            onPress={() => setXrayPage(item)}
                          >
                            {item}
                          </Pagination.Link>
                        </Pagination.Item>
                      )
                    )}
                    <Pagination.Item>
                      <Pagination.Next
                        isDisabled={xrayPage === xrayTotalPages}
                        onPress={() => setXrayPage((p) => Math.min(xrayTotalPages, p + 1))}
                      >
                        <span>Next</span>
                        <Pagination.NextIcon />
                      </Pagination.Next>
                    </Pagination.Item>
                  </Pagination.Content>
                </Pagination>
                <div />
              </Table.Footer>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
