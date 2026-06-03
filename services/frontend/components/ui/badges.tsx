'use client';

import { Chip } from '@heroui/react';

import { useWorkScope } from '@/hooks/use-work-scope';
import type { OwnerType } from '@/lib/api';
import { cn } from '@/lib/utils';

type BadgeTone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

type BadgeConfig = {
  tone: BadgeTone;
  label?: string;
  animated?: boolean;
};

function SemanticBadge({
  label,
  tone,
  className,
  animated = false,
  title,
}: {
  label: string;
  tone: BadgeTone;
  className?: string;
  animated?: boolean;
  title?: string;
}) {
  return (
    <Chip
      className={cn('gap-1.5 text-xs font-medium', className)}
      color={tone}
      size="sm"
      title={title}
      variant="soft"
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full bg-current',
            animated ? 'animate-pulse' : undefined
          )}
        />
        {label}
      </span>
    </Chip>
  );
}

const STATUS_ALIASES: Record<string, string> = {
  warming_artifactory_cache: 'warming_cache',
  indexing: 'indexing_artifact',
  queued: 'queued_in_xray',
};

const STATUS_CONFIG: Record<string, BadgeConfig> = {
  healthy: { tone: 'success' },
  degraded: { tone: 'warning' },
  stale: { tone: 'warning' },
  completed: { tone: 'success' },
  failed: { tone: 'danger' },
  running: { tone: 'accent', animated: true },
  pending: { tone: 'default', label: 'queued' },
  cancelled: { tone: 'warning' },
  warming_cache: { tone: 'accent', label: 'warming cache', animated: true },
  indexing_artifact: { tone: 'warning', label: 'indexing artifact', animated: true },
  queued_in_xray: { tone: 'accent', label: 'queued in xray', animated: true },
  blocked_by_xray_policy: { tone: 'warning', label: 'blocked by xray policy' },
  waiting_for_xray: { tone: 'warning', label: 'waiting for xray', animated: true },
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

  if (
    (normalizedStatus === 'pending' || normalizedStatus === 'running') &&
    normalizedExternalStatus &&
    normalizedExternalStatus !== normalizedStatus
  ) {
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

export function StatusBadge({
  status,
  externalStatus,
}: {
  status: string;
  externalStatus?: string;
}) {
  const effectiveStatus = resolveDisplayStatus(status, externalStatus);
  const config = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.pending;

  return (
    <SemanticBadge
      animated={config.animated}
      label={config.label ?? formatStatusLabel(effectiveStatus)}
      title={formatStatusLabel(effectiveStatus)}
      tone={config.tone}
    />
  );
}

const SEVERITY_CONFIG: Record<string, { label: string; tone: BadgeTone }> = {
  CRITICAL: { label: 'Critical', tone: 'danger' },
  HIGH: { label: 'High', tone: 'warning' },
  MEDIUM: { label: 'Medium', tone: 'accent' },
  LOW: { label: 'Low', tone: 'default' },
  UNKNOWN: { label: 'Unknown', tone: 'default' },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.UNKNOWN;

  return (
    <Chip color={config.tone} size="sm" variant="soft">
      {config.label}
    </Chip>
  );
}

const SEVERITY_COUNT_TONES: Record<'critical' | 'high' | 'medium' | 'low', BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'accent',
  low: 'default',
};

export function SevCount({
  count,
  level,
}: {
  count: number;
  level: 'critical' | 'high' | 'medium' | 'low';
}) {
  const tone = count > 0 ? SEVERITY_COUNT_TONES[level] : 'default';

  return (
    <Chip className="min-w-10 justify-center tabular-nums" color={tone} size="sm" variant="soft">
      {count}
    </Chip>
  );
}

export function SourceBadge({ source }: { source?: string }) {
  const normalized = (source ?? '').trim().toLowerCase();
  const isOSV = normalized === 'osv.dev';
  const isXray = normalized === 'jfrog xray' || normalized === 'xray';
  const label = isOSV ? 'OSV.dev' : isXray ? 'Xray' : source?.trim() || 'Trivy';
  const tone: BadgeTone = isOSV ? 'accent' : isXray ? 'warning' : 'default';
  const title =
    source ||
    (isOSV ? 'OSV supplemental finding' : isXray ? 'JFrog Xray finding' : 'Scanner finding');

  return (
    <Chip color={tone} size="sm" title={title} variant="soft">
      {label}
    </Chip>
  );
}

export function SuppressionSourceBadge({ source }: { source?: string }) {
  const normalized = (source ?? 'local').trim().toLowerCase();
  const label = normalized === 'xray' ? 'Xray' : normalized === 'mixed' ? 'Mixed' : 'Local';
  const tone: BadgeTone =
    normalized === 'xray' ? 'warning' : normalized === 'mixed' ? 'default' : 'accent';

  return (
    <Chip color={tone} size="sm" title={`Suppression source: ${label}`} variant="soft">
      {label}
    </Chip>
  );
}

const OWNERSHIP_TONE: Record<'user' | 'org' | 'system', BadgeTone> = {
  user: 'default',
  org: 'accent',
  system: 'warning',
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
  const workScope = useWorkScope();
  const resolvedType = ownerType === 'org' || ownerType === 'system' ? ownerType : 'user';
  const orgName = ownerOrgId ? orgNamesById?.[ownerOrgId] : undefined;
  const isSharedIntoCurrentOrg = workScope.kind === 'org' && resolvedType === 'user';
  const label = isSharedIntoCurrentOrg
    ? 'User-owned'
    : resolvedType === 'org'
      ? orgName
        ? `Org: ${orgName}`
        : 'Organization'
      : resolvedType === 'system'
        ? 'System'
        : 'Personal';

  return (
    <Chip className={className} color={OWNERSHIP_TONE[resolvedType]} size="sm" variant="soft">
      {label}
    </Chip>
  );
}
