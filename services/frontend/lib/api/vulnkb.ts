import { req } from './core';
import type {
  PublicVulnerabilityIntelligenceHistory,
  VulnerabilityExposureResponse,
  VulnKBEntry,
} from './types/vulnkb';

export const listKBEntries = (
  q?: string,
  severity?: string,
  page = 1,
  limit = 50,
  exploit?: boolean,
  minCvss?: number,
  publishedAfter?: string
) => {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (severity) params.set('severity', severity);
  if (exploit === true) params.set('exploit', 'true');
  if (minCvss && minCvss > 0) params.set('min_cvss', String(minCvss));
  if (publishedAfter) params.set('published_after', publishedAfter);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return req<{ data: VulnKBEntry[]; total: number }>('GET', `/api/v1/kb/?${params}`);
};

export const getKBEntry = (vulnId: string) =>
  req<VulnKBEntry>('GET', `/api/v1/kb/${encodeURIComponent(vulnId)}`);

export const getKBHistory = (
  vulnId: string,
  options: { limit?: number; beforeAt?: string; beforeId?: string } = {}
) => {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.beforeAt && options.beforeId) {
    params.set('before_at', options.beforeAt);
    params.set('before_id', options.beforeId);
  }
  return req<PublicVulnerabilityIntelligenceHistory>(
    'GET',
    `/api/v1/kb/${encodeURIComponent(vulnId)}/history?${params}`
  );
};

export const getKBExposure = (
  vulnId: string,
  options: { page?: number; limit?: number; posture?: string } = {}
) => {
  const params = new URLSearchParams({
    page: String(options.page ?? 1),
    limit: String(options.limit ?? 25),
  });
  if (options.posture && options.posture !== 'all') params.set('posture', options.posture);
  return req<VulnerabilityExposureResponse>(
    'GET',
    `/api/v1/kb/${encodeURIComponent(vulnId)}/exposure?${params}`
  );
};
