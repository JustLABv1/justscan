import type { OrgRole } from './api/types/orgs';

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function hasOrgRoleAtLeast(role: OrgRole | null | undefined, minimum: OrgRole): boolean {
  if (!role) return false;
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum];
}

export function canViewOrg(role: OrgRole | null | undefined): boolean {
  return Boolean(role);
}

export function canMutateOrg(role: OrgRole | null | undefined): boolean {
  return hasOrgRoleAtLeast(role, 'editor');
}

export function canManageOrg(role: OrgRole | null | undefined): boolean {
  return hasOrgRoleAtLeast(role, 'admin');
}

export function canOwnOrg(role: OrgRole | null | undefined): boolean {
  return role === 'owner';
}
