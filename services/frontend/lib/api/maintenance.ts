import { publicReq } from './core';

export interface MaintenanceSettings {
  enabled: boolean;
  message: string;
}

export const getMaintenanceSettings = () =>
  publicReq<MaintenanceSettings>('GET', '/api/v1/public/maintenance');
