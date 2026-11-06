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
import { Sheet } from '@/components/panelui/sheet';
import { Button, Spinner } from '@/components/ui';
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot';
import { ArrowUpRight, X } from 'lucide-react';
import { Activity01Icon, Alert02Icon, Refresh01Icon } from 'hugeicons-react';
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

function jobStatusTone(status: string): StatusDotTone {
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
      return 'neutral';
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

function scanDetailsHref(job: BackgroundJob) {
  if (job.type !== 'scan') return null;
  const scanID = job.metadata?.scan_id ?? job.metadata?.resource_id;
  if (typeof scanID !== 'string' || !scanID.trim()) return null;
  return `/scans/details/${encodeURIComponent(scanID)}`;
}

function isWatchlistScanJob(job: BackgroundJob) {
  return (
    job.type === 'scan' &&
    (job.metadata?.trigger_source === 'watchlist' || typeof job.metadata?.watchlist_id === 'string')
  );
}

function isGitScanJob(job: BackgroundJob) {
  return job.type === 'scan' && job.metadata?.trigger_source === 'git_repository';
}

/** Watchlist schedules and Git repository scans, as opposed to scans a person started. */
function isAutomatedJob(job: BackgroundJob) {
  return isWatchlistScanJob(job) || isGitScanJob(job);
}

/**
 * Automated runs only earn a place here while they run or after they fail;
 * a routine finished one is history that lives on its own page.
 */
function isVisibleJob(job: BackgroundJob) {
  if (!isAutomatedJob(job)) return true;
  return isBackgroundJobActive(job) || job.status === 'failed';
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

function BackgroundJobRow({
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
  const scanHref = scanDetailsHref(job);

  const subtitle = active
    ? formatPhase(job.phase) || job.description || 'Working in the background…'
    : [
        job.finished_at
          ? `${jobStatusLabel(job.status)} ${timeAgo(job.finished_at)}`
          : jobStatusLabel(job.status),
        job.description,
        isWatchlistScanJob(job) ? 'Watchlist' : isGitScanJob(job) ? 'Git repository' : null,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <li
      aria-label={`${job.title}, ${jobStatusLabel(job.status)}`}
      className="group flex min-w-0 items-start gap-3 px-5 py-3"
    >
      <span className="mt-1.5 flex size-4 shrink-0 items-center justify-center">
        {active ? (
          <Spinner aria-label={`${jobStatusLabel(job.status)} process`} size="sm" />
        ) : (
          <StatusDot tone={jobStatusTone(job.status)} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-foreground">{job.title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>

        {active && hasProgress(job) ? (
          <div className="mt-2 space-y-1">
            <div
              role="progressbar"
              aria-label={`${job.title} progress`}
              aria-valuemin={0}
              aria-valuemax={progressTotal}
              aria-valuenow={progressCurrent}
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {progressCurrent.toLocaleString()} of {progressTotal.toLocaleString()}
            </p>
          </div>
        ) : null}

        {job.status === 'failed' && job.error ? (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Show error
            </summary>
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 font-mono text-xs leading-5 text-muted-foreground">
              {job.error}
            </pre>
          </details>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {scanHref ? (
          <a
            href={scanHref}
            aria-label={`View scan for ${job.title}`}
            title="View scan"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArrowUpRight aria-hidden className="size-4" />
          </a>
        ) : null}
        {!active ? (
          <button
            type="button"
            aria-label={`Remove ${job.title || 'background process'} from the process center`}
            title="Remove"
            disabled={isDismissing}
            onClick={() => onDismiss(job.id)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ActivityTrigger({
  collapsed,
  activeCount,
  onPress,
}: {
  collapsed: boolean;
  activeCount: number;
  onPress: () => void;
}) {
  return (
    <div className="relative w-full">
      <Button
        aria-label={
          activeCount > 0
            ? `Background processes, ${activeCount} active`
            : 'Background processes, no active jobs'
        }
        className={
          collapsed
            ? 'relative w-full text-muted-foreground'
            : 'w-full justify-start gap-2 text-muted-foreground hover:text-foreground'
        }
        isIconOnly={collapsed}
        size="default"
        onPress={onPress}
        variant="ghost"
      >
        {activeCount > 0 ? (
          <Spinner size="sm" aria-hidden />
        ) : (
          <Activity01Icon aria-hidden size={17} />
        )}
        {!collapsed ? (
          <>
            <span className="flex-1 text-left">Activity</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {activeCount > 0 ? `${activeCount} running` : 'Idle'}
            </span>
          </>
        ) : null}
      </Button>
      {collapsed && activeCount > 0 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
        />
      ) : null}
    </div>
  );
}

export function BackgroundProcessCenter({ collapsed = false }: { collapsed?: boolean }) {
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
    () => (jobsScopeKey === scopeKey ? jobs : []).filter(isVisibleJob),
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
          } else if (
            (job.status === 'succeeded' || job.status === 'completed') &&
            !isAutomatedJob(job)
          ) {
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
      setJobs((current) =>
        mergeJobs(current, [job, ...current.filter((item) => item.id !== job.id)])
      );
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
      <ActivityTrigger
        collapsed={collapsed}
        activeCount={activeCount}
        onPress={() => {
          setIsOpen(true);
          void loadJobs();
        }}
      />

      <Sheet open={isOpen} onOpenChange={setIsOpen} side="right">
        <Sheet.Content className="sm:max-w-md">
          <Sheet.Header
            title="Background processes"
            description={
              activeCount > 0
                ? `${activeCount} running or queued · ${finishedJobs.length} finished`
                : finishedJobs.length > 0
                  ? `Nothing running · ${finishedJobs.length} finished`
                  : 'Nothing running'
            }
          />
          <Sheet.Body className="p-0">
            <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
              {announcement}
            </div>
            {loading && scopedJobs.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Spinner aria-label="Loading background processes" />
                Loading processes…
              </div>
            ) : scopedError && scopedJobs.length === 0 ? (
              <div className="m-5 space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-start gap-3">
                  <Alert02Icon aria-hidden className="mt-0.5 shrink-0 text-destructive" size={18} />
                  <div>
                    <p className="text-sm font-medium">Couldn’t load processes</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{scopedError}</p>
                  </div>
                </div>
                <Button onPress={() => void loadJobs()} size="sm" variant="secondary">
                  <Refresh01Icon aria-hidden size={14} />
                  Try again
                </Button>
              </div>
            ) : scopedJobs.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <Activity01Icon aria-hidden className="mx-auto text-muted-foreground" size={26} />
                <p className="mt-3 text-sm font-medium">Nothing to track yet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Long-running scans and cleanup tasks will appear here while they work.
                </p>
              </div>
            ) : (
              <div className="pb-4">
                {scopedError ? (
                  <p className="mx-5 mb-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    Updates paused: {scopedError}
                  </p>
                ) : null}
                {activeJobs.length > 0 ? (
                  <section aria-label="In progress">
                    <h3 className="px-5 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                      In progress
                    </h3>
                    <ul>
                      {activeJobs.map((job) => (
                        <BackgroundJobRow
                          isDismissing={dismissingJobIDs.has(job.id)}
                          job={job}
                          key={job.id}
                          onDismiss={(id) => void dismissJobs([id])}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
                {finishedJobs.length > 0 ? (
                  <section aria-label="Finished" className={activeJobs.length > 0 ? 'mt-3' : ''}>
                    <div className="flex items-center justify-between px-5 pb-1 pt-2">
                      <h3 className="text-xs font-medium text-muted-foreground">Finished</h3>
                      <button
                        type="button"
                        disabled={dismissingJobIDs.size > 0}
                        onClick={() => void dismissJobs(finishedJobs.map((job) => job.id))}
                        className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                      >
                        Clear all
                      </button>
                    </div>
                    <ul>
                      {finishedJobs.map((job) => (
                        <BackgroundJobRow
                          isDismissing={dismissingJobIDs.has(job.id)}
                          job={job}
                          key={job.id}
                          onDismiss={(id) => void dismissJobs([id])}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
          </Sheet.Body>
        </Sheet.Content>
      </Sheet>
    </>
  );
}
