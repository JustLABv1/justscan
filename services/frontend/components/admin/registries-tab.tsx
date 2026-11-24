'use client';

import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { useToast } from '@/components/toast';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { StatusDot, StatusTag, type StatusDotTone } from '@/components/ui/status-dot';
import {
  AUTH_TYPE_LABELS,
  HEALTH_LABELS,
  SCAN_PROVIDER_LABELS,
  labelFor,
  summarizeError,
} from '@/lib/labels';
import { fullDate } from '@/lib/time';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { XrayModeSelector } from '@/components/registries/xray-mode-selector';
import { FormAlert, StatusAlert } from '@/components/ui/form-alert';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  adminCreateGlobalRegistry,
  adminDeleteGlobalRegistry,
  adminListGlobalRegistries,
  adminSetDefaultRegistry,
  adminUnsetDefaultRegistry,
  adminUpdateGlobalRegistry,
} from '@/lib/api/admin';
import type {
  Registry,
  RegistryWithHealth,
  ScanProvider,
  XrayMode,
} from '@/lib/api/types/registries';
import { deferEffect } from '@/lib/defer-effect';
import {
  Button,
  Card,
  Chip,
  Input,
  ListBox,
  DetailSheet,
  ResourceList,
  SearchField,
  Select,
  useOverlayState,
} from '@/components/ui';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Shield01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

const HEALTH_TONES: Record<string, StatusDotTone> = {
  healthy: 'success',
  unhealthy: 'danger',
  unknown: 'muted',
};

export function RegistriesTab() {
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();
  const [search, setSearch] = useState('');

  const [editingRegistry, setEditingRegistry] = useState<RegistryWithHealth | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [xrayUrl, setXrayUrl] = useState('');
  const [xrayArtifactoryId, setXrayArtifactoryId] = useState('default');
  const [xrayRepository, setXrayRepository] = useState('');
  const [xrayMode, setXrayMode] = useState<XrayMode>('limited');
  const [authType, setAuthType] = useState<'none' | 'basic' | 'token' | 'aws_ecr'>('none');
  const [scanProvider, setScanProvider] = useState<ScanProvider>('trivy');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [registryStep, setRegistryStep] = useState(0);

  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminListGlobalRegistries();
      setRegistries(response.data ?? []);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load global registries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  const filteredRegistries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return registries.filter(
      (registry) =>
        q.length === 0 ||
        registry.name.toLowerCase().includes(q) ||
        registry.url.toLowerCase().includes(q) ||
        registry.scan_provider.toLowerCase().includes(q)
    );
  }, [registries, search]);

  function resetForm(registry?: RegistryWithHealth | null) {
    setEditingRegistry(registry ?? null);
    setName(registry?.name ?? '');
    setUrl(registry?.url ?? '');
    setXrayUrl(registry?.xray_url ?? '');
    setXrayArtifactoryId(registry?.xray_artifactory_id ?? 'default');
    setXrayRepository(registry?.xray_repository ?? '');
    setXrayMode(registry?.xray_mode ?? 'limited');
    setAuthType(registry?.auth_type ?? 'none');
    setScanProvider(registry?.scan_provider ?? 'trivy');
    setUsername('');
    setPassword('');
    setFormError('');
  }

  function openCreate() {
    resetForm();
    setRegistryStep(0);
    modal.open();
  }

  function openEdit(registry: RegistryWithHealth) {
    resetForm(registry);
    setRegistryStep(0);
    modal.open();
  }

  function requiredLabel(text: string) {
    return (
      <span>
        {text} <span className="text-destructive">*</span>
      </span>
    );
  }

  function validateRegistryStep(step: number) {
    if (step === 0) {
      if (!name.trim() || !url.trim()) {
        return 'Registry name and endpoint are required.';
      }
    }
    if (step === 1 && scanProvider === 'artifactory_xray' && !xrayUrl.trim()) {
      return 'Xray URL is required for Artifactory Xray provider.';
    }
    return '';
  }

  function goToNextRegistryStep() {
    const validationError = validateRegistryStep(registryStep);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError('');
    setRegistryStep((current) => Math.min(current + 1, 2));
  }

  function handleRegistryPrimaryAction() {
    if (registryStep < 2) {
      goToNextRegistryStep();
      return;
    }
    const form = document.getElementById('global-registry-form') as HTMLFormElement | null;
    form?.requestSubmit();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError('');

    try {
      const payload = {
        name: name.trim(),
        url: url.trim(),
        xray_url: scanProvider === 'artifactory_xray' ? xrayUrl.trim() || undefined : undefined,
        xray_artifactory_id:
          scanProvider === 'artifactory_xray' ? xrayArtifactoryId.trim() || 'default' : undefined,
        xray_repository:
          scanProvider === 'artifactory_xray' ? xrayRepository.trim() || undefined : undefined,
        xray_mode: scanProvider === 'artifactory_xray' ? xrayMode : undefined,
        auth_type: authType,
        scan_provider: scanProvider,
        ...(!editingRegistry || username.trim() ? { username: username.trim() } : {}),
        ...(password.trim() ? { password: password.trim() } : {}),
      };

      if (editingRegistry) {
        await adminUpdateGlobalRegistry(editingRegistry.id, payload);
      } else {
        await adminCreateGlobalRegistry(payload);
      }

      modal.close();
      await load();
      toast.success(editingRegistry ? 'Registry updated' : 'Registry created');
    } catch (saveError: unknown) {
      setFormError(
        saveError instanceof Error ? saveError.message : 'Failed to save global registry'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, registryName: string) {
    const ok = await confirm({
      title: 'Delete Registry',
      message: `Remove global registry "${registryName}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await adminDeleteGlobalRegistry(id);
      await load();
      toast.success('Registry deleted');
    } catch (deleteError: unknown) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Failed to delete registry');
    }
  }

  async function handleSetDefault(registry: Registry) {
    try {
      if (registry.is_default) {
        await adminUnsetDefaultRegistry(registry.id);
      } else {
        await adminSetDefaultRegistry(registry.id);
      }
      await load();
      toast.success(registry.is_default ? 'Default registry cleared' : 'Default registry updated');
    } catch (defaultError: unknown) {
      toast.error(
        defaultError instanceof Error ? defaultError.message : 'Failed to update default registry'
      );
    }
  }

  return (
    <AdminPageShell
      actions={
        <Button size="sm" onPress={openCreate}>
          <PlusSignIcon size={15} />
          Add registry
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <StatusAlert status="danger" title="Registries failed to load" description={error} />
        ) : null}

        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b border-border p-4">
            <FilterToolbar
              search={
                <SearchField
                  aria-label="Filter registries"
                  name="admin-registry-search"
                  variant="secondary"
                  className="w-full sm:max-w-md"
                  value={search}
                  onChange={setSearch}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="Filter by name, URL, or provider..." />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
              }
            />
          </div>

          {filteredRegistries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {loading
                ? 'Loading registries...'
                : registries.length === 0
                  ? 'No global registries yet. Add one to share it with every workspace.'
                  : 'No registries match your filter.'}
            </p>
          ) : (
            <ResourceList bordered={false} aria-label="Global registries">
              {filteredRegistries.map((registry) => {
                const tone = HEALTH_TONES[registry.health_status] ?? 'muted';
                return (
                  <ResourceList.Item
                    key={registry.id}
                    media={<StatusDot tone={tone} />}
                    title={registry.name}
                    tone={registry.health_status === 'unhealthy' ? 'danger' : 'default'}
                    description={
                      <span title={registry.url}>
                        {registry.url} ·{' '}
                        {labelFor(SCAN_PROVIDER_LABELS, registry.scan_provider || 'trivy')} ·{' '}
                        {labelFor(AUTH_TYPE_LABELS, registry.auth_type || 'none')}
                      </span>
                    }
                    meta={
                      <>
                        {registry.is_default ? (
                          <Chip size="sm" color="accent">
                            Default
                          </Chip>
                        ) : null}
                        <span
                          title={
                            [
                              registry.health_message,
                              registry.last_health_check_at
                                ? `Checked ${fullDate(registry.last_health_check_at)}`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ') || undefined
                          }
                        >
                          <StatusTag tone={tone}>
                            {labelFor(HEALTH_LABELS, registry.health_status)}
                          </StatusTag>
                        </span>
                      </>
                    }
                    actions={
                      <RowActionsMenu
                        label={`Open actions for registry ${registry.name}`}
                        items={[
                          {
                            id: 'edit',
                            label: 'Edit registry',
                            icon: <PencilEdit01Icon size={15} />,
                            onAction: () => openEdit(registry),
                          },
                          {
                            id: 'toggle-default',
                            label: registry.is_default ? 'Unset default' : 'Set as default',
                            icon: <Shield01Icon size={15} />,
                            onAction: () => {
                              void handleSetDefault(registry);
                            },
                          },
                          {
                            id: 'delete',
                            label: 'Delete registry',
                            icon: <Delete01Icon size={15} />,
                            variant: 'danger',
                            onAction: () => {
                              void handleDelete(registry.id, registry.name);
                            },
                          },
                        ]}
                      />
                    }
                  >
                    {registry.health_status === 'unhealthy' && registry.health_message ? (
                      <p
                        className="truncate text-xs text-destructive"
                        title={registry.health_message}
                      >
                        {summarizeError(registry.health_message)}
                      </p>
                    ) : null}
                  </ResourceList.Item>
                );
              })}
            </ResourceList>
          )}
        </Card>

        <DetailSheet state={modal}>
          <DetailSheet.Backdrop isDismissable={false}>
            <DetailSheet.Container size="lg">
              <DetailSheet.Dialog>
                <DetailSheet.Header>
                  <DetailSheet.Heading>
                    {editingRegistry ? 'Edit registry' : 'Add registry'}
                  </DetailSheet.Heading>
                  <DetailSheet.CloseTrigger />
                </DetailSheet.Header>
                <DetailSheet.Body>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Configure global registry connectivity in three guided steps.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <Chip
                        variant={registryStep === 0 ? 'primary' : 'soft'}
                        color={registryStep === 0 ? 'accent' : 'default'}
                      >
                        1. Basics
                      </Chip>
                      <Chip
                        variant={registryStep === 1 ? 'primary' : 'soft'}
                        color={registryStep === 1 ? 'accent' : 'default'}
                      >
                        2. Scanner
                      </Chip>
                      <Chip
                        variant={registryStep === 2 ? 'primary' : 'soft'}
                        color={registryStep === 2 ? 'accent' : 'default'}
                      >
                        3. Credentials
                      </Chip>
                    </div>
                    <form id="global-registry-form" onSubmit={handleSubmit} className="space-y-4">
                      {formError ? (
                        <FormAlert title="Registry not saved" description={formError} />
                      ) : null}

                      {registryStep === 0 && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1 min-w-0">
                            <p className="text-xs text-muted-foreground">
                              {requiredLabel('Registry name')}
                            </p>
                            <Input
                              className="w-full"
                              variant="secondary"
                              placeholder="Production Docker Hub Mirror"
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                              required
                            />
                          </div>
                          <div className="space-y-1 min-w-0">
                            <p className="text-xs text-muted-foreground">
                              {requiredLabel('Registry URL')}
                            </p>
                            <Input
                              className="w-full"
                              variant="secondary"
                              placeholder="https://registry.example.com"
                              value={url}
                              onChange={(event) => setUrl(event.target.value)}
                              required
                            />
                          </div>
                        </div>
                      )}

                      {registryStep === 1 && (
                        <div className="space-y-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1 min-w-0">
                              <p className="text-xs text-muted-foreground">Scan provider</p>
                              <Select
                                aria-label="Scan provider"
                                className="w-full"
                                value={scanProvider}
                                onChange={(value) => setScanProvider(value as ScanProvider)}
                                variant="secondary"
                              >
                                <Select.Trigger>
                                  <Select.Value />
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    <ListBox.Item id="trivy">Trivy</ListBox.Item>
                                    <ListBox.Item id="artifactory_xray">
                                      Artifactory Xray
                                    </ListBox.Item>
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </div>
                            <div className="space-y-1 min-w-0">
                              <p className="text-xs text-muted-foreground">Authentication</p>
                              <Select
                                aria-label="Authentication"
                                className="w-full"
                                value={authType}
                                onChange={(value) =>
                                  setAuthType(value as 'none' | 'basic' | 'token' | 'aws_ecr')
                                }
                                variant="secondary"
                              >
                                <Select.Trigger>
                                  <Select.Value />
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    <ListBox.Item id="none">No authentication</ListBox.Item>
                                    <ListBox.Item id="basic">Username and password</ListBox.Item>
                                    <ListBox.Item id="token">Token</ListBox.Item>
                                    <ListBox.Item id="aws_ecr">AWS ECR</ListBox.Item>
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            </div>
                          </div>
                          {scanProvider === 'artifactory_xray' && (
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-1 min-w-0 md:col-span-2">
                                <p className="text-xs text-muted-foreground">
                                  {requiredLabel('Xray URL')}
                                </p>
                                <Input
                                  className="w-full"
                                  variant="secondary"
                                  placeholder="https://xray.example.com"
                                  value={xrayUrl}
                                  onChange={(event) => setXrayUrl(event.target.value)}
                                  required
                                />
                              </div>
                              <div className="space-y-1 min-w-0">
                                <p className="text-xs text-muted-foreground">Artifactory ID</p>
                                <Input
                                  className="w-full"
                                  variant="secondary"
                                  placeholder="default"
                                  value={xrayArtifactoryId}
                                  onChange={(event) => setXrayArtifactoryId(event.target.value)}
                                />
                              </div>
                              <div className="space-y-1 min-w-0">
                                <p className="text-xs text-muted-foreground">Repository key</p>
                                <Input
                                  className="w-full"
                                  variant="secondary"
                                  placeholder="docker-remote"
                                  value={xrayRepository}
                                  onChange={(event) => setXrayRepository(event.target.value)}
                                />
                              </div>
                              <div className="md:col-span-2">
                                <XrayModeSelector value={xrayMode} onChange={setXrayMode} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {registryStep === 2 && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1 min-w-0">
                            <p className="text-xs text-muted-foreground">Username</p>
                            <Input
                              className="w-full"
                              variant="secondary"
                              placeholder={
                                editingRegistry
                                  ? 'Leave blank to keep current username'
                                  : 'Username'
                              }
                              value={username}
                              onChange={(event) => setUsername(event.target.value)}
                            />
                          </div>
                          <div className="space-y-1 min-w-0">
                            <p className="text-xs text-muted-foreground">
                              {editingRegistry
                                ? 'Password or token'
                                : requiredLabel('Password or token')}
                            </p>
                            <Input
                              className="w-full"
                              type="password"
                              variant="secondary"
                              placeholder={
                                editingRegistry
                                  ? 'Leave blank to keep existing secret'
                                  : 'Password or token'
                              }
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              required={!editingRegistry && authType !== 'none'}
                            />
                          </div>
                        </div>
                      )}
                    </form>
                  </div>
                </DetailSheet.Body>
                <DetailSheet.Footer>
                  <Button type="button" variant="secondary" onPress={modal.close}>
                    Cancel
                  </Button>
                  {registryStep > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onPress={() => setRegistryStep((current) => Math.max(current - 1, 0))}
                    >
                      Back
                    </Button>
                  )}
                  {registryStep < 2 ? (
                    <Button type="button" variant="primary" onPress={handleRegistryPrimaryAction}>
                      Next
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      isDisabled={saving}
                      onPress={handleRegistryPrimaryAction}
                    >
                      {saving ? 'Saving...' : editingRegistry ? 'Save registry' : 'Create registry'}
                    </Button>
                  )}
                </DetailSheet.Footer>
              </DetailSheet.Dialog>
            </DetailSheet.Container>
          </DetailSheet.Backdrop>
        </DetailSheet>

        {confirmDialog}
      </div>
    </AdminPageShell>
  );
}
