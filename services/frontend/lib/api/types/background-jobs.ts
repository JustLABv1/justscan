export type BackgroundJobStatus =
  | 'queued'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | (string & {});

export interface BackgroundJob {
  id: string;
  type: string;
  status: BackgroundJobStatus;
  title: string;
  description?: string | null;
  progress_current?: number | null;
  progress_total?: number | null;
  phase?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface BackgroundJobsResponse {
  jobs: BackgroundJob[];
}

export interface EnqueuedBackgroundJobResponse {
  job: BackgroundJob;
}
