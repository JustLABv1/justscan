'use client';

import { Button } from '@heroui/react';
import { useMemo, useState } from 'react';

import { useToast } from '@/components/toast';
import { nativeFieldClassName } from '@/components/ui/form-styles';
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
import { useEffect } from 'react';
import { AdminShell } from '../_components/admin-shell';

const inputCls = nativeFieldClassName;

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

const emptyForm: ProviderFormState = {
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

function toFormState(provider?: AIProviderAdmin): ProviderFormState {
  if (!provider) {
    return emptyForm;
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

export default function AdminAIPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [providers, setProviders] = useState<AIProviderAdmin[]>([]);
  const [supportedProviders, setSupportedProviders] = useState<AISupportedProvider[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [form, setForm] = useState<ProviderFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSetting, setSavingSetting] = useState<'enabled' | 'allowAnonymous' | ''>('');
  const [testingKey, setTestingKey] = useState('');

  async function load() {
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
      setSelectedKey((current) => (current && nextProviders.some((provider) => provider.providerKey === current) ? current : ''));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.providerKey === selectedKey) ?? null,
    [providers, selectedKey],
  );

  useEffect(() => {
    setForm(toFormState(selectedProvider ?? undefined));
  }, [selectedProvider]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        providerKey: form.providerKey,
        providerType: form.providerType,
        label: form.label,
        baseUrl: form.baseUrl,
        apiPath: form.apiPath,
        apiVersion: form.apiVersion,
        region: form.region,
        organization: form.organization,
        token: form.token,
        chatModel: form.chatModel,
        embeddingModel: form.embeddingModel,
        enabled: form.enabled,
        isDefault: form.isDefault,
        timeoutSeconds: Number(form.timeoutSeconds || 0),
        maxContextTokens: Number(form.maxContextTokens || 0),
        maxOutputTokens: Number(form.maxOutputTokens || 0),
        temperature: Number(form.temperature || 0),
      };

      if (selectedProvider) {
        await adminUpdateAIProvider(selectedProvider.providerKey, payload);
        toast.success('AI provider updated');
      } else {
        await adminCreateAIProvider(payload);
        toast.success('AI provider created');
      }
      await load();
      if (!selectedProvider) {
        setSelectedKey(form.providerKey);
      }
      setForm((current) => ({ ...current, token: '' }));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to save AI provider');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(key: string) {
    if (!window.confirm(`Delete AI provider ${key}?`)) {
      return;
    }
    try {
      await adminDeleteAIProvider(key);
      toast.success('AI provider deleted');
      if (selectedKey === key) {
        setSelectedKey('');
        setForm(emptyForm);
      }
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

  const providerTypeMeta = supportedProviders.find((provider) => provider.type === form.providerType);
  const defaultProvider = providers.find((provider) => provider.isDefault) ?? null;

  return (
    <AdminShell>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,420px)]">
        <section className="glass-panel rounded-[28px] p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Provider connectivity</h2>
              <p className="mt-1 text-sm text-zinc-500">Configure LLM providers, validate credentials, and choose the default runtime used by the assistant.</p>
            </div>
            <Button className="btn-secondary" onPress={() => { setSelectedKey(''); setForm(emptyForm); }} variant="secondary">
              New provider
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Assistant availability</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{settings?.enabled ? 'AI is enabled' : 'AI is disabled'}</p>
                  <p className="mt-1 text-xs text-zinc-500">When disabled, the assistant page and chat APIs reject requests immediately.</p>
                </div>
                <Button
                  className={settings?.enabled ? 'btn-danger' : 'btn-secondary'}
                  isDisabled={!settings || savingSetting !== ''}
                  onPress={() => {
                    if (!settings) {
                      return;
                    }
                    void handleUpdateSettings({ enabled: !settings.enabled }, 'enabled');
                  }}
                  style={{ alignSelf: 'flex-start' }}
                  variant="secondary"
                >
                  {savingSetting === 'enabled' ? 'Saving…' : settings?.enabled ? 'Disable AI' : 'Enable AI'}
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Anonymous AI</p>
                  <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{settings?.allowAnonymous ? 'Anonymous access allowed' : 'Anonymous access blocked'}</p>
                  <p className="mt-1 text-xs text-zinc-500">Controls whether future unauthenticated AI entry points may use the configured providers.</p>
                </div>
                <Button
                  className={settings?.allowAnonymous ? 'btn-danger' : 'btn-secondary'}
                  isDisabled={!settings || savingSetting !== ''}
                  onPress={() => {
                    if (!settings) {
                      return;
                    }
                    void handleUpdateSettings({ allowAnonymous: !settings.allowAnonymous }, 'allowAnonymous');
                  }}
                  style={{ alignSelf: 'flex-start' }}
                  variant="secondary"
                >
                  {savingSetting === 'allowAnonymous' ? 'Saving…' : settings?.allowAnonymous ? 'Disable anonymous AI' : 'Enable anonymous AI'}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Configured providers', value: String(providers.length) },
              { label: 'Supported runtimes', value: String(supportedProviders.length) },
              { label: 'Default provider', value: defaultProvider?.label ?? 'None' },
              { label: 'Selected provider', value: selectedProvider?.label ?? 'New provider' },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{item.label}</p>
                <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {supportedProviders.map((provider) => (
              <span key={provider.type} className="rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: 'var(--glass-border)', background: 'var(--app-bg)', color: 'var(--text-secondary)' }}>
                {provider.label}
              </span>
            ))}
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="rounded-2xl border px-4 py-6 text-sm text-zinc-500" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                Loading AI providers…
              </div>
            ) : providers.length === 0 ? (
              <div className="rounded-2xl border px-4 py-6 text-sm text-zinc-500" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                No provider configured yet.
              </div>
            ) : providers.map((provider) => (
              <div key={provider.providerKey} className="rounded-2xl border p-4" style={{ borderColor: selectedKey === provider.providerKey ? 'rgba(124,58,237,0.35)' : 'var(--glass-border)', background: 'var(--row-hover)' }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button type="button" className="min-w-0 text-left" onClick={() => setSelectedKey(provider.providerKey)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">{provider.label}</h3>
                      {provider.isDefault ? <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-300">Default</span> : null}
                      {!provider.enabled ? <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-semibold text-zinc-400">Disabled</span> : null}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{provider.providerType} · {provider.chatModel || 'No model'}</p>
                    <p className="mt-1 text-xs text-zinc-500 break-all">{provider.baseUrl || 'No base URL set'}</p>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <Button className="btn-secondary" isDisabled={testingKey === provider.providerKey} onPress={() => handleTest(provider.providerKey)} variant="secondary">
                      {testingKey === provider.providerKey ? 'Testing…' : 'Test'}
                    </Button>
                    <Button className="btn-danger" onPress={() => handleDelete(provider.providerKey)} variant="secondary">
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel rounded-[28px] p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">{selectedProvider ? 'Edit provider' : 'Create provider'}</h2>
            <p className="mt-1 text-sm text-zinc-500">Use a stable provider key. The assistant page uses the default provider when no explicit key is chosen.</p>
          </div>

          <label className="space-y-1.5 block">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Provider key</span>
            <input className={inputCls} disabled={Boolean(selectedProvider)} value={form.providerKey} onChange={(event) => setForm((current) => ({ ...current, providerKey: event.target.value }))} placeholder="primary-openai" />
          </label>

          <label className="space-y-1.5 block">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Provider type</span>
            <select
              className={inputCls}
              disabled={Boolean(selectedProvider)}
              value={form.providerType}
              onChange={(event) => {
                const nextType = event.target.value;
                const nextMeta = supportedProviders.find((provider) => provider.type === nextType);
                setForm((current) => ({
                  ...current,
                  providerType: nextType,
                  baseUrl: nextMeta?.defaultUrl ?? current.baseUrl,
                  chatModel: nextMeta?.defaultModel ?? current.chatModel,
                }));
              }}
            >
              {supportedProviders.map((provider) => (
                <option key={provider.type} value={provider.type}>{provider.label}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Label</span>
              <input className={inputCls} value={form.label} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} placeholder="Primary OpenAI" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Chat model</span>
              <input className={inputCls} value={form.chatModel} onChange={(event) => setForm((current) => ({ ...current, chatModel: event.target.value }))} placeholder={providerTypeMeta?.defaultModel ?? 'gpt-4o-mini'} />
            </label>
          </div>

          <label className="space-y-1.5 block">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Base URL</span>
            <input className={inputCls} value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder={providerTypeMeta?.defaultUrl ?? 'https://api.openai.com/v1'} />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">API path</span>
              <input className={inputCls} value={form.apiPath} onChange={(event) => setForm((current) => ({ ...current, apiPath: event.target.value }))} placeholder="Optional override" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">API version</span>
              <input className={inputCls} value={form.apiVersion} onChange={(event) => setForm((current) => ({ ...current, apiVersion: event.target.value }))} placeholder="Optional" />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Region</span>
              <input className={inputCls} value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} placeholder="Optional" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Organization</span>
              <input className={inputCls} value={form.organization} onChange={(event) => setForm((current) => ({ ...current, organization: event.target.value }))} placeholder="Optional" />
            </label>
          </div>

          <label className="space-y-1.5 block">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">API token</span>
            <input className={inputCls} type="password" value={form.token} onChange={(event) => setForm((current) => ({ ...current, token: event.target.value }))} placeholder={selectedProvider?.tokenConfigured ? 'Leave blank to keep current token' : 'Paste provider token'} />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Embedding model</span>
              <input className={inputCls} value={form.embeddingModel} onChange={(event) => setForm((current) => ({ ...current, embeddingModel: event.target.value }))} placeholder="Optional" />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Temperature</span>
              <input className={inputCls} type="number" step="0.1" min="0" max="2" value={form.temperature} onChange={(event) => setForm((current) => ({ ...current, temperature: event.target.value }))} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Timeout</span>
              <input className={inputCls} type="number" min="1" value={form.timeoutSeconds} onChange={(event) => setForm((current) => ({ ...current, timeoutSeconds: event.target.value }))} />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Context tokens</span>
              <input className={inputCls} type="number" min="1" value={form.maxContextTokens} onChange={(event) => setForm((current) => ({ ...current, maxContextTokens: event.target.value }))} />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Output tokens</span>
              <input className={inputCls} type="number" min="1" value={form.maxOutputTokens} onChange={(event) => setForm((current) => ({ ...current, maxOutputTokens: event.target.value }))} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
              <input checked={form.enabled} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" />
              <span className="text-sm text-zinc-700 dark:text-zinc-200">Provider enabled</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
              <input checked={form.isDefault} onChange={(event) => setForm((current) => ({ ...current, isDefault: event.target.checked }))} type="checkbox" />
              <span className="text-sm text-zinc-700 dark:text-zinc-200">Use as default provider</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button className="btn-primary" isDisabled={saving || !form.providerKey.trim()} onPress={handleSave} variant="primary">
              {saving ? 'Saving…' : selectedProvider ? 'Save changes' : 'Create provider'}
            </Button>
            {selectedProvider ? (
              <Button className="btn-secondary" onPress={() => setForm(toFormState(selectedProvider))} variant="secondary">
                Reset
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}