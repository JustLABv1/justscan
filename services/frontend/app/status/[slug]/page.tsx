'use client';

import { Logo } from '@/components/logo';
import {
  SeverityBadge,
  SourceBadge,
  StatusBadge,
  formatStatusLabel,
  resolveDisplayStatus,
} from '@/components/ui/badges';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type {
  StatusPageItem,
  StatusPageResponse,
  StatusPageScanSummary,
  Vulnerability,
} from '@/lib/api';
import {
  ApiError,
  getStatusPageBySlug,
  getStatusPageItemVulnerabilityContextAnalysis,
  getStatusPageTrackedScan,
  getToken,
  listStatusPageItemVulnerabilities,
  listStatusPageScanHistory,
} from '@/lib/api';
import type { BlockedPolicyDetailsView } from '@/lib/blocked-policy';
import {
  compactBlockedPolicyList,
  countBlockedPolicyList,
  formatIgnoreRuleStatusLabel,
  getBlockedPolicyDetails,
} from '@/lib/blocked-policy';
import { deferEffect } from '@/lib/defer-effect';
import { timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  ListBox,
  Modal,
  SearchField,
  Select,
  Spinner,
  Table,
  useOverlayState,
} from '@heroui/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AUTO_REFRESH_MS = 30000;
const VULN_PAGE_SIZE = 25;
const STATUS_SELECT_TRIGGER_CLS = 'surface-input min-h-11 rounded-full px-3 text-sm';
const STATUS_INPUT_CLS = 'surface-input min-h-11 rounded-xl px-3 text-sm outline-none';
const RECENT_SCAN_SEGMENTS = 14;
const STATUS_PRIORITY: Record<string, number> = {
  failed: 0,
  blocked_by_xray_policy: 1,
  stale: 2,
  waiting_for_xray: 3,
  warming_cache: 3,
  indexing_artifact: 3,
  queued_in_xray: 3,
  running: 4,
  pending: 5,
  healthy: 6,
  cancelled: 7,
};
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
  completed: '#22c55e',
  stale: '#eab308',
  failed: '#ef4444',
  blocked_by_xray_policy: '#f59e0b',
  pending: 'color-mix(in srgb, var(--accent) 78%, white)',
  running: '#60a5fa',
  cancelled: '#52525b',
  waiting_for_xray: '#f59e0b',
  warming_cache: '#fb923c',
  indexing_artifact: '#f97316',
  queued_in_xray: '#f59e0b',
};
const ACTIVE_SCAN_STATUSES = new Set([
  'running',
  'pending',
  'waiting_for_xray',
  'warming_cache',
  'indexing_artifact',
  'queued_in_xray',
]);

const EXPOSURE_PRIORITY: Record<string, number> = {
  high_risk: 0,
  findings_present: 1,
  unknown: 2,
  clear: 3,
};

const EXPOSURE_COLOR: Record<string, string> = {
  high_risk: '#f97316',
  findings_present: '#eab308',
  unknown: '#71717a',
  clear: '#22c55e',
};

type VulnerabilitySortKey =
  | 'vuln_id'
  | 'pkg_name'
  | 'installed_version'
  | 'fixed_version'
  | 'severity'
  | 'cvss_score';
type ExposureStatus = 'high_risk' | 'findings_present' | 'unknown' | 'clear';

function getStatusRank(status: string) {
  return STATUS_PRIORITY[status] ?? 99;
}

function getExposureRank(status: ExposureStatus) {
  return EXPOSURE_PRIORITY[status] ?? 99;
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

function getOperationalStatusLabel(status: string) {
  const labels: Record<string, string> = {
    blocked_by_xray_policy: 'policy blocked',
    waiting_for_xray: 'waiting for xray',
    warming_cache: 'warming cache',
    indexing_artifact: 'indexing artifact',
    queued_in_xray: 'queued in xray',
  };

  return labels[status] ?? formatStatusLabel(status);
}

function formatExposureStatusLabel(status: ExposureStatus) {
  const labels: Record<ExposureStatus, string> = {
    high_risk: 'high risk',
    findings_present: 'findings present',
    unknown: 'unknown',
    clear: 'clear',
  };

  return labels[status];
}

function getExposureStatus(
  item: Pick<StatusPageItem, 'critical_count' | 'high_count' | 'medium_count' | 'low_count'>,
  operationalStatus?: string
): ExposureStatus {
  if (item.critical_count > 0 || item.high_count > 0) {
    return 'high_risk';
  }
  if (item.medium_count > 0 || item.low_count > 0) {
    return 'findings_present';
  }
  if (
    operationalStatus &&
    (operationalStatus === 'failed' ||
      operationalStatus === 'blocked_by_xray_policy' ||
      ACTIVE_SCAN_STATUSES.has(operationalStatus))
  ) {
    return 'unknown';
  }
  return 'clear';
}

function isExposedStatus(status: ExposureStatus) {
  return status === 'high_risk' || status === 'findings_present';
}

function isClearStatus(item: StatusPageItem, operationalStatus?: string) {
  const resolvedOperationalStatus = operationalStatus ?? getPresentationStatus(item);
  return (
    resolvedOperationalStatus === 'healthy' &&
    getExposureStatus(item, resolvedOperationalStatus) === 'clear'
  );
}

function getPrimaryAccent(operationalStatus: string, exposureStatus: ExposureStatus) {
  if (operationalStatus !== 'healthy') {
    return STATUS_COLOR[operationalStatus] ?? STATUS_COLOR.pending;
  }
  return EXPOSURE_COLOR[exposureStatus] ?? STATUS_COLOR.healthy;
}

function compareItemsByPriority(left: StatusPageItem, right: StatusPageItem) {
  const leftStatus = getPresentationStatus(left);
  const rightStatus = getPresentationStatus(right);
  const leftExposure = getExposureStatus(left, leftStatus);
  const rightExposure = getExposureStatus(right, rightStatus);

  return (
    getStatusRank(leftStatus) - getStatusRank(rightStatus) ||
    getExposureRank(leftExposure) - getExposureRank(rightExposure) ||
    right.critical_count - left.critical_count ||
    right.high_count - left.high_count ||
    right.medium_count - left.medium_count ||
    right.low_count - left.low_count ||
    right.freshness_hours - left.freshness_hours ||
    new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
  );
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{
        background: 'var(--status-pill-bg)',
        border: '1px solid var(--status-pill-border)',
        color: 'var(--text-primary)',
      }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: 'var(--text-muted)' }}
      >
        Tag
      </span>
      <span className="font-mono text-[12px] leading-none">{tag}</span>
    </span>
  );
}

function compactErrorSummary(message?: string) {
  const firstLine = message
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return '';
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

function summarizeWatchCoverage(blockedPolicyDetails: BlockedPolicyDetailsView) {
  const totalWatches = blockedPolicyDetails.matchedWatches.length;
  if (totalWatches === 0) return '';

  const activeIgnoreCount = blockedPolicyDetails.matchedWatches.filter(
    (watch) => watch.ignoreRuleStatus === 'active_ignore'
  ).length;
  if (activeIgnoreCount > 0) {
    return `${activeIgnoreCount}/${totalWatches} watches have active ignore`;
  }

  const unavailableCount = blockedPolicyDetails.matchedWatches.filter(
    (watch) => watch.ignoreRuleStatus === 'status_unavailable'
  ).length;
  if (unavailableCount > 0) {
    return `${unavailableCount}/${totalWatches} watch statuses unavailable`;
  }

  return `${totalWatches} watches with no ignore`;
}

function buildItemNote(
  item: StatusPageItem,
  blockedPolicyDetails: BlockedPolicyDetailsView | null
) {
  if (blockedPolicyDetails) {
    const details: string[] = [];
    if (blockedPolicyDetails.totalViolations) {
      details.push(`${blockedPolicyDetails.totalViolations} violations`);
    }
    if (blockedPolicyDetails.blockingPolicies.length > 0) {
      details.push(
        `${countBlockedPolicyList(blockedPolicyDetails.blockingPolicies)} blocking policies`
      );
    }
    const watchCoverage = summarizeWatchCoverage(blockedPolicyDetails);
    if (watchCoverage) {
      details.push(watchCoverage);
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

function BlockedPolicyWatchBadge({
  status,
}: {
  status: 'active_ignore' | 'no_ignore' | 'status_unavailable';
}) {
  const palette =
    status === 'active_ignore'
      ? {
          color: '#b45309',
          background: 'rgba(245,158,11,0.12)',
          borderColor: 'rgba(245,158,11,0.26)',
        }
      : status === 'status_unavailable'
        ? {
            color: '#9a3412',
            background: 'rgba(251,146,60,0.12)',
            borderColor: 'rgba(251,146,60,0.28)',
          }
        : {
            color: 'var(--text-secondary)',
            background: 'var(--status-pill-bg)',
            borderColor: 'var(--status-pill-border)',
          };

  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      style={palette}
    >
      {formatIgnoreRuleStatusLabel(status)}
    </span>
  );
}

function BlockedPolicyWatchList({
  watches,
  compact = false,
}: {
  watches: BlockedPolicyDetailsView['matchedWatches'];
  compact?: boolean;
}) {
  if (watches.length === 0) return null;

  return (
    <div className="space-y-2">
      {watches.map((watch) => (
        <div
          key={`${watch.name}-${watch.ignoreRuleStatus}`}
          className={`flex flex-col gap-2 rounded-xl border ${compact ? 'px-3 py-2' : 'px-3 py-2.5'} sm:flex-row sm:items-center sm:justify-between`}
          style={{
            borderColor: 'rgba(245,158,11,0.18)',
            background: 'color-mix(in srgb, rgba(245,158,11,0.06) 60%, var(--status-card-bg))',
          }}
        >
          <span
            className={`break-all ${compact ? 'text-[12px]' : 'text-[13px]'}`}
            style={{ color: 'var(--text-primary)' }}
          >
            {watch.name}
          </span>
          <BlockedPolicyWatchBadge status={watch.ignoreRuleStatus} />
        </div>
      ))}
    </div>
  );
}

function getRefreshCadence(lastLoadedAt: number | null, now: number) {
  const elapsedMs = lastLoadedAt ? Math.max(0, now - lastLoadedAt) : 0;

  return {
    elapsedMs,
    progress: Math.min(100, (elapsedMs / AUTO_REFRESH_MS) * 100),
    secondsRemaining: Math.max(
      0,
      Math.ceil((AUTO_REFRESH_MS - Math.min(elapsedMs, AUTO_REFRESH_MS)) / 1000)
    ),
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
        style={{
          background: `radial-gradient(circle at left center, ${accentSoft}, transparent 72%)`,
        }}
      />
      <div className="relative flex items-center justify-between gap-4">
        <div className="space-y-1.5">
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-muted)' }}
          >
            {isXray ? 'Xray pipeline active' : 'Scan pipeline active'}
          </p>
          <p
            className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}
            style={{ color: 'var(--text-primary)' }}
          >
            {detail}
          </p>
          <p className="text-[12px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {startedAt
              ? `Started ${timeAgo(startedAt)}`
              : 'Live scan data is still arriving for this tag.'}
          </p>
        </div>

        <div
          className={`relative shrink-0 ${compact ? 'h-14 w-28' : 'h-16 w-32'}`}
          aria-hidden="true"
        >
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
            <span
              key={`dot-${dot}`}
              className="absolute"
              style={{ left: `${12 + dot * 18}px`, top: `${13 + dot * 12}px` }}
            >
              <span
                className="absolute inline-flex size-3 animate-ping rounded-full"
                style={{
                  background: accent,
                  opacity: 0.45,
                  animationDelay: `${dot * 220}ms`,
                  animationDuration: '1.8s',
                }}
              />
              <span
                className="relative inline-flex size-3 rounded-full border border-white/50"
                style={{ background: accent }}
              />
            </span>
          ))}
          <span
            className="absolute right-1 top-1/2 size-8 -translate-y-1/2 rounded-full border-2 animate-pulse"
            style={{ borderColor: accent, boxShadow: `0 0 0 4px ${accentSoft}` }}
          />
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium capitalize"
      style={{
        color: 'var(--text-secondary)',
        background: 'var(--status-pill-bg)',
        border: '1px solid var(--status-pill-border)',
      }}
    >
      <span className="relative flex size-2.5">
        {(status === 'running' || status === 'pending') && (
          <span
            className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
            style={{ background: color }}
          />
        )}
        <span
          className="relative inline-flex size-2.5 rounded-full"
          style={{ background: color }}
        />
      </span>
      {formatStatusLabel(status)}
    </span>
  );
}

function StateChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium"
      style={{
        background: `color-mix(in srgb, ${color} 12%, var(--status-pill-bg))`,
        border: `1px solid color-mix(in srgb, ${color} 22%, var(--status-pill-border))`,
        color: 'var(--text-secondary)',
      }}
    >
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </span>
      <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </span>
  );
}

function getServiceTone(item: StatusPageItem) {
  const operationalStatus = getPresentationStatus(item);
  const exposureStatus = getExposureStatus(item, operationalStatus);
  const totalFindings = getFindingTotal(item);

  if (ACTIVE_SCAN_STATUSES.has(operationalStatus)) {
    return {
      label: 'Scanning',
      detail: item.current_step ? formatStatusLabel(item.current_step) : 'Scan in progress',
      color: STATUS_COLOR[operationalStatus] ?? STATUS_COLOR.running,
    };
  }

  if (operationalStatus === 'failed') {
    return {
      label: 'Issue Detected',
      detail: compactErrorSummary(item.error_message) || 'Latest scan failed',
      color: STATUS_COLOR.failed,
    };
  }

  if (operationalStatus === 'blocked_by_xray_policy') {
    return {
      label: 'Policy Blocked',
      detail: 'Xray blocked the latest snapshot',
      color: STATUS_COLOR.blocked_by_xray_policy,
    };
  }

  if (operationalStatus === 'stale') {
    return {
      label: 'Stale Snapshot',
      detail: `Observed ${timeAgo(item.observed_at)}`,
      color: STATUS_COLOR.stale,
    };
  }

  if (exposureStatus === 'high_risk') {
    return {
      label: 'Findings Present',
      detail: `${totalFindings.toLocaleString()} findings in the latest scan`,
      color: EXPOSURE_COLOR.high_risk,
    };
  }

  if (exposureStatus === 'findings_present') {
    return {
      label: 'Findings Present',
      detail: `${totalFindings.toLocaleString()} findings in the latest scan`,
      color: EXPOSURE_COLOR.findings_present,
    };
  }

  return {
    label: 'Operational',
    detail: 'No known issues in the latest snapshot',
    color: STATUS_COLOR.healthy,
  };
}

type PolicyDecision = 'allowed' | 'warning' | 'blocked';

function getPolicyDecision(item: StatusPageItem): PolicyDecision {
  const operationalStatus = getPresentationStatus(item);
  if (
    operationalStatus === 'failed' ||
    operationalStatus === 'blocked_by_xray_policy' ||
    item.critical_count > 0
  ) {
    return 'blocked';
  }
  if (
    operationalStatus !== 'healthy' ||
    item.high_count > 0 ||
    item.medium_count > 0 ||
    item.low_count > 0
  ) {
    return 'warning';
  }
  return 'allowed';
}

function getPolicyDecisionMeta(decision: PolicyDecision) {
  if (decision === 'blocked') {
    return { label: 'Blocked', color: 'danger' as const, tone: '#f87171' };
  }
  if (decision === 'warning') {
    return { label: 'Warning', color: 'warning' as const, tone: '#facc15' };
  }
  return { label: 'Allowed', color: 'success' as const, tone: '#34d399' };
}

function getRiskScore(item: StatusPageItem) {
  const weighted =
    item.critical_count * 20 + item.high_count * 8 + item.medium_count * 3 + item.low_count;
  const operationalStatus = getPresentationStatus(item);
  const withOperationalFloor =
    operationalStatus === 'failed' || operationalStatus === 'blocked_by_xray_policy'
      ? Math.max(weighted, 70)
      : weighted;
  return Math.min(99, withOperationalFloor);
}

function formatScanner(scanProvider?: string) {
  if (!scanProvider) return '-';
  if (scanProvider.toLowerCase() === 'xray') return 'Xray';
  if (scanProvider.toLowerCase() === 'trivy') return 'Trivy';
  return scanProvider;
}

function StatusBoardBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex shrink-0 whitespace-nowrap items-center gap-2 rounded-full px-3 py-1 text-[13px] font-medium"
      style={{ color }}
    >
      <span className="size-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function formatScanHistoryOptionLabel(scan: StatusPageScanSummary) {
  const effectiveStatus = getEffectiveScanStatus(scan.scan_status, scan.external_status);
  return `${scan.is_latest ? 'Latest' : 'Previous'} · ${formatStatusLabel(effectiveStatus)} · ${timeAgo(scan.observed_at)}`;
}

async function listStatusPageScanHistoryWithRetry(slug: string, scanId: string, attempts = 3) {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await listStatusPageScanHistory(slug, scanId);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}

function buildFallbackScanSummary(item: StatusPageItem): StatusPageScanSummary {
  return {
    scan_id: item.latest_scan_id,
    image_name: item.image_name,
    image_tag: item.image_tag,
    scan_status: item.scan_status,
    external_status: item.external_status,
    scan_provider: item.scan_provider,
    current_step: item.current_step,
    error_message: item.error_message,
    blocked_policy_details: item.blocked_policy_details,
    critical_count: item.critical_count,
    high_count: item.high_count,
    medium_count: item.medium_count,
    low_count: item.low_count,
    started_at: item.started_at,
    completed_at: item.observed_at,
    created_at: item.started_at ?? item.observed_at,
    observed_at: item.observed_at,
    is_latest: true,
  };
}

function getRecentScanStripScans(item: StatusPageItem, scans?: StatusPageScanSummary[]) {
  const source = scans && scans.length > 0 ? scans : [buildFallbackScanSummary(item)];
  return source
    .toSorted(
      (left, right) => new Date(left.observed_at).getTime() - new Date(right.observed_at).getTime()
    )
    .slice(-RECENT_SCAN_SEGMENTS);
}

function RecentScanStrip({
  slug,
  item,
  scans,
  onHistoryLoaded,
  compact,
}: {
  slug: string;
  item: StatusPageItem;
  scans?: StatusPageScanSummary[];
  onHistoryLoaded?: (scanId: string, scans: StatusPageScanSummary[]) => void;
  compact?: boolean;
}) {
  const [localScans, setLocalScans] = useState<StatusPageScanSummary[] | undefined>(scans);
  const [localLoading, setLocalLoading] = useState(false);

  useEffect(() => {
    return deferEffect(() => {
      setLocalScans(scans);
    });
  }, [scans]);

  useEffect(() => {
    let cancelled = false;
    const cancelDeferred = deferEffect(() => {
      if (scans !== undefined || !item.latest_scan_id) {
        return;
      }

      setLocalLoading(true);

      listStatusPageScanHistoryWithRetry(slug, item.latest_scan_id)
        .then((history) => {
          if (cancelled) return;
          setLocalScans(history);
          onHistoryLoaded?.(item.latest_scan_id, history);
        })
        .catch(() => {
          if (cancelled) return;
          setLocalScans([]);
        })
        .finally(() => {
          if (!cancelled) {
            setLocalLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, [item.latest_scan_id, onHistoryLoaded, scans, slug]);

  const tone = getServiceTone(item);
  const effectiveScans = localScans ?? scans;
  const recentScans = getRecentScanStripScans(item, effectiveScans);
  const latestScan = recentScans[recentScans.length - 1] ?? buildFallbackScanSummary(item);
  const leadingPlaceholders = Math.max(0, RECENT_SCAN_SEGMENTS - recentScans.length);
  const latestLabel = localLoading
    ? 'Loading older scans'
    : recentScans.length === 1
      ? 'Single recorded scan'
      : `${recentScans.length} recent scans`;

  if (compact) {
    return (
      <div className="flex gap-1.5 overflow-hidden" aria-label="14 day scan history">
        {Array.from({ length: leadingPlaceholders }, (_, index) => (
          <span
            key={`${item.latest_scan_id}:empty:${index}`}
            className="h-14 w-2.5 shrink-0 rounded-[3px] bg-default-100"
            aria-hidden="true"
          />
        ))}
        {recentScans.map((scan) => {
          const status = getEffectiveScanStatus(scan.scan_status, scan.external_status);
          const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
          return (
            <span
              key={scan.scan_id}
              className="h-14 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: color, opacity: scan.is_latest ? 1 : 0.84 }}
              title={formatScanHistoryOptionLabel(scan)}
              aria-label={formatScanHistoryOptionLabel(scan)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-hidden" aria-label="Recent scan history">
        {Array.from({ length: leadingPlaceholders }, (_, index) => (
          <span
            key={`${item.latest_scan_id}:empty:${index}`}
            className="h-10 flex-1 rounded-[3px] bg-default-100"
            aria-hidden="true"
          />
        ))}
        {recentScans.map((scan) => {
          const status = getEffectiveScanStatus(scan.scan_status, scan.external_status);
          const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
          return (
            <span
              key={scan.scan_id}
              className="h-10 flex-1 rounded-[3px]"
              style={{ background: color, opacity: scan.is_latest ? 1 : 0.84 }}
              title={formatScanHistoryOptionLabel(scan)}
              aria-label={formatScanHistoryOptionLabel(scan)}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-[12px] text-default-500">
        <span>Older scans</span>
        <span className="h-px flex-1 bg-divider" />
        <span style={{ color: tone.color }}>{latestLabel}</span>
        <span className="h-px flex-1 bg-divider" />
        <span>{timeAgo(latestScan.observed_at)}</span>
      </div>
    </div>
  );
}

function ScanTimeline({
  scans,
  selectedId,
  onSelect,
  isLoading,
}: {
  scans: StatusPageScanSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (scans.length === 0 && !isLoading) return null;

  // Display oldest → newest (left → right)
  const ordered = [...scans].reverse();

  // Info strip shows hovered scan, falling back to selected
  const infoId = hoveredId ?? selectedId;
  const infoScan = ordered.find((s) => s.scan_id === infoId);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-medium uppercase tracking-widest"
          style={{ color: 'var(--text-faint)' }}
        >
          Older
        </span>
        <span
          className="text-[10px] font-medium uppercase tracking-widest"
          style={{ color: 'var(--text-faint)' }}
        >
          Latest
        </span>
      </div>

      {isLoading ? (
        <div className="flex h-10 items-center justify-center">
          <div className="size-4 animate-spin rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500" />
        </div>
      ) : (
        <div
          className="flex items-center overflow-x-auto py-1"
          role="radiogroup"
          aria-label="Scan history timeline"
        >
          {ordered.map((scan, i) => {
            const status = getEffectiveScanStatus(scan.scan_status, scan.external_status);
            const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
            const isSelected = scan.scan_id === selectedId;

            return (
              <div key={scan.scan_id} className="flex shrink-0 items-center">
                {i > 0 && (
                  <div
                    className="h-[2px] w-6 shrink-0"
                    style={{ background: 'var(--border-subtle)' }}
                  />
                )}

                {/* Touch target wraps a smaller visual dot */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={formatScanHistoryOptionLabel(scan)}
                  onClick={() => onSelect(scan.scan_id)}
                  onMouseEnter={() => setHoveredId(scan.scan_id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className="relative flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                >
                  <span
                    className="relative flex size-4 shrink-0 items-center justify-center rounded-full transition-all duration-200"
                    style={{
                      background: color,
                      boxShadow: isSelected
                        ? `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent)`
                        : undefined,
                      transform: isSelected ? 'scale(1.35)' : undefined,
                    }}
                  >
                    {scan.is_latest && (
                      <span
                        className="absolute -right-[3px] -top-[3px] size-[7px] rounded-full"
                        style={{
                          background: 'var(--status-card-bg)',
                          border: `2px solid ${color}`,
                        }}
                      />
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Info strip - updates on hover, shows selected when not hovering */}
      {infoScan &&
        (() => {
          const status = getEffectiveScanStatus(infoScan.scan_status, infoScan.external_status);
          const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
          return (
            <div
              className="flex items-center gap-2 text-[12px]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
              <span>{formatScanHistoryOptionLabel(infoScan)}</span>
            </div>
          );
        })()}
    </div>
  );
}

function StatusItemVulnerabilityModal({
  slug,
  item,
  state,
  onClose,
  onHistoryLoaded,
}: {
  slug: string;
  item: StatusPageItem | null;
  state: ReturnType<typeof useOverlayState>;
  onClose: () => void;
  onHistoryLoaded?: (scanId: string, scans: StatusPageScanSummary[]) => void;
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
  const [fetchedSelectedScan, setFetchedSelectedScan] = useState<{
    scanId: string;
    scan: StatusPageScanSummary | null;
  }>({ scanId: '', scan: null });
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
    [history, selectedScanId]
  );
  const selectedScan =
    historyMatch ??
    (fetchedSelectedScan.scanId === selectedScanId ? fetchedSelectedScan.scan : null);
  const vulnerabilityRequestKey = selectedScanId
    ? [
        slug,
        selectedScanId,
        page,
        severityFilter,
        pkgFilter,
        hasFix ? '1' : '0',
        String(minCvss),
        sortBy,
        sortDir,
      ].join('|')
    : '';
  const loading =
    Boolean(vulnerabilityRequestKey) && vulnerabilityState.requestKey !== vulnerabilityRequestKey;
  const vulns =
    vulnerabilityState.requestKey === vulnerabilityRequestKey ? vulnerabilityState.data : [];
  const vulnTotal =
    vulnerabilityState.requestKey === vulnerabilityRequestKey ? vulnerabilityState.total : 0;
  const error =
    vulnerabilityState.requestKey === vulnerabilityRequestKey ? vulnerabilityState.error : '';

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

        const scans =
          historyResponse.length > 0 ? historyResponse : trackedScan ? [trackedScan] : [];

        setHistory(scans);
        if (item?.latest_scan_id && scans.length > 0) {
          onHistoryLoaded?.(item.latest_scan_id, scans);
        }
        setHistoryResponseKey(requestKey);
        setSelectedScanId(
          (current) =>
            scans.find((scan) => scan.scan_id === current)?.scan_id ??
            scans.find((scan) => scan.is_latest)?.scan_id ??
            trackedScan?.scan_id ??
            item.latest_scan_id
        );
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
  }, [item?.latest_scan_id, onHistoryLoaded, slug]);

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

    const requestKey = [
      slug,
      selectedScanId,
      page,
      severityFilter,
      pkgFilter,
      hasFix ? '1' : '0',
      String(minCvss),
      sortBy,
      sortDir,
    ].join('|');
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
      sortDir
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
    return getBlockedPolicyDetails(
      selectedScan?.external_status ?? item?.external_status,
      selectedScan?.blocked_policy_details ?? item?.blocked_policy_details,
      selectedScan?.error_message ?? item?.error_message ?? null
    );
  }, [
    item?.blocked_policy_details,
    item?.error_message,
    item?.external_status,
    selectedScan?.blocked_policy_details,
    selectedScan?.error_message,
    selectedScan?.external_status,
  ]);

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
          <Modal.Dialog className="surface-modal overflow-hidden rounded-[28px] w-[min(1120px,calc(100vw-1.5rem))] max-w-none">
            <Modal.Body className="p-0">
              <div className="border-b px-6 py-5" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      Vulnerability drill-down
                    </p>
                    <div>
                      <h3
                        className="font-mono text-base font-semibold sm:text-lg"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {item ? item.image_name : 'Loading item'}
                      </h3>
                      {item && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <TagBadge tag={item.image_tag} />
                          {selectedScan?.is_latest === false && (
                            <span
                              className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                              style={{
                                background: 'var(--status-pill-bg)',
                                border: '1px solid var(--status-pill-border)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              Historical snapshot
                            </span>
                          )}
                        </div>
                      )}
                      {displayedScan && (
                        <p className="mt-1 text-[13px] leading-6 text-zinc-500">
                          Snapshot {timeAgo(displayedScan.observed_at)}.{' '}
                          {vulnTotal.toLocaleString()} matching finding{vulnTotal === 1 ? '' : 's'}.
                        </p>
                      )}
                    </div>
                  </div>
                  {selectedScan ? (
                    <StatusBadge
                      status={selectedScan.scan_status}
                      externalStatus={selectedScan.external_status}
                    />
                  ) : item ? (
                    <StatusDot status={getPresentationStatus(item)} />
                  ) : null}
                </div>
              </div>

              <div className="space-y-4 px-6 py-5">
                {effectiveScanStatus === 'running' ||
                effectiveScanStatus === 'pending' ||
                selectedScan?.scan_status === 'running' ||
                selectedScan?.scan_status === 'pending' ? (
                  <RunningScanVisualization
                    provider={selectedScan?.scan_provider ?? item?.scan_provider}
                    currentStep={selectedScan?.current_step ?? item?.current_step}
                    status={selectedScan?.scan_status ?? item?.scan_status ?? 'pending'}
                    externalStatus={selectedScan?.external_status ?? item?.external_status}
                    startedAt={selectedScan?.started_at ?? item?.started_at}
                  />
                ) : null}

                {blockedPolicyDetails && (
                  <div
                    className="rounded-3xl border p-4"
                    style={{
                      borderColor: 'rgba(245,158,11,0.24)',
                      background: 'rgba(245,158,11,0.08)',
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p
                        className="text-[11px] font-semibold uppercase tracking-[0.16em]"
                        style={{ color: '#b45309' }}
                      >
                        Xray policy violation
                      </p>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                        style={{ borderColor: 'rgba(245,158,11,0.24)', color: '#b45309' }}
                      >
                        Findings may still be available below
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-primary)' }}>
                      {blockedPolicyDetails.summary}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {blockedPolicyDetails.totalViolations && (
                        <span
                          className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                          style={getTintedChipStyle('#f59e0b', '#b45309')}
                        >
                          {blockedPolicyDetails.totalViolations} violations
                        </span>
                      )}
                      {blockedPolicyDetails.blockingPolicies.length > 0 && (
                        <span
                          className="rounded-full border px-2.5 py-1 text-[11px]"
                          style={getTintedChipStyle('#f59e0b', 'var(--text-secondary)')}
                        >
                          {countBlockedPolicyList(blockedPolicyDetails.blockingPolicies)} blocking
                          policies
                        </span>
                      )}
                      {blockedPolicyDetails.matchedWatches.length > 0 && (
                        <span
                          className="rounded-full border px-2.5 py-1 text-[11px]"
                          style={getTintedChipStyle('#f59e0b', 'var(--text-secondary)')}
                        >
                          {blockedPolicyDetails.matchedWatches.length} watches
                        </span>
                      )}
                      {blockedPolicyDetails.matchedIssues.length > 0 && (
                        <span
                          className="rounded-full border px-2.5 py-1 text-[11px]"
                          style={getTintedChipStyle('#f59e0b', 'var(--text-secondary)')}
                        >
                          {countBlockedPolicyList(blockedPolicyDetails.matchedIssues)} matched
                          issues
                        </span>
                      )}
                    </div>
                    <details className="mt-3 group">
                      <summary
                        className="cursor-pointer list-none text-[12px] font-semibold"
                        style={{ color: '#b45309' }}
                      >
                        Show Xray details
                      </summary>
                      <div className="mt-3 space-y-3">
                        {blockedPolicyDetails.matchedWatches.length > 0 && (
                          <div className="space-y-2">
                            <p
                              className="text-[12px] font-semibold"
                              style={{ color: 'var(--text-primary)' }}
                            >
                              Matched watches
                            </p>
                            <BlockedPolicyWatchList
                              watches={blockedPolicyDetails.matchedWatches}
                              compact
                            />
                          </div>
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          {blockedPolicyDetails.blockingPolicies.length > 0 && (
                            <div className="text-[12px] leading-5">
                              <span
                                className="font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                Blocking policies:
                              </span>{' '}
                              <span style={{ color: 'var(--text-secondary)' }}>
                                {compactBlockedPolicyList(blockedPolicyDetails.blockingPolicies, 3)}
                              </span>
                            </div>
                          )}
                          {blockedPolicyDetails.matchedPolicies.length > 0 && (
                            <div className="text-[12px] leading-5">
                              <span
                                className="font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                Matched policies:
                              </span>{' '}
                              <span style={{ color: 'var(--text-secondary)' }}>
                                {compactBlockedPolicyList(blockedPolicyDetails.matchedPolicies, 3)}
                              </span>
                            </div>
                          )}
                          {blockedPolicyDetails.matchedIssues.length > 0 && (
                            <div className="text-[12px] leading-5">
                              <span
                                className="font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                Matched issues:
                              </span>{' '}
                              <span style={{ color: 'var(--text-secondary)' }}>
                                {compactBlockedPolicyList(blockedPolicyDetails.matchedIssues, 3)}
                              </span>
                            </div>
                          )}
                          {blockedPolicyDetails.artifact && (
                            <div className="text-[12px] leading-5">
                              <span
                                className="font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                Artifact:
                              </span>{' '}
                              <span
                                className="break-all"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                {blockedPolicyDetails.artifact}
                              </span>
                            </div>
                          )}
                          {blockedPolicyDetails.manifest && (
                            <div className="text-[12px] leading-5">
                              <span
                                className="font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                Manifest:
                              </span>{' '}
                              <span
                                className="break-all"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                {blockedPolicyDetails.manifest}
                              </span>
                            </div>
                          )}
                          {blockedPolicyDetails.jfrog && (
                            <div className="text-[12px] leading-5 sm:col-span-2">
                              <span
                                className="font-semibold"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                JFrog:
                              </span>{' '}
                              <span
                                className="break-all"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                {blockedPolicyDetails.jfrog}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </details>
                    <div
                      className="mt-3 border-t pt-3 text-[12px]"
                      style={{
                        borderColor: 'rgba(245,158,11,0.16)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      Select a previous scan if you want to compare how the policy block and
                      findings changed across snapshots.
                    </div>
                  </div>
                )}

                {historyError && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500 dark:text-red-400">
                    {historyError}
                  </div>
                )}

                <ScanTimeline
                  scans={history}
                  selectedId={selectedScanId}
                  onSelect={(id) => {
                    setSelectedScanId(id);
                    setPage(1);
                  }}
                  isLoading={historyLoading}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={severityFilter || '__all__'}
                    onChange={(value) => {
                      setSeverityFilter(String(value === '__all__' ? '' : (value ?? '')));
                      setPage(1);
                    }}
                    className="w-full min-w-[180px] sm:w-auto"
                    aria-label="Filter vulnerabilities by severity"
                  >
                    <Select.Trigger className={STATUS_SELECT_TRIGGER_CLS}>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {VULN_SEVERITY_OPTIONS.map((option) => (
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
                    onChange={(event) => {
                      setPkgInput(event.target.value);
                    }}
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
                    onChange={(event) => {
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

                  <Button
                    size="sm"
                    variant={hasFix ? 'primary' : 'secondary'}
                    onPress={() => {
                      setHasFix((value) => !value);
                      setPage(1);
                    }}
                    className="rounded-full px-4 text-sm font-medium"
                  >
                    Has Fix
                  </Button>
                </div>

                {error && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-500 dark:text-red-400">
                    {error}
                  </div>
                )}

                <div
                  className="overflow-hidden rounded-3xl"
                  style={{
                    background: 'var(--status-card-bg)',
                    border: '1px solid var(--status-card-border)',
                  }}
                >
                  <Table variant="secondary">
                    <Table.ScrollContainer>
                      <Table.Content
                        aria-label="Status page vulnerabilities"
                        className="min-w-[840px]"
                      >
                        <Table.Header>
                          {(
                            [
                              { label: 'CVE ID', key: 'vuln_id' },
                              { label: 'Package', key: 'pkg_name' },
                              { label: 'Installed', key: 'installed_version' },
                              { label: 'Fixed In', key: 'fixed_version' },
                              { label: 'Severity', key: 'severity' },
                              { label: 'CVSS', key: 'cvss_score' },
                            ] as { label: string; key: VulnerabilitySortKey }[]
                          ).map(({ label, key }) => {
                            const active = sortBy === key;
                            return (
                              <Table.Column key={key} isRowHeader={key === 'vuln_id'}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (active) {
                                      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
                                    } else {
                                      setSortBy(key);
                                      setSortDir('asc');
                                    }
                                    setPage(1);
                                  }}
                                  className="inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
                                  style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}
                                  aria-label={`Sort vulnerabilities by ${label}`}
                                >
                                  <span>{label}</span>
                                  {active && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                                </button>
                              </Table.Column>
                            );
                          })}
                        </Table.Header>
                        <Table.Body>
                          {loading ? (
                            <Table.Row id="loading">
                              <Table.Cell colSpan={6}>
                                <div className="py-12 text-center">
                                  <div className="flex justify-center">
                                    <div className="size-6 animate-spin rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-accent-500" />
                                  </div>
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          ) : vulns.length === 0 ? (
                            <Table.Row id="empty">
                              <Table.Cell colSpan={6}>
                                <div
                                  className="py-12 text-center text-sm"
                                  style={{ color: 'var(--text-faint)' }}
                                >
                                  {vulnTotal === 0
                                    ? blockedPolicyDetails
                                      ? 'Xray blocked this snapshot with policy violations, but no vulnerability records were returned for this scan.'
                                      : 'No vulnerabilities found for this image tag.'
                                    : 'No results match your filters.'}
                                </div>
                              </Table.Cell>
                            </Table.Row>
                          ) : (
                            vulns.map((vuln) => (
                              <Table.Row
                                key={vuln.id}
                                id={vuln.id}
                                className="hover:bg-[var(--row-hover)]"
                              >
                                <Table.Cell>
                                  {vuln.vuln_id ? (
                                    <div className="flex flex-col gap-1.5">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => openVulnerabilityDetails(vuln)}
                                          className="font-mono text-xs text-accent transition-colors hover:underline dark:text-accent"
                                        >
                                          {vuln.vuln_id}
                                        </button>
                                        <SourceBadge source={vuln.data_source} />
                                      </div>
                                      {vuln.title && (
                                        <p className="max-w-[280px] text-xs leading-5 text-zinc-500">
                                          {vuln.title}
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <span style={{ color: 'var(--text-faint)' }}>-</span>
                                  )}
                                </Table.Cell>
                                <Table.Cell
                                  className="font-mono text-xs"
                                  style={{ color: 'var(--text-secondary)' }}
                                >
                                  {vuln.pkg_name}
                                </Table.Cell>
                                <Table.Cell
                                  className="font-mono text-xs"
                                  style={{ color: 'var(--text-muted)' }}
                                >
                                  {vuln.installed_version || '-'}
                                </Table.Cell>
                                <Table.Cell className="font-mono text-xs text-emerald-600 dark:text-emerald-500">
                                  {vuln.fixed_version || (
                                    <span style={{ color: 'var(--text-faint)' }}>-</span>
                                  )}
                                </Table.Cell>
                                <Table.Cell>
                                  <SeverityBadge severity={vuln.severity} />
                                </Table.Cell>
                                <Table.Cell
                                  className="font-mono text-xs"
                                  style={{ color: 'var(--text-muted)' }}
                                >
                                  {vuln.cvss_score ? vuln.cvss_score.toFixed(1) : '-'}
                                </Table.Cell>
                              </Table.Row>
                            ))
                          )}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                </div>
              </div>
            </Modal.Body>

            <Modal.Footer
              className="flex items-center justify-between gap-3 px-6 py-4"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {vulnTotal.toLocaleString()} total findings
              </span>
              <div className="flex items-center gap-2">
                {reportHref && (
                  <Button
                    size="sm"
                    variant="primary"
                    onPress={() => window.open(reportHref, '_blank', 'noopener,noreferrer')}
                    className="rounded-full px-4"
                  >
                    Generate report
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={page <= 1}
                  onPress={() => {
                    setPage((current) => Math.max(1, current - 1));
                  }}
                  className="rounded-full px-4"
                >
                  Prev
                </Button>
                <span className="px-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {page} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={page >= totalPages}
                  onPress={() => {
                    setPage((current) => Math.min(totalPages, current + 1));
                  }}
                  className="rounded-full px-4"
                >
                  Next
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={onClose}
                  className="rounded-full px-4"
                >
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
        loadContextAnalysis={
          selectedScanId
            ? (vulnerability) =>
                getStatusPageItemVulnerabilityContextAnalysis(
                  slug,
                  selectedScanId,
                  vulnerability.id
                )
            : undefined
        }
      />
    </Modal>
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
  const [activeItem, setActiveItem] = useState<StatusPageItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [rowScanHistory, setRowScanHistory] = useState<Record<string, StatusPageScanSummary[]>>({});
  const mountedRef = useRef(true);
  const vulnerabilityModal = useOverlayState();
  const refreshClock = useTicker(1000);

  function openItemDetails(item: StatusPageItem) {
    setActiveItem(item);
    vulnerabilityModal.open();
  }

  function closeItemDetails() {
    vulnerabilityModal.close();
  }

  function syncRowHistory(scanId: string, scans: StatusPageScanSummary[]) {
    setRowScanHistory((current) => {
      const existing = current[scanId];
      if (existing && existing.length >= scans.length) {
        return current;
      }
      return {
        ...current,
        [scanId]: scans,
      };
    });
  }

  const load = useCallback(
    async (showLoader: boolean) => {
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
    },
    [slug]
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const cancelDeferred = deferEffect(() => load(true));
    const interval = setInterval(() => {
      void load(false);
    }, AUTO_REFRESH_MS);

    return () => {
      cancelDeferred();
      clearInterval(interval);
    };
  }, [load]);

  const summary = useMemo(() => {
    const items = data?.items ?? [];
    return items.reduce(
      (acc, item) => {
        const operationalStatus = getPresentationStatus(item);
        const exposureStatus = getExposureStatus(item, operationalStatus);
        acc.total += 1;
        acc.attention +=
          operationalStatus === 'healthy' && !isExposedStatus(exposureStatus) ? 0 : 1;
        acc.critical += item.critical_count;
        acc.high += item.high_count;
        acc.medium += item.medium_count;
        acc.low += item.low_count;
        acc.findings += getFindingTotal(item);
        acc.stale += operationalStatus === 'stale' ? 1 : 0;
        acc.operations[operationalStatus] = (acc.operations[operationalStatus] ?? 0) + 1;
        acc.exposure[exposureStatus] = (acc.exposure[exposureStatus] ?? 0) + 1;
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
        operations: {} as Record<string, number>,
        exposure: {} as Record<string, number>,
      }
    );
  }, [data]);

  const trackedItems = useMemo(() => {
    return (data?.items ?? []).toSorted(
      (left, right) =>
        compareItemsByPriority(left, right) ||
        left.display_order - right.display_order ||
        left.image_name.localeCompare(right.image_name) ||
        left.image_tag.localeCompare(right.image_tag)
    );
  }, [data]);

  const filteredTrackedItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return trackedItems;
    return trackedItems.filter((item) => {
      const operationalStatus = getPresentationStatus(item);
      const decisionLabel = getPolicyDecisionMeta(getPolicyDecision(item)).label.toLowerCase();
      return (
        item.image_name.toLowerCase().includes(query) ||
        item.image_tag.toLowerCase().includes(query) ||
        `${item.image_name}:${item.image_tag}`.toLowerCase().includes(query) ||
        formatStatusLabel(operationalStatus).toLowerCase().includes(query) ||
        formatScanner(item.scan_provider).toLowerCase().includes(query) ||
        decisionLabel.includes(query)
      );
    });
  }, [searchQuery, trackedItems]);

  const decisionSummary = useMemo(() => {
    return trackedItems.reduce(
      (acc, item) => {
        const decision = getPolicyDecision(item);
        acc[decision] += 1;
        return acc;
      },
      { allowed: 0, warning: 0, blocked: 0 }
    );
  }, [trackedItems]);

  const latestObservedAt = useMemo(() => {
    return trackedItems.reduce<string | null>((latest, item) => {
      if (!latest) return item.observed_at;
      return new Date(item.observed_at).getTime() > new Date(latest).getTime()
        ? item.observed_at
        : latest;
    }, null);
  }, [trackedItems]);

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="rounded-2xl border border-divider bg-content1 p-8 max-w-md text-center space-y-4">
          <div className="size-11 rounded-2xl mx-auto flex items-center justify-center bg-content2">
            <Logo size={18} className="text-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {needsAuth ? 'Authentication Required' : 'Status Page Unavailable'}
            </h1>
            <p className="text-sm text-default-500 mt-1.5">{error}</p>
          </div>
          {needsAuth && (
            <Link
              href={`/login?returnUrl=/status/${slug}`}
              className="inline-flex px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-primary-foreground"
            >
              {getToken() ? 'Sign in again to continue' : 'Sign in to continue'}
            </Link>
          )}
        </div>
      </div>
    );
  }

  const operationalIssueCount =
    (summary.operations.failed ?? 0) +
    (summary.operations.blocked_by_xray_policy ?? 0) +
    (summary.operations.stale ?? 0);
  const exposedCount = (summary.exposure.high_risk ?? 0) + (summary.exposure.findings_present ?? 0);
  const runningCount = summary.operations.running ?? 0;
  const healthyCount = trackedItems.length - operationalIssueCount;
  const { secondsRemaining } = getRefreshCadence(lastLoadedAt, refreshClock);
  const pageTone =
    operationalIssueCount > 0
      ? {
          label: 'Investigating Issues',
          color: STATUS_COLOR.failed,
          description: `${summary.operations.failed ?? 0} failed, ${summary.operations.blocked_by_xray_policy ?? 0} policy blocked, and ${summary.operations.stale ?? 0} stale snapshot${operationalIssueCount === 1 ? '' : 's'} currently need attention.`,
        }
      : exposedCount > 0
        ? {
            label: 'Operational With Findings',
            color: EXPOSURE_COLOR.findings_present,
            description: `${summary.exposure.high_risk ?? 0} high-risk and ${summary.exposure.findings_present ?? 0} lower-severity finding set${exposedCount === 1 ? '' : 's'} are present in the latest scans.`,
          }
        : runningCount > 0
          ? {
              label: 'Operational, Scans Active',
              color: STATUS_COLOR.running,
              description: `${runningCount} scan${runningCount === 1 ? '' : 's'} are still processing, but there are no current operational failures on tracked services.`,
            }
          : {
              label: 'All Systems Operational',
              color: STATUS_COLOR.healthy,
              description:
                'Every tracked service is healthy in the latest snapshot and no known findings are currently present.',
            };
  const headerDescription = data.page.description?.trim() ?? '';
  const showHeaderDescription =
    headerDescription.length > 0 &&
    headerDescription.toLowerCase() !== data.page.name.trim().toLowerCase();

  return (
    <div className="light min-h-screen bg-background text-foreground" data-theme="light">
      <main className="w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <section className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-divider bg-content1 px-3 py-1.5">
                <Logo size={14} className="invert-0 dark:invert-0" />
                <span className="text-sm font-medium text-default-700">JustScan Status</span>
              </div>
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-divider bg-content1">
                  <Logo size={20} className="invert-0 dark:invert-0" />
                </div>
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  {data.page.name}
                </h1>
              </div>
              {showHeaderDescription ? (
                <p className="max-w-4xl text-base leading-relaxed text-default-600">
                  {headerDescription}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip variant="soft" color="default">
                Snapshot {latestObservedAt ? timeAgo(latestObservedAt) : 'pending'}
              </Chip>
              <Chip variant="soft" color="default" className="capitalize">
                {data.page.visibility}
              </Chip>
              <Button
                size="sm"
                variant="secondary"
                isPending={refreshing}
                onPress={() => void load(false)}
                className="rounded-full px-4"
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-default-600">
            <StatusBoardBadge label={pageTone.label} color={pageTone.color} />
            <span>{healthyCount} healthy</span>
            <span>{operationalIssueCount} issues</span>
            <span>{exposedCount} exposed</span>
            <span>{runningCount} scanning</span>
            <span>{refreshing ? 'Refreshing now' : `Auto refresh in ${secondsRemaining}s`}</span>
            <span>Stale after {data.page.stale_after_hours}h</span>
          </div>
          <p className="text-sm text-default-600">{pageTone.description}</p>

          <Card className="grid overflow-hidden sm:grid-cols-3 sm:divide-x sm:divide-divider" variant="secondary">
            <div className="text-center">
              <p className="text-3xl font-semibold text-success">{decisionSummary.allowed}</p>
              <p className="mt-1 text-sm text-default-600">Allowed</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-warning">{decisionSummary.warning}</p>
              <p className="mt-1 text-sm text-default-600">Warnings</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-semibold text-danger">{decisionSummary.blocked}</p>
              <p className="mt-1 text-sm text-default-600">Blocked</p>
            </div>
          </Card>

          <Card variant="secondary">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">Scanned images</h2>
                <p className="mt-1 text-default-600">
                  Latest policy decision per tracked image with 14-day history.
                </p>
              </div>
              <SearchField
                aria-label="Search images"
                value={searchQuery}
                onChange={setSearchQuery}
                variant="secondary"
                className="w-full sm:max-w-sm"
              >
                <SearchField.Group className="rounded-full">
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search images..." />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
            </div>

            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Image policy status table" className="min-w-[1180px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Image</Table.Column>
                    <Table.Column>Status</Table.Column>
                    <Table.Column>Risk</Table.Column>
                    <Table.Column>Findings</Table.Column>
                    <Table.Column>14 Days</Table.Column>
                    <Table.Column>Scanner</Table.Column>
                    <Table.Column>Last Scan</Table.Column>
                    <Table.Column>Actions</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {filteredTrackedItems.length === 0 ? (
                      <Table.Row id="empty">
                        <Table.Cell colSpan={8}>
                          <div className="py-12 text-center text-sm text-default-600">
                            {trackedItems.length === 0
                              ? 'No services are currently tracked.'
                              : 'No images match your search.'}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      filteredTrackedItems.map((item) => {
                        const decision = getPolicyDecision(item);
                        const decisionMeta = getPolicyDecisionMeta(decision);
                        const riskScore = getRiskScore(item);
                        return (
                          <Table.Row
                            key={`${item.image_name}:${item.image_tag}`}
                            id={`${item.image_name}:${item.image_tag}`}
                            className="hover:bg-content2"
                          >
                            <Table.Cell>
                              <div className="flex items-start gap-3">
                                <span
                                  className="mt-2 size-2.5 shrink-0 rounded-full"
                                  style={{ background: decisionMeta.tone }}
                                />
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    className="truncate text-left text-lg font-semibold hover:underline"
                                    onClick={() => openItemDetails(item)}
                                  >
                                    {item.image_name}
                                  </button>
                                  <p className="mt-1 truncate font-mono text-xs text-default-500">
                                    {item.image_name}:{item.image_tag}
                                  </p>
                                </div>
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <Chip
                                color={decisionMeta.color}
                                variant="soft"
                                className="rounded-full"
                              >
                                {decisionMeta.label}
                              </Chip>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-3xl font-semibold">{riskScore}</span>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-sm">
                                <span className="text-danger">{item.critical_count}</span> critical
                                <span className="mx-1 text-default-400">·</span>
                                <span className="text-warning">{item.high_count}</span> high
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <RecentScanStrip
                                slug={slug}
                                item={item}
                                scans={rowScanHistory[item.latest_scan_id]}
                                onHistoryLoaded={syncRowHistory}
                                compact
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-sm text-default-600">
                                {formatScanner(item.scan_provider)}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-sm text-default-500">
                                {timeAgo(item.observed_at)}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <Button
                                size="sm"
                                variant="secondary"
                                onPress={() => openItemDetails(item)}
                                className="rounded-full"
                              >
                                Details
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        );
                      })
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card>
        </section>
      </main>

      {activeItem && vulnerabilityModal.isOpen && (
        <StatusItemVulnerabilityModal
          key={`${activeItem.image_name}:${activeItem.image_tag}`}
          slug={slug}
          item={activeItem}
          state={vulnerabilityModal}
          onClose={closeItemDetails}
          onHistoryLoaded={syncRowHistory}
        />
      )}
    </div>
  );
}
