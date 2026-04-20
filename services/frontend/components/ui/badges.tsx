'use client';

import type { OwnerType } from '@/lib/api';

// ── StatusBadge ────────────────────────────────────────────────────────
const STATUS_ALIASES: Record<string, string> = {
  warming_artifactory_cache: 'warming_cache',
  indexing: 'indexing_artifact',
  queued: 'queued_in_xray',
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label?: string }> = {
  healthy: { color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.22)' },
  degraded: { color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.22)' },
  stale: { color: '#eab308', bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.22)' },
  completed: { color: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.22)' },
  failed:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.22)'  },
  running:   { color: '#60a5fa', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.22)' },
  pending:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'queued' },
  cancelled: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)' },
  warming_cache: { color: '#38bdf8', bg: 'rgba(14,165,233,0.12)', border: 'rgba(14,165,233,0.22)', label: 'warming cache' },
  indexing_artifact: { color: '#f97316', bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.22)', label: 'indexing artifact' },
  queued_in_xray: { color: '#c084fc', bg: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.22)', label: 'queued in xray' },
  blocked_by_xray_policy: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)', label: 'blocked by xray policy' },
  waiting_for_xray: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)', label: 'waiting for xray' },
};

export function normalizeStatus(status?: string) {
  if (!status) {
    return '';
  }

  return STATUS_ALIASES[status] ?? status;
}

export function resolveDisplayStatus(status: string, externalStatus?: string) {
  const normalizedStatus = normalizeStatus(status);
  const normalizedExternalStatus = normalizeStatus(externalStatus);

  if ((normalizedStatus === 'pending' || normalizedStatus === 'running') && normalizedExternalStatus && normalizedExternalStatus !== normalizedStatus) {
    return normalizedExternalStatus;
  }

  if (normalizedStatus === 'failed' && normalizedExternalStatus === 'blocked_by_xray_policy') {
    return normalizedExternalStatus;
  }

  return normalizedStatus;
}

export function formatStatusLabel(status: string) {
  const normalizedStatus = normalizeStatus(status);
  const labels: Record<string, string> = {
    blocked_by_xray_policy: 'blocked by xray policy',
    waiting_for_xray: 'waiting for xray',
    warming_cache: 'warming cache',
    indexing_artifact: 'indexing artifact',
    queued_in_xray: 'queued in xray',
  };

  return labels[normalizedStatus] ?? normalizedStatus.replace(/_/g, ' ');
}

export function StatusBadge({ status, externalStatus }: { status: string; externalStatus?: string }) {
  const effectiveStatus = resolveDisplayStatus(status, externalStatus);
  const s = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 ${effectiveStatus === 'warming_cache' ? 'animate-bounce' : effectiveStatus === 'running' || effectiveStatus === 'waiting_for_xray' || effectiveStatus === 'queued_in_xray' || effectiveStatus === 'indexing_artifact' ? 'animate-pulse' : ''}`}
        aria-hidden
      />
      {s.label ?? formatStatusLabel(effectiveStatus)}
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

export function SuppressionSourceBadge({ source }: { source?: string }) {
  const normalized = (source ?? 'local').trim().toLowerCase();
  const label = normalized === 'xray' ? 'Xray' : normalized === 'mixed' ? 'Mixed' : 'Local';
  const style = normalized === 'xray'
    ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.22)' }
    : normalized === 'mixed'
      ? { background: 'rgba(236,72,153,0.12)', color: '#f472b6', border: '1px solid rgba(236,72,153,0.22)' }
      : { background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.22)' };

  return (
    <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md shrink-0" style={style} title={`Suppression source: ${label}`}>
      {label}
    </span>
  );
}

const OWNERSHIP_CONFIG: Record<'user' | 'org' | 'system', { color: string; bg: string; border: string }> = {
  user: { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.22)' },
  org: { color: '#a78bfa', bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.22)' },
  system: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)' },
};

export function OwnershipBadge({
  ownerType,
  ownerOrgId,
  orgNamesById,
  className = '',
}: {
  ownerType?: OwnerType;
  ownerOrgId?: string | null;
  orgNamesById?: Record<string, string>;
  className?: string;
}) {
  const resolvedType = ownerType === 'org' || ownerType === 'system' ? ownerType : 'user';
  const cfg = OWNERSHIP_CONFIG[resolvedType];
  const orgName = ownerOrgId ? orgNamesById?.[ownerOrgId] : undefined;
  const label = resolvedType === 'org'
    ? orgName ? `Org: ${orgName}` : 'Org workspace'
    : resolvedType === 'system'
      ? 'System'
      : 'Personal';
  const title = resolvedType === 'org'
    ? orgName ? `Owned by organization ${orgName}` : 'Owned by an organization workspace'
    : resolvedType === 'system'
      ? 'Owned by the system'
      : 'Owned by your personal workspace';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${className}`.trim()}
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
      title={title}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />
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
