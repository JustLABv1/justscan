'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  adminCreateGlobalRegistry,
  adminDeleteGlobalRegistry,
  adminListGlobalRegistries,
  adminSetDefaultRegistry,
  adminUnsetDefaultRegistry,
  adminUpdateGlobalRegistry,
} from '@/lib/api/admin';
import type { Registry, RegistryWithHealth, ScanProvider } from '@/lib/api/types/registries';
import { deferEffect } from '@/lib/defer-effect';
import { Button, Card, Chip, Input, ListBox, Modal, SearchField, Select, Table, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

function Banner({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <Card className={type === 'success' ? 'border border-success/30 bg-success/10' : 'border border-danger/30 bg-danger/10'}>
      <Card.Content>
        <p className={type === 'success' ? 'text-sm text-success' : 'text-sm text-danger'}>{text}</p>
      </Card.Content>
    </Card>
  );
}

export function RegistriesTab() {
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  const [editingRegistry, setEditingRegistry] = useState<RegistryWithHealth | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [xrayUrl, setXrayUrl] = useState('');
  const [xrayArtifactoryId, setXrayArtifactoryId] = useState('default');
  const [xrayRepository, setXrayRepository] = useState('');
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
    return registries.filter((registry) =>
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
        {text} <span className="text-danger">*</span>
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
        xray_artifactory_id: scanProvider === 'artifactory_xray' ? xrayArtifactoryId.trim() || 'default' : undefined,
        xray_repository: scanProvider === 'artifactory_xray' ? xrayRepository.trim() || undefined : undefined,
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
      setSuccess(editingRegistry ? 'Registry updated' : 'Registry created');
      setTimeout(() => setSuccess(''), 2500);
    } catch (saveError: unknown) {
      setFormError(saveError instanceof Error ? saveError.message : 'Failed to save global registry');
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
      setSuccess('Registry deleted');
      setTimeout(() => setSuccess(''), 2500);
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete registry');
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
      setSuccess(registry.is_default ? 'Default registry cleared' : 'Default registry updated');
      setTimeout(() => setSuccess(''), 2500);
    } catch (defaultError: unknown) {
      setError(defaultError instanceof Error ? defaultError.message : 'Failed to update default registry');
    }
  }

  return (
    <div className="space-y-4">
      {error && <Banner type="error" text={error} />}
      {success && <Banner type="success" text={success} />}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SearchField name="admin-registry-search" variant="secondary" className="w-full sm:max-w-sm">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Filter registries by name, endpoint, or provider..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button variant="secondary" onPress={openCreate}>
            <PlusSignIcon size={15} />
            Add Registry
          </Button>
        </div>

        <Table variant="secondary">
          <Table.ScrollContainer>
            <Table.Content aria-label="Global registries" className="min-w-[1080px]">
              <Table.Header>
                <Table.Column isRowHeader>Registry</Table.Column>
                <Table.Column>Endpoint</Table.Column>
                <Table.Column>Provider</Table.Column>
                <Table.Column>Auth</Table.Column>
                <Table.Column>Health</Table.Column>
                <Table.Column>Default</Table.Column>
                <Table.Column className="text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() => (
                  <div className="py-10 text-center text-sm text-zinc-500">
                    {loading ? 'Loading registries...' : 'No registries found.'}
                  </div>
                )}
              >
                {filteredRegistries.map((registry) => (
                  <Table.Row key={registry.id} id={registry.id}>
                    <Table.Cell>
                      <p className="font-medium">{registry.name}</p>
                      <p className="text-xs text-zinc-500">{registry.id}</p>
                    </Table.Cell>
                    <Table.Cell className="font-mono text-xs text-zinc-500">{registry.url}</Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500">
                      {registry.scan_provider === 'artifactory_xray' ? 'Artifactory Xray' : 'Trivy'}
                    </Table.Cell>
                    <Table.Cell className="text-xs text-zinc-500 uppercase tracking-[0.1em]">{registry.auth_type}</Table.Cell>
                    <Table.Cell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={registry.health_status === 'healthy' ? 'success' : registry.health_status === 'unhealthy' ? 'danger' : 'default'}
                      >
                        {registry.health_status}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      {registry.is_default ? (
                        <Chip size="sm" variant="soft" color="accent">Default</Chip>
                      ) : (
                        <span className="text-xs text-zinc-500">—</span>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for registry ${registry.name}`}
                          items={[
                            {
                              id: 'toggle-default',
                              label: registry.is_default ? 'Unset default' : 'Set as default',
                              onAction: () => {
                                void handleSetDefault(registry);
                              },
                            },
                            {
                              id: 'edit',
                              label: 'Edit registry',
                              icon: <PencilEdit01Icon size={15} />,
                              onAction: () => openEdit(registry),
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
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </Card>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{editingRegistry ? 'Edit Registry' : 'Add Registry'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-4">
                  <p className="text-sm text-zinc-500">
                    Configure global registry connectivity in three guided steps.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Chip variant={registryStep === 0 ? 'primary' : 'soft'} color={registryStep === 0 ? 'accent' : 'default'}>1. Basics</Chip>
                    <Chip variant={registryStep === 1 ? 'primary' : 'soft'} color={registryStep === 1 ? 'accent' : 'default'}>2. Scanner</Chip>
                    <Chip variant={registryStep === 2 ? 'primary' : 'soft'} color={registryStep === 2 ? 'accent' : 'default'}>3. Credentials</Chip>
                  </div>
                <form id="global-registry-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && <p className="text-sm text-danger">{formError}</p>}

                  {registryStep === 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1 min-w-0"><p className="text-xs text-zinc-500">{requiredLabel('Registry Name')}</p><Input className="w-full" variant="secondary" placeholder="Production Docker Hub Mirror" value={name} onChange={(event) => setName(event.target.value)} required /></div>
                      <div className="space-y-1 min-w-0"><p className="text-xs text-zinc-500">{requiredLabel('Registry URL')}</p><Input className="w-full" variant="secondary" placeholder="https://registry.example.com" value={url} onChange={(event) => setUrl(event.target.value)} required /></div>
                    </div>
                  )}

                  {registryStep === 1 && (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs text-zinc-500">Scan Provider</p>
                          <Select className="w-full" value={scanProvider} onChange={(value) => setScanProvider(value as ScanProvider)} variant="secondary">
                            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                <ListBox.Item id="trivy">Trivy</ListBox.Item>
                                <ListBox.Item id="artifactory_xray">Artifactory Xray</ListBox.Item>
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        </div>
                        <div className="space-y-1 min-w-0">
                          <p className="text-xs text-zinc-500">Authentication Type</p>
                          <Select className="w-full" value={authType} onChange={(value) => setAuthType(value as 'none' | 'basic' | 'token' | 'aws_ecr')} variant="secondary">
                            <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                <ListBox.Item id="none">None</ListBox.Item>
                                <ListBox.Item id="basic">Basic</ListBox.Item>
                                <ListBox.Item id="token">Token</ListBox.Item>
                                <ListBox.Item id="aws_ecr">AWS ECR</ListBox.Item>
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        </div>
                      </div>
                      {scanProvider === 'artifactory_xray' && (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1 min-w-0 md:col-span-2"><p className="text-xs text-zinc-500">{requiredLabel('Xray URL')}</p><Input className="w-full" variant="secondary" placeholder="https://xray.example.com" value={xrayUrl} onChange={(event) => setXrayUrl(event.target.value)} required /></div>
                          <div className="space-y-1 min-w-0"><p className="text-xs text-zinc-500">Artifactory ID</p><Input className="w-full" variant="secondary" placeholder="default" value={xrayArtifactoryId} onChange={(event) => setXrayArtifactoryId(event.target.value)} /></div>
                          <div className="space-y-1 min-w-0"><p className="text-xs text-zinc-500">Repository Key</p><Input className="w-full" variant="secondary" placeholder="docker-remote" value={xrayRepository} onChange={(event) => setXrayRepository(event.target.value)} /></div>
                        </div>
                      )}
                    </div>
                  )}

                  {registryStep === 2 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs text-zinc-500">Username</p>
                        <Input
                          className="w-full"
                          variant="secondary"
                          placeholder={editingRegistry ? 'Leave blank to keep current username' : 'Username'}
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs text-zinc-500">{editingRegistry ? 'Password / Token' : requiredLabel('Password / Token')}</p>
                        <Input
                          className="w-full"
                          type="password"
                          variant="secondary"
                          placeholder={editingRegistry ? 'Leave blank to keep existing secret' : 'Password / Token'}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          required={!editingRegistry && authType !== 'none'}
                        />
                      </div>
                    </div>
                  )}
                </form>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button type="button" variant="secondary" onPress={modal.close}>Cancel</Button>
                {registryStep > 0 && <Button type="button" variant="secondary" onPress={() => setRegistryStep((current) => Math.max(current - 1, 0))}>Back</Button>}
                {registryStep < 2 ? (
                  <Button type="button" variant="primary" onPress={handleRegistryPrimaryAction}>Next</Button>
                ) : (
                  <Button type="button" variant="primary" isDisabled={saving} onPress={handleRegistryPrimaryAction}>
                    {saving ? 'Saving...' : editingRegistry ? 'Save Registry' : 'Create Registry'}
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
