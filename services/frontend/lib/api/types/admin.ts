import type { ScannerHealth } from './dashboard';

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

export interface NotificationConditionOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
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

export interface XRayUsageStats {
  total_requests: number;
  error_requests: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  top_endpoints: EndpointStat[];
  status_breakdown: StatusBucket[];
}

export type MCPRuntimeMode = 'enabled' | 'read_only' | 'disabled';

export interface MCPAdminSettings {
  mode: MCPRuntimeMode;
  actions_enabled: boolean;
  config_enabled: boolean;
  http_enabled: boolean;
  endpoint: string;
}

export interface MCPMetrics {
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  rejected_calls: number;
  error_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  active_users: number;
  action_calls: number;
  replayed_actions: number;
}

export interface MCPToolMetric {
  tool_name: string;
  calls: number;
  errors: number;
  actions: number;
  replayed_actions: number;
  avg_duration_ms: number;
}

export interface MCPTransportMetric {
  transport: string;
  calls: number;
  errors: number;
  actions: number;
}

export interface MCPInteraction {
  id: string;
  user_id?: string;
  username?: string;
  email?: string;
  transport: string;
  tool_name: string;
  status: 'success' | 'error' | 'rejected' | string;
  duration_ms: number;
  action: boolean;
  replayed: boolean;
  resource_id?: string;
  error_code?: string;
  created_at: string;
}

export interface MCPOverview {
  'window': string;
  from: string;
  to: string;
  settings: MCPAdminSettings;
  metrics: MCPMetrics;
  by_tool: MCPToolMetric[];
  by_transport: MCPTransportMetric[];
  recent_activity: MCPInteraction[];
}

export interface MCPActivityFilters {
  tool?: string;
  transport?: string;
  status?: string;
  user?: string;
}

export interface AdminDashboardQueues {
  running: number;
  pending: number;
  failed: number;
  blocked_policies: number;
  needs_attention: number;
}

export interface AdminDashboardCounts {
  users: number;
  tokens: number;
  active_channels: number;
  identity_providers: number;
  global_registries: number;
}

export interface AdminDashboardInsights {
  api_requests_24h: number;
  api_error_requests_24h: number;
  api_average_ms: number;
  api_p95_ms: number;
  xray_requests_24h: number;
  xray_error_requests_24h: number;
}

export interface AdminDashboardTrendPoint {
  date: string;
  total: number;
  completed: number;
  failed: number;
}

export interface AdminDashboardVulnerabilityTrendPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface AdminDashboard {
  generated_at: string;
  public_scan_enabled: boolean;
  total_scans: number;
  status_counts: Record<string, number>;
  severity_totals: Record<string, number>;
  queues: AdminDashboardQueues;
  admin_counts: AdminDashboardCounts;
  insights: AdminDashboardInsights;
  scanner_health: ScannerHealth;
  recent_audit: AuditLog[];
  scan_trends: AdminDashboardTrendPoint[];
  vulnerability_trends: AdminDashboardVulnerabilityTrendPoint[];
}

export interface XRayRequestLogFilters {
  scan_id?: string;
  registry_id?: string;
  endpoint?: string;
  status?: string;
  from?: string;
  to?: string;
}

export interface AdminXRayRequestLog {
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
  scope_type: 'system' | 'org' | 'user';
  scope_ref: string;
  config: NotificationConfig;
  enabled: boolean;
  events: string[];
  org_ids: string[];
  image_patterns: string[];
  min_severity: '' | 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  created_at: string;
  updated_at: string;
}

export interface NotificationConditionPredicate {
  field: string;
  operator: string;
  value: string | number | boolean | string[];
}

export interface NotificationConditionGroup {
  op: 'all' | 'any';
  conditions: NotificationConditionPredicate[];
}

export interface NotificationRule {
  id: string;
  name: string;
  scope_type: 'system' | 'org' | 'user';
  scope_ref: string;
  enabled: boolean;
  channel_ids: string[];
  event_types: string[];
  conditions: NotificationConditionGroup;
  delivery_mode: 'immediate' | 'digest';
  digest_window_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationDelivery {
  id: string;
  channel_id: string;
  rule_id?: string | null;
  event_id?: string | null;
  queue_job_id?: string | null;
  event: string;
  triggered_by: string;
  status: string;
  error: string;
  details: string;
  scope_type: 'system' | 'org' | 'user';
  scope_ref: string;
  created_at: string;
  channel_name?: string;
  rule_name?: string;
}

export interface NotificationDeliveryListResponse {
  data: NotificationDelivery[];
  has_more: boolean;
  next_offset: number;
}

export interface NotificationQueueJob {
  id: string;
  event_id?: string | null;
  rule_id: string;
  channel_id: string;
  digest_id?: string | null;
  scope_type: 'system' | 'org' | 'user';
  scope_ref: string;
  delivery_mode: 'immediate' | 'digest';
  status: 'pending' | 'leased' | 'delivered' | 'failed' | 'dead_letter';
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_owner: string;
  leased_until?: string | null;
  payload: Record<string, unknown>;
  last_error: string;
  last_attempt_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
  channel_name?: string;
  rule_name?: string;
}

export interface AdminOrg {
  id: string;
  name: string;
  description: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  allow_image_scans: boolean;
  allow_helm_scans: boolean;
  allow_rescans: boolean;
  allow_member_invites: boolean;
  allow_org_tokens: boolean;
  member_count: number;
  pending_invite_count: number;
  active_token_count: number;
}
