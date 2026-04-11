'use client';

import { Logo } from '@/components/logo';
import { SeverityBadge, SourceBadge, StatusBadge, formatStatusLabel, resolveDisplayStatus } from '@/components/ui/badges';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type { StatusPageItem, StatusPageResponse, StatusPageScanSummary, Vulnerability } from '@/lib/api';
import { ApiError, getStatusPageBySlug, getStatusPageItemVulnerabilityContextAnalysis, getStatusPageTrackedScan, getToken, listStatusPageItemVulnerabilities, listStatusPageScanHistory } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { Button, ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AUTO_REFRESH_MS = 30000;
const VULN_PAGE_SIZE = 25;
const STATUS_LAYOUT_STORAGE_KEY = 'justscan_status_page_layout';
const STATUS_FILTER_STORAGE_KEY = 'justscan_status_page_filter';
const STATUS_SORT_STORAGE_KEY = 'justscan_status_page_sort';
const STATUS_SELECT_TRIGGER_CLS = 'glass-input min-h-11 rounded-full px-3 text-sm';
const STATUS_INPUT_CLS = 'glass-input min-h-11 rounded-xl px-3 text-sm outline-none';
const STATUS_PRIORITY: Record<string, number> = {
  failed: 0,
  blocked_by_xray_policy: 1,
  degraded: 2,
  stale: 3,
  running: 4,
  pending: 5,
  healthy: 6,
  cancelled: 7,
};
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'blocked_by_xray_policy', label: 'Blocked' },
  { key: 'running', label: 'Running' },
  { key: 'degraded', label: 'Degraded' },
  { key: 'stale', label: 'Stale' },
  { key: 'healthy', label: 'Healthy' },
] as const;
const SORT_OPTIONS = [
  { key: 'display', label: 'Configured order' },
  { key: 'worst', label: 'Worst first' },
  { key: 'stale', label: 'Stalest first' },
  { key: 'latest', label: 'Newest scan' },
] as const;
const LAYOUT_OPTIONS = [
  { key: 'detailed', label: 'Detailed' },
  { key: 'compact', label: 'Compact' },
  { key: 'grid', label: 'Grid' },
  { key: 'table', label: 'Table' },
] as const;
const VULN_SEVERITY_OPTIONS = [
  { key: '__all__', label: 'All severities' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'HIGH', label: 'High' },
  { key: 'MEDIUM', label: 'Medium' },
  { key: 'LOW', label: 'Low' },
] as const;

const SEV = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#71717a',
} as const;

const STATUS_COLOR: Record<string, string> = {
  healthy: '#22c55e',
  degraded: '#f97316',
  stale: '#eab308',
  failed: '#ef4444',
  blocked_by_xray_policy: '#f59e0b',
  pending: '#a78bfa',
  running: '#60a5fa',
  cancelled: '#52525b',
  waiting_for_xray: '#f59e0b',
  warming_cache: '#fb923c',
  indexing_artifact: '#f97316',
  queued_in_xray: '#f59e0b',
};
const ACTIVE_SCAN_STATUSES = new Set(['running', 'pending', 'waiting_for_xray', 'warming_cache', 'indexing_artifact', 'queued_in_xray']);

type FilterKey = (typeof FILTERS)[number]['key'];
type SortKey = (typeof SORT_OPTIONS)[number]['key'];
type LayoutKey = (typeof LAYOUT_OPTIONS)[number]['key'];
type VulnerabilitySortKey = 'vuln_id' | 'pkg_name' | 'installed_version' | 'fixed_version' | 'severity' | 'cvss_score';

function getStatusRank(status: string) {
  return STATUS_PRIORITY[status] ?? 99;
}

function getTintedChipStyle(accent: string, textColor = accent) {
  return {
    background: `color-mix(in srgb, ${accent} 14%, var(--status-card-bg))`,
    border: `1px solid color-mix(in srgb, ${accent} 24%, var(--status-card-border))`,
    color: textColor,
  };
}

function getEffectiveScanStatus(status: string, externalStatus?: string) {
  return resolveDisplayStatus(status, externalStatus);
}

function getFindingTotal(item: StatusPageItem) {
  return item.critical_count + item.high_count + item.medium_count + item.low_count;
}

function getPresentationStatus(item: StatusPageItem) {
  return item.status === 'running' || item.status === 'pending'
    ? getEffectiveScanStatus(item.scan_status, item.external_status)
    : item.status;
}

function compareItemsByPriority(left: StatusPageItem, right: StatusPageItem) {
  const leftStatus = getPresentationStatus(left);
  const rightStatus = getPresentationStatus(right);

  return (
    getStatusRank(leftStatus) - getStatusRank(rightStatus)
    || right.critical_count - left.critical_count
    || right.high_count - left.high_count
    || right.medium_count - left.medium_count
    || right.low_count - left.low_count
    || right.freshness_hours - left.freshness_hours
    || new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
  );
}

type BlockedPolicyDetails = {
  summary: string;
  manifest?: string;
  artifact?: string;
  jfrog?: string;
  matchedIssues?: string;
  matchedWatches?: string;
  blockingPolicies?: string;
  matchedPolicies?: string;
  totalViolations?: string;
};

function parseBlockedPolicyDetails(errorMessage?: string | null): BlockedPolicyDetails | null {
  const message = errorMessage?.trim();
  if (!message) return null;

  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const details: BlockedPolicyDetails = { summary: lines[0] };
  for (const line of lines.slice(1)) {
    if (line.startsWith('Manifest: ')) details.manifest = line.slice('Manifest: '.length);
    else if (line.startsWith('Artifact: ')) details.artifact = line.slice('Artifact: '.length);
    else if (line.startsWith('JFrog: ')) details.jfrog = line.slice('JFrog: '.length);
    else if (line.startsWith('Matched issues: ')) details.matchedIssues = line.slice('Matched issues: '.length);
    else if (line.startsWith('Matched watches: ')) details.matchedWatches = line.slice('Matched watches: '.length);
    else if (line.startsWith('Blocking policies: ')) details.blockingPolicies = line.slice('Blocking policies: '.length);
    else if (line.startsWith('Matched policies: ')) details.matchedPolicies = line.slice('Matched policies: '.length);
    else if (line.startsWith('Xray violations found for this artifact: ')) details.totalViolations = line.slice('Xray violations found for this artifact: '.length);
  }

  const hasStructuredDetails = Boolean(
    details.manifest ||
    details.artifact ||
    details.jfrog ||
    details.matchedIssues ||
    details.matchedWatches ||
    details.blockingPolicies ||
    details.matchedPolicies ||
    details.totalViolations,
  );

  return hasStructuredDetails ? details : null;
}

function countDelimitedValues(value?: string) {
  if (!value) return 0;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .length;
}

function compactDelimitedValues(value?: string, maxItems = 2) {
  if (!value) return '';
  const items = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (items.length <= maxItems) return items.join(', ');
  return `${items.slice(0, maxItems).join(', ')} +${items.length - maxItems} more`;
}

function TagBadge({ tag, accent }: { tag: string; accent?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{
        background: accent ? `color-mix(in srgb, ${accent} 10%, var(--status-pill-bg))` : 'var(--status-pill-bg)',
        border: accent ? `1px solid color-mix(in srgb, ${accent} 24%, var(--status-pill-border))` : '1px solid var(--status-pill-border)',
        color: 'var(--text-primary)',
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
        Tag
      </span>
      <span className="font-mono text-[12px] leading-none">{tag}</span>
    </span>
  );
}

function compactErrorSummary(message?: string) {
  const firstLine = message?.split('\n').map((line) => line.trim()).find(Boolean);
  if (!firstLine) return '';
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

function buildItemNote(item: StatusPageItem, blockedPolicyDetails: BlockedPolicyDetails | null) {
  if (blockedPolicyDetails) {
    const details: string[] = [];
    if (blockedPolicyDetails.totalViolations) {
      details.push(`${blockedPolicyDetails.totalViolations} violations`);
    }
    if (blockedPolicyDetails.blockingPolicies) {
      details.push(`${countDelimitedValues(blockedPolicyDetails.blockingPolicies)} blocking policies`);
    }
    return details.length > 0 ? details.join(' · ') : blockedPolicyDetails.summary;
  }

  if (item.error_message) {
    return compactErrorSummary(item.error_message);
  }

  const parts: string[] = [];
  if (item.critical_count > 0) parts.push(`${item.critical_count} critical`);
  if (item.high_count > 0) parts.push(`${item.high_count} high`);
  if (item.medium_count > 0) parts.push(`${item.medium_count} medium`);
  if (item.low_count > 0) parts.push(`${item.low_count} low`);
  return parts.length > 0 ? parts.join(' · ') : 'No active findings';
}

function getRefreshCadence(lastLoadedAt: number | null, now: number) {
  const elapsedMs = lastLoadedAt ? Math.max(0, now - lastLoadedAt) : 0;

  return {
    elapsedMs,
    progress: Math.min(100, (elapsedMs / AUTO_REFRESH_MS) * 100),
    secondsRemaining: Math.max(0, Math.ceil((AUTO_REFRESH_MS - Math.min(elapsedMs, AUTO_REFRESH_MS)) / 1000)),
  };
}

function useTicker(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  const gradient = data
    .reduce<{ stops: string[]; offset: number }>((accumulator, segment) => {
      const start = accumulator.offset;
      const end = start + (segment.value / total) * 100;
      accumulator.stops.push(`${segment.color} ${start}% ${end}%`);
      return {
        stops: accumulator.stops,
        offset: end,
      };
    }, { stops: [], offset: 0 })
    .stops
    .join(', ');

  return (
    <div className="relative isolate flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-full">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from -90deg, ${gradient})`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)',
        }}
      />
      <div
        className="absolute inset-[12px] rounded-full"
        style={{
          background: 'color-mix(in srgb, var(--status-card-bg) 92%, transparent)',
          border: '1px solid var(--status-card-border)',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.08)',
        }}
      />
      <div className="relative flex flex-col items-center justify-center text-center">
        <span className="text-[26px] font-semibold leading-none tabular-nums" style={{ color: 'var(--text-primary)' }}>{total}</span>
        <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>Tags</span>
      </div>
    </div>
  );
}

function RunningScanVisualization({
  provider,
  currentStep,
  status,
  externalStatus,
  startedAt,
  compact = false,
}: {
  provider?: string;
  currentStep?: string;
  status: string;
  externalStatus?: string;
  startedAt?: string;
  compact?: boolean;
}) {
  const providerKey = (provider ?? '').toLowerCase();
  const isXray = providerKey === 'xray';
  const accent = isXray ? '#f59e0b' : '#60a5fa';
  const accentSoft = isXray ? 'rgba(245,158,11,0.14)' : 'rgba(96,165,250,0.16)';
  const resolvedStatus = getEffectiveScanStatus(status, externalStatus);
  const detail = currentStep ? formatStatusLabel(currentStep) : formatStatusLabel(resolvedStatus);

  return (
    <div
      className={`relative overflow-hidden rounded-[24px] border px-4 ${compact ? 'py-3' : 'py-4'}`}
      style={{
        background: `linear-gradient(135deg, ${accentSoft}, color-mix(in srgb, var(--status-card-bg) 88%, transparent))`,
        borderColor: `color-mix(in srgb, ${accent} 22%, var(--status-card-border))`,
      }}
    >
      <div
        className="absolute inset-y-0 left-0 w-20 opacity-70"
        style={{ background: `radial-gradient(circle at left center, ${accentSoft}, transparent 72%)` }}
      />
      <div className="relative flex items-center justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
            {isXray ? 'Xray pipeline active' : 'Scan pipeline active'}
          </p>
          <p className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`} style={{ color: 'var(--text-primary)' }}>
            {detail}
          </p>
          <p className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {startedAt ? `Started ${timeAgo(startedAt)}` : 'Live scan data is still arriving for this tag.'}
          </p>
        </div>

        <div className={`relative shrink-0 ${compact ? 'h-14 w-28' : 'h-16 w-32'}`} aria-hidden="true">
          {[0, 1, 2].map((lane) => (
            <span
              key={`lane-${lane}`}
              className="absolute left-0 right-7 h-px"
              style={{
                top: `${18 + lane * 12}px`,
                background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
                opacity: 0.5,
              }}
            />
          ))}
          {[0, 1, 2].map((dot) => (
            <span key={`dot-${dot}`} className="absolute" style={{ left: `${12 + dot * 18}px`, top: `${13 + dot * 12}px` }}>
              <span
                className="absolute inline-flex h-3 w-3 animate-ping rounded-full"
                style={{ background: accent, opacity: 0.45, animationDelay: `${dot * 220}ms`, animationDuration: '1.8s' }}
              />
              <span className="relative inline-flex h-3 w-3 rounded-full border border-white/50" style={{ background: accent }} />
            </span>
          ))}
          <span
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full border-2 animate-pulse"
            style={{ borderColor: accent, boxShadow: `0 0 0 4px ${accentSoft}` }}
          />
        </div>
      </div>
    </div>
  );
}

function SeverityBar({ item }: { item: StatusPageItem }) {
  const total = getFindingTotal(item);
  if (total === 0) {
    return (
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 rounded-full" style={{ background: 'var(--status-bar-track)' }} />
        <span className="min-w-[82px] text-right text-[12px] font-medium tabular-nums text-zinc-500">0 findings</span>
      </div>
    );
  }
  const segments = [
    { key: 'critical', count: item.critical_count, color: SEV.critical },
    { key: 'high', count: item.high_count, color: SEV.high },
    { key: 'medium', count: item.medium_count, color: SEV.medium },
    { key: 'low', count: item.low_count, color: SEV.low },
  ].filter(s => s.count > 0);

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--status-bar-track)' }}>
        {segments.map(s => (
          <div
            key={s.key}
            className="h-full transition-all duration-700"
            style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <span className="min-w-[82px] text-right text-[12px] font-medium tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {total.toLocaleString()} findings
      </span>
    </div>
  );
}

function Delta({ value }: { value?: number }) {
  if (!value) return null;
  const up = value > 0;
  return (
    <span className={`text-[11px] font-semibold tabular-nums ${up ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
      {up ? `+${value}` : value}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium capitalize"
      style={{
        color: 'var(--text-secondary)',
        background: 'var(--status-pill-bg)',
        border: '1px solid var(--status-pill-border)',
      }}>
      <span className="relative flex h-2.5 w-2.5">
        {(status === 'running' || status === 'pending') && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
        )}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      </span>
      {formatStatusLabel(status)}
    </span>
  );
}

function SignalStat({
  label,
  value,
  color,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  color: string;
  detail?: string;
}) {
  return (
    <div
      className="min-w-[112px] rounded-2xl px-3.5 py-3"
      style={{
        background: `color-mix(in srgb, ${color} 10%, var(--status-card-bg))`,
        border: `1px solid color-mix(in srgb, ${color} 18%, var(--status-card-border))`,
      }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-2xl font-semibold leading-none tabular-nums" style={{ color }}>{value}</span>
        {detail ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-secondary)' }}>
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SeverityStat({
  label,
  value,
  delta,
  color,
}: {
  label: string;
  value: number;
  delta?: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl px-3.5 py-3 min-w-[110px]"
      style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums leading-none" style={{ color }}>{value}</span>
        <Delta value={delta} />
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'primary' : 'secondary'}
      onPress={onClick}
      className="rounded-full px-3.5 text-sm font-medium"
      style={active ? undefined : { color: 'var(--text-secondary)' }}
    >
      <span>{label}</span>
      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
        style={{
          background: active ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.05)',
          color: active ? '#ffffff' : 'var(--text-secondary)',
        }}>
        {count}
      </span>
    </Button>
  );
}

function CompactStatusRow({
  item,
  onOpen,
}: {
  item: StatusPageItem;
  onOpen: (item: StatusPageItem) => void;
}) {
  const status = getPresentationStatus(item);
  const effectiveScanStatus = getEffectiveScanStatus(item.scan_status, item.external_status);
  const accent = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
  const totalFindings = getFindingTotal(item);
  const blockedPolicyDetails = status === 'blocked_by_xray_policy' ? parseBlockedPolicyDetails(item.error_message) : null;
  const note = buildItemNote(item, blockedPolicyDetails);
  const isRunning = ACTIVE_SCAN_STATUSES.has(effectiveScanStatus);

  return (
    <button
      type="button"
      className="group relative w-full overflow-hidden rounded-[20px] border px-4 py-3 text-left transition-colors hover:border-zinc-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
      style={{
        background: status === 'healthy'
          ? 'var(--status-card-bg)'
          : `color-mix(in srgb, ${accent} 7%, var(--status-card-bg))`,
        borderColor: status === 'healthy'
          ? 'var(--status-card-border)'
          : `color-mix(in srgb, ${accent} 18%, var(--status-card-border))`,
      }}
      aria-label={`Open details for ${item.image_name}:${item.image_tag}`}
      onClick={() => onOpen(item)}
    >
      <div className="absolute inset-y-0 left-0 w-1 rounded-full" style={{ background: accent }} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.8fr)_auto_auto_auto] lg:items-center">
        <div className="min-w-0 pl-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={status} />
            <TagBadge tag={item.image_tag} accent={accent} />
            {isRunning ? (
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}
              >
                {formatStatusLabel(item.current_step || effectiveScanStatus)}
              </span>
            ) : null}
          </div>
          <p className="mt-2 truncate font-mono text-[14px] font-medium sm:text-[15px]" style={{ color: 'var(--text-primary)' }}>
            {item.image_name}
          </p>
          <p className="mt-1 line-clamp-2 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {note}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2 lg:block lg:min-w-[112px] lg:bg-transparent lg:p-0"
          style={{ background: 'var(--status-pill-bg)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Findings</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: totalFindings > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
            {totalFindings.toLocaleString()}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2 lg:block lg:min-w-[112px] lg:bg-transparent lg:p-0"
          style={{ background: 'var(--status-pill-bg)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Freshness</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {item.freshness_hours}h
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl px-3 py-2 lg:block lg:min-w-[120px] lg:bg-transparent lg:p-0 lg:text-right"
          style={{ background: 'var(--status-pill-bg)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>Observed</p>
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            {timeAgo(item.observed_at)}
          </p>
        </div>
      </div>
    </button>
  );
}

function formatScanHistoryOptionLabel(scan: StatusPageScanSummary) {
  const effectiveStatus = getEffectiveScanStatus(scan.scan_status, scan.external_status);
  return `${scan.is_latest ? 'Latest' : 'Previous'} · ${formatStatusLabel(effectiveStatus)} · ${timeAgo(scan.observed_at)}`;
}

function StatusItemVulnerabilityModal({
  slug,
  item,
  state,
  onClose,
}: {
  slug: string;
  item: StatusPageItem | null;
  state: ReturnType<typeof useOverlayState>;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<StatusPageScanSummary[]>([]);
  const [selectedScanId, setSelectedScanId] = useState(() => item?.latest_scan_id ?? '');
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState('');
  const [pkgInput, setPkgInput] = useState('');
  const [pkgFilter, setPkgFilter] = useState('');
  const [minCvss, setMinCvss] = useState(0);
  const [minCvssInput, setMinCvssInput] = useState('');
  const [hasFix, setHasFix] = useState(false);
  const [sortBy, setSortBy] = useState<VulnerabilitySortKey>('severity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [historyResponseKey, setHistoryResponseKey] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [fetchedSelectedScan, setFetchedSelectedScan] = useState<{ scanId: string; scan: StatusPageScanSummary | null }>({ scanId: '', scan: null });
  const [vulnerabilityState, setVulnerabilityState] = useState<{
    requestKey: string;
    data: Vulnerability[];
    total: number;
    error: string;
  }>({ requestKey: '', data: [], total: 0, error: '' });
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);
  const vulnerabilityDetailsModal = useOverlayState();
  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const historyRequestKey = item?.latest_scan_id ? `${slug}:${item.latest_scan_id}` : '';
  const historyLoading = Boolean(historyRequestKey) && historyResponseKey !== historyRequestKey;
  const historyMatch = useMemo(
    () => history.find((scan) => scan.scan_id === selectedScanId) ?? null,
    [history, selectedScanId],
  );
  const selectedScan = historyMatch ?? (fetchedSelectedScan.scanId === selectedScanId ? fetchedSelectedScan.scan : null);
  const vulnerabilityRequestKey = selectedScanId
    ? [slug, selectedScanId, page, severityFilter, pkgFilter, hasFix ? '1' : '0', String(minCvss), sortBy, sortDir].join('|')
    : '';
  const loading = Boolean(vulnerabilityRequestKey) && vulnerabilityState.requestKey !== vulnerabilityRequestKey;
  const vulns = vulnerabilityState.requestKey === vulnerabilityRequestKey ? vulnerabilityState.data : [];
  const vulnTotal = vulnerabilityState.requestKey === vulnerabilityRequestKey ? vulnerabilityState.total : 0;
  const error = vulnerabilityState.requestKey === vulnerabilityRequestKey ? vulnerabilityState.error : '';

  const reportHref = (() => {
    if (!selectedScanId) return '';
    const params = new URLSearchParams({
      scanId: selectedScanId,
      sortBy,
      sortDir,
    });
    if (severityFilter) params.set('severity', severityFilter);
    if (pkgInput.trim()) params.set('pkg', pkgInput.trim());
    if (minCvss > 0) params.set('minCvss', String(minCvss));
    if (hasFix) params.set('hasFix', 'true');
    return `/status/${encodeURIComponent(slug)}/report?${params.toString()}`;
  })();

  useEffect(() => {
    if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    pkgDebounceRef.current = setTimeout(() => {
      setPkgFilter(pkgInput);
      setPage(1);
    }, 350);

    return () => {
      if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    };
  }, [pkgInput]);

  useEffect(() => {
    if (!item?.latest_scan_id) return;
    let cancelled = false;
    const requestKey = `${slug}:${item.latest_scan_id}`;

    Promise.all([
      listStatusPageScanHistory(slug, item.latest_scan_id),
      getStatusPageTrackedScan(slug, item.latest_scan_id).catch(() => null),
    ])
      .then(([historyResponse, trackedScan]) => {
        if (cancelled) return;

        const scans = historyResponse.length > 0
          ? historyResponse
          : trackedScan
            ? [trackedScan]
            : [];

        setHistory(scans);
        setHistoryResponseKey(requestKey);
        setSelectedScanId((current) => (
          scans.find((scan) => scan.scan_id === current)?.scan_id
          ?? scans.find((scan) => scan.is_latest)?.scan_id
          ?? trackedScan?.scan_id
          ?? item.latest_scan_id
        ));
        setHistoryError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setHistory([]);
        setHistoryResponseKey(requestKey);
        setHistoryError(err instanceof Error ? err.message : 'Failed to load scan history');
      });

    return () => {
      cancelled = true;
    };
  }, [slug, item?.latest_scan_id]);

  useEffect(() => {
    if (!selectedScanId || historyMatch) return;

    let cancelled = false;
    getStatusPageTrackedScan(slug, selectedScanId)
      .then((scan) => {
        if (!cancelled) setFetchedSelectedScan({ scanId: selectedScanId, scan });
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchedSelectedScan({ scanId: selectedScanId, scan: null });
          setHistoryError(err instanceof Error ? err.message : 'Failed to load scan details');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug, selectedScanId, historyMatch]);

  useEffect(() => {
    if (!selectedScanId) return;

    const requestKey = [slug, selectedScanId, page, severityFilter, pkgFilter, hasFix ? '1' : '0', String(minCvss), sortBy, sortDir].join('|');
    listStatusPageItemVulnerabilities(
      slug,
      selectedScanId,
      page,
      VULN_PAGE_SIZE,
      severityFilter || undefined,
      pkgFilter || undefined,
      hasFix || undefined,
      minCvss || undefined,
      sortBy,
      sortDir,
    )
      .then((result) => {
        setVulnerabilityState({
          requestKey,
          data: result.data ?? [],
          total: result.total ?? 0,
          error: '',
        });
      })
      .catch((err) => {
        setVulnerabilityState({
          requestKey,
          data: [],
          total: 0,
          error: err instanceof Error ? err.message : 'Failed to load vulnerabilities',
        });
      });
  }, [slug, selectedScanId, page, severityFilter, pkgFilter, hasFix, minCvss, sortBy, sortDir]);

  const effectiveScanStatus = selectedScan
    ? getEffectiveScanStatus(selectedScan.scan_status, selectedScan.external_status)
    : item
      ? getEffectiveScanStatus(item.scan_status, item.external_status)
      : 'pending';
  const displayedScan = selectedScan ?? item;
  const blockedPolicyDetails = useMemo(() => {
    if (effectiveScanStatus !== 'blocked_by_xray_policy') return null;
    return parseBlockedPolicyDetails(selectedScan?.error_message ?? item?.error_message ?? null);
  }, [effectiveScanStatus, item?.error_message, selectedScan?.error_message]);

  const totalPages = Math.max(1, Math.ceil(vulnTotal / VULN_PAGE_SIZE));

  function openVulnerabilityDetails(vulnerability: Vulnerability) {
    setSelectedVulnerability(vulnerability);
    vulnerabilityDetailsModal.open();
  }

  function closeVulnerabilityDetails() {
    vulnerabilityDetailsModal.close();
    setSelectedVulnerability(null);
  }

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="lg" placement="center">
          <Modal.Dialog className="glass-modal overflow-hidden rounded-[28px] w-[min(1120px,calc(100vw-1.5rem))] max-w-none">
            <Modal.Body className="px-0 py-0">
              <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Vulnerability drill-down</p>
                    <div>
                      <h3 className="font-mono text-base font-semibold sm:text-lg" style={{ color: 'var(--text-primary)' }}>
                        {item ? item.image_name : 'Loading item'}
                      </h3>
                      {item && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <TagBadge tag={item.image_tag} accent={effectiveScanStatus === 'blocked_by_xray_policy' ? STATUS_COLOR.blocked_by_xray_policy : undefined} />
                          {selectedScan?.is_latest === false && (
                            <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                              style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                              Historical snapshot
                            </span>
                          )}
                        </div>
                      )}
                      {displayedScan && (
                        <p className="mt-1 text-[13px] leading-6 text-zinc-500">
                          Snapshot {timeAgo(displayedScan.observed_at)}. {vulnTotal.toLocaleString()} matching finding{vulnTotal === 1 ? '' : 's'}.
                        </p>
                      )}
                    </div>
                  </div>
                  {selectedScan ? (
                    <StatusBadge status={selectedScan.scan_status} externalStatus={selectedScan.external_status} />
                  ) : item ? (
                    <StatusDot status={getPresentationStatus(item)} />
                  ) : null}
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                {effectiveScanStatus === 'running' || effectiveScanStatus === 'pending' || selectedScan?.scan_status === 'running' || selectedScan?.scan_status === 'pending' ? (
                  <RunningScanVisualization
                    provider={selectedScan?.scan_provider ?? item?.scan_provider}
                    currentStep={selectedScan?.current_step ?? item?.current_step}
                    status={selectedScan?.scan_status ?? item?.scan_status ?? 'pending'}
                    externalStatus={selectedScan?.external_status ?? item?.external_status}
                    startedAt={selectedScan?.started_at ?? item?.started_at}
                  />
                ) : null}

                {blockedPolicyDetails && (
                  <div className="rounded-3xl border px-4 py-4" style={{ borderColor: 'rgba(245,158,11,0.24)', background: 'rgba(245,158,11,0.08)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: '#b45309' }}>Xray policy violation</p>
                      <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: 'rgba(245,158,11,0.24)', color: '#b45309' }}>
                        Findings may still be available below
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-primary)' }}>{blockedPolicyDetails.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {blockedPolicyDetails.totalViolations && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={getTintedChipStyle('#f59e0b', '#b45309')}>
                          {blockedPolicyDetails.totalViolations} violations
                        </span>
                      )}
                      {blockedPolicyDetails.blockingPolicies && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px]" style={getTintedChipStyle('#f59e0b', 'var(--text-secondary)')}>
                          {countDelimitedValues(blockedPolicyDetails.blockingPolicies)} blocking policies
                        </span>
                      )}
                      {blockedPolicyDetails.matchedWatches && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px]" style={getTintedChipStyle('#f59e0b', 'var(--text-secondary)')}>
                          {countDelimitedValues(blockedPolicyDetails.matchedWatches)} watches
                        </span>
                      )}
                      {blockedPolicyDetails.matchedIssues && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px]" style={getTintedChipStyle('#f59e0b', 'var(--text-secondary)')}>
                          {countDelimitedValues(blockedPolicyDetails.matchedIssues)} matched issues
                        </span>
                      )}
                    </div>
                    <details className="mt-3 group">
                      <summary className="cursor-pointer list-none text-[12px] font-semibold" style={{ color: '#b45309' }}>
                        Show Xray details
                      </summary>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {blockedPolicyDetails.blockingPolicies && <div className="text-[12px] leading-5"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Blocking policies:</span> <span style={{ color: 'var(--text-secondary)' }}>{compactDelimitedValues(blockedPolicyDetails.blockingPolicies, 3)}</span></div>}
                        {blockedPolicyDetails.matchedPolicies && <div className="text-[12px] leading-5"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Matched policies:</span> <span style={{ color: 'var(--text-secondary)' }}>{compactDelimitedValues(blockedPolicyDetails.matchedPolicies, 3)}</span></div>}
                        {blockedPolicyDetails.matchedWatches && <div className="text-[12px] leading-5"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Matched watches:</span> <span style={{ color: 'var(--text-secondary)' }}>{compactDelimitedValues(blockedPolicyDetails.matchedWatches, 3)}</span></div>}
                        {blockedPolicyDetails.matchedIssues && <div className="text-[12px] leading-5"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Matched issues:</span> <span style={{ color: 'var(--text-secondary)' }}>{compactDelimitedValues(blockedPolicyDetails.matchedIssues, 3)}</span></div>}
                        {blockedPolicyDetails.artifact && <div className="text-[12px] leading-5"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Artifact:</span> <span className="break-all" style={{ color: 'var(--text-secondary)' }}>{blockedPolicyDetails.artifact}</span></div>}
                        {blockedPolicyDetails.manifest && <div className="text-[12px] leading-5"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Manifest:</span> <span className="break-all" style={{ color: 'var(--text-secondary)' }}>{blockedPolicyDetails.manifest}</span></div>}
                        {blockedPolicyDetails.jfrog && <div className="text-[12px] leading-5 sm:col-span-2"><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>JFrog:</span> <span className="break-all" style={{ color: 'var(--text-secondary)' }}>{blockedPolicyDetails.jfrog}</span></div>}
                      </div>
                    </details>
                    <div className="mt-3 border-t pt-3 text-[12px]" style={{ borderColor: 'rgba(245,158,11,0.16)', color: 'var(--text-secondary)' }}>
                      Select a previous scan if you want to compare how the policy block and findings changed across snapshots.
                    </div>
                  </div>
                )}

                {historyError && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500 dark:text-red-400">
                    {historyError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3"
                  style={{ borderColor: 'var(--status-card-border)', background: 'var(--status-card-bg)' }}>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Snapshot controls</p>
                    <p className="mt-1 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                      Latest scan is selected by default. Switch snapshots here, then open the print report if you want a shareable export of the current filter state.
                    </p>
                  </div>
                  {reportHref ? (
                    <Link
                      href={reportHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full px-4 py-2 text-sm font-semibold transition-colors"
                      style={{ background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(167,139,250,0.25)', color: '#7c3aed' }}
                    >
                      Open print report
                    </Link>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    selectedKey={selectedScanId || undefined}
                    onSelectionChange={(key) => {
                      const value = String(key ?? '');
                      setSelectedScanId(value);
                      setPage(1);
                    }}
                    className="w-full min-w-[220px] sm:w-auto"
                    aria-label="Select scan snapshot"
                    isDisabled={historyLoading || history.length === 0}
                  >
                    <Select.Trigger className={STATUS_SELECT_TRIGGER_CLS}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {history.map((scan) => (
                          <ListBox.Item id={scan.scan_id} key={scan.scan_id} textValue={formatScanHistoryOptionLabel(scan)}>
                            <div className="flex flex-col gap-1">
                              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{scan.is_latest ? 'Latest scan' : 'Previous scan'}</span>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatScanHistoryOptionLabel(scan)}</span>
                            </div>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  <Select selectedKey={severityFilter || '__all__'} onSelectionChange={key => { setSeverityFilter(String(key === '__all__' ? '' : key)); setPage(1); }} className="w-full min-w-[180px] sm:w-auto" aria-label="Filter vulnerabilities by severity">
                    <Select.Trigger className={STATUS_SELECT_TRIGGER_CLS}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {VULN_SEVERITY_OPTIONS.map(option => (
                          <ListBox.Item id={option.key} key={option.key} textValue={option.label}>
                            {option.label}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  <input
                    type="text"
                    value={pkgInput}
                    onChange={event => { setPkgInput(event.target.value); }}
                    placeholder="Package name"
                    aria-label="Filter vulnerabilities by package name"
                    className={`${STATUS_INPUT_CLS} min-w-[180px] flex-1`}
                    style={{ color: 'var(--text-primary)' }}
                  />

                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={minCvssInput}
                    onChange={event => {
                      setMinCvssInput(event.target.value);
                      const value = parseFloat(event.target.value);
                      setMinCvss(Number.isNaN(value) ? 0 : value);
                      setPage(1);
                    }}
                    placeholder="Min CVSS"
                    aria-label="Filter vulnerabilities by minimum CVSS score"
                    className={`${STATUS_INPUT_CLS} w-[120px]`}
                    style={{ color: 'var(--text-primary)' }}
                  />

                  <Button size="sm" variant={hasFix ? 'primary' : 'secondary'} onPress={() => { setHasFix(value => !value); setPage(1); }} className="rounded-full px-4 text-sm font-medium">
                    Has Fix
                  </Button>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div className="overflow-hidden rounded-3xl" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[840px] text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                          {([
                            { label: 'CVE ID', key: 'vuln_id' },
                            { label: 'Package', key: 'pkg_name' },
                            { label: 'Installed', key: 'installed_version' },
                            { label: 'Fixed In', key: 'fixed_version' },
                            { label: 'Severity', key: 'severity' },
                            { label: 'CVSS', key: 'cvss_score' },
                          ] as { label: string; key: VulnerabilitySortKey }[]).map(({ label, key }) => {
                            const active = sortBy === key;
                            return (
                              <th key={key} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (active) {
                                      setSortDir(current => current === 'asc' ? 'desc' : 'asc');
                                    } else {
                                      setSortBy(key);
                                      setSortDir('asc');
                                    }
                                    setPage(1);
                                  }}
                                  className="inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
                                  style={{ color: active ? '#7c3aed' : 'var(--text-faint)' }}
                                  aria-label={`Sort vulnerabilities by ${label}`}
                                >
                                  <span>{label}</span>
                                  {active && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                                </button>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <tr>
                            <td colSpan={6} className="py-12 text-center">
                              <div className="flex justify-center">
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500" />
                              </div>
                            </td>
                          </tr>
                        ) : vulns.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-12 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                              {vulnTotal === 0
                                ? blockedPolicyDetails
                                  ? 'Xray blocked this snapshot with policy violations, but no vulnerability records were returned for this scan.'
                                  : 'No vulnerabilities found for this image tag.'
                                : 'No results match your filters.'}
                            </td>
                          </tr>
                        ) : vulns.map((vuln, index) => (
                          <tr
                            key={vuln.id}
                            style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                            onMouseEnter={event => (event.currentTarget.style.background = 'var(--row-hover)')}
                            onMouseLeave={event => (event.currentTarget.style.background = 'transparent')}
                          >
                            <td className="px-4 py-3 align-top">
                              {vuln.vuln_id ? (
                                <div className="flex flex-col gap-1.5">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openVulnerabilityDetails(vuln)}
                                      className="font-mono text-xs text-violet-600 transition-colors hover:underline dark:text-violet-400"
                                    >
                                      {vuln.vuln_id}
                                    </button>
                                    <SourceBadge source={vuln.data_source} />
                                  </div>
                                  {vuln.title && (
                                    <p className="max-w-[280px] text-xs leading-5 text-zinc-500">{vuln.title}</p>
                                  )}
                                </div>
                              ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs align-top" style={{ color: 'var(--text-secondary)' }}>{vuln.pkg_name}</td>
                            <td className="px-4 py-3 font-mono text-xs align-top" style={{ color: 'var(--text-muted)' }}>{vuln.installed_version || '—'}</td>
                            <td className="px-4 py-3 font-mono text-xs align-top text-emerald-600 dark:text-emerald-500">
                              {vuln.fixed_version || <span style={{ color: 'var(--text-faint)' }}>—</span>}
                            </td>
                            <td className="px-4 py-3 align-top"><SeverityBadge severity={vuln.severity} /></td>
                            <td className="px-4 py-3 font-mono text-xs align-top" style={{ color: 'var(--text-muted)' }}>
                              {vuln.cvss_score ? vuln.cvss_score.toFixed(1) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Modal.Body>

            <Modal.Footer className="flex items-center justify-between gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{vulnTotal.toLocaleString()} total findings</span>
              <div className="flex items-center gap-2">
                {reportHref && (
                  <Button size="sm" variant="primary" onPress={() => window.open(reportHref, '_blank', 'noopener,noreferrer')} className="rounded-full px-4">
                    Generate report
                  </Button>
                )}
                <Button size="sm" variant="secondary" isDisabled={page <= 1} onPress={() => { setPage(current => Math.max(1, current - 1)); }} className="rounded-full px-4">
                  Prev
                </Button>
                <span className="px-2 text-sm" style={{ color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
                <Button size="sm" variant="secondary" isDisabled={page >= totalPages} onPress={() => { setPage(current => Math.min(totalPages, current + 1)); }} className="rounded-full px-4">
                  Next
                </Button>
                <Button size="sm" variant="secondary" onPress={onClose} className="rounded-full px-4">
                  Close
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <VulnerabilityDetailsModal
        vulnerability={selectedVulnerability}
        state={vulnerabilityDetailsModal}
        onClose={closeVulnerabilityDetails}
        loadContextAnalysis={selectedScanId
          ? (vulnerability) => getStatusPageItemVulnerabilityContextAnalysis(slug, selectedScanId, vulnerability.id)
          : undefined}
      />
    </Modal>
  );
}

function ItemCard({
  item,
  index,
  layout,
  onOpen,
}: {
  item: StatusPageItem;
  index: number;
  layout: LayoutKey;
  onOpen: (item: StatusPageItem) => void;
}) {
  const effectiveScanStatus = getEffectiveScanStatus(item.scan_status, item.external_status);
  const cardStatus = getPresentationStatus(item);
  const color = STATUS_COLOR[cardStatus] ?? STATUS_COLOR.pending;
  const totalFindings = getFindingTotal(item);
  const blockedPolicyDetails = cardStatus === 'blocked_by_xray_policy' ? parseBlockedPolicyDetails(item.error_message) : null;
  const itemNote = buildItemNote(item, blockedPolicyDetails);
  const isRunning = ACTIVE_SCAN_STATUSES.has(effectiveScanStatus);
  const isCompact = layout === 'compact';
  const isDense = layout === 'compact' || layout === 'grid';
  const isGrid = layout === 'grid';
  const severityStats = [
    { label: 'Critical', value: item.critical_count, delta: item.delta_critical_count, color: SEV.critical },
    { label: 'High', value: item.high_count, delta: item.delta_high_count, color: SEV.high },
    { label: 'Medium', value: item.medium_count, delta: item.delta_medium_count, color: SEV.medium },
    { label: 'Low', value: item.low_count, delta: item.delta_low_count, color: SEV.low },
  ].filter(metric => metric.value > 0);
  const canOpen = Boolean(item.latest_scan_id);
  const content = (
    <>
      <div className="absolute inset-y-0 left-0 w-1 rounded-full" style={{ background: color }} />

      <div className={`${isDense ? 'px-4 py-4 md:px-5 md:py-5 space-y-3' : 'px-5 py-5 md:px-6 md:py-6 space-y-4'}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusDot status={cardStatus} />
              <span className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                Freshness {item.freshness_hours}h
              </span>
              <span className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{
                  color: totalFindings > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: totalFindings > 0 ? 'rgba(239,68,68,0.08)' : 'var(--status-pill-bg)',
                  border: totalFindings > 0 ? '1px solid rgba(239,68,68,0.16)' : '1px solid var(--status-pill-border)',
                }}>
                {totalFindings > 0 ? `${totalFindings.toLocaleString()} findings` : 'No active findings'}
              </span>
            </div>
            <p className={`font-mono font-medium break-all leading-relaxed ${isDense ? 'text-[14px]' : 'text-[15px] sm:text-base'}`} style={{ color: 'var(--text-primary)' }}>
              {item.image_name}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <TagBadge tag={item.image_tag} accent={color} />
              {item.previous_scan_id && (
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                  {item.previous_scan_at ? 'Has previous snapshot' : 'Snapshot tracked'}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-500">
              <span>Observed {timeAgo(item.observed_at)}</span>
              <span>·</span>
              <span className="capitalize">Scan {formatStatusLabel(effectiveScanStatus)}</span>
              {item.previous_scan_at && (
                <>
                  <span>·</span>
                  <span>Prev {timeAgo(item.previous_scan_at)}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {isRunning && !isCompact && (
          <RunningScanVisualization
            provider={item.scan_provider}
            currentStep={item.current_step}
            status={item.scan_status}
            externalStatus={item.external_status}
            startedAt={item.started_at}
            compact
          />
        )}

        {!isCompact && <SeverityBar item={item} />}

        {isCompact ? (
          <div className="flex flex-wrap items-center gap-2">
            {severityStats.length > 0 ? severityStats.map(metric => (
              <span
                key={metric.label}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  color: metric.color,
                  background: 'var(--status-pill-bg)',
                  border: '1px solid var(--status-pill-border)',
                }}
              >
                {metric.label} {metric.value}
              </span>
            )) : (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                No active findings
              </span>
            )}
          </div>
        ) : isDense ? (
          <div className="flex flex-wrap gap-2">
            {severityStats.length > 0 ? severityStats.map(metric => (
              <span
                key={metric.label}
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  color: metric.color,
                  background: 'var(--status-pill-bg)',
                  border: '1px solid var(--status-pill-border)',
                }}
              >
                {metric.label} {metric.value}
                {metric.delta ? ` (${metric.delta > 0 ? `+${metric.delta}` : metric.delta})` : ''}
              </span>
            )) : (
              <div className="rounded-2xl px-3 py-2 text-[12px] leading-5"
                style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)', color: 'var(--text-secondary)' }}>
                No active findings in the latest completed scan.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {severityStats.length > 0 ? severityStats.map(metric => (
              <SeverityStat
                key={metric.label}
                label={metric.label}
                value={metric.value}
                delta={metric.delta}
                color={metric.color}
              />
            )) : (
              <div className="rounded-2xl px-4 py-3 text-[13px] leading-6"
                style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)', color: 'var(--text-secondary)' }}>
                No active findings. This tag is currently clear in the latest completed scan.
              </div>
            )}
          </div>
        )}

        {isCompact ? (
          <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: blockedPolicyDetails ? 'rgba(245,158,11,0.22)' : item.error_message ? 'rgba(239,68,68,0.2)' : 'var(--status-card-border)', background: blockedPolicyDetails ? 'rgba(245,158,11,0.08)' : item.error_message ? 'rgba(239,68,68,0.05)' : 'var(--status-card-bg)' }}>
            <p className="text-[12px] leading-5" style={{ color: blockedPolicyDetails ? 'var(--text-primary)' : item.error_message ? 'var(--text-secondary)' : 'var(--text-secondary)' }}>
              {itemNote}
            </p>
          </div>
        ) : blockedPolicyDetails ? (
          <div className={`rounded-xl border ${isDense ? 'px-3 py-2.5' : 'px-4 py-3'}`} style={{ borderColor: 'rgba(245,158,11,0.22)', background: 'rgba(245,158,11,0.08)' }}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: '#b45309' }}>Xray policy violation</p>
            <p className={`leading-6 ${isDense ? 'text-[12px]' : 'text-[13px]'}`} style={{ color: 'var(--text-primary)' }}>{blockedPolicyDetails.summary}</p>
            {blockedPolicyDetails.blockingPolicies && !isGrid && (
              <p className="mt-2 text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                Blocking policies: {isDense ? compactDelimitedValues(blockedPolicyDetails.blockingPolicies, 2) : blockedPolicyDetails.blockingPolicies}
              </p>
            )}
            {blockedPolicyDetails.totalViolations && isDense && (
              <p className="mt-2 text-[11px] font-semibold" style={{ color: '#b45309' }}>
                {blockedPolicyDetails.totalViolations} violations detected
              </p>
            )}
          </div>
        ) : item.error_message ? (
          <div className={`rounded-xl border border-red-500/20 bg-red-500/5 ${isDense ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-500 dark:text-red-400">Scan Error</p>
            {isDense ? (
              <p className="line-clamp-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-red-700/80 dark:text-red-300/80">
                {item.error_message}
              </p>
            ) : (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-red-700/80 dark:text-red-300/80">
                {item.error_message}
              </pre>
            )}
          </div>
        ) : null}

        {canOpen && (
          <div className={`flex items-center justify-between border-t text-[12px] ${isDense ? 'pt-2' : 'pt-3'}`} style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
            <span>{isCompact ? 'Open scan details.' : isDense ? 'Open details and previous scans.' : 'Open image details to inspect CVEs, Xray policy violations, and previous scans.'}</span>
            <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Open</span>
          </div>
        )}
      </div>
    </>
  );

  if (canOpen) {
    return (
      <button
        type="button"
        className={`status-item-enter status-card relative w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 ${isDense ? 'rounded-2xl' : 'rounded-3xl'}`}
        style={{
          background: 'var(--status-card-bg)',
          border: '1px solid var(--status-card-border)',
          animationDelay: `${index * 60}ms`,
          cursor: 'pointer',
        }}
        aria-label={`Open details for ${item.image_name}:${item.image_tag}`}
        onClick={() => onOpen(item)}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`status-item-enter status-card relative overflow-hidden ${isDense ? 'rounded-2xl' : 'rounded-3xl'}`}
      style={{
        background: 'var(--status-card-bg)',
        border: '1px solid var(--status-card-border)',
        animationDelay: `${index * 60}ms`,
      }}
    >
      {content}
    </div>
  );
}

function RefreshBar({ lastLoadedAt }: { lastLoadedAt: number | null }) {
  const now = useTicker(1000);
  const { progress } = getRefreshCadence(lastLoadedAt, now);

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[2px]" style={{ background: 'var(--status-bar-track)' }}>
      <div
        className="h-full transition-all duration-1000 ease-linear"
        style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }}
      />
    </div>
  );
}

function SnapshotStatusChips({ snapshotAt, lastLoadedAt, refreshing }: { snapshotAt: string; lastLoadedAt: number | null; refreshing: boolean }) {
  useTicker(30000);
  const refreshClock = useTicker(1000);
  const { secondsRemaining } = getRefreshCadence(lastLoadedAt, refreshClock);

  return (
    <>
      <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        Snapshot {timeAgo(snapshotAt)}
      </span>
      <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
        <span className={`h-2.5 w-2.5 rounded-full ${refreshing ? 'animate-pulse' : ''}`} style={{ background: refreshing ? STATUS_COLOR.running : STATUS_COLOR.healthy }} />
        {refreshing ? 'Refreshing now' : `Auto refresh in ${secondsRemaining}s`}
      </span>
    </>
  );
}

function RefreshCadenceCard({ lastLoadedAt }: { lastLoadedAt: number | null }) {
  const now = useTicker(1000);
  const { progress, secondsRemaining } = getRefreshCadence(lastLoadedAt, now);

  return (
    <div className="rounded-[28px] px-5 py-4" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
      <div className="flex items-center justify-between text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        <span>Snapshot cadence</span>
        <span className="tabular-nums">{secondsRemaining}s</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--status-bar-track)' }}>
        <div className="h-full transition-all duration-1000 ease-linear" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }} />
      </div>
      <p className="mt-3 text-[13px] leading-6 text-zinc-500">
        The page keeps the current snapshot stable while polling in the background, so changes appear without wiping the current view.
      </p>
    </div>
  );
}

function StatusTable({ items, onOpen }: { items: StatusPageItem[]; onOpen: (item: StatusPageItem) => void }) {
  return (
    <div className="overflow-hidden rounded-[28px]" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
              {['Image', 'Tag', 'Status', 'Findings', 'Snapshot', 'Details', ''].map((label) => (
                <th
                  key={label || 'open'}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: 'var(--text-faint)' }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const cardStatus = getPresentationStatus(item);
              const blockedPolicyDetails = cardStatus === 'blocked_by_xray_policy' ? parseBlockedPolicyDetails(item.error_message) : null;
              const totalFindings = getFindingTotal(item);
              return (
                <tr
                  key={`${item.image_name}:${item.image_tag}`}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={event => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={event => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="max-w-[360px] space-y-1">
                      <button
                        type="button"
                        className="font-mono text-[13px] leading-5 break-all text-left transition-colors hover:text-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
                        style={{ color: 'var(--text-primary)' }}
                        aria-label={`Open details for ${item.image_name}:${item.image_tag}`}
                        onClick={() => onOpen(item)}
                      >
                        {item.image_name}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <TagBadge tag={item.image_tag} accent={STATUS_COLOR[cardStatus]} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <StatusDot status={cardStatus} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1">
                      <p className="text-[13px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{totalFindings.toLocaleString()}</p>
                      <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{buildItemNote(item, blockedPolicyDetails)}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="space-y-1 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                      <p>Observed {timeAgo(item.observed_at)}</p>
                      <p>Freshness {item.freshness_hours}h</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="max-w-[260px] text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                      {blockedPolicyDetails ? blockedPolicyDetails.summary : item.error_message ? compactErrorSummary(item.error_message) : 'View scan history, findings, and Xray details.'}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <button
                      type="button"
                      className="rounded-full px-3 py-1.5 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
                      style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}
                      onClick={() => onOpen(item)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<StatusPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortBy, setSortBy] = useState<SortKey>('worst');
  const [layout, setLayout] = useState<LayoutKey>('compact');
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [activeItem, setActiveItem] = useState<StatusPageItem | null>(null);
  const mountedRef = useRef(true);
  const vulnerabilityModal = useOverlayState();

  function openItemDetails(item: StatusPageItem) {
    setActiveItem(item);
    vulnerabilityModal.open();
  }

  function closeItemDetails() {
    vulnerabilityModal.close();
  }

  const load = useCallback(async (showLoader: boolean) => {
    if (showLoader) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const result = await getStatusPageBySlug(slug);
      if (!mountedRef.current) return;
      setData(result);
      setError('');
      setNeedsAuth(false);
      setLastLoadedAt(Date.now());
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError && err.status === 401) {
        setNeedsAuth(true);
        setError('This status page requires authentication.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load status page');
      }
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STATUS_LAYOUT_STORAGE_KEY);
    const storedFilter = window.localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    const storedSort = window.localStorage.getItem(STATUS_SORT_STORAGE_KEY);
    if (stored === 'detailed' || stored === 'compact' || stored === 'grid' || stored === 'table') {
      setLayout(stored);
    }
    if (storedFilter === 'all' || storedFilter === 'failed' || storedFilter === 'blocked_by_xray_policy' || storedFilter === 'running' || storedFilter === 'degraded' || storedFilter === 'stale' || storedFilter === 'healthy') {
      setFilter(storedFilter);
    }
    if (storedSort === 'display' || storedSort === 'worst' || storedSort === 'stale' || storedSort === 'latest') {
      setSortBy(storedSort);
    }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !preferencesReady) return;
    window.localStorage.setItem(STATUS_LAYOUT_STORAGE_KEY, layout);
    window.localStorage.setItem(STATUS_FILTER_STORAGE_KEY, filter);
    window.localStorage.setItem(STATUS_SORT_STORAGE_KEY, sortBy);
  }, [filter, layout, preferencesReady, sortBy]);

  useEffect(() => {
    void load(true);
    const interval = setInterval(() => {
      void load(false);
    }, AUTO_REFRESH_MS);

    return () => clearInterval(interval);
  }, [load]);

  const summary = useMemo(() => {
    const items = data?.items ?? [];
    return items.reduce(
      (acc, item) => {
        const status = getPresentationStatus(item);
        acc.total += 1;
        acc.attention += status === 'healthy' ? 0 : 1;
        acc.critical += item.critical_count;
        acc.high += item.high_count;
        acc.medium += item.medium_count;
        acc.low += item.low_count;
        acc.findings += getFindingTotal(item);
        acc.stale += status === 'stale' ? 1 : 0;
        acc.statuses[status] = (acc.statuses[status] ?? 0) + 1;
        return acc;
      },
      {
        total: 0,
        attention: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        findings: 0,
        stale: 0,
        statuses: {} as Record<string, number>,
      },
    );
  }, [data]);

  const donutData = useMemo(
    () => Object.entries(summary.statuses)
      .sort(([left], [right]) => getStatusRank(left) - getStatusRank(right))
      .map(([status, count]) => ({
        label: status,
        value: count,
        color: STATUS_COLOR[status] ?? '#52525b',
      })),
    [summary.statuses],
  );

  const filterCounts = useMemo(
    () => ({
      all: data?.items.length ?? 0,
      failed: data?.items.filter(item => getPresentationStatus(item) === 'failed').length ?? 0,
      blocked_by_xray_policy: data?.items.filter(item => getPresentationStatus(item) === 'blocked_by_xray_policy').length ?? 0,
      running: data?.items.filter(item => ACTIVE_SCAN_STATUSES.has(getPresentationStatus(item))).length ?? 0,
      degraded: data?.items.filter(item => getPresentationStatus(item) === 'degraded').length ?? 0,
      stale: data?.items.filter(item => getPresentationStatus(item) === 'stale').length ?? 0,
      healthy: data?.items.filter(item => getPresentationStatus(item) === 'healthy').length ?? 0,
    }),
    [data],
  );

  const healthState = useMemo(() => {
    if (summary.statuses.failed) {
      return {
        title: 'Failures detected',
        description: `${summary.statuses.failed} image tag${summary.statuses.failed === 1 ? '' : 's'} currently need immediate attention.`,
        color: SEV.critical,
      };
    }
    if (summary.statuses.blocked_by_xray_policy) {
      return {
        title: 'Blocked by Xray policy',
        description: `${summary.statuses.blocked_by_xray_policy} tag${summary.statuses.blocked_by_xray_policy === 1 ? '' : 's'} were stopped by policy enforcement and should be reviewed.`,
        color: STATUS_COLOR.blocked_by_xray_policy,
      };
    }
    if (summary.statuses.degraded) {
      return {
        title: 'Degraded coverage',
        description: `${summary.statuses.degraded} tag${summary.statuses.degraded === 1 ? '' : 's'} have active findings but no current failures.`,
        color: SEV.high,
      };
    }
    if (summary.statuses.stale) {
      return {
        title: 'Freshness gap',
        description: `${summary.statuses.stale} tag${summary.statuses.stale === 1 ? '' : 's'} are stale and should be refreshed soon.`,
        color: SEV.medium,
      };
    }
    if (summary.statuses.running || summary.statuses.pending) {
      return {
        title: 'Scan activity in progress',
        description: 'The page is healthy overall, with live scans still in motion.',
        color: STATUS_COLOR.running,
      };
    }
    return {
      title: 'Everything looks healthy',
      description: 'All tracked tags are currently healthy in the latest snapshot.',
      color: STATUS_COLOR.healthy,
    };
  }, [summary]);

  const visibleItems = useMemo(() => {
    const items = [...(data?.items ?? [])];
    const filtered = filter === 'all'
      ? items
      : items.filter(item => {
        const presentationStatus = getPresentationStatus(item);

        if (filter === 'running') {
          return ACTIVE_SCAN_STATUSES.has(presentationStatus);
        }

        return presentationStatus === filter;
      });

    filtered.sort((left, right) => {
      if (sortBy === 'worst') {
        return compareItemsByPriority(left, right);
      }

      if (sortBy === 'stale') {
        return (
          right.freshness_hours - left.freshness_hours
          || getStatusRank(getPresentationStatus(left)) - getStatusRank(getPresentationStatus(right))
          || right.critical_count - left.critical_count
        );
      }

      if (sortBy === 'latest') {
        return (
          new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
          || getStatusRank(getPresentationStatus(left)) - getStatusRank(getPresentationStatus(right))
        );
      }

      return (
        left.display_order - right.display_order
        || left.image_name.localeCompare(right.image_name)
        || left.image_tag.localeCompare(right.image_tag)
      );
    });

    return filtered;
  }, [data, filter, sortBy]);

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center app-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
            <Logo size={18} className="text-white" />
          </div>
          <div className="w-6 h-6 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen app-bg flex items-center justify-center px-6">
        <div className="rounded-2xl p-8 max-w-md text-center space-y-4"
          style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
          <div className="w-11 h-11 rounded-2xl mx-auto flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
            <Logo size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {needsAuth ? 'Authentication Required' : 'Status Page Unavailable'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1.5">{error}</p>
          </div>
          {needsAuth && (
            <Link href={`/login?returnUrl=/status/${slug}`} className="inline-flex px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
              {getToken() ? 'Sign in again to continue' : 'Sign in to continue'}
            </Link>
          )}
        </div>
      </div>
    );
  }

  const activeUpdate = data.page.updates?.[0];
  const recentUpdates = data.page.updates?.slice(0, 3) ?? [];
  const openIssueCount = (summary.statuses.failed ?? 0) + (summary.statuses.blocked_by_xray_policy ?? 0) + (summary.statuses.degraded ?? 0) + (summary.statuses.stale ?? 0);
  const headlineTone = activeUpdate?.level === 'incident'
    ? { background: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.18)', accent: '#dc2626', label: 'Incident' }
    : activeUpdate?.level === 'maintenance'
      ? { background: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.18)', accent: '#b45309', label: 'Maintenance' }
      : openIssueCount > 0
        ? { background: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.18)', accent: '#c2410c', label: 'Attention' }
        : { background: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.18)', accent: '#15803d', label: 'Operational' };
  const headlineTitle = activeUpdate
    ? activeUpdate.title
    : openIssueCount > 0
      ? `${openIssueCount} tracked tag${openIssueCount === 1 ? '' : 's'} need attention`
      : 'All tracked tags operational';
  const headlineBody = activeUpdate?.body
    || (openIssueCount > 0
      ? healthState.description
      : filterCounts.running > 0
        ? `${filterCounts.running} scan${filterCounts.running === 1 ? '' : 's'} are still processing in the background, but no tracked tags are currently in a failed, blocked, degraded, or stale state.`
        : 'All tracked tags are healthy in the latest snapshot with no active incident, policy block, or freshness issue right now.');
  const compactRows = layout === 'compact' ? visibleItems : [];

  return (
    <div className="min-h-screen app-bg">
      <RefreshBar lastLoadedAt={lastLoadedAt} />
      <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
        <section className="space-y-4">
          <div
            className="rounded-[24px] px-5 py-4 sm:px-6"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--status-header-border)', boxShadow: 'var(--glass-shadow)' }}
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 space-y-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                    <Logo size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">JustScan status</p>
                    <h1 className="truncate text-xl font-semibold leading-tight sm:text-2xl" style={{ color: 'var(--text-primary)' }}>{data.page.name}</h1>
                  </div>
                  <span
                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
                    style={{ background: headlineTone.background, border: `1px solid ${headlineTone.border}`, color: headlineTone.accent }}
                  >
                    {headlineTone.label}
                  </span>
                </div>
                {data.page.description ? (
                  <p className="max-w-4xl text-[14px] leading-6 text-zinc-500 dark:text-zinc-300">{data.page.description}</p>
                ) : null}
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                    {summary.total} tracked tags
                  </span>
                  <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                    {openIssueCount > 0 ? `${openIssueCount} need attention` : 'No open incidents'}
                  </span>
                  <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                    {filterCounts.running} scanning
                  </span>
                  <span className="rounded-full px-3 py-1.5 capitalize" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                    {data.page.visibility}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end xl:pt-1">
                <SnapshotStatusChips snapshotAt={data.now} lastLoadedAt={lastLoadedAt} refreshing={refreshing} />
                <Button size="sm" isPending={refreshing} onPress={() => void load(false)} className="rounded-full px-4 text-sm font-semibold">
                  {refreshing ? 'Refreshing...' : 'Refresh now'}
                </Button>
              </div>
            </div>

            <details className="mt-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--status-card-border)', background: 'var(--status-card-bg)' }}>
              <summary className="cursor-pointer list-none text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Page details</summary>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                  Stale after {data.page.stale_after_hours}h
                </span>
              </div>
            </details>
          </div>

          <section
            className="rounded-[24px] border px-5 py-4 sm:px-6"
            style={{ background: headlineTone.background, borderColor: headlineTone.border }}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: headlineTone.accent }}>{headlineTone.label}</p>
                <h2 className="mt-1 text-lg font-semibold sm:text-xl" style={{ color: 'var(--text-primary)' }}>{headlineTitle}</h2>
                <p className="mt-2 max-w-4xl text-[14px] leading-6" style={{ color: 'var(--text-secondary)' }}>{headlineBody}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <span className="rounded-full px-3 py-1.5 text-[12px] font-semibold" style={getTintedChipStyle(headlineTone.accent)}>
                  {openIssueCount > 0 ? `${openIssueCount} affected` : 'No impact'}
                </span>
                <span className="rounded-full px-3 py-1.5 text-[12px] font-semibold" style={getTintedChipStyle(headlineTone.accent)}>
                  {filterCounts.running} scanning
                </span>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Components</h2>
              <p className="mt-1 text-[14px] leading-6 text-zinc-500">
                Compact rows are the default view. Problem states surface first, while detailed scan history and vulnerabilities stay inside the drill-down modal.
              </p>
            </div>

            <div className="rounded-[24px] border px-4 py-4 sm:px-5" style={{ background: 'var(--status-card-bg)', borderColor: 'var(--status-card-border)' }}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Controls</p>
                  <p className="mt-1 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                    Sorting and layout now live in one toolbar so the list controls read as a single unit.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[430px]">
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Sort</p>
                    <Select selectedKey={sortBy} onSelectionChange={key => setSortBy(String(key) as SortKey)} className="w-full" aria-label="Sort image tags">
                      <Select.Trigger className={STATUS_SELECT_TRIGGER_CLS}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {SORT_OPTIONS.map(option => (
                            <ListBox.Item id={option.key} key={option.key} textValue={option.label}>
                              {option.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Layout</p>
                    <Select selectedKey={layout} onSelectionChange={key => setLayout(String(key) as LayoutKey)} className="w-full" aria-label="Change status page layout">
                      <Select.Trigger className={STATUS_SELECT_TRIGGER_CLS}>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {LAYOUT_OPTIONS.map(option => (
                            <ListBox.Item id={option.key} key={option.key} textValue={option.label}>
                              {option.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {FILTERS.map(option => (
                  <FilterChip
                    key={option.key}
                    label={option.label}
                    count={filterCounts[option.key]}
                    active={filter === option.key}
                    onClick={() => setFilter(option.key)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Current view</p>
                <p className="mt-1 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                  {layout === 'compact'
                    ? 'Compact rows are active and recommended for public status browsing.'
                    : `Showing the ${LAYOUT_OPTIONS.find((option) => option.key === layout)?.label ?? layout} layout.`}
                </p>
              </div>
              <div className="rounded-full px-3 py-1.5 text-[12px] font-medium" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                {visibleItems.length} visible
              </div>
            </div>

            {visibleItems.length > 0 ? (
            layout === 'compact' ? (
              <div className="space-y-2">
                {compactRows.map((item) => (
                  <CompactStatusRow key={`${item.image_name}:${item.image_tag}`} item={item} onOpen={openItemDetails} />
                ))}
              </div>
            ) : layout === 'table' ? (
              <StatusTable items={visibleItems} onOpen={openItemDetails} />
            ) : (
              <div className={layout === 'grid' ? 'grid gap-3 md:grid-cols-2 2xl:grid-cols-3' : 'space-y-3'}>
                {visibleItems.map((item, index) => (
                  <ItemCard key={`${item.image_name}:${item.image_tag}`} item={item} index={index} layout={layout} onOpen={openItemDetails} />
                ))}
              </div>
            )
          ) : (
            <div className="rounded-[28px] px-6 py-12 text-center"
              style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No image tags match this view</p>
              <p className="mt-2 text-[14px] leading-6 text-zinc-500">
                Try a different filter or sort order to bring the relevant tags back into view.
              </p>
            </div>
          )}
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.95fr)]">
            <div className="rounded-[24px] px-5 py-4 sm:px-6" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Recent updates</p>
                  <h2 className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Incident and maintenance history</h2>
                </div>
                <span className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>{recentUpdates.length} shown</span>
              </div>
              <div className="mt-4 space-y-3">
                {recentUpdates.length > 0 ? recentUpdates.map((update, index) => {
                  const tone = update.level === 'incident'
                    ? { background: 'rgba(239,68,68,0.05)', border: 'rgba(239,68,68,0.16)', accent: '#dc2626' }
                    : update.level === 'maintenance'
                      ? { background: 'rgba(245,158,11,0.05)', border: 'rgba(245,158,11,0.16)', accent: '#b45309' }
                      : { background: 'rgba(59,130,246,0.05)', border: 'rgba(59,130,246,0.16)', accent: '#2563eb' };

                  return (
                    <div
                      key={`${update.title}:${update.created_at ?? index}`}
                      className="rounded-2xl px-4 py-3"
                      style={{ background: tone.background, border: `1px solid ${tone.border}` }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{update.title}</p>
                        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]" style={getTintedChipStyle(tone.accent)}>
                          {update.level}
                        </span>
                      </div>
                      <p className="mt-2 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>{update.body}</p>
                    </div>
                  );
                }) : (
                  <div className="rounded-2xl px-4 py-4" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No recent status posts</p>
                    <p className="mt-1 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                      This page currently has no published incident or maintenance updates.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[24px] px-5 py-4" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
                <div className="flex items-start gap-4">
                  <DonutChart data={donutData} />
                  <div className="min-w-0 space-y-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Overview</p>
                      <h2 className="mt-1 text-lg font-semibold" style={{ color: healthState.color }}>{healthState.title}</h2>
                      <p className="mt-1 text-[13px] leading-6 text-zinc-500">Secondary context for the current snapshot, kept below the main component list.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {donutData.map(segment => (
                        <span
                          key={segment.label}
                          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium capitalize"
                          style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: segment.color }} />
                          {formatStatusLabel(segment.label)}
                          <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{segment.value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <SignalStat label="Failures" value={summary.statuses.failed ?? 0} color={SEV.critical} />
                <SignalStat label="Blocked" value={summary.statuses.blocked_by_xray_policy ?? 0} color={STATUS_COLOR.blocked_by_xray_policy} />
                <SignalStat label="Degraded" value={summary.statuses.degraded ?? 0} color={SEV.high} />
                <SignalStat label="Stale" value={summary.statuses.stale ?? 0} color={SEV.medium} />
              </div>

              <RefreshCadenceCard lastLoadedAt={lastLoadedAt} />
            </div>
          </section>
        </section>
      </main>

      {activeItem && vulnerabilityModal.isOpen && (
        <StatusItemVulnerabilityModal
          key={`${activeItem.image_name}:${activeItem.image_tag}`}
          slug={slug}
          item={activeItem}
          state={vulnerabilityModal}
          onClose={closeItemDetails}
        />
      )}
    </div>
  );
}
