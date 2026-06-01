import { req } from './core';
import { appendScope } from './scope';
import type { Collection } from './types/collections';

export const listCollections = (query?: string) => {
  const params = new URLSearchParams();
  appendScope(params);
  if (query) params.set('q', query);
  const qs = params.toString();
  return req<{ data: Collection[] }>('GET', `/api/v1/collections/${qs ? `?${qs}` : ''}`).then(
    (result) => result.data ?? []
  );
};

export const createCollection = (name: string, orgId?: string) =>
  req<Collection>('POST', '/api/v1/collections/', { name, org_id: orgId });

export const updateCollection = (id: string, name: string) =>
  req<Collection>('PUT', `/api/v1/collections/${id}`, { name });

export const deleteCollection = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/collections/${id}`);
