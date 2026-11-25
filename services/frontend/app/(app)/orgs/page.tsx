'use client';
import { StatusTag } from '@/components/ui/status-dot';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { LoadableCollectionState } from '@/components/ui/loadable-collection-state';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  acceptOrgInvite,
  createOrg,
  declineOrgInvite,
  deleteOrg,
  getUser,
  listMyOrgInvites,
  listOrgs,
  Org,
  OrgInvite,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { formatDateOnly } from '@/lib/time';
import {
  Avatar,
  Button,
  Card,
  ListBox,
  Modal,
  ResourceList,
  SearchField,
  Select,
  Spinner,
  useOverlayState,
} from '@/components/ui';
import { EmptyState } from '@/components/ui/empty-state';
import { labelFor, pluralize, ROLE_LABELS } from '@/lib/labels';
import { Delete01Icon, PlusSignIcon, UserAdd01Icon, UserGroupIcon } from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type OrgWithCount = Org;

type OrgSortKey = 'name' | 'policies' | 'members' | 'updated';
const SORT_OPTIONS: Array<{ id: OrgSortKey; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'members', label: 'Most members' },
  { id: 'policies', label: 'Most policies' },
  { id: 'updated', label: 'Recently updated' },
];

type WorkspaceAvatarColor = 'accent' | 'success' | 'warning' | 'danger';
const workspaceColors: WorkspaceAvatarColor[] = ['accent', 'success', 'warning', 'danger'];
const hashWorkspaceName = (name: string) =>
  Array.from(name).reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);

function OrgAvatar({ name }: { name: string }) {
  return (
    <Avatar
      className="shrink-0"
      color={workspaceColors[hashWorkspaceName(name) % workspaceColors.length]}
      size="sm"
      variant="soft"
    >
      <Avatar.Fallback>{name.trim().charAt(0).toUpperCase() || 'O'}</Avatar.Fallback>
    </Avatar>
  );
}

export default function OrgsPage() {
  const currentUser = getUser() as { role?: string } | null;
  const isSystemAdmin = currentUser?.role === 'admin';
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [pendingInvites, setPendingInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteActionId, setInviteActionId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<OrgSortKey>('name');
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextOrgs, nextInvites] = await Promise.all([listOrgs(), listMyOrgInvites()]);
      setOrgs(nextOrgs);
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
      return (
        org.name.toLowerCase().includes(query) ||
        (org.description || '').toLowerCase().includes(query)
      );
    });
  }, [orgs, searchQuery]);

  const sortedOrgs = useMemo(() => {
    return [...filteredOrgs].sort((first, second) => {
      if (sortKey === 'policies') return (second.policy_count ?? 0) - (first.policy_count ?? 0);
      if (sortKey === 'members') return (second.member_count ?? 0) - (first.member_count ?? 0);
      if (sortKey === 'updated') {
        return (
          (Date.parse(second.updated_at || '') || 0) - (Date.parse(first.updated_at || '') || 0)
        );
      }
      return first.name.localeCompare(second.name);
    });
  }, [filteredOrgs, sortKey]);
  const showToolbar = orgs.length > 5 || Boolean(searchQuery);

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
    if (deletingId) return;
    setDeletingId(id);
    try {
      await deleteOrg(id);
      toast.success('Organization deleted');
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete organization');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAcceptInvite(invite: OrgInvite) {
    setInviteActionId(invite.id);
    setInviteError('');
    try {
      const result = await acceptOrgInvite(invite.id);
      toast.success(
        `Joined ${result.org_name || invite.org_name || 'organization'} as ${labelFor(ROLE_LABELS, result.role).toLowerCase()}`
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
    <PageContainer size="default">
      <PageHeader
        title="Organizations"
        description="Manage organization workspaces, members, and invites."
        actions={
          <Button onPress={modal.open} variant="primary">
            <PlusSignIcon size={15} /> New organization
          </Button>
        }
      />

      {inviteError ? <FormAlert description={inviteError} title="Invite action failed" /> : null}

      {pendingInvites.length > 0 ? (
        <Card>
          <Card.Header>
            <Card.Title className="flex items-center gap-2">
              <UserAdd01Icon size={16} className="text-warning" />
              {pendingInvites.length === 1
                ? 'You have an invitation'
                : `You have ${pendingInvites.length} invitations`}
            </Card.Title>
            <Card.Description>Invitations sent to your account email.</Card.Description>
          </Card.Header>
          <Card.Content>
            <ResourceList>
              {pendingInvites.map((invite) => {
                const busy = inviteActionId === invite.id;
                const inviter = invite.invited_by_username || invite.invited_by_email;
                return (
                  <ResourceList.Item
                    key={invite.id}
                    tone="warning"
                    media={<OrgAvatar name={invite.org_name || 'Organization'} />}
                    title={invite.org_name || 'Organization'}
                    description={[
                      `Join as ${labelFor(ROLE_LABELS, invite.role).toLowerCase()}`,
                      inviter ? `invited by ${inviter}` : null,
                      `expires ${formatDateOnly(invite.expires_at)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    actions={
                      <>
                        <Button
                          size="sm"
                          variant="primary"
                          isDisabled={busy}
                          isPending={busy}
                          onPress={() => {
                            void handleAcceptInvite(invite);
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          isDisabled={busy}
                          onPress={() => {
                            void handleDeclineInvite(invite);
                          }}
                        >
                          Decline
                        </Button>
                      </>
                    }
                  >
                    {invite.org_description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {invite.org_description}
                      </p>
                    ) : null}
                  </ResourceList.Item>
                );
              })}
            </ResourceList>
          </Card.Content>
        </Card>
      ) : null}

      <LoadableCollectionState
        emptyState={
          <EmptyState
            icon={<UserGroupIcon size={28} />}
            title="No organizations yet"
            description="Create an organization to share scans, policies, and settings with your team."
            action={{ label: 'Create organization', onClick: modal.open }}
          />
        }
        error={error || undefined}
        errorTitle="Organization loading failed"
        isEmpty={orgs.length === 0}
        loading={loading}
        loadingFallback={
          <div className="flex h-48 items-center justify-center" role="status">
            <Spinner />
            <span className="sr-only">Loading organizations</span>
          </div>
        }
        retry={() => void load()}
      >
        <div className="space-y-4">
          {showToolbar ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchField name="org-search" variant="secondary" className="min-w-0 flex-1">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    aria-label="Search organizations"
                    placeholder="Search organizations..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <Select
                aria-label="Sort organizations"
                className="w-full sm:w-48"
                value={sortKey}
                variant="secondary"
                onChange={(value) => setSortKey(String(value || 'name') as OrgSortKey)}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {SORT_OPTIONS.map((option) => (
                      <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                        {option.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          ) : null}

          {sortedOrgs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl px-4 py-10 text-center ring-1 ring-foreground/10">
              <p className="text-sm text-muted-foreground">No organizations match this search.</p>
              <Button size="sm" variant="secondary" onPress={() => setSearchQuery('')}>
                Clear search
              </Button>
            </div>
          ) : (
            <ResourceList aria-label="Organizations">
              {sortedOrgs.map((org) => (
                <ResourceList.Item
                  key={org.id}
                  href={`/orgs/${org.id}`}
                  media={<OrgAvatar name={org.name} />}
                  title={org.name}
                  description={[
                    pluralize(org.member_count ?? 0, 'member'),
                    pluralize(org.policy_count ?? 0, 'policy', 'policies'),
                    org.updated_at ? `updated ${formatDateOnly(org.updated_at)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={
                    org.current_user_role ? (
                      <StatusTag>{labelFor(ROLE_LABELS, org.current_user_role)}</StatusTag>
                    ) : null
                  }
                  actions={
                    isSystemAdmin || org.current_user_role === 'owner' ? (
                      <RowActionsMenu
                        label={`Open actions menu for ${org.name}`}
                        items={[
                          {
                            id: 'delete',
                            label: 'Delete organization',
                            icon: <Delete01Icon size={15} />,
                            variant: 'danger',
                            pending: deletingId === org.id,
                            disabled: deletingId !== null && deletingId !== org.id,
                            onAction: () => {
                              void handleDelete(org.id, org.name);
                            },
                          },
                        ]}
                      />
                    ) : null
                  }
                >
                  {org.description ? (
                    <p className="truncate text-xs text-muted-foreground" title={org.description}>
                      {org.description}
                    </p>
                  ) : null}
                </ResourceList.Item>
              ))}
            </ResourceList>
          )}
        </div>
      </LoadableCollectionState>

      <Modal state={modal}>
        <Modal.Backdrop isDismissable={false}>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="overflow-hidden">
              <Modal.Header>
                <Modal.Heading>New organization</Modal.Heading>
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
                  />
                  <FormField
                    label="Description"
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    value={description}
                  />
                </form>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={modal.close} variant="tertiary">
                  Cancel
                </Button>
                <Button type="submit" form="create-org-form" isPending={creating}>
                  Create
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </PageContainer>
  );
}
