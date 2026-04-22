import { OrgInvite, OrgMember, OrgRole } from '@/lib/api';
import { timeAgo, timeUntil } from '@/lib/time';
import { Delete01Icon, PlusSignIcon } from 'hugeicons-react';

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
  onMemberRoleChange: (member: OrgMember, nextRole: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>) => void | Promise<void>;
  onOpenInviteModal: () => void;
  onRemoveMember: (member: OrgMember) => void | Promise<void>;
  onRevokeInvite: (invite: OrgInvite) => void | Promise<void>;
  onTransferOwnership: (member: OrgMember) => void | Promise<void>;
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
}: OrgTeamTabProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Members</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {currentOrgRole ? `Your role: ${currentOrgRole}` : isSystemAdmin ? 'Platform admin access' : 'Organization members'}
            </p>
          </div>
          {canManageMembers && (
            <button onClick={onOpenInviteModal} className="btn-primary inline-flex items-center gap-2" type="button">
              <PlusSignIcon size={14} />
              Invite Member
            </button>
          )}
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          {membersLoading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <div className="px-6 py-8 text-sm text-zinc-500 text-center">No members found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Joined</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {members.map((member, index) => (
                  <tr
                    key={member.user_id}
                    style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-zinc-800 dark:text-zinc-200">{member.username || member.email || member.user_id}</p>
                        {member.email && <p className="text-xs text-zinc-500 mt-0.5">{member.email}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {canEditRoles && member.role !== 'owner' ? (
                        <select
                          className={`${inputClassName} py-2 px-3 max-w-[140px] text-sm`}
                          value={member.role}
                          onChange={(event) => void onMemberRoleChange(member, event.target.value as Extract<OrgRole, 'admin' | 'editor' | 'viewer'>)}
                        >
                          <option value="viewer">viewer</option>
                          <option value="editor">editor</option>
                          <option value="admin">admin</option>
                        </select>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-violet-500/10 text-violet-400 border-violet-500/20">
                          {member.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{timeAgo(member.joined_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canTransferOwnership && member.role !== 'owner' && (
                          <button
                            onClick={() => void onTransferOwnership(member)}
                            className="btn-secondary text-xs px-3 py-1.5"
                            type="button"
                          >
                            Make owner
                          </button>
                        )}
                        {canManageMembers && member.role !== 'owner' && (
                          <button onClick={() => void onRemoveMember(member)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors" title="Remove member" type="button">
                            <Delete01Icon size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="glass-panel relative rounded-2xl p-5 space-y-3">
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none" style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.15),transparent)' }} />
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Pending Invites</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Active invite links for this organization.</p>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-zinc-500">No active invites.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((invite) => (
              <div key={invite.id} className="rounded-xl px-4 py-3 flex items-center justify-between gap-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{invite.email}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{invite.role} · expires {timeUntil(invite.expires_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => void onCopyInviteLink(invite)} className="btn-secondary text-xs px-3 py-1.5" type="button">Copy link</button>
                  {canManageMembers && (
                    <button onClick={() => void onRevokeInvite(invite)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors" title="Revoke invite" type="button">
                      <Delete01Icon size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}