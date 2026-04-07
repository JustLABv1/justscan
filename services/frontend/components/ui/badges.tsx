'use client';

// ── StatusBadge ────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label?: string }> = {
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.22)' },
  failed:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.22)'  },
  running:   { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.22)' },
  pending:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'queued' },
  cancelled: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
  waiting_for_xray: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)', label: 'waiting for xray' },
};

export function StatusBadge({ status, externalStatus }: { status: string; externalStatus?: string }) {
  const effectiveStatus = externalStatus === 'waiting_for_xray' && (status === 'pending' || status === 'running')
    ? 'waiting_for_xray'
    : status;
  const s = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${effectiveStatus === 'running' || effectiveStatus === 'waiting_for_xray' ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      {s.label ?? effectiveStatus}
    </span>
  );
}

// ── SeverityBadge ──────────────────────────────────────────────────────
const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: 'Critical', color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/20' },
  HIGH:     { label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  MEDIUM:   { label: 'Medium',   color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  LOW:      { label: 'Low',      color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  UNKNOWN:  { label: 'Unknown',  color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/20' },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEV_CONFIG[severity] ?? SEV_CONFIG.UNKNOWN;
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

// ── SourceBadge ────────────────────────────────────────────────────────
export function SourceBadge({ source }: { source?: string }) {
  const normalized = (source ?? '').trim().toLowerCase();
  const isOSV = normalized === 'osv.dev';
  const isXray = normalized === 'jfrog xray' || normalized === 'xray';
  const label = isOSV ? 'OSV.dev' : isXray ? 'Xray' : source?.trim() || 'Trivy';
  const style = isOSV
    ? { background: 'rgba(59,130,246,0.14)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.24)' }
    : isXray
      ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.22)' }
      : { background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.22)' };
  return (
    <span
      className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
      style={style}
      title={source || (isOSV ? 'OSV supplemental finding' : isXray ? 'JFrog Xray finding' : 'Scanner finding')}
    >
      {label}
    </span>
  );
}

// ── SevCount (table cell) ──────────────────────────────────────────────
const SEV_TEXT: Record<string, string> = {
  critical: 'text-red-400 font-bold',
  high:     'text-orange-400',
  medium:   'text-yellow-400',
  low:      'text-blue-400',
};

export function SevCount({ count, level }: { count: number; level: 'critical' | 'high' | 'medium' | 'low' }) {
  return (
    <span className={`font-mono text-sm ${count ? SEV_TEXT[level] : 'text-zinc-400 dark:text-zinc-700'}`}>
      {count || '—'}
    </span>
  );
}
