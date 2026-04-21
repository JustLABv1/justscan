import { req } from './core';
import type { VulnKBEntry } from './types/vulnkb';

export const listKBEntries = (q?: string, severity?: string, page = 1, limit = 50, exploit?: boolean, minCvss?: number, publishedAfter?: string) => {
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