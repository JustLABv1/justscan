'use client';
import { Logo } from '@/components/logo';
import { ApiError, getSharedScan, getToken, Scan } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

// ── Severity / status helpers ────────────────────────────────────────

const SEV: Record<string, string> = {
  critical: 'text-red-400 font-bold',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
};

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; label?: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.22)' },
  failed:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.22)' },
  running:   { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.22)' },
  pending:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'queued' },
  cancelled: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.20)' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`} />
      {s.label ?? status}
    </span>
  );
}

function SevCount({ count, cls }: { count: number; cls: string }) {
  return (
    <span className={`font-mono text-sm tabular-nums ${count ? cls : 'text-zinc-400 dark:text-zinc-600'}`}>
      {count || '—'}
    </span>
  );
}

function StatBox({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 px-4 py-3 rounded-xl flex-1 min-w-[90px]"
      style={{ background: 'var(--table-header-bg)', border: '1px solid var(--border-subtle)' }}
    >
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className={`text-xl font-bold font-mono ${color ?? ''}`} style={color ? undefined : { color: 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
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

// ── Main content (needs Suspense for useSearchParams) ────────────────

function HelmGroupContent() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoggedIn(!!getToken());
  }, []);

  useEffect(() => {
    if (!token) return;
    // Build full list of tokens: primary token + any extras from ?tokens=
    const extraTokens = searchParams.get('tokens')?.split(',').filter(Boolean) ?? [];
    const allTokens = [token, ...extraTokens];

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all(allTokens.map(t => getSharedScan(t).catch(e => ({ __error: e, __token: t }))))
      .then(results => {
        const validScans: Scan[] = [];
        for (const r of results) {
          if ('__error' in (r as Record<string, unknown>)) {
            const err = (r as { __error: unknown; __token: string }).__error;
            const tok = (r as { __error: unknown; __token: string }).__token;
            if (err instanceof ApiError && err.status === 401) {
              router.push(`/login?returnUrl=/shared/helm/${token}${searchParams.toString() ? '?' + searchParams.toString() : ''}`);
              return;
            }
            // Skip individual failed tokens (e.g. token revoked), don't fail whole group
            console.warn('Failed to load scan for token', tok, err);
          } else {
            validScans.push(r as Scan);
          }
        }
        if (validScans.length === 0) {
          setError('No scans could be loaded. The share links may have been revoked.');
        } else {
          setScans(validScans);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, router]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ────────────────────────────────────────────────
  const firstScan = scans[0];
  const chartUrl = firstScan?.helm_chart ?? '';
  const isOCI = chartUrl.startsWith('oci://');
  const displayUrl = chartUrl.replace(/^oci:\/\//, '') || 'Helm Chart Scan';

  const totalImages = scans.length;
  const completed = scans.filter(s => s.status === 'completed').length;
  const failed    = scans.filter(s => s.status === 'failed').length;
  const pending   = scans.filter(s => s.status === 'pending' || s.status === 'running').length;
  const totalCritical = scans.reduce((a, s) => a + (s.critical_count ?? 0), 0);
  const totalHigh     = scans.reduce((a, s) => a + (s.high_count ?? 0), 0);
  const totalMedium   = scans.reduce((a, s) => a + (s.medium_count ?? 0), 0);
  const totalLow      = scans.reduce((a, s) => a + (s.low_count ?? 0), 0);

  const mostRecentAt = scans.length > 0 ? scans[0].created_at : null;
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

  function handleCopyLink() {
    navigator.clipboard.writeText(pageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--app-bg)' }}>
      <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
        <span className="w-4 h-4 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
        Loading helm chart scan…
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--app-bg)' }}>
      <div className="text-center space-y-3">
        <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>
        <Link href="/" className="text-violet-600 dark:text-violet-400 text-sm hover:underline">← Back to home</Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: 'var(--app-bg)' }}>
      {/* Nav */}
      <nav
        className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 h-14"
        style={{ background: 'var(--nav-bg)', borderBottom: '1px solid var(--border-subtle)', backdropFilter: 'blur(12px)' }}
      >
        <Link href="/" className="flex items-center gap-2.5 select-none">
          <Logo size={22} className="text-[#a78bfa]" />
          <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isLoggedIn ? (
            <Link
              href="/scans"
              className="btn-primary-sm"
            >
              Dashboard →
            </Link>
          ) : (
            <Link
              href="/login"
              className="btn-primary-sm"
            >
              Sign in →
            </Link>
          )}
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Helm package icon */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                <h1 className="text-xl font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={chartUrl}>
                  {displayUrl}
                </h1>
                {chartUrl && (
                  <span
                    className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: isOCI ? 'rgba(124,58,237,0.1)' : 'rgba(59,130,246,0.1)',
                      color: isOCI ? '#a78bfa' : '#60a5fa',
                      border: `1px solid ${isOCI ? 'rgba(124,58,237,0.2)' : 'rgba(59,130,246,0.2)'}`,
                    }}
                  >
                    {isOCI ? 'OCI' : 'HTTP'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>{totalImages} image{totalImages !== 1 ? 's' : ''}</span>
                {mostRecentAt && (
                  <span title={fullDate(mostRecentAt)}>· Scanned {timeAgo(mostRecentAt)}</span>
                )}
              </div>
            </div>

            {/* Copy link button */}
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl font-medium transition-all shrink-0"
              style={{ background: copied ? 'rgba(34,197,94,0.12)' : 'rgba(124,58,237,0.1)', border: `1px solid ${copied ? 'rgba(34,197,94,0.25)' : 'rgba(124,58,237,0.2)'}`, color: copied ? '#4ade80' : '#a78bfa' }}
            >
              {copied ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  Copy link
                </>
              )}
            </button>
          </div>

          {/* Aggregate severity notice */}
          {(totalCritical > 0 || totalHigh > 0) && (
            <div
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span style={{ color: '#f87171' }}>
                {totalCritical > 0 && <><strong>{totalCritical}</strong> critical{totalHigh > 0 ? ', ' : ''}</>}
                {totalHigh > 0 && <><strong>{totalHigh}</strong> high</>}
                {' '}vulnerabilit{(totalCritical + totalHigh) !== 1 ? 'ies' : 'y'} found across {completed} image{completed !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {totalCritical === 0 && totalHigh === 0 && completed > 0 && (
            <div
              className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm"
              style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.18)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span style={{ color: '#34d399' }}>No critical or high vulnerabilities found</span>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="flex gap-3 flex-wrap">
          <StatBox label="Images" value={totalImages} />
          <StatBox label="Completed" value={completed} color="text-emerald-400" />
          {pending > 0 && <StatBox label="Running" value={pending} color="text-blue-400" />}
          {failed > 0  && <StatBox label="Failed"  value={failed}  color="text-red-400" />}
          {totalCritical > 0 && <StatBox label="Critical" value={totalCritical} color="text-red-400" />}
          {totalHigh > 0     && <StatBox label="High"     value={totalHigh}     color="text-orange-400" />}
          {totalMedium > 0   && <StatBox label="Medium"   value={totalMedium}   color="text-yellow-400" />}
          {totalLow > 0      && <StatBox label="Low"      value={totalLow}      color="text-blue-400" />}
        </div>

        {/* Image list */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
          {/* Table header */}
          <div
            className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide hidden sm:grid"
            style={{
              gridTemplateColumns: '1fr 120px 1fr 60px 60px 60px 60px 110px',
              background: 'var(--table-header-bg)',
              borderBottom: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
            }}
          >
            <span>Image</span>
            <span>Tag</span>
            <span>Source</span>
            <span className="text-center">C</span>
            <span className="text-center">H</span>
            <span className="text-center">M</span>
            <span className="text-center">L</span>
            <span className="text-right">Status</span>
          </div>

          {/* Rows */}
          {scans.map((scan, i) => {
            const href = scan.share_token ? `/shared/${scan.share_token}` : '#';
            const isLinkable = !!scan.share_token && (scan.status === 'completed' || scan.status === 'failed');
            const Row = isLinkable ? Link : 'div';
            return (
              <Row
                key={scan.id}
                // @ts-expect-error — href only passed to Link
                href={isLinkable ? href : undefined}
                className={`flex flex-col sm:grid items-center px-4 py-3 gap-2 transition-colors ${isLinkable ? 'hover:bg-violet-500/5 cursor-pointer group' : ''}`}
                style={{
                  gridTemplateColumns: '1fr 120px 1fr 60px 60px 60px 60px 110px',
                  borderBottom: i < scans.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  background: 'var(--card-bg)',
                }}
              >
                {/* Mobile label */}
                <span className="sm:hidden text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Image</span>

                <span
                  className={`text-sm font-mono truncate transition-colors ${isLinkable ? 'group-hover:text-violet-500' : ''}`}
                  style={{ color: 'var(--text-primary)' }}
                  title={scan.image_name}
                >
                  {scan.image_name}
                </span>
                <span className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }} title={scan.image_tag}>
                  {scan.image_tag || 'latest'}
                </span>
                <span className="text-xs truncate" style={{ color: 'var(--text-faint)' }} title={scan.helm_source_path ?? ''}>
                  {scan.helm_source_path ? scan.helm_source_path.split(' › ')[0] : '—'}
                </span>
                <span className="text-center sm:block flex gap-1 items-center"><SevCount count={scan.critical_count ?? 0} cls={SEV.critical} /></span>
                <span className="text-center sm:block flex gap-1 items-center"><SevCount count={scan.high_count ?? 0} cls={SEV.high} /></span>
                <span className="text-center sm:block flex gap-1 items-center"><SevCount count={scan.medium_count ?? 0} cls={SEV.medium} /></span>
                <span className="text-center sm:block flex gap-1 items-center"><SevCount count={scan.low_count ?? 0} cls={SEV.low} /></span>
                <span className="flex justify-end items-center gap-2">
                  <StatusBadge status={scan.status} />
                  {isLinkable && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-faint)' }}>
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  )}
                </span>
              </Row>
            );
          })}
        </div>

        {/* Footer note */}
        <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
          Powered by{' '}
          <Link href="/" className="hover:underline" style={{ color: 'var(--text-muted)' }}>JustScan</Link>
          {' '}· Click an image row to view its full vulnerability report
        </p>
      </div>
    </div>
  );
}

export default function SharedHelmGroupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--app-bg)' }}>
        <span className="w-5 h-5 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
      </div>
    }>
      <HelmGroupContent />
    </Suspense>
  );
}
