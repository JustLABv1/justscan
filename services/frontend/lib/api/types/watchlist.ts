import type { OwnerType } from './common';

export interface WatchlistItem {
  id: string;
  image_name: string;
  image_tag: string;
  registry_id?: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  last_scan_id?: string;
  last_scanned_at?: string;
  created_at: string;
  owner_type?: OwnerType;
  owner_user_id?: string | null;
  owner_org_id?: string | null;
}