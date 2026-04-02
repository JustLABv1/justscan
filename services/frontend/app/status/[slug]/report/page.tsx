'use client';

import { ApiError, getStatusPageBySlug, listStatusPageItemVulnerabilities, StatusPageItem, Vulnerability } from '@/lib/api';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

const REPORT_PAGE_SIZE = 500;

const SEV_COLORS: Record<string, { bg: string; fg: string; light: string }> = {
  CRITICAL: { bg: '#dc2626', fg: '#ffffff', light: '#fef2f2' },
  HIGH: { bg: '#ea580c', fg: '#ffffff', light: '#fff7ed' },
  MEDIUM: { bg: '#ca8a04', fg: '#ffffff', light: '#fefce8' },
  LOW: { bg: '#2563eb', fg: '#ffffff', light: '#eff6ff' },
  UNKNOWN: { bg: '#6b7280', fg: '#ffffff', light: '#f9fafb' },
};

function formatDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SeverityBadge({ severity }: { severity: string }) {
  const config = SEV_COLORS[severity] ?? SEV_COLORS.UNKNOWN;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      fontSize: '10px',
      fontWeight: 700,
      background: config.bg,
      color: config.fg,
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
    }}>
      {severity}
    </span>
  );
}

async function fetchAllVulnerabilities(
  slug: string,
  scanId: string,
  severity: string,
  pkg: string,
  hasFix: boolean,
  minCvss: number,
  sortBy: string,
  sortDir: 'asc' | 'desc',
) {
  const all: Vulnerability[] = [];
  let page = 1;

  while (true) {
    const response = await listStatusPageItemVulnerabilities(
      slug,
      scanId,
      page,
      REPORT_PAGE_SIZE,
      severity || undefined,
      pkg || undefined,
      hasFix || undefined,
      minCvss || undefined,
      sortBy,
      sortDir,
    );

    const items = response.data ?? [];
    all.push(...items);
    if (all.length >= (response.total ?? all.length) || items.length < REPORT_PAGE_SIZE) {
      break;
    }
    page += 1;
  }

  return all;
}

function StatusReportContent() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const scanId = searchParams.get('scanId') ?? '';
  const severity = searchParams.get('severity') ?? '';
  const pkg = searchParams.get('pkg') ?? '';
  const hasFix = searchParams.get('hasFix') === 'true';
  const minCvss = Number(searchParams.get('minCvss') ?? '0') || 0;
  const sortBy = searchParams.get('sortBy') ?? 'severity';
  const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';

  const [pageName, setPageName] = useState('Status Report');
  const [item, setItem] = useState<StatusPageItem | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [error, setError] = useState('');

  const requestError = !scanId ? 'Missing scanId query parameter.' : '';

  useEffect(() => {
    if (!scanId) return;

    let cancelled = false;

    async function load() {
      try {
        const page = await getStatusPageBySlug(slug);
        if (cancelled) return;

        setPageName(page.page.name);
        const matched = (page.items ?? []).find(candidate => candidate.latest_scan_id === scanId);
        if (!matched) {
          setError('Status page item not found.');
          return;
        }

        setItem(matched);
        const findings = await fetchAllVulnerabilities(slug, scanId, severity, pkg, hasFix, minCvss, sortBy, sortDir);
        if (cancelled) return;
        setVulns(findings);
        setError('');
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to load report');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, scanId, severity, pkg, hasFix, minCvss, sortBy, sortDir]);

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
    for (const vuln of vulns) {
      counts[vuln.severity] = (counts[vuln.severity] ?? 0) + 1;
    }
    return counts;
  }, [vulns]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (severity) parts.push(`Severity: ${severity}`);
    if (pkg) parts.push(`Package: ${pkg}`);
    if (minCvss > 0) parts.push(`Min CVSS: ${minCvss.toFixed(1)}`);
    if (hasFix) parts.push('Has Fix only');
    parts.push(`Sort: ${sortBy} ${sortDir}`);
    return parts;
  }, [severity, pkg, minCvss, hasFix, sortBy, sortDir]);

  if (requestError) {
    return <div style={{ padding: '40px', color: '#dc2626', fontFamily: 'sans-serif' }}><strong>Error:</strong> {requestError}</div>;
  }

  if (error) {
    return <div style={{ padding: '40px', color: '#dc2626', fontFamily: 'sans-serif' }}><strong>Error:</strong> {error}</div>;
  }

  if (!item) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#6b7280', gap: 12 }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ width: 20, height: 20, border: '2px solid #e5e7eb', borderTopColor: '#7c3aed', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        Loading report…
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 1.5cm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print\\:hidden { display: none !important; }
        }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; }
      `}</style>

      <button
        onClick={() => window.print()}
        className="print:hidden"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 20,
          border: 'none',
          borderRadius: 10,
          padding: '10px 16px',
          fontSize: 13,
          fontWeight: 700,
          color: '#fff',
          background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
          boxShadow: '0 0 18px rgba(124,58,237,0.28)',
          cursor: 'pointer',
        }}
      >
        Save as PDF
      </button>

      <div style={{ width: '100%', maxWidth: '186mm', margin: '0 auto', padding: '28px 0 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e5e7eb', paddingBottom: 20, marginBottom: 28 }}>
          <div style={{ borderLeft: '5px solid #7c3aed', paddingLeft: 16 }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>JustScan Status Report</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{pageName}</p>
            <p style={{ margin: '8px 0 0', fontFamily: 'monospace', fontSize: 11, color: '#6b7280', wordBreak: 'break-all' }}>
              {item.image_name}:{item.image_tag}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ background: '#ede9fe', color: '#6d28d9', fontWeight: 700, fontSize: 12, padding: '4px 12px', borderRadius: 999, border: '1px solid #c4b5fd' }}>
              {vulns.length.toLocaleString()} findings
            </span>
            <span style={{ fontSize: 11, color: '#6b7280' }}>Generated {formatDate(new Date().toISOString())}</span>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #7c3aed', paddingBottom: 6, display: 'inline-block' }}>
            Scan Snapshot
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, border: '1px solid #e5e7eb' }}>
            <tbody>
              {([
                ['Observed', formatDate(item.observed_at)],
                ['Status', item.status],
                ['Scan state', item.scan_status],
                ['Freshness', `${item.freshness_hours}h`],
                ['Latest scan ID', item.latest_scan_id],
              ] as [string, string][]).map(([label, value]) => (
                <tr key={label}>
                  <td style={{ width: 140, padding: '6px 10px', fontWeight: 600, color: '#374151', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>{label}</td>
                  <td style={{ padding: '6px 10px', color: '#111827', borderBottom: '1px solid #e5e7eb', fontFamily: label === 'Latest scan ID' ? 'monospace' : 'inherit', fontSize: label === 'Latest scan ID' ? 11 : 12, wordBreak: 'break-all' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #7c3aed', paddingBottom: 6, display: 'inline-block' }}>
            Applied Filters
          </p>
          {filterSummary.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {filterSummary.map(part => (
                <span key={part} style={{ background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 600 }}>{part}</span>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>No additional filters were applied.</p>
          )}
        </div>

        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #7c3aed', paddingBottom: 6, display: 'inline-block' }}>
            Severity Summary
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const).map(severityKey => (
                  <th key={severityKey} style={{ padding: '8px', textAlign: 'center', border: '1px solid #e5e7eb', fontWeight: 700, color: SEV_COLORS[severityKey].bg }}>{severityKey}</th>
                ))}
                <th style={{ padding: '8px', textAlign: 'center', border: '1px solid #e5e7eb', fontWeight: 700, color: '#374151' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const).map(severityKey => (
                  <td key={severityKey} style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #e5e7eb', fontWeight: 800, fontSize: 20, color: severityCounts[severityKey] > 0 ? SEV_COLORS[severityKey].bg : '#9ca3af' }}>
                    {severityCounts[severityKey]}
                  </td>
                ))}
                <td style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #e5e7eb', fontWeight: 800, fontSize: 20 }}>{vulns.length}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #7c3aed', paddingBottom: 6, display: 'inline-block' }}>
            Vulnerabilities
          </p>
          {vulns.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6b7280', fontStyle: 'italic' }}>No vulnerabilities match the current filters.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['CVE ID', 'Package', 'Installed', 'Fixed In', 'Severity', 'CVSS'].map(header => (
                    <th key={header} style={{ padding: '7px 10px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600, color: '#374151', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vulns.map((vuln, index) => (
                  <tr key={vuln.id} style={{ background: index % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ color: '#7c3aed', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{vuln.vuln_id || '—'}</span>
                        {vuln.title && <span style={{ color: '#6b7280', fontSize: 11, lineHeight: 1.45 }}>{vuln.title}</span>}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, verticalAlign: 'top' }}>{vuln.pkg_name}</td>
                    <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, color: '#6b7280', verticalAlign: 'top' }}>{vuln.installed_version || '—'}</td>
                    <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, color: '#15803d', verticalAlign: 'top' }}>{vuln.fixed_version || '—'}</td>
                    <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', verticalAlign: 'top' }}><SeverityBadge severity={vuln.severity} /></td>
                    <td style={{ padding: '8px 10px', border: '1px solid #e5e7eb', fontFamily: 'monospace', fontSize: 11, verticalAlign: 'top' }}>{vuln.cvss_score ? vuln.cvss_score.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

export default function StatusReportPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#6b7280' }}>Loading…</div>}>
      <StatusReportContent />
    </Suspense>
  );
}