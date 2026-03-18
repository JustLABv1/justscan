const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export const getToken = (): string | null =>
  typeof window !== 'undefined' ? localStorage.getItem('justscan_token') : null;
export const setToken = (t: string) => localStorage.setItem('justscan_token', t);
export const clearToken = () => localStorage.removeItem('justscan_token');
export const getUser = () => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('justscan_user');
  return raw ? JSON.parse(raw) : null;
};
export const setUser = (u: object) =>
  localStorage.setItem('justscan_user', JSON.stringify(u));
export const clearUser = () => localStorage.removeItem('justscan_user');

function authHeaders(): HeadersInit {
  const t = getToken();
  return {
    'Content-Type': 'application/json',
    ...(t ? { Authorization: `Bearer ${t}` } : {}),
  };
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// Auth
export const login = (email: string, password: string, rememberMe = false) =>
  req<{ token: string; user: User; expires_at: number }>('POST', '/api/v1/auth/login', {
    email,
    password,
    remember_me: rememberMe,
  });

export const register = (username: string, email: string, password: string) =>
  req<{ result: string }>('POST', '/api/v1/auth/register', { username, email, password });

// Dashboard
export const getStats = () =>
  req<DashboardStats>('GET', '/api/v1/dashboard/stats');

// Scans
export const listScans = (page = 1, limit = 20) =>
  req<{ data: Scan[]; total: number }>('GET', `/api/v1/scans/?page=${page}&limit=${limit}`);

export const getScan = (id: string) =>
  req<Scan>('GET', `/api/v1/scans/${id}`);

export const createScan = (imageName: string, imageTag: string, registryId?: string, tagIds?: string[], platform?: string) =>
  req<Scan>('POST', '/api/v1/scans/', { image: imageName, tag: imageTag, registry_id: registryId, tag_ids: tagIds, platform });

export const deleteScan = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${id}`);

export const listVulnerabilities = (
  scanId: string,
  page = 1,
  limit = 100,
  severity?: string,
  pkg?: string,
  hasFix?: boolean,
  minCvss?: number,
  sortBy?: string,
  sortDir?: 'asc' | 'desc',
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (severity) params.set('severity', severity);
  if (pkg) params.set('pkg', pkg);
  if (hasFix) params.set('has_fix', 'true');
  if (minCvss) params.set('min_cvss', String(minCvss));
  if (sortBy) params.set('sort_by', sortBy);
  if (sortDir) params.set('sort_dir', sortDir);
  return req<{ data: Vulnerability[]; total: number }>('GET', `/api/v1/scans/${scanId}/vulnerabilities?${params}`);
};

// Tags
export const listTags = () =>
  req<{ data: Tag[] }>('GET', '/api/v1/tags/').then((r) => r.data ?? []);
export const createTag = (name: string, color: string) =>
  req<Tag>('POST', '/api/v1/tags/', { name, color });
export const updateTag = (id: string, name: string, color: string) =>
  req<Tag>('PUT', `/api/v1/tags/${id}`, { name, color });
export const deleteTag = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/tags/${id}`);
export const addTagToScan = (scanId: string, tagId: string) =>
  req<{ result: string }>('POST', `/api/v1/scans/${scanId}/tags/${tagId}`);
export const removeTagFromScan = (scanId: string, tagId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/tags/${tagId}`);

// Comments
export const createComment = (scanId: string, vulnId: string, content: string) =>
  req<Comment>('POST', `/api/v1/scans/${scanId}/vulnerabilities/${vulnId}/comments`, { content });
export const updateComment = (commentId: string, content: string) =>
  req<Comment>('PUT', `/api/v1/comments/${commentId}`, { content });
export const deleteComment = (commentId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/comments/${commentId}`);

// Registries
export const listRegistries = () =>
  req<{ data: RegistryWithHealth[] }>('GET', '/api/v1/registries/').then((r) => r.data ?? []);
export const createRegistry = (data: Partial<Registry>) =>
  req<Registry>('POST', '/api/v1/registries/', data);
export const updateRegistry = (id: string, data: Partial<Registry>) =>
  req<Registry>('PUT', `/api/v1/registries/${id}`, data);
export const deleteRegistry = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/registries/${id}`);

// Watchlist
export const listWatchlist = () =>
  req<{ data: WatchlistItem[] }>('GET', '/api/v1/watchlist/').then((r) => r.data ?? []);
export const createWatchlistItem = (data: Partial<WatchlistItem>) =>
  req<WatchlistItem>('POST', '/api/v1/watchlist/', data);
export const updateWatchlistItem = (id: string, data: Partial<WatchlistItem>) =>
  req<WatchlistItem>('PUT', `/api/v1/watchlist/${id}`, data);
export const deleteWatchlistItem = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/watchlist/${id}`);
export const triggerWatchlistScan = (id: string) =>
  req<{ result: string }>('POST', `/api/v1/watchlist/${id}/scan`);

// Orgs
export const listOrgs = () =>
  req<{ data: Org[] }>('GET', '/api/v1/orgs/').then((r) => r.data ?? []);
export const createOrg = (name: string, description: string) =>
  req<Org>('POST', '/api/v1/orgs/', { name, description });
export const getOrg = (id: string) =>
  req<Org>('GET', `/api/v1/orgs/${id}`);
export const updateOrg = (id: string, data: Partial<Org>) =>
  req<Org>('PUT', `/api/v1/orgs/${id}`, data);
export const deleteOrg = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${id}`);

export const createPolicy = (orgId: string, name: string, rules: PolicyRule[]) =>
  req<OrgPolicy>('POST', `/api/v1/orgs/${orgId}/policies`, { name, rules });
export const updatePolicy = (orgId: string, policyId: string, name: string, rules: PolicyRule[]) =>
  req<OrgPolicy>('PUT', `/api/v1/orgs/${orgId}/policies/${policyId}`, { name, rules });
export const deletePolicy = (orgId: string, policyId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/policies/${policyId}`);

export const assignScanToOrg = (orgId: string, scanId: string) =>
  req<{ result: string }>('POST', `/api/v1/orgs/${orgId}/scans/${scanId}`);
export const removeScanFromOrg = (orgId: string, scanId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/scans/${scanId}`);
export const listOrgScans = (orgId: string) =>
  req<{ data: Scan[] }>('GET', `/api/v1/orgs/${orgId}/scans`).then((r) => r.data ?? []);

export const getScanCompliance = (scanId: string) =>
  req<{ data: ComplianceResult[] }>('GET', `/api/v1/scans/${scanId}/compliance`).then((r) => r.data ?? []);
export const reEvaluateCompliance = (scanId: string) =>
  req<{ data: ComplianceResult[] }>('POST', `/api/v1/scans/${scanId}/compliance/evaluate`).then((r) => r.data ?? []);

export const getComplianceTrend = (orgId: string) =>
  req<{ data: TrendPoint[] }>('GET', `/api/v1/orgs/${orgId}/compliance/trend`).then((r) => r.data ?? []);

// Public (unauthenticated) scan API
async function publicReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export const getPublicSettings = () =>
  publicReq<{ enabled: boolean; rate_limit_per_hour: number }>('GET', '/api/v1/public/settings');

export const createPublicScan = (image: string, tag: string, platform?: string) =>
  publicReq<Scan>('POST', '/api/v1/public/scans', { image, tag, platform });

export const getPublicScan = (id: string) =>
  publicReq<Scan>('GET', `/api/v1/public/scans/${id}`);

export const listPublicVulnerabilities = (
  scanId: string,
  page = 1,
  limit = 50,
  severity?: string,
  pkg?: string,
  hasFix?: boolean,
  minCvss?: number,
  sortBy?: string,
  sortDir?: 'asc' | 'desc',
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (severity) params.set('severity', severity);
  if (pkg) params.set('pkg', pkg);
  if (hasFix) params.set('has_fix', 'true');
  if (minCvss) params.set('min_cvss', String(minCvss));
  if (sortBy) params.set('sort_by', sortBy);
  if (sortDir) params.set('sort_dir', sortDir);
  return publicReq<{ data: Vulnerability[]; total: number }>(
    'GET',
    `/api/v1/public/scans/${scanId}/vulnerabilities?${params}`,
  );
};

// Admin settings
export const getAdminSettings = () =>
  req<Record<string, string>>('GET', '/api/v1/admin/settings');

export const setPublicScanEnabled = (enabled: boolean) =>
  req<{ enabled: boolean }>('PUT', '/api/v1/admin/settings/public-scan', { enabled });

// Auto-tag rules
export const listAutoTagRules = () =>
  req<{ data: AutoTagRule[] }>('GET', '/api/v1/auto-tags/').then(r => r.data ?? []);
export const createAutoTagRule = (pattern: string, tag_id: string) =>
  req<AutoTagRule>('POST', '/api/v1/auto-tags/', { pattern, tag_id });
export const updateAutoTagRule = (id: string, pattern: string, tag_id: string) =>
  req<AutoTagRule>('PUT', `/api/v1/auto-tags/${id}`, { pattern, tag_id });
export const deleteAutoTagRule = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/auto-tags/${id}`);

// Registry health
export const testRegistry = (id: string) =>
  req<{ health_status: string; health_message: string; last_health_check_at: string }>('POST', `/api/v1/registries/${id}/test`);

// Scan comparison
export const compareScans = (scanIdA: string, scanIdB: string) =>
  req<ScanComparison>('GET', `/api/v1/scans/compare?a=${scanIdA}&b=${scanIdB}`);

// Scan trends
export const getScanTrends = (imageName?: string, imageTag?: string, days = 30) => {
  const params = new URLSearchParams({ days: String(days) });
  if (imageName) params.set('image_name', imageName);
  if (imageTag) params.set('image_tag', imageTag);
  return req<{ data: ScanTrendPoint[] }>('GET', `/api/v1/scans/trends?${params}`).then(r => r.data ?? []);
};

// Dashboard trends
export const getDashboardTrends = () =>
  req<{ data: DashboardTrendPoint[] }>('GET', '/api/v1/dashboard/trends').then(r => r.data ?? []);

// Org risk score
export const getOrgRiskScore = (orgId: string) =>
  req<OrgRiskScore>('GET', `/api/v1/orgs/${orgId}/risk`);

// Admin users
export const listAdminUsers = () =>
  req<{ users: AdminUser[] }>('GET', '/api/v1/admin/users').then(r => r.users ?? []);
export const updateAdminUser = (id: string, data: { username?: string; email?: string; role?: string; password?: string }) =>
  req<{ result: string }>('PUT', `/api/v1/admin/users/${id}`, data);
export const deleteAdminUser = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/admin/users/${id}`);
export const disableAdminUser = (id: string, disabled: boolean, disabled_reason?: string) =>
  req<{ result: string }>('PUT', `/api/v1/admin/users/${id}/disable`, { disabled, disabled_reason: disabled_reason ?? '' });
export const createAdminUser = (username: string, email: string, password: string, role: string) =>
  req<{ result: string }>('POST', '/api/v1/admin/users/', { username, email, password, role });

// Suppressions
export const listSuppressions = (digest: string) =>
  req<Suppression[]>('GET', `/api/v1/images/${encodeURIComponent(digest)}/suppressions`);
export const upsertSuppression = (digest: string, data: Partial<Suppression>) =>
  req<Suppression>('POST', `/api/v1/images/${encodeURIComponent(digest)}/suppressions`, data);
export const deleteSuppression = (digest: string, vulnId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/images/${encodeURIComponent(digest)}/suppressions/${encodeURIComponent(vulnId)}`);

// Types
export interface PolicyRule {
  type: 'max_cvss' | 'max_count' | 'max_total' | 'require_fix' | 'blocked_cve';
  value?: number;
  severity?: string;
  cve_id?: string;
}

export interface OrgPolicy {
  id: string;
  org_id: string;
  name: string;
  rules: PolicyRule[];
  created_at: string;
  updated_at: string;
}

export interface Org {
  id: string;
  name: string;
  description: string;
  image_patterns?: string[];
  created_by_id: string;
  created_at: string;
  updated_at: string;
  policies?: OrgPolicy[];
}

export interface TrendPoint {
  date: string;
  pass: number;
  fail: number;
  rate: number;
}

export interface Violation {
  rule: PolicyRule;
  message: string;
  vuln_id?: string;
}

export interface ComplianceResult {
  id: string;
  scan_id: string;
  policy_id: string;
  org_id: string;
  status: 'pass' | 'fail';
  violations: Violation[];
  evaluated_at: string;
  policy_name?: string;
  org_name?: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  role: string;
  disabled: boolean;
}

export interface Scan {
  id: string;
  image_name: string;
  image_tag: string;
  image_digest: string;
  status: string;
  error_message: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  suppressed_count: number;
  trivy_version: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  tags?: Tag[];
  architecture?: string;
  os_family?: string;
  os_name?: string;
}

export interface Vulnerability {
  id: string;
  scan_id: string;
  vuln_id: string;
  pkg_name: string;
  installed_version: string;
  fixed_version: string;
  severity: string;
  title: string;
  description: string;
  cvss_score: number;
  references: string[];
  suppression?: Suppression | null;
  comments?: Comment[];
  first_seen_at?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Registry {
  id: string;
  name: string;
  url: string;
  auth_type: 'none' | 'basic' | 'token' | 'aws_ecr';
  username: string;
  password?: string;
  created_at: string;
}

export interface WatchlistItem {
  id: string;
  image_name: string;
  image_tag: string;
  registry_id?: string;
  schedule: string;
  enabled: boolean;
  last_scan_id?: string;
  created_at: string;
}

export interface Suppression {
  id: string;
  vuln_id: string;
  image_digest: string;
  reason: string;
  note: string;
  created_at: string;
}

export interface Comment {
  id: string;
  vulnerability_id: string;
  scan_id: string;
  user_id: string;
  content: string;
  username?: string;
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  total_scans: number;
  status_counts: Record<string, number>;
  severity_totals: Record<string, number>;
  recent_scans: Scan[] | null;
  top_images: { image_name: string; count: number }[] | null;
  watchlist_count: number;
}

export interface AutoTagRule {
  id: string;
  pattern: string;
  tag_id: string;
  created_by_id: string;
  created_at: string;
  tag?: Tag;
}

export interface RegistryWithHealth extends Registry {
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  health_message: string;
  last_health_check_at: string | null;
}

export interface ScanTrendPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  scan_count: number;
}

export interface DashboardTrendPoint {
  date: string;
  total: number;
  completed: number;
  failed: number;
}

export interface OrgRiskScore {
  score: number;
  grade: string;
  unique_images: number;
  total_scans: number;
  totals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };
  compliance_pass_rate: number;
  compliance_pass: number;
  compliance_fail: number;
}

export interface ScanComparison {
  scan_a: Scan;
  scan_b: Scan;
  added: Vulnerability[];
  removed: Vulnerability[];
  unchanged: Vulnerability[];
  summary: {
    added_count: number;
    removed_count: number;
    unchanged_count: number;
    added_critical: number;
    added_high: number;
  };
}

export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  disabled: boolean;
  disabled_reason: string;
  created_at: string;
  updated_at: string;
}
