'use client';

import { getScanXrayRequestLogs } from '@/lib/api/scans';
import type { ScanStepLog, XRayRequestLog } from '@/lib/api/types/scans';
import { fullDate, timeAgo } from '@/lib/time';
import { Alert, Button, Card, Chip, ProgressBar, Modal, useOverlayState } from '@heroui/react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

type ProgressStepKey =
  | 'queued'
  | 'preparing_image'
  | 'scanning_image'
  | 'processing_results'
  | 'finalizing_report'
  | 'warming_cache'
  | 'indexing_artifact'
  | 'queued_in_xray'
  | 'waiting_for_xray'
  | 'importing_results'
  | 'completed'
  | 'failed'
  | 'cancelled';

type ProgressStepState = 'pending' | 'active' | 'complete';

type StepDefinition = {
  key: ProgressStepKey;
  title: string;
  description: string;
  detailMessages: string[];
};

type StepView = StepDefinition & {
  state: ProgressStepState;
};

type ProgressModel = {
  activeKey: ProgressStepKey;
  badgeLabel: string;
  eyebrow: string;
  title: string;
  detailMessages: string[];
  note: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  beam: string;
  steps: StepView[];
};

type RuntimeWarning = {
  title: string;
  detail: string;
};

type StatusTone = {
  color: string;
  background: string;
  border: string;
  label: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  trivy: 'Built-in scanner',
  artifactory_xray: 'Artifactory Xray',
};

const TIMELINE_STATUS_TONES: Record<string, StatusTone> = {
  completed: {
    color: '#34d399',
    background: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.22)',
    label: 'completed',
  },
  failed: {
    color: '#f87171',
    background: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.22)',
    label: 'failed',
  },
  cancelled: {
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.20)',
    label: 'cancelled',
  },
  blocked_by_xray_policy: {
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.22)',
    label: 'blocked by xray policy',
  },
  pending: {
    color: '#a1a1aa',
    background: 'rgba(161,161,170,0.08)',
    border: 'rgba(161,161,170,0.15)',
    label: 'queued',
  },
};

const LOCAL_PROGRESS_STEPS: StepDefinition[] = [
  {
    key: 'queued',
    title: 'Queued',
    description: 'Waiting for a scanner worker and free execution capacity.',
    detailMessages: [
      'The scan request is queued and waiting for the next available worker.',
      'JustScan has accepted the scan and is holding it until scanner capacity frees up.',
    ],
  },
  {
    key: 'preparing_image',
    title: 'Preparing Image',
    description: 'Preparing the scan environment and resolving image metadata.',
    detailMessages: [
      'The backend is preparing the scan environment, cache, and registry context.',
      'Scanner prerequisites are being checked before the image analysis starts.',
    ],
  },
  {
    key: 'scanning_image',
    title: 'Scanning Image',
    description: 'The scanner is actively inspecting the image contents.',
    detailMessages: [
      'The scanner is analyzing packages and dependencies inside the image now.',
      'Image contents are being inspected and matched against vulnerability data sources.',
    ],
  },
  {
    key: 'processing_results',
    title: 'Processing Results',
    description: 'Parsing findings and merging scanner output into normalized results.',
    detailMessages: [
      'Findings are being parsed, normalized, and merged into a single result set.',
      'Scanner output is being deduplicated and prepared for persistence.',
    ],
  },
  {
    key: 'finalizing_report',
    title: 'Finalizing Report',
    description: 'Persisting findings, metadata, and report details.',
    detailMessages: [
      'The final report, counts, and metadata are being written to the database.',
      'JustScan is wrapping up enrichment and persisting the completed scan record.',
    ],
  },
];

const XRAY_PROGRESS_STEPS: StepDefinition[] = [
  {
    key: 'queued',
    title: 'Queued',
    description: 'Scan request accepted and waiting for the external pipeline to start.',
    detailMessages: [
      'The external scan request has been accepted and is waiting for the provider pipeline.',
      'JustScan has queued the scan and is waiting for the external provider to begin work.',
    ],
  },
  {
    key: 'warming_cache',
    title: 'Warming Cache',
    description: 'Pulling the image through Artifactory so Xray can inspect it.',
    detailMessages: [
      'Artifactory is warming the image path so Xray can access and index the artifact.',
      'The image is being prepared in Artifactory before Xray starts its own analysis.',
    ],
  },
  {
    key: 'indexing_artifact',
    title: 'Indexing Artifact',
    description: 'Registering manifests and layers for Xray analysis.',
    detailMessages: [
      'Xray is indexing the manifest and layer metadata for the image.',
      'The artifact is being normalized so vulnerabilities can be mapped correctly.',
    ],
  },
  {
    key: 'queued_in_xray',
    title: 'Queued in Xray',
    description: 'The external artifact scan has been submitted and is waiting for execution.',
    detailMessages: [
      'The artifact scan has been submitted to Xray and is waiting in the provider queue.',
      'JustScan is waiting for Xray to begin the artifact analysis step.',
    ],
  },
  {
    key: 'waiting_for_xray',
    title: 'Waiting for Xray',
    description: 'Xray is still processing the image and has not returned a final summary yet.',
    detailMessages: [
      'Xray is still processing the image and has not published final findings yet.',
      'The scan is active in Xray; JustScan will import the result automatically once it is ready.',
    ],
  },
  {
    key: 'importing_results',
    title: 'Importing Results',
    description: 'Collecting and persisting finished Xray findings.',
    detailMessages: [
      'Xray finished and JustScan is importing the findings into the local database.',
      'The external scan result is being converted into JustScan findings and counters.',
    ],
  },
];

const XRAY_STEP_KEYS = new Set<ProgressStepKey>([
  'warming_cache',
  'indexing_artifact',
  'queued_in_xray',
  'waiting_for_xray',
  'importing_results',
]);

const TERMINAL_PROGRESS_STEPS: StepDefinition[] = [
  {
    key: 'completed',
    title: 'Completed',
    description: 'The scan finished successfully and the report is ready.',
    detailMessages: ['The scan finished successfully and the report is ready.'],
  },
  {
    key: 'failed',
    title: 'Failed',
    description: 'The scan stopped because the backend encountered an error.',
    detailMessages: ['The scan stopped because the backend encountered an error.'],
  },
  {
    key: 'cancelled',
    title: 'Cancelled',
    description: 'The scan was intentionally stopped before completion.',
    detailMessages: ['The scan was intentionally stopped before completion.'],
  },
];

const STEP_DEFINITION_MAP = new Map<string, StepDefinition>(
  [...LOCAL_PROGRESS_STEPS, ...XRAY_PROGRESS_STEPS, ...TERMINAL_PROGRESS_STEPS].map((step) => [
    step.key,
    step,
  ])
);

function accentForStep(step: ProgressStepKey) {
  switch (step) {
    case 'preparing_image':
    case 'queued_in_xray':
      return {
        accent: 'color-mix(in srgb, var(--accent) 78%, white)',
        accentSoft: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        accentBorder: 'color-mix(in srgb, var(--accent) 24%, transparent)',
        beam: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent) 92%, transparent), color-mix(in srgb, var(--accent) 10%, transparent), transparent)',
      };
    case 'processing_results':
    case 'waiting_for_xray':
      return {
        accent: '#c084fc',
        accentSoft: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        accentBorder: 'color-mix(in srgb, var(--accent) 24%, transparent)',
        beam: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent) 92%, transparent), color-mix(in srgb, var(--accent) 10%, transparent), transparent)',
      };
    case 'finalizing_report':
    case 'indexing_artifact':
      return {
        accent: 'var(--accent)',
        accentSoft: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        accentBorder: 'color-mix(in srgb, var(--accent) 24%, transparent)',
        beam: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 10%, transparent), color-mix(in srgb, var(--accent) 92%, transparent), color-mix(in srgb, var(--accent) 10%, transparent), transparent)',
      };
    default:
      return {
        accent: 'color-mix(in srgb, var(--accent) 88%, white)',
        accentSoft: 'rgba(139,92,246,0.12)',
        accentBorder: 'rgba(139,92,246,0.24)',
        beam: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.1), rgba(139,92,246,0.92), rgba(139,92,246,0.1), transparent)',
      };
  }
}

function formatElapsed(elapsedSeconds: number): string {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  if (mins > 59) {
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m`;
  }
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatTimelineDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function orderStepLogs(stepLogs?: ScanStepLog[] | null): ScanStepLog[] {
  return (stepLogs ?? []).toSorted((left, right) => left.position - right.position);
}

function resolveStepLogEnd(
  stepLog: ScanStepLog,
  nextStep?: ScanStepLog,
  completedAt?: string | null
): string | null {
  return stepLog.completed_at ?? nextStep?.started_at ?? completedAt ?? null;
}

function latestStepOutput(stepLog?: ScanStepLog | null): string | null {
  if (!stepLog || stepLog.output.length === 0) {
    return null;
  }
  return stepLog.output[stepLog.output.length - 1] ?? null;
}

function stepOutputCount(stepLog?: ScanStepLog | null): number {
  if (!stepLog) {
    return 0;
  }
  return stepLog.output_count ?? stepLog.output.length;
}

function prettyXrayValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function providerLabel(scanProvider?: string | null, stepLogs?: ScanStepLog[] | null): string {
  if (scanProvider && PROVIDER_LABELS[scanProvider]) {
    return PROVIDER_LABELS[scanProvider];
  }
  if ((stepLogs ?? []).some((stepLog) => XRAY_STEP_KEYS.has(stepLog.step as ProgressStepKey))) {
    return PROVIDER_LABELS.artifactory_xray;
  }
  return PROVIDER_LABELS.trivy;
}

function compactImageLabel(image?: string | null): string | null {
  if (!image) {
    return null;
  }
  if (image.length <= 64) {
    return image;
  }
  return `${image.slice(0, 28)}...${image.slice(-24)}`;
}

function isBlockedXrayPolicy(
  externalStatus?: string | null,
  scanProvider?: string | null
): boolean {
  return scanProvider === 'artifactory_xray' && externalStatus === 'blocked_by_xray_policy';
}

function hasRecoveredBlockedSummary(stepLogs?: ScanStepLog[] | null): boolean {
  return (stepLogs ?? []).some((stepLog) =>
    stepLog.output.some((line) => {
      const normalized = line.toLowerCase();
      return (
        normalized.includes('blocked-artifact summary') ||
        normalized.includes('stored ') ||
        normalized.includes('xray returned no vulnerabilities')
      );
    })
  );
}

function effectiveTimelineStatus(
  status?: string | null,
  externalStatus?: string | null
): string | null {
  if (status === 'failed' && externalStatus === 'blocked_by_xray_policy') {
    return 'blocked_by_xray_policy';
  }
  return status ?? null;
}

function timelineStatusTone(status?: string | null): StatusTone {
  if (status && TIMELINE_STATUS_TONES[status]) {
    return TIMELINE_STATUS_TONES[status];
  }
  return TIMELINE_STATUS_TONES.pending;
}

function terminalRowTone(step: string, blockedByPolicy: boolean) {
  if (blockedByPolicy) {
    return {
      bubble: '#f59e0b',
      glow: '0 0 10px rgba(245,158,11,0.18)',
      border: 'rgba(245,158,11,0.24)',
      badgeColor: '#f59e0b',
      badgeBackground: 'rgba(245,158,11,0.12)',
    };
  }
  if (step === 'completed') {
    return {
      bubble: '#34d399',
      glow: '0 0 10px rgba(16,185,129,0.18)',
      border: 'rgba(16,185,129,0.24)',
      badgeColor: '#34d399',
      badgeBackground: 'rgba(16,185,129,0.12)',
    };
  }
  if (step === 'failed') {
    return {
      bubble: '#f87171',
      glow: '0 0 10px rgba(239,68,68,0.18)',
      border: 'rgba(239,68,68,0.24)',
      badgeColor: '#f87171',
      badgeBackground: 'rgba(239,68,68,0.12)',
    };
  }
  if (step === 'cancelled') {
    return {
      bubble: '#f59e0b',
      glow: '0 0 10px rgba(245,158,11,0.18)',
      border: 'rgba(245,158,11,0.24)',
      badgeColor: '#f59e0b',
      badgeBackground: 'rgba(245,158,11,0.12)',
    };
  }
  return {
    bubble: 'color-mix(in srgb, var(--accent) 88%, white)',
    glow: 'none',
    border: 'color-mix(in srgb, var(--accent) 18%, transparent)',
    badgeColor: 'color-mix(in srgb, var(--accent) 88%, white)',
    badgeBackground: 'color-mix(in srgb, var(--accent) 8%, transparent)',
  };
}

function buildRuntimeWarning(
  activeKey: ProgressStepKey,
  activeStepElapsedSeconds: number | null,
  latestOutput: string | null,
  scanProvider?: string | null
): RuntimeWarning | null {
  const normalizedOutput = (latestOutput ?? '').toLowerCase();

  if (normalizedOutput.includes('retry')) {
    return {
      title: 'Transient retry in progress',
      detail:
        latestOutput ?? 'The backend is retrying the active step after a transient provider error.',
    };
  }

  if (normalizedOutput.includes('timed out')) {
    return {
      title: 'Still waiting on the provider',
      detail:
        latestOutput ??
        'The active step is still running in the background. JustScan will keep polling until it finishes or goes stale.',
    };
  }

  if (activeStepElapsedSeconds === null) {
    return null;
  }

  if (
    (activeKey === 'queued' || activeKey === 'queued_in_xray') &&
    activeStepElapsedSeconds >= 90
  ) {
    return {
      title: 'Still waiting for execution capacity',
      detail:
        scanProvider === 'artifactory_xray'
          ? 'The request is accepted, but the provider has not started the next execution phase yet.'
          : 'The request is accepted, but a local scanner worker has not started the next execution phase yet.',
    };
  }

  if (activeKey === 'warming_cache' && activeStepElapsedSeconds >= 150) {
    return {
      title: 'Artifactory warm-up is slower than usual',
      detail:
        'The image is still being pulled through Artifactory so Xray can access and index it.',
    };
  }

  if (activeKey === 'waiting_for_xray' && activeStepElapsedSeconds >= 240) {
    return {
      title: 'Still waiting on Xray',
      detail:
        'Xray has not published the final artifact summary yet. JustScan will import findings automatically when it does.',
    };
  }

  if (activeKey === 'scanning_image' && activeStepElapsedSeconds >= 300) {
    return {
      title: 'Image analysis is taking longer than usual',
      detail:
        'The local scanner is still working through the image contents. This is expected for larger images or slower registries and the scan remains active.',
    };
  }

  if (
    (activeKey === 'processing_results' || activeKey === 'importing_results') &&
    activeStepElapsedSeconds >= 150
  ) {
    return {
      title: 'Results processing is still active',
      detail:
        'The backend is still normalizing or importing findings before the report can be published.',
    };
  }

  return null;
}

function titleCaseStep(step: string): string {
  return step
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeStep(step: string): StepDefinition {
  const known = STEP_DEFINITION_MAP.get(step);
  if (known) {
    return known;
  }

  return {
    key: 'queued',
    title: titleCaseStep(step),
    description: 'This step was recorded by the backend during scan execution.',
    detailMessages: ['This step was recorded by the backend during scan execution.'],
  };
}

function resolveCurrentStep(
  status: string,
  currentStep: string | null | undefined,
  scanProvider?: string | null
): ProgressStepKey {
  const normalized = (currentStep ?? '').trim() as ProgressStepKey | '';
  if (normalized) {
    return normalized;
  }
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (scanProvider === 'artifactory_xray') return 'queued';
  return status === 'running' ? 'scanning_image' : 'queued';
}

function buildProgressModel(
  status: string,
  currentStep: string | null | undefined,
  scanProvider?: string | null
): ProgressModel {
  const activeKey = resolveCurrentStep(status, currentStep, scanProvider);
  const xrayFlow = scanProvider === 'artifactory_xray' || XRAY_STEP_KEYS.has(activeKey);
  const steps = xrayFlow ? XRAY_PROGRESS_STEPS : LOCAL_PROGRESS_STEPS;
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.key === activeKey)
  );
  const resolvedStep = steps[activeIndex] ?? steps[0];
  const accent = accentForStep(resolvedStep.key);
  const stepViews: StepView[] = steps.map((step, index) => ({
    ...step,
    state: index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending',
  }));

  return {
    activeKey: resolvedStep.key,
    badgeLabel: resolvedStep.title,
    eyebrow: `Stage ${activeIndex + 1} of ${steps.length}`,
    title: resolvedStep.title,
    detailMessages: resolvedStep.detailMessages,
    note: xrayFlow
      ? 'This progress is driven by live backend states from the Xray integration.'
      : 'This progress is driven by live backend states from the local scanner worker.',
    accent: accent.accent,
    accentSoft: accent.accentSoft,
    accentBorder: accent.accentBorder,
    beam: accent.beam,
    steps: stepViews,
  };
}

export function ScannerDatabaseCard({
  label,
  updatedAt,
  downloadedAt,
}: {
  label: string;
  updatedAt?: string | null;
  downloadedAt?: string | null;
}) {
  return (
    <Card className="p-4">
      <Card.Content className="p-0">
        <p className="mb-1 text-xs text-zinc-500">{label}</p>
        <p
          className="text-sm font-medium text-zinc-900 dark:text-white"
          title={updatedAt ? fullDate(updatedAt) : ''}
        >
          {updatedAt ? `${timeAgo(updatedAt)} (${fullDate(updatedAt)})` : 'Unknown'}
        </p>
        <p className="mt-1 text-xs text-zinc-500" title={downloadedAt ? fullDate(downloadedAt) : ''}>
          Downloaded {downloadedAt ? timeAgo(downloadedAt) : 'unknown'}
        </p>
      </Card.Content>
    </Card>
  );
}

export function ScanningAnimation({
  status,
  startedAt,
  image,
  scanProvider,
  currentStep,
  stepLogs,
}: {
  status: string;
  startedAt: string | null;
  image?: string;
  scanProvider?: string | null;
  currentStep?: string | null;
  stepLogs?: ScanStepLog[] | null;
}) {
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : null;
  const [fallbackStart, setFallbackStart] = useState<number | null>(startedAtMs);
  const [now, setNow] = useState(() => startedAtMs ?? 0);
  const [detailTick, setDetailTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const currentNow = Date.now();
      if (startedAtMs === null) {
        setFallbackStart((current) => current ?? currentNow);
      }
      setNow(currentNow);
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAtMs]);

  useEffect(() => {
    const timer = setInterval(() => setDetailTick((previous) => previous + 1), 2600);
    return () => clearInterval(timer);
  }, []);

  const baseStart = startedAtMs ?? fallbackStart ?? now;
  const elapsed = Math.max(0, Math.floor((now - baseStart) / 1000));
  const progress = buildProgressModel(status, currentStep, scanProvider);
  const detailMessage =
    progress.detailMessages[detailTick % progress.detailMessages.length] ??
    progress.detailMessages[0];
  const orderedLogs = orderStepLogs(stepLogs);
  const activeStepLog =
    [...orderedLogs].reverse().find((stepLog) => stepLog.step === progress.activeKey) ??
    orderedLogs[orderedLogs.length - 1] ??
    null;
  const activeStepStart = activeStepLog?.started_at
    ? new Date(activeStepLog.started_at).getTime()
    : null;
  const activeStepElapsed = activeStepStart
    ? Math.max(0, Math.floor((now - activeStepStart) / 1000))
    : null;
  const latestOutput = latestStepOutput(activeStepLog);
  const runtimeWarning = buildRuntimeWarning(
    progress.activeKey,
    activeStepElapsed,
    latestOutput,
    scanProvider
  );
  const providerName = providerLabel(scanProvider, orderedLogs);
  const compactImage = compactImageLabel(image);
  const activeStepIndex = Math.max(
    0,
    progress.steps.findIndex((step) => step.state === 'active')
  );
  const progressPercent =
    progress.steps.length <= 1
      ? 100
      : Math.round((activeStepIndex / (progress.steps.length - 1)) * 100);

  return (
    <Card className="rounded-2xl p-5 md:p-7">
      <Card.Content className="flex min-w-0 flex-col gap-6 p-0">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-3">
              <Chip color="accent" size="sm" variant="soft">
                {progress.title}
              </Chip>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">{progress.title}</h3>
            </div>
            <p key={`${progress.activeKey}-${detailTick}`} className="min-h-10 text-sm leading-5 text-muted-foreground">
              {detailMessage}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <Chip size="sm" variant="secondary">
              {providerName}
            </Chip>
            <Chip color="accent" size="sm" variant="soft" className="font-mono uppercase tracking-wide">
              {progress.eyebrow}
            </Chip>
            {(startedAt || elapsed > 0) && (
              <Chip size="sm" variant="secondary" className="font-mono">
                total {formatElapsed(elapsed)}
              </Chip>
            )}
            {activeStepElapsed !== null && (
              <Chip size="sm" variant="secondary" className="font-mono">
                step {formatElapsed(activeStepElapsed)}
              </Chip>
            )}
          </div>
        </div>

        <div className="space-y-3 pt-2 pb-3">
          <ProgressBar aria-label="Scan step progress" color="accent" size="sm" value={progressPercent}>
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
          <div className="flex flex-wrap gap-2">
            {progress.steps.map((step) => (
              <Chip
                key={step.key}
                size="sm"
                variant={step.state === 'pending' ? 'secondary' : 'soft'}
                color={step.state === 'complete' ? 'success' : step.state === 'active' ? 'accent' : 'default'}
              >
                {step.title}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-2 grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Card variant="secondary" className="min-w-0 px-4 py-3 pb-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Context
            </p>
            <p className="break-words text-sm font-mono text-foreground" style={{ overflowWrap: 'anywhere' }} title={image}>
              {image || compactImage || '—'}
            </p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{progress.note}</p>
          </Card>
          <Card variant="secondary" className="min-w-0 px-4 py-3 pb-4">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Live signal
              </p>
              <span className="text-[10px] text-muted-foreground">
                {stepOutputCount(activeStepLog)
                  ? `${stepOutputCount(activeStepLog)} update${stepOutputCount(activeStepLog) === 1 ? '' : 's'}`
                  : 'Awaiting'}
              </span>
            </div>
            <p className="break-words text-[13px] font-mono leading-5 text-foreground" style={{ overflowWrap: 'anywhere' }} title={latestOutput ?? ''}>
              {latestOutput ?? 'No output recorded yet.'}
            </p>
          </Card>
          {runtimeWarning && (
            <Alert className="lg:col-span-2" status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{runtimeWarning.title}</Alert.Title>
                <Alert.Description>{runtimeWarning.detail}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}

export function ScanStepTimeline({
  stepLogs,
  completedAt,
  status,
  externalStatus,
  scanProvider,
  scanId,
}: {
  stepLogs?: ScanStepLog[] | null;
  completedAt?: string | null;
  status?: string | null;
  externalStatus?: string | null;
  scanProvider?: string | null;
  scanId?: string | null;
}) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const xrayDebugModal = useOverlayState();
  const [xrayLogs, setXrayLogs] = useState<XRayRequestLog[]>([]);
  const [xrayLogsLoading, setXrayLogsLoading] = useState(false);
  const [xrayLogsError, setXrayLogsError] = useState<string | null>(null);
  const [selectedXrayLogID, setSelectedXrayLogID] = useState<string | null>(null);
  const orderedLogs = orderStepLogs(stepLogs);

  if (orderedLogs.length === 0) {
    return null;
  }

  const finalTimestamp = completedAt ?? orderedLogs[orderedLogs.length - 1]?.completed_at ?? null;
  const firstStartedAt = orderedLogs[0]?.started_at ?? null;
  const totalDurationMs =
    firstStartedAt && finalTimestamp
      ? Math.max(0, new Date(finalTimestamp).getTime() - new Date(firstStartedAt).getTime())
      : null;
  const providerName = providerLabel(scanProvider, orderedLogs);
  const totalOutputs = orderedLogs.reduce((count, stepLog) => count + stepOutputCount(stepLog), 0);
  const blockedByPolicy = isBlockedXrayPolicy(externalStatus, scanProvider);
  const recoveredBlockedSummary = blockedByPolicy && hasRecoveredBlockedSummary(orderedLogs);
  const effectiveStatus = effectiveTimelineStatus(status, externalStatus);
  const statusTone = timelineStatusTone(effectiveStatus);
  const canShowXrayDebug = scanProvider === 'artifactory_xray' && Boolean(scanId);

  const resolvedSelectedStepId =
    selectedStepId && orderedLogs.some((stepLog) => stepLog.id === selectedStepId)
      ? selectedStepId
      : orderedLogs[orderedLogs.length - 1]?.id;
  const selectedStep =
    orderedLogs.find((stepLog) => stepLog.id === resolvedSelectedStepId) ??
    orderedLogs[orderedLogs.length - 1];
  const selectedStepIndex = orderedLogs.findIndex((stepLog) => stepLog.id === selectedStep.id);
  const selectedResolvedEnd = resolveStepLogEnd(
    selectedStep,
    orderedLogs[selectedStepIndex + 1],
    completedAt
  );
  const selectedDurationMs = selectedResolvedEnd
    ? Math.max(
        0,
        new Date(selectedResolvedEnd).getTime() - new Date(selectedStep.started_at).getTime()
      )
    : null;
  const selectedDefinition = describeStep(selectedStep.step);
  const selectedOutputPreview = latestStepOutput(selectedStep);
  const selectedRowTone = terminalRowTone(
    selectedStep.step,
    blockedByPolicy && selectedStep.step === 'failed'
  );
  const selectedIsTerminal =
    selectedStep.step === 'completed' ||
    selectedStep.step === 'failed' ||
    selectedStep.step === 'cancelled';
  const firstActiveIndex = orderedLogs.findIndex(
    (stepLog, index) => !resolveStepLogEnd(stepLog, orderedLogs[index + 1], completedAt)
  );
  const effectiveActiveIndex = firstActiveIndex === -1 ? orderedLogs.length - 1 : firstActiveIndex;
  const timelineProgressPercent =
    orderedLogs.length <= 1
      ? 100
      : Math.max(0, Math.min(100, (effectiveActiveIndex / (orderedLogs.length - 1)) * 100));

  let slowestStep: { title: string; durationMs: number } | null = null;
  for (let index = 0; index < orderedLogs.length; index += 1) {
    const stepLog = orderedLogs[index];
    const resolvedEnd = resolveStepLogEnd(stepLog, orderedLogs[index + 1], completedAt);
    if (!resolvedEnd) continue;
    const durationMs = Math.max(
      0,
      new Date(resolvedEnd).getTime() - new Date(stepLog.started_at).getTime()
    );
    if (!slowestStep || durationMs > slowestStep.durationMs) {
      slowestStep = { title: describeStep(stepLog.step).title, durationMs };
    }
  }

  const selectedXrayLog =
    xrayLogs.find((entry) => entry.id === selectedXrayLogID) ??
    xrayLogs[xrayLogs.length - 1] ??
    null;

  const loadXrayLogs = async () => {
    if (!scanId) {
      return;
    }
    setXrayLogsLoading(true);
    setXrayLogsError(null);
    try {
      const entries = await getScanXrayRequestLogs(scanId, 400);
      setXrayLogs(entries);
      setSelectedXrayLogID(entries[entries.length - 1]?.id ?? null);
    } catch (error: unknown) {
      setXrayLogsError(error instanceof Error ? error.message : 'Failed to load Xray debug logs');
      setXrayLogs([]);
      setSelectedXrayLogID(null);
    } finally {
      setXrayLogsLoading(false);
    }
  };

  const handleOpenXrayDebug = async () => {
    xrayDebugModal.open();
    await loadXrayLogs();
  };

  return (
    <Card
      className="surface-card overflow-hidden rounded-[28px] p-5 md:px-6 md:py-6"
      style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}
    >
      <style>{`
				@keyframes timelineRise { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: translateY(0); } }
				@keyframes timelineGlow { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.9; } }
				@keyframes timelinePulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 0%, transparent); } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 10%, transparent); } }
			`}</style>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
            Backend step history
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {blockedByPolicy && recoveredBlockedSummary
              ? 'Xray blocked the normal scan path, but JustScan still recovered artifact summary data and imported whatever findings the provider exposed.'
              : 'Each row is persisted by the backend, including timestamps and any step output that was produced.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canShowXrayDebug && (
            <Button
              size="sm"
              variant="outline"
              onPress={() => {
                void handleOpenXrayDebug();
              }}
            >
              Xray debug
            </Button>
          )}
          {effectiveStatus && (
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{
                color: statusTone.color,
                background: statusTone.background,
                border: `1px solid ${statusTone.border}`,
              }}
            >
              {statusTone.label}
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Total duration
            </p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {totalDurationMs !== null ? formatDuration(totalDurationMs) : '—'}
            </p>
          </div>
          <p className="text-xs text-zinc-500">Across {orderedLogs.length} recorded steps</p>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Slowest step
            </p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {slowestStep?.title ?? '—'}
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            {slowestStep ? formatDuration(slowestStep.durationMs) : 'No completed duration yet'}
          </p>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Provider
            </p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">{providerName}</p>
          </div>
          <p className="text-xs text-zinc-500">
            {totalOutputs} backend update{totalOutputs === 1 ? '' : 's'} captured
          </p>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Finished
            </p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">
              {finalTimestamp ? timeAgo(finalTimestamp) : '—'}
            </p>
          </div>
          <p className="text-xs text-zinc-500">
            {finalTimestamp ? fullDate(finalTimestamp) : 'No completion time recorded'}
          </p>
        </Card>
      </div>

      <Card className="mt-5 p-4 md:p-5">
        <div className="hidden md:block">
          <div className="overflow-x-auto">
            <div className="flex min-w-[900px] px-4 py-4">
              {orderedLogs.map((stepLog, index) => {
                const definition = describeStep(stepLog.step);
                const resolvedEnd = resolveStepLogEnd(stepLog, orderedLogs[index + 1], completedAt);
                const durationMs = resolvedEnd
                  ? Math.max(
                      0,
                      new Date(resolvedEnd).getTime() - new Date(stepLog.started_at).getTime()
                    )
                  : null;
                const blockedTerminalRow = blockedByPolicy && stepLog.step === 'failed';
                const rowTone = terminalRowTone(stepLog.step, blockedTerminalRow);
                const isSelected = selectedStep.id === stepLog.id;
                const isCompleted = Boolean(resolvedEnd);
                const isActive = index === effectiveActiveIndex && !isCompleted;
                const isFirst = index === 0;
                const isLast = index === orderedLogs.length - 1;
                const leftDone = index <= effectiveActiveIndex;
                const rightDone = index < effectiveActiveIndex;

                return (
                  <motion.button
                    key={stepLog.id}
                    type="button"
                    onClick={() => setSelectedStepId(stepLog.id)}
                    className="group m-0 flex flex-1 appearance-none flex-col items-center border-0 bg-transparent p-0 text-center"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: index * 0.045 }}
                  >
                    {/* Date label */}
                    <span className="mb-2 block text-[11px] font-semibold uppercase leading-4 tracking-[0.16em] text-zinc-500">
                      {formatTimelineDate(stepLog.started_at)}
                    </span>

                    {/* Connector + circle in the same flex row — lines run through circle center by design */}
                    <div className="flex w-full items-center">
                      <div
                        className="h-[3px] flex-1"
                        style={{
                          background: isFirst
                            ? 'transparent'
                            : leftDone
                              ? '#10b981'
                              : 'var(--surface-border)',
                        }}
                      />
                      <motion.span
                        className="z-10 flex flex-shrink-0 items-center justify-center rounded-full border text-xs font-bold"
                        style={{
                          width: 32,
                          height: 32,
                          background: isCompleted
                            ? '#10b981'
                            : isActive
                              ? '#14b8a6'
                              : 'var(--card-bg)',
                          borderColor:
                            isCompleted || isActive ? 'transparent' : 'var(--surface-border)',
                          color: isCompleted || isActive ? '#ffffff' : '#71717a',
                          boxShadow: isSelected
                            ? `0 0 0 6px ${rowTone.badgeBackground}`
                            : undefined,
                        }}
                        animate={isSelected || isActive ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                        transition={{
                          duration: 1.5,
                          repeat: isSelected || isActive ? Infinity : 0,
                          ease: 'easeInOut',
                        }}
                      >
                        {isCompleted ? (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          index + 1
                        )}
                      </motion.span>
                      <div
                        className="h-[3px] flex-1"
                        style={{
                          background: isLast
                            ? 'transparent'
                            : rightDone
                              ? '#10b981'
                              : 'var(--surface-border)',
                        }}
                      />
                    </div>

                    {/* Labels below */}
                    <div className="mt-3 px-1">
                      <p className="text-xs font-semibold text-zinc-900 dark:text-white">
                        {blockedTerminalRow ? 'Blocked by policy' : definition.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                        {definition.description}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                        {durationMs !== null ? formatDuration(durationMs) : 'Running'}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-2 md:hidden">
          {orderedLogs.map((stepLog, index) => {
            const definition = describeStep(stepLog.step);
            const resolvedEnd = resolveStepLogEnd(stepLog, orderedLogs[index + 1], completedAt);
            const blockedTerminalRow = blockedByPolicy && stepLog.step === 'failed';
            const isSelected = selectedStep.id === stepLog.id;

            return (
              <button
                key={stepLog.id}
                type="button"
                onClick={() => setSelectedStepId(stepLog.id)}
                className="w-full rounded-xl px-3 py-2 text-left"
                style={{
                  background: isSelected ? 'rgba(20,184,166,0.08)' : 'var(--card-bg)',
                  border: `1px solid ${isSelected ? 'rgba(20,184,166,0.25)' : 'var(--surface-border)'}`,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                      {blockedTerminalRow ? 'Blocked by Xray policy' : definition.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">{definition.description}</p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    {resolvedEnd ? 'Done' : 'Active'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {formatTimelineDate(stepLog.started_at)} • {timeAgo(stepLog.started_at)}
                </p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="mt-4 rounded-2xl p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Selected step
            </p>
            <h4 className="mt-1 text-base font-semibold text-zinc-900 dark:text-white">
              {blockedByPolicy && selectedStep.step === 'failed'
                ? 'Blocked by Xray policy'
                : selectedDefinition.title}
            </h4>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {selectedDefinition.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span
              className="rounded-full px-2.5 py-1 text-zinc-600 dark:text-zinc-300"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
            >
              Started {timeAgo(selectedStep.started_at)}
            </span>
            <span
              className="rounded-full px-2.5 py-1 text-zinc-600 dark:text-zinc-300"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
            >
              {selectedDurationMs !== null ? formatDuration(selectedDurationMs) : 'Running'}
            </span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Card variant="secondary">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Started
            </p>
            <p
              className="text-xs text-zinc-800 dark:text-zinc-200"
              title={fullDate(selectedStep.started_at)}
            >
              {fullDate(selectedStep.started_at)}
            </p>
          </Card>
          {selectedResolvedEnd && (
            <Card variant="secondary">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Finished
              </p>
              <p
                className="text-xs text-zinc-800 dark:text-zinc-200"
                title={fullDate(selectedResolvedEnd)}
              >
                {fullDate(selectedResolvedEnd)}
              </p>
            </Card>
          )}
        </div>

        <Card className="mt-4" variant="secondary">
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{
                background: selectedIsTerminal ? selectedRowTone.bubble : 'color-mix(in srgb, var(--accent) 78%, white)',
                animation: 'timelineGlow 1.7s ease-in-out infinite',
              }}
            />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Live signal
            </p>
          </div>
          <p className="text-sm leading-6 text-zinc-800 dark:text-zinc-200">
            {selectedOutputPreview ?? 'No backend output was recorded for this step.'}
          </p>
          {selectedStep.output.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {selectedStep.output.map((line, outputIndex) => (
                <li
                  key={`${selectedStep.id}-output-${outputIndex}`}
                  className="text-sm leading-5 text-zinc-700 dark:text-zinc-300"
                >
                  {line}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Card>

      <Modal state={xrayDebugModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="full" placement="center">
            <Modal.Dialog className="surface-modal max-h-[85vh] overflow-hidden rounded-2xl">
              <Modal.Header
                className="border-b px-6 py-4"
                style={{ borderColor: 'var(--surface-border)' }}
              >
                <Modal.Heading className="text-base font-semibold text-zinc-900 dark:text-white">
                  Xray request timeline debug
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="min-h-0 px-0 py-0">
                <div className="grid h-[70vh] grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <div
                    className="border-b p-3 lg:border-b-0 lg:border-r"
                    style={{ borderColor: 'var(--surface-border)' }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Requests ({xrayLogs.length})
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          void loadXrayLogs();
                        }}
                        isDisabled={xrayLogsLoading}
                      >
                        {xrayLogsLoading ? 'Refreshing…' : 'Refresh'}
                      </Button>
                    </div>
                    {xrayLogsError && (
                      <p className="mb-2 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-xs text-red-500">
                        {xrayLogsError}
                      </p>
                    )}
                    <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
                      {xrayLogs.map((entry, index) => {
                        const isActive = selectedXrayLog?.id === entry.id;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className="w-full rounded-lg border px-2.5 py-2 text-left"
                            style={{
                              borderColor: isActive
                                ? 'rgba(20,184,166,0.35)'
                                : 'var(--surface-border)',
                              background: isActive ? 'rgba(20,184,166,0.10)' : 'var(--card-bg)',
                            }}
                            onClick={() => setSelectedXrayLogID(entry.id)}
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                              #{index + 1} - {entry.method}
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-xs font-medium text-zinc-900 dark:text-white">
                              {entry.endpoint}
                            </p>
                            <p className="mt-1 text-[11px] text-zinc-500">
                              {entry.status_code} - {entry.duration_ms}ms -{' '}
                              {timeAgo(entry.created_at)}
                            </p>
                          </button>
                        );
                      })}
                      {!xrayLogsLoading && xrayLogs.length === 0 && (
                        <p
                          className="rounded-lg border px-3 py-2 text-xs text-zinc-500"
                          style={{ borderColor: 'var(--surface-border)' }}
                        >
                          No Xray requests were logged for this scan yet.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="min-h-0 overflow-y-auto p-4 md:p-5">
                    {selectedXrayLog ? (
                      <div className="space-y-3">
                        <Card variant="secondary" className="space-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            Request
                          </p>
                          <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                            {selectedXrayLog.method} {selectedXrayLog.endpoint}
                          </p>
                          <p className="text-xs text-zinc-500">
                            URL: {selectedXrayLog.request_url || selectedXrayLog.endpoint}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {fullDate(selectedXrayLog.created_at)} - {selectedXrayLog.duration_ms}ms
                            - Status {selectedXrayLog.status_code}
                          </p>
                          {selectedXrayLog.error && (
                            <p className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-red-500">
                              {selectedXrayLog.error}
                            </p>
                          )}
                        </Card>

                        <Card variant="secondary">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            Request headers
                          </p>
                          <pre
                            className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border p-2 text-xs"
                            style={{ borderColor: 'var(--surface-border)' }}
                          >
                            {prettyXrayValue(selectedXrayLog.request_headers ?? {})}
                          </pre>
                        </Card>

                        <Card variant="secondary">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            Request body
                          </p>
                          <pre
                            className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border p-2 text-xs"
                            style={{ borderColor: 'var(--surface-border)' }}
                          >
                            {prettyXrayValue(selectedXrayLog.request_body ?? '')}
                          </pre>
                        </Card>

                        <Card variant="secondary">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            Response headers
                          </p>
                          <pre
                            className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border p-2 text-xs"
                            style={{ borderColor: 'var(--surface-border)' }}
                          >
                            {prettyXrayValue(selectedXrayLog.response_headers ?? {})}
                          </pre>
                        </Card>

                        <Card variant="secondary">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            Response body
                          </p>
                          <pre
                            className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border p-2 text-xs"
                            style={{ borderColor: 'var(--surface-border)' }}
                          >
                            {prettyXrayValue(selectedXrayLog.response_body ?? '')}
                          </pre>
                        </Card>
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">
                        Select a request to inspect full debug details.
                      </p>
                    )}
                  </div>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </Card>
  );
}
