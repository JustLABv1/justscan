import { req, sharedReq } from './core';
import { appendScope } from './scope';
import { listScans } from './scans';
import type { ResourceShare } from './types/orgs';
import type { StatusPage, StatusPagePayload, StatusPageResponse, StatusPageScanSummary, StatusPageTargetOption } from './types/status-pages';
import type { Vulnerability, VulnerabilityContextAnalysis } from './types/scans';

export const listStatusPages = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ data: StatusPage[] }>('GET', `/api/v1/status-pages/${qs ? `?${qs}` : ''}`).then((result) => result.data ?? []);
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
  req<{ data: ResourceShare[] }>('GET', `/api/v1/status-pages/${id}/shares`).then((result) => result.data ?? []);

export const shareStatusPage = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/status-pages/${id}/shares`, { org_id: orgId });

export const unshareStatusPage = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/status-pages/${id}/shares/${orgId}`);

export const getStatusPageBySlug = (slug: string) =>
  sharedReq<StatusPageResponse>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}`);

export const getStatusPageTrackedScan = (slug: string, scanId: string) =>
  sharedReq<StatusPageScanSummary>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/scans/${encodeURIComponent(scanId)}`);

export const listStatusPageScanHistory = (slug: string, scanId: string) =>
  sharedReq<{ data: StatusPageScanSummary[] }>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/scans/${encodeURIComponent(scanId)}/history`).then((result) => result.data ?? []);

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
  return sharedReq<{ data: Vulnerability[]; total: number }>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/items/${encodeURIComponent(scanId)}/vulnerabilities?${params}`);
};

export const getStatusPageItemVulnerabilityContextAnalysis = (slug: string, scanId: string, vulnerabilityId: string) =>
  sharedReq<VulnerabilityContextAnalysis>('GET', `/api/v1/status-pages/slug/${encodeURIComponent(slug)}/items/${encodeURIComponent(scanId)}/vulnerabilities/${encodeURIComponent(vulnerabilityId)}/analysis`);

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