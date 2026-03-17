'use client';
import {
  createWatchlistItem,
  deleteWatchlistItem,
  listRegistries,
  listWatchlist,
  Registry,
  triggerWatchlistScan,
  updateWatchlistItem,
  WatchlistItem,
} from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Clock01Icon, Delete01Icon, PencilEdit01Icon, PlayIcon, PlusSignIcon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors';
const selectCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors';

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<WatchlistItem | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [schedule, setSchedule] = useState('0 2 * * *');
  const [enabled, setEnabled] = useState(true);
  const [registryId, setRegistryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [triggering, setTriggering] = useState('');
  const modal = useOverlayState();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listWatchlist());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    listRegistries().then(setRegistries).catch(() => {});
  }, [load]);

  function openCreate() {
    setEditing(null); setImageName(''); setImageTag('latest'); setSchedule('0 2 * * *');
    setEnabled(true); setRegistryId(''); setFormError('');
    modal.open();
  }

  function openEdit(item: WatchlistItem) {
    setEditing(item); setImageName(item.image_name); setImageTag(item.image_tag);
    setSchedule(item.schedule ?? '0 2 * * *'); setEnabled(item.enabled);
    setRegistryId(item.registry_id ?? ''); setFormError('');
    modal.open();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(''); setSaving(true);
    try {
      const data = { image_name: imageName, image_tag: imageTag, schedule, enabled, ...(registryId ? { registry_id: registryId } : {}) };
      if (editing) await updateWatchlistItem(editing.id, data);
      else await createWatchlistItem(data);
      modal.close();
      await load();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this item from the watchlist?')) return;
    await deleteWatchlistItem(id).catch(() => {});
    load();
  }

  async function handleTrigger(id: string) {
    setTriggering(id);
    try { await triggerWatchlistScan(id); } catch { /* ignore */ } finally {
      setTriggering('');
      load();
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Watchlist</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Auto-scan images on a schedule</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <PlusSignIcon size={16} />
          Add Image
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 py-16 text-center text-zinc-600 text-sm">
          No images being watched. Add one to auto-scan on a schedule.
        </div>
      ) : (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Schedule</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Registry</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Last Scan</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {items.map((item) => {
                const reg = registries.find((r) => r.id === item.registry_id);
                return (
                  <tr key={item.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-200">
                      {item.image_name}:{item.image_tag}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-400">
                        <Clock01Icon size={13} className="text-zinc-600 shrink-0" />
                        {item.schedule}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {reg?.name ?? <span className="text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${
                        item.enabled
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full bg-current ${item.enabled ? 'animate-pulse' : ''}`} />
                        {item.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500 font-mono">
                      {item.last_scan_id
                        ? item.last_scan_id.slice(0, 8) + '…'
                        : <span className="text-zinc-700">Never</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleTrigger(item.id)}
                          disabled={triggering === item.id}
                          className="text-zinc-600 hover:text-violet-400 disabled:opacity-50 transition-colors p-1.5"
                          title="Scan now"
                        >
                          {triggering === item.id
                            ? <div className="w-3.5 h-3.5 border-2 border-zinc-600 border-t-violet-400 rounded-full animate-spin" />
                            : <PlayIcon size={15} />
                          }
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          className="text-zinc-600 hover:text-zinc-300 transition-colors p-1.5"
                          title="Edit"
                        >
                          <PencilEdit01Icon size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-zinc-600 hover:text-red-400 transition-colors p-1.5"
                          title="Delete"
                        >
                          <Delete01Icon size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <Modal.Header className="border-b border-zinc-800 px-6 py-4">
                <Modal.Heading className="text-white font-semibold">
                  {editing ? 'Edit Watchlist Item' : 'Add to Watchlist'}
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="watchlist-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                      {formError}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-sm font-medium text-zinc-300">Image Name</label>
                      <input
                        className={inputCls + ' font-mono'}
                        placeholder="nginx"
                        value={imageName}
                        onChange={(e) => setImageName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="w-28 space-y-1.5">
                      <label className="text-sm font-medium text-zinc-300">Tag</label>
                      <input
                        className={inputCls + ' font-mono'}
                        placeholder="latest"
                        value={imageTag}
                        onChange={(e) => setImageTag(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">
                      Schedule <span className="text-zinc-600 font-normal">(cron)</span>
                    </label>
                    <input
                      className={inputCls + ' font-mono'}
                      placeholder="0 2 * * *"
                      value={schedule}
                      onChange={(e) => setSchedule(e.target.value)}
                      required
                    />
                    <p className="text-xs text-zinc-600">e.g. <code className="text-zinc-500">0 2 * * *</code> = daily at 2am</p>
                  </div>
                  {registries.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-300">
                        Registry <span className="text-zinc-600 font-normal">(optional)</span>
                      </label>
                      <select value={registryId} onChange={(e) => setRegistryId(e.target.value)} className={selectCls}>
                        <option value="">Public / Docker Hub</option>
                        {registries.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <div
                      onClick={() => setEnabled(!enabled)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-violet-600' : 'bg-zinc-700'}`}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                    </div>
                    <span className="text-sm font-medium text-zinc-300">Enabled</span>
                  </label>
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
                  form="watchlist-form"
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
