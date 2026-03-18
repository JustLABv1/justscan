'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { useToast } from '@/components/toast';
import {
    createWatchlistItem, deleteWatchlistItem, listRegistries, listWatchlist,
    Registry, triggerWatchlistScan, updateWatchlistItem, WatchlistItem,
} from '@/lib/api';
import { cronToHuman } from '@/lib/cron';
import { timeAgo } from '@/lib/time';
import { ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { Clock01Icon, Delete01Icon, EyeIcon, PencilEdit01Icon, PlayIcon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

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
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await listWatchlist()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); listRegistries().then(setRegistries).catch(() => {}); }, [load]);

  function openCreate() {
    setEditing(null); setImageName(''); setImageTag('latest'); setSchedule('0 2 * * *');
    setEnabled(true); setRegistryId(''); setFormError(''); modal.open();
  }
  function openEdit(item: WatchlistItem) {
    setEditing(item); setImageName(item.image_name); setImageTag(item.image_tag);
    setSchedule(item.schedule ?? '0 2 * * *'); setEnabled(item.enabled);
    setRegistryId(item.registry_id ?? ''); setFormError(''); modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      const data = { image_name: imageName, image_tag: imageTag, schedule, enabled, ...(registryId ? { registry_id: registryId } : {}) };
      if (editing) { await updateWatchlistItem(editing.id, data); toast.success('Watchlist item updated'); }
      else { await createWatchlistItem(data); toast.success('Added to watchlist'); }
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Remove from watchlist?',
      message: 'This image will no longer be automatically scanned on a schedule.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteWatchlistItem(id).catch(() => {});
    toast.success('Removed from watchlist');
    load();
  }
  async function handleTrigger(id: string) {
    setTriggering(id);
    try { await triggerWatchlistScan(id); toast.success('Scan triggered'); } catch { /* ignore */ }
    finally { setTriggering(''); load(); }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Watchlist</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Auto-scan images on a schedule</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
        >
          <PlusSignIcon size={15} /> Add Image
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <EyeIcon size={32} color="rgba(113,113,122,0.5)" />
          <p className="text-sm text-zinc-500">No images being watched. Add one to auto-scan on a schedule.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Schedule</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Registry</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Last Scan</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const reg = registries.find((r) => r.id === item.registry_id);
                return (
                  <tr key={item.id} style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-200">{item.image_name}:{item.image_tag}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgba(167,139,250,0.8)' }} title={item.schedule}>
                        <Clock01Icon size={12} color="rgba(113,113,122,0.7)" className="shrink-0" />
                        {cronToHuman(item.schedule ?? '')}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{reg?.name ?? <span className="text-zinc-400 dark:text-zinc-700">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                        style={item.enabled
                          ? { color: '#34d399', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.22)' }
                          : { color: '#71717a', background: 'rgba(113,113,122,0.08)', border: '1px solid rgba(113,113,122,0.15)' }
                        }>
                        <span className={`w-1.5 h-1.5 rounded-full bg-current ${item.enabled ? 'animate-pulse' : ''}`} />
                        {item.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {item.last_scan_id ? (
                        <Link href={`/scans/${item.last_scan_id}`} className="hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
                          {timeAgo(item.last_scanned_at)}
                        </Link>
                      ) : <span className="text-zinc-400 dark:text-zinc-700">Never</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => handleTrigger(item.id)} disabled={triggering === item.id}
                          className="text-zinc-400 dark:text-zinc-600 hover:text-violet-500 dark:hover:text-violet-400 disabled:opacity-50 transition-colors p-1.5" title="Scan now">
                          {triggering === item.id
                            ? <div className="w-3.5 h-3.5 border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-400 rounded-full animate-spin" />
                            : <PlayIcon size={15} />}
                        </button>
                        <button onClick={() => openEdit(item)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors p-1.5" title="Edit">
                          <PencilEdit01Icon size={15} />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1.5" title="Delete">
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
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editing ? 'Edit Watchlist Item' : 'Add to Watchlist'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="watchlist-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image Name</label>
                      <input className={inputCls + ' font-mono'} placeholder="nginx"
                        value={imageName} onChange={(e) => setImageName(e.target.value)} required />
                    </div>
                    <div className="w-28 space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                      <input className={inputCls + ' font-mono'} placeholder="latest"
                        value={imageTag} onChange={(e) => setImageTag(e.target.value)} required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Schedule <span className="text-zinc-400 dark:text-zinc-600 font-normal">(cron)</span></label>
                    <input className={inputCls + ' font-mono'} placeholder="0 2 * * *"
                      value={schedule} onChange={(e) => setSchedule(e.target.value)} required />
                    <p className="text-xs text-zinc-500">e.g. <code className="text-zinc-400 dark:text-zinc-500">0 2 * * *</code> = daily at 2 am</p>
                  </div>
                  {registries.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Registry <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span></label>
                      <Select selectedKey={registryId} onSelectionChange={k => setRegistryId(String(k === '__none__' ? '' : k))}>
                        <Select.Trigger className={inputCls}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Public / Docker Hub</ListBox.Item>
                            {registries.map((r) => <ListBox.Item key={r.id} id={r.id}>{r.name}</ListBox.Item>)}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                  )}
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <button
                      type="button"
                      onClick={() => setEnabled(!enabled)}
                      className="relative w-9 h-5 rounded-full transition-colors shrink-0"
                      style={{ background: enabled ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : 'var(--glass-border)' }}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow ${enabled ? 'translate-x-4' : ''}`} />
                    </button>
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Enabled</span>
                  </label>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>Cancel</button>
                <button type="submit" form="watchlist-form" disabled={saving}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editing ? 'Save' : 'Add'}
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
