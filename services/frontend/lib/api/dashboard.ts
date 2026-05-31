import { req } from './core';
import { appendScope } from './scope';
import type { DashboardStats, DashboardTrendPoint, DashboardVulnTrendPoint, ScannerHealth } from './types/dashboard';

export const getStats = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<DashboardStats>('GET', `/api/v1/dashboard/stats${qs ? `?${qs}` : ''}`);
};

export const getScannerHealth = () =>
  req<ScannerHealth>('GET', '/api/v1/dashboard/scanner-health');

export const getDashboardTrends = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ data: DashboardTrendPoint[] }>(
    'GET',
    `/api/v1/dashboard/trends${qs ? `?${qs}` : ''}`
  ).then((result) => result.data ?? []);
};

export const getDashboardVulnTrends = (days = 30) => {
  const params = new URLSearchParams({ days: String(days) });
  appendScope(params);
  return req<{ data: DashboardVulnTrendPoint[] }>(
    'GET',
    `/api/v1/dashboard/vuln-trends?${params.toString()}`
  ).then((result) => result.data ?? []);
};
