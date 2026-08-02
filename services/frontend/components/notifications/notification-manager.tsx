'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { StatusAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName, heroTextAreaClassName } from '@/components/ui/form-styles';
import {
  conditionFieldLabels,
  conditionFieldOptions,
  conditionValueIsEmpty,
  eventTypeOptions,
  formatConditionValue,
  getConditionDefinition,
  getDefaultConditionValue,
  getDefaultOperator,
  getOperatorOptions,
  normalizeConditionValue,
  operatorLabels,
  parseConditionValue,
  type ConditionValue,
} from '@/components/notifications/condition-catalog';
import { ConditionValueControl } from '@/components/notifications/condition-value-control';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import type {
  NotificationChannel,
  NotificationConditionGroup,
  NotificationConditionOption,
  NotificationConditionPredicate,
  NotificationDelivery,
  NotificationQueueJob,
  NotificationRule,
} from '@/lib/api';
import {
  createScopedNotificationChannel,
  createScopedNotificationRule,
  deleteScopedNotificationChannel,
  deleteScopedNotificationRule,
  listScopedNotificationChannels,
  listScopedNotificationConditionOptions,
  listScopedNotificationDeliveries,
  listScopedNotificationQueue,
  listScopedNotificationRules,
  retryScopedNotificationQueueJob,
  testScopedNotificationChannel,
  updateScopedNotificationChannel,
  updateScopedNotificationRule,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  Button,
  Card,
  Chip,
  ListBox,
  Modal,
  Select,
  Spinner,
  Switch,
  Table,
  TextArea,
  useOverlayState,
} from '@heroui/react';
import {
  Add01Icon,
  Delete01Icon,
  Notification01Icon,
  Refresh01Icon,
  Setting07Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const channelTypeOptions: Array<{ value: NotificationChannel['type']; label: string }> = [
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'teams', label: 'Teams' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'email', label: 'Email' },
  { value: 'telegram', label: 'Telegram' },
];

const DELIVERY_PAGE_SIZE = 20;

const deliveryModeLabels: Record<'immediate' | 'digest', string> = {
  immediate: 'Immediate',
  digest: 'Summary',
};

const groupOpLabels: Record<'all' | 'any', string> = {
  all: 'Match all conditions',
  any: 'Match any condition',
};

const noopConditionLookup = () => {};

type NotificationManagerProps = {
  basePath: string;
  heading: string;
  description: string;
  canManage?: boolean;
};

type ChannelFormState = {
  id?: string;
  name: string;
  type: NotificationChannel['type'];
  enabled: boolean;
  webhook_url: string;
  headers: string;
  smtp_host: string;
  smtp_port: string;
  smtp_username: string;
  smtp_password: string;
  smtp_from: string;
  to_addresses: string;
  smtp_tls: boolean;
  telegram_bot_token: string;
  telegram_chat_id: string;
};

type RuleFormState = {
  id?: string;
  name: string;
  enabled: boolean;
  channel_ids: string[];
  event_types: string[];
  delivery_mode: 'immediate' | 'digest';
  digest_window_minutes: string;
  op: 'all' | 'any';
  conditions: Array<{ id: string; field: string; operator: string; value: ConditionValue }>;
};

function emptyChannelForm(): ChannelFormState {
  return {
    name: '',
    type: 'webhook',
    enabled: true,
    webhook_url: '',
    headers: '',
    smtp_host: '',
    smtp_port: '587',
    smtp_username: '',
    smtp_password: '',
    smtp_from: '',
    to_addresses: '',
    smtp_tls: true,
    telegram_bot_token: '',
    telegram_chat_id: '',
  };
}

function emptyRuleForm(): RuleFormState {
  return {
    name: '',
    enabled: true,
    channel_ids: [],
    event_types: ['scan_complete'],
    delivery_mode: 'immediate',
    digest_window_minutes: '15',
    op: 'all',
    conditions: [createCondition('highest_cvss')],
  };
}

function createCondition(field = 'highest_cvss') {
  return {
    id: crypto.randomUUID(),
    field,
    operator: getDefaultOperator(field),
    value: getDefaultConditionValue(field),
  };
}

function decodeRuleConditions(group?: NotificationConditionGroup | null) {
  if (!group || !Array.isArray(group.conditions) || group.conditions.length === 0) {
    return emptyRuleForm().conditions;
  }
  return group.conditions.map((condition) => ({
    id: crypto.randomUUID(),
    field: condition.field,
    operator: condition.operator,
    value: Array.isArray(condition.value) ? condition.value.map(String) : String(condition.value),
  }));
}

function parseHeaders(rawHeaders: string) {
  const headers: Record<string, string> = {};
  for (const line of rawHeaders.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [key, ...rest] = trimmed.split(':');
    if (!key || rest.length === 0) continue;
    headers[key.trim()] = rest.join(':').trim();
  }
  return headers;
}

function summarizeRule(rule: NotificationRule, channels: NotificationChannel[]) {
  const channelNames = rule.channel_ids
    .flatMap((channelId) => {
      const name = channels.find((channel) => channel.id === channelId)?.name;
      return name ? [name] : [];
    })
    .join(', ');
  const conditions =
    rule.conditions?.conditions
      ?.map(
        (condition) =>
          `${conditionFieldLabels[condition.field as keyof typeof conditionFieldLabels] ?? condition.field} ${operatorLabels[condition.operator] ?? condition.operator} ${formatConditionValue(condition.value)}`
      )
      .join(' • ') || 'No conditions';
  return `${rule.event_types.join(', ')} • ${channelNames || 'No channels'} • ${conditions}`;
}

export function NotificationManager({
  basePath,
  heading,
  description,
  canManage = true,
}: NotificationManagerProps) {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [deliveries, setDeliveries] = useState<NotificationDelivery[]>([]);
  const [deliveriesHasMore, setDeliveriesHasMore] = useState(false);
  const [deliveriesLoadingMore, setDeliveriesLoadingMore] = useState(false);
  const [queueJobs, setQueueJobs] = useState<NotificationQueueJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [channelForm, setChannelForm] = useState<ChannelFormState>(() => emptyChannelForm());
  const [ruleForm, setRuleForm] = useState<RuleFormState>(() => emptyRuleForm());
  const [conditionOptions, setConditionOptions] = useState<
    Record<string, NotificationConditionOption[]>
  >({});
  const [conditionOptionLoading, setConditionOptionLoading] = useState<Record<string, boolean>>({});
  const conditionLookupRequest = useRef<Record<string, number>>({});
  const deliveryOffsetRef = useRef(0);
  const deliveriesLoadingRef = useRef(false);

  const channelModal = useOverlayState();
  const ruleModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextChannels, nextRules, nextDeliveries, nextQueue] = await Promise.all([
        listScopedNotificationChannels(basePath),
        listScopedNotificationRules(basePath),
        listScopedNotificationDeliveries(basePath, DELIVERY_PAGE_SIZE),
        listScopedNotificationQueue(basePath, 20),
      ]);
      setChannels(nextChannels);
      setRules(nextRules);
      setDeliveries(nextDeliveries.data);
      setDeliveriesHasMore(nextDeliveries.has_more);
      deliveryOffsetRef.current = nextDeliveries.next_offset;
      setQueueJobs(nextQueue);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => deferEffect(load), [load]);

  const loadMoreDeliveries = useCallback(async () => {
    if (!deliveriesHasMore || deliveriesLoadingRef.current) return;

    deliveriesLoadingRef.current = true;
    setDeliveriesLoadingMore(true);
    try {
      const nextPage = await listScopedNotificationDeliveries(
        basePath,
        DELIVERY_PAGE_SIZE,
        deliveryOffsetRef.current
      );
      setDeliveries((current) => {
        const existingIDs = new Set(current.map((delivery) => delivery.id));
        return [...current, ...nextPage.data.filter((delivery) => !existingIDs.has(delivery.id))];
      });
      setDeliveriesHasMore(nextPage.has_more);
      deliveryOffsetRef.current = nextPage.next_offset;
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load more deliveries');
    } finally {
      setDeliveriesLoadingMore(false);
      requestAnimationFrame(() => {
        deliveriesLoadingRef.current = false;
      });
    }
  }, [basePath, deliveriesHasMore]);

  const loadConditionOptions = useCallback(
    async (field: string, query = '') => {
      const definition = getConditionDefinition(field);
      if (definition.kind !== 'dynamic' && definition.kind !== 'pattern') return;

      const requestID = (conditionLookupRequest.current[field] ?? 0) + 1;
      conditionLookupRequest.current[field] = requestID;
      setConditionOptionLoading((current) => ({ ...current, [field]: true }));
      try {
        const options = await listScopedNotificationConditionOptions(basePath, field, query);
        if (conditionLookupRequest.current[field] === requestID) {
          setConditionOptions((current) => ({ ...current, [field]: options }));
        }
      } catch {
        // Suggestions are an enhancement; a saved legacy value or a custom
        // pattern must remain editable when the lookup is unavailable.
      } finally {
        if (conditionLookupRequest.current[field] === requestID) {
          setConditionOptionLoading((current) => ({ ...current, [field]: false }));
        }
      }
    },
    [basePath]
  );

  const channelNames = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.id, channel.name])),
    [channels]
  );
  const eventNames = useMemo(
    () => Object.fromEntries(eventTypeOptions.map((option) => [option.value, option.label])),
    []
  );
  const operatorNames = useMemo(() => Object.fromEntries(Object.entries(operatorLabels)), []);
  const conditionFieldNames = useMemo(
    () =>
      Object.fromEntries(
        conditionFieldOptions.map((field) => [field, conditionFieldLabels[field]])
      ),
    []
  );
  const conditionLookupHandlers = useMemo(
    () =>
      Object.fromEntries(
        conditionFieldOptions.map((field) => [
          field,
          (query: string) => {
            void loadConditionOptions(field, query);
          },
        ])
      ) as Record<string, (query: string) => void>,
    [loadConditionOptions]
  );

  function openCreateChannel() {
    if (!canManage) return;
    setChannelForm(emptyChannelForm());
    channelModal.open();
  }

  function openEditChannel(channel: NotificationChannel) {
    if (!canManage) return;
    setChannelForm({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      enabled: channel.enabled,
      webhook_url: channel.config.webhook_url ?? '',
      headers: Object.entries(channel.config.headers ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
      smtp_host: channel.config.smtp_host ?? '',
      smtp_port: String(channel.config.smtp_port ?? 587),
      smtp_username: channel.config.smtp_username ?? '',
      smtp_password: '',
      smtp_from: channel.config.smtp_from ?? '',
      to_addresses: (channel.config.to_addresses ?? []).join(', '),
      smtp_tls: Boolean(channel.config.smtp_tls),
      telegram_bot_token: '',
      telegram_chat_id: channel.config.telegram_chat_id ?? '',
    });
    channelModal.open();
  }

  function openCreateRule() {
    if (!canManage) return;
    setRuleForm(emptyRuleForm());
    ruleModal.open();
  }

  function openEditRule(rule: NotificationRule) {
    if (!canManage) return;
    setRuleForm({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      channel_ids: rule.channel_ids,
      event_types: rule.event_types,
      delivery_mode: rule.delivery_mode,
      digest_window_minutes: String(rule.digest_window_minutes || 15),
      op: rule.conditions?.op ?? 'all',
      conditions: decodeRuleConditions(rule.conditions),
    });
    ruleModal.open();
  }

  async function handleSaveChannel(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setFeedback(null);

    const payload: Partial<NotificationChannel> = {
      name: channelForm.name.trim(),
      type: channelForm.type,
      enabled: channelForm.enabled,
      config: {
        webhook_url: channelForm.webhook_url.trim() || undefined,
        headers: parseHeaders(channelForm.headers),
        smtp_host: channelForm.smtp_host.trim() || undefined,
        smtp_port: Number(channelForm.smtp_port) || undefined,
        smtp_username: channelForm.smtp_username.trim() || undefined,
        smtp_password: channelForm.smtp_password || undefined,
        smtp_from: channelForm.smtp_from.trim() || undefined,
        to_addresses: channelForm.to_addresses
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        smtp_tls: channelForm.smtp_tls,
        telegram_bot_token: channelForm.telegram_bot_token || undefined,
        telegram_chat_id: channelForm.telegram_chat_id.trim() || undefined,
      },
    };

    try {
      if (channelForm.id) {
        await updateScopedNotificationChannel(basePath, channelForm.id, payload);
        setFeedback({ type: 'success', text: 'Notification channel updated.' });
      } else {
        await createScopedNotificationChannel(basePath, payload);
        setFeedback({ type: 'success', text: 'Notification channel created.' });
      }
      channelModal.close();
      await load();
    } catch (saveError: unknown) {
      setFeedback({
        type: 'error',
        text:
          saveError instanceof Error ? saveError.message : 'Failed to save notification channel',
      });
    }
  }

  async function handleSaveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setFeedback(null);

    const payload: Partial<NotificationRule> = {
      name: ruleForm.name.trim(),
      enabled: ruleForm.enabled,
      channel_ids: ruleForm.channel_ids,
      event_types: ruleForm.event_types,
      delivery_mode: ruleForm.delivery_mode,
      digest_window_minutes:
        ruleForm.delivery_mode === 'digest' ? Number(ruleForm.digest_window_minutes) || 15 : 0,
      conditions: {
        op: ruleForm.op,
        conditions: ruleForm.conditions.flatMap<NotificationConditionPredicate>((condition) => {
          if (
            !condition.field.trim() ||
            !condition.operator.trim() ||
            conditionValueIsEmpty(condition.value)
          ) {
            return [];
          }
          return [
            {
              field: condition.field.trim(),
              operator: condition.operator.trim(),
              value: parseConditionValue(condition.field, condition.operator, condition.value),
            },
          ];
        }),
      },
    };

    try {
      if (ruleForm.id) {
        await updateScopedNotificationRule(basePath, ruleForm.id, payload);
        setFeedback({ type: 'success', text: 'Notification rule updated.' });
      } else {
        await createScopedNotificationRule(basePath, payload);
        setFeedback({ type: 'success', text: 'Notification rule created.' });
      }
      ruleModal.close();
      await load();
    } catch (saveError: unknown) {
      setFeedback({
        type: 'error',
        text: saveError instanceof Error ? saveError.message : 'Failed to save notification rule',
      });
    }
  }

  async function handleDeleteChannel(channel: NotificationChannel) {
    if (!canManage) return;
    const ok = await confirm({
      title: `Delete "${channel.name}"?`,
      message:
        'Associated rules will need to be updated manually if they still reference this channel.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteScopedNotificationChannel(basePath, channel.id);
      setFeedback({ type: 'success', text: `Deleted ${channel.name}.` });
      await load();
    } catch (deleteError: unknown) {
      setFeedback({
        type: 'error',
        text: deleteError instanceof Error ? deleteError.message : 'Failed to delete channel',
      });
    }
  }

  async function handleDeleteRule(rule: NotificationRule) {
    if (!canManage) return;
    const ok = await confirm({
      title: `Delete "${rule.name}"?`,
      message: 'Future matching events will stop creating deliveries for this rule.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteScopedNotificationRule(basePath, rule.id);
      setFeedback({ type: 'success', text: `Deleted ${rule.name}.` });
      await load();
    } catch (deleteError: unknown) {
      setFeedback({
        type: 'error',
        text: deleteError instanceof Error ? deleteError.message : 'Failed to delete rule',
      });
    }
  }

  async function handleTestChannel(channel: NotificationChannel) {
    if (!canManage) return;
    try {
      await testScopedNotificationChannel(basePath, channel.id, 'scan_complete');
      setFeedback({ type: 'success', text: `Sent test notification via ${channel.name}.` });
      await load();
    } catch (testError: unknown) {
      setFeedback({
        type: 'error',
        text: testError instanceof Error ? testError.message : 'Failed to send test notification',
      });
    }
  }

  async function handleRetryJob(job: NotificationQueueJob) {
    if (!canManage) return;
    try {
      await retryScopedNotificationQueueJob(basePath, job.id);
      setFeedback({ type: 'success', text: `Re-queued ${job.rule_name ?? 'notification job'}.` });
      await load();
    } catch (retryError: unknown) {
      setFeedback({
        type: 'error',
        text: retryError instanceof Error ? retryError.message : 'Failed to retry notification job',
      });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <Card.Header>
          <Card.Title>{heading}</Card.Title>
          <Card.Description>{description}</Card.Description>
        </Card.Header>
      </Card>

      {error ? (
        <StatusAlert status="danger" title="Notifications failed to load" description={error} />
      ) : null}

      {feedback ? (
        <StatusAlert
          status={feedback.type === 'success' ? 'success' : 'danger'}
          title={
            feedback.type === 'success' ? 'Notification updated' : 'Notification action failed'
          }
          description={feedback.text}
        />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Channels</h2>
              <p className="text-sm text-zinc-500">Delivery credentials and destination toggles.</p>
            </div>
            <Button onPress={openCreateChannel} isDisabled={!canManage}>
              <Add01Icon size={15} />
              Add channel
            </Button>
          </div>

          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Notification channels">
                <Table.Header>
                  <Table.Column isRowHeader>Name</Table.Column>
                  <Table.Column>Type</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="text-right">Actions</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="py-8 text-center text-sm text-zinc-500">
                      {loading ? 'Loading channels...' : 'No notification channels configured.'}
                    </div>
                  )}
                >
                  {channels.map((channel) => (
                    <Table.Row key={channel.id} id={channel.id}>
                      <Table.Cell>
                        <div>
                          <p className="font-medium">{channel.name}</p>
                          <p className="text-xs text-zinc-500">{channel.type}</p>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <Chip size="sm" variant="soft" className="capitalize">
                          {channel.type}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        <Chip
                          size="sm"
                          color={channel.enabled ? 'success' : 'danger'}
                          variant="soft"
                        >
                          {channel.enabled ? 'Enabled' : 'Disabled'}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex justify-end">
                          {canManage ? (
                            <RowActionsMenu
                              label={`Open actions for ${channel.name}`}
                              items={[
                                {
                                  id: 'edit-channel',
                                  label: 'Edit channel',
                                  icon: <Setting07Icon size={14} />,
                                  onAction: () => openEditChannel(channel),
                                },
                                {
                                  id: 'test-channel',
                                  label: 'Send test',
                                  icon: <Notification01Icon size={14} />,
                                  onAction: () => {
                                    void handleTestChannel(channel);
                                  },
                                },
                                {
                                  id: 'delete-channel',
                                  label: 'Delete channel',
                                  icon: <Delete01Icon size={14} />,
                                  variant: 'danger',
                                  onAction: () => {
                                    void handleDeleteChannel(channel);
                                  },
                                },
                              ]}
                            />
                          ) : (
                            <span className="text-xs text-muted">Read only</span>
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Rules</h2>
              <p className="text-sm text-zinc-500">
                Match scan events and route them through selected channels.
              </p>
            </div>
            <Button onPress={openCreateRule} isDisabled={!canManage || channels.length === 0}>
              <Add01Icon size={15} />
              Add rule
            </Button>
          </div>

          <div className="space-y-3">
            {loading ? (
              <p className="text-sm text-zinc-500">Loading rules...</p>
            ) : rules.length === 0 ? (
              <p className="text-sm text-zinc-500">No rules configured yet.</p>
            ) : (
              rules.map((rule) => (
                <Card key={rule.id} variant="secondary" className="space-y-3">
                  <Card.Content className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{rule.name}</p>
                          <Chip
                            size="sm"
                            color={rule.enabled ? 'success' : 'danger'}
                            variant="soft"
                          >
                            {rule.enabled ? 'Enabled' : 'Disabled'}
                          </Chip>
                          <Chip size="sm" variant="soft">
                            {rule.delivery_mode === 'digest'
                              ? `Summary ${rule.digest_window_minutes}m`
                              : 'Immediate'}
                          </Chip>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {summarizeRule(rule, channels)}
                        </p>
                      </div>
                      <div className="flex">
                        {canManage ? (
                          <RowActionsMenu
                            label={`Open actions for ${rule.name}`}
                            items={[
                              {
                                id: 'edit-rule',
                                label: 'Edit rule',
                                icon: <Setting07Icon size={14} />,
                                onAction: () => openEditRule(rule),
                              },
                              {
                                id: 'delete-rule',
                                label: 'Delete rule',
                                icon: <Delete01Icon size={14} />,
                                variant: 'danger',
                                onAction: () => {
                                  void handleDeleteRule(rule);
                                },
                              },
                            ]}
                          />
                        ) : null}
                      </div>
                    </div>
                  </Card.Content>
                </Card>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Queue</h2>
            <p className="text-sm text-zinc-500">
              Recent notification jobs, retries, and dead letters.
            </p>
          </div>
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Notification queue jobs">
                <Table.Header>
                  <Table.Column isRowHeader>Rule</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column>Attempts</Table.Column>
                  <Table.Column className="text-right">Action</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="py-8 text-center text-sm text-zinc-500">
                      {loading ? 'Loading queue...' : 'No queued notifications yet.'}
                    </div>
                  )}
                >
                  {queueJobs.map((job) => (
                    <Table.Row key={job.id} id={job.id}>
                      <Table.Cell>
                        <div>
                          <p className="font-medium">{job.rule_name ?? 'Rule'}</p>
                          <p className="text-xs text-zinc-500">
                            {job.channel_name ?? channelNames[job.channel_id] ?? job.channel_id}
                          </p>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <Chip
                          size="sm"
                          color={
                            job.status === 'delivered'
                              ? 'success'
                              : job.status === 'dead_letter'
                                ? 'danger'
                                : 'default'
                          }
                          variant="soft"
                        >
                          {job.status}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        {job.attempt_count}/{job.max_attempts}
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex justify-end">
                          {canManage &&
                          (job.status === 'dead_letter' || job.status === 'failed') ? (
                            <RowActionsMenu
                              label={`Open actions for ${job.rule_name ?? 'notification job'}`}
                              items={[
                                {
                                  id: 'retry-job',
                                  label: 'Retry job',
                                  icon: <Refresh01Icon size={14} />,
                                  onAction: () => {
                                    void handleRetryJob(job);
                                  },
                                },
                              ]}
                            />
                          ) : (
                            <span className="text-xs text-zinc-500">
                              {job.last_error ? job.last_error : 'Ready'}
                            </span>
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Deliveries</h2>
            <p className="text-sm text-zinc-500">
              Latest delivery attempts across all channels in this scope.
            </p>
          </div>
          <Table variant="secondary">
            <Table.ScrollContainer className="max-h-[28rem] overflow-y-auto">
              <Table.Content aria-label="Notification deliveries">
                <Table.Header className="sticky top-0 z-10 bg-surface-secondary">
                  <Table.Column isRowHeader>Channel</Table.Column>
                  <Table.Column>Event</Table.Column>
                  <Table.Column>Status</Table.Column>
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="py-8 text-center text-sm text-zinc-500">
                      {loading ? 'Loading deliveries...' : 'No delivery history yet.'}
                    </div>
                  )}
                >
                  {deliveries.map((delivery) => (
                    <Table.Row key={delivery.id} id={delivery.id}>
                      <Table.Cell>
                        <div>
                          <p className="font-medium">
                            {delivery.channel_name ??
                              channelNames[delivery.channel_id] ??
                              delivery.channel_id}
                          </p>
                          {delivery.rule_name ? (
                            <p className="text-xs text-zinc-500">{delivery.rule_name}</p>
                          ) : null}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="font-mono text-xs">{delivery.event}</Table.Cell>
                      <Table.Cell>
                        <Chip
                          size="sm"
                          color={
                            delivery.status === 'delivered'
                              ? 'success'
                              : delivery.status === 'dead_letter'
                                ? 'danger'
                                : 'default'
                          }
                          variant="soft"
                        >
                          {delivery.status}
                        </Chip>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                  {deliveriesHasMore ? (
                    <Table.LoadMore
                      isLoading={deliveriesLoadingMore}
                      scrollOffset={0}
                      onLoadMore={() => void loadMoreDeliveries()}
                    >
                      <Table.LoadMoreContent>
                        <Spinner size="sm" />
                        <span className="text-sm">Loading more deliveries…</span>
                      </Table.LoadMoreContent>
                    </Table.LoadMore>
                  ) : null}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      </div>

      <Modal state={channelModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {channelForm.id ? 'Edit Notification Channel' : 'Add Notification Channel'}
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form
                  id="notification-channel-form"
                  onSubmit={handleSaveChannel}
                  className="space-y-4"
                >
                  <FormField
                    label="Channel name"
                    value={channelForm.name}
                    onChange={(event) =>
                      setChannelForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Production Slack Alerts"
                    required
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <Select
                      value={channelForm.type}
                      onChange={(value) =>
                        setChannelForm((current) => ({
                          ...current,
                          type: String(value) as NotificationChannel['type'],
                        }))
                      }
                      variant="secondary"
                    >
                      <Select.Trigger className={heroSelectTriggerClassName}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {channelTypeOptions.map((option) => (
                            <ListBox.Item key={option.value} id={option.value}>
                              {option.label}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <div className="flex h-full items-center">
                      <Switch
                        isSelected={channelForm.enabled}
                        onChange={(enabled) =>
                          setChannelForm((current) => ({ ...current, enabled }))
                        }
                      >
                        <Switch.Content>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                          Enabled
                        </Switch.Content>
                      </Switch>
                    </div>
                  </div>

                  {channelForm.type === 'webhook' ||
                  channelForm.type === 'discord' ||
                  channelForm.type === 'slack' ||
                  channelForm.type === 'teams' ? (
                    <>
                      <FormField
                        label="Webhook URL"
                        value={channelForm.webhook_url}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            webhook_url: event.target.value,
                          }))
                        }
                        placeholder="https://hooks.slack.com/services/..."
                        required
                      />
                      <TextArea
                        aria-label="Headers"
                        className={heroTextAreaClassName}
                        rows={4}
                        variant="secondary"
                        value={channelForm.headers}
                        onChange={(event) =>
                          setChannelForm((current) => ({ ...current, headers: event.target.value }))
                        }
                        placeholder={'Authorization: Bearer secret\nX-Env: production'}
                      />
                    </>
                  ) : null}

                  {channelForm.type === 'email' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        label="SMTP host"
                        value={channelForm.smtp_host}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            smtp_host: event.target.value,
                          }))
                        }
                        placeholder="smtp.postmarkapp.com"
                        required
                      />
                      <FormField
                        label="SMTP port"
                        value={channelForm.smtp_port}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            smtp_port: event.target.value,
                          }))
                        }
                        placeholder="587"
                        required
                      />
                      <FormField
                        label="SMTP username"
                        value={channelForm.smtp_username}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            smtp_username: event.target.value,
                          }))
                        }
                        placeholder="postmark-api-token"
                      />
                      <FormField
                        label="SMTP password"
                        type="password"
                        description={
                          channelForm.id ? 'Leave blank to keep the existing password.' : undefined
                        }
                        value={channelForm.smtp_password}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            smtp_password: event.target.value,
                          }))
                        }
                        placeholder="smtp-password"
                      />
                      <FormField
                        label="From address"
                        value={channelForm.smtp_from}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            smtp_from: event.target.value,
                          }))
                        }
                        placeholder="alerts@justscan.local"
                        required
                      />
                      <div className="flex h-full items-center">
                        <Switch
                          isSelected={channelForm.smtp_tls}
                          onChange={(smtp_tls) =>
                            setChannelForm((current) => ({ ...current, smtp_tls }))
                          }
                        >
                          <Switch.Content>
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                            Use TLS
                          </Switch.Content>
                        </Switch>
                      </div>
                      <div className="md:col-span-2">
                        <FormField
                          label="Recipients"
                          description="Comma-separated email addresses."
                          value={channelForm.to_addresses}
                          onChange={(event) =>
                            setChannelForm((current) => ({
                              ...current,
                              to_addresses: event.target.value,
                            }))
                          }
                          placeholder="secops@acme.io, platform@acme.io"
                          required
                        />
                      </div>
                    </div>
                  ) : null}

                  {channelForm.type === 'telegram' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        label="Bot token"
                        type="password"
                        description={
                          channelForm.id ? 'Leave blank to keep the existing bot token.' : undefined
                        }
                        value={channelForm.telegram_bot_token}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            telegram_bot_token: event.target.value,
                          }))
                        }
                        placeholder="123456789:AA..."
                        required={!channelForm.id}
                      />
                      <FormField
                        label="Chat ID"
                        value={channelForm.telegram_chat_id}
                        onChange={(event) =>
                          setChannelForm((current) => ({
                            ...current,
                            telegram_chat_id: event.target.value,
                          }))
                        }
                        placeholder="-1001234567890"
                        required
                      />
                    </div>
                  ) : null}
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={channelModal.close}>
                  Cancel
                </Button>
                <Button type="submit" form="notification-channel-form">
                  Save Channel
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={ruleModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="cover" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {ruleForm.id ? 'Edit Notification Rule' : 'Add Notification Rule'}
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <form id="notification-rule-form" onSubmit={handleSaveRule} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      label="Rule name"
                      value={ruleForm.name}
                      onChange={(event) =>
                        setRuleForm((current) => ({ ...current, name: event.target.value }))
                      }
                      placeholder="Critical Production Findings"
                      required
                    />
                    <div className="flex h-full items-start pt-7">
                      <Switch
                        isSelected={ruleForm.enabled}
                        onChange={(enabled) => setRuleForm((current) => ({ ...current, enabled }))}
                      >
                        <Switch.Content>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                          Enabled
                        </Switch.Content>
                      </Switch>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <Select
                      selectionMode="multiple"
                      value={ruleForm.channel_ids}
                      onChange={(value) =>
                        setRuleForm((current) => ({
                          ...current,
                          channel_ids: Array.isArray(value)
                            ? value.map(String)
                            : value == null
                              ? []
                              : [String(value)],
                        }))
                      }
                      variant="secondary"
                    >
                      <Select.Trigger className={heroSelectTriggerClassName}>
                        <span
                          className={
                            ruleForm.channel_ids.length > 0 ? 'truncate' : 'truncate text-zinc-500'
                          }
                        >
                          {ruleForm.channel_ids.length > 0
                            ? ruleForm.channel_ids
                                .map((channelId) => channelNames[channelId] ?? channelId)
                                .join(', ')
                            : 'Select channels'}
                        </span>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox selectionMode="multiple">
                          {channels.map((channel) => (
                            <ListBox.Item key={channel.id} id={channel.id} textValue={channel.name}>
                              {channel.name}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>

                    <Select
                      selectionMode="multiple"
                      value={ruleForm.event_types}
                      onChange={(value) =>
                        setRuleForm((current) => ({
                          ...current,
                          event_types: Array.isArray(value)
                            ? value.map(String)
                            : value == null
                              ? []
                              : [String(value)],
                        }))
                      }
                      variant="secondary"
                    >
                      <Select.Trigger className={heroSelectTriggerClassName}>
                        <span
                          className={
                            ruleForm.event_types.length > 0 ? 'truncate' : 'truncate text-zinc-500'
                          }
                        >
                          {ruleForm.event_types.length > 0
                            ? ruleForm.event_types
                                .map((eventType) => eventNames[eventType] ?? eventType)
                                .join(', ')
                            : 'Select events'}
                        </span>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox selectionMode="multiple">
                          {eventTypeOptions.map((option) => (
                            <ListBox.Item
                              key={option.value}
                              id={option.value}
                              textValue={option.label}
                            >
                              {option.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>

                    <Select
                      value={ruleForm.delivery_mode}
                      onChange={(value) =>
                        setRuleForm((current) => ({
                          ...current,
                          delivery_mode: String(value) as 'immediate' | 'digest',
                        }))
                      }
                      variant="secondary"
                    >
                      <Select.Trigger className={heroSelectTriggerClassName}>
                        <span className="truncate">
                          {deliveryModeLabels[ruleForm.delivery_mode]}
                        </span>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="immediate" textValue="Immediate">
                            Immediate
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                          <ListBox.Item id="digest" textValue="Summary">
                            Summary
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  {ruleForm.delivery_mode === 'digest' ? (
                    <FormField
                      label="Summary window (minutes)"
                      value={ruleForm.digest_window_minutes}
                      onChange={(event) =>
                        setRuleForm((current) => ({
                          ...current,
                          digest_window_minutes: event.target.value,
                        }))
                      }
                      placeholder="15"
                      required
                    />
                  ) : null}

                  <Select
                    value={ruleForm.op}
                    onChange={(value) =>
                      setRuleForm((current) => ({ ...current, op: String(value) as 'all' | 'any' }))
                    }
                    variant="secondary"
                  >
                    <Select.Trigger className={heroSelectTriggerClassName}>
                      <span className="truncate">{groupOpLabels[ruleForm.op]}</span>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="all" textValue="Match all conditions">
                          Match all conditions
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="any" textValue="Match any condition">
                          Match any condition
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-medium">Conditions</p>
                      <p className="text-xs text-muted">
                        Choose known values from guided lists. Resource fields search values visible
                        in this scope, while pattern operators can accept a custom value.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {ruleForm.conditions.map((condition, index) => (
                      <Card key={condition.id} variant="secondary">
                        <Card.Content className="grid gap-3 lg:grid-cols-[1.1fr_1fr_minmax(14rem,1.5fr)_auto]">
                          <Select
                            value={condition.field}
                            onChange={(value) =>
                              setRuleForm((current) => ({
                                ...current,
                                conditions: current.conditions.map((item, itemIndex) => {
                                  if (itemIndex !== index) return item;
                                  const nextField = String(value);
                                  const nextOperator = getDefaultOperator(nextField);
                                  return {
                                    ...item,
                                    field: nextField,
                                    operator: nextOperator,
                                    value: normalizeConditionValue(
                                      nextOperator,
                                      getDefaultConditionValue(nextField)
                                    ),
                                  };
                                }),
                              }))
                            }
                            variant="primary"
                          >
                            <Select.Trigger className={heroSelectTriggerClassName}>
                              <span className="truncate">
                                {(conditionFieldNames[condition.field] ?? condition.field) ||
                                  'Select field'}
                              </span>
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {conditionFieldOptions.map((field) => (
                                  <ListBox.Item
                                    key={field}
                                    id={field}
                                    textValue={conditionFieldLabels[field]}
                                  >
                                    {conditionFieldLabels[field]}
                                    <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>

                          <Select
                            value={condition.operator}
                            onChange={(value) =>
                              setRuleForm((current) => ({
                                ...current,
                                conditions: current.conditions.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        operator: String(value),
                                        value: normalizeConditionValue(String(value), item.value),
                                      }
                                    : item
                                ),
                              }))
                            }
                            variant="primary"
                          >
                            <Select.Trigger className={heroSelectTriggerClassName}>
                              <span className="truncate">
                                {(operatorNames[condition.operator] ?? condition.operator) ||
                                  'Select operator'}
                              </span>
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {getOperatorOptions(condition.field, condition.operator).map(
                                  (operator) => (
                                    <ListBox.Item
                                      key={operator}
                                      id={operator}
                                      textValue={operatorLabels[operator]}
                                    >
                                      {operatorLabels[operator]}
                                      <ListBox.ItemIndicator />
                                    </ListBox.Item>
                                  )
                                )}
                              </ListBox>
                            </Select.Popover>
                          </Select>

                          <ConditionValueControl
                            key={`${condition.id}-${condition.field}`}
                            field={condition.field}
                            operator={condition.operator}
                            value={condition.value}
                            options={conditionOptions[condition.field] ?? []}
                            isLoading={conditionOptionLoading[condition.field] ?? false}
                            onLookup={
                              conditionLookupHandlers[condition.field] ?? noopConditionLookup
                            }
                            onChange={(value) =>
                              setRuleForm((current) => ({
                                ...current,
                                conditions: current.conditions.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, value } : item
                                ),
                              }))
                            }
                          />

                          <div className="flex items-center justify-end">
                            <Button
                              variant="danger-soft"
                              size="sm"
                              onPress={() =>
                                setRuleForm((current) => ({
                                  ...current,
                                  conditions: current.conditions.filter(
                                    (item) => item.id !== condition.id
                                  ),
                                }))
                              }
                              isDisabled={ruleForm.conditions.length === 1}
                            >
                              <Delete01Icon size={14} />
                            </Button>
                          </div>
                        </Card.Content>
                      </Card>
                    ))}

                    <Button
                      variant="secondary"
                      onPress={() =>
                        setRuleForm((current) => ({
                          ...current,
                          conditions: [...current.conditions, createCondition()],
                        }))
                      }
                    >
                      <Add01Icon size={14} />
                      Add condition
                    </Button>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={ruleModal.close}>
                  Cancel
                </Button>
                <Button type="submit" form="notification-rule-form">
                  Save Rule
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {confirmDialog}
    </div>
  );
}
