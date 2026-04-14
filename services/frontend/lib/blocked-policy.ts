import type { BlockedPolicyDetails, BlockedPolicyIgnoreRuleStatus, BlockedPolicyMatchedWatch } from '@/lib/api';

export type BlockedPolicyDetailsView = {
  summary: string;
  manifest?: string;
  artifact?: string;
  jfrog?: string;
  matchedIssues: string[];
  matchedWatches: Array<{ name: string; ignoreRuleStatus: BlockedPolicyIgnoreRuleStatus }>;
  blockingPolicies: string[];
  matchedPolicies: string[];
  totalViolations?: number;
};

export function getBlockedPolicyDetails(
  externalStatus?: string | null,
  blockedPolicyDetails?: BlockedPolicyDetails | null,
  errorMessage?: string | null,
): BlockedPolicyDetailsView | null {
  if (externalStatus !== 'blocked_by_xray_policy') {
    return null;
  }

  if (blockedPolicyDetails) {
    return normalizeBlockedPolicyDetails(blockedPolicyDetails);
  }

  return parseLegacyBlockedPolicyDetails(errorMessage);
}

export function countBlockedPolicyList(values?: string[] | BlockedPolicyMatchedWatch[] | Array<{ name: string }> | null) {
  return values?.length ?? 0;
}

export function compactBlockedPolicyList(values?: string[] | BlockedPolicyMatchedWatch[] | Array<{ name: string }> | null, maxItems = 2) {
  if (!values || values.length === 0) return '';
  const labels = values.map((value) => typeof value === 'string' ? value : value.name);
  if (labels.length <= maxItems) return labels.join(', ');
  return `${labels.slice(0, maxItems).join(', ')} +${labels.length - maxItems} more`;
}

export function formatIgnoreRuleStatusLabel(status: BlockedPolicyIgnoreRuleStatus) {
  switch (status) {
    case 'active_ignore':
      return 'Active ignore';
    case 'status_unavailable':
      return 'Status unavailable';
    default:
      return 'No ignore';
  }
}

function normalizeBlockedPolicyDetails(details: BlockedPolicyDetails): BlockedPolicyDetailsView {
  return {
    summary: details.summary,
    manifest: details.manifest || undefined,
    artifact: details.artifact || undefined,
    jfrog: details.jfrog || undefined,
    matchedIssues: details.matched_issues ?? [],
    matchedWatches: (details.matched_watches ?? []).map((watch) => ({
      name: watch.name,
      ignoreRuleStatus: watch.ignore_rule_status,
    })),
    blockingPolicies: details.blocking_policies ?? [],
    matchedPolicies: details.matched_policies ?? [],
    totalViolations: details.total_violations,
  };
}

function parseLegacyBlockedPolicyDetails(errorMessage?: string | null): BlockedPolicyDetailsView | null {
  const message = errorMessage?.trim();
  if (!message) return null;

  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const details: BlockedPolicyDetailsView = {
    summary: lines[0],
    matchedIssues: [],
    matchedWatches: [],
    blockingPolicies: [],
    matchedPolicies: [],
  };

  for (const line of lines.slice(1)) {
    if (line.startsWith('Manifest: ')) details.manifest = line.slice('Manifest: '.length);
    else if (line.startsWith('Artifact: ')) details.artifact = line.slice('Artifact: '.length);
    else if (line.startsWith('JFrog: ')) details.jfrog = line.slice('JFrog: '.length);
    else if (line.startsWith('Matched issues: ')) details.matchedIssues = splitDelimitedValues(line.slice('Matched issues: '.length));
    else if (line.startsWith('Matched watches: ')) {
      details.matchedWatches = splitDelimitedValues(line.slice('Matched watches: '.length)).map((name) => ({
        name,
        ignoreRuleStatus: 'status_unavailable' as const,
      }));
    }
    else if (line.startsWith('Blocking policies: ')) details.blockingPolicies = splitDelimitedValues(line.slice('Blocking policies: '.length));
    else if (line.startsWith('Matched policies: ')) details.matchedPolicies = splitDelimitedValues(line.slice('Matched policies: '.length));
    else if (line.startsWith('Xray violations found for this artifact: ')) {
      const parsed = Number(line.slice('Xray violations found for this artifact: '.length).trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        details.totalViolations = parsed;
      }
    }
  }

  const hasStructuredDetails = Boolean(
    details.manifest ||
    details.artifact ||
    details.jfrog ||
    details.matchedIssues.length ||
    details.matchedWatches.length ||
    details.blockingPolicies.length ||
    details.matchedPolicies.length ||
    details.totalViolations,
  );

  return hasStructuredDetails ? details : null;
}

function splitDelimitedValues(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}