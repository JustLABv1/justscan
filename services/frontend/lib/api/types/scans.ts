import type { OwnerType } from './common';
import type { ResourceShare } from './orgs';
import type { ScanProvider } from './registries';

export interface ScanStepLog {
  id: string;
  scan_id: string;
  step: string;
  position: number;
  started_at: string;
  completed_at?: string | null;
  output: string[];
  output_count?: number;
}

export type BlockedPolicyIgnoreRuleStatus = 'active_ignore' | 'no_ignore' | 'status_unavailable';

export interface BlockedPolicyMatchedWatch {
  name: string;
  ignore_rule_status: BlockedPolicyIgnoreRuleStatus;
}

export interface BlockedPolicyDetails {
  summary: string;
  manifest?: string;
  artifact?: string;
  jfrog?: string;
  matched_issues?: string[];
  matched_watches?: BlockedPolicyMatchedWatch[];
  blocking_policies?: string[];
  matched_policies?: string[];
  total_violations?: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
}

export interface Suppression {
  id: string;
  vuln_id: string;
  image_digest: string;
  status: 'accepted' | 'wont_fix' | 'false_positive' | 'xray_ignore';
  justification: string;
  user_id: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  username?: string;
  source?: 'local' | 'xray' | 'mixed';
  sources?: Array<'local' | 'xray'>;
  read_only?: boolean;
  xray_rule_id?: string;
  xray_policy_name?: string;
  xray_watch_name?: string;
}

export interface Comment {
  id: string;
  vulnerability_id: string;
  scan_id: string;
  user_id: string;
  content: string;
  username?: string;
  created_at: string;
  updated_at: string;
}

export interface Scan {
  id: string;
  image_name: string;
  image_tag: string;
  image_digest: string;
  scan_provider: ScanProvider;
  external_scan_id?: string;
  external_status?: string;
  current_step: string;
  status: string;
  error_message: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  suppressed_count: number;
  trivy_version: string;
  grype_version: string;
  trivy_vuln_db_updated_at?: string | null;
  trivy_vuln_db_downloaded_at?: string | null;
  trivy_java_db_updated_at?: string | null;
  trivy_java_db_downloaded_at?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  registry_id?: string;
  tags?: Tag[];
  architecture?: string;
  os_family?: string;
  os_name?: string;
  image_config?: Record<string, unknown>;
  platform?: string;
  share_token?: string;
  share_visibility?: string;
  helm_scan_run_id?: string;
  helm_chart?: string;
  helm_chart_name?: string;
  helm_chart_version?: string;
  helm_source_path?: string;
  blocked_policy_details?: BlockedPolicyDetails | null;
  step_logs?: ScanStepLog[];
}

export interface AdminScan extends Omit<Scan, 'tags'> {
  owner_email: string;
  owner_username: string;
  share_token?: string;
  share_visibility?: string;
  helm_chart?: string;
  helm_chart_name?: string;
  helm_chart_version?: string;
  helm_source_path?: string;
}

export interface Vulnerability {
  id: string;
  scan_id: string;
  vuln_id: string;
  pkg_name: string;
  installed_version: string;
  fixed_version: string;
  severity: string;
  title: string;
  description: string;
  cvss_score: number;
  data_source?: string;
  external_component_id?: string;
  references: string[];
  suppression?: Suppression | null;
  comments?: Comment[];
  first_seen_at?: string | null;
}

export interface VulnerabilityContextAnalysis {
  provider: string;
  supported: boolean;
  available: boolean;
  message?: string;
  vulnerability_id: string;
  component_id?: string;
  source_component_id?: string;
  artifact_path?: string;
  applicable?: boolean | null;
  summary?: string;
  evidence?: string[];
  dependency_paths?: string[];
  raw?: Record<string, unknown>;
}

export interface ScanTrendPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  scan_count: number;
}

export interface ImageSummary {
  image_name: string;
  scan_count: number;
  latest_scan_id: string;
  latest_tag: string;
  latest_status: string;
  latest_external_status?: string;
  latest_scan_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

export interface SBOMComponent {
  id: string;
  scan_id: string;
  name: string;
  version: string;
  type: string;
  package_url: string;
  license: string;
  supplier: string;
  created_at: string;
}

export interface ScanComparison {
  scan_a: Scan;
  scan_b: Scan;
  added: Vulnerability[];
  removed: Vulnerability[];
  unchanged: Vulnerability[];
  summary: {
    added_count: number;
    removed_count: number;
    unchanged_count: number;
    added_critical: number;
    added_high: number;
  };
}

export interface ScanShareResponse {
  share_token: string;
  share_visibility: string;
}

export interface SharedScanRescanResponse {
  scan_id: string;
  type: 'public' | 'authenticated';
}

export interface BulkDeleteScansResponse {
  deleted: number;
}

export interface ScanOrgGrantListResponse {
  data: ResourceShare[];
}