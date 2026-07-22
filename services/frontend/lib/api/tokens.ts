import { req } from './core';
import type { APIToken, OrgTokenScope, PersonalToken } from './types/orgs';

export const listOrgTokens = (orgId: string) =>
  req<{ data: APIToken[] }>('GET', `/api/v1/orgs/${orgId}/tokens`).then((result) => result.data ?? []);

export const createOrgToken = (
  orgId: string,
  description: string,
  expiresIn?: number,
  scope: OrgTokenScope = 'org_admin'
) =>
  req<APIToken & { key: string }>('POST', `/api/v1/orgs/${orgId}/tokens`, {
    description,
    expires_in: expiresIn,
    scope,
  });

export const revokeOrgToken = (orgId: string, tokenId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/tokens/${tokenId}`);

export const deleteRevokedOrgToken = (orgId: string, tokenId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/tokens/${tokenId}/purge`);

export const listUserTokens = () =>
  req<{ data: PersonalToken[]; total: number }>('GET', '/api/v1/user/tokens');

export const createUserToken = (description: string, expiresIn?: number) =>
  req<PersonalToken & { key: string }>('POST', '/api/v1/user/tokens', { description, expires_in: expiresIn });

export const revokeUserToken = (tokenId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/user/tokens/${tokenId}`);
