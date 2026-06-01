import type { OwnerType } from './common';
import type { Collection } from './collections';
import type { Scan } from './scans';

export interface WatchlistComplianceSummary {
  status: 'pass' | 'fail';
  pass_count: number;
  fail_count: number;
  policy_names: string[];
  failed_policy_names: string[];
  org_names: string[];
  evaluated_at?: string | null;
}

export interface WatchlistItem {
  id: string;
  image_name: string;
  image_tag: string;
  registry_id?: string | null;
  collection_ids?: string[];
  schedule: string;
  timezone: string;
  enabled: boolean;
  last_scan_id?: string;
  last_scanned_at?: string;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
  last_scan?: Scan | null;
  compliance_summary?: WatchlistComplianceSummary | null;
  collections?: Collection[] | null;
}
