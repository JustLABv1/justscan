'use client';
import { Logo } from '@/components/logo';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Scanner animation — pure CSS keyframes, no external libs
// ---------------------------------------------------------------------------
function ScannerAnimation({ isDark }: { isDark: boolean }) {
  const items = [
    { label: 'nginx:latest',       emoji: '🐳', delay: 0 },
    { label: 'python:3.11-slim',   emoji: '📦', delay: 1.4 },
    { label: 'postgres:16-alpine', emoji: '⚓', delay: 2.8 },
  ];

  return (
    <div className="relative select-none" style={{ width: 420, height: 280 }}>
      <style>{`
        @keyframes itemTravel {
          0%   { transform: translateX(-110px); opacity: 0; }
          8%   { opacity: 1; }
          40%  { transform: translateX(0px);    opacity: 1; }
          60%  { transform: translateX(0px);    opacity: 0.5; }
          68%  { transform: translateX(110px);  opacity: 1; }
          92%  { opacity: 1; }
          100% { transform: translateX(280px);  opacity: 0; }
        }
        @keyframes scanBeam {
          0%, 100% { transform: translateY(-80px); opacity: 0.5; }
          50%       { transform: translateY(80px);  opacity: 1; }
        }
        @keyframes badgeFloat {
          0%   { transform: translateY(16px); opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(-20px); opacity: 0; }
        }
        @keyframes scannerPulse {
          0%, 100% { box-shadow: 0 0 24px rgba(124,58,237,0.4), 0 0 0 1px rgba(167,139,250,0.3); }
          50%       { box-shadow: 0 0 56px rgba(124,58,237,0.75), 0 0 0 1px rgba(167,139,250,0.6); }
        }
        @keyframes glowLine {
          0%, 100% { opacity: 0.15; }
          50%       { opacity: 0.5; }
        }
        /* Arc crawls around the border perimeter */
        @keyframes arcCrawl {
          0%   { stroke-dashoffset: 620; }
          100% { stroke-dashoffset: 0; }
        }
        /* Flicker the arc opacity for electric stuttering */
        @keyframes arcFlicker {
          0%   { opacity: 0.9; }
          7%   { opacity: 0.3; }
          10%  { opacity: 1; }
          18%  { opacity: 0.5; }
          22%  { opacity: 0.95; }
          31%  { opacity: 0.2; }
          35%  { opacity: 1; }
          48%  { opacity: 0.7; }
          52%  { opacity: 1; }
          63%  { opacity: 0.4; }
          67%  { opacity: 0.9; }
          79%  { opacity: 0.6; }
          83%  { opacity: 1; }
          91%  { opacity: 0.3; }
          95%  { opacity: 0.85; }
          100% { opacity: 0.9; }
        }
        /* Jagged offset for the secondary arc — creates the electric zigzag illusion */
        @keyframes arcCrawl2 {
          0%   { stroke-dashoffset: 560; }
          100% { stroke-dashoffset: -60; }
        }
        @keyframes arcFlicker2 {
          0%   { opacity: 0.7; }
          13%  { opacity: 1; }
          19%  { opacity: 0.2; }
          25%  { opacity: 0.9; }
          38%  { opacity: 0.5; }
          44%  { opacity: 0.85; }
          57%  { opacity: 0.1; }
          62%  { opacity: 0.8; }
          74%  { opacity: 0.4; }
          80%  { opacity: 1; }
          88%  { opacity: 0.6; }
          100% { opacity: 0.7; }
        }
        @keyframes arcGlow {
          0%, 100% { filter: drop-shadow(0 0 3px rgba(167,139,250,0.6)) drop-shadow(0 0 8px rgba(124,58,237,0.4)); }
          50%       { filter: drop-shadow(0 0 6px rgba(167,139,250,0.9)) drop-shadow(0 0 16px rgba(124,58,237,0.7)); }
        }
      `}</style>

      {/* Conveyor track */}
      <div className="absolute" style={{
        top: 126, left: 0, right: 0, height: 1,
        background: isDark
          ? 'linear-gradient(90deg, transparent, rgba(167,139,250,0.25), rgba(124,58,237,0.4), rgba(167,139,250,0.25), transparent)'
          : 'linear-gradient(90deg, transparent, rgba(124,58,237,0.15), rgba(124,58,237,0.28), rgba(124,58,237,0.15), transparent)',
        animation: 'glowLine 3s ease-in-out infinite',
      }} />

      {/* Traveling items */}
      {items.map(it => (
        <div key={it.label}
          className="absolute flex flex-col items-center gap-1"
          style={{
            top: 82, left: 70,
            animation: `itemTravel 4.2s ease-in-out infinite`,
            animationDelay: `${it.delay}s`,
          }}>
          <span style={{ fontSize: 30 }}>{it.emoji}</span>
          <span className="text-[9px] font-mono whitespace-nowrap"
            style={{ color: isDark ? 'rgba(167,139,250,0.7)' : 'rgba(109,40,217,0.6)' }}>
            {it.label}
          </span>
        </div>
      ))}

      {/* ── Gate / Scanner box ── */}
      <div className="absolute rounded-3xl overflow-visible flex items-center justify-center"
        style={{
          top: 20, left: 170, width: 80, height: 220,
          background: isDark ? 'rgba(124,58,237,0.1)' : 'rgba(124,58,237,0.06)',
          backdropFilter: 'blur(6px)',
          animation: 'scannerPulse 2.4s ease-in-out infinite',
        }}>

        {/* Sweep beam */}
        <div className="absolute inset-x-0 h-0.5"
          style={{
            top: '50%',
            background: isDark
              ? 'linear-gradient(90deg, transparent, rgba(167,139,250,0.95), transparent)'
              : 'linear-gradient(90deg, transparent, rgba(124,58,237,0.8), transparent)',
            animation: 'scanBeam 2.2s ease-in-out infinite',
            boxShadow: '0 0 12px 2px rgba(167,139,250,0.6)',
            borderRadius: 2,
          }} />

        {/* Corner brackets */}
        <div className="absolute top-2 left-2 w-4 h-4"
          style={{ borderTop: '2px solid rgba(167,139,250,0.8)', borderLeft: '2px solid rgba(167,139,250,0.8)', borderRadius: '3px 0 0 0' }} />
        <div className="absolute top-2 right-2 w-4 h-4"
          style={{ borderTop: '2px solid rgba(167,139,250,0.8)', borderRight: '2px solid rgba(167,139,250,0.8)', borderRadius: '0 3px 0 0' }} />
        <div className="absolute bottom-2 left-2 w-4 h-4"
          style={{ borderBottom: '2px solid rgba(167,139,250,0.8)', borderLeft: '2px solid rgba(167,139,250,0.8)', borderRadius: '0 0 0 3px' }} />
        <div className="absolute bottom-2 right-2 w-4 h-4"
          style={{ borderBottom: '2px solid rgba(167,139,250,0.8)', borderRight: '2px solid rgba(167,139,250,0.8)', borderRadius: '0 0 3px 0' }} />

        {/*
          ── Electric arc overlay ──
          SVG exactly covers the gate (80×220). The <rect> has the same border-radius (24px = rounded-3xl).
          Perimeter ≈ 2*(80+220) - (2π-8)*24 ≈ 560px — we use 620 for dasharray to have a crawling partial arc.
          Two arcs with slightly different dash lengths crawl in opposite directions + flicker keyframes = electric effect.
        */}
        <svg
          className="absolute pointer-events-none"
          style={{
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            animation: 'arcGlow 1.8s ease-in-out infinite',
          }}
          viewBox="0 0 80 220"
          fill="none"
        >
          {/* Base dim border so the arc has something to crawl on */}
          <rect x="1" y="1" width="78" height="218" rx="23" ry="23"
            stroke="rgba(167,139,250,0.3)" strokeWidth="1.5" />

          {/* Primary arc — crawls clockwise, flickers */}
          <rect x="1" y="1" width="78" height="218" rx="23" ry="23"
            stroke="rgba(200,180,255,0.95)" strokeWidth="2"
            strokeDasharray="80 540"
            strokeDashoffset="620"
            strokeLinecap="round"
            style={{
              animation: 'arcCrawl 1.6s linear infinite, arcFlicker 0.9s steps(1) infinite',
            }} />

          {/* Secondary arc — offset phase, slightly longer dash, opposite feel */}
          <rect x="1" y="1" width="78" height="218" rx="23" ry="23"
            stroke="rgba(167,139,250,0.75)" strokeWidth="1.5"
            strokeDasharray="55 565"
            strokeDashoffset="500"
            strokeLinecap="round"
            style={{
              animation: 'arcCrawl2 1.1s linear infinite, arcFlicker2 0.7s steps(1) infinite',
            }} />

          {/* Third arc — faster, shorter, creates rapid micro-flashes */}
          <rect x="1" y="1" width="78" height="218" rx="23" ry="23"
            stroke="rgba(221,214,254,0.85)" strokeWidth="1"
            strokeDasharray="30 590"
            strokeDashoffset="310"
            strokeLinecap="round"
            style={{
              animation: 'arcCrawl 0.75s linear infinite, arcFlicker 0.45s steps(1) infinite',
              animationDelay: '-0.3s, -0.15s',
            }} />

          {/* Fourth arc — travels in reverse for bidirectional arc feel */}
          <rect x="1" y="1" width="78" height="218" rx="23" ry="23"
            stroke="rgba(139,92,246,0.6)" strokeWidth="2"
            strokeDasharray="65 555"
            strokeDashoffset="200"
            strokeLinecap="round"
            style={{
              animation: 'arcCrawl2 2.2s linear infinite, arcFlicker2 1.1s steps(1) infinite',
              animationDelay: '-0.8s, -0.4s',
            }} />
        </svg>
      </div>

      {/* Floating CVE severity badges */}
      {([
        { label: 'CRITICAL', color: '#ef4444', delay: 0.8,  left: 262 },
        { label: 'HIGH',     color: '#f97316', delay: 2.2,  left: 268 },
        { label: 'MEDIUM',   color: '#eab308', delay: 3.6,  left: 260 },
        { label: 'CVE-2024', color: '#7c3aed', delay: 1.5,  left: 256 },
      ] as const).map(badge => (
        <div key={badge.label}
          className="absolute text-white rounded-md px-2 py-0.5 text-[9px] font-bold whitespace-nowrap"
          style={{
            top: 96, left: badge.left,
            background: badge.color,
            boxShadow: `0 2px 10px ${badge.color}66`,
            animation: `badgeFloat 4.2s ease-in-out infinite`,
            animationDelay: `${badge.delay}s`,
            opacity: 0,
          }}>
          {badge.label}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const FEATURES = [
  { emoji: '🔍', title: 'CVE Detection',      desc: 'All image layers scanned against NVD, GHSA & OSV databases' },
  { emoji: '⚓', title: 'Helm Chart Scanning', desc: 'Extract and scan every container image inside a Helm chart' },
  { emoji: '📋', title: 'SBOM Export',         desc: 'Full software bill of materials in CycloneDX or SPDX format' },
  { emoji: '🔔', title: 'Watchlist',           desc: 'Schedule recurring scans and get notified on new CVEs' },
  { emoji: '🏢', title: 'Organizations',       desc: 'Share scans and manage findings across teams' },
  { emoji: '📜', title: 'Audit Log',           desc: 'Full history of who ran what scan and when' },
];

const STEPS = [
  { n: '1', title: 'Enter an image or chart',  desc: 'Paste any public Docker image reference or a Helm chart URL' },
  { n: '2', title: 'Trivy scans all layers',   desc: 'We pull the image, unpack all layers, and cross-reference vulnerability databases' },
  { n: '3', title: 'Review your findings',     desc: 'Browse CVEs by severity, filter by package, and export results' },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function LandingPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}>

      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <style>{`
          @keyframes heroGridDrift {
            0%   { background-position: 0 0; }
            100% { background-position: 40px 40px; }
          }
          @keyframes heroSweep {
            0%   { transform: translateY(-100vh); opacity: 0; }
            5%   { opacity: 1; }
            95%  { opacity: 1; }
            100% { transform: translateY(100vh); opacity: 0; }
          }
        `}</style>
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full"
          style={{ background: isDark ? 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 65%)' : 'radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 65%)' }} />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full"
          style={{ background: isDark ? 'radial-gradient(circle, rgba(109,40,217,0.1) 0%, transparent 65%)' : 'radial-gradient(circle, rgba(109,40,217,0.05) 0%, transparent 65%)' }} />
        <div className="absolute inset-0"
          style={{
            backgroundImage: isDark
              ? 'radial-gradient(circle, rgba(167,139,250,0.08) 1px, transparent 1px)'
              : 'radial-gradient(circle, rgba(124,58,237,0.05) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            animation: 'heroGridDrift 18s linear infinite',
          }} />
        <div className="absolute inset-x-0 h-px"
          style={{
            background: isDark
              ? 'linear-gradient(90deg, transparent, rgba(124,58,237,0.3), rgba(167,139,250,0.4), rgba(124,58,237,0.3), transparent)'
              : 'linear-gradient(90deg, transparent, rgba(124,58,237,0.12), rgba(124,58,237,0.2), rgba(124,58,237,0.12), transparent)',
            animation: 'heroSweep 13s ease-in-out infinite',
            animationDelay: '1s',
            top: 0,
          }} />
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', boxShadow: '0 0 16px rgba(124,58,237,0.45)' }}>
            <Logo size={16} className="text-white" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight" style={{ color: 'var(--text-primary)' }}>JustScan</span>
        </div>
        <div className="flex items-center gap-2">
          {mounted && (
            <button onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
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
          <Link href="/swagger/index.html"
            target="_blank"
            rel="noreferrer"
            className="text-sm px-4 py-2 rounded-xl font-medium transition-all hover:opacity-90"
            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            API docs
          </Link>
          <Link href="/login"
            className="text-sm px-4 py-2 rounded-xl font-medium transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: 'white', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}>
            Sign in
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1">

        {/* ── Hero ────────────────────────────────────────────────── */}
        <section className="flex flex-col lg:flex-row items-center justify-center gap-10 px-6 pt-20 pb-16 max-w-6xl mx-auto">

          {/* Copy + CTAs */}
          <div className="flex-1 max-w-xl text-center lg:text-left space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Free · No account needed · Powered by Trivy
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-bold tracking-tight leading-[1.1]"
              style={{ color: 'var(--text-primary)' }}>
              Find CVEs in any
              <br />
              <span style={{ background: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 60%, #6d28d9 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                container image
              </span>
              <br />
              in seconds
            </h1>

            <p className="text-base leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Scan Docker images and Helm charts for vulnerabilities across all layers.
              No sign-up, no Docker daemon, no configuration — just paste and scan.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link href="/public/scan/image"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold text-white text-center transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 28px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.15)' }}>
                Scan Docker image →
              </Link>
              <Link href="/public/scan/helm"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold text-center transition-all hover:opacity-90"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                Scan Helm chart →
              </Link>
            </div>

            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              5 free scans per hour · Public images only · Self-hosted
            </p>
          </div>

          {/* Scanner animation */}
          <div className="shrink-0">
            {mounted && <ScannerAnimation isDark={isDark} />}
          </div>
        </section>

        {/* ── Feature grid ─────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Everything you need to{' '}
              <span style={{ background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                stay secure
              </span>
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              Sign in for the full experience — or start scanning for free right now.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ emoji, title, desc }) => (
              <div key={title} className="rounded-2xl p-5 space-y-2 transition-all"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(167,139,250,0.35)')}
                onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--glass-border)')}>
                <p className="text-2xl">{emoji}</p>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              How it works
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {STEPS.map(({ n, title, desc }) => (
              <div key={n} className="flex sm:flex-col items-start sm:items-center sm:text-center gap-4 sm:gap-3 flex-1">
                <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 16px rgba(124,58,237,0.3)' }}>
                  {n}
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</p>
                  <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA banner ───────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-3xl mx-auto">
          <div className="rounded-3xl p-8 sm:p-10 text-center space-y-6"
            style={{
              background: isDark
                ? 'linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(109,40,217,0.1) 100%)'
                : 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(109,40,217,0.04) 100%)',
              border: '1px solid rgba(167,139,250,0.25)',
              boxShadow: '0 0 60px rgba(124,58,237,0.12)',
            }}>
            <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center text-[#a78bfa]"
              style={{ background: isDark ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.1)', border: '1px solid rgba(167,139,250,0.3)' }}>
              <Logo size={22} />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Start scanning for free
              </h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                No account, no credit card, no Docker daemon. Just paste an image reference and go.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/public/scan/image"
                className="w-full sm:w-auto px-7 py-3 rounded-xl text-sm font-semibold text-white text-center transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 0 28px rgba(124,58,237,0.4)' }}>
                Scan Docker image →
              </Link>
              <Link href="/public/scan/helm"
                className="w-full sm:w-auto px-7 py-3 rounded-xl text-sm font-semibold text-center transition-all hover:opacity-90"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                Scan Helm chart →
              </Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Or{' '}
              <Link href="/login" className="underline underline-offset-2 transition-colors"
                style={{ color: 'var(--text-faint)' }}
                onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = '#a78bfa')}
                onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-faint)')}>
                sign in
              </Link>{' '}
              for unlimited scans, watchlists, organizations, and more.
            </p>
          </div>
        </section>

      </main>

      <footer className="relative z-10 text-center py-6 text-xs"
        style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>
        JustScan · Self-hosted container vulnerability scanner
      </footer>
    </div>
  );
}
