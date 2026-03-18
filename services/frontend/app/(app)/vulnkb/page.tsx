'use client';
import { getKBEntry, listKBEntries, VulnKBEntry } from '@/lib/api';
import { InformationCircleIcon, Shield01Icon } from 'hugeicons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

const inputCls = 'px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

const SEV_STYLE: Record<string, React.CSSProperties> = {
  CRITICAL: { color: '#f87171', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)' },
  HIGH:     { color: '#fb923c', background: 'rgba(249,115,22,0.10)', border: '1px solid rgba(249,115,22,0.22)' },
  MEDIUM:   { color: '#facc15', background: 'rgba(234,179,8,0.10)',  border: '1px solid rgba(234,179,8,0.22)' },
  LOW:      { color: '#60a5fa', background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.22)' },
  UNKNOWN:  { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.18)' },
};

function SevBadge({ severity }: { severity: string }) {
  const s = SEV_STYLE[severity?.toUpperCase()] ?? SEV_STYLE.UNKNOWN;
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize" style={s}>
      {severity || 'Unknown'}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  const color = score >= 9 ? '#f87171' : score >= 7 ? '#fb923c' : score >= 4 ? '#facc15' : '#60a5fa';
  return (
    <span className="font-mono text-sm font-semibold" style={{ color }}>
      {score ? score.toFixed(1) : '—'}
    </span>
  );
}

function DetailPanel({ entry, onClose }: { entry: VulnKBEntry; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl p-6 space-y-5"
        style={{ background: 'var(--modal-bg)', border: '1px solid var(--border-subtle)', boxShadow: '0 25px 60px rgba(0,0,0,0.4)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold font-mono text-zinc-900 dark:text-white">{entry.vuln_id}</h2>
              <SevBadge severity={entry.severity} />
              <ScorePill score={entry.cvss_score} />
              {entry.exploit_available && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  Exploit Available
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {entry.published_date ? `Published ${new Date(entry.published_date).toLocaleDateString()}` : 'Unknown publish date'}
              {entry.cvss_vector && <span className="ml-3 font-mono">{entry.cvss_vector}</span>}
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-xl leading-none transition-colors">×</button>
        </div>

        {entry.description && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">Description</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">{entry.description}</p>
          </div>
        )}

        {entry.references && entry.references.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">References</p>
            <ul className="space-y-1">
              {entry.references.map((r, i) => (
                <li key={i}>
                  <a href={r.url} target="_blank" rel="noreferrer"
                    className="text-xs text-violet-500 dark:text-violet-400 hover:underline break-all">
                    {r.url}
                  </a>
                  {r.source && <span className="text-xs text-zinc-500 ml-2">({r.source})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

const LIMIT = 50;

export default function VulnKBPage() {
  const [entries, setEntries] = useState<VulnKBEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [severity, setSeverity] = useState('');
  const [detail, setDetail] = useState<VulnKBEntry | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listKBEntries(query || undefined, severity || undefined, page, LIMIT);
      setEntries(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load KB');
    } finally {
      setLoading(false);
    }
  }, [query, severity, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setQuery(queryInput); setPage(1); }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [queryInput]);

  // Reset page when severity changes
  useEffect(() => { setPage(1); }, [severity]);

  async function handleRowClick(entry: VulnKBEntry) {
    try {
      const full = await getKBEntry(entry.vuln_id);
      setDetail(full);
    } catch {
      setDetail(entry);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
            <Shield01Icon size={22} className="text-violet-500" />
            Vulnerability Knowledge Base
          </h1>
      <p className="text-sm text-zinc-500 mt-0.5">Enriched CVE data from NVD, GHSA, OSV, and other sources via Trivy</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
            placeholder="Search CVE ID or description…"
            className={`${inputCls} w-64`}
          />
          <select value={severity} onChange={e => { setSeverity(e.target.value); setPage(1); }} className={inputCls}>
            <option value="">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
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
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Severity</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">CVSS</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Published</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</th>
              <th className="px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider text-center">Exploit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="flex justify-center">
                    <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                  </div>
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Shield01Icon size={32} className="text-zinc-400 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-500">No KB entries found.</p>
                    <p className="text-xs text-zinc-400">The KB is populated when vulnerabilities are found in scans.</p>
                  </div>
                </td>
              </tr>
            ) : entries.map((e, i) => (
              <tr
                key={e.vuln_id}
                style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined, cursor: 'pointer' }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--row-hover)')}
                onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                onClick={() => handleRowClick(e)}
              >
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-violet-500 dark:text-violet-400">{e.vuln_id}</span>
                </td>
                <td className="px-4 py-3">
                  <SevBadge severity={e.severity} />
                </td>
                <td className="px-4 py-3 text-right">
                  <ScorePill score={e.cvss_score} />
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500">
                  {e.published_date ? new Date(e.published_date).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400 max-w-xs">
                  <span className="line-clamp-2">{e.description || '—'}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  {e.exploit_available ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)' }}>Yes</span>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">{total.toLocaleString()} entries</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >
              ← Prev
            </button>
            <span className="text-sm text-zinc-500 px-2">{page} / {Math.ceil(total / LIMIT)}</span>
            <button
              disabled={page >= Math.ceil(total / LIMIT)}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-zinc-400 flex items-center gap-1.5">
        <InformationCircleIcon size={13} />
        The KB is populated automatically from scan data — sources include NVD, GHSA, OSV, Red Hat, Debian, and more.
      </p>

      {detail && <DetailPanel entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
