'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { acceptOrgInvite, createOrg, declineOrgInvite, deleteOrg, getUser, listMyOrgInvites, listOrgs, Org, OrgInvite } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { ArrowRight01Icon, Building04Icon, Delete01Icon, PlusSignIcon, UserAdd01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface OrgWithCount extends Org { policy_count: number }

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
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOrgs, nextInvites] = await Promise.all([listOrgs(), listMyOrgInvites()]);
      setOrgs(nextOrgs as OrgWithCount[]);
      setPendingInvites(nextInvites);
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load organizations'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setCreateError(''); setCreating(true);
    try {
      await createOrg(name, description);
      modal.close(); setName(''); setDescription(''); await load();
    } catch (err: unknown) { setCreateError(err instanceof Error ? err.message : 'Failed to create organization'); }
    finally { setCreating(false); }
  }

  async function handleDelete(id: string, orgName: string) {
    const ok = await confirm({
      title: `Delete "${orgName}"?`,
      message: 'All policies and compliance results for this organization will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteOrg(id).catch(() => {}); load();
  }

  async function handleAcceptInvite(invite: OrgInvite) {
    setInviteActionId(invite.id);
    setInviteError('');
    try {
      const result = await acceptOrgInvite(invite.id);
      toast.success(`Joined ${result.org_name || invite.org_name || 'organization'} as ${result.role}`);
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
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Organizations</h1>
          {orgs.length > 0 && <p className="text-sm text-zinc-500 mt-0.5">{orgs.length} organization{orgs.length !== 1 ? 's' : ''}</p>}
        </div>
        <button
          onClick={modal.open}
          className="btn-primary inline-flex items-center gap-2"
        >
          <PlusSignIcon size={15} /> New Organization
        </button>
      </div>

      {error ? <FormAlert description={error} title="Organization loading failed" /> : null}
      {inviteError ? <FormAlert description={inviteError} title="Invite action failed" /> : null}

      {pendingInvites.length > 0 && (
        <section className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.22)' }}>
              <UserAdd01Icon size={20} color="#f59e0b" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Pending Invites</h2>
              <p className="text-sm text-zinc-500">Review organization invitations tied to your account email.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {pendingInvites.map((invite) => {
              const busy = inviteActionId === invite.id;
              return (
                <div key={invite.id} className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{invite.org_name || 'Organization'}</p>
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.22)', color: '#a78bfa' }}>
                          {invite.role}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">Invited by {invite.invited_by_username || invite.invited_by_email || 'a teammate'}</p>
                    </div>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-zinc-500"
                      style={{ background: 'var(--row-divider)' }}>
                      Expires {new Date(invite.expires_at).toLocaleDateString()}
                    </span>
                  </div>

                  {invite.org_description && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">{invite.org_description}</p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      className="btn-primary inline-flex items-center gap-2"
                      disabled={busy}
                      onClick={() => { void handleAcceptInvite(invite); }}
                      type="button"
                    >
                      {busy && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                      Accept
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => { void handleDeclineInvite(invite); }}
                      type="button"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="glass-panel rounded-2xl py-20 flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.2)' }}>
            <Building04Icon size={28} color="rgba(167,139,250,0.6)" />
          </div>
          <p className="text-sm text-zinc-500 text-center max-w-xs">
            No organizations yet. Create one to start managing compliance policies.
          </p>
          <button onClick={modal.open} className="btn-secondary mt-1" type="button">
            Create organization →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {orgs.map((org) => (
            <div key={org.id} className="glass-panel relative rounded-2xl p-5 flex flex-col gap-4 group transition-all duration-200 cursor-default"
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(167,139,250,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--glass-border)')}>
              <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
                style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.15),transparent)' }} />

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(124,58,237,0.2)', boxShadow: '0 0 14px rgba(124,58,237,0.3)', border: '1px solid rgba(167,139,250,0.15)' }}>
                  <Building04Icon size={19} color="#a78bfa" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{org.name}</h2>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">{org.description || 'No description'}</p>
                </div>
                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{ color: '#a78bfa', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.2)' }}>
                  {org.policy_count ?? 0} {org.policy_count === 1 ? 'policy' : 'policies'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1"
                style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <Link href={`/orgs/${org.id}`}
                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                  View details <ArrowRight01Icon size={13} />
                </Link>
                {(isSystemAdmin || org.current_user_role === 'owner') ? (
                  <RowActionsMenu
                    label={`Open actions menu for ${org.name}`}
                    items={[
                      { id: 'delete', label: 'Delete organization', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(org.id, org.name); } },
                    ]}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">New Organization</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="create-org-form" onSubmit={handleCreate} className="space-y-4">
                  {createError ? <FormAlert description={createError} title="Organization creation failed" /> : null}
                  <FormField label="Name" onChange={(e) => setName(e.target.value)} placeholder="e.g. Production" required value={name} />
                  <FormField label="Description" onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" value={description} />
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="btn-secondary" type="button">Cancel</button>
                <button type="submit" form="create-org-form" disabled={creating}
                  className="btn-primary inline-flex items-center gap-2">
                  {creating && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Create
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
