'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  acceptOrgInvite,
  createOrg,
  declineOrgInvite,
  deleteOrg,
  getUser,
  listMyOrgInvites,
  listOrgMembers,
  listOrgs,
  Org,
  OrgInvite,
  OrgMember,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import {
  Avatar,
  Button,
  Card,
  ListBox,
  Modal,
  SearchField,
  Select,
  Table,
  useOverlayState,
  type SortDescriptor,
} from '@heroui/react';
import { Delete01Icon, PlusSignIcon, UserAdd01Icon } from 'hugeicons-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface OrgWithCount extends Org {
  members: OrgMember[];
  policy_count: number;
}

type OrgSortKey = 'name' | 'policies' | 'members' | 'updated';
type WorkspaceAvatarColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const workspaceColors: WorkspaceAvatarColor[] = ['accent', 'success', 'warning', 'danger'];
const hashWorkspaceName = (name: string) =>
  Array.from(name).reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);
const workspaceColorFor = (kind: 'personal' | 'org', name: string): WorkspaceAvatarColor =>
  kind === 'personal'
    ? 'default'
    : workspaceColors[hashWorkspaceName(name) % workspaceColors.length];

function initialsForMember(member: OrgMember) {
  const value = member.username || member.email || member.user_id;
  const parts = value
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return 'U';
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}

export default function OrgsPage() {
  const currentUser = getUser() as { role?: string } | null;
  const isSystemAdmin = currentUser?.role === 'admin';
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [pendingInvites, setPendingInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteActionId, setInviteActionId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'name',
    direction: 'ascending',
  });
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOrgs, nextInvites] = await Promise.all([listOrgs(), listMyOrgInvites()]);
      const orgsWithMembers = await Promise.all(
        nextOrgs.map(async (org) => {
          const members = await listOrgMembers(org.id).catch(() => []);
          return { ...(org as OrgWithCount), members };
        })
      );
      setOrgs(orgsWithMembers);
      setPendingInvites(nextInvites);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => deferEffect(load), [load]);

  const filteredOrgs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return orgs;
    }

    return orgs.filter((org) => {
      const memberMatches = org.members.some((member) =>
        [member.username, member.email, member.role]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(query))
      );

      return (
        org.name.toLowerCase().includes(query) ||
        (org.description || '').toLowerCase().includes(query) ||
        memberMatches
      );
    });
  }, [orgs, searchQuery]);

  const sortedOrgs = useMemo(() => {
    const direction = sortDescriptor.direction === 'descending' ? -1 : 1;
    const column = String(sortDescriptor.column || 'name') as OrgSortKey;

    return [...filteredOrgs].sort((first, second) => {
      if (column === 'policies') {
        return ((first.policy_count ?? 0) - (second.policy_count ?? 0)) * direction;
      }

      if (column === 'members') {
        return (first.members.length - second.members.length) * direction;
      }

      if (column === 'updated') {
        const firstUpdated = Date.parse(first.updated_at || '') || 0;
        const secondUpdated = Date.parse(second.updated_at || '') || 0;
        return (firstUpdated - secondUpdated) * direction;
      }

      return first.name.localeCompare(second.name) * direction;
    });
  }, [filteredOrgs, sortDescriptor]);

  const sortByValue = String(sortDescriptor.column || 'name');
  const sortDirectionValue = sortDescriptor.direction === 'descending' ? 'desc' : 'asc';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      await createOrg(name, description);
      modal.close();
      setName('');
      setDescription('');
      await load();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, orgName: string) {
    const ok = await confirm({
      title: `Delete "${orgName}"?`,
      message:
        'All policies and compliance results for this organization will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteOrg(id).catch(() => {});
    load();
  }

  async function handleAcceptInvite(invite: OrgInvite) {
    setInviteActionId(invite.id);
    setInviteError('');
    try {
      const result = await acceptOrgInvite(invite.id);
      toast.success(
        `Joined ${result.org_name || invite.org_name || 'organization'} as ${result.role}`
      );
      await load();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to accept organization invite');
    } finally {
      setInviteActionId(null);
    }
  }

  async function handleDeclineInvite(invite: OrgInvite) {
    setInviteActionId(invite.id);
    setInviteError('');
    try {
      await declineOrgInvite(invite.id);
      toast.success(`Declined invite to ${invite.org_name || 'organization'}`);
      await load();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to decline organization invite');
    } finally {
      setInviteActionId(null);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Organizations"
        description={
          orgs.length > 0
            ? `${orgs.length} organization${orgs.length !== 1 ? 's' : ''}`
            : 'Manage organization workspaces, members, and invites.'
        }
        actions={
          <Button onClick={modal.open} variant="primary">
            <PlusSignIcon size={15} /> New Organization
          </Button>
        }
      />

      {error ? <FormAlert description={error} title="Organization loading failed" /> : null}
      {inviteError ? <FormAlert description={inviteError} title="Invite action failed" /> : null}

      {pendingInvites.length > 0 && (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <div
              className="size-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.22)',
              }}
            >
              <UserAdd01Icon size={20} color="#f59e0b" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Pending Invites
              </h2>
              <p className="text-sm text-zinc-500">
                Review organization invitations tied to your account email.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {pendingInvites.map((invite) => {
              const busy = inviteActionId === invite.id;
              return (
                <Card key={invite.id} className="bg-surface-secondary">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                          {invite.org_name || 'Organization'}
                        </p>
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            background: 'rgba(124,58,237,0.12)',
                            border: '1px solid rgba(167,139,250,0.22)',
                            color: '#a78bfa',
                          }}
                        >
                          {invite.role}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">
                        Invited by{' '}
                        {invite.invited_by_username || invite.invited_by_email || 'a teammate'}
                      </p>
                    </div>
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-500"
                      style={{ background: 'var(--row-divider)' }}
                    >
                      Expires {new Date(invite.expires_at).toLocaleDateString()}
                    </span>
                  </div>

                  {invite.org_description && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">
                      {invite.org_description}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      isDisabled={busy}
                      onClick={() => {
                        void handleAcceptInvite(invite);
                      }}
                    >
                      {busy && (
                        <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      )}
                      Accept
                    </Button>
                    <Button
                      variant="secondary"
                      className="border border-zinc-300 dark:border-zinc-700"
                      isDisabled={busy}
                      onClick={() => {
                        void handleDeclineInvite(invite);
                      }}
                    >
                      Decline
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="size-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : orgs.length === 0 ? (
        <Card className="py-20 flex flex-col items-center gap-3">
          <div
            className="size-14 rounded-2xl flex items-center justify-center"
            style={{
              background: 'rgba(124,58,237,0.12)',
              border: '1px solid rgba(124,58,237,0.2)',
            }}
          >
            <Avatar color="accent" size="lg" variant="soft">
              <Avatar.Fallback>O</Avatar.Fallback>
            </Avatar>
          </div>
          <p className="text-sm text-zinc-500 text-center max-w-xs">
            No organizations yet. Create one to start managing compliance policies.
          </p>
          <Button onClick={modal.open} variant="secondary">
            Create organization →
          </Button>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <SearchField name="org-search" variant="secondary" className="w-full xl:max-w-md">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Search organizations, descriptions, or members..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                aria-label="Sort organizations by"
                className="w-full sm:w-[180px]"
                value={sortByValue}
                variant="secondary"
                onChange={(value) =>
                  setSortDescriptor((previous) => ({
                    ...previous,
                    column: String(value || 'name'),
                  }))
                }
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="name" textValue="Name">
                      Name
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="policies" textValue="Policies">
                      Policies
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="members" textValue="Members">
                      Members
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="updated" textValue="Updated">
                      Updated
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
              <Select
                aria-label="Sort organizations direction"
                className="w-full sm:w-[160px]"
                value={sortDirectionValue}
                variant="secondary"
                onChange={(value) =>
                  setSortDescriptor((previous) => ({
                    ...previous,
                    direction: value === 'desc' ? 'descending' : 'ascending',
                  }))
                }
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="asc" textValue="Ascending">
                      Ascending
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="desc" textValue="Descending">
                      Descending
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>

          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Organizations table"
                className="min-w-[900px]"
                sortDescriptor={sortDescriptor}
                onSortChange={setSortDescriptor}
              >
                <Table.Header>
                  <Table.Column id="name" allowsSorting isRowHeader>
                    Organization
                  </Table.Column>
                  <Table.Column id="members" allowsSorting>
                    Members
                  </Table.Column>
                  <Table.Column id="policies" allowsSorting>
                    Policies
                  </Table.Column>
                  <Table.Column id="updated" allowsSorting>
                    Updated
                  </Table.Column>
                  <Table.Column className="text-right">Actions</Table.Column>
                </Table.Header>
                <Table.Body>
                  {sortedOrgs.length === 0 ? (
                    <Table.Row id="empty">
                      <Table.Cell colSpan={5}>
                        <div className="px-4 py-10 text-center text-sm text-zinc-500">
                          No organizations match this search.
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ) : (
                    sortedOrgs.map((org) => (
                      <Table.Row
                        key={org.id}
                        id={org.id}
                        className="cursor-pointer transition-colors hover:bg-[var(--row-hover)]"
                      >
                        <Table.Cell onClick={() => router.push(`/orgs/${org.id}`)}>
                          <div className="flex items-center gap-3">
                            <Avatar
                              className="shrink-0"
                              color={workspaceColorFor('org', org.name)}
                              size="sm"
                              variant="soft"
                            >
                              <Avatar.Fallback>
                                {org.name.trim().charAt(0).toUpperCase() || 'O'}
                              </Avatar.Fallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-zinc-900 dark:text-white">
                                {org.name}
                              </p>
                              <p className="truncate text-xs text-zinc-500">
                                {org.description || 'No description'}
                              </p>
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell onClick={() => router.push(`/orgs/${org.id}`)}>
                          {org.members.length === 0 ? (
                            <span className="text-xs text-zinc-500">No members</span>
                          ) : (
                            <div className="flex items-center -space-x-2">
                              {org.members.slice(0, 4).map((member) => (
                                <Avatar
                                  key={member.user_id}
                                  color={workspaceColorFor('org', org.name)}
                                  size="sm"
                                >
                                  <Avatar.Fallback>{initialsForMember(member)}</Avatar.Fallback>
                                </Avatar>
                              ))}
                              {org.members.length > 4 ? (
                                <Avatar color={workspaceColorFor('org', org.name)} size="sm">
                                  <Avatar.Fallback>+{org.members.length - 4}</Avatar.Fallback>
                                </Avatar>
                              ) : null}
                            </div>
                          )}
                        </Table.Cell>
                        <Table.Cell onClick={() => router.push(`/orgs/${org.id}`)}>
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              color: '#a78bfa',
                              background: 'rgba(124,58,237,0.15)',
                              border: '1px solid rgba(167,139,250,0.2)',
                            }}
                          >
                            {org.policy_count ?? 0} {org.policy_count === 1 ? 'policy' : 'policies'}
                          </span>
                        </Table.Cell>
                        <Table.Cell
                          className="text-xs text-zinc-500"
                          onClick={() => router.push(`/orgs/${org.id}`)}
                        >
                          {new Date(org.updated_at).toLocaleDateString()}
                        </Table.Cell>
                        <Table.Cell onClick={(event) => event.stopPropagation()}>
                          <div className="flex justify-end">
                            {isSystemAdmin || org.current_user_role === 'owner' ? (
                              <RowActionsMenu
                                label={`Open actions menu for ${org.name}`}
                                items={[
                                  {
                                    id: 'delete',
                                    label: 'Delete organization',
                                    icon: <Delete01Icon size={15} />,
                                    variant: 'danger',
                                    onAction: () => {
                                      void handleDelete(org.id, org.name);
                                    },
                                  },
                                ]}
                              />
                            ) : (
                              <span className="text-xs text-zinc-500">—</span>
                            )}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>New Organization</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="py-5">
                <form id="create-org-form" onSubmit={handleCreate} className="space-y-4">
                  {createError ? (
                    <FormAlert description={createError} title="Organization creation failed" />
                  ) : null}
                  <FormField
                    label="Name"
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Production"
                    required
                    value={name}
                    className="bg-surface-secondary"
                  />
                  <FormField
                    label="Description"
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    value={description}
                    className="bg-surface-secondary"
                  />
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button onClick={modal.close} variant="tertiary">
                  Cancel
                </Button>
                <Button type="submit" form="create-org-form" isDisabled={creating}>
                  {creating && (
                    <div className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  Create
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
