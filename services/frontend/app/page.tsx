'use client';
import { createPublicScan, getToken } from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';

export default function LandingPage() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    if (getToken()) router.replace('/scans');
  }, [router]);

  const isDark = resolvedTheme === 'dark';

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
      const scan = await createPublicScan(image, tag);
      router.push(`/scan/${scan.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}
    >
      {/* Ambient glow — adapts per theme */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full"
          style={{ background: isDark
            ? 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 65%)'
            : 'radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 65%)' }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full"
          style={{ background: isDark
            ? 'radial-gradient(circle, rgba(109,40,217,0.1) 0%, transparent 65%)'
            : 'radial-gradient(circle, rgba(109,40,217,0.06) 0%, transparent 65%)' }}
        />
      </div>

      {/* Nav */}
      <header
        className="relative z-10 flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
              boxShadow: '0 0 16px rgba(124,58,237,0.45)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </div>
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
          <Link
            href="/login"
            className="text-sm px-4 py-2 rounded-xl font-medium transition-colors"
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
              color: 'white',
              boxShadow: '0 0 16px rgba(124,58,237,0.3)',
            }}
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-12 text-center">
        <div className="w-full max-w-2xl space-y-8">

          {/* Shield icon */}
          <div className="flex justify-center">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center"
              style={{
                background: isDark
                  ? 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(109,40,217,0.12) 100%)'
                  : 'linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(109,40,217,0.06) 100%)',
                border: '1px solid rgba(167,139,250,0.25)',
                boxShadow: '0 0 40px rgba(124,58,237,0.15)',
              }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
            </div>
          </div>

          {/* Heading */}
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Scan any Docker image
              <br />
              <span style={{ background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                for free
              </span>
            </h1>
            <p className="text-base max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
              Detect CVEs across all image layers in seconds — no account needed.
              Up to 5 scans per hour, powered by Trivy.
            </p>
          </div>

          {/* Free scan bar */}
          <form onSubmit={handleScan} className="space-y-3">
            <div
              className="flex items-center gap-2 p-2 rounded-2xl transition-shadow"
              style={{
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                boxShadow: 'var(--glass-shadow)',
              }}
            >
              <div className="pl-2 shrink-0" style={{ color: 'var(--text-faint)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                style={{
                  background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                  boxShadow: '0 0 20px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Starting…
                  </span>
                ) : 'Scan free'}
              </button>
            </div>
            {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              5 free scans per hour · Public images only · No sign-up required
            </p>
          </form>

          {/* Quick pick */}
          <div className="flex flex-wrap justify-center gap-2">
            {['nginx:latest', 'ubuntu:22.04', 'python:3.11-slim', 'node:20-alpine'].map(img => (
              <button
                key={img}
                onClick={() => { setInput(img); inputRef.current?.focus(); }}
                className="text-xs px-3 py-1.5 rounded-full font-mono transition-colors hover:border-violet-400/40"
                style={{
                  background: 'var(--row-hover)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)',
                }}
              >
                {img}
              </button>
            ))}
          </div>
        </div>

        {/* Divider + sign-in section */}
        <div className="mt-20 w-full max-w-2xl">
          <div className="flex items-center gap-4 mb-8">
            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>Already have an account?</span>
            <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
          </div>

          <div
            className="rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)' }}
          >
            <div className="text-left">
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Sign in for the full experience</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Track scans, add tags, suppress findings, schedule watchlists, and more.
              </p>
            </div>
            <Link
              href="/login"
              className="shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 20px rgba(124,58,237,0.25)' }}
            >
              Sign in →
            </Link>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {[
              { icon: '🔍', title: 'CVE Detection', desc: 'All layers scanned against NVD, GHSA & more' },
              { icon: '📋', title: 'SBOM Export', desc: 'Full software bill of materials for every scan' },
              { icon: '🔔', title: 'Watchlist', desc: 'Schedule recurring scans on your images' },
            ].map(({ icon, title, desc }) => (
              <div
                key={title}
                className="rounded-2xl p-4 text-left"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)' }}
              >
                <p className="text-lg mb-1">{icon}</p>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 text-center py-6 text-xs" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>
        JustScan · Self-hosted image vulnerability scanner
      </footer>
    </div>
  );
}
