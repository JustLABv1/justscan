'use client';

import { FilterDisclosureTrigger } from '@/components/ui/filter-toolbar';
import { StatusAlert } from '@/components/ui/form-alert';
import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import { StatusTag, type StatusDotTone } from '@/components/ui/status-dot';
import { displayUser, humanize, labelFor, pluralize } from '@/lib/labels';
import { getAdminMCPOverview, listAdminMCPActivity, updateAdminMCPSettings } from '@/lib/api/admin';
import type {
  MCPActivityFilters,
  MCPInteraction,
  MCPOverview,
  MCPRuntimeMode,
} from '@/lib/api/types/admin';
import { useToast } from '@/components/toast';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Disclosure,
  ListBox,
  ResourceList,
  SearchField,
  Select,
  SettingRow,
  SettingsSection,
  Table,
  TablePager,
} from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 25;
type MCPWindow = '24h' | '7d' | '30d';

const STATUS_DISPLAY: Record<string, { label: string; tone: StatusDotTone }> = {
  success: { label: 'Succeeded', tone: 'success' },
  error: { label: 'Failed', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'warning' },
};

const TRANSPORT_LABELS: Record<string, string> = {
  http: 'HTTP',
  stdio: 'Local (stdio)',
};

/** MCP tool names are snake_case identifiers such as `list_scans`. */
function toolLabel(name: string) {
  return humanize(name) || 'Unknown tool';
}

function modeLabel(mode: MCPRuntimeMode) {
  if (mode === 'read_only') return 'Read-only';
  if (mode === 'disabled') return 'Disabled';
  return 'Read and actions';
}

function modeDescription(mode: MCPRuntimeMode) {
  if (mode === 'read_only') return 'Read tools stay available; scan-starting actions are rejected.';
  if (mode === 'disabled') return 'All MCP requests are rejected, including active stdio sessions.';
  return 'Read tools and confirmation-gated scan actions are available.';
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
      const result = await listAdminMCPActivity(activityPage, PAGE_SIZE, activityFilters, window);
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
  const maxToolCalls = Math.max(1, ...toolMetrics.map((tool) => tool.calls));
  const modeDirty = Boolean(overview && draftMode !== overview.settings.mode);

  return (
    <div className="space-y-4">
      {overviewError ? (
        <StatusAlert
          status="danger"
          title="MCP analytics failed to load"
          description={overviewError}
        />
      ) : null}

      {overview ? (
        <SettingsSection
          title="MCP access"
          description="Controls what MCP clients can do. Applies to new HTTP requests and running stdio sessions."
          footer={
            modeDirty ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={savingMode}
                  onPress={() => setDraftMode(overview.settings.mode)}
                >
                  Discard
                </Button>
                <Button size="sm" onPress={() => void saveMode()} isDisabled={savingMode}>
                  {savingMode ? 'Saving...' : 'Save changes'}
                </Button>
              </>
            ) : null
          }
        >
          <SettingRow label="Runtime mode" description={modeDescription(draftMode)}>
            <Select
              aria-label="Runtime mode"
              value={draftMode}
              onChange={(value) => setDraftMode(value as MCPRuntimeMode)}
              variant="secondary"
              className="w-full sm:w-44"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="enabled">Read and actions</ListBox.Item>
                  <ListBox.Item id="read_only">Read-only</ListBox.Item>
                  <ListBox.Item id="disabled">Disabled</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </SettingRow>
          <SettingRow
            label="Server configuration"
            description={
              overview.settings.http_enabled && overview.settings.endpoint ? (
                <span className="break-all">HTTP endpoint: {overview.settings.endpoint}</span>
              ) : (
                'Set in the backend configuration file.'
              )
            }
          >
            <StatusTag tone={overview.settings.config_enabled ? 'success' : 'warning'}>
              {overview.settings.config_enabled ? 'MCP enabled' : 'MCP not enabled'}
            </StatusTag>
            <StatusTag tone={overview.settings.http_enabled ? 'success' : 'muted'}>
              {overview.settings.http_enabled ? 'HTTP exposed' : 'HTTP off'}
            </StatusTag>
          </SettingRow>
        </SettingsSection>
      ) : null}

      <div className="flex flex-col justify-between gap-3 pt-2 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-base font-medium">Usage</h2>
          <p className="text-sm text-muted-foreground">
            Tool calls from HTTP and stdio clients. Only metadata is stored, never payloads or
            credentials.
          </p>
        </div>
        <Select
          aria-label="Time window"
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

      {metrics && !overviewLoading ? (
        <StatStrip className="lg:grid-cols-4">
          <StatStripItem
            label="Tool calls"
            value={metrics.total_calls.toLocaleString()}
            hint={`${(metrics.error_rate * 100).toFixed(1)}% failed or rejected`}
            tone={metrics.error_rate > 0 ? 'warning' : undefined}
          />
          <StatStripItem
            label="Actions"
            value={metrics.action_calls.toLocaleString()}
            hint={`${pluralize(metrics.replayed_actions, 'repeated request')}`}
          />
          <StatStripItem label="Active users" value={metrics.active_users.toLocaleString()} />
          <StatStripItem
            label="Response time"
            value={`${metrics.p95_duration_ms.toFixed(0)} ms`}
            hint="95th percentile"
          />
        </StatStrip>
      ) : null}

      {overview ? (
        <section className="space-y-2" aria-labelledby="mcp-tools-heading">
          <h3 id="mcp-tools-heading" className="text-sm font-medium">
            Most used tools
          </h3>
          <ResourceList aria-label="Most used MCP tools">
            {toolMetrics.length === 0 ? (
              <ResourceList.Item
                title={overviewLoading ? 'Loading tool usage...' : 'No MCP calls in this window'}
              />
            ) : (
              toolMetrics.map((tool) => (
                <ResourceList.Item
                  key={tool.tool_name}
                  title={toolLabel(tool.tool_name)}
                  titleTooltip={tool.tool_name}
                  description={[
                    pluralize(tool.calls, 'call'),
                    tool.errors > 0 ? pluralize(tool.errors, 'error') : null,
                    tool.actions > 0 ? pluralize(tool.actions, 'action') : null,
                    `${tool.avg_duration_ms.toFixed(0)} ms average`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  tone={tool.errors > 0 ? 'warning' : 'default'}
                >
                  <div
                    className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.max(2, (tool.calls / maxToolCalls) * 100)}%` }}
                    />
                  </div>
                </ResourceList.Item>
              ))
            )}
          </ResourceList>
          {transportMetrics.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              By transport:{' '}
              {transportMetrics
                .map(
                  (transport) =>
                    `${labelFor(TRANSPORT_LABELS, transport.transport)} ${transport.calls.toLocaleString()}`
                )
                .join(' · ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <Card className="gap-0 overflow-hidden py-0">
        <Card.Header className="border-b border-border py-4">
          <Card.Title>Activity</Card.Title>
          <Card.Description>Individual tool calls in the selected time window.</Card.Description>
        </Card.Header>
        <Disclosure className="border-b border-border p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <SearchField
              aria-label="Filter by user"
              name="mcp-activity-user"
              variant="secondary"
              className="min-w-0 flex-1"
              value={filters.user}
              onChange={(value) => {
                setFilters((current) => ({ ...current, user: value }));
                setActivityPage(1);
              }}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Filter by user..." />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Select
              aria-label="Tool"
              value={filters.tool || '__all__'}
              onChange={(value) => {
                setFilters((current) => ({
                  ...current,
                  tool: value === '__all__' ? '' : String(value),
                }));
                setActivityPage(1);
              }}
              variant="secondary"
              className="w-full md:w-48"
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
                      {toolLabel(tool.tool_name)}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="Status"
              value={filters.status || '__all__'}
              onChange={(value) => {
                setFilters((current) => ({
                  ...current,
                  status: value === '__all__' ? '' : String(value),
                }));
                setActivityPage(1);
              }}
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
                  <ListBox.Item id="success">Succeeded</ListBox.Item>
                  <ListBox.Item id="error">Failed</ListBox.Item>
                  <ListBox.Item id="rejected">Rejected</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <FilterDisclosureTrigger activeCount={filters.transport ? 1 : 0} />
          </div>
          <Disclosure.Content>
            <Disclosure.Body className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Transport
                </span>
                <Select
                  aria-label="Transport"
                  value={filters.transport || '__all__'}
                  onChange={(value) => {
                    setFilters((current) => ({
                      ...current,
                      transport: value === '__all__' ? '' : String(value),
                    }));
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
                      <ListBox.Item id="http">{TRANSPORT_LABELS.http}</ListBox.Item>
                      <ListBox.Item id="stdio">{TRANSPORT_LABELS.stdio}</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>

        {activityError ? (
          <StatusAlert
            className="m-4"
            status="danger"
            title="MCP activity failed to load"
            description={activityError}
          />
        ) : null}

        <Table.Responsive
          cards={
            <ResourceList aria-label="MCP activity" bordered={false}>
              {!activity.length && (
                <li className="p-4 text-sm text-muted-foreground">
                  {activityLoading ? 'Loading MCP activity…' : 'No MCP activity found.'}
                </li>
              )}
              {activity.map((entry) => {
                const status = STATUS_DISPLAY[entry.status] ?? {
                  label: humanize(entry.status),
                  tone: 'neutral' as const,
                };
                return (
                  <ResourceList.Item
                    key={entry.id}
                    title={toolLabel(entry.tool_name)}
                    titleTooltip={entry.tool_name}
                    description={displayUser(entry)}
                    meta={<StatusTag tone={status.tone}>{status.label}</StatusTag>}
                  >
                    <p className="text-xs text-muted-foreground">{entry.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        labelFor(TRANSPORT_LABELS, entry.transport),
                        entry.action ? (entry.replayed ? 'Repeated action' : 'Action') : 'Read',
                        `${entry.duration_ms.toLocaleString()} ms`,
                      ].join(' · ')}
                    </p>
                    <p className="text-xs text-muted-foreground">{fullDate(entry.created_at)}</p>
                    {entry.error_code && (
                      <p className="text-xs text-destructive">{humanize(entry.error_code)}</p>
                    )}
                  </ResourceList.Item>
                );
              })}
            </ResourceList>
          }
        >
          <Table variant="secondary">
            <Table.ScrollContainer className="rounded-none border-0">
              <Table.Content aria-label="MCP activity" aria-busy={activityLoading}>
                <Table.Header>
                  <Table.Column isRowHeader className="px-4">
                    Tool
                  </Table.Column>
                  <Table.Column>User</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="hidden md:table-cell">Details</Table.Column>
                  <Table.Column className="px-4 text-right">Time</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      {activityLoading ? 'Loading MCP activity...' : 'No MCP activity found.'}
                    </div>
                  )}
                >
                  {activity.map((entry) => {
                    const status = STATUS_DISPLAY[entry.status] ?? {
                      label: humanize(entry.status),
                      tone: 'neutral' as const,
                    };
                    return (
                      <Table.Row key={entry.id} id={entry.id}>
                        <Table.Cell className="max-w-0 px-4 sm:w-[30%]">
                          <span className="block truncate font-medium" title={entry.tool_name}>
                            {toolLabel(entry.tool_name)}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="max-w-48">
                          <span
                            className="block truncate text-muted-foreground"
                            title={entry.email || undefined}
                          >
                            {displayUser(entry)}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap">
                          <StatusTag tone={status.tone}>{status.label}</StatusTag>
                          {entry.error_code ? (
                            <span
                              className="block text-xs text-muted-foreground"
                              title={entry.error_code}
                            >
                              {humanize(entry.error_code)}
                            </span>
                          ) : null}
                        </Table.Cell>
                        <Table.Cell className="hidden text-muted-foreground md:table-cell">
                          {[
                            labelFor(TRANSPORT_LABELS, entry.transport),
                            entry.action ? (entry.replayed ? 'Repeated action' : 'Action') : 'Read',
                            `${entry.duration_ms.toLocaleString()} ms`,
                          ].join(' · ')}
                        </Table.Cell>
                        <Table.Cell className="whitespace-nowrap px-4 text-right text-muted-foreground">
                          <span title={fullDate(entry.created_at)}>
                            {timeAgo(entry.created_at)}
                          </span>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Table.Responsive>
        <TablePager
          page={activityPage}
          pageSize={PAGE_SIZE}
          total={activityTotal}
          onPageChange={setActivityPage}
          noun="calls"
        />
      </Card>
    </div>
  );
}
