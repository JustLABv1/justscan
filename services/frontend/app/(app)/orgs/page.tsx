'use client';
import { createOrg, deleteOrg, listOrgs, Org } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { ArrowRight01Icon, Building04Icon, Delete01Icon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors';

interface OrgWithCount extends Org {
  policy_count: number;
}

export default function OrgsPage() {
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const modal = useOverlayState();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listOrgs();
      setOrgs(data as OrgWithCount[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    if (!confirm(`Delete organization "${orgName}"? This will remove all policies and compliance results.`)) return;
    await deleteOrg(id).catch(() => {});
    load();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Organizations</h1>
          {orgs.length > 0 && (
            <p className="text-sm text-zinc-500 mt-0.5">{orgs.length} organization{orgs.length !== 1 ? 's' : ''}</p>
          )}
        </div>
        <button
          onClick={modal.open}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <PlusSignIcon size={16} />
          New Organization
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 space-y-3">
          <Building04Icon size={36} className="text-zinc-700" />
          <p className="text-sm text-zinc-600">No organizations yet. Create one to start managing compliance policies.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {orgs.map((org) => (
            <div
              key={org.id}
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 flex flex-col gap-3 hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-violet-600/20 flex items-center justify-center shrink-0">
                    <Building04Icon size={18} className="text-violet-400" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white truncate">{org.name}</h2>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">
                      {org.description || 'No description'}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                  {org.policy_count ?? 0} {org.policy_count === 1 ? 'policy' : 'policies'}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
                <button
                  onClick={() => handleDelete(org.id, org.name)}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                  title="Delete organization"
                >
                  <Delete01Icon size={15} />
                </button>
                <Link
                  href={`/orgs/${org.id}`}
                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-violet-400 transition-colors"
                >
                  View
                  <ArrowRight01Icon size={13} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <Modal.Header className="border-b border-zinc-800 px-6 py-4">
                <Modal.Heading className="text-white font-semibold">New Organization</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="create-org-form" onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                      {createError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Name <span className="text-red-400">*</span></label>
                    <input
                      className={inputCls}
                      placeholder="e.g. Production"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Description</label>
                    <input
                      className={inputCls}
                      placeholder="Optional description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="border-t border-zinc-800 px-6 py-4 flex gap-3 justify-end">
                <button
                  onClick={modal.close}
                  className="px-4 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="create-org-form"
                  disabled={creating}
                  className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-60 transition-colors flex items-center gap-2"
                >
                  {creating && (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  Create
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
