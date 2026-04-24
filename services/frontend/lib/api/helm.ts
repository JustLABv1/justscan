import { req } from './core';
import type { HelmExtractResponse, HelmScanRunDetail, HelmScanRunSummary } from './types/helm';
import type { Scan } from './types/scans';

export const extractHelmImages = (chartUrl: string, chartName?: string, chartVersion?: string) =>
  req<HelmExtractResponse>('POST', '/api/v1/helm/extract', {
    chart_url: chartUrl,
    chart_name: chartName,
    chart_version: chartVersion,
  });

export const createHelmScans = (
  chartUrl: string,
  images: Array<{ full_ref: string; source_path: string }>,
  platform?: string,
  tagIds?: string[],
  chartName?: string,
  chartVersion?: string,
  registryId?: string,
  orgId?: string,
) =>
  req<{ run: import('./types/helm').HelmScanRun; scans: Scan[] }>('POST', '/api/v1/helm/scan', {
    chart_url: chartUrl,
    images,
    platform: platform || undefined,
    registry_id: registryId || undefined,
    tag_ids: tagIds,
    chart_name: chartName,
    chart_version: chartVersion,
    org_id: orgId,
  });

export const listHelmScanRuns = (page = 1, limit = 20, chartUrl?: string) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (chartUrl) params.set('chart_url', chartUrl);
  return req<{ data: HelmScanRunSummary[]; total: number }>('GET', `/api/v1/helm/runs?${params}`);
};

export const getHelmScanRun = (id: string) =>
  req<HelmScanRunDetail>('GET', `/api/v1/helm/runs/${id}`);