'use client';
import { DashboardStats, getStats, Scan } from '@/lib/api';
import {
  Activity01Icon,
  Add01Icon,
  AlertDiamondIcon,
  CheckmarkBadge01Icon,
  Clock01Icon,
  EyeIcon,
  Shield01Icon,
} from 'hugeicons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// ── severity config ──────────────────────────────────────────────────
const SEV = [
  { key: 'critical', label: 'Critical', hex: '#f87171', glow: 'rgba(239,68,68,0.35)',   grad: 'linear-gradient(90deg,#991b1b,#f87171)' },
  { key: 'high',     label: 'High',     hex: '#fb923c', glow: 'rgba(249,115,22,0.35)',  grad: 'linear-gradient(90deg,#c2410c,#fb923c)' },
  { key: 'medium',   label: 'Medium',   hex: '#fbbf24', glow: 'rgba(245,158,11,0.3)',   grad: 'linear-gradient(90deg,#b45309,#fbbf24)' },
  { key: 'low',      label: 'Low',      hex: '#60a5fa', glow: 'rgba(59,130,246,0.3)',   grad: 'linear-gradient(90deg,#1d4ed8,#60a5fa)' },
  { key: 'unknown',  label: 'Unknown',  hex: '#a1a1aa', glow: 'rgba(113,113,122,0.25)', grad: 'linear-gradient(90deg,#3f3f46,#a1a1aa)' },
];

// ── stat card config ─────────────────────────────────────────────────
const STATS = [
  {
    key: 'total',
    label: 'Total Scans',
    Icon: Shield01Icon,
    tint: 'rgba(124,58,237,0.14)',
    iconColor: '#a78bfa',
    iconBg: 'rgba(124,58,237,0.22)',
    glow: 'rgba(124,58,237,0.4)',
    getValue: (s: DashboardStats) => s.total_scans,
    getSub:   (s: DashboardStats) => {
      const r = s.status_counts['running'] ?? 0;
      return r > 0 ? { text: `${r} running`, pulse: true } : null;
    },
  },
  {
    key: 'completed',
    label: 'Completed',
    Icon: CheckmarkBadge01Icon,
    tint: 'rgba(16,185,129,0.11)',
    iconColor: '#34d399',
    iconBg: 'rgba(16,185,129,0.2)',
    glow: 'rgba(16,185,129,0.35)',
    getValue: (s: DashboardStats) => s.status_counts['completed'] ?? 0,
    getSub:   () => null,
  },
  {
    key: 'failed',
    label: 'Failed',
    Icon: AlertDiamondIcon,
    tint: 'rgba(239,68,68,0.11)',
    iconColor: '#f87171',
    iconBg: 'rgba(239,68,68,0.2)',
    glow: 'rgba(239,68,68,0.35)',
    getValue: (s: DashboardStats) => s.status_counts['failed'] ?? 0,
    getSub:   () => null,
  },
  {
    key: 'watchlist',
    label: 'Watchlist',
    Icon: EyeIcon,
    tint: 'rgba(59,130,246,0.11)',
    iconColor: '#60a5fa',
    iconBg: 'rgba(59,130,246,0.2)',
    glow: 'rgba(59,130,246,0.35)',
    getValue: (s: DashboardStats) => s.watchlist_count,
    getSub:   () => null,
  },
];

// ── helpers ──────────────────────────────────────────────────────────
function glassCard(tint?: string): React.CSSProperties {
  return {
    background: tint
      ? `linear-gradient(145deg, ${tint} 0%, var(--glass-bg-tint-end) 70%)`
      : 'var(--glass-bg)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid var(--glass-border)',
    boxShadow: 'var(--glass-shadow)',
  };
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; border: string }> = {
  completed: { label: 'Done',    color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.22)'  },
  failed:    { label: 'Failed',  color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.22)'   },
  running:   { label: 'Running', color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.22)'  },
  pending:   { label: 'Pending', color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)' },
};

function RecentScanRow({ scan }: { scan: Scan }) {
  const sc = STATUS_MAP[scan.status] ?? STATUS_MAP.pending;
  return (
    <Link
      href={`/scans/${scan.id}`}
      className="flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors duration-150 group"
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 tracking-wide"
          style={{ color: sc.color, background: sc.bg, border: `1px solid ${sc.border}` }}
        >
          {sc.label}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
            {scan.image_name}:{scan.image_tag}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">{new Date(scan.created_at).toLocaleString()}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-2">
        {scan.critical_count > 0 && (
          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md"
            style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.18)' }}>
            C:{scan.critical_count}
          </span>
        )}
        {scan.high_count > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
            style={{ color: '#fb923c', background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.18)' }}>
            H:{scan.high_count}
          </span>
        )}
        {scan.medium_count > 0 && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md"
            style={{ color: '#fbbf24', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.18)' }}>
            M:{scan.medium_count}
          </span>
        )}
      </div>
    </Link>
  );
}

// ── page ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-8">
      <div className="rounded-xl px-4 py-3 text-sm"
        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
        {error}
      </div>
    </div>
  );

  if (!stats) return null;

  const totalVulns = Object.values(stats.severity_totals).reduce((a, b) => a + b, 0);
  const hasCriticals = (stats.severity_totals['critical'] ?? 0) > 0;

  return (
    <div className="relative p-6 space-y-5 max-w-7xl mx-auto">
      {/* Ambient background orbs */}
      <div className="pointer-events-none" aria-hidden>
        <div className="fixed top-0 right-0 w-[560px] h-[560px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.09) 0%, transparent 70%)', filter: 'blur(48px)', zIndex: 0 }} />
        <div className="fixed bottom-0 left-64 w-[480px] h-[480px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(29,78,216,0.07) 0%, transparent 70%)', filter: 'blur(48px)', zIndex: 0 }} />
        {hasCriticals && (
          <div className="fixed top-1/2 right-1/3 w-[360px] h-[360px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(239,68,68,0.05) 0%, transparent 70%)', filter: 'blur(48px)', zIndex: 0 }} />
        )}
      </div>

      {/* ── Header ── */}
      <div className="relative flex items-start justify-between z-10">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">Security scan activity overview</p>
        </div>
        <Link
          href="/scans"
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-150 hover:opacity-90 active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
            boxShadow: '0 0 24px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
        >
          <Add01Icon size={15} />
          New Scan
        </Link>
      </div>

      {/* ── Stat cards ── */}
      <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 z-10">
        {STATS.map(({ key, label, Icon, tint, iconColor, iconBg, glow, getValue, getSub }) => {
          const value = getValue(stats);
          const sub = getSub(stats);
          return (
            <div key={key} className="relative flex items-center gap-3 rounded-xl px-4 py-3 overflow-hidden" style={glassCard(tint)}>
              {/* Watermark */}
              <div className="absolute -right-2 -bottom-2 opacity-[0.05] pointer-events-none">
                <Icon size={56} color={iconColor} />
              </div>
              {/* Icon badge */}
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: iconBg, boxShadow: `0 0 14px ${glow}` }}>
                <Icon size={17} color={iconColor} />
              </div>
              {/* Text */}
              <div className="min-w-0">
                <p className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight tabular-nums leading-none">{value}</p>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{label}</p>
                {sub && (
                  <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: '#60a5fa' }}>
                    {sub.pulse && <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse shrink-0" />}
                    {sub.text}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Vulnerability landscape ── */}
      <div className="relative rounded-2xl p-5 z-10" style={glassCard()}>
        {/* Top edge shimmer */}
        <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.2), transparent)' }} />

        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(124,58,237,0.2)', boxShadow: '0 0 14px rgba(124,58,237,0.3)' }}>
              <Activity01Icon size={17} color="#a78bfa" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Vulnerability Landscape</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Across all completed scans</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-zinc-900 dark:text-white tabular-nums">{totalVulns.toLocaleString()}</p>
            <p className="text-xs text-zinc-500">total findings</p>
          </div>
        </div>

        <div className="space-y-3">
          {SEV.map(({ key, label, hex, glow, grad }) => {
            const count = stats.severity_totals[key] ?? 0;
            const pct   = totalVulns > 0 ? (count / totalVulns) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs font-medium w-14 shrink-0 tabular-nums" style={{ color: hex }}>
                  {label}
                </span>
                <div className="flex-1 rounded-full h-2 overflow-hidden"
                  style={{ background: 'var(--row-divider)' }}>
                  <div
                    className="h-2 rounded-full transition-all duration-700"
                    style={{
                      width: `${pct}%`,
                      background: grad,
                      boxShadow: pct > 2 ? `0 0 10px ${glow}` : undefined,
                    }}
                  />
                </div>
                <span
                  className="text-xs font-mono font-bold w-14 text-right shrink-0 px-2 py-0.5 rounded-lg tabular-nums"
                  style={{
                    color: hex,
                    background: glow.replace('0.35', '0.1').replace('0.3', '0.08').replace('0.25', '0.07'),
                    border: `1px solid ${glow.replace('0.35', '0.18').replace('0.3', '0.15').replace('0.25', '0.12')}`,
                  }}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="relative grid md:grid-cols-2 gap-4 z-10">
        {/* Recent scans */}
        <div className="relative rounded-2xl p-5" style={glassCard()}>
          <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.15), transparent)' }} />
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                <Clock01Icon size={14} color="#71717a" />
              </div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Recent Scans</h2>
            </div>
            <Link href="/scans" className="text-xs text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors">
              View all →
            </Link>
          </div>
          {(stats.recent_scans ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">No scans yet</p>
          ) : (
            <div className="space-y-0.5 -mx-1">
              {(stats.recent_scans ?? []).map((s) => <RecentScanRow key={s.id} scan={s} />)}
            </div>
          )}
        </div>

        {/* Top scanned images */}
        <div className="relative rounded-2xl p-5" style={glassCard()}>
          <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.15), transparent)' }} />
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              <Shield01Icon size={14} color="#71717a" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Top Scanned Images</h2>
          </div>
          {(stats.top_images ?? []).length === 0 ? (
            <p className="text-sm text-zinc-500 py-8 text-center">No data yet</p>
          ) : (
            <div className="space-y-1.5 pt-1">
              {(stats.top_images ?? []).map((img, i) => (
                <div
                  key={img.image_name}
                  className="flex items-center gap-3 px-2.5 py-2 rounded-xl"
                  style={{ background: 'var(--row-hover)', border: '1px solid var(--row-divider)' }}
                >
                  <span
                    className="text-xs font-bold w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                    style={i === 0
                      ? { background: 'rgba(124,58,237,0.25)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }
                      : { background: 'var(--row-divider)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }
                    }
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate">{img.image_name}</span>
                  <span
                    className="text-xs font-mono shrink-0 px-2 py-0.5 rounded-lg"
                    style={{ color: 'var(--text-muted)', background: 'var(--row-divider)', border: '1px solid var(--glass-border)' }}
                  >
                    {img.count}×
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
