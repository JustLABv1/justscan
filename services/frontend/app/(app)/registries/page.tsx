'use client';
import { createRegistry, deleteRegistry, listRegistries, Registry, updateRegistry } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors';

export default function RegistriesPage() {
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Registry | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<'none' | 'basic' | 'token' | 'aws_ecr'>('none');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const modal = useOverlayState();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRegistries(await listRegistries());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null); setName(''); setUrl(''); setAuthType('basic'); setUsername(''); setPassword(''); setFormError('');
    modal.open();
  }

  function openEdit(r: Registry) {
    setEditing(r); setName(r.name); setUrl(r.url); setAuthType(r.auth_type ?? 'none'); setUsername(r.username ?? ''); setPassword(''); setFormError('');
    modal.open();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(''); setSaving(true);
    try {
      if (editing) {
        await updateRegistry(editing.id, { name, url, auth_type: authType, username, ...(password ? { password } : {}) });
      } else {
        await createRegistry({ name, url, auth_type: authType, username: username || undefined, password: password || undefined });
      }
      modal.close();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this registry?')) return;
    await deleteRegistry(id).catch(() => {});
    load();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Registries</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Configure private Docker registries</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <PlusSignIcon size={16} />
          Add Registry
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
        </div>
      ) : registries.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 py-16 text-center text-zinc-600 text-sm">
          No registries configured. Add one to use private images.
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">URL</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Auth</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Username</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {registries.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-200">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{r.url}</td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{r.auth_type ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{r.username || <span className="text-zinc-700">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(r)}
                        className="text-zinc-600 hover:text-zinc-300 transition-colors p-1.5"
                        title="Edit"
                      >
                        <PencilEdit01Icon size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors p-1.5"
                        title="Delete"
                      >
                        <Delete01Icon size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <Modal.Header className="border-b border-zinc-800 px-6 py-4">
                <Modal.Heading className="text-white font-semibold">{editing ? 'Edit Registry' : 'Add Registry'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="registry-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Name</label>
                    <input className={inputCls} placeholder="My Registry" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">URL</label>
                    <input className={inputCls + ' font-mono'} placeholder="https://registry.example.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Auth Type</label>
                    <select
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as 'none' | 'basic' | 'token' | 'aws_ecr')}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                    >
                      <option value="none">None (public registry)</option>
                      <option value="basic">Basic (username / password)</option>
                      <option value="token">Token</option>
                      <option value="aws_ecr">AWS ECR</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Username <span className="text-zinc-600 font-normal">(optional)</span></label>
                    <input className={inputCls} placeholder="Optional" value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">
                      Password{' '}
                      {editing
                        ? <span className="text-zinc-600 font-normal">(leave blank to keep unchanged)</span>
                        : <span className="text-zinc-600 font-normal">(optional)</span>
                      }
                    </label>
                    <input
                      type="password"
                      className={inputCls}
                      placeholder={editing ? '••••••••' : 'Optional'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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
                  form="registry-form"
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-60 transition-colors flex items-center gap-2"
                >
                  {saving ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  {editing ? 'Save' : 'Add'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
