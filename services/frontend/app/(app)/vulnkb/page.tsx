'use client';
import { getKBEntry, listKBEntries, VulnKBEntry } from '@/lib/api';
import { Label, ListBox, Select, Switch } from '@heroui/react';
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

const CVSS_OPTIONS = [
  { id: '0',   label: 'Any CVSS' },
  { id: '4',   label: '≥ 4.0 (Medium+)' },
  { id: '7',   label: '≥ 7.0 (High+)' },
  { id: '9',   label: '≥ 9.0 (Critical)' },
];

const SEV_OPTIONS = [
  { id: '',         label: 'All Severities' },
  { id: 'CRITICAL', label: 'Critical' },
  { id: 'HIGH',     label: 'High' },
  { id: 'MEDIUM',   label: 'Medium' },
  { id: 'LOW',      label: 'Low' },
];

const PUBLISHED_OPTIONS = [
  { id: '',     label: 'Any Time' },
  { id: '30d',  label: 'Last 30 days' },
  { id: '90d',  label: 'Last 90 days' },
  { id: '1y',   label: 'Last year' },
];

function publishedAfterDate(value: string): string | undefined {
  if (!value) return undefined;
  const now = new Date();
  if (value === '30d') { now.setDate(now.getDate() - 30); return now.toISOString(); }
  if (value === '90d') { now.setDate(now.getDate() - 90); return now.toISOString(); }
  if (value === '1y')  { now.setFullYear(now.getFullYear() - 1); return now.toISOString(); }
  return undefined;
}

export default function VulnKBPage() {
  const [entries, setEntries] = useState<VulnKBEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [severity, setSeverity] = useState('');
  const [minCvss, setMinCvss] = useState('0');
  const [exploitOnly, setExploitOnly] = useState(false);
  const [publishedRange, setPublishedRange] = useState('');
  const [detail, setDetail] = useState<VulnKBEntry | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listKBEntries(
        query || undefined,
        severity || undefined,
        page,
        LIMIT,
        exploitOnly || undefined,
        Number(minCvss) || undefined,
        publishedAfterDate(publishedRange),
      );
      setEntries(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load KB');
    } finally {
      setLoading(false);
    }
  }, [query, severity, page, exploitOnly, minCvss, publishedRange]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setQuery(queryInput); setPage(1); }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [queryInput]);

  useEffect(() => { setPage(1); }, [severity, minCvss, exploitOnly, publishedRange]);

  async function handleRowClick(entry: VulnKBEntry) {
    try {
      const full = await getKBEntry(entry.vuln_id);
      setDetail(full);
    } catch {
      setDetail(entry);
    }
  }

  const activeFilters = [severity, minCvss !== '0' ? `CVSS ≥ ${minCvss}` : '', exploitOnly ? 'Exploit Only' : '', publishedRange ? PUBLISHED_OPTIONS.find(o => o.id === publishedRange)?.label : ''].filter(Boolean);

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
      </div>

      {/* Filters */}
      <div className="glass-panel rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="flex-1 min-w-52">
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Search</label>
            <input
              type="text"
              value={queryInput}
              onChange={e => setQueryInput(e.target.value)}
              placeholder="CVE ID or description…"
              className={`${inputCls} w-full`}
            />
          </div>

          {/* Severity Select */}
          <div className="min-w-44">
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Severity</label>
            <Select
              selectedKey={severity}
              onSelectionChange={k => setSeverity(String(k ?? ''))}
              className="w-full"
              placeholder="All Severities"
            >
              <Select.Trigger className={inputCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {SEV_OPTIONS.map(o => (
                    <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
                      {o.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {/* CVSS Select */}
          <div className="min-w-44">
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Min CVSS</label>
            <Select
              selectedKey={minCvss}
              onSelectionChange={k => setMinCvss(String(k ?? '0'))}
              className="w-full"
              placeholder="Any CVSS"
            >
              <Select.Trigger className={inputCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {CVSS_OPTIONS.map(o => (
                    <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
                      {o.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {/* Published Range Select */}
          <div className="min-w-40">
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Published</label>
            <Select
              selectedKey={publishedRange}
              onSelectionChange={k => setPublishedRange(String(k ?? ''))}
              className="w-full"
              placeholder="Any Time"
            >
              <Select.Trigger className={inputCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {PUBLISHED_OPTIONS.map(o => (
                    <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
                      {o.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {/* Exploit Only Toggle */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-zinc-500">Exploit</label>
            <Switch
              isSelected={exploitOnly}
              onChange={setExploitOnly}
              className="h-[38px] flex items-center"
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Switch.Content>
                <Label className="text-sm text-zinc-600 dark:text-zinc-300">Only</Label>
              </Switch.Content>
            </Switch>
          </div>

          {/* Reset */}
          {activeFilters.length > 0 && (
            <button
              onClick={() => { setSeverity(''); setMinCvss('0'); setExploitOnly(false); setPublishedRange(''); setQueryInput(''); setQuery(''); setPage(1); }}
              className="px-3 py-2 text-sm rounded-xl text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors self-end"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeFilters.map((f, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}>
                {f}
              </span>
            ))}
          </div>
        )}
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
                    <p className="text-xs text-zinc-400">Try adjusting your filters or the KB is populated when vulnerabilities are found in scans.</p>
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
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}>Yes</span>
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

