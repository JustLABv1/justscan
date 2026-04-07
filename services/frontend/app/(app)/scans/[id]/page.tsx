'use client';
import { ScannerDatabaseCard, ScanningAnimation } from '@/components/scans/scan-runtime';
import { useToast } from '@/components/toast';
import { SeverityBadge, SourceBadge, StatusBadge } from '@/components/ui/badges';
import { ScanDetailSkeleton } from '@/components/ui/skeleton';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import {
    addTagToScan,
    assignScanToOrg,
    cancelScan,
    ComplianceResult,
    createComment,
    createShare,
    deleteComment,
    deleteShare,
    deleteSuppression,
    getScan,
    getScanCompliance,
    getScanSBOM,
    getUser,
    listOrgs,
    listScans,
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
import { fullDate, timeAgo } from '@/lib/time';
import { Calendar, DateField, DatePicker, ListBox, Select } from '@heroui/react';
import type { DateValue } from '@internationalized/date';
import { parseDate } from '@internationalized/date';
import { ArrowLeft01Icon, Cancel01Icon, Comment01Icon, CpuIcon, Delete02Icon, FileExportIcon, GitCompareIcon, Refresh01Icon, Share01Icon, ShieldKeyIcon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const inputCls = 'px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl glass-input';

function FirstSeenBadge({ firstSeenAt }: { firstSeenAt?: string | null }) {
  if (!firstSeenAt) {
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: '#fb923c', background: 'rgba(249,115,22,0.12)' }}>
        New
      </span>
    );
  }
  return <span className="text-xs text-zinc-500">{timeAgo(firstSeenAt)}</span>;
}

const LIMIT = 25;

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [scan, setScan] = useState<Scan | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'vulns' | 'sbom' | 'details'>('vulns');
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
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [reScanning, setReScanning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [comparingPrev, setComparingPrev] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareVisibility, setShareVisibility] = useState<'public' | 'authenticated'>('public');
  const [shareCopied, setShareCopied] = useState(false);

  const [suppressStatus, setSuppressStatus] = useState<Suppression['status']>('accepted');
  const [suppressJustification, setSuppressJustification] = useState('');
  const [suppressExpiry, setSuppressExpiry] = useState<DateValue | null>(null);
  const [suppressSaving, setSuppressSaving] = useState(false);
  const [suppressError, setSuppressError] = useState('');

  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStatus = scan?.status;

  const loadScan = useCallback(async () => {
    const nextScan = await getScan(id);
    setScan(nextScan);
    return nextScan;
  }, [id]);

  // Initial load
  useEffect(() => {
    loadScan().catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
    listTags().then(setAllTags).catch(() => {});
    getScanCompliance(id).then(setCompliance).catch(() => {});
    listOrgs().then(setAllOrgs).catch(() => {});
  }, [id, loadScan]);

  useConditionalInterval(() => {
    void loadScan()
      .then((nextScan) => {
        if (nextScan.status === 'completed' || nextScan.status === 'failed') {
          void getScanCompliance(id).then(setCompliance).catch(() => {});
        }
      })
      .catch(() => {});
  }, scanStatus === 'pending' || scanStatus === 'running', 3000);

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
    setSuppressError('');
    if (v?.suppression) {
      setSuppressStatus(v.suppression.status);
      setSuppressJustification(v.suppression.justification);
      setSuppressExpiry(v.suppression.expires_at
        ? parseDate(v.suppression.expires_at.slice(0, 10))
        : null);
    } else {
      setSuppressStatus('accepted');
      setSuppressJustification('');
      setSuppressExpiry(null);
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
      toast.success('Re-scan queued');
      router.push(`/scans/${newScan.id}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to queue re-scan');
    } finally {
      setReScanning(false);
    }
  }

  async function handleCancel() {
    if (!scan) return;
    setCancelling(true);
    try {
      await cancelScan(id);
      setScan(s => s ? { ...s, status: 'cancelled' } : s);
    } catch { /* ignore */ } finally {
      setCancelling(false);
    }
  }

  async function handleEnableShare() {
    if (!scan) return;
    setShareLoading(true);
    try {
      const result = await createShare(scan.id, shareVisibility);
      setScan(s => s ? { ...s, share_token: result.share_token, share_visibility: result.share_visibility } : s);
    } catch { /* ignore */ } finally {
      setShareLoading(false);
    }
  }

  async function handleDisableShare() {
    if (!scan) return;
    setShareLoading(true);
    try {
      await deleteShare(scan.id);
      setScan(s => s ? { ...s, share_token: undefined, share_visibility: undefined } : s);
    } catch { /* ignore */ } finally {
      setShareLoading(false);
    }
  }

  async function handleComparePrev() {
    if (!scan) return;
    setComparingPrev(true);
    try {
      const res = await listScans(1, 5, scan.image_name);
      const prev = (res.data ?? []).find(s => s.id !== scan.id);
      if (prev) router.push(`/scans/compare?a=${prev.id}&b=${scan.id}`);
    } catch { /* ignore */ } finally {
      setComparingPrev(false);
    }
  }

  async function handleSuppress(vuln: Vulnerability) {
    if (!scan?.image_digest) return;
    setSuppressSaving(true);
    setSuppressError('');
    try {
      await upsertSuppression(scan.image_digest, {
        vuln_id: vuln.vuln_id,
        status: suppressStatus,
        justification: suppressJustification,
        expires_at: suppressExpiry ? new Date(suppressExpiry.toString()).toISOString() : null,
      });
      loadVulns();
    } catch (e: unknown) {
      setSuppressError(e instanceof Error ? e.message : 'Failed to save suppression');
    } finally {
      setSuppressSaving(false);
    }
  }

  async function handleLiftSuppression(vuln: Vulnerability) {
    if (!scan?.image_digest) return;
    setSuppressSaving(true);
    setSuppressError('');
    try {
      await deleteSuppression(scan.image_digest, vuln.vuln_id);
      loadVulns();
    } catch (e: unknown) {
      setSuppressError(e instanceof Error ? e.message : 'Failed to lift suppression');
    } finally {
      setSuppressSaving(false);
    }
  }

  if (loading) return <ScanDetailSkeleton />;

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
    { count: scan.critical_count, label: 'Critical', color: 'text-red-400',    border: 'border-red-500/20'    },
    { count: scan.high_count,     label: 'High',     color: 'text-orange-400', border: 'border-orange-500/20' },
    { count: scan.medium_count,   label: 'Medium',   color: 'text-yellow-400', border: 'border-yellow-500/20' },
    { count: scan.low_count,      label: 'Low',      color: 'text-blue-400',   border: 'border-blue-500/20'   },
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
            {scan.helm_chart && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 mt-1" title={scan.helm_source_path}>
                <span className="font-medium text-violet-400">Helm</span>
                <span className="font-mono truncate max-w-[320px]">{scan.helm_chart}</span>
                {scan.helm_source_path && (
                  <span className="text-zinc-400 truncate max-w-[200px]">· {scan.helm_source_path}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/reports/print?scans=${scan.id}`}
              target="_blank"
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >
              <FileExportIcon size={15} />
              Export
            </Link>
            {(scan.status === 'pending' || scan.status === 'running') && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl font-medium disabled:opacity-50 transition-all hover:opacity-90"
                style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}
                title="Stop this scan"
              >
                {cancelling
                  ? <span className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                  : <Cancel01Icon size={15} />}
                Cancel
              </button>
            )}
            <button
              onClick={handleReScan}
              disabled={reScanning || scan.status === 'running' || scan.status === 'pending'}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl font-medium disabled:opacity-50 transition-all hover:opacity-90"
              style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#c4b5fd' }}
              title="Start a new scan with the same image and tag"
            >
              {reScanning
                ? <span className="w-3.5 h-3.5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                : <Refresh01Icon size={15} />}
              Re-scan
            </button>
            <button
              onClick={handleComparePrev}
              disabled={comparingPrev}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl font-medium disabled:opacity-50 transition-all"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
              title="Compare with the previous scan of this image"
            >
              {comparingPrev
                ? <span className="w-3.5 h-3.5 border-2 border-zinc-400/30 border-t-zinc-400 rounded-full animate-spin" />
                : <GitCompareIcon size={15} />}
              Compare
            </button>
            {/* Share button + dropdown panel */}
            <div className="relative">
              <button
                onClick={() => { setShareOpen(o => !o); if (scan.share_visibility) setShareVisibility(scan.share_visibility as 'public' | 'authenticated'); }}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-xl font-medium transition-all"
                style={scan.share_token
                  ? { background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }
                  : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
                title="Share this scan"
              >
                <Share01Icon size={15} />
                Share
              </button>
              {shareOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} />
                  <div className="absolute right-0 top-11 w-80 rounded-xl z-50 p-4 space-y-3"
                    style={{ background: 'var(--modal-bg)', border: '1px solid var(--modal-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-white">Share scan</p>
                      <button onClick={() => setShareOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>
                    </div>
                    {scan.share_token ? (
                      <>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1.5">Share link
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs font-medium"
                              style={{ background: scan.share_visibility === 'public' ? 'rgba(34,197,94,0.1)' : 'rgba(124,58,237,0.1)', color: scan.share_visibility === 'public' ? '#4ade80' : '#a78bfa', border: `1px solid ${scan.share_visibility === 'public' ? 'rgba(34,197,94,0.2)' : 'rgba(124,58,237,0.2)'}` }}>
                              {scan.share_visibility}
                            </span>
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 truncate">
                              {typeof window !== 'undefined' ? `${window.location.origin}/shared/${scan.share_token}` : ''}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(`${window.location.origin}/shared/${scan.share_token}`);
                                setShareCopied(true);
                                setTimeout(() => setShareCopied(false), 1500);
                              }}
                              className="shrink-0 px-2.5 py-1.5 text-xs rounded-lg transition-colors"
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}
                            >
                              {shareCopied ? '✓ Copied' : 'Copy'}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs text-zinc-500">Change visibility</p>
                          <div className="flex gap-2">
                            {(['public', 'authenticated'] as const).map(v => (
                              <button key={v} onClick={() => setShareVisibility(v)}
                                className="flex-1 py-1.5 text-xs rounded-lg font-medium transition-all"
                                style={shareVisibility === v
                                  ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white' }
                                  : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                                {v === 'public' ? '🌐 Public' : '🔐 Signed in'}
                              </button>
                            ))}
                          </div>
                          {shareVisibility !== scan.share_visibility && (
                            <button onClick={handleEnableShare} disabled={shareLoading}
                              className="w-full py-1.5 text-xs rounded-lg font-medium transition-all disabled:opacity-50"
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                              {shareLoading ? 'Updating…' : 'Update visibility'}
                            </button>
                          )}
                        </div>
                        <button onClick={handleDisableShare} disabled={shareLoading}
                          className="w-full py-2 text-xs rounded-lg transition-all disabled:opacity-50"
                          style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.18)' }}>
                          {shareLoading ? 'Processing…' : 'Disable sharing'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <p className="text-xs text-zinc-500">Visibility</p>
                          <div className="flex gap-2">
                            {(['public', 'authenticated'] as const).map(v => (
                              <button key={v} onClick={() => setShareVisibility(v)}
                                className="flex-1 py-1.5 text-xs rounded-lg font-medium transition-all"
                                style={shareVisibility === v
                                  ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white' }
                                  : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                                {v === 'public' ? '🌐 Public' : '🔐 Signed in'}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            {shareVisibility === 'public'
                              ? 'Anyone with the link can view this scan.'
                              : 'Only signed-in users can view this scan.'}
                          </p>
                        </div>
                        <button onClick={handleEnableShare} disabled={shareLoading}
                          className="w-full py-2 text-sm rounded-lg font-medium transition-all disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white' }}>
                          {shareLoading ? 'Creating link…' : 'Create share link'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status + severity cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="glass-panel rounded-xl p-4 col-span-1">
          <p className="text-xs text-zinc-500 mb-2">Status</p>
          <StatusBadge status={scan.status} externalStatus={scan.external_status} />
          {scan.external_status && scan.scan_provider === 'artifactory_xray' && (
            <p className="text-[11px] text-zinc-500 mt-2">
              External state: {scan.external_status.replace(/_/g, ' ')}
            </p>
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

    {/* Scanner info moved to Details tab */}

      {/* Error banner — shown when scan failed */}
      {scan.status === 'failed' && scan.error_message && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}>
          <svg className="shrink-0 mt-0.5" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-400 mb-0.5">Scan failed</p>
            <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-all font-mono leading-relaxed">{scan.error_message}</pre>
          </div>
        </div>
      )}

      {/* Tags + Compliance + Scanner info → moved to Details tab */}

      {/* Scanning animation */}
      {(scan.status === 'pending' || scan.status === 'running') && (
        <ScanningAnimation status={scan.status} externalStatus={scan.external_status} startedAt={scan.started_at} />
      )}

      {/* Tab bar */}
      {scan.status !== 'pending' && scan.status !== 'running' && (
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
          {([
            { id: 'vulns',   label: vulnTotal ? `Vulnerabilities (${vulnTotal})` : 'Vulnerabilities' },
            { id: 'sbom',    label: sbomTotal ? `SBOM (${sbomTotal})` : 'SBOM' },
            { id: 'details', label: 'Details' },
          ] as { id: 'vulns' | 'sbom' | 'details'; label: string }[]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="px-4 py-1.5 text-sm font-medium rounded-lg transition-all"
              style={activeTab === id
                ? { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', boxShadow: '0 0 12px rgba(124,58,237,0.3)' }
                : { color: 'var(--text-muted)' }}
            >
              {label}
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
            <Select selectedKey={sbomTypeFilter || '__all__'} onSelectionChange={k => { setSbomTypeFilter(String(k === '__all__' ? '' : k)); setSbomLoaded(false); }} className="flex-1">
              <Select.Trigger className={inputCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="__all__">All Types</ListBox.Item>
                  <ListBox.Item id="library">Library</ListBox.Item>
                  <ListBox.Item id="application">Application</ListBox.Item>
                  <ListBox.Item id="operating-system">OS</ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
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
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'vulns' && <div className="space-y-4">
        <div className="space-y-2.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
            Vulnerabilities
            {vulnTotal > 0 && <span className="text-sm font-normal text-zinc-500 ml-2">{vulnTotal} found</span>}
          </h2>
          {/* Severity pills + secondary filters in one row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { id: '',         label: 'All',      count: (scan.critical_count ?? 0) + (scan.high_count ?? 0) + (scan.medium_count ?? 0) + (scan.low_count ?? 0) },
              { id: 'CRITICAL', label: 'Critical', count: scan.critical_count ?? 0, color: 'rgba(239,68,68,0.15)',   activeColor: '#f87171', border: 'rgba(239,68,68,0.3)'   },
              { id: 'HIGH',     label: 'High',     count: scan.high_count     ?? 0, color: 'rgba(249,115,22,0.15)', activeColor: '#fb923c', border: 'rgba(249,115,22,0.3)' },
              { id: 'MEDIUM',   label: 'Medium',   count: scan.medium_count   ?? 0, color: 'rgba(234,179,8,0.15)',  activeColor: '#facc15', border: 'rgba(234,179,8,0.3)'  },
              { id: 'LOW',      label: 'Low',      count: scan.low_count      ?? 0, color: 'rgba(59,130,246,0.15)', activeColor: '#60a5fa', border: 'rgba(59,130,246,0.3)' },
            ] as { id: string; label: string; count: number; color?: string; activeColor?: string; border?: string }[]).map(({ id, label, count, color, activeColor, border }) => {
              const active = severityFilter === id;
              return (
                <button
                  key={id}
                  onClick={() => { setSeverityFilter(id); setPage(1); }}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium border transition-all"
                  style={active
                    ? { background: color ?? 'rgba(124,58,237,0.15)', color: activeColor ?? '#a78bfa', borderColor: border ?? 'rgba(167,139,250,0.3)' }
                    : { background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }
                  }
                >
                  {label}
                  {count > 0 && <span className="opacity-60">{count}</span>}
                </button>
              );
            })}
            </div>
            {/* Secondary filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={pkgInput}
                onChange={(e) => setPkgInput(e.target.value)}
                placeholder="Package…"
                className={inputCls}
              />
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-zinc-500 whitespace-nowrap">Min CVSS</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={minCvss || ''}
                  placeholder="0"
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setMinCvss(!isNaN(val) ? val : 0);
                    setPage(1);
                  }}
                  className={`${inputCls} w-20`}
                />
              </div>
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
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${v.vuln_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-violet-500 dark:text-violet-400 hover:text-violet-400 dark:hover:text-violet-300 hover:underline transition-colors"
                          >
                            {v.vuln_id}
                          </a>
                          <SourceBadge source={v.data_source} />
                          {v.suppression && (
                            <span
                              className="text-xs font-medium px-1.5 py-0.5 rounded-md capitalize shrink-0"
                              style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.25)' }}
                              title={v.suppression.justification || 'Suppressed'}
                            >
                              {v.suppression.status.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
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
                      <FirstSeenBadge firstSeenAt={v.first_seen_at} />
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
                                <Select selectedKey={suppressStatus} onSelectionChange={k => setSuppressStatus(k as Suppression['status'])}>
                                  <Select.Trigger className={inputCls}>
                                    <Select.Value />
                                    <Select.Indicator />
                                  </Select.Trigger>
                                  <Select.Popover>
                                    <ListBox>
                                      <ListBox.Item id="accepted">Accepted Risk</ListBox.Item>
                                      <ListBox.Item id="wont_fix">Won&apos;t Fix</ListBox.Item>
                                      <ListBox.Item id="false_positive">False Positive</ListBox.Item>
                                    </ListBox>
                                  </Select.Popover>
                                </Select>
                                <input
                                  type="text"
                                  value={suppressJustification}
                                  onChange={e => setSuppressJustification(e.target.value)}
                                  placeholder="Justification…"
                                  className={`${inputCls} flex-1 min-w-0`}
                                />
                                <DatePicker
                                  aria-label="Expiry date (optional)"
                                  value={suppressExpiry}
                                  onChange={setSuppressExpiry}
                                  className="w-40"
                                >
                                  <DateField.Group className={`${inputCls} flex items-center gap-1`}>
                                    <DateField.Input>{(seg) => <DateField.Segment segment={seg} />}</DateField.Input>
                                    <DateField.Suffix>
                                      <DatePicker.Trigger>
                                        <DatePicker.TriggerIndicator />
                                      </DatePicker.Trigger>
                                    </DateField.Suffix>
                                  </DateField.Group>
                                  <DatePicker.Popover>
                                    <Calendar aria-label="Expiry date">
                                      <Calendar.Header>
                                        <Calendar.YearPickerTrigger>
                                          <Calendar.YearPickerTriggerHeading />
                                          <Calendar.YearPickerTriggerIndicator />
                                        </Calendar.YearPickerTrigger>
                                        <Calendar.NavButton slot="previous" />
                                        <Calendar.NavButton slot="next" />
                                      </Calendar.Header>
                                      <Calendar.Grid>
                                        <Calendar.GridHeader>
                                          {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                                        </Calendar.GridHeader>
                                        <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
                                      </Calendar.Grid>
                                      <Calendar.YearPickerGrid>
                                        <Calendar.YearPickerGridBody>
                                          {({year}) => <Calendar.YearPickerCell year={year} />}
                                        </Calendar.YearPickerGridBody>
                                      </Calendar.YearPickerGrid>
                                    </Calendar>
                                  </DatePicker.Popover>
                                </DatePicker>
                                <button
                                  onClick={() => handleSuppress(v)}
                                  disabled={suppressSaving || !suppressJustification.trim()}
                                  className="px-3 py-2 text-sm rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90 shrink-0 flex items-center gap-1.5"
                                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
                                >
                                  {suppressSaving && <span className="w-3 h-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />}
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
                              {suppressError && (
                                <p className="text-xs mt-1" style={{ color: '#f87171' }}>{suppressError}</p>
                              )}
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
                                      <span className="text-xs text-zinc-500 ml-2" title={fullDate(c.created_at)}>
                                        {timeAgo(c.created_at)}
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

      {/* Details tab */}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'details' && (
        <div className="space-y-4">

          {/* Scanner info */}
          {(scan.trivy_version || scan.trivy_vuln_db_updated_at || scan.trivy_java_db_updated_at) && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Scanner</p>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="glass-panel rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">Scanner</p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">Trivy {scan.trivy_version || 'unknown'}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {scan.completed_at ? `DB snapshot captured ${timeAgo(scan.completed_at)}` : 'DB snapshot captured when this scan completed'}
                  </p>
                </div>
                <ScannerDatabaseCard
                  label="Vulnerability DB"
                  updatedAt={scan.trivy_vuln_db_updated_at}
                  downloadedAt={scan.trivy_vuln_db_downloaded_at}
                />
                <ScannerDatabaseCard
                  label="Java DB"
                  updatedAt={scan.trivy_java_db_updated_at}
                  downloadedAt={scan.trivy_java_db_downloaded_at}
                />
              </div>
            </div>
          )}

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="glass-panel rounded-xl px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Tags</p>
              <div className="flex items-center gap-2 flex-wrap">
                {allTags.map((tag) => {
                  const active = (scan.tags ?? []).some((t) => t.id === tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag)}
                      disabled={tagLoading === tag.id}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-all disabled:opacity-50 ${
                        !active ? 'text-zinc-500 border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600' : ''
                      }`}
                      style={active ? { background: tag.color + '22', color: tag.color, borderColor: tag.color + '50' } : undefined}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Compliance */}
          {(allOrgs.length > 0 || compliance.length > 0) && (
            <div className="glass-panel rounded-xl px-4 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Compliance</p>
                {compliance.length > 0 && (
                  <button
                    onClick={handleReEvaluate}
                    disabled={complianceLoading}
                    className="text-xs text-zinc-500 hover:text-violet-400 transition-colors disabled:opacity-40"
                  >
                    {complianceLoading ? '…' : 'Re-evaluate'}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {compliance.length === 0 ? (
                  <>
                    <span className="text-xs text-zinc-500">No org assigned —</span>
                    {allOrgs.map((org) => (
                      <button
                        key={org.id}
                        onClick={() => handleAssignOrg(org.id)}
                        className="text-xs px-2.5 py-1 rounded-full font-medium border transition-colors"
                        style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}
                      >
                        + {org.name}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {Object.entries(
                      compliance.reduce((acc, r) => {
                        const key = r.org_name ?? r.org_id;
                        if (!acc[key]) acc[key] = { org_id: r.org_id, org_name: r.org_name ?? r.org_id, results: [] };
                        acc[key].results.push(r);
                        return acc;
                      }, {} as Record<string, { org_id: string; org_name: string; results: ComplianceResult[] }>),
                    ).map(([, { org_id, org_name, results }]) => {
                      const allPass = results.every((r) => r.status === 'pass');
                      return (
                        <div key={org_id} className="flex items-center gap-1">
                          <button
                            onClick={() => setExpandedOrg(expandedOrg === org_id ? null : org_id)}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border transition-all"
                            style={allPass
                              ? { background: 'rgba(16,185,129,0.1)', color: '#34d399', borderColor: 'rgba(16,185,129,0.25)' }
                              : { background: 'rgba(239,68,68,0.1)', color: '#f87171', borderColor: 'rgba(239,68,68,0.25)' }}
                          >
                            {allPass ? '✓' : '✗'} {org_name}
                          </button>
                          <button onClick={() => handleRemoveOrg(org_id)} className="text-zinc-500 hover:text-red-400 transition-colors text-sm px-1">×</button>
                        </div>
                      );
                    })}
                    {allOrgs.filter((o) => !compliance.some((c) => c.org_id === o.id)).map((org) => (
                      <button
                        key={org.id}
                        onClick={() => handleAssignOrg(org.id)}
                        className="text-xs px-2.5 py-1 rounded-full font-medium border transition-colors"
                        style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}
                      >
                        + {org.name}
                      </button>
                    ))}
                  </>
                )}
              </div>
              {expandedOrg && (
                <div className="mt-2 pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
                  {compliance.filter((r) => r.org_id === expandedOrg).map((r) => (
                    <div key={r.id} className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs ${r.status === 'pass' ? 'text-emerald-500' : 'text-red-400'}`}>
                          {r.status === 'pass' ? '✓' : '✗'}
                        </span>
                        <span className="text-xs text-zinc-500">{r.policy_name}</span>
                      </div>
                      {r.violations && r.violations.length > 0 && (
                        <ul className="ml-4 space-y-0.5">
                          {r.violations.slice(0, 3).map((v, i) => (
                            <li key={i} className="text-xs text-zinc-500">{v.message}</li>
                          ))}
                          {r.violations.length > 3 && (
                            <li className="text-xs text-zinc-500">+{r.violations.length - 3} more</li>
                          )}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
