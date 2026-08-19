import type { WatchlistItem } from '@/lib/api';

export type WatchlistPostureKind =
  | 'policy_failed'
  | 'blocked'
  | 'scan_failed'
  | 'intelligence_pending'
  | 'running'
  | 'compliant'
  | 'no_policy'
  | 'never_scanned'
  | 'disabled';

export interface WatchlistPosture {
  kind: WatchlistPostureKind;
  label: string;
  description: string;
  tone: 'success' | 'warning' | 'danger' | 'accent' | 'neutral';
}

export function getWatchlistPosture(item: WatchlistItem): WatchlistPosture {
  if (!item.enabled) {
    return {
      kind: 'disabled',
      label: 'Disabled',
      description: 'Schedule is paused',
      tone: 'neutral',
    };
  }

  const scan = item.last_scan;
  if (!scan && !item.last_scan_id) {
    return {
      kind: 'never_scanned',
      label: 'Never scanned',
      description: 'No scan result exists yet',
      tone: 'warning',
    };
  }

  if (scan?.external_status === 'blocked_by_xray_policy') {
    return {
      kind: 'blocked',
      label: 'Xray blocked',
      description: 'Last scan was blocked by an Xray policy',
      tone: 'danger',
    };
  }

  if (item.compliance_summary?.status === 'fail') {
    const names = item.compliance_summary.failed_policy_names ?? [];
    return {
      kind: 'policy_failed',
      label: 'Policy failed',
      description:
        names.length > 0
          ? names.slice(0, 3).join(', ')
          : `${item.compliance_summary.fail_count} policy result${item.compliance_summary.fail_count === 1 ? '' : 's'} failed`,
      tone: 'danger',
    };
  }

  if (scan?.status === 'failed') {
    return {
      kind: 'scan_failed',
      label: 'Scan failed',
      description: scan.error_message || 'Last scan did not complete',
      tone: 'danger',
    };
  }

  if (scan?.status === 'running' || scan?.status === 'pending') {
    return {
      kind: 'running',
      label: scan.status === 'pending' ? 'Queued' : 'Running',
      description: scan.current_step ? scan.current_step.replace(/_/g, ' ') : 'Scan in progress',
      tone: 'accent',
    };
  }

  if (item.intelligence_summary?.state === 'confirmation_pending') {
    const count = item.intelligence_summary.changed_cve_count;
    return {
      kind: 'intelligence_pending',
      label: 'CVE confirmation pending',
      description: `${count} CVE${count === 1 ? '' : 's'} changed; run the next scan to confirm posture`,
      tone: 'warning',
    };
  }

  if (item.compliance_summary?.status === 'pass') {
    return {
      kind: 'compliant',
      label: 'Compliant',
      description: `${item.compliance_summary.pass_count} policy result${item.compliance_summary.pass_count === 1 ? '' : 's'} passed`,
      tone: 'success',
    };
  }

  return {
    kind: 'no_policy',
    label: 'No policy results',
    description: 'No organization policy evaluated this scan',
    tone: 'neutral',
  };
}

export function watchlistNeedsPolicyAttention(item: WatchlistItem) {
  const posture = getWatchlistPosture(item);
  return (
    posture.kind === 'blocked' ||
    posture.kind === 'policy_failed' ||
    posture.kind === 'scan_failed' ||
    item.intelligence_summary?.state === 'confirmation_pending'
  );
}

export function watchlistNeedsIntelligenceConfirmation(item: WatchlistItem) {
  return item.enabled && item.intelligence_summary?.state === 'confirmation_pending';
}

export function getWatchlistPolicyAttentionItems(items: WatchlistItem[]) {
  return items
    .filter((item) => item.enabled && watchlistNeedsPolicyAttention(item))
    .sort((left, right) => {
      const rank = (item: WatchlistItem) => {
        const kind = getWatchlistPosture(item).kind;
        if (kind === 'blocked') return 0;
        if (kind === 'policy_failed') return 1;
        if (kind === 'scan_failed') return 2;
        return 3;
      };
      const rankDiff = rank(left) - rank(right);
      if (rankDiff !== 0) return rankDiff;
      const leftTime = Date.parse(left.last_scanned_at ?? left.last_scan?.completed_at ?? '');
      const rightTime = Date.parse(right.last_scanned_at ?? right.last_scan?.completed_at ?? '');
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });
}
