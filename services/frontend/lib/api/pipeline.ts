import { getApiBase } from './base';

export type PipelineSource = 'generic' | 'justscan_cli' | 'github_actions' | 'gitlab_ci' | 'n8n';
export type PipelineVerdict = 'pending' | 'pass' | 'fail' | 'error';

export interface PipelineScanCreateRequest {
  image: string;
  source: PipelineSource;
  external_ref?: string;
  callback?: {
    url?: string;
    secret?: string;
  };
}

export interface PipelineScanAccepted {
  scan_id: string;
  status: string;
  scan_status: string;
  status_url: string;
  scan_url: string;
}

export interface PipelineScanResult {
  event: string;
  scan_id: string;
  org_id: string;
  source: PipelineSource;
  external_ref?: string;
  status: string;
  external_status?: string;
  current_step: string;
  verdict: PipelineVerdict;
  error_message?: string;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  unknown_count: number;
  image_name: string;
  image_tag: string;
  scan_provider: string;
  scan_url?: string;
  status_url?: string;
  callback: {
    status: string;
    attempts: number;
    last_error?: string;
  };
}

async function pipelineTokenRequest<T>(
  method: 'GET' | 'POST',
  url: string,
  token: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export function resolvePipelineApiURL(publicURL: string, path: string): string {
  const base = publicURL.trim().replace(/\/+$/, '') || getApiBase();
  return `${base}${path}`;
}

export function createPipelineScanWithToken(
  publicURL: string,
  orgId: string,
  token: string,
  request: PipelineScanCreateRequest
) {
  return pipelineTokenRequest<PipelineScanAccepted>(
    'POST',
    resolvePipelineApiURL(publicURL, `/api/v1/orgs/${orgId}/pipeline-scans`),
    token,
    request
  );
}

export function getPipelineScanWithToken(statusURL: string, token: string) {
  return pipelineTokenRequest<PipelineScanResult>('GET', statusURL, token);
}
