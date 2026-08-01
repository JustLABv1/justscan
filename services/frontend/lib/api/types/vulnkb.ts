export interface VulnKBEntry {
  vuln_id: string;
  description: string;
  severity: string;
  cvss_vector: string;
  cvss_score: number;
  published_date: string | null;
  modified_date: string | null;
  references: { url: string; source: string }[];
  exploit_available: boolean;
  fetched_at: string;
  history_event_count?: number;
  last_change_at?: string | null;
  last_change?: {
    event_name: string;
    source: string;
    source_identifier: string;
    observed_at: string;
  } | null;
}

export interface PublicVulnerabilityIntelligenceHistory {
  data: import('./vulnerability-intelligence').VulnerabilityIntelligenceChangeEvent[];
  total: number;
  has_more: boolean;
  next_before_at?: string | null;
  next_before_id?: string | null;
}

export interface VulnerabilityExposurePosture {
  state: string;
  cve_state: string;
  severity: string;
  cvss_score: number;
  reason: string;
  observed_at?: string | null;
  change_event_id?: string | null;
  updated_at?: string | null;
}

export interface VulnerabilityExposureRow {
  finding_id: string;
  scan_id: string;
  image_name: string;
  image_tag: string;
  completed_at?: string | null;
  package_name: string;
  installed_version: string;
  fixed_version: string;
  scan_severity: string;
  scan_cvss_score: number;
  posture?: VulnerabilityExposurePosture | null;
}

export interface VulnerabilityExposureSummary {
  findings: number;
  scans: number;
  changed: number;
  needs_rescan: number;
  fix_available: number;
}

export interface VulnerabilityExposureResponse {
  data: VulnerabilityExposureRow[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
  summary: VulnerabilityExposureSummary;
}
