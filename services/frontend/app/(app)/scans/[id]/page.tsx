'use client';
import { ScanDetailHeader } from '@/components/scans/scan-detail-header';
import { useToast } from '@/components/toast';
import {
  OwnershipBadge,
  SeverityBadge,
  SourceBadge,
  StatusBadge,
  SuppressionSourceBadge,
} from '@/components/ui/badges';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { ScanDetailSkeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import type {
  ComplianceResult,
  Org,
  ResourceShare,
  SBOMComponent,
  Scan,
  Suppression,
  Tag,
  Vulnerability,
  VulnerabilityViewPreferenceResponse,
  VulnerabilityViewSettings,
} from '@/lib/api';
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
  getScanVulnerabilityViewSettings,
  getTokenType,
  getUser,
  getVulnerabilityContextAnalysis,
  grantScanOrgAccess,
  listOrgs,
  listScanOrgGrants,
  listScans,
  listSuppressionShares,
  listTags,
  listVulnerabilities,
  reEvaluateCompliance,
  removeScanFromOrg,
  removeTagFromScan,
  reScan,
  resetScanVulnerabilityViewPreference,
  revokeScanOrgAccess,
  saveScanVulnerabilityViewPreference,
  shareSuppression,
  unshareSuppression,
  upsertSuppression,
} from '@/lib/api';
import { formatIgnoreRuleStatusLabel, getBlockedPolicyDetails } from '@/lib/blocked-policy';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Alert,
  Button,
  Calendar,
  Card,
  DateField,
  DatePicker,
  Dropdown,
  Label,
  ListBox,
  Modal,
  Select,
  Table,
  useOverlayState,
} from '@heroui/react';
import type { DateValue } from '@internationalized/date';
import { parseDate } from '@internationalized/date';
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Comment01Icon,
  CpuIcon,
  Delete01Icon,
  Delete02Icon,
  FileExportIcon,
  GitCompareIcon,
  MoreVerticalIcon,
  Refresh01Icon,
  Share01Icon,
  Shield01Icon,
  ShieldKeyIcon,
} from 'hugeicons-react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  ScannerDatabaseCard,
  ScanningAnimation,
  ScanStepTimeline,
} from '../../../../components/scans/scan-runtime';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

type ScanTab = 'vulns' | 'policy' | 'sbom' | 'details' | 'timeline';

const DEFAULT_VULNERABILITY_VIEW_SETTINGS: VulnerabilityViewSettings = {
  sort_by: 'severity',
  sort_dir: 'asc',
  severity: '',
  min_cvss: 0,
  has_fix: false,
};

const VULNERABILITY_SORT_LABELS: Record<VulnerabilityViewSettings['sort_by'], string> = {
  vuln_id: 'CVE ID',
  pkg_name: 'Package',
  severity: 'Severity',
  cvss_score: 'CVSS',
  installed_version: 'Installed',
  fixed_version: 'Fixed In',
};

function vulnerabilityViewSummary(settings: VulnerabilityViewSettings) {
  const filters = [
    settings.severity ? settings.severity : 'All severities',
    settings.min_cvss > 0 ? `CVSS >= ${settings.min_cvss}` : '',
    settings.has_fix ? 'Has fix' : '',
  ].filter(Boolean);
  return `${VULNERABILITY_SORT_LABELS[settings.sort_by]} ${settings.sort_dir === 'desc' ? 'descending' : 'ascending'} | ${filters.join(' | ')}`;
}

function vulnerabilityViewSettingsEqual(
  a: VulnerabilityViewSettings,
  b: VulnerabilityViewSettings
) {
  return (
    a.sort_by === b.sort_by &&
    a.sort_dir === b.sort_dir &&
    a.severity === b.severity &&
    a.min_cvss === b.min_cvss &&
    a.has_fix === b.has_fix
  );
}

function DetailBlock({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-2">{label}</p>
      <p
        className={
          mono
            ? 'text-xs font-mono text-zinc-700 dark:text-zinc-300 break-all leading-relaxed'
            : 'text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed'
        }
      >
        {value}
      </p>
    </div>
  );
}

function PolicyListSection({
  label,
  items,
  mono = false,
}: {
  label: string;
  items: string[];
  mono?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</p>
        <span
          className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
          style={{
            borderColor: 'var(--surface-border)',
            color: 'var(--text-secondary)',
            background: 'var(--app-bg)',
          }}
        >
          {items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item}
            className={`rounded-lg border px-3 py-2 text-sm leading-relaxed ${mono ? 'font-mono text-xs break-all' : ''}`}
            style={{
              borderColor: 'var(--surface-border)',
              color: 'var(--text-primary)',
              background: 'var(--app-bg)',
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchStatusBadge({
  status,
}: {
  status: 'active_ignore' | 'no_ignore' | 'status_unavailable';
}) {
  const palette =
    status === 'active_ignore'
      ? { color: '#b45309', background: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.26)' }
      : status === 'status_unavailable'
        ? { color: '#7c2d12', background: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.28)' }
        : {
            color: 'var(--text-secondary)',
            background: 'var(--app-bg)',
            border: 'var(--surface-border)',
          };

  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      style={{ color: palette.color, background: palette.background, borderColor: palette.border }}
    >
      {formatIgnoreRuleStatusLabel(status)}
    </span>
  );
}

function PolicyWatchList({
  watches,
}: {
  watches: Array<{
    name: string;
    ignoreRuleStatus: 'active_ignore' | 'no_ignore' | 'status_unavailable';
  }>;
}) {
  if (watches.length === 0) return null;

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
          Matched Watches
        </p>
        <span
          className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
          style={{
            borderColor: 'var(--surface-border)',
            color: 'var(--text-secondary)',
            background: 'var(--app-bg)',
          }}
        >
          {watches.length}
        </span>
      </div>
      <div className="space-y-2">
        {watches.map((watch) => (
          <div
            key={watch.name}
            className="flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderColor: 'var(--surface-border)', background: 'var(--app-bg)' }}
          >
            <span className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>
              {watch.name}
            </span>
            <WatchStatusBadge status={watch.ignoreRuleStatus} />
          </div>
        ))}
      </div>
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
  return Object.entries(record).map(
    ([key, entry]) => [key, String(entry ?? '').trim()] as [string, string]
  );
}

function FirstSeenBadge({ firstSeenAt }: { firstSeenAt?: string | null }) {
  if (!firstSeenAt) {
    return (
      <span
        className="text-xs font-semibold px-2 py-0.5 rounded-md"
        style={{ color: '#fb923c', background: 'rgba(249,115,22,0.12)' }}
      >
        New
      </span>
    );
  }
  return <span className="text-xs text-zinc-500">{timeAgo(firstSeenAt)}</span>;
}

const LIMIT = 25;

function isScanTab(value: string | null): value is ScanTab {
  return (
    value === 'vulns' ||
    value === 'policy' ||
    value === 'sbom' ||
    value === 'details' ||
    value === 'timeline'
  );
}

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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
  const [severityFilter, setSeverityFilter] = useState<VulnerabilityViewSettings['severity']>('');
  const [pkgFilter, setPkgFilter] = useState('');
  const [pkgInput, setPkgInput] = useState('');
  const [minCvss, setMinCvss] = useState(0);
  const [hasFix, setHasFix] = useState(false);
  const [sortBy, setSortBy] = useState<VulnerabilityViewSettings['sort_by']>('severity');
  const [sortDir, setSortDir] = useState<VulnerabilityViewSettings['sort_dir']>('asc');
  const [viewSettingsReady, setViewSettingsReady] = useState(false);
  const [viewPreference, setViewPreference] = useState<VulnerabilityViewPreferenceResponse | null>(
    null
  );
  const [viewPreferenceSaving, setViewPreferenceSaving] = useState(false);
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
  const loadScanInFlightRef = useRef<Promise<Scan> | null>(null);
  const defaultTabInitializedRef = useRef(false);
  const vulnerabilityViewInitializedRef = useRef(false);

  const [suppressStatus, setSuppressStatus] = useState<Suppression['status']>('accepted');
  const [suppressJustification, setSuppressJustification] = useState('');
  const [suppressExpiry, setSuppressExpiry] = useState<DateValue | null>(null);
  const [suppressSaving, setSuppressSaving] = useState(false);
  const [suppressError, setSuppressError] = useState('');
  const [scanOrgGrants, setScanOrgGrants] = useState<ResourceShare[]>([]);
  const [scanOrgGrantsLoading, setScanOrgGrantsLoading] = useState(false);
  const [scanOrgGrantsError, setScanOrgGrantsError] = useState('');
  const [scanOrgGrantOrgId, setScanOrgGrantOrgId] = useState('');
  const [scanOrgGrantSaving, setScanOrgGrantSaving] = useState(false);
  const [suppressionAccessTarget, setSuppressionAccessTarget] = useState<Suppression | null>(null);
  const [suppressionAccessShares, setSuppressionAccessShares] = useState<ResourceShare[]>([]);
  const [suppressionAccessLoading, setSuppressionAccessLoading] = useState(false);
  const [suppressionAccessError, setSuppressionAccessError] = useState('');
  const [suppressionAccessOrgId, setSuppressionAccessOrgId] = useState('');
  const [suppressionAccessSaving, setSuppressionAccessSaving] = useState(false);
  const vulnerabilityDetailsModal = useOverlayState();
  const scanAccessModal = useOverlayState();
  const suppressionAccessModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);

  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStatus = scan?.status;
  const blockedPolicyDetails = getBlockedPolicyDetails(
    scan?.external_status,
    scan?.blocked_policy_details,
    scan?.error_message
  );
  const hasPolicyTab = Boolean(blockedPolicyDetails);
  const currentVulnerabilityViewSettings: VulnerabilityViewSettings = {
    sort_by: sortBy,
    sort_dir: sortDir,
    severity: severityFilter,
    min_cvss: minCvss,
    has_fix: hasFix,
  };
  const effectiveVulnerabilityViewSettings =
    viewPreference?.settings ?? DEFAULT_VULNERABILITY_VIEW_SETTINGS;
  const vulnerabilityViewHasChanges =
    viewSettingsReady &&
    !vulnerabilityViewSettingsEqual(
      currentVulnerabilityViewSettings,
      effectiveVulnerabilityViewSettings
    );
  const vulnerabilityViewSourceLabel = viewPreference?.has_user_override
    ? 'My saved default'
    : viewPreference?.source === 'org'
      ? 'Organization default'
      : 'System default';

  const loadScan = useCallback(async () => {
    if (loadScanInFlightRef.current) {
      return loadScanInFlightRef.current;
    }

    const loadVersion = ++loadVersionRef.current;
    const request = getScan(id)
      .then((nextScan) => {
        if (loadVersion === loadVersionRef.current) {
          setScan(nextScan);
        }
        return nextScan;
      })
      .finally(() => {
        if (loadScanInFlightRef.current === request) {
          loadScanInFlightRef.current = null;
        }
      });

    loadScanInFlightRef.current = request;
    return request;
  }, [id]);

  const applyVulnerabilityViewPreference = useCallback(
    (preference: VulnerabilityViewPreferenceResponse) => {
      setViewPreference(preference);
      setSeverityFilter(preference.settings.severity);
      setMinCvss(preference.settings.min_cvss);
      setHasFix(preference.settings.has_fix);
      setSortBy(preference.settings.sort_by);
      setSortDir(preference.settings.sort_dir);
      setPage(1);
    },
    []
  );

  useEffect(() => {
    defaultTabInitializedRef.current = false;
    vulnerabilityViewInitializedRef.current = false;
    setActiveTab('vulns');
    setViewSettingsReady(false);
    setViewPreference(null);
    setSeverityFilter('');
    setMinCvss(0);
    setHasFix(false);
    setSortBy('severity');
    setSortDir('asc');
    setPage(1);
  }, [id]);

  // Initial load
  useEffect(() => {
    loadScan()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    listTags()
      .then(setAllTags)
      .catch(() => {});
    getScanCompliance(id)
      .then(setCompliance)
      .catch(() => {});
    listOrgs()
      .then(setAllOrgs)
      .catch(() => {});
  }, [id, loadScan]);

  useConditionalInterval(
    () => {
      void loadScan()
        .then((nextScan) => {
          if (nextScan.status === 'completed' || nextScan.status === 'failed') {
            void getScanCompliance(id)
              .then(setCompliance)
              .catch(() => {});
          }
        })
        .catch(() => {});
    },
    scanStatus === 'pending' || scanStatus === 'running',
    3000
  );

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

    const requestedTab = searchParams.get('tab');
    if (isScanTab(requestedTab) && (requestedTab !== 'policy' || blockedPolicyDetails)) {
      setActiveTab(requestedTab);
      defaultTabInitializedRef.current = true;
      return;
    }

    defaultTabInitializedRef.current = true;
  }, [blockedPolicyDetails, scan, searchParams]);

  useEffect(() => {
    if (!scan) return;
    if (scan.status === 'pending' || scan.status === 'running') {
      setViewSettingsReady(true);
      return;
    }
    if (vulnerabilityViewInitializedRef.current) return;

    let cancelled = false;
    setViewSettingsReady(false);
    getScanVulnerabilityViewSettings(id)
      .then((preference) => {
        if (cancelled) return;
        applyVulnerabilityViewPreference(preference);
        vulnerabilityViewInitializedRef.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        setViewPreference({
          settings: DEFAULT_VULNERABILITY_VIEW_SETTINGS,
          source: 'system',
          scope_type: 'personal',
          scope_ref: '',
          has_user_override: false,
        });
        vulnerabilityViewInitializedRef.current = true;
      })
      .finally(() => {
        if (!cancelled) setViewSettingsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [applyVulnerabilityViewPreference, id, scan?.id, scan?.status]);

  useEffect(() => {
    if (!scan || scan.status === 'pending' || scan.status === 'running') return;
    if (!defaultTabInitializedRef.current) return;

    const requestedTab = searchParams.get('tab');
    const nextTab = activeTab === 'vulns' ? null : activeTab;
    if (requestedTab === nextTab || (!requestedTab && !nextTab)) return;

    const params = new URLSearchParams(searchParams.toString());
    if (nextTab) {
      params.set('tab', nextTab);
    } else {
      params.delete('tab');
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [activeTab, pathname, router, scan, searchParams]);

  useEffect(() => {
    if (!vulnerabilityDetailsModal.isOpen) {
      setSelectedVulnerability(null);
    }
  }, [vulnerabilityDetailsModal.isOpen]);

  // Reset suppress form when expanded vuln changes
  useEffect(() => {
    const v = vulns.find((v) => v.id === expandedVuln);
    setSuppressError('');
    if (v?.suppression) {
      setSuppressStatus(v.suppression.status);
      setSuppressJustification(v.suppression.justification);
      setSuppressExpiry(
        v.suppression.expires_at ? parseDate(v.suppression.expires_at.slice(0, 10)) : null
      );
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
    return () => {
      if (sbomDebounceRef.current) clearTimeout(sbomDebounceRef.current);
    };
  }, [sbomNameInput]);

  // Load SBOM when tab is first opened
  useEffect(() => {
    if (activeTab !== 'sbom' || sbomLoaded || !scan || scan.status !== 'completed') return;
    setSbomLoading(true);
    getScanSBOM(id, sbomNameFilter || undefined, sbomTypeFilter || undefined)
      .then((res) => {
        setSbomComponents(res.data ?? []);
        setSbomTotal(res.total);
        setSbomLoaded(true);
      })
      .catch(() => {})
      .finally(() => setSbomLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, scan?.status]);

  // Reload SBOM when filters change (after first load)
  useEffect(() => {
    if (!sbomLoaded) return;
    setSbomLoading(true);
    getScanSBOM(id, sbomNameFilter || undefined, sbomTypeFilter || undefined)
      .then((res) => {
        setSbomComponents(res.data ?? []);
        setSbomTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setSbomLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbomNameFilter, sbomTypeFilter]);

  function loadVulns() {
    if (!scan || scan.status === 'pending' || scan.status === 'running' || !viewSettingsReady)
      return;
    setVulnLoading(true);
    listVulnerabilities(
      id,
      page,
      LIMIT,
      severityFilter || undefined,
      pkgFilter || undefined,
      hasFix || undefined,
      minCvss || undefined,
      sortBy,
      sortDir
    )
      .then((res) => {
        setVulns(res.data ?? []);
        setVulnTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setVulnLoading(false));
  }

  useEffect(() => {
    loadVulns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    scan,
    page,
    severityFilter,
    pkgFilter,
    minCvss,
    hasFix,
    sortBy,
    sortDir,
    viewSettingsReady,
  ]);

  async function saveVulnerabilityViewPreference() {
    if (!viewSettingsReady) return;
    setViewPreferenceSaving(true);
    try {
      const preference = await saveScanVulnerabilityViewPreference(
        id,
        currentVulnerabilityViewSettings
      );
      applyVulnerabilityViewPreference(preference);
      toast.success('Default vulnerability view saved');
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save vulnerability view preference'
      );
    } finally {
      setViewPreferenceSaving(false);
    }
  }

  async function resetVulnerabilityViewPreference() {
    if (!viewSettingsReady) return;
    setViewPreferenceSaving(true);
    try {
      const preference = await resetScanVulnerabilityViewPreference(id);
      applyVulnerabilityViewPreference(preference);
      toast.success('Default vulnerability view reset');
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to reset vulnerability view preference'
      );
    } finally {
      setViewPreferenceSaving(false);
    }
  }

  async function toggleTag(tag: Tag) {
    if (!scan) return;
    const has = (scan.tags ?? []).some((t) => t.id === tag.id);
    setTagLoading(tag.id);
    try {
      if (has) {
        await removeTagFromScan(id, tag.id);
        setScan((prev) => {
          if (!prev) return prev;
          return { ...prev, tags: (prev.tags ?? []).filter((t) => t.id !== tag.id) };
        });
      } else {
        await addTagToScan(id, tag.id);
        setScan((prev) => {
          if (!prev) return prev;
          return { ...prev, tags: [...(prev.tags ?? []), tag] };
        });
      }
    } catch {
      /* ignore */
    } finally {
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
    } catch {
      /* ignore */
    } finally {
      setCommentSaving(false);
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await deleteComment(commentId);
      loadVulns();
    } catch {
      /* ignore */
    }
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
      setScan((current) =>
        current
          ? {
              ...current,
              status: result.status ?? 'cancelled',
              current_step: result.current_step ?? 'cancelled',
              external_status: result.external_status ?? 'cancelled',
              completed_at: result.completed_at ?? new Date().toISOString(),
              error_message: result.error_message ?? 'Cancelled by user',
            }
          : current
      );
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
      setScan((s) =>
        s ? { ...s, share_token: result.share_token, share_visibility: result.share_visibility } : s
      );
    } catch {
      /* ignore */
    } finally {
      setShareLoading(false);
    }
  }

  async function handleDisableShare() {
    if (!scan) return;
    setShareLoading(true);
    try {
      await deleteShare(scan.id);
      setScan((s) => (s ? { ...s, share_token: undefined, share_visibility: undefined } : s));
    } catch {
      /* ignore */
    } finally {
      setShareLoading(false);
    }
  }

  async function handleComparePrev() {
    if (!scan) return;
    setComparingPrev(true);
    try {
      const res = await listScans(1, 5, scan.image_name);
      const prev = (res.data ?? []).find((s) => s.id !== scan.id);
      if (prev) router.push(`/scans/compare?a=${prev.id}&b=${scan.id}`);
    } catch {
      /* ignore */
    } finally {
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
        org_id: scan.owner_type === 'org' ? (scan.owner_org_id ?? undefined) : undefined,
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
    if (vuln.suppression?.read_only || vuln.suppression?.source === 'xray') return;
    setSuppressSaving(true);
    setSuppressError('');
    try {
      await deleteSuppression(
        scan.image_digest,
        vuln.vuln_id,
        scan.owner_type === 'org' ? (scan.owner_org_id ?? undefined) : undefined
      );
      loadVulns();
    } catch (e: unknown) {
      setSuppressError(e instanceof Error ? e.message : 'Failed to lift suppression');
    } finally {
      setSuppressSaving(false);
    }
  }

  function canManageScanAccess() {
    if (isPlatformAdmin) return true;
    if (scan?.owner_type === 'org' && scan.owner_org_id) {
      return manageableOrgIds.has(scan.owner_org_id);
    }
    return true;
  }

  async function loadScanOrgGrantState() {
    if (!scan) return;
    setScanOrgGrantsLoading(true);
    setScanOrgGrantsError('');
    try {
      setScanOrgGrants(await listScanOrgGrants(scan.id));
    } catch (err: unknown) {
      setScanOrgGrantsError(
        err instanceof Error ? err.message : 'Failed to load scan access grants'
      );
    } finally {
      setScanOrgGrantsLoading(false);
    }
  }

  function openScanAccessModal() {
    setScanOrgGrantOrgId('');
    setScanOrgGrantsError('');
    scanAccessModal.open();
    void loadScanOrgGrantState();
  }

  async function handleGrantScanAccess() {
    if (!scan || !scanOrgGrantOrgId) return;
    setScanOrgGrantSaving(true);
    setScanOrgGrantsError('');
    try {
      await grantScanOrgAccess(scan.id, scanOrgGrantOrgId);
      toast.success('Scan access granted');
      setScanOrgGrantOrgId('');
      await loadScanOrgGrantState();
    } catch (err: unknown) {
      setScanOrgGrantsError(err instanceof Error ? err.message : 'Failed to grant scan access');
    } finally {
      setScanOrgGrantSaving(false);
    }
  }

  async function handleRevokeScanAccess(orgId: string) {
    if (!scan) return;
    setScanOrgGrantSaving(true);
    setScanOrgGrantsError('');
    try {
      await revokeScanOrgAccess(scan.id, orgId);
      toast.success('Scan access revoked');
      await loadScanOrgGrantState();
    } catch (err: unknown) {
      setScanOrgGrantsError(err instanceof Error ? err.message : 'Failed to revoke scan access');
    } finally {
      setScanOrgGrantSaving(false);
    }
  }

  function canManageSuppressionAccess(suppression?: Suppression | null) {
    if (
      !suppression ||
      suppression.read_only ||
      suppression.source === 'xray' ||
      suppression.owner_type === 'system'
    )
      return false;
    if (isPlatformAdmin) return true;
    if (suppression.owner_type === 'org' && suppression.owner_org_id) {
      return manageableOrgIds.has(suppression.owner_org_id);
    }
    return true;
  }

  async function loadSuppressionAccessShares(suppressionId: string) {
    setSuppressionAccessLoading(true);
    setSuppressionAccessError('');
    try {
      setSuppressionAccessShares(await listSuppressionShares(suppressionId));
    } catch (err: unknown) {
      setSuppressionAccessError(
        err instanceof Error ? err.message : 'Failed to load access grants'
      );
    } finally {
      setSuppressionAccessLoading(false);
    }
  }

  function openSuppressionAccess(suppression: Suppression) {
    setSuppressionAccessTarget(suppression);
    setSuppressionAccessShares([]);
    setSuppressionAccessOrgId('');
    setSuppressionAccessError('');
    suppressionAccessModal.open();
    void loadSuppressionAccessShares(suppression.id);
  }

  async function handleGrantSuppressionAccess() {
    if (!suppressionAccessTarget || !suppressionAccessOrgId) return;
    setSuppressionAccessSaving(true);
    setSuppressionAccessError('');
    try {
      await shareSuppression(suppressionAccessTarget.id, suppressionAccessOrgId);
      toast.success('Suppression access granted');
      setSuppressionAccessOrgId('');
      await loadSuppressionAccessShares(suppressionAccessTarget.id);
    } catch (err: unknown) {
      setSuppressionAccessError(err instanceof Error ? err.message : 'Failed to grant access');
    } finally {
      setSuppressionAccessSaving(false);
    }
  }

  async function handleRevokeSuppressionAccess(orgId: string) {
    if (!suppressionAccessTarget) return;
    setSuppressionAccessSaving(true);
    setSuppressionAccessError('');
    try {
      await unshareSuppression(suppressionAccessTarget.id, orgId);
      toast.success('Suppression access revoked');
      await loadSuppressionAccessShares(suppressionAccessTarget.id);
    } catch (err: unknown) {
      setSuppressionAccessError(err instanceof Error ? err.message : 'Failed to revoke access');
    } finally {
      setSuppressionAccessSaving(false);
    }
  }

  function openVulnerabilityDetails(vulnerability: Vulnerability) {
    setSelectedVulnerability(vulnerability);
    vulnerabilityDetailsModal.open();
  }

  if (loading) return <ScanDetailSkeleton />;

  if (error)
    return (
      <div className="p-6">
        <div
          className="rounded-xl px-4 py-3 text-sm"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.18)',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      </div>
    );

  if (!scan) return null;

  const totalPages = Math.max(1, Math.ceil(vulnTotal / LIMIT));
  const currentUser = getUser();
  const isPlatformAdmin = getTokenType() === 'admin' || currentUser?.role === 'admin';
  const orgNamesById = Object.fromEntries(allOrgs.map((org) => [org.id, org.name]));
  const manageableOrgIds = new Set(
    allOrgs
      .filter((org) => org.current_user_role === 'owner' || org.current_user_role === 'admin')
      .map((org) => org.id)
  );
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
  const imageExposedPorts = imageConfigEntries(runtimeImageConfig?.['ExposedPorts']).map(
    ([port]) => port
  );
  const imageVolumes = imageConfigEntries(runtimeImageConfig?.['Volumes']).map(
    ([volume]) => volume
  );
  const availableScanGrantTargets = allOrgs.filter(
    (org) =>
      (isPlatformAdmin || manageableOrgIds.has(org.id)) &&
      org.id !== scan.owner_org_id &&
      !scanOrgGrants.some((share) => share.org_id === org.id)
  );
  const availableSuppressionShareTargets = suppressionAccessTarget
    ? allOrgs.filter(
        (org) =>
          (isPlatformAdmin || manageableOrgIds.has(org.id)) &&
          org.id !== suppressionAccessTarget.owner_org_id &&
          !suppressionAccessShares.some((share) => share.org_id === org.id)
      )
    : [];

  const sevCards = [
    {
      count: scan.critical_count,
      label: 'Critical',
      color: 'text-red-400',
      border: 'border-red-500/20',
    },
    {
      count: scan.high_count,
      label: 'High',
      color: 'text-orange-400',
      border: 'border-orange-500/20',
    },
    {
      count: scan.medium_count,
      label: 'Medium',
      color: 'text-yellow-400',
      border: 'border-yellow-500/20',
    },
    { count: scan.low_count, label: 'Low', color: 'text-blue-400', border: 'border-blue-500/20' },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Scan details"
        breadcrumbs={[{ label: 'Scans', href: '/scans' }, { label: 'Scan details' }]}
      />

      {/* Header */}
      <ScanDetailHeader
        badges={
          <OwnershipBadge
            ownerType={scan.owner_type}
            ownerOrgId={scan.owner_org_id}
            orgNamesById={orgNamesById}
          />
        }
        navigation={
          <Button className="btn-secondary" onPress={() => router.back()} variant="secondary">
            <ArrowLeft01Icon size={15} />
            Back to scans
          </Button>
        }
        title={`${scan.image_name}:${scan.image_tag}`}
        subtitle={scan.image_digest ? <span>{scan.image_digest}</span> : undefined}
        meta={
          <>
            {scan.architecture && (
              <p className="flex items-center gap-1.5 text-xs text-zinc-500 mt-1">
                <CpuIcon size={12} />
                {scan.architecture} · {scan.os_family} {scan.os_name}
              </p>
            )}
            {scan.helm_chart && (
              <p
                className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500"
                title={scan.helm_source_path}
              >
                <span className="font-medium text-violet-400">Helm</span>
                <span
                  className="max-w-full font-mono break-words"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {scan.helm_chart}
                </span>
                {scan.helm_source_path && (
                  <span className="text-zinc-400 break-words" style={{ overflowWrap: 'anywhere' }}>
                    · {scan.helm_source_path}
                  </span>
                )}
              </p>
            )}
            <p className="mt-1 text-xs text-zinc-500">
              Workspace:{' '}
              {scan.owner_type === 'org' && scan.owner_org_id
                ? (orgNamesById[scan.owner_org_id] ?? 'Org workspace')
                : 'Personal'}
            </p>
          </>
        }
        actions={
          <div className="relative flex flex-wrap items-center gap-2">
            {(scan.status === 'pending' || scan.status === 'running') && (
              <Button
                className="btn-warning"
                isDisabled={cancelling}
                onPress={handleCancel}
                variant="secondary"
              >
                {cancelling ? (
                  <span className="size-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                ) : (
                  <Cancel01Icon size={15} />
                )}
                Cancel
              </Button>
            )}
            <Button
              className="btn-primary"
              isDisabled={reScanning || scan.status === 'running' || scan.status === 'pending'}
              onPress={handleReScan}
              variant="primary"
            >
              {reScanning ? (
                <span className="size-3.5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
              ) : (
                <Refresh01Icon size={15} />
              )}
              Re-scan
            </Button>
            <Button
              className="btn-secondary"
              onPress={() =>
                router.push(`/assistant?scopeType=scan&scopeRef=${encodeURIComponent(scan.id)}`)
              }
              variant="secondary"
            >
              Ask AI
            </Button>
            {canManageScanAccess() && (
              <Button className="btn-secondary" onPress={openScanAccessModal} variant="secondary">
                <Shield01Icon size={15} />
                Manage Access
              </Button>
            )}
            <div className="relative">
              <Dropdown>
                <Dropdown.Trigger>
                  <Button
                    aria-label="Open scan actions"
                    className="btn-icon-subtle size-10"
                    isIconOnly
                    style={
                      shareOpen
                        ? { color: '#a78bfa', borderColor: 'rgba(167,139,250,0.25)' }
                        : undefined
                    }
                    variant="secondary"
                  >
                    <MoreVerticalIcon size={16} />
                  </Button>
                </Dropdown.Trigger>
                <Dropdown.Popover className="min-w-[220px]">
                  <Dropdown.Menu
                    onAction={(key) => {
                      if (key === 'export') {
                        window.open(
                          `/reports/print?scans=${scan.id}`,
                          '_blank',
                          'noopener,noreferrer'
                        );
                      }
                      if (key === 'compare') {
                        void handleComparePrev();
                      }
                      if (key === 'share') {
                        if (scan.share_visibility)
                          setShareVisibility(scan.share_visibility as 'public' | 'authenticated');
                        setShareOpen(true);
                      }
                    }}
                  >
                    <Dropdown.Item id="export" textValue="Export scan report">
                      <div className="flex items-center gap-2">
                        <FileExportIcon size={15} />
                        <Label>Export</Label>
                      </div>
                    </Dropdown.Item>
                    <Dropdown.Item
                      id="compare"
                      textValue="Compare with previous scan"
                      isDisabled={comparingPrev}
                    >
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
                  <div
                    className="absolute right-0 top-12 w-80 rounded-xl z-50 p-4 space-y-3"
                    style={{
                      background: 'var(--modal-bg)',
                      border: '1px solid var(--modal-border)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-800 dark:text-white">
                        Share scan
                      </p>
                      <Button
                        className="btn-icon-subtle text-lg leading-none"
                        onPress={() => setShareOpen(false)}
                        type="button"
                        variant="secondary"
                      >
                        ✕
                      </Button>
                    </div>
                    {scan.share_token ? (
                      <>
                        <div>
                          <p className="text-xs text-zinc-500 mb-1.5">
                            Share link
                            <span
                              className="ml-1.5 px-1.5 py-0.5 rounded text-xs font-medium"
                              style={{
                                background:
                                  scan.share_visibility === 'public'
                                    ? 'rgba(34,197,94,0.1)'
                                    : 'rgba(124,58,237,0.1)',
                                color: scan.share_visibility === 'public' ? '#4ade80' : '#a78bfa',
                                border: `1px solid ${scan.share_visibility === 'public' ? 'rgba(34,197,94,0.2)' : 'rgba(124,58,237,0.2)'}`,
                              }}
                            >
                              {scan.share_visibility}
                            </span>
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-lg px-2 py-1.5 truncate">
                              {typeof window !== 'undefined'
                                ? `${window.location.origin}/shared/${scan.share_token}`
                                : ''}
                            </code>
                            <Button
                              onPress={() => {
                                navigator.clipboard.writeText(
                                  `${window.location.origin}/shared/${scan.share_token}`
                                );
                                setShareCopied(true);
                                setTimeout(() => setShareCopied(false), 1500);
                              }}
                              className="btn-secondary shrink-0"
                              type="button"
                              variant="secondary"
                            >
                              {shareCopied ? '✓ Copied' : 'Copy'}
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-xs text-zinc-500">Change visibility</p>
                          <SegmentedControl
                            ariaLabel="Share visibility"
                            className="w-full"
                            itemClassName="flex-1"
                            options={[
                              { id: 'public', label: 'Public' },
                              { id: 'authenticated', label: 'Signed in' },
                            ]}
                            value={shareVisibility}
                            onChange={setShareVisibility}
                            size="sm"
                          />
                          {shareVisibility !== scan.share_visibility && (
                            <Button
                              className="btn-primary w-full"
                              isDisabled={shareLoading}
                              onPress={handleEnableShare}
                              type="button"
                              variant="primary"
                            >
                              {shareLoading ? 'Updating…' : 'Update visibility'}
                            </Button>
                          )}
                        </div>
                        <Button
                          className="btn-danger w-full"
                          isDisabled={shareLoading}
                          onPress={handleDisableShare}
                          type="button"
                          variant="danger"
                        >
                          {shareLoading ? 'Processing…' : 'Disable sharing'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <p className="text-xs text-zinc-500">Visibility</p>
                          <SegmentedControl
                            ariaLabel="Share visibility"
                            className="w-full"
                            itemClassName="flex-1"
                            options={[
                              { id: 'public', label: 'Public' },
                              { id: 'authenticated', label: 'Signed in' },
                            ]}
                            value={shareVisibility}
                            onChange={setShareVisibility}
                            size="sm"
                          />
                          <p className="text-xs text-zinc-400 leading-relaxed">
                            {shareVisibility === 'public'
                              ? 'Anyone with the link can view this scan.'
                              : 'Only signed-in users can view this scan.'}
                          </p>
                        </div>
                        <Button
                          className="btn-primary w-full"
                          isDisabled={shareLoading}
                          onPress={handleEnableShare}
                          type="button"
                          variant="primary"
                        >
                          {shareLoading ? 'Creating link…' : 'Create share link'}
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        }
      />

      {/* Status + severity cards */}
      {scan.status !== 'pending' && scan.status !== 'running' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard
            label="Status"
            value={<StatusBadge status={scan.status} externalStatus={scan.external_status} />}
            className="col-span-2 md:col-span-1"
            valueClassName="text-sm font-semibold"
          />
          {sevCards.map(({ label, count, color, border }) => (
            <StatCard
              key={label}
              label={label}
              value={count ?? 0}
              className={`border ${border}`}
              valueClassName={`text-xl font-semibold tabular-nums ${color}`}
            />
          ))}
        </div>
      )}

      {/* Scanner info moved to Details tab */}

      {/* Error banner - shown when scan failed */}
      {scan.status === 'failed' && scan.error_message && (
        <Alert status="danger" className="border border-danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {scan.external_status === 'blocked_by_xray_policy'
                ? 'Blocked by Xray policy'
                : 'Scan failed'}
            </Alert.Title>
            <Alert.Description>
              {scan.external_status === 'blocked_by_xray_policy' && blockedPolicyDetails ? (
                <div className="space-y-1.5">
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {blockedPolicyDetails.summary}
                  </p>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    See the Policy Violations tab for the matched issues, watches, policies, and raw
                    JFrog response.
                  </p>
                </div>
              ) : (
                <pre
                  className="text-xs whitespace-pre-wrap break-all font-mono leading-relaxed"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {scan.error_message}
                </pre>
              )}
            </Alert.Description>
            <Button className="mt-2 sm:hidden" size="sm" variant="primary">
              Refresh
            </Button>
          </Alert.Content>
        </Alert>
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
          <SegmentedControl
            ariaLabel="Scan detail tabs"
            className="min-w-max"
            options={
              [
                {
                  id: 'vulns',
                  label: vulnTotal ? `Vulnerabilities (${vulnTotal})` : 'Vulnerabilities',
                },
                ...(hasPolicyTab
                  ? [
                      {
                        id: 'policy' as const,
                        label: blockedPolicyDetails?.totalViolations
                          ? `Policy Violations (${blockedPolicyDetails.totalViolations})`
                          : 'Policy Violations',
                      },
                    ]
                  : []),
                { id: 'sbom', label: sbomTotal ? `SBOM (${sbomTotal})` : 'SBOM' },
                {
                  id: 'timeline',
                  label: scan.step_logs?.length
                    ? `Timeline (${scan.step_logs.length})`
                    : 'Timeline',
                },
                { id: 'details', label: 'Details' },
              ] as { id: ScanTab; label: string }[]
            }
            value={activeTab}
            onChange={setActiveTab}
          />
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

      {scan.status !== 'pending' &&
        scan.status !== 'running' &&
        activeTab === 'policy' &&
        blockedPolicyDetails && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                Policy Violations
              </h2>
              <p className="text-sm text-zinc-500">
                Xray blocked this image by policy. When Xray also exposes artifact summary data, the
                normal Vulnerabilities tab can still be populated; this tab keeps the
                policy-specific context separate.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <DetailBlock label="Summary" value={blockedPolicyDetails.summary} />
              <DetailBlock
                label="Xray Violations"
                value={
                  blockedPolicyDetails.totalViolations
                    ? String(blockedPolicyDetails.totalViolations)
                    : undefined
                }
              />
              <DetailBlock label="Manifest" value={blockedPolicyDetails.manifest} mono />
              <DetailBlock label="Artifact" value={blockedPolicyDetails.artifact} mono />
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
              <PolicyWatchList watches={blockedPolicyDetails.matchedWatches} />
              <div className="space-y-3">
                <PolicyListSection
                  label="Blocking Policies"
                  items={blockedPolicyDetails.blockingPolicies}
                />
                <PolicyListSection
                  label="Matched Policies"
                  items={blockedPolicyDetails.matchedPolicies}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <PolicyListSection
                label="Matched Issues"
                items={blockedPolicyDetails.matchedIssues}
              />
              <DetailBlock label="JFrog Response" value={blockedPolicyDetails.jfrog} mono />
            </div>
          </div>
        )}

      {/* SBOM tab */}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'sbom' && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <FormField
              hideLabel
              label="Filter components by name"
              type="text"
              value={sbomNameInput}
              onChange={(e) => setSbomNameInput(e.target.value)}
              placeholder="Filter by name..."
              className="min-w-0 md:flex-1"
              containerClassName="min-w-0 md:flex-1"
            />
            <Select
              value={sbomTypeFilter || '__all__'}
              onChange={(value) => {
                setSbomTypeFilter(String(value === '__all__' ? '' : (value ?? '')));
                setSbomLoaded(false);
              }}
              className="min-w-0 md:w-56 md:flex-none"
            >
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
          <Card className="surface-panel rounded-2xl overflow-hidden">
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="SBOM components" className="min-w-[860px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Name</Table.Column>
                    <Table.Column>Version</Table.Column>
                    <Table.Column>Type</Table.Column>
                    <Table.Column>License</Table.Column>
                    <Table.Column>Package URL</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {sbomLoading || sbomComponents.length === 0 ? (
                      <Table.Row key="sbom-state" id="sbom-state">
                        <Table.Cell colSpan={5}>
                          {sbomLoading ? (
                            <div className="py-12 text-center">
                              <div className="flex justify-center">
                                <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                              </div>
                            </div>
                          ) : (
                            <div className="py-12 text-center text-sm text-zinc-500">
                              No SBOM components found for this scan.
                            </div>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      sbomComponents.map((c) => (
                        <Table.Row key={c.id} id={c.id} className="hover:bg-[var(--row-hover)]">
                          <Table.Cell className="font-mono text-xs text-zinc-700 dark:text-zinc-200">
                            {c.name}
                          </Table.Cell>
                          <Table.Cell className="font-mono text-xs text-zinc-500">
                            {c.version || '-'}
                          </Table.Cell>
                          <Table.Cell>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{
                                background: 'var(--row-hover)',
                                border: '1px solid var(--surface-border)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {c.type}
                            </span>
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {c.license || '-'}
                          </Table.Cell>
                          <Table.Cell className="font-mono text-xs text-zinc-400 max-w-xs truncate">
                            <span title={c.package_url}>{c.package_url || '-'}</span>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>
        </div>
      )}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'vulns' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
              Vulnerabilities
              {vulnTotal > 0 && (
                <span className="text-sm font-normal text-zinc-500 ml-2">{vulnTotal} found</span>
              )}
            </h2>
            <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
              <div className="w-full overflow-x-auto pb-1 lg:w-auto lg:max-w-full lg:shrink-0 lg:pb-0">
                <SegmentedControl
                  ariaLabel="Severity filters"
                  className="min-w-max"
                  options={(
                    [
                      {
                        id: '',
                        label: 'All',
                        count:
                          (scan.critical_count ?? 0) +
                          (scan.high_count ?? 0) +
                          (scan.medium_count ?? 0) +
                          (scan.low_count ?? 0),
                      },
                      {
                        id: 'CRITICAL',
                        label: 'Critical',
                        count: scan.critical_count ?? 0,
                        color: 'rgba(239,68,68,0.15)',
                        activeColor: '#f87171',
                        border: 'rgba(239,68,68,0.3)',
                      },
                      {
                        id: 'HIGH',
                        label: 'High',
                        count: scan.high_count ?? 0,
                        color: 'rgba(249,115,22,0.15)',
                        activeColor: '#fb923c',
                        border: 'rgba(249,115,22,0.3)',
                      },
                      {
                        id: 'MEDIUM',
                        label: 'Medium',
                        count: scan.medium_count ?? 0,
                        color: 'rgba(234,179,8,0.15)',
                        activeColor: '#facc15',
                        border: 'rgba(234,179,8,0.3)',
                      },
                      {
                        id: 'LOW',
                        label: 'Low',
                        count: scan.low_count ?? 0,
                        color: 'rgba(59,130,246,0.15)',
                        activeColor: '#60a5fa',
                        border: 'rgba(59,130,246,0.3)',
                      },
                    ] as {
                      id: VulnerabilityViewSettings['severity'];
                      label: string;
                      count: number;
                      color?: string;
                      activeColor?: string;
                      border?: string;
                    }[]
                  ).map((option) => ({
                    id: option.id,
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{option.label}</span>
                        {option.count > 0 && (
                          <span className="text-[11px] font-semibold opacity-70">
                            {option.count}
                          </span>
                        )}
                      </span>
                    ),
                    color: option.color,
                    activeColor: option.activeColor,
                    border: option.border,
                  }))}
                  value={severityFilter}
                  onChange={(next) => {
                    setSeverityFilter(next);
                    setPage(1);
                  }}
                  size="sm"
                  getItemStyle={(option, active) => {
                    if (!active) {
                      return undefined;
                    }
                    const withPalette = option as {
                      color?: string;
                      activeColor?: string;
                      border?: string;
                    };
                    return {
                      background: withPalette.color ?? 'rgba(124,58,237,0.15)',
                      color: withPalette.activeColor ?? '#a78bfa',
                      borderColor: withPalette.border ?? 'rgba(167,139,250,0.3)',
                    };
                  }}
                />
              </div>
              <div className="flex w-full flex-col gap-2 md:flex-row md:items-center lg:w-auto lg:min-w-0 lg:flex-1 lg:justify-end">
                <FormField
                  hideLabel
                  label="Filter by package"
                  type="text"
                  value={pkgInput}
                  onChange={(e) => setPkgInput(e.target.value)}
                  placeholder="Package..."
                  className="min-w-[220px] flex-1 md:min-w-[280px] lg:max-w-[360px]"
                  containerClassName="min-w-[220px] flex-1 md:min-w-[280px] lg:max-w-[360px]"
                />
                <FormField
                  hideLabel
                  label="Minimum CVSS"
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={minCvss || ''}
                  placeholder="Min CVSS"
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setMinCvss(!isNaN(val) ? val : 0);
                    setPage(1);
                  }}
                  className="w-full min-w-[7rem] shrink-0 md:w-28"
                  containerClassName="w-full min-w-[7rem] shrink-0 md:w-28"
                />
                <Button
                  onPress={() => {
                    setHasFix(!hasFix);
                    setPage(1);
                  }}
                  className={`${hasFix ? 'btn-primary' : 'btn-secondary'} w-full shrink-0 md:w-auto`}
                  variant={hasFix ? 'primary' : 'secondary'}
                >
                  Has Fix
                </Button>
              </div>
            </div>

            <Card className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  {vulnerabilityViewSourceLabel}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {viewSettingsReady
                    ? vulnerabilityViewSummary(currentVulnerabilityViewSettings)
                    : 'Loading default view...'}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  className="btn-secondary"
                  isDisabled={
                    !viewSettingsReady || viewPreferenceSaving || !vulnerabilityViewHasChanges
                  }
                  onPress={() => void saveVulnerabilityViewPreference()}
                  variant="secondary"
                >
                  {viewPreferenceSaving && vulnerabilityViewHasChanges
                    ? 'Saving...'
                    : 'Save as my default'}
                </Button>
                <Button
                  className="btn-secondary"
                  isDisabled={
                    !viewSettingsReady || viewPreferenceSaving || !viewPreference?.has_user_override
                  }
                  onPress={() => void resetVulnerabilityViewPreference()}
                  variant="secondary"
                >
                  Reset default
                </Button>
              </div>
            </Card>
          </div>

          <Card className="surface-panel rounded-2xl overflow-hidden">
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Scan vulnerabilities" className="min-w-[1120px]">
                  <Table.Header>
                    {(
                      [
                        { label: 'CVE ID', key: 'vuln_id', align: 'left' },
                        { label: 'Package', key: 'pkg_name', align: 'left' },
                        { label: 'Installed', key: 'installed_version', align: 'left' },
                        { label: 'Fixed In', key: 'fixed_version', align: 'left' },
                        { label: 'Severity', key: 'severity', align: 'left' },
                        { label: 'CVSS', key: 'cvss_score', align: 'right' },
                      ] as {
                        label: string;
                        key: VulnerabilityViewSettings['sort_by'];
                        align: 'left' | 'right';
                      }[]
                    ).map(({ label, key, align }) => {
                      const active = sortBy === key;
                      return (
                        <Table.Column
                          key={key}
                          isRowHeader={key === 'vuln_id'}
                          onClick={() => {
                            if (active) {
                              setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                            } else {
                              setSortBy(key);
                              setSortDir('asc');
                            }
                            setPage(1);
                          }}
                          className={`cursor-pointer select-none transition-colors ${
                            align === 'right' ? 'text-right' : 'text-left'
                          }`}
                          style={{ color: active ? '#a78bfa' : 'rgba(113,113,122,0.8)' }}
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            <span
                              className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}
                            >
                              {active && sortDir === 'desc' ? '↓' : '↑'}
                            </span>
                          </span>
                        </Table.Column>
                      );
                    })}
                    <Table.Column className="text-left" style={{ color: 'rgba(113,113,122,0.8)' }}>
                      First Seen
                    </Table.Column>
                    <Table.Column className="text-right" style={{ color: 'rgba(113,113,122,0.8)' }}>
                      Notes
                    </Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {vulnLoading || vulns.length === 0 ? (
                      <Table.Row key="vuln-state" id="vuln-state">
                        <Table.Cell colSpan={8}>
                          {vulnLoading ? (
                            <div className="py-12 text-center">
                              <div className="flex justify-center">
                                <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                              </div>
                            </div>
                          ) : (
                            <div className="py-12 text-center text-zinc-500 text-sm">
                              {scan.external_status === 'blocked_by_xray_policy'
                                ? 'No imported vulnerabilities are available because Xray blocked this artifact before the normal scan summary was produced. See the Policy Violations tab for the matched issues, watches, and policies.'
                                : 'No vulnerabilities found.'}
                            </div>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      vulns.map((v) => (
                        <Fragment key={v.id}>
                          <Table.Row id={v.id} className="hover:bg-[var(--row-hover)]">
                            <Table.Cell>
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
                                      style={{
                                        background: 'rgba(251,146,60,0.12)',
                                        color: '#fb923c',
                                        border: '1px solid rgba(251,146,60,0.25)',
                                      }}
                                      title={v.suppression.justification || 'Suppressed'}
                                    >
                                      {v.suppression.status.replace(/_/g, ' ')}
                                    </span>
                                  )}
                                  {v.suppression && (
                                    <SuppressionSourceBadge source={v.suppression.source} />
                                  )}
                                </div>
                              ) : (
                                <span className="text-zinc-400 dark:text-zinc-600">-</span>
                              )}
                            </Table.Cell>
                            <Table.Cell className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                              {v.pkg_name}
                            </Table.Cell>
                            <Table.Cell className="font-mono text-xs text-zinc-500">
                              {v.installed_version}
                            </Table.Cell>
                            <Table.Cell className="font-mono text-xs text-emerald-500">
                              {v.fixed_version || (
                                <span className="text-zinc-400 dark:text-zinc-700">-</span>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <SeverityBadge severity={v.severity} />
                            </Table.Cell>
                            <Table.Cell className="text-right font-mono text-xs text-zinc-500">
                              {v.cvss_score ? v.cvss_score.toFixed(1) : '-'}
                            </Table.Cell>
                            <Table.Cell>
                              <FirstSeenBadge firstSeenAt={v.first_seen_at} />
                            </Table.Cell>
                            <Table.Cell className="text-right">
                              <Button
                                onPress={() => {
                                  setExpandedVuln(expandedVuln === v.id ? null : v.id);
                                  setCommentText('');
                                }}
                                className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
                                variant="secondary"
                              >
                                <Comment01Icon size={15} />
                                {v.comments && v.comments.length > 0 && (
                                  <span
                                    className="text-xs rounded-full px-1.5 py-0.5 font-medium"
                                    style={{ background: 'rgba(124,58,237,0.2)', color: '#a78bfa' }}
                                  >
                                    {v.comments.length}
                                  </span>
                                )}
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                          {expandedVuln === v.id && (
                            <Table.Row id={`${v.id}-expanded`}>
                              <Table.Cell
                                colSpan={8}
                                className="p-4"
                                style={{
                                  borderTop: '1px solid var(--border-subtle)',
                                  background: 'var(--row-hover)',
                                }}
                              >
                                <div className="space-y-4 max-w-3xl">
                                  {/* Suppression section */}
                                  {scan.image_digest && (
                                    <div className="space-y-2.5">
                                      <div className="flex items-center gap-2">
                                        <ShieldKeyIcon size={13} className="text-zinc-400" />
                                        <span
                                          className="text-xs font-semibold uppercase tracking-wider"
                                          style={{ color: 'var(--text-muted)' }}
                                        >
                                          Suppression
                                        </span>
                                        {v.suppression && (
                                          <span
                                            className="text-xs px-2 py-0.5 rounded-full font-medium capitalize"
                                            style={{
                                              background: 'rgba(239,68,68,0.1)',
                                              color: '#f87171',
                                              border: '1px solid rgba(239,68,68,0.2)',
                                            }}
                                          >
                                            {v.suppression.status.replace(/_/g, ' ')}
                                          </span>
                                        )}
                                      </div>
                                      {v.suppression && (
                                        <div
                                          className="rounded-lg px-3 py-2 space-y-1"
                                          style={{
                                            background: 'rgba(239,68,68,0.05)',
                                            border: '1px solid rgba(239,68,68,0.15)',
                                          }}
                                        >
                                          <p className="text-xs text-zinc-400">
                                            {v.suppression.justification || '-'}
                                          </p>
                                          <div className="flex items-center gap-2 pt-1 flex-wrap">
                                            <SuppressionSourceBadge source={v.suppression.source} />
                                            <OwnershipBadge
                                              ownerType={v.suppression.owner_type}
                                              ownerOrgId={v.suppression.owner_org_id}
                                              orgNamesById={orgNamesById}
                                            />
                                            {v.suppression.read_only && (
                                              <span className="text-[11px] text-zinc-400">
                                                Managed by Xray
                                              </span>
                                            )}
                                            {canManageSuppressionAccess(v.suppression) && (
                                              <Button
                                                onPress={() =>
                                                  openSuppressionAccess(
                                                    v.suppression as Suppression
                                                  )
                                                }
                                                className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 transition-colors"
                                                type="button"
                                                variant="secondary"
                                              >
                                                <Shield01Icon size={12} />
                                                Manage access
                                              </Button>
                                            )}
                                          </div>
                                          {v.suppression.expires_at && (
                                            <p className="text-xs text-zinc-500">
                                              Expires:{' '}
                                              {new Date(
                                                v.suppression.expires_at
                                              ).toLocaleDateString()}
                                            </p>
                                          )}
                                          {(v.suppression.xray_policy_name ||
                                            v.suppression.xray_watch_name) && (
                                            <p className="text-xs text-zinc-500">
                                              {[
                                                v.suppression.xray_policy_name,
                                                v.suppression.xray_watch_name,
                                              ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                            </p>
                                          )}
                                          {v.suppression.username && (
                                            <p className="text-xs text-zinc-500">
                                              By: {v.suppression.username}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                      {!(
                                        v.suppression?.read_only || v.suppression?.source === 'xray'
                                      ) ? (
                                        <div className="flex gap-2 items-center flex-wrap">
                                          <Select
                                            value={suppressStatus}
                                            onChange={(value) =>
                                              setSuppressStatus(value as Suppression['status'])
                                            }
                                          >
                                            <Select.Trigger>
                                              <Select.Value />
                                              <Select.Indicator />
                                            </Select.Trigger>
                                            <Select.Popover>
                                              <ListBox>
                                                <ListBox.Item id="accepted">
                                                  Accepted Risk
                                                </ListBox.Item>
                                                <ListBox.Item id="wont_fix">
                                                  Won&apos;t Fix
                                                </ListBox.Item>
                                                <ListBox.Item id="false_positive">
                                                  False Positive
                                                </ListBox.Item>
                                              </ListBox>
                                            </Select.Popover>
                                          </Select>
                                          <FormField
                                            hideLabel
                                            label="Suppression justification"
                                            type="text"
                                            value={suppressJustification}
                                            onChange={(e) =>
                                              setSuppressJustification(e.target.value)
                                            }
                                            placeholder="Justification..."
                                            className="flex-1 min-w-0"
                                            containerClassName="flex-1 min-w-0"
                                          />
                                          <DatePicker
                                            aria-label="Expiry date (optional)"
                                            value={suppressExpiry}
                                            onChange={setSuppressExpiry}
                                            className="w-40"
                                          >
                                            <DateField.Group
                                              className={`${inputCls} flex items-center gap-1`}
                                            >
                                              <DateField.Input>
                                                {(seg) => <DateField.Segment segment={seg} />}
                                              </DateField.Input>
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
                                                    {(day) => (
                                                      <Calendar.HeaderCell>
                                                        {day}
                                                      </Calendar.HeaderCell>
                                                    )}
                                                  </Calendar.GridHeader>
                                                  <Calendar.GridBody>
                                                    {(date) => <Calendar.Cell date={date} />}
                                                  </Calendar.GridBody>
                                                </Calendar.Grid>
                                                <Calendar.YearPickerGrid>
                                                  <Calendar.YearPickerGridBody>
                                                    {({ year }) => (
                                                      <Calendar.YearPickerCell year={year} />
                                                    )}
                                                  </Calendar.YearPickerGridBody>
                                                </Calendar.YearPickerGrid>
                                              </Calendar>
                                            </DatePicker.Popover>
                                          </DatePicker>
                                          <Button
                                            onPress={() => handleSuppress(v)}
                                            isDisabled={
                                              suppressSaving || !suppressJustification.trim()
                                            }
                                            className="btn-warning inline-flex shrink-0 items-center gap-1.5"
                                            type="button"
                                            variant="danger-soft"
                                          >
                                            {suppressSaving && (
                                              <span className="size-3 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                                            )}
                                            {v.suppression ? 'Update' : 'Suppress'}
                                          </Button>
                                          {v.suppression && (
                                            <Button
                                              onPress={() => handleLiftSuppression(v)}
                                              isDisabled={suppressSaving}
                                              className="btn-secondary shrink-0"
                                              type="button"
                                              variant="secondary"
                                            >
                                              Lift
                                            </Button>
                                          )}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-zinc-500">
                                          This suppression comes from Xray and cannot be edited
                                          here.
                                        </p>
                                      )}
                                      {suppressError && (
                                        <p className="text-xs mt-1" style={{ color: '#f87171' }}>
                                          {suppressError}
                                        </p>
                                      )}
                                    </div>
                                  )}

                                  <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

                                  {/* Notes / Comments */}
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                      <Comment01Icon size={13} className="text-zinc-400" />
                                      <span
                                        className="text-xs font-semibold uppercase tracking-wider"
                                        style={{ color: 'var(--text-muted)' }}
                                      >
                                        Notes
                                      </span>
                                    </div>
                                    {v.comments && v.comments.length > 0 ? (
                                      <div className="space-y-2">
                                        {v.comments.map((c) => (
                                          <div
                                            key={c.id}
                                            className="flex items-start justify-between gap-3 group"
                                          >
                                            <div className="flex-1 min-w-0">
                                              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                                {c.username || 'You'}
                                              </span>
                                              <span
                                                className="text-xs text-zinc-500 ml-2"
                                                title={fullDate(c.created_at)}
                                              >
                                                {timeAgo(c.created_at)}
                                              </span>
                                              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                                                {c.content}
                                              </p>
                                            </div>
                                            {currentUser?.id === c.user_id && (
                                              <Button
                                                onPress={() => handleDeleteComment(c.id)}
                                                className="text-zinc-400 dark:text-zinc-700 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                                                isIconOnly
                                                variant="secondary"
                                              >
                                                <Delete02Icon size={14} />
                                              </Button>
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
                                      <Button
                                        onPress={() => handleAddComment(v.id)}
                                        isDisabled={commentSaving || !commentText.trim()}
                                        className="btn-primary shrink-0"
                                        type="button"
                                        variant="primary"
                                      >
                                        Add Note
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          )}
                        </Fragment>
                      ))
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-500">{vulnTotal} total</span>
              <div className="flex items-center gap-2">
                <Button
                  isDisabled={page <= 1}
                  onPress={() => setPage((p) => p - 1)}
                  className="btn-secondary"
                  type="button"
                  variant="secondary"
                >
                  ← Prev
                </Button>
                <span className="text-sm text-zinc-500 px-2">
                  {page} / {totalPages}
                </span>
                <Button
                  isDisabled={page >= totalPages}
                  onPress={() => setPage((p) => p + 1)}
                  className="btn-secondary"
                  type="button"
                  variant="secondary"
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Details tab */}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'details' && (
        <div className="space-y-4">
          {/* Scanner info */}
          {(scan.trivy_version ||
            scan.grype_version ||
            scan.trivy_vuln_db_updated_at ||
            scan.trivy_java_db_updated_at) && (
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Scanner
              </p>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="surface-panel rounded-xl p-4">
                  <p className="text-xs text-zinc-500 mb-1">Scanner</p>
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">
                    Trivy {scan.trivy_version || 'unknown'}
                  </p>
                  {scan.grype_version && (
                    <p className="text-sm font-medium text-zinc-900 dark:text-white mt-1">
                      Grype {scan.grype_version}
                    </p>
                  )}
                  <p className="text-xs text-zinc-500 mt-1">
                    {scan.completed_at
                      ? `DB snapshot captured ${timeAgo(scan.completed_at)}`
                      : 'DB snapshot captured when this scan completed'}
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
              <p
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Image metadata
              </p>

              <Card className="surface-panel rounded-xl overflow-hidden">
                <Table variant="secondary">
                  <Table.Content aria-label="Image metadata details">
                    <Table.Header>
                      <Table.Column isRowHeader>Field</Table.Column>
                      <Table.Column>Value</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      <Table.Row id="meta-created">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Created
                        </Table.Cell>
                        <Table.Cell>{imageCreated || '-'}</Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-author">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Author
                        </Table.Cell>
                        <Table.Cell>{imageAuthor || '-'}</Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-docker-version">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Docker version
                        </Table.Cell>
                        <Table.Cell>{imageDockerVersion || '-'}</Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-user">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          User
                        </Table.Cell>
                        <Table.Cell className="font-mono text-xs">{imageUser || '-'}</Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-working-dir">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Working directory
                        </Table.Cell>
                        <Table.Cell className="font-mono text-xs">
                          {imageWorkingDir || '-'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-entrypoint">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Entrypoint
                        </Table.Cell>
                        <Table.Cell className="font-mono text-xs">
                          {imageEntrypoint.length > 0 ? imageEntrypoint.join(' ') : '-'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-command">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Command
                        </Table.Cell>
                        <Table.Cell className="font-mono text-xs">
                          {imageCommand.length > 0 ? imageCommand.join(' ') : '-'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-env-count">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Environment variables
                        </Table.Cell>
                        <Table.Cell>
                          {imageEnv.length > 0 ? `${imageEnv.length} captured` : '0 captured'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-label-count">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Labels
                        </Table.Cell>
                        <Table.Cell>
                          {imageLabelEntries.length > 0
                            ? `${imageLabelEntries.length} captured`
                            : '0 captured'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-exposed-ports">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Exposed ports
                        </Table.Cell>
                        <Table.Cell
                          className={imageExposedPorts.length > 0 ? 'font-mono text-xs' : ''}
                        >
                          {imageExposedPorts.length > 0
                            ? imageExposedPorts.join(', ')
                            : 'None declared'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-declared-volumes">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Declared volumes
                        </Table.Cell>
                        <Table.Cell className={imageVolumes.length > 0 ? 'font-mono text-xs' : ''}>
                          {imageVolumes.length > 0 ? imageVolumes.join(', ') : '-'}
                        </Table.Cell>
                      </Table.Row>
                    </Table.Body>
                  </Table.Content>
                </Table>
              </Card>

              {imageEnv.length > 0 && (
                <details className="surface-panel rounded-xl p-4">
                  <summary
                    className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Environment
                  </summary>
                  <pre
                    className="mt-3 overflow-x-auto rounded-xl p-4 text-xs leading-6 text-zinc-700 dark:text-zinc-300"
                    style={{
                      background: 'var(--row-hover)',
                      border: '1px solid var(--surface-border)',
                    }}
                  >
                    {imageEnv.join('\n')}
                  </pre>
                </details>
              )}

              {imageLabelEntries.length > 0 && (
                <details className="surface-panel rounded-xl p-4">
                  <summary
                    className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Labels
                  </summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {imageLabelEntries.map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-xl p-3"
                        style={{
                          background: 'var(--row-hover)',
                          border: '1px solid var(--surface-border)',
                        }}
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                          {key}
                        </p>
                        <p className="mt-2 break-all font-mono text-xs text-zinc-700 dark:text-zinc-300">
                          {value || '-'}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <details className="surface-panel rounded-xl p-4">
                <summary
                  className="cursor-pointer text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Raw image config
                </summary>
                <pre
                  className="mt-3 overflow-x-auto rounded-xl p-4 text-xs leading-6 text-zinc-700 dark:text-zinc-300"
                  style={{
                    background: 'var(--row-hover)',
                    border: '1px solid var(--surface-border)',
                  }}
                >
                  {JSON.stringify(fullImageConfig, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Tags */}
          {allTags.length > 0 && (
            <div className="surface-panel rounded-xl p-4">
              <p
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: 'var(--text-muted)' }}
              >
                Tags
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {allTags.map((tag) => {
                  const active = (scan.tags ?? []).some((t) => t.id === tag.id);
                  return (
                    <Button
                      key={tag.id}
                      onPress={() => toggleTag(tag)}
                      isDisabled={tagLoading === tag.id}
                      className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-all disabled:opacity-50 ${
                        !active
                          ? 'text-zinc-500 border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600'
                          : ''
                      }`}
                      variant="secondary"
                      style={
                        active
                          ? {
                              background: tag.color + '22',
                              color: tag.color,
                              borderColor: tag.color + '50',
                            }
                          : undefined
                      }
                    >
                      {tag.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Compliance */}
          {(allOrgs.length > 0 || compliance.length > 0) && (
            <div className="surface-panel rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Compliance
                </p>
                {compliance.length > 0 && (
                  <Button
                    onPress={handleReEvaluate}
                    isDisabled={complianceLoading}
                    className="text-xs text-zinc-500 hover:text-violet-400 transition-colors disabled:opacity-40"
                    variant="secondary"
                  >
                    {complianceLoading ? '…' : 'Re-evaluate'}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {compliance.length === 0 ? (
                  <>
                    <span className="text-xs text-zinc-500">No org assigned -</span>
                    {allOrgs.map((org) => (
                      <Button
                        key={org.id}
                        onPress={() => handleAssignOrg(org.id)}
                        className="text-xs px-2.5 py-1 rounded-full font-medium border transition-colors"
                        variant="secondary"
                        style={{
                          background: 'var(--row-hover)',
                          border: '1px solid var(--surface-border)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        + {org.name}
                      </Button>
                    ))}
                  </>
                ) : (
                  <>
                    {Object.entries(
                      compliance.reduce(
                        (acc, r) => {
                          const key = r.org_name ?? r.org_id;
                          if (!acc[key])
                            acc[key] = {
                              org_id: r.org_id,
                              org_name: r.org_name ?? r.org_id,
                              results: [],
                            };
                          acc[key].results.push(r);
                          return acc;
                        },
                        {} as Record<
                          string,
                          { org_id: string; org_name: string; results: ComplianceResult[] }
                        >
                      )
                    ).map(([, { org_id, org_name, results }]) => {
                      const allPass = results.every((r) => r.status === 'pass');
                      return (
                        <div key={org_id} className="flex items-center gap-1">
                          <Button
                            onClick={() => setExpandedOrg(expandedOrg === org_id ? null : org_id)}
                            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border transition-all"
                            variant="secondary"
                            style={
                              allPass
                                ? {
                                    background: 'rgba(16,185,129,0.1)',
                                    color: '#34d399',
                                    borderColor: 'rgba(16,185,129,0.25)',
                                  }
                                : {
                                    background: 'rgba(239,68,68,0.1)',
                                    color: '#f87171',
                                    borderColor: 'rgba(239,68,68,0.25)',
                                  }
                            }
                          >
                            {allPass ? '✓' : '✗'} {org_name}
                          </Button>
                          <Button
                            onPress={() => handleRemoveOrg(org_id)}
                            className="text-zinc-500 hover:text-red-400 transition-colors text-sm px-1"
                            variant="secondary"
                          >
                            ×
                          </Button>
                        </div>
                      );
                    })}
                    {allOrgs
                      .filter((o) => !compliance.some((c) => c.org_id === o.id))
                      .map((org) => (
                        <Button
                          key={org.id}
                          onPress={() => handleAssignOrg(org.id)}
                          className="text-xs px-2.5 py-1 rounded-full font-medium border transition-colors"
                          variant="secondary"
                          style={{
                            background: 'var(--row-hover)',
                            border: '1px solid var(--surface-border)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          + {org.name}
                        </Button>
                      ))}
                  </>
                )}
              </div>
              {expandedOrg && (
                <div className="mt-2 pt-3 border-t border-zinc-200 dark:border-zinc-800 space-y-1.5">
                  {compliance
                    .filter((r) => r.org_id === expandedOrg)
                    .map((r) => (
                      <div key={r.id} className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs ${r.status === 'pass' ? 'text-emerald-500' : 'text-red-400'}`}
                          >
                            {r.status === 'pass' ? '✓' : '✗'}
                          </span>
                          <span className="text-xs text-zinc-500">{r.policy_name}</span>
                        </div>
                        {r.violations && r.violations.length > 0 && (
                          <ul className="ml-4 space-y-0.5">
                            {r.violations.slice(0, 3).map((v, i) => (
                              <li key={i} className="text-xs text-zinc-500">
                                {v.message}
                              </li>
                            ))}
                            {r.violations.length > 3 && (
                              <li className="text-xs text-zinc-500">
                                +{r.violations.length - 3} more
                              </li>
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

      <Modal state={scanAccessModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="surface-modal rounded-2xl overflow-hidden">
              <Modal.Header
                className="px-6 py-4"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Manage Scan Access
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 space-y-4">
                {scanOrgGrantsError ? (
                  <FormAlert description={scanOrgGrantsError} title="Access update failed" />
                ) : null}
                <div
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: 'var(--row-hover)',
                    border: '1px solid var(--surface-border)',
                  }}
                >
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {scan.image_name}:{scan.image_tag}
                  </p>
                  <p className="mt-1 font-mono text-xs text-zinc-500" title={scan.image_digest}>
                    {scan.image_digest}
                  </p>
                  <div className="mt-2">
                    <OwnershipBadge
                      ownerType={scan.owner_type}
                      ownerOrgId={scan.owner_org_id}
                      orgNamesById={orgNamesById}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Current access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Organizations listed here can open this scan directly. Public or authenticated
                      share links remain configured separately.
                    </p>
                  </div>
                  {scanOrgGrantsLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  ) : scanOrgGrants.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {scanOrgGrants.map((share) => (
                        <div
                          key={share.org_id}
                          className="flex items-start justify-between gap-3 rounded-xl px-4 py-3"
                          style={{
                            background: 'var(--row-hover)',
                            border: '1px solid var(--surface-border)',
                          }}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {share.org_name}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium text-zinc-500">Locked</span>
                          ) : (
                            <Button
                              type="button"
                              onPress={() => {
                                void handleRevokeScanAccess(share.org_id);
                              }}
                              isDisabled={scanOrgGrantSaving}
                              className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50"
                              isIconOnly
                              variant="secondary"
                            >
                              <Delete01Icon size={15} />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Grant access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Share this scan with another organization you manage.
                    </p>
                  </div>
                  {availableScanGrantTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Select
                        value={scanOrgGrantOrgId || '__none__'}
                        onChange={(value) =>
                          setScanOrgGrantOrgId(String(value === '__none__' ? '' : (value ?? '')))
                        }
                        className="flex-1"
                      >
                        <Select.Trigger className={selectTriggerCls}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Select an organization</ListBox.Item>
                            {availableScanGrantTargets.map((org) => (
                              <ListBox.Item key={org.id} id={org.id}>
                                {org.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button
                        type="button"
                        onPress={() => {
                          void handleGrantScanAccess();
                        }}
                        isDisabled={!scanOrgGrantOrgId || scanOrgGrantSaving}
                        className="btn-primary disabled:opacity-60"
                        variant="primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button
                  onPress={scanAccessModal.close}
                  className="btn-secondary"
                  type="button"
                  variant="secondary"
                >
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={suppressionAccessModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="surface-modal rounded-2xl overflow-hidden">
              <Modal.Header
                className="px-6 py-4"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Manage Suppression Access
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 space-y-4">
                {suppressionAccessError ? (
                  <div
                    className="rounded-xl px-3 py-2.5 text-sm"
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      color: '#f87171',
                    }}
                  >
                    {suppressionAccessError}
                  </div>
                ) : null}
                {suppressionAccessTarget ? (
                  <div
                    className="rounded-xl px-4 py-3"
                    style={{
                      background: 'var(--row-hover)',
                      border: '1px solid var(--surface-border)',
                    }}
                  >
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {suppressionAccessTarget.vuln_id}
                    </p>
                    <p
                      className="mt-1 font-mono text-xs text-zinc-500"
                      title={suppressionAccessTarget.image_digest}
                    >
                      {suppressionAccessTarget.image_digest.length > 48
                        ? `${suppressionAccessTarget.image_digest.slice(0, 48)}…`
                        : suppressionAccessTarget.image_digest}
                    </p>
                    <div className="mt-2">
                      <OwnershipBadge
                        ownerType={suppressionAccessTarget.owner_type}
                        ownerOrgId={suppressionAccessTarget.owner_org_id}
                        orgNamesById={orgNamesById}
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Current access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Organizations listed here can use this suppression.
                    </p>
                  </div>
                  {suppressionAccessLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                    </div>
                  ) : suppressionAccessShares.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {suppressionAccessShares.map((share) => (
                        <div
                          key={share.org_id}
                          className="flex items-start justify-between gap-3 rounded-xl px-4 py-3"
                          style={{
                            background: 'var(--row-hover)',
                            border: '1px solid var(--surface-border)',
                          }}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                              {share.org_name}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              {share.is_owner ? 'Owner workspace' : 'Shared access'}
                            </p>
                          </div>
                          {share.is_owner ? (
                            <span className="text-xs font-medium text-zinc-500">Locked</span>
                          ) : (
                            <Button
                              type="button"
                              onPress={() => {
                                void handleRevokeSuppressionAccess(share.org_id);
                              }}
                              isDisabled={suppressionAccessSaving}
                              className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50"
                              isIconOnly
                              variant="secondary"
                            >
                              <Delete01Icon size={15} />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Grant access
                    </h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Share this suppression with another organization you manage.
                    </p>
                  </div>
                  {availableSuppressionShareTargets.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No additional organizations are available for sharing.
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      <Select
                        value={suppressionAccessOrgId || '__none__'}
                        onChange={(value) =>
                          setSuppressionAccessOrgId(
                            String(value === '__none__' ? '' : (value ?? ''))
                          )
                        }
                        className="flex-1"
                      >
                        <Select.Trigger className={selectTriggerCls}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="__none__">Select an organization</ListBox.Item>
                            {availableSuppressionShareTargets.map((org) => (
                              <ListBox.Item key={org.id} id={org.id}>
                                {org.name}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <Button
                        type="button"
                        onPress={() => {
                          void handleGrantSuppressionAccess();
                        }}
                        isDisabled={!suppressionAccessOrgId || suppressionAccessSaving}
                        className="btn-primary disabled:opacity-60"
                        variant="primary"
                      >
                        Grant
                      </Button>
                    </div>
                  )}
                </div>
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button
                  onPress={suppressionAccessModal.close}
                  className="btn-secondary"
                  type="button"
                  variant="secondary"
                >
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <VulnerabilityDetailsModal
        vulnerability={selectedVulnerability}
        state={vulnerabilityDetailsModal}
        onClose={() => vulnerabilityDetailsModal.close()}
        loadContextAnalysis={(vulnerability) =>
          getVulnerabilityContextAnalysis(id, vulnerability.id)
        }
      />
    </div>
  );
}
