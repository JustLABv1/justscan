import { req } from './core';
import { appendScope } from './scope';
import type { ResourceShare } from './types/orgs';
import type { Suppression, SuppressionAppliedImage } from './types/scans';

export const listSuppressions = (digest: string) =>
  req<Suppression[]>('GET', `/api/v1/images/${digest}/suppressions`);

export const upsertSuppression = (
  digest: string,
  data: Partial<Suppression> & { org_id?: string; is_global?: boolean }
) => req<Suppression>('POST', `/api/v1/images/${digest}/suppressions`, data);

export const deleteSuppression = (digest: string, vulnId: string, orgId?: string) => {
  const params = new URLSearchParams();
  if (orgId) params.set('org_id', orgId);
  const suffix = params.toString() ? `?${params}` : '';
  return req<{ result: string }>(
    'DELETE',
    `/api/v1/images/${digest}/suppressions/${encodeURIComponent(vulnId)}${suffix}`
  );
};

export const deleteSuppressionById = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/suppressions/${id}`);

export const listSuppressionShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/suppressions/${id}/shares`).then(
    (result) => result.data ?? []
  );

export const shareSuppression = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/suppressions/${id}/shares`, { org_id: orgId });

export const unshareSuppression = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/suppressions/${id}/shares/${orgId}`);

export const transferSuppressionOwnership = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/suppressions/${id}/transfer-ownership`, {
    org_id: orgId,
  });

export const listSuppressionImages = (id: string) => {
  const params = new URLSearchParams();
  appendScope(params);
  const suffix = params.toString() ? `?${params}` : '';
  return req<{ data: SuppressionAppliedImage[]; total: number }>(
    'GET',
    `/api/v1/suppressions/${id}/images${suffix}`
  );
};

export const listAllSuppressions = (page = 1, limit = 50, status?: string, q?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  appendScope(params);
  return req<{ data: Suppression[]; total: number }>('GET', `/api/v1/suppressions/?${params}`);
};
