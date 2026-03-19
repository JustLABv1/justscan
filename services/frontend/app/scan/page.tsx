'use client';
import { Logo } from '@/components/logo';
import { createPublicScan, getPublicScan, getPublicSettings, getToken, Scan } from '@/lib/api';
import {
    addToPublicHistory,
    clearPublicHistory,
    getPublicHistory,
    PublicScanRecord,
    timeAgo,
    updatePublicHistoryEntry,
} from '@/lib/publicScanHistory';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy link"
      className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md transition-all opacity-0 group-hover:opacity-100 hover:!opacity-100"
      style={{ color: copied ? '#34d399' : 'var(--text-muted)', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      )}
    </button>
  );
}

const PLATFORMS = [
  { value: '', label: 'Auto (detect)' },
  { value: 'linux/amd64', label: 'linux/amd64' },
  { value: 'linux/arm64', label: 'linux/arm64' },
  { value: 'linux/arm/v7', label: 'linux/arm/v7' },
  { value: 'windows/amd64', label: 'windows/amd64' },
];

function statusStyle(status: string): { color: string; dot: string } {
  switch (status) {
    case 'completed': return { color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'failed':    return { color: 'text-red-500 dark:text-red-400',         dot: 'bg-red-500' };
    case 'running':   return { color: 'text-blue-500 dark:text-blue-400',        dot: 'bg-blue-400' };
    default:          return { color: 'text-zinc-500',                           dot: 'bg-zinc-400' };
  }
}

function HistoryRow({ record }: { record: PublicScanRecord }) {
  const router = useRouter();
  const st = statusStyle(record.status);
  const isActive = record.status === 'running' || record.status === 'pending';
  const scanUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/scan/${record.id}`
    : `/scan/${record.id}`;
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/scan/${record.id}`)}
      onKeyDown={e => { if (e.key === 'Enter') router.push(`/scan/${record.id}`); }}
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors group cursor-pointer"
      style={{ background: 'var(--row-hover)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--glass-bg)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--row-hover)')}
    >
      {/* Image + platform */}
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {record.image_name}:{record.image_tag}
        </p>
        {record.platform && (
          <span className="text-xs px-1.5 py-0.5 rounded font-mono mt-0.5 inline-block"
            style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.15)' }}>
            {record.platform}
          </span>
        )}
      </div>

      {/* Status */}
      <div className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${st.color}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${st.dot} ${isActive ? 'animate-pulse' : ''}`} />
        {record.status}
      </div>

      {/* Severity counts (only for completed) */}
      {record.status === 'completed' && (
        <div className="hidden sm:flex items-center gap-2 shrink-0 text-xs font-mono">
          {record.critical_count > 0 && <span className="text-red-500 dark:text-red-400">{record.critical_count}C</span>}
          {record.high_count > 0     && <span className="text-orange-500 dark:text-orange-400">{record.high_count}H</span>}
          {record.medium_count > 0   && <span className="text-yellow-600 dark:text-yellow-400">{record.medium_count}M</span>}
          {record.low_count > 0      && <span className="text-blue-500 dark:text-blue-400">{record.low_count}L</span>}
          {record.critical_count === 0 && record.high_count === 0 && record.medium_count === 0 && record.low_count === 0 && (
            <span className="text-emerald-600 dark:text-emerald-400">Clean</span>
          )}
        </div>
      )}

      {/* Time */}
      <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)' }}>{timeAgo(record.created_at)}</span>

      {/* Copy URL */}
      <CopyButton url={scanUrl} />

      {/* Arrow */}
      <svg className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" width="14" height="14"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ color: 'var(--text-muted)' }}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  );
}

export default function PublicScanPage() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<{ enabled: boolean; rate_limit_per_hour: number } | null>(null);
  const [history, setHistory] = useState<PublicScanRecord[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDark = resolvedTheme === 'dark';

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setIsLoggedIn(!!getToken());
    getPublicSettings().then(setSettings).catch(() => setSettings({ enabled: true, rate_limit_per_hour: 5 }));
    setHistory(getPublicHistory());
    inputRef.current?.focus();
  }, []);

  // Poll status for any pending/running scans in history
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    const active = history.filter(s => s.status === 'pending' || s.status === 'running');
    if (active.length === 0) return;

    pollRef.current = setInterval(async () => {
      let anyChange = false;
      await Promise.all(
        active.map(async record => {
          try {
            const fresh = await getPublicScan(record.id);
            if (fresh.status !== record.status) {
              updatePublicHistoryEntry(record.id, {
                status: fresh.status,
                critical_count: fresh.critical_count,
                high_count: fresh.high_count,
                medium_count: fresh.medium_count,
                low_count: fresh.low_count,
                unknown_count: fresh.unknown_count,
              });
              anyChange = true;
            }
          } catch { /* ignore */ }
        })
      );
      if (anyChange) setHistory(getPublicHistory());
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [history]);

  async function handleScan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const trimmed = input.trim();
    if (!trimmed) return;
    const colonIdx = trimmed.lastIndexOf(':');
    let image = trimmed;
    let tag = 'latest';
    if (colonIdx > 0 && !trimmed.includes(':/')) {
      image = trimmed.slice(0, colonIdx);
      tag = trimmed.slice(colonIdx + 1) || 'latest';
    }
    setLoading(true);
    try {
      const scan = await createPublicScan(image, tag, platform || undefined);
      addToPublicHistory(scanToRecord(scan, platform));
      setHistory(getPublicHistory());
      router.push(`/scan/${scan.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
      setLoading(false);
    }
  }

  function handleClearHistory() {
    clearPublicHistory();
    setHistory([]);
  }

  const isDisabled = settings !== null && !settings.enabled;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}>
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full"
          style={{ background: isDark ? 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 65%)' : 'radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full"
          style={{ background: isDark ? 'radial-gradient(circle, rgba(109,40,217,0.1) 0%, transparent 65%)' : 'radial-gradient(circle, rgba(109,40,217,0.05) 0%, transparent 65%)' }} />
      </div>

      {/* Nav */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 12px rgba(124,58,237,0.5)' }}>
            <Logo size={16} className="text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </Link>

        <div className="flex items-center gap-2">
          {mounted && (
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
          )}
          <Link href={isLoggedIn ? '/scans' : '/login'} className="text-sm px-3 py-1.5 rounded-xl font-medium transition-colors"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            {isLoggedIn ? 'Dashboard →' : 'Sign in'}
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-8 my-auto">

          {/* Hero */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{
                  background: isDark ? 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(109,40,217,0.12) 100%)' : 'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(109,40,217,0.06) 100%)',
                  border: '1px solid rgba(167,139,250,0.25)',
                  boxShadow: '0 0 32px rgba(124,58,237,0.15)',
                }}>
                <Logo size={28} className="text-[#a78bfa]" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Scan any Docker image{' '}
                <span style={{ background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  instantly
                </span>
              </h1>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                No account needed · {settings?.rate_limit_per_hour ?? 5} free scans per hour · Powered by Trivy
              </p>
            </div>
          </div>

          {/* Form */}
          {isDisabled ? (
            <div className="rounded-2xl px-6 py-5 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-red-500 dark:text-red-400 font-medium">Public scanning is temporarily disabled</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>The administrator has disabled this feature. Please check back later.</p>
            </div>
          ) : (
            <form onSubmit={handleScan} className="space-y-2">
              {/* Image input row */}
              <div className="flex items-center gap-2 p-2 rounded-2xl"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}>
                <div className="pl-2 shrink-0" style={{ color: 'var(--text-faint)' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/>
                  </svg>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="nginx:latest  or  ubuntu:22.04"
                  disabled={loading}
                  className="flex-1 bg-transparent text-base outline-none font-mono py-2.5"
                  style={{ color: 'var(--text-primary)', caretColor: '#7c3aed' }}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' }}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Starting…
                    </span>
                  ) : 'Scan'}
                </button>
              </div>

              {/* Platform row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Platform:</span>
                {PLATFORMS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlatform(p.value)}
                    className="text-xs px-2.5 py-1 rounded-lg font-mono transition-all"
                    style={platform === p.value
                      ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.4)', color: '#7c3aed' }
                      : { background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
            </form>
          )}

          {/* Quick picks */}
          {!isDisabled && (
            <div className="flex flex-wrap gap-2">
              {['nginx:latest', 'ubuntu:22.04', 'python:3.11-slim', 'node:20-alpine'].map(img => (
                <button
                  key={img}
                  onClick={() => setInput(img)}
                  className="text-xs px-3 py-1.5 rounded-full font-mono transition-colors"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  {img}
                </button>
              ))}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>Your recent scans</h2>
                <button
                  onClick={handleClearHistory}
                  className="text-xs transition-colors"
                  style={{ color: 'var(--text-faint)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                >
                  Clear history
                </button>
              </div>
              <div className="rounded-2xl overflow-hidden space-y-px p-2"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                {history.map(record => (
                  <HistoryRow key={record.id} record={record} />
                ))}
              </div>
              <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                Stored locally on this device · Sign in to keep scans permanently
              </p>
            </div>
          )}
        </div>
      </main>

      <footer className="relative z-10 text-center py-6 text-xs" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>
        JustScan · Self-hosted image vulnerability scanner
      </footer>
    </div>
  );
}

function scanToRecord(scan: Scan, platform: string): PublicScanRecord {
  return {
    id: scan.id,
    image_name: scan.image_name,
    image_tag: scan.image_tag,
    platform: platform || undefined,
    status: scan.status,
    critical_count: scan.critical_count ?? 0,
    high_count: scan.high_count ?? 0,
    medium_count: scan.medium_count ?? 0,
    low_count: scan.low_count ?? 0,
    unknown_count: scan.unknown_count ?? 0,
    created_at: scan.created_at,
  };
}
