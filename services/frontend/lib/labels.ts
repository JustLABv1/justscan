/**
 * Display labels for values the backend stores as enums, keys, or IDs.
 *
 * Pages should never print a raw enum (`artifactory_xray`), event key
 * (`scan.create.batch`), or UUID. Use the helpers here so the same value reads
 * the same way everywhere.
 */

/** Turns `blocked_by_xray_policy` or `scan.create` into "Blocked by Xray policy" / "Scan create". */
export function humanize(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const words = raw
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => KNOWN_WORDS[word] ?? word);
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const KNOWN_WORDS: Record<string, string> = {
  xray: 'Xray',
  justscan: 'JustScan',
  api: 'API',
  ai: 'AI',
  mcp: 'MCP',
  oidc: 'OIDC',
  sso: 'SSO',
  cve: 'CVE',
  cves: 'CVEs',
  sbom: 'SBOM',
  ecr: 'ECR',
  aws: 'AWS',
  http: 'HTTP',
  https: 'HTTPS',
  oci: 'OCI',
  url: 'URL',
  id: 'ID',
  ci: 'CI',
  cli: 'CLI',
  helm: 'Helm',
  trivy: 'Trivy',
  grype: 'Grype',
  artifactory: 'Artifactory',
  git: 'Git',
};

/** Looks a value up in a label map, falling back to `humanize`. */
export function labelFor(map: Record<string, string>, value: string | null | undefined): string {
  const key = String(value ?? '').trim();
  if (!key) return '';
  return map[key] ?? map[key.toLowerCase()] ?? humanize(key);
}

export const SCAN_PROVIDER_LABELS: Record<string, string> = {
  trivy: 'Trivy',
  grype: 'Grype',
  artifactory_xray: 'Artifactory Xray',
  xray: 'Artifactory Xray',
  upload: 'Uploaded report',
};

export const AUTH_TYPE_LABELS: Record<string, string> = {
  none: 'No authentication',
  basic: 'Username and password',
  token: 'Token',
  aws_ecr: 'AWS ECR',
  bearer: 'Bearer token',
  local: 'Local account',
  oidc: 'Single sign-on',
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  user: 'User',
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
  member: 'Member',
};

export const VISIBILITY_LABELS: Record<string, string> = {
  private: 'Private',
  authenticated: 'Signed-in users',
  public: 'Public',
  workspace: 'Workspace',
  org: 'Organization',
  personal: 'Personal',
};

export const HEALTH_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  unhealthy: 'Unreachable',
  degraded: 'Degraded',
  unknown: 'Not checked',
  pending: 'Not checked',
};

/** Background jobs, notification queue items, deliveries, Helm and Git runs. */
export const JOB_STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  queued: 'Queued',
  running: 'Running',
  processing: 'Processing',
  completed: 'Completed',
  completed_partial: 'Partially completed',
  succeeded: 'Succeeded',
  success: 'Succeeded',
  delivered: 'Delivered',
  sent: 'Sent',
  failed: 'Failed',
  error: 'Failed',
  dead_letter: 'Gave up after retries',
  retrying: 'Retrying',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
  disabled: 'Disabled',
  enabled: 'Enabled',
};

export const AUDIT_OPERATION_LABELS: Record<string, string> = {
  'user.login': 'Signed in',
  'scan.create': 'Started a scan',
  'scan.create.batch': 'Queued scans',
  'scan.create.upload': 'Uploaded a scan report',
  'scan.public.create': 'Public scan started',
  'scan.public.helm.create': 'Public Helm scan started',
  'scan.public.rescan': 'Public rescan started',
  'scan.shared.rescan': 'Rescan from a shared link',
  'scan.rescan': 'Rescanned an image',
  'scan.cancel': 'Cancelled a scan',
  'scan.group_delete': 'Deleted scans for an image',
  'scan.bulk_delete': 'Deleted scans',
  'scan.bulk_share_workspace': 'Shared scans with a workspace',
  'scan.bulk_transfer_ownership': 'Transferred scan ownership',
  'scan.xray_policy_refresh': 'Refreshed Xray policy results',
  'helm.scan': 'Scanned a Helm chart',
  'mcp.scan.rescan': 'Rescan through MCP',
  'mcp.watchlist.scan': 'Watchlist scan through MCP',
  'org.member.remove': 'Removed an organization member',
  'org.member.role_change': 'Changed a member role',
  'org.token.create': 'Created an organization token',
  'org.token.delete': 'Deleted an organization token',
  'org.token.revoke': 'Revoked an organization token',
  'org.transfer_ownership': 'Transferred organization ownership',
  'settings.ai.update': 'Updated AI settings',
  'settings.ai_provider.create': 'Added an AI provider',
  'settings.ai_provider.delete': 'Removed an AI provider',
  'settings.ai_provider.test': 'Tested an AI provider',
  'settings.ai_provider.update': 'Updated an AI provider',
  'settings.mcp.update': 'Updated MCP settings',
};

/** Notification events such as `scan.completed` or `policy.failed`. */
export function eventLabel(event: string | null | undefined): string {
  return labelFor(AUDIT_OPERATION_LABELS, event);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return UUID_PATTERN.test(String(value ?? '').trim());
}

/** A person's display name. Never returns a UUID. */
export function displayUser(
  user:
    | {
        username?: string | null;
        name?: string | null;
        display_name?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
  fallback = 'Unknown user'
): string {
  const candidate = [user?.display_name, user?.name, user?.username, user?.email]
    .map((value) => String(value ?? '').trim())
    .find((value) => value && !isUuid(value));
  return candidate || fallback;
}

/**
 * Splits an image reference into the part people recognize and the registry
 * host, so long hosts can be shown as secondary text instead of pushing the
 * name out of view.
 */
export function splitImageRef(reference: string | null | undefined): {
  host: string;
  name: string;
} {
  const value = String(reference ?? '').trim();
  const slash = value.indexOf('/');
  if (slash > 0) {
    const first = value.slice(0, slash);
    if (first.includes('.') || first.includes(':') || first === 'localhost') {
      return { host: first, name: value.slice(slash + 1) };
    }
  }
  return { host: '', name: value };
}

/** `sha256:abcdef…` shortened for display, with the algorithm prefix kept. */
export function shortDigest(digest: string | null | undefined, length = 12): string {
  const value = String(digest ?? '').trim();
  if (!value) return '';
  const [algorithm, hash] = value.includes(':') ? value.split(':', 2) : ['', value];
  const short = hash.length > length ? `${hash.slice(0, length)}…` : hash;
  return algorithm ? `${algorithm}:${short}` : short;
}

/**
 * Turns scanner output (stderr, ANSI codes, stack traces) into one readable
 * sentence for list cells. Keep the raw text for a details view.
 */
export function summarizeError(message: string | null | undefined, maxLength = 140): string {
  const cleaned = String(message ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const lower = cleaned.toLowerCase();
  if (lower.includes('unable to find the specified image') || lower.includes('manifest unknown')) {
    return 'Image not found in any configured registry or local runtime.';
  }
  if (lower.includes('unauthorized') || lower.includes('authentication required')) {
    return 'The registry rejected the credentials.';
  }
  if (lower.includes('did not expose an artifact status')) {
    return 'Xray did not index the image in time.';
  }
  if (lower.includes('timed out') || lower.includes('deadline exceeded')) {
    return 'The scan timed out.';
  }

  const fatal = cleaned.match(/FATAL\s+(?:Fatal error\s+)?(.+?)(?::\s*\*|$)/);
  const sentence = (fatal?.[1] ?? cleaned)
    .replace(/^\S*\s*failed: exit status \d+\s*[—-]\s*stderr:\s*/i, '')
    .replace(/^\d{4}-\d\d-\d\dT\S+\s+\w+\s+/, '');
  return sentence.length > maxLength ? `${sentence.slice(0, maxLength - 1)}…` : sentence;
}
