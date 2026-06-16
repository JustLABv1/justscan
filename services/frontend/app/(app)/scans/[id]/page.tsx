'use client';
import { useAIContextBridge } from '@/components/assistant/ai-context-bridge';
import { EvilRadarChart } from '@/components/evilcharts/charts/radar-chart';
import { ScanFailureAlert } from '@/components/scans/scan-failure-alert';
import { ManageSuppressionAccessModal } from '@/components/suppressions/manage-suppression-access-modal';
import { useToast } from '@/components/toast';
import {
  OwnershipBadge,
  resolveDisplayStatus,
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
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import { useConditionalInterval } from '@/hooks/use-conditional-interval';
import { useWorkScope } from '@/hooks/use-work-scope';
import type {
  ComplianceResult,
  Org,
  PolicyRule,
  ResourceShare,
  SBOMComponent,
  Scan,
  Suppression,
  Tag,
  Vulnerability,
  VulnerabilitySummary,
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
  deleteSuppressionById,
  getScan,
  getScanCompliance,
  getScanSBOM,
  getScanVulnerabilityViewSettings,
  getTokenType,
  getUser,
  getVulnerabilityContextAnalysis,
  getVulnerabilitySummary,
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
  refreshScanXrayPolicy,
  resetScanVulnerabilityViewPreference,
  revokeScanOrgAccess,
  saveScanVulnerabilityViewPreference,
  shareSuppression,
  unshareSuppression,
  upsertSuppression,
} from '@/lib/api';
import { getBlockedPolicyDetails } from '@/lib/blocked-policy';
import { deferEffect } from '@/lib/defer-effect';
import { canManageOrg, canMutateOrg } from '@/lib/org-permissions';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Accordion,
  Alert,
  Button,
  Calendar,
  Card,
  Chip,
  DateField,
  DatePicker,
  Dropdown,
  Label,
  ListBox,
  Modal,
  Pagination,
  SearchField,
  Select,
  Table,
  TextArea,
  Tooltip,
  useOverlayState,
} from '@heroui/react';
import type { DateValue } from '@internationalized/date';
import { parseDate } from '@internationalized/date';
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Comment01Icon,
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

type ScanTab = 'vulns' | 'sbom' | 'details' | 'timeline' | 'compliance';
type ActiveVulnerabilitySeverityFilter = VulnerabilityViewSettings['severity'] | 'CRITICAL,HIGH';
type ActiveVulnerabilityViewSettings = Omit<VulnerabilityViewSettings, 'severity'> & {
  severity: ActiveVulnerabilitySeverityFilter;
};

const DEFAULT_VULNERABILITY_VIEW_SETTINGS: VulnerabilityViewSettings = {
  sort_by: 'severity',
  sort_dir: 'asc',
  severity: '',
  min_cvss: 0,
  has_fix: false,
  xray_policy_first: false,
  policy_failed_only: false,
};

const ACTIVE_SCAN_STATUSES = new Set([
  'pending',
  'running',
  'warming_cache',
  'indexing_artifact',
  'queued_in_xray',
  'waiting_for_xray',
]);

const VULNERABILITY_SORT_LABELS: Record<VulnerabilityViewSettings['sort_by'], string> = {
  vuln_id: 'CVE ID',
  pkg_name: 'Package',
  severity: 'Severity',
  cvss_score: 'CVSS',
  installed_version: 'Installed',
  fixed_version: 'Fixed In',
};

function isPersistableSeverityFilter(
  value: ActiveVulnerabilitySeverityFilter
): value is VulnerabilityViewSettings['severity'] {
  return (
    value === '' ||
    value === 'CRITICAL' ||
    value === 'HIGH' ||
    value === 'MEDIUM' ||
    value === 'LOW' ||
    value === 'UNKNOWN'
  );
}

function severityFilterSummaryLabel(value: ActiveVulnerabilitySeverityFilter) {
  if (value === 'CRITICAL,HIGH') {
    return 'Critical + High';
  }
  return value || 'All severities';
}

function vulnerabilityViewSummary(settings: ActiveVulnerabilityViewSettings) {
  const filters = [
    severityFilterSummaryLabel(settings.severity),
    settings.min_cvss > 0 ? `CVSS >= ${settings.min_cvss}` : '',
    settings.has_fix ? 'Has fix' : '',
    settings.xray_policy_first ? 'Xray policy first' : '',
    settings.policy_failed_only ? 'Org policy failed only' : '',
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
    a.has_fix === b.has_fix &&
    a.xray_policy_first === b.xray_policy_first &&
    a.policy_failed_only === b.policy_failed_only
  );
}

type XrayWatchPolicyMatch = {
  watchName: string;
  watchID: string;
  policy: string;
  rule: string;
  isBlocking: boolean;
  isBuildFailed: boolean;
  failPullRequest: boolean;
};

function isActiveXrayPolicyMatch(match: XrayWatchPolicyMatch): boolean {
  return match.isBlocking || match.isBuildFailed || match.failPullRequest;
}

function parseXrayWatchPolicyMatches(vulnerability: Vulnerability): XrayWatchPolicyMatch[] {
  const raw = vulnerability.xray_watch_policy_matches;
  if (!Array.isArray(raw)) {
    return [];
  }

  const results: XrayWatchPolicyMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const row = item as Record<string, unknown>;
    const watchName = typeof row.watch_name === 'string' ? row.watch_name.trim() : '';
    const watchID = typeof row.watch_id === 'string' ? row.watch_id.trim() : '';
    const policy = typeof row.policy === 'string' ? row.policy.trim() : '';
    const rule = typeof row.rule === 'string' ? row.rule.trim() : '';
    const isBlocking = row.is_blocking === true;
    const isBuildFailed = row.is_build_failed === true;
    const failPullRequest = row.fail_pull_request === true;

    results.push({ watchName, watchID, policy, rule, isBlocking, isBuildFailed, failPullRequest });
  }

  const deduped = new Map<string, XrayWatchPolicyMatch>();
  for (const match of results) {
    const key = [
      match.watchName.toLowerCase(),
      match.watchID.toLowerCase(),
      match.policy.toLowerCase(),
      match.rule.toLowerCase(),
      match.isBlocking ? '1' : '0',
      match.isBuildFailed ? '1' : '0',
      match.failPullRequest ? '1' : '0',
    ].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, match);
    }
  }

  return Array.from(deduped.values());
}

function xrayWatchNames(vulnerability: Vulnerability): string[] {
  const names = [...(vulnerability.xray_watch_names ?? []), vulnerability.xray_watch_name ?? '']
    .map((name) => name.trim())
    .filter(Boolean);

  return Array.from(new Set(names));
}

function vulnerabilityHasXrayPolicy(vulnerability: Vulnerability): boolean {
  const policyMatches = parseXrayWatchPolicyMatches(vulnerability);
  return (
    policyMatches.length > 0 ||
    xrayWatchNames(vulnerability).length > 0 ||
    policyMatches.some(isActiveXrayPolicyMatch) ||
    vulnerability.xray_is_blocking === true
  );
}

function prioritizeXrayPolicyVulnerabilities(vulnerabilities: Vulnerability[]): Vulnerability[] {
  return vulnerabilities
    .map((vulnerability, index) => ({ vulnerability, index }))
    .sort((left, right) => {
      const leftPriority = vulnerabilityHasXrayPolicy(left.vulnerability) ? 1 : 0;
      const rightPriority = vulnerabilityHasXrayPolicy(right.vulnerability) ? 1 : 0;
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.vulnerability);
}

function summarizeVisibleVulnerabilities(vulnerabilities: Vulnerability[]): VulnerabilitySummary {
  const summary: VulnerabilitySummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    with_fix: 0,
    xray_policy: 0,
  };

  for (const vulnerability of vulnerabilities) {
    switch ((vulnerability.severity ?? '').toUpperCase()) {
      case 'CRITICAL':
        summary.critical += 1;
        break;
      case 'HIGH':
        summary.high += 1;
        break;
      case 'MEDIUM':
        summary.medium += 1;
        break;
      case 'LOW':
        summary.low += 1;
        break;
      default:
        break;
    }
    if ((vulnerability.fixed_version ?? '').trim() !== '') {
      summary.with_fix += 1;
    }
    if (vulnerabilityHasXrayPolicy(vulnerability)) {
      summary.xray_policy += 1;
    }
  }

  return summary;
}

function parseRouteSeverityFilter(raw: string | null): ActiveVulnerabilitySeverityFilter | null {
  const normalized = (raw ?? '')
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

  if (normalized.length === 0) {
    return null;
  }

  const unique = Array.from(new Set(normalized));
  if (unique.length === 2 && unique[0] === 'CRITICAL' && unique[1] === 'HIGH') {
    return 'CRITICAL,HIGH';
  }
  if (unique.length === 2 && unique[0] === 'HIGH' && unique[1] === 'CRITICAL') {
    return 'CRITICAL,HIGH';
  }
  if (unique.length === 1 && isPersistableSeverityFilter(unique[0] as ActiveVulnerabilitySeverityFilter)) {
    return unique[0] as VulnerabilityViewSettings['severity'];
  }

  return null;
}

function routeHasFixFilter(raw: string | null) {
  return raw === 'true' ? true : raw === 'false' ? false : null;
}

function routeHideSuppressedFilter(raw: string | null) {
  return raw === 'false' ? true : raw === 'true' ? false : null;
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

function normalizeVulnId(value?: string | null) {
  return (value ?? '').trim().toUpperCase();
}

function summarizePolicyRule(rule?: PolicyRule | null): string {
  if (!rule) {
    return '';
  }

  switch (rule.type) {
    case 'max_cvss':
      return `Max CVSS < ${(rule.value ?? 0).toFixed(1)}`;
    case 'max_count': {
      const severity = (rule.severity ?? '').trim().toUpperCase() || 'SEVERITY';
      return `Max ${severity} vulnerabilities: ${Math.trunc(rule.value ?? 0)}`;
    }
    case 'max_total':
      return `Max total vulnerabilities: ${Math.trunc(rule.value ?? 0)}`;
    case 'require_fix': {
      const severity = (rule.severity ?? '').trim().toUpperCase() || 'SPECIFIED';
      return `Fix required for ${severity} vulnerabilities`;
    }
    case 'blocked_cve':
      return `Blocked CVE: ${(rule.cve_id ?? '').trim() || 'specified CVE'}`;
    case 'xray_policy_block':
      return 'No Xray policy blocking vulnerabilities';
    default:
      return rule.type;
  }
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

const LIMIT = 10;

function isScanTab(value: string | null): value is ScanTab {
  return (
    value === 'vulns' ||
    value === 'sbom' ||
    value === 'details' ||
    value === 'timeline' ||
    value === 'compliance'
  );
}

function buildPaginationItems(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) {
    items.push('ellipsis');
  }
  for (let page = start; page <= end; page += 1) {
    items.push(page);
  }
  if (end < totalPages - 1) {
    items.push('ellipsis');
  }
  items.push(totalPages);
  return items;
}

export default function ScanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setRouteContext, setOverlayContext } = useAIContextBridge();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const workScope = useWorkScope();
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
  const [severityFilter, setSeverityFilter] = useState<ActiveVulnerabilitySeverityFilter>('');
  const [pkgFilter, setPkgFilter] = useState('');
  const [pkgInput, setPkgInput] = useState('');
  const [cveFilter, setCveFilter] = useState('');
  const [cveInput, setCveInput] = useState('');
  const [minCvss, setMinCvss] = useState(0);
  const [hasFix, setHasFix] = useState(false);
  const [hideSuppressed, setHideSuppressed] = useState(false);
  const [xrayPolicyFirst, setXrayPolicyFirst] = useState(false);
  const [policyFailedOnly, setPolicyFailedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<VulnerabilityViewSettings['sort_by']>('severity');
  const [sortDir, setSortDir] = useState<VulnerabilityViewSettings['sort_dir']>('asc');
  const [viewSettingsReady, setViewSettingsReady] = useState(false);
  const [viewPreference, setViewPreference] = useState<VulnerabilityViewPreferenceResponse | null>(
    null
  );
  const [viewPreferenceSaving, setViewPreferenceSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vulnLoading, setVulnLoading] = useState(false);
  const [vulnSummary, setVulnSummary] = useState<VulnerabilitySummary | null>(null);
  const [filteredVulnSummaryOverride, setFilteredVulnSummaryOverride] =
    useState<VulnerabilitySummary | null>(null);
  const [isVulnerabilityRadarCollapsed, setIsVulnerabilityRadarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const userId = getUser()?.id ?? 'anonymous';
    return window.localStorage.getItem(`justscan:vuln-radar-collapsed:${userId}`) === '1';
  });
  const [error, setError] = useState('');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagLoading, setTagLoading] = useState('');
  const [selectedTagToAdd, setSelectedTagToAdd] = useState('');
  const [expandedVuln, setExpandedVuln] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);

  const [compliance, setCompliance] = useState<ComplianceResult[]>([]);
  const [allOrgs, setAllOrgs] = useState<Org[]>([]);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [selectedOrgToAssign, setSelectedOrgToAssign] = useState('');
  const [complianceVulnById, setComplianceVulnById] = useState<Record<string, Vulnerability[]>>({});
  const [complianceVulnLoading, setComplianceVulnLoading] = useState(false);
  const [complianceVulnLoaded, setComplianceVulnLoaded] = useState(false);
  const [reScanning, setReScanning] = useState(false);
  const [xrayPolicyRefreshing, setXrayPolicyRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [comparingPrev, setComparingPrev] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareVisibility, setShareVisibility] = useState<'public' | 'authenticated'>('public');
  const [shareCopied, setShareCopied] = useState(false);
  const loadVersionRef = useRef(0);
  const loadScanInFlightRef = useRef<Promise<Scan> | null>(null);
  const defaultTabInitializedRef = useRef(false);
  const vulnerabilityViewInitializedRef = useRef(false);
  const vulnerabilityViewScopeKeyRef = useRef('');
  const appliedRouteVulnerabilityFocusKeyRef = useRef('');

  const [suppressStatus, setSuppressStatus] = useState<Suppression['status']>('accepted');
  const [suppressScope, setSuppressScope] = useState<'personal' | 'workspace' | 'global'>(
    workScope.kind === 'org' ? 'workspace' : 'personal'
  );
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
  const xrayPolicyDetailsModal = useOverlayState();
  const shareModal = useOverlayState();
  const scanAccessModal = useOverlayState();
  const suppressionAccessModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);
  const [selectedXrayVulnerability, setSelectedXrayVulnerability] = useState<Vulnerability | null>(
    null
  );

  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStatus = scan?.status;
  const activeWorkScopeOrgId = workScope.kind === 'org' ? workScope.orgId : '';
  const vulnerabilityViewScopeKey =
    workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const blockedPolicyDetails = getBlockedPolicyDetails(
    scan?.external_status,
    scan?.blocked_policy_details,
    scan?.error_message
  );
  const currentVulnerabilityViewSettings: ActiveVulnerabilityViewSettings = {
    sort_by: sortBy,
    sort_dir: sortDir,
    severity: severityFilter,
    min_cvss: minCvss,
    has_fix: hasFix,
    xray_policy_first: xrayPolicyFirst,
    policy_failed_only: policyFailedOnly,
  };
  const effectiveVulnerabilityViewSettings =
    viewPreference?.settings ?? DEFAULT_VULNERABILITY_VIEW_SETTINGS;
  const persistableCurrentVulnerabilityViewSettings: VulnerabilityViewSettings = {
    ...currentVulnerabilityViewSettings,
    severity: isPersistableSeverityFilter(severityFilter) ? severityFilter : '',
  };
  const vulnerabilityViewHasChanges =
    viewSettingsReady &&
    !vulnerabilityViewSettingsEqual(
      persistableCurrentVulnerabilityViewSettings,
      effectiveVulnerabilityViewSettings
    );
  const routeSeverityFilter = parseRouteSeverityFilter(searchParams.get('severity'));
  const routeHasFix = routeHasFixFilter(searchParams.get('has_fix'));
  const routeHideSuppressed = routeHideSuppressedFilter(searchParams.get('suppressed'));
  const routeSortBy = searchParams.get('sort_by');
  const routeSortDir = searchParams.get('sort_dir');
  const hasRouteVulnerabilityFocus =
    routeSeverityFilter !== null ||
    routeHasFix !== null ||
    routeHideSuppressed !== null ||
    Boolean(routeSortBy) ||
    Boolean(routeSortDir);
  const triageFocusActive = searchParams.get('triage_focus') === 'acknowledge';
  const hasTransientVulnerabilityFilters =
    pkgInput.trim().length > 0 ||
    pkgFilter.trim().length > 0 ||
    cveInput.trim().length > 0 ||
    cveFilter.trim().length > 0 ||
    hideSuppressed ||
    !isPersistableSeverityFilter(severityFilter) ||
    hasRouteVulnerabilityFocus;
  const vulnerabilityViewSourceLabel = viewPreference?.has_user_override
    ? 'My saved default'
    : viewPreference?.source === 'org'
      ? 'Organization default'
      : 'System default';
  const currentUser = getUser();
  const radarPreferenceKey = `justscan:vuln-radar-collapsed:${currentUser?.id ?? 'anonymous'}`;

  useEffect(() => {
    setRouteContext({
      scopeType: 'scan',
      scopeRef: id,
      title: scan ? `${scan.image_name}:${scan.image_tag}` : 'Scan scope',
      description: 'Current scan details',
    });
  }, [id, scan, setRouteContext]);

  useEffect(() => {
    if (!vulnerabilityDetailsModal.isOpen || !selectedVulnerability) {
      setOverlayContext(null);
      return;
    }

    setOverlayContext({
      scopeType: 'vulnerability',
      scopeRef: `${id}:${selectedVulnerability.id}`,
      title: selectedVulnerability.vuln_id || 'Vulnerability scope',
      description: 'Focused vulnerability details',
    });
  }, [id, selectedVulnerability, setOverlayContext, vulnerabilityDetailsModal.isOpen]);

  useEffect(() => () => setOverlayContext(null), [setOverlayContext]);

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
      const normalizedSettings: VulnerabilityViewSettings = {
        ...DEFAULT_VULNERABILITY_VIEW_SETTINGS,
        ...preference.settings,
        policy_failed_only: Boolean(preference.settings.policy_failed_only),
      };
      setViewPreference({ ...preference, settings: normalizedSettings });
      setSeverityFilter(normalizedSettings.severity);
      setMinCvss(normalizedSettings.min_cvss);
      setHasFix(normalizedSettings.has_fix);
      setXrayPolicyFirst(normalizedSettings.xray_policy_first);
      setPolicyFailedOnly(normalizedSettings.policy_failed_only);
      setSortBy(normalizedSettings.sort_by);
      setSortDir(normalizedSettings.sort_dir);
      setPage(1);
    },
    []
  );

  useEffect(() => {
    return deferEffect(() => {
      defaultTabInitializedRef.current = false;
      vulnerabilityViewInitializedRef.current = false;
      setActiveTab('vulns');
      setViewSettingsReady(false);
      setViewPreference(null);
      setSeverityFilter('');
      setMinCvss(0);
      setHasFix(false);
      setHideSuppressed(false);
      setXrayPolicyFirst(false);
      setPolicyFailedOnly(false);
      setSortBy('severity');
      setSortDir('asc');
      setPage(1);
      setFilteredVulnSummaryOverride(null);
      setComplianceVulnById({});
      setComplianceVulnLoaded(false);
      setComplianceVulnLoading(false);
      appliedRouteVulnerabilityFocusKeyRef.current = '';
    });
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
    if (cveDebounceRef.current) clearTimeout(cveDebounceRef.current);
    cveDebounceRef.current = setTimeout(() => {
      setCveFilter(cveInput.trim().toUpperCase());
      setPage(1);
    }, 400);
    return () => {
      if (cveDebounceRef.current) clearTimeout(cveDebounceRef.current);
    };
  }, [cveInput]);

  useEffect(() => {
    return deferEffect(() => {
      if (!scan || defaultTabInitializedRef.current) return;
      if (scan.status === 'pending' || scan.status === 'running') return;

      const requestedTab = searchParams.get('tab');
      if (isScanTab(requestedTab)) {
        setActiveTab(requestedTab);
        defaultTabInitializedRef.current = true;
        return;
      }

      defaultTabInitializedRef.current = true;
    });
  }, [blockedPolicyDetails, scan, searchParams]);

  useEffect(() => {
    let cancelled = false;
    const cancelDeferred = deferEffect(() => {
      if (vulnerabilityViewScopeKeyRef.current !== vulnerabilityViewScopeKey) {
        vulnerabilityViewScopeKeyRef.current = vulnerabilityViewScopeKey;
        vulnerabilityViewInitializedRef.current = false;
      }
      if (!scan) return;
      if (scan.status === 'pending' || scan.status === 'running') {
        setViewSettingsReady(true);
        return;
      }
      if (vulnerabilityViewInitializedRef.current) return;

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
    });

    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, [applyVulnerabilityViewPreference, id, scan, vulnerabilityViewScopeKey]);

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
    return deferEffect(() => {
      if (!scan || scan.status === 'pending' || scan.status === 'running') return;
      if (!viewSettingsReady || !hasRouteVulnerabilityFocus) return;

      const focusKey = searchParams.toString();
      if (appliedRouteVulnerabilityFocusKeyRef.current === focusKey) return;
      appliedRouteVulnerabilityFocusKeyRef.current = focusKey;

      if (routeSeverityFilter !== null) {
        setSeverityFilter(routeSeverityFilter);
      }
      if (routeHasFix !== null) {
        setHasFix(routeHasFix);
      }
      if (routeHideSuppressed !== null) {
        setHideSuppressed(routeHideSuppressed);
      }
      if (
        routeSortBy === 'vuln_id' ||
        routeSortBy === 'pkg_name' ||
        routeSortBy === 'severity' ||
        routeSortBy === 'cvss_score' ||
        routeSortBy === 'installed_version' ||
        routeSortBy === 'fixed_version'
      ) {
        setSortBy(routeSortBy);
      }
      if (routeSortDir === 'asc' || routeSortDir === 'desc') {
        setSortDir(routeSortDir);
      }
      setPage(1);
    });
  }, [
    hasRouteVulnerabilityFocus,
    routeHasFix,
    routeHideSuppressed,
    routeSeverityFilter,
    routeSortBy,
    routeSortDir,
    scan,
    searchParams,
    viewSettingsReady,
  ]);

  useEffect(() => {
    return deferEffect(() => {
      if (!vulnerabilityDetailsModal.isOpen) {
        setSelectedVulnerability(null);
      }
    });
  }, [vulnerabilityDetailsModal.isOpen]);

  // Reset suppress form when expanded vuln changes
  useEffect(() => {
    return deferEffect(() => {
      const v = vulns.find((v) => v.id === expandedVuln);
      setSuppressError('');
      if (v?.suppression) {
        setSuppressStatus(v.suppression.status);
        setSuppressScope(
          v.suppression.owner_type === 'system'
            ? 'global'
            : v.suppression.owner_type === 'org'
              ? 'workspace'
              : 'personal'
        );
        setSuppressJustification(v.suppression.justification);
        setSuppressExpiry(
          v.suppression.expires_at ? parseDate(v.suppression.expires_at.slice(0, 10)) : null
        );
      } else {
        setSuppressStatus('accepted');
        setSuppressScope(workScope.kind === 'org' ? 'workspace' : 'personal');
        setSuppressJustification('');
        setSuppressExpiry(null);
      }
    });
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
    return deferEffect(() => {
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, scan?.status]);

  // Reload SBOM when filters change (after first load)
  useEffect(() => {
    return deferEffect(() => {
      if (!sbomLoaded) return;
      setSbomLoading(true);
      getScanSBOM(id, sbomNameFilter || undefined, sbomTypeFilter || undefined)
        .then((res) => {
          setSbomComponents(res.data ?? []);
          setSbomTotal(res.total);
        })
        .catch(() => {})
        .finally(() => setSbomLoading(false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbomNameFilter, sbomTypeFilter]);

  function loadVulns() {
    if (!scan || scan.status === 'pending' || scan.status === 'running' || !viewSettingsReady)
      return;
    setVulnLoading(true);
    const severityParts = severityFilter
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean);
    const apiSeverityFilter = severityParts.length > 0 ? severityParts.join(',') : undefined;
    const baseArgs = [
      apiSeverityFilter,
      pkgFilter || undefined,
      hasFix || undefined,
      minCvss || undefined,
      sortBy,
      sortDir,
    ] as const;

    const normalizedCveFilter = cveFilter.trim().toUpperCase();
    const policyFailedFilterActive = policyFailedOnly && workScope.kind === 'org';
    const policyFailedVulnIdSet = new Set<string>();
    if (policyFailedFilterActive) {
      for (const result of compliance) {
        if (result.org_id !== activeWorkScopeOrgId || result.status !== 'fail') continue;
        for (const violation of result.violations ?? []) {
          const rawVulnId = (violation.vuln_id ?? violation.rule?.cve_id ?? '').trim();
          if (!rawVulnId) continue;
          const normalizedVulnId = normalizeVulnId(rawVulnId);
          if (normalizedVulnId) {
            policyFailedVulnIdSet.add(normalizedVulnId);
          }
        }
      }
    }
    const shouldLoadAllPages =
      xrayPolicyFirst ||
      normalizedCveFilter.length > 0 ||
      policyFailedFilterActive ||
      hideSuppressed ||
      severityParts.length > 1;

    if (!shouldLoadAllPages) {
      setFilteredVulnSummaryOverride(null);
    }

    const loadPromise = shouldLoadAllPages
      ? (async () => {
          const pageSize = 100;
          let nextPage = 1;
          let total = 0;
          const all: Vulnerability[] = [];

          for (;;) {
            const res = await listVulnerabilities(id, nextPage, pageSize, ...baseArgs);
            const rows = res.data ?? [];
            total = res.total ?? total;
            all.push(...rows);

            if (rows.length === 0 || all.length >= total) {
              break;
            }
            nextPage += 1;
          }

          const prioritized = xrayPolicyFirst ? prioritizeXrayPolicyVulnerabilities(all) : all;
          const filteredByCve = normalizedCveFilter
            ? prioritized.filter((vulnerability) =>
                normalizeVulnId(vulnerability.vuln_id).includes(normalizedCveFilter)
              )
            : prioritized;
          const filteredByPolicy = policyFailedFilterActive
            ? filteredByCve.filter((vulnerability) =>
                policyFailedVulnIdSet.has(normalizeVulnId(vulnerability.vuln_id))
              )
            : filteredByCve;
          const filteredBySuppression = hideSuppressed
            ? filteredByPolicy.filter((vulnerability) => !vulnerability.suppression)
            : filteredByPolicy;
          const start = (page - 1) * LIMIT;
          const end = start + LIMIT;
          setFilteredVulnSummaryOverride(summarizeVisibleVulnerabilities(filteredBySuppression));
          return {
            data: filteredBySuppression.slice(start, end),
            total: filteredBySuppression.length,
          };
        })()
      : listVulnerabilities(id, page, LIMIT, ...baseArgs);

    loadPromise
      .then((res) => {
        const rows = hideSuppressed
          ? (res.data ?? []).filter((vulnerability) => !vulnerability.suppression)
          : (res.data ?? []);
        setVulns(rows);
        setVulnTotal(res.total ?? rows.length);
      })
      .catch(() => {
        setFilteredVulnSummaryOverride(null);
      })
      .finally(() => setVulnLoading(false));
  }

  useEffect(() => {
    return deferEffect(loadVulns);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    scan,
    page,
    severityFilter,
    pkgFilter,
    minCvss,
    hasFix,
    xrayPolicyFirst,
    policyFailedOnly,
    hideSuppressed,
    cveFilter,
    sortBy,
    sortDir,
    compliance,
    workScope.kind,
    activeWorkScopeOrgId,
    viewSettingsReady,
  ]);

  useEffect(() => {
    return deferEffect(() => {
      if (!scan || scan.status === 'pending' || scan.status === 'running' || !viewSettingsReady) {
        setVulnSummary(null);
        return;
      }
      if (filteredVulnSummaryOverride) {
        setVulnSummary(filteredVulnSummaryOverride);
        return;
      }

      getVulnerabilitySummary(
        id,
        severityFilter || undefined,
        pkgFilter || undefined,
        hasFix || undefined,
        minCvss || undefined
      )
        .then(setVulnSummary)
        .catch(() => setVulnSummary(null));
    });
  }, [
    filteredVulnSummaryOverride,
    hasFix,
    id,
    minCvss,
    pkgFilter,
    scan,
    severityFilter,
    viewSettingsReady,
  ]);

  useEffect(() => {
    let cancelled = false;
    const cancelDeferred = deferEffect(() => {
      if (activeTab !== 'compliance') return;
      if (!scan || scan.status === 'pending' || scan.status === 'running') return;
      if (complianceVulnLoaded || complianceVulnLoading) return;

      setComplianceVulnLoading(true);
      (async () => {
        try {
          const pageSize = 200;
          let currentPage = 1;
          let total = 0;
          const allRows: Vulnerability[] = [];

          for (;;) {
            const response = await listVulnerabilities(id, currentPage, pageSize);
            const rows = response.data ?? [];
            total = response.total ?? total;
            allRows.push(...rows);

            if (rows.length === 0 || allRows.length >= total) {
              break;
            }
            currentPage += 1;
          }

          if (cancelled) return;

          const byId: Record<string, Vulnerability[]> = {};
          for (const vulnerability of allRows) {
            const key = normalizeVulnId(vulnerability.vuln_id);
            if (!key) continue;
            if (!byId[key]) {
              byId[key] = [];
            }
            byId[key].push(vulnerability);
          }

          setComplianceVulnById(byId);
          setComplianceVulnLoaded(true);
        } catch {
          if (!cancelled) {
            setComplianceVulnLoaded(true);
          }
        } finally {
          if (!cancelled) {
            setComplianceVulnLoading(false);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, [activeTab, complianceVulnLoaded, complianceVulnLoading, id, scan]);

  async function saveVulnerabilityViewPreference() {
    if (!viewSettingsReady) return;
    setViewPreferenceSaving(true);
    try {
      const preference = await saveScanVulnerabilityViewPreference(
        id,
        persistableCurrentVulnerabilityViewSettings
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

  function resetToSavedVulnerabilityView() {
    if (!viewSettingsReady) return;
    setPkgInput('');
    setPkgFilter('');
    setCveInput('');
    setCveFilter('');
    setHideSuppressed(false);
    applyVulnerabilityViewPreference({
      settings: effectiveVulnerabilityViewSettings,
      source: viewPreference?.source ?? 'system',
      scope_type: viewPreference?.scope_type ?? 'personal',
      scope_ref: viewPreference?.scope_ref ?? '',
      has_user_override: Boolean(viewPreference?.has_user_override),
    });
  }

  async function toggleTag(tag: Tag) {
    if (!scan || !canMutateScan()) return;
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
    if (!canMutateScan()) return;
    await assignScanToOrg(orgId, id).catch(() => {});
    const results = await getScanCompliance(id).catch(() => [] as ComplianceResult[]);
    setCompliance(results);
  }

  async function handleRemoveOrg(orgId: string) {
    if (!canMutateScan()) return;
    await removeScanFromOrg(orgId, id).catch(() => {});
    setCompliance((c) => c.filter((r) => r.org_id !== orgId));
  }

  async function handleReEvaluate() {
    if (!canMutateScan()) return;
    setComplianceLoading(true);
    const results = await reEvaluateCompliance(id).catch(() => [] as ComplianceResult[]);
    setCompliance(results);
    setComplianceLoading(false);
  }

  async function handleReScan() {
    if (!canMutateScan()) return;
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

  async function handleRefreshXrayPolicy() {
    if (!scan || !canMutateScan()) return;
    setXrayPolicyRefreshing(true);
    try {
      const result = await refreshScanXrayPolicy(id);
      setScan(result.scan);
      setFilteredVulnSummaryOverride(null);
      setComplianceVulnById({});
      setComplianceVulnLoaded(false);
      setComplianceVulnLoading(false);
      setPage(1);
      const results = await getScanCompliance(id).catch(() => [] as ComplianceResult[]);
      setCompliance(results);
      const suffix = result.violation_count === 1 ? 'violation' : 'violations';
      toast.success(`Xray policy data refreshed (${result.violation_count} ${suffix})`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to refresh Xray policy data');
    } finally {
      setXrayPolicyRefreshing(false);
    }
  }

  async function handleCancel() {
    if (!scan || !canMutateScan()) return;
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
    if (!scan || !canManageScanAccess()) return;
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
    if (!scan || !canManageScanAccess()) return;
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
    if (!scan?.image_digest || !canMutateScan()) return;
    setSuppressSaving(true);
    setSuppressError('');
    try {
      await upsertSuppression(scan.image_digest, {
        vuln_id: vuln.vuln_id,
        status: suppressStatus,
        justification: suppressJustification,
        expires_at: suppressExpiry ? new Date(suppressExpiry.toString()).toISOString() : null,
        org_id:
          suppressScope === 'global'
            ? undefined
            : suppressScope === 'workspace' && workScope.kind === 'org'
              ? workScope.orgId
              : undefined,
        is_global: suppressScope === 'global' ? true : undefined,
      });
      loadVulns();
    } catch (e: unknown) {
      setSuppressError(e instanceof Error ? e.message : 'Failed to save suppression');
    } finally {
      setSuppressSaving(false);
    }
  }

  async function handleLiftSuppression(vuln: Vulnerability) {
    if (!scan?.image_digest || !canMutateScan()) return;
    if (vuln.suppression?.read_only || vuln.suppression?.source === 'xray') return;
    setSuppressSaving(true);
    setSuppressError('');
    try {
      if (vuln.suppression?.id) {
        await deleteSuppressionById(vuln.suppression.id);
      } else {
        await deleteSuppression(
          scan.image_digest,
          vuln.vuln_id,
          vuln.suppression?.owner_type === 'org'
            ? (vuln.suppression.owner_org_id ?? undefined)
            : undefined
        );
      }
      loadVulns();
    } catch (e: unknown) {
      setSuppressError(e instanceof Error ? e.message : 'Failed to remove suppression');
    } finally {
      setSuppressSaving(false);
    }
  }

  function roleForOrg(orgId?: string | null) {
    if (!orgId) return undefined;
    return allOrgs.find((org) => org.id === orgId)?.current_user_role;
  }

  function canMutateScan() {
    if (!scan) return false;
    if (isPlatformAdmin) return true;
    if (scan.owner_type === 'org' && scan.owner_org_id) {
      return canMutateOrg(roleForOrg(scan.owner_org_id));
    }
    return true;
  }

  function canManageScanAccess() {
    if (!scan) return false;
    if (isPlatformAdmin) return true;
    if (scan?.owner_type === 'org' && scan.owner_org_id) {
      return canManageOrg(roleForOrg(scan.owner_org_id));
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
    if (!canManageScanAccess()) return;
    setScanOrgGrantOrgId('');
    setScanOrgGrantsError('');
    scanAccessModal.open();
    void loadScanOrgGrantState();
  }

  async function handleGrantScanAccess() {
    if (!scan || !scanOrgGrantOrgId || !canManageScanAccess()) return;
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
    if (!scan || !canManageScanAccess()) return;
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
      return canManageOrg(roleForOrg(suppression.owner_org_id));
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
    if (!canManageSuppressionAccess(suppression)) return;
    setSuppressionAccessTarget(suppression);
    setSuppressionAccessShares([]);
    setSuppressionAccessOrgId('');
    setSuppressionAccessError('');
    suppressionAccessModal.open();
    void loadSuppressionAccessShares(suppression.id);
  }

  async function handleGrantSuppressionAccess() {
    if (
      !suppressionAccessTarget ||
      !suppressionAccessOrgId ||
      !canManageSuppressionAccess(suppressionAccessTarget)
    )
      return;
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
    if (!suppressionAccessTarget || !canManageSuppressionAccess(suppressionAccessTarget)) return;
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

  function openXrayPolicyDetails(vulnerability: Vulnerability) {
    setSelectedXrayVulnerability(vulnerability);
    xrayPolicyDetailsModal.open();
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
  const effectiveScanStatus = resolveDisplayStatus(scan.status, scan.external_status);
  const isScanInProgress = ACTIVE_SCAN_STATUSES.has(effectiveScanStatus);

  const totalPages = Math.max(1, Math.ceil(vulnTotal / LIMIT));
  const isPlatformAdmin = getTokenType() === 'admin' || currentUser?.role === 'admin';
  const orgNamesById = Object.fromEntries(allOrgs.map((org) => [org.id, org.name]));
  const ownerOrgPolicy =
    scan?.owner_type === 'org' && scan.owner_org_id
      ? allOrgs.find((org) => org.id === scan.owner_org_id)
      : null;
  const rescanDisabledReason = !ownerOrgPolicy
    ? ''
    : !ownerOrgPolicy.is_active
      ? 'Organization is suspended. Re-scan is disabled.'
      : ownerOrgPolicy.allow_rescans
        ? ''
        : 'Re-scans are disabled for this organization.';
  const manageableOrgIds = new Set(
    allOrgs.filter((org) => canManageOrg(org.current_user_role)).map((org) => org.id)
  );
  const canMutateCurrentScan = canMutateScan();
  const canRefreshXrayPolicy =
    scan.scan_provider === 'artifactory_xray' &&
    (scan.status === 'completed' || scan.status === 'failed') &&
    !isScanInProgress;
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

  const complianceByOrg = Object.values(
    compliance.reduce(
      (acc, result) => {
        const key = result.org_id;
        if (!acc[key]) {
          acc[key] = {
            org_id: result.org_id,
            org_name: result.org_name ?? result.org_id,
            results: [],
          };
        }
        acc[key].results.push(result);
        return acc;
      },
      {} as Record<string, { org_id: string; org_name: string; results: ComplianceResult[] }>
    )
  );
  const currentVulnById: Record<string, Vulnerability[]> = {};
  for (const vulnerability of vulns) {
    const key = normalizeVulnId(vulnerability.vuln_id);
    if (!key) continue;
    if (!currentVulnById[key]) {
      currentVulnById[key] = [];
    }
    currentVulnById[key].push(vulnerability);
  }
  const activeOrgCompliance =
    workScope.kind === 'org'
      ? compliance.filter((result) => result.org_id === workScope.orgId)
      : [];
  const orgPolicyFailuresByVuln: Record<
    string,
    Array<{ name: string; ruleSummaries: string[] }>
  > = {};
  const orgPolicyFailureSetsByVuln: Record<string, Record<string, Set<string>>> = {};
  for (const result of activeOrgCompliance) {
    if (result.status !== 'fail') {
      continue;
    }
    const policyName = result.policy_name?.trim() || 'Policy';
    const policyRuleSummaries = (result.policy_rules ?? [])
      .map((rule) => summarizePolicyRule(rule))
      .map((summary) => summary.trim())
      .filter(Boolean);
    for (const violation of result.violations ?? []) {
      const rawVulnId = (violation.vuln_id ?? violation.rule?.cve_id ?? '').trim();
      if (!rawVulnId) {
        continue;
      }
      const vulnId = normalizeVulnId(rawVulnId);
      if (!vulnId) {
        continue;
      }
      if (!orgPolicyFailureSetsByVuln[vulnId]) {
        orgPolicyFailureSetsByVuln[vulnId] = {};
      }
      if (!orgPolicyFailureSetsByVuln[vulnId][policyName]) {
        orgPolicyFailureSetsByVuln[vulnId][policyName] = new Set<string>();
      }
      for (const summary of policyRuleSummaries) {
        orgPolicyFailureSetsByVuln[vulnId][policyName].add(summary);
      }
      const violationRuleSummary = summarizePolicyRule(violation.rule);
      if (violationRuleSummary) {
        orgPolicyFailureSetsByVuln[vulnId][policyName].add(violationRuleSummary);
      }
    }
  }
  for (const vulnId of Object.keys(orgPolicyFailureSetsByVuln)) {
    orgPolicyFailuresByVuln[vulnId] = Object.entries(orgPolicyFailureSetsByVuln[vulnId])
      .map(([name, rules]) => ({
        name,
        ruleSummaries: Array.from(rules).sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
  const complianceViolationRows = compliance
    .filter((result) => result.status === 'fail')
    .flatMap((result) =>
      (result.violations ?? []).map((violation, index) => {
        const rawVulnId = violation.vuln_id ?? violation.rule?.cve_id ?? '';
        const vulnId = normalizeVulnId(rawVulnId);
        const matches = vulnId
          ? [...(complianceVulnById[vulnId] ?? []), ...(currentVulnById[vulnId] ?? [])]
          : [];
        const primaryMatch = matches[0];
        return {
          id: `${result.id}-${index}`,
          orgId: result.org_id,
          orgName: result.org_name ?? result.org_id,
          policyName: result.policy_name ?? 'Policy',
          evaluatedAt: result.evaluated_at,
          message: violation.message,
          vulnId,
          ruleType: violation.rule?.type ?? '',
          severity: primaryMatch?.severity ?? violation.rule?.severity ?? '',
          packageName: primaryMatch?.pkg_name ?? '',
          installedVersion: primaryMatch?.installed_version ?? '',
          fixedVersion: primaryMatch?.fixed_version ?? '',
          hasFix: Boolean(primaryMatch?.fixed_version),
          matchCount: matches.length,
          primaryMatch,
        };
      })
    );
  const vulnPaginationItems = buildPaginationItems(page, totalPages);

  const vulnerabilityRadarData = [
    { subject: 'Critical', value: vulnSummary?.critical ?? 0 },
    { subject: 'High', value: vulnSummary?.high ?? 0 },
    { subject: 'Medium', value: vulnSummary?.medium ?? 0 },
    { subject: 'Low', value: vulnSummary?.low ?? 0 },
    { subject: 'Fix Available', value: vulnSummary?.with_fix ?? 0 },
    { subject: 'Xray Policy', value: vulnSummary?.xray_policy ?? 0 },
  ];
  const filteredVulnerabilityTotal = vulnTotal;
  const vulnerabilitiesWithFix = vulnSummary?.with_fix ?? 0;
  const vulnerabilitiesWithoutFix = Math.max(
    0,
    filteredVulnerabilityTotal - vulnerabilitiesWithFix
  );
  const xrayPolicyMatches = vulnSummary?.xray_policy ?? 0;
  const criticalAndHigh = (vulnSummary?.critical ?? 0) + (vulnSummary?.high ?? 0);
  const fixCoveragePercent =
    filteredVulnerabilityTotal > 0
      ? Math.round((vulnerabilitiesWithFix / filteredVulnerabilityTotal) * 100)
      : 0;
  const xrayPolicyPercent =
    filteredVulnerabilityTotal > 0
      ? Math.round((xrayPolicyMatches / filteredVulnerabilityTotal) * 100)
      : 0;
  const severityDistribution = [
    { label: 'Critical', value: vulnSummary?.critical ?? 0 },
    { label: 'High', value: vulnSummary?.high ?? 0 },
    { label: 'Medium', value: vulnSummary?.medium ?? 0 },
    { label: 'Low', value: vulnSummary?.low ?? 0 },
  ];
  const dominantSeverity = severityDistribution.reduce((best, current) =>
    current.value > best.value ? current : best
  );
  const remediationItems = [
    {
      label: 'Critical/high exposure',
      value: criticalAndHigh,
      detail:
        criticalAndHigh > 0
          ? 'Start here before reviewing medium and low findings.'
          : 'No critical or high findings in the current view.',
      tone: criticalAndHigh > 0 ? 'danger' : 'success',
      action: () => {
        setActiveTab('vulns');
        setSeverityFilter(
          criticalAndHigh > 0 && (vulnSummary?.critical ?? 0) > 0 ? 'CRITICAL' : 'HIGH'
        );
      },
      actionLabel: 'Review highest risk',
    },
    {
      label: 'Fixes available',
      value: vulnerabilitiesWithFix,
      detail:
        vulnerabilitiesWithFix > 0
          ? `${fixCoveragePercent}% of visible findings have a fixed version.`
          : 'No fixed versions are currently reported.',
      tone: vulnerabilitiesWithFix > 0 ? 'warning' : 'default',
      action: () => {
        setActiveTab('vulns');
        setHasFix(true);
      },
      actionLabel: 'Show fixable',
    },
    {
      label: 'Policy blockers',
      value: complianceViolationRows.length + xrayPolicyMatches,
      detail:
        complianceViolationRows.length + xrayPolicyMatches > 0
          ? 'Policy signals should be resolved or explicitly accepted.'
          : 'No policy blockers are visible in this scan.',
      tone: complianceViolationRows.length + xrayPolicyMatches > 0 ? 'danger' : 'success',
      action: () => {
        setActiveTab(complianceViolationRows.length > 0 ? 'compliance' : 'vulns');
        setXrayPolicyFirst(xrayPolicyMatches > 0);
        setPolicyFailedOnly(complianceViolationRows.length > 0);
      },
      actionLabel: 'Review policy',
    },
  ] as const;
  const focusSeverityCounts = [
    { label: 'Critical', value: scan.critical_count, className: 'text-red-400' },
    { label: 'High', value: scan.high_count, className: 'text-orange-400' },
    { label: 'Medium', value: scan.medium_count, className: 'text-yellow-400' },
    { label: 'Low', value: scan.low_count, className: 'text-blue-400' },
  ];
  const focusLead =
    scan.external_status === 'blocked_by_xray_policy'
      ? 'Xray blocked this artifact before the normal scan completion path.'
      : criticalAndHigh > 0
        ? 'Start with critical and high findings before moving into broader cleanup.'
        : vulnerabilitiesWithFix > 0
          ? 'No critical/high exposure in this view. Apply available fixes next.'
          : 'This scan has no urgent remediation signal in the current view.';

  const headerActions = (
    <div className="relative flex flex-wrap items-center justify-end gap-2">
      <Button className="btn-secondary" onPress={() => router.back()} variant="secondary">
        <ArrowLeft01Icon size={15} />
        Back to scans
      </Button>
      {isScanInProgress && (
        <Button
          className="bg-warning-soft-hover text-warning"
          isDisabled={cancelling || !canMutateCurrentScan}
          onPress={handleCancel}
          variant="primary"
        >
          {cancelling ? (
            <span className="size-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          ) : (
            <Cancel01Icon size={15} />
          )}
          Cancel
        </Button>
      )}
      {canRefreshXrayPolicy && (
        <Button
          className="btn-secondary"
          isDisabled={xrayPolicyRefreshing || !canMutateCurrentScan}
          onPress={handleRefreshXrayPolicy}
          variant="secondary"
        >
          {xrayPolicyRefreshing ? (
            <span className="size-3.5 border-2 border-zinc-400/30 border-t-zinc-400 rounded-full animate-spin" />
          ) : (
            <Refresh01Icon size={15} />
          )}
          Refresh Xray policy
        </Button>
      )}
      <Button
        className="btn-primary"
        isDisabled={
          reScanning || !canMutateCurrentScan || isScanInProgress || Boolean(rescanDisabledReason)
        }
        onPress={handleReScan}
        variant="primary"
      >
        {reScanning ? (
          <span className="size-3.5 border-2 border-accent-400/30 border-t-accent-400 rounded-full animate-spin" />
        ) : (
          <Refresh01Icon size={15} />
        )}
        Re-scan
      </Button>
      <div className="relative">
        <Dropdown>
          <Dropdown.Trigger>
            <Button
              aria-label="Open scan actions"
              className="btn-icon-subtle size-10"
              isIconOnly
              style={
                shareModal.isOpen
                  ? {
                      color: 'color-mix(in srgb, var(--accent) 78%, white)',
                      borderColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
                    }
                  : undefined
              }
              variant="secondary"
            >
              <MoreVerticalIcon size={16} />
            </Button>
          </Dropdown.Trigger>
          <Dropdown.Popover className="min-w-[220px]">
            <Dropdown.Menu
              onAction={(key: any) => {
                if (key === 'export') {
                  window.open(`/reports/print?scans=${scan.id}`, '_blank', 'noopener,noreferrer');
                }
                if (key === 'compare') {
                  void handleComparePrev();
                }
                if (key === 'manage_access') {
                  if (!canManageScanAccess()) return;
                  openScanAccessModal();
                }
                if (key === 'share') {
                  if (!canManageScanAccess()) return;
                  if (scan.share_visibility)
                    setShareVisibility(scan.share_visibility as 'public' | 'authenticated');
                  shareModal.open();
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
              {canManageScanAccess() ? (
                <Dropdown.Item id="manage_access" textValue="Manage scan access">
                  <div className="flex items-center gap-2">
                    <Shield01Icon size={15} />
                    <Label>Manage Access</Label>
                  </div>
                </Dropdown.Item>
              ) : null}
              {canManageScanAccess() ? (
                <Dropdown.Item id="share" textValue="Manage scan sharing">
                  <div className="flex items-center gap-2">
                    <Share01Icon size={15} />
                    <Label>{scan.share_token ? 'Manage share' : 'Share'}</Label>
                  </div>
                </Dropdown.Item>
              ) : null}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        {scan.share_token ? (
          <Tooltip delay={0}>
            <Tooltip.Trigger
              aria-label={`Shared scan (${scan.share_visibility === 'authenticated' ? 'signed in' : 'public'})`}
              className="absolute -right-0.5 -top-0.5 z-10 inline-block size-2.5 rounded-full bg-success ring-2 ring-[var(--app-bg)]"
            />
            <Tooltip.Content placement="top" showArrow>
              {scan.share_visibility === 'authenticated'
                ? 'Shared scan: only signed-in users can open the link'
                : 'Shared scan: anyone with the link can open it'}
            </Tooltip.Content>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={`${scan.image_name}:${scan.image_tag}`}
        description={
          scan.image_digest ||
          'Inspect vulnerability results, runtime signals, and sharing controls for this scan.'
        }
        actions={headerActions}
      />
      {rescanDisabledReason ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Re-scan disabled</Alert.Title>
            <Alert.Description>{rescanDisabledReason}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Modal state={shareModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="sm" placement="center">
            <Modal.Dialog className="surface-modal rounded-2xl overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Share scan
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {scan.share_token ? (
                  <>
                    <div>
                      <p className="mb-1.5 text-xs text-zinc-500">
                        Share link
                        <span
                          className="ml-1.5 rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            background:
                              scan.share_visibility === 'public'
                                ? 'rgba(34,197,94,0.1)'
                                : 'color-mix(in srgb, var(--accent) 10%, transparent)',
                            color:
                              scan.share_visibility === 'public'
                                ? '#4ade80'
                                : 'color-mix(in srgb, var(--accent) 78%, white)',
                            border: `1px solid ${scan.share_visibility === 'public' ? 'rgba(34,197,94,0.2)' : 'color-mix(in srgb, var(--accent) 20%, transparent)'}`,
                          }}
                        >
                          {scan.share_visibility}
                        </span>
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded-lg bg-zinc-100 px-2 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
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
                        onChange={(next) => {
                          if (!canManageScanAccess()) return;
                          setShareVisibility(next);
                        }}
                        size="sm"
                      />
                      {shareVisibility !== scan.share_visibility && (
                        <Button
                          className="btn-primary w-full"
                          isDisabled={shareLoading || !canManageScanAccess()}
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
                      isDisabled={shareLoading || !canManageScanAccess()}
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
                        onChange={(next) => {
                          if (!canManageScanAccess()) return;
                          setShareVisibility(next);
                        }}
                        size="sm"
                      />
                      <p className="text-xs leading-relaxed text-zinc-400">
                        {shareVisibility === 'public'
                          ? 'Anyone with the link can view this scan.'
                          : 'Only signed-in users can view this scan.'}
                      </p>
                    </div>
                    <Button
                      className="btn-primary w-full"
                      isDisabled={shareLoading || !canManageScanAccess()}
                      onPress={handleEnableShare}
                      type="button"
                      variant="primary"
                    >
                      {shareLoading ? 'Creating link…' : 'Create share link'}
                    </Button>
                  </>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {scan.status !== 'pending' && scan.status !== 'running' && (
        <Card className="overflow-hidden">
          <Card.Content className="gap-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={scan.status} externalStatus={scan.external_status} />
                  <Chip color={dominantSeverity.value > 0 ? 'warning' : 'success'} variant="soft">
                    Dominant: {dominantSeverity.label}
                  </Chip>
                  {xrayPolicyMatches > 0 ? (
                    <Chip color="warning" variant="soft">
                      {xrayPolicyMatches} Xray signal{xrayPolicyMatches === 1 ? '' : 's'}
                    </Chip>
                  ) : null}
                </div>
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                    Remediation focus
                  </h2>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{focusLead}</p>
                  {scan.external_status === 'blocked_by_xray_policy' && blockedPolicyDetails ? (
                    <p className="mt-2 max-w-3xl text-xs leading-relaxed text-warning">
                      {blockedPolicyDetails.summary}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 xl:min-w-[28rem]">
                {focusSeverityCounts.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl px-3 py-2"
                    style={{ background: 'var(--surface-secondary)' }}
                  >
                    <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted">
                      {item.label}
                    </p>
                    <p className={`mt-1 text-lg font-semibold tabular-nums ${item.className}`}>
                      {item.value ?? 0}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-2 lg:grid-cols-3">
              {remediationItems.map((item) => (
                <button
                  key={item.label}
                  className="group rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={item.value === 0}
                  onClick={item.action}
                  style={{ background: 'var(--surface-secondary)' }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-muted">
                        {item.label}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted">{item.detail}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-lg font-semibold tabular-nums text-foreground">
                        {item.value}
                      </span>
                      {item.value > 0 ? (
                        <span className="text-xs font-medium text-accent transition-transform group-hover:translate-x-0.5">
                          Open →
                        </span>
                      ) : (
                        <Chip color="success" size="sm" variant="soft">
                          Clear
                        </Chip>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </Card.Content>
        </Card>
      )}

      {/* Scanner info moved to Details tab */}

      {/* Error banner - shown when scan failed outside the Xray policy summary */}
      {scan.status === 'failed' &&
        scan.error_message &&
        scan.external_status !== 'blocked_by_xray_policy' && (
          <ScanFailureAlert
            errorMessage={scan.error_message}
            imageReference={`${scan.image_name}:${scan.image_tag}`}
          />
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
                {
                  id: 'compliance',
                  label: `Compliance (${complianceViolationRows.length})`,
                },
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
          scanId={scan.id}
          stepLogs={scan.step_logs}
          completedAt={scan.completed_at}
          status={scan.status}
          externalStatus={scan.external_status}
          scanProvider={scan.scan_provider}
        />
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
              onChange={(e: any) => setSbomNameInput(e.target.value)}
              placeholder="Filter by name..."
              className="min-w-0 md:flex-1"
              containerClassName="min-w-0 md:flex-1"
            />
            <Select
              value={sbomTypeFilter || '__all__'}
              onChange={(value: any) => {
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
                                <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
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
                          <Table.Cell className=" text-xs text-zinc-700 dark:text-zinc-200">
                            {c.name}
                          </Table.Cell>
                          <Table.Cell className=" text-xs text-zinc-500">
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
                          <Table.Cell className=" text-xs text-zinc-400 max-w-xs truncate">
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
        <Card className="overflow-hidden">
          <Card.Header className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                  Vulnerabilities
                  {vulnTotal > 0 && (
                    <span className="text-sm font-normal text-zinc-500 ml-2">
                      {vulnTotal} found
                    </span>
                  )}
                </h2>
                <p className="text-[11px] text-zinc-500 mt-1">
                  {viewSettingsReady
                    ? `${vulnerabilityViewSourceLabel}: ${vulnerabilityViewSummary(currentVulnerabilityViewSettings)}`
                    : 'Loading default view...'}
                </p>
                {triageFocusActive && (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Triage focus is showing open critical and high vulnerabilities with fixes so
                    you can acknowledge them quickly.
                  </p>
                )}
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
                    !viewSettingsReady ||
                    viewPreferenceSaving ||
                    (!vulnerabilityViewHasChanges && !hasTransientVulnerabilityFilters)
                  }
                  onPress={() => resetToSavedVulnerabilityView()}
                  variant="secondary"
                >
                  Reset to saved
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
            </div>

            <Card variant="secondary" className="flex flex-col gap-3 p-3">
              <div className="w-full overflow-x-auto pb-1">
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
                      background: withPalette.color ?? 'var(--color-accent-soft)',
                      color: withPalette.activeColor ?? 'var(--color-accent)',
                      borderColor: withPalette.border ?? 'var(--color-accent-soft-hover)',
                    };
                  }}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_160px_150px_120px_minmax(360px,auto)]">
                <SearchField name="scan-vuln-search" className="min-w-0 w-full">
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      placeholder="Search package..."
                      value={pkgInput}
                      onChange={(event: any) => setPkgInput(event.target.value)}
                    />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <SearchField name="scan-vuln-cve-search" className="min-w-0 w-full">
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input
                      placeholder="Search CVE (e.g. CVE-2026-31789)..."
                      value={cveInput}
                      onChange={(event: any) => setCveInput(event.target.value)}
                    />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <Select
                  aria-label="Sort vulnerabilities by"
                  value={sortBy}
                  className="w-full"
                  onChange={(value: any) => {
                    setSortBy(value as VulnerabilityViewSettings['sort_by']);
                    setPage(1);
                  }}
                >
                  <Select.Trigger className={`${selectTriggerCls} h-11`}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="vuln_id">CVE ID</ListBox.Item>
                      <ListBox.Item id="pkg_name">Package</ListBox.Item>
                      <ListBox.Item id="severity">Severity</ListBox.Item>
                      <ListBox.Item id="cvss_score">CVSS</ListBox.Item>
                      <ListBox.Item id="installed_version">Installed</ListBox.Item>
                      <ListBox.Item id="fixed_version">Fixed In</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select
                  aria-label="Sort direction"
                  value={sortDir}
                  className="w-full"
                  onChange={(value: any) => {
                    setSortDir(value as VulnerabilityViewSettings['sort_dir']);
                    setPage(1);
                  }}
                >
                  <Select.Trigger className={`${selectTriggerCls} h-11`}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="asc">Ascending</ListBox.Item>
                      <ListBox.Item id="desc">Descending</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
                <FormField
                  hideLabel
                  label="Minimum CVSS"
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={minCvss || ''}
                  placeholder="Min CVSS"
                  onChange={(e: any) => {
                    const val = parseFloat(e.target.value);
                    setMinCvss(!isNaN(val) ? val : 0);
                    setPage(1);
                  }}
                  className="w-full h-11 bg-surface"
                  containerClassName="w-full"
                />
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:col-span-2 2xl:col-span-1 2xl:grid-cols-4">
                  <Button
                    onPress={() => {
                      setHasFix(!hasFix);
                      setPage(1);
                    }}
                    className="min-w-0 w-full"
                    variant={hasFix ? 'primary' : 'secondary'}
                  >
                    Has Fix
                  </Button>
                  <Button
                    onPress={() => {
                      setHideSuppressed(!hideSuppressed);
                      setPage(1);
                    }}
                    className="min-w-0 w-full"
                    variant={hideSuppressed ? 'primary' : 'secondary'}
                  >
                    Hide Acknowledged
                  </Button>
                  <Button
                    onPress={() => {
                      setXrayPolicyFirst(!xrayPolicyFirst);
                      setPage(1);
                    }}
                    className={`${xrayPolicyFirst ? 'btn-primary' : 'btn-secondary'} min-w-0 w-full`}
                    variant={xrayPolicyFirst ? 'primary' : 'secondary'}
                  >
                    Xray Policy First
                  </Button>
                  <Button
                    onPress={() => {
                      setPolicyFailedOnly(!policyFailedOnly);
                      setPage(1);
                    }}
                    isDisabled={workScope.kind !== 'org'}
                    className={`${policyFailedOnly && workScope.kind === 'org' ? 'btn-primary' : 'btn-secondary'} min-w-0 w-full`}
                    variant={policyFailedOnly && workScope.kind === 'org' ? 'primary' : 'secondary'}
                  >
                    Policy Failed
                  </Button>
                </div>
              </div>
            </Card>

            <Card variant="secondary" className="p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Vulnerability Radar
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500">
                    Filtered results ({vulnTotal} rows)
                  </span>
                  <Button
                    className="btn-secondary h-7 px-2 text-[11px]"
                    variant="secondary"
                    onPress={() => {
                      const next = !isVulnerabilityRadarCollapsed;
                      setIsVulnerabilityRadarCollapsed(next);
                      if (typeof window !== 'undefined') {
                        window.localStorage.setItem(radarPreferenceKey, next ? '1' : '0');
                      }
                    }}
                  >
                    {isVulnerabilityRadarCollapsed ? 'Show' : 'Hide'}
                  </Button>
                </div>
              </div>
              {!isVulnerabilityRadarCollapsed && (
                <div className="grid gap-3 lg:grid-cols-[minmax(320px,520px)_1fr] lg:items-center">
                  <EvilRadarChart
                    data={vulnerabilityRadarData}
                    className="mx-auto h-[240px] w-full max-w-[520px] min-h-[240px] flex-none"
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                    <Card className="p-2.5">
                      <p className="text-[11px] text-zinc-500">Dominant Severity</p>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {dominantSeverity.label}
                      </p>
                    </Card>
                    <Card className="p-2.5">
                      <p className="text-[11px] text-zinc-500">Critical + High</p>
                      <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                        {criticalAndHigh}
                      </p>
                    </Card>
                    <Card className="p-2.5">
                      <p className="text-[11px] text-zinc-500">Fix Coverage</p>
                      <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {fixCoveragePercent}%
                      </p>
                    </Card>
                    <Card className="p-2.5">
                      <p className="text-[11px] text-zinc-500">No Known Fix</p>
                      <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                        {vulnerabilitiesWithoutFix}
                      </p>
                    </Card>
                    <Card className="p-2.5">
                      <p className="text-[11px] text-zinc-500">Xray Policy Matches</p>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {xrayPolicyMatches}
                      </p>
                    </Card>
                    <Card className="p-2.5">
                      <p className="text-[11px] text-zinc-500">Policy Match Rate</p>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {xrayPolicyPercent}%
                      </p>
                    </Card>
                  </div>
                </div>
              )}
            </Card>
          </Card.Header>

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
                        style={{ color: active ? 'var(--color-accent)' : undefined }}
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
                  <Table.Column className="text-left">First Seen</Table.Column>
                  <Table.Column className="text-left">Org Policy</Table.Column>
                  <Table.Column className="text-left">Xray Policy</Table.Column>
                  <Table.Column className="text-right">Suppr. & Notes</Table.Column>
                </Table.Header>
                <Table.Body>
                  {vulnLoading || vulns.length === 0 ? (
                    <Table.Row key="vuln-state" id="vuln-state">
                      <Table.Cell colSpan={10}>
                        {vulnLoading ? (
                          <div className="py-12 text-center">
                            <div className="flex justify-center">
                              <div className="size-6 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent animate-spin" />
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
                    vulns.map((v) => {
                      const failedPolicies =
                        orgPolicyFailuresByVuln[normalizeVulnId(v.vuln_id)] ?? [];
                      const hasPolicyFailure = failedPolicies.length > 0;

                      return (
                        <Fragment key={v.id}>
                          <Table.Row
                            id={v.id}
                            className="hover:bg-[var(--row-hover)]"
                            style={
                              hasPolicyFailure
                                ? {
                                    background: 'rgba(239,68,68,0.05)',
                                    borderTop: '1px solid rgba(239,68,68,0.12)',
                                    borderBottom: '1px solid rgba(239,68,68,0.12)',
                                  }
                                : undefined
                            }
                          >
                            <Table.Cell>
                              {v.vuln_id ? (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <button
                                    type="button"
                                    onClick={() => openVulnerabilityDetails(v)}
                                    className=" text-xs text-accent hover:text-accent/80 hover:underline transition-colors"
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
                            <Table.Cell className=" text-xs text-zinc-700 dark:text-zinc-300">
                              {v.pkg_name}
                            </Table.Cell>
                            <Table.Cell className=" text-xs text-zinc-500">
                              {v.installed_version}
                            </Table.Cell>
                            <Table.Cell className=" text-xs text-emerald-500">
                              {v.fixed_version || (
                                <span className="text-zinc-400 dark:text-zinc-700">-</span>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <SeverityBadge severity={v.severity} />
                            </Table.Cell>
                            <Table.Cell className="text-right  text-xs text-zinc-500">
                              {v.cvss_score ? v.cvss_score.toFixed(1) : '-'}
                            </Table.Cell>
                            <Table.Cell>
                              <FirstSeenBadge firstSeenAt={v.first_seen_at} />
                            </Table.Cell>
                            <Table.Cell>
                              {hasPolicyFailure ? (
                                <Tooltip delay={0}>
                                  <Tooltip.Trigger className="inline-flex">
                                    <Chip color="danger" size="sm" variant="soft">
                                      Policy failed
                                    </Chip>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content placement="top" showArrow>
                                    <div className="max-w-xs space-y-2 p-0.5">
                                      {failedPolicies.map((policy) => (
                                        <div key={policy.name} className="space-y-1">
                                          <p className="text-xs font-semibold text-zinc-100">
                                            {policy.name}
                                          </p>
                                          {policy.ruleSummaries.length > 0 ? (
                                            <div className="space-y-0.5">
                                              {policy.ruleSummaries.map((rule) => (
                                                <p
                                                  key={`${policy.name}-${rule}`}
                                                  className="text-[11px] text-zinc-300"
                                                >
                                                  {rule}
                                                </p>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      ))}
                                    </div>
                                  </Tooltip.Content>
                                </Tooltip>
                              ) : (
                                <span className="text-xs text-zinc-400">-</span>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              {(() => {
                                const policyMatches = parseXrayWatchPolicyMatches(v);
                                const watchCount = xrayWatchNames(v).length;
                                const hasDetails =
                                  policyMatches.length > 0 ||
                                  watchCount > 0 ||
                                  !!v.xray_is_blocking;
                                if (!hasDetails) {
                                  return <span className="text-xs text-zinc-400">-</span>;
                                }

                                return (
                                  <Button
                                    onPress={() => openXrayPolicyDetails(v)}
                                    className="inline-flex items-center gap-1.5"
                                    variant="danger-soft"
                                  >
                                    Details
                                    <Chip
                                      className="font-semibold"
                                      color="danger"
                                      size="sm"
                                      variant="soft"
                                    >
                                      {policyMatches.length || watchCount}
                                    </Chip>
                                  </Button>
                                );
                              })()}
                            </Table.Cell>
                            <Table.Cell className="text-right">
                              <Button
                                onPress={() => {
                                  setExpandedVuln(expandedVuln === v.id ? null : v.id);
                                  setCommentText('');
                                }}
                                className="inline-flex items-center gap-1 text-zinc-400 dark:text-zinc-500 hover:text-accent transition-colors"
                                variant="secondary"
                              >
                                <Comment01Icon size={15} />
                                {v.comments && v.comments.length > 0 && (
                                  <span
                                    className="text-xs rounded-full px-1.5 py-0.5 font-medium"
                                    style={{
                                      background: 'var(--color-accent-soft)',
                                      color: 'var(--color-accent)',
                                    }}
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
                                colSpan={10}
                                className="p-4"
                                style={{
                                  borderTop: '1px solid var(--border-subtle)',
                                  background: 'var(--row-hover)',
                                }}
                              >
                                <div className="w-full space-y-4 xl:grid xl:grid-cols-12 xl:gap-4 xl:space-y-0">
                                  {/* Suppression section */}
                                  {scan.image_digest && (
                                    <Card
                                      className="overflow-hidden xl:col-span-8"
                                      variant="secondary"
                                    >
                                      <Card.Header className="flex-row items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                          <ShieldKeyIcon size={13} className="text-zinc-400" />
                                          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                                            Suppression
                                          </span>
                                        </div>
                                        {v.suppression && (
                                          <Chip color="danger" size="sm" variant="soft">
                                            {v.suppression.status.replace(/_/g, ' ')}
                                          </Chip>
                                        )}
                                      </Card.Header>
                                      <Card.Content className="space-y-3">
                                        {v.suppression ? (
                                          <Card variant="default">
                                            <Card.Content className="space-y-3 p-3">
                                              <p className="text-sm text-zinc-300">
                                                {v.suppression.justification ||
                                                  'No justification provided.'}
                                              </p>
                                              <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <SuppressionSourceBadge
                                                    source={v.suppression.source}
                                                  />
                                                  <OwnershipBadge
                                                    ownerType={v.suppression.owner_type}
                                                    ownerOrgId={v.suppression.owner_org_id}
                                                    orgNamesById={orgNamesById}
                                                  />
                                                  {v.suppression.read_only && (
                                                    <Chip size="sm" variant="soft">
                                                      Managed by Xray
                                                    </Chip>
                                                  )}
                                                </div>
                                                {canManageSuppressionAccess(v.suppression) && (
                                                  <Button
                                                    onPress={() =>
                                                      openSuppressionAccess(
                                                        v.suppression as Suppression
                                                      )
                                                    }
                                                    size="sm"
                                                    className="inline-flex items-center gap-1"
                                                    type="button"
                                                    variant="secondary"
                                                  >
                                                    <Shield01Icon size={12} />
                                                    Manage Access
                                                  </Button>
                                                )}
                                              </div>
                                              <div className="grid gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                                                {v.suppression.expires_at && (
                                                  <p>
                                                    Expires:{' '}
                                                    {new Date(
                                                      v.suppression.expires_at
                                                    ).toLocaleDateString()}
                                                  </p>
                                                )}
                                                {(v.suppression.xray_policy_name ||
                                                  v.suppression.xray_watch_name) && (
                                                  <p>
                                                    {[
                                                      v.suppression.xray_policy_name,
                                                      v.suppression.xray_watch_name,
                                                    ]
                                                      .filter(Boolean)
                                                      .join(' · ')}
                                                  </p>
                                                )}
                                                {v.suppression.username && (
                                                  <p>By: {v.suppression.username}</p>
                                                )}
                                              </div>
                                            </Card.Content>
                                          </Card>
                                        ) : (
                                          <p className="text-sm text-zinc-500">
                                            No suppression exists for this vulnerability yet.
                                          </p>
                                        )}

                                        {canMutateCurrentScan &&
                                        !(
                                          v.suppression?.read_only ||
                                          v.suppression?.source === 'xray'
                                        ) &&
                                        !(
                                          v.suppression?.owner_type === 'system' && !isPlatformAdmin
                                        ) ? (
                                          <Card variant="default">
                                            <Card.Content className="space-y-3 p-3">
                                              <div className="grid gap-2 sm:grid-cols-2">
                                                <Select
                                                  value={suppressStatus}
                                                  onChange={(value: any) =>
                                                    setSuppressStatus(
                                                      value as Suppression['status']
                                                    )
                                                  }
                                                  isDisabled={!canMutateCurrentScan}
                                                  variant="secondary"
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
                                                <Select
                                                  value={suppressScope}
                                                  onChange={(value: any) =>
                                                    setSuppressScope(
                                                      (value as
                                                        | 'personal'
                                                        | 'workspace'
                                                        | 'global') ??
                                                        (workScope.kind === 'org'
                                                          ? 'workspace'
                                                          : 'personal')
                                                    )
                                                  }
                                                  variant="secondary"
                                                  isDisabled={Boolean(v.suppression)}
                                                >
                                                  <Select.Trigger>
                                                    <Select.Value />
                                                    <Select.Indicator />
                                                  </Select.Trigger>
                                                  <Select.Popover>
                                                    <ListBox>
                                                      <ListBox.Item id="personal">
                                                        Personal
                                                      </ListBox.Item>
                                                      {(workScope.kind === 'org' ||
                                                        suppressScope === 'workspace') && (
                                                        <ListBox.Item id="workspace">
                                                          {workScope.kind === 'org' &&
                                                          workScope.orgName
                                                            ? `Workspace: ${workScope.orgName}`
                                                            : 'Organization workspace'}
                                                        </ListBox.Item>
                                                      )}
                                                      {isPlatformAdmin && (
                                                        <ListBox.Item id="global">
                                                          Global (all workspaces)
                                                        </ListBox.Item>
                                                      )}
                                                    </ListBox>
                                                  </Select.Popover>
                                                </Select>
                                              </div>
                                              <FormField
                                                hideLabel
                                                label="Suppression justification"
                                                type="text"
                                                value={suppressJustification}
                                                onChange={(e: any) =>
                                                  setSuppressJustification(e.target.value)
                                                }
                                                placeholder="Suppression justification"
                                                className="w-full"
                                                containerClassName="w-full"
                                                disabled={!canMutateCurrentScan}
                                              />
                                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <span className="text-xs text-zinc-500">
                                                  {suppressScope === 'global'
                                                    ? 'Visible in all workspaces.'
                                                    : suppressScope === 'workspace'
                                                      ? 'Visible in the selected organization workspace.'
                                                      : 'Visible only in your personal workspace unless shared later.'}
                                                </span>
                                                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                                                  <DatePicker
                                                    aria-label="Expiry date (optional)"
                                                    value={suppressExpiry}
                                                    onChange={setSuppressExpiry}
                                                    className="w-64"
                                                    isDisabled={!canMutateCurrentScan}
                                                  >
                                                    <DateField.Group
                                                      className={`${inputCls} flex min-h-10 items-center justify-between gap-1`}
                                                    >
                                                      <DateField.Input>
                                                        {(seg: any) => (
                                                          <DateField.Segment segment={seg} />
                                                        )}
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
                                                            {(day: any) => (
                                                              <Calendar.HeaderCell>
                                                                {day}
                                                              </Calendar.HeaderCell>
                                                            )}
                                                          </Calendar.GridHeader>
                                                          <Calendar.GridBody>
                                                            {(date: any) => (
                                                              <Calendar.Cell date={date} />
                                                            )}
                                                          </Calendar.GridBody>
                                                        </Calendar.Grid>
                                                        <Calendar.YearPickerGrid>
                                                          <Calendar.YearPickerGridBody>
                                                            {({ year }: any) => (
                                                              <Calendar.YearPickerCell
                                                                year={year}
                                                              />
                                                            )}
                                                          </Calendar.YearPickerGridBody>
                                                        </Calendar.YearPickerGrid>
                                                      </Calendar>
                                                    </DatePicker.Popover>
                                                  </DatePicker>
                                                  <Button
                                                    onPress={() => handleSuppress(v)}
                                                    isDisabled={
                                                      suppressSaving ||
                                                      !suppressJustification.trim() ||
                                                      !canMutateCurrentScan
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
                                                      isDisabled={
                                                        suppressSaving || !canMutateCurrentScan
                                                      }
                                                      className="btn-secondary shrink-0"
                                                      type="button"
                                                      variant="secondary"
                                                    >
                                                      Remove
                                                    </Button>
                                                  )}
                                                </div>
                                              </div>
                                              {suppressError && (
                                                <p className="text-xs text-red-400">
                                                  {suppressError}
                                                </p>
                                              )}
                                            </Card.Content>
                                          </Card>
                                        ) : (
                                          <Card variant="default">
                                            <Card.Content className="p-3">
                                              <p className="text-xs text-zinc-500">
                                                {canMutateCurrentScan
                                                  ? v.suppression?.owner_type === 'system'
                                                    ? 'This is a global suppression. Only platform admins can edit it here.'
                                                    : 'This suppression comes from Xray and cannot be edited here.'
                                                  : 'Your role has read-only suppression access in this organization.'}
                                              </p>
                                            </Card.Content>
                                          </Card>
                                        )}
                                      </Card.Content>
                                    </Card>
                                  )}

                                  {/* Notes / Comments */}
                                  <Card
                                    className={`overflow-hidden xl:h-full ${scan.image_digest ? 'xl:col-span-4' : 'xl:col-span-12'}`}
                                    variant="secondary"
                                  >
                                    <Card.Header className="flex-row items-center justify-between gap-3">
                                      <div className="flex items-center gap-2">
                                        <Comment01Icon size={13} className="text-zinc-400" />
                                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                                          Notes
                                        </span>
                                      </div>
                                      <Chip size="sm" variant="soft">
                                        {v.comments?.length ?? 0} note
                                        {(v.comments?.length ?? 0) === 1 ? '' : 's'}
                                      </Chip>
                                    </Card.Header>
                                    <Card.Content className="space-y-3">
                                      {v.comments && v.comments.length > 0 ? (
                                        <div className="space-y-2">
                                          {v.comments.map((c) => (
                                            <Card key={c.id} variant="default">
                                              <Card.Content className="p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                  <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                      <span className="text-xs font-semibold text-zinc-300">
                                                        {c.username || 'You'}
                                                      </span>
                                                      <span
                                                        className="text-xs text-zinc-500"
                                                        title={fullDate(c.created_at)}
                                                      >
                                                        {timeAgo(c.created_at)}
                                                      </span>
                                                    </div>
                                                    <p className="mt-1 text-sm text-zinc-400">
                                                      {c.content}
                                                    </p>
                                                  </div>
                                                  {currentUser?.id === c.user_id && (
                                                    <Button
                                                      onPress={() => handleDeleteComment(c.id)}
                                                      className="shrink-0"
                                                      isIconOnly
                                                      variant="secondary"
                                                    >
                                                      <Delete02Icon size={14} />
                                                    </Button>
                                                  )}
                                                </div>
                                              </Card.Content>
                                            </Card>
                                          ))}
                                        </div>
                                      ) : (
                                        <Card variant="default">
                                          <Card.Content className="p-3">
                                            <p className="text-sm text-zinc-500">
                                              No notes yet. Add context for teammates here.
                                            </p>
                                          </Card.Content>
                                        </Card>
                                      )}
                                      <div className="space-y-2">
                                        <TextArea
                                          className="w-full"
                                          value={commentText}
                                          onChange={(e: any) => setCommentText(e.target.value)}
                                          placeholder="Add a note..."
                                          rows={3}
                                        />
                                        <div className="flex justify-end">
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
                                    </Card.Content>
                                  </Card>
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          <Table.Footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              Showing {vulnTotal === 0 ? 0 : (page - 1) * LIMIT + 1}-
              {Math.min(page * LIMIT, vulnTotal)} of {vulnTotal}
            </span>
            <Pagination size="sm" className="justify-self-center">
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={page === 1}
                    onPress={() => setPage((previous) => Math.max(1, previous - 1))}
                  >
                    <Pagination.PreviousIcon />
                    <span>Previous</span>
                  </Pagination.Previous>
                </Pagination.Item>
                {vulnPaginationItems.map((item, index) =>
                  item === 'ellipsis' ? (
                    <Pagination.Item key={`vuln-ellipsis-${index}`}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  ) : (
                    <Pagination.Item key={`vuln-page-${item}`}>
                      <Pagination.Link isActive={item === page} onPress={() => setPage(item)}>
                        {item}
                      </Pagination.Link>
                    </Pagination.Item>
                  )
                )}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={page === totalPages}
                    onPress={() => setPage((previous) => Math.min(totalPages, previous + 1))}
                  >
                    <span>Next</span>
                    <Pagination.NextIcon />
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
            </Pagination>
            <div />
          </Table.Footer>
        </Card>
      )}

      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'compliance' && (
        <div className="space-y-4">
          <Card>
            <Card.Content className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Non-compliant findings
                </p>
                <Button
                  onPress={handleReEvaluate}
                  isDisabled={complianceLoading || !canMutateCurrentScan}
                  className="text-xs text-zinc-500 hover:text-accent transition-colors disabled:opacity-40"
                  variant="secondary"
                >
                  {complianceLoading ? '…' : 'Re-evaluate'}
                </Button>
              </div>
              <div className="flex gap-2">
                <Select
                  value={selectedOrgToAssign || '__none__'}
                  onChange={(value: any) =>
                    setSelectedOrgToAssign(String(value === '__none__' ? '' : (value ?? '')))
                  }
                  className="flex-1"
                  isDisabled={!canMutateCurrentScan}
                >
                  <Select.Trigger className="bg-surface-secondary">
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="__none__">Assign organization</ListBox.Item>
                      {allOrgs
                        .filter((org) => !compliance.some((c) => c.org_id === org.id))
                        .map((org) => (
                          <ListBox.Item key={org.id} id={org.id}>
                            {org.name}
                          </ListBox.Item>
                        ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Button
                  className="btn-primary"
                  variant="primary"
                  isDisabled={!selectedOrgToAssign || !canMutateCurrentScan}
                  onPress={() => {
                    const orgId = selectedOrgToAssign;
                    setSelectedOrgToAssign('');
                    void handleAssignOrg(orgId);
                  }}
                >
                  Add
                </Button>
              </div>
              {complianceByOrg.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {complianceByOrg.map(({ org_id, org_name }) => (
                    <Button
                      key={org_id}
                      className="text-xs"
                      variant="secondary"
                      isDisabled={!canMutateCurrentScan}
                      onPress={() => void handleRemoveOrg(org_id)}
                    >
                      {org_name} ×
                    </Button>
                  ))}
                </div>
              )}
            </Card.Content>
          </Card>

          <Card className="overflow-hidden">
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Compliance violations" className="min-w-[980px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Org</Table.Column>
                    <Table.Column>Policy</Table.Column>
                    <Table.Column>CVE</Table.Column>
                    <Table.Column>Package</Table.Column>
                    <Table.Column>Installed</Table.Column>
                    <Table.Column>Fixed In</Table.Column>
                    <Table.Column>Has Fix</Table.Column>
                    <Table.Column>Rule</Table.Column>
                    <Table.Column>Severity</Table.Column>
                    <Table.Column>Violation</Table.Column>
                    <Table.Column>Evaluated</Table.Column>
                    <Table.Column>Open</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {complianceViolationRows.length === 0 ? (
                      <Table.Row id="compliance-empty">
                        <Table.Cell colSpan={12}>
                          <div className="py-10 text-center text-sm text-zinc-500">
                            No non-compliant violations.
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      complianceViolationRows.map((row) => (
                        <Table.Row key={row.id} id={row.id}>
                          <Table.Cell className="text-xs text-zinc-700 dark:text-zinc-300">
                            {row.orgName}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-700 dark:text-zinc-300">
                            {row.policyName}
                          </Table.Cell>
                          <Table.Cell className="text-xs">
                            {row.vulnId ? (
                              <button
                                type="button"
                                className="text-accent hover:text-accent/80 hover:underline"
                                onClick={() => {
                                  if (row.primaryMatch) {
                                    openVulnerabilityDetails(row.primaryMatch);
                                  }
                                }}
                              >
                                {row.matchCount > 1
                                  ? `${row.vulnId} (+${row.matchCount - 1})`
                                  : row.vulnId}
                              </button>
                            ) : (
                              <span className="text-zinc-400">-</span>
                            )}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-700 dark:text-zinc-300">
                            {row.packageName || '-'}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {row.installedVersion || '-'}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {row.fixedVersion || '-'}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {row.hasFix ? 'Yes' : 'No'}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {row.ruleType || '-'}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {row.severity || '-'}
                          </Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">{row.message}</Table.Cell>
                          <Table.Cell className="text-xs text-zinc-500">
                            {timeAgo(row.evaluatedAt)}
                          </Table.Cell>
                          <Table.Cell>
                            {row.primaryMatch ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-xs"
                                onPress={() => openVulnerabilityDetails(row.primaryMatch!)}
                              >
                                Open details
                              </Button>
                            ) : (
                              <span className="text-xs text-zinc-400">-</span>
                            )}
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

      {/* Details tab */}
      {scan.status !== 'pending' && scan.status !== 'running' && activeTab === 'details' && (
        <div className="space-y-4">
          <div className="space-y-3">
            <p
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              Scan context
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Ownership
                </p>
                <div className="mt-2">
                  <OwnershipBadge
                    ownerType={scan.owner_type}
                    ownerOrgId={scan.owner_org_id}
                    orgNamesById={orgNamesById}
                  />
                </div>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Platform
                </p>
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                  {scan.architecture
                    ? `${scan.architecture} · ${scan.os_family} ${scan.os_name}`
                    : '-'}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Workspace
                </p>
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">
                  {scan.owner_type === 'org' && scan.owner_org_id
                    ? (orgNamesById[scan.owner_org_id] ?? 'Org workspace')
                    : 'Personal'}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Source
                </p>
                {scan.helm_chart ? (
                  <p
                    className="mt-1 break-words text-sm text-zinc-900 dark:text-zinc-100"
                    style={{ overflowWrap: 'anywhere' }}
                    title={scan.helm_source_path}
                  >
                    Helm {scan.helm_chart}
                    {scan.helm_source_path ? ` · ${scan.helm_source_path}` : ''}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">Direct image scan</p>
                )}
              </Card>
            </div>
          </div>

          {/* Scanner info */}
          {(scan.trivy_version ||
            scan.grype_version ||
            scan.trivy_vuln_db_updated_at ||
            scan.trivy_java_db_updated_at) && (
            <div className="space-y-3">
              <p
                className="text-xs font-semibold uppercase tracking-wider mb-2"
                style={{ color: 'var(--text-muted)' }}
              >
                Scanner
              </p>
              <div className="grid gap-3 lg:grid-cols-3">
                <Card className="p-4">
                  <Card.Content className="p-0">
                    <p className="mb-1 text-xs text-zinc-500">Scanner</p>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">
                      Trivy {scan.trivy_version || 'unknown'}
                    </p>
                    {scan.grype_version && (
                      <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">
                        Grype {scan.grype_version}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-zinc-500">
                      {scan.completed_at
                        ? `DB snapshot captured ${timeAgo(scan.completed_at)}`
                        : 'DB snapshot captured when this scan completed'}
                    </p>
                  </Card.Content>
                </Card>
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

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Created
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">
                    {imageCreated || '-'}
                  </p>
                </Card>
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Runtime user
                  </p>
                  <p className="mt-1  text-sm text-zinc-900 dark:text-zinc-100">
                    {imageUser || '-'}
                  </p>
                </Card>
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Working directory
                  </p>
                  <p className="mt-1  text-sm text-zinc-900 dark:text-zinc-100">
                    {imageWorkingDir || '-'}
                  </p>
                </Card>
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Entrypoint
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">
                    {imageEntrypoint.length > 0 ? 'Configured' : 'Not declared'}
                  </p>
                </Card>
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Environment variables
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">
                    {imageEnv.length > 0 ? `${imageEnv.length} captured` : '0 captured'}
                  </p>
                </Card>
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Labels
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">
                    {imageLabelEntries.length > 0
                      ? `${imageLabelEntries.length} captured`
                      : '0 captured'}
                  </p>
                </Card>
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Exposed ports
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">
                    {imageExposedPorts.length > 0
                      ? `${imageExposedPorts.length} declared`
                      : 'None declared'}
                  </p>
                </Card>
                <Card className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Volumes
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">
                    {imageVolumes.length > 0 ? `${imageVolumes.length} declared` : 'None declared'}
                  </p>
                </Card>
              </div>

              <Card className="overflow-hidden">
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
                        <Table.Cell className=" text-xs">{imageUser || '-'}</Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-working-dir">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Working directory
                        </Table.Cell>
                        <Table.Cell className=" text-xs">{imageWorkingDir || '-'}</Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-entrypoint">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Entrypoint
                        </Table.Cell>
                        <Table.Cell className=" text-xs">
                          {imageEntrypoint.length > 0 ? imageEntrypoint.join(' ') : '-'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-command">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Command
                        </Table.Cell>
                        <Table.Cell className=" text-xs">
                          {imageCommand.length > 0 ? imageCommand.join(' ') : '-'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-exposed-ports">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Exposed ports
                        </Table.Cell>
                        <Table.Cell className={imageExposedPorts.length > 0 ? ' text-xs' : ''}>
                          {imageExposedPorts.length > 0
                            ? imageExposedPorts.join(', ')
                            : 'None declared'}
                        </Table.Cell>
                      </Table.Row>
                      <Table.Row id="meta-declared-volumes">
                        <Table.Cell className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                          Declared volumes
                        </Table.Cell>
                        <Table.Cell className={imageVolumes.length > 0 ? ' text-xs' : ''}>
                          {imageVolumes.length > 0 ? imageVolumes.join(', ') : '-'}
                        </Table.Cell>
                      </Table.Row>
                    </Table.Body>
                  </Table.Content>
                </Table>
              </Card>

              <Card className="p-2">
                <Accordion allowsMultipleExpanded hideSeparator className="space-y-2">
                  <Accordion.Item
                    isExpanded={imageEnv.length > 0}
                    className="overflow-hidden rounded-lg"
                  >
                    <Accordion.Heading>
                      <Accordion.Trigger className="rounded-lg px-3 py-2 text-left">
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                            Environment
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            {imageEnv.length} entries
                          </span>
                        </div>
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body className="pt-0">
                        {imageEnv.length > 0 ? (
                          <pre
                            className="overflow-x-auto rounded-xl p-4 text-xs leading-6 text-zinc-700 dark:text-zinc-300"
                            style={{
                              background: 'var(--row-hover)',
                              border: '1px solid var(--surface-border)',
                            }}
                          >
                            {imageEnv.join('\n')}
                          </pre>
                        ) : (
                          <div
                            className="rounded-xl px-3 py-2 text-xs text-zinc-500"
                            style={{
                              background: 'var(--row-hover)',
                              border: '1px solid var(--surface-border)',
                            }}
                          >
                            No environment variables were captured for this image.
                          </div>
                        )}
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item
                    isExpanded={imageLabelEntries.length > 0}
                    className="overflow-hidden rounded-lg"
                  >
                    <Accordion.Heading>
                      <Accordion.Trigger className="rounded-lg px-3 py-2 text-left">
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                            Labels
                          </span>
                          <span className="text-[11px] text-zinc-500">
                            {imageLabelEntries.length} entries
                          </span>
                        </div>
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body className="pt-0">
                        {imageLabelEntries.length > 0 ? (
                          <div className="grid gap-2 sm:grid-cols-2">
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
                                <p className="mt-2 break-all  text-xs text-zinc-700 dark:text-zinc-300">
                                  {value || '-'}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div
                            className="rounded-xl px-3 py-2 text-xs text-zinc-500"
                            style={{
                              background: 'var(--row-hover)',
                              border: '1px solid var(--surface-border)',
                            }}
                          >
                            No labels were captured for this image.
                          </div>
                        )}
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item className="overflow-hidden rounded-lg">
                    <Accordion.Heading>
                      <Accordion.Trigger className="rounded-lg px-3 py-2 text-left">
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                            Raw image config
                          </span>
                          <span className="text-[11px] text-zinc-500">JSON</span>
                        </div>
                      </Accordion.Trigger>
                    </Accordion.Heading>
                    <Accordion.Panel>
                      <Accordion.Body className="pt-0">
                        <pre
                          className="overflow-x-auto rounded-xl p-4 text-xs leading-6 text-zinc-700 dark:text-zinc-300"
                          style={{
                            background: 'var(--row-hover)',
                            border: '1px solid var(--surface-border)',
                          }}
                        >
                          {JSON.stringify(fullImageConfig, null, 2)}
                        </pre>
                      </Accordion.Body>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </Card>
            </div>
          )}

          {allTags.length > 0 && (
            <Card>
              <Card.Content className="space-y-3 p-4">
                <p
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Tags
                </p>
                <div className="flex gap-2">
                  <Select
                    value={selectedTagToAdd || '__none__'}
                    onChange={(value: any) =>
                      setSelectedTagToAdd(String(value === '__none__' ? '' : (value ?? '')))
                    }
                    className="flex-1"
                    isDisabled={!canMutateCurrentScan}
                  >
                    <Select.Trigger className="bg-surface-secondary">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="__none__">Select a tag</ListBox.Item>
                        {allTags
                          .filter((tag) => !(scan.tags ?? []).some((t) => t.id === tag.id))
                          .map((tag) => (
                            <ListBox.Item key={tag.id} id={tag.id}>
                              {tag.name}
                            </ListBox.Item>
                          ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <Button
                    className="btn-primary"
                    variant="primary"
                    isDisabled={!selectedTagToAdd || !canMutateCurrentScan}
                    onPress={() => {
                      const tag = allTags.find((candidate) => candidate.id === selectedTagToAdd);
                      if (!tag) return;
                      setSelectedTagToAdd('');
                      void toggleTag(tag);
                    }}
                  >
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(scan.tags ?? []).length === 0 ? (
                    <span className="text-xs text-zinc-500">No tags assigned.</span>
                  ) : (
                    (scan.tags ?? []).map((tag) => (
                      <Button
                        key={tag.id}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium"
                        variant="secondary"
                        isDisabled={tagLoading === tag.id || !canMutateCurrentScan}
                        onPress={() => void toggleTag(tag)}
                        style={{
                          background: tag.color + '22',
                          color: tag.color,
                          borderColor: tag.color + '50',
                        }}
                      >
                        <span>{tag.name}</span>
                        <span
                          className="inline-flex size-4 items-center justify-center rounded-full text-[11px]"
                          style={{ background: tag.color + '33' }}
                          aria-hidden
                        >
                          ×
                        </span>
                      </Button>
                    ))
                  )}
                </div>
              </Card.Content>
            </Card>
          )}
        </div>
      )}

      <Modal state={scanAccessModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="surface-modal rounded-2xl overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  Manage Scan Access
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="py-5 space-y-4">
                {scanOrgGrantsError ? (
                  <FormAlert description={scanOrgGrantsError} title="Access update failed" />
                ) : null}
                <Card variant="secondary">
                  <div className="flex gap-2">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                      {scan.image_name}:{scan.image_tag}
                    </p>
                    <OwnershipBadge
                      ownerType={scan.owner_type}
                      ownerOrgId={scan.owner_org_id}
                      orgNamesById={orgNamesById}
                    />
                  </div>
                  <p className="text-xs text-zinc-500" title={scan.image_digest}>
                    {scan.image_digest}
                  </p>
                </Card>

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
                      <div className="size-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500 animate-spin" />
                    </div>
                  ) : scanOrgGrants.length === 0 ? (
                    <p className="text-sm text-zinc-500">No organization grants yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {scanOrgGrants.map((share) => (
                        <Card key={share.org_id} className="py-3" variant="secondary">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                {share.org_name}
                              </p>
                              <p className="text-xs text-zinc-500 mt-0.5">
                                {share.is_owner ? 'Owner workspace' : 'Shared access'}
                              </p>
                            </div>
                            <div>
                              {share.is_owner ? (
                                <span className="text-xs font-medium text-zinc-500">Locked</span>
                              ) : (
                                <Button
                                  onPress={() => {
                                    void handleRevokeScanAccess(share.org_id);
                                  }}
                                  isDisabled={scanOrgGrantSaving}
                                  isIconOnly
                                  variant="danger-soft"
                                >
                                  <Delete01Icon size={15} />
                                </Button>
                              )}
                            </div>
                          </div>
                        </Card>
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
                        onChange={(value: any) =>
                          setScanOrgGrantOrgId(String(value === '__none__' ? '' : (value ?? '')))
                        }
                        className="flex-1"
                      >
                        <Select.Trigger className="bg-surface-secondary">
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
              <Modal.Footer>
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

      <ManageSuppressionAccessModal
        state={suppressionAccessModal}
        target={suppressionAccessTarget}
        shares={suppressionAccessShares}
        loading={suppressionAccessLoading}
        error={suppressionAccessError}
        saving={suppressionAccessSaving}
        selectedOrgId={suppressionAccessOrgId}
        onSelectedOrgIdChange={setSuppressionAccessOrgId}
        onGrant={() => {
          void handleGrantSuppressionAccess();
        }}
        onRevoke={(orgId) => {
          void handleRevokeSuppressionAccess(orgId);
        }}
        availableOrgTargets={availableSuppressionShareTargets.map((org) => ({
          id: org.id,
          name: org.name,
        }))}
        orgNamesById={orgNamesById}
        selectTriggerClassName={selectTriggerCls}
      />

      <VulnerabilityDetailsModal
        vulnerability={selectedVulnerability}
        state={vulnerabilityDetailsModal}
        onClose={() => vulnerabilityDetailsModal.close()}
        loadContextAnalysis={(vulnerability) =>
          getVulnerabilityContextAnalysis(id, vulnerability.id)
        }
      />

      <Modal state={xrayPolicyDetailsModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="surface-modal overflow-hidden rounded-[24px] w-[min(900px,calc(100vw-1.5rem))] max-w-none">
              <Modal.Header>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Xray policy details
                  </p>
                  <Modal.Heading className="font-mono text-base font-semibold text-zinc-900 dark:text-white sm:text-lg">
                    {selectedXrayVulnerability?.vuln_id || 'Unnamed finding'}
                  </Modal.Heading>
                </div>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="space-y-4">
                {(() => {
                  if (!selectedXrayVulnerability) {
                    return null;
                  }

                  const watchNames = xrayWatchNames(selectedXrayVulnerability);
                  const policyMatches = parseXrayWatchPolicyMatches(selectedXrayVulnerability);
                  const hasActiveBlocking =
                    selectedXrayVulnerability.xray_is_blocking === true ||
                    policyMatches.some(isActiveXrayPolicyMatch);

                  return (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-zinc-500">Current block state:</span>
                        <Chip
                          className="border text-[11px] font-semibold"
                          style={
                            hasActiveBlocking
                              ? {
                                  borderColor: 'rgba(239,68,68,0.28)',
                                  color: '#f87171',
                                  background: 'rgba(239,68,68,0.12)',
                                }
                              : {
                                  borderColor: 'var(--surface-border)',
                                  color: 'var(--text-secondary)',
                                  background: 'var(--app-bg)',
                                }
                          }
                        >
                          {hasActiveBlocking ? 'Blocking is active' : 'Blocking is not active'}
                        </Chip>
                      </div>

                      {watchNames.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Watches
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {watchNames.map((watchName) => (
                              <Chip key={watchName} variant="soft">
                                {watchName}
                              </Chip>
                            ))}
                          </div>
                        </div>
                      )}

                      {policyMatches.length > 0 ? (
                        <Card className="surface-panel rounded-2xl overflow-hidden">
                          <Table variant="secondary">
                            <Table.ScrollContainer>
                              <Table.Content
                                aria-label="Xray watch policy matches"
                                className="min-w-[760px]"
                              >
                                <Table.Header>
                                  <Table.Column isRowHeader>Watch</Table.Column>
                                  <Table.Column>Policy</Table.Column>
                                  <Table.Column>Rule</Table.Column>
                                  <Table.Column className="text-right">Blocking</Table.Column>
                                </Table.Header>
                                <Table.Body>
                                  {policyMatches.map((match, index) => (
                                    <Table.Row
                                      key={`${match.watchName}-${match.policy}-${match.rule}-${index}`}
                                      id={`${match.watchName}-${match.policy}-${match.rule}-${index}`}
                                    >
                                      <Table.Cell className="text-xs text-zinc-700 dark:text-zinc-300">
                                        <div className="flex flex-col">
                                          <span>{match.watchName || '-'}</span>
                                          {match.watchID && (
                                            <span className="text-[11px] text-zinc-500">
                                              {match.watchID}
                                            </span>
                                          )}
                                        </div>
                                      </Table.Cell>
                                      <Table.Cell className="text-xs text-zinc-700 dark:text-zinc-300">
                                        {match.policy || '-'}
                                      </Table.Cell>
                                      <Table.Cell className="text-xs text-zinc-700 dark:text-zinc-300">
                                        {match.rule || '-'}
                                      </Table.Cell>
                                      <Table.Cell className="text-right">
                                        <span
                                          className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                                          style={
                                            isActiveXrayPolicyMatch(match)
                                              ? {
                                                  borderColor: 'rgba(239,68,68,0.28)',
                                                  color: '#f87171',
                                                  background: 'rgba(239,68,68,0.12)',
                                                }
                                              : {
                                                  borderColor: 'var(--surface-border)',
                                                  color: 'var(--text-secondary)',
                                                  background: 'var(--app-bg)',
                                                }
                                          }
                                        >
                                          {isActiveXrayPolicyMatch(match) ? 'Active' : 'Not active'}
                                        </span>
                                      </Table.Cell>
                                    </Table.Row>
                                  ))}
                                </Table.Body>
                              </Table.Content>
                            </Table.ScrollContainer>
                          </Table>
                        </Card>
                      ) : (
                        <Alert status="warning" className="border border-warning">
                          <Alert.Indicator />
                          <Alert.Content>
                            <Alert.Title>No watch-policy matches were persisted</Alert.Title>
                            <Alert.Description>
                              This vulnerability has Xray context, but no explicit watch-policy
                              match rows were returned from the export details payload.
                            </Alert.Description>
                          </Alert.Content>
                        </Alert>
                      )}
                    </>
                  );
                })()}
              </Modal.Body>
              <Modal.Footer
                className="px-6 py-4 flex justify-end"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <Button
                  onPress={xrayPolicyDetailsModal.close}
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
    </div>
  );
}
