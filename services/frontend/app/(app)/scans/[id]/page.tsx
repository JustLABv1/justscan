'use client';
import {
  addTagToScan,
  createComment,
  deleteComment,
  getScan,
  getUser,
  listTags,
  listVulnerabilities,
  removeTagFromScan,
  Scan,
  Tag,
  Vulnerability,
} from '@/lib/api';
import { ArrowLeft01Icon, Comment01Icon, CpuIcon, Delete02Icon, FileExportIcon, PencilEdit01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
const inputCls = 'rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors';

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState('');
  const [pkgFilter, setPkgFilter] = useState('');
  const [pkgInput, setPkgInput] = useState('');
  const [minCvss, setMinCvss] = useState(0);
  const [cvssMode, setCvssMode] = useState<'preset' | 'custom'>('preset');
  const [customCvss, setCustomCvss] = useState('');
  const [hasFix, setHasFix] = useState(false);
  const [sortBy, setSortBy] = useState('severity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(true);
  const [vulnLoading, setVulnLoading] = useState(false);
  const [error, setError] = useState('');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagLoading, setTagLoading] = useState('');
  const [expandedVuln, setExpandedVuln] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);

  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getScan(id)
      .then(setScan)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    listTags().then(setAllTags).catch(() => {});
  }, [id]);

  // Debounce package filter input
  useEffect(() => {
    if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    pkgDebounceRef.current = setTimeout(() => {
      setPkgFilter(pkgInput);
      setPage(1);
    }, 400);
    return () => {
      if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    };
  }, [pkgInput]);

  function loadVulns() {
    if (!scan) return;
    setVulnLoading(true);
    listVulnerabilities(
      id, page, LIMIT,
      severityFilter || undefined,
      pkgFilter || undefined,
      hasFix || undefined,
      minCvss || undefined,
      sortBy,
      sortDir,
    )
      .then((res) => { setVulns(res.data ?? []); setVulnTotal(res.total); })
      .catch(() => {})
      .finally(() => setVulnLoading(false));
  }

  useEffect(() => {
    loadVulns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scan, page, severityFilter, pkgFilter, minCvss, hasFix, sortBy, sortDir]);

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

  async function handleAddComment(vulnId: string) {
    if (!commentText.trim()) return;
    setCommentSaving(true);
    try {
      await createComment(id, vulnId, commentText.trim());
      setCommentText('');
      loadVulns();
    } catch { /* ignore */ } finally {
      setCommentSaving(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await deleteComment(commentId);
      loadVulns();
    } catch { /* ignore */ }
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
  const currentUser = getUser();

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
            {scan.architecture && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 mt-1">
                <CpuIcon size={12} />
                {scan.architecture} · {scan.os_family} {scan.os_name}
              </p>
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
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Vulnerabilities
              {vulnTotal > 0 && <span className="text-sm font-normal text-zinc-500 ml-2">{vulnTotal} found</span>}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
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
            <input
              type="text"
              value={pkgInput}
              onChange={(e) => setPkgInput(e.target.value)}
              placeholder="Package…"
              className={inputCls}
            />
            <select
              value={cvssMode === 'custom' ? 'custom' : minCvss}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setCvssMode('custom');
                  setCustomCvss('');
                  setMinCvss(0);
                } else {
                  setCvssMode('preset');
                  setMinCvss(Number(e.target.value));
                  setPage(1);
                }
              }}
              className={selectCls}
            >
              <option value={0}>Any CVSS</option>
              <option value={4}>≥ 4.0</option>
              <option value={7}>≥ 7.0</option>
              <option value={9}>≥ 9.0</option>
              <option value="custom">Custom…</option>
            </select>
            {cvssMode === 'custom' && (
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={customCvss}
                placeholder="0.0"
                onChange={(e) => {
                  setCustomCvss(e.target.value);
                  const val = parseFloat(e.target.value);
                  setMinCvss(!isNaN(val) ? val : 0);
                  setPage(1);
                }}
                className={`${inputCls} w-24`}
              />
            )}
            <button
              onClick={() => { setHasFix(!hasFix); setPage(1); }}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${hasFix ? 'border-violet-500 bg-violet-500/15 text-violet-300' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
            >
              Has Fix
            </button>
          </div>
        </div>

        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                {([
                  { label: 'CVE ID',    key: 'vuln_id',           align: 'left'  },
                  { label: 'Package',   key: 'pkg_name',          align: 'left'  },
                  { label: 'Installed', key: 'installed_version', align: 'left'  },
                  { label: 'Fixed In',  key: 'fixed_version',     align: 'left'  },
                  { label: 'Severity',  key: 'severity',          align: 'left'  },
                  { label: 'CVSS',      key: 'cvss_score',        align: 'right' },
                ] as { label: string; key: string; align: 'left' | 'right' }[]).map(({ label, key, align }) => {
                  const active = sortBy === key;
                  return (
                    <th
                      key={key}
                      onClick={() => {
                        if (active) {
                          setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                        } else {
                          setSortBy(key);
                          setSortDir('asc');
                        }
                        setPage(1);
                      }}
                      className={`px-4 py-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none transition-colors text-${align} ${active ? 'text-violet-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                          {active && sortDir === 'desc' ? '↓' : '↑'}
                        </span>
                      </span>
                    </th>
                  );
                })}
                <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {vulnLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="flex justify-center">
                      <div className="w-6 h-6 rounded-full border-2 border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : vulns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-600 text-sm">
                    No vulnerabilities found.
                  </td>
                </tr>
              ) : vulns.map((v) => (
                <>
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
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setExpandedVuln(expandedVuln === v.id ? null : v.id);
                          setCommentText('');
                        }}
                        className="inline-flex items-center gap-1 text-zinc-500 hover:text-violet-400 transition-colors"
                      >
                        <Comment01Icon size={15} />
                        {v.comments && v.comments.length > 0 && (
                          <span className="text-xs bg-violet-500/20 text-violet-400 rounded-full px-1.5 py-0.5 font-medium">
                            {v.comments.length}
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                  {expandedVuln === v.id && (
                    <tr key={`${v.id}-comments`}>
                      <td colSpan={7} className="border-t border-zinc-800 bg-zinc-800/60 px-4 py-4">
                        <div className="space-y-3 max-w-3xl">
                          {v.comments && v.comments.length > 0 ? (
                            <div className="space-y-2">
                              {v.comments.map((c) => (
                                <div key={c.id} className="flex items-start justify-between gap-3 group">
                                  <div className="flex-1 min-w-0">
                                    <span className="text-xs font-semibold text-zinc-300">
                                      {c.username || 'You'}
                                    </span>
                                    <span className="text-xs text-zinc-600 ml-2">
                                      {new Date(c.created_at).toLocaleString()}
                                    </span>
                                    <p className="text-xs text-zinc-400 mt-0.5">{c.content}</p>
                                  </div>
                                  {currentUser?.id === c.user_id && (
                                    <button
                                      onClick={() => handleDeleteComment(c.id)}
                                      className="text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                    >
                                      <Delete02Icon size={14} />
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-zinc-600">No notes yet.</p>
                          )}
                          <div className="flex gap-2 items-end pt-1">
                            <textarea
                              value={commentText}
                              onChange={(e) => setCommentText(e.target.value)}
                              placeholder="Add a note…"
                              rows={2}
                              className={`${inputCls} flex-1 resize-none`}
                            />
                            <button
                              onClick={() => handleAddComment(v.id)}
                              disabled={commentSaving || !commentText.trim()}
                              className="px-3 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                            >
                              Add Note
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
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
