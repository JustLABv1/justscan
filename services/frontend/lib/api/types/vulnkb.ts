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
}