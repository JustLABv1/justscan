import type { Scan } from './scans';

export interface DashboardStats {
  total_scans: number;
  status_counts: Record<string, number>;
  severity_totals: Record<string, number>;
  attention_scans: Scan[] | null;
  recent_scans: Scan[] | null;
  top_images: { image_name: string; count: number }[] | null;
  watchlist_count: number;
  operations: DashboardOperations;
  activity: DashboardActivity;
  policy_failures: DashboardPolicyFailures;
  git_repositories: DashboardGitRepositorySummary;
}

export interface DashboardActivity {
  images_scanned_today: number;
}

export interface DashboardPolicyFailures {
  today: number;
  last_3_days: number;
  last_7_days: number;
}

export interface DashboardGitRepositorySummary {
  total: number;
  enabled: number;
  healthy: number;
  needs_attention: number;
  in_progress: number;
}

export interface DashboardOperations {
  blocked_policy_count: number;
  xray_blocked_count: number;
  org_policy_fail_count: number;
  active_xray_count: number;
  active_xray_step_counts: Record<string, number>;
  active_xray_scans: Scan[] | null;
}

export interface ScannerHealthWorker {
  worker_id: number;
  cache_dir: string;
  status: 'healthy' | 'stale' | 'error';
  error?: string;
  trivy_version: string;
  vuln_db_updated_at?: string | null;
  vuln_db_downloaded_at?: string | null;
  vuln_db_age_hours?: number | null;
  java_db_updated_at?: string | null;
  java_db_downloaded_at?: string | null;
  java_db_age_hours?: number | null;
}

export interface ScannerHealth {
  local_scanner_enabled: boolean;
  grype_enabled: boolean;
  message?: string;
  generated_at: string;
  cache_root: string;
  max_allowed_age_hours: number;
  total_workers: number;
  healthy_workers: number;
  stale_workers: number;
  error_workers: number;
  oldest_vuln_db_age_hours?: number | null;
  oldest_java_db_age_hours?: number | null;
  workers: ScannerHealthWorker[];
}

export interface DashboardTrendPoint {
  date: string;
  total: number;
  completed: number;
  failed: number;
}

export interface DashboardVulnTrendPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}
