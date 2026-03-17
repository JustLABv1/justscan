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
  suppression?: { reason: string; note: string } | null;
  comments?: Comment[];
}

interface Tag { id: string; name: string; color: string; }

interface Scan {
  id: string;
  image_name: string;
  image_tag: string;
  image_digest: string;
  status: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  suppressed_count: number;
  trivy_version: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  tags?: Tag[];
}

interface ReportOpts {
  showCvss: boolean;
  showDescription: boolean;
  showReferences: boolean;
  showSuppressed: boolean;
  showComments: boolean;
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
  });

  useEffect(() => {
    const token = localStorage.getItem('justscan_token');
    if (!token) { setError('Not authenticated. Please log in and try again.'); return; }

    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    const headers = { Authorization: `Bearer ${token}` };

    async function load() {
      const scanRes = await fetch(`${api}/api/v1/scans/${scanId}`, { headers });
      if (!scanRes.ok) { setError(`Failed to load scan (${scanRes.status})`); return; }
      const scanData: Scan = await scanRes.json();
      setScan(scanData);

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
    }

    load().catch((e) => setError(e.message));
  }, [scanId]);

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

  return (
    <>
      {/* Floating config panel */}
      <div className="print:hidden fixed top-4 left-4 bg-white border border-gray-200 shadow-lg rounded-xl p-4 space-y-2 z-10" style={{ minWidth: '180px' }}>
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
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #111; background: #fff; }
        h1, h2, h3 { margin: 0; }
      `}</style>

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
            {scan.status === 'completed' && (
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
                ['Scan ID', scan.id],
                ['Status', scan.status.toUpperCase()],
                ['Started', formatDate(scan.started_at)],
                ['Completed', formatDate(scan.completed_at)],
                ['Trivy Version', scan.trivy_version || '—'],
                ...(scan.tags && scan.tags.length > 0 ? [['Tags', scan.tags.map((t) => t.name).join(', ')]] : []),
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
                      <div style={{ marginTop: '6px', borderTop: '1px solid #e5e7eb', paddingTop: '6px' }}>
                        {v.comments.map(c => (
                          <p key={c.id} style={{ margin: '2px 0', fontSize: '11px', color: '#374151' }}>
                            <span style={{ fontWeight: 600 }}>{c.username || 'Note'}:</span> {c.content}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
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
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {suppressedVulns.map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', border: '1px solid #e5e7eb' }}>{v.vuln_id}</td>
                    <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb' }}>{v.pkg_name}</td>
                    <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb' }}>{v.severity}</td>
                    <td style={{ padding: '5px 8px', border: '1px solid #e5e7eb' }}>{v.suppression?.reason ?? '—'}</td>
                  </tr>
                ))}
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
    </>
  );
}
