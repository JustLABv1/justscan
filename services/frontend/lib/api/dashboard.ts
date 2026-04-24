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

export const getDashboardTrends = () =>
  req<{ data: DashboardTrendPoint[] }>('GET', '/api/v1/dashboard/trends').then((result) => result.data ?? []);

export const getDashboardVulnTrends = (days = 30) =>
  req<{ data: DashboardVulnTrendPoint[] }>('GET', `/api/v1/dashboard/vuln-trends?days=${days}`).then((result) => result.data ?? []);