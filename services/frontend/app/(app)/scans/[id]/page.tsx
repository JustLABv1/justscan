'use client';
import {
  addTagToScan,
  assignScanToOrg,
  ComplianceResult,
  createComment,
  deleteComment,
  deleteSuppression,
  getScan,
  getScanCompliance,
  getScanSBOM,
  getUser,
  listOrgs,
  listTags,
  listVulnerabilities,
  Org,
  reEvaluateCompliance,
  removeScanFromOrg,
  removeTagFromScan,
  reScan,
  SBOMComponent,
  Scan,
  Suppression,
  Tag,
  upsertSuppression,
  Vulnerability,
} from '@/lib/api';
import { ArrowLeft01Icon, Comment01Icon, CpuIcon, Delete02Icon, FileExportIcon, PencilEdit01Icon, Refresh01Icon, ShieldKeyIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const inputCls = 'px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: 'Critical', color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  HIGH:     { label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  MEDIUM:   { label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  LOW:      { label: 'Low',      color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  UNKNOWN:  { label: 'Unknown',  color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20' },
};

function FirstSeenBadge({ firstSeenAt, scanCompletedAt }: { firstSeenAt?: string | null; scanCompletedAt?: string | null }) {
  if (!firstSeenAt) return <span className="text-xs text-zinc-500">—</span>;
  const first = new Date(firstSeenAt);
  const scan = scanCompletedAt ? new Date(scanCompletedAt) : new Date();
  const diffDays = Math.floor((scan.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 1) return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{color:'#fb923c', background:'rgba(249,115,22,0.12)'}}>New</span>
  );
  return <span className="text-xs text-zinc-500">{diffDays}d ago</span>;
}

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

// ── Scanning animation shown while pending/running ───────────────────
function ScanningAnimation({ status, startedAt }: { status: string; startedAt: string | null }) {
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState(0);

  const phases = [
    'Pulling image layers…',
    'Analyzing OS packages…',
    'Scanning language libraries…',
    'Checking CVE database…',
    'Correlating vulnerabilities…',
    'Building report…',
  ];

  useEffect(() => {
    const t = setInterval(() => {
      const start = startedAt ? new Date(startedAt).getTime() : Date.now();
      setElapsed(Math.floor((Date.now() - start) / 1000));
      setPhase(p => (p + 1) % phases.length);
    }, 1800);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div
      className="glass-panel rounded-2xl overflow-hidden"
      style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.06) 0%, rgba(59,130,246,0.04) 100%)' }}
    >
      {/* Top bar */}
      <div
        className="h-0.5 w-full relative overflow-hidden"
        style={{ background: 'rgba(124,58,237,0.15)' }}
      >
        <div
          className="absolute inset-y-0 left-0 w-1/3"
          style={{
            background: 'linear-gradient(90deg, transparent, #a78bfa, #60a5fa, transparent)',
            animation: 'scanBar 2s ease-in-out infinite',
          }}
        />
      </div>

      <style>{`
        @keyframes scanBar {
          0%   { left: -33%; }
          100% { left: 100%; }
        }
        @keyframes radarSweep {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes ringPulse1 {
          0%, 100% { opacity: 0.8; }
          50%       { opacity: 0.25; }
        }
        @keyframes ringPulse2 {
          0%, 100% { opacity: 0.6; }
          50%       { opacity: 0.15; }
        }
        @keyframes ringPulse3 {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 0.08; }
        }
        @keyframes fadePhase {
          0%   { opacity: 0; transform: translateY(6px); }
          15%  { opacity: 1; transform: translateY(0);   }
          85%  { opacity: 1; transform: translateY(0);   }
          100% { opacity: 0; transform: translateY(-6px);}
        }
      `}</style>

      <div className="p-10 flex flex-col items-center gap-8">
        {/* Radar — pure SVG for precise positioning */}
        <svg width="160" height="160" viewBox="0 0 160 160" style={{ overflow: 'visible' }}>
          {/* Radial glow background */}
          <circle cx="80" cy="80" r="76"
            fill="url(#radarGlow)" />
          <defs>
            <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Rings */}
          <circle cx="80" cy="80" r="76" stroke="rgba(124,58,237,0.18)" strokeWidth="1" fill="none"
            style={{ animation: 'ringPulse3 3s ease-in-out infinite' }} />
          <circle cx="80" cy="80" r="56" stroke="rgba(124,58,237,0.25)" strokeWidth="1" fill="none"
            style={{ animation: 'ringPulse2 3s ease-in-out infinite 0.4s' }} />
          <circle cx="80" cy="80" r="36" stroke="rgba(124,58,237,0.35)" strokeWidth="1" fill="none"
            style={{ animation: 'ringPulse1 3s ease-in-out infinite 0.8s' }} />

          {/* Cross-hairs — clipped to outer ring */}
          <line x1="4" y1="80" x2="156" y2="80" stroke="rgba(124,58,237,0.12)" strokeWidth="1" />
          <line x1="80" y1="4" x2="80" y2="156" stroke="rgba(124,58,237,0.12)" strokeWidth="1" />

          {/* Rotating sweep group — origin at exact center (80,80) */}
          <g style={{ transformOrigin: '80px 80px', animation: 'radarSweep 3s linear infinite' }}>
            {/* Wedge: from center, straight up (80,4), arc CW ~90° to (156,80), back to center */}
            <path d="M 80 80 L 80 4 A 76 76 0 0 1 156 80 Z"
              fill="rgba(124,58,237,0.13)" />
            {/* Arm: center (80,80) to top (80,4) — rotates with group */}
            <line x1="80" y1="80" x2="80" y2="4"
              stroke="rgba(167,139,250,0.85)" strokeWidth="1.5" strokeLinecap="round" />
          </g>

          {/* Center glow */}
          <circle cx="80" cy="80" r="7" fill="rgba(167,139,250,0.2)" />
          {/* Center dot */}
          <circle cx="80" cy="80" r="3.5" fill="#a78bfa"
            style={{ filter: 'drop-shadow(0 0 5px rgba(167,139,250,0.9))' }} />
        </svg>

        {/* Text */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2.5">
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full uppercase tracking-widest"
              style={{
                background: status === 'running' ? 'rgba(59,130,246,0.12)' : 'rgba(161,161,170,0.1)',
                border: `1px solid ${status === 'running' ? 'rgba(59,130,246,0.25)' : 'rgba(161,161,170,0.2)'}`,
                color: status === 'running' ? '#60a5fa' : '#a1a1aa',
              }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle animate-pulse"
                style={{ background: status === 'running' ? '#60a5fa' : '#a1a1aa' }} />
              {status}
            </span>
            {elapsed > 0 && (
              <span className="text-xs text-zinc-500 font-mono">{elapsedStr}</span>
            )}
          </div>

          <p
            className="text-sm text-zinc-500"
            key={phase}
            style={{ animation: 'fadePhase 1.8s ease-in-out forwards', minHeight: 20 }}
          >
            {status === 'pending' ? 'Waiting for scanner…' : phases[phase]}
          </p>

          <p className="text-xs text-zinc-500/50 mt-1">
            Results will appear automatically when the scan finishes.
          </p>
        </div>
      </div>
    </div>
  );
}

const LIMIT = 25;

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'vulns' | 'sbom'>('vulns');
  const [sbomComponents, setSbomComponents] = useState<SBOMComponent[]>([]);
  const [sbomTotal, setSbomTotal] = useState(0);
  const [sbomLoading, setSbomLoading] = useState(false);
  const [sbomLoaded, setSbomLoaded] = useState(false);
  const [sbomNameFilter, setSbomNameFilter] = useState('');
  const [sbomNameInput, setSbomNameInput] = useState('');
  const [sbomTypeFilter, setSbomTypeFilter] = useState('');
  const sbomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('scan_severity_filter') ?? '') : ''
  );
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

  const [compliance, setCompliance] = useState<ComplianceResult[]>([]);
  const [allOrgs, setAllOrgs] = useState<Org[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [reScanning, setReScanning] = useState(false);

  const [suppressStatus, setSuppressStatus] = useState<Suppression['status']>('accepted');
  const [suppressJustification, setSuppressJustification] = useState('');
  const [suppressExpiry, setSuppressExpiry] = useState('');
  const [suppressSaving, setSuppressSaving] = useState(false);

  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadScan = useCallback(() => {
    return getScan(id).then(setScan).catch((e) => setError(e.message));
  }, [id]);

  // Initial load
  useEffect(() => {
    loadScan().finally(() => setLoading(false));
    listTags().then(setAllTags).catch(() => {});
    getScanCompliance(id).then(setCompliance).catch(() => {});
    listOrgs().then(setAllOrgs).catch(() => {});
  }, [id, loadScan]);

  // Poll every 3s while scan is pending or running
  useEffect(() => {
    if (!scan) return;
    if (scan.status !== 'pending' && scan.status !== 'running') return;
    const interval = setInterval(() => {
      loadScan().then(() => {
        setScan(prev => {
          if (prev && (prev.status === 'completed' || prev.status === 'failed')) {
            clearInterval(interval);
            // Load vulns and compliance now that it's done
            getScanCompliance(id).then(setCompliance).catch(() => {});
          }
          return prev;
        });
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [scan?.status, id, loadScan]);

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

  // Persist severity filter
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('scan_severity_filter', severityFilter);
  }, [severityFilter]);

  // Reset suppress form when expanded vuln changes
  useEffect(() => {
    const v = vulns.find(v => v.id === expandedVuln);
    if (v?.suppression) {
      setSuppressStatus(v.suppression.status);
      setSuppressJustification(v.suppression.justification);
      setSuppressExpiry(v.suppression.expires_at
        ? new Date(v.suppression.expires_at).toISOString().slice(0, 10)
        : '');
    } else {
      setSuppressStatus('accepted');
      setSuppressJustification('');
      setSuppressExpiry('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedVuln]);

  // Debounce SBOM name filter
  useEffect(() => {
    if (sbomDebounceRef.current) clearTimeout(sbomDebounceRef.current);
    sbomDebounceRef.current = setTimeout(() => setSbomNameFilter(sbomNameInput), 350);
    return () => { if (sbomDebounceRef.current) clearTimeout(sbomDebounceRef.current); };
  }, [sbomNameInput]);

  // Load SBOM when tab is first opened
  useEffect(() => {
    if (activeTab !== 'sbom' || sbomLoaded || !scan || scan.status !== 'completed') return;
    setSbomLoading(true);
    getScanSBOM(id, sbomNameFilter || undefined, sbomTypeFilter || undefined)
      .then(res => { setSbomComponents(res.data ?? []); setSbomTotal(res.total); setSbomLoaded(true); })
      .catch(() => {})
      .finally(() => setSbomLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, scan?.status]);

  // Reload SBOM when filters change (after first load)
  useEffect(() => {
    if (!sbomLoaded) return;
    setSbomLoading(true);
    getScanSBOM(id, sbomNameFilter || undefined, sbomTypeFilter || undefined)
      .then(res => { setSbomComponents(res.data ?? []); setSbomTotal(res.total); })
      .catch(() => {})
      .finally(() => setSbomLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbomNameFilter, sbomTypeFilter]);

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

  async function handleAssignOrg(orgId: string) {
    await assignScanToOrg(orgId, id).catch(() => {});
    const results = await getScanCompliance(id).catch(() => [] as ComplianceResult[]);
    setCompliance(results);
  }

  async function handleRemoveOrg(orgId: string) {
    await removeScanFromOrg(orgId, id).catch(() => {});
    setCompliance((c) => c.filter((r) => r.org_id !== orgId));
  }

  async function handleReEvaluate() {
    setComplianceLoading(true);
    const results = await reEvaluateCompliance(id).catch(() => [] as ComplianceResult[]);
    setCompliance(results);
    setComplianceLoading(false);
  }

  async function handleReScan() {
    setReScanning(true);
    try {
      const newScan = await reScan(id);
      router.push(`/scans/${newScan.id}`);
    } catch { /* ignore */ } finally {
      setReScanning(false);
    }
  }

  async function handleSuppress(vuln: Vulnerability) {
    if (!scan?.image_digest) return;
    setSuppressSaving(true);
    try {
      await upsertSuppression(scan.image_digest, {
        vuln_id: vuln.vuln_id,
        status: suppressStatus,
        justification: suppressJustification,
        expires_at: suppressExpiry ? new Date(suppressExpiry).toISOString() : null,
      });
      loadVulns();
    } catch { /* ignore */ } finally {
      setSuppressSaving(false);
    }
  }

  async function handleLiftSuppression(vuln: Vulnerability) {
    if (!scan?.image_digest) return;
    setSuppressSaving(true);
    try {
      await deleteSuppression(scan.image_digest, vuln.vuln_id);
      loadVulns();
    } catch { /* ignore */ } finally {
      setSuppressSaving(false);
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6">
      <div className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
        {error}
      </div>
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
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors mb-3"
        >
          <ArrowLeft01Icon size={15} />
          Back to scans
        </button>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold font-mono text-zinc-900 dark:text-white break-all">
              {scan.image_name}:{scan.image_tag}
            </h1>
            {scan.image_digest && (
              <p className="text-xs font-mono text-zinc-500 mt-1 break-all">{scan.image_digest}</p>
            )}
            {scan.architecture && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 mt-1">
                <CpuIcon size={12} />
                {scan.architecture} · {scan.os_family} {scan.os_name}
              </p>
            )}
          </div>
          <Link
            href={`/reports/print?scans=${scan.id}`}
            target="_blank"
            className="flex items-center gap-2 shrink-0 px-3 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
          >
            <FileExportIcon size={15} />
            Export
          </Link>
          <button
            onClick={handleReScan}
            disabled={reScanning || scan.status === 'running' || scan.status === 'pending'}
            className="flex items-center gap-2 shrink-0 px-3 py-2 text-sm rounded-xl font-medium disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#c4b5fd' }}
            title="Start a new scan with the same image and tag"
          >
            {reScanning
              ? <span className="w-3.5 h-3.5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
              : <Refresh01Icon size={15} />}
            Re-scan
          </button>
        </div>
      </div>

      {/* Status + severity cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="glass-panel rounded-xl p-4 col-span-1">
          <p className="text-xs text-zinc-500 mb-2">Status</p>
          <StatusBadge status={scan.status} />
          {scan.error_message && (
            <p className="text-xs text-red-400 mt-2 line-clamp-2">{scan.error_message}</p>
          )}
        </div>
        {sevCards.map(({ label, count, color, border }) => (
          <div key={label} className={`rounded-xl border ${border} p-4`} style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: 'var(--glass-shadow)',
          }}>
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{count ?? 0}</p>
          </div>
        ))}
      </div>

      {/* Tags */}
      {allTags.length > 0 && (
        <div className="glass-panel rounded-xl p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <PencilEdit01Icon size={14} className="text-zinc-500" />
            <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Tags</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = (scan.tags ?? []).some((t) => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag)}
                  disabled={tagLoading === tag.id}
                  className={`text-xs px-3 py-1 rounded-full font-medium border transition-all disabled:opacity-50 ${
                    active ? '' : 'text-zinc-500 border-zinc-300 dark:border-zinc-700'
                  }`}
                  style={active ? { background: tag.color + '25', color: tag.color, borderColor: tag.color + '50' } : undefined}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Compliance */}
      {(compliance.length > 0 || allOrgs.length > 0) && (
        <div className="glass-panel rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldKeyIcon size={14} className="text-zinc-500" />
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Compliance</span>
            </div>
            {compliance.length > 0 && (
              <button
                onClick={handleReEvaluate}
                disabled={complianceLoading}
                className="text-xs text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors disabled:opacity-40"
              >
                {complianceLoading ? 'Evaluating…' : 'Re-evaluate'}
              </button>
            )}
          </div>

          {compliance.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">Not assigned to any organization.</p>
              {allOrgs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {allOrgs.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => handleAssignOrg(org.id)}
                      className="text-xs px-2 py-1 rounded-lg text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors"
                      style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                    >
                      + {org.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(
                compliance.reduce(
                  (acc, r) => {
                    const key = r.org_name ?? r.org_id;
                    if (!acc[key]) acc[key] = { org_id: r.org_id, org_name: r.org_name ?? r.org_id, results: [] };
                    acc[key].results.push(r);
                    return acc;
                  },
                  {} as Record<string, { org_id: string; org_name: string; results: ComplianceResult[] }>,
                ),
              ).map(([, { org_id, org_name, results }]) => {
                const allPass = results.every((r) => r.status === 'pass');
                return (
                  <div key={org_id} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          allPass ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {allPass ? '✓' : '✗'} {org_name}
                      </span>
                      <button
                        onClick={() => handleRemoveOrg(org_id)}
                        className="text-zinc-400 dark:text-zinc-700 hover:text-red-400 transition-colors text-xs"
                      >
                        remove
                      </button>
                    </div>
                    {results.map((r) => (
                      <div key={r.id} className="ml-4 space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs ${r.status === 'pass' ? 'text-emerald-500' : 'text-red-400'}`}>
                            {r.status === 'pass' ? '✓' : '✗'}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">{r.policy_name}</span>
                        </div>
                        {r.violations && r.violations.length > 0 && (
                          <ul className="ml-4 space-y-0.5">
                            {r.violations.slice(0, 3).map((v, i) => (
                              <li key={i} className="text-xs text-zinc-500">{v.message}</li>
                            ))}
                            {r.violations.length > 3 && (
                              <li className="text-xs text-zinc-500 dark:text-zinc-700">+{r.violations.length - 3} more</li>
                            )}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
              {allOrgs
                .filter((o) => !compliance.some((c) => c.org_id === o.id))
                .map((org) => (
                  <button
                    key={org.id}
                    onClick={() => handleAssignOrg(org.id)}
                    className="text-xs px-2 py-1 rounded-lg text-zinc-600 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors"
                    style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                  >
                    + {org.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Scanning animation */}
      {(scan.status === 'pending' || scan.status === 'running') && (
        <ScanningAnimation status={scan.status} startedAt={scan.started_at} />
      )}

      {/* Tab bar */}
      {scan.status !== 'pending' && scan.status !== 'running' && (
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          {(['vulns', 'sbom'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-1.5 text-sm font-medium rounded-lg transition-all"
              style={activeTab === tab
                ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', boxShadow: '0 0 12px rgba(124,58,237,0.3)' }
                : { color: 'var(--text-muted)' }}
            >
              {tab === 'vulns' ? `Vulnerabilities${vulnTotal ? ` (${vulnTotal})` : ''}` : `SBOM${sbomTotal ? ` (${sbomTotal})` : ''}`}
            </button>
          ))}
        </div>
      )}

      {/* SBOM tab */}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'sbom' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={sbomNameInput}
              onChange={e => setSbomNameInput(e.target.value)}
              placeholder="Filter by name…"
              className={inputCls}
            />
            <select
              value={sbomTypeFilter}
              onChange={e => { setSbomTypeFilter(e.target.value); setSbomLoaded(false); }}
              className={inputCls}
            >
              <option value="">All Types</option>
              <option value="library">Library</option>
              <option value="application">Application</option>
              <option value="operating-system">OS</option>
            </select>
          </div>
          <div className="glass-panel rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Version</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">License</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Package URL</th>
                </tr>
              </thead>
              <tbody>
                {sbomLoading ? (
                  <tr><td colSpan={5} className="py-12 text-center">
                    <div className="flex justify-center">
                      <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  </td></tr>
                ) : sbomComponents.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-sm text-zinc-500">
                    No SBOM components found for this scan.
                  </td></tr>
                ) : sbomComponents.map((c, i) => (
                  <tr
                    key={c.id}
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-700 dark:text-zinc-200">{c.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">{c.version || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                        {c.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">{c.license || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-400 max-w-xs truncate" title={c.package_url}>{c.package_url || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'vulns' && <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
              Vulnerabilities
              {vulnTotal > 0 && <span className="text-sm font-normal text-zinc-500 ml-2">{vulnTotal} found</span>}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={severityFilter}
              onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
              className={inputCls}
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
              className={inputCls}
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
              className="px-3 py-2 text-sm rounded-xl transition-colors"
              style={hasFix
                ? { background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.3)', color: '#c4b5fd' }
                : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }
              }
            >
              Has Fix
            </button>
          </div>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                {([
                  { label: 'CVE ID',     key: 'vuln_id',           align: 'left'  },
                  { label: 'Package',    key: 'pkg_name',          align: 'left'  },
                  { label: 'Installed',  key: 'installed_version', align: 'left'  },
                  { label: 'Fixed In',   key: 'fixed_version',     align: 'left'  },
                  { label: 'Severity',   key: 'severity',          align: 'left'  },
                  { label: 'CVSS',       key: 'cvss_score',        align: 'right' },
                  { label: 'First Seen', key: 'first_seen_at',     align: 'left'  },
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
                      className={`px-4 py-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none transition-colors text-${align}`}
                      style={{ color: active ? '#a78bfa' : 'rgba(113,113,122,0.8)' }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>
                          {active && sortDir === 'desc' ? '↓' : '↑'}
                        </span>
                      </span>
                    </th>
                  );
                })}
                <th className="text-right px-4 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(113,113,122,0.8)' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {vulnLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <div className="flex justify-center">
                      <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  </td>
                </tr>
              ) : vulns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500 text-sm">
                    No vulnerabilities found.
                  </td>
                </tr>
              ) : vulns.map((v, i) => (
                <>
                  <tr
                    key={v.id}
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-4 py-3">
                      {v.vuln_id ? (
                        <a
                          href={`https://nvd.nist.gov/vuln/detail/${v.vuln_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-violet-500 dark:text-violet-400 hover:text-violet-400 dark:hover:text-violet-300 hover:underline transition-colors"
                        >
                          {v.vuln_id}
                        </a>
                      ) : <span className="text-zinc-400 dark:text-zinc-600">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">{v.pkg_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{v.installed_version}</td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-500">
                      {v.fixed_version || <span className="text-zinc-400 dark:text-zinc-700">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={v.severity} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">
                      {v.cvss_score ? v.cvss_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <FirstSeenBadge firstSeenAt={v.first_seen_at} scanCompletedAt={scan.completed_at} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setExpandedVuln(expandedVuln === v.id ? null : v.id);
                          setCommentText('');
                        }}
                        className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
                      >
                        <Comment01Icon size={15} />
                        {v.comments && v.comments.length > 0 && (
                          <span className="text-xs rounded-full px-1.5 py-0.5 font-medium"
                            style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}>
                            {v.comments.length}
                          </span>
                        )}
                      </button>
                    </td>
                  </tr>
                  {expandedVuln === v.id && (
                    <tr key={`${v.id}-comments`}>
                      <td colSpan={8} className="px-4 py-4" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--row-hover)' }}>
                        <div className="space-y-4 max-w-3xl">

                          {/* Suppression section */}
                          {scan.image_digest && (
                            <div className="space-y-2.5">
                              <div className="flex items-center gap-2">
                                <ShieldKeyIcon size={13} className="text-zinc-400" />
                                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Suppression</span>
                                {v.suppression && (
                                  <span className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                                    style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                                    {v.suppression.status.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </div>
                              {v.suppression && (
                                <div className="rounded-lg px-3 py-2 space-y-1"
                                  style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}>
                                  <p className="text-xs text-zinc-400">{v.suppression.justification || '—'}</p>
                                  {v.suppression.expires_at && (
                                    <p className="text-xs text-zinc-500">Expires: {new Date(v.suppression.expires_at).toLocaleDateString()}</p>
                                  )}
                                  {v.suppression.username && (
                                    <p className="text-xs text-zinc-500">By: {v.suppression.username}</p>
                                  )}
                                </div>
                              )}
                              <div className="flex gap-2 items-center flex-wrap">
                                <select
                                  value={suppressStatus}
                                  onChange={e => setSuppressStatus(e.target.value as Suppression['status'])}
                                  className={inputCls}
                                >
                                  <option value="accepted">Accepted Risk</option>
                                  <option value="wont_fix">Won&apos;t Fix</option>
                                  <option value="false_positive">False Positive</option>
                                </select>
                                <input
                                  type="text"
                                  value={suppressJustification}
                                  onChange={e => setSuppressJustification(e.target.value)}
                                  placeholder="Justification…"
                                  className={`${inputCls} flex-1 min-w-0`}
                                />
                                <input
                                  type="date"
                                  value={suppressExpiry}
                                  onChange={e => setSuppressExpiry(e.target.value)}
                                  title="Expiry date (optional)"
                                  className={inputCls}
                                />
                                <button
                                  onClick={() => handleSuppress(v)}
                                  disabled={suppressSaving || !suppressJustification.trim()}
                                  className="px-3 py-2 text-sm rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90 shrink-0"
                                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
                                >
                                  {v.suppression ? 'Update' : 'Suppress'}
                                </button>
                                {v.suppression && (
                                  <button
                                    onClick={() => handleLiftSuppression(v)}
                                    disabled={suppressSaving}
                                    className="px-3 py-2 text-sm rounded-xl disabled:opacity-40 transition-colors shrink-0"
                                    style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}
                                  >
                                    Lift
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

                          {/* Notes / Comments */}
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Comment01Icon size={13} className="text-zinc-400" />
                              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Notes</span>
                            </div>
                            {v.comments && v.comments.length > 0 ? (
                              <div className="space-y-2">
                                {v.comments.map((c) => (
                                  <div key={c.id} className="flex items-start justify-between gap-3 group">
                                    <div className="flex-1 min-w-0">
                                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                        {c.username || 'You'}
                                      </span>
                                      <span className="text-xs text-zinc-500 ml-2">
                                        {new Date(c.created_at).toLocaleString()}
                                      </span>
                                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{c.content}</p>
                                    </div>
                                    {currentUser?.id === c.user_id && (
                                      <button
                                        onClick={() => handleDeleteComment(c.id)}
                                        className="text-zinc-400 dark:text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                      >
                                        <Delete02Icon size={14} />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-zinc-500">No notes yet.</p>
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
                                className="px-3 py-2 text-sm rounded-xl font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90 shrink-0"
                                style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.35),inset 0 1px 0 rgba(255,255,255,0.15)' }}
                              >
                                Add Note
                              </button>
                            </div>
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
                className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
              >
                ← Prev
              </button>
              <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}
