'use client';
import { useToast } from '@/components/toast';
import { SeverityBadge, SourceBadge, StatusBadge } from '@/components/ui/badges';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import { ScanDetailSkeleton } from '@/components/ui/skeleton';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import type { ComplianceResult, Org, SBOMComponent, Scan, Suppression, Tag, Vulnerability } from '@/lib/api';
import {
    addTagToScan,
    assignScanToOrg,
    cancelScan,
    createComment,
    createShare,
    deleteComment,
    deleteShare,
    deleteSuppression,
    getScan,
    getScanCompliance,
    getScanSBOM,
    getUser,
    getVulnerabilityContextAnalysis,
    listOrgs,
    listScans,
    listTags,
    listVulnerabilities,
    reEvaluateCompliance,
    removeScanFromOrg,
    removeTagFromScan,
    reScan,
    upsertSuppression,
} from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { Calendar, DateField, DatePicker, Dropdown, Label, ListBox, Select, useOverlayState } from '@heroui/react';
import type { DateValue } from '@internationalized/date';
import { parseDate } from '@internationalized/date';
import { ArrowLeft01Icon, Cancel01Icon, Comment01Icon, CpuIcon, Delete02Icon, FileExportIcon, GitCompareIcon, MoreVerticalIcon, Refresh01Icon, Share01Icon, ShieldKeyIcon } from 'hugeicons-react';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ScannerDatabaseCard, ScanningAnimation, ScanStepTimeline } from '../../../../components/scans/scan-runtime';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

type ScanTab = 'vulns' | 'policy' | 'sbom' | 'details' | 'timeline';

type BlockedPolicyDetails = {
  summary: string;
  manifest?: string;
  artifact?: string;
  jfrog?: string;
  matchedIssues?: string;
  matchedWatches?: string;
  blockingPolicies?: string;
  matchedPolicies?: string;
  totalViolations?: string;
};

function parseBlockedPolicyDetails(errorMessage?: string | null): BlockedPolicyDetails | null {
  const message = errorMessage?.trim();
  if (!message) return null;

  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const details: BlockedPolicyDetails = { summary: lines[0] };
  for (const line of lines.slice(1)) {
    if (line.startsWith('Manifest: ')) details.manifest = line.slice('Manifest: '.length);
    else if (line.startsWith('Artifact: ')) details.artifact = line.slice('Artifact: '.length);
    else if (line.startsWith('JFrog: ')) details.jfrog = line.slice('JFrog: '.length);
    else if (line.startsWith('Matched issues: ')) details.matchedIssues = line.slice('Matched issues: '.length);
    else if (line.startsWith('Matched watches: ')) details.matchedWatches = line.slice('Matched watches: '.length);
    else if (line.startsWith('Blocking policies: ')) details.blockingPolicies = line.slice('Blocking policies: '.length);
    else if (line.startsWith('Matched policies: ')) details.matchedPolicies = line.slice('Matched policies: '.length);
    else if (line.startsWith('Xray violations found for this artifact: ')) details.totalViolations = line.slice('Xray violations found for this artifact: '.length);
  }

  const hasStructuredDetails = Boolean(
    details.manifest ||
    details.artifact ||
    details.jfrog ||
    details.matchedIssues ||
    details.matchedWatches ||
    details.blockingPolicies ||
    details.matchedPolicies ||
    details.totalViolations
  );

  return hasStructuredDetails ? details : null;
}

function DetailBlock({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;

  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">{label}</p>
      <p className={mono ? 'text-xs font-mono text-zinc-700 dark:text-zinc-300 break-all leading-relaxed' : 'text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed'}>
        {value}
      </p>
    </div>
  );
}

function imageConfigObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function imageConfigString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function imageConfigStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function imageConfigEntries(value: unknown): Array<[string, string]> {
  const record = imageConfigObject(value);
  if (!record) {
    return [];
  }
  return Object.entries(record).map(([key, entry]) => [key, String(entry ?? '').trim()] as [string, string]);
}

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
  const [activeTab, setActiveTab] = useState<ScanTab>('vulns');
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
  const loadVersionRef = useRef(0);
  const defaultTabInitializedRef = useRef(false);

  const [suppressStatus, setSuppressStatus] = useState<Suppression['status']>('accepted');
  const [suppressJustification, setSuppressJustification] = useState('');
  const [suppressExpiry, setSuppressExpiry] = useState<DateValue | null>(null);
  const [suppressSaving, setSuppressSaving] = useState(false);
  const [suppressError, setSuppressError] = useState('');
  const vulnerabilityDetailsModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);

  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStatus = scan?.status;
  const blockedPolicyDetails = scan?.external_status === 'blocked_by_xray_policy'
    ? parseBlockedPolicyDetails(scan.error_message)
    : null;
  const hasPolicyTab = Boolean(blockedPolicyDetails);

  const loadScan = useCallback(async () => {
    const loadVersion = ++loadVersionRef.current;
    const nextScan = await getScan(id);
    if (loadVersion === loadVersionRef.current) {
      setScan(nextScan);
    }
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

  useEffect(() => {
    if (!scan || defaultTabInitializedRef.current) return;
    if (scan.status === 'pending' || scan.status === 'running') return;

    if (scan.external_status === 'blocked_by_xray_policy' && blockedPolicyDetails) {
      setActiveTab('policy');
    }

    defaultTabInitializedRef.current = true;
  }, [blockedPolicyDetails, scan]);

  useEffect(() => {
    if (!vulnerabilityDetailsModal.isOpen) {
      setSelectedVulnerability(null);
    }
  }, [vulnerabilityDetailsModal.isOpen]);

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
      const result = await cancelScan(id);
      setScan((current) => current ? {
        ...current,
        status: result.status ?? 'cancelled',
        current_step: result.current_step ?? 'cancelled',
        external_status: result.external_status ?? 'cancelled',
        completed_at: result.completed_at ?? new Date().toISOString(),
        error_message: result.error_message ?? 'Cancelled by user',
      } : current);
      await loadScan().catch(() => {});
      toast.success('Scan cancelled');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel scan');
    } finally {
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

  function openVulnerabilityDetails(vulnerability: Vulnerability) {
    setSelectedVulnerability(vulnerability);
    vulnerabilityDetailsModal.open();
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
  const fullImageConfig = scan.image_config;
  const runtimeImageConfig = imageConfigObject(fullImageConfig?.['config']);
  const imageCreated = imageConfigString(fullImageConfig?.['created']);
  const imageAuthor = imageConfigString(fullImageConfig?.['author']);
  const imageDockerVersion = imageConfigString(fullImageConfig?.['docker_version']);
  const imageUser = imageConfigString(runtimeImageConfig?.['User']);
  const imageWorkingDir = imageConfigString(runtimeImageConfig?.['WorkingDir']);
  const imageEntrypoint = imageConfigStringArray(runtimeImageConfig?.['Entrypoint']);
  const imageCommand = imageConfigStringArray(runtimeImageConfig?.['Cmd']);
  const imageEnv = imageConfigStringArray(runtimeImageConfig?.['Env']);
  const imageLabelEntries = imageConfigEntries(runtimeImageConfig?.['Labels']);
  const imageExposedPorts = imageConfigEntries(runtimeImageConfig?.['ExposedPorts']).map(([port]) => port);
  const imageVolumes = imageConfigEntries(runtimeImageConfig?.['Volumes']).map(([volume]) => volume);

  const sevCards = [
    { count: scan.critical_count, label: 'Critical', color: 'text-red-400',    border: 'border-red-500/20'    },
    { count: scan.high_count,     label: 'High',     color: 'text-orange-400', border: 'border-orange-500/20' },
    { count: scan.medium_count,   label: 'Medium',   color: 'text-yellow-400', border: 'border-yellow-500/20' },
    { count: scan.low_count,      label: 'Low',      color: 'text-blue-400',   border: 'border-blue-500/20'   },
  ];

  return (
    <div className="p-6 max-w-[1500px] mx-auto space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="btn-secondary inline-flex items-center gap-1.5 mb-3"
          type="button"
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
          <div className="relative flex items-center gap-2 shrink-0">
            {(scan.status === 'pending' || scan.status === 'running') && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="btn-warning inline-flex items-center gap-2"
                title="Stop this scan"
                type="button"
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
              className="btn-primary inline-flex items-center gap-2"
              title="Start a new scan with the same image and tag"
              type="button"
            >
              {reScanning
                ? <span className="w-3.5 h-3.5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                : <Refresh01Icon size={15} />}
              Re-scan
            </button>
            <Dropdown>
              <Dropdown.Trigger>
                <button
                  type="button"
                  className="btn-icon-subtle h-10 w-10"
                  style={shareOpen ? { color: '#a78bfa', borderColor: 'rgba(167,139,250,0.25)' } : undefined}
                  aria-label="Open scan actions"
                  title="More actions"
                >
                  <MoreVerticalIcon size={16} />
                </button>
              </Dropdown.Trigger>
              <Dropdown.Popover className="min-w-[220px]">
                <Dropdown.Menu onAction={(key) => {
                  if (key === 'export') {
                    window.open(`/reports/print?scans=${scan.id}`, '_blank', 'noopener,noreferrer');
                  }
                  if (key === 'compare') {
                    void handleComparePrev();
                  }
                  if (key === 'share') {
                    if (scan.share_visibility) setShareVisibility(scan.share_visibility as 'public' | 'authenticated');
                    setShareOpen(true);
                  }
                }}>
                  <Dropdown.Item id="export" textValue="Export scan report">
                    <div className="flex items-center gap-2">
                      <FileExportIcon size={15} />
                      <Label>Export</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="compare" textValue="Compare with previous scan" isDisabled={comparingPrev}>
                    <div className="flex items-center gap-2">
                      <GitCompareIcon size={15} />
                      <Label>{comparingPrev ? 'Compare…' : 'Compare'}</Label>
                    </div>
                  </Dropdown.Item>
                  <Dropdown.Item id="share" textValue="Manage scan sharing">
                    <div className="flex items-center gap-2">
                      <Share01Icon size={15} />
                      <Label>{scan.share_token ? 'Manage share' : 'Share'}</Label>
                    </div>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
            {shareOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} />
                <div className="absolute right-0 top-12 w-80 rounded-xl z-50 p-4 space-y-3"
                  style={{ background: 'var(--modal-bg)', border: '1px solid var(--modal-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-zinc-800 dark:text-white">Share scan</p>
                    <button className="btn-icon-subtle text-lg leading-none" onClick={() => setShareOpen(false)} type="button">✕</button>
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
                            className="btn-secondary shrink-0"
                            type="button"
                          >
                            {shareCopied ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs text-zinc-500">Change visibility</p>
                        <div className="segmented-control w-full">
                          {(['public', 'authenticated'] as const).map(v => (
                            <button key={v} onClick={() => setShareVisibility(v)}
                              className="segmented-control-item flex-1"
                              data-active={shareVisibility === v ? 'true' : 'false'}
                              data-size="sm"
                              type="button">
                              {v === 'public' ? 'Public' : 'Signed in'}
                            </button>
                          ))}
                        </div>
                        {shareVisibility !== scan.share_visibility && (
                          <button className="btn-primary w-full" disabled={shareLoading} onClick={handleEnableShare} type="button">
                            {shareLoading ? 'Updating…' : 'Update visibility'}
                          </button>
                        )}
                      </div>
                      <button className="btn-danger w-full" disabled={shareLoading} onClick={handleDisableShare} type="button">
                        {shareLoading ? 'Processing…' : 'Disable sharing'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <p className="text-xs text-zinc-500">Visibility</p>
                        <div className="segmented-control w-full">
                          {(['public', 'authenticated'] as const).map(v => (
                            <button key={v} onClick={() => setShareVisibility(v)}
                              className="segmented-control-item flex-1"
                              data-active={shareVisibility === v ? 'true' : 'false'}
                              data-size="sm"
                              type="button">
                              {v === 'public' ? 'Public' : 'Signed in'}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          {shareVisibility === 'public'
                            ? 'Anyone with the link can view this scan.'
                            : 'Only signed-in users can view this scan.'}
                        </p>
                      </div>
                      <button className="btn-primary w-full" disabled={shareLoading} onClick={handleEnableShare} type="button">
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

      {/* Status + severity cards */}
      {scan.status !== 'pending' && scan.status !== 'running' && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
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
          <div key={label} className={`glass-panel rounded-xl border ${border} p-4`}>
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{count ?? 0}</p>
          </div>
          ))}
        </div>
      )}

    {/* Scanner info moved to Details tab */}

      {/* Error banner — shown when scan failed */}
      {scan.status === 'failed' && scan.error_message && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-3"
          style={scan.external_status === 'blocked_by_xray_policy'
            ? { background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.22)' }
            : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.22)' }}
        >
          <svg
            className="shrink-0 mt-0.5"
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke={scan.external_status === 'blocked_by_xray_policy' ? '#f59e0b' : '#f87171'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div className="min-w-0">
            <p
              className="text-sm font-medium mb-0.5"
              style={{ color: scan.external_status === 'blocked_by_xray_policy' ? '#d97706' : '#dc2626' }}
            >
              {scan.external_status === 'blocked_by_xray_policy' ? 'Blocked by Xray policy' : 'Scan failed'}
            </p>
            {scan.external_status === 'blocked_by_xray_policy' && blockedPolicyDetails ? (
              <div className="space-y-1.5">
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{blockedPolicyDetails.summary}</p>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  See the Policy Violations tab for the matched issues, watches, policies, and raw JFrog response.
                </p>
              </div>
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-all font-mono leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{scan.error_message}</pre>
            )}
          </div>
        </div>
      )}

      {/* Tags + Compliance + Scanner info → moved to Details tab */}

      {/* Scanning animation */}
      {(scan.status === 'pending' || scan.status === 'running') && (
        <ScanningAnimation
          status={scan.status}
          startedAt={scan.started_at}
          image={`${scan.image_name}:${scan.image_tag}`}
          scanProvider={scan.scan_provider}
          currentStep={scan.current_step}
          stepLogs={scan.step_logs}
        />
      )}

      {/* Tab bar */}
      {scan.status !== 'pending' && scan.status !== 'running' && (
        <div className="w-full overflow-x-auto pb-1">
          <div className="segmented-control min-w-max">
            {([
              { id: 'vulns', label: vulnTotal ? `Vulnerabilities (${vulnTotal})` : 'Vulnerabilities' },
              ...(hasPolicyTab ? [{ id: 'policy' as const, label: blockedPolicyDetails?.totalViolations ? `Policy Violations (${blockedPolicyDetails.totalViolations})` : 'Policy Violations' }] : []),
              { id: 'sbom', label: sbomTotal ? `SBOM (${sbomTotal})` : 'SBOM' },
              { id: 'timeline', label: scan.step_logs?.length ? `Timeline (${scan.step_logs.length})` : 'Timeline' },
              { id: 'details', label: 'Details' },
            ] as { id: ScanTab; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="segmented-control-item"
                data-active={activeTab === id ? 'true' : 'false'}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'timeline' && (
        <ScanStepTimeline
          stepLogs={scan.step_logs}
          completedAt={scan.completed_at}
          status={scan.status}
          externalStatus={scan.external_status}
          scanProvider={scan.scan_provider}
        />
      )}

      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'policy' && blockedPolicyDetails && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Policy Violations</h2>
            <p className="text-sm text-zinc-500">
              Xray blocked this image by policy. When Xray also exposes artifact summary data, the normal Vulnerabilities tab can still be populated; this tab keeps the policy-specific context separate.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <DetailBlock label="Summary" value={blockedPolicyDetails.summary} />
            <DetailBlock label="Xray Violations" value={blockedPolicyDetails.totalViolations} />
            <DetailBlock label="Manifest" value={blockedPolicyDetails.manifest} mono />
            <DetailBlock label="Artifact" value={blockedPolicyDetails.artifact} mono />
            <DetailBlock label="Matched Issues" value={blockedPolicyDetails.matchedIssues} />
            <DetailBlock label="Matched Watches" value={blockedPolicyDetails.matchedWatches} />
            <DetailBlock label="Blocking Policies" value={blockedPolicyDetails.blockingPolicies} />
            <DetailBlock label="Matched Policies" value={blockedPolicyDetails.matchedPolicies} />
          </div>

          <DetailBlock label="JFrog Response" value={blockedPolicyDetails.jfrog} mono />
        </div>
      )}

      {/* SBOM tab */}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'sbom' && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              type="text"
              value={sbomNameInput}
              onChange={e => setSbomNameInput(e.target.value)}
              placeholder="Filter by name…"
              className={`${inputCls} min-w-0 md:flex-1`}
            />
            <Select selectedKey={sbomTypeFilter || '__all__'} onSelectionChange={k => { setSbomTypeFilter(String(k === '__all__' ? '' : k)); setSbomLoaded(false); }} className="min-w-0 md:w-56 md:flex-none">
              <Select.Trigger className={selectTriggerCls}>
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
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
        </div>
      )}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'vulns' && <div className="space-y-4">
        <div className="space-y-2.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
            Vulnerabilities
            {vulnTotal > 0 && <span className="text-sm font-normal text-zinc-500 ml-2">{vulnTotal} found</span>}
          </h2>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="w-full overflow-x-auto pb-1 xl:w-auto">
              <div className="segmented-control min-w-max">
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
                      className="segmented-control-item"
                      data-active={active ? 'true' : 'false'}
                      data-size="sm"
                      type="button"
                      style={active
                        ? { background: color ?? 'rgba(124,58,237,0.15)', color: activeColor ?? '#a78bfa', borderColor: border ?? 'rgba(167,139,250,0.3)' }
                        : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span>{label}</span>
                        {count > 0 && <span className="text-[11px] font-semibold opacity-70">{count}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 md:flex-row md:items-end xl:w-auto xl:justify-end">
              <input
                type="text"
                value={pkgInput}
                onChange={(e) => setPkgInput(e.target.value)}
                placeholder="Package…"
                className={`${inputCls} min-w-[220px] flex-1 md:min-w-[280px] xl:w-[320px] xl:flex-none`}
              />
              <div className="flex shrink-0 flex-col gap-1.5">
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
                  className={`${inputCls} w-full min-w-[5.5rem] md:w-24`}
                />
              </div>
              <button
                onClick={() => { setHasFix(!hasFix); setPage(1); }}
                className={`${hasFix ? 'btn-primary' : 'btn-secondary'} w-full shrink-0 md:w-auto`}
                type="button"
              >
                Has Fix
              </button>
            </div>
          </div>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
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
                      {scan.external_status === 'blocked_by_xray_policy'
                        ? 'No imported vulnerabilities are available because Xray blocked this artifact before the normal scan summary was produced. See the Policy Violations tab for the matched issues, watches, and policies.'
                        : 'No vulnerabilities found.'}
                    </td>
                  </tr>
                ) : vulns.map((v, i) => (
                  <Fragment key={v.id}>
                    <tr
                      style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                    <td className="px-4 py-3">
                      {v.vuln_id ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => openVulnerabilityDetails(v)}
                            className="font-mono text-xs text-violet-500 dark:text-violet-400 hover:text-violet-400 dark:hover:text-violet-300 hover:underline transition-colors"
                          >
                            {v.vuln_id}
                          </button>
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
                    <tr>
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
                                  <Select.Trigger className={selectTriggerCls}>
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
                                  className="btn-warning inline-flex shrink-0 items-center gap-1.5"
                                  type="button"
                                >
                                  {suppressSaving && <span className="w-3 h-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />}
                                  {v.suppression ? 'Update' : 'Suppress'}
                                </button>
                                {v.suppression && (
                                  <button
                                    onClick={() => handleLiftSuppression(v)}
                                    disabled={suppressSaving}
                                    className="btn-secondary shrink-0"
                                    type="button"
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
                                className="btn-primary shrink-0"
                                type="button"
                              >
                                Add Note
                              </button>
                            </div>
                          </div>

                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-500">{vulnTotal} total</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="btn-secondary"
                type="button"
              >
                ← Prev
              </button>
              <span className="text-sm text-zinc-500 px-2">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                className="btn-secondary"
                type="button"
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
          {(scan.trivy_version || scan.grype_version || scan.trivy_vuln_db_updated_at || scan.trivy_java_db_updated_at) && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Scanner</p>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="glass-panel rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">Scanner</p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">Trivy {scan.trivy_version || 'unknown'}</p>
                  {scan.grype_version && (
                    <p className="text-sm font-medium text-zinc-900 dark:text-white mt-1">Grype {scan.grype_version}</p>
                  )}
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

          {fullImageConfig && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Image metadata</p>

              <div className="grid gap-3 lg:grid-cols-3">
                <DetailBlock label="Created" value={imageCreated} />
                <DetailBlock label="Author" value={imageAuthor} />
                <DetailBlock label="Docker version" value={imageDockerVersion} />
                <DetailBlock label="User" value={imageUser} mono />
                <DetailBlock label="Working directory" value={imageWorkingDir} mono />
                <DetailBlock label="Entrypoint" value={imageEntrypoint.join(' ')} mono />
              </div>

              {imageCommand.length > 0 && (
                <DetailBlock label="Command" value={imageCommand.join(' ')} mono />
              )}

              <div className="grid gap-3 lg:grid-cols-3">
                <DetailBlock label="Environment variables" value={imageEnv.length > 0 ? `${imageEnv.length} captured` : '0 captured'} />
                <DetailBlock label="Labels" value={imageLabelEntries.length > 0 ? `${imageLabelEntries.length} captured` : '0 captured'} />
                <DetailBlock label="Exposed ports" value={imageExposedPorts.length > 0 ? imageExposedPorts.join(', ') : 'None declared'} mono={imageExposedPorts.length > 0} />
              </div>

              {imageVolumes.length > 0 && (
                <DetailBlock label="Declared volumes" value={imageVolumes.join(', ')} mono />
              )}

              {imageEnv.length > 0 && (
                <details className="glass-panel rounded-xl px-4 py-4">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Environment
                  </summary>
                  <pre className="mt-3 overflow-x-auto rounded-xl p-4 text-xs leading-6 text-zinc-700 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    {imageEnv.join('\n')}
                  </pre>
                </details>
              )}

              {imageLabelEntries.length > 0 && (
                <details className="glass-panel rounded-xl px-4 py-4">
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    Labels
                  </summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {imageLabelEntries.map(([key, value]) => (
                      <div key={key} className="rounded-xl p-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{key}</p>
                        <p className="mt-2 break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">{value || '—'}</p>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <details className="glass-panel rounded-xl px-4 py-4">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Raw image config
                </summary>
                <pre className="mt-3 overflow-x-auto rounded-xl p-4 text-xs leading-6 text-zinc-700 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                  {JSON.stringify(fullImageConfig, null, 2)}
                </pre>
              </details>
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

      <VulnerabilityDetailsModal
        vulnerability={selectedVulnerability}
        state={vulnerabilityDetailsModal}
        onClose={() => vulnerabilityDetailsModal.close()}
        loadContextAnalysis={(vulnerability) => getVulnerabilityContextAnalysis(id, vulnerability.id)}
      />
    </div>
  );
}
