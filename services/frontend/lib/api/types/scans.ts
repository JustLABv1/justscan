import type { OwnerType } from './common';
import type { ResourceShare } from './orgs';
import type { ScanProvider, XrayMode } from './registries';

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

export interface XRayRequestLog {
  id: string;
  scan_id?: string | null;
  registry_id?: string | null;
  method: string;
  endpoint: string;
  request_url?: string;
  status_code: number;
  duration_ms: number;
  error?: string | null;
  request_headers?: Record<string, unknown>;
  request_body?: string;
  response_headers?: Record<string, unknown>;
  response_body?: string;
  created_at: string;
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

export interface ScanComplianceSummary {
  status: 'pass' | 'fail';
  pass_count: number;
  fail_count: number;
  policy_names: string[];
  failed_policy_names: string[];
  failed_policies?: Array<{
    name: string;
    rule_summaries?: string[];
  }>;
  evaluated_at?: string | null;
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
  applies_image_count?: number;
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

export interface SuppressionAppliedImage {
  image_name: string;
  image_tag: string;
  image_digest: string;
  latest_scan_id: string;
  latest_seen_at: string;
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
  xray_mode?: XrayMode;
  xray_provider_scanned_at?: string | null;
  scan_source?: 'registry' | 'uploaded_archive';
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
  compliance_summary?: ScanComplianceSummary | null;
  pipeline_initiator?: PipelineInitiator | null;
  step_logs?: ScanStepLog[];
}

export interface PipelineInitiator {
  source: string;
  token_id?: string | null;
  token_description?: string;
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
  xray_issue_id?: string;
  xray_violation_id?: string;
  xray_watch_name?: string;
  xray_watch_names?: string[];
  xray_watch_policy_matches?: Array<Record<string, unknown>>;
  xray_matched_policies?: Array<Record<string, unknown>>;
  xray_violation_paths?: string[];
  xray_component_physical_paths?: string[];
  xray_source?: string;
  xray_source_version?: string;
  xray_source_id?: string;
  xray_is_blocking?: boolean;
  xray_violation_raw?: Record<string, unknown>;
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

export interface VulnerabilitySummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  with_fix: number;
  xray_policy: number;
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
  has_unassigned_scans?: boolean;
  compliance_summary?: ScanComplianceSummary | null;
  pipeline_initiator?: PipelineInitiator | null;
}

export interface ImageOverview {
  image_name: string;
  scan_count: number;
  tag_count: number;
  latest_scan_id: string;
  latest_tag: string;
  latest_status: string;
  latest_external_status?: string;
  latest_scan_at: string;
  health_scan_id: string;
  health_tag: string;
  health_status: string;
  health_external_status?: string;
  health_critical_count: number;
  health_high_count: number;
  health_medium_count: number;
  health_low_count: number;
  health_policy_failed: boolean;
}

export interface ImageStats {
  total_scans: number;
  completed_scans: number;
  failed_scans: number;
  policy_available: boolean;
  policy_passed_scans: number;
  policy_failed_scans: number;
  policy_evaluated_scans: number;
  average_duration_ms: number;
}

/** The latest visible scan for one concrete image name and tag pair. */
export interface ArtifactSummary {
  image_name: string;
  image_tag: string;
  scan_count: number;
  latest_scan_id: string;
  latest_status: string;
  latest_external_status?: string;
  latest_current_step?: string;
  latest_scan_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  compliance_summary?: ScanComplianceSummary | null;
  tags?: Tag[];
}

export interface ArtifactFilterOptions {
  statuses: string[];
  has_critical: boolean;
  has_policy_fail: boolean;
}

export interface ScanQueueSummary {
  queued_in_justscan: number;
  active: number;
  worker_capacity: number;
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
  document_id?: string;
  bom_ref?: string;
  group?: string;
  scope?: string;
  ecosystem?: string;
  is_root?: boolean;
  dependency_depth?: number | null;
  licenses?: string[];
  hashes?: Array<Record<string, unknown>>;
  properties?: Array<Record<string, unknown>>;
  vulnerability_count?: number;
}

export interface SBOMDocument {
  id: string;
  scan_id: string;
  source: 'trivy' | 'xray' | 'trivy_fallback' | 'legacy';
  status: string;
  format: string;
  spec_version?: string;
  root_ref?: string;
  component_count: number;
  dependency_count: number;
  graph_complete: boolean;
  warnings?: string[];
  diagnostic?: string;
}

export interface SBOMDependency {
  id: string;
  document_id: string;
  from_component_id: string;
  to_component_id: string;
}

export interface SBOMGraph {
  document?: SBOMDocument;
  nodes: SBOMComponent[];
  edges: SBOMDependency[];
  truncated: boolean;
}

export interface SBOMComponentDetail {
  component: SBOMComponent;
  dependencies: SBOMComponent[];
  dependents: SBOMComponent[];
  vulnerabilities: Vulnerability[];
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
