import { req, type ApiRequestOptions } from './core';
import { appendScope } from './scope';
import type {
  BackgroundJob,
  BackgroundJobsResponse,
  EnqueuedBackgroundJobResponse,
} from './types/background-jobs';

export const BACKGROUND_JOB_FINISHED_EVENT = 'justscan-background-job-finished';
export const BACKGROUND_JOB_ENQUEUED_EVENT = 'justscan-background-job-enqueued';
export const OPEN_BACKGROUND_PROCESS_CENTER_EVENT = 'justscan-open-process-center';

export function listBackgroundJobs(limit = 50, options?: ApiRequestOptions) {
  const params = new URLSearchParams({ limit: String(limit) });
  appendScope(params);
  return req<BackgroundJobsResponse>(
    'GET',
    `/api/v1/background-jobs?${params.toString()}`,
    undefined,
    options
  );
}

export function openBackgroundProcessCenter() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_BACKGROUND_PROCESS_CENTER_EVENT));
}

export function isBackgroundJobActive(job: BackgroundJob) {
  return job.status === 'queued' || job.status === 'pending' || job.status === 'running';
}

export function isBackgroundJobFinished(job: BackgroundJob) {
  return !isBackgroundJobActive(job);
}

function metadataString(job: BackgroundJob, keys: string[]) {
  const metadata = job.metadata;
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/**
 * Group deletion jobs carry image/tag identifiers in metadata. Keep this
 * matcher tolerant of the backend's snake_case and descriptive aliases so
 * callers can refresh the right surface when a job completes.
 */
export function isScanGroupDeletionJob(job: BackgroundJob, imageName: string, imageTag?: string) {
  const type = job.type.toLowerCase();
  if (!type.includes('delete') && !type.includes('deletion')) return false;
  if (!type.includes('scan') && !type.includes('image') && !type.includes('artifact')) return false;

  const image = metadataString(job, [
    'image',
    'image_name',
    'repository',
    'repository_name',
    'target_image',
  ]);
  const tag = metadataString(job, ['tag', 'image_tag', 'target_tag']);
  if (image && image !== imageName) return false;
  if (imageTag && tag && tag !== imageTag) return false;

  // If metadata is absent, use the title/description as a conservative
  // fallback. This still avoids refreshing unrelated deletion jobs.
  if (!image) {
    const text = `${job.title} ${job.description ?? ''}`.toLowerCase();
    if (!text.includes(imageName.toLowerCase())) return false;
  }
  if (imageTag && !tag) {
    const text = `${job.title} ${job.description ?? ''}`.toLowerCase();
    if (!text.includes(imageTag.toLowerCase())) return false;
  }
  return true;
}

export type BackgroundJobFinishedDetail = { job: BackgroundJob };

export function announceBackgroundJobEnqueued(job: BackgroundJob) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<BackgroundJobFinishedDetail>(BACKGROUND_JOB_ENQUEUED_EVENT, {
      detail: { job },
    })
  );
}

export function announceBackgroundJobFinished(job: BackgroundJob) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<BackgroundJobFinishedDetail>(BACKGROUND_JOB_FINISHED_EVENT, {
      detail: { job },
    })
  );
}

// Re-export the response type from the API module for enqueue callers.
export type { EnqueuedBackgroundJobResponse };
