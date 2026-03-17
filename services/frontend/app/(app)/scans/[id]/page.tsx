'use client';
import { addTagToScan, getScan, listTags, listVulnerabilities, removeTagFromScan, Scan, Tag, Vulnerability } from '@/lib/api';
import { ArrowLeft01Icon, FileExportIcon, PencilEdit01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: 'Critical', color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  HIGH:     { label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  MEDIUM:   { label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  LOW:      { label: 'Low',      color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  UNKNOWN:  { label: 'Unknown',  color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20' },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEV_CONFIG[severity] ?? SEV_CONFIG.UNKNOWN;
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    failed:    'bg-red-500/15 text-red-400 border-red-500/20',
    running:   'bg-blue-500/15 text-blue-400 border-blue-500/20',
    pending:   'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
  };
  const cls = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'running' ? 'animate-pulse bg-blue-400' : 'bg-current'}`} />
      {status}
    </span>
  );
}

const LIMIT = 25;

const selectCls = 'rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500 transition-colors';

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [vulnLoading, setVulnLoading] = useState(false);
  const [error, setError] = useState('');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagLoading, setTagLoading] = useState('');

  useEffect(() => {
    getScan(id)
      .then(setScan)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    listTags().then(setAllTags).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!scan) return;
    setVulnLoading(true);
    listVulnerabilities(id, page, LIMIT, severityFilter || undefined)
      .then((res) => { setVulns(res.data ?? []); setVulnTotal(res.total); })
      .catch(() => {})
      .finally(() => setVulnLoading(false));
  }, [id, scan, page, severityFilter]);

  async function toggleTag(tag: Tag) {
    if (!scan) return;
    const has = (scan.tags ?? []).some((t) => t.id === tag.id);
    setTagLoading(tag.id);
    try {
      if (has) {
        await removeTagFromScan(id, tag.id);
        setScan({ ...scan, tags: (scan.tags ?? []).filter((t) => t.id !== tag.id) });
      } else {
        await addTagToScan(id, tag.id);
        setScan({ ...scan, tags: [...(scan.tags ?? []), tag] });
      }
    } catch { /* ignore */ } finally {
      setTagLoading('');
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6">
      <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
    </div>
  );

  if (!scan) return null;

  const totalPages = Math.max(1, Math.ceil(vulnTotal / LIMIT));

  const sevCards = [
    { count: scan.critical_count, ...SEV_CONFIG.CRITICAL },
    { count: scan.high_count,     ...SEV_CONFIG.HIGH },
    { count: scan.medium_count,   ...SEV_CONFIG.MEDIUM },
    { count: scan.low_count,      ...SEV_CONFIG.LOW },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to scans
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold font-mono text-white break-all">
              {scan.image_name}:{scan.image_tag}
            </h1>
            {scan.image_digest && (
              <p className="text-xs font-mono text-zinc-600 mt-1 break-all">{scan.image_digest}</p>
            )}
          </div>
          <Link
            href={`/reports/${scan.id}/print`}
            target="_blank"
            className="flex items-center gap-2 shrink-0 px-3 py-2 text-sm rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <FileExportIcon size={15} />
            Export
          </Link>
        </div>
      </div>

      {/* Status + severity cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 col-span-1">
          <p className="text-xs text-zinc-500 mb-2">Status</p>
          <StatusBadge status={scan.status} />
          {scan.error_message && (
            <p className="text-xs text-red-400 mt-2 line-clamp-2">{scan.error_message}</p>
          )}
        </div>
        {sevCards.map(({ label, count, color, border }) => (
          <div key={label} className={`bg-zinc-900 rounded-xl border ${border} p-4`}>
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{count ?? 0}</p>
          </div>
        ))}
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <PencilEdit01Icon size={14} className="text-zinc-500" />
            <span className="text-sm font-medium text-zinc-400">Tags</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = (scan.tags ?? []).some((t) => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag)}
                  disabled={tagLoading === tag.id}
                  className="text-xs px-3 py-1 rounded-full font-medium border transition-all disabled:opacity-50"
                  style={
                    active
                      ? { background: tag.color + '25', color: tag.color, borderColor: tag.color + '50' }
                      : { background: 'transparent', color: '#71717a', borderColor: '#3f3f46' }
                  }
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Vulnerabilities */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">
              Vulnerabilities
              {vulnTotal > 0 && <span className="text-sm font-normal text-zinc-500 ml-2">{vulnTotal} found</span>}
            </h2>
          </div>
          <select
            value={severityFilter}
            onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
            className={selectCls}
          >
            <option value="">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">CVE ID</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Package</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Installed</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Fixed In</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Severity</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">CVSS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {vulnLoading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <div className="flex justify-center">
                      <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : vulns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-600 text-sm">
                    No vulnerabilities found.
                  </td>
                </tr>
              ) : vulns.map((v) => (
                <tr key={v.id} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-3">
                    {v.vuln_id ? (
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${v.vuln_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-violet-400 hover:text-violet-300 hover:underline transition-colors"
                      >
                        {v.vuln_id}
                      </a>
                    ) : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-300">{v.pkg_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{v.installed_version}</td>
                  <td className="px-4 py-3 font-mono text-xs text-emerald-500">
                    {v.fixed_version || <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <SeverityBadge severity={v.severity} />
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">
                    {v.cvss_score ? v.cvss_score.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-500">{vulnTotal} total</span>
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
      </div>
    </div>
  );
}
