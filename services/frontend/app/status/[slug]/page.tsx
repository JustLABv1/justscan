'use client';

import { Logo } from '@/components/logo';
import {
  ActiveStatusUpdates,
  OverallStatusBanner,
  PublicStatusHeader,
  StatusMetrics,
} from './_components/public-status-chrome';
import { StatusBadge, formatStatusLabel, resolveDisplayStatus } from '@/components/ui/badges';
import type { StatusPageItem, StatusPageResponse, StatusPageScanSummary } from '@/lib/api';
import {
  ApiError,
  getScan,
  getStatusPageBySlug,
  getStatusPageTrackedScan,
  getToken,
  listStatusPageScanHistory,
} from '@/lib/api';
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
  Skeleton,
  Table,
  Tooltip,
  useOverlayState,
} from '@heroui/react';
import { ArrowRight01Icon, Cancel01Icon, PackageIcon, Shield01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const AUTO_REFRESH_MS = 30000;
const RECENT_SCAN_SEGMENTS = 14;
const SCAN_HISTORY_SKELETON_KEYS = Array.from(
  { length: 8 },
  (_, index) => `scan-history-skeleton-${index + 1}`
);
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

type ExposureStatus = 'high_risk' | 'findings_present' | 'unknown' | 'clear';
type ImageStatusFilter = '__all__' | 'issues' | 'healthy' | 'scanning' | 'exposed';
type DecisionFilter = '__all__' | PolicyDecision;

const IMAGE_STATUS_FILTER_OPTIONS: Array<{ key: ImageStatusFilter; label: string }> = [
  { key: '__all__', label: 'All image states' },
  { key: 'issues', label: 'Operational issues' },
  { key: 'healthy', label: 'Healthy' },
  { key: 'scanning', label: 'Scanning' },
  { key: 'exposed', label: 'Findings present' },
];

const DECISION_FILTER_OPTIONS: Array<{ key: DecisionFilter; label: string }> = [
  { key: '__all__', label: 'All org policies' },
  { key: 'failed', label: 'Policy failed' },
  { key: 'passed', label: 'Policy passed' },
  { key: 'not_evaluated', label: 'Not evaluated' },
];

function getStatusRank(status: string) {
  return STATUS_PRIORITY[status] ?? 99;
}

function getExposureRank(status: ExposureStatus) {
  return EXPOSURE_PRIORITY[status] ?? 99;
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
    item.compliance_status !== 'fail' &&
    getExposureStatus(item, resolvedOperationalStatus) === 'clear'
  );
}

function compareItemsByPriority(left: StatusPageItem, right: StatusPageItem) {
  const leftStatus = getPresentationStatus(left);
  const rightStatus = getPresentationStatus(right);
  const leftExposure = getExposureStatus(left, leftStatus);
  const rightExposure = getExposureStatus(right, rightStatus);

  return (
    getStatusRank(leftStatus) - getStatusRank(rightStatus) ||
    Number(right.compliance_status === 'fail') - Number(left.compliance_status === 'fail') ||
    getExposureRank(leftExposure) - getExposureRank(rightExposure) ||
    right.critical_count - left.critical_count ||
    right.high_count - left.high_count ||
    right.medium_count - left.medium_count ||
    right.low_count - left.low_count ||
    right.freshness_hours - left.freshness_hours ||
    new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
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
      label: 'Xray Policy Blocked',
      detail: 'Xray blocked the latest snapshot',
      color: STATUS_COLOR.blocked_by_xray_policy,
    };
  }

  if (item.compliance_status === 'fail') {
    return {
      label: 'Organization Policy Failed',
      detail: 'The latest completed scan failed an organization policy',
      color: STATUS_COLOR.failed,
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

type PolicyDecision = 'passed' | 'failed' | 'not_evaluated';

function getPolicyDecision(item: Pick<StatusPageItem, 'compliance_status'>): PolicyDecision {
  if (item.compliance_status === 'fail') return 'failed';
  if (item.compliance_status === 'pass') return 'passed';
  return 'not_evaluated';
}

function getPolicyDecisionMeta(decision: PolicyDecision) {
  if (decision === 'failed') {
    return { label: 'Org policy failed', color: 'danger' as const, tone: STATUS_COLOR.failed };
  }
  if (decision === 'passed') {
    return { label: 'Org policy passed', color: 'success' as const, tone: STATUS_COLOR.healthy };
  }
  return { label: 'No org policy', color: 'default' as const, tone: EXPOSURE_COLOR.unknown };
}

function getOperationalStatusMeta(status: string) {
  if (status === 'failed') {
    return { label: 'Scan failed', color: 'danger' as const };
  }
  if (status === 'blocked_by_xray_policy') {
    return { label: 'Xray policy blocked', color: 'warning' as const };
  }
  if (status === 'stale') {
    return { label: 'Stale', color: 'warning' as const };
  }
  if (ACTIVE_SCAN_STATUSES.has(status)) {
    return { label: getOperationalStatusLabel(status), color: 'accent' as const };
  }
  if (status === 'healthy' || status === 'completed') {
    return { label: 'Operational', color: 'success' as const };
  }
  return { label: getOperationalStatusLabel(status), color: 'default' as const };
}

function getScanHistoryMeta(
  scan: Pick<StatusPageScanSummary, 'scan_status' | 'external_status' | 'compliance_status'>
) {
  const operationalStatus = getEffectiveScanStatus(scan.scan_status, scan.external_status);
  if (operationalStatus === 'failed') {
    return { label: 'scan failed', color: STATUS_COLOR.failed };
  }
  if (operationalStatus === 'blocked_by_xray_policy') {
    return { label: 'Xray policy blocked', color: STATUS_COLOR.blocked_by_xray_policy };
  }
  if (ACTIVE_SCAN_STATUSES.has(operationalStatus)) {
    return {
      label: getOperationalStatusLabel(operationalStatus),
      color: STATUS_COLOR[operationalStatus] ?? STATUS_COLOR.running,
    };
  }
  if (operationalStatus !== 'completed' && operationalStatus !== 'healthy') {
    return {
      label: getOperationalStatusLabel(operationalStatus),
      color: STATUS_COLOR[operationalStatus] ?? EXPOSURE_COLOR.unknown,
    };
  }
  if (scan.compliance_status === 'fail') {
    return { label: 'org policy failed', color: STATUS_COLOR.failed };
  }
  return {
    label: scan.compliance_status === 'pass' ? 'org policy passed' : 'completed',
    color: STATUS_COLOR.completed,
  };
}

function formatScanner(scanProvider?: string) {
  if (!scanProvider) return '-';
  if (scanProvider.toLowerCase() === 'xray') return 'Xray';
  if (scanProvider.toLowerCase() === 'trivy') return 'Trivy';
  return scanProvider;
}

function formatScanHistoryOptionLabel(scan: StatusPageScanSummary) {
  const meta = getScanHistoryMeta(scan);
  return `${scan.is_latest ? 'Latest' : 'Previous'} · ${meta.label} · ${timeAgo(scan.observed_at)}`;
}

function buildFallbackScanSummary(item: StatusPageItem): StatusPageScanSummary {
  return {
    scan_id: item.latest_scan_id,
    image_name: item.image_name,
    image_tag: item.image_tag,
    scan_status: item.scan_status,
    external_status: item.external_status,
    compliance_status: item.compliance_status,
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
  item,
  scans,
  compact,
  onOpen,
}: {
  item: StatusPageItem;
  scans?: StatusPageScanSummary[];
  compact?: boolean;
  onOpen: (item: StatusPageItem) => void;
}) {
  const tone = getServiceTone(item);
  const hasLoadedHistory = scans !== undefined;
  const recentScans = getRecentScanStripScans(item, scans);
  const latestScan = recentScans[recentScans.length - 1] ?? buildFallbackScanSummary(item);

  if (!hasLoadedHistory) {
    return (
      <div className="flex gap-1.5" aria-label="Loading scan history">
        {SCAN_HISTORY_SKELETON_KEYS.slice(0, compact ? 5 : 8).map((key) => (
          <Skeleton
            key={key}
            className={compact ? 'h-14 w-2.5 rounded-[3px]' : 'h-10 flex-1 rounded-[3px]'}
          />
        ))}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex gap-1.5 overflow-hidden" aria-label="14 day scan history">
        {recentScans.map((scan) => {
          const { color } = getScanHistoryMeta(scan);
          return (
            <Tooltip key={scan.scan_id} delay={100}>
              <Tooltip.Trigger aria-label={formatScanHistoryOptionLabel(scan)}>
                <button
                  type="button"
                  aria-label={formatScanHistoryOptionLabel(scan)}
                  className="h-14 w-2.5 shrink-0 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ background: color, opacity: scan.is_latest ? 1 : 0.84 }}
                  onClick={() => onOpen(item)}
                />
              </Tooltip.Trigger>
              <Tooltip.Content showArrow>
                <Tooltip.Arrow />
                {formatScanHistoryOptionLabel(scan)}
              </Tooltip.Content>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-hidden" aria-label="Recent scan history">
        {recentScans.map((scan) => {
          const { color } = getScanHistoryMeta(scan);
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
        <span style={{ color: tone.color }}>{recentScans.length} recent scans</span>
        <span className="h-px flex-1 bg-divider" />
        <span>{timeAgo(latestScan.observed_at)}</span>
      </div>
    </div>
  );
}

function ImageStatusChips({ item }: { item: StatusPageItem }) {
  const decisionMeta = getPolicyDecisionMeta(getPolicyDecision(item));
  const operationalMeta = getOperationalStatusMeta(getPresentationStatus(item));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip color={decisionMeta.color} size="sm" variant="soft">
        <Chip.Label>{decisionMeta.label}</Chip.Label>
      </Chip>
      <Chip color={operationalMeta.color} size="sm" variant="soft">
        <Chip.Label>{operationalMeta.label}</Chip.Label>
      </Chip>
    </div>
  );
}

function FindingDeltas({ item }: { item: StatusPageItem }) {
  const deltas = [
    { label: 'critical', value: item.delta_critical_count },
    { label: 'high', value: item.delta_high_count },
    { label: 'medium', value: item.delta_medium_count },
    { label: 'low', value: item.delta_low_count },
  ];
  const hasPreviousScan = deltas.some((delta) => delta.value !== undefined);
  if (!hasPreviousScan) return null;

  const changed = deltas.filter((delta) => delta.value && delta.value !== 0).slice(0, 2);
  if (changed.length === 0) {
    return <p className="mt-1 text-[11px] text-muted">No finding changes</p>;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] tabular-nums">
      {changed.map((delta) => (
        <span
          key={delta.label}
          className={Number(delta.value) > 0 ? 'text-danger' : 'text-success'}
        >
          {Number(delta.value) > 0 ? '+' : ''}
          {delta.value} {delta.label}
        </span>
      ))}
    </div>
  );
}

function MobileImageStatusCard({
  item,
  scans,
  onOpen,
}: {
  item: StatusPageItem;
  scans?: StatusPageScanSummary[];
  onOpen: (item: StatusPageItem) => void;
}) {
  const totalFindings = getFindingTotal(item);

  return (
    <Card className="border border-divider/70 bg-surface/70 p-4 shadow-sm" variant="secondary">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted">
            <PackageIcon size={17} aria-hidden />
          </span>
          <div className="min-w-0">
            <button
              type="button"
              className="block max-w-full truncate text-left text-sm font-semibold text-foreground hover:underline"
              onClick={() => onOpen(item)}
            >
              {item.image_name}
            </button>
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted">{item.image_tag}</p>
          </div>
        </div>
        <Button
          isIconOnly
          aria-label={`View scan history for ${item.image_name}:${item.image_tag}`}
          size="sm"
          variant="tertiary"
          onPress={() => onOpen(item)}
        >
          <ArrowRight01Icon size={16} aria-hidden />
        </Button>
      </div>

      <div className="mt-3">
        <ImageStatusChips item={item} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-muted">Critical</p>
          <p className="mt-0.5 font-semibold tabular-nums text-danger">{item.critical_count}</p>
        </div>
        <div>
          <p className="text-muted">High</p>
          <p className="mt-0.5 font-semibold tabular-nums text-warning">{item.high_count}</p>
        </div>
        <div>
          <p className="text-muted">All findings</p>
          <p className="mt-0.5 font-semibold tabular-nums text-foreground">{totalFindings}</p>
        </div>
      </div>
      <FindingDeltas item={item} />

      <div className="mt-4 border-t border-divider/70 pt-3">
        <RecentScanStrip compact item={item} onOpen={onOpen} scans={scans} />
        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted">
          <span>{formatScanner(item.scan_provider)}</span>
          <span>Scanned {timeAgo(item.observed_at)}</span>
        </div>
      </div>
    </Card>
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
        <div className="flex h-12 items-center gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton
              key={index}
              className={`size-4 shrink-0 rounded-full ${index < 4 ? 'mr-auto' : ''}`}
            />
          ))}
        </div>
      ) : (
        <div
          className="flex w-full items-center py-1"
          role="radiogroup"
          aria-label="Scan history timeline"
        >
          {ordered.map((scan, i) => {
            const { color } = getScanHistoryMeta(scan);
            const isSelected = scan.scan_id === selectedId;

            return (
              <div key={scan.scan_id} className="contents">
                {i > 0 && (
                  <div
                    className="h-px min-w-3 flex-1"
                    style={{ background: 'var(--border-subtle)' }}
                  />
                )}

                {/* Touch target wraps a smaller visual dot */}
                <Tooltip delay={100}>
                  <Tooltip.Trigger aria-label={formatScanHistoryOptionLabel(scan)}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => onSelect(scan.scan_id)}
                      onFocus={() => setHoveredId(scan.scan_id)}
                      onBlur={() => setHoveredId(null)}
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
                  </Tooltip.Trigger>
                  <Tooltip.Content showArrow>
                    <Tooltip.Arrow />
                    {formatScanHistoryOptionLabel(scan)}
                  </Tooltip.Content>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      {/* Info strip - updates on hover, shows selected when not hovering */}
      {infoScan &&
        (() => {
          const { color } = getScanHistoryMeta(infoScan);
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

function StatusItemHistoryModal({
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
  const [historyResponseKey, setHistoryResponseKey] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [scanAccess, setScanAccess] = useState<'checking' | 'allowed' | 'denied'>('checking');
  const [fetchedSelectedScan, setFetchedSelectedScan] = useState<{
    scanId: string;
    scan: StatusPageScanSummary | null;
  }>({ scanId: '', scan: null });

  const historyRequestKey = item?.latest_scan_id ? `${slug}:${item.latest_scan_id}` : '';
  const historyLoading = Boolean(historyRequestKey) && historyResponseKey !== historyRequestKey;
  const historyMatch = useMemo(
    () => history.find((scan) => scan.scan_id === selectedScanId) ?? null,
    [history, selectedScanId]
  );
  const selectedScan =
    historyMatch ??
    (fetchedSelectedScan.scanId === selectedScanId ? fetchedSelectedScan.scan : null);
  const displayedScan = selectedScan ?? item;
  const scanDetailsHref =
    scanAccess === 'allowed' && selectedScanId ? `/scans/${selectedScanId}` : '';
  const totalFindings = displayedScan
    ? displayedScan.critical_count +
      displayedScan.high_count +
      displayedScan.medium_count +
      displayedScan.low_count
    : 0;

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
        if (scans.length > 0) onHistoryLoaded?.(item.latest_scan_id, scans);
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
  }, [historyMatch, selectedScanId, slug]);

  useEffect(() => {
    if (!selectedScanId || !getToken()) {
      const cancelDenied = deferEffect(() => setScanAccess('denied'));
      return cancelDenied;
    }

    let cancelled = false;
    const cancelChecking = deferEffect(() => setScanAccess('checking'));
    getScan(selectedScanId)
      .then(() => {
        if (!cancelled) setScanAccess('allowed');
      })
      .catch(() => {
        if (!cancelled) setScanAccess('denied');
      });

    return () => {
      cancelled = true;
      cancelChecking();
    };
  }, [selectedScanId]);

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center">
          <Modal.Dialog className="surface-modal w-[min(720px,calc(100vw-1.5rem))] max-w-none overflow-hidden rounded-[28px]">
            <Modal.Body className="space-y-4 p-4 sm:p-6">
              <Card className="border border-divider/70" variant="default">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-muted">
                      <PackageIcon size={18} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                        Scan history
                      </p>
                      <h3 className="mt-1 truncate font-mono text-sm font-semibold text-foreground sm:text-base">
                        {item?.image_name ?? 'Loading image'}
                      </h3>
                      {item ? (
                        <p className="mt-1 truncate font-mono text-xs text-muted">
                          {item.image_tag}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {selectedScan ? (
                      <>
                        <Chip
                          color={getPolicyDecisionMeta(getPolicyDecision(selectedScan)).color}
                          size="sm"
                          variant="soft"
                        >
                          <Chip.Label>
                            {getPolicyDecisionMeta(getPolicyDecision(selectedScan)).label}
                          </Chip.Label>
                        </Chip>
                        <StatusBadge
                          externalStatus={selectedScan.external_status}
                          status={selectedScan.scan_status}
                        />
                      </>
                    ) : item ? (
                      <ImageStatusChips item={item} />
                    ) : null}
                  </div>
                </div>
              </Card>

              <div className="space-y-4">
                {historyError ? (
                  <Card className="border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
                    {historyError}
                  </Card>
                ) : null}

                <ScanTimeline
                  isLoading={historyLoading}
                  onSelect={setSelectedScanId}
                  scans={history}
                  selectedId={selectedScanId}
                />

                {displayedScan ? (
                  <Card
                    className="border border-divider/70 bg-surface-secondary/70 p-4"
                    variant="secondary"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-muted">
                          {selectedScan?.is_latest === false ? 'Previous scan' : 'Latest scan'}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {formatScanner(displayedScan.scan_provider)} ·{' '}
                          {timeAgo(displayedScan.observed_at)}
                        </p>
                      </div>
                      <Chip size="sm" variant="secondary">
                        <Chip.Label>{totalFindings.toLocaleString()} findings</Chip.Label>
                      </Chip>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        {
                          label: 'Critical',
                          value: displayedScan.critical_count,
                          color: 'text-danger',
                        },
                        { label: 'High', value: displayedScan.high_count, color: 'text-warning' },
                        {
                          label: 'Medium',
                          value: displayedScan.medium_count,
                          color: 'text-warning',
                        },
                        { label: 'Low', value: displayedScan.low_count, color: 'text-muted' },
                      ].map((metric) => (
                        <div key={metric.label} className="rounded-xl bg-surface p-3">
                          <p className="text-[11px] font-medium text-muted">{metric.label}</p>
                          <p className={`mt-1 text-lg font-semibold tabular-nums ${metric.color}`}>
                            {metric.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Card>
                ) : null}

                {scanAccess === 'denied' ? (
                  <p className="text-xs leading-5 text-muted">
                    Scan details are only available when your JustScan account has access to this
                    scan.
                  </p>
                ) : null}
              </div>
            </Modal.Body>

            <Modal.Footer className="flex items-center justify-end gap-2 border-t border-divider/70 px-4 py-4 sm:px-6">
              <Button size="sm" variant="secondary" onPress={onClose}>
                Close
              </Button>
              {scanDetailsHref ? (
                <Link href={scanDetailsHref}>
                  <Button size="sm" variant="primary">
                    View scan details
                    <ArrowRight01Icon size={15} aria-hidden />
                  </Button>
                </Link>
              ) : scanAccess === 'checking' ? (
                <Button isPending size="sm" variant="primary">
                  Checking access
                </Button>
              ) : null}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function PublicStatusPageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-divider/70 bg-background/85">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-20 rounded" />
              <Skeleton className="h-3.5 w-32 rounded" />
            </div>
          </div>
          <Skeleton className="size-8 rounded-xl" />
        </div>
      </div>
      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="space-y-2">
          <Skeleton className="h-3 w-36 rounded" />
          <Skeleton className="h-8 w-64 rounded-lg" />
        </div>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </main>
    </div>
  );
}

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const { resolvedTheme, setTheme } = useTheme();
  const [data, setData] = useState<StatusPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [activeItem, setActiveItem] = useState<StatusPageItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ImageStatusFilter>('__all__');
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('__all__');
  const [rowScanHistory, setRowScanHistory] = useState<Record<string, StatusPageScanSummary[]>>({});
  const [isPageVisible, setIsPageVisible] = useState(true);
  const mountedRef = useRef(true);
  const filtersInitializedRef = useRef(false);
  const scanHistoryRequestsRef = useRef<Set<string> | null>(null);
  const historyModal = useOverlayState();
  const refreshClock = useTicker(1000);

  function openItemDetails(item: StatusPageItem) {
    setActiveItem(item);
    historyModal.open();
  }

  function closeItemDetails() {
    historyModal.close();
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
    const cancelMounted = deferEffect(() => setMounted(true));
    return () => {
      cancelMounted();
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const cancelDeferred = deferEffect(() => load(true));
    return cancelDeferred;
  }, [load]);

  useEffect(() => {
    if (!isPageVisible || historyModal.isOpen || !lastLoadedAt) return;
    const elapsed = Math.max(0, Date.now() - lastLoadedAt);
    const timeout = setTimeout(() => void load(false), Math.max(0, AUTO_REFRESH_MS - elapsed));
    return () => clearTimeout(timeout);
  }, [historyModal.isOpen, isPageVisible, lastLoadedAt, load]);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryStatus = params.get('state');
    const queryDecision = params.get('decision');
    return deferEffect(() => {
      setSearchQuery(params.get('q') ?? '');
      setStatusFilter(
        IMAGE_STATUS_FILTER_OPTIONS.some((option) => option.key === queryStatus)
          ? (queryStatus as ImageStatusFilter)
          : '__all__'
      );
      setDecisionFilter(
        DECISION_FILTER_OPTIONS.some((option) => option.key === queryDecision)
          ? (queryDecision as DecisionFilter)
          : '__all__'
      );
      filtersInitializedRef.current = true;
    });
  }, []);

  useEffect(() => {
    if (!filtersInitializedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const query = searchQuery.trim();
    if (query) params.set('q', query);
    else params.delete('q');
    if (statusFilter !== '__all__') params.set('state', statusFilter);
    else params.delete('state');
    if (decisionFilter !== '__all__') params.set('decision', decisionFilter);
    else params.delete('decision');

    const nextUrl = `${window.location.pathname}${params.size > 0 ? `?${params.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [decisionFilter, searchQuery, statusFilter]);

  const summary = useMemo(() => {
    const items = data?.items ?? [];
    return items.reduce(
      (acc, item) => {
        const operationalStatus = getPresentationStatus(item);
        const exposureStatus = getExposureStatus(item, operationalStatus);
        const hasOperationalIssue =
          operationalStatus === 'failed' ||
          operationalStatus === 'blocked_by_xray_policy' ||
          operationalStatus === 'stale';
        const hasPolicyFailure = item.compliance_status === 'fail';
        acc.total += 1;
        acc.attention +=
          operationalStatus === 'healthy' &&
          !hasPolicyFailure &&
          !isExposedStatus(exposureStatus)
            ? 0
            : 1;
        acc.issues += hasOperationalIssue || hasPolicyFailure ? 1 : 0;
        acc.policyFailed += hasPolicyFailure ? 1 : 0;
        acc.critical += item.critical_count;
        acc.high += item.high_count;
        acc.medium += item.medium_count;
        acc.low += item.low_count;
        acc.findings += getFindingTotal(item);
        acc.stale += operationalStatus === 'stale' ? 1 : 0;
        acc.healthy += isClearStatus(item, operationalStatus) ? 1 : 0;
        acc.scanning += ACTIVE_SCAN_STATUSES.has(operationalStatus) ? 1 : 0;
        acc.operations[operationalStatus] = (acc.operations[operationalStatus] ?? 0) + 1;
        acc.exposure[exposureStatus] = (acc.exposure[exposureStatus] ?? 0) + 1;
        return acc;
      },
      {
        total: 0,
        attention: 0,
        issues: 0,
        policyFailed: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        findings: 0,
        stale: 0,
        healthy: 0,
        scanning: 0,
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
    return trackedItems.filter((item) => {
      const operationalStatus = getPresentationStatus(item);
      const exposureStatus = getExposureStatus(item, operationalStatus);
      const decision = getPolicyDecision(item);
      const decisionLabel = getPolicyDecisionMeta(decision).label.toLowerCase();
      const matchesSearch =
        !query ||
        item.image_name.toLowerCase().includes(query) ||
        item.image_tag.toLowerCase().includes(query) ||
        `${item.image_name}:${item.image_tag}`.toLowerCase().includes(query) ||
        formatStatusLabel(operationalStatus).toLowerCase().includes(query) ||
        formatScanner(item.scan_provider).toLowerCase().includes(query) ||
        decisionLabel.includes(query);
      const matchesDecision = decisionFilter === '__all__' || decision === decisionFilter;
      const matchesStatus =
        statusFilter === '__all__' ||
        (statusFilter === 'issues' &&
          (operationalStatus === 'failed' ||
            operationalStatus === 'blocked_by_xray_policy' ||
            operationalStatus === 'stale' ||
            item.compliance_status === 'fail')) ||
        (statusFilter === 'healthy' && isClearStatus(item, operationalStatus)) ||
        (statusFilter === 'scanning' && ACTIVE_SCAN_STATUSES.has(operationalStatus)) ||
        (statusFilter === 'exposed' && isExposedStatus(exposureStatus));

      return matchesSearch && matchesDecision && matchesStatus;
    });
  }, [decisionFilter, searchQuery, statusFilter, trackedItems]);

  useEffect(() => {
    const requestedScanIds =
      scanHistoryRequestsRef.current ?? (scanHistoryRequestsRef.current = new Set<string>());

    filteredTrackedItems.forEach((item) => {
      const scanId = item.latest_scan_id;
      if (!scanId || rowScanHistory[scanId] !== undefined || requestedScanIds.has(scanId)) {
        return;
      }

      requestedScanIds.add(scanId);
      listStatusPageScanHistory(slug, scanId)
        .then((scans) => {
          if (!mountedRef.current) return;
          setRowScanHistory((current) => ({ ...current, [scanId]: scans }));
        })
        .catch(() => {
          if (!mountedRef.current) return;
          setRowScanHistory((current) => ({ ...current, [scanId]: [] }));
        });
    });
  }, [filteredTrackedItems, rowScanHistory, slug]);

  const activeUpdates = useMemo(() => {
    return [...(data?.page.updates ?? [])].toSorted(
      (left, right) =>
        new Date(right.created_at ?? right.updated_at ?? 0).getTime() -
        new Date(left.created_at ?? left.updated_at ?? 0).getTime()
    );
  }, [data?.page.updates]);

  const hasImageFilters =
    searchQuery.trim().length > 0 || statusFilter !== '__all__' || decisionFilter !== '__all__';
  const statusFilterLabel = IMAGE_STATUS_FILTER_OPTIONS.find(
    (option) => option.key === statusFilter
  )?.label;
  const decisionFilterLabel = DECISION_FILTER_OPTIONS.find(
    (option) => option.key === decisionFilter
  )?.label;

  function clearImageFilters() {
    setSearchQuery('');
    setStatusFilter('__all__');
    setDecisionFilter('__all__');
  }

  function selectMetricFilter(key: string) {
    setSearchQuery('');
    if (key.startsWith('decision:')) {
      const nextDecision = key.replace('decision:', '') as DecisionFilter;
      setStatusFilter('__all__');
      setDecisionFilter(decisionFilter === nextDecision ? '__all__' : nextDecision);
      return;
    }

    const nextStatus = key.replace('status:', '') as ImageStatusFilter;
    setDecisionFilter('__all__');
    setStatusFilter(statusFilter === nextStatus ? '__all__' : nextStatus);
  }

  const activeMetricKey =
    searchQuery.trim().length > 0
      ? undefined
      : decisionFilter !== '__all__' && statusFilter === '__all__'
        ? `decision:${decisionFilter}`
        : statusFilter !== '__all__' && decisionFilter === '__all__'
          ? `status:${statusFilter}`
          : undefined;

  const decisionSummary = useMemo(() => {
    return trackedItems.reduce(
      (acc, item) => {
        const decision = getPolicyDecision(item);
        acc[decision] += 1;
        return acc;
      },
      { passed: 0, failed: 0, not_evaluated: 0 }
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
    return <PublicStatusPageSkeleton />;
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

  const issueCount = summary.issues;
  const policyFailureCount = summary.policyFailed;
  const exposedCount = (summary.exposure.high_risk ?? 0) + (summary.exposure.findings_present ?? 0);
  const runningCount = summary.scanning;
  const healthyCount = summary.healthy;
  const activeIncidentCount = activeUpdates.filter((update) => update.level === 'incident').length;
  const activeMaintenanceCount = activeUpdates.filter(
    (update) => update.level === 'maintenance'
  ).length;
  const { secondsRemaining } = getRefreshCadence(lastLoadedAt, refreshClock);
  const pageTone =
    activeIncidentCount > 0
      ? {
          label: 'Active Incident',
          color: STATUS_COLOR.failed,
          description: `${activeIncidentCount} active incident notice${activeIncidentCount === 1 ? '' : 's'} currently require attention.`,
        }
      : issueCount > 0
        ? {
            label: 'Investigating Issues',
            color: STATUS_COLOR.failed,
            description: `${summary.operations.failed ?? 0} scan failed, ${summary.operations.blocked_by_xray_policy ?? 0} Xray blocked, ${policyFailureCount} org policy failed, and ${summary.operations.stale ?? 0} stale snapshot${issueCount === 1 ? '' : 's'} currently need attention.`,
          }
        : activeMaintenanceCount > 0
          ? {
              label: 'Maintenance In Progress',
              color: STATUS_COLOR.blocked_by_xray_policy,
              description: `${activeMaintenanceCount} active maintenance notice${activeMaintenanceCount === 1 ? '' : 's'} may affect tracked images.`,
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
  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.38] dark:opacity-[0.24]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--accent) 22%, transparent) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 12% 4%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 24%), radial-gradient(circle at 88% 12%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 22%)',
        }}
      />

      <PublicStatusHeader
        isDark={isDark}
        latestObservedAt={latestObservedAt}
        mounted={mounted}
        onRefresh={() => void load(false)}
        onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
        pageName={data.page.name}
        refreshing={refreshing}
        visibility={data.page.visibility}
      />

      <main className="relative z-10 mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-muted">
              <Shield01Icon size={15} aria-hidden />
              Container image status
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {data.page.name}
            </h1>
            {showHeaderDescription ? (
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">{headerDescription}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Chip className="capitalize sm:hidden" size="sm" variant="secondary">
              <Chip.Label>{data.page.visibility}</Chip.Label>
            </Chip>
            <Chip className="lg:hidden" size="sm" variant="secondary">
              <Chip.Label>
                Updated {latestObservedAt ? timeAgo(latestObservedAt) : 'pending'}
              </Chip.Label>
            </Chip>
          </div>
        </section>

        <OverallStatusBanner
          autoRefreshPaused={!isPageVisible || historyModal.isOpen}
          exposedCount={exposedCount}
          healthyCount={healthyCount}
          issueCount={issueCount}
          refreshing={refreshing}
          runningCount={runningCount}
          secondsRemaining={secondsRemaining}
          staleAfterHours={data.page.stale_after_hours}
          tone={pageTone}
        />

        <StatusMetrics
          activeKey={activeMetricKey}
          metrics={[
            {
              key: 'decision:passed',
              label: 'Policy passed',
              value: decisionSummary.passed,
              color: 'success',
            },
            {
              key: 'decision:failed',
              label: 'Policy failed',
              value: decisionSummary.failed,
              color: 'danger',
            },
            {
              key: 'decision:not_evaluated',
              label: 'Not evaluated',
              value: decisionSummary.not_evaluated,
              color: 'default',
            },
            { key: 'status:scanning', label: 'Scanning', value: runningCount, color: 'accent' },
            {
              key: 'status:exposed',
              label: 'Total findings',
              value: summary.findings,
              color: 'default',
            },
          ]}
          onSelect={selectMetricFilter}
        />

        <ActiveStatusUpdates updates={activeUpdates} />

        <Card
          className="overflow-hidden border border-divider/70 bg-surface/70 p-0 shadow-sm"
          variant="secondary"
        >
          <div className="border-b border-divider/70 p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <PackageIcon size={17} className="text-muted" aria-hidden />
                  <h2 className="text-base font-semibold text-foreground">Scanned images</h2>
                  <Chip size="sm" variant="secondary">
                    <Chip.Label>
                      {filteredTrackedItems.length}
                      {filteredTrackedItems.length !== trackedItems.length
                        ? ` of ${trackedItems.length}`
                        : ''}
                    </Chip.Label>
                  </Chip>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Latest operational state, org policy result, findings, and scan history.
                </p>
              </div>

              <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:grid-cols-[minmax(260px,1fr)_190px_170px_auto]">
                <SearchField
                  aria-label="Search images"
                  className="sm:col-span-2 xl:col-span-1"
                  value={searchQuery}
                  variant="secondary"
                  onChange={setSearchQuery}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="Search image, tag, scanner..." />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <Select
                  aria-label="Filter images by state"
                  variant="secondary"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(String(value) as ImageStatusFilter)}
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {IMAGE_STATUS_FILTER_OPTIONS.map((option) => (
                        <ListBox.Item id={option.key} key={option.key} textValue={option.label}>
                          {option.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Select
                  aria-label="Filter images by organization policy result"
                  variant="secondary"
                  value={decisionFilter}
                  onChange={(value) => setDecisionFilter(String(value) as DecisionFilter)}
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {DECISION_FILTER_OPTIONS.map((option) => (
                        <ListBox.Item id={option.key} key={option.key} textValue={option.label}>
                          {option.label}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <Button
                  isDisabled={!hasImageFilters}
                  variant="tertiary"
                  onPress={clearImageFilters}
                >
                  Clear
                </Button>
              </div>
            </div>
            {hasImageFilters ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-muted">Active filters</span>
                {searchQuery.trim() ? (
                  <Button
                    className="h-7 px-2 text-[11px]"
                    size="sm"
                    variant="secondary"
                    onPress={() => setSearchQuery('')}
                  >
                    Search: {searchQuery.trim()}
                    <Cancel01Icon size={13} aria-hidden />
                  </Button>
                ) : null}
                {statusFilter !== '__all__' ? (
                  <Button
                    className="h-7 px-2 text-[11px]"
                    size="sm"
                    variant="secondary"
                    onPress={() => setStatusFilter('__all__')}
                  >
                    {statusFilterLabel}
                    <Cancel01Icon size={13} aria-hidden />
                  </Button>
                ) : null}
                {decisionFilter !== '__all__' ? (
                  <Button
                    className="h-7 px-2 text-[11px]"
                    size="sm"
                    variant="secondary"
                    onPress={() => setDecisionFilter('__all__')}
                  >
                    {decisionFilterLabel}
                    <Cancel01Icon size={13} aria-hidden />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 p-3 md:hidden">
            {filteredTrackedItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted">
                {trackedItems.length === 0
                  ? 'No images are currently tracked.'
                  : 'No images match the current filters.'}
              </div>
            ) : (
              filteredTrackedItems.map((item) => (
                <MobileImageStatusCard
                  item={item}
                  key={`${item.image_name}:${item.image_tag}`}
                  onOpen={openItemDetails}
                  scans={rowScanHistory[item.latest_scan_id]}
                />
              ))
            )}
          </div>

          <div className="hidden md:block">
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Image policy status table" className="min-w-[1100px]">
                  <Table.Header>
                    <Table.Column isRowHeader>Image</Table.Column>
                    <Table.Column>State</Table.Column>
                    <Table.Column>Findings</Table.Column>
                    <Table.Column>14 days</Table.Column>
                    <Table.Column>Scanner</Table.Column>
                    <Table.Column>Last scan</Table.Column>
                    <Table.Column>Action</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {filteredTrackedItems.length === 0 ? (
                      <Table.Row id="empty">
                        <Table.Cell colSpan={7}>
                          <div className="py-12 text-center text-sm text-muted">
                            {trackedItems.length === 0
                              ? 'No images are currently tracked.'
                              : 'No images match the current filters.'}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ) : (
                      filteredTrackedItems.map((item) => (
                        <Table.Row
                          key={`${item.image_name}:${item.image_tag}`}
                          id={`${item.image_name}:${item.image_tag}`}
                          className="hover:bg-surface-secondary"
                        >
                          <Table.Cell>
                            <div className="flex max-w-[420px] items-start gap-3">
                              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-muted">
                                <PackageIcon size={15} aria-hidden />
                              </span>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  className="block max-w-full truncate text-left text-sm font-semibold text-foreground hover:underline"
                                  onClick={() => openItemDetails(item)}
                                >
                                  {item.image_name}
                                </button>
                                <p className="mt-0.5 truncate font-mono text-[11px] text-muted">
                                  {item.image_tag}
                                </p>
                              </div>
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <ImageStatusChips item={item} />
                          </Table.Cell>
                          <Table.Cell>
                            <div>
                              <div className="flex items-center gap-3 text-xs tabular-nums">
                                <span className="text-danger">{item.critical_count} critical</span>
                                <span className="text-warning">{item.high_count} high</span>
                                <span className="text-muted">{getFindingTotal(item)} total</span>
                              </div>
                              <FindingDeltas item={item} />
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <RecentScanStrip
                              compact
                              item={item}
                              onOpen={openItemDetails}
                              scans={rowScanHistory[item.latest_scan_id]}
                            />
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-xs text-muted">
                              {formatScanner(item.scan_provider)}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-xs text-muted">{timeAgo(item.observed_at)}</span>
                          </Table.Cell>
                          <Table.Cell>
                            <Button
                              isIconOnly
                              aria-label={`View scan history for ${item.image_name}:${item.image_tag}`}
                              size="sm"
                              variant="tertiary"
                              onPress={() => openItemDetails(item)}
                            >
                              <ArrowRight01Icon size={16} aria-hidden />
                            </Button>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    )}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </div>
        </Card>
      </main>

      {activeItem && historyModal.isOpen && (
        <StatusItemHistoryModal
          key={`${activeItem.image_name}:${activeItem.image_tag}`}
          slug={slug}
          item={activeItem}
          state={historyModal}
          onClose={closeItemDetails}
          onHistoryLoaded={syncRowHistory}
        />
      )}
    </div>
  );
}
