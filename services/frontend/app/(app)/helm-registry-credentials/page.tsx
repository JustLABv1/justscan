'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormField } from '@/components/ui/form-field';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadableCollectionState } from '@/components/ui/loadable-collection-state';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { useOrgDirectory } from '@/hooks/use-org-name-map';
import { useWorkScope } from '@/hooks/use-work-scope';
import {
  createHelmRegistryCredential,
  deleteHelmRegistryCredential,
  HelmRegistryCredential,
  HelmRegistryCredentialInput,
  listHelmRegistryCredentialShares,
  listHelmRegistryCredentials,
  ResourceShare,
  shareHelmRegistryCredential,
  testHelmRegistryCredential,
  transferHelmRegistryCredentialOwnership,
  unshareHelmRegistryCredential,
  updateHelmRegistryCredential,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  Button,
  Card,
  Chip,
  Description,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Table,
  useOverlayState,
} from '@heroui/react';
import {
  Delete01Icon,
  Key01Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  RefreshIcon,
  Share01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

export default function HelmRegistryCredentialsPage() {
  const workScope = useWorkScope();
  const { orgs } = useOrgDirectory();
  const { success, error } = useToast();
  const { confirm, dialog } = useConfirmDialog();
  const modal = useOverlayState();
  const shareModal = useOverlayState();
  const [items, setItems] = useState<HelmRegistryCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<HelmRegistryCredential | null>(null);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesError, setSharesError] = useState('');
  const [sharePending, setSharePending] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<HelmRegistryCredential | null>(null);
  const [shareOrgID, setShareOrgID] = useState('');
  const [transferOrgID, setTransferOrgID] = useState('');
  const [name, setName] = useState('');
  const [url, setURL] = useState('');
  const [protocol, setProtocol] = useState<'oci' | 'http'>('oci');
  const [authType, setAuthType] = useState<'basic' | 'access_token' | 'bearer_token'>(
    'access_token'
  );
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<'all' | 'oci' | 'http'>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | 'healthy' | 'unhealthy' | 'unknown'>(
    'all'
  );
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      setItems(await listHelmRegistryCredentials());
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'Could not load Helm credentials.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => deferEffect(() => void load()), [load, scopeKey]);

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (protocolFilter !== 'all' && item.protocol !== protocolFilter) return false;
      if (healthFilter !== 'all' && item.health_status !== healthFilter) return false;
      return (
        !query ||
        [item.name, item.url, item.username, item.auth_type]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query))
      );
    });
  }, [healthFilter, items, protocolFilter, searchQuery]);

  function open(item?: HelmRegistryCredential) {
    setEditing(item ?? null);
    setName(item?.name ?? '');
    setURL(item?.url ?? '');
    setProtocol(item?.protocol ?? 'oci');
    setAuthType(item?.auth_type ?? 'access_token');
    setUsername(item?.username ?? '');
    setSecret('');
    modal.open();
  }
  async function save() {
    if (saving) return;
    const data: HelmRegistryCredentialInput = {
      name,
      url,
      protocol,
      auth_type: authType,
      username,
      secret,
      ...(workScope.kind === 'org' && !editing ? { org_id: workScope.orgId } : {}),
    };
    setSaving(true);
    try {
      if (editing) await updateHelmRegistryCredential(editing.id, data);
      else await createHelmRegistryCredential(data);
      modal.close();
      await load();
      success(editing ? 'Helm credential updated.' : 'Helm credential created.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not save Helm credential.');
    } finally {
      setSaving(false);
    }
  }
  async function remove(item: HelmRegistryCredential) {
    if (
      !(await confirm({
        title: 'Delete Helm credential?',
        message: 'This cannot be deleted while a Helm source explicitly uses it.',
        confirmLabel: 'Delete',
        variant: 'danger',
      }))
    )
      return;
    const actionKey = `delete:${item.id}`;
    if (pendingAction) return;
    setPendingAction(actionKey);
    try {
      await deleteHelmRegistryCredential(item.id);
      await load();
      success('Helm credential deleted.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not delete Helm credential.');
    } finally {
      setPendingAction(null);
    }
  }
  async function test(item: HelmRegistryCredential) {
    const actionKey = `test:${item.id}`;
    if (pendingAction) return;
    setPendingAction(actionKey);
    try {
      const result = await testHelmRegistryCredential(item.id);
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, ...result } : entry))
      );
      success(
        result.health_status === 'healthy'
          ? 'Credential authentication succeeded.'
          : result.health_message
      );
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Credential test failed.');
    } finally {
      setPendingAction(null);
    }
  }
  async function openShares(item: HelmRegistryCredential) {
    setShareTarget(item);
    setShareOrgID('');
    setTransferOrgID('');
    setShares([]);
    setSharesError('');
    setSharesLoading(true);
    shareModal.open();
    try {
      setShares(await listHelmRegistryCredentialShares(item.id));
    } catch (caught) {
      setSharesError(caught instanceof Error ? caught.message : 'Could not load access grants.');
    } finally {
      setSharesLoading(false);
    }
  }
  async function reloadShares() {
    if (!shareTarget) return;
    setSharesLoading(true);
    setSharesError('');
    try {
      setShares(await listHelmRegistryCredentialShares(shareTarget.id));
    } catch (caught) {
      setSharesError(caught instanceof Error ? caught.message : 'Could not load access grants.');
    } finally {
      setSharesLoading(false);
    }
  }
  async function grant() {
    if (!shareTarget || !shareOrgID) return;
    if (sharePending) return;
    setSharePending('grant');
    try {
      await shareHelmRegistryCredential(shareTarget.id, shareOrgID);
      await reloadShares();
      setShareOrgID('');
      success('Access granted.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not grant access.');
    } finally {
      setSharePending(null);
    }
  }
  async function revoke(orgID: string) {
    if (!shareTarget) return;
    if (sharePending) return;
    setSharePending(`revoke:${orgID}`);
    try {
      await unshareHelmRegistryCredential(shareTarget.id, orgID);
      await reloadShares();
      success('Access revoked.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not revoke access.');
    } finally {
      setSharePending(null);
    }
  }
  async function transfer() {
    if (!shareTarget || !transferOrgID) return;
    if (
      !(await confirm({
        title: 'Transfer credential ownership?',
        message: 'The current organization retains shared access.',
        confirmLabel: 'Transfer',
        variant: 'danger',
      }))
    )
      return;
    if (sharePending) return;
    setSharePending('transfer');
    try {
      await transferHelmRegistryCredentialOwnership(shareTarget.id, transferOrgID);
      shareModal.close();
      await load();
      success('Credential ownership transferred.');
    } catch (caught) {
      error(caught instanceof Error ? caught.message : 'Could not transfer ownership.');
    } finally {
      setSharePending(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Helm registry credentials"
        description="Private Helm dependency credentials. They are separate from image registries and never appear when creating scans."
        actions={
          <Button variant="primary" onPress={() => open()}>
            <PlusSignIcon size={16} /> Add credential
          </Button>
        }
      />
      <LoadableCollectionState
        emptyState={
          <EmptyState
            icon={<Key01Icon size={28} />}
            eyebrow="Helm dependencies"
            title="No Helm credentials yet"
            description="Add a private OCI or HTTP chart credential to resolve protected dependencies without exposing it in image-scanning workflows."
            action={{ label: 'Add credential', onClick: () => open() }}
          />
        }
        error={loadError || undefined}
        errorTitle="Helm credentials failed to load"
        isEmpty={items.length === 0}
        loading={loading}
        retry={() => void load()}
        loadingFallback={
          <Card>
            <Card.Content
              className="flex min-h-48 items-center justify-center text-sm text-muted"
              role="status"
            >
              Loading Helm credentials…
            </Card.Content>
          </Card>
        }
      >
        <Card className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SearchField
              name="helm-credentials-search"
              variant="secondary"
              className="w-full sm:max-w-sm"
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  aria-label="Search Helm credentials"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search name, URL, username, or authentication..."
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <div className="flex w-full gap-2 sm:w-auto">
              <Select
                aria-label="Filter Helm credentials by protocol"
                value={protocolFilter}
                onChange={(value) =>
                  setProtocolFilter(value === 'oci' || value === 'http' ? value : 'all')
                }
                className="flex-1 sm:w-36"
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all">All protocols</ListBox.Item>
                    <ListBox.Item id="oci">OCI</ListBox.Item>
                    <ListBox.Item id="http">HTTP</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select
                aria-label="Filter Helm credentials by health"
                value={healthFilter}
                onChange={(value) =>
                  setHealthFilter(
                    value === 'healthy' || value === 'unhealthy' || value === 'unknown'
                      ? value
                      : 'all'
                  )
                }
                className="flex-1 sm:w-40"
                variant="secondary"
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all">All health</ListBox.Item>
                    <ListBox.Item id="healthy">Healthy</ListBox.Item>
                    <ListBox.Item id="unhealthy">Unhealthy</ListBox.Item>
                    <ListBox.Item id="unknown">Unknown</ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>
          {filteredItems.length === 0 ? (
            <EmptyState
              icon={<Key01Icon size={28} />}
              title="No Helm credentials match your filters"
              description="Try a different search, protocol, or health filter."
              action={{
                label: 'Clear filters',
                onClick: () => {
                  setSearchQuery('');
                  setProtocolFilter('all');
                  setHealthFilter('all');
                },
              }}
            />
          ) : (
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Helm registry credentials" className="md:min-w-[780px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Credential</Table.Column>
                    <Table.Column className="hidden md:table-cell">Endpoint</Table.Column>
                    <Table.Column className="hidden md:table-cell">Authentication</Table.Column>
                    <Table.Column className="hidden md:table-cell">Health</Table.Column>
                    <Table.Column className="flex justify-end">Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {filteredItems.map((item) => (
                      <Table.Row key={item.id} id={item.id}>
                        <Table.Cell>
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{item.name}</p>
                            <Chip size="sm" variant="soft">
                              {item.protocol.toUpperCase()}
                            </Chip>
                            <p className="truncate text-xs text-muted md:hidden">{item.url}</p>
                            <p className="text-xs capitalize text-muted md:hidden">
                              {item.auth_type.replace('_', ' ')} · {item.health_status}
                            </p>
                          </div>
                        </Table.Cell>
                        <Table.Cell className="hidden md:table-cell">
                          <p className="max-w-md break-all font-mono text-xs text-muted">
                            {item.url}
                          </p>
                        </Table.Cell>
                        <Table.Cell className="hidden md:table-cell">
                          <div className="space-y-1">
                            <p className="text-sm">{item.auth_type.replace('_', ' ')}</p>
                            {item.username ? (
                              <p className="text-xs text-muted">{item.username}</p>
                            ) : null}
                          </div>
                        </Table.Cell>
                        <Table.Cell className="hidden md:table-cell">
                          <div className="space-y-1">
                            <Chip
                              color={
                                item.health_status === 'healthy'
                                  ? 'success'
                                  : item.health_status === 'unhealthy'
                                    ? 'danger'
                                    : 'warning'
                              }
                              size="sm"
                              variant="soft"
                            >
                              {item.health_status}
                            </Chip>
                            {item.health_message ? (
                              <p className="max-w-48 text-xs text-muted">{item.health_message}</p>
                            ) : null}
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex justify-end">
                            <RowActionsMenu
                              label={`Open actions menu for ${item.name}`}
                              items={[
                                {
                                  id: 'test',
                                  label: 'Test credential',
                                  icon: <RefreshIcon size={15} />,
                                  pending: pendingAction === `test:${item.id}`,
                                  disabled:
                                    pendingAction !== null && pendingAction !== `test:${item.id}`,
                                  onAction: () => void test(item),
                                },
                                {
                                  id: 'access',
                                  label: 'Manage access',
                                  icon: <Share01Icon size={15} />,
                                  onAction: () => void openShares(item),
                                },
                                {
                                  id: 'edit',
                                  label: 'Edit',
                                  icon: <PencilEdit01Icon size={15} />,
                                  onAction: () => open(item),
                                },
                                {
                                  id: 'delete',
                                  label: 'Delete',
                                  icon: <Delete01Icon size={15} />,
                                  variant: 'danger',
                                  pending: pendingAction === `delete:${item.id}`,
                                  disabled:
                                    pendingAction !== null && pendingAction !== `delete:${item.id}`,
                                  onAction: () => void remove(item),
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
          )}
        </Card>
      </LoadableCollectionState>
      <Modal isOpen={modal.isOpen} onOpenChange={modal.setOpen}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {editing ? 'Edit Helm credential' : 'Add Helm credential'}
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="space-y-4">
                <FormField
                  label="Name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <FormField
                  label="Registry URL"
                  value={url}
                  onChange={(event) => setURL(event.target.value)}
                  placeholder={
                    protocol === 'oci'
                      ? 'oci://registry.example.com/charts'
                      : 'https://charts.example.com/repository'
                  }
                />
                <Select
                  value={protocol}
                  onChange={(value) => setProtocol(String(value) as typeof protocol)}
                  variant="secondary"
                >
                  <Label>Dependency protocol</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="oci">OCI registry</ListBox.Item>
                      <ListBox.Item id="http">HTTP chart repository</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select
                  value={authType}
                  onChange={(value) => setAuthType(String(value) as typeof authType)}
                  variant="secondary"
                >
                  <Label>Authentication</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="basic">Username and password</ListBox.Item>
                      <ListBox.Item id="access_token">Username and access token</ListBox.Item>
                      {protocol === 'oci' ? (
                        <ListBox.Item id="bearer_token">OCI bearer token</ListBox.Item>
                      ) : null}
                    </ListBox>
                  </Select.Popover>
                </Select>
                {authType !== 'bearer_token' ? (
                  <FormField
                    label="Username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                ) : null}
                <FormField
                  label={editing ? 'New secret (leave empty to keep it)' : 'Secret'}
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <Description>
                  OCI tests authenticate to the registry. Pull permission for a specific chart is
                  verified during discovery.
                </Description>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Cancel
                </Button>
                <Button variant="primary" isPending={saving} onPress={() => void save()}>
                  <Key01Icon size={15} /> Save credential
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <Modal isOpen={shareModal.isOpen} onOpenChange={shareModal.setOpen}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Credential access</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="space-y-3">
                {sharesError ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-danger/30 bg-danger/5 px-4 py-5 text-center">
                    <p className="text-sm text-danger">{sharesError}</p>
                    <Button
                      variant="secondary"
                      isPending={sharesLoading}
                      onPress={() => void reloadShares()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : sharesLoading ? (
                  <div className="py-8 text-center text-sm text-muted">Loading access grants…</div>
                ) : (
                  <>
                    <Select
                      aria-label="Share Helm credential with organization"
                      value={shareOrgID}
                      onChange={(value) => setShareOrgID(String(value))}
                      variant="secondary"
                    >
                      <Label>Share with organization</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {orgs.map((org) => (
                            <ListBox.Item id={org.id} key={org.id}>
                              {org.name}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Button
                      variant="secondary"
                      isPending={sharePending === 'grant'}
                      isDisabled={!shareOrgID || sharePending !== null}
                      onPress={() => void grant()}
                    >
                      Grant access
                    </Button>
                    {shares.length === 0 ? (
                      <p className="text-sm text-muted">No organizations have access yet.</p>
                    ) : (
                      shares.map((share) => (
                        <div
                          className="flex items-center justify-between rounded-lg border border-divider/70 px-3 py-2"
                          key={share.org_id}
                        >
                          <span className="text-sm">
                            {share.org_name}
                            {share.is_owner ? ' (owner)' : ''}
                          </span>
                          {!share.is_owner ? (
                            <Button
                              size="sm"
                              variant="tertiary"
                              isPending={sharePending === `revoke:${share.org_id}`}
                              isDisabled={sharePending !== null}
                              onPress={() => void revoke(share.org_id)}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </>
                )}
                {shareTarget?.owner_type === 'org' ? (
                  <div className="space-y-2 border-t border-divider/70 pt-3">
                    <Select
                      aria-label="Transfer Helm credential ownership"
                      value={transferOrgID}
                      onChange={(value) => setTransferOrgID(String(value))}
                      variant="secondary"
                    >
                      <Label>Transfer ownership</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {orgs.map((org) => (
                            <ListBox.Item id={org.id} key={org.id}>
                              {org.name}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Button
                      variant="danger-soft"
                      isPending={sharePending === 'transfer'}
                      isDisabled={!transferOrgID || sharePending !== null}
                      onPress={() => void transfer()}
                    >
                      Transfer ownership
                    </Button>
                  </div>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="tertiary">
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {dialog}
    </PageContainer>
  );
}
