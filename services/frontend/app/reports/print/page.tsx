'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

const SCAN_PAGE_SIZE = 100;
const VULN_PAGE_SIZE = 500;
const PAGE_BATCH_SIZE = 4;

interface Comment { id: string; user_id: string; content: string; username?: string; created_at: string; }
interface Tag { id: string; name: string; color: string; }
interface Vulnerability {
  id: string; vuln_id: string; pkg_name: string; installed_version: string;
  fixed_version: string; severity: string; title: string; description: string;
  cvss_score: number; references: string[];
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
}

interface ManualFinding {
  id: string; scan_id: string; vuln_id: string; severity: string;
  pkg_name: string; installed_version: string; fixed_version: string;
  title: string; description: string; cvss_score: number; justification: string;
  created_at: string;
}
interface ScanData { scan: Scan; vulns: Vulnerability[]; }
interface CustomField { label: string; value: string; }

interface Filters {
  minCvss: number;
  severities: string[];
  onlyHasFix: boolean;
  showSuppressed: boolean;
  showComments: boolean;
  showDescription: boolean;
  showReferences: boolean;
  showScanId: boolean;
  showStarted: boolean;
  showCompleted: boolean;
  showTrivyVersion: boolean;
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

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function SevBadge({ s }: { s: string }) {
  const c = SEV_COLORS[s] ?? SEV_COLORS.UNKNOWN;
  return (
    <span style={{ background: c.bg, color: c.text, fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
      {s}
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

function filterVulns(vulns: Vulnerability[], f: Filters): Vulnerability[] {
  return vulns.filter(v => {
    if (v.suppression && !f.showSuppressed) return false;
    if (f.severities.length > 0 && !f.severities.includes(v.severity)) return false;
    if (f.minCvss > 0 && v.cvss_score < f.minCvss) return false;
    if (f.onlyHasFix && !v.fixed_version) return false;
    return true;
  });
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

function FilterPanel({ f, onChange }: { f: Filters; onChange: (f: Filters) => void }) {
  function toggle(sev: string) {
    const sevs = f.severities.includes(sev) ? f.severities.filter(s => s !== sev) : [...f.severities, sev];
    onChange({ ...f, severities: sevs });
  }
  const dotColors: Record<string, string> = { CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#d97706', LOW: '#2563eb', UNKNOWN: '#6b7280' };
  return (
    <div className="print:hidden" style={{ position: 'fixed', top: 16, right: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px', minWidth: 200, boxShadow: '0 4px 24px rgba(0,0,0,0.10)', zIndex: 10, fontSize: 13 }}>
      <p style={{ fontWeight: 700, color: '#111827', marginBottom: 12 }}>Filters</p>

      <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Min CVSS</p>
      <input type="number" min={0} max={10} step={0.1} value={f.minCvss || ''} placeholder="0.0"
        onChange={e => onChange({ ...f, minCvss: parseFloat(e.target.value) || 0 })}
        style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '4px 8px', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }} />

      <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Severity</p>
      {SEVS.map(s => (
        <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.severities.length === 0 || f.severities.includes(s)}
            onChange={() => {
              if (f.severities.length === 0) onChange({ ...f, severities: SEVS.filter(x => x !== s) });
              else toggle(s);
            }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColors[s], display: 'inline-block' }} />
          {s}
        </label>
      ))}

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.onlyHasFix} onChange={e => onChange({ ...f, onlyHasFix: e.target.checked })} />
        Has Fix Only
      </label>

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />

      <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Show</p>
      {([['showDescription', 'Descriptions'], ['showReferences', 'References'], ['showComments', 'Comments'], ['showSuppressed', 'Suppressed']] as [keyof Filters, string][]).map(([k, label]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={f[k] as boolean} onChange={e => onChange({ ...f, [k]: e.target.checked })} />
          {label}
        </label>
      ))}

      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
      <p style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scan Details</p>
      {([['showScanId', 'Scan ID'], ['showStarted', 'Started'], ['showCompleted', 'Completed'], ['showTrivyVersion', 'Scanner Versions']] as [keyof Filters, string][]).map(([k, label]) => (
        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={f[k] as boolean} onChange={e => onChange({ ...f, [k]: e.target.checked })} />
          {label}
        </label>
      ))}

      <button onClick={() => window.print()}
        style={{ width: '100%', marginTop: 16, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 0', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
        Save as PDF
      </button>
    </div>
  );
}

function ScanSection({ data, filters, isFirst }: { data: ScanData; filters: Filters; isFirst: boolean }) {
  const { scan, vulns } = data;
  const activeVulns = filterVulns(vulns.filter(v => !v.suppression), filters);
  const suppressedVulns = filters.showSuppressed ? vulns.filter(v => v.suppression) : [];
  const ws = worstSeverity(scan);
  const accentColor = SEV_COLORS[ws]?.bg ?? '#7c3aed';
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
          {scan.image_digest && <p style={{ fontFamily: 'monospace', fontSize: 10, color: '#9ca3af', margin: '0 0 6px', wordBreak: 'break-all' }}>{scan.image_digest}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {scan.critical_count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '2px 7px', borderRadius: 4, border: '1px solid #fca5a5' }}>C: {scan.critical_count}</span>}
            {scan.high_count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#ea580c', background: '#fff7ed', padding: '2px 7px', borderRadius: 4, border: '1px solid #fed7aa' }}>H: {scan.high_count}</span>}
            {scan.medium_count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706', background: '#fffbeb', padding: '2px 7px', borderRadius: 4, border: '1px solid #fde68a' }}>M: {scan.medium_count}</span>}
            {scan.low_count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '2px 7px', borderRadius: 4, border: '1px solid #bfdbfe' }}>L: {scan.low_count}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: statusColors.background, color: statusColors.color, border: `1px solid ${statusColors.border ?? statusColors.background}` }}>
            {formatStatusLabel(displayStatus)}
          </span>
          {scan.architecture && <span style={{ fontSize: 10, color: '#6b7280' }}>{scan.architecture} · {scan.os_family}</span>}
        </div>
      </div>

      {/* Metadata */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 20, border: '1px solid #e5e7eb' }}>
        <tbody>
          {([
            ...(filters.showScanId ? [['Scan ID', scan.id, true] as [string, string, boolean]] : []),
            ...(filters.showStarted ? [['Started', fmt(scan.started_at), false] as [string, string, boolean]] : []),
            ...(filters.showCompleted ? [['Completed', fmt(scan.completed_at), false] as [string, string, boolean]] : []),
            ...(filters.showTrivyVersion ? [['Scanner Versions', [scan.trivy_version ? `Trivy ${scan.trivy_version}` : '', scan.grype_version ? `Grype ${scan.grype_version}` : ''].filter(Boolean).join(' · ') || '—', false] as [string, string, boolean]] : []),
            ...(scan.helm_chart ? [['Helm Chart', scan.helm_chart, true] as [string, string, boolean]] : []),
            ...(scan.helm_source_path ? [['Helm Source', scan.helm_source_path, false] as [string, string, boolean]] : []),
            ...(scan.os_family ? [['OS', `${scan.os_family} ${scan.os_name}`.trim(), false] as [string, string, boolean]] : []),
            ...(scan.architecture ? [['Architecture', scan.architecture, false] as [string, string, boolean]] : []),
            ...(scan.tags && scan.tags.length > 0 ? [['Tags', scan.tags.map(t => t.name).join(', '), false] as [string, string, boolean]] : []),
            ...customFields.map(f => [f.label, f.value, false] as [string, string, boolean]),
          ] as [string, string, boolean][]).map(([label, value, mono]) => (
            <tr key={label}>
              <td style={{ padding: '5px 12px', fontWeight: 600, color: '#374151', background: '#f9fafb', width: 140, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{label}</td>
              <td style={{ padding: '5px 12px', color: '#111827', fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 10 : 12, wordBreak: 'break-all', borderBottom: '1px solid #e5e7eb' }}>{value}</td>
            </tr>
          ))}
          {/* Registry / Location — editable, hidden on print if empty */}
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
                {savingLocation && <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 4 }}>Saving…</span>}
              </span>
              {imageLocation && <span className="hidden print:inline" style={{ fontSize: 12, color: '#111827' }}>{imageLocation}</span>}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Custom fields editor — screen only */}
      <div className="print:hidden" style={{ marginBottom: 16, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add Custom Info Field</p>
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

      {/* Vulnerabilities */}
      <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #7c3aed', paddingBottom: 6, display: 'inline-block' }}>
        Vulnerabilities ({activeVulns.length})
      </p>

      {activeVulns.length === 0 ? (
        <p style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic', margin: '8px 0 20px' }}>No vulnerabilities match current filters.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 24 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              {['CVE ID', 'Package', 'Installed', 'Fixed In', 'Severity', 'CVSS'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600, color: '#374151', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeVulns.map((v, vi) => (
              <>
                <tr key={v.id} style={{ background: vi % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>{v.vuln_id || '—'}</td>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11 }}>{v.pkg_name}</td>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, color: '#6b7280' }}>{v.installed_version}</td>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, color: '#15803d', fontWeight: v.fixed_version ? 600 : 400 }}>{v.fixed_version || '—'}</td>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb' }}><SevBadge s={v.severity} /></td>
                  <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, textAlign: 'right', fontWeight: v.cvss_score >= 7 ? 700 : 400, color: v.cvss_score >= 9 ? '#dc2626' : v.cvss_score >= 7 ? '#ea580c' : '#374151' }}>
                    {v.cvss_score ? v.cvss_score.toFixed(1) : '—'}
                  </td>
                </tr>
                {(filters.showDescription && v.description) && (
                  <tr key={`${v.id}-desc`} style={{ background: vi % 2 === 0 ? '#fafafa' : '#f5f5f5' }}>
                    <td colSpan={6} style={{ padding: '4px 10px 8px 20px', border: '1px solid #e5e7eb', fontSize: 11, color: '#4b5563', lineHeight: 1.5, borderTop: 'none' }}>
                      {v.title && <strong style={{ color: '#111827' }}>{v.title} — </strong>}
                      {v.description.length > 400 ? v.description.slice(0, 400) + '…' : v.description}
                      {filters.showReferences && v.references?.length > 0 && (
                        <span style={{ color: '#7c3aed', marginLeft: 8, fontSize: 10 }}>{v.references.slice(0, 2).join(' · ')}</span>
                      )}
                      {filters.showComments && v.comments && v.comments.length > 0 && (
                        <div style={{ marginTop: '6px' }}>
                          {v.comments.map(c => (
                            <div key={c.id} style={{ marginTop: '4px', background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '3px solid #f59e0b', borderRadius: '3px', padding: '6px 8px' }}>
                              <p style={{ margin: '0 0 2px', fontSize: '10px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                Analyst Note
                                {c.username && <span style={{ fontWeight: 400, marginLeft: '5px', textTransform: 'none', letterSpacing: 0 }}>— {c.username}</span>}
                              </p>
                              <p style={{ margin: 0, fontSize: '11px', color: '#78350f', lineHeight: 1.5 }}>{c.content}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}

      {/* Manual Findings */}
      {manualFindings.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #7c3aed', paddingBottom: 6, display: 'inline-block' }}>
            Manual Findings ({manualFindings.length})
          </p>
          {manualFindings.map((f) => (
            <div key={f.id} style={{ border: '1px solid #e5e7eb', borderLeft: '4px solid #7c3aed', borderRadius: 4, padding: '10px 12px', marginBottom: 8, position: 'relative' }}>
              <button
                className="print:hidden"
                onClick={() => deleteManualFinding(f.id)}
                style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 14, lineHeight: 1 }}
                title="Delete finding"
              >✕</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{f.vuln_id}</span>
                <SevBadge s={f.severity} />
                <span style={{ display: 'inline-block', background: '#ede9fe', color: '#6d28d9', fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.05em' }}>MANUAL</span>
                {f.cvss_score > 0 && <span style={{ fontSize: 11, color: '#555', fontWeight: 600 }}>CVSS {f.cvss_score.toFixed(1)}</span>}
              </div>
              {f.title && <p style={{ margin: '0 0 3px', fontWeight: 600, fontSize: 12 }}>{f.title}</p>}
              {f.pkg_name && (
                <p style={{ margin: 0, fontSize: 11, color: '#444' }}>
                  <span style={{ fontWeight: 600 }}>{f.pkg_name}</span>{' '}
                  {f.installed_version && <span style={{ color: '#dc2626' }}>{f.installed_version}</span>}
                  {f.fixed_version && <> → <span style={{ color: '#16a34a' }}>fix: {f.fixed_version}</span></>}
                </p>
              )}
              {f.justification && (
                <div style={{ marginTop: 6, background: '#ede9fe', border: '1px solid #c4b5fd', borderLeft: '3px solid #7c3aed', borderRadius: 3, padding: '6px 8px' }}>
                  <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 700, color: '#5b21b6', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Justification</p>
                  <p style={{ margin: 0, fontSize: 11, color: '#4c1d95', lineHeight: 1.5 }}>{f.justification}</p>
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
          style={{ background: showAddFinding ? '#f3f4f6' : '#7c3aed', color: showAddFinding ? '#374151' : '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >
          {showAddFinding ? '✕ Cancel' : '+ Add Manual CVE'}
        </button>
        {showAddFinding && (
          <div style={{ marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', background: '#fafafa' }}>
            {([['vuln_id', 'CVE ID *'], ['pkg_name', 'Package'], ['installed_version', 'Installed Version'], ['title', 'Title']] as [keyof ManualFinding, string][]).map(([field, label]) => (
              <div key={field}>
                <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>{label}</p>
                <input
                  type="text"
                  value={(newFinding as Record<string, string | number>)[field] as string ?? ''}
                  onChange={e => setNewFinding(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div>
              <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>Severity</p>
              <select
                value={newFinding.severity ?? 'HIGH'}
                onChange={e => setNewFinding(f => ({ ...f, severity: e.target.value }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }}
              >
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>CVSS Score</p>
              <input
                type="number" min={0} max={10} step={0.1}
                value={newFinding.cvss_score ?? 0}
                onChange={e => setNewFinding(f => ({ ...f, cvss_score: parseFloat(e.target.value) || 0 }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 6px', fontSize: 12, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ fontSize: 10, color: '#6b7280', margin: '0 0 2px', fontWeight: 600 }}>Justification — Why is this CVE accepted / not a risk?</p>
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
                style={{ background: newFinding.vuln_id ? '#7c3aed' : '#e5e7eb', color: newFinding.vuln_id ? '#fff' : '#9ca3af', border: 'none', borderRadius: 6, padding: '7px 20px', fontWeight: 700, fontSize: 12, cursor: newFinding.vuln_id ? 'pointer' : 'not-allowed' }}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
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
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb', fontFamily: 'monospace' }}>{v.vuln_id}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.pkg_name}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.severity}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.suppression ? (statusLabel[v.suppression.status] ?? v.suppression.status) : '—'}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.suppression?.source ?? 'local'}</td>
                    <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb', color: '#374151' }}>{[v.suppression?.justification, v.suppression?.xray_policy_name, v.suppression?.xray_watch_name].filter(Boolean).join(' · ') || '—'}</td>
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
    showSuppressed: true,
    showComments: true,
    showDescription: true,
    showReferences: true,
    showScanId: true,
    showStarted: true,
    showCompleted: true,
    showTrivyVersion: true,
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

      const results = await Promise.all(scansToLoad.map(async (scan): Promise<ScanData> => ({
        scan,
        vulns: await fetchAllVulnerabilities(api, headers, scan.id),
      })));

      setData(results);
    }

    loadReport().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report.'));
  }, [helmChart, helmRun, requestError, scansParam, token]);

    if (requestError) return <div style={{ padding: 40, color: '#dc2626', fontFamily: 'sans-serif' }}><strong>Error:</strong> {requestError}</div>;
  if (error) return <div style={{ padding: 40, color: '#dc2626', fontFamily: 'sans-serif' }}><strong>Error:</strong> {error}</div>;
  if (!data.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#6b7280', gap: 12 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: 20, height: 20, border: '2px solid #e5e7eb', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Loading report…
    </div>
  );

  const totalActive = data.reduce((sum, d) => sum + filterVulns(d.vulns.filter(v => !v.suppression), filters).length, 0);
  const resolvedHelmChart = helmChart || data.find(({ scan }) => scan.helm_chart)?.scan.helm_chart || '';
  const reportTitle = resolvedHelmChart ? 'Helm Chart Security Report' : 'Security Vulnerability Report';

  return (
    <>
      <FilterPanel f={filters} onChange={setFilters} />

      <style>{`
        @media print {
          @page { size: A4; margin: 1.5cm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page-break { page-break-before: always; }
          .print\\:hidden { display: none !important; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; }
      `}</style>

      <div style={{ width: '100%', maxWidth: '178mm', margin: '0 auto', padding: '24px 0 32px' }}>

        {/* Report header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e5e7eb', paddingBottom: 20, marginBottom: 28 }}>
          <div style={{ borderLeft: '5px solid #7c3aed', paddingLeft: 16 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: 0, letterSpacing: '-0.02em' }}>{reportTitle}</h1>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
              Generated {new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            {resolvedHelmChart && (
              <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#6b7280', margin: '8px 0 0', wordBreak: 'break-all' }}>
                Chart: {resolvedHelmChart}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
            {resolvedHelmChart && (
              <span style={{ background: '#ede9fe', color: '#7c3aed', fontWeight: 700, fontSize: 13, padding: '4px 12px', borderRadius: 999, border: '1px solid #c4b5fd' }}>
                Helm chart
              </span>
            )}
            <span style={{ background: '#ede9fe', color: '#7c3aed', fontWeight: 700, fontSize: 13, padding: '4px 12px', borderRadius: 999, border: '1px solid #c4b5fd' }}>
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
            <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #7c3aed', paddingBottom: 6, display: 'inline-block' }}>
              Summary
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Image', 'Status', 'Critical', 'High', 'Medium', 'Low'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Image' ? 'left' : 'center', border: '1px solid #e5e7eb', fontWeight: 600, color: '#374151', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map(({ scan }) => (
                  <tr key={scan.id}>
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                      <a href={`#scan-${scan.id}`} style={{ color: '#7c3aed', textDecoration: 'none', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{scan.image_name}:{scan.image_tag}</a>
                    </td>
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                      {(() => {
                        const displayStatus = reportStatus(scan);
                        const statusColors = statusChipColors(displayStatus);
                        return (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: statusColors.background, color: statusColors.color }}>
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

        {/* Per-scan sections */}
        {data.map((d, i) => <ScanSection key={d.scan.id} data={d} filters={filters} isFirst={i === 0} />)}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af' }}>
          <span>JustScan Security Report</span>
          <span>{data.map(d => `${d.scan.image_name}:${d.scan.image_tag}`).join(', ')}</span>
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
