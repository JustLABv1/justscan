'use client';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { listAdminOrgs, updateAdminOrgGovernance } from '@/lib/api/admin';
import {
  createOrgInvite,
  listOrgInvites,
  listOrgMembers,
  removeOrgMember,
  revokeOrgInvite,
  transferOrgOwnership,
  updateOrgMemberRole,
} from '@/lib/api/orgs';
import { createOrgToken, listOrgTokens, revokeOrgToken } from '@/lib/api/tokens';
import type { AdminOrg } from '@/lib/api/types/admin';
import type { APIToken, OrgInvite, OrgMember, OrgRole } from '@/lib/api/types/orgs';
import { deferEffect } from '@/lib/defer-effect';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  Input,
  ListBox,
  Modal,
  SearchField,
  Select,
  Spinner,
  Switch,
  Table,
  useOverlayState,
} from '@heroui/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

export function OrganizationsTab() {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [activeOrgId, setActiveOrgId] = useState<string>('');
  const activeOrg = useMemo(
    () => orgs.find((org) => org.id === activeOrgId) ?? null,
    [orgs, activeOrgId]
  );

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [tokens, setTokens] = useState<APIToken[]>([]);

  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [newInviteRole, setNewInviteRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');
  const [newTokenDescription, setNewTokenDescription] = useState('');

  const orgModal = useOverlayState();
  const inviteModal = useOverlayState();
  const tokenModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listAdminOrgs(query);
      setOrgs(data);
      if (activeOrgId && !data.some((org) => org.id === activeOrgId)) {
        setActiveOrgId('');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, [query, activeOrgId]);

  const loadOrgDetails = useCallback(async (orgId: string) => {
    if (!orgId) return;
    try {
      const [nextMembers, nextInvites, nextTokens] = await Promise.all([
        listOrgMembers(orgId),
        listOrgInvites(orgId),
        listOrgTokens(orgId),
      ]);
      setMembers(nextMembers);
      setInvites(nextInvites);
      setTokens(nextTokens.filter((token) => !token.disabled));
    } catch {
      setMembers([]);
      setInvites([]);
      setTokens([]);
    }
  }, []);

  useEffect(() => deferEffect(loadOrgs), [loadOrgs]);

  async function openOrgManagement(org: AdminOrg) {
    setActiveOrgId(org.id);
    await loadOrgDetails(org.id);
    orgModal.open();
  }

  async function updateGovernance(
    patch: Partial<
      Pick<
        AdminOrg,
        | 'is_active'
        | 'allow_image_scans'
        | 'allow_helm_scans'
        | 'allow_rescans'
        | 'allow_member_invites'
        | 'allow_org_tokens'
      >
    >
  ) {
    if (!activeOrg) return;
    setSaving(true);
    try {
      const updated = await updateAdminOrgGovernance(activeOrg.id, patch);
      setOrgs((current) =>
        current.map((org) => (org.id === updated.id ? { ...org, ...updated } : org))
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(member: OrgMember, nextRole: 'admin' | 'editor' | 'viewer') {
    if (!activeOrg || member.role === nextRole) return;
    await updateOrgMemberRole(activeOrg.id, member.user_id, nextRole as OrgRole);
    await loadOrgDetails(activeOrg.id);
  }

  async function handleRemoveMember(member: OrgMember) {
    if (!activeOrg) return;
    const ok = await confirm({
      title: `Remove ${member.username || member.email || 'member'}?`,
      message: 'This user will lose access to the organization immediately.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await removeOrgMember(activeOrg.id, member.user_id);
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleTransferOwnership(member: OrgMember) {
    if (!activeOrg) return;
    const ok = await confirm({
      title: `Transfer ownership to ${member.username || member.email || 'member'}?`,
      message: 'Current owner becomes admin and this action cannot be undone automatically.',
      confirmLabel: 'Transfer',
      variant: 'warning',
    });
    if (!ok) return;
    await transferOrgOwnership(activeOrg.id, member.user_id);
    await loadOrgDetails(activeOrg.id);
  }

  async function handleCreateInvite() {
    if (!activeOrg || !newInviteEmail.trim()) return;
    await createOrgInvite(activeOrg.id, newInviteEmail.trim(), newInviteRole);
    inviteModal.close();
    setNewInviteEmail('');
    setNewInviteRole('viewer');
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleRevokeInvite(invite: OrgInvite) {
    if (!activeOrg) return;
    await revokeOrgInvite(activeOrg.id, invite.id);
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleCreateToken() {
    if (!activeOrg || !newTokenDescription.trim()) return;
    await createOrgToken(activeOrg.id, newTokenDescription.trim());
    tokenModal.close();
    setNewTokenDescription('');
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleRevokeToken(tokenId: string) {
    if (!activeOrg) return;
    await revokeOrgToken(activeOrg.id, tokenId);
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card className="border border-danger/30 bg-danger/10">
          <Card.Content>
            <p className="text-sm text-danger">{error}</p>
          </Card.Content>
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SearchField name="admin-org-search" variant="secondary" className="max-w-md">
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                placeholder="Search organizations..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button variant="secondary" onPress={loadOrgs} isDisabled={loading}>
            Refresh
          </Button>
        </div>

        <Table variant="secondary">
          <Table.Content aria-label="Organizations">
            <Table.Header>
              <Table.Column isRowHeader>Name</Table.Column>
              <Table.Column>Members</Table.Column>
              <Table.Column>Invites</Table.Column>
              <Table.Column>Tokens</Table.Column>
              <Table.Column>Status</Table.Column>
              <Table.Column className="text-right">Actions</Table.Column>
            </Table.Header>
            <Table.Body>
              {loading ? (
                <Table.Row id="loading">
                  <Table.Cell colSpan={6}>
                    <div className="flex items-center justify-center py-6">
                      <Spinner size="sm" />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ) : orgs.length === 0 ? (
                <Table.Row id="empty">
                  <Table.Cell colSpan={6}>
                    <div className="py-6 text-center text-sm text-zinc-500">
                      No organizations found.
                    </div>
                  </Table.Cell>
                </Table.Row>
              ) : (
                orgs.map((org) => (
                  <Table.Row key={org.id} id={org.id}>
                    <Table.Cell>
                      <div>
                        <p className="font-medium">{org.name}</p>
                        <p className="text-xs text-zinc-500">Created {timeAgo(org.created_at)}</p>
                      </div>
                    </Table.Cell>
                    <Table.Cell>{org.member_count}</Table.Cell>
                    <Table.Cell>{org.pending_invite_count}</Table.Cell>
                    <Table.Cell>{org.active_token_count}</Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft" color={org.is_active ? 'success' : 'danger'}>
                        {org.is_active ? 'Active' : 'Suspended'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={() => void openOrgManagement(org)}
                        >
                          Manage
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))
              )}
            </Table.Body>
          </Table.Content>
        </Table>
      </Card>

      <Modal state={orgModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="cover" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{activeOrg?.name ?? 'Organization'}</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="space-y-5 max-h-[75vh] overflow-y-auto">
                {activeOrg ? (
                  <>
                    <p className="text-xs text-zinc-500">
                      {activeOrg.description || 'No description'} · Updated{' '}
                      {fullDate(activeOrg.updated_at)}
                    </p>

                    <div className="grid gap-3 md:grid-cols-2">
                      <Switch
                        isSelected={activeOrg.is_active}
                        onChange={(value) => void updateGovernance({ is_active: value })}
                        isDisabled={saving}
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Content>Organization active</Switch.Content>
                      </Switch>
                      <Switch
                        isSelected={activeOrg.allow_image_scans}
                        onChange={(value) => void updateGovernance({ allow_image_scans: value })}
                        isDisabled={saving}
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Content>Allow image scans</Switch.Content>
                      </Switch>
                      <Switch
                        isSelected={activeOrg.allow_helm_scans}
                        onChange={(value) => void updateGovernance({ allow_helm_scans: value })}
                        isDisabled={saving}
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Content>Allow Helm scans</Switch.Content>
                      </Switch>
                      <Switch
                        isSelected={activeOrg.allow_rescans}
                        onChange={(value) => void updateGovernance({ allow_rescans: value })}
                        isDisabled={saving}
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Content>Allow rescans</Switch.Content>
                      </Switch>
                      <Switch
                        isSelected={activeOrg.allow_member_invites}
                        onChange={(value) => void updateGovernance({ allow_member_invites: value })}
                        isDisabled={saving}
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Content>Allow member invites</Switch.Content>
                      </Switch>
                      <Switch
                        isSelected={activeOrg.allow_org_tokens}
                        onChange={(value) => void updateGovernance({ allow_org_tokens: value })}
                        isDisabled={saving}
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Content>Allow org tokens</Switch.Content>
                      </Switch>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Members</h3>
                        <Button
                          size="sm"
                          variant="secondary"
                          onPress={inviteModal.open}
                          isDisabled={!activeOrg.allow_member_invites || !activeOrg.is_active}
                        >
                          Invite
                        </Button>
                      </div>
                      <Table variant="secondary">
                        <Table.Content aria-label="Org members">
                          <Table.Header>
                            <Table.Column isRowHeader>User</Table.Column>
                            <Table.Column>Role</Table.Column>
                            <Table.Column>Actions</Table.Column>
                          </Table.Header>
                          <Table.Body>
                            {members.map((member) => (
                              <Table.Row key={member.user_id} id={member.user_id}>
                                <Table.Cell>
                                  <div>
                                    <p className="text-sm font-medium">
                                      {member.username || member.email || member.user_id}
                                    </p>
                                    {member.email && (
                                      <p className="text-xs text-zinc-500">{member.email}</p>
                                    )}
                                  </div>
                                </Table.Cell>
                                <Table.Cell>
                                  {member.role === 'owner' ? (
                                    <Chip size="sm" variant="soft" color="accent">
                                      owner
                                    </Chip>
                                  ) : (
                                    <Select
                                      value={member.role}
                                      onChange={(value) =>
                                        void handleRoleChange(
                                          member,
                                          String(value) as 'admin' | 'editor' | 'viewer'
                                        )
                                      }
                                      variant="secondary"
                                      className="w-32"
                                    >
                                      <Select.Trigger>
                                        <Select.Value />
                                        <Select.Indicator />
                                      </Select.Trigger>
                                      <Select.Popover>
                                        <ListBox>
                                          <ListBox.Item id="viewer">viewer</ListBox.Item>
                                          <ListBox.Item id="editor">editor</ListBox.Item>
                                          <ListBox.Item id="admin">admin</ListBox.Item>
                                        </ListBox>
                                      </Select.Popover>
                                    </Select>
                                  )}
                                </Table.Cell>
                                <Table.Cell>
                                  <div className="flex gap-2">
                                    {member.role !== 'owner' && (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          onPress={() => void handleTransferOwnership(member)}
                                        >
                                          Make owner
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="danger-soft"
                                          onPress={() => void handleRemoveMember(member)}
                                        >
                                          Remove
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </Table.Cell>
                              </Table.Row>
                            ))}
                          </Table.Body>
                        </Table.Content>
                      </Table>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-sm font-semibold">Invites</h3>
                        <div className="space-y-2">
                          {invites.length === 0 && (
                            <p className="text-xs text-zinc-500">No active invites.</p>
                          )}
                          {invites.map((invite) => (
                            <Card key={invite.id} className="bg-surface-secondary">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-medium">{invite.email}</p>
                                  <p className="text-[11px] text-zinc-500">{invite.role}</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="danger-soft"
                                  onPress={() => void handleRevokeInvite(invite)}
                                >
                                  Revoke
                                </Button>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="text-sm font-semibold">Org tokens</h3>
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={tokenModal.open}
                            isDisabled={!activeOrg.allow_org_tokens || !activeOrg.is_active}
                          >
                            Create
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {tokens.length === 0 && (
                            <p className="text-xs text-zinc-500">No active tokens.</p>
                          )}
                          {tokens.map((token) => (
                            <Card key={token.id} className="bg-surface-secondary">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-medium">{token.description}</p>
                                  <p className="text-[11px] text-zinc-500">
                                    {token.scope === 'pipeline_scan' ? 'Pipeline scan' : 'Org admin'} · Expires {timeAgo(token.expires_at)}
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  variant="danger-soft"
                                  onPress={() => void handleRevokeToken(token.id)}
                                >
                                  Revoke
                                </Button>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-4 text-sm text-zinc-500">No organization selected.</div>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={inviteModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Create Invite</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="space-y-3">
                <Input
                  className="w-full"
                  variant="secondary"
                  value={newInviteEmail}
                  onChange={(event) => setNewInviteEmail(event.target.value)}
                  placeholder="user@example.com"
                />
                <Select
                  className="w-full"
                  value={newInviteRole}
                  onChange={(value) =>
                    setNewInviteRole(String(value) as 'admin' | 'editor' | 'viewer')
                  }
                  variant="secondary"
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="viewer">viewer</ListBox.Item>
                      <ListBox.Item id="editor">editor</ListBox.Item>
                      <ListBox.Item id="admin">admin</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onPress={inviteModal.close}>
                  Cancel
                </Button>
                <Button onPress={() => void handleCreateInvite()}>Create invite</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={tokenModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Create Org Token</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <Input
                  className="w-full"
                  variant="secondary"
                  value={newTokenDescription}
                  onChange={(event) => setNewTokenDescription(event.target.value)}
                  placeholder="CI token"
                />
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onPress={tokenModal.close}>
                  Cancel
                </Button>
                <Button onPress={() => void handleCreateToken()}>Create token</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {confirmDialog}
    </div>
  );
}
