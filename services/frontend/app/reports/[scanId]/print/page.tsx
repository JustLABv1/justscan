'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import PrintButton from './PrintButton';

interface Comment {
  id: string;
  user_id: string;
  content: string;
  username?: string;
  created_at: string;
}

interface Vulnerability {
  id: string;
  vuln_id: string;
  pkg_name: string;
  installed_version: string;
  fixed_version: string;
  severity: string;
  title: string;
  description: string;
  cvss_score: number;
  references: string[];
  suppression?: { status: string; justification: string; username?: string; source?: string; xray_policy_name?: string; xray_watch_name?: string } | null;
  comments?: Comment[];
}

interface Tag { id: string; name: string; color: string; }

interface ManualFinding {
  id: string;
  scan_id: string;
  vuln_id: string;
  severity: string;
  pkg_name: string;
  installed_version: string;
  fixed_version: string;
  title: string;
  description: string;
  cvss_score: number;
  justification: string;
  created_at: string;
}

interface Scan {
  id: string;
  image_name: string;
  image_tag: string;
  image_digest: string;
  scan_provider?: 'trivy' | 'artifactory_xray';
  external_status?: string;
  status: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  suppressed_count: number;
  trivy_version: string;
  grype_version: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  image_location: string;
  tags?: Tag[];
}

interface CustomField { label: string; value: string; }

interface ReportOpts {
  showCvss: boolean;
  showDescription: boolean;
  showReferences: boolean;
  showSuppressed: boolean;
  showComments: boolean;
  showScanId: boolean;
  showStarted: boolean;
  showCompleted: boolean;
  showTrivyVersion: boolean;
}

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#ca8a04',
  LOW: '#2563eb',
  UNKNOWN: '#6b7280',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

function SeverityBadge({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.UNKNOWN;
  return (
    <span style={{
      display: 'inline-block', backgroundColor: color, color: '#fff',
      fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px',
      borderRadius: '3px', letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>
      {severity}
    </span>
  );
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

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').toUpperCase();
}

export default function PrintReportPage() {
  const { scanId } = useParams<{ scanId: string }>();
  const [scan, setScan] = useState<Scan | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [error, setError] = useState('');
  const [opts, setOpts] = useState<ReportOpts>({
    showCvss: true,
    showDescription: true,
    showReferences: true,
    showSuppressed: true,
    showComments: true,
    showScanId: true,
    showStarted: true,
    showCompleted: true,
    showTrivyVersion: true,
  });
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [newCustomField, setNewCustomField] = useState<CustomField>({ label: '', value: '' });
  const [manualFindings, setManualFindings] = useState<ManualFinding[]>([]);
  const [imageLocation, setImageLocation] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);
  const [showAddFinding, setShowAddFinding] = useState(false);
  const [newFinding, setNewFinding] = useState<Partial<ManualFinding>>({ severity: 'HIGH', cvss_score: 0 });

  useEffect(() => {
    const token = localStorage.getItem('justscan_token');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!token) { setError('Not authenticated. Please log in and try again.'); return; }

    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    const headers = { Authorization: `Bearer ${token}` };

    async function load() {
      const scanRes = await fetch(`${api}/api/v1/scans/${scanId}`, { headers });
      if (!scanRes.ok) { setError(`Failed to load scan (${scanRes.status})`); return; }
      const scanData: Scan = await scanRes.json();
      setScan(scanData);
      if (scanData.image_location) setImageLocation(scanData.image_location);

      const all: Vulnerability[] = [];
      let page = 1;
      while (true) {
        const vRes = await fetch(`${api}/api/v1/scans/${scanId}/vulnerabilities?page=${page}&limit=500`, { headers });
        if (!vRes.ok) break;
        const vData: { data: Vulnerability[]; total: number } = await vRes.json();
        all.push(...(vData.data ?? []));
        if (all.length >= vData.total || (vData.data ?? []).length < 500) break;
        page++;
      }
      setVulns(all);

      const mfRes = await fetch(`${api}/api/v1/scans/${scanId}/manual-findings`, { headers });
      if (mfRes.ok) setManualFindings(await mfRes.json());
    }

    load().catch((e) => setError(e.message));
  }, [scanId]);

  async function patchImageLocation(value: string) {
    const token = localStorage.getItem('justscan_token');
    if (!token) return;
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    setSavingLocation(true);
    await fetch(`${api}/api/v1/scans/${scanId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_location: value }),
    }).finally(() => setSavingLocation(false));
  }

  async function submitManualFinding() {
    if (!newFinding.vuln_id) return;
    const token = localStorage.getItem('justscan_token');
    if (!token) return;
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    const res = await fetch(`${api}/api/v1/scans/${scanId}/manual-findings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
    const token = localStorage.getItem('justscan_token');
    if (!token) return;
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    await fetch(`${api}/api/v1/scans/${scanId}/manual-findings/${findingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setManualFindings(prev => prev.filter(f => f.id !== findingId));
  }

  if (error) return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', color: '#dc2626' }}>
      <strong>Error:</strong> {error}
    </div>
  );

  if (!scan) return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', color: '#555', display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ width: '20px', height: '20px', border: '2px solid #ddd', borderTopColor: '#555', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Loading report…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const activeVulns = vulns.filter((v) => !v.suppression);
  const suppressedVulns = vulns.filter((v) => v.suppression);
  const severityCounts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  for (const v of activeVulns) severityCounts[v.severity] = (severityCounts[v.severity] ?? 0) + 1;
  const totalActive = activeVulns.length;
  const imageRef = scan.image_tag ? `${scan.image_name}:${scan.image_tag}` : scan.image_name;
  const displayStatus = reportStatus(scan);
  const isSuccessfulReportState = displayStatus === 'completed' || displayStatus === 'blocked_by_xray_policy';

  return (
    <>
      {/* Floating config panel */}
      <div className="print:hidden fixed top-4 left-4 bg-white border border-gray-200 shadow-lg rounded-xl p-4 space-y-2 z-10" style={{ minWidth: '220px', maxWidth: '260px', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>Report Options</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={opts.showCvss} onChange={e => setOpts(o => ({ ...o, showCvss: e.target.checked }))} />
          CVSS Score
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={opts.showDescription} onChange={e => setOpts(o => ({ ...o, showDescription: e.target.checked }))} />
          Descriptions
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={opts.showReferences} onChange={e => setOpts(o => ({ ...o, showReferences: e.target.checked }))} />
          References
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={opts.showSuppressed} onChange={e => setOpts(o => ({ ...o, showSuppressed: e.target.checked }))} />
          Suppressed findings
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={opts.showComments} onChange={e => setOpts(o => ({ ...o, showComments: e.target.checked }))} />
          Notes / Comments
        </label>

        <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>Scan Details</p>
        {([['showScanId', 'Scan ID'], ['showStarted', 'Started'], ['showCompleted', 'Completed'], ['showTrivyVersion', 'Scanner Versions']] as [keyof ReportOpts, string][]).map(([k, label]) => (
          <label key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#374151', cursor: 'pointer' }}>
            <input type="checkbox" checked={opts[k] as boolean} onChange={e => setOpts(o => ({ ...o, [k]: e.target.checked }))} />
            {label}
          </label>
        ))}

        <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>Custom Info Fields</p>
        {customFields.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
            <span style={{ flex: 1, fontSize: '11px', color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>{f.label}:</strong> {f.value}</span>
            <button onClick={() => setCustomFields(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '13px', lineHeight: 1, flexShrink: 0 }}>×</button>
          </div>
        ))}
        <input
          type="text"
          value={newCustomField.label}
          onChange={e => setNewCustomField(f => ({ ...f, label: e.target.value }))}
          placeholder="Label (e.g. Team)"
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '4px', padding: '3px 6px', fontSize: '11px', boxSizing: 'border-box', marginBottom: '3px' }}
        />
        <input
          type="text"
          value={newCustomField.value}
          onChange={e => setNewCustomField(f => ({ ...f, value: e.target.value }))}
          placeholder="Value"
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '4px', padding: '3px 6px', fontSize: '11px', boxSizing: 'border-box', marginBottom: '4px' }}
        />
        <button
          onClick={() => {
            if (!newCustomField.label) return;
            setCustomFields(prev => [...prev, newCustomField]);
            setNewCustomField({ label: '', value: '' });
          }}
          disabled={!newCustomField.label}
          style={{ width: '100%', background: newCustomField.label ? '#374151' : '#e5e7eb', color: newCustomField.label ? '#fff' : '#9ca3af', border: 'none', borderRadius: '4px', padding: '5px 0', fontWeight: 700, fontSize: '11px', cursor: newCustomField.label ? 'pointer' : 'not-allowed' }}
        >
          + Add Field
        </button>

        <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>Registry / Location</p>
        <input
          type="text"
          value={imageLocation}
          onChange={e => setImageLocation(e.target.value)}
          onBlur={() => patchImageLocation(imageLocation)}
          placeholder="e.g. registry.example.com/app"
          style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px 6px', fontSize: '11px', boxSizing: 'border-box', color: '#374151' }}
        />
        {savingLocation && <p style={{ fontSize: '10px', color: '#6b7280', margin: '2px 0 0' }}>Saving…</p>}

        <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
        <button
          onClick={() => setShowAddFinding(f => !f)}
          style={{ width: '100%', background: showAddFinding ? '#f3f4f6' : '#7c3aed', color: showAddFinding ? '#374151' : '#fff', border: 'none', borderRadius: '6px', padding: '6px 0', fontWeight: 700, fontSize: '11px', cursor: 'pointer' }}
        >
          {showAddFinding ? '✕ Cancel' : '+ Add Manual CVE'}
        </button>
        {showAddFinding && (
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[['vuln_id', 'CVE ID *', 'text'], ['pkg_name', 'Package', 'text'], ['installed_version', 'Version', 'text'], ['title', 'Title', 'text']].map(([field, label]) => (
              <div key={field}>
                <p style={{ fontSize: '10px', color: '#6b7280', margin: '0 0 2px' }}>{label}</p>
                <input
                  type="text"
                  value={(newFinding as Record<string, string | number>)[field] as string ?? ''}
                  onChange={e => setNewFinding(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '4px', padding: '3px 5px', fontSize: '11px', boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div>
              <p style={{ fontSize: '10px', color: '#6b7280', margin: '0 0 2px' }}>Severity</p>
              <select
                value={newFinding.severity ?? 'HIGH'}
                onChange={e => setNewFinding(f => ({ ...f, severity: e.target.value }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '4px', padding: '3px 5px', fontSize: '11px', boxSizing: 'border-box' }}
              >
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <p style={{ fontSize: '10px', color: '#6b7280', margin: '0 0 2px' }}>CVSS Score</p>
              <input
                type="number" min={0} max={10} step={0.1}
                value={newFinding.cvss_score ?? 0}
                onChange={e => setNewFinding(f => ({ ...f, cvss_score: parseFloat(e.target.value) || 0 }))}
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '4px', padding: '3px 5px', fontSize: '11px', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <p style={{ fontSize: '10px', color: '#6b7280', margin: '0 0 2px' }}>Justification *</p>
              <textarea
                value={newFinding.justification ?? ''}
                onChange={e => setNewFinding(f => ({ ...f, justification: e.target.value }))}
                rows={3}
                placeholder="Why is this CVE accepted / not a risk?"
                style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: '4px', padding: '3px 5px', fontSize: '11px', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>
            <button
              onClick={submitManualFinding}
              disabled={!newFinding.vuln_id}
              style={{ background: newFinding.vuln_id ? '#7c3aed' : '#e5e7eb', color: newFinding.vuln_id ? '#fff' : '#9ca3af', border: 'none', borderRadius: '6px', padding: '6px 0', fontWeight: 700, fontSize: '11px', cursor: newFinding.vuln_id ? 'pointer' : 'not-allowed', marginTop: '2px' }}
            >
              Save Finding
            </button>
          </div>
        )}
      </div>

      <PrintButton />
      <style>{`
        @media print {
          @page { size: A4; margin: 1.5cm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .page-break { page-break-before: always; }
          .no-break { page-break-inside: avoid; }
        }
        * { box-sizing: border-box; }
        html, body, #__next { margin: 0; padding: 0; min-height: 100%; background: #fff !important; color: #111827; color-scheme: light; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; }
        h1, h2, h3 { margin: 0; }
      `}</style>

      <div style={{ minHeight: '100vh', width: '100%', background: '#fff', color: '#111827' }}>
        <div style={{ maxWidth: '210mm', margin: '0 auto', padding: '32px 40px', background: '#fff' }}>

        {/* Header */}
        <div style={{ borderBottom: '3px solid #111', paddingBottom: '20px', marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em' }}>
                JustScan — Security Report
              </h1>
              <p style={{ color: '#555', marginTop: '4px', fontSize: '13px' }}>
                Generated {formatDate(new Date().toISOString())}
              </p>
            </div>
      			{isSuccessfulReportState && (
              <div style={{
                background: totalActive === 0 ? '#dcfce7' : '#fef2f2',
                color: totalActive === 0 ? '#166534' : '#991b1b',
                border: `1px solid ${totalActive === 0 ? '#86efac' : '#fca5a5'}`,
                padding: '6px 14px', borderRadius: '6px', fontWeight: 700, fontSize: '13px',
              }}>
                {totalActive === 0 ? 'No Vulnerabilities' : `${totalActive} Active Finding${totalActive !== 1 ? 's' : ''}`}
              </div>
            )}
          </div>
        </div>

        {/* Scan Metadata */}
        <div className="no-break" style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#444' }}>
            Scan Details
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <tbody>
              {([
                ['Image', imageRef],
                ['Digest', scan.image_digest || '—'],
                ...(opts.showScanId ? [['Scan ID', scan.id]] : []),
                ['Status', formatStatusLabel(displayStatus)],
                ...(opts.showStarted ? [['Started', formatDate(scan.started_at)]] : []),
                ...(opts.showCompleted ? [['Completed', formatDate(scan.completed_at)]] : []),
                ...(opts.showTrivyVersion ? [['Scanner Versions', [scan.trivy_version ? `Trivy ${scan.trivy_version}` : '', scan.grype_version ? `Grype ${scan.grype_version}` : ''].filter(Boolean).join(' · ') || '—']] : []),
                ...(imageLocation ? [['Registry / Location', imageLocation]] : []),
                ...(scan.tags && scan.tags.length > 0 ? [['Tags', scan.tags.map((t) => t.name).join(', ')]] : []),
                ...customFields.map(f => [f.label, f.value]),
              ] as [string, string][]).map(([label, value]) => (
                <tr key={label} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600, color: '#555', width: '160px' }}>{label}</td>
                  <td style={{ padding: '6px 8px', fontFamily: label === 'Digest' || label === 'Scan ID' ? 'monospace' : 'inherit', fontSize: label === 'Digest' || label === 'Scan ID' ? '11px' : '13px', wordBreak: 'break-all' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Severity Summary */}
        <div className="no-break" style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#444' }}>
            Severity Summary
          </h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {SEVERITY_ORDER.map((sev) => (
                  <th key={sev} style={{ padding: '8px', fontWeight: 700, color: SEVERITY_COLORS[sev], border: '1px solid #e5e7eb' }}>
                    {sev}
                  </th>
                ))}
                <th style={{ padding: '8px', fontWeight: 700, color: '#374151', border: '1px solid #e5e7eb' }}>SUPPRESSED</th>
                <th style={{ padding: '8px', fontWeight: 700, color: '#374151', border: '1px solid #e5e7eb' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {SEVERITY_ORDER.map((sev) => (
                  <td key={sev} style={{ padding: '10px 8px', fontWeight: 800, fontSize: '20px', color: severityCounts[sev] > 0 ? SEVERITY_COLORS[sev] : '#9ca3af', border: '1px solid #e5e7eb' }}>
                    {severityCounts[sev] ?? 0}
                  </td>
                ))}
                <td style={{ padding: '10px 8px', fontWeight: 800, fontSize: '20px', color: '#9ca3af', border: '1px solid #e5e7eb' }}>{suppressedVulns.length}</td>
                <td style={{ padding: '10px 8px', fontWeight: 800, fontSize: '20px', color: '#111', border: '1px solid #e5e7eb' }}>{vulns.length}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Active Vulnerabilities */}
        {activeVulns.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#444' }}>
              Active Vulnerabilities ({totalActive})
            </h2>
            {activeVulns.map((v) => (
              <div key={v.id} className="no-break" style={{
                border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${SEVERITY_COLORS[v.severity] ?? '#6b7280'}`,
                borderRadius: '4px', padding: '12px 14px', marginBottom: '10px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '13px' }}>{v.vuln_id}</span>
                      <SeverityBadge severity={v.severity} />
                      {opts.showCvss && v.cvss_score > 0 && (
                        <span style={{ fontSize: '11px', color: '#555', fontWeight: 600 }}>CVSS {v.cvss_score.toFixed(1)}</span>
                      )}
                    </div>
                    {v.title && <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '13px' }}>{v.title}</p>}
                    <p style={{ margin: 0, fontSize: '12px', color: '#444' }}>
                      <span style={{ fontWeight: 600 }}>{v.pkg_name}</span>{' '}
                      <span style={{ color: '#dc2626' }}>{v.installed_version}</span>
                      {v.fixed_version && <>{' → '}<span style={{ color: '#16a34a' }}>fix: {v.fixed_version}</span></>}
                    </p>
                    {opts.showDescription && v.description && (
                      <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#555', lineHeight: 1.5 }}>
                        {v.description.length > 350 ? v.description.slice(0, 350) + '…' : v.description}
                      </p>
                    )}
                    {opts.showReferences && v.references && v.references.length > 0 && (
                      <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#2563eb' }}>
                        {v.references.slice(0, 2).join(' · ')}
                      </p>
                    )}
                    {opts.showComments && v.comments && v.comments.length > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        {v.comments.map(c => (
                          <div key={c.id} style={{ marginTop: '6px', background: '#fffbeb', border: '1px solid #fde68a', borderLeft: '4px solid #f59e0b', borderRadius: '4px', padding: '8px 10px' }}>
                            <p style={{ margin: '0 0 3px', fontSize: '10px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              Analyst Note
                              {c.username && <span style={{ fontWeight: 400, marginLeft: '6px', textTransform: 'none', letterSpacing: 0 }}>— {c.username}</span>}
                            </p>
                            <p style={{ margin: 0, fontSize: '12px', color: '#78350f', lineHeight: 1.6 }}>{c.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Manual Findings */}
        {manualFindings.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#444' }}>
              Manual Findings ({manualFindings.length})
            </h2>
            {manualFindings.map((f) => (
              <div key={f.id} className="no-break" style={{ border: '1px solid #e5e7eb', borderLeft: '4px solid #7c3aed', borderRadius: '4px', padding: '12px 14px', marginBottom: '10px', position: 'relative' }}>
                <button
                  className="print:hidden"
                  onClick={() => deleteManualFinding(f.id)}
                  style={{ position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '14px', lineHeight: 1 }}
                  title="Delete finding"
                >✕</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '13px' }}>{f.vuln_id}</span>
                  <SeverityBadge severity={f.severity} />
                  <span style={{ display: 'inline-block', background: '#ede9fe', color: '#6d28d9', fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: '3px', letterSpacing: '0.05em' }}>MANUAL</span>
                  {opts.showCvss && f.cvss_score > 0 && (
                    <span style={{ fontSize: '11px', color: '#555', fontWeight: 600 }}>CVSS {f.cvss_score.toFixed(1)}</span>
                  )}
                </div>
                {f.title && <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '13px' }}>{f.title}</p>}
                {f.pkg_name && (
                  <p style={{ margin: 0, fontSize: '12px', color: '#444' }}>
                    <span style={{ fontWeight: 600 }}>{f.pkg_name}</span>{' '}
                    {f.installed_version && <span style={{ color: '#dc2626' }}>{f.installed_version}</span>}
                    {f.fixed_version && <>{' → '}<span style={{ color: '#16a34a' }}>fix: {f.fixed_version}</span></>}
                  </p>
                )}
                {f.justification && (
                  <div style={{ marginTop: '8px', background: '#ede9fe', border: '1px solid #c4b5fd', borderLeft: '4px solid #7c3aed', borderRadius: '4px', padding: '8px 10px' }}>
                    <p style={{ margin: '0 0 3px', fontSize: '10px', fontWeight: 700, color: '#5b21b6', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Justification</p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#4c1d95', lineHeight: 1.6 }}>{f.justification}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Suppressed Vulnerabilities */}
        {opts.showSuppressed && suppressedVulns.length > 0 && (
          <div style={{ marginBottom: '28px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#444' }}>
              Suppressed ({suppressedVulns.length})
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>CVE / ID</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>Package</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>Severity</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>Source</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>Justification</th>
                </tr>
              </thead>
              <tbody>
                {suppressedVulns.map((v) => {
                  const statusLabel: Record<string, string> = { accepted: 'Accepted', wont_fix: "Won't Fix", false_positive: 'False Positive', xray_ignore: 'Xray Ignore' };
                  return (
                    <tr key={v.id} style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', border: '1px solid #e5e7eb' }}>{v.vuln_id}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb' }}>{v.pkg_name}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb' }}>{v.severity}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb' }}>{v.suppression ? (statusLabel[v.suppression.status] ?? v.suppression.status) : '—'}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb' }}>{v.suppression?.source ?? 'local'}</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb', color: '#374151' }}>{[v.suppression?.justification, v.suppression?.xray_policy_name, v.suppression?.xray_watch_name].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '14px', marginTop: '16px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9ca3af' }}>
          <span>JustScan Security Report · {imageRef}</span>
          <span>Scan ID: {scan.id}</span>
        </div>
        </div>
      </div>
    </>
  );
}
