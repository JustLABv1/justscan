'use client';
import { createScan, deleteScan, listScans, listTags, Scan, Tag } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { Delete01Icon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const SEV_CELL: Record<string, string> = {
  critical: 'text-red-400 font-bold',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    failed:    'bg-red-500/15 text-red-400 border-red-500/20',
    running:   'bg-blue-500/15 text-blue-400 border-blue-500/20',
    pending:   'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
  };
  const cls = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'running' ? 'bg-blue-400 animate-pulse' : 'bg-current'}`} />
      {status}
    </span>
  );
}

const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors';

export default function ScansPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const modal = useOverlayState();
  const LIMIT = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await listScans(p, LIMIT);
      setScans(res.data ?? []);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page); }, [load, page]);
  useEffect(() => { listTags().then(setTags).catch(() => {}); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      await createScan(imageName, imageTag);
      modal.close();
      setImageName('');
      setImageTag('latest');
      await load(1);
      setPage(1);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create scan');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this scan?')) return;
    await deleteScan(id).catch(() => {});
    load(page);
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Scans</h1>
          {total > 0 && <p className="text-sm text-zinc-500 mt-0.5">{total} scans total</p>}
        </div>
        <button
          onClick={modal.open}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <PlusSignIcon size={16} />
          New Scan
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Table */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-red-500/70 uppercase tracking-wider">C</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-orange-500/70 uppercase tracking-wider">H</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-yellow-500/70 uppercase tracking-wider">M</th>
              <th className="text-center px-3 py-3 text-xs font-medium text-blue-500/70 uppercase tracking-wider">L</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Tags</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-16 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
                  </div>
                </td>
              </tr>
            ) : scans.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-16 text-center text-zinc-600 text-sm">
                  No scans yet. Create one to get started.
                </td>
              </tr>
            ) : scans.map((scan) => (
              <tr key={scan.id} className="hover:bg-zinc-800/40 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/scans/${scan.id}`} className="font-mono text-zinc-200 hover:text-violet-400 transition-colors text-sm">
                    {scan.image_name}:{scan.image_tag}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={scan.status} />
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.critical_count ? SEV_CELL.critical : 'text-zinc-700'}>
                    {scan.critical_count || '—'}
                  </span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.high_count ? SEV_CELL.high : 'text-zinc-700'}>
                    {scan.high_count || '—'}
                  </span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.medium_count ? SEV_CELL.medium : 'text-zinc-700'}>
                    {scan.medium_count || '—'}
                  </span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.low_count ? SEV_CELL.low : 'text-zinc-700'}>
                    {scan.low_count || '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(scan.tags ?? []).map((t) => (
                      <span
                        key={t.id}
                        className="inline-block text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: t.color + '22', color: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                  {new Date(scan.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDelete(scan.id)}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                    title="Delete scan"
                  >
                    <Delete01Icon size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{total} scans</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Create modal */}
      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="bg-zinc-900 border border-zinc-800 rounded-2xl">
              <Modal.Header className="border-b border-zinc-800 px-6 py-4">
                <Modal.Heading className="text-white font-semibold">New Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="create-scan-form" onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-sm text-red-400">
                      {createError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Image Name</label>
                    <input
                      className={inputCls + ' font-mono'}
                      placeholder="nginx"
                      value={imageName}
                      onChange={(e) => setImageName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Tag</label>
                    <input
                      className={inputCls + ' font-mono'}
                      placeholder="latest"
                      value={imageTag}
                      onChange={(e) => setImageTag(e.target.value)}
                      required
                    />
                  </div>
                  {tags.length > 0 && (
                    <p className="text-xs text-zinc-600">Tags can be added from the scan detail page after creation.</p>
                  )}
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
                  form="create-scan-form"
                  disabled={creating}
                  className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-60 transition-colors flex items-center gap-2"
                >
                  {creating ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : null}
                  Start Scan
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
