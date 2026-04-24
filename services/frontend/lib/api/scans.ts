import { req } from './core';
import { appendScope } from './scope';
import type { ResourceShare } from './types/orgs';
import type { BulkDeleteScansResponse, ImageSummary, SBOMComponent, Scan, ScanComparison, ScanShareResponse, ScanTrendPoint, SharedScanRescanResponse, Vulnerability, VulnerabilityContextAnalysis } from './types/scans';

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

export const getVulnerabilityContextAnalysis = (scanId: string, vulnerabilityId: string) =>
  req<VulnerabilityContextAnalysis>('GET', `/api/v1/scans/${scanId}/vulnerabilities/${vulnerabilityId}/analysis`);

export const compareScans = (scanIdA: string, scanIdB: string) =>
  req<ScanComparison>('GET', `/api/v1/scans/compare?a=${scanIdA}&b=${scanIdB}`);

export const getScanTrends = (imageName?: string, imageTag?: string, days = 30) => {
  const params = new URLSearchParams({ days: String(days) });
  if (imageName) params.set('image_name', imageName);
  if (imageTag) params.set('image_tag', imageTag);
  return req<{ data: ScanTrendPoint[] }>('GET', `/api/v1/scans/trends?${params}`).then((result) => result.data ?? []);
};

export const reScan = (id: string) =>
  req<Scan>('POST', `/api/v1/scans/${id}/rescan`);

export const cancelScan = (id: string) =>
  req<{ result: string; status?: string; current_step?: string; external_status?: string; completed_at?: string; error_message?: string }>('POST', `/api/v1/scans/${id}/cancel`);

export const bulkDeleteScans = (ids: string[]) =>
  req<BulkDeleteScansResponse>('DELETE', '/api/v1/scans/bulk', { ids });

export const bulkAddTagToScans = (tagId: string, ids: string[]) =>
  req<{ result: string }>('POST', `/api/v1/scans/bulk/tags/${tagId}`, { ids });

export const getScanSBOM = (scanId: string, name?: string, type?: string) => {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (type) params.set('type', type);
  return req<{ data: SBOMComponent[]; total: number }>('GET', `/api/v1/scans/${scanId}/sbom?${params}`);
};

export const createShare = (scanId: string, visibility: 'public' | 'authenticated') =>
  req<ScanShareResponse>('POST', `/api/v1/scans/${scanId}/share`, { visibility });

export const deleteShare = (scanId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/share`);

export const listScanOrgGrants = (scanId: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/scans/${scanId}/org-grants`).then((result) => result.data ?? []);

export const grantScanOrgAccess = (scanId: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/scans/${scanId}/org-grants`, { org_id: orgId });

export const revokeScanOrgAccess = (scanId: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/org-grants/${orgId}`);

export type { SharedScanRescanResponse };