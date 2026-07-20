'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { OwnershipTransfer } from '@/components/ownership-transfer';
import { XrayModeSelector } from '@/components/registries/xray-mode-selector';
import { useToast } from '@/components/toast';
import { OwnershipBadge } from '@/components/ui/badges';
import { EmptyState } from '@/components/ui/empty-state';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createRegistry,
  deleteRegistry,
  getDefaultScannerCapabilities,
  getTokenType,
  getWorkScope,
  listRegistriesWithCapabilities,
  listRegistryShares,
  RegistryWithHealth,
  ResourceShare,
  ScannerCapabilities,
  shareRegistry,
  testRegistry,
  transferRegistryOwnership,
  unshareRegistry,
  updateRegistry,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import { timeAgo } from '@/lib/time';
import {
  Alert,
  Button,
  Card,
  ListBox,
  Modal,
  SearchField,
  Select,
  Spinner,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  ServerStack01Icon,
  Shield01Icon,
  TestTube01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { XrayMode } from '@/lib/api/types/registries';

const selectTriggerCls = heroSelectTriggerClassName;

const AUTH_TYPE_LABEL: Record<string, string> = {
  none: 'Public',
  basic: 'Basic auth',
  token: 'Token',
  aws_ecr: 'AWS ECR',
};
const AUTH_TYPE_STYLE: Record<string, React.CSSProperties> = {
  none: {
    color: '#a1a1aa',
    background: 'rgba(161,161,170,0.08)',
    border: '1px solid rgba(161,161,170,0.15)',
  },
  basic: {
    color: '#60a5fa',
    background: 'rgba(59,130,246,0.1)',
    border: '1px solid rgba(59,130,246,0.2)',
  },
  token: {
    color: 'color-mix(in srgb, var(--accent) 78%, white)',
    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
    border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
  },
  aws_ecr: {
    color: '#fb923c',
    background: 'rgba(249,115,22,0.1)',
    border: '1px solid rgba(249,115,22,0.2)',
  },
};

const PROVIDER_LABEL: Record<string, string> = {
  trivy: 'Trivy',
  artifactory_xray: 'Artifactory Xray',
};

const PROVIDER_STYLE: Record<string, React.CSSProperties> = {
  trivy: {
    color: '#22c55e',
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.2)',
  },
  artifactory_xray: {
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)',
    border: '1px solid rgba(245,158,11,0.2)',
  },
};

function HealthBadge({ status, message }: { status: string; message: string }) {
  const cfg = (
    {
      healthy: {
        color: '#34d399',
        bg: 'rgba(16,185,129,0.1)',
        border: 'rgba(16,185,129,0.2)',
        label: 'Healthy',
      },
      unhealthy: {
        color: '#f87171',
        bg: 'rgba(239,68,68,0.1)',
        border: 'rgba(239,68,68,0.2)',
        label: 'Unhealthy',
      },
      unknown: {
        color: '#a1a1aa',
        bg: 'rgba(161,161,170,0.08)',
        border: 'rgba(161,161,170,0.15)',
        label: 'Unknown',
      },
    } as Record<string, { color: string; bg: string; border: string; label: string }>
  )[status] ?? {
    color: '#a1a1aa',
    bg: 'rgba(161,161,170,0.08)',
    border: 'rgba(161,161,170,0.15)',
    label: status,
  };
  return (
    <span
      className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
      title={message}
    >
      <span className="size-1.5 rounded-full" style={{ background: cfg.color }} />
      {cfg.label}
    </span>
  );
}

export default function RegistriesPage() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const { orgs, orgNamesById } = useOrgDirectory();
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>(
    getDefaultScannerCapabilities()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RegistryWithHealth | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [xrayUrl, setXrayUrl] = useState('');
  const [xrayArtifactoryId, setXrayArtifactoryId] = useState('default');
  const [xrayRepository, setXrayRepository] = useState('');
  const [xrayMode, setXrayMode] = useState<XrayMode>('limited');
  const [authType, setAuthType] = useState<'none' | 'basic' | 'token' | 'aws_ecr'>('none');
  const [scanProvider, setScanProvider] = useState<'trivy' | 'artifactory_xray'>('trivy');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<RegistryWithHealth | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareOrgId, setShareOrgId] = useState('');
  const [transferOrgId, setTransferOrgId] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<'all' | 'trivy' | 'artifactory_xray'>('all');
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const isPlatformAdmin = getTokenType() === 'admin';
  const orgRoleById = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.current_user_role] as const)),
    [orgs]
  );
  const canMutateActiveScope =
    isPlatformAdmin || workScope.kind !== 'org' || canMutateOrg(orgRoleById.get(workScope.orgId));
  const manageableOrgIds = new Set<string>();
  for (const org of orgs) {
    if (canManageOrg(org.current_user_role)) manageableOrgIds.add(org.id);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listRegistriesWithCapabilities();
      setRegistries(response.data);
      setCapabilities(response.capabilities);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load, scopeKey]);

  function openCreate() {
    if (!canMutateActiveScope) return;
    setEditing(null);
    setName('');
    setUrl('');
    setXrayUrl('');
    setXrayArtifactoryId('default');
    setXrayRepository('');
    setXrayMode('limited');
    setAuthType('none');
    setScanProvider(capabilities.enable_trivy ? 'trivy' : 'artifactory_xray');
    setUsername('');
    setPassword('');
    setFormError('');
    modal.open();
  }
  function openEdit(r: RegistryWithHealth) {
    if (!canMutateRegistry(r)) return;
    setEditing(r);
    setName(r.name);
    setUrl(r.url);
    setXrayUrl(r.xray_url ?? '');
    setXrayArtifactoryId(r.xray_artifactory_id ?? 'default');
    setXrayRepository(r.xray_repository ?? '');
    setXrayMode(r.xray_mode ?? 'limited');
    setAuthType(r.auth_type ?? 'none');
    setScanProvider(r.scan_provider ?? 'trivy');
    setUsername(r.username ?? '');
    setPassword('');
    setFormError('');
    modal.open();
  }
  function canMutateRegistry(registry: RegistryWithHealth) {
    if (registry.owner_type === 'system') return isPlatformAdmin;
    if (isPlatformAdmin) return true;
    if (registry.owner_type === 'org' && registry.owner_org_id) {
      return canMutateOrg(orgRoleById.get(registry.owner_org_id));
    }
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    if (editing ? !canMutateRegistry(editing) : !canMutateActiveScope) return;
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const currentScope = getWorkScope();
      const payload = {
        name,
        url,
        xray_url: scanProvider === 'artifactory_xray' ? xrayUrl || undefined : undefined,
        xray_artifactory_id:
          scanProvider === 'artifactory_xray' ? xrayArtifactoryId || 'default' : undefined,
        xray_repository:
          scanProvider === 'artifactory_xray' ? xrayRepository.trim() || undefined : undefined,
        xray_mode: scanProvider === 'artifactory_xray' ? xrayMode : undefined,
        auth_type: authType,
        scan_provider: scanProvider,
        username,
        ...(password ? { password } : {}),
        ...(currentScope.kind === 'org' ? { org_id: currentScope.orgId } : {}),
      };
      if (editing) {
        await updateRegistry(editing.id, payload);
        toast.success('Registry updated');
      } else {
        await createRegistry(payload);
        toast.success('Registry added');
      }
      modal.close();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }
  async function handleDelete(id: string) {
    const registry = registries.find((candidate) => candidate.id === id);
    if (registry && !canMutateRegistry(registry)) return;
    const ok = await confirm({
      title: 'Delete registry?',
      message: 'The registry configuration will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteRegistry(id).catch(() => {});
    toast.success('Registry deleted');
    load();
  }
  async function handleTest(id: string) {
    const registry = registries.find((candidate) => candidate.id === id);
    if (registry && !canMutateRegistry(registry)) return;
    setTesting(id);
    try {
      await testRegistry(id);
      toast.success('Connection test passed');
      await load();
    } catch {
      toast.error('Connection test failed');
      await load();
    } finally {
      setTesting(null);
    }
  }

  function canManageAccess(registry: RegistryWithHealth) {
    if (isPlatformAdmin) return true;
    if (registry.owner_type === 'org' && registry.owner_org_id) {
      return canManageOrg(orgRoleById.get(registry.owner_org_id));
    }
    return true;
  }

  async function loadShares(registryId: string) {
    setSharesLoading(true);
    setShareError('');
    try {
      setShares(await listRegistryShares(registryId));
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to load access grants');
    } finally {
      setSharesLoading(false);
    }
  }

  function openShareModal(registry: RegistryWithHealth) {
    if (!canManageAccess(registry)) return;
    setShareTarget(registry);
    setShares([]);
    setShareOrgId('');
    setTransferOrgId('');
    setShareError('');
    shareModal.open();
    void loadShares(registry.id);
  }

  async function handleGrantShare() {
    if (!shareTarget || !shareOrgId || !canManageAccess(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await shareRegistry(shareTarget.id, shareOrgId);
      toast.success('Registry access granted');
      setShareOrgId('');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleRevokeShare(orgId: string) {
    if (!shareTarget || !canManageAccess(shareTarget)) return;
    setShareSaving(true);
    setShareError('');
    try {
      await unshareRegistry(shareTarget.id, orgId);
      toast.success('Registry access revoked');
      await loadShares(shareTarget.id);
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleTransferOwnership() {
    if (
      !shareTarget ||
      !transferOrgId ||
      shareTarget.owner_type !== 'org' ||
      !canManageAccess(shareTarget)
    )
      return;
    const destination =
      orgs.find((org) => org.id === transferOrgId)?.name ?? 'the selected organization';
    const ok = await confirm({
      title: `Transfer registry ownership to ${destination}?`,
      message:
        'The current owner will retain shared access and existing organization grants will remain.',
      confirmLabel: 'Transfer',
      variant: 'danger',
    });
    if (!ok) return;
    setShareSaving(true);
    setShareError('');
    try {
      await transferRegistryOwnership(shareTarget.id, transferOrgId);
      toast.success('Registry ownership transferred');
      shareModal.close();
      await load();
    } catch (err: unknown) {
      setShareError(err instanceof Error ? err.message : 'Failed to transfer ownership');
    } finally {
      setShareSaving(false);
    }
  }

  const availableShareTargets = shareTarget
    ? orgs.filter(
        (org) =>
          (isPlatformAdmin || manageableOrgIds.has(org.id)) &&
          org.id !== shareTarget.owner_org_id &&
          !shares.some((share) => share.org_id === org.id)
      )
    : [];
  const transferTargets =
    shareTarget?.owner_type === 'org'
      ? orgs.filter(
          (org) =>
            (isPlatformAdmin || manageableOrgIds.has(org.id)) && org.id !== shareTarget.owner_org_id
        )
      : [];
  const filteredRegistries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return registries.filter((registry) => {
      const providerMatches =
        providerFilter === 'all' || (registry.scan_provider ?? 'trivy') === providerFilter;
      if (!providerMatches) return false;
      if (!query) return true;
      return [registry.name, registry.url, registry.username]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [providerFilter, registries, searchQuery]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Registries"
        description="Configure private Docker registries and choose the scan provider per registry."
        actions={
          registries.length > 0 ? (
            <Button
              onPress={openCreate}
              className="inline-flex items-center gap-2"
              type="button"
              isDisabled={!canMutateActiveScope}
              variant="primary"
            >
              <PlusSignIcon size={15} /> Add Registry
            </Button>
          ) : undefined
        }
      />

      {error ? <FormAlert description={error} title="Registry loading failed" /> : null}

      {!loading && registries.length === 0 ? (
        <EmptyState
          icon={<ServerStack01Icon size={28} />}
          title="No registries configured"
          description="Add a private Docker registry and choose the scanner that will evaluate images from it."
          action={canMutateActiveScope ? { label: 'Add Registry', onClick: openCreate } : undefined}
        />
      ) : (
        <Card className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SearchField
              name="registries-search"
              variant="secondary"
              className="w-full sm:max-w-sm"
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search registry, URL, or username..."
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Select
              value={providerFilter}
              onChange={(value) =>
                setProviderFilter(
                  value === 'artifactory_xray'
                    ? 'artifactory_xray'
                    : value === 'trivy'
                      ? 'trivy'
                      : 'all'
                )
              }
              className="w-full sm:w-[180px]"
              variant="secondary"
            >
              <Select.Trigger className={selectTriggerCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all">All providers</ListBox.Item>
                  <ListBox.Item id="trivy">Trivy</ListBox.Item>
                  <ListBox.Item id="artifactory_xray">Artifactory Xray</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          {loading ? (
            <div className="flex min-h-48 items-center justify-center">
              <Spinner color="accent" size="sm" />
            </div>
          ) : filteredRegistries.length === 0 ? (
            <EmptyState
              icon={<ServerStack01Icon size={28} />}
              title="No registries match your filters"
              description="Try a different search or provider filter."
              action={{
                label: 'Clear filters',
                onClick: () => {
                  setSearchQuery('');
                  setProviderFilter('all');
                },
              }}
            />
          ) : (
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Configured registries" className="min-w-[800px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Name</Table.Column>
                    <Table.Column>Connection</Table.Column>
                    <Table.Column>Health</Table.Column>
                    <Table.Column className="flex justify-end">Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {filteredRegistries.map((r) => (
                      <Table.Row key={r.id} id={r.id}>
                        <Table.Cell>
                          <div className="space-y-1">
                            <p className="font-medium text-zinc-700 dark:text-zinc-200">{r.name}</p>
                            <OwnershipBadge
                              ownerType={r.owner_type}
                              ownerOrgId={r.owner_org_id}
                              orgNamesById={orgNamesById}
                            />
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="space-y-1.5">
                            <p className="font-mono text-xs text-muted">{r.url}</p>
                            <div className="flex flex-wrap gap-1.5">
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-md"
                                style={PROVIDER_STYLE[r.scan_provider ?? 'trivy']}
                              >
                                {PROVIDER_LABEL[r.scan_provider ?? 'trivy']}
                              </span>
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-md"
                                style={AUTH_TYPE_STYLE[r.auth_type ?? 'none']}
                              >
                                {AUTH_TYPE_LABEL[r.auth_type ?? 'none']}
                              </span>
                              {r.username ? (
                                <span className="text-xs text-muted">{r.username}</span>
                              ) : null}
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex flex-col gap-1">
                            <HealthBadge
                              status={r.health_status ?? 'unknown'}
                              message={r.health_message ?? ''}
                            />
                            {r.last_health_check_at && (
                              <span className="text-[10px] text-zinc-500">
                                {timeAgo(r.last_health_check_at)}
                              </span>
                            )}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex items-center justify-end">
                            {canManageAccess(r) || canMutateRegistry(r) ? (
                              <RowActionsMenu
                                label={`Open actions menu for ${r.name}`}
                                items={[
                                  ...(canMutateRegistry(r)
                                    ? [
                                        {
                                          id: 'test',
                                          label: testing === r.id ? 'Testing…' : 'Test connection',
                                          icon: <TestTube01Icon size={15} />,
                                          disabled: testing === r.id,
                                          onAction: () => {
                                            void handleTest(r.id);
                                          },
                                        },
                                      ]
                                    : []),
                                  ...(canManageAccess(r)
                                    ? [
                                        {
                                          id: 'share',
                                          label: 'Manage access',
                                          icon: <Shield01Icon size={15} />,
                                          onAction: () => openShareModal(r),
                                        },
                                      ]
                                    : []),
                                  ...(canMutateRegistry(r)
                                    ? [
                                        {
                                          id: 'edit',
                                          label: 'Edit registry',
                                          icon: <PencilEdit01Icon size={15} />,
                                          onAction: () => openEdit(r),
                                        },
                                        {
                                          id: 'delete',
                                          label: 'Delete registry',
                                          icon: <Delete01Icon size={15} />,
                                          variant: 'danger' as const,
                                          onAction: () => {
                                            void handleDelete(r.id);
                                          },
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            ) : (
                              <span className="text-xs text-zinc-400">Read only</span>
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </Card>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container className="px-3 sm:px-6" size="lg" placement="center" scroll="inside">
            <Modal.Dialog className="max-w-3xl">
              <Modal.Header className="border-b border-surface-border px-6 py-5 sm:px-8">
                <div className="min-w-0">
                  <Modal.Heading>{editing ? 'Edit Registry' : 'Add Registry'}</Modal.Heading>
                  <p className="mt-1 text-sm text-muted">
                    Configure connectivity, scan behavior, and credentials in one place.
                  </p>
                </div>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="px-6 py-6 sm:px-8">
                <form id="registry-form" onSubmit={handleSubmit} className="space-y-6">
                  {formError ? (
                    <FormAlert description={formError} title="Registry save failed" />
                  ) : null}
                  <Card variant="secondary" className="gap-0 overflow-hidden">
                    <Card.Header className="border-b border-surface-border px-5 py-4">
                      <Card.Title>Registry connection</Card.Title>
                      <Card.Description>
                        The endpoint JustScan uses to resolve and pull images.
                      </Card.Description>
                    </Card.Header>
                    <Card.Content className="grid gap-4 p-5 md:grid-cols-2">
                      <FormField
                        label="Name"
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Registry"
                        required
                        value={name}
                        className="bg-surface-primary"
                        variant="primary"
                      />
                      <FormField
                        className="bg-surface-primary"
                        label="URL"
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://registry.example.com"
                        required
                        value={url}
                        variant="primary"
                      />
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-sm font-medium">Scan Provider</label>
                        <Select
                          variant="primary"
                          value={scanProvider}
                          onChange={(value) =>
                            setScanProvider(value as 'trivy' | 'artifactory_xray')
                          }
                        >
                          <Select.Trigger className={selectTriggerCls + ' bg-surface-primary'}>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="shrink-0 text-zinc-400">
                                <ServerStack01Icon size={15} />
                              </span>
                              <Select.Value />
                            </div>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="trivy" isDisabled={!capabilities.enable_trivy}>
                                Trivy (built-in JustScan scanner)
                              </ListBox.Item>
                              <ListBox.Item id="artifactory_xray">Artifactory Xray</ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        <p className="text-xs text-muted">
                          This is stored in JustScan and does not require editing backend/config.yaml.
                        </p>
                        {!capabilities.enable_trivy && scanProvider === 'trivy' && editing && (
                          <p className="text-xs text-warning">
                            This registry must be switched to Artifactory Xray before saving changes.
                          </p>
                        )}
                      </div>
                    </Card.Content>
                  </Card>
                  {scanProvider === 'artifactory_xray' && (
                    <Card variant="secondary" className="gap-0 overflow-hidden">
                      <Card.Header className="border-b border-surface-border px-5 py-4">
                        <Card.Title>Xray scan behavior</Card.Title>
                        <Card.Description>
                          Map images to Artifactory and choose whether this credential can request a
                          fresh Xray scan.
                        </Card.Description>
                      </Card.Header>
                      <Card.Content className="grid gap-4 p-5 md:grid-cols-2">
                        <FormField
                          className="bg-surface-primary md:col-span-2"
                          description="Leave empty to reuse the registry URL. Set this only when the Docker host differs from the JFrog platform host."
                          label="Xray Base URL"
                          onChange={(e) => setXrayUrl(e.target.value)}
                          placeholder="https://jfrog.example.com"
                          value={xrayUrl}
                          variant="primary"
                        />
                        <FormField
                          className="bg-surface-primary"
                          description="Usually default. Prefixes artifact paths sent to Xray."
                          label="Artifactory ID"
                          onChange={(e) => setXrayArtifactoryId(e.target.value)}
                          placeholder="default"
                          value={xrayArtifactoryId}
                          variant="primary"
                        />
                        <FormField
                          className="bg-surface-primary"
                          description="Optional repo prefix, for example docker-remote."
                          label="Default Artifactory Repo"
                          onChange={(e) => setXrayRepository(e.target.value)}
                          placeholder="docker-remote"
                          value={xrayRepository}
                          variant="primary"
                        />
                        <div className="md:col-span-2">
                          <XrayModeSelector value={xrayMode} onChange={setXrayMode} />
                        </div>
                        <Alert className="md:col-span-2" status="warning">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Description>
                              Xray image names must map to an Artifactory repository path, for
                              example <span className="font-mono">test-images/debian:12-slim</span>.
                            </Alert.Description>
                          </Alert.Content>
                        </Alert>
                      </Card.Content>
                    </Card>
                  )}
                  <Card variant="secondary" className="gap-0 overflow-hidden">
                    <Card.Header className="border-b border-surface-border px-5 py-4">
                      <Card.Title>Credentials</Card.Title>
                      <Card.Description>
                        Stored encrypted and reused for image pulls and Xray requests.
                      </Card.Description>
                    </Card.Header>
                    <Card.Content className="grid gap-4 p-5 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Auth Type</label>
                        <Select
                          variant="primary"
                          value={authType}
                          onChange={(value) =>
                            setAuthType(value as 'none' | 'basic' | 'token' | 'aws_ecr')
                          }
                        >
                          <Select.Trigger className={selectTriggerCls + ' bg-surface-primary'}>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="shrink-0 text-zinc-400">
                                <Shield01Icon size={15} />
                              </span>
                              <Select.Value />
                            </div>
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="none">None (public registry)</ListBox.Item>
                              <ListBox.Item id="basic">Basic (username / password)</ListBox.Item>
                              <ListBox.Item id="token">Token</ListBox.Item>
                              <ListBox.Item id="aws_ecr">AWS ECR</ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      </div>
                      <FormField
                        className="bg-surface-primary"
                        label="Username"
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Optional"
                        value={username}
                        variant="primary"
                      />
                      <FormField
                        autoComplete="off"
                        className="bg-surface-primary md:col-span-2"
                        description={
                          editing
                            ? 'Leave blank to keep the stored password unchanged.'
                            : 'Optional unless your registry provider requires credentials.'
                        }
                        label="Password / token"
                        name="registry-password"
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={editing ? '••••••••' : 'Optional'}
                        type="password"
                        value={password}
                        variant="primary"
                      />
                    </Card.Content>
                  </Card>
                </form>
              </Modal.Body>
              <Modal.Footer className="border-t border-surface-border px-6 py-4 sm:px-8">
                <Button onPress={modal.close} type="button" variant="secondary">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="registry-form"
                  isDisabled={
                    saving || (editing ? !canMutateRegistry(editing) : !canMutateActiveScope)
                  }
                  variant="primary"
                >
                  {saving && (
                    <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {editing ? 'Save' : 'Add'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="surface-modal rounded-2xl overflow-hidden">
              <Modal.Header
                className="px-6 py-4"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Manage Registry Access
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 space-y-4">
                {shareError ? (
                  <FormAlert description={shareError} title="Access update failed" />
                ) : null}
                {shareTarget ? (
                  <div
                    className="rounded-xl px-4 py-3"
                    style={{
                      background: 'var(--row-hover)',
                      border: '1px solid var(--surface-border)',
                    }}
                  >
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {shareTarget.name}
                    </p>
                    <div className="mt-2">
                      <OwnershipBadge
                        ownerType={shareTarget.owner_type}
                        ownerOrgId={shareTarget.owner_org_id}
                        orgNamesById={orgNamesById}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Current access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Organizations listed here can use this registry.
                    </p>
                  </div>
                  {sharesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
                    </div>
                  ) : shares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {shares.map((share) => (
                        <div
                          key={share.org_id}
                          className="flex items-start justify-between gap-3 rounded-xl px-4 py-3"
                          style={{
                            background: 'var(--row-hover)',
                            border: '1px solid var(--surface-border)',
                          }}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {share.org_name}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium text-zinc-500">Locked</span>
                          ) : (
                            <Button
                              type="button"
                              onPress={() => {
                                void handleRevokeShare(share.org_id);
                              }}
                              isDisabled={shareSaving}
                              className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50"
                              isIconOnly
                              variant="secondary"
                            >
                              <Delete01Icon size={15} />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Grant access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Share this registry with another organization you manage.
                    </p>
                  </div>
                  {availableShareTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Select
                        value={shareOrgId || '__none__'}
                        onChange={(value) =>
                          setShareOrgId(String(value === '__none__' ? '' : (value ?? '')))
                        }
                        className="flex-1"
                      >
                        <Select.Trigger className={selectTriggerCls}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Select an organization</ListBox.Item>
                            {availableShareTargets.map((org) => (
                              <ListBox.Item key={org.id} id={org.id}>
                                {org.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button
                        type="button"
                        onPress={() => {
                          void handleGrantShare();
                        }}
                        isDisabled={!shareOrgId || shareSaving}
                        className="btn-primary disabled:opacity-60"
                        variant="primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
                <OwnershipTransfer
                  ownerOrgId={shareTarget?.owner_type === 'org' ? shareTarget.owner_org_id : null}
                  organizations={transferTargets}
                  selectedOrgId={transferOrgId}
                  onSelectedOrgIdChange={setTransferOrgId}
                  onTransfer={() => void handleTransferOwnership()}
                  isSaving={shareSaving}
                />
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button
                  onPress={shareModal.close}
                  className="btn-secondary"
                  type="button"
                  variant="secondary"
                >
                  Close
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
