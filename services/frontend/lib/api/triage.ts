import { req } from './core';
import { appendScope } from './scope';
import type { TriageResponse } from './types/triage';

export const getTriage = (options?: {
  limit?: number;
  offset?: number;
  kind?: 'all' | 'scan' | 'policy' | 'fix' | 'watchlist';
  priority?: 'all' | 'critical' | 'high' | 'medium';
  query?: string;
}) => {
  const params = new URLSearchParams({
    limit: String(options?.limit ?? 50),
    offset: String(options?.offset ?? 0),
  });
  if (options?.kind) params.set('kind', options.kind);
  if (options?.priority) params.set('priority', options.priority);
  if (options?.query) params.set('q', options.query);
  appendScope(params);
  return req<TriageResponse>('GET', `/api/v1/triage/?${params}`);
};
