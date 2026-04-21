export interface SearchImageResult {
  image_name: string;
  scan_count: number;
}

export interface SearchVulnResult {
  vuln_id: string;
  pkg_name: string;
  severity: string;
  scan_count: number;
}

export interface SearchScanResult {
  id: string;
  image_name: string;
  image_tag: string;
  status: string;
  critical_count: number;
  high_count: number;
}