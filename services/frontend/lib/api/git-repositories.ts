import { req } from './core';
import { appendScope } from './scope';
import type { GitDiscoveredImage, GitRepository, GitRepositoryDiscoveryRule, GitRepositoryImageExclusion, GitRepositoryLatestImageScan, GitRepositoryRun, GitRepositoryRunCandidate, GitRepositoryRunImage } from './types/git-repositories';

export type GitRepositoryInput = Partial<GitRepository> & { credential?: string; org_id?: string };

export const listGitRepositories = (scope?: string) => {
  const params = new URLSearchParams();
  if (scope) params.set('scope', scope);
  else appendScope(params);
  const query = params.toString();
  return req<{ data: GitRepository[] }>('GET', `/api/v1/git-repositories/${query ? `?${query}` : ''}`).then((result) => result.data ?? []);
};
export const createGitRepository = (data: GitRepositoryInput) => req<GitRepository>('POST', '/api/v1/git-repositories/', data);
export const getGitRepository = (id: string) => req<GitRepository>('GET', `/api/v1/git-repositories/${id}`);
export const updateGitRepository = (id: string, data: GitRepositoryInput) => req<GitRepository>('PUT', `/api/v1/git-repositories/${id}`, data);
export const deleteGitRepository = (id: string) => req<{ result: string }>('DELETE', `/api/v1/git-repositories/${id}`);
export const validateGitRepository = (data: GitRepositoryInput) => req<{ commit_sha: string; images: GitDiscoveredImage[] }>('POST', '/api/v1/git-repositories/validate', data);
export const listGitRepositoryRuns = (id: string) => req<{ data: GitRepositoryRun[] }>('GET', `/api/v1/git-repositories/${id}/runs`).then((result) => result.data ?? []);
export const listGitRepositoryLatestImageScans = (id: string) => req<{ data: GitRepositoryLatestImageScan[] }>('GET', `/api/v1/git-repositories/${id}/latest-image-scans`).then((result) => result.data ?? []);
export const runGitRepository = (id: string, options: { policy?: 'changed' | 'all'; selected_images?: string[] } = {}) => req<GitRepositoryRun>('POST', `/api/v1/git-repositories/${id}/runs`, options);
export const cancelGitRepositoryRun = (id: string, runId: string) =>
  req<GitRepositoryRun>('POST', `/api/v1/git-repositories/${id}/runs/${runId}/cancel`, {});
export const listGitRepositoryImageExclusions = (id: string) => req<{ data: GitRepositoryImageExclusion[] }>('GET', `/api/v1/git-repositories/${id}/image-exclusions`).then((result) => result.data ?? []);
export const createGitRepositoryImageExclusion = (id: string, full_ref: string) => req<GitRepositoryImageExclusion>('POST', `/api/v1/git-repositories/${id}/image-exclusions`, { full_ref });
export const deleteGitRepositoryImageExclusion = (id: string, exclusionId: string) => req<{ result: string }>('DELETE', `/api/v1/git-repositories/${id}/image-exclusions/${exclusionId}`);
export const discoverGitRepository = (id: string) => req<{ run: GitRepositoryRun; images: GitDiscoveredImage[] }>('POST', `/api/v1/git-repositories/${id}/discover`, {});
export const getGitRepositoryRun = (id: string, runId: string) => req<{ run: GitRepositoryRun; images: GitRepositoryRunImage[] }>('GET', `/api/v1/git-repositories/${id}/runs/${runId}`);
export const listGitRepositoryCandidates = (id: string, runId: string) => req<{ data: GitRepositoryRunCandidate[] }>('GET', `/api/v1/git-repositories/${id}/runs/${runId}/candidates`).then((result) => result.data ?? []);
export const listGitRepositoryDiscoveryRules = (id: string) => req<{ data: GitRepositoryDiscoveryRule[] }>('GET', `/api/v1/git-repositories/${id}/discovery-rules`).then((result) => result.data ?? []);
export const createGitRepositoryDiscoveryRule = (id: string, data: Pick<GitRepositoryDiscoveryRule, 'path_pattern' | 'resolution' | 'config'>) => req<GitRepositoryDiscoveryRule>('POST', `/api/v1/git-repositories/${id}/discovery-rules`, data);
export const deleteGitRepositoryDiscoveryRule = (id: string, ruleId: string) => req<{ result: string }>('DELETE', `/api/v1/git-repositories/${id}/discovery-rules/${ruleId}`);
export const exportGitRepositoryDiscoveryRules = (id: string) => req<{ yaml: string }>('GET', `/api/v1/git-repositories/${id}/discovery-rules/export`).then((result) => result.yaml);
