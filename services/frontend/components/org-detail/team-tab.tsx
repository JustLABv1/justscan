import { OrgInvite, OrgMember, OrgRole } from '@/lib/api';
import { displayUser, labelFor, pluralize, ROLE_LABELS } from '@/lib/labels';
import { fullDate, timeAgo, timeUntil } from '@/lib/time';
import {
  Avatar,
  Button,
  Card,
  ListBox,
  ResourceList,
  SearchField,
  Select,
  Spinner,
} from '@/components/ui';
import { RowActionsMenu, type RowActionItem } from '@/components/ui/row-actions-menu';
import { StatusTag } from '@/components/ui/status-dot';
import { Copy01Icon, Crown03Icon, Delete01Icon, PlusSignIcon } from 'hugeicons-react';
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
  pendingInviteAction: string | null;
  pendingMemberAction: string | null;
  featureDisabledReason?: string;
}

const EDITABLE_ROLES = ['viewer', 'editor', 'admin'] as const;
const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, editor: 2, viewer: 3 };

/** "Joined yesterday" rather than "Joined Yesterday"; dates keep their capitals. */
function relativeLower(value: string | null | undefined) {
  const text = timeAgo(value);
  return /^(Just now|Yesterday)$/.test(text) ? text.toLowerCase() : text;
}

function memberName(member: OrgMember) {
  return displayUser(member, 'Unknown member');
}

function memberInitials(member: OrgMember) {
  const words = memberName(member)
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return 'U';
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
  pendingInviteAction,
  pendingMemberAction,
  featureDisabledReason,
}: OrgTeamTabProps) {
  const [memberSearch, setMemberSearch] = useState('');
  const query = memberSearch.trim().toLowerCase();

  const sortedMembers = useMemo(() => {
    const filtered = query
      ? members.filter((member) =>
          [memberName(member), member.email, labelFor(ROLE_LABELS, member.role)]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(query))
        )
      : members;
    return [...filtered].sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        memberName(a).localeCompare(memberName(b), undefined, { sensitivity: 'base' })
    );
  }, [members, query]);

  const filteredInvites = useMemo(() => {
    if (!query) return invites;
    return invites.filter((invite) =>
      [invite.email, labelFor(ROLE_LABELS, invite.role)].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [invites, query]);

  const showSearch = members.length + invites.length > 6 || Boolean(memberSearch);
  const memberSummary = [
    pluralize(members.length, 'member'),
    invites.length > 0 ? pluralize(invites.length, 'pending invite') : null,
    currentOrgRole
      ? `you are ${labelFor(ROLE_LABELS, currentOrgRole).toLowerCase()}`
      : isSystemAdmin
        ? 'platform admin access'
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card>
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <Card.Title>Members</Card.Title>
          <Card.Description>{membersLoading ? 'Loading members…' : memberSummary}</Card.Description>
          {featureDisabledReason ? (
            <p className="mt-1 text-xs text-warning-foreground">{featureDisabledReason}</p>
          ) : null}
        </div>
        {canManageMembers ? (
          <Button
            onClick={onOpenInviteModal}
            isDisabled={
              Boolean(featureDisabledReason) ||
              pendingMemberAction !== null ||
              pendingInviteAction !== null
            }
          >
            <PlusSignIcon size={14} />
            Invite member
          </Button>
        ) : null}
      </Card.Header>

      <Card.Content className="space-y-4">
        {membersLoading ? (
          <div className="flex justify-center py-8" role="status">
            <Spinner />
            <span className="sr-only">Loading members</span>
          </div>
        ) : members.length === 0 && invites.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No members or pending invites.
          </p>
        ) : (
          <>
            {showSearch ? (
              <SearchField name="org-members-search" variant="secondary">
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    aria-label="Search members"
                    placeholder="Search members by name, email, or role..."
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            ) : null}

            {sortedMembers.length === 0 && filteredInvites.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No members match this search.
              </p>
            ) : (
              <ResourceList aria-label="Organization members">
                {sortedMembers.map((member) => {
                  const name = memberName(member);
                  const menuItems: RowActionItem[] = [];
                  if (canTransferOwnership && member.role !== 'owner') {
                    menuItems.push({
                      id: 'transfer',
                      label: 'Make owner',
                      icon: <Crown03Icon size={15} />,
                      pending: pendingMemberAction === `transfer:${member.user_id}`,
                      disabled: pendingMemberAction !== null,
                      onAction: () => void onTransferOwnership(member),
                    });
                  }
                  if (canManageMembers && member.role !== 'owner') {
                    menuItems.push({
                      id: 'remove',
                      label: 'Remove from organization',
                      icon: <Delete01Icon size={15} />,
                      variant: 'danger',
                      pending: pendingMemberAction === `remove:${member.user_id}`,
                      disabled: pendingMemberAction !== null,
                      onAction: () => void onRemoveMember(member),
                    });
                  }
                  return (
                    <ResourceList.Item
                      key={member.user_id}
                      media={
                        <Avatar color="accent" size="sm" variant="soft">
                          <Avatar.Fallback>{memberInitials(member)}</Avatar.Fallback>
                        </Avatar>
                      }
                      title={name}
                      description={
                        <>
                          {member.email && member.email !== name ? `${member.email} · ` : ''}
                          <span title={fullDate(member.joined_at)}>
                            Joined {relativeLower(member.joined_at)}
                          </span>
                        </>
                      }
                      meta={
                        canEditRoles && member.role !== 'owner' ? (
                          <Select
                            aria-label={`Role for ${name}`}
                            value={member.role}
                            isDisabled={pendingMemberAction !== null}
                            onChange={(value) =>
                              void onMemberRoleChange(
                                member,
                                String(value) as Extract<OrgRole, 'admin' | 'editor' | 'viewer'>
                              )
                            }
                          >
                            <Select.Trigger className={`${inputClassName} w-32 text-sm`}>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {EDITABLE_ROLES.map((role) => (
                                  <ListBox.Item key={role} id={role} textValue={ROLE_LABELS[role]}>
                                    {ROLE_LABELS[role]}
                                  </ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        ) : (
                          <StatusTag tone={member.role === 'owner' ? 'accent' : undefined}>
                            {labelFor(ROLE_LABELS, member.role)}
                          </StatusTag>
                        )
                      }
                      actions={
                        menuItems.length > 0 ? (
                          <RowActionsMenu label={`Actions for ${name}`} items={menuItems} />
                        ) : null
                      }
                    />
                  );
                })}
                {filteredInvites.length > 0 ? (
                  <ResourceList.Section title="Pending invitations">
                    {filteredInvites.map((invite) => (
                      <ResourceList.Item
                        key={invite.id}
                        tone="warning"
                        media={
                          <Avatar color="warning" size="sm" variant="soft">
                            <Avatar.Fallback>
                              {invite.email.charAt(0).toUpperCase()}
                            </Avatar.Fallback>
                          </Avatar>
                        }
                        title={invite.email}
                        description={
                          <span title={fullDate(invite.expires_at)}>
                            Invited as {labelFor(ROLE_LABELS, invite.role).toLowerCase()} · expires{' '}
                            {timeUntil(invite.expires_at)}
                          </span>
                        }
                        actions={
                          <RowActionsMenu
                            label={`Actions for the invite to ${invite.email}`}
                            items={[
                              {
                                id: 'copy',
                                label: 'Copy invite link',
                                icon: <Copy01Icon size={15} />,
                                disabled: pendingInviteAction !== null,
                                onAction: () => void onCopyInviteLink(invite),
                              },
                              ...(canManageMembers
                                ? [
                                    {
                                      id: 'revoke',
                                      label: 'Revoke invite',
                                      icon: <Delete01Icon size={15} />,
                                      variant: 'danger' as const,
                                      pending: pendingInviteAction === invite.id,
                                      disabled: pendingInviteAction !== null,
                                      onAction: () => void onRevokeInvite(invite),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        }
                      />
                    ))}
                  </ResourceList.Section>
                ) : null}
              </ResourceList>
            )}
          </>
        )}
      </Card.Content>
    </Card>
  );
}
