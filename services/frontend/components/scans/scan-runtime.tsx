'use client';

import { getScanXrayRequestLogs } from '@/lib/api/scans';
import type { ScanStepLog, XRayRequestLog } from '@/lib/api/types/scans';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  Modal,
  ProgressBar,
  ScrollShadow,
  useOverlayState,
} from '@heroui/react';
import {
  Clock01Icon,
  CloudUploadIcon,
  DatabaseSyncIcon,
  FileSearchIcon,
  FileValidationIcon,
  FileVerifiedIcon,
  FolderFileStorageIcon,
  PackageIcon,
  Search01Icon,
  ServerStack01Icon,
  Shield01Icon,
} from 'hugeicons-react';
import type { ComponentType, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

type ProgressStepState = 'pending' | 'active' | 'complete';

type StepDefinition = {
  key: string;
  title: string;
  description: string;
  detailMessages: string[];
};

type StepView = StepDefinition & {
  state: ProgressStepState;
};

type StepIconComponent = ComponentType<{
  'aria-hidden'?: boolean;
  className?: string;
  size?: number;
}>;

type ProgressModel = {
  activeKey: string;
  eyebrow: string;
  title: string;
  detailMessages: string[];
  note: string;
  steps: StepView[];
};

type RuntimeWarning = {
  title: string;
  detail: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  trivy: 'Built-in scanner',
  artifactory_xray: 'Artifactory Xray',
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

const XRAY_STEP_KEYS = new Set<string>([
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

const STEP_IDENTITY_ICONS: Record<string, StepIconComponent> = {
  cancelled: Clock01Icon,
  completed: FileVerifiedIcon,
  failed: Shield01Icon,
  finalizing_report: FileValidationIcon,
  importing_results: DatabaseSyncIcon,
  indexing_artifact: FolderFileStorageIcon,
  preparing_image: PackageIcon,
  processing_results: DatabaseSyncIcon,
  queued: Clock01Icon,
  queued_in_xray: ServerStack01Icon,
  scanning_image: Search01Icon,
  waiting_for_xray: Clock01Icon,
  warming_cache: CloudUploadIcon,
};

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
  if ((stepLogs ?? []).some((stepLog) => XRAY_STEP_KEYS.has(stepLog.step))) {
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

function buildRuntimeWarning(
  activeKey: string,
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
    key: step,
    title: titleCaseStep(step),
    description: 'This step was recorded by the backend during scan execution.',
    detailMessages: ['This step was recorded by the backend during scan execution.'],
  };
}

function resolveCurrentStep(
  status: string,
  currentStep: string | null | undefined,
  scanProvider?: string | null
): string {
  const normalized = (currentStep ?? '').trim();
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
  const knownActiveIndex = steps.findIndex((step) => step.key === activeKey);
  const activeIndex = knownActiveIndex === -1 ? steps.length : Math.max(0, knownActiveIndex);
  const resolvedStep =
    knownActiveIndex === -1 ? describeStep(activeKey) : (steps[activeIndex] ?? steps[0]);
  const stepViews: StepView[] = [
    ...steps.map(
      (step, index): StepView => ({
        ...step,
        state: index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending',
      })
    ),
    ...(knownActiveIndex === -1
      ? [
          {
            ...resolvedStep,
            key: activeKey,
            state: 'active' as const,
          },
        ]
      : []),
  ];

  return {
    activeKey: resolvedStep.key,
    eyebrow: `Stage ${Math.min(activeIndex + 1, stepViews.length)} of ${stepViews.length}`,
    title: resolvedStep.title,
    detailMessages: resolvedStep.detailMessages,
    note: xrayFlow
      ? 'This progress is driven by live backend states from the Xray integration.'
      : 'This progress is driven by live backend states from the local scanner worker.',
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
        <p
          className="mt-1 text-xs text-zinc-500"
          title={downloadedAt ? fullDate(downloadedAt) : ''}
        >
          Downloaded {downloadedAt ? timeAgo(downloadedAt) : 'unknown'}
        </p>
      </Card.Content>
    </Card>
  );
}

type PipelineStepRuntime = StepView & {
  runtimeId: string;
  durationLabel: string;
  output: string[];
  startedAt?: string | null;
  completedAt?: string | null;
};

function scanStatusLabel(status: string): string {
  if (status === 'pending') return 'Queued';
  if (status === 'running') return 'Running';
  return titleCaseStep(status);
}

function pipelineStatusColor(
  status: string
): 'default' | 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'cancelled' || status === 'blocked_by_xray_policy') return 'warning';
  if (status === 'pending') return 'default';
  return 'accent';
}

function stepStateTone(state: ProgressStepState): {
  color: 'default' | 'accent' | 'success';
  label: string;
  rowClassName: string;
} {
  if (state === 'complete') {
    return {
      color: 'success',
      label: 'Done',
      rowClassName: 'bg-success/5 text-success',
    };
  }
  if (state === 'active') {
    return {
      color: 'accent',
      label: 'Running',
      rowClassName: 'bg-accent/5 text-accent',
    };
  }
  return {
    color: 'default',
    label: 'Waiting',
    rowClassName: 'bg-default/40 text-muted',
  };
}

function StepStatusIcon({ state, title }: { state: ProgressStepState; title: string }) {
  if (state === 'complete') {
    return (
      <span
        aria-label={`${title} complete`}
        className="flex size-5 items-center justify-center rounded-full bg-success text-success-foreground"
      >
        <svg
          aria-hidden
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          viewBox="0 0 24 24"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  if (state === 'active') {
    return (
      <span
        aria-label={`${title} running`}
        className="flex size-5 items-center justify-center rounded-full border-2 border-accent/25 border-t-accent motion-safe:animate-spin"
      />
    );
  }

  return (
    <span
      aria-label={`${title} waiting`}
      className="flex size-5 items-center justify-center rounded-full bg-default"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-muted" />
    </span>
  );
}

function StepIdentityIcon({ state, stepKey }: { state: ProgressStepState; stepKey: string }) {
  const Icon = STEP_IDENTITY_ICONS[stepKey] ?? FileSearchIcon;
  const iconClassName =
    state === 'pending' ? 'text-muted' : state === 'active' ? 'text-accent' : 'text-success';

  return <Icon aria-hidden className={iconClassName} size={20} />;
}

function StepStatusBadge({ state, title }: { state: ProgressStepState; title: string }) {
  if (state === 'complete') {
    return (
      <Badge
        aria-label={`${title} completed successfully`}
        color="success"
        placement="bottom-right"
        size="sm"
      >
        <svg
          aria-hidden
          className="size-2.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          viewBox="0 0 24 24"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </Badge>
    );
  }

  if (state === 'active') {
    return (
      <Badge aria-label={`${title} is running`} color="accent" placement="bottom-right" size="sm">
        <span aria-hidden className="size-2 rounded-full bg-current motion-safe:animate-pulse" />
      </Badge>
    );
  }

  return <Badge aria-label={`${title} is waiting`} color="default" placement="bottom-right" />;
}

function resolvePipelineStepRuntime({
  progress,
  orderedLogs,
  completedAt,
  now,
}: {
  progress: ProgressModel;
  orderedLogs: ScanStepLog[];
  completedAt?: string | null;
  now: number;
}): PipelineStepRuntime[] {
  return progress.steps.map((step) => {
    const matchingLogs = orderedLogs.filter((stepLog) => stepLog.step === step.key);
    const stepLog = matchingLogs[matchingLogs.length - 1] ?? null;
    const stepLogIndex = stepLog
      ? orderedLogs.findIndex((candidate) => candidate.id === stepLog.id)
      : -1;
    const resolvedEnd =
      stepLog && stepLogIndex >= 0
        ? resolveStepLogEnd(stepLog, orderedLogs[stepLogIndex + 1], completedAt)
        : null;
    const startedAtMs = stepLog?.started_at ? new Date(stepLog.started_at).getTime() : null;
    const completedDurationMs =
      startedAtMs && resolvedEnd
        ? Math.max(0, new Date(resolvedEnd).getTime() - startedAtMs)
        : null;
    const activeDurationSeconds =
      step.state === 'active' && startedAtMs
        ? Math.max(0, Math.floor((now - startedAtMs) / 1000))
        : null;
    const durationLabel =
      completedDurationMs !== null
        ? formatDuration(completedDurationMs)
        : activeDurationSeconds !== null
          ? formatElapsed(activeDurationSeconds)
          : step.state === 'pending'
            ? 'Waiting'
            : 'Starting';

    return {
      ...step,
      runtimeId: stepLog?.id ?? `${step.key}-${step.state}`,
      durationLabel,
      output: stepLog?.output ?? [],
      startedAt: stepLog?.started_at ?? null,
      completedAt: resolvedEnd,
    };
  });
}

function activeRuntimeStep(
  runtimeSteps: PipelineStepRuntime[],
  orderedLogs: ScanStepLog[]
): PipelineStepRuntime | null {
  return (
    runtimeSteps.find((step) => step.state === 'active') ??
    runtimeSteps[runtimeSteps.length - 1] ??
    (orderedLogs.length > 0
      ? {
          ...describeStep(orderedLogs[orderedLogs.length - 1].step),
          runtimeId: orderedLogs[orderedLogs.length - 1].id,
          state: 'active',
          durationLabel: 'Running',
          output: orderedLogs[orderedLogs.length - 1].output,
          startedAt: orderedLogs[orderedLogs.length - 1].started_at,
          completedAt: orderedLogs[orderedLogs.length - 1].completed_at,
        }
      : null)
  );
}

function resolveTimelinePipelineSteps({
  orderedLogs,
  completedAt,
}: {
  orderedLogs: ScanStepLog[];
  completedAt?: string | null;
}): PipelineStepRuntime[] {
  return orderedLogs.map((stepLog, index) => {
    const definition = describeStep(stepLog.step);
    const resolvedEnd = resolveStepLogEnd(stepLog, orderedLogs[index + 1], completedAt);
    const durationMs = resolvedEnd
      ? Math.max(0, new Date(resolvedEnd).getTime() - new Date(stepLog.started_at).getTime())
      : null;

    return {
      ...definition,
      runtimeId: stepLog.id,
      state: resolvedEnd ? 'complete' : 'active',
      durationLabel: durationMs !== null ? formatDuration(durationMs) : 'Running',
      output: stepLog.output,
      startedAt: stepLog.started_at,
      completedAt: resolvedEnd,
    };
  });
}

function PipelineStepOverview({ steps }: { steps: PipelineStepRuntime[] }) {
  const activeStepId = steps.find((step) => step.state === 'active')?.runtimeId ?? null;
  const activeStepRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (!activeStepId) {
      return;
    }

    activeStepRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [activeStepId]);

  return (
    <div className="rounded-3xl mt-4">
      <ScrollShadow
        className="-mx-1 px-1 pb-2"
        orientation="horizontal"
        size={32}
        visibility="auto"
      >
        <ol className="flex min-w-full gap-3">
          {steps.map((step, index) => {
            const isActive = step.state === 'active';

            return (
              <li
                key={`${step.key}-${index}`}
                ref={step.runtimeId === activeStepId ? activeStepRef : undefined}
                className={`relative min-w-[17rem] shrink-0 overflow-hidden rounded-2xl border p-px sm:min-w-[19rem] ${
                  isActive
                    ? 'border-accent/20 bg-accent/15 shadow-[0_0_20px_color-mix(in_srgb,var(--accent)_8%,transparent)]'
                    : 'border-divider bg-surface-secondary'
                }`}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-24 bg-[conic-gradient(from_90deg,transparent_0_68%,color-mix(in_srgb,var(--accent)_20%,transparent)_74%,var(--accent)_80%,color-mix(in_srgb,var(--accent)_20%,transparent)_86%,transparent_92%)] opacity-80 motion-safe:animate-spin motion-reduce:hidden"
                  />
                ) : null}
                <div className="relative flex items-start gap-3 rounded-[calc(1rem-1px)] bg-surface-secondary px-4 py-3">
                  <Badge.Anchor className="shrink-0">
                    <span className="flex size-10 items-center justify-center rounded-2xl bg-surface">
                      <StepIdentityIcon state={step.state} stepKey={step.key} />
                    </span>
                    <StepStatusBadge state={step.state} title={step.title} />
                  </Badge.Anchor>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{step.title}</p>
                    <p className="mt-1 font-mono text-xs text-muted">{step.durationLabel}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </ScrollShadow>
    </div>
  );
}

function PipelineDurationList({
  steps,
  selectedStepId,
  onStepSelect,
}: {
  steps: PipelineStepRuntime[];
  selectedStepId?: string | null;
  onStepSelect?: (stepId: string) => void;
}) {
  return (
    <div className="rounded-3xl bg-surface-secondary p-3 sm:p-4">
      <ol className="space-y-1.5">
        {steps.map((step, index) => {
          const tone = stepStateTone(step.state);
          const isSelected = selectedStepId === step.runtimeId;
          const rowClassName = `flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${
            step.state === 'active' ? 'bg-accent/5' : ''
          } ${isSelected ? 'ring-1 ring-accent/25' : ''}`;
          const rowContent = (
            <>
              <StepStatusIcon state={step.state} title={step.title} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{step.title}</p>
                {step.startedAt ? (
                  <p className="mt-0.5 text-xs text-muted">Started {timeAgo(step.startedAt)}</p>
                ) : null}
              </div>
              <span className={`rounded-full px-2.5 py-1 font-mono text-xs ${tone.rowClassName}`}>
                {step.durationLabel}
              </span>
            </>
          );

          return (
            <li key={`${step.runtimeId}-duration-${index}`}>
              {onStepSelect ? (
                <button
                  type="button"
                  className={rowClassName}
                  onClick={() => onStepSelect(step.runtimeId)}
                >
                  {rowContent}
                </button>
              ) : (
                <div className={rowClassName}>{rowContent}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PipelineLiveLogs({
  activeStep,
  detailMessage,
}: {
  activeStep: PipelineStepRuntime | null;
  detailMessage: string;
}) {
  const visibleLogs =
    activeStep && activeStep.output.length > 0
      ? activeStep.output.slice(-7)
      : [
          `$ justscan scan --step ${activeStep?.key ?? 'queued'}`,
          `-> ${detailMessage}`,
          '-> waiting for the next backend update',
        ];

  return (
    <div className="rounded-3xl bg-surface-secondary p-4 shadow-surface sm:p-5">
      <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl font-mono text-xs text-foreground">
        {visibleLogs
          .map((line) => (line.startsWith('$') ? line : `-> ${line.replace(/^->\s?/, '')}`))
          .join('\n')}
      </pre>
    </div>
  );
}

function ScanPipelineCard({
  status,
  image,
  subtitle,
  providerName,
  progress,
  progressPercent,
  elapsed,
  runtimeSteps,
  activeStep,
  detailMessage,
  selectedStepId,
  onStepSelect,
  actions,
}: {
  status: string;
  image?: string;
  subtitle?: string;
  providerName: string;
  progress: ProgressModel;
  progressPercent: number;
  elapsed: number;
  runtimeSteps: PipelineStepRuntime[];
  activeStep: PipelineStepRuntime | null;
  detailMessage: string;
  selectedStepId?: string | null;
  onStepSelect?: (stepId: string) => void;
  actions?: ReactNode;
}) {
  const compactImage = compactImageLabel(image);
  const description = image || compactImage || subtitle || progress.note;

  return (
    <Card className="overflow-hidden p-0">
      <ProgressBar
        aria-label="Running scan progress"
        color={pipelineStatusColor(status)}
        size="sm"
        value={progressPercent}
      >
        <ProgressBar.Track className="rounded-none">
          <ProgressBar.Fill className="rounded-none" />
        </ProgressBar.Track>
      </ProgressBar>

      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-lg">Scan pipeline</Card.Title>
            <Chip size="sm" variant="secondary">
              {providerName}
            </Chip>
          </div>
          <Card.Description
            className="mt-2 max-w-2xl font-mono text-xs"
            title={image || compactImage || undefined}
          >
            {description}
          </Card.Description>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip color={pipelineStatusColor(status)} size="sm" variant="soft">
            {scanStatusLabel(status)} · {progress.title}
          </Chip>
          {actions}
        </div>
      </Card.Header>

      <Card.Content className="gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
        <PipelineStepOverview steps={runtimeSteps} />
        <PipelineDurationList
          onStepSelect={onStepSelect}
          selectedStepId={selectedStepId}
          steps={runtimeSteps}
        />
        <PipelineLiveLogs activeStep={activeStep} detailMessage={detailMessage} />
      </Card.Content>

      <Card.Footer className="flex-row flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
        <p className="font-mono text-sm text-muted">
          {formatElapsed(elapsed)} elapsed · {Math.round(progressPercent)}%
        </p>
        <Chip color={pipelineStatusColor(status)} size="sm" variant="soft">
          {activeStep ? `${activeStep.title}...` : progress.eyebrow}
        </Chip>
      </Card.Footer>
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
  const providerName = providerLabel(scanProvider, orderedLogs);
  const activeStepIndex = Math.max(
    0,
    progress.steps.findIndex((step) => step.state === 'active')
  );
  const progressPercent =
    progress.steps.length <= 1
      ? 100
      : Math.round((activeStepIndex / (progress.steps.length - 1)) * 100);
  const runtimeSteps = resolvePipelineStepRuntime({
    progress,
    orderedLogs,
    completedAt: null,
    now,
  });
  const activeStep = activeRuntimeStep(runtimeSteps, orderedLogs);
  const activeStepStartedAt = activeStep?.startedAt
    ? new Date(activeStep.startedAt).getTime()
    : null;
  const activeStepElapsed = activeStepStartedAt
    ? Math.max(0, Math.floor((now - activeStepStartedAt) / 1000))
    : null;
  const latestOutput =
    activeStep && activeStep.output.length > 0
      ? activeStep.output[activeStep.output.length - 1]
      : null;
  const runtimeWarning = buildRuntimeWarning(
    progress.activeKey,
    activeStepElapsed,
    latestOutput,
    scanProvider
  );

  return (
    <section className="space-y-4">
      <ScanPipelineCard
        activeStep={activeStep}
        detailMessage={detailMessage}
        elapsed={elapsed}
        image={image}
        progress={progress}
        progressPercent={progressPercent}
        providerName={providerName}
        runtimeSteps={runtimeSteps}
        status={status}
      />

      {runtimeWarning ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{runtimeWarning.title}</Alert.Title>
            <Alert.Description>{runtimeWarning.detail}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
    </section>
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
  const elapsedSeconds = totalDurationMs !== null ? Math.round(totalDurationMs / 1000) : 0;
  const providerName = providerLabel(scanProvider, orderedLogs);
  const totalOutputs = orderedLogs.reduce((count, stepLog) => count + stepOutputCount(stepLog), 0);
  const blockedByPolicy = isBlockedXrayPolicy(externalStatus, scanProvider);
  const recoveredBlockedSummary = blockedByPolicy && hasRecoveredBlockedSummary(orderedLogs);
  const effectiveStatus = effectiveTimelineStatus(status, externalStatus);
  const timelineSteps = resolveTimelinePipelineSteps({ orderedLogs, completedAt });
  const canShowXrayDebug = scanProvider === 'artifactory_xray' && Boolean(scanId);
  const resolvedSelectedStepId =
    selectedStepId && orderedLogs.some((stepLog) => stepLog.id === selectedStepId)
      ? selectedStepId
      : orderedLogs[orderedLogs.length - 1]?.id;
  const selectedPipelineStep =
    timelineSteps.find((step) => step.runtimeId === resolvedSelectedStepId) ??
    timelineSteps[timelineSteps.length - 1] ??
    null;
  const activeTimelineStepIndex = timelineSteps.findIndex((step) => step.state === 'active');
  const timelineProgressPercent = finalTimestamp
    ? 100
    : timelineSteps.length <= 1
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            ((activeTimelineStepIndex === -1 ? timelineSteps.length - 1 : activeTimelineStepIndex) /
              (timelineSteps.length - 1)) *
              100
          )
        );
  const timelineProgress: ProgressModel = {
    activeKey: selectedPipelineStep?.key ?? 'completed',
    eyebrow: `${orderedLogs.length} recorded step${orderedLogs.length === 1 ? '' : 's'}`,
    title:
      blockedByPolicy && selectedPipelineStep?.key === 'failed'
        ? 'Blocked by Xray policy'
        : (selectedPipelineStep?.title ?? scanStatusLabel(effectiveStatus ?? 'completed')),
    detailMessages: [selectedPipelineStep?.description ?? 'The scan timeline has been recorded.'],
    note:
      blockedByPolicy && recoveredBlockedSummary
        ? 'Xray blocked the normal scan path, but JustScan recovered artifact summary data and imported the provider findings it could access.'
        : 'This pipeline is reconstructed from the backend step logs persisted for this scan.',
    steps: timelineSteps,
  };

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
    <section className="space-y-4">
      <ScanPipelineCard
        actions={
          canShowXrayDebug ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                void handleOpenXrayDebug();
              }}
            >
              Xray debug
            </Button>
          ) : null
        }
        activeStep={selectedPipelineStep}
        detailMessage={timelineProgress.note}
        elapsed={elapsedSeconds}
        onStepSelect={setSelectedStepId}
        progress={timelineProgress}
        progressPercent={timelineProgressPercent}
        providerName={providerName}
        runtimeSteps={timelineSteps}
        selectedStepId={resolvedSelectedStepId}
        status={effectiveStatus ?? 'completed'}
        subtitle={`${totalOutputs} backend update${totalOutputs === 1 ? '' : 's'} captured${
          finalTimestamp ? ` · Finished ${timeAgo(finalTimestamp)}` : ''
        }`}
      />

      <Modal state={xrayDebugModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="full" placement="center">
            <Modal.Dialog className="max-h-[85vh] overflow-hidden">
              <Modal.Header>
                <Modal.Heading className="text-base font-semibold text-zinc-900 dark:text-white">
                  Xray request timeline debug
                </Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body>
                <div className="grid h-[70vh] grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <div
                    className="border-b p-3 lg:border-b-0 lg:border-r"
                    style={{ borderColor: 'var(--separator-secondary)' }}
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
                    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
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
                                : 'var(--separator-secondary)',
                              background: isActive
                                ? 'rgba(20,184,166,0.10)'
                                : 'var(--surface-secondary)',
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
                        <Card variant="secondary">
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
                            <Alert status="danger" className="bg-danger-soft">
                              <Alert.Indicator />
                              <Alert.Content>
                                <Alert.Title>Unable to connect to server</Alert.Title>
                                <Alert.Description>{selectedXrayLog.error}</Alert.Description>
                              </Alert.Content>
                            </Alert>
                          )}
                        </Card>

                        <Card variant="secondary">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                            Request headers
                          </p>
                          <pre
                            className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border p-2 text-xs"
                            style={{ borderColor: 'var(--separator-tertiary)' }}
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
                            style={{ borderColor: 'var(--separator-tertiary)' }}
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
                            style={{ borderColor: 'var(--separator-tertiary)' }}
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
                            style={{ borderColor: 'var(--separator-tertiary)' }}
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
    </section>
  );
}
