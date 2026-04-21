import { sharedReq } from './core';
import type { SharedScanRescanResponse, Scan, Vulnerability, VulnerabilityContextAnalysis } from './types/scans';

export const getSharedScan = (token: string) =>
  sharedReq<Scan>('GET', `/api/v1/shared/${token}`);

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
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (severity) params.set('severity', severity);
  if (pkg) params.set('pkg', pkg);
  if (hasFix) params.set('has_fix', 'true');
  if (minCvss) params.set('min_cvss', String(minCvss));
  if (sortBy) params.set('sort_by', sortBy);
  if (sortDir) params.set('sort_dir', sortDir);
  return sharedReq<{ data: Vulnerability[]; total: number }>('GET', `/api/v1/shared/${token}/vulnerabilities?${params}`);
};

export const rescanShared = (token: string) =>
  sharedReq<SharedScanRescanResponse>('POST', `/api/v1/shared/${token}/rescan`);

export const getSharedVulnerabilityContextAnalysis = (token: string, vulnerabilityId: string) =>
  sharedReq<VulnerabilityContextAnalysis>('GET', `/api/v1/shared/${token}/vulnerabilities/${vulnerabilityId}/analysis`);