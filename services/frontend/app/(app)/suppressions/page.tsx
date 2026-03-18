'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { deleteSuppression, listAllSuppressions, Suppression } from '@/lib/api';
import { Delete01Icon, SecurityLockIcon } from 'hugeicons-react';
import { useCallback, useEffect, useState } from 'react';

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  accepted:       { color: '#60a5fa', background: 'rgba(59,130,246,0.1)',   border: '1px solid rgba(59,130,246,0.22)'   },
  wont_fix:       { color: '#a78bfa', background: 'rgba(124,58,237,0.1)',   border: '1px solid rgba(124,58,237,0.22)'   },
  false_positive: { color: '#34d399', background: 'rgba(16,185,129,0.1)',   border: '1px solid rgba(16,185,129,0.22)'   },
};

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Accepted Risk',
  wont_fix: "Won't Fix",
  false_positive: 'False Positive',
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? {};
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={s}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const LIMIT = 50;

export default function SuppressionsPage() {
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAllSuppressions(page, LIMIT, statusFilter || undefined);
      setSuppressions(res.data ?? []);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load suppressions');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(s: Suppression) {
    const ok = await confirm({
      title: `Remove suppression for ${s.vuln_id}?`,
      message: 'The vulnerability will no longer be suppressed for this image.',
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteSuppression(s.image_digest, s.vuln_id).catch(() => {});
    load();
  }

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
            <SecurityLockIcon size={22} className="text-violet-500" />
            Suppressions
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {total > 0 ? `${total} active suppression${total !== 1 ? 's' : ''}` : 'Manage vulnerability suppressions across all images'}
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input"
        >
          <option value="">All Statuses</option>
          <option value="accepted">Accepted Risk</option>
          <option value="wont_fix">Won&apos;t Fix</option>
          <option value="false_positive">False Positive</option>
        </select>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">CVE ID</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image Digest</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Justification</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">By</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Expires</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                  </div>
                </td>
              </tr>
            ) : suppressions.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <SecurityLockIcon size={32} className="text-zinc-400 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-500">No suppressions found.</p>
                    <p className="text-xs text-zinc-400">Suppressions allow you to acknowledge known vulnerabilities in a scan.</p>
                  </div>
                </td>
              </tr>
            ) : suppressions.map((s, i) => (
              <tr
                key={s.id}
                style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td className="px-4 py-3">
                  <a
                    href={`https://nvd.nist.gov/vuln/detail/${s.vuln_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-violet-500 dark:text-violet-400 hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    {s.vuln_id}
                  </a>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-zinc-500" title={s.image_digest}>
                    {s.image_digest.length > 28 ? s.image_digest.slice(0, 28) + '…' : s.image_digest}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 max-w-xs">
                  <span className="line-clamp-2">{s.justification || '—'}</span>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">{s.username || '—'}</td>
                <td className="px-4 py-3 text-xs">
                  {s.expires_at ? (
                    <span className={new Date(s.expires_at) < new Date() ? 'text-red-400' : 'text-zinc-500'}>
                      {new Date(s.expires_at).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-zinc-400">Never</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {new Date(s.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleDelete(s)}
                    className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1"
                    title="Remove suppression"
                  >
                    <Delete01Icon size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{total} total</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
            >← Prev</button>
            <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
            >Next →</button>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
