import { req } from './core';
import { appendScope } from './scope';
import type { ResourceShare } from './types/orgs';
import type { Tag } from './types/scans';

export const listTags = () => {
  const params = new URLSearchParams();
  appendScope(params);
  const qs = params.toString();
  return req<{ data: Tag[] }>('GET', `/api/v1/tags/${qs ? `?${qs}` : ''}`).then((result) => result.data ?? []);
};

export const createTag = (name: string, color: string, orgId?: string) =>
  req<Tag>('POST', '/api/v1/tags/', { name, color, org_id: orgId });

export const updateTag = (id: string, name: string, color: string) =>
  req<Tag>('PUT', `/api/v1/tags/${id}`, { name, color });

export const deleteTag = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/tags/${id}`);

export const listTagShares = (id: string) =>
  req<{ data: ResourceShare[] }>('GET', `/api/v1/tags/${id}/shares`).then((result) => result.data ?? []);

export const shareTag = (id: string, orgId: string) =>
  req<{ result: string }>('POST', `/api/v1/tags/${id}/shares`, { org_id: orgId });

export const unshareTag = (id: string, orgId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/tags/${id}/shares/${orgId}`);

export const addTagToScan = (scanId: string, tagId: string) =>
  req<{ result: string }>('POST', `/api/v1/scans/${scanId}/tags/${tagId}`);

export const removeTagFromScan = (scanId: string, tagId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/scans/${scanId}/tags/${tagId}`);