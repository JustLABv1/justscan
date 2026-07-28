import type { OwnerType } from './common';

export type GitRepositoryRescanPolicy = 'changed' | 'all';
export type GitRepositoryDiscoveryMode = 'auto' | 'kustomize' | 'manifests';
export type GitRepositoryRunStatus =
  | 'queued'
  | 'discovering'
  | 'scanning'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface GitRepository {
  id: string;
  name: string;
  clone_url: string;
  ref: string;
  auth_type: 'none' | 'token' | 'basic';
  username: string;
  credential_configured: boolean;
  schedule: string;
  timezone: string;
  enabled: boolean;
  rescan_policy: GitRepositoryRescanPolicy;
  discovery_mode: GitRepositoryDiscoveryMode;
  entrypoints: string[];
  tag_ids: string[];
  owner_type: OwnerType;
  owner_org_id?: string | null;
  last_run_id?: string | null;
  last_run_at?: string | null;
  created_at: string;
}

export interface GitRepositoryRun {
  id: string;
  repository_id: string;
  trigger: string;
  requested_policy: GitRepositoryRescanPolicy;
  ref: string;
  commit_sha: string;
  status: GitRepositoryRunStatus;
  error_message?: string;
  target_count: number;
  image_count: number;
  scan_count: number;
  unresolved_count: number;
  requested_images: string[];
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface GitRepositoryImageExclusion {
  id: string;
  repository_id: string;
  full_ref: string;
  created_at: string;
}

export type GitRepositoryCandidateStatus = 'unresolved' | 'auto_accepted' | 'resolved' | 'ignored';

export interface GitRepositoryRunCandidate {
  id: string;
  run_id: string;
  path: string;
  detected_type: 'helm_values' | 'helm_chart' | string;
  confidence: string;
  evidence: Record<string, unknown>;
  status: GitRepositoryCandidateStatus;
  rule_id?: string | null;
  created_at: string;
}

export interface GitRepositoryDiscoveryRule {
  id: string;
  repository_id: string;
  path_pattern: string;
  resolution: 'kustomize' | 'helm' | 'manifests' | 'ignore';
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export interface GitDiscoveredImage {
  full_ref: string;
  image_name: string;
  image_tag: string;
  locations: Array<{ file: string; target?: string; document: number; kind?: string; name?: string; namespace?: string; path: string }>;
}

export interface GitRepositoryRunImage {
  id: string;
  run_id: string;
  full_ref: string;
  image_name: string;
  image_tag: string;
  locations: { items?: GitDiscoveredImage['locations'] };
  state: string;
  scan_id?: string | null;
}

export interface GitRepositoryLatestImageScan {
  full_ref: string;
  scan_id: string;
  status: string;
  created_at: string;
}
