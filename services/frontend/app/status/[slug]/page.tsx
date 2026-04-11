'use client';

import { Logo } from '@/components/logo';
import { StatusBadge } from '@/components/ui/badges';
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
const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: { label: 'Critical', color: 'text-red-500 dark:text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  HIGH: { label: 'High', color: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  MEDIUM: { label: 'Medium', color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  LOW: { label: 'Low', color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  UNKNOWN: { label: 'Unknown', color: 'text-zinc-500', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20' },
};

type FilterKey = (typeof FILTERS)[number]['key'];
type SortKey = (typeof SORT_OPTIONS)[number]['key'];
type LayoutKey = (typeof LAYOUT_OPTIONS)[number]['key'];
type VulnerabilitySortKey = 'vuln_id' | 'pkg_name' | 'installed_version' | 'fixed_version' | 'severity' | 'cvss_score';

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEV_CONFIG[severity] ?? SEV_CONFIG.UNKNOWN;
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.color} ${cfg.border}`}>
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
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
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

function getStatusRank(status: string) {
  return STATUS_PRIORITY[status] ?? 99;
}

function getEffectiveScanStatus(status: string, externalStatus?: string) {
  if ((status === 'pending' || status === 'running') && externalStatus && externalStatus !== status) {
    return externalStatus;
  }
  if (status === 'failed' && externalStatus === 'blocked_by_xray_policy') {
    return externalStatus;
  }
  return status;
}

function formatStatusLabel(status: string) {
  const labels: Record<string, string> = {
    blocked_by_xray_policy: 'blocked by xray policy',
    waiting_for_xray: 'waiting for xray',
    warming_cache: 'warming cache',
    indexing_artifact: 'indexing artifact',
    queued_in_xray: 'queued in xray',
  };
  return labels[status] ?? status.replace(/_/g, ' ');
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

function SummaryCard({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  color?: string;
}) {
  return (
    <div className="status-card status-metric flex flex-col justify-between rounded-3xl px-5 py-4 gap-3"
      style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <span className="text-3xl font-semibold tabular-nums leading-none" style={{ color: color ?? 'var(--text-primary)' }}>
        {value}
      </span>
      <p className="text-[13px] leading-5 text-zinc-500">{detail}</p>
    </div>
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

function AttentionRow({
  item,
  onOpen,
}: {
  item: StatusPageItem;
  onOpen: (item: StatusPageItem) => void;
}) {
  const presentationStatus = getPresentationStatus(item);
  const accent = STATUS_COLOR[presentationStatus] ?? STATUS_COLOR.pending;
  const blockedPolicyDetails = presentationStatus === 'blocked_by_xray_policy' ? parseBlockedPolicyDetails(item.error_message) : null;
  const totalFindings = getFindingTotal(item);
  const note = buildItemNote(item, blockedPolicyDetails);
  const severityChips = [
    { label: 'Critical', value: item.critical_count, color: SEV.critical },
    { label: 'High', value: item.high_count, color: SEV.high },
    { label: 'Medium', value: item.medium_count, color: SEV.medium },
    { label: 'Low', value: item.low_count, color: SEV.low },
  ].filter((metric) => metric.value > 0);

  return (
    <div
      className="relative overflow-hidden rounded-[24px] px-4 py-4 md:px-5 cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
      style={{
        background: 'var(--status-card-bg)',
        border: `1px solid color-mix(in srgb, ${accent} 18%, var(--status-card-border))`,
      }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div className="absolute inset-y-0 left-0 w-1 rounded-full" style={{ background: accent }} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={presentationStatus} />
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums"
              style={{
                background: totalFindings > 0 ? 'rgba(239,68,68,0.08)' : 'var(--status-pill-bg)',
                border: totalFindings > 0 ? '1px solid rgba(239,68,68,0.16)' : '1px solid var(--status-pill-border)',
                color: totalFindings > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {totalFindings > 0 ? `${totalFindings.toLocaleString()} findings` : 'No active findings'}
            </span>
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Observed {timeAgo(item.observed_at)}</span>
          </div>

          <div className="space-y-2">
            <p className="font-mono text-[14px] leading-6 break-all sm:text-[15px]" style={{ color: 'var(--text-primary)' }}>{item.image_name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <TagBadge tag={item.image_tag} accent={accent} />
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}
              >
                Freshness {item.freshness_hours}h
              </span>
            </div>
          </div>

          <p className="text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>{note}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[280px] lg:justify-end">
          {severityChips.length > 0 ? severityChips.slice(0, 3).map((metric) => (
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
          )) : null}
          <span className="rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
            Inspect
          </span>
        </div>
      </div>
    </div>
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
                        <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: 'rgba(245,158,11,0.2)', color: '#b45309', background: 'rgba(255,255,255,0.5)' }}>
                          {blockedPolicyDetails.totalViolations} violations
                        </span>
                      )}
                      {blockedPolicyDetails.blockingPolicies && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: 'rgba(245,158,11,0.2)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.5)' }}>
                          {countDelimitedValues(blockedPolicyDetails.blockingPolicies)} blocking policies
                        </span>
                      )}
                      {blockedPolicyDetails.matchedWatches && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: 'rgba(245,158,11,0.2)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.5)' }}>
                          {countDelimitedValues(blockedPolicyDetails.matchedWatches)} watches
                        </span>
                      )}
                      {blockedPolicyDetails.matchedIssues && (
                        <span className="rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: 'rgba(245,158,11,0.2)', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.5)' }}>
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
                              <th
                                key={key}
                                onClick={() => {
                                  if (active) {
                                    setSortDir(current => current === 'asc' ? 'desc' : 'asc');
                                  } else {
                                    setSortBy(key);
                                    setSortDir('asc');
                                  }
                                  setPage(1);
                                }}
                                className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider"
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
  const isRunning = item.scan_status === 'running' || item.scan_status === 'pending';
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

  return (
    <div
      className={`status-item-enter status-card relative overflow-hidden ${isDense ? 'rounded-2xl' : 'rounded-3xl'}`}
      style={{
        background: 'var(--status-card-bg)',
        border: '1px solid var(--status-card-border)',
        animationDelay: `${index * 60}ms`,
        cursor: canOpen ? 'pointer' : 'default',
      }}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : -1}
      onClick={() => {
        if (canOpen) onOpen(item);
      }}
      onKeyDown={event => {
        if (!canOpen) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
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
    </div>
  );
}

function RefreshBar({ progress }: { progress: number }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-[2px]" style={{ background: 'var(--status-bar-track)' }}>
      <div
        className="h-full transition-all duration-1000 ease-linear"
        style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }}
      />
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
                  className="cursor-pointer"
                  onClick={() => onOpen(item)}
                  onMouseEnter={event => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={event => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="max-w-[360px] space-y-1">
                      <p className="font-mono text-[13px] leading-5 break-all" style={{ color: 'var(--text-primary)' }}>{item.image_name}</p>
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
                      className="rounded-full px-3 py-1.5 text-[12px] font-semibold"
                      style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(item);
                      }}
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
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortBy, setSortBy] = useState<SortKey>('display');
  const [layout, setLayout] = useState<LayoutKey>('detailed');
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
    mountedRef.current = true;
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
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

  useEffect(() => {
    if (!activeItem || !data) return;
    const refreshedItem = data.items.find((candidate) => (
      candidate.image_name === activeItem.image_name && candidate.image_tag === activeItem.image_tag
    ));
    if (refreshedItem) setActiveItem(refreshedItem);
  }, [activeItem, data]);

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

  const elapsedMs = lastLoadedAt ? Math.max(0, now - lastLoadedAt) : 0;
  const refreshProgress = Math.min(100, (elapsedMs / AUTO_REFRESH_MS) * 100);
  const secondsRemaining = Math.max(0, Math.ceil((AUTO_REFRESH_MS - Math.min(elapsedMs, AUTO_REFRESH_MS)) / 1000));

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
      running: data?.items.filter(item => {
        const status = getPresentationStatus(item);
        return status === 'running' || status === 'pending' || status === 'waiting_for_xray' || status === 'warming_cache' || status === 'indexing_artifact' || status === 'queued_in_xray';
      }).length ?? 0,
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
          return presentationStatus === 'running'
            || presentationStatus === 'pending'
            || presentationStatus === 'waiting_for_xray'
            || presentationStatus === 'warming_cache'
            || presentationStatus === 'indexing_artifact'
            || presentationStatus === 'queued_in_xray';
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
  const openIssueCount = (summary.statuses.failed ?? 0) + (summary.statuses.blocked_by_xray_policy ?? 0) + (summary.statuses.degraded ?? 0) + (summary.statuses.stale ?? 0);
  const incidentItems = [...data.items]
    .filter((item) => {
      const status = getPresentationStatus(item);
      return status === 'failed' || status === 'blocked_by_xray_policy' || status === 'degraded' || status === 'stale';
    })
    .sort(compareItemsByPriority);
  const incidentPreview = incidentItems.slice(0, 6);

  return (
    <div className="min-h-screen app-bg">
      <RefreshBar progress={refreshProgress} />
      <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
        <section className="space-y-5">
          <div
            className="rounded-[28px] px-5 py-4 sm:px-6"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--status-header-border)', boxShadow: 'var(--glass-shadow)' }}
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)' }}>
                    <Logo size={16} className="text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">JustScan status</p>
                    <h1 className="truncate text-xl font-semibold leading-tight sm:text-2xl" style={{ color: 'var(--text-primary)' }}>{data.page.name}</h1>
                  </div>
                  {activeUpdate ? (
                    <span
                      className="rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
                      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.16)', color: '#dc2626' }}
                    >
                      Active update
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Snapshot {timeAgo(data.now)}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                  <span className={`h-2.5 w-2.5 rounded-full ${refreshing ? 'animate-pulse' : ''}`} style={{ background: refreshing ? STATUS_COLOR.running : STATUS_COLOR.healthy }} />
                  {refreshing ? 'Refreshing now' : `Auto refresh in ${secondsRemaining}s`}
                </span>
                <Button size="sm" isPending={refreshing} onPress={() => void load(false)} className="rounded-full px-4 text-sm font-semibold">
                  {refreshing ? 'Refreshing...' : 'Refresh now'}
                </Button>
              </div>
            </div>

            <details className="mt-3 rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--status-card-border)', background: 'var(--status-card-bg)' }}>
              <summary className="cursor-pointer list-none text-[12px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Page details</summary>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className="rounded-full px-3 py-1.5 capitalize" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                  {data.page.visibility}
                </span>
                <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                  Stale after {data.page.stale_after_hours}h
                </span>
                <span className="rounded-full px-3 py-1.5" style={{ background: 'var(--status-pill-bg)', border: '1px solid var(--status-pill-border)', color: 'var(--text-secondary)' }}>
                  {openIssueCount > 0 ? `${openIssueCount} tags need attention` : 'No open incidents'}
                </span>
              </div>
            </details>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
            <div className="rounded-[30px] px-5 py-5 sm:px-6" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Current state</p>
              <h2 className="mt-3 text-2xl font-semibold sm:text-3xl" style={{ color: healthState.color }}>{healthState.title}</h2>
              <p className="mt-3 max-w-3xl text-[15px] leading-7" style={{ color: 'var(--text-secondary)' }}>{healthState.description}</p>
              {data.page.description ? (
                <p className="mt-3 max-w-3xl text-[14px] leading-6 text-zinc-500 dark:text-zinc-300">{data.page.description}</p>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                <SignalStat label="Failures" value={summary.statuses.failed ?? 0} color={SEV.critical} />
                <SignalStat label="Blocked" value={summary.statuses.blocked_by_xray_policy ?? 0} color={STATUS_COLOR.blocked_by_xray_policy} />
                <SignalStat label="Degraded" value={summary.statuses.degraded ?? 0} color={SEV.high} />
                <SignalStat label="Stale" value={summary.statuses.stale ?? 0} color={SEV.medium} />
                <SignalStat label="Scanning" value={filterCounts.running} color={STATUS_COLOR.running} />
              </div>
            </div>

            <div className="space-y-4">
              <div
                className={`rounded-[28px] px-5 py-4 ${
                  activeUpdate
                    ? activeUpdate.level === 'incident'
                      ? 'border-red-500/20 bg-red-500/5'
                      : activeUpdate.level === 'maintenance'
                        ? 'border-yellow-500/20 bg-yellow-500/5'
                        : 'border-blue-500/20 bg-blue-500/5'
                    : ''
                }`}
                style={activeUpdate ? undefined : { background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{activeUpdate ? 'Active update' : 'Incident channel'}</p>
                    <p className="mt-1 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {activeUpdate ? activeUpdate.title : 'No active incident or maintenance notice'}
                    </p>
                    <p className="mt-1.5 text-[14px] leading-6 text-zinc-500 dark:text-zinc-400">
                      {activeUpdate?.body || 'Nothing is currently pinned above the live snapshot. If something breaks, the update rail here becomes the primary announcement surface.'}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{activeUpdate?.level || 'clear'}</span>
                </div>
              </div>

              <div className="rounded-[28px] px-5 py-4" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
                <div className="flex items-center justify-between text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  <span>Snapshot cadence</span>
                  <span className="tabular-nums">{secondsRemaining}s</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: 'var(--status-bar-track)' }}>
                  <div className="h-full transition-all duration-1000 ease-linear" style={{ width: `${refreshProgress}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }} />
                </div>
                <p className="mt-3 text-[13px] leading-6 text-zinc-500">
                  The page keeps the current snapshot stable while polling in the background, so changes appear without wiping the current view.
                </p>
              </div>
            </div>
          </div>

          {incidentItems.length > 0 ? (
            <section className="space-y-3">
              <div>
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Affected tags right now</h2>
                <p className="mt-2 max-w-3xl text-[14px] leading-6 text-zinc-500">
                  These tags are shown first because they are failed, blocked by policy, degraded, or stale. This section answers the first question on the page: what currently needs attention.
                </p>
              </div>

              <div className="space-y-3">
                {incidentPreview.map((item) => (
                  <AttentionRow key={`${item.image_name}:${item.image_tag}`} item={item} onOpen={openItemDetails} />
                ))}
              </div>

              {incidentItems.length > incidentPreview.length ? (
                <p className="text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                  Showing {incidentPreview.length} of {incidentItems.length} affected tags. Use the full tracked-tag view below to review the remaining items.
                </p>
              ) : null}
            </section>
          ) : (
            <section className="rounded-[28px] px-5 py-5 sm:px-6" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Current incidents</p>
              <h2 className="mt-2 text-xl font-semibold" style={{ color: STATUS_COLOR.healthy }}>No current incidents</h2>
              <p className="mt-2 max-w-3xl text-[14px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                {filterCounts.running > 0
                  ? `All tracked tags are currently healthy. ${filterCounts.running} scan${filterCounts.running === 1 ? '' : 's'} are still running in the background.`
                  : 'All tracked tags are healthy in the latest snapshot, with no failures, degraded tags, policy blocks, or stale snapshots at the moment.'}
              </p>
            </section>
          )}

          <section className="space-y-4">
          <div className="space-y-4">
            <div>
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-zinc-500">All tracked tags</h2>
              <p className="mt-2 text-[14px] leading-6 text-zinc-500">
                After reviewing the current incident board above, use this section to browse the full tracked set. Detailed view remains the default because it keeps status, findings, and drill-down entry points in one place.
              </p>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
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

              <div className="flex w-full flex-col gap-3 xl:max-w-[380px] xl:items-end">
                <div className="flex w-full items-center gap-3 xl:justify-end">
                  <span className="text-sm text-zinc-500">Sort</span>
                  <Select selectedKey={sortBy} onSelectionChange={key => setSortBy(String(key) as SortKey)} className="w-full max-w-[240px]" aria-label="Sort image tags">
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

                <details className="w-full rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--status-card-border)', background: 'var(--status-card-bg)' }}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">View options</p>
                      <p className="mt-1 text-[13px] leading-6" style={{ color: 'var(--text-secondary)' }}>
                        {layout === 'detailed' ? 'Detailed view is active and recommended for triage.' : `Current layout: ${LAYOUT_OPTIONS.find((option) => option.key === layout)?.label ?? layout}.`}
                      </p>
                    </div>
                    <span className="text-sm text-zinc-500">Layout</span>
                  </summary>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="text-sm text-zinc-500">Layout</span>
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
                </details>
              </div>
            </div>
          </div>

          {visibleItems.length > 0 ? (
            layout === 'table' ? (
              <StatusTable items={visibleItems} onOpen={openItemDetails} />
            ) : (
              <div className={layout === 'grid' ? 'grid gap-3 md:grid-cols-2 2xl:grid-cols-3' : layout === 'compact' ? 'space-y-2' : 'space-y-3'}>
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

          <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.95fr)] xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.9fr)]">
            <div className="status-card rounded-[28px] px-5 py-5 sm:px-6" style={{ background: 'var(--status-card-bg)', border: '1px solid var(--status-card-border)' }}>
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-5">
                  <DonutChart data={donutData} />
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Status mix</p>
                      <h2 className="mt-1 text-2xl font-semibold" style={{ color: healthState.color }}>{healthState.title}</h2>
                      <p className="mt-2 max-w-xl text-[14px] leading-6 text-zinc-500">This aggregate view stays below the live triage area so users can review the overall mix without losing the immediate state of the page.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {donutData.map(segment => (
                        <span
                          key={segment.label}
                          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium capitalize"
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4 xl:grid-cols-2">
              <SummaryCard label="Tracked tags" value={summary.total} detail="Image tags currently included in this public status page." />
              <SummaryCard label="Open incidents" value={openIssueCount} detail="Tags that are failed, blocked, degraded, or stale in the latest snapshot." color={openIssueCount > 0 ? SEV.high : 'var(--text-primary)'} />
              <SummaryCard label="Critical findings" value={summary.critical.toLocaleString()} detail="Critical issues across all tracked tags in the latest snapshot." color={summary.critical > 0 ? SEV.critical : 'var(--text-faint)'} />
              <SummaryCard label="Scanning now" value={filterCounts.running} detail="Tags still processing or waiting on downstream scan work." color={filterCounts.running > 0 ? STATUS_COLOR.running : 'var(--text-faint)'} />
            </div>
          </section>
        </section>
      </main>

      {activeItem && vulnerabilityModal.isOpen && (
        <StatusItemVulnerabilityModal
          key={`${activeItem.image_name}:${activeItem.image_tag}:${activeItem.latest_scan_id}`}
          slug={slug}
          item={activeItem}
          state={vulnerabilityModal}
          onClose={closeItemDetails}
        />
      )}
    </div>
  );
}
