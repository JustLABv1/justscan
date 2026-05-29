import type { Scan } from './scans';
import type { WatchlistItem } from './watchlist';

export type TriageItemKind = 'scan' | 'policy' | 'fix' | 'watchlist';
export type TriagePriority = 'critical' | 'high' | 'medium';

export interface TriageSeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
}

export interface TriageItem {
  id: string;
  kind: TriageItemKind;
  priority: TriagePriority;
  title: string;
  description: string;
  href: string;
  primary_action: string;
  signals: string[];
  severity_counts: TriageSeverityCounts;
  fix_count: number;
  policy_names?: string[];
  scan?: Scan;
  watchlist_item?: WatchlistItem;
  updated_at: string;
}

export interface TriageSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  fixable: number;
  policy_failures: number;
  watchlist: number;
}

export interface TriageResponse {
  items: TriageItem[];
  summary: TriageSummary;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}
