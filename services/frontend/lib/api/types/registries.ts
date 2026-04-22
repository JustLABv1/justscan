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