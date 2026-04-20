const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const TOKEN_STORAGE_KEY = 'justscan_token';
const USER_STORAGE_KEY = 'justscan_user';
const WORK_SCOPE_STORAGE_KEY = 'justscan_work_scope';
const ORG_MEMBERSHIP_EVENT = 'justscan-org-membership-changed';

export type OwnerType = 'user' | 'org' | 'system';

export type WorkScope =
  | { kind: 'personal' }
  | { kind: 'org'; orgId: string; orgName?: string };

function parseTokenPayload(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function setClientCookie(name: string, value: string, expiresAt?: number) {
  if (typeof document === 'undefined') return;
  const segments = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (expiresAt) {
    segments.push(`Expires=${new Date(expiresAt * 1000).toUTCString()}`);
  }
  document.cookie = segments.join('; ');
}

function clearClientCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export const getToken = (): string | null =>
  typeof window !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;

export const setToken = (token: string) => {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  const payload = parseTokenPayload(token);
  const expiresAt = typeof payload?.exp === 'number' ? payload.exp : undefined;
  setClientCookie(TOKEN_STORAGE_KEY, token, expiresAt);
};

export const clearToken = () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  clearClientCookie(TOKEN_STORAGE_KEY);
};

export const getTokenType = (): 'admin' | 'user' | null => {
  const user = getUser() as { role?: string } | null;
  if (user?.role === 'admin') return 'admin';
  const token = getToken();
  if (!token) return null;
  const payload = parseTokenPayload(token);
  if (!payload) return null;
  if (payload.role === 'admin') return 'admin';
  return 'user';
};

export interface AuthSnapshot {
  token_present: boolean;
  role: 'admin' | 'user' | null;
  expires_at: string | null;
  expires_in_seconds: number | null;
}

export const getAuthSnapshot = (): AuthSnapshot => {
  const token = getToken();
  const payload = token ? parseTokenPayload(token) : null;
  const exp = typeof payload?.exp === 'number' ? payload.exp : null;
  return {
    token_present: Boolean(token),
    role: getTokenType(),
    expires_at: exp ? new Date(exp * 1000).toISOString() : null,
    expires_in_seconds: exp ? Math.max(0, Math.floor(exp - Date.now() / 1000)) : null,
  };
};

export const getUser = () => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const setUser = (user: object) => {
  const serialized = JSON.stringify(user);
  localStorage.setItem(USER_STORAGE_KEY, serialized);
  const token = getToken();
  const payload = token ? parseTokenPayload(token) : null;
  const expiresAt = typeof payload?.exp === 'number' ? payload.exp : undefined;
  setClientCookie(USER_STORAGE_KEY, serialized, expiresAt);
};

export const clearUser = () => {
  localStorage.removeItem(USER_STORAGE_KEY);
  clearClientCookie(USER_STORAGE_KEY);
};

export const getWorkScope = (): WorkScope => {
  if (typeof window === 'undefined') return { kind: 'personal' };
  const raw = localStorage.getItem(WORK_SCOPE_STORAGE_KEY);
  if (!raw) return { kind: 'personal' };
  try {
    const parsed = JSON.parse(raw) as WorkScope;
    if (parsed && parsed.kind === 'org' && parsed.orgId) return parsed;
    return { kind: 'personal' };
  } catch {
    return { kind: 'personal' };
  }
};

export const setWorkScope = (scope: WorkScope) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WORK_SCOPE_STORAGE_KEY, JSON.stringify(scope));
  window.dispatchEvent(new CustomEvent('justscan-work-scope-changed', { detail: scope }));
};

export const clearWorkScope = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(WORK_SCOPE_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('justscan-work-scope-changed', { detail: { kind: 'personal' } }));
};

function scopeQueryParam(): string {
  const scope = getWorkScope();
  if (scope.kind === 'personal') return 'personal';
  if (scope.kind === 'org') return scope.orgId;
  return '';
}

function appendScope(params: URLSearchParams): void {
  const s = scopeQueryParam();
  if (s) params.set('scope', s);
}

function notifyOrgMembershipChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ORG_MEMBERSHIP_EVENT));
}

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
  if (res.status === 401) {
    clearToken();
    clearUser();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// Auth
export const getOIDCAvailability = () =>
  req<{ oidc_enabled: boolean; local_auth_enabled: boolean }>('GET', '/api/v1/auth/oidc/available');

export const login = (email: string, password: string, rememberMe = false) =>
  req<{ token: string; user: User; expires_at: number }>('POST', '/api/v1/auth/login', {
    email,
    password,
    remember_me: rememberMe,
  });

export const register = (username: string, email: string, password: string) =>
  req<{ result: string }>('POST', '/api/v1/auth/register', { username, email, password });

// Dashboard
export const getStats = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<DashboardStats>('GET', `/api/v1/dashboard/stats${qs ? `?${qs}` : ''}`);
};

export const getScannerHealth = () =>
  req<ScannerHealth>('GET', '/api/v1/dashboard/scanner-health');

// Scans
export const listScans = (page = 1, limit = 20, image?: string, status?: string, exact?: boolean, helmOnly?: boolean, helmChart?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (image) params.set('image', image);
  if (status) params.set('status', status);
  if (exact) params.set('exact', 'true');
  if (helmOnly) params.set('helm_only', 'true');
  if (helmChart) params.set('helm_chart', helmChart);
  appendScope(params);
  return req<{ data: Scan[]; total: number }>('GET', `/api/v1/scans/?${params}`);
};

export const listScanImages = (page = 1, limit = 30, image?: string, status?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (image) params.set('image', image);
  if (status) params.set('status', status);
  appendScope(params);
  return req<{ data: ImageSummary[]; total: number }>('GET', `/api/v1/scans/images?${params}`);
};

export const getScan = (id: string) =>
  req<Scan>('GET', `/api/v1/scans/${id}`);

export const createScan = (imageName: string, imageTag: string, registryId?: string, tagIds?: string[], platform?: string, orgId?: string) =>
  req<Scan>('POST', '/api/v1/scans/', { image: imageName, tag: imageTag, registry_id: registryId, tag_ids: tagIds, platform, org_id: orgId });

export const createScans = (images: string[], registryId?: string, tagIds?: string[], platform?: string, orgId?: string) =>
  req<{ scans: Scan[] }>('POST', '/api/v1/scans/batch', { images, registry_id: registryId, tag_ids: tagIds, platform, org_id: orgId });

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

export const getVulnerabilityContextAnalysis = (scanId: string, vulnerabilityId: string) =>
  req<VulnerabilityContextAnalysis>('GET', `/api/v1/scans/${scanId}/vulnerabilities/${vulnerabilityId}/analysis`);
export const listTags = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ data: Tag[] }>('GET', `/api/v1/tags/${qs ? `?${qs}` : ''}`).then((r) => r.data ?? []);
};
export const createTag = (name: string, color: string, orgId?: string) =>
  req<Tag>('POST', '/api/v1/tags/', { name, color, org_id: orgId });
export const updateTag = (id: string, name: string, color: string) =>
  req<Tag>('PUT', `/api/v1/tags/${id}`, { name, color });
export const deleteTag = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/tags/${id}`);
export const listTagShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/tags/${id}/shares`).then((r) => r.data ?? []);
export const shareTag = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/tags/${id}/shares`, { org_id: orgId });
export const unshareTag = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/tags/${id}/shares/${orgId}`);
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
export const listRegistries = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<RegistryListResponse>('GET', `/api/v1/registries/${qs ? `?${qs}` : ''}`).then((r) => r.data ?? []);
};
export const listRegistriesWithCapabilities = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<RegistryListResponse>('GET', `/api/v1/registries/${qs ? `?${qs}` : ''}`).then((r) => ({
    data: r.data ?? [],
    capabilities: r.capabilities ?? getDefaultScannerCapabilities(),
  }));
};
export const createRegistry = (data: Partial<Registry> & { org_id?: string }) =>
  req<Registry>('POST', '/api/v1/registries/', data);
export const updateRegistry = (id: string, data: Partial<Registry>) =>
  req<Registry>('PUT', `/api/v1/registries/${id}`, data);
export const deleteRegistry = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/registries/${id}`);
export const listRegistryShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/registries/${id}/shares`).then((r) => r.data ?? []);
export const shareRegistry = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/registries/${id}/shares`, { org_id: orgId });
export const unshareRegistry = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/registries/${id}/shares/${orgId}`);
export const getDefaultRegistry = () =>
  req<Registry>('GET', '/api/v1/registries/default').catch(() => null);

// Multi-provider OIDC
export const listOIDCProviders = () =>
  req<OIDCProvider[]>('GET', '/api/v1/auth/oidc/providers').then((r) => (Array.isArray(r) ? r : []));

// Admin: OIDC provider CRUD
export const adminListOIDCProviders = () =>
  req<{ data: OIDCProviderAdmin[] }>('GET', '/api/v1/admin/oidc-providers').then((r) => r.data ?? []);
export const adminCreateOIDCProvider = (data: Partial<OIDCProviderAdmin>) =>
  req<OIDCProviderAdmin>('POST', '/api/v1/admin/oidc-providers', data);
export const adminUpdateOIDCProvider = (name: string, data: Partial<OIDCProviderAdmin>) =>
  req<OIDCProviderAdmin>('PUT', `/api/v1/admin/oidc-providers/${name}`, data);
export const adminDeleteOIDCProvider = (name: string) =>
  req<void>('DELETE', `/api/v1/admin/oidc-providers/${name}`);

// Admin: Group→org mappings
export const adminListGroupMappings = (providerName: string) =>
  req<{ data: OIDCGroupMapping[] }>('GET', `/api/v1/admin/oidc-providers/${providerName}/group-mappings`).then((r) => r.data ?? []);
export const adminCreateGroupMapping = (providerName: string, data: Partial<OIDCGroupMapping>) =>
  req<OIDCGroupMapping>('POST', `/api/v1/admin/oidc-providers/${providerName}/group-mappings`, data);
export const adminDeleteGroupMapping = (providerName: string, mappingId: string) =>
  req<void>('DELETE', `/api/v1/admin/oidc-providers/${providerName}/group-mappings/${mappingId}`);

// Admin: Scanner settings
export const adminUpdateScannerSettings = (data: Partial<ScannerSettings>) =>
  req<{ updated: Record<string, string> }>('PUT', '/api/v1/admin/settings/scanner', data);
export const adminUpdateAuthSettings = (data: { local_auth_enabled: boolean }) =>
  req<{ local_auth_enabled: boolean }>('PUT', '/api/v1/admin/settings/auth', data);

// Admin: Global registries
export const adminListGlobalRegistries = () =>
  req<RegistryListResponse>('GET', '/api/v1/admin/registries').then((r) => ({ data: r.data ?? [], capabilities: r.capabilities ?? getDefaultScannerCapabilities() }));
export const adminCreateGlobalRegistry = (data: Partial<Registry>) =>
  req<Registry>('POST', '/api/v1/admin/registries', data);
export const adminDeleteGlobalRegistry = (id: string) =>
  req<void>('DELETE', `/api/v1/admin/registries/${id}`);
export const adminSetDefaultRegistry = (id: string) =>
  req<{ id: string; is_default: boolean }>('PUT', `/api/v1/admin/registries/${id}/set-default`);
export const adminUnsetDefaultRegistry = (id: string) =>
  req<{ id: string; is_default: boolean }>('PUT', `/api/v1/admin/registries/${id}/unset-default`);

// Watchlist
export const listWatchlist = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ data: WatchlistItem[] }>('GET', `/api/v1/watchlist/${qs ? `?${qs}` : ''}`).then((r) => r.data ?? []);
};
export const createWatchlistItem = (data: Partial<WatchlistItem> & { org_id?: string }) =>
  req<WatchlistItem>('POST', '/api/v1/watchlist/', data);
export const updateWatchlistItem = (id: string, data: Partial<WatchlistItem>) =>
  req<WatchlistItem>('PUT', `/api/v1/watchlist/${id}`, data);
export const deleteWatchlistItem = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/watchlist/${id}`);
export const triggerWatchlistScan = (id: string) =>
  req<{ result: string }>('POST', `/api/v1/watchlist/${id}/scan`);
export const listWatchlistShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/watchlist/${id}/shares`).then((r) => r.data ?? []);
export const shareWatchlistItem = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/watchlist/${id}/shares`, { org_id: orgId });
export const unshareWatchlistItem = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/watchlist/${id}/shares/${orgId}`);

// Orgs
export const listOrgs = () =>
  req<{ data: Org[] }>('GET', '/api/v1/orgs/').then((r) => r.data ?? []);
export const createOrg = (name: string, description: string) =>
  req<Org>('POST', '/api/v1/orgs/', { name, description }).then((org) => {
    notifyOrgMembershipChanged();
    return org;
  });
export const getOrg = (id: string) =>
  req<Org>('GET', `/api/v1/orgs/${id}`);
export const updateOrg = (id: string, data: Partial<Org>) =>
  req<Org>('PUT', `/api/v1/orgs/${id}`, data);
export const deleteOrg = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${id}`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });

export const listOrgMembers = (orgId: string) =>
  req<{ data: OrgMember[] }>('GET', `/api/v1/orgs/${orgId}/members`).then((r) => r.data ?? []);
export const updateOrgMemberRole = (orgId: string, userId: string, role: OrgRole) =>
  req<{ result: string }>('PATCH', `/api/v1/orgs/${orgId}/members/${userId}`, { role });
export const removeOrgMember = (orgId: string, userId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/members/${userId}`);
export const listOrgInvites = (orgId: string) =>
  req<{ data: OrgInvite[] }>('GET', `/api/v1/orgs/${orgId}/invites`).then((r) => r.data ?? []);
export const listMyOrgInvites = () =>
  req<{ data: OrgInvite[] }>('GET', '/api/v1/orgs/invites').then((r) => r.data ?? []);
export const createOrgInvite = (orgId: string, email: string, role: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>) =>
  req<OrgInvite>('POST', `/api/v1/orgs/${orgId}/invites`, { email, role });
export const revokeOrgInvite = (orgId: string, inviteId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/invites/${inviteId}`);
export const declineOrgInvite = (inviteId: string) =>
  req<{ result: string }>('POST', `/api/v1/orgs/invites/${inviteId}/decline`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });
export const acceptOrgInvite = (inviteId: string) =>
  req<{ result: string; org_id: string; org_name?: string; role: OrgRole }>('POST', `/api/v1/orgs/invites/${inviteId}/accept`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });
export const acceptOrgInviteByToken = (token: string) =>
  req<{ result: string; org_id: string; org_name?: string; role: OrgRole }>('POST', `/api/v1/orgs/invites/by-token/${token}/accept`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });

// Org tokens
export interface APIToken {
  id: string;
  key: string;
  description: string;
  type: string;
  disabled: boolean;
  disabled_reason: string;
  created_at: string;
  expires_at: string;
  user_id: string;
  org_id?: string;
}
export const listOrgTokens = (orgId: string) =>
  req<{ data: APIToken[] }>('GET', `/api/v1/orgs/${orgId}/tokens`).then((r) => r.data ?? []);
export const createOrgToken = (orgId: string, description: string, expiresIn?: number) =>
  req<APIToken & { key: string }>('POST', `/api/v1/orgs/${orgId}/tokens`, { description, expires_in: expiresIn });
export const revokeOrgToken = (orgId: string, tokenId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/tokens/${tokenId}`);

// Personal access tokens (PATs)
export interface PersonalToken {
  id: string;
  description: string;
  type: string;
  disabled: boolean;
  disabled_reason: string;
  created_at: string;
  expires_at: string;
}
export const listUserTokens = () =>
  req<{ data: PersonalToken[]; total: number }>('GET', '/api/v1/user/tokens');
export const createUserToken = (description: string, expiresIn?: number) =>
  req<PersonalToken & { key: string }>('POST', '/api/v1/user/tokens', { description, expires_in: expiresIn });
export const revokeUserToken = (tokenId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/user/tokens/${tokenId}`);

// Org ownership transfer
export const transferOrgOwnership = (orgId: string, newOwnerUserId: string) =>
  req<{ result: string }>('POST', `/api/v1/orgs/${orgId}/transfer-ownership`, { new_owner_user_id: newOwnerUserId });

// Org audit log
export interface AuditEntry {
  id: string;
  org_id: string;
  user_id: string;
  username: string;
  email: string;
  action: string;
  details: string;
  created_at: string;
}
export const listOrgAuditLog = (orgId: string, page = 1, limit = 50) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return req<{ data: AuditEntry[]; total: number }>('GET', `/api/v1/orgs/${orgId}/audit?${params}`);
};

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
  publicReq<PublicSettings>('GET', '/api/v1/public/settings');

export const createPublicScan = (image: string, tag: string, platform?: string) =>
  publicReq<Scan>('POST', '/api/v1/public/scans', { image, tag, platform });

export const reScanPublic = (id: string) =>
  publicReq<Scan>('POST', `/api/v1/public/scans/${id}/rescan`);

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

export const getPublicVulnerabilityContextAnalysis = (scanId: string, vulnerabilityId: string) =>
  publicReq<VulnerabilityContextAnalysis>('GET', `/api/v1/public/scans/${scanId}/vulnerabilities/${vulnerabilityId}/analysis`);

export const extractPublicHelmImages = (
  chartUrl: string,
  chartName?: string,
  chartVersion?: string,
) =>
  publicReq<HelmExtractResponse>('POST', '/api/v1/public/helm/extract', {
    chart_url: chartUrl,
    chart_name: chartName,
    chart_version: chartVersion,
  });

export const createPublicHelmScans = (
  chartUrl: string,
  images: Array<{ full_ref: string; source_path: string }>,
  platform?: string,
  chartName?: string,
  chartVersion?: string,
) =>
  publicReq<{ run?: HelmScanRun; scans: Scan[] }>('POST', '/api/v1/public/helm/scan', {
    chart_url: chartUrl,
    images,
    platform: platform || undefined,
    chart_name: chartName,
    chart_version: chartVersion,
  });

export const getPublicHelmScanRun = (id: string) =>
  publicReq<HelmScanRunDetail>('GET', `/api/v1/public/helm/runs/${id}`);

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

// Dashboard vulnerability trends
export const getDashboardVulnTrends = (days = 30) =>
  req<{ data: DashboardVulnTrendPoint[] }>('GET', `/api/v1/dashboard/vuln-trends?days=${days}`).then(r => r.data ?? []);

// Global search
export const search = (q: string) => {
  const params = new URLSearchParams({ q });
  appendScope(params);
  return req<{ images: SearchImageResult[]; vulns: SearchVulnResult[]; scans: SearchScanResult[] }>('GET', `/api/v1/search/?${params}`);
};

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

// Admin tokens
export const listAdminTokens = () =>
  req<{ tokens: AdminToken[] }>('GET', '/api/v1/admin/tokens').then(r => r.tokens ?? []);

export const updateAdminToken = (id: string, data: Pick<AdminToken, 'description' | 'disabled' | 'disabled_reason'>) =>
  req<{ result: string }>('PUT', `/api/v1/admin/tokens/${id}`, data);

export const deleteAdminToken = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/admin/tokens/${id}`);

// Suppressions
export const listSuppressions = (digest: string) =>
  req<Suppression[]>('GET', `/api/v1/images/${digest}/suppressions`);
export const upsertSuppression = (digest: string, data: Partial<Suppression> & { org_id?: string }) =>
  req<Suppression>('POST', `/api/v1/images/${digest}/suppressions`, data);
export const deleteSuppression = (digest: string, vulnId: string, orgId?: string) => {
  const params = new URLSearchParams();
  if (orgId) params.set('org_id', orgId);
  const suffix = params.toString() ? `?${params}` : '';
  return req<{ result: string }>('DELETE', `/api/v1/images/${digest}/suppressions/${encodeURIComponent(vulnId)}${suffix}`);
};
export const deleteSuppressionById = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/suppressions/${id}`);
export const listSuppressionShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/suppressions/${id}/shares`).then((r) => r.data ?? []);
export const shareSuppression = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/suppressions/${id}/shares`, { org_id: orgId });
export const unshareSuppression = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/suppressions/${id}/shares/${orgId}`);

// Scans - bulk & rescan
export const reScan = (id: string) =>
  req<Scan>('POST', `/api/v1/scans/${id}/rescan`);

export const cancelScan = (id: string) =>
  req<{ result: string; status?: string; current_step?: string; external_status?: string; completed_at?: string; error_message?: string }>('POST', `/api/v1/scans/${id}/cancel`);

export const bulkDeleteScans = (ids: string[]) =>
  req<{ deleted: number }>('DELETE', '/api/v1/scans/bulk', { ids });

export const bulkAddTagToScans = (tagId: string, ids: string[]) =>
  req<{ result: string }>('POST', `/api/v1/scans/bulk/tags/${tagId}`, { ids });

// Admin - audit log
export const listAuditLogs = (page = 1, limit = 50, filters?: AuditLogFilters) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters?.operation) params.set('operation', filters.operation);
  if (filters?.user) params.set('user', filters.user);
  if (filters?.q) params.set('q', filters.q);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  return req<{ data: AuditLog[]; total: number }>('GET', `/api/v1/admin/audit?${params}`);
};

// Admin - API request logs (insights)
export const listAPIRequestLogs = (page = 1, limit = 50, filters?: APIRequestLogFilters) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters?.method) params.set('method', filters.method);
  if (filters?.path) params.set('path', filters.path);
  if (filters?.user) params.set('user', filters.user);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  return req<{ data: APIRequestLog[]; total: number }>('GET', `/api/v1/admin/api-logs?${params}`);
};

export const getAPIUsageStats = (from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const suffix = params.toString() ? `?${params}` : '';
  return req<APIUsageStats>('GET', `/api/v1/admin/api-usage${suffix}`);
};

// Admin - xRay request logs (insights)
export const listXRayRequestLogs = (page = 1, limit = 50, filters?: XRayRequestLogFilters) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters?.scan_id) params.set('scan_id', filters.scan_id);
  if (filters?.registry_id) params.set('registry_id', filters.registry_id);
  if (filters?.endpoint) params.set('endpoint', filters.endpoint);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  return req<{ data: XRayRequestLog[]; total: number }>('GET', `/api/v1/admin/xray-logs?${params}`);
};

// Admin - log retention settings
export const updateAPILogRetention = (days: number) =>
  req<{ days: number }>('PUT', '/api/v1/admin/settings/api-log-retention', { days });

export const updateXRayLogRetention = (days: number) =>
  req<{ days: number }>('PUT', '/api/v1/admin/settings/xray-log-retention', { days });

// Admin - notifications
export const listNotificationChannels = () =>
  req<{ data: NotificationChannel[] }>('GET', '/api/v1/admin/notifications').then(r => r.data ?? []);

export const createNotificationChannel = (data: Partial<NotificationChannel>) =>
  req<NotificationChannel>('POST', '/api/v1/admin/notifications', data);

export const updateNotificationChannel = (id: string, data: Partial<NotificationChannel>) =>
  req<NotificationChannel>('PUT', `/api/v1/admin/notifications/${id}`, data);

export const deleteNotificationChannel = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/admin/notifications/${id}`);

export const testNotificationChannel = (id: string, event?: string) =>
  req<{ result: string }>('POST', `/api/v1/admin/notifications/${id}/test`, event ? { event } : {});

export const listNotificationDeliveries = (id: string, limit = 10) =>
  req<{ data: NotificationDelivery[] }>('GET', `/api/v1/admin/notifications/${id}/deliveries?limit=${limit}`).then(r => r.data ?? []);

// Helm chart scanning
export interface HelmImage {
  full_ref: string;
  name: string;
  tag: string;
  source_file: string;
  source_path: string;
}

export interface HelmExtractResponse {
  chart_name: string;
  chart_version: string;
  images: HelmImage[];
}

export interface HelmScanRun {
  id: string;
  user_id?: string;
  chart_url: string;
  chart_name?: string;
  chart_version?: string;
  platform?: string;
  created_at: string;
}

export interface HelmScanRunSummary extends HelmScanRun {
  total_images: number;
  completed_images: number;
  failed_images: number;
  active_images: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  owner_email?: string;
  owner_username?: string;
}

export interface HelmRunItem {
  key: string;
  attempt_count: number;
  latest_scan: Scan;
}

export interface HelmScanRunDetail {
  run: HelmScanRun;
  items: HelmRunItem[];
}

export const extractHelmImages = (
  chartUrl: string,
  chartName?: string,
  chartVersion?: string,
) =>
  req<HelmExtractResponse>('POST', '/api/v1/helm/extract', {
    chart_url: chartUrl,
    chart_name: chartName,
    chart_version: chartVersion,
  });

export const createHelmScans = (
  chartUrl: string,
  images: Array<{ full_ref: string; source_path: string }>,
  platform?: string,
  tagIds?: string[],
  chartName?: string,
  chartVersion?: string,
  registryId?: string,
  orgId?: string,
) =>
  req<{ run: HelmScanRun; scans: Scan[] }>('POST', '/api/v1/helm/scan', {
    chart_url: chartUrl,
    images,
    platform: platform || undefined,
    registry_id: registryId || undefined,
    tag_ids: tagIds,
    chart_name: chartName,
    chart_version: chartVersion,
    org_id: orgId,
  });

export const listHelmScanRuns = (page = 1, limit = 20, chartUrl?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (chartUrl) params.set('chart_url', chartUrl);
  return req<{ data: HelmScanRunSummary[]; total: number }>('GET', `/api/v1/helm/runs?${params}`);
};

export const getHelmScanRun = (id: string) =>
  req<HelmScanRunDetail>('GET', `/api/v1/helm/runs/${id}`);

// Admin - rate limit
export const updateRateLimit = (limit: number) =>
  req<{ limit: number }>('PUT', '/api/v1/admin/settings/rate-limit', { limit });

export const updateRegisterRateLimit = (limit: number) =>
  req<{ limit: number }>('PUT', '/api/v1/admin/settings/register-rate-limit', { limit });

// Vuln KB
export const listKBEntries = (q?: string, severity?: string, page = 1, limit = 50, exploit?: boolean, minCvss?: number, publishedAfter?: string) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (severity) params.set('severity', severity);
  if (exploit === true) params.set('exploit', 'true');
  if (minCvss && minCvss > 0) params.set('min_cvss', String(minCvss));
  if (publishedAfter) params.set('published_after', publishedAfter);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return req<{ data: VulnKBEntry[]; total: number }>('GET', `/api/v1/kb/?${params}`);
};
export const getKBEntry = (vulnId: string) =>
  req<VulnKBEntry>('GET', `/api/v1/kb/${encodeURIComponent(vulnId)}`);

// SBOM
export const getScanSBOM = (scanId: string, name?: string, type?: string) => {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (type) params.set('type', type);
  return req<{ data: SBOMComponent[]; total: number }>('GET', `/api/v1/scans/${scanId}/sbom?${params}`);
};

// User profile
export const getUserDetails = () =>
  req<{ result: string; user: User }>('GET', '/api/v1/user/');
export const updateUserDetails = (username: string, email: string) =>
  req<{ result: string }>('PUT', '/api/v1/user/', { username, email });
export const changePassword = (currentPassword: string, newPassword: string, confirmPassword: string) =>
  req<{ result: string }>('PUT', '/api/v1/user/password', {
    current_password: currentPassword,
    new_password: newPassword,
    confirm_password: confirmPassword,
  });

// Global suppressions list
export const listAllSuppressions = (page = 1, limit = 50, status?: string, q?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  appendScope(params);
  return req<{ data: Suppression[]; total: number }>('GET', `/api/v1/suppressions/?${params}`);
};

// Scan sharing
export const createShare = (scanId: string, visibility: 'public' | 'authenticated') =>
  req<{ share_token: string; share_visibility: string }>('POST', `/api/v1/scans/${scanId}/share`, { visibility });

export const deleteShare = (scanId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/share`);
export const listScanOrgGrants = (scanId: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/scans/${scanId}/org-grants`).then((r) => r.data ?? []);
export const grantScanOrgAccess = (scanId: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/scans/${scanId}/org-grants`, { org_id: orgId });
export const revokeScanOrgAccess = (scanId: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/org-grants/${orgId}`);

// Status pages
export const listStatusPages = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ data: StatusPage[] }>('GET', `/api/v1/status-pages/${qs ? `?${qs}` : ''}`).then(r => r.data ?? []);
};

export const createStatusPage = (data: StatusPagePayload) =>
  req<StatusPage>('POST', '/api/v1/status-pages/', data);

export const getStatusPage = (id: string) =>
  req<StatusPageResponse>('GET', `/api/v1/status-pages/${id}`);

export const updateStatusPage = (id: string, data: StatusPagePayload) =>
  req<StatusPage>('PUT', `/api/v1/status-pages/${id}`, data);

export const deleteStatusPage = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/status-pages/${id}`);
export const listStatusPageShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/status-pages/${id}/shares`).then((r) => r.data ?? []);
export const shareStatusPage = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/status-pages/${id}/shares`, { org_id: orgId });
export const unshareStatusPage = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/status-pages/${id}/shares/${orgId}`);

export const getStatusPageBySlug = (slug: string) =>
  sharedReq<StatusPageResponse>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}`);

export const getStatusPageTrackedScan = (slug: string, scanId: string) =>
  sharedReq<StatusPageScanSummary>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/scans/${encodeURIComponent(scanId)}`);

export const listStatusPageScanHistory = (slug: string, scanId: string) =>
  sharedReq<{ data: StatusPageScanSummary[] }>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/scans/${encodeURIComponent(scanId)}/history`)
    .then(r => r.data ?? []);

export const listStatusPageItemVulnerabilities = (
  slug: string,
  scanId: string,
  page = 1,
  limit = 25,
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
  return sharedReq<{ data: Vulnerability[]; total: number }>(
    'GET',
    `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/items/${encodeURIComponent(scanId)}/vulnerabilities?${params}`,
  );
};

export const getStatusPageItemVulnerabilityContextAnalysis = (slug: string, scanId: string, vulnerabilityId: string) =>
  sharedReq<VulnerabilityContextAnalysis>(
    'GET',
    `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/items/${encodeURIComponent(scanId)}/vulnerabilities/${encodeURIComponent(vulnerabilityId)}/analysis`,
  );

export const listStatusPageTargetOptions = async () => {
  const limit = 100;
  let page = 1;
  let total = 0;
  const seen = new Map<string, StatusPageTargetOption>();

  do {
    const response = await listScans(page, limit);
    total = response.total ?? 0;
    for (const scan of response.data ?? []) {
      const key = `${scan.image_name}:${scan.image_tag}`;
      if (!seen.has(key)) {
        seen.set(key, {
          id: key,
          image_name: scan.image_name,
          image_tag: scan.image_tag,
          label: key,
          latest_scan_id: scan.id,
          latest_status: scan.status,
          observed_at: scan.completed_at ?? scan.created_at,
          critical_count: scan.critical_count,
          high_count: scan.high_count,
        });
      }
    }
    page += 1;
  } while ((page - 1) * limit < total);

  return Array.from(seen.values()).sort((left, right) => left.label.localeCompare(right.label));
};

// Admin - all scans
export const listAdminScans = (page = 1, limit = 50, image?: string, status?: string, helmOnly?: boolean, owner?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (image) params.set('image', image);
  if (status) params.set('status', status);
  if (helmOnly) params.set('helm_only', 'true');
  if (owner) params.set('owner', owner);
  return req<{ data: AdminScan[]; total: number }>('GET', `/api/v1/admin/scans?${params}`);
};

// Shared scans — sends JWT if available but throws ApiError (with .status) instead of redirecting on 401
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function sharedReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, err.error ?? res.statusText);
  }
  return res.json();
}

export const getSharedScan = (token: string) =>
  sharedReq<Scan>('GET', `/api/v1/shared/${token}`);

export const listSharedVulnerabilities = (
  token: string,
  page = 1,
  limit = 25,
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
  return sharedReq<{ data: Vulnerability[]; total: number }>('GET', `/api/v1/shared/${token}/vulnerabilities?${params}`);
};

export const rescanShared = (token: string) =>
  sharedReq<{ scan_id: string; type: 'public' | 'authenticated' }>('POST', `/api/v1/shared/${token}/rescan`);

export const getSharedVulnerabilityContextAnalysis = (token: string, vulnerabilityId: string) =>
  sharedReq<VulnerabilityContextAnalysis>('GET', `/api/v1/shared/${token}/vulnerabilities/${vulnerabilityId}/analysis`);

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

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface Org {
  id: string;
  name: string;
  description: string;
  image_patterns?: string[];
  created_by_id: string;
  created_at: string;
  updated_at: string;
  current_user_role?: OrgRole;
  policies?: OrgPolicy[];
}

export interface ResourceShare {
  org_id: string;
  org_name: string;
  org_description?: string;
  is_owner: boolean;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  joined_at: string;
  created_at: string;
  email?: string;
  username?: string;
}

export interface OrgInvite {
  id: string;
  org_id: string;
  org_name?: string;
  org_description?: string;
  email: string;
  role: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>;
  token: string;
  invited_by_user_id: string;
  invited_by_email?: string;
  invited_by_username?: string;
  accepted_by_user_id?: string | null;
  accepted_at?: string | null;
  revoked_at?: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
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
  disabled_reason?: string;
  auth_type: 'local' | 'oidc';
  last_login_at?: string | null;
  last_login_method: 'local' | 'oidc' | '';
}

export interface ScanStepLog {
  id: string;
  scan_id: string;
  step: string;
  position: number;
  started_at: string;
  completed_at?: string | null;
  output: string[];
  output_count?: number;
}

export type BlockedPolicyIgnoreRuleStatus = 'active_ignore' | 'no_ignore' | 'status_unavailable';

export interface BlockedPolicyMatchedWatch {
  name: string;
  ignore_rule_status: BlockedPolicyIgnoreRuleStatus;
}

export interface BlockedPolicyDetails {
  summary: string;
  manifest?: string;
  artifact?: string;
  jfrog?: string;
  matched_issues?: string[];
  matched_watches?: BlockedPolicyMatchedWatch[];
  blocking_policies?: string[];
  matched_policies?: string[];
  total_violations?: number;
}

export interface Scan {
  id: string;
  image_name: string;
  image_tag: string;
  image_digest: string;
  scan_provider: ScanProvider;
  external_scan_id?: string;
  external_status?: string;
  current_step: string;
  status: string;
  error_message: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  suppressed_count: number;
  trivy_version: string;
  grype_version: string;
  trivy_vuln_db_updated_at?: string | null;
  trivy_vuln_db_downloaded_at?: string | null;
  trivy_java_db_updated_at?: string | null;
  trivy_java_db_downloaded_at?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  registry_id?: string;
  tags?: Tag[];
  architecture?: string;
  os_family?: string;
  os_name?: string;
  image_config?: Record<string, unknown>;
  platform?: string;
  share_token?: string;
  share_visibility?: string;
  helm_scan_run_id?: string;
  helm_chart?: string;
  helm_chart_name?: string;
  helm_chart_version?: string;
  helm_source_path?: string;
  blocked_policy_details?: BlockedPolicyDetails | null;
  step_logs?: ScanStepLog[];
}

export interface AdminScan extends Omit<Scan, 'tags'> {
  owner_email: string;
  owner_username: string;
  share_token?: string;
  share_visibility?: string;
  helm_chart?: string;
  helm_chart_name?: string;
  helm_chart_version?: string;
  helm_source_path?: string;
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
  data_source?: string;
  external_component_id?: string;
  references: string[];
  suppression?: Suppression | null;
  comments?: Comment[];
  first_seen_at?: string | null;
}

export interface VulnerabilityContextAnalysis {
  provider: string;
  supported: boolean;
  available: boolean;
  message?: string;
  vulnerability_id: string;
  component_id?: string;
  source_component_id?: string;
  artifact_path?: string;
  applicable?: boolean | null;
  summary?: string;
  evidence?: string[];
  dependency_paths?: string[];
  raw?: Record<string, unknown>;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
}

export interface Registry {
  id: string;
  name: string;
  url: string;
  xray_url?: string;
  xray_artifactory_id?: string;
  auth_type: 'none' | 'basic' | 'token' | 'aws_ecr';
  scan_provider: ScanProvider;
  username: string;
  password?: string;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  is_default?: boolean;
}

export interface OIDCProvider {
  name: string;
  display_name: string;
  button_color?: string;
}

export interface OIDCProviderAdmin extends OIDCProvider {
  issuer_url: string;
  client_id: string;
  client_secret?: string;
  redirect_uri: string;
  scopes: string[];
  admin_groups: string[];
  admin_roles: string[];
  groups_claim: string;
  roles_claim: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface OIDCGroupMapping {
  id: string;
  provider_name: string;
  oidc_group: string;
  org_id: string;
  org_name?: string;
  role: string;
  auto_create_org: boolean;
  remove_on_unsync: boolean;
  created_at: string;
}

export interface ScannerSettings {
  enable_trivy?: boolean;
  enable_grype?: boolean;
  concurrency?: number;
  timeout_seconds?: number;
  db_max_age_hours?: number;
  enable_osv_java_augmentation?: boolean;
}

export type ScanProvider = 'trivy' | 'artifactory_xray';

export interface ProviderCapability {
  id: ScanProvider;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface ScannerCapabilities {
  enable_trivy: boolean;
  enable_grype: boolean;
  local_scan_message?: string;
  providers: ProviderCapability[];
}

export interface RegistryListResponse {
  data: RegistryWithHealth[];
  capabilities?: ScannerCapabilities;
}

export interface PublicSettings {
  enabled: boolean;
  rate_limit_per_hour: number;
  local_scan_available?: boolean;
  disabled_reason?: string;
}

export function getDefaultScannerCapabilities(): ScannerCapabilities {
  return {
    enable_trivy: true,
    enable_grype: true,
    providers: [
      { id: 'trivy', label: 'Trivy', enabled: true },
      { id: 'artifactory_xray', label: 'Artifactory Xray', enabled: true },
    ],
  };
}

export function isProviderAvailable(
  provider: ScanProvider | string | undefined | null,
  capabilities?: ScannerCapabilities | null,
): boolean {
  const normalized = (provider ?? 'trivy') as ScanProvider;
  if (normalized === 'artifactory_xray') {
    return true;
  }
  return capabilities?.enable_trivy ?? true;
}

export interface WatchlistItem {
  id: string;
  image_name: string;
  image_tag: string;
  registry_id?: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  last_scan_id?: string;
  last_scanned_at?: string;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
}

export interface Suppression {
  id: string;
  vuln_id: string;
  image_digest: string;
  status: 'accepted' | 'wont_fix' | 'false_positive' | 'xray_ignore';
  justification: string;
  user_id: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  username?: string;
  source?: 'local' | 'xray' | 'mixed';
  sources?: Array<'local' | 'xray'>;
  read_only?: boolean;
  xray_rule_id?: string;
  xray_policy_name?: string;
  xray_watch_name?: string;
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
  operations: DashboardOperations;
}

export interface DashboardOperations {
  blocked_policy_count: number;
  active_xray_count: number;
  active_xray_step_counts: Record<string, number>;
  active_xray_scans: Scan[] | null;
}

export interface ScannerHealthWorker {
  worker_id: number;
  cache_dir: string;
  status: 'healthy' | 'stale' | 'error';
  error?: string;
  trivy_version: string;
  vuln_db_updated_at?: string | null;
  vuln_db_downloaded_at?: string | null;
  vuln_db_age_hours?: number | null;
  java_db_updated_at?: string | null;
  java_db_downloaded_at?: string | null;
  java_db_age_hours?: number | null;
}

export interface ScannerHealth {
  local_scanner_enabled: boolean;
  grype_enabled: boolean;
  message?: string;
  generated_at: string;
  cache_root: string;
  max_allowed_age_hours: number;
  total_workers: number;
  healthy_workers: number;
  stale_workers: number;
  error_workers: number;
  oldest_vuln_db_age_hours?: number | null;
  oldest_java_db_age_hours?: number | null;
  workers: ScannerHealthWorker[];
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

export interface DashboardVulnTrendPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface SearchImageResult {
  image_name: string;
  scan_count: number;
}

export interface SearchVulnResult {
  vuln_id: string;
  pkg_name: string;
  severity: string;
  scan_count: number;
}

export interface SearchScanResult {
  id: string;
  image_name: string;
  image_tag: string;
  status: string;
  critical_count: number;
  high_count: number;
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
  auth_type: 'local' | 'oidc';
  last_login_at?: string | null;
  last_login_method: 'local' | 'oidc' | '';
  created_at: string;
  updated_at: string;
}

export interface AdminToken {
  id: string;
  key: string;
  description: string;
  type: string;
  disabled: boolean;
  disabled_reason: string;
  created_at: string;
  expires_at: string;
  user_id: string;
}

export interface AuditLogFilters {
  operation?: string;
  user?: string;
  q?: string;
  from?: string;
  to?: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  operation: string;
  details: string;
  created_at: string;
  username?: string;
  email?: string;
  role?: string;
}

export interface APIRequestLogFilters {
  method?: string;
  path?: string;
  user?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface APIRequestLog {
  id: string;
  user_id?: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  created_at: string;
  username?: string;
  email?: string;
}

export interface EndpointStat {
  method: string;
  path: string;
  count: number;
}

export interface UserStat {
  user_id?: string;
  username: string;
  count: number;
}

export interface StatusBucket {
  status_code: number;
  count: number;
}

export interface APIUsageStats {
  total_requests: number;
  error_requests: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  top_endpoints: EndpointStat[];
  top_users: UserStat[];
  status_breakdown: StatusBucket[];
}

export interface XRayRequestLogFilters {
  scan_id?: string;
  registry_id?: string;
  endpoint?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface XRayRequestLog {
  id: string;
  scan_id?: string;
  registry_id?: string;
  method: string;
  endpoint: string;
  status_code: number;
  duration_ms: number;
  error?: string;
  created_at: string;
}

export interface NotificationConfig {
  webhook_url?: string;
  headers?: Record<string, string>;
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_from?: string;
  to_addresses?: string[];
  smtp_tls?: boolean;
  telegram_bot_token?: string;
  telegram_chat_id?: string;
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'discord' | 'email' | 'webhook' | 'slack' | 'teams' | 'telegram';
  config: NotificationConfig;
  enabled: boolean;
  events: string[];
  org_ids: string[];
  image_patterns: string[];
  min_severity: '' | 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  created_at: string;
  updated_at: string;
}

export interface NotificationDelivery {
  id: string;
  channel_id: string;
  event: string;
  triggered_by: string;
  status: string;
  error: string;
  details: string;
  created_at: string;
  channel_name?: string;
}

export interface VulnKBEntry {
  vuln_id: string;
  description: string;
  severity: string;
  cvss_vector: string;
  cvss_score: number;
  published_date: string | null;
  modified_date: string | null;
  references: { url: string; source: string }[];
  exploit_available: boolean;
  fetched_at: string;
}

export interface ImageSummary {
  image_name: string;
  scan_count: number;
  latest_scan_id: string;
  latest_tag: string;
  latest_status: string;
  latest_external_status?: string;
  latest_scan_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

export interface SBOMComponent {
  id: string;
  scan_id: string;
  name: string;
  version: string;
  type: string;
  package_url: string;
  license: string;
  supplier: string;
  created_at: string;
}

export interface StatusPageTarget {
  id?: string;
  page_id?: string;
  image_name: string;
  image_tag: string;
  display_order: number;
  created_at?: string;
}

export interface StatusPageUpdate {
  id?: string;
  page_id?: string;
  title: string;
  body: string;
  level: 'info' | 'maintenance' | 'incident';
  active_from?: string | null;
  active_until?: string | null;
  created_by_user_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StatusPage {
  id: string;
  name: string;
  slug: string;
  description: string;
  visibility: 'private' | 'public' | 'authenticated';
  include_all_tags: boolean;
  image_patterns?: string[];
  stale_after_hours: number;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  created_at: string;
  updated_at: string;
  targets?: StatusPageTarget[];
  updates?: StatusPageUpdate[];
}

export interface StatusPageItem {
  image_name: string;
  image_tag: string;
  latest_scan_id: string;
  scan_status: string;
  external_status?: string;
  scan_provider?: string;
  current_step?: string;
  started_at?: string;
  status: string;
  error_message?: string;
  blocked_policy_details?: BlockedPolicyDetails | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  previous_scan_id?: string;
  previous_critical_count?: number;
  previous_high_count?: number;
  previous_medium_count?: number;
  previous_low_count?: number;
  delta_critical_count?: number;
  delta_high_count?: number;
  delta_medium_count?: number;
  delta_low_count?: number;
  freshness_hours: number;
  observed_at: string;
  previous_scan_at?: string;
  display_order: number;
}

export interface StatusPageScanSummary {
  scan_id: string;
  image_name: string;
  image_tag: string;
  scan_status: string;
  external_status?: string;
  scan_provider?: string;
  current_step?: string;
  error_message?: string;
  blocked_policy_details?: BlockedPolicyDetails | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  observed_at: string;
  is_latest: boolean;
}

export interface StatusPageResponse {
  page: StatusPage;
  items: StatusPageItem[];
  now: string;
}

export interface StatusPagePayload {
  name: string;
  slug?: string;
  description?: string;
  visibility: 'private' | 'public' | 'authenticated';
  org_id?: string;
  include_all_tags: boolean;
  image_patterns?: string[];
  stale_after_hours: number;
  targets: StatusPageTarget[];
  updates?: StatusPageUpdate[];
}

export interface StatusPageTargetOption {
  id: string;
  image_name: string;
  image_tag: string;
  label: string;
  latest_scan_id: string;
  latest_status: string;
  observed_at: string;
  critical_count: number;
  high_count: number;
}

