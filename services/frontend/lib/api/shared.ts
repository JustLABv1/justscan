import { sharedReq, type ApiRequestOptions } from './core';
import type {
  SBOMComponent,
  SBOMComponentDetail,
  SBOMDocument,
  SBOMGraph,
  Scan,
  SharedScanRescanResponse,
  Vulnerability,
  VulnerabilityContextAnalysis,
} from './types/scans';

export const getSharedScan = (token: string, options?: ApiRequestOptions) =>
  sharedReq<Scan>('GET', `/api/v1/shared/${token}`, undefined, options);

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
  options?: ApiRequestOptions
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
    `/api/v1/shared/${token}/vulnerabilities?${params}`,
    undefined,
    options
  );
};

export const rescanShared = (token: string) =>
  sharedReq<SharedScanRescanResponse>('POST', `/api/v1/shared/${token}/rescan`);

export const getSharedVulnerabilityContextAnalysis = (token: string, vulnerabilityId: string) =>
  sharedReq<VulnerabilityContextAnalysis>(
    'GET',
    `/api/v1/shared/${token}/vulnerabilities/${vulnerabilityId}/analysis`
  );

export const getSharedSBOM = (token: string, name?: string) => {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  return sharedReq<{ data: SBOMComponent[]; total: number; document?: SBOMDocument }>(
    'GET',
    `/api/v1/shared/${token}/sbom?${params}`
  );
};

export const getSharedSBOMGraph = (token: string, focus?: string) => {
  const params = new URLSearchParams();
  if (focus) params.set('focus', focus);
  return sharedReq<SBOMGraph>('GET', `/api/v1/shared/${token}/sbom/graph?${params}`);
};

export const getSharedSBOMComponent = (token: string, componentId: string) =>
  sharedReq<SBOMComponentDetail>('GET', `/api/v1/shared/${token}/sbom/components/${componentId}`);
