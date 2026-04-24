import { publicReq } from './core';
import type { HelmExtractResponse, HelmScanRun, HelmScanRunDetail } from './types/helm';
import type { PublicSettings } from './types/registries';
import type { Scan, Vulnerability, VulnerabilityContextAnalysis } from './types/scans';

export const getPublicSettings = () =>
  publicReq<PublicSettings>('GET', '/api/v1/public/settings');

export const createPublicScan = (image: string, tag: string, platform?: string) =>
  publicReq<Scan>('POST', '/api/v1/public/scans', { image, tag, platform });

export const reScanPublic = (id: string) =>
  publicReq<Scan>('POST', `/api/v1/public/scans/${id}/rescan`);

export const getPublicScan = (id: string) =>
  publicReq<Scan>('GET', `/api/v1/public/scans/${id}`);

export const listPublicVulnerabilities = (
  scanId: string,
  page = 1,
  limit = 50,
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
  return publicReq<{ data: Vulnerability[]; total: number }>('GET', `/api/v1/public/scans/${scanId}/vulnerabilities?${params}`);
};

export const getPublicVulnerabilityContextAnalysis = (scanId: string, vulnerabilityId: string) =>
  publicReq<VulnerabilityContextAnalysis>('GET', `/api/v1/public/scans/${scanId}/vulnerabilities/${vulnerabilityId}/analysis`);

export const extractPublicHelmImages = (chartUrl: string, chartName?: string, chartVersion?: string) =>
  publicReq<HelmExtractResponse>('POST', '/api/v1/public/helm/extract', {
    chart_url: chartUrl,
    chart_name: chartName,
    chart_version: chartVersion,
  });

export const createPublicHelmScans = (
  chartUrl: string,
  images: Array<{ full_ref: string; source_path: string }>,
  platform?: string,
  chartName?: string,
  chartVersion?: string,
) =>
  publicReq<{ run?: HelmScanRun; scans: Scan[] }>('POST', '/api/v1/public/helm/scan', {
    chart_url: chartUrl,
    images,
    platform: platform || undefined,
    chart_name: chartName,
    chart_version: chartVersion,
  });

export const getPublicHelmScanRun = (id: string) =>
  publicReq<HelmScanRunDetail>('GET', `/api/v1/public/helm/runs/${id}`);