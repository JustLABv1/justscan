import { req, reqForm } from './core';
import { appendScope } from './scope';
import type {
  ResourceShare,
  VulnerabilityViewPreferenceResponse,
  VulnerabilityViewSettings,
} from './types/orgs';
import type {
  BulkDeleteScansResponse,
  ArtifactFilterOptions,
  ArtifactSummary,
  ImageSummary,
  SBOMComponent,
  Scan,
  ScanComparison,
  ScanQueueSummary,
  ScanShareResponse,
  ScanTrendPoint,
  SharedScanRescanResponse,
  Vulnerability,
  VulnerabilitySummary,
  VulnerabilityContextAnalysis,
  XRayRequestLog,
} from './types/scans';

export const listScans = (
  page = 1,
  limit = 20,
  image?: string,
  status?: string,
  exact?: boolean,
  helmOnly?: boolean,
  helmChart?: string,
  collection?: string,
  from?: string,
  to?: string,
  imageTag?: string,
  query?: string
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (image) params.set('image', image);
  if (status) params.set('status', status);
  if (exact) params.set('exact', 'true');
  if (helmOnly) params.set('helm_only', 'true');
  if (helmChart) params.set('helm_chart', helmChart);
  if (collection) params.set('collection', collection);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (imageTag) params.set('image_tag', imageTag);
  if (query) params.set('q', query);
  appendScope(params);
  return req<{ data: Scan[]; total: number }>('GET', `/api/v1/scans/?${params}`);
};

export const listScanArtifacts = (
  page = 1,
  limit = 30,
  query?: string,
  status?: string,
  critical?: '' | 'yes' | 'no',
  collection?: string,
  policy?: '' | 'fail'
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (critical) params.set('critical', critical);
  if (collection) params.set('collection', collection);
  if (policy) params.set('policy', policy);
  appendScope(params);
  return req<{ data: ArtifactSummary[]; total: number; filters: ArtifactFilterOptions }>(
    'GET',
    `/api/v1/scans/artifacts?${params}`
  );
};

export const listScanImages = (
  page = 1,
  limit = 30,
  image?: string,
  status?: string,
  collection?: string
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (image) params.set('image', image);
  if (status) params.set('status', status);
  if (collection) params.set('collection', collection);
  appendScope(params);
  return req<{ data: ImageSummary[]; total: number }>('GET', `/api/v1/scans/images?${params}`);
};

export const getScanQueueSummary = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const query = params.toString();
  return req<ScanQueueSummary>('GET', `/api/v1/scans/queue-summary${query ? `?${query}` : ''}`);
};

export const getScan = (id: string) => req<Scan>('GET', `/api/v1/scans/${id}`);

export const getScanXrayRequestLogs = (id: string, limit = 200) =>
  req<{ data: XRayRequestLog[] }>('GET', `/api/v1/scans/${id}/xray-requests?limit=${limit}`).then(
    (result) => result.data ?? []
  );

export const createScan = (
  imageName: string,
  imageTag: string,
  registryId?: string,
  tagIds?: string[],
  platform?: string,
  orgId?: string,
  xrayRepository?: string
) =>
  req<Scan>('POST', '/api/v1/scans/', {
    image: imageName,
    tag: imageTag,
    registry_id: registryId,
    tag_ids: tagIds,
    platform,
    org_id: orgId,
    xray_repository: xrayRepository,
  });

export const createScans = (
  images: string[],
  registryId?: string,
  tagIds?: string[],
  platform?: string,
  orgId?: string,
  xrayRepository?: string
) =>
  req<{ scans: Scan[] }>('POST', '/api/v1/scans/batch', {
    images,
    registry_id: registryId,
    tag_ids: tagIds,
    platform,
    org_id: orgId,
    xray_repository: xrayRepository,
  });

export const createUploadedArchiveScan = (input: {
  archive: File;
  imageName?: string;
  imageTag?: string;
  platform?: string;
  orgId?: string;
  tagIds?: string[];
}) => {
  const formData = new FormData();
  formData.append('archive', input.archive);
  if (input.imageName) formData.append('image_name', input.imageName);
  if (input.imageTag) formData.append('image_tag', input.imageTag);
  if (input.platform) formData.append('platform', input.platform);
  if (input.tagIds && input.tagIds.length > 0) formData.append('tag_ids', input.tagIds.join(','));
  const path = input.orgId
    ? `/api/v1/orgs/${input.orgId}/archive-scans`
    : '/api/v1/scans/upload';
  return reqForm<Scan>('POST', path, formData);
};

export const deleteScan = (id: string) => req<{ result: string }>('DELETE', `/api/v1/scans/${id}`);

export const listVulnerabilities = (
  scanId: string,
  page = 1,
  limit = 100,
  severity?: string,
  pkg?: string,
  hasFix?: boolean,
  minCvss?: number,
  sortBy?: string,
  sortDir?: 'asc' | 'desc'
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (severity) params.set('severity', severity);
  if (pkg) params.set('pkg', pkg);
  if (hasFix) params.set('has_fix', 'true');
  if (minCvss) params.set('min_cvss', String(minCvss));
  if (sortBy) params.set('sort_by', sortBy);
  if (sortDir) params.set('sort_dir', sortDir);
  return req<{ data: Vulnerability[]; total: number }>(
    'GET',
    `/api/v1/scans/${scanId}/vulnerabilities?${params}`
  );
};

export const getVulnerabilitySummary = (
  scanId: string,
  severity?: string,
  pkg?: string,
  hasFix?: boolean,
  minCvss?: number
) => {
  const params = new URLSearchParams();
  if (severity) params.set('severity', severity);
  if (pkg) params.set('pkg', pkg);
  if (hasFix) params.set('has_fix', 'true');
  if (minCvss) params.set('min_cvss', String(minCvss));
  const query = params.toString();
  return req<VulnerabilitySummary>(
    'GET',
    `/api/v1/scans/${scanId}/vulnerabilities/summary${query ? `?${query}` : ''}`
  );
};

const vulnerabilityViewQuery = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const getScanVulnerabilityViewSettings = (scanId: string) =>
  req<VulnerabilityViewPreferenceResponse>(
    'GET',
    `/api/v1/scans/${scanId}/vulnerability-view${vulnerabilityViewQuery()}`
  );

export const saveScanVulnerabilityViewPreference = (
  scanId: string,
  settings: VulnerabilityViewSettings
) =>
  req<VulnerabilityViewPreferenceResponse>(
    'PUT',
    `/api/v1/scans/${scanId}/vulnerability-view${vulnerabilityViewQuery()}`,
    settings
  );

export const resetScanVulnerabilityViewPreference = (scanId: string) =>
  req<VulnerabilityViewPreferenceResponse>(
    'DELETE',
    `/api/v1/scans/${scanId}/vulnerability-view${vulnerabilityViewQuery()}`
  );

export const getVulnerabilityContextAnalysis = (scanId: string, vulnerabilityId: string) =>
  req<VulnerabilityContextAnalysis>(
    'GET',
    `/api/v1/scans/${scanId}/vulnerabilities/${vulnerabilityId}/analysis`
  );

export const compareScans = (scanIdA: string, scanIdB: string) =>
  req<ScanComparison>('GET', `/api/v1/scans/compare?a=${scanIdA}&b=${scanIdB}`);

export const getScanTrends = (imageName?: string, imageTag?: string, days = 30) => {
  const params = new URLSearchParams({ days: String(days) });
  if (imageName) params.set('image_name', imageName);
  if (imageTag) params.set('image_tag', imageTag);
  return req<{ data: ScanTrendPoint[] }>('GET', `/api/v1/scans/trends?${params}`).then(
    (result) => result.data ?? []
  );
};

export const reScan = (id: string) => req<Scan>('POST', `/api/v1/scans/${id}/rescan`);

export const refreshScanXrayPolicy = (id: string) => {
  const params = new URLSearchParams();
  appendScope(params);
  const query = params.toString();
  return req<{ scan: Scan; violation_count: number }>(
    'POST',
    `/api/v1/scans/${id}/xray-policy-refresh${query ? `?${query}` : ''}`
  );
};

export const cancelScan = (id: string) =>
  req<{
    result: string;
    status?: string;
    current_step?: string;
    external_status?: string;
    completed_at?: string;
    error_message?: string;
  }>('POST', `/api/v1/scans/${id}/cancel`);

export const bulkDeleteScans = (ids: string[]) =>
  req<BulkDeleteScansResponse>('DELETE', '/api/v1/scans/bulk', { ids });

export const bulkAddTagToScans = (tagId: string, ids: string[]) =>
  req<{ result: string }>('POST', `/api/v1/scans/bulk/tags/${tagId}`, { ids });

export const bulkGrantScansToOrg = (orgId: string, ids: string[]) =>
  req<{ result: string; count: number }>('POST', '/api/v1/scans/bulk/org-grants', {
    ids,
    org_id: orgId,
  });

export const bulkTransferScansOwnership = (
  ids: string[],
  target: { type: 'user' } | { type: 'org'; orgId: string }
) =>
  req<{ result: string; count: number }>('POST', '/api/v1/scans/bulk/transfer-ownership', {
    ids,
    target_type: target.type,
    ...(target.type === 'org' ? { target_org_id: target.orgId } : {}),
  });

export const bulkAddCollectionToScans = (collectionId: string, ids: string[]) => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ result: string }>(
    'POST',
    `/api/v1/scans/bulk/collections/${collectionId}${qs ? `?${qs}` : ''}`,
    { ids }
  );
};

export const bulkRemoveCollectionFromScans = (collectionId: string, ids: string[]) => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ result: string }>(
    'DELETE',
    `/api/v1/scans/bulk/collections/${collectionId}${qs ? `?${qs}` : ''}`,
    { ids }
  );
};

export const getScanSBOM = (scanId: string, name?: string, type?: string) => {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (type) params.set('type', type);
  return req<{ data: SBOMComponent[]; total: number }>(
    'GET',
    `/api/v1/scans/${scanId}/sbom?${params}`
  );
};

export const createShare = (scanId: string, visibility: 'public' | 'authenticated') =>
  req<ScanShareResponse>('POST', `/api/v1/scans/${scanId}/share`, { visibility });

export const deleteShare = (scanId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/share`);

export const listScanOrgGrants = (scanId: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/scans/${scanId}/org-grants`).then(
    (result) => result.data ?? []
  );

export const grantScanOrgAccess = (scanId: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/scans/${scanId}/org-grants`, { org_id: orgId });

export const revokeScanOrgAccess = (scanId: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/org-grants/${orgId}`);

export type { SharedScanRescanResponse };
