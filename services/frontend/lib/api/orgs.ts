import { req } from './core';
import { notifyOrgMembershipChanged } from './scope';
import type { AuditEntry, ComplianceResult, Org, OrgInvite, OrgMember, OrgPolicy, OrgRiskScore, OrgRole, PipelineScanHistoryItem, PolicyRule, TrendPoint, VulnerabilityViewSettings } from './types/orgs';
import type { Scan } from './types/scans';

export const listOrgs = () =>
  req<{ data: Org[] }>('GET', '/api/v1/orgs/').then((result) => result.data ?? []);

export const createOrg = (name: string, description: string) =>
  req<Org>('POST', '/api/v1/orgs/', { name, description }).then((org) => {
    notifyOrgMembershipChanged();
    return org;
  });

export const getOrg = (id: string) =>
  req<Org>('GET', `/api/v1/orgs/${id}`);

export const updateOrg = (id: string, data: Partial<Org>) =>
  req<Org>('PUT', `/api/v1/orgs/${id}`, data);

export const updateOrgVulnerabilityViewSettings = (id: string, settings: VulnerabilityViewSettings) =>
  req<{ settings: VulnerabilityViewSettings }>('PUT', `/api/v1/orgs/${id}/vulnerability-view`, settings);

export const deleteOrg = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${id}`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });

export const listOrgMembers = (orgId: string) =>
  req<{ data: OrgMember[] }>('GET', `/api/v1/orgs/${orgId}/members`).then((result) => result.data ?? []);

export const updateOrgMemberRole = (orgId: string, userId: string, role: OrgRole) =>
  req<{ result: string }>('PATCH', `/api/v1/orgs/${orgId}/members/${userId}`, { role });

export const removeOrgMember = (orgId: string, userId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/members/${userId}`);

export const listOrgInvites = (orgId: string) =>
  req<{ data: OrgInvite[] }>('GET', `/api/v1/orgs/${orgId}/invites`).then((result) => result.data ?? []);

export const listMyOrgInvites = () =>
  req<{ data: OrgInvite[] }>('GET', '/api/v1/orgs/invites').then((result) => result.data ?? []);

export const createOrgInvite = (orgId: string, email: string, role: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>) =>
  req<OrgInvite>('POST', `/api/v1/orgs/${orgId}/invites`, { email, role });

export const revokeOrgInvite = (orgId: string, inviteId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/invites/${inviteId}`);

export const declineOrgInvite = (inviteId: string) =>
  req<{ result: string }>('POST', `/api/v1/orgs/invites/${inviteId}/decline`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });

export const acceptOrgInvite = (inviteId: string) =>
  req<{ result: string; org_id: string; org_name?: string; role: OrgRole }>('POST', `/api/v1/orgs/invites/${inviteId}/accept`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });

export const acceptOrgInviteByToken = (token: string) =>
  req<{ result: string; org_id: string; org_name?: string; role: OrgRole }>('POST', `/api/v1/orgs/invites/by-token/${token}/accept`).then((result) => {
    notifyOrgMembershipChanged();
    return result;
  });

export const transferOrgOwnership = (orgId: string, newOwnerUserId: string) =>
  req<{ result: string }>('POST', `/api/v1/orgs/${orgId}/transfer-ownership`, { new_owner_user_id: newOwnerUserId });

export const listOrgAuditLog = (orgId: string, page = 1, limit = 50) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return req<{ data: AuditEntry[]; total: number }>('GET', `/api/v1/orgs/${orgId}/audit?${params}`);
};

export const createPolicy = (
  orgId: string,
  name: string,
  rules: PolicyRule[],
  includeSuppressed = true
) =>
  req<OrgPolicy>('POST', `/api/v1/orgs/${orgId}/policies`, {
    name,
    rules,
    include_suppressed: includeSuppressed,
  });

export const updatePolicy = (
  orgId: string,
  policyId: string,
  name: string,
  rules: PolicyRule[],
  includeSuppressed: boolean
) =>
  req<OrgPolicy>('PUT', `/api/v1/orgs/${orgId}/policies/${policyId}`, {
    name,
    rules,
    include_suppressed: includeSuppressed,
  });

export const deletePolicy = (orgId: string, policyId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/policies/${policyId}`);

export const assignScanToOrg = (orgId: string, scanId: string) =>
  req<{ result: string }>('POST', `/api/v1/orgs/${orgId}/scans/${scanId}`);

export const removeScanFromOrg = (orgId: string, scanId: string) =>
  req<{ result: string }>('DELETE', `/api/v1/orgs/${orgId}/scans/${scanId}`);

export const listOrgScans = (orgId: string) =>
  req<{ data: Scan[] }>('GET', `/api/v1/orgs/${orgId}/scans`).then((result) => result.data ?? []);

export const getScanCompliance = (scanId: string) =>
  req<{ data: ComplianceResult[] }>('GET', `/api/v1/scans/${scanId}/compliance`).then((result) => result.data ?? []);

export const reEvaluateCompliance = (scanId: string) =>
  req<{ data: ComplianceResult[] }>('POST', `/api/v1/scans/${scanId}/compliance/evaluate`).then((result) => result.data ?? []);

export const getComplianceTrend = (orgId: string, days = 30) =>
  req<{ data: TrendPoint[] }>('GET', `/api/v1/orgs/${orgId}/compliance/trend?days=${days}`).then((result) => result.data ?? []);

export const listPipelineScans = (orgId: string, page = 1, limit = 20) =>
  req<{ data: PipelineScanHistoryItem[]; total: number; page: number; limit: number }>(
    'GET',
    `/api/v1/orgs/${orgId}/pipeline-scans?page=${page}&limit=${limit}`
  );

export const getOrgRiskScore = (orgId: string) =>
  req<OrgRiskScore>('GET', `/api/v1/orgs/${orgId}/risk`);
