'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import {
  deleteNotificationChannel,
  listNotificationChannels,
  testNotificationChannel,
  updateNotificationChannel,
} from '@/lib/api/admin';
import type { NotificationChannel } from '@/lib/api/types/admin';
import { deferEffect } from '@/lib/defer-effect';
import {
  Card,
  Chip,
  ListBox,
  Pagination,
  SearchField,
  Select,
  Table,
} from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RowActionsMenu } from '../ui/row-actions-menu';

const PAGE_SIZE = 10;

export function NotificationsTab() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | NotificationChannel['type']>('all');
  const [page, setPage] = useState(1);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextChannels = await listNotificationChannels();
      setChannels(nextChannels);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load notification channels');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  async function handleDelete(channel: NotificationChannel) {
    const ok = await confirm({
      title: `Delete "${channel.name}"?`,
      message: 'The notification channel will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await deleteNotificationChannel(channel.id);
      setFeedback({ type: 'success', text: `Deleted ${channel.name}.` });
      await load();
    } catch (deleteError: unknown) {
      setFeedback({
        type: 'error',
        text: deleteError instanceof Error ? deleteError.message : 'Failed to delete channel',
      });
    }
  }

  async function handleToggleEnabled(channel: NotificationChannel) {
    const ok = await confirm(
      channel.enabled
        ? {
            title: `Disable "${channel.name}"?`,
            message: 'No notifications will be sent through this channel.',
            confirmLabel: 'Disable',
            variant: 'warning',
          }
        : {
            title: `Enable "${channel.name}"?`,
            message: 'Notifications will start being sent through this channel.',
            confirmLabel: 'Enable',
            variant: 'default',
          }
    );
    if (!ok) return;

    try {
      await updateNotificationChannel(channel.id, { enabled: !channel.enabled });
      setFeedback({
        type: 'success',
        text: `${!channel.enabled ? 'Enabled' : 'Disabled'} ${channel.name}.`,
      });
      await load();
    } catch (toggleError: unknown) {
      setFeedback({
        type: 'error',
        text: toggleError instanceof Error ? toggleError.message : 'Failed to update channel',
      });
    }
  }

  async function handleTest(channel: NotificationChannel) {
    try {
      await testNotificationChannel(channel.id, channel.events[0]);
      setFeedback({ type: 'success', text: `Sent test notification via ${channel.name}.` });
    } catch (testError: unknown) {
      setFeedback({
        type: 'error',
        text: testError instanceof Error ? testError.message : 'Failed to send test notification',
      });
    }
  }

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return channels.filter((channel) => {
      const matchesSearch =
        q.length === 0 ||
        channel.name.toLowerCase().includes(q) ||
        channel.type.toLowerCase().includes(q) ||
        channel.events.some((eventName) => eventName.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' && channel.enabled) ||
        (statusFilter === 'disabled' && !channel.enabled);

      const matchesType = typeFilter === 'all' || channel.type === typeFilter;

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [channels, searchQuery, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredChannels.length / PAGE_SIZE));
  const effectivePage = Math.min(page, totalPages);
  const pagedChannels = filteredChannels.slice(
    (effectivePage - 1) * PAGE_SIZE,
    effectivePage * PAGE_SIZE
  );

  const paginationItems = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items: Array<number | 'ellipsis'> = [1];
    if (effectivePage > 3) items.push('ellipsis');
    const start = Math.max(2, effectivePage - 1);
    const end = Math.min(totalPages - 1, effectivePage + 1);
    for (let i = start; i <= end; i += 1) items.push(i);
    if (effectivePage < totalPages - 2) items.push('ellipsis');
    items.push(totalPages);
    return items;
  }, [effectivePage, totalPages]);

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border border-danger/30 bg-danger/10">
          <Card.Content>
            <p className="text-sm text-danger">{error}</p>
          </Card.Content>
        </Card>
      )}

      {feedback && (
        <Card className={feedback.type === 'success' ? 'border border-success/30 bg-success/10' : 'border border-danger/30 bg-danger/10'}>
          <Card.Content>
            <p className={feedback.type === 'success' ? 'text-sm text-success' : 'text-sm text-danger'}>{feedback.text}</p>
          </Card.Content>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchField name="admin-notifications-search" variant="secondary" className="w-full sm:max-w-sm">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Filter channels by name, type, or event..."
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(String(value) as typeof typeFilter);
                setPage(1);
              }}
              variant="secondary"
              className="w-full sm:w-40"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all">All types</ListBox.Item>
                  <ListBox.Item id="discord">Discord</ListBox.Item>
                  <ListBox.Item id="slack">Slack</ListBox.Item>
                  <ListBox.Item id="teams">Teams</ListBox.Item>
                  <ListBox.Item id="email">Email</ListBox.Item>
                  <ListBox.Item id="telegram">Telegram</ListBox.Item>
                  <ListBox.Item id="webhook">Webhook</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(String(value) as typeof statusFilter);
                setPage(1);
              }}
              variant="secondary"
              className="w-full sm:w-36"
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all">All status</ListBox.Item>
                  <ListBox.Item id="enabled">Enabled</ListBox.Item>
                  <ListBox.Item id="disabled">Disabled</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Notification channels" className="min-w-[980px]">
              <Table.Header>
                <Table.Column isRowHeader>Name</Table.Column>
                <Table.Column>Type</Table.Column>
                <Table.Column>Events</Table.Column>
                <Table.Column>Scope</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading notification channels...' : 'No channels match your filters.'}
                  </div>
                )}
              >
                {pagedChannels.map((channel) => (
                  <Table.Row key={channel.id} id={channel.id} className="hover:bg-[var(--row-hover)]">
                    <Table.Cell className="font-medium">{channel.name}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft" className="capitalize">
                        {channel.type}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap gap-1">
                        {channel.events.map((eventName) => (
                          <Chip key={eventName} size="sm" variant="soft" className="font-mono text-xs">
                            {eventName}
                          </Chip>
                        ))}
                      </div>
                    </Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">
                      <div className="space-y-1">
                        <p>{channel.org_ids.length > 0 ? `${channel.org_ids.length} org filters` : 'All orgs'}</p>
                        <p>
                          {channel.image_patterns.length > 0
                            ? `${channel.image_patterns.length} image filters`
                            : 'All images'}
                        </p>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" color={channel.enabled ? 'success' : 'default'} variant="soft">
                        {channel.enabled ? 'Enabled' : 'Disabled'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for ${channel.name}`}
                          items={[
                            {
                              id: 'test',
                              label: 'Send test',
                              onAction: () => {
                                void handleTest(channel);
                              },
                            },
                            {
                              id: 'toggle',
                              label: channel.enabled ? 'Disable channel' : 'Enable channel',
                              onAction: () => {
                                void handleToggleEnabled(channel);
                              },
                            },
                            {
                              id: 'delete',
                              label: 'Delete channel',
                              variant: 'danger',
                              onAction: () => {
                                void handleDelete(channel);
                              },
                            },
                          ]}
                        />
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center px-4 py-3 gap-3">
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              Showing {filteredChannels.length === 0 ? 0 : (effectivePage - 1) * PAGE_SIZE + 1}-
              {Math.min(effectivePage * PAGE_SIZE, filteredChannels.length)} of {filteredChannels.length}
            </span>
            <Pagination size="sm" className="justify-self-center">
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={effectivePage === 1}
                    onPress={() => setPage((previous) => Math.max(1, previous - 1))}
                  >
                    <Pagination.PreviousIcon />
                    <span>Previous</span>
                  </Pagination.Previous>
                </Pagination.Item>
                {paginationItems.map((item, index) =>
                  item === 'ellipsis' ? (
                    <Pagination.Item key={`notifications-ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={`notifications-page-${item}`}>
                      <Pagination.Link isActive={item === effectivePage} onPress={() => setPage(item)}>
                        {item}
                      </Pagination.Link>
                    </Pagination.Item>
                  )
                )}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={effectivePage === totalPages}
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
      {confirmDialog}
    </div>
  );
}
