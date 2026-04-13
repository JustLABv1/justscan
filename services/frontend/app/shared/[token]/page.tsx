'use client';
import { Logo } from '@/components/logo';
import { ScanDetailHeader } from '@/components/scans/scan-detail-header';
import { nativeFieldClassName } from '@/components/ui/form-styles';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type { Scan, Vulnerability } from '@/lib/api';
import { ApiError, getSharedScan, getSharedVulnerabilityContextAnalysis, getToken, listScans, listSharedVulnerabilities, rescanShared } from '@/lib/api';
import { Button, useOverlayState } from '@heroui/react';
import { CpuIcon, FileExportIcon, GitCompareIcon, Refresh01Icon } from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ScanningAnimation, ScanStepTimeline } from '../../../components/scans/scan-runtime';

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

function SourceBadge({ source }: { source?: string }) {
  const normalized = (source ?? '').trim().toLowerCase();
  const isOSV = normalized === 'osv.dev';
  const isXray = normalized === 'jfrog xray' || normalized === 'xray';
  const label = isOSV ? 'OSV.dev' : isXray ? 'Xray' : source?.trim() || 'Trivy';
  return (
    <span
      className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
      style={isOSV
        ? { background: 'rgba(59,130,246,0.14)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.24)' }
        : isXray
          ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.22)' }
          : { background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.22)' }}
      title={source || (isOSV ? 'OSV supplemental finding' : isXray ? 'JFrog Xray finding' : 'Scanner finding')}
    >
      {label}
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

const LIMIT = 25;

type ResultTab = 'overview' | 'timeline';

export default function SharedScanPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
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
  const [reScanning, setReScanning] = useState(false);
  const [comparingPrev, setComparingPrev] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>('overview');
  const vulnerabilityDetailsModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setIsLoggedIn(!!getToken());
  }, []);

  useEffect(() => {
    function fetchScan() {
      getSharedScan(token)
        .then(s => {
          setScan(s);
          if (s.status === 'completed' || s.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        })
        .catch(e => {
          if (e instanceof ApiError && e.status === 401) {
            router.push(`/login?returnUrl=/shared/${token}`);
            return;
          }
          setError(e.message);
          if (pollRef.current) clearInterval(pollRef.current);
        });
    }
    fetchScan();
    pollRef.current = setInterval(fetchScan, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [token, router]);

  useEffect(() => {
    if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    pkgDebounceRef.current = setTimeout(() => { setPkgFilter(pkgInput); setPage(1); }, 400);
    return () => { if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current); };
  }, [pkgInput]);

  useEffect(() => {
    if (!scan || (scan.status !== 'completed' && scan.external_status !== 'blocked_by_xray_policy')) return;
    setVulnLoading(true);
    listSharedVulnerabilities(token, page, LIMIT, severityFilter || undefined, pkgFilter || undefined, hasFix || undefined, minCvss || undefined, sortBy, sortDir)
      .then(res => { setVulns(res.data ?? []); setVulnTotal(res.total); })
      .catch(e => {
        if (e instanceof ApiError && e.status === 401) {
          router.push(`/login?returnUrl=/shared/${token}`);
        }
      })
      .finally(() => setVulnLoading(false));
  }, [token, scan?.status, scan?.external_status, page, severityFilter, pkgFilter, minCvss, hasFix, sortBy, sortDir, router]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRescan() {
    setReScanning(true);
    setActionError('');
    try {
      const result = await rescanShared(token);
      if (result.type === 'authenticated') {
        router.push(`/scans/${result.scan_id}`);
      } else {
        router.push(`/public/scan/${result.scan_id}`);
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to queue re-scan');
    } finally {
      setReScanning(false);
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

  const inputCls = nativeFieldClassName;

  function openVulnerabilityDetails(vulnerability: Vulnerability) {
    setSelectedVulnerability(vulnerability);
    vulnerabilityDetailsModal.open();
  }

  function closeVulnerabilityDetails() {
    vulnerabilityDetailsModal.close();
    setSelectedVulnerability(null);
  }

  if (error) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--app-bg)' }}>
      <div className="text-center space-y-3">
        <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>
        <Link href="/" className="text-violet-600 dark:text-violet-400 text-sm hover:underline">← Back to home</Link>
      </div>
    </div>
  );

  const isScanning = !scan || scan.status === 'pending' || scan.status === 'running';
  const isBlockedByXrayPolicy = scan?.external_status === 'blocked_by_xray_policy';
  const showResultTabs = Boolean(scan && !isScanning && (scan.status === 'completed' || scan.status === 'failed'));
  const showRecoveredOverview = Boolean(scan && (scan.status === 'completed' || isBlockedByXrayPolicy));
  const totalPages = Math.max(1, Math.ceil(vulnTotal / LIMIT));
  const imageName = scan ? `${scan.image_name}:${scan.image_tag}` : '…';

  return (
    <div className="min-h-screen" style={{ background: 'var(--app-bg)' }}>
      {/* Nav */}
      <header
        className="sticky top-0 z-20 flex items-center justify-between px-6 py-4"
        style={{ background: 'var(--app-bg)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 12px rgba(124,58,237,0.4)' }}>
            <Logo size={16} className="text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isLoggedIn ? (
            <Link href="/scans"
              className="btn-secondary">
              Dashboard →
            </Link>
          ) : (
            <Link href={`/login?returnUrl=/shared/${token}`}
              className="btn-secondary">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 py-8 space-y-6">
        {actionError && (
          <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
            {actionError}
          </div>
        )}

        <ScanDetailHeader
          badges={(
            <>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                Shared scan
              </span>
              {scan?.share_visibility === 'authenticated' && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: 'rgba(234,179,8,0.1)', color: '#facc15', border: '1px solid rgba(234,179,8,0.2)' }}>
                  Signed-in users only
                </span>
              )}
            </>
          )}
          title={imageName}
          subtitle={scan?.image_digest ? <span>{scan.image_digest}</span> : undefined}
          meta={scan?.architecture ? (
            <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <CpuIcon size={12} />
              {scan.architecture} · {scan.os_family} {scan.os_name}
            </p>
          ) : undefined}
          actions={(
            <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Shared scan actions">
              {(scan?.status === 'completed' || isBlockedByXrayPolicy) && (
                <Button
                  className="btn-secondary"
                  onPress={() => window.open(`/reports/print?scans=${scan.id}`, '_blank', 'noopener,noreferrer')}
                  variant="secondary"
                >
                  <FileExportIcon size={15} />
                  Export
                </Button>
              )}
              {(scan?.status === 'completed' || scan?.status === 'failed') && (
                <Button className="btn-primary" isDisabled={reScanning} onPress={handleRescan} variant="primary">
                  {reScanning
                    ? <span className="w-3.5 h-3.5 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
                    : <Refresh01Icon size={15} />}
                  Re-scan
                </Button>
              )}
              {scan?.status === 'completed' && isLoggedIn && (
                <Button className="btn-secondary" isDisabled={comparingPrev} onPress={handleComparePrev} variant="secondary">
                  {comparingPrev
                    ? <span className="w-3.5 h-3.5 border-2 border-zinc-400/30 border-t-zinc-400 rounded-full animate-spin" />
                    : <GitCompareIcon size={15} />}
                  Compare
                </Button>
              )}
            </div>
          )}
        />

        {isScanning && (
          <ScanningAnimation
            image={imageName}
            status={scan?.status ?? 'pending'}
            startedAt={scan?.started_at ?? null}
            scanProvider={scan?.scan_provider}
            currentStep={scan?.current_step ?? null}
            stepLogs={scan?.step_logs ?? null}
          />
        )}

        {showResultTabs && (
          <div className="w-full overflow-x-auto pb-1">
            <div className="segmented-control min-w-max">
              {([
                { id: 'overview', label: showRecoveredOverview ? 'Overview' : 'Status' },
                { id: 'timeline', label: scan?.step_logs?.length ? `Timeline (${scan.step_logs.length})` : 'Timeline' },
              ] as { id: ResultTab; label: string }[]).map(({ id, label }) => (
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

        {scan?.status === 'failed' && activeTab === 'overview' && !isBlockedByXrayPolicy && (
          <>
            <div className="rounded-2xl px-6 py-5 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-red-500 dark:text-red-400 font-medium">Scan failed</p>
              {scan.error_message && <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>{scan.error_message}</p>}
            </div>
          </>
        )}

        {isBlockedByXrayPolicy && activeTab === 'overview' && (
          <div className="rounded-2xl px-6 py-5" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.22)' }}>
            <p className="font-medium" style={{ color: '#f59e0b' }}>Blocked by Xray policy</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Xray blocked the normal scan path, but JustScan recovered any findings the provider still exposed. The results below reflect that recovered data.
            </p>
            {scan?.error_message && <p className="text-sm mt-3 whitespace-pre-wrap break-all" style={{ color: 'var(--text-faint)' }}>{scan.error_message}</p>}
          </div>
        )}

        {scan && !isScanning && activeTab === 'timeline' && (
          <ScanStepTimeline
            stepLogs={scan.step_logs}
            completedAt={scan.completed_at}
            status={scan.status}
            externalStatus={scan.external_status}
            scanProvider={scan.scan_provider}
          />
        )}

        {scan && showRecoveredOverview && activeTab === 'overview' && (
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
              <div className="space-y-3">
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Vulnerabilities
                  {vulnTotal > 0 && <span className="text-sm font-normal ml-2" style={{ color: 'var(--text-muted)' }}>{vulnTotal} found</span>}
                </h2>
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  {/* Severity pills */}
                  <div className="w-full overflow-x-auto pb-1 xl:w-auto">
                    <div className="segmented-control min-w-max">
                      {['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(sev => (
                        <button key={sev || '__all__'} onClick={() => { setSeverityFilter(sev); setPage(1); }}
                          className="segmented-control-item"
                          data-active={severityFilter === sev ? 'true' : 'false'}
                          data-size="sm"
                          type="button">
                          {sev || 'All'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 md:flex-row md:items-end xl:w-auto xl:justify-end">
                    <input
                      type="text"
                      value={pkgInput}
                      onChange={e => setPkgInput(e.target.value)}
                      placeholder="Package…"
                      className={`${inputCls} min-w-[220px] flex-1 md:min-w-[280px] xl:w-[320px] xl:flex-none`}
                    />
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <label className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Min CVSS</label>
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
                        placeholder="0"
                        className={`${inputCls} w-full min-w-[5.5rem] md:w-24`}
                      />
                    </div>
                    <button
                      onClick={() => { setHasFix(!hasFix); setPage(1); }}
                      className={`${hasFix ? 'btn-primary' : 'btn-secondary'} w-full shrink-0 md:w-auto`}
                    >
                      Has Fix
                    </button>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
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
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button type="button" onClick={() => openVulnerabilityDetails(v)}
                                className="font-mono text-xs text-violet-600 dark:text-violet-400 hover:underline transition-colors">
                                {v.vuln_id}
                              </button>
                              <SourceBadge source={v.data_source} />
                            </div>
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
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{vulnTotal} total</span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                      className="btn-secondary"
                    >← Prev</button>
                    <span className="text-sm px-2" style={{ color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
                    <button
                      disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                      className="btn-secondary"
                    >Next →</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <VulnerabilityDetailsModal
          vulnerability={selectedVulnerability}
          state={vulnerabilityDetailsModal}
          onClose={closeVulnerabilityDetails}
          loadContextAnalysis={(vulnerability) => getSharedVulnerabilityContextAnalysis(token, vulnerability.id)}
        />
      </main>
    </div>
  );
}
