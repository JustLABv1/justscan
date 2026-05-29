import { req } from './core';
import type {
  NotificationChannel,
  NotificationDelivery,
  NotificationQueueJob,
  NotificationRule,
} from './types/admin';

export const listScopedNotificationChannels = (basePath: string) =>
  req<{ data: NotificationChannel[] }>('GET', `${basePath}/channels`).then((result) => result.data ?? []);

export const createScopedNotificationChannel = (
  basePath: string,
  data: Partial<NotificationChannel>
) => req<NotificationChannel>('POST', `${basePath}/channels`, data);

export const updateScopedNotificationChannel = (
  basePath: string,
  id: string,
  data: Partial<NotificationChannel>
) => req<NotificationChannel>('PUT', `${basePath}/channels/${id}`, data);

export const deleteScopedNotificationChannel = (basePath: string, id: string) =>
  req<{ result: string }>('DELETE', `${basePath}/channels/${id}`);

export const testScopedNotificationChannel = (basePath: string, id: string, event?: string) =>
  req<{ result: string }>('POST', `${basePath}/channels/${id}/test`, event ? { event } : {});

export const listScopedNotificationRules = (basePath: string) =>
  req<{ data: NotificationRule[] }>('GET', `${basePath}/rules`).then((result) => result.data ?? []);

export const createScopedNotificationRule = (basePath: string, data: Partial<NotificationRule>) =>
  req<NotificationRule>('POST', `${basePath}/rules`, data);

export const updateScopedNotificationRule = (
  basePath: string,
  id: string,
  data: Partial<NotificationRule>
) => req<NotificationRule>('PUT', `${basePath}/rules/${id}`, data);

export const deleteScopedNotificationRule = (basePath: string, id: string) =>
  req<{ result: string }>('DELETE', `${basePath}/rules/${id}`);

export const listScopedNotificationDeliveries = (basePath: string, limit = 25) =>
  req<{ data: NotificationDelivery[] }>('GET', `${basePath}/deliveries?limit=${limit}`).then((result) => result.data ?? []);

export const listScopedNotificationQueue = (basePath: string, limit = 50) =>
  req<{ data: NotificationQueueJob[] }>('GET', `${basePath}/queue?limit=${limit}`).then((result) => result.data ?? []);

export const retryScopedNotificationQueueJob = (basePath: string, jobId: string) =>
  req<{ result: string }>('POST', `${basePath}/queue/${jobId}/retry`);
