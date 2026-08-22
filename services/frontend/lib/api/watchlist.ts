import { req, type ApiRequestOptions } from './core';
import { appendScope } from './scope';
import type { ResourceShare } from './types/orgs';
import type { WatchlistItem } from './types/watchlist';

export const listWatchlist = (options?: ApiRequestOptions) => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ data: WatchlistItem[] }>(
    'GET',
    `/api/v1/watchlist/${qs ? `?${qs}` : ''}`,
    undefined,
    options
  ).then((result) => result.data ?? []);
};

export const createWatchlistItem = (data: Partial<WatchlistItem> & { org_id?: string }) =>
  req<WatchlistItem>('POST', '/api/v1/watchlist/', data);

export const updateWatchlistItem = (id: string, data: Partial<WatchlistItem>) =>
  req<WatchlistItem>('PUT', `/api/v1/watchlist/${id}`, data);

export const deleteWatchlistItem = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/watchlist/${id}`);

export const triggerWatchlistScan = (id: string) =>
  req<{ result: string }>('POST', `/api/v1/watchlist/${id}/scan`);

export const listWatchlistShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/watchlist/${id}/shares`).then(
    (result) => result.data ?? []
  );

export const shareWatchlistItem = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/watchlist/${id}/shares`, { org_id: orgId });

export const unshareWatchlistItem = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/watchlist/${id}/shares/${orgId}`);

export const transferWatchlistItemOwnership = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/watchlist/${id}/transfer-ownership`, { org_id: orgId });
