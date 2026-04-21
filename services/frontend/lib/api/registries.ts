import { req } from './core';
import { appendScope } from './scope';
import type { ResourceShare } from './types/orgs';
import type { Registry, RegistryListResponse, ScannerCapabilities, ScanProvider } from './types/registries';

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

export const listRegistries = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<RegistryListResponse>('GET', `/api/v1/registries/${qs ? `?${qs}` : ''}`).then((result) => result.data ?? []);
};

export const listRegistriesWithCapabilities = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<RegistryListResponse>('GET', `/api/v1/registries/${qs ? `?${qs}` : ''}`).then((result) => ({
    data: result.data ?? [],
    capabilities: result.capabilities ?? getDefaultScannerCapabilities(),
  }));
};

export const createRegistry = (data: Partial<Registry> & { org_id?: string }) =>
  req<Registry>('POST', '/api/v1/registries/', data);

export const updateRegistry = (id: string, data: Partial<Registry>) =>
  req<Registry>('PUT', `/api/v1/registries/${id}`, data);

export const deleteRegistry = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/registries/${id}`);

export const listRegistryShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/registries/${id}/shares`).then((result) => result.data ?? []);

export const shareRegistry = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/registries/${id}/shares`, { org_id: orgId });

export const unshareRegistry = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/registries/${id}/shares/${orgId}`);

export const getDefaultRegistry = () =>
  req<Registry>('GET', '/api/v1/registries/default').catch(() => null);

export const testRegistry = (id: string) =>
  req<{ health_status: string; health_message: string; last_health_check_at: string }>('POST', `/api/v1/registries/${id}/test`);