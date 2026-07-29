import { req } from './core';
import { appendScope } from './scope';
import type { ResourceShare } from './types/orgs';
import type { HelmRegistryCredential, HelmRegistryCredentialInput } from './types/helm-registry-credentials';

export const listHelmRegistryCredentials = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const query = params.toString();
  return req<{ data: HelmRegistryCredential[] }>('GET', `/api/v1/helm-registry-credentials/${query ? `?${query}` : ''}`).then((result) => result.data ?? []);
};
export const createHelmRegistryCredential = (data: HelmRegistryCredentialInput) => req<HelmRegistryCredential>('POST', '/api/v1/helm-registry-credentials/', data);
export const updateHelmRegistryCredential = (id: string, data: Partial<HelmRegistryCredentialInput>) => req<HelmRegistryCredential>('PUT', `/api/v1/helm-registry-credentials/${id}`, data);
export const deleteHelmRegistryCredential = (id: string) => req<{ result: string }>('DELETE', `/api/v1/helm-registry-credentials/${id}`);
export const testHelmRegistryCredential = (id: string) => req<Pick<HelmRegistryCredential, 'health_status' | 'health_message' | 'last_health_check_at'>>('POST', `/api/v1/helm-registry-credentials/${id}/test`);
export const listHelmRegistryCredentialShares = (id: string) => req<{ data: ResourceShare[] }>('GET', `/api/v1/helm-registry-credentials/${id}/shares`).then((result) => result.data ?? []);
export const shareHelmRegistryCredential = (id: string, orgId: string) => req<{ result: string }>('POST', `/api/v1/helm-registry-credentials/${id}/shares`, { org_id: orgId });
export const unshareHelmRegistryCredential = (id: string, orgId: string) => req<{ result: string }>('DELETE', `/api/v1/helm-registry-credentials/${id}/shares/${orgId}`);
export const transferHelmRegistryCredentialOwnership = (id: string, orgId: string) => req<{ result: string }>('POST', `/api/v1/helm-registry-credentials/${id}/transfer-ownership`, { org_id: orgId });
