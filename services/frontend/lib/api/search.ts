import { req } from './core';
import { appendScope } from './scope';
import type { SearchImageResult, SearchScanResult, SearchVulnResult } from './types/search';

export const search = (q: string) => {
  const params = new URLSearchParams({ q });
  appendScope(params);
  return req<{ images: SearchImageResult[]; vulns: SearchVulnResult[]; scans: SearchScanResult[] }>('GET', `/api/v1/search/?${params}`);
};