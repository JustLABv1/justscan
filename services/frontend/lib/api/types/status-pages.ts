import type { OwnerType } from './common';
import type { BlockedPolicyDetails } from './scans';

export interface StatusPageTarget {
  id?: string;
  page_id?: string;
  image_name: string;
  image_tag: string;
  display_order: number;
  created_at?: string;
}

export interface StatusPageUpdate {
  id?: string;
  page_id?: string;
  title: string;
  body: string;
  level: 'info' | 'maintenance' | 'incident';
  active_from?: string | null;
  active_until?: string | null;
  created_by_user_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StatusPage {
  id: string;
  name: string;
  slug: string;
  description: string;
  visibility: 'private' | 'public' | 'authenticated';
  include_all_tags: boolean;
  image_patterns?: string[];
  stale_after_hours: number;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  created_at: string;
  updated_at: string;
  targets?: StatusPageTarget[];
  updates?: StatusPageUpdate[];
}

export interface StatusPageItem {
  image_name: string;
  image_tag: string;
  latest_scan_id: string;
  scan_status: string;
  external_status?: string;
  scan_provider?: string;
  current_step?: string;
  started_at?: string;
  status: string;
  error_message?: string;
  blocked_policy_details?: BlockedPolicyDetails | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  previous_scan_id?: string;
  previous_critical_count?: number;
  previous_high_count?: number;
  previous_medium_count?: number;
  previous_low_count?: number;
  delta_critical_count?: number;
  delta_high_count?: number;
  delta_medium_count?: number;
  delta_low_count?: number;
  freshness_hours: number;
  observed_at: string;
  previous_scan_at?: string;
  display_order: number;
}

export interface StatusPageScanSummary {
  scan_id: string;
  image_name: string;
  image_tag: string;
  scan_status: string;
  external_status?: string;
  scan_provider?: string;
  current_step?: string;
  error_message?: string;
  blocked_policy_details?: BlockedPolicyDetails | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  observed_at: string;
  is_latest: boolean;
}

export interface StatusPageResponse {
  page: StatusPage;
  items: StatusPageItem[];
  now: string;
}

export interface StatusPagePayload {
  name: string;
  slug?: string;
  description?: string;
  visibility: 'private' | 'public' | 'authenticated';
  org_id?: string;
  include_all_tags: boolean;
  image_patterns?: string[];
  stale_after_hours: number;
  targets: StatusPageTarget[];
  updates?: StatusPageUpdate[];
}

export interface StatusPageTargetOption {
  id: string;
  image_name: string;
  image_tag: string;
  label: string;
  latest_scan_id: string;
  latest_status: string;
  observed_at: string;
  critical_count: number;
  high_count: number;
}