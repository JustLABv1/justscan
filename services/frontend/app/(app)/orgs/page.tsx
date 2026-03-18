'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { createOrg, deleteOrg, listOrgs, Org } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { ArrowRight01Icon, Building04Icon, Delete01Icon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

interface OrgWithCount extends Org { policy_count: number }

export default function OrgsPage() {
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try { setOrgs((await listOrgs()) as OrgWithCount[]); }
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

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Organizations</h1>
          {orgs.length > 0 && <p className="text-sm text-zinc-500 mt-0.5">{orgs.length} organization{orgs.length !== 1 ? 's' : ''}</p>}
        </div>
        <button
          onClick={modal.open}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
        >
          <PlusSignIcon size={15} /> New Organization
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>{error}</div>
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
          <button onClick={modal.open} className="mt-1 text-sm font-medium text-violet-500 hover:text-violet-400 dark:text-violet-400 dark:hover:text-violet-300 transition-colors">
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
                <button onClick={() => handleDelete(org.id, org.name)}
                  className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1" title="Delete organization">
                  <Delete01Icon size={15} />
                </button>
                <Link href={`/orgs/${org.id}`}
                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                  View details <ArrowRight01Icon size={13} />
                </Link>
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
                  {createError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {createError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Name <span className="text-red-400">*</span></label>
                    <input className={inputCls} placeholder="e.g. Production"
                      value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Description</label>
                    <input className={inputCls} placeholder="Optional description"
                      value={description} onChange={(e) => setDescription(e.target.value)} />
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>Cancel</button>
                <button type="submit" form="create-org-form" disabled={creating}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
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
