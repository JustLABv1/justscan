'use client';
import { Logo } from '@/components/logo';
import { getPublicScan, getToken, listPublicVulnerabilities, Scan, Vulnerability } from '@/lib/api';
import { updatePublicHistoryEntry } from '@/lib/publicScanHistory';
import { ListBox, Select } from '@heroui/react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: 'Critical', color: 'text-red-500 dark:text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  HIGH:     { label: 'High',     color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  MEDIUM:   { label: 'Medium',   color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  LOW:      { label: 'Low',      color: 'text-blue-500 dark:text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  UNKNOWN:  { label: 'Unknown',  color: 'text-zinc-500',  bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20' },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEV_CONFIG[severity] ?? SEV_CONFIG.UNKNOWN;
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-9 h-9" />;
  const isDark = resolvedTheme === 'dark';
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
      style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

function ScanningAnimation({ image }: { image: string }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-6">
      <div className="relative flex items-center justify-center w-40 h-40">
        <span className="absolute w-40 h-40 rounded-full border border-violet-500/20 animate-ping" style={{ animationDuration: '2s' }} />
        <span className="absolute w-32 h-32 rounded-full border border-violet-500/30 animate-ping" style={{ animationDuration: '1.6s', animationDelay: '0.3s' }} />
        <span className="absolute w-24 h-24 rounded-full border border-violet-500/40 animate-ping" style={{ animationDuration: '1.2s', animationDelay: '0.6s' }} />
        <span className="absolute w-28 h-28 rounded-full border-2 border-t-violet-500 border-r-violet-400/40 border-b-violet-500/10 border-l-violet-400/20 animate-spin" style={{ animationDuration: '1.2s' }} />
        <div
          className="relative w-16 h-16 rounded-2xl flex items-center justify-center z-10"
          style={{
            background: isDark
              ? 'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(109,40,217,0.15) 100%)'
              : 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(109,40,217,0.08) 100%)',
            border: '1px solid rgba(167,139,250,0.3)',
            boxShadow: '0 0 30px rgba(124,58,237,0.25)',
          }}
        >
          <Logo size={28} className="text-[#a78bfa]" />
        </div>
        <div
          className="absolute w-28 h-0.5 rounded-full"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.8), transparent)',
            animation: 'scanLine 2s ease-in-out infinite',
          }}
        />
        <style>{`
          @keyframes scanLine {
            0%   { transform: translateY(-48px); opacity: 0; }
            20%  { opacity: 1; }
            80%  { opacity: 1; }
            100% { transform: translateY(48px); opacity: 0; }
          }
        `}</style>
      </div>
      <div className="text-center space-y-1.5">
        <p className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Scanning image…</p>
        <p className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>{image}</p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>This may take up to a minute</p>
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-violet-500"
            style={{ animation: 'bounce 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  );
}

const LIMIT = 25;

export default function PublicScanResultPage() {
  const { id } = useParams<{ id: string }>();
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState('');
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState('');
  const [pkgInput, setPkgInput] = useState('');
  const [pkgFilter, setPkgFilter] = useState('');
  const [minCvss, setMinCvss] = useState(0);
  const [minCvssInput, setMinCvssInput] = useState('');
  const [hasFix, setHasFix] = useState(false);
  const [sortBy, setSortBy] = useState('severity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [vulnLoading, setVulnLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setIsLoggedIn(!!getToken()), []);

  useEffect(() => {
    function fetchScan() {
      getPublicScan(id)
        .then(s => {
          setScan(s);
          if (s.status === 'completed' || s.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            updatePublicHistoryEntry(id, {
              status: s.status,
              critical_count: s.critical_count ?? 0,
              high_count: s.high_count ?? 0,
              medium_count: s.medium_count ?? 0,
              low_count: s.low_count ?? 0,
              unknown_count: s.unknown_count ?? 0,
            });
          }
        })
        .catch(e => {
          setError(e.message);
          if (pollRef.current) clearInterval(pollRef.current);
        });
    }
    fetchScan();
    pollRef.current = setInterval(fetchScan, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  useEffect(() => {
    if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    pkgDebounceRef.current = setTimeout(() => { setPkgFilter(pkgInput); setPage(1); }, 400);
    return () => { if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current); };
  }, [pkgInput]);

  useEffect(() => {
    if (!scan || scan.status !== 'completed') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVulnLoading(true);
    listPublicVulnerabilities(id, page, LIMIT, severityFilter || undefined, pkgFilter || undefined, hasFix || undefined, minCvss || undefined, sortBy, sortDir)
      .then(res => { setVulns(res.data ?? []); setVulnTotal(res.total); })
      .catch(() => {})
      .finally(() => setVulnLoading(false));
  }, [id, scan?.status, page, severityFilter, pkgFilter, minCvss, hasFix, sortBy, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputCls = 'px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-500/40 transition-colors rounded-xl';

  if (error) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--app-bg)' }}>
      <div className="text-center space-y-3">
        <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>
        <Link href="/public/scan/image" className="text-violet-600 dark:text-violet-400 text-sm hover:underline">← Try another scan</Link>
      </div>
    </div>
  );

  const isScanning = !scan || scan.status === 'pending' || scan.status === 'running';
  const totalPages = Math.max(1, Math.ceil(vulnTotal / LIMIT));
  const imageName = scan ? `${scan.image_name}:${scan.image_tag}` : '…';

  return (
    <div className="min-h-screen" style={{ background: 'var(--app-bg)' }}>
      {/* Nav */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-6 py-4"
        style={{ background: 'var(--app-bg)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <Link href="/public/scan/image" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 12px rgba(124,58,237,0.4)' }}>
            <Logo size={16} className="text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </Link>

        <div className="flex items-center gap-2">
          {scan?.status === 'completed' && (
            <Link
              href={`/reports/print?scans=${id}`}
              target="_blank"
              className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors flex items-center gap-1.5"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </Link>
          )}
          <ThemeToggle />
          {isLoggedIn ? (
            <Link href="/scans"
              className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Dashboard →
            </Link>
          ) : (
            <Link href="/login" className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Scan header */}
        <div>
          <Link href="/public/scan/image" className="inline-flex items-center gap-1.5 text-sm transition-colors mb-3"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            New scan
          </Link>
          <h1 className="text-xl font-bold font-mono break-all" style={{ color: 'var(--text-primary)' }}>{imageName}</h1>
          {scan?.image_digest && <p className="text-xs font-mono mt-1 break-all" style={{ color: 'var(--text-faint)' }}>{scan.image_digest}</p>}
          {scan?.architecture && (
            <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="4"/><line x1="15" y1="2" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="22"/><line x1="15" y1="20" x2="15" y2="22"/><line x1="2" y1="9" x2="4" y2="9"/><line x1="20" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="4" y2="15"/><line x1="20" y1="15" x2="22" y2="15"/></svg>
              {scan.architecture} · {scan.os_family} {scan.os_name}
            </p>
          )}
        </div>

        {isScanning && <ScanningAnimation image={imageName} />}

        {scan?.status === 'failed' && (
          <div className="rounded-2xl px-6 py-5 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-red-500 dark:text-red-400 font-medium">Scan failed</p>
            {scan.error_message && <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{scan.error_message}</p>}
            <Link href="/public/scan/image" className="inline-block mt-3 text-sm text-violet-600 dark:text-violet-400 hover:underline">Try another image →</Link>
          </div>
        )}

        {scan?.status === 'completed' && (
          <>
            {/* Severity cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { ...SEV_CONFIG.CRITICAL, count: scan.critical_count },
                { ...SEV_CONFIG.HIGH,     count: scan.high_count },
                { ...SEV_CONFIG.MEDIUM,   count: scan.medium_count },
                { ...SEV_CONFIG.LOW,      count: scan.low_count },
              ].map(({ label, count, color, border }) => (
                <div
                  key={label}
                  className={`rounded-2xl border ${border} p-4 cursor-pointer transition-all hover:scale-105`}
                  style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)' }}
                  onClick={() => { setSeverityFilter(f => f === label.toUpperCase() ? '' : label.toUpperCase()); setPage(1); }}
                >
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
                  <p className={`text-2xl font-bold ${color}`}>{count ?? 0}</p>
                </div>
              ))}
            </div>

            {/* Vulnerabilities */}
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Vulnerabilities
                  {vulnTotal > 0 && <span className="text-sm font-normal ml-2" style={{ color: 'var(--text-muted)' }}>{vulnTotal} found</span>}
                </h2>
                <div className="flex flex-wrap gap-2 items-center">
                  <Select selectedKey={severityFilter || '__all__'} onSelectionChange={k => { setSeverityFilter(String(k === '__all__' ? '' : k)); setPage(1); }}>
                    <Select.Trigger className={inputCls} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id="__all__">All Severities</ListBox.Item>
                        <ListBox.Item id="CRITICAL">Critical</ListBox.Item>
                        <ListBox.Item id="HIGH">High</ListBox.Item>
                        <ListBox.Item id="MEDIUM">Medium</ListBox.Item>
                        <ListBox.Item id="LOW">Low</ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <input
                    type="text"
                    value={pkgInput}
                    onChange={e => setPkgInput(e.target.value)}
                    placeholder="Package…"
                    className={inputCls}
                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
                  />
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={minCvssInput}
                    onChange={e => {
                      setMinCvssInput(e.target.value);
                      const v = parseFloat(e.target.value);
                      setMinCvss(isNaN(v) ? 0 : v);
                      setPage(1);
                    }}
                    placeholder="Min CVSS"
                    className={inputCls}
                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', width: 100 }}
                  />
                  <button
                    onClick={() => { setHasFix(!hasFix); setPage(1); }}
                    className="px-3 py-2 text-sm rounded-xl transition-colors"
                    style={hasFix
                      ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#7c3aed' }
                      : { background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                  >
                    Has Fix
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                      {([
                        { label: 'CVE ID', key: 'vuln_id' },
                        { label: 'Package', key: 'pkg_name' },
                        { label: 'Installed', key: 'installed_version' },
                        { label: 'Fixed In', key: 'fixed_version' },
                        { label: 'Severity', key: 'severity' },
                        { label: 'CVSS', key: 'cvss_score' },
                      ] as { label: string; key: string }[]).map(({ label, key }) => {
                        const active = sortBy === key;
                        return (
                          <th
                            key={key}
                            onClick={() => { if (active) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortBy(key); setSortDir('asc'); } setPage(1); }}
                            className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider cursor-pointer select-none"
                            style={{ color: active ? '#7c3aed' : 'var(--text-faint)' }}
                          >
                            <span className="inline-flex items-center gap-1">
                              {label}
                              {active && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {vulnLoading ? (
                      <tr><td colSpan={6} className="py-12 text-center">
                        <div className="flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-t-violet-500 animate-spin" style={{ borderColor: 'var(--border-subtle)', borderTopColor: '#7c3aed' }} /></div>
                      </td></tr>
                    ) : vulns.length === 0 ? (
                      <tr><td colSpan={6} className="py-12 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                        {vulnTotal === 0 ? 'No vulnerabilities found.' : 'No results match your filters.'}
                      </td></tr>
                    ) : vulns.map((v, i) => (
                      <tr
                        key={v.id}
                        style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td className="px-4 py-3">
                          {v.vuln_id ? (
                            <a href={`https://nvd.nist.gov/vuln/detail/${v.vuln_id}`} target="_blank" rel="noreferrer"
                              className="font-mono text-xs text-violet-600 dark:text-violet-400 hover:underline transition-colors">
                              {v.vuln_id}
                            </a>
                          ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{v.pkg_name}</td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{v.installed_version}</td>
                        <td className="px-4 py-3 font-mono text-xs text-emerald-600 dark:text-emerald-500">
                          {v.fixed_version || <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        </td>
                        <td className="px-4 py-3"><SeverityBadge severity={v.severity} /></td>
                        <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                          {v.cvss_score ? v.cvss_score.toFixed(1) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{vulnTotal} total</span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                      className="px-3 py-1.5 text-sm rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >← Prev</button>
                    <span className="text-sm px-2" style={{ color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
                    <button
                      disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                      className="px-3 py-1.5 text-sm rounded-xl disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                    >Next →</button>
                  </div>
                </div>
              )}
            </div>

            {/* Sign-in CTA */}
            <div
              className="rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(167,139,250,0.15)' }}
            >
              <div>
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Want more features?</p>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Sign in to track scans, add tags, suppress findings, and more.</p>
              </div>
              <Link
                href="/login"
                className="shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.25)' }}
              >
                Sign in →
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
