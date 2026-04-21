export interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
  disabled: boolean;
  disabled_reason: string;
  auth_type: 'local' | 'oidc';
  last_login_at?: string | null;
  last_login_method: 'local' | 'oidc' | '';
  created_at: string;
  updated_at: string;
}

export interface AdminToken {
  id: string;
  key: string;
  description: string;
  type: string;
  disabled: boolean;
  disabled_reason: string;
  created_at: string;
  expires_at: string;
  user_id: string;
}

export interface AuditLogFilters {
  operation?: string;
  user?: string;
  q?: string;
  from?: string;
  to?: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  operation: string;
  details: string;
  created_at: string;
  username?: string;
  email?: string;
  role?: string;
}

export interface APIRequestLogFilters {
  method?: string;
  path?: string;
  user?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface APIRequestLog {
  id: string;
  user_id?: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  created_at: string;
  username?: string;
  email?: string;
}

export interface EndpointStat {
  method: string;
  path: string;
  count: number;
}

export interface UserStat {
  user_id?: string;
  username: string;
  count: number;
}

export interface StatusBucket {
  status_code: number;
  count: number;
}

export interface APIUsageStats {
  total_requests: number;
  error_requests: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  top_endpoints: EndpointStat[];
  top_users: UserStat[];
  status_breakdown: StatusBucket[];
}

export interface XRayRequestLogFilters {
  scan_id?: string;
  registry_id?: string;
  endpoint?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface XRayRequestLog {
  id: string;
  scan_id?: string;
  registry_id?: string;
  method: string;
  endpoint: string;
  status_code: number;
  duration_ms: number;
  error?: string;
  created_at: string;
}

export interface NotificationConfig {
  webhook_url?: string;
  headers?: Record<string, string>;
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_from?: string;
  to_addresses?: string[];
  smtp_tls?: boolean;
  telegram_bot_token?: string;
  telegram_chat_id?: string;
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'discord' | 'email' | 'webhook' | 'slack' | 'teams' | 'telegram';
  config: NotificationConfig;
  enabled: boolean;
  events: string[];
  org_ids: string[];
  image_patterns: string[];
  min_severity: '' | 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  created_at: string;
  updated_at: string;
}

export interface NotificationDelivery {
  id: string;
  channel_id: string;
  event: string;
  triggered_by: string;
  status: string;
  error: string;
  details: string;
  created_at: string;
  channel_name?: string;
}