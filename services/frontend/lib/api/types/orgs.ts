export interface PolicyRule {
  type: 'max_cvss' | 'max_count' | 'max_total' | 'require_fix' | 'blocked_cve';
  value?: number;
  severity?: string;
  cve_id?: string;
}

export interface OrgPolicy {
  id: string;
  org_id: string;
  name: string;
  rules: PolicyRule[];
  created_at: string;
  updated_at: string;
}

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface Org {
  id: string;
  name: string;
  description: string;
  image_patterns?: string[];
  created_by_id: string;
  created_at: string;
  updated_at: string;
  current_user_role?: OrgRole;
  policies?: OrgPolicy[];
}

export interface ResourceShare {
  org_id: string;
  org_name: string;
  org_description?: string;
  is_owner: boolean;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  joined_at: string;
  created_at: string;
  email?: string;
  username?: string;
}

export interface OrgInvite {
  id: string;
  org_id: string;
  org_name?: string;
  org_description?: string;
  email: string;
  role: Extract<OrgRole, 'admin' | 'editor' | 'viewer'>;
  token: string;
  invited_by_user_id: string;
  invited_by_email?: string;
  invited_by_username?: string;
  accepted_by_user_id?: string | null;
  accepted_at?: string | null;
  revoked_at?: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface TrendPoint {
  date: string;
  pass: number;
  fail: number;
  rate: number;
}

export interface Violation {
  rule: PolicyRule;
  message: string;
  vuln_id?: string;
}

export interface ComplianceResult {
  id: string;
  scan_id: string;
  policy_id: string;
  org_id: string;
  status: 'pass' | 'fail';
  violations: Violation[];
  evaluated_at: string;
  policy_name?: string;
  org_name?: string;
}

export interface APIToken {
  id: string;
  key: string;
  description: string;
  type: string;
  disabled: boolean;
  disabled_reason: string;
  created_at: string;
  expires_at: string;
  user_id: string;
  org_id?: string;
}

export interface PersonalToken {
  id: string;
  description: string;
  type: string;
  disabled: boolean;
  disabled_reason: string;
  created_at: string;
  expires_at: string;
}

export interface AuditEntry {
  id: string;
  org_id: string;
  user_id: string;
  username: string;
  email: string;
  action: string;
  details: string;
  created_at: string;
}

export interface OrgRiskScore {
  score: number;
  grade: string;
  unique_images: number;
  total_scans: number;
  totals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    unknown: number;
  };
  compliance_pass_rate: number;
  compliance_pass: number;
  compliance_fail: number;
}