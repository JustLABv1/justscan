import { req, type ApiRequestOptions } from './core';
import { appendScope } from './scope';
import type {
  DashboardStats,
  DashboardTrendPoint,
  DashboardVulnTrendPoint,
  ScannerHealth,
} from './types/dashboard';

export const getStats = (options?: ApiRequestOptions) => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<DashboardStats>(
    'GET',
    `/api/v1/dashboard/stats${qs ? `?${qs}` : ''}`,
    undefined,
    options
  );
};

export const getScannerHealth = (options?: ApiRequestOptions) =>
  req<ScannerHealth>('GET', '/api/v1/dashboard/scanner-health', undefined, options);

export const getDashboardTrends = (
  range: '6h' | '24h' | '7d' | '30d' = '30d',
  options?: ApiRequestOptions
) => {
  const params = new URLSearchParams();
  params.set('range', range);
  appendScope(params);
  const qs = params.toString();
  return req<{ data: DashboardTrendPoint[] }>(
    'GET',
    `/api/v1/dashboard/trends${qs ? `?${qs}` : ''}`,
    undefined,
    options
  ).then((result) => result.data ?? []);
};

export const getDashboardVulnTrends = (days = 30, options?: ApiRequestOptions) => {
  const params = new URLSearchParams({ days: String(days) });
  appendScope(params);
  return req<{ data: DashboardVulnTrendPoint[] }>(
    'GET',
    `/api/v1/dashboard/vuln-trends?${params.toString()}`,
    undefined,
    options
  ).then((result) => result.data ?? []);
};
