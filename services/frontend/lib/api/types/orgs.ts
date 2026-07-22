export interface PolicyRule {
  type:
    | 'max_cvss'
    | 'max_count'
    | 'max_total'
    | 'require_fix'
    | 'blocked_cve'
    | 'xray_policy_block';
  value?: number;
  severity?: string;
  cve_id?: string;
}

export interface OrgPolicy {
  id: string;
  org_id: string;
  name: string;
  rules: PolicyRule[];
  include_suppressed: boolean;
  created_at: string;
  updated_at: string;
}

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type VulnerabilityViewSortBy =
  | 'vuln_id'
  | 'pkg_name'
  | 'severity'
  | 'cvss_score'
  | 'installed_version'
  | 'fixed_version';
export type VulnerabilityViewSortDir = 'asc' | 'desc';
export type VulnerabilityViewSeverity = '' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface VulnerabilityViewSettings {
  sort_by: VulnerabilityViewSortBy;
  sort_dir: VulnerabilityViewSortDir;
  severity: VulnerabilityViewSeverity;
  min_cvss: number;
  has_fix: boolean;
  xray_policy_first: boolean;
  policy_failed_only: boolean;
}

export interface VulnerabilityViewPreferenceResponse {
  settings: VulnerabilityViewSettings;
  source: 'system' | 'org' | 'user';
  scope_type: 'personal' | 'org';
  scope_ref: string;
  has_user_override: boolean;
  org_settings?: VulnerabilityViewSettings;
}

export interface Org {
  id: string;
  name: string;
  description: string;
  member_count?: number;
  policy_count?: number;
  scan_count?: number;
  unique_image_count?: number;
  last_scan_at?: string | null;
  is_active: boolean;
  allow_image_scans: boolean;
  allow_helm_scans: boolean;
  allow_rescans: boolean;
  allow_member_invites: boolean;
  allow_org_tokens: boolean;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  current_user_role?: OrgRole;
  vulnerability_view_settings?: VulnerabilityViewSettings;
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
  policy_rules?: PolicyRule[];
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
  scope: OrgTokenScope;
}

export type OrgTokenScope = 'org_admin' | 'pipeline_scan';

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

export interface PipelineScanHistoryItem {
  id: string;
  scan_id: string;
  source: string;
  external_ref?: string;
  delivery_status: string;
  delivery_attempt_count: number;
  last_delivery_error?: string;
  last_attempt_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  initiator?: {
    source: string;
    token_id?: string | null;
    token_description?: string;
  };
  scan: {
    id: string;
    image_name: string;
    image_tag: string;
    status: string;
    current_step: string;
    critical_count: number;
    high_count: number;
    completed_at?: string | null;
  };
}
