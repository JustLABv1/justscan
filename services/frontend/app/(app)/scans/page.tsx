'use client';
import { createScan, deleteScan, listScans, Scan } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { CheckmarkSquare01Icon, Delete01Icon, FileExportIcon, GitCompareIcon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

const SEV_CELL: Record<string, string> = {
  critical: 'text-red-400 font-bold',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

const STATUS: Record<string, { color: string; bg: string; border: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.22)'  },
  failed:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.22)'   },
  running:   { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.22)'  },
  pending:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  );
}

export default function ScansPage() {
  const [scans, setScans] = useState<Scan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageTag, setImageTag] = useState('latest');
  const [platform, setPlatform] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(''); setCreating(true);
    try {
      await createScan(imageName, imageTag, undefined, undefined, platform || undefined);
      modal.close(); setImageName(''); setImageTag('latest'); setPlatform('');
      await load(1); setPage(1);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create scan');
    } finally { setCreating(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this scan?')) return;
    await deleteScan(id).catch(() => {});
    load(page);
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const colCount = selecting ? 10 : 9;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Scans</h1>
          {total > 0 && <p className="text-sm text-zinc-500 mt-0.5">{total} scans total</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelecting(s => !s); setSelected(new Set()); }}
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl transition-all duration-150"
            style={selecting
              ? { background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd' }
              : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }
            }
          >
            <CheckmarkSquare01Icon size={15} />
            {selecting ? 'Cancel' : 'Select'}
          </button>
          <Link
            href="/scans/compare"
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl transition-all duration-150"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
          >
            <GitCompareIcon size={15} />
            Compare
          </Link>
          <button
            onClick={modal.open}
            className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90 active:scale-95"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
          >
            <PlusSignIcon size={15} />
            New Scan
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
              {selecting && <th className="px-3 py-3 w-8" />}
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }}>C</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }}>H</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }}>M</th>
              <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }}>L</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Tags</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="py-16 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
                  </div>
                </td>
              </tr>
            ) : scans.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-16 text-center text-zinc-500 text-sm">
                  No scans yet. Create one to get started.
                </td>
              </tr>
            ) : scans.map((scan, i) => (
              <tr
                key={scan.id}
                className="transition-colors"
                style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {selecting && (
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSelect(scan.id)}
                      aria-label={selected.has(scan.id) ? 'Deselect' : 'Select'}
                      className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
                      style={selected.has(scan.id)
                        ? { background: 'rgba(124,58,237,0.9)', border: '1px solid rgba(167,139,250,0.8)' }
                        : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                    >
                      {selected.has(scan.id) && (
                        <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/scans/${scan.id}`} className="font-mono text-zinc-700 dark:text-zinc-300 hover:text-violet-500 dark:hover:text-violet-400 transition-colors text-sm">
                    {scan.image_name}:{scan.image_tag}
                  </Link>
                </td>
                <td className="px-4 py-3"><StatusBadge status={scan.status} /></td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.critical_count ? SEV_CELL.critical : 'text-zinc-400 dark:text-zinc-700'}>{scan.critical_count || '—'}</span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.high_count ? SEV_CELL.high : 'text-zinc-400 dark:text-zinc-700'}>{scan.high_count || '—'}</span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.medium_count ? SEV_CELL.medium : 'text-zinc-400 dark:text-zinc-700'}>{scan.medium_count || '—'}</span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.low_count ? SEV_CELL.low : 'text-zinc-400 dark:text-zinc-700'}>{scan.low_count || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(scan.tags ?? []).map((t) => (
                      <span key={t.id} className="inline-block text-xs px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: t.color + '22', color: t.color, border: `1px solid ${t.color}33` }}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                  {new Date(scan.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button onClick={() => handleDelete(scan.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors" title="Delete">
                    <Delete01Icon size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Multi-select export bar */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 px-6 py-3 flex items-center justify-between z-20 print:hidden"
          style={{ background: 'var(--modal-bg)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid var(--border-subtle)' }}
        >
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{selected.size} scan{selected.size !== 1 ? 's' : ''} selected</span>
          <div className="flex gap-3">
            <button onClick={() => setSelected(new Set())} className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">Clear</button>
            <a
              href={`/reports/print?scans=${[...selected].join(',')}`}
              target="_blank"
              className="flex items-center gap-2 text-sm font-semibold text-white px-4 py-2 rounded-xl transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35)' }}
            >
              <FileExportIcon size={15} /> Export Report
            </a>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{total} scans</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >← Prev</button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >Next →</button>
          </div>
        </div>
      )}

      {/* Create modal */}
      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">New Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="create-scan-form" onSubmit={handleCreate} className="space-y-4">
                  {createError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {createError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image Name</label>
                    <input className={inputCls + ' font-mono'} placeholder="nginx"
                      value={imageName} onChange={(e) => setImageName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                    <input className={inputCls + ' font-mono'} placeholder="latest"
                      value={imageTag} onChange={(e) => setImageTag(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Platform <span className="text-zinc-400 dark:text-zinc-600 font-normal">(optional)</span></label>
                    <select className={inputCls} value={platform} onChange={(e) => setPlatform(e.target.value)}>
                      <option value="">Auto-detect</option>
                      <option value="linux/amd64">linux/amd64</option>
                      <option value="linux/arm64">linux/arm64</option>
                      <option value="linux/arm/v7">linux/arm/v7</option>
                      <option value="linux/arm/v6">linux/arm/v6</option>
                      <option value="linux/386">linux/386</option>
                      <option value="linux/s390x">linux/s390x</option>
                      <option value="linux/ppc64le">linux/ppc64le</option>
                      <option value="windows/amd64">windows/amd64</option>
                    </select>
                  </div>
                  <p className="text-xs text-zinc-500">Tags can be added from the scan detail page after creation.</p>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  Cancel
                </button>
                <button type="submit" form="create-scan-form" disabled={creating}
                  className="px-4 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-60 flex items-center gap-2 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                  {creating && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
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
