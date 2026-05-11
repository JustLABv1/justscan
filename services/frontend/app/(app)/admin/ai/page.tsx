'use client';

import { useToast } from '@/components/toast';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import {
    adminCreateAIProvider,
    adminDeleteAIProvider,
    adminListAIProviders,
    adminListAISupportedProviders,
    adminTestAIProvider,
    adminUpdateAIProvider,
    adminUpdateAISettings,
    getAdminAISettings,
    type AIProviderAdmin,
    type AISettings,
    type AISupportedProvider,
} from '@/lib/api';
import {
    AlertDialog,
    Button,
    Card,
    Dropdown,
    Label,
    ListBox,
    Modal,
    Select,
    Switch,
    Table,
    useOverlayState,
} from '@heroui/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AdminShell } from '../_components/admin-shell';

const selectTriggerCls = heroSelectTriggerClassName;

type ProviderFormState = {
  providerKey: string;
  providerType: string;
  label: string;
  baseUrl: string;
  apiPath: string;
  apiVersion: string;
  region: string;
  organization: string;
  token: string;
  chatModel: string;
  embeddingModel: string;
  enabled: boolean;
  isDefault: boolean;
  timeoutSeconds: string;
  maxContextTokens: string;
  maxOutputTokens: string;
  temperature: string;
};

const baseFormDefaults: ProviderFormState = {
  providerKey: '',
  providerType: 'openai-compatible',
  label: '',
  baseUrl: '',
  apiPath: '',
  apiVersion: '',
  region: '',
  organization: '',
  token: '',
  chatModel: '',
  embeddingModel: '',
  enabled: true,
  isDefault: false,
  timeoutSeconds: '30',
  maxContextTokens: '6000',
  maxOutputTokens: '1200',
  temperature: '0.2',
};

function buildEmptyForm(supportedProviders: AISupportedProvider[]): ProviderFormState {
  const fallbackType = supportedProviders.some((provider) => provider.type === baseFormDefaults.providerType)
    ? baseFormDefaults.providerType
    : supportedProviders[0]?.type ?? baseFormDefaults.providerType;
  const meta = supportedProviders.find((provider) => provider.type === fallbackType);

  return {
    ...baseFormDefaults,
    providerType: fallbackType,
    baseUrl: meta?.defaultUrl ?? '',
    chatModel: meta?.defaultModel ?? '',
  };
}

function toFormState(provider?: AIProviderAdmin): ProviderFormState {
  if (!provider) {
    return { ...baseFormDefaults };
  }

  return {
    providerKey: provider.providerKey,
    providerType: provider.providerType,
    label: provider.label,
    baseUrl: provider.baseUrl,
    apiPath: provider.apiPath,
    apiVersion: provider.apiVersion,
    region: provider.region,
    organization: provider.organization,
    token: '',
    chatModel: provider.chatModel,
    embeddingModel: provider.embeddingModel,
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    timeoutSeconds: String(provider.timeoutSeconds),
    maxContextTokens: String(provider.maxContextTokens),
    maxOutputTokens: String(provider.maxOutputTokens),
    temperature: String(provider.temperature),
  };
}

function toneStyle(tone: 'success' | 'danger' | 'neutral' | 'accent') {
  switch (tone) {
    case 'success':
      return {
        background: 'rgba(34,197,94,0.12)',
        border: '1px solid rgba(34,197,94,0.22)',
        color: '#86efac',
      };
    case 'danger':
      return {
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid rgba(239,68,68,0.22)',
        color: '#fca5a5',
      };
    case 'accent':
      return {
        background: 'rgba(124,58,237,0.12)',
        border: '1px solid rgba(124,58,237,0.22)',
        color: '#c4b5fd',
      };
    default:
      return {
        background: 'rgba(113,113,122,0.12)',
        border: '1px solid rgba(113,113,122,0.2)',
        color: 'var(--text-secondary)',
      };
  }
}

function SurfaceCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <Card className={`surface-panel overflow-hidden rounded-[28px] ${className}`.trim()}>
      {children}
    </Card>
  );
}

function StatusPill({ tone, children }: { tone: 'success' | 'danger' | 'neutral' | 'accent'; children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold" style={toneStyle(tone)}>
      {children}
    </span>
  );
}

function ProviderBadges({ provider }: { provider: AIProviderAdmin }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {provider.isDefault ? <StatusPill tone="accent">Default</StatusPill> : null}
      {provider.enabled ? <StatusPill tone="success">Enabled</StatusPill> : <StatusPill tone="danger">Disabled</StatusPill>}
      {provider.tokenConfigured ? <StatusPill tone="neutral">Token configured</StatusPill> : <StatusPill tone="danger">Token missing</StatusPill>}
    </div>
  );
}

function formatEndpoint(value: string) {
  if (!value) {
    return 'No base URL set';
  }

  return value.replace(/^https?:\/\//, '');
}

export default function AdminAIPage() {
  const toast = useToast();
  const modal = useOverlayState();

  const [settings, setSettings] = useState<AISettings | null>(null);
  const [providers, setProviders] = useState<AIProviderAdmin[]>([]);
  const [supportedProviders, setSupportedProviders] = useState<AISupportedProvider[]>([]);
  const [editingProviderKey, setEditingProviderKey] = useState<string | null>(null);
  const [providerPendingDelete, setProviderPendingDelete] = useState<AIProviderAdmin | null>(null);
  const [form, setForm] = useState<ProviderFormState>(baseFormDefaults);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [savingSetting, setSavingSetting] = useState<'enabled' | 'allowAnonymous' | ''>('');
  const [testingKey, setTestingKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextProviders, nextSupported] = await Promise.all([
        getAdminAISettings(),
        adminListAIProviders(),
        adminListAISupportedProviders(),
      ]);
      setSettings(nextSettings);
      setProviders(nextProviders);
      setSupportedProviders(nextSupported);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const editingProvider = useMemo(
    () => (editingProviderKey ? providers.find((provider) => provider.providerKey === editingProviderKey) ?? null : null),
    [editingProviderKey, providers],
  );

  const providerTypeMeta = useMemo(
    () => supportedProviders.find((provider) => provider.type === form.providerType) ?? null,
    [form.providerType, supportedProviders],
  );

  const defaultProvider = useMemo(
    () => providers.find((provider) => provider.isDefault) ?? null,
    [providers],
  );

  const sortedProviders = useMemo(
    () => providers.toSorted((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
      }
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    }),
    [providers],
  );

  function openCreateModal() {
    setEditingProviderKey(null);
    setForm(buildEmptyForm(supportedProviders));
    setFormError('');
    modal.open();
  }

  function openEditModal(provider: AIProviderAdmin) {
    setEditingProviderKey(provider.providerKey);
    setForm(toFormState(provider));
    setFormError('');
    modal.open();
  }

  function resetForm() {
    setFormError('');
    if (editingProvider) {
      setForm(toFormState(editingProvider));
      return;
    }
    setForm(buildEmptyForm(supportedProviders));
  }

  async function handleSave() {
    if (!form.providerKey.trim()) {
      setFormError('Provider key is required.');
      return;
    }

    setSaving(true);
    setFormError('');

    try {
      const payload = {
        providerKey: form.providerKey.trim(),
        providerType: form.providerType,
        label: form.label.trim(),
        baseUrl: form.baseUrl.trim(),
        apiPath: form.apiPath.trim(),
        apiVersion: form.apiVersion.trim(),
        region: form.region.trim(),
        organization: form.organization.trim(),
        token: form.token,
        chatModel: form.chatModel.trim(),
        embeddingModel: form.embeddingModel.trim(),
        enabled: form.enabled,
        isDefault: form.isDefault,
        timeoutSeconds: Number(form.timeoutSeconds || 0),
        maxContextTokens: Number(form.maxContextTokens || 0),
        maxOutputTokens: Number(form.maxOutputTokens || 0),
        temperature: Number(form.temperature || 0),
      };

      if (editingProviderKey) {
        await adminUpdateAIProvider(editingProviderKey, payload);
        toast.success('AI provider updated');
      } else {
        await adminCreateAIProvider(payload);
        toast.success('AI provider created');
      }

      modal.close();
      setEditingProviderKey(null);
      setForm(buildEmptyForm(supportedProviders));
      await load();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to save AI provider';
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!providerPendingDelete) {
      return;
    }

    setDeletePending(true);
    try {
      await adminDeleteAIProvider(providerPendingDelete.providerKey);
      toast.success('AI provider deleted');
      if (editingProviderKey === providerPendingDelete.providerKey) {
        modal.close();
        setEditingProviderKey(null);
      }
      setProviderPendingDelete(null);
      await load();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete AI provider');
    } finally {
      setDeletePending(false);
    }
  }

  async function handleTest(key: string) {
    setTestingKey(key);
    try {
      await adminTestAIProvider(key);
      toast.success('Provider test succeeded');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Provider test failed');
    } finally {
      setTestingKey('');
    }
  }

  async function handleUpdateSettings(next: Partial<Pick<AISettings, 'enabled' | 'allowAnonymous'>>, settingKey: 'enabled' | 'allowAnonymous') {
    setSavingSetting(settingKey);
    try {
      const updated = await adminUpdateAISettings(next);
      setSettings(updated);
      toast.success('AI settings updated');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update AI settings');
    } finally {
      setSavingSetting('');
    }
  }

  function handleProviderTypeChange(nextType: string) {
    const nextMeta = supportedProviders.find((provider) => provider.type === nextType);
    setForm((current) => ({
      ...current,
      providerType: nextType,
      baseUrl: nextMeta?.defaultUrl ?? current.baseUrl,
      chatModel: nextMeta?.defaultModel ?? current.chatModel,
    }));
  }

  const inventoryDescription = loading
    ? 'Loading configured providers...'
    : providers.length === 0
      ? 'No provider is configured yet. Create your first provider to enable assistant traffic.'
      : `${providers.length} provider${providers.length === 1 ? '' : 's'} configured.`;

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[28px] border p-5 sm:px-6" style={{ borderColor: 'var(--surface-border)', background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))' }}>
          <div className="max-w-3xl space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>Provider Control</p>
            <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Manage AI providers without the permanent editor</h2>
            <p className="text-sm leading-6" style={{ color: 'var(--text-faint)' }}>
              Configure global AI availability, review configured runtimes, and create or edit providers in a contained modal workflow.
            </p>
          </div>
          <Button className="btn-primary" onPress={openCreateModal} variant="primary">
            New provider
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SurfaceCard>
            <div className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>Assistant availability</p>
                  <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{settings?.enabled ? 'AI is enabled' : 'AI is disabled'}</p>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>When off, the assistant UI and chat APIs reject requests immediately.</p>
                </div>
                <StatusPill tone={settings?.enabled ? 'success' : 'danger'}>
                  {settings?.enabled ? 'On' : 'Off'}
                </StatusPill>
              </div>
              <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                <Switch
                  isDisabled={!settings || savingSetting !== ''}
                  isSelected={settings?.enabled ?? false}
                  onChange={(nextSelected) => {
                    if (!settings) {
                      return;
                    }
                    void handleUpdateSettings({ enabled: nextSelected }, 'enabled');
                  }}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>
                    <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {savingSetting === 'enabled' ? 'Saving availability...' : 'Allow assistant requests'}
                    </Label>
                  </Switch.Content>
                </Switch>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <div className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>Anonymous access</p>
                  <p className="mt-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {settings?.allowAnonymous ? 'Anonymous access allowed' : 'Anonymous access blocked'}
                  </p>
                  <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>Controls whether unauthenticated AI entry points may use configured providers.</p>
                </div>
                <StatusPill tone={settings?.allowAnonymous ? 'accent' : 'neutral'}>
                  {settings?.allowAnonymous ? 'Allowed' : 'Blocked'}
                </StatusPill>
              </div>
              <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                <Switch
                  isDisabled={!settings || savingSetting !== ''}
                  isSelected={settings?.allowAnonymous ?? false}
                  onChange={(nextSelected) => {
                    if (!settings) {
                      return;
                    }
                    void handleUpdateSettings({ allowAnonymous: nextSelected }, 'allowAnonymous');
                  }}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>
                    <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {savingSetting === 'allowAnonymous' ? 'Saving policy...' : 'Permit anonymous provider usage'}
                    </Label>
                  </Switch.Content>
                </Switch>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <div className="flex h-full flex-col justify-between p-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>Default provider</p>
                <p className="mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{defaultProvider?.label ?? 'None configured'}</p>
                <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>
                  {defaultProvider ? `${defaultProvider.providerType} · ${defaultProvider.chatModel || 'No chat model'}` : 'The assistant uses the default provider when no explicit provider key is chosen.'}
                </p>
              </div>
              <div className="mt-4">
                {defaultProvider ? <ProviderBadges provider={defaultProvider} /> : <StatusPill tone="neutral">Awaiting configuration</StatusPill>}
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <div className="flex h-full flex-col justify-between p-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>Inventory</p>
                <p className="mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{providers.length}</p>
                <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>
                  {supportedProviders.length} supported runtime{supportedProviders.length === 1 ? '' : 's'} exposed for provider setup.
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill tone="neutral">{providers.filter((provider) => provider.enabled).length} enabled</StatusPill>
                <StatusPill tone="neutral">{providers.filter((provider) => provider.tokenConfigured).length} with tokens</StatusPill>
              </div>
            </div>
          </SurfaceCard>
        </div>

        <SurfaceCard>
          <div className="space-y-5 p-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Configured providers</h3>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-faint)' }}>{inventoryDescription}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {supportedProviders.slice(0, 4).map((provider) => (
                  <StatusPill key={provider.type} tone="neutral">{provider.label}</StatusPill>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="rounded-2xl border px-4 py-10 text-sm" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)', color: 'var(--text-faint)' }}>
                Loading AI providers…
              </div>
            ) : sortedProviders.length === 0 ? (
              <div className="rounded-3xl border px-5 py-10 text-center" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>No provider configured yet</p>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--text-faint)' }}>
                  Create your first provider to validate credentials, choose a default runtime, and unblock assistant traffic.
                </p>
                <div className="mt-5">
                  <Button className="btn-primary" onPress={openCreateModal} variant="primary">
                    Create provider
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <Table variant="secondary">
                    <Table.ScrollContainer>
                      <Table.Content aria-label="Configured AI providers" className="min-w-[920px]">
                        <Table.Header>
                          <Table.Column isRowHeader>Provider</Table.Column>
                          <Table.Column>Runtime</Table.Column>
                          <Table.Column>Endpoint</Table.Column>
                          <Table.Column>Status</Table.Column>
                          <Table.Column>Actions</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {sortedProviders.map((provider) => (
                            <Table.Row key={provider.providerKey}>
                              <Table.Cell>
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{provider.label}</p>
                                    {provider.isDefault ? <StatusPill tone="accent">Default</StatusPill> : null}
                                  </div>
                                  <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>{provider.providerKey}</p>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="space-y-1 text-sm">
                                  <p style={{ color: 'var(--text-primary)' }}>{provider.providerType}</p>
                                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{provider.chatModel || 'No chat model set'}</p>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="max-w-[260px] space-y-1 text-sm">
                                  <p className="truncate" style={{ color: 'var(--text-primary)' }}>{formatEndpoint(provider.baseUrl)}</p>
                                  <p className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>{provider.apiPath || provider.apiVersion || 'Default API path and version'}</p>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <ProviderBadges provider={provider} />
                              </Table.Cell>
                              <Table.Cell>
                                <div className="flex items-center justify-end gap-2">
                                  <Button
                                    className="btn-secondary whitespace-nowrap"
                                    isDisabled={Boolean(testingKey)}
                                    onPress={() => handleTest(provider.providerKey)}
                                    variant="secondary"
                                  >
                                    {testingKey === provider.providerKey ? 'Testing...' : 'Test'}
                                  </Button>
                                  <Dropdown>
                                    <Dropdown.Trigger className="btn-secondary inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium outline-none">
                                      Actions
                                    </Dropdown.Trigger>
                                    <Dropdown.Popover className="min-w-[180px]" placement="bottom end">
                                      <Dropdown.Menu onAction={(key) => {
                                        if (key === 'edit') {
                                          openEditModal(provider);
                                        }
                                        if (key === 'delete') {
                                          setProviderPendingDelete(provider);
                                        }
                                      }}>
                                        <Dropdown.Item id="edit" textValue="Edit provider">
                                          <Label>Edit provider</Label>
                                        </Dropdown.Item>
                                        <Dropdown.Item id="delete" textValue="Delete provider" className="text-danger">
                                          <Label className="text-danger">Delete provider</Label>
                                        </Dropdown.Item>
                                      </Dropdown.Menu>
                                    </Dropdown.Popover>
                                  </Dropdown>
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                </div>

                <div className="space-y-3 md:hidden">
                  {sortedProviders.map((provider) => (
                    <div key={provider.providerKey} className="rounded-3xl border p-4" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{provider.label}</p>
                            {provider.isDefault ? <StatusPill tone="accent">Default</StatusPill> : null}
                          </div>
                          <p className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>{provider.providerKey}</p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>Runtime</p>
                            <p className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>{provider.providerType}</p>
                            <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{provider.chatModel || 'No chat model set'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>Endpoint</p>
                            <p className="mt-1 text-sm break-all" style={{ color: 'var(--text-primary)' }}>{provider.baseUrl || 'No base URL set'}</p>
                            <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{provider.apiPath || provider.apiVersion || 'Default API path and version'}</p>
                          </div>
                        </div>

                        <ProviderBadges provider={provider} />

                        <div className="flex items-center gap-2">
                          <Button
                            className="btn-secondary flex-1"
                            isDisabled={Boolean(testingKey)}
                            onPress={() => handleTest(provider.providerKey)}
                            variant="secondary"
                          >
                            {testingKey === provider.providerKey ? 'Testing...' : 'Test provider'}
                          </Button>
                          <Dropdown>
                            <Dropdown.Trigger className="btn-secondary inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium outline-none">
                              Actions
                            </Dropdown.Trigger>
                            <Dropdown.Popover className="min-w-[180px]" placement="bottom end">
                              <Dropdown.Menu onAction={(key) => {
                                if (key === 'edit') {
                                  openEditModal(provider);
                                }
                                if (key === 'delete') {
                                  setProviderPendingDelete(provider);
                                }
                              }}>
                                <Dropdown.Item id="edit" textValue="Edit provider">
                                  <Label>Edit provider</Label>
                                </Dropdown.Item>
                                <Dropdown.Item id="delete" textValue="Delete provider" className="text-danger">
                                  <Label className="text-danger">Delete provider</Label>
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown.Popover>
                          </Dropdown>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <div className="space-y-4 p-5 sm:px-6">
            <div>
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Supported runtimes</h3>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-faint)' }}>Available provider types and their seeded defaults for new configurations.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {supportedProviders.map((provider) => (
                <div key={provider.type} className="rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: 'var(--surface-border)', background: 'var(--app-bg)', color: 'var(--text-secondary)' }}>
                  {provider.label}
                </div>
              ))}
            </div>
          </div>
        </SurfaceCard>

        <Modal state={modal}>
          <Modal.Backdrop isDismissable variant="blur">
            <Modal.Container placement="center" size="lg">
              <Modal.Dialog className="surface-modal overflow-hidden rounded-3xl">
                <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <Modal.Heading className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {editingProviderKey ? 'Edit provider' : 'Create provider'}
                  </Modal.Heading>
                  <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
                </Modal.Header>
                <Modal.Body className="max-h-[calc(100dvh-12rem)] overflow-y-auto px-6 py-5">
                  <form
                    id="ai-provider-form"
                    className="space-y-5"
                    action={() => {
                      void handleSave();
                    }}
                  >
                    {formError ? (
                      <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                        {formError}
                      </div>
                    ) : null}

                    <div className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Identity</h4>
                        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>Provider identity is stable and controls how the assistant references this runtime.</p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          description="Use a stable key because assistant settings and runtime references depend on it."
                          disabled={Boolean(editingProviderKey)}
                          label="Provider key"
                          placeholder="primary-openai"
                          required
                          value={form.providerKey}
                          onChange={(event) => setForm((current) => ({ ...current, providerKey: event.target.value }))}
                        />

                        <Select
                          className="w-full"
                          isDisabled={Boolean(editingProviderKey)}
                          placeholder="Select a provider type"
                          value={form.providerType}
                          onChange={(value) => handleProviderTypeChange(String(value))}
                        >
                          <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Provider type</Label>
                          <Select.Trigger className={selectTriggerCls}>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              {supportedProviders.map((provider) => (
                                <ListBox.Item id={provider.type} key={provider.type} textValue={provider.label}>
                                  {provider.label}
                                  <ListBox.ItemIndicator />
                                </ListBox.Item>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>

                        <FormField
                          label="Label"
                          placeholder="Primary OpenAI"
                          value={form.label}
                          onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                        />

                        <FormField
                          description="Seeded from the selected provider type when available."
                          label="Chat model"
                          placeholder={providerTypeMeta?.defaultModel ?? 'gpt-4o-mini'}
                          value={form.chatModel}
                          onChange={(event) => setForm((current) => ({ ...current, chatModel: event.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Endpoint and authentication</h4>
                        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>Provide the runtime endpoint and secret material used to reach this model provider.</p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          containerClassName="md:col-span-2"
                          label="Base URL"
                          placeholder={providerTypeMeta?.defaultUrl ?? 'https://api.openai.com/v1'}
                          value={form.baseUrl}
                          onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
                        />

                        <FormField
                          label="API path"
                          placeholder="Optional override"
                          value={form.apiPath}
                          onChange={(event) => setForm((current) => ({ ...current, apiPath: event.target.value }))}
                        />

                        <FormField
                          label="API version"
                          placeholder="Optional"
                          value={form.apiVersion}
                          onChange={(event) => setForm((current) => ({ ...current, apiVersion: event.target.value }))}
                        />

                        <FormField
                          label="Region"
                          placeholder="Optional"
                          value={form.region}
                          onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))}
                        />

                        <FormField
                          label="Organization"
                          placeholder="Optional"
                          value={form.organization}
                          onChange={(event) => setForm((current) => ({ ...current, organization: event.target.value }))}
                        />

                        <FormField
                          containerClassName="md:col-span-2"
                          description={editingProvider?.tokenConfigured ? 'Leave blank to keep the current token.' : 'Paste the provider token used for assistant requests.'}
                          label="API token"
                          placeholder={editingProvider?.tokenConfigured ? 'Current token is already configured' : 'Paste provider token'}
                          type="password"
                          value={form.token}
                          onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Models and runtime tuning</h4>
                        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>Set model defaults and the runtime safety rails used by the assistant.</p>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <FormField
                          label="Embedding model"
                          placeholder="Optional"
                          value={form.embeddingModel}
                          onChange={(event) => setForm((current) => ({ ...current, embeddingModel: event.target.value }))}
                        />
                        <FormField
                          label="Temperature"
                          max="2"
                          min="0"
                          step="0.1"
                          type="number"
                          value={form.temperature}
                          onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))}
                        />
                        <FormField
                          label="Timeout seconds"
                          min="1"
                          type="number"
                          value={form.timeoutSeconds}
                          onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: event.target.value }))}
                        />
                        <FormField
                          label="Context tokens"
                          min="1"
                          type="number"
                          value={form.maxContextTokens}
                          onChange={(event) => setForm((current) => ({ ...current, maxContextTokens: event.target.value }))}
                        />
                        <FormField
                          label="Output tokens"
                          min="1"
                          type="number"
                          value={form.maxOutputTokens}
                          onChange={(event) => setForm((current) => ({ ...current, maxOutputTokens: event.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="rounded-3xl border p-4 sm:p-5" style={{ borderColor: 'var(--surface-border)', background: 'var(--row-hover)' }}>
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Provider state</h4>
                        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-faint)' }}>Set whether this provider can receive traffic and whether it becomes the assistant default.</p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--app-bg)' }}>
                          <Switch isSelected={form.enabled} onChange={(nextSelected) => setForm((current) => ({ ...current, enabled: nextSelected }))}>
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                            <Switch.Content>
                              <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Provider enabled</Label>
                            </Switch.Content>
                          </Switch>
                        </div>
                        <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--app-bg)' }}>
                          <Switch isSelected={form.isDefault} onChange={(nextSelected) => setForm((current) => ({ ...current, isDefault: nextSelected }))}>
                            <Switch.Control>
                              <Switch.Thumb />
                            </Switch.Control>
                            <Switch.Content>
                              <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Use as default provider</Label>
                            </Switch.Content>
                          </Switch>
                        </div>
                      </div>
                    </div>
                  </form>
                </Modal.Body>
                <Modal.Footer className="flex flex-wrap justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <Button className="btn-secondary" onPress={() => { resetForm(); }} variant="secondary">
                    Reset
                  </Button>
                  <Button className="btn-secondary" onPress={() => { modal.close(); }} variant="secondary">
                    Cancel
                  </Button>
                  <Button className="btn-primary" form="ai-provider-form" isDisabled={saving || !form.providerKey.trim()} type="submit" variant="primary">
                    {saving ? 'Saving...' : editingProviderKey ? 'Save changes' : 'Create provider'}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>

        <AlertDialog isOpen={Boolean(providerPendingDelete)} onOpenChange={(isOpen) => {
          if (!isOpen) {
            setProviderPendingDelete(null);
          }
        }}>
          <AlertDialog.Backdrop variant="blur">
            <AlertDialog.Container placement="center">
              <AlertDialog.Dialog className="surface-modal overflow-hidden rounded-3xl sm:max-w-[420px]">
                <AlertDialog.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
                <AlertDialog.Header>
                  <AlertDialog.Icon status="danger" />
                  <AlertDialog.Heading>Delete provider?</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                    This removes <strong>{providerPendingDelete?.label ?? 'this provider'}</strong> and its runtime configuration from the admin inventory.
                  </p>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button slot="close" variant="tertiary">Cancel</Button>
                  <Button isDisabled={deletePending} onPress={() => { void handleConfirmDelete(); }} variant="danger">
                    {deletePending ? 'Deleting...' : 'Delete provider'}
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      </div>
    </AdminShell>
  );
}