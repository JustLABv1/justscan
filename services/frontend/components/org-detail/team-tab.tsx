import { OrgInvite, OrgMember, OrgRole } from '@/lib/api';
import { timeAgo, timeUntil } from '@/lib/time';
import { Avatar, Button, Card, ListBox, SearchField, Select, Table, type SortDescriptor } from '@heroui/react';
import { Delete01Icon, PlusSignIcon } from 'hugeicons-react';
import { useMemo, useState } from 'react';

interface OrgTeamTabProps {
  canEditRoles: boolean;
  canManageMembers: boolean;
  canTransferOwnership: boolean;
  currentOrgRole?: OrgRole;
  inputClassName: string;
  invites: OrgInvite[];
  isSystemAdmin: boolean;
  members: OrgMember[];
  membersLoading: boolean;
  onCopyInviteLink: (invite: OrgInvite) => void | Promise<void>;
  onMemberRoleChange: (
    member: OrgMember,
    nextRole: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>
  ) => void | Promise<void>;
  onOpenInviteModal: () => void;
  onRemoveMember: (member: OrgMember) => void | Promise<void>;
  onRevokeInvite: (invite: OrgInvite) => void | Promise<void>;
  onTransferOwnership: (member: OrgMember) => void | Promise<void>;
  featureDisabledReason?: string;
}

function memberInitials(member: OrgMember) {
  const base = member.username || member.email || member.user_id;
  const words = base
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length === 0) {
    return 'U';
  }

  return words.map((word) => word[0]?.toUpperCase() || '').join('');
}

export function OrgTeamTab({
  canEditRoles,
  canManageMembers,
  canTransferOwnership,
  currentOrgRole,
  inputClassName,
  invites,
  isSystemAdmin,
  members,
  membersLoading,
  onCopyInviteLink,
  onMemberRoleChange,
  onOpenInviteModal,
  onRemoveMember,
  onRevokeInvite,
  onTransferOwnership,
  featureDisabledReason,
}: OrgTeamTabProps) {
  const [memberSearch, setMemberSearch] = useState('');
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'user',
    direction: 'ascending',
  });

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) {
      return members;
    }

    return members.filter((member) => {
      const displayName = member.username || member.email || member.user_id;
      return [displayName, member.email, member.user_id, member.role]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [memberSearch, members]);

  const sortedMembers = useMemo(() => {
    const direction = sortDescriptor.direction === 'descending' ? -1 : 1;
    const column = String(sortDescriptor.column ?? 'user');

    return [...filteredMembers].sort((a, b) => {
      if (column === 'joined') {
        const first = Date.parse(a.joined_at || '') || 0;
        const second = Date.parse(b.joined_at || '') || 0;
        return (first - second) * direction;
      }

      const first =
        column === 'role' ? a.role : (a.username || a.email || a.user_id).toLocaleLowerCase();
      const second =
        column === 'role' ? b.role : (b.username || b.email || b.user_id).toLocaleLowerCase();

      return first.localeCompare(second) * direction;
    });
  }, [filteredMembers, sortDescriptor]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Members</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {currentOrgRole
                ? `Your role: ${currentOrgRole}`
                : isSystemAdmin
                  ? 'Platform admin access'
                  : 'Organization members'}
            </p>
          </div>
          {canManageMembers && (
            <Button onClick={onOpenInviteModal} isDisabled={Boolean(featureDisabledReason)}>
              <PlusSignIcon size={14} />
              Invite Member
            </Button>
          )}
        </div>
        {featureDisabledReason && (
          <p className="text-xs text-warning mt-1">{featureDisabledReason}</p>
        )}

        <div>
          {membersLoading ? (
            <div className="flex justify-center py-8">
              <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <div className="px-6 py-8 text-sm text-zinc-500 text-center">No members found.</div>
          ) : (
            <div className="space-y-3">
              <SearchField name="org-members-search" variant="secondary">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="Search members by name, email, role..."
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>

              <Table variant="secondary">
                <Table.ScrollContainer>
                  <Table.Content
                    aria-label="Organization members"
                    className="min-w-[720px]"
                    sortDescriptor={sortDescriptor}
                    onSortChange={setSortDescriptor}
                  >
                    <Table.Header>
                      <Table.Column id="user" allowsSorting isRowHeader>
                        User
                      </Table.Column>
                      <Table.Column id="role" allowsSorting>
                        Role
                      </Table.Column>
                      <Table.Column id="joined" allowsSorting>
                        Joined
                      </Table.Column>
                      <Table.Column className="text-right">Actions</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {sortedMembers.length === 0 ? (
                        <Table.Row id="empty">
                          <Table.Cell colSpan={4}>
                            <div className="px-4 py-8 text-center text-sm text-zinc-500">
                              No members match this search.
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ) : (
                        sortedMembers.map((member) => (
                          <Table.Row
                            key={member.user_id}
                            id={member.user_id}
                            className="transition-colors hover:bg-[var(--row-hover)]"
                          >
                            <Table.Cell>
                              <div className="flex items-center gap-3">
                                <Avatar color="accent" size="sm" variant="soft">
                                  <Avatar.Fallback>{memberInitials(member)}</Avatar.Fallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium text-zinc-800 dark:text-zinc-200">
                                    {member.username || member.email || member.user_id}
                                  </p>
                                  {member.email && (
                                    <p className="text-xs text-zinc-500 mt-0.5">{member.email}</p>
                                  )}
                                </div>
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              {canEditRoles && member.role !== 'owner' ? (
                                <Select
                                  value={member.role}
                                  onChange={(value) =>
                                    void onMemberRoleChange(
                                      member,
                                      String(value) as Extract<
                                        OrgRole,
                                        'admin' | 'editor' | 'viewer'
                                      >
                                    )
                                  }
                                >
                                  <Select.Trigger className={`${inputClassName} max-w-[140px] py-2 text-sm`}>
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
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-accent-500/10 text-accent border-accent-500/20">
                                  {member.role}
                                </span>
                              )}
                            </Table.Cell>
                            <Table.Cell className="text-xs text-zinc-500">
                              {timeAgo(member.joined_at)}
                            </Table.Cell>
                            <Table.Cell>
                              <div className="flex items-center justify-end gap-2">
                                {canTransferOwnership && member.role !== 'owner' && (
                                  <Button
                                    onClick={() => void onTransferOwnership(member)}
                                    variant="secondary"
                                  >
                                    Make owner
                                  </Button>
                                )}
                                {canManageMembers && member.role !== 'owner' && (
                                  <Button
                                    onClick={() => void onRemoveMember(member)}
                                    variant="danger-soft"
                                    isIconOnly
                                  >
                                    <Delete01Icon size={15} />
                                  </Button>
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
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div>
          <h3 className="text-base font-semibold">Pending Invites</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Active invite links for this organization.</p>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-zinc-500">No active invites.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((invite) => (
              <Card key={invite.id} className="bg-surface-secondary">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{invite.email}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {invite.role} · expires {timeUntil(invite.expires_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button onClick={() => void onCopyInviteLink(invite)} variant="secondary">
                      Copy link
                    </Button>
                    {canManageMembers && (
                      <Button
                        onClick={() => void onRevokeInvite(invite)}
                        isIconOnly
                        variant="danger-soft"
                      >
                        <Delete01Icon size={15} />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
