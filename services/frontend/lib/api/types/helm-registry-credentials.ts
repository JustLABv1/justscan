import type { OwnerType } from './common';

export type HelmRegistryProtocol = 'oci' | 'http';
export type HelmRegistryAuthType = 'basic' | 'access_token' | 'bearer_token';

export interface HelmRegistryCredential {
  id: string;
  name: string;
  url: string;
  protocol: HelmRegistryProtocol;
  auth_type: HelmRegistryAuthType;
  username: string;
  credential_configured: boolean;
  owner_type: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  created_at: string;
  updated_at: string;
  health_status: 'healthy' | 'unhealthy' | 'unknown';
  health_message: string;
  last_health_check_at?: string | null;
}

export interface HelmRegistryCredentialInput {
  name: string;
  url: string;
  protocol: HelmRegistryProtocol;
  auth_type: HelmRegistryAuthType;
  username?: string;
  secret?: string;
  org_id?: string;
}
