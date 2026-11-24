'use client';

import { AdminPageShell } from '@/components/admin/admin-page-shell';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { StatusAlert } from '@/components/ui/form-alert';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { StatusTag } from '@/components/ui/status-dot';
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
import { ROLE_LABELS, displayUser, labelFor, pluralize } from '@/lib/labels';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  Input,
  Label,
  ListBox,
  Modal,
  DetailSheet,
  ResourceList,
  SearchField,
  Select,
  SettingRow,
  SettingsSection,
  Switch,
  TextField,
  useOverlayState,
} from '@/components/ui';
import { Delete01Icon, Crown02Icon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type GovernanceKey =
  | 'is_active'
  | 'allow_image_scans'
  | 'allow_helm_scans'
  | 'allow_rescans'
  | 'allow_member_invites'
  | 'allow_org_tokens';

const GOVERNANCE_CONTROLS: Array<{ key: GovernanceKey; label: string; description: string }> = [
  {
    key: 'is_active',
    label: 'Organization active',
    description: 'When off, members keep their data but cannot use the organization.',
  },
  {
    key: 'allow_image_scans',
    label: 'Image scans',
    description: 'Members can start new container image scans.',
  },
  {
    key: 'allow_helm_scans',
    label: 'Helm chart scans',
    description: 'Members can scan every image referenced by a Helm chart.',
  },
  {
    key: 'allow_rescans',
    label: 'Rescans',
    description: 'Members can rescan images they scanned before.',
  },
  {
    key: 'allow_member_invites',
    label: 'Member invites',
    description: 'Organization admins can invite new members by email.',
  },
  {
    key: 'allow_org_tokens',
    label: 'Organization tokens',
    description: 'Organization admins can create API tokens for pipelines and automation.',
  },
];

const ORG_ROLE_OPTIONS = ['viewer', 'editor', 'admin'] as const;

const TOKEN_SCOPE_LABELS: Record<string, string> = {
  pipeline_scan: 'Pipeline scans',
  org_admin: 'Organization admin',
};

function expiryLabel(expiresAt?: string | null) {
  const date = expiresAt ? new Date(expiresAt) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return 'Never expires';
  if (date.getTime() <= Date.now()) return `Expired ${timeAgo(expiresAt)}`;
  return `Expires ${timeUntil(expiresAt)}`;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function OrganizationsTab() {
  const toast = useToast();
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

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    try {
      await action();
      toast.success(success);
      return true;
    } catch (actionError: unknown) {
      toast.error(errorMessage(actionError, failure));
      return false;
    }
  }

  async function updateGovernance(key: GovernanceKey, value: boolean) {
    if (!activeOrg) return;
    setSaving(true);
    try {
      const updated = await updateAdminOrgGovernance(activeOrg.id, { [key]: value });
      setOrgs((current) =>
        current.map((org) => (org.id === updated.id ? { ...org, ...updated } : org))
      );
      const control = GOVERNANCE_CONTROLS.find((item) => item.key === key);
      toast.success(`${control?.label ?? 'Setting'} ${value ? 'enabled' : 'disabled'}`);
    } catch (updateError: unknown) {
      toast.error(errorMessage(updateError, 'Failed to update organization'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRoleChange(member: OrgMember, nextRole: 'admin' | 'editor' | 'viewer') {
    if (!activeOrg || member.role === nextRole) return;
    const ok = await run(
      () => updateOrgMemberRole(activeOrg.id, member.user_id, nextRole as OrgRole),
      `${displayUser(member)} is now ${labelFor(ROLE_LABELS, nextRole).toLowerCase()}`,
      'Failed to change role'
    );
    if (ok) await loadOrgDetails(activeOrg.id);
  }

  async function handleRemoveMember(member: OrgMember) {
    if (!activeOrg) return;
    const name = displayUser(member, 'this member');
    const confirmed = await confirm({
      title: `Remove ${name}?`,
      message: 'This user will lose access to the organization immediately.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!confirmed) return;
    const ok = await run(
      () => removeOrgMember(activeOrg.id, member.user_id),
      `${name} removed`,
      'Failed to remove member'
    );
    if (!ok) return;
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleTransferOwnership(member: OrgMember) {
    if (!activeOrg) return;
    const name = displayUser(member, 'this member');
    const confirmed = await confirm({
      title: `Transfer ownership to ${name}?`,
      message: 'The current owner becomes an admin. This cannot be undone automatically.',
      confirmLabel: 'Transfer',
      variant: 'warning',
    });
    if (!confirmed) return;
    const ok = await run(
      () => transferOrgOwnership(activeOrg.id, member.user_id),
      `${name} now owns ${activeOrg.name}`,
      'Failed to transfer ownership'
    );
    if (ok) await loadOrgDetails(activeOrg.id);
  }

  async function handleCreateInvite() {
    if (!activeOrg || !newInviteEmail.trim()) return;
    const ok = await run(
      () => createOrgInvite(activeOrg.id, newInviteEmail.trim(), newInviteRole),
      `Invite sent to ${newInviteEmail.trim()}`,
      'Failed to create invite'
    );
    if (!ok) return;
    inviteModal.close();
    setNewInviteEmail('');
    setNewInviteRole('viewer');
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleRevokeInvite(invite: OrgInvite) {
    if (!activeOrg) return;
    const ok = await run(
      () => revokeOrgInvite(activeOrg.id, invite.id),
      `Invite for ${invite.email} revoked`,
      'Failed to revoke invite'
    );
    if (!ok) return;
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleCreateToken() {
    if (!activeOrg || !newTokenDescription.trim()) return;
    const ok = await run(
      () => createOrgToken(activeOrg.id, newTokenDescription.trim()),
      'Organization token created',
      'Failed to create token'
    );
    if (!ok) return;
    tokenModal.close();
    setNewTokenDescription('');
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  async function handleRevokeToken(token: APIToken) {
    if (!activeOrg) return;
    const ok = await run(
      () => revokeOrgToken(activeOrg.id, token.id),
      `Token ${token.description ? `"${token.description}" ` : ''}revoked`,
      'Failed to revoke token'
    );
    if (!ok) return;
    await loadOrgDetails(activeOrg.id);
    await loadOrgs();
  }

  return (
    <AdminPageShell
      actions={
        <Button size="sm" variant="secondary" onPress={loadOrgs} isDisabled={loading}>
          Refresh
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? (
          <StatusAlert status="danger" title="Organizations failed to load" description={error} />
        ) : null}

        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b border-border p-4">
            <FilterToolbar
              search={
                <SearchField
                  aria-label="Search organizations"
                  name="admin-org-search"
                  variant="secondary"
                  className="w-full sm:max-w-md"
                  value={query}
                  onChange={setQuery}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="Search organizations..." />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
              }
            />
          </div>

          {orgs.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {loading ? 'Loading organizations...' : 'No organizations found.'}
            </p>
          ) : (
            <ResourceList bordered={false} aria-label="Organizations">
              {orgs.map((org) => (
                <ResourceList.Item
                  key={org.id}
                  title={org.name}
                  tone={org.is_active ? 'default' : 'warning'}
                  description={[
                    pluralize(org.member_count, 'member'),
                    pluralize(org.pending_invite_count, 'invite'),
                    pluralize(org.active_token_count, 'token'),
                  ].join(' · ')}
                  meta={
                    <>
                      <span
                        className="hidden text-xs text-muted-foreground sm:inline"
                        title={fullDate(org.created_at)}
                      >
                        Created {timeAgo(org.created_at)}
                      </span>
                      <StatusTag tone={org.is_active ? 'success' : 'warning'}>
                        {org.is_active ? 'Active' : 'Suspended'}
                      </StatusTag>
                    </>
                  }
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void openOrgManagement(org)}
                    >
                      Manage
                    </Button>
                  }
                />
              ))}
            </ResourceList>
          )}
        </Card>

        <DetailSheet state={orgModal}>
          <DetailSheet.Backdrop isDismissable={false}>
            <DetailSheet.Container size="xl">
              <DetailSheet.Dialog>
                <DetailSheet.Header>
                  <DetailSheet.Heading>{activeOrg?.name ?? 'Organization'}</DetailSheet.Heading>
                  <DetailSheet.CloseTrigger />
                </DetailSheet.Header>
                <DetailSheet.Body className="space-y-4">
                  {activeOrg ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {activeOrg.description || 'No description'} · Updated{' '}
                        <span title={fullDate(activeOrg.updated_at)}>
                          {timeAgo(activeOrg.updated_at)}
                        </span>
                      </p>

                      <SettingsSection
                        title="Governance"
                        description="What this organization's members are allowed to do. Changes save immediately."
                      >
                        {GOVERNANCE_CONTROLS.map((control) => (
                          <SettingRow
                            key={control.key}
                            label={control.label}
                            description={control.description}
                          >
                            <Switch
                              aria-label={control.label}
                              isSelected={activeOrg[control.key]}
                              onChange={(value) => void updateGovernance(control.key, value)}
                              isDisabled={saving}
                            >
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                            </Switch>
                          </SettingRow>
                        ))}
                      </SettingsSection>

                      <section className="space-y-2" aria-labelledby="org-members-heading">
                        <div className="flex items-center justify-between gap-3">
                          <h3 id="org-members-heading" className="text-sm font-medium">
                            Members
                          </h3>
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={inviteModal.open}
                            isDisabled={!activeOrg.allow_member_invites || !activeOrg.is_active}
                          >
                            Invite member
                          </Button>
                        </div>
                        <ResourceList aria-label="Members">
                          {members.length === 0 ? (
                            <ResourceList.Item title="No members yet" />
                          ) : (
                            members.map((member) => {
                              const name = displayUser(member);
                              return (
                                <ResourceList.Item
                                  key={member.user_id}
                                  title={name}
                                  description={
                                    member.email && member.email !== name ? member.email : undefined
                                  }
                                  meta={
                                    member.role === 'owner' ? (
                                      <Chip size="sm" color="accent">
                                        Owner
                                      </Chip>
                                    ) : (
                                      <Select
                                        aria-label={`Role for ${name}`}
                                        value={member.role}
                                        onChange={(value) =>
                                          void handleRoleChange(
                                            member,
                                            String(value) as 'admin' | 'editor' | 'viewer'
                                          )
                                        }
                                        variant="secondary"
                                        className="w-28"
                                      >
                                        <Select.Trigger>
                                          <Select.Value />
                                          <Select.Indicator />
                                        </Select.Trigger>
                                        <Select.Popover>
                                          <ListBox>
                                            {ORG_ROLE_OPTIONS.map((role) => (
                                              <ListBox.Item key={role} id={role}>
                                                {labelFor(ROLE_LABELS, role)}
                                              </ListBox.Item>
                                            ))}
                                          </ListBox>
                                        </Select.Popover>
                                      </Select>
                                    )
                                  }
                                  actions={
                                    member.role !== 'owner' ? (
                                      <RowActionsMenu
                                        label={`Open actions for ${name}`}
                                        items={[
                                          {
                                            id: 'owner',
                                            label: 'Make owner',
                                            icon: <Crown02Icon size={15} />,
                                            onAction: () => void handleTransferOwnership(member),
                                          },
                                          {
                                            id: 'remove',
                                            label: 'Remove from organization',
                                            icon: <Delete01Icon size={15} />,
                                            variant: 'danger',
                                            onAction: () => void handleRemoveMember(member),
                                          },
                                        ]}
                                      />
                                    ) : null
                                  }
                                />
                              );
                            })
                          )}
                        </ResourceList>
                      </section>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <section className="space-y-2" aria-labelledby="org-invites-heading">
                          <h3 id="org-invites-heading" className="text-sm font-medium">
                            Pending invites
                          </h3>
                          <ResourceList aria-label="Pending invites">
                            {invites.length === 0 ? (
                              <ResourceList.Item title="No pending invites" />
                            ) : (
                              invites.map((invite) => (
                                <ResourceList.Item
                                  key={invite.id}
                                  title={invite.email}
                                  description={`${labelFor(ROLE_LABELS, invite.role)} · ${expiryLabel(invite.expires_at)}`}
                                  actions={
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onPress={() => void handleRevokeInvite(invite)}
                                    >
                                      Revoke
                                    </Button>
                                  }
                                />
                              ))
                            )}
                          </ResourceList>
                        </section>

                        <section className="space-y-2" aria-labelledby="org-tokens-heading">
                          <div className="flex items-center justify-between gap-3">
                            <h3 id="org-tokens-heading" className="text-sm font-medium">
                              Organization tokens
                            </h3>
                            <Button
                              size="sm"
                              variant="secondary"
                              onPress={tokenModal.open}
                              isDisabled={!activeOrg.allow_org_tokens || !activeOrg.is_active}
                            >
                              Create token
                            </Button>
                          </div>
                          <ResourceList aria-label="Organization tokens">
                            {tokens.length === 0 ? (
                              <ResourceList.Item title="No active tokens" />
                            ) : (
                              tokens.map((token) => (
                                <ResourceList.Item
                                  key={token.id}
                                  title={token.description || 'Unnamed token'}
                                  description={`${labelFor(TOKEN_SCOPE_LABELS, token.scope)} · ${expiryLabel(token.expires_at)}`}
                                  actions={
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onPress={() => void handleRevokeToken(token)}
                                    >
                                      Revoke
                                    </Button>
                                  }
                                />
                              ))
                            )}
                          </ResourceList>
                        </section>
                      </div>
                    </>
                  ) : (
                    <p className="py-4 text-sm text-muted-foreground">No organization selected.</p>
                  )}
                </DetailSheet.Body>
              </DetailSheet.Dialog>
            </DetailSheet.Container>
          </DetailSheet.Backdrop>
        </DetailSheet>

        <Modal state={inviteModal}>
          <Modal.Backdrop isDismissable={false}>
            <Modal.Container size="md" placement="center">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>Invite member</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="space-y-4">
                  <TextField value={newInviteEmail} onChange={setNewInviteEmail} type="email">
                    <Label className="mb-1.5 text-sm font-medium">Email</Label>
                    <Input className="w-full" variant="secondary" placeholder="user@example.com" />
                  </TextField>
                  <div className="space-y-1.5">
                    <span className="block text-sm font-medium">Role</span>
                    <Select
                      aria-label="Role"
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
                          {ORG_ROLE_OPTIONS.map((role) => (
                            <ListBox.Item key={role} id={role}>
                              {labelFor(ROLE_LABELS, role)}
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="tertiary" onPress={inviteModal.close}>
                    Cancel
                  </Button>
                  <Button
                    onPress={() => void handleCreateInvite()}
                    isDisabled={!newInviteEmail.trim()}
                  >
                    Send invite
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>

        <Modal state={tokenModal}>
          <Modal.Backdrop isDismissable={false}>
            <Modal.Container size="md" placement="center">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>Create organization token</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body>
                  <TextField value={newTokenDescription} onChange={setNewTokenDescription}>
                    <Label className="mb-1.5 text-sm font-medium">Description</Label>
                    <Input className="w-full" variant="secondary" placeholder="CI token" />
                  </TextField>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="tertiary" onPress={tokenModal.close}>
                    Cancel
                  </Button>
                  <Button
                    onPress={() => void handleCreateToken()}
                    isDisabled={!newTokenDescription.trim()}
                  >
                    Create token
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>

        {confirmDialog}
      </div>
    </AdminPageShell>
  );
}
