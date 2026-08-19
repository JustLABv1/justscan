'use client';

import {
  getAdminMCPOverview,
  listAdminMCPActivity,
  updateAdminMCPSettings,
} from '@/lib/api/admin';
import type {
  MCPActivityFilters,
  MCPInteraction,
  MCPOverview,
  MCPRuntimeMode,
} from '@/lib/api/types/admin';
import { useToast } from '@/components/toast';
import { StatCard } from '@/components/ui/stat-card';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Activity01Icon,
  Clock03Icon,
  CodeIcon,
  FlashIcon,
  UserGroupIcon,
} from 'hugeicons-react';
import {
  Button,
  Card,
  Chip,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Table,
} from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 25;
type MCPWindow = '24h' | '7d' | '30d';

function statusColor(status: MCPInteraction['status']): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'success') return 'success';
  if (status === 'rejected') return 'warning';
  if (status === 'error') return 'danger';
  return 'default';
}

function modeLabel(mode: MCPRuntimeMode) {
  if (mode === 'read_only') return 'Read-only';
  if (mode === 'disabled') return 'Disabled';
  return 'Read + actions';
}

function modeDescription(mode: MCPRuntimeMode) {
  if (mode === 'read_only') return 'Read tools stay available; scan-starting actions are rejected.';
  if (mode === 'disabled') return 'All MCP requests are rejected, including active stdio sessions.';
  return 'Read tools and confirmation-gated scan actions are available.';
}

function pagerItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const items: Array<number | 'ellipsis'> = [1];
  if (page > 3) items.push('ellipsis');
  for (let value = Math.max(2, page - 1); value <= Math.min(totalPages - 1, page + 1); value += 1) {
    items.push(value);
  }
  if (page < totalPages - 2) items.push('ellipsis');
  items.push(totalPages);
  return items;
}

export function MCPAdminTab() {
  const toast = useToast();
  const [window, setWindow] = useState<MCPWindow>('24h');
  const [overview, setOverview] = useState<MCPOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [activity, setActivity] = useState<MCPInteraction[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [filters, setFilters] = useState({
    tool: '',
    transport: '',
    status: '',
    user: '',
  });
  const [draftMode, setDraftMode] = useState<MCPRuntimeMode>('enabled');
  const [savingMode, setSavingMode] = useState(false);

  const activityFilters: MCPActivityFilters = useMemo(
    () => ({
      tool: filters.tool || undefined,
      transport: filters.transport || undefined,
      status: filters.status || undefined,
      user: filters.user || undefined,
    }),
    [filters]
  );

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const result = await getAdminMCPOverview(window);
      setOverview(result);
      setDraftMode(result.settings.mode);
    } catch (error: unknown) {
      setOverviewError(error instanceof Error ? error.message : 'Failed to load MCP analytics');
    } finally {
      setOverviewLoading(false);
    }
  }, [window]);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError('');
    try {
      const result = await listAdminMCPActivity(
        activityPage,
        PAGE_SIZE,
        activityFilters,
        window
      );
      setActivity(result.data ?? []);
      setActivityTotal(result.total ?? 0);
    } catch (error: unknown) {
      setActivityError(error instanceof Error ? error.message : 'Failed to load MCP activity');
    } finally {
      setActivityLoading(false);
    }
  }, [activityFilters, activityPage, window]);

  useEffect(() => {
    return deferEffect(loadOverview);
  }, [loadOverview]);

  useEffect(() => {
    return deferEffect(loadActivity);
  }, [loadActivity]);

  async function saveMode() {
    setSavingMode(true);
    try {
      const settings = await updateAdminMCPSettings(draftMode);
      setOverview((current) => (current ? { ...current, settings } : current));
      toast.success(`MCP mode set to ${modeLabel(settings.mode)}`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update MCP mode');
    } finally {
      setSavingMode(false);
    }
  }

  const metrics = overview?.metrics;
  const toolMetrics = overview?.by_tool ?? [];
  const transportMetrics = overview?.by_transport ?? [];
  const totalPages = Math.max(1, Math.ceil(activityTotal / PAGE_SIZE));
  const pagination = pagerItems(activityPage, totalPages);

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-muted">
            Tool-level telemetry for HTTP and stdio MCP clients. Payloads and credentials are never
            stored.
          </p>
        </div>
        <Select
          aria-label="MCP analytics window"
          value={window}
          onChange={(value) => {
            setWindow(value as MCPWindow);
            setActivityPage(1);
          }}
          variant="secondary"
          className="w-full sm:w-44"
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="24h">Last 24 hours</ListBox.Item>
              <ListBox.Item id="7d">Last 7 days</ListBox.Item>
              <ListBox.Item id="30d">Last 30 days</ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {overviewError && <p className="text-sm text-danger">{overviewError}</p>}

      {metrics && !overviewLoading && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
          <StatCard
            label="Tool calls"
            value={metrics.total_calls.toLocaleString()}
            hint={`${(metrics.error_rate * 100).toFixed(1)}% error or rejected`}
            icon={<Activity01Icon size={17} />}
            variant="stacked"
          />
          <StatCard
            label="Successful"
            value={metrics.successful_calls.toLocaleString()}
            hint={`${metrics.failed_calls.toLocaleString()} tool errors`}
            icon={<FlashIcon size={17} />}
            tone="success"
            variant="stacked"
          />
          <StatCard
            label="Actions"
            value={metrics.action_calls.toLocaleString()}
            hint={`${metrics.replayed_actions.toLocaleString()} idempotent replays`}
            icon={<CodeIcon size={17} />}
            tone="warning"
            variant="stacked"
          />
          <StatCard
            label="Active users"
            value={metrics.active_users.toLocaleString()}
            hint={`${metrics.p95_duration_ms.toFixed(0)} ms p95`}
            icon={<UserGroupIcon size={17} />}
            variant="stacked"
          />
        </div>
      )}

      {overview && (
        <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
          <Card className="space-y-4">
            <Card.Header>
              <Card.Title>MCP runtime control</Card.Title>
              <Card.Description>
                Use read-only mode while investigating integrations. The change applies to new HTTP
                requests and active stdio tool calls.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-4">
              <Select
                aria-label="MCP runtime mode"
                value={draftMode}
                onChange={(value) => setDraftMode(value as MCPRuntimeMode)}
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="enabled">Read + actions</ListBox.Item>
                    <ListBox.Item id="read_only">Read-only</ListBox.Item>
                    <ListBox.Item id="disabled">Disabled</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <p className="text-xs leading-5 text-muted">{modeDescription(draftMode)}</p>
              <div className="flex flex-wrap gap-2">
                <Chip size="sm" variant="soft" color={overview.settings.config_enabled ? 'success' : 'warning'}>
                  {overview.settings.config_enabled ? 'MCP configured' : 'MCP not enabled in config'}
                </Chip>
                <Chip size="sm" variant="soft" color={overview.settings.http_enabled ? 'success' : 'default'}>
                  HTTP {overview.settings.http_enabled ? 'exposed' : 'off'}
                </Chip>
              </div>
              {overview.settings.http_enabled && overview.settings.endpoint && (
                <p className="font-mono text-xs text-muted">{overview.settings.endpoint}</p>
              )}
              <div className="flex justify-end">
                <Button variant="secondary" onPress={() => void saveMode()} isDisabled={savingMode || draftMode === overview.settings.mode}>
                  {savingMode ? 'Saving...' : 'Save runtime mode'}
                </Button>
              </div>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title>Most used tools</Card.Title>
              <Card.Description>Calls and failures in the selected time window.</Card.Description>
            </Card.Header>
            <Card.Content>
              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content aria-label="MCP tool usage" className="min-w-[620px]">
                    <Table.Header>
                      <Table.Column isRowHeader>Tool</Table.Column>
                      <Table.Column>Calls</Table.Column>
                      <Table.Column>Errors</Table.Column>
                      <Table.Column>Actions</Table.Column>
                      <Table.Column>Avg. duration</Table.Column>
                    </Table.Header>
                    <Table.Body
                      renderEmptyState={() => (
                        <div className="py-8 text-center text-sm text-muted">
                          {overviewLoading ? 'Loading MCP tool stats...' : 'No MCP calls in this window.'}
                        </div>
                      )}
                    >
                      {toolMetrics.map((tool) => (
                        <Table.Row key={tool.tool_name}>
                          <Table.Cell className="font-mono text-xs">{tool.tool_name}</Table.Cell>
                          <Table.Cell>{tool.calls.toLocaleString()}</Table.Cell>
                          <Table.Cell>
                            <Chip size="sm" variant="soft" color={tool.errors > 0 ? 'warning' : 'success'}>
                              {tool.errors.toLocaleString()}
                            </Chip>
                          </Table.Cell>
                          <Table.Cell>{tool.actions.toLocaleString()}</Table.Cell>
                          <Table.Cell className="text-xs text-muted">{tool.avg_duration_ms.toFixed(0)} ms</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-divider/60 pt-3">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Transport mix
                </span>
                {transportMetrics.map((transport) => (
                  <Chip key={transport.transport} size="sm" variant="soft">
                    {transport.transport}: {transport.calls.toLocaleString()}
                  </Chip>
                ))}
                {transportMetrics.length === 0 && (
                  <span className="text-xs text-muted">No calls yet</span>
                )}
              </div>
            </Card.Content>
          </Card>
        </div>
      )}

      <Card className="space-y-4">
        <Card.Header>
          <Card.Title>Interaction activity</Card.Title>
          <Card.Description>Recent calls are searchable by tool, transport, status, and user.</Card.Description>
        </Card.Header>
        <Card.Content className="space-y-4">
          {activityError && <p className="text-sm text-danger">{activityError}</p>}
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <Select
              aria-label="MCP tool filter"
              value={filters.tool || '__all__'}
              onChange={(value) => {
                setFilters((current) => ({ ...current, tool: value === '__all__' ? '' : String(value) }));
                setActivityPage(1);
              }}
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">All tools</ListBox.Item>
                  {toolMetrics.map((tool) => (
                    <ListBox.Item key={tool.tool_name} id={tool.tool_name}>
                      {tool.tool_name}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="MCP transport filter"
              value={filters.transport || '__all__'}
              onChange={(value) => {
                setFilters((current) => ({ ...current, transport: value === '__all__' ? '' : String(value) }));
                setActivityPage(1);
              }}
              variant="secondary"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">All transports</ListBox.Item>
                  <ListBox.Item id="http">HTTP</ListBox.Item>
                  <ListBox.Item id="stdio">stdio</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="MCP status filter"
              value={filters.status || '__all__'}
              onChange={(value) => {
                setFilters((current) => ({ ...current, status: value === '__all__' ? '' : String(value) }));
                setActivityPage(1);
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
                  <ListBox.Item id="success">Success</ListBox.Item>
                  <ListBox.Item id="error">Error</ListBox.Item>
                  <ListBox.Item id="rejected">Rejected</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <SearchField name="mcp-activity-user" variant="secondary">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Filter by user"
                  value={filters.user}
                  onChange={(event) => {
                    setFilters((current) => ({ ...current, user: event.target.value }));
                    setActivityPage(1);
                  }}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
          </div>

          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="MCP interaction activity" className="min-w-[1000px]">
                <Table.Header>
                  <Table.Column isRowHeader>Time</Table.Column>
                  <Table.Column>User</Table.Column>
                  <Table.Column>Transport</Table.Column>
                  <Table.Column>Tool</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column>Duration</Table.Column>
                  <Table.Column>Type</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="py-10 text-center text-sm text-muted">
                      {activityLoading ? 'Loading MCP activity...' : 'No MCP activity found.'}
                    </div>
                  )}
                >
                  {activity.map((entry) => (
                    <Table.Row key={entry.id} id={entry.id} className="hover:bg-[var(--row-hover)]">
                      <Table.Cell className="text-xs text-muted">
                        <span title={fullDate(entry.created_at)}>{timeAgo(entry.created_at)}</span>
                      </Table.Cell>
                      <Table.Cell className="text-xs text-muted">
                        {entry.username || entry.email || entry.user_id?.slice(0, 8) || 'unknown'}
                      </Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="soft" className="font-mono">
                          {entry.transport}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="font-mono text-xs">{entry.tool_name}</Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="soft" color={statusColor(entry.status)}>
                          {entry.status}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="text-xs text-muted">{entry.duration_ms} ms</Table.Cell>
                      <Table.Cell className="text-xs">
                        {entry.action ? (
                          <span className="inline-flex items-center gap-1 text-warning">
                            <CodeIcon size={14} />
                            {entry.replayed ? 'replay' : 'action'}
                          </span>
                        ) : (
                          'read'
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
            <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
              <span className="text-xs text-muted">
                Showing {activityTotal === 0 ? 0 : (activityPage - 1) * PAGE_SIZE + 1}-
                {Math.min(activityPage * PAGE_SIZE, activityTotal)} of {activityTotal}
              </span>
              <Pagination size="sm">
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={activityPage === 1}
                      onPress={() => setActivityPage((current) => Math.max(1, current - 1))}
                    >
                      <Pagination.PreviousIcon />
                      <span>Previous</span>
                    </Pagination.Previous>
                  </Pagination.Item>
                  {pagination.map((item, index) =>
                    item === 'ellipsis' ? (
                      <Pagination.Item key={`ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={item}>
                        <Pagination.Link
                          isActive={item === activityPage}
                          onPress={() => setActivityPage(item)}
                        >
                          {item}
                        </Pagination.Link>
                      </Pagination.Item>
                    )
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={activityPage === totalPages}
                      onPress={() => setActivityPage((current) => Math.min(totalPages, current + 1))}
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
        </Card.Content>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted">
        <Clock03Icon size={14} />
        Analytics are retained with the MCP interaction table and contain metadata only.
      </div>
    </div>
  );
}
