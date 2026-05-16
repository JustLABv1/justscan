'use client';

import { listAuditLogs } from '@/lib/api/admin';
import type { AuditLog, AuditLogFilters } from '@/lib/api/types/admin';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Input,
  Pagination,
  SearchField,
  Table,
} from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 20;

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

export function AuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  const requestFilters: AuditLogFilters = useMemo(
    () => ({
      q: query.trim() || undefined,
      user: userFilter.trim() || undefined,
      operation: operationFilter.trim() || undefined,
      from: toIsoOrUndefined(fromFilter),
      to: toIsoOrUndefined(toFilter),
    }),
    [fromFilter, operationFilter, query, toFilter, userFilter]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await listAuditLogs(page, PAGE_SIZE, requestFilters);
      setLogs(response.data ?? []);
      setTotal(response.total ?? 0);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, requestFilters]);

  useEffect(() => deferEffect(load), [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const rows: AuditLog[] = [];
      let exportPage = 1;
      let exportTotal = 0;

      do {
        const result = await listAuditLogs(exportPage, 200, requestFilters);
        rows.push(...(result.data ?? []));
        exportTotal = result.total ?? 0;
        exportPage += 1;
      } while (rows.length < exportTotal);

      const csv = [
        ['created_at', 'username', 'email', 'role', 'operation', 'details'].join(','),
        ...rows.map((entry) =>
          [
            escapeCsv(entry.created_at),
            escapeCsv(entry.username ?? entry.user_id),
            escapeCsv(entry.email ?? ''),
            escapeCsv(entry.role ?? ''),
            escapeCsv(entry.operation),
            escapeCsv(entry.details),
          ].join(',')
        ),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `justscan-audit-${new Date().toISOString().slice(0, 19)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export audit logs');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border border-danger/30 bg-danger/10">
          <Card.Content>
            <p className="text-sm text-danger">{error}</p>
          </Card.Content>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid w-full gap-2 md:grid-cols-2 xl:grid-cols-5">
            <SearchField name="admin-audit-search" variant="secondary">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Search details or operation..."
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Input
              variant="secondary"
              placeholder="User or email"
              value={userFilter}
              onChange={(event) => {
                setUserFilter(event.target.value);
                setPage(1);
              }}
            />
            <Input
              variant="secondary"
              placeholder="Operation"
              value={operationFilter}
              onChange={(event) => {
                setOperationFilter(event.target.value);
                setPage(1);
              }}
            />
            <Input
              type="datetime-local"
              variant="secondary"
              value={fromFilter}
              onChange={(event) => {
                setFromFilter(event.target.value);
                setPage(1);
              }}
            />
            <Input
              type="datetime-local"
              variant="secondary"
              value={toFilter}
              onChange={(event) => {
                setToFilter(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <Button
            variant="secondary"
            onPress={handleExport}
            isDisabled={exporting || total === 0}
            className="shrink-0"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Admin audit logs" className="min-w-[1100px]">
              <Table.Header>
                <Table.Column isRowHeader>Time</Table.Column>
                <Table.Column>User</Table.Column>
                <Table.Column>Role</Table.Column>
                <Table.Column>Operation</Table.Column>
                <Table.Column>Details</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading audit events...' : 'No audit events match your filters.'}
                  </div>
                )}
              >
                {logs.map((log) => (
                  <Table.Row key={log.id} id={log.id} className="hover:bg-[var(--row-hover)]">
                    <Table.Cell className="text-xs text-zinc-500">
                      <span title={fullDate(log.created_at)}>{timeAgo(log.created_at)}</span>
                    </Table.Cell>
                    <Table.Cell className="font-medium">{log.username ?? log.user_id.slice(0, 8)}</Table.Cell>
                    <Table.Cell className="text-xs uppercase tracking-[0.12em] text-zinc-500">
                      {log.role ?? 'n/a'}
                    </Table.Cell>
                    <Table.Cell className="font-mono text-xs">{log.operation}</Table.Cell>
                    <Table.Cell className="max-w-[520px] text-sm text-zinc-500">
                      <div className="line-clamp-2 whitespace-pre-wrap break-words">{log.details || 'No details recorded.'}</div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
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
                    <Pagination.Item key={`audit-ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={`audit-page-${item}`}>
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
        </Table>
      </Card>
    </div>
  );
}
