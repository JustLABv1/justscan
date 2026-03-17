'use client';
import { createScan, deleteScan, listScans, Scan } from '@/lib/api';
import { Modal, useOverlayState } from '@heroui/react';
import { CheckmarkSquare01Icon, Delete01Icon, FileExportIcon, PlusSignIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

// ── shared glass styles ───────────────────────────────────────────────
const panel: React.CSSProperties = {
  background: 'linear-gradient(145deg,rgba(255,255,255,0.038) 0%,rgba(255,255,255,0.01) 100%)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.07)',
  boxShadow: '0 4px 32px rgba(0,0,0,0.25),inset 0 1px 0 rgba(255,255,255,0.05)',
};
const modalPanel: React.CSSProperties = {
  background: 'linear-gradient(145deg,rgba(20,20,24,0.97) 0%,rgba(15,15,18,0.99) 100%)',
  backdropFilter: 'blur(32px)',
  WebkitBackdropFilter: 'blur(32px)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 25px 50px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.06)',
};
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 10,
  color: '#f4f4f5',
};
const inputCls = 'w-full px-3 py-2.5 text-sm placeholder-zinc-600 outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl';

// ── severity columns ──────────────────────────────────────────────────
const SEV_CELL: Record<string, string> = {
  critical: 'text-red-400 font-bold',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

// ── status badge ──────────────────────────────────────────────────────
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
      <span
        className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`}
      />
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
      await createScan(imageName, imageTag);
      modal.close(); setImageName(''); setImageTag('latest');
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
          <h1 className="text-2xl font-bold text-white tracking-tight">Scans</h1>
          {total > 0 && <p className="text-sm text-zinc-500 mt-0.5">{total} scans total</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSelecting(s => !s); setSelected(new Set()); }}
            className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl transition-all duration-150"
            style={selecting
              ? { background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#d4d4d8' }
            }
          >
            <CheckmarkSquare01Icon size={15} />
            {selecting ? 'Cancel' : 'Select'}
          </button>
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
      <div className="rounded-2xl overflow-hidden" style={panel}>
        {/* top shimmer */}
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.2),transparent)' }} />
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
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
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-800 border-t-violet-500 animate-spin" />
                  </div>
                </td>
              </tr>
            ) : scans.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-16 text-center text-zinc-600 text-sm">
                  No scans yet. Create one to get started.
                </td>
              </tr>
            ) : scans.map((scan, i) => (
              <tr
                key={scan.id}
                className="transition-colors"
                style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {selecting && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(scan.id)}
                      onChange={() => toggleSelect(scan.id)}
                      className="w-4 h-4 accent-violet-500 cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <Link href={`/scans/${scan.id}`} className="font-mono text-zinc-300 hover:text-violet-400 transition-colors text-sm">
                    {scan.image_name}:{scan.image_tag}
                  </Link>
                </td>
                <td className="px-4 py-3"><StatusBadge status={scan.status} /></td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.critical_count ? SEV_CELL.critical : 'text-zinc-700'}>{scan.critical_count || '—'}</span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.high_count ? SEV_CELL.high : 'text-zinc-700'}>{scan.high_count || '—'}</span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.medium_count ? SEV_CELL.medium : 'text-zinc-700'}>{scan.medium_count || '—'}</span>
                </td>
                <td className="px-3 py-3 text-center font-mono text-sm">
                  <span className={scan.low_count ? SEV_CELL.low : 'text-zinc-700'}>{scan.low_count || '—'}</span>
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
                  <button onClick={() => handleDelete(scan.id)} className="text-zinc-600 hover:text-red-400 transition-colors" title="Delete">
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
          style={{ background: 'rgba(9,9,11,0.85)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid rgba(255,255,255,0.07)' }}
        >
          <span className="text-sm text-zinc-400">{selected.size} scan{selected.size !== 1 ? 's' : ''} selected</span>
          <div className="flex gap-3">
            <button onClick={() => setSelected(new Set())} className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Clear</button>
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
          <span className="text-sm text-zinc-600">{total} scans</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >← Prev</button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >Next →</button>
          </div>
        </div>
      )}

      {/* Create modal */}
      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="rounded-2xl overflow-hidden" style={modalPanel}>
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <Modal.Heading className="text-white font-semibold">New Scan</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-300" />
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
                    <label className="text-sm font-medium text-zinc-300">Image Name</label>
                    <input className={inputCls + ' font-mono'} style={inputStyle} placeholder="nginx"
                      value={imageName} onChange={(e) => setImageName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-300">Tag</label>
                    <input className={inputCls + ' font-mono'} style={inputStyle} placeholder="latest"
                      value={imageTag} onChange={(e) => setImageTag(e.target.value)} required />
                  </div>
                  <p className="text-xs text-zinc-600">Tags can be added from the scan detail page after creation.</p>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <button onClick={modal.close} className="px-4 py-2 text-sm rounded-xl text-zinc-300 hover:text-white transition-colors"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
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
