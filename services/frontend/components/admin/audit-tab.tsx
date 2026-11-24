'use client';

import { AdminPageShell } from '@/components/admin/admin-page-shell';
import {
  AdminDateRangeField,
  dateRangeToIso,
  type AdminDateRange,
} from '@/components/admin/admin-filters';
import { auditActor, parseAuditDetails } from '@/components/admin/audit-format';
import { FilterDisclosureTrigger } from '@/components/ui/filter-toolbar';
import { StatusAlert } from '@/components/ui/form-alert';
import { ROLE_LABELS, eventLabel, labelFor } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { listAuditLogs } from '@/lib/api/admin';
import type { AuditLog, AuditLogFilters } from '@/lib/api/types/admin';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  DescriptionList,
  Disclosure,
  Input,
  Label,
  ResourceList,
  SearchField,
  TablePager,
  TextField,
} from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 20;

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
  const [dateRange, setDateRange] = useState<AdminDateRange>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const requestFilters: AuditLogFilters = useMemo(
    () => ({
      q: query.trim() || undefined,
      user: userFilter.trim() || undefined,
      operation: operationFilter.trim() || undefined,
      ...dateRangeToIso(dateRange),
    }),
    [dateRange, operationFilter, query, userFilter]
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
            escapeCsv(entry.username || auditActor(entry)),
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

  const moreFilterCount = [userFilter, operationFilter, dateRange].filter(Boolean).length;

  return (
    <AdminPageShell
      actions={
        <Button
          size="sm"
          variant="secondary"
          onPress={handleExport}
          isDisabled={exporting || total === 0}
        >
          {exporting ? 'Exporting...' : 'Export CSV'}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <StatusAlert status="danger" title="Audit log failed to load" description={error} />
        ) : null}

        <Card className="gap-0 overflow-hidden py-0">
          <Disclosure className="border-b border-border p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchField
                aria-label="Search activity"
                name="admin-audit-search"
                variant="secondary"
                className="min-w-0 flex-1"
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setPage(1);
                }}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search activity details..." />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <FilterDisclosureTrigger activeCount={moreFilterCount} />
            </div>
            <Disclosure.Content>
              <Disclosure.Body className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-3">
                <TextField
                  value={userFilter}
                  onChange={(value) => {
                    setUserFilter(value);
                    setPage(1);
                  }}
                >
                  <Label className="mb-1.5 text-xs font-medium text-muted-foreground">User</Label>
                  <Input variant="secondary" placeholder="Username or email" />
                </TextField>
                <TextField
                  value={operationFilter}
                  onChange={(value) => {
                    setOperationFilter(value);
                    setPage(1);
                  }}
                >
                  <Label className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Activity type
                  </Label>
                  <Input variant="secondary" placeholder="For example scan.create" />
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

          {logs.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {loading ? 'Loading activity...' : 'No activity matches your filters.'}
            </p>
          ) : (
            <ResourceList bordered={false} aria-label="Audit log" aria-busy={loading}>
              {logs.map((log) => {
                const { summary, facts } = parseAuditDetails(log.details);
                const expanded = expandedId === log.id;
                const hasDetails = facts.length > 0 || summary.length > 120;
                const role = log.role ? labelFor(ROLE_LABELS, log.role) : '';
                return (
                  <ResourceList.Item
                    key={log.id}
                    title={eventLabel(log.operation)}
                    titleTooltip={log.operation}
                    description={[auditActor(log), role].filter(Boolean).join(' · ')}
                    meta={
                      <span
                        className="whitespace-nowrap text-xs text-muted-foreground"
                        title={fullDate(log.created_at)}
                      >
                        {timeAgo(log.created_at)}
                      </span>
                    }
                    actions={
                      hasDetails ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={expanded}
                          aria-controls={`audit-details-${log.id}`}
                          onPress={() => setExpandedId(expanded ? null : log.id)}
                        >
                          {expanded ? 'Hide details' : 'Details'}
                        </Button>
                      ) : null
                    }
                  >
                    {summary ? (
                      <p
                        className={cn(
                          'text-sm text-muted-foreground [overflow-wrap:anywhere]',
                          !expanded && 'line-clamp-1'
                        )}
                      >
                        {summary}
                      </p>
                    ) : null}
                    {expanded ? (
                      <div
                        id={`audit-details-${log.id}`}
                        className="mt-2 rounded-lg bg-muted/30 p-3"
                      >
                        <DescriptionList
                          columns={3}
                          items={[
                            ...facts.map((fact) => ({
                              label: fact.label,
                              value: fact.value,
                              mono: fact.key !== 'size' && fact.key !== 'violations',
                            })),
                            { label: 'Recorded', value: fullDate(log.created_at) },
                            { label: 'Email', value: log.email, hidden: !log.email },
                          ]}
                        />
                      </div>
                    ) : null}
                  </ResourceList.Item>
                );
              })}
            </ResourceList>
          )}
          <TablePager
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            noun="events"
          />
        </Card>
      </div>
    </AdminPageShell>
  );
}
