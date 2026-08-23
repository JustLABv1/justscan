'use client';

import {
  BACKGROUND_JOB_ENQUEUED_EVENT,
  announceBackgroundJobFinished,
  dismissBackgroundJob,
  dismissBackgroundJobs,
  isBackgroundJobActive,
  isBackgroundJobFinished,
  listBackgroundJobs,
  openBackgroundProcessCenter,
  OPEN_BACKGROUND_PROCESS_CENTER_EVENT,
} from '@/lib/api/background-jobs';
import type { BackgroundJob } from '@/lib/api/types/background-jobs';
import { timeAgo } from '@/lib/time';
import { useToast } from '@/components/toast';
import { useWorkScope } from '@/hooks/use-work-scope';
import { Badge, Button, Chip, Drawer, ProgressBar, Spinner } from '@heroui/react';
import {
  Activity01Icon,
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Refresh01Icon,
} from 'hugeicons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const JOB_LIMIT = 50;
const ACTIVE_POLL_MS = 2500;
const IDLE_POLL_MS = 15000;

function jobStatusLabel(status: string) {
  switch (status) {
    case 'queued':
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'succeeded':
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.replaceAll('_', ' ') || 'Unknown';
  }
}

function jobStatusColor(status: string): 'default' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'running':
      return 'accent';
    case 'succeeded':
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warning';
    default:
      return 'default';
  }
}

function hasProgress(job: BackgroundJob) {
  return (
    typeof job.progress_total === 'number' &&
    job.progress_total > 0 &&
    typeof job.progress_current === 'number'
  );
}

function formatPhase(phase: string | null | undefined) {
  const normalized = phase?.trim().replaceAll('_', ' ');
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function jobDisplayPriority(job: BackgroundJob) {
  if (isBackgroundJobActive(job)) return 0;
  if (job.status === 'failed') return 1;
  return 2;
}

function jobDisplayTime(job: BackgroundJob) {
  return Date.parse(job.finished_at ?? job.started_at ?? job.created_at) || 0;
}

function mergeJobs(current: BackgroundJob[], incoming: BackgroundJob[]) {
  const nextById = new Map(incoming.map((job) => [job.id, job]));

  // The endpoint is allowed to return only the active window. Keep terminal
  // jobs already shown in this session so the drawer still has a useful
  // recent history after the server trims them from its response.
  for (const job of current) {
    if (!nextById.has(job.id) && isBackgroundJobFinished(job)) {
      nextById.set(job.id, job);
    }
  }

  return Array.from(nextById.values())
    .sort((a, b) => {
      const priorityDifference = jobDisplayPriority(a) - jobDisplayPriority(b);
      if (priorityDifference !== 0) return priorityDifference;
      return jobDisplayTime(b) - jobDisplayTime(a);
    })
    .slice(0, JOB_LIMIT);
}

function announceFinishedJob(job: BackgroundJob, setAnnouncement: (value: string) => void) {
  const title = job.title || 'Background process';
  if (job.status === 'failed') {
    setAnnouncement(`${title} failed${job.error ? `: ${job.error}` : '.'}`);
  } else if (job.status === 'succeeded' || job.status === 'completed') {
    setAnnouncement(`${title} completed.`);
  } else if (job.status === 'cancelled') {
    setAnnouncement(`${title} was cancelled.`);
  }
}

function BackgroundJobCard({
  job,
  isDismissing,
  onDismiss,
}: {
  job: BackgroundJob;
  isDismissing: boolean;
  onDismiss: (id: string) => void;
}) {
  const active = isBackgroundJobActive(job);
  const progressCurrent = Math.max(0, job.progress_current ?? 0);
  const progressTotal = Math.max(1, job.progress_total ?? 1);
  const progressPercent = Math.min(100, (progressCurrent / progressTotal) * 100);
  const color = jobStatusColor(job.status);

  return (
    <article
      aria-label={`${job.title}, ${jobStatusLabel(job.status)}`}
      className="space-y-3 rounded-xl border border-border bg-surface-secondary/60 p-3"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{job.title}</p>
          {job.description ? (
            <p className="mt-1 text-xs leading-5 text-muted">{job.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Chip color={color} size="sm" variant="soft">
            <span className="inline-flex items-center gap-1.5">
              {active ? (
                <Spinner aria-label={`${jobStatusLabel(job.status)} process`} size="sm" />
              ) : null}
              {!active && (job.status === 'succeeded' || job.status === 'completed') ? (
                <CheckmarkCircle02Icon aria-hidden size={13} />
              ) : null}
              {!active && job.status === 'failed' ? <Alert02Icon aria-hidden size={13} /> : null}
              {jobStatusLabel(job.status)}
            </span>
          </Chip>
        </div>
      </div>

      {hasProgress(job) ? (
        <div className="space-y-1.5">
          <ProgressBar
            aria-label={`${job.title} progress`}
            color={color === 'default' ? 'accent' : color}
            maxValue={progressTotal}
            size="sm"
            value={progressCurrent}
          >
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>{formatPhase(job.phase) || (active ? 'Working…' : jobStatusLabel(job.status))}</span>
            <span className="tabular-nums">
              {progressCurrent.toLocaleString()} / {progressTotal.toLocaleString()} (
              {Math.round(progressPercent)}%)
            </span>
          </div>
        </div>
      ) : active ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Spinner aria-hidden size="sm" />
          <span>{formatPhase(job.phase) || 'Working in the background…'}</span>
        </div>
      ) : null}

      {job.status === 'failed' && job.error ? (
        <p className="rounded-lg bg-danger/10 px-2.5 py-2 text-xs leading-5 text-danger">
          {job.error}
        </p>
      ) : null}
      {!active ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <p className="text-[11px] text-muted">
            {job.finished_at
              ? `${jobStatusLabel(job.status)} ${timeAgo(job.finished_at)}`
              : 'Finished'}
          </p>
          <Button
            aria-label={`Remove ${job.title || 'background process'} from the process center`}
            className="shrink-0"
            isPending={isDismissing}
            onPress={() => onDismiss(job.id)}
            size="sm"
            variant="tertiary"
          >
            <Cancel01Icon aria-hidden size={15} />
            Remove
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function BackgroundProcessCenter() {
  const workScope = useWorkScope();
  const scopeKey = workScope.kind === 'org' ? `org:${workScope.orgId}` : 'personal';
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [jobsScopeKey, setJobsScopeKey] = useState(scopeKey);
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorScopeKey, setErrorScopeKey] = useState(scopeKey);
  const [announcement, setAnnouncement] = useState('');
  const [dismissingJobIDs, setDismissingJobIDs] = useState<Set<string>>(() => new Set());
  const toast = useToast();
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const previousStatusesRef = useRef<Map<string, string>>(new Map());
  const loadedRef = useRef(false);
  const jobsScopeKeyRef = useRef(scopeKey);
  const toastRef = useRef(toast);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const scopedJobs = useMemo(
    () => (jobsScopeKey === scopeKey ? jobs : []),
    [jobs, jobsScopeKey, scopeKey]
  );
  const scopedError = errorScopeKey === scopeKey ? error : '';
  const activeJobs = useMemo(() => scopedJobs.filter(isBackgroundJobActive), [scopedJobs]);
  const finishedJobs = useMemo(() => scopedJobs.filter(isBackgroundJobFinished), [scopedJobs]);
  const activeCount = activeJobs.length;

  const loadJobs = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!loadedRef.current) setLoading(true);

    try {
      const response = await listBackgroundJobs(JOB_LIMIT, { signal: controller.signal });
      const incoming = response.jobs ?? [];
      const previousStatuses = previousStatusesRef.current;
      const nextStatuses = new Map<string, string>();

      for (const job of incoming) {
        nextStatuses.set(job.id, job.status);
        const previousStatus = previousStatuses.get(job.id);
        if (previousStatus && previousStatus !== job.status && isBackgroundJobFinished(job)) {
          announceFinishedJob(job, setAnnouncement);
          announceBackgroundJobFinished(job);
          if (job.status === 'failed') {
            toastRef.current.error(`${job.title || 'Background process'} failed`, {
              description: job.error || 'The process could not be completed.',
              action: { label: 'View progress', onPress: openBackgroundProcessCenter },
            });
          } else if (job.status === 'succeeded' || job.status === 'completed') {
            toastRef.current.success(`${job.title || 'Background process'} completed`, {
              description: job.description || undefined,
            });
          }
        }
      }

      previousStatusesRef.current = nextStatuses;
      setJobs((current) =>
        mergeJobs(jobsScopeKeyRef.current === scopeKey ? current : [], incoming)
      );
      jobsScopeKeyRef.current = scopeKey;
      setJobsScopeKey(scopeKey);
      setError('');
      setErrorScopeKey(scopeKey);
      loadedRef.current = true;
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Unable to load background processes.');
        setErrorScopeKey(scopeKey);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [scopeKey]);

  useEffect(() => {
    loadedRef.current = false;
    previousStatusesRef.current = new Map();
    void loadJobs();
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      inFlightRef.current = false;
    };
  }, [loadJobs, scopeKey]);

  useEffect(() => {
    const onVisibilityChange = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const interval = window.setInterval(
      () => void loadJobs(),
      isOpen || activeCount > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS
    );
    return () => window.clearInterval(interval);
  }, [activeCount, isOpen, isVisible, loadJobs]);

  useEffect(() => {
    const onEnqueued = (event: Event) => {
      const job = (event as CustomEvent<{ job?: BackgroundJob }>).detail?.job;
      if (!job) return;
      previousStatusesRef.current.set(job.id, job.status);
      setJobs((current) => mergeJobs(current, [job, ...current.filter((item) => item.id !== job.id)]));
      setJobsScopeKey(scopeKey);
      jobsScopeKeyRef.current = scopeKey;
      void loadJobs();
    };
    window.addEventListener(BACKGROUND_JOB_ENQUEUED_EVENT, onEnqueued);
    return () => window.removeEventListener(BACKGROUND_JOB_ENQUEUED_EVENT, onEnqueued);
  }, [loadJobs, scopeKey]);

  useEffect(() => {
    const onOpen = () => {
      setIsOpen(true);
      void loadJobs();
    };
    window.addEventListener(OPEN_BACKGROUND_PROCESS_CENTER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BACKGROUND_PROCESS_CENTER_EVENT, onOpen);
  }, [loadJobs]);

  useEffect(() => {
    if (!announcement) return;
    const timeout = window.setTimeout(() => setAnnouncement(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [announcement]);

  const dismissJobs = useCallback(async (ids: string[]) => {
    const uniqueIDs = Array.from(new Set(ids));
    if (uniqueIDs.length === 0) return;
    setDismissingJobIDs((current) => new Set([...current, ...uniqueIDs]));
    try {
      if (uniqueIDs.length === 1) {
        await dismissBackgroundJob(uniqueIDs[0]);
      } else {
        await dismissBackgroundJobs(uniqueIDs);
      }
      const removed = new Set(uniqueIDs);
      setJobs((current) => current.filter((job) => !removed.has(job.id)));
      for (const id of removed) previousStatusesRef.current.delete(id);
    } catch (reason) {
      toastRef.current.error('Couldn’t remove process history', {
        description: reason instanceof Error ? reason.message : 'Please try again.',
      });
    } finally {
      setDismissingJobIDs((current) => {
        const next = new Set(current);
        for (const id of uniqueIDs) next.delete(id);
        return next;
      });
    }
  }, []);

  return (
    <>
      <Badge.Anchor className="shrink-0">
        <Button
          aria-label={
            activeCount > 0
              ? `Background processes, ${activeCount} active`
              : 'Background processes, no active jobs'
          }
          className="justify-center rounded-full text-zinc-700 dark:text-zinc-200"
          isIconOnly
          onPress={() => {
            setIsOpen(true);
            void loadJobs();
          }}
          variant="tertiary"
        >
          <Activity01Icon aria-hidden size={17} />
        </Button>
        {activeCount > 0 ? (
          <Badge color="accent" size="sm">
            {activeCount > 99 ? '99+' : activeCount}
          </Badge>
        ) : null}
      </Badge.Anchor>

      <Drawer.Backdrop isOpen={isOpen} onOpenChange={setIsOpen} variant="blur">
        <Drawer.Content placement="right">
          <Drawer.Dialog className="flex h-full w-full max-w-[30rem] flex-col border-l border-border">
            <Drawer.Header className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div className="min-w-0">
                <Drawer.Heading>Background processes</Drawer.Heading>
                <p className="mt-1 text-sm text-muted">
                  {activeCount > 0
                    ? `${activeCount} process${activeCount === 1 ? '' : 'es'} running or queued`
                    : 'No processes are running'}
                </p>
              </div>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body className="space-y-3 p-5">
              <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
                {announcement}
              </div>
              {loading && scopedJobs.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
                  <Spinner aria-label="Loading background processes" />
                  Loading processes…
                </div>
              ) : scopedError && scopedJobs.length === 0 ? (
                <div className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
                  <div className="flex items-start gap-3">
                    <Alert02Icon aria-hidden className="mt-0.5 shrink-0 text-danger" size={18} />
                    <div>
                      <p className="text-sm font-medium">Couldn’t load processes</p>
                      <p className="mt-1 text-xs leading-5 text-muted">{scopedError}</p>
                    </div>
                  </div>
                  <Button onPress={() => void loadJobs()} size="sm" variant="secondary">
                    <Refresh01Icon aria-hidden size={14} />
                    Try again
                  </Button>
                </div>
              ) : scopedJobs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center">
                  <Activity01Icon aria-hidden className="mx-auto text-muted" size={26} />
                  <p className="mt-3 text-sm font-medium">Nothing to track yet</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Long-running scans and cleanup tasks will appear here while they work.
                  </p>
                </div>
              ) : (
                <>
                  {scopedError ? (
                    <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                      Updates paused: {scopedError}
                    </p>
                  ) : null}
                  <div className="space-y-3">
                    {scopedJobs.map((job) => (
                      <BackgroundJobCard
                        isDismissing={dismissingJobIDs.has(job.id)}
                        job={job}
                        key={job.id}
                        onDismiss={(id) => void dismissJobs([id])}
                      />
                    ))}
                  </div>
                </>
              )}
            </Drawer.Body>
            <Drawer.Footer className="flex flex-col gap-2 border-t border-border p-4">
              {finishedJobs.length > 0 ? (
                <Button
                  className="w-full"
                  isDisabled={dismissingJobIDs.size > 0}
                  isPending={dismissingJobIDs.size === finishedJobs.length}
                  onPress={() => void dismissJobs(finishedJobs.map((job) => job.id))}
                  variant="tertiary"
                >
                  <Cancel01Icon aria-hidden size={15} />
                  Remove completed &amp; failed ({finishedJobs.length})
                </Button>
              ) : null}
              <Button slot="close" className="w-full" variant="secondary">
                Close
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}
