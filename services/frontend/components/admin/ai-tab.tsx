'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
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
import { deferEffect } from '@/lib/defer-effect';
import { Button, Card, Chip, Label, ListBox, Modal, SearchField, Select, Switch, Table, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Rocket01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const selectTriggerCls = heroSelectTriggerClassName;
const PAGE_SIZE = 10;

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
    : (supportedProviders[0]?.type ?? baseFormDefaults.providerType);
  const meta = supportedProviders.find((provider) => provider.type === fallbackType);
  return { ...baseFormDefaults, providerType: fallbackType, baseUrl: meta?.defaultUrl ?? '', chatModel: meta?.defaultModel ?? '' };
}

function toFormState(provider?: AIProviderAdmin): ProviderFormState {
  if (!provider) return { ...baseFormDefaults };
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

function metricLabel(value: number | null | undefined) {
  if (value == null) return '—';
  return value.toString();
}

export function AITab() {
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const modal = useOverlayState();

  const [settings, setSettings] = useState<AISettings | null>(null);
  const [providers, setProviders] = useState<AIProviderAdmin[]>([]);
  const [supportedProviders, setSupportedProviders] = useState<AISupportedProvider[]>([]);
  const [editingProviderKey, setEditingProviderKey] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>(baseFormDefaults);
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSetting, setSavingSetting] = useState<'enabled' | 'allowAnonymous' | ''>('');
  const [testingKey, setTestingKey] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [providerStep, setProviderStep] = useState(0);

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

  useEffect(() => deferEffect(load), [load]);

  const editingProvider = useMemo(() =>
    editingProviderKey
      ? (providers.find((provider) => provider.providerKey === editingProviderKey) ?? null)
      : null,
    [editingProviderKey, providers]
  );

  const filteredProviders = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = [...providers].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    if (!query) return sorted;
    return sorted.filter((provider) =>
      provider.label.toLowerCase().includes(query) ||
      provider.providerKey.toLowerCase().includes(query) ||
      provider.providerType.toLowerCase().includes(query) ||
      provider.baseUrl.toLowerCase().includes(query)
    );
  }, [providers, search]);

  const totalPages = Math.max(1, Math.ceil(filteredProviders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedProviders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredProviders.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredProviders]);

  const providerTypeMeta = useMemo(
    () => supportedProviders.find((provider) => provider.type === form.providerType) ?? null,
    [form.providerType, supportedProviders]
  );

  function openCreateModal() {
    setEditingProviderKey(null);
    setForm(buildEmptyForm(supportedProviders));
    setFormError('');
    setProviderStep(0);
    modal.open();
  }

  function openEditModal(provider: AIProviderAdmin) {
    setEditingProviderKey(provider.providerKey);
    setForm(toFormState(provider));
    setFormError('');
    setProviderStep(0);
    modal.open();
  }

  function validateProviderStep(step: number) {
    if (step === 0) {
      if (!form.providerKey.trim() || !form.providerType || !form.label.trim()) {
        return 'Provider key, type, and label are required.';
      }
    }
    if (step === 1) {
      if (!form.baseUrl.trim() || !form.chatModel.trim()) {
        return 'Base URL and chat model are required.';
      }
    }
    return '';
  }

  function goToNextProviderStep() {
    const validationError = validateProviderStep(providerStep);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError('');
    setProviderStep((current) => Math.min(current + 1, 2));
  }

  function handleProviderPrimaryAction() {
    if (providerStep < 2) {
      goToNextProviderStep();
      return;
    }
    const formElement = document.getElementById('ai-provider-form') as HTMLFormElement | null;
    formElement?.requestSubmit();
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

  async function handleDelete(provider: AIProviderAdmin) {
    const ok = await confirm({
      title: 'Delete AI Provider',
      message: `Remove provider "${provider.label}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await adminDeleteAIProvider(provider.providerKey);
      toast.success('AI provider deleted');
      await load();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete AI provider');
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

  const enabledCount = providers.filter((provider) => provider.enabled).length;
  const tokenCount = providers.filter((provider) => provider.tokenConfigured).length;
  const defaultProvider = providers.find((provider) => provider.isDefault);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <Card.Content className="space-y-1">
            <p className="text-xs text-zinc-500">Providers</p>
            <p className="text-2xl font-semibold">{providers.length}</p>
            <p className="text-xs text-zinc-500">{enabledCount} enabled</p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content className="space-y-1">
            <p className="text-xs text-zinc-500">Token Health</p>
            <p className="text-2xl font-semibold">{tokenCount}</p>
            <p className="text-xs text-zinc-500">with configured credentials</p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content className="space-y-1">
            <p className="text-xs text-zinc-500">AI Availability</p>
            <p className="text-2xl font-semibold">{settings?.enabled ? 'On' : 'Off'}</p>
            <p className="text-xs text-zinc-500">assistant request path</p>
          </Card.Content>
        </Card>
        <Card>
          <Card.Content className="space-y-1">
            <p className="text-xs text-zinc-500">Default Provider</p>
            <p className="text-lg font-semibold truncate">{defaultProvider?.label ?? 'None'}</p>
            <p className="text-xs text-zinc-500 truncate">{defaultProvider?.providerType ?? 'Unset'}</p>
          </Card.Content>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center">
          <SearchField name="admin-ai-search" variant="secondary" className="w-full">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Filter providers by label, key, runtime, or endpoint..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <Switch
            isDisabled={!settings || savingSetting !== ''}
            isSelected={settings?.enabled ?? false}
            onChange={(nextSelected) => {
              if (!settings) return;
              void handleUpdateSettings({ enabled: nextSelected }, 'enabled');
            }}
          >
            <Switch.Control><Switch.Thumb /></Switch.Control>
            <Switch.Content>AI Enabled</Switch.Content>
          </Switch>

          <Switch
            isDisabled={!settings || savingSetting !== ''}
            isSelected={settings?.allowAnonymous ?? false}
            onChange={(nextSelected) => {
              if (!settings) return;
              void handleUpdateSettings({ allowAnonymous: nextSelected }, 'allowAnonymous');
            }}
          >
            <Switch.Control><Switch.Thumb /></Switch.Control>
            <Switch.Content>Anonymous Access</Switch.Content>
          </Switch>

          <Button variant="secondary" onPress={openCreateModal}>
            <PlusSignIcon size={15} />
            Add Provider
          </Button>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Configured AI providers" className="min-w-[980px]">
              <Table.Header>
                <Table.Column isRowHeader>Provider</Table.Column>
                <Table.Column>Runtime</Table.Column>
                <Table.Column>Endpoint</Table.Column>
                <Table.Column>Status</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading AI providers...' : 'No providers found.'}
                  </div>
                )}
              >
                {pagedProviders.map((provider) => (
                  <Table.Row key={provider.providerKey} id={provider.providerKey}>
                    <Table.Cell>
                      <p className="font-medium">{provider.label}</p>
                      <p className="font-mono text-xs text-zinc-500">{provider.providerKey}</p>
                    </Table.Cell>
                    <Table.Cell>
                      <p className="text-sm">{provider.providerType}</p>
                      <p className="text-xs text-zinc-500">{provider.chatModel || 'No chat model set'}</p>
                    </Table.Cell>
                    <Table.Cell>
                      <p className="font-mono text-xs text-zinc-500 break-all">{provider.baseUrl || 'No base URL set'}</p>
                      <p className="text-xs text-zinc-500">{provider.apiPath || provider.apiVersion || 'Default API route'}</p>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap gap-2">
                        {provider.isDefault && <Chip size="sm" variant="soft" color="accent">Default</Chip>}
                        <Chip size="sm" variant="soft" color={provider.enabled ? 'success' : 'danger'}>{provider.enabled ? 'Enabled' : 'Disabled'}</Chip>
                        <Chip size="sm" variant="soft" color={provider.tokenConfigured ? 'success' : 'warning'}>{provider.tokenConfigured ? 'Token set' : 'Token missing'}</Chip>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for provider ${provider.label}`}
                          items={[
                            {
                              id: 'test',
                              label: testingKey === provider.providerKey ? 'Testing...' : 'Test provider',
                              icon: <Rocket01Icon size={15} />,
                              onAction: () => {
                                void handleTest(provider.providerKey);
                              },
                            },
                            {
                              id: 'edit',
                              label: 'Edit provider',
                              icon: <PencilEdit01Icon size={15} />,
                              onAction: () => openEditModal(provider),
                            },
                            {
                              id: 'delete',
                              label: 'Delete provider',
                              icon: <Delete01Icon size={15} />,
                              variant: 'danger',
                              onAction: () => {
                                void handleDelete(provider);
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
        </Table>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">
            Showing {filteredProviders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filteredProviders.length)} of {filteredProviders.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" isDisabled={currentPage <= 1} onPress={() => setPage((current) => Math.max(1, current - 1))}>
              Previous
            </Button>
            <span className="text-sm text-zinc-500">Page {currentPage} of {totalPages}</span>
            <Button variant="secondary" isDisabled={currentPage >= totalPages} onPress={() => setPage((current) => Math.min(totalPages, current + 1))}>
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Card.Content className="space-y-2">
          <p className="text-sm font-medium">Supported Runtimes</p>
          <div className="flex flex-wrap gap-2">
            {supportedProviders.map((provider) => (
              <Chip key={provider.type} size="sm" variant="soft">
                {provider.label}
              </Chip>
            ))}
          </div>
        </Card.Content>
      </Card>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{editingProviderKey ? 'Edit Provider' : 'Create Provider'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-4">
                  <p className="text-sm text-zinc-500">
                    Configure provider identity, endpoint, and runtime behavior in three steps.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Chip variant={providerStep === 0 ? 'primary' : 'soft'} color={providerStep === 0 ? 'accent' : 'default'}>1. Identity</Chip>
                    <Chip variant={providerStep === 1 ? 'primary' : 'soft'} color={providerStep === 1 ? 'accent' : 'default'}>2. Endpoint</Chip>
                    <Chip variant={providerStep === 2 ? 'primary' : 'soft'} color={providerStep === 2 ? 'accent' : 'default'}>3. Runtime</Chip>
                  </div>
                <form
                  id="ai-provider-form"
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSave();
                  }}
                >
                  {formError && <p className="text-sm text-danger">{formError}</p>}

                  {providerStep === 0 && <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      label="Provider key"
                      description="Stable identifier used by the backend."
                      placeholder="primary-openai"
                      required
                      disabled={Boolean(editingProviderKey)}
                      value={form.providerKey}
                      onChange={(event) => setForm((current) => ({ ...current, providerKey: event.target.value }))}
                    />

                    <Select
                      className="w-full min-w-0"
                      isDisabled={Boolean(editingProviderKey)}
                      variant="secondary"
                      value={form.providerType}
                      onChange={(value) => handleProviderTypeChange(String(value))}
                    >
                      <Label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Provider type <span className="text-danger">*</span>
                      </Label>
                      <Select.Trigger className={selectTriggerCls}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {supportedProviders.map((provider) => (
                            <ListBox.Item key={provider.type} id={provider.type}>
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
                      required
                      value={form.label}
                      onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                    />
                    <FormField
                      label="Chat model"
                      placeholder={providerTypeMeta?.defaultModel ?? 'gpt-4o-mini'}
                      required
                      value={form.chatModel}
                      onChange={(event) => setForm((current) => ({ ...current, chatModel: event.target.value }))}
                    />
                  </div>}

                  {providerStep === 1 && <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      containerClassName="md:col-span-2"
                      label="Base URL"
                      placeholder={providerTypeMeta?.defaultUrl ?? 'https://api.openai.com/v1'}
                      required
                      value={form.baseUrl}
                      onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
                    />
                    <FormField label="API path" placeholder="Optional override" value={form.apiPath} onChange={(event) => setForm((current) => ({ ...current, apiPath: event.target.value }))} />
                    <FormField label="API version" placeholder="Optional" value={form.apiVersion} onChange={(event) => setForm((current) => ({ ...current, apiVersion: event.target.value }))} />
                    <FormField label="Region" placeholder="Optional" value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} />
                    <FormField label="Organization" placeholder="Optional" value={form.organization} onChange={(event) => setForm((current) => ({ ...current, organization: event.target.value }))} />
                    <FormField
                      containerClassName="md:col-span-2"
                      label="API token"
                      type="password"
                      description={editingProvider?.tokenConfigured ? 'Leave blank to keep the current token.' : 'Required for hosted providers.'}
                      placeholder={editingProvider?.tokenConfigured ? 'Current token already configured' : 'Paste provider token'}
                      value={form.token}
                      onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))}
                    />
                  </div>}

                  {providerStep === 2 && <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <FormField label="Embedding model" placeholder="Optional" value={form.embeddingModel} onChange={(event) => setForm((current) => ({ ...current, embeddingModel: event.target.value }))} />
                    <FormField label="Temperature" type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))} />
                    <FormField label="Timeout (s)" type="number" min="1" value={form.timeoutSeconds} onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: event.target.value }))} />
                    <FormField label="Context tokens" type="number" min="1" value={form.maxContextTokens} onChange={(event) => setForm((current) => ({ ...current, maxContextTokens: event.target.value }))} />
                    <FormField label="Output tokens" type="number" min="1" value={form.maxOutputTokens} onChange={(event) => setForm((current) => ({ ...current, maxOutputTokens: event.target.value }))} />
                  </div>}

                  {providerStep === 2 && <div className="grid gap-2 sm:grid-cols-2">
                    <Switch isSelected={form.enabled} onChange={(next) => setForm((current) => ({ ...current, enabled: next }))}>
                      <Switch.Control><Switch.Thumb /></Switch.Control>
                      <Switch.Content>Provider enabled</Switch.Content>
                    </Switch>
                    <Switch isSelected={form.isDefault} onChange={(next) => setForm((current) => ({ ...current, isDefault: next }))}>
                      <Switch.Control><Switch.Thumb /></Switch.Control>
                      <Switch.Content>Set as default provider</Switch.Content>
                    </Switch>
                  </div>}
                </form>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button type="button" variant="secondary" onPress={modal.close}>Cancel</Button>
                {providerStep > 0 && (
                  <Button type="button" variant="secondary" onPress={() => setProviderStep((current) => Math.max(current - 1, 0))}>
                    Back
                  </Button>
                )}
                {providerStep < 2 ? (
                  <Button type="button" variant="primary" onPress={handleProviderPrimaryAction}>Next</Button>
                ) : (
                  <Button type="button" variant="primary" isDisabled={saving} onPress={handleProviderPrimaryAction}>
                    {saving ? 'Saving...' : editingProviderKey ? 'Save Provider' : 'Create Provider'}
                  </Button>
                )}
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {confirmDialog}
    </div>
  );
}
