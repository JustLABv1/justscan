export type OwnerType = 'user' | 'org' | 'system';

export type WorkScope =
  | { kind: 'personal' }
  | { kind: 'org'; orgId: string; orgName?: string };

export interface AuthSnapshot {
  token_present: boolean;
  role: 'admin' | 'user' | null;
  expires_at: string | null;
  expires_in_seconds: number | null;
}

export interface User {
  id: string;
  email: string;
  username: string;
  role: string;
  disabled: boolean;
  disabled_reason?: string;
  auth_type: 'local' | 'oidc';
  last_login_at?: string | null;
  last_login_method: 'local' | 'oidc' | '';
}