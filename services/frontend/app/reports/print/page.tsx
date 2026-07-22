'use client';
import { Button, Drawer, Label, NumberField, SearchField, Switch, useOverlayState } from '@heroui/react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useCallback, useEffect, useRef, useState } from 'react';

const SCAN_PAGE_SIZE = 100;
const VULN_PAGE_SIZE = 500;
const PAGE_BATCH_SIZE = 4;

interface Comment { id: string; user_id: string; content: string; username?: string; created_at: string; }
interface Tag { id: string; name: string; color: string; }
interface Vulnerability {
  id: string; vuln_id: string; pkg_name: string; installed_version: string;
  fixed_version: string; severity: string; title: string; description: string;
  cvss_score: number; references: string[]; data_source?: string; first_seen_at?: string | null;
  xray_watch_name?: string; xray_watch_names?: string[]; xray_watch_policy_matches?: Array<Record<string, unknown>>;
  xray_is_blocking?: boolean;
  suppression?: { status: string; justification: string; username?: string; source?: string; xray_policy_name?: string; xray_watch_name?: string } | null;
  comments?: Comment[];
}
interface Scan {
  id: string; image_name: string; image_tag: string; image_digest: string;
  scan_provider?: 'trivy' | 'artifactory_xray';
  external_status?: string;
  status: string; critical_count: number; high_count: number; medium_count: number;
  low_count: number; unknown_count: number; suppressed_count: number;
  trivy_version: string; grype_version: string; started_at: string | null; completed_at: string | null;
  created_at: string; architecture?: string; os_family?: string; os_name?: string;
  image_location?: string; helm_chart?: string; helm_source_path?: string;
  tags?: Tag[];
  scan_source?: string; owner_org_id?: string;
  collections?: Array<{ id: string; name: string }>;
  blocked_policy_details?: {
    summary?: string; blocking_policies?: string[]; matched_policies?: string[];
    matched_watches?: Array<{ name: string }>; total_violations?: number;
  } | null;
  compliance_summary?: {
    status: 'pass' | 'fail'; pass_count: number; fail_count: number;
    policy_names: string[]; failed_policy_names: string[];
  } | null;
}

interface ManualFinding {
  id: string; scan_id: string; vuln_id: string; severity: string;
  pkg_name: string; installed_version: string; fixed_version: string;
  title: string; description: string; cvss_score: number; justification: string;
  created_at: string;
}
interface ComplianceResult {
  id: string;
  org_id: string;
  org_name?: string;
  status: 'pass' | 'fail';
  policy_name?: string;
  violations?: Array<{ vuln_id?: string; message?: string; rule?: { cve_id?: string } }>;
}
interface ScanData { scan: Scan; vulns: Vulnerability[]; compliance: ComplianceResult[]; }
interface CustomField { label: string; value: string; }

interface Filters {
  minCvss: number;
  severities: string[];
  onlyHasFix: boolean;
  search: string;
  xrayPolicyOnly: boolean;
  orgPolicyFailedOnly: boolean;
  showSuppressed: boolean;
  showComments: boolean;
  showDescription: boolean;
  showReferences: boolean;
  showScanId: boolean;
  showStarted: boolean;
  showCompleted: boolean;
  showTrivyVersion: boolean;
  showPolicyDetails: boolean;
  deduplicateCves: boolean;
  hideRegistryData: boolean;
}

interface ReportFinding {
  vulnerability: Vulnerability;
  packages: Array<{ name: string; installedVersion: string; fixedVersion: string }>;
  affectedImages: string[];
  xrayPolicyLabels: string[];
  orgPolicyLabels: string[];
}

interface PaginatedResponse<T> {
  data?: T[];
  total?: number;
  page?: number;
  limit?: number;
}

interface HelmRunDetailResponse {
  run: {
    id: string;
    chart_url: string;
  };
  items: Array<{
    key: string;
    attempt_count: number;
    latest_scan: Scan;
  }>;
}

const SEV_COLORS: Record<string, { bg: string; text: string; light: string }> = {
  CRITICAL: { bg: '#dc2626', text: '#fff', light: '#fef2f2' },
  HIGH:     { bg: '#ea580c', text: '#fff', light: '#fff7ed' },
  MEDIUM:   { bg: '#d97706', text: '#fff', light: '#fffbeb' },
  LOW:      { bg: '#2563eb', text: '#fff', light: '#eff6ff' },
  UNKNOWN:  { bg: '#6b7280', text: '#fff', light: '#f9fafb' },
};

const SEVS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const SEVERITY_DOT_COLORS: Record<string, string> = { CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#d97706', LOW: '#2563eb', UNKNOWN: '#6b7280' };
const FILTER_TOGGLE_GROUPS: Array<{ label: string; rows: Array<[keyof Filters, string]> }> = [
  {
    label: 'Finding filters',
    rows: [
      ['onlyHasFix', 'Has fix only'],
      ['xrayPolicyOnly', 'Xray policy findings only'],
      ['orgPolicyFailedOnly', 'Org policy failures only'],
      ['showSuppressed', 'Include acknowledged findings'],
    ],
  },
  {
    label: 'Finding content',
    rows: [
      ['showDescription', 'Descriptions'],
      ['showReferences', 'References'],
      ['showComments', 'Analyst comments'],
      ['showPolicyDetails', 'Policy details'],
    ],
  },
  {
    label: 'Scan details',
    rows: [
      ['showScanId', 'Scan ID'],
      ['showStarted', 'Started'],
      ['showCompleted', 'Completed'],
      ['showTrivyVersion', 'Scanner versions'],
    ],
  },
  {
    label: 'Report display',
    rows: [
      ['deduplicateCves', 'Deduplicate CVEs'],
      ['hideRegistryData', 'Hide registry data'],
    ],
  },
];

function fmt(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function SevBadge({ s }: { s: string }) {
  const c = SEV_COLORS[s] ?? SEV_COLORS.UNKNOWN;
  return (
    <span style={{ background: c.bg, color: c.text, fontSize: '12px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {s}
    </span>
  );
}

function BrandMark({ size = 34 }: { size?: number }) {
  const imageSize = Math.round(size * 1.55);
  return (
    <span
      className="report-brand-mark"
      style={{
        height: size,
        width: size,
      }}
    >
      <Image
        src="/justscan-logo.png"
        alt="JustScan logo"
        width={imageSize}
        height={imageSize}
        style={{ filter: 'invert(1)', height: imageSize, maxWidth: 'none', width: imageSize }}
        priority={size > 20}
      />
    </span>
  );
}

function worstSeverity(scan: Scan): string {
  if (scan.critical_count > 0) return 'CRITICAL';
  if (scan.high_count > 0) return 'HIGH';
  if (scan.medium_count > 0) return 'MEDIUM';
  if (scan.low_count > 0) return 'LOW';
  return 'NONE';
}

function reportStatus(scan: Pick<Scan, 'status' | 'scan_provider' | 'external_status'>): string {
  if (scan.scan_provider === 'artifactory_xray') {
    const external = (scan.external_status ?? '').trim();
    if (external !== '' && external !== 'completed' && external !== scan.status) {
      return external;
    }
  }
  return scan.status;
}

function statusChipColors(status: string): { background: string; color: string; border?: string } {
  if (status === 'completed') {
    return { background: '#dcfce7', color: '#15803d', border: '#86efac' };
  }
  if (status === 'blocked_by_xray_policy') {
    return { background: '#fff7ed', color: '#c2410c', border: '#fdba74' };
  }
  return { background: '#fef2f2', color: '#dc2626', border: '#fca5a5' };
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

function normalizeVulnId(value?: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

function vulnerabilityHasXrayPolicy(vulnerability: Vulnerability): boolean {
  return Boolean(
    vulnerability.xray_is_blocking ||
    vulnerability.xray_watch_name?.trim() ||
    vulnerability.xray_watch_names?.some((name) => name.trim()) ||
    vulnerability.xray_watch_policy_matches?.length
  );
}

function xrayPolicyLabels(vulnerability: Vulnerability): string[] {
  const labels = [
    vulnerability.xray_watch_name ?? '',
    ...(vulnerability.xray_watch_names ?? []),
    ...(vulnerability.xray_watch_policy_matches ?? []).flatMap((match) => {
      const policy = typeof match.policy === 'string' ? match.policy : '';
      const watch = typeof match.watch_name === 'string' ? match.watch_name : '';
      return [policy, watch];
    }),
  ].flatMap((value) => value.trim() ? [value.trim()] : []);
  if (labels.length === 0 && vulnerabilityHasXrayPolicy(vulnerability)) labels.push('Policy match');
  return Array.from(new Set(labels));
}

function orgPolicyFailureMap(compliance: ComplianceResult[]): Map<string, string[]> {
  const failures = new Map<string, Set<string>>();
  for (const result of compliance) {
    if (result.status !== 'fail') continue;
    for (const violation of result.violations ?? []) {
      const vulnId = normalizeVulnId(violation.vuln_id ?? violation.rule?.cve_id);
      if (!vulnId) continue;
      const labels = failures.get(vulnId) ?? new Set<string>();
      labels.add(result.policy_name?.trim() || 'Organization policy');
      failures.set(vulnId, labels);
    }
  }
  return new Map(Array.from(failures, ([key, labels]) => [key, Array.from(labels).sort()]));
}

function filterVulns(vulns: Vulnerability[], f: Filters, policyFailures: Map<string, string[]>): Vulnerability[] {
  const search = f.search.trim().toLowerCase();
  return vulns.filter(v => {
    if (v.suppression && !f.showSuppressed) return false;
    if (f.severities.length > 0 && !f.severities.includes(v.severity)) return false;
    if (f.minCvss > 0 && v.cvss_score < f.minCvss) return false;
    if (f.onlyHasFix && !v.fixed_version) return false;
    if (f.xrayPolicyOnly && !vulnerabilityHasXrayPolicy(v)) return false;
    if (f.orgPolicyFailedOnly && !policyFailures.has(normalizeVulnId(v.vuln_id))) return false;
    if (search && ![v.vuln_id, v.pkg_name, v.title, v.data_source].some((value) => value?.toLowerCase().includes(search))) return false;
    return true;
  });
}

function severityRank(severity: string): number {
  const rank = SEVS.indexOf(severity.toUpperCase());
  return rank === -1 ? SEVS.length : rank;
}

function selectRepresentativeFinding(current: Vulnerability, candidate: Vulnerability): Vulnerability {
  const currentRank = severityRank(current.severity);
  const candidateRank = severityRank(candidate.severity);
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current;
  if (candidate.cvss_score !== current.cvss_score) return candidate.cvss_score > current.cvss_score ? candidate : current;
  return candidate.id.localeCompare(current.id) < 0 ? candidate : current;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildReportFindings(data: ScanData[], filters: Filters): ReportFinding[] {
  const sourceFindings = data.flatMap(({ scan, vulns, compliance }) => {
    const policyFailures = orgPolicyFailureMap(compliance);
    return filterVulns(vulns, filters, policyFailures)
      .filter((vulnerability) => !vulnerability.suppression)
      .map((vulnerability) => ({
        vulnerability,
        image: `${scan.image_name}:${scan.image_tag}`,
        xrayPolicyLabels: xrayPolicyLabels(vulnerability),
        orgPolicyLabels: policyFailures.get(normalizeVulnId(vulnerability.vuln_id)) ?? [],
      }));
  });

  if (!filters.deduplicateCves) {
    return sourceFindings.map(({ vulnerability, image, xrayPolicyLabels, orgPolicyLabels }) => ({
      vulnerability,
      packages: [{
        name: vulnerability.pkg_name,
        installedVersion: vulnerability.installed_version,
        fixedVersion: vulnerability.fixed_version,
      }],
      affectedImages: [image],
      xrayPolicyLabels,
      orgPolicyLabels,
    }));
  }

  const grouped = new Map<string, ReportFinding>();
  for (const source of sourceFindings) {
    const normalizedId = normalizeVulnId(source.vulnerability.vuln_id);
    const key = normalizedId.startsWith('CVE-') ? normalizedId : `finding:${source.vulnerability.id}`;
    const existing = grouped.get(key);
    const packageEntry = {
      name: source.vulnerability.pkg_name,
      installedVersion: source.vulnerability.installed_version,
      fixedVersion: source.vulnerability.fixed_version,
    };
    if (!existing) {
      grouped.set(key, {
        vulnerability: source.vulnerability,
        packages: [packageEntry],
        affectedImages: [source.image],
        xrayPolicyLabels: source.xrayPolicyLabels,
        orgPolicyLabels: source.orgPolicyLabels,
      });
      continue;
    }

    const representative = selectRepresentativeFinding(existing.vulnerability, source.vulnerability);
    const comments = [...(existing.vulnerability.comments ?? []), ...(source.vulnerability.comments ?? [])];
    existing.vulnerability = {
      ...representative,
      references: uniqueStrings([...(existing.vulnerability.references ?? []), ...(source.vulnerability.references ?? [])]),
      comments: comments.filter((comment, index) => comments.findIndex((candidate) => candidate.id === comment.id) === index),
    };
    if (!existing.packages.some((item) => item.name === packageEntry.name && item.installedVersion === packageEntry.installedVersion && item.fixedVersion === packageEntry.fixedVersion)) {
      existing.packages.push(packageEntry);
    }
    existing.affectedImages = uniqueStrings([...existing.affectedImages, source.image]);
    existing.xrayPolicyLabels = uniqueStrings([...existing.xrayPolicyLabels, ...source.xrayPolicyLabels]);
    existing.orgPolicyLabels = uniqueStrings([...existing.orgPolicyLabels, ...source.orgPolicyLabels]);
  }

  return Array.from(grouped.values());
}

async function fetchPaginatedCollection<T>(
  fetchPage: (page: number) => Promise<PaginatedResponse<T>>,
  defaultPageSize: number,
): Promise<T[]> {
  const firstPage = await fetchPage(1);
  const firstItems = firstPage.data ?? [];
  const total = firstPage.total ?? firstItems.length;
  const pageSize = firstPage.limit && firstPage.limit > 0 ? firstPage.limit : defaultPageSize;

  if (total <= firstItems.length || pageSize <= 0) {
    return firstItems;
  }

  const totalPages = Math.ceil(total / pageSize);
  const allItems = [...firstItems];

  for (let startPage = 2; startPage <= totalPages; startPage += PAGE_BATCH_SIZE) {
    const pages: number[] = [];
    for (let page = startPage; page < startPage + PAGE_BATCH_SIZE && page <= totalPages; page++) {
      pages.push(page);
    }

    const responses = await Promise.all(pages.map(fetchPage));
    for (const response of responses) {
      allItems.push(...(response.data ?? []));
    }
  }

  return allItems;
}

async function fetchScan(api: string, headers: HeadersInit, scanId: string): Promise<Scan | null> {
  const response = await fetch(`${api}/api/v1/scans/${scanId}`, { headers });
  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function fetchAllVulnerabilities(api: string, headers: HeadersInit, scanId: string): Promise<Vulnerability[]> {
  return fetchPaginatedCollection<Vulnerability>(async (page) => {
    const response = await fetch(`${api}/api/v1/scans/${scanId}/vulnerabilities?page=${page}&limit=${VULN_PAGE_SIZE}`, { headers });
    if (!response.ok) {
      throw new Error(`Failed to load vulnerabilities for scan ${scanId}`);
    }

    return response.json();
  }, VULN_PAGE_SIZE);
}

async function fetchCompliance(api: string, headers: HeadersInit, scanId: string): Promise<ComplianceResult[]> {
  const response = await fetch(`${api}/api/v1/scans/${scanId}/compliance`, { headers });
  if (!response.ok) return [];
  const body: { data?: ComplianceResult[] } = await response.json();
  return body.data ?? [];
}

async function fetchAllChartScans(api: string, headers: HeadersInit, helmChart: string): Promise<Scan[]> {
  return fetchPaginatedCollection<Scan>(async (page) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(SCAN_PAGE_SIZE),
      helm_chart: helmChart,
    });

    const response = await fetch(`${api}/api/v1/scans/?${params.toString()}`, { headers });
    if (!response.ok) {
      throw new Error('Failed to load Helm chart scans');
    }

    return response.json();
  }, SCAN_PAGE_SIZE);
}

async function fetchRunScans(api: string, headers: HeadersInit, helmRun: string): Promise<Scan[]> {
  const response = await fetch(`${api}/api/v1/helm/runs/${helmRun}`, { headers });
  if (!response.ok) {
    throw new Error('Failed to load Helm run');
  }

  const detail: HelmRunDetailResponse = await response.json();
  return (detail.items ?? []).map((item) => item.latest_scan);
}

function ReportFilterControls({ f, onChange, showHeading = true }: { f: Filters; onChange: (f: Filters) => void; showHeading?: boolean }) {
  function toggle(sev: string) {
    const sevs = f.severities.includes(sev) ? f.severities.filter(s => s !== sev) : [...f.severities, sev];
    onChange({ ...f, severities: sevs });
  }
  return (
    <div className="text-sm text-zinc-900" style={{ colorScheme: 'light' }}>
      {showHeading && <>
        <p className="mb-1 font-semibold text-zinc-900">Report filters</p>
        <p className="mb-4 text-xs text-zinc-500">Changes apply immediately to the printable report.</p>
      </>}

      <SearchField className="mb-3" value={f.search} onChange={(search) => onChange({ ...f, search })}>
        <Label className="text-xs font-semibold text-zinc-700">CVE, package, or title</Label>
        <SearchField.Group className="border-zinc-200 bg-white text-zinc-900">
          <SearchField.SearchIcon />
          <SearchField.Input className="text-zinc-900 placeholder:text-zinc-400" placeholder="Search findings" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <NumberField className="mb-4" minValue={0} maxValue={10} step={0.1} value={f.minCvss} onChange={(minCvss) => onChange({ ...f, minCvss })}>
        <Label className="text-xs font-semibold text-zinc-700">Minimum CVSS</Label>
        <NumberField.Group className="border-zinc-200 bg-white text-zinc-900">
          <NumberField.DecrementButton className="text-zinc-700 hover:bg-zinc-100">
            <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
              <path d="M3 8h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
            </svg>
          </NumberField.DecrementButton>
          <NumberField.Input className="text-zinc-900" />
          <NumberField.IncrementButton className="text-zinc-700 hover:bg-zinc-100">
            <svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16">
              <path d="M3 8h10M8 3v10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
            </svg>
          </NumberField.IncrementButton>
        </NumberField.Group>
      </NumberField>

      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Severity</p>
      {SEVS.map(s => (
        <label key={s} className="mb-1 flex cursor-pointer items-center gap-2 text-xs text-zinc-800">
          <input className="accent-blue-600" type="checkbox" checked={f.severities.length === 0 || f.severities.includes(s)}
            onChange={() => {
              if (f.severities.length === 0) onChange({ ...f, severities: SEVS.filter(x => x !== s) });
              else toggle(s);
            }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEVERITY_DOT_COLORS[s], display: 'inline-block' }} />
          {s}
        </label>
      ))}

      {FILTER_TOGGLE_GROUPS.map((group) => (
        <div key={group.label} className="mt-4 border-t border-zinc-200 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{group.label}</p>
          <div className="space-y-2.5">
            {group.rows.map(([key, label]) => (
              <Switch
                key={key}
                className="flex w-full flex-row items-center justify-start gap-3"
                isSelected={f[key] as boolean}
                onChange={(value) => onChange({ ...f, [key]: value })}
              >
                {({ isSelected }) => (
                  <>
                    <Switch.Control
                      className={`shrink-0 ${isSelected ? 'bg-blue-600' : 'bg-zinc-200'}`}
                    >
                      <Switch.Thumb className="bg-white" />
                    </Switch.Control>
                    <Switch.Content className="min-w-0">
                      <Label className="block text-xs leading-4 text-zinc-800">{label}</Label>
                    </Switch.Content>
                  </>
                )}
              </Switch>
            ))}
          </div>
        </div>
      ))}

      <Button className="mt-5 w-full bg-blue-600 text-white hover:bg-blue-700" variant="primary" onPress={() => window.print()}>
        Save as PDF
      </Button>
    </div>
  );
}

function FilterPanel({ f, onChange }: { f: Filters; onChange: (f: Filters) => void }) {
  const drawer = useOverlayState();

  return (
    <>
      <aside className="report-filter-panel print:hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-lg">
        <ReportFilterControls f={f} onChange={onChange} />
      </aside>

      <div className="report-filter-trigger print:hidden">
        <Button className="shadow-lg" variant="primary" onPress={drawer.open}>Filters</Button>
      </div>

      <Drawer.Backdrop
        className="report-filter-drawer print:hidden"
        isOpen={drawer.isOpen}
        onOpenChange={drawer.setOpen}
        variant="blur"
      >
        <Drawer.Content placement="right">
          <Drawer.Dialog aria-label="Report filters" className="flex h-full w-[min(92vw,22rem)] flex-col bg-white">
            <Drawer.Header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
              <div>
                <Drawer.Heading className="font-semibold text-zinc-900">Report filters</Drawer.Heading>
                <p className="mt-1 text-xs text-zinc-500">Changes apply immediately to the printable report.</p>
              </div>
              <Drawer.CloseTrigger className="text-zinc-500 hover:text-zinc-700" />
            </Drawer.Header>
            <Drawer.Body className="flex-1 px-5 py-4">
              <ReportFilterControls f={f} onChange={onChange} showHeading={false} />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}

function ReportVulnerabilitySection({ findings, filters }: { findings: ReportFinding[]; filters: Filters }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid var(--accent)', paddingBottom: 6, display: 'inline-block' }}>
        Vulnerabilities ({findings.length})
      </p>

      {findings.length === 0 ? (
        <p style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic', margin: '8px 0 20px' }}>No vulnerabilities match current filters.</p>
      ) : (
        <table className="report-findings-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12, marginBottom: 24 }}>
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '27%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '9%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {['CVE ID', 'Package', 'Installed', 'Fixed In', 'Severity', 'CVSS'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600, color: '#374151', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {findings.map((finding, index) => {
              const vulnerability = finding.vulnerability;
              const rowBackground = index % 2 === 0 ? '#fff' : '#fafafa';
              const detailBackground = index % 2 === 0 ? '#fafafa' : '#f5f5f5';
              return (
                <Fragment key={vulnerability.id}>
                  <tr style={{ background: rowBackground }}>
                    <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12, color: 'var(--accent)', fontWeight: 600, overflowWrap: 'anywhere' }}>{vulnerability.vuln_id || '-'}</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>
                      {finding.packages.map((item) => <div key={`${item.name}-${item.installedVersion}-${item.fixedVersion}`}>{item.name || '-'}</div>)}
                    </td>
                    <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12, color: '#6b7280', overflowWrap: 'anywhere' }}>
                      {finding.packages.map((item) => <div key={`${item.name}-${item.installedVersion}`}>{item.installedVersion || '-'}</div>)}
                    </td>
                    <td style={{ padding: '6px 8px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12, color: '#15803d', fontWeight: finding.packages.some((item) => item.fixedVersion) ? 600 : 400, overflowWrap: 'anywhere' }}>
                      {finding.packages.map((item) => <div key={`${item.name}-${item.fixedVersion}`}>{item.fixedVersion || '-'}</div>)}
                    </td>
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}><SevBadge s={vulnerability.severity} /></td>
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12, textAlign: 'right', fontWeight: vulnerability.cvss_score >= 7 ? 700 : 400, color: vulnerability.cvss_score >= 9 ? '#dc2626' : vulnerability.cvss_score >= 7 ? '#ea580c' : '#374151' }}>
                      {vulnerability.cvss_score ? vulnerability.cvss_score.toFixed(1) : '-'}
                    </td>
                  </tr>
                  {(filters.showDescription || filters.showReferences || filters.showComments || filters.showPolicyDetails || finding.affectedImages.length > 0) && (
                    <tr style={{ background: detailBackground }}>
                      <td colSpan={6} className="report-detail-cell">
                        <div style={{ marginBottom: 5 }}><strong style={{ color: '#111827' }}>Affected images:</strong> {finding.affectedImages.join(' · ')}</div>
                        {filters.showDescription && vulnerability.title && <strong style={{ color: '#111827' }}>{vulnerability.title} - </strong>}
                        {filters.showDescription && vulnerability.description && (vulnerability.description.length > 400 ? vulnerability.description.slice(0, 400) + '…' : vulnerability.description)}
                        {filters.showReferences && vulnerability.references?.length > 0 && (
                          <span style={{ color: 'var(--accent)', marginLeft: 8, fontSize: 12, overflowWrap: 'anywhere', wordBreak: 'break-all' }}>{vulnerability.references.slice(0, 2).join(' · ')}</span>
                        )}
                        {filters.showPolicyDetails && (finding.xrayPolicyLabels.length > 0 || finding.orgPolicyLabels.length > 0) && (
                          <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {finding.xrayPolicyLabels.map(label => <span key={`xray-${label}`} style={{ padding: '2px 5px', borderRadius: 3, background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa' }}>Xray: {label}</span>)}
                            {finding.orgPolicyLabels.map(label => <span key={`org-${label}`} style={{ padding: '2px 5px', borderRadius: 3, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>Org: {label}</span>)}
                          </div>
                        )}
                        {filters.showComments && vulnerability.comments && vulnerability.comments.length > 0 && (
                          <div style={{ marginTop: '6px' }}>
                            {vulnerability.comments.map(comment => (
                              <div key={comment.id} style={{ marginTop: '4px', background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '3px solid #f59e0b', borderRadius: '3px', padding: '6px 8px' }}>
                                <p style={{ margin: '0 0 2px', fontSize: '12px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                  Analyst Note
                                  {comment.username && <span style={{ fontWeight: 400, marginLeft: '5px', textTransform: 'none', letterSpacing: 0 }}>- {comment.username}</span>}
                                </p>
                                <p style={{ margin: 0, fontSize: '12px', color: '#78350f', lineHeight: 1.5 }}>{comment.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ScanSection({ data, filters, isFirst }: { data: ScanData; filters: Filters; isFirst: boolean }) {
  const { scan, vulns, compliance } = data;
  const policyFailures = orgPolicyFailureMap(compliance);
  const filteredVulns = filterVulns(vulns, filters, policyFailures);
  const suppressedVulns = filteredVulns.filter(v => v.suppression);
  const ws = worstSeverity(scan);
  const accentColor = SEV_COLORS[ws]?.bg ?? 'var(--accent)';
  const imageRef = `${scan.image_name}:${scan.image_tag}`;
  const displayStatus = reportStatus(scan);
  const statusColors = statusChipColors(displayStatus);

  const [imageLocation, setImageLocation] = useState(scan.image_location ?? '');
  const [savingLocation, setSavingLocation] = useState(false);
  const [manualFindings, setManualFindings] = useState<ManualFinding[]>([]);
  const [showAddFinding, setShowAddFinding] = useState(false);
  const [newFinding, setNewFinding] = useState<Partial<ManualFinding>>({ severity: 'HIGH', cvss_score: 0 });
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [newCustomField, setNewCustomField] = useState<CustomField>({ label: '', value: '' });
  const apiRef = useRef(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080');
  const tokenRef = useRef(typeof window !== 'undefined' ? localStorage.getItem('justscan_token') ?? '' : '');

  useEffect(() => {
    const headers = { Authorization: `Bearer ${tokenRef.current}` };
    fetch(`${apiRef.current}/api/v1/scans/${scan.id}/manual-findings`, { headers })
      .then(r => r.ok ? r.json() : [])
      .then(data => setManualFindings(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [scan.id]);

  const patchImageLocation = useCallback((value: string) => {
    setSavingLocation(true);
    fetch(`${apiRef.current}/api/v1/scans/${scan.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_location: value }),
    }).finally(() => setSavingLocation(false));
  }, [scan.id]);

  async function submitManualFinding() {
    if (!newFinding.vuln_id) return;
    const res = await fetch(`${apiRef.current}/api/v1/scans/${scan.id}/manual-findings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenRef.current}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(newFinding),
    });
    if (res.ok) {
      const created: ManualFinding = await res.json();
      setManualFindings(prev => [...prev, created]);
      setNewFinding({ severity: 'HIGH', cvss_score: 0 });
      setShowAddFinding(false);
    }
  }

  async function deleteManualFinding(findingId: string) {
    await fetch(`${apiRef.current}/api/v1/scans/${scan.id}/manual-findings/${findingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    setManualFindings(prev => prev.filter(f => f.id !== findingId));
  }

  return (
    <div className={isFirst ? '' : 'page-break'} style={{ marginBottom: 48 }} id={`scan-${scan.id}`}>
      {/* Scan header */}
      <div style={{ display: 'flex', borderLeft: `5px solid ${accentColor}`, paddingLeft: 16, marginBottom: 20, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#111827', margin: '0 0 2px', wordBreak: 'break-all' }}>{imageRef}</p>
          {scan.image_digest && <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#9ca3af', margin: '0 0 6px', wordBreak: 'break-all' }}>{scan.image_digest}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {scan.critical_count > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '2px 7px', borderRadius: 4, border: '1px solid #fca5a5' }}>C: {scan.critical_count}</span>}
            {scan.high_count > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#ea580c', background: '#fff7ed', padding: '2px 7px', borderRadius: 4, border: '1px solid #fed7aa' }}>H: {scan.high_count}</span>}
            {scan.medium_count > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#d97706', background: '#fffbeb', padding: '2px 7px', borderRadius: 4, border: '1px solid #fde68a' }}>M: {scan.medium_count}</span>}
            {scan.low_count > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '2px 7px', borderRadius: 4, border: '1px solid #bfdbfe' }}>L: {scan.low_count}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: statusColors.background, color: statusColors.color, border: `1px solid ${statusColors.border ?? statusColors.background}` }}>
            {formatStatusLabel(displayStatus)}
          </span>
          {scan.architecture && <span style={{ fontSize: 12, color: '#6b7280' }}>{scan.architecture} · {scan.os_family}</span>}
        </div>
      </div>

      {/* Metadata */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 20, border: '1px solid #e5e7eb' }}>
        <tbody>
          {([
            ...(filters.showScanId ? [['Scan ID', scan.id, true] as [string, string, boolean]] : []),
            ...(filters.showStarted ? [['Started', fmt(scan.started_at), false] as [string, string, boolean]] : []),
            ...(filters.showCompleted ? [['Completed', fmt(scan.completed_at), false] as [string, string, boolean]] : []),
            ...(filters.showTrivyVersion ? [['Scanner Versions', [scan.trivy_version ? `Trivy ${scan.trivy_version}` : '', scan.grype_version ? `Grype ${scan.grype_version}` : ''].filter(Boolean).join(' · ') || '-', false] as [string, string, boolean]] : []),
            ...(scan.helm_chart ? [['Helm Chart', scan.helm_chart, true] as [string, string, boolean]] : []),
            ...(scan.helm_source_path ? [['Helm Source', scan.helm_source_path, false] as [string, string, boolean]] : []),
            ...(scan.os_family ? [['OS', `${scan.os_family} ${scan.os_name}`.trim(), false] as [string, string, boolean]] : []),
            ...(scan.architecture ? [['Architecture', scan.architecture, false] as [string, string, boolean]] : []),
            ...([['Provider / Source', [scan.scan_provider === 'artifactory_xray' ? 'Artifactory Xray' : 'Trivy', scan.scan_source === 'uploaded_archive' ? 'Uploaded archive' : filters.hideRegistryData ? '' : 'Registry'].filter(Boolean).join(' / '), false] as [string, string, boolean]]),
            ...(scan.tags && scan.tags.length > 0 ? [['Tags', scan.tags.map(t => t.name).join(', '), false] as [string, string, boolean]] : []),
            ...(scan.collections && scan.collections.length > 0 ? [['Collections', scan.collections.map(collection => collection.name).join(', '), false] as [string, string, boolean]] : []),
            ...customFields.map(f => [f.label, f.value, false] as [string, string, boolean]),
          ] as [string, string, boolean][]).map(([label, value, mono]) => (
            <tr key={label}>
              <td style={{ padding: '5px 12px', fontWeight: 600, color: '#374151', background: '#f9fafb', width: 140, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{label}</td>
              <td style={{ padding: '5px 12px', color: '#111827', fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 10 : 12, wordBreak: 'break-all', borderBottom: '1px solid #e5e7eb' }}>{value}</td>
            </tr>
          ))}
          {!filters.hideRegistryData && (
            <tr>
              <td style={{ padding: '5px 12px', fontWeight: 600, color: '#374151', background: '#f9fafb', width: 140, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>Registry / Location</td>
              <td style={{ padding: '3px 8px', borderBottom: '1px solid #e5e7eb' }}>
                <span className="print:hidden">
                  <input
                    type="text"
                    value={imageLocation}
                    onChange={e => setImageLocation(e.target.value)}
                    onBlur={() => patchImageLocation(imageLocation)}
                    placeholder="e.g. registry.example.com/myapp"
                    style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '3px 6px', fontSize: 12, boxSizing: 'border-box', color: '#374151' }}
                  />
                  {savingLocation && <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 4 }}>Saving…</span>}
                </span>
                {imageLocation && <span className="hidden print:inline" style={{ fontSize: 12, color: '#111827' }}>{imageLocation}</span>}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {filters.showPolicyDetails && (scan.compliance_summary || scan.blocked_policy_details) && (
        <div className="report-policy-summary" style={{ marginBottom: 20, padding: '10px 12px', border: '1px solid #e5e7eb', borderLeft: `4px solid ${scan.compliance_summary?.status === 'fail' || scan.blocked_policy_details ? '#dc2626' : '#16a34a'}`, borderRadius: 4, background: '#f9fafb', fontSize: 12 }}>
          <strong style={{ color: '#111827' }}>Policy summary</strong>
          {scan.compliance_summary && (
            <p style={{ margin: '4px 0 0', color: '#374151' }}>
              Organization policies: {scan.compliance_summary.status.toUpperCase()} · {scan.compliance_summary.pass_count} passed · {scan.compliance_summary.fail_count} failed
              {scan.compliance_summary.failed_policy_names?.length ? ` · Failed: ${scan.compliance_summary.failed_policy_names.join(', ')}` : ''}
            </p>
          )}
          {scan.blocked_policy_details && (
            <p style={{ margin: '4px 0 0', color: '#374151', overflowWrap: 'anywhere' }}>
              Xray: {scan.blocked_policy_details.summary || 'Artifact blocked by policy'}
              {scan.blocked_policy_details.blocking_policies?.length ? ` · Policies: ${scan.blocked_policy_details.blocking_policies.join(', ')}` : ''}
              {scan.blocked_policy_details.matched_watches?.length ? ` · Watches: ${scan.blocked_policy_details.matched_watches.map(watch => watch.name).join(', ')}` : ''}
            </p>
          )}
        </div>
      )}

      {/* Custom fields editor - screen only */}
      <div className="print:hidden" style={{ marginBottom: 16, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add Custom Info Field</p>
        {customFields.map((cf, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>{cf.label}:</strong> {cf.value}</span>
            <button onClick={() => setCustomFields(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            value={newCustomField.label}
            onChange={e => setNewCustomField(f => ({ ...f, label: e.target.value }))}
            placeholder="Label (e.g. Team)"
            style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px', fontSize: 12, boxSizing: 'border-box' }}
          />
          <input
            type="text"
            value={newCustomField.value}
            onChange={e => setNewCustomField(f => ({ ...f, value: e.target.value }))}
            placeholder="Value"
            style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px', fontSize: 12, boxSizing: 'border-box' }}
          />
          <button
            onClick={() => {
              if (!newCustomField.label) return;
              setCustomFields(prev => [...prev, newCustomField]);
              setNewCustomField({ label: '', value: '' });
            }}
            disabled={!newCustomField.label}
            style={{ background: newCustomField.label ? '#374151' : '#e5e7eb', color: newCustomField.label ? '#fff' : '#9ca3af', border: 'none', borderRadius: 4, padding: '4px 12px', fontWeight: 700, fontSize: 12, cursor: newCustomField.label ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Manual Findings */}
      {manualFindings.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid var(--accent)', paddingBottom: 6, display: 'inline-block' }}>
            Manual Findings ({manualFindings.length})
          </p>
          {manualFindings.map((f) => (
            <div key={f.id} style={{ border: '1px solid #e5e7eb', borderLeft: '4px solid var(--accent)', borderRadius: 4, padding: '10px 12px', marginBottom: 8, position: 'relative' }}>
              <button
                className="print:hidden"
                onClick={() => deleteManualFinding(f.id)}
                style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, lineHeight: 1 }}
                title="Delete finding"
              >✕</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{f.vuln_id}</span>
                <SevBadge s={f.severity} />
                <span style={{ display: 'inline-block', background: 'color-mix(in srgb, var(--accent) 18%, white)', color: 'color-mix(in srgb, var(--accent) 82%, black)', fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.05em' }}>MANUAL</span>
                {f.cvss_score > 0 && <span style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>CVSS {f.cvss_score.toFixed(1)}</span>}
              </div>
              {f.title && <p style={{ margin: '0 0 3px', fontWeight: 600, fontSize: 12 }}>{f.title}</p>}
              {f.pkg_name && (
                <p style={{ margin: 0, fontSize: 12, color: '#444' }}>
                  <span style={{ fontWeight: 600 }}>{f.pkg_name}</span>{' '}
                  {f.installed_version && <span style={{ color: '#dc2626' }}>{f.installed_version}</span>}
                  {f.fixed_version && <> → <span style={{ color: '#16a34a' }}>fix: {f.fixed_version}</span></>}
                </p>
              )}
              {f.justification && (
                <div style={{ marginTop: 6, background: 'color-mix(in srgb, var(--accent) 18%, white)', border: '1px solid color-mix(in srgb, var(--accent) 62%, white)', borderLeft: '3px solid var(--accent)', borderRadius: 3, padding: '6px 8px' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: '#5b21b6', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Justification</p>
                  <p style={{ margin: 0, fontSize: 12, color: '#4c1d95', lineHeight: 1.5 }}>{f.justification}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Manual CVE form (screen only) */}
      <div className="print:hidden" style={{ marginBottom: 20 }}>
        <button
          onClick={() => setShowAddFinding(v => !v)}
          style={{ background: showAddFinding ? '#f3f4f6' : 'var(--accent)', color: showAddFinding ? '#374151' : '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >
          {showAddFinding ? '✕ Cancel' : '+ Add Manual CVE'}
        </button>
        {showAddFinding && (
          <div style={{ marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', background: '#fafafa' }}>
            {([['vuln_id', 'CVE ID *'], ['pkg_name', 'Package'], ['installed_version', 'Installed Version'], ['title', 'Title']] as [keyof ManualFinding, string][]).map(([field, label]) => (
              <div key={field}>
                <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>{label}</p>
                <input
                  type="text"
                  value={(newFinding as Record<string, string | number>)[field] as string ?? ''}
                  onChange={e => setNewFinding(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>Severity</p>
              <select
                value={newFinding.severity ?? 'HIGH'}
                onChange={e => setNewFinding(f => ({ ...f, severity: e.target.value }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }}
              >
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>CVSS Score</p>
              <input
                type="number" min={0} max={10} step={0.1}
                value={newFinding.cvss_score ?? 0}
                onChange={e => setNewFinding(f => ({ ...f, cvss_score: parseFloat(e.target.value) || 0 }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>Justification - Why is this CVE accepted / not a risk?</p>
              <textarea
                value={newFinding.justification ?? ''}
                onChange={e => setNewFinding(f => ({ ...f, justification: e.target.value }))}
                rows={2}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button
                onClick={submitManualFinding}
                disabled={!newFinding.vuln_id}
                style={{ background: newFinding.vuln_id ? 'var(--accent)' : '#e5e7eb', color: newFinding.vuln_id ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, padding: '7px 20px', fontWeight: 700, fontSize: 12, cursor: newFinding.vuln_id ? 'pointer' : 'not-allowed' }}
              >
                Save Finding
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Suppressed */}
      {suppressedVulns.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>Suppressed ({suppressedVulns.length})</p>
          <table className="report-suppressed-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['CVE ID', 'Package', 'Severity', 'Status', 'Source', 'Justification'].map(h => (
                  <th key={h} style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600, color: '#6b7280' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppressedVulns.map(v => {
                const statusLabel: Record<string, string> = { accepted: 'Accepted', wont_fix: "Won't Fix", false_positive: 'False Positive', xray_ignore: 'Xray Ignore' };
                return (
                  <tr key={v.id} style={{ color: '#6b7280' }}>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{v.vuln_id}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb', overflowWrap: 'anywhere' }}>{v.pkg_name}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.severity}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.suppression ? (statusLabel[v.suppression.status] ?? v.suppression.status) : '-'}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.suppression?.source ?? 'local'}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb', color: '#374151', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{[v.suppression?.justification, v.suppression?.xray_policy_name, v.suppression?.xray_watch_name].filter(Boolean).join(' · ') || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PrintReport() {
  const params = useSearchParams();
  const scansParam = params.get('scans') ?? '';
  const helmChart = params.get('helmChart') ?? '';
  const helmRun = params.get('helmRun') ?? '';
  const scanIds = scansParam.split(',').filter(Boolean);
  const token = typeof window !== 'undefined' ? localStorage.getItem('justscan_token') : null;
  const hasRequestTarget = scanIds.length > 0 || Boolean(helmChart) || Boolean(helmRun);
  const requestError = !hasRequestTarget
    ? 'No scan IDs, Helm chart, or Helm run provided.'
    : (token ? '' : 'Not authenticated.');

  const [data, setData] = useState<ScanData[]>([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>({
    minCvss: 0,
    severities: [],
    onlyHasFix: false,
    search: '',
    xrayPolicyOnly: false,
    orgPolicyFailedOnly: false,
    showSuppressed: true,
    showComments: true,
    showDescription: true,
    showReferences: true,
    showScanId: true,
    showStarted: true,
    showCompleted: true,
    showTrivyVersion: true,
    showPolicyDetails: true,
    deduplicateCves: false,
    hideRegistryData: false,
  });

  useEffect(() => {
    if (requestError || !token) {
      return;
    }

    const requestedScanIds = scansParam.split(',').filter(Boolean);

    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    const headers = { Authorization: `Bearer ${token}` };

    async function loadReport() {
      setError('');

      const scansToLoad = requestedScanIds.length
        ? (await Promise.all(requestedScanIds.map((scanId) => fetchScan(api, headers, scanId)))).filter((scan): scan is Scan => scan !== null)
        : helmRun
          ? await fetchRunScans(api, headers, helmRun)
          : await fetchAllChartScans(api, headers, helmChart);

      if (!scansToLoad.length) {
        setError(requestedScanIds.length ? 'Failed to load scans.' : helmRun ? 'No scans found for this Helm run.' : 'No scans found for this Helm chart.');
        setData([]);
        return;
      }

      const results = await Promise.all(scansToLoad.map(async (scan): Promise<ScanData> => {
        const [vulns, compliance] = await Promise.all([
          fetchAllVulnerabilities(api, headers, scan.id),
          fetchCompliance(api, headers, scan.id),
        ]);
        return { scan, vulns, compliance };
      }));

      setData(results);
    }

    loadReport().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report.'));
  }, [helmChart, helmRun, requestError, scansParam, token]);

    if (requestError) return <div style={{ padding: 40, color: '#dc2626', fontFamily: 'sans-serif' }}><strong>Error:</strong> {requestError}</div>;
  if (error) return <div style={{ padding: 40, color: '#dc2626', fontFamily: 'sans-serif' }}><strong>Error:</strong> {error}</div>;
  if (!data.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#6b7280', gap: 12 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: 20, height: 20, border: '2px solid #e5e7eb', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Loading report…
    </div>
  );

  const reportFindings = buildReportFindings(data, filters);
  const totalActive = reportFindings.length;
  const resolvedHelmChart = helmChart || data.find(({ scan }) => scan.helm_chart)?.scan.helm_chart || '';
  const reportTitle = resolvedHelmChart ? 'Helm Chart Security Report' : 'Security Vulnerability Report';

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 1.5cm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page-break { page-break-before: always; }
          .print\\:hidden { display: none !important; }
          .report-findings-table, .report-suppressed-table { width: 100% !important; max-width: 100% !important; }
          .report-findings-table tr, .report-suppressed-table tr, .report-policy-summary { break-inside: avoid; page-break-inside: avoid; }
          .report-findings-table th, .report-findings-table td, .report-suppressed-table th, .report-suppressed-table td {
            overflow-wrap: anywhere !important;
            word-break: break-word;
          }
        }
        * { box-sizing: border-box; }
        html, body, #__next { margin: 0; padding: 0; min-height: 100%; background: #fff !important; color: #111827; color-scheme: light; }
        body { font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif); }
        .report-brand-mark { align-items: center; display: inline-flex; flex-shrink: 0; justify-content: center; overflow: hidden; }
        .report-detail-cell { padding: 5px 10px 8px; border: 1px solid #e5e7eb; border-top: none; color: #4b5563; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; word-break: break-word; }
        .report-workspace { margin: 0 auto; max-width: 178mm; padding: 24px 16px 32px; }
        .report-document { width: 100%; }
        .report-filter-panel { display: none; }
        .report-filter-trigger { position: fixed; right: 16px; bottom: 16px; z-index: 20; }
        @media (min-width: 1280px) {
          .report-workspace { align-items: start; display: grid; gap: 24px; grid-template-columns: minmax(0, 178mm) 20rem; justify-content: center; max-width: calc(178mm + 23.5rem); }
          .report-filter-panel { display: block; max-height: calc(100vh - 32px); overflow-y: auto; position: sticky; top: 16px; width: 20rem; }
          .report-filter-trigger, .report-filter-drawer { display: none !important; }
        }
        @media print {
          .report-workspace { display: block; max-width: none; padding: 0; }
          .report-document { max-width: none; }
          .report-filter-panel, .report-filter-trigger, .report-filter-drawer { display: none !important; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', width: '100%', background: '#fff', color: '#111827' }}>
        <div className="report-workspace">
        <div className="report-document">

        {/* Report header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e5e7eb', paddingBottom: 20, marginBottom: 28 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <BrandMark />
              <div>
                <p style={{ margin: 0, color: '#111827', fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>JustScan</p>
                <a href="https://justlab.app/en/justscan" style={{ display: 'block', marginTop: 1, color: '#6b7280', fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', textDecoration: 'none' }}>justlab.app/en/justscan</a>
              </div>
            </div>
            <div style={{ borderLeft: '5px solid var(--accent)', paddingLeft: 16 }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: 0, letterSpacing: '-0.02em' }}>{reportTitle}</h1>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
                Generated {new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
              {resolvedHelmChart && (
                <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280', margin: '8px 0 0', wordBreak: 'break-all' }}>
                  Chart: {resolvedHelmChart}
                </p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            {resolvedHelmChart && (
              <span style={{ background: 'color-mix(in srgb, var(--accent) 18%, white)', color: 'var(--accent)', fontWeight: 700, fontSize: 13, padding: '4px 12px', borderRadius: 999, border: '1px solid color-mix(in srgb, var(--accent) 62%, white)' }}>
                Helm chart
              </span>
            )}
            <span style={{ background: 'color-mix(in srgb, var(--accent) 18%, white)', color: 'var(--accent)', fontWeight: 700, fontSize: 13, padding: '4px 12px', borderRadius: 999, border: '1px solid color-mix(in srgb, var(--accent) 62%, white)' }}>
              {data.length} image{data.length !== 1 ? 's' : ''}
            </span>
            <span style={{ background: totalActive === 0 ? '#dcfce7' : '#fef2f2', color: totalActive === 0 ? '#15803d' : '#dc2626', fontWeight: 700, fontSize: 13, padding: '4px 12px', borderRadius: 999, border: `1px solid ${totalActive === 0 ? '#86efac' : '#fca5a5'}` }}>
              {totalActive} finding{totalActive !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Multi-scan summary table */}
        {data.length > 1 && (
          <div style={{ marginBottom: 32 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid var(--accent)', paddingBottom: 6, display: 'inline-block' }}>
              Summary
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Image', 'Status', 'Critical', 'High', 'Medium', 'Low'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Image' ? 'left' : 'center', border: '1px solid #e5e7eb', fontWeight: 600, color: '#374151', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map(({ scan }) => (
                  <tr key={scan.id}>
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                      <a href={`#scan-${scan.id}`} style={{ color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{scan.image_name}:{scan.image_tag}</a>
                    </td>
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                      {(() => {
                        const displayStatus = reportStatus(scan);
                        const statusColors = statusChipColors(displayStatus);
                        return (
                          <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: statusColors.background, color: statusColors.color }}>
                            {formatStatusLabel(displayStatus)}
                          </span>
                        );
                      })()}
                    </td>
                    {[scan.critical_count, scan.high_count, scan.medium_count, scan.low_count].map((n, i) => {
                      const colors = ['#dc2626', '#ea580c', '#d97706', '#2563eb'];
                      return <td key={i} style={{ padding: '6px 10px', border: '1px solid #e5e7eb', textAlign: 'center', fontWeight: n > 0 ? 700 : 400, color: n > 0 ? colors[i] : '#9ca3af', fontFamily: 'monospace', fontSize: 12 }}>{n}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ReportVulnerabilitySection findings={reportFindings} filters={filters} />

        {/* Per-scan sections */}
        {data.map((d, i) => <ScanSection key={d.scan.id} data={d} filters={filters} isFirst={i === 0} />)}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#6b7280', fontWeight: 600 }}>
            <BrandMark size={18} />
            JustScan Security Report · https://justlab.app/en/justscan
          </span>
          <span style={{ maxWidth: '65%', textAlign: 'right', overflowWrap: 'anywhere' }}>{data.map(d => `${d.scan.image_name}:${d.scan.image_tag}`).join(', ')}</span>
        </div>
        </div>
        <FilterPanel f={filters} onChange={setFilters} />
        </div>
      </div>
    </>
  );
}

export default function PrintReportPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#6b7280' }}>Loading…</div>}>
      <PrintReport />
    </Suspense>
  );
}
