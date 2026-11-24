import type { Vulnerability } from '@/lib/api';

type XrayWatchPolicyMatch = {
  watchName: string;
  watchID: string;
  policy: string;
  rule: string;
  isBlocking: boolean;
  isBuildFailed: boolean;
  failPullRequest: boolean;
};

function parseXrayWatchPolicyMatches(vulnerability: Vulnerability): XrayWatchPolicyMatch[] {
  const raw = vulnerability.xray_watch_policy_matches;
  if (!Array.isArray(raw)) return [];

  const deduped = new Map<string, XrayWatchPolicyMatch>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const match: XrayWatchPolicyMatch = {
      watchName: text(row.watch_name),
      watchID: text(row.watch_id),
      policy: text(row.policy),
      rule: text(row.rule),
      isBlocking: row.is_blocking === true,
      isBuildFailed: row.is_build_failed === true,
      failPullRequest: row.fail_pull_request === true,
    };
    const key = [
      match.watchName.toLowerCase(),
      match.watchID.toLowerCase(),
      match.policy.toLowerCase(),
      match.rule.toLowerCase(),
      match.isBlocking,
      match.isBuildFailed,
      match.failPullRequest,
    ].join('|');
    if (!deduped.has(key)) deduped.set(key, match);
  }
  return Array.from(deduped.values());
}

function xrayWatchNames(vulnerability: Vulnerability): string[] {
  const names = [...(vulnerability.xray_watch_names ?? []), vulnerability.xray_watch_name ?? '']
    .map((name) => name.trim())
    .filter(Boolean);
  return Array.from(new Set(names));
}

/** Policy matches for one finding, or null when no registry policy applies. */
export function xrayPolicySummary(
  vulnerability: Vulnerability
): { count: number; blocking: boolean } | null {
  const matches = parseXrayWatchPolicyMatches(vulnerability);
  const watchCount = xrayWatchNames(vulnerability).length;
  if (matches.length === 0 && watchCount === 0 && !vulnerability.xray_is_blocking) return null;
  return {
    count: matches.length || watchCount || 1,
    blocking:
      vulnerability.xray_is_blocking === true ||
      matches.some((match) => match.isBlocking || match.isBuildFailed || match.failPullRequest),
  };
}

/** Moves findings that match a registry policy to the front, keeping their order. */
export function prioritizePolicyFindings(vulnerabilities: Vulnerability[]): Vulnerability[] {
  return vulnerabilities
    .map((vulnerability, index) => ({
      vulnerability,
      index,
      priority: xrayPolicySummary(vulnerability) ? 1 : 0,
    }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((entry) => entry.vulnerability);
}
