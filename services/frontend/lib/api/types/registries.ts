import type { OwnerType } from './common';
import type { Tag } from './scans';

export type ScanProvider = 'trivy' | 'artifactory_xray';

export interface Registry {
  id: string;
  name: string;
  url: string;
  xray_url?: string;
  xray_artifactory_id?: string;
  auth_type: 'none' | 'basic' | 'token' | 'aws_ecr';
  scan_provider: ScanProvider;
  username: string;
  password?: string;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  is_default?: boolean;
}

export interface OIDCProvider {
  name: string;
  display_name: string;
  button_color?: string;
}

export interface OIDCProviderAdmin extends OIDCProvider {
  issuer_url: string;
  client_id: string;
  client_secret?: string;
  redirect_uri: string;
  scopes: string[];
  admin_groups: string[];
  admin_roles: string[];
  included_groups: string[];
  excluded_groups: string[];
  included_org_names: string[];
  excluded_org_names: string[];
  groups_claim: string;
  roles_claim: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface OIDCGroupMapping {
  id: string;
  provider_name: string;
  effect: 'allow' | 'exclude';
  claim_type: 'group' | 'role';
  match_type: 'exact' | 'prefix';
  match_value: string;
  org_id?: string | null;
  org_name?: string;
  role: string;
  provisioning_mode: 'existing_org' | 'create_org';
  org_name_template: string;
  recreate_missing_org: boolean;
  remove_on_unsync: boolean;
  created_at: string;
}

export interface OIDCOrgRoleOverride {
  id: string;
  provider_name: string;
  claim_type: 'group' | 'role';
  match_type: 'exact' | 'prefix';
  match_value: string;
  target_type: 'org_id' | 'rendered_name';
  org_id?: string | null;
  org_name?: string;
  org_name_template: string;
  role: 'viewer' | 'editor' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface OIDCClaimSyncRoute {
  mapping_id: string;
  effect: string;
  claim_type: 'group' | 'role';
  match_type: 'exact' | 'prefix';
  match_value: string;
  claim: string;
  suffix?: string;
  provisioning_mode: 'existing_org' | 'create_org';
  org_id?: string | null;
  org_name?: string;
  base_role?: string;
  final_role?: string;
  requires_create: boolean;
  status: 'matched' | 'selected' | 'shadowed' | 'blocked_derived_org' | 'skipped' | 'error';
  reason?: string;
  override_applied: boolean;
  remove_on_unsync: boolean;
  recreate_missing_org: boolean;
}

export interface OIDCClaimSyncMembership {
  mapping_id: string;
  org_id?: string | null;
  org_name: string;
  claim: string;
  suffix?: string;
  base_role: string;
  final_role: string;
  requires_create: boolean;
  provisioning_mode: 'existing_org' | 'create_org';
  remove_on_unsync: boolean;
  override_applied: boolean;
}

export interface OIDCClaimSyncPreview {
  provider_name: string;
  input_groups: string[];
  input_roles: string[];
  provider_filtered_groups: string[];
  provider_filtered_out_groups: string[];
  effective_groups: string[];
  effective_roles: string[];
  blocked_groups: string[];
  blocked_roles: string[];
  matched_routes: OIDCClaimSyncRoute[];
  final_memberships: OIDCClaimSyncMembership[];
}

export interface ScannerSettings {
  enable_trivy?: boolean;
  enable_grype?: boolean;
  concurrency?: number;
  timeout_seconds?: number;
  db_max_age_hours?: number;
  enable_osv_java_augmentation?: boolean;
}

export interface ProviderCapability {
  id: ScanProvider;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface ScannerCapabilities {
  enable_trivy: boolean;
  enable_grype: boolean;
  local_scan_message?: string;
  providers: ProviderCapability[];
}

export interface RegistryWithHealth extends Registry {
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  health_message: string;
  last_health_check_at: string | null;
}

export interface RegistryListResponse {
  data: RegistryWithHealth[];
  capabilities?: ScannerCapabilities;
}

export interface PublicSettings {
  enabled: boolean;
  rate_limit_per_hour: number;
  local_scan_available?: boolean;
  disabled_reason?: string;
}

export interface AutoTagRule {
  id: string;
  pattern: string;
  tag_id: string;
  created_by_id: string;
  created_at: string;
  tag?: Tag;
}