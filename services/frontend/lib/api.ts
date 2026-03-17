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

export const createScan = (imageName: string, imageTag: string, registryId?: string, tagIds?: string[]) =>
  req<Scan>('POST', '/api/v1/scans/', { image: imageName, tag: imageTag, registry_id: registryId, tag_ids: tagIds });

export const deleteScan = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${id}`);

export const listVulnerabilities = (scanId: string, page = 1, limit = 100, severity?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (severity) params.set('severity', severity);
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

// Registries
export const listRegistries = () =>
  req<{ data: Registry[] }>('GET', '/api/v1/registries/').then((r) => r.data ?? []);
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

// Suppressions
export const listSuppressions = (digest: string) =>
  req<Suppression[]>('GET', `/api/v1/images/${encodeURIComponent(digest)}/suppressions`);
export const upsertSuppression = (digest: string, data: Partial<Suppression>) =>
  req<Suppression>('POST', `/api/v1/images/${encodeURIComponent(digest)}/suppressions`, data);
export const deleteSuppression = (digest: string, vulnId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/images/${encodeURIComponent(digest)}/suppressions/${encodeURIComponent(vulnId)}`);

// Types
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
  auth_type: 'basic' | 'token' | 'aws_ecr';
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

export interface DashboardStats {
  total_scans: number;
  status_counts: Record<string, number>;
  severity_totals: Record<string, number>;
  recent_scans: Scan[] | null;
  top_images: { image_name: string; count: number }[] | null;
  watchlist_count: number;
}
