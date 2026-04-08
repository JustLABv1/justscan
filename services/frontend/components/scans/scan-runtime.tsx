'use client';

import type { ScanStepLog } from '@/lib/api';
import { fullDate, timeAgo } from '@/lib/time';
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

const STEP_DEFINITION_MAP = new Map<string, StepDefinition>([
	...LOCAL_PROGRESS_STEPS,
	...XRAY_PROGRESS_STEPS,
	...TERMINAL_PROGRESS_STEPS,
].map((step) => [step.key, step]));

function accentForStep(step: ProgressStepKey) {
	switch (step) {
		case 'preparing_image':
		case 'queued_in_xray':
			return {
				accent: '#a78bfa',
				accentSoft: 'rgba(167,139,250,0.12)',
				accentBorder: 'rgba(167,139,250,0.24)',
				beam: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.1), rgba(167,139,250,0.92), rgba(167,139,250,0.1), transparent)',
			};
		case 'processing_results':
		case 'waiting_for_xray':
			return {
				accent: '#c084fc',
				accentSoft: 'rgba(192,132,252,0.12)',
				accentBorder: 'rgba(192,132,252,0.24)',
				beam: 'linear-gradient(90deg, transparent, rgba(192,132,252,0.1), rgba(192,132,252,0.92), rgba(192,132,252,0.1), transparent)',
			};
		case 'finalizing_report':
		case 'indexing_artifact':
			return {
				accent: '#7c3aed',
				accentSoft: 'rgba(124,58,237,0.12)',
				accentBorder: 'rgba(124,58,237,0.24)',
				beam: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.1), rgba(124,58,237,0.92), rgba(124,58,237,0.1), transparent)',
			};
		default:
			return {
				accent: '#8b5cf6',
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

function resolveCurrentStep(status: string, currentStep: string | null | undefined, scanProvider?: string | null): ProgressStepKey {
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

function buildProgressModel(status: string, currentStep: string | null | undefined, scanProvider?: string | null): ProgressModel {
	const activeKey = resolveCurrentStep(status, currentStep, scanProvider);
	const xrayFlow = scanProvider === 'artifactory_xray' || XRAY_STEP_KEYS.has(activeKey);
	const steps = xrayFlow ? XRAY_PROGRESS_STEPS : LOCAL_PROGRESS_STEPS;
	const activeIndex = Math.max(0, steps.findIndex((step) => step.key === activeKey));
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

export function ScannerDatabaseCard({ label, updatedAt, downloadedAt }: { label: string; updatedAt?: string | null; downloadedAt?: string | null }) {
	return (
		<div className="glass-panel rounded-xl p-4">
			<p className="text-xs text-zinc-500 mb-1">{label}</p>
			<p className="text-sm font-medium text-zinc-900 dark:text-white" title={updatedAt ? fullDate(updatedAt) : ''}>
				{updatedAt ? `${timeAgo(updatedAt)} (${fullDate(updatedAt)})` : 'Unknown'}
			</p>
			<p className="text-xs text-zinc-500 mt-1" title={downloadedAt ? fullDate(downloadedAt) : ''}>
				Downloaded {downloadedAt ? timeAgo(downloadedAt) : 'unknown'}
			</p>
		</div>
	);
}

export function ScanningAnimation({
	status,
	startedAt,
	image,
	scanProvider,
	currentStep,
}: {
	status: string;
	startedAt: string | null;
	image?: string;
	scanProvider?: string | null;
	currentStep?: string | null;
}) {
	const [fallbackStart] = useState(() => Date.now());
	const [now, setNow] = useState(() => Date.now());
	const [detailTick, setDetailTick] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		const timer = setInterval(() => setDetailTick((previous) => previous + 1), 2600);
		return () => clearInterval(timer);
	}, []);

	const baseStart = startedAt ? new Date(startedAt).getTime() : fallbackStart;
	const elapsed = Math.max(0, Math.floor((now - baseStart) / 1000));
	const progress = buildProgressModel(status, currentStep, scanProvider);
	const detailMessage = progress.detailMessages[detailTick % progress.detailMessages.length] ?? progress.detailMessages[0];

	return (
		<div className="glass-panel overflow-hidden rounded-[28px]" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(91,33,182,0.04) 55%, rgba(167,139,250,0.06) 100%)' }}>
			<div className="relative h-0.5 w-full overflow-hidden" style={{ background: 'rgba(124,58,237,0.16)' }}>
				<div
					className="absolute inset-y-0 left-0"
					style={{
						width: '34%',
						background: progress.beam,
						animation: 'stepperBeam 1.85s linear infinite',
					}}
				/>
			</div>

			<style>{`
				@keyframes stepperBeam { 0% { left: -34%; } 100% { left: 100%; } }
				@keyframes stepPulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.18); opacity: 0.24; } }
				@keyframes activeCard { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
				@keyframes detailFade { 0% { opacity: 0; transform: translateY(8px); } 14% { opacity: 1; transform: translateY(0); } 86% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-8px); } }
				@keyframes shimmerTrail { 0% { transform: translateY(-100%); opacity: 0; } 18% { opacity: 1; } 100% { transform: translateY(120%); opacity: 0; } }
				@keyframes statusFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
			`}</style>

			<div className="grid gap-6 px-5 py-5 md:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] md:px-7 md:py-6">
				<div className="space-y-5">
					<div className="flex flex-wrap items-center gap-2.5">
						<span
							className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]"
							style={{
								color: progress.accent,
								background: progress.accentSoft,
								border: `1px solid ${progress.accentBorder}`,
							}}
						>
							<span className="relative flex h-2.5 w-2.5" style={{ animation: 'statusFloat 1.8s ease-in-out infinite' }}>
								<span className="absolute inset-0 rounded-full" style={{ background: progress.accent, animation: 'stepPulse 1.6s ease-in-out infinite' }} />
								<span className="relative h-2.5 w-2.5 rounded-full" style={{ background: progress.accent }} />
							</span>
							{progress.badgeLabel}
						</span>
						{(startedAt || elapsed > 0) && <span className="font-mono text-xs text-zinc-500">{formatElapsed(elapsed)}</span>}
					</div>

					<div className="space-y-2">
						<p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">{progress.eyebrow}</p>
						<h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">{progress.title}</h2>
						<p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400" key={`${progress.activeKey}-${detailTick}`} style={{ animation: 'detailFade 2.6s ease-in-out forwards', minHeight: 48 }}>
							{detailMessage}
						</p>
					</div>

					<div className="grid gap-3 sm:grid-cols-2">
						{image && (
							<div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.14)' }}>
								<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Image</p>
								<p className="mt-2 break-all font-mono text-sm text-zinc-700 dark:text-zinc-300">{image}</p>
							</div>
						)}
						<div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(124,58,237,0.07)', border: '1px solid rgba(124,58,237,0.14)' }}>
							<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Timing</p>
							<p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{startedAt ? `Started ${timeAgo(startedAt)}` : 'Waiting to start'}</p>
							{startedAt && <p className="mt-1 text-xs text-zinc-500">{fullDate(startedAt)}</p>}
						</div>
					</div>

					<p className="text-xs leading-5 text-zinc-500">{progress.note}</p>
				</div>

				<ol className="space-y-3">
					{progress.steps.map((step, index) => {
						const isActive = step.state === 'active';
						const isComplete = step.state === 'complete';
						const isLast = index === progress.steps.length - 1;
						const nodeColor = isActive || isComplete ? progress.accent : 'rgba(148,163,184,0.44)';

						return (
							<li
								key={step.key}
								className="relative rounded-2xl px-4 py-3"
								style={{
									background: isActive ? progress.accentSoft : isComplete ? 'rgba(139,92,246,0.08)' : 'rgba(124,58,237,0.05)',
									border: `1px solid ${isActive ? progress.accentBorder : isComplete ? 'rgba(139,92,246,0.18)' : 'rgba(124,58,237,0.1)'}`,
									animation: isActive ? 'activeCard 2.6s ease-in-out infinite' : undefined,
								}}
							>
								<div className="flex gap-3">
									<div className="relative flex shrink-0 flex-col items-center pt-0.5">
										<span
											className="relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
											style={{
												color: isActive || isComplete ? '#ffffff' : '#71717a',
												background: isActive || isComplete ? nodeColor : 'rgba(255,255,255,0.72)',
												border: `1px solid ${isActive || isComplete ? nodeColor : 'rgba(124,58,237,0.18)'}`,
												boxShadow: isActive ? `0 0 18px ${progress.accentSoft}` : undefined,
											}}
										>
											{isActive && <span className="absolute inset-0 rounded-full" style={{ background: progress.accent, animation: 'stepPulse 1.7s ease-in-out infinite' }} />}
											<span className="relative">{isComplete ? '✓' : index + 1}</span>
										</span>
										{!isLast && (
											<span className="relative mt-1 block h-10 w-px overflow-hidden rounded-full" style={{ background: isComplete ? 'rgba(139,92,246,0.22)' : 'rgba(124,58,237,0.18)' }}>
												{isActive && <span className="absolute inset-x-0 top-0 h-8 rounded-full" style={{ background: progress.accent, animation: 'shimmerTrail 1.35s linear infinite' }} />}
											</span>
										)}
									</div>

									<div className="min-w-0 pt-0.5">
										<div className="flex flex-wrap items-center gap-2">
											<p className="text-sm font-semibold text-zinc-900 dark:text-white">{step.title}</p>
											{isActive && (
												<span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: progress.accent, background: progress.accentSoft }}>
													Live
												</span>
											)}
											{isComplete && <span className="text-[11px] font-medium text-violet-600 dark:text-violet-300">Done</span>}
										</div>
										<p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{step.description}</p>
									</div>
								</div>
							</li>
						);
					})}
				</ol>
			</div>

			<div className="px-5 pb-5 text-xs text-zinc-500 md:px-7 md:pb-6">Results will appear automatically when the scan finishes.</div>
		</div>
	);
}

export function ScanStepTimeline({
	stepLogs,
	completedAt,
	status,
}: {
	stepLogs?: ScanStepLog[] | null;
	completedAt?: string | null;
	status?: string | null;
}) {
	const orderedLogs = [...(stepLogs ?? [])].sort((left, right) => left.position - right.position);
	if (orderedLogs.length === 0) {
		return null;
	}

	const finalTimestamp = completedAt ?? orderedLogs[orderedLogs.length - 1]?.completed_at ?? null;
	const firstStartedAt = orderedLogs[0]?.started_at ?? null;
	const totalDurationMs = firstStartedAt && finalTimestamp
		? Math.max(0, new Date(finalTimestamp).getTime() - new Date(firstStartedAt).getTime())
		: null;

	return (
		<div
			className="glass-panel overflow-hidden rounded-[28px] px-5 py-5 md:px-6 md:py-6"
			style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
		>
			<style>{`
				@keyframes timelineRise { 0% { opacity: 0; transform: translateY(12px); } 100% { opacity: 1; transform: translateY(0); } }
				@keyframes timelineGlow { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.9; } }
			`}</style>

			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Timeline</p>
					<h3 className="mt-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">Backend step history</h3>
					<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Each row is persisted by the backend, including timestamps and any step output that was produced.</p>
				</div>
				<div className="flex flex-wrap gap-2 text-xs">
					{status && (
						<span className="rounded-full px-3 py-1 font-semibold uppercase tracking-[0.18em]" style={{ color: '#8b5cf6', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.16)' }}>
							{status}
						</span>
					)}
					{totalDurationMs !== null && (
						<span className="rounded-full px-3 py-1 font-medium text-zinc-600 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
							Total duration {formatDuration(totalDurationMs)}
						</span>
					)}
				</div>
			</div>

			<ol className="mt-5 space-y-3">
				{orderedLogs.map((stepLog, index) => {
					const definition = describeStep(stepLog.step);
					const nextStep = orderedLogs[index + 1];
					const resolvedEnd = stepLog.completed_at ?? nextStep?.started_at ?? completedAt ?? null;
					const durationMs = resolvedEnd
						? Math.max(0, new Date(resolvedEnd).getTime() - new Date(stepLog.started_at).getTime())
						: null;
					const isTerminal = stepLog.step === 'completed' || stepLog.step === 'failed' || stepLog.step === 'cancelled';

					return (
						<li
							key={stepLog.id}
							className="rounded-2xl px-4 py-4"
							style={{
								background: 'var(--card-bg)',
								border: `1px solid ${isTerminal ? 'rgba(124,58,237,0.18)' : 'var(--glass-border)'}`,
								animation: `timelineRise 380ms ease forwards`,
								animationDelay: `${index * 70}ms`,
								opacity: 0,
							}}
						>
							<div className="flex gap-3">
								<div className="relative flex shrink-0 flex-col items-center pt-0.5">
									<span
										className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
										style={{ background: isTerminal ? '#7c3aed' : '#8b5cf6', boxShadow: isTerminal ? '0 0 10px rgba(124,58,237,0.14)' : 'none' }}
									>
										{index + 1}
									</span>
									{index < orderedLogs.length - 1 && (
										<span className="mt-1 block h-10 w-px rounded-full" style={{ background: 'rgba(124,58,237,0.12)' }} />
									)}
								</div>

								<div className="min-w-0 flex-1 space-y-3">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<div className="flex flex-wrap items-center gap-2">
												<p className="text-sm font-semibold text-zinc-900 dark:text-white">{definition.title}</p>
												{isTerminal && (
													<span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#8b5cf6', background: 'rgba(124,58,237,0.08)' }}>
														Final
													</span>
												)}
											</div>
											<p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{definition.description}</p>
										</div>

										<div className="flex flex-wrap gap-2 text-xs">
											{durationMs !== null && (
												<span className="rounded-full px-2.5 py-1 font-medium text-zinc-700 dark:text-zinc-200" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
													{formatDuration(durationMs)}
												</span>
											)}
											<span className="rounded-full px-2.5 py-1 font-medium text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
												{timeAgo(stepLog.started_at)}
											</span>
										</div>
									</div>

									<div className="grid gap-2 sm:grid-cols-2">
										<div className="rounded-xl px-3 py-2" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
											<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Started</p>
											<p className="mt-1 text-xs text-zinc-800 dark:text-zinc-200" title={fullDate(stepLog.started_at)}>{fullDate(stepLog.started_at)}</p>
										</div>
										{resolvedEnd && (
											<div className="rounded-xl px-3 py-2" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
												<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Finished</p>
												<p className="mt-1 text-xs text-zinc-800 dark:text-zinc-200" title={fullDate(resolvedEnd)}>{fullDate(resolvedEnd)}</p>
											</div>
										)}
									</div>

									{stepLog.output.length > 0 && (
										<div className="rounded-2xl px-3 py-3" style={{ background: 'linear-gradient(180deg, rgba(124,58,237,0.05) 0%, rgba(124,58,237,0.02) 100%)', border: '1px solid rgba(124,58,237,0.14)' }}>
											<div className="mb-2 flex items-center gap-2">
												<span className="h-2 w-2 rounded-full" style={{ background: '#a78bfa', animation: 'timelineGlow 1.7s ease-in-out infinite' }} />
												<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Outputs</p>
											</div>
											<ul className="space-y-1.5">
												{stepLog.output.map((line, outputIndex) => (
													<li key={`${stepLog.id}-output-${outputIndex}`} className="text-sm leading-5 text-zinc-800 dark:text-zinc-200">
														{line}
													</li>
												))}
											</ul>
										</div>
									)}
								</div>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
