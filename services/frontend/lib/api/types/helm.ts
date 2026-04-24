import type { Scan } from './scans';

export interface HelmImage {
  full_ref: string;
  name: string;
  tag: string;
  source_file: string;
  source_path: string;
}

export interface HelmExtractResponse {
  chart_name: string;
  chart_version: string;
  images: HelmImage[];
}

export interface HelmScanRun {
  id: string;
  user_id?: string;
  chart_url: string;
  chart_name?: string;
  chart_version?: string;
  platform?: string;
  created_at: string;
}

export interface HelmScanRunSummary extends HelmScanRun {
  total_images: number;
  completed_images: number;
  failed_images: number;
  active_images: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  owner_email?: string;
  owner_username?: string;
}

export interface HelmRunItem {
  key: string;
  attempt_count: number;
  latest_scan: Scan;
}

export interface HelmScanRunDetail {
  run: HelmScanRun;
  items: HelmRunItem[];
}