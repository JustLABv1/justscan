'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

interface Comment { id: string; user_id: string; content: string; username?: string; created_at: string; }
interface Tag { id: string; name: string; color: string; }
interface Vulnerability {
  id: string; vuln_id: string; pkg_name: string; installed_version: string;
  fixed_version: string; severity: string; title: string; description: string;
  cvss_score: number; references: string[];
  suppression?: { reason: string; note: string } | null;
  comments?: Comment[];
}
interface Scan {
  id: string; image_name: string; image_tag: string; image_digest: string;
  status: string; critical_count: number; high_count: number; medium_count: number;
  low_count: number; unknown_count: number; suppressed_count: number;
  trivy_version: string; started_at: string | null; completed_at: string | null;
  created_at: string; architecture?: string; os_family?: string; os_name?: string;
  tags?: Tag[];
}
interface ScanData { scan: Scan; vulns: Vulnerability[]; }
interface Filters {
  minCvss: number;
  severities: string[];
  onlyHasFix: boolean;
  showSuppressed: boolean;
  showComments: boolean;
  showDescription: boolean;
  showReferences: boolean;
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

function filterVulns(vulns: Vulnerability[], f: Filters): Vulnerability[] {
  return vulns.filter(v => {
    if (v.suppression && !f.showSuppressed) return false;
    if (f.severities.length > 0 && !f.severities.includes(v.severity)) return false;
    if (f.minCvss > 0 && v.cvss_score < f.minCvss) return false;
    if (f.onlyHasFix && !v.fixed_version) return false;
    return true;
  });
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
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: scan.status === 'completed' ? '#dcfce7' : '#fef2f2', color: scan.status === 'completed' ? '#15803d' : '#dc2626', border: `1px solid ${scan.status === 'completed' ? '#86efac' : '#fca5a5'}` }}>
            {scan.status.toUpperCase()}
          </span>
          {scan.architecture && <span style={{ fontSize: 10, color: '#6b7280' }}>{scan.architecture} · {scan.os_family}</span>}
        </div>
      </div>

      {/* Metadata */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 20, border: '1px solid #e5e7eb' }}>
        <tbody>
          {([
            ['Scan ID', scan.id, true],
            ['Started', fmt(scan.started_at), false],
            ['Completed', fmt(scan.completed_at), false],
            ['Trivy Version', scan.trivy_version || '—', false],
            ...(scan.os_family ? [['OS', `${scan.os_family} ${scan.os_name}`.trim(), false] as [string, string, boolean]] : []),
            ...(scan.architecture ? [['Architecture', scan.architecture, false] as [string, string, boolean]] : []),
            ...(scan.tags && scan.tags.length > 0 ? [['Tags', scan.tags.map(t => t.name).join(', '), false] as [string, string, boolean]] : []),
          ] as [string, string, boolean][]).map(([label, value, mono]) => (
            <tr key={label}>
              <td style={{ padding: '5px 12px', fontWeight: 600, color: '#374151', background: '#f9fafb', width: 140, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{label}</td>
              <td style={{ padding: '5px 12px', color: '#111827', fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 10 : 12, wordBreak: 'break-all', borderBottom: '1px solid #e5e7eb' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
                        <div style={{ marginTop: 4, borderTop: '1px solid #e5e7eb', paddingTop: 4 }}>
                          {v.comments.map(c => (
                            <p key={c.id} style={{ margin: '2px 0', fontSize: 10, color: '#374151' }}>
                              <strong>{c.username || 'Note'}:</strong> {c.content}
                            </p>
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

      {/* Suppressed */}
      {suppressedVulns.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>Suppressed ({suppressedVulns.length})</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['CVE ID', 'Package', 'Severity', 'Reason'].map(h => (
                  <th key={h} style={{ padding: '5px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600, color: '#6b7280' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppressedVulns.map(v => (
                <tr key={v.id} style={{ color: '#9ca3af' }}>
                  <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb', fontFamily: 'monospace' }}>{v.vuln_id}</td>
                  <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.pkg_name}</td>
                  <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.severity}</td>
                  <td style={{ padding: '4px 8px', border: '1px solid #e5e7eb' }}>{v.suppression?.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PrintReport() {
  const params = useSearchParams();
  const scanIds = (params.get('scans') ?? '').split(',').filter(Boolean);

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
  });

  useEffect(() => {
    if (!scanIds.length) { setError('No scan IDs provided.'); return; }
    const token = localStorage.getItem('justscan_token');
    if (!token) { setError('Not authenticated.'); return; }

    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    const headers = { Authorization: `Bearer ${token}` };

    Promise.all(scanIds.map(async (scanId): Promise<ScanData | null> => {
      const [scanRes, vulnRes] = await Promise.all([
        fetch(`${api}/api/v1/scans/${scanId}`, { headers }),
        fetch(`${api}/api/v1/scans/${scanId}/vulnerabilities?page=1&limit=500`, { headers }),
      ]);
      if (!scanRes.ok) return null;
      const scan: Scan = await scanRes.json();
      const vulnData = vulnRes.ok ? await vulnRes.json() : { data: [] };
      return { scan, vulns: vulnData.data ?? [] };
    })).then(results => {
      const valid = results.filter((r): r is ScanData => r !== null);
      if (!valid.length) setError('Failed to load scans.');
      else setData(valid);
    }).catch(e => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <div style={{ padding: 40, color: '#dc2626', fontFamily: 'sans-serif' }}><strong>Error:</strong> {error}</div>;
  if (!data.length) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#6b7280', gap: 12 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: 20, height: 20, border: '2px solid #e5e7eb', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      Loading report…
    </div>
  );

  const totalActive = data.reduce((sum, d) => sum + filterVulns(d.vulns.filter(v => !v.suppression), filters).length, 0);

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

      <div style={{ maxWidth: '210mm', margin: '0 auto', padding: '32px 40px' }}>

        {/* Report header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e5e7eb', paddingBottom: 20, marginBottom: 28 }}>
          <div style={{ borderLeft: '5px solid #7c3aed', paddingLeft: 16 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: 0, letterSpacing: '-0.02em' }}>Security Vulnerability Report</h1>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
              Generated {new Date().toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11 }}>
                      <a href={`#scan-${scan.id}`} style={{ color: '#7c3aed', textDecoration: 'none' }}>{scan.image_name}:{scan.image_tag}</a>
                    </td>
                    <td style={{ padding: '6px 10px', border: '1px solid #e5e7eb', textAlign: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: scan.status === 'completed' ? '#dcfce7' : '#fef2f2', color: scan.status === 'completed' ? '#15803d' : '#dc2626' }}>{scan.status}</span>
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
