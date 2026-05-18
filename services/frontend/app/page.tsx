'use client';
import { Logo } from '@/components/logo';
import { Button } from '@heroui/react';
import {
  Building04Icon,
  FileExportIcon,
  GridTableIcon,
  Notification01Icon,
  PackageIcon,
  Search01Icon,
} from 'hugeicons-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Scanner animation — pure CSS keyframes, no external libs
// ---------------------------------------------------------------------------
function ScannerAnimation({ isDark }: { isDark: boolean }) {
  const reduceMotion = useReducedMotion();
  const items = [
    { label: 'nginx:latest', emoji: '🐳', delay: 0 },
    { label: 'python:3.11-slim', emoji: '📦', delay: 1.4 },
    { label: 'postgres:16-alpine', emoji: '⚓', delay: 2.8 },
  ];

  return (
    <div className="relative select-none" style={{ width: 420, height: 280 }}>
      <style>{`
        @keyframes scannerPulse {
          0%, 100% { box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
          50%       { box-shadow: 0 0 56px color-mix(in srgb, var(--accent) 75%, transparent), 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent); }
        }
        @keyframes glowLine {
          0%, 100% { opacity: 0.15; }
          50%       { opacity: 0.5; }
        }
        @keyframes arcCrawl {
          0%   { stroke-dashoffset: 620; }
          100% { stroke-dashoffset: 0; }
        }
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
          0%, 100% { filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 60%, transparent)) drop-shadow(0 0 8px color-mix(in srgb, var(--accent) 40%, transparent)); }
          50%       { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 90%, transparent)) drop-shadow(0 0 16px color-mix(in srgb, var(--accent) 70%, transparent)); }
        }
      `}</style>

      {/* Conveyor track */}
      <div
        className="absolute"
        style={{
          top: 126,
          left: 0,
          right: 0,
          height: 1,
          background: isDark
            ? 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 25%, transparent), color-mix(in srgb, var(--accent) 40%, transparent), color-mix(in srgb, var(--accent) 25%, transparent), transparent)'
            : 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 15%, transparent), color-mix(in srgb, var(--accent) 28%, transparent), color-mix(in srgb, var(--accent) 15%, transparent), transparent)',
          animation: 'glowLine 3s ease-in-out infinite',
        }}
      />

      {/* Traveling items */}
      {items.map((it) => (
        <motion.div
          key={it.label}
          className="absolute flex flex-col items-center gap-1"
          style={{
            top: 82,
            left: 70,
          }}
          initial={{ x: -110, opacity: 0 }}
          animate={
            reduceMotion
              ? { opacity: [0, 0.9, 0] }
              : { x: [-110, 0, 0, 110, 280], opacity: [0, 1, 1, 0.65, 1, 0] }
          }
          transition={{
            duration: 4.6,
            times: reduceMotion ? [0, 0.5, 1] : [0, 0.12, 0.4, 0.62, 0.82, 1],
            ease: 'easeInOut',
            repeat: Infinity,
            repeatType: 'loop',
            delay: it.delay,
            repeatDelay: 0.65,
          }}
        >
          <span style={{ fontSize: 30 }}>{it.emoji}</span>
          <span
            className="text-[9px] font-mono whitespace-nowrap"
            style={{
              color: isDark
                ? 'color-mix(in srgb, var(--accent) 70%, transparent)'
                : 'color-mix(in srgb, var(--accent) 60%, transparent)',
            }}
          >
            {it.label}
          </span>
        </motion.div>
      ))}

      {/* ── Gate / Scanner box ── */}
      <motion.div
        className="absolute rounded-3xl overflow-visible flex items-center justify-center"
        style={{
          top: 20,
          left: 170,
          width: 80,
          height: 220,
          background: isDark
            ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
            : 'color-mix(in srgb, var(--accent) 6%, transparent)',
          backdropFilter: 'blur(6px)',
          animation: reduceMotion ? undefined : 'scannerPulse 2.8s ease-in-out infinite',
        }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: [0.92, 1, 0.92] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* Sweep beam */}
        <motion.div
          className="absolute inset-x-0 h-0.5"
          style={{
            top: '50%',
            background: isDark
              ? 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 95%, transparent), transparent)'
              : 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 80%, transparent), transparent)',
            boxShadow: '0 0 12px 2px color-mix(in srgb, var(--accent) 60%, transparent)',
            borderRadius: 2,
          }}
          initial={{ y: -80, opacity: 0.5 }}
          animate={reduceMotion ? { opacity: 0.45 } : { y: [-80, 80, -80], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
        />

        {/* Corner brackets */}
        <div
          className="absolute top-2 left-2 size-4"
          style={{
            borderTop: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderLeft: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderRadius: '3px 0 0 0',
          }}
        />
        <div
          className="absolute top-2 right-2 size-4"
          style={{
            borderTop: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderRight: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderRadius: '0 3px 0 0',
          }}
        />
        <div
          className="absolute bottom-2 left-2 size-4"
          style={{
            borderBottom: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderLeft: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderRadius: '0 0 0 3px',
          }}
        />
        <div
          className="absolute bottom-2 right-2 size-4"
          style={{
            borderBottom: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderRight: '2px solid color-mix(in srgb, var(--accent) 80%, transparent)',
            borderRadius: '0 0 3px 0',
          }}
        />

        <svg
          className="absolute pointer-events-none"
          style={{
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            animation: reduceMotion ? undefined : 'arcGlow 1.8s ease-in-out infinite',
          }}
          viewBox="0 0 80 220"
          fill="none"
        >
          {/* Base dim border so the arc has something to crawl on */}
          <rect
            x="1"
            y="1"
            width="78"
            height="218"
            rx="23"
            ry="23"
            stroke="color-mix(in srgb, var(--accent) 30%, transparent)"
            strokeWidth="1.5"
          />

          {/* Primary arc */}
          <rect
            x="1"
            y="1"
            width="78"
            height="218"
            rx="23"
            ry="23"
            stroke="color-mix(in srgb, var(--accent) 95%, white)"
            strokeWidth="2"
            strokeDasharray="80 540"
            strokeDashoffset="620"
            strokeLinecap="round"
            style={{
              animation: reduceMotion ? undefined : 'arcCrawl 1.9s linear infinite, arcFlicker 1.1s steps(1) infinite',
            }}
          />

          {/* Secondary arc */}
          <rect
            x="1"
            y="1"
            width="78"
            height="218"
            rx="23"
            ry="23"
            stroke="color-mix(in srgb, var(--accent) 75%, transparent)"
            strokeWidth="1.5"
            strokeDasharray="55 565"
            strokeDashoffset="500"
            strokeLinecap="round"
            style={{
              animation: reduceMotion ? undefined : 'arcCrawl2 2.4s linear infinite, arcFlicker2 1.4s steps(1) infinite',
            }}
          />
        </svg>
      </motion.div>

      {/* Floating CVE severity badges */}
      {(
        [
          { label: 'CRITICAL', color: '#ef4444', delay: 0.8, left: 262 },
          { label: 'HIGH', color: '#f97316', delay: 2.2, left: 268 },
          { label: 'MEDIUM', color: '#eab308', delay: 3.6, left: 260 },
          { label: 'CVE-2024', color: 'var(--accent)', delay: 1.5, left: 256 },
        ] as const
      ).map((badge) => (
        <motion.div
          key={badge.label}
          className="absolute text-white rounded-md px-2 py-0.5 text-[9px] font-bold whitespace-nowrap"
          style={{
            top: 96,
            left: badge.left,
            background: badge.color,
            boxShadow: `0 2px 10px ${badge.color}66`,
          }}
          initial={{ y: 16, opacity: 0 }}
          animate={reduceMotion ? { opacity: [0, 0.9, 0] } : { y: [16, 0, -20], opacity: [0, 1, 1, 0] }}
          transition={{
            duration: 4.4,
            times: reduceMotion ? [0, 0.5, 1] : [0, 0.22, 0.78, 1],
            repeat: Infinity,
            repeatType: 'loop',
            ease: 'easeInOut',
            delay: badge.delay,
            repeatDelay: 0.65,
          }}
        >
          {badge.label}
        </motion.div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const FEATURES = [
  {
    Icon: Search01Icon,
    title: 'CVE Detection',
    desc: 'Normalize findings across Trivy-backed scans and JFrog Artifactory/Xray imports',
  },
  {
    Icon: PackageIcon,
    title: 'Helm Chart Scanning',
    desc: 'Extract and scan every container image inside a Helm chart',
  },
  {
    Icon: FileExportIcon,
    title: 'SBOM Export',
    desc: 'Full software bill of materials in CycloneDX or SPDX format',
  },
  {
    Icon: Notification01Icon,
    title: 'Watchlist',
    desc: 'Schedule recurring scans and get notified on new CVEs',
  },
  {
    Icon: Building04Icon,
    title: 'Organizations',
    desc: 'Share scans and manage findings across teams',
  },
  { Icon: GridTableIcon, title: 'Audit Log', desc: 'Full history of who ran what scan and when' },
];

const STEPS = [
  {
    n: '1',
    title: 'Enter an image or chart',
    desc: 'Paste any public Docker image reference or a Helm chart URL',
  },
  {
    n: '2',
    title: 'Scan with Trivy or Xray',
    desc: 'Start with Trivy-backed public scans, or sign in to route private registries through JFrog Artifactory/Xray',
  },
  {
    n: '3',
    title: 'Review your findings',
    desc: 'Browse CVEs by severity, filter by package, and export results',
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function LandingPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}
    >
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 size-[700px] rounded-full"
          style={{
            background: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 65%)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 65%)',
          }}
        />
        <div
          className="absolute bottom-0 right-1/4 size-[400px] rounded-full"
          style={{
            background: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 65%)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 5%, transparent) 0%, transparent 65%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 8%, transparent) 1px, transparent 1px)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 5%, transparent) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            animation: 'heroGridDrift 18s linear infinite',
          }}
        />
        <div
          className="absolute inset-x-0 h-px"
          style={{
            background: isDark
              ? 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 30%, transparent), color-mix(in srgb, var(--accent) 40%, transparent), color-mix(in srgb, var(--accent) 30%, transparent), transparent)'
              : 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 12%, transparent), color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 12%, transparent), transparent)',
            animation: 'heroSweep 13s ease-in-out infinite',
            animationDelay: '1s',
            top: 0,
          }}
        />
      </div>

      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <Logo size={32} className="text-white" />
          <span className="font-semibold text-[15px] tracking-tight">JustScan</span>
        </div>
        <div className="flex items-center gap-2">
          {mounted && (
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className="size-9 flex items-center justify-center rounded-xl transition-colors"
              style={{
                background: 'var(--row-hover)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-muted)',
              }}
            >
              {isDark ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
          )}
          <Link href="/login">
            <Button>Sign in</Button>
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1">
        {/* ── Hero ────────────────────────────────────────────────── */}
        <section className="flex flex-col lg:flex-row items-center justify-center gap-10 px-6 pt-20 pb-16 max-w-6xl mx-auto">
          {/* Copy + CTAs */}
          <div className="flex-1 max-w-xl text-center lg:text-left space-y-6">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: 'var(--accent-soft)',
                border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                color: 'var(--accent)',
              }}
            >
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Free public scans · Trivy + Artifactory/Xray support
            </div>

            <h1
              className="text-4xl sm:text-5xl lg:text-[52px] font-bold tracking-tight leading-[1.1]"
              style={{ color: 'var(--text-primary)' }}
            >
              Find CVEs in any
              <br />
              <span
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, white) 0%, var(--accent) 60%, color-mix(in srgb, var(--accent) 80%, black) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                container image
              </span>
              <br />
              in seconds
            </h1>

            <p className="text-base leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Scan Docker images and Helm charts for vulnerabilities across all layers. Start
              instantly with Trivy-backed public scans, then sign in to scan private registries
              through JFrog Artifactory/Xray.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Link
                href="/public/scan/image"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold text-white text-center transition-all hover:opacity-90 active:scale-[0.98]"
                style={{
                  background:
                    'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, black))',
                  boxShadow:
                    '0 0 28px color-mix(in srgb, var(--accent) 40%, transparent), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}
              >
                Scan Docker image →
              </Link>
              <Link
                href="/public/scan/helm"
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-semibold text-center transition-all hover:opacity-90"
                style={{
                  background: 'var(--row-hover)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                Scan Helm chart →
              </Link>
            </div>

            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              5 free scans per hour · Public images only · Self-hosted
            </p>
          </div>

          {/* Scanner animation */}
          <div className="shrink-0">{mounted && <ScannerAnimation isDark={isDark} />}</div>
        </section>

        {/* ── Feature grid ─────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              Everything you need to{' '}
              <span
                style={{
                  background:
                    'linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, white), var(--accent))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                stay secure
              </span>
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              Start scanning for free with Trivy, then sign in for registry workflows powered by
              JFrog Artifactory/Xray.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-2xl p-5 space-y-2 transition-all"
                style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--surface-border)',
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.borderColor =
                    'color-mix(in srgb, var(--accent) 35%, transparent)')
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLDivElement).style.borderColor = 'var(--surface-border)')
                }
              >
                <div
                  className="size-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: isDark
                      ? 'color-mix(in srgb, var(--accent) 16%, transparent)'
                      : 'color-mix(in srgb, var(--accent) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
                    color: 'var(--accent)',
                  }}
                >
                  <Icon size={30} aria-hidden />
                </div>
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <h2
              className="text-2xl sm:text-3xl font-bold tracking-tight"
              style={{ color: 'var(--text-primary)' }}
            >
              How it works
            </h2>
          </div>
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {STEPS.map(({ n, title, desc }) => (
              <div
                key={n}
                className="flex sm:flex-col items-start sm:items-center sm:text-center gap-4 sm:gap-3 flex-1"
              >
                <div
                  className="shrink-0 size-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, black))',
                    boxShadow: '0 0 16px color-mix(in srgb, var(--accent) 30%, transparent)',
                  }}
                >
                  {n}
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {title}
                  </p>
                  <p
                    className="text-xs mt-1 leading-relaxed"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA banner ───────────────────────────────────────────── */}
        <section className="px-6 py-16 max-w-3xl mx-auto">
          <div
            className="rounded-3xl p-8 sm:p-10 text-center space-y-6"
            style={{
              background: isDark
                ? 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent) 0%, color-mix(in srgb, var(--accent) 10%, transparent) 100%)'
                : 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent) 0%, color-mix(in srgb, var(--accent) 4%, transparent) 100%)',
              border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
              boxShadow: '0 0 60px color-mix(in srgb, var(--accent) 12%, transparent)',
            }}
          >
            <div className="size-12 rounded-2xl mx-auto flex items-center justify-center">
              <Logo size={48} />
            </div>
            <div>
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Start scanning for free
              </h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                No account, no credit card, no Docker daemon. Just paste an image reference and go.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/public/scan/image"
                className="w-full sm:w-auto px-7 py-3 rounded-xl text-sm font-semibold text-white text-center transition-all hover:opacity-90"
                style={{
                  background:
                    'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 80%, black))',
                  boxShadow: '0 0 28px color-mix(in srgb, var(--accent) 40%, transparent)',
                }}
              >
                Scan Docker image →
              </Link>
              <Link
                href="/public/scan/helm"
                className="w-full sm:w-auto px-7 py-3 rounded-xl text-sm font-semibold text-center transition-all hover:opacity-90"
                style={{
                  background: 'var(--row-hover)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                Scan Helm chart →
              </Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Or{' '}
              <Link
                href="/login"
                className="underline underline-offset-2 transition-colors"
                style={{ color: 'var(--text-faint)' }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--accent)')
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.color = 'var(--text-faint)')
                }
              >
                sign in
              </Link>{' '}
              for unlimited scans, watchlists, organizations, and more.
            </p>
          </div>
        </section>
      </main>

      <footer
        className="relative z-10 text-center py-6 text-xs"
        style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}
      >
        JustScan · Self-hosted container vulnerability scanner
      </footer>
    </div>
  );
}
