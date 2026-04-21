import { req } from './core';
import { getDefaultScannerCapabilities } from './registries';
import type { APIRequestLog, APIRequestLogFilters, APIUsageStats, AdminToken, AdminUser, AuditLog, AuditLogFilters, NotificationChannel, NotificationDelivery, XRayRequestLog, XRayRequestLogFilters } from './types/admin';
import type { AdminScan } from './types/scans';
import type { AutoTagRule, OIDCGroupMapping, OIDCProviderAdmin, Registry, RegistryListResponse, ScannerSettings } from './types/registries';

export const adminListOIDCProviders = () =>
  req<{ data: OIDCProviderAdmin[] }>('GET', '/api/v1/admin/oidc-providers').then((result) => result.data ?? []);

export const adminCreateOIDCProvider = (data: Partial<OIDCProviderAdmin>) =>
  req<OIDCProviderAdmin>('POST', '/api/v1/admin/oidc-providers', data);

export const adminUpdateOIDCProvider = (name: string, data: Partial<OIDCProviderAdmin>) =>
  req<OIDCProviderAdmin>('PUT', `/api/v1/admin/oidc-providers/${name}`, data);

export const adminDeleteOIDCProvider = (name: string) =>
  req<void>('DELETE', `/api/v1/admin/oidc-providers/${name}`);

export const adminListGroupMappings = (providerName: string) =>
  req<{ data: OIDCGroupMapping[] }>('GET', `/api/v1/admin/oidc-providers/${providerName}/group-mappings`).then((result) => result.data ?? []);

export const adminCreateGroupMapping = (providerName: string, data: Partial<OIDCGroupMapping>) =>
  req<OIDCGroupMapping>('POST', `/api/v1/admin/oidc-providers/${providerName}/group-mappings`, data);

export const adminDeleteGroupMapping = (providerName: string, mappingId: string) =>
  req<void>('DELETE', `/api/v1/admin/oidc-providers/${providerName}/group-mappings/${mappingId}`);

export const adminUpdateScannerSettings = (data: Partial<ScannerSettings>) =>
  req<{ updated: Record<string, string> }>('PUT', '/api/v1/admin/settings/scanner', data);

export const adminUpdateAuthSettings = (data: { local_auth_enabled: boolean }) =>
  req<{ local_auth_enabled: boolean }>('PUT', '/api/v1/admin/settings/auth', data);

export const adminListGlobalRegistries = () =>
  req<RegistryListResponse>('GET', '/api/v1/admin/registries').then((result) => ({ data: result.data ?? [], capabilities: result.capabilities ?? getDefaultScannerCapabilities() }));

export const adminCreateGlobalRegistry = (data: Partial<Registry>) =>
  req<Registry>('POST', '/api/v1/admin/registries', data);

export const adminDeleteGlobalRegistry = (id: string) =>
  req<void>('DELETE', `/api/v1/admin/registries/${id}`);

export const adminSetDefaultRegistry = (id: string) =>
  req<{ id: string; is_default: boolean }>('PUT', `/api/v1/admin/registries/${id}/set-default`);

export const adminUnsetDefaultRegistry = (id: string) =>
  req<{ id: string; is_default: boolean }>('PUT', `/api/v1/admin/registries/${id}/unset-default`);

export const getAdminSettings = () =>
  req<Record<string, string>>('GET', '/api/v1/admin/settings');

export const setPublicScanEnabled = (enabled: boolean) =>
  req<{ enabled: boolean }>('PUT', '/api/v1/admin/settings/public-scan', { enabled });

export const listAutoTagRules = () =>
  req<{ data: AutoTagRule[] }>('GET', '/api/v1/auto-tags/').then((result) => result.data ?? []);

export const createAutoTagRule = (pattern: string, tag_id: string) =>
  req<AutoTagRule>('POST', '/api/v1/auto-tags/', { pattern, tag_id });

export const updateAutoTagRule = (id: string, pattern: string, tag_id: string) =>
  req<AutoTagRule>('PUT', `/api/v1/auto-tags/${id}`, { pattern, tag_id });

export const deleteAutoTagRule = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/auto-tags/${id}`);

export const listAdminUsers = () =>
  req<{ users: AdminUser[] }>('GET', '/api/v1/admin/users').then((result) => result.users ?? []);

export const updateAdminUser = (id: string, data: { username?: string; email?: string; role?: string; password?: string }) =>
  req<{ result: string }>('PUT', `/api/v1/admin/users/${id}`, data);

export const deleteAdminUser = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/admin/users/${id}`);

export const disableAdminUser = (id: string, disabled: boolean, disabled_reason?: string) =>
  req<{ result: string }>('PUT', `/api/v1/admin/users/${id}/disable`, { disabled, disabled_reason: disabled_reason ?? '' });

export const createAdminUser = (username: string, email: string, password: string, role: string) =>
  req<{ result: string }>('POST', '/api/v1/admin/users/', { username, email, password, role });

export const listAdminTokens = () =>
  req<{ tokens: AdminToken[] }>('GET', '/api/v1/admin/tokens').then((result) => result.tokens ?? []);

export const updateAdminToken = (id: string, data: Pick<AdminToken, 'description' | 'disabled' | 'disabled_reason'>) =>
  req<{ result: string }>('PUT', `/api/v1/admin/tokens/${id}`, data);

export const deleteAdminToken = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/admin/tokens/${id}`);

export const listAuditLogs = (page = 1, limit = 50, filters?: AuditLogFilters) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters?.operation) params.set('operation', filters.operation);
  if (filters?.user) params.set('user', filters.user);
  if (filters?.q) params.set('q', filters.q);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  return req<{ data: AuditLog[]; total: number }>('GET', `/api/v1/admin/audit?${params}`);
};

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

export const updateAPILogRetention = (days: number) =>
  req<{ days: number }>('PUT', '/api/v1/admin/settings/api-log-retention', { days });

export const updateXRayLogRetention = (days: number) =>
  req<{ days: number }>('PUT', '/api/v1/admin/settings/xray-log-retention', { days });

export const listNotificationChannels = () =>
  req<{ data: NotificationChannel[] }>('GET', '/api/v1/admin/notifications').then((result) => result.data ?? []);

export const createNotificationChannel = (data: Partial<NotificationChannel>) =>
  req<NotificationChannel>('POST', '/api/v1/admin/notifications', data);

export const updateNotificationChannel = (id: string, data: Partial<NotificationChannel>) =>
  req<NotificationChannel>('PUT', `/api/v1/admin/notifications/${id}`, data);

export const deleteNotificationChannel = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/admin/notifications/${id}`);

export const testNotificationChannel = (id: string, event?: string) =>
  req<{ result: string }>('POST', `/api/v1/admin/notifications/${id}/test`, event ? { event } : {});

export const listNotificationDeliveries = (id: string, limit = 10) =>
  req<{ data: NotificationDelivery[] }>('GET', `/api/v1/admin/notifications/${id}/deliveries?limit=${limit}`).then((result) => result.data ?? []);

export const updateRateLimit = (limit: number) =>
  req<{ limit: number }>('PUT', '/api/v1/admin/settings/rate-limit', { limit });

export const updateRegisterRateLimit = (limit: number) =>
  req<{ limit: number }>('PUT', '/api/v1/admin/settings/register-rate-limit', { limit });

export const listAdminScans = (page = 1, limit = 50, image?: string, status?: string, helmOnly?: boolean, owner?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (image) params.set('image', image);
  if (status) params.set('status', status);
  if (helmOnly) params.set('helm_only', 'true');
  if (owner) params.set('owner', owner);
  return req<{ data: AdminScan[]; total: number }>('GET', `/api/v1/admin/scans?${params}`);
};