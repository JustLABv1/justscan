'use client';
import { compareScans, listScans, Scan, ScanComparison, Vulnerability } from '@/lib/api';
import { ArrowLeft01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const inputCls = 'w-full px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

function SevBadge({ sev }: { sev: string }) {
  const cfg: Record<string, { color: string; bg: string }> = {
    CRITICAL: { color: '#f87171', bg: 'rgba(239,68,68,0.12)'    },
    HIGH:     { color: '#fb923c', bg: 'rgba(249,115,22,0.12)'   },
    MEDIUM:   { color: '#fbbf24', bg: 'rgba(245,158,11,0.12)'   },
    LOW:      { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)'   },
    UNKNOWN:  { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)'  },
  };
  const c = cfg[sev.toUpperCase()] ?? cfg.UNKNOWN;
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: c.color, background: c.bg }}>{sev}</span>;
}

function VulnTable({ vulns, emptyText }: { vulns: Vulnerability[]; emptyText: string }) {
  if (vulns.length === 0) {
    return <p className="text-sm text-zinc-500 py-6 text-center">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">CVE ID</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">Package</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">Severity</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">Version</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wider">CVSS</th>
          </tr>
        </thead>
        <tbody>
          {vulns.map((v, i) => (
            <tr key={v.id ?? i}
              style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <td className="px-4 py-2.5">
                {v.vuln_id ? (
                  <a
                    href={`https://nvd.nist.gov/vuln/detail/${v.vuln_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-violet-500 dark:text-violet-400 hover:underline"
                  >
                    {v.vuln_id}
                  </a>
                ) : <span className="text-zinc-400">—</span>}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">{v.pkg_name}</td>
              <td className="px-4 py-2.5"><SevBadge sev={v.severity} /></td>
              <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">{v.installed_version}</td>
              <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-500">
                {v.cvss_score ? v.cvss_score.toFixed(1) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScanSelector({
  label,
  value,
  onChange,
  scans,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  scans: Scan[];
}) {
  return (
    <div className="space-y-1.5 flex-1">
      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{label}</label>
      <select className={inputCls} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Select a scan…</option>
        {scans.map(s => (
          <option key={s.id} value={s.id}>
            {s.image_name}:{s.image_tag} — {new Date(s.created_at).toLocaleDateString()} ({s.status})
          </option>
        ))}
      </select>
    </div>
  );
}

function ComparePageInner() {
  const params = useSearchParams();
  const [scanA, setScanA] = useState(params.get('a') ?? '');
  const [scanB, setScanB] = useState(params.get('b') ?? '');
  const [scans, setScans] = useState<Scan[]>([]);
  const [result, setResult] = useState<ScanComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [scansLoading, setScansLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listScans(1, 100)
      .then(r => setScans(r.data ?? []))
      .catch(() => {})
      .finally(() => setScansLoading(false));
  }, []);

  // Auto-compare if both params are present on load
  useEffect(() => {
    const a = params.get('a');
    const b = params.get('b');
    if (a && b) {
      runCompare(a, b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCompare(idA: string, idB: string) {
    if (!idA || !idB) { setError('Please select two scans to compare.'); return; }
    if (idA === idB) { setError('Please select two different scans.'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      const r = await compareScans(idA, idB);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  }

  function handleCompare() {
    runCompare(scanA, scanB);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/scans"
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to scans
        </Link>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Scan Comparison</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Compare two scans to see which vulnerabilities were added or resolved</p>
      </div>

      {/* Selectors */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          {scansLoading ? (
            <div className="flex-1 flex items-center justify-center py-4">
              <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
            </div>
          ) : (
            <>
              <ScanSelector label="Scan A (baseline)" value={scanA} onChange={setScanA} scans={scans} />
              <div className="flex items-center justify-center pb-2.5 text-zinc-400 font-bold select-none shrink-0">vs</div>
              <ScanSelector label="Scan B (compare to)" value={scanB} onChange={setScanB} scans={scans} />
            </>
          )}
          <button
            onClick={handleCompare}
            disabled={loading || !scanA || !scanB}
            className="shrink-0 flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' }}
          >
            {loading && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Compare
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-panel rounded-xl p-4 text-center">
              <p className="text-2xl font-bold tabular-nums" style={{ color: '#f87171' }}>{result.summary.added_count}</p>
              <p className="text-xs text-zinc-500 mt-0.5">New vulnerabilities</p>
              {(result.summary.added_critical > 0 || result.summary.added_high > 0) && (
                <p className="text-xs mt-1" style={{ color: '#f87171' }}>
                  {result.summary.added_critical > 0 && `${result.summary.added_critical} critical`}
                  {result.summary.added_critical > 0 && result.summary.added_high > 0 && ', '}
                  {result.summary.added_high > 0 && `${result.summary.added_high} high`}
                </p>
              )}
            </div>
            <div className="glass-panel rounded-xl p-4 text-center">
              <p className="text-2xl font-bold tabular-nums" style={{ color: '#34d399' }}>{result.summary.removed_count}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Resolved vulnerabilities</p>
            </div>
            <div className="glass-panel rounded-xl p-4 text-center">
              <p className="text-2xl font-bold tabular-nums text-zinc-400">{result.summary.unchanged_count}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Unchanged</p>
            </div>
          </div>

          {/* Added */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--row-divider)' }}>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">New Vulnerabilities</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.2)' }}>
                +{result.summary.added_count}
              </span>
            </div>
            <VulnTable vulns={result.added} emptyText="No new vulnerabilities — great!" />
          </div>

          {/* Removed */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--row-divider)' }}>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Resolved Vulnerabilities</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#34d399', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.2)' }}>
                -{result.summary.removed_count}
              </span>
            </div>
            <VulnTable vulns={result.removed} emptyText="No vulnerabilities were resolved." />
          </div>

          {/* Unchanged */}
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--row-divider)' }}>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Unchanged</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.15)' }}>
                {result.summary.unchanged_count}
              </span>
            </div>
            <VulnTable vulns={result.unchanged} emptyText="No unchanged vulnerabilities." />
          </div>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
      </div>
    }>
      <ComparePageInner />
    </Suspense>
  );
}
