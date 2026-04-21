import type { AuthSnapshot } from './types/common';

const TOKEN_STORAGE_KEY = 'justscan_token';
const USER_STORAGE_KEY = 'justscan_user';

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