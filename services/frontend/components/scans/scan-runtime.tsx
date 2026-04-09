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
	trivy: 'Local Trivy worker',
	artifactory_xray: 'Artifactory Xray',
};

const TIMELINE_STATUS_TONES: Record<string, StatusTone> = {
	completed: { color: '#34d399', background: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.22)', label: 'completed' },
	failed: { color: '#f87171', background: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.22)', label: 'failed' },
	cancelled: { color: '#f59e0b', background: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.20)', label: 'cancelled' },
	blocked_by_xray_policy: { color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.22)', label: 'blocked by xray policy' },
	pending: { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.15)', label: 'queued' },
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

function orderStepLogs(stepLogs?: ScanStepLog[] | null): ScanStepLog[] {
	return [...(stepLogs ?? [])].sort((left, right) => left.position - right.position);
}

function resolveStepLogEnd(stepLog: ScanStepLog, nextStep?: ScanStepLog, completedAt?: string | null): string | null {
	return stepLog.completed_at ?? nextStep?.started_at ?? completedAt ?? null;
}

function latestStepOutput(stepLog?: ScanStepLog | null): string | null {
	if (!stepLog || stepLog.output.length === 0) {
		return null;
	}
	return stepLog.output[stepLog.output.length - 1] ?? null;
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

function providerSummary(scanProvider?: string | null): string {
	if (scanProvider === 'artifactory_xray') {
		return 'JustScan is following the external Artifactory/Xray pipeline and will import findings as soon as the provider publishes the artifact summary.';
	}
	return 'JustScan is executing the local Trivy worker flow and will publish the report after normalization, enrichment, and persistence finish.';
}

type ProviderHeroModel = {
	title: string;
	summary: string;
	panelBackground: string;
	panelBorder: string;
	primary: string;
	secondary: string;
	grid: string;
	glow: string;
	cardBackground: string;
};

function runtimeProviderHero(scanProvider?: string | null): ProviderHeroModel {
	if (scanProvider === 'artifactory_xray') {
		return {
			title: 'Artifact streaming through Xray',
			summary: 'Artifactory is warming, indexing, and handing the artifact off until Xray publishes a summary that JustScan can import.',
			panelBackground: 'linear-gradient(160deg, rgba(249,115,22,0.14) 0%, rgba(249,115,22,0.05) 30%, transparent 100%), var(--card-bg)',
			panelBorder: 'rgba(249,115,22,0.18)',
			primary: 'rgba(249,115,22,0.94)',
			secondary: 'rgba(251,146,60,0.82)',
			grid: 'rgba(249,115,22,0.09)',
			glow: 'rgba(249,115,22,0.16)',
			cardBackground: 'linear-gradient(135deg, rgba(249,115,22,0.07) 0%, rgba(249,115,22,0.025) 42%, transparent 100%), var(--glass-bg)',
		};
	}

	return {
		title: 'Trivy sweeping the image',
		summary: 'The local worker is traversing packages, correlating findings, and assembling the report before the result is finalized.',
		panelBackground: 'linear-gradient(160deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 28%, transparent 100%), var(--card-bg)',
		panelBorder: 'rgba(16,185,129,0.22)',
		primary: 'rgba(16,185,129,0.92)',
		secondary: 'rgba(45,212,191,0.72)',
		grid: 'rgba(16,185,129,0.14)',
		glow: 'rgba(16,185,129,0.16)',
		cardBackground: 'linear-gradient(135deg, rgba(16,185,129,0.07) 0%, rgba(16,185,129,0.025) 46%, transparent 100%), var(--glass-bg)',
	};
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

function isBlockedXrayPolicy(externalStatus?: string | null, scanProvider?: string | null): boolean {
	return scanProvider === 'artifactory_xray' && externalStatus === 'blocked_by_xray_policy';
}

function hasRecoveredBlockedSummary(stepLogs?: ScanStepLog[] | null): boolean {
	return (stepLogs ?? []).some((stepLog) =>
		stepLog.output.some((line) => {
			const normalized = line.toLowerCase();
			return normalized.includes('blocked-artifact summary') || normalized.includes('stored ') || normalized.includes('xray returned no vulnerabilities');
		}),
	);
}

function effectiveTimelineStatus(status?: string | null, externalStatus?: string | null): string | null {
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
		bubble: '#8b5cf6',
		glow: 'none',
		border: 'rgba(124,58,237,0.18)',
		badgeColor: '#8b5cf6',
		badgeBackground: 'rgba(124,58,237,0.08)',
	};
}

function buildRuntimeWarning(
	activeKey: ProgressStepKey,
	activeStepElapsedSeconds: number | null,
	latestOutput: string | null,
	scanProvider?: string | null,
): RuntimeWarning | null {
	const normalizedOutput = (latestOutput ?? '').toLowerCase();

	if (normalizedOutput.includes('retry')) {
		return {
			title: 'Transient retry in progress',
			detail: latestOutput ?? 'The backend is retrying the active step after a transient provider error.',
		};
	}

	if (normalizedOutput.includes('timed out')) {
		return {
			title: 'Provider wait threshold reached',
			detail: latestOutput ?? 'The active step hit a timeout condition and may need operator attention.',
		};
	}

	if (activeStepElapsedSeconds === null) {
		return null;
	}

	if ((activeKey === 'queued' || activeKey === 'queued_in_xray') && activeStepElapsedSeconds >= 90) {
		return {
			title: 'Still waiting for execution capacity',
			detail: scanProvider === 'artifactory_xray'
				? 'The request is accepted, but the provider has not started the next execution phase yet.'
				: 'The request is accepted, but a local scanner worker has not started the next execution phase yet.',
		};
	}

	if (activeKey === 'warming_cache' && activeStepElapsedSeconds >= 150) {
		return {
			title: 'Artifactory warm-up is slower than usual',
			detail: 'The image is still being pulled through Artifactory so Xray can access and index it.',
		};
	}

	if (activeKey === 'waiting_for_xray' && activeStepElapsedSeconds >= 240) {
		return {
			title: 'Still waiting on Xray',
			detail: 'Xray has not published the final artifact summary yet. JustScan will import findings automatically when it does.',
		};
	}

	if (activeKey === 'scanning_image' && activeStepElapsedSeconds >= 300) {
		return {
			title: 'Image analysis is taking longer than usual',
			detail: 'The local scanner is still working through the image contents. This can happen on larger images or slower registries.',
		};
	}

	if ((activeKey === 'processing_results' || activeKey === 'importing_results') && activeStepElapsedSeconds >= 150) {
		return {
			title: 'Results processing is still active',
			detail: 'The backend is still normalizing or importing findings before the report can be published.',
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
	stepLogs,
}: {
	status: string;
	startedAt: string | null;
	image?: string;
	scanProvider?: string | null;
	currentStep?: string | null;
	stepLogs?: ScanStepLog[] | null;
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
	const orderedLogs = orderStepLogs(stepLogs);
	const activeStepLog = [...orderedLogs].reverse().find((stepLog) => stepLog.step === progress.activeKey) ?? orderedLogs[orderedLogs.length - 1] ?? null;
	const activeStepStart = activeStepLog?.started_at ? new Date(activeStepLog.started_at).getTime() : null;
	const activeStepElapsed = activeStepStart ? Math.max(0, Math.floor((now - activeStepStart) / 1000)) : null;
	const latestOutput = latestStepOutput(activeStepLog);
	const runtimeWarning = buildRuntimeWarning(progress.activeKey, activeStepElapsed, latestOutput, scanProvider);
	const providerName = providerLabel(scanProvider, orderedLogs);
	const providerDetail = providerSummary(scanProvider);
	const providerHero = runtimeProviderHero(scanProvider);
	const compactImage = compactImageLabel(image);
	const isXrayProvider = scanProvider === 'artifactory_xray';

	return (
		<div className="scan-runtime-animated glass-panel relative isolate overflow-hidden rounded-[28px]" style={{ background: providerHero.cardBackground }}>
			<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
				<div
					className="absolute -left-20 top-6 h-44 w-44 rounded-full blur-3xl"
					style={{
						background: `radial-gradient(circle, ${providerHero.primary} 0%, ${providerHero.glow} 46%, transparent 76%)`,
						animation: 'ambientFloat 14s ease-in-out infinite',
					}}
				/>
				<div
					className="absolute right-[-72px] top-20 h-52 w-52 rounded-full blur-3xl"
					style={{
						background: `radial-gradient(circle, ${providerHero.secondary} 0%, ${providerHero.glow} 42%, transparent 74%)`,
						animation: 'ambientDrift 17s ease-in-out infinite',
					}}
				/>
				<div
					className="absolute bottom-[-84px] left-[24%] h-56 w-56 rounded-full blur-3xl"
					style={{
						background: `radial-gradient(circle, ${providerHero.secondary} 0%, rgba(255,255,255,0.04) 46%, transparent 74%)`,
						animation: 'ambientFloat 19s ease-in-out infinite reverse',
					}}
				/>
				<div
					className="absolute inset-x-10 top-16 h-36"
					style={{
						background: `linear-gradient(90deg, transparent 0%, ${providerHero.glow} 18%, rgba(255,255,255,0.18) 50%, ${providerHero.glow} 82%, transparent 100%)`,
						opacity: 0.5,
						filter: 'blur(24px)',
						animation: 'scanSweep 8.2s ease-in-out infinite',
					}}
				/>
			</div>
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
				@keyframes ambientFloat { 0%, 100% { transform: translate3d(0, 0, 0) scale(1); } 33% { transform: translate3d(18px, -12px, 0) scale(1.06); } 66% { transform: translate3d(-10px, 16px, 0) scale(0.96); } }
				@keyframes ambientDrift { 0%, 100% { transform: translate3d(0, 0, 0) scale(1); } 30% { transform: translate3d(-14px, 10px, 0) scale(1.04); } 70% { transform: translate3d(12px, -18px, 0) scale(0.98); } }
				@keyframes gridPan { 0% { transform: translate3d(0, 0, 0); } 100% { transform: translate3d(22px, 22px, 0); } }
				@keyframes scanSweep { 0% { transform: translateX(-28%) scaleX(0.92); opacity: 0; } 14% { opacity: 0.85; } 50% { opacity: 1; } 86% { opacity: 0.7; } 100% { transform: translateX(28%) scaleX(1.08); opacity: 0; } }
				@keyframes stepPulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.18); opacity: 0.24; } }
				@keyframes activeCard { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
				@keyframes activeOutline { 0%, 100% { opacity: 0.32; box-shadow: 0 0 0 0 rgba(167,139,250,0.14); } 50% { opacity: 0.74; box-shadow: 0 0 0 6px rgba(167,139,250,0.04); } }
				@keyframes cardSheen { 0% { transform: translateX(-130%) skewX(-18deg); opacity: 0; } 18% { opacity: 0.28; } 54% { opacity: 0.22; } 100% { transform: translateX(150%) skewX(-18deg); opacity: 0; } }
				@keyframes detailFade { 0% { opacity: 0; transform: translateY(8px); } 14% { opacity: 1; transform: translateY(0); } 86% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-8px); } }
				@keyframes shimmerTrail { 0% { transform: translateY(-100%); opacity: 0; } 18% { opacity: 1; } 100% { transform: translateY(120%); opacity: 0; } }
				@keyframes horizontalTrail { 0% { transform: translateX(-100%); opacity: 0; } 14% { opacity: 1; } 100% { transform: translateX(120%); opacity: 0; } }
				@keyframes statusFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
				@keyframes heroFloat { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
				@keyframes xrayPacket { 0% { transform: translateX(-18px) scale(0.92); opacity: 0; } 12% { opacity: 1; } 82% { opacity: 1; } 100% { transform: translateX(240px) scale(1.04); opacity: 0; } }
				@keyframes xrayPacketAlt { 0% { transform: translateX(-24px) scale(0.86); opacity: 0; } 18% { opacity: 0.9; } 84% { opacity: 0.9; } 100% { transform: translateX(240px) scale(1.02); opacity: 0; } }
				@keyframes xrayNodePulse { 0%, 100% { transform: scale(1); opacity: 0.46; } 50% { transform: scale(1.12); opacity: 1; } }
				@keyframes xrayFramePulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.08); opacity: 0.72; } 50% { box-shadow: 0 0 0 10px rgba(249,115,22,0.02); opacity: 1; } }
				@keyframes radarSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
				@keyframes radarPulse { 0% { transform: scale(0.45); opacity: 0.82; } 100% { transform: scale(1.2); opacity: 0; } }
				@media (prefers-reduced-motion: reduce) {
					.scan-runtime-animated,
					.scan-runtime-animated * {
						animation-duration: 0.01ms !important;
						animation-iteration-count: 1 !important;
						transition-duration: 0.01ms !important;
					}
				}
			`}</style>

			<div className="relative z-10 space-y-6 px-5 py-5 md:px-7 md:py-6">
				<div className="space-y-5">
					<div
						className="relative overflow-hidden rounded-[30px] border px-5 py-5 md:px-6 md:py-6"
						style={{
							background: providerHero.panelBackground,
							border: `1px solid ${providerHero.panelBorder}`,
							boxShadow: `0 24px 60px -42px ${providerHero.glow}`,
						}}
					>
						<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
							<div className="absolute inset-0 opacity-70" style={{ backgroundImage: `linear-gradient(${providerHero.grid} 1px, transparent 1px), linear-gradient(90deg, ${providerHero.grid} 1px, transparent 1px)`, backgroundSize: '20px 20px', animation: 'gridPan 26s linear infinite' }} />
							<div className="absolute inset-0" style={{ background: `radial-gradient(circle at 18% 24%, ${providerHero.glow} 0%, transparent 40%), radial-gradient(circle at 78% 62%, ${providerHero.glow} 0%, transparent 38%)` }} />
							<div className="absolute inset-x-0 top-1/2 h-28 -translate-y-1/2" style={{ background: `linear-gradient(90deg, transparent 0%, ${providerHero.glow} 18%, rgba(255,255,255,0.4) 50%, ${providerHero.glow} 82%, transparent 100%)`, filter: 'blur(20px)', animation: 'scanSweep 6.6s ease-in-out infinite' }} />
						</div>

						<div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-center">
							<div className="space-y-4">
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
								<span className="rounded-full px-3 py-1 text-[11px] font-medium" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}>
									{providerName}
								</span>
								{(startedAt || elapsed > 0) && <span className="rounded-full border px-3 py-1 font-mono text-xs" style={{ borderColor: 'var(--glass-border)', background: 'var(--card-bg)', color: 'var(--text-muted)' }}>{formatElapsed(elapsed)}</span>}
								{activeStepElapsed !== null && <span className="rounded-full border px-3 py-1 font-mono text-xs" style={{ borderColor: 'var(--glass-border)', background: 'var(--card-bg)', color: 'var(--text-muted)' }}>step {formatElapsed(activeStepElapsed)}</span>}
							</div>

							<div className="space-y-3">
								<p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>{progress.eyebrow}</p>
								<h2 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{progress.title}</h2>
								<p className="max-w-2xl text-sm leading-6" key={`${progress.activeKey}-${detailTick}`} style={{ animation: 'detailFade 2.6s ease-in-out forwards', minHeight: 48, color: 'var(--text-secondary)' }}>
									{detailMessage}
								</p>
									<p className="max-w-2xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{providerHero.summary}</p>
							</div>

							<div className="flex flex-wrap gap-2 text-xs">
								{compactImage && (
									<span className="rounded-full border px-3 py-1 font-mono" style={{ borderColor: 'var(--glass-border)', background: 'var(--card-bg)', color: 'var(--text-secondary)' }} title={image}>
										{compactImage}
									</span>
								)}
								<span className="rounded-full border px-3 py-1" style={{ borderColor: 'var(--glass-border)', background: 'var(--card-bg)', color: 'var(--text-secondary)' }}>
									{progress.note}
								</span>
							</div>
						</div>

							<div className="relative h-[230px]">
								<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
								{isXrayProvider ? (
									<>
										<div className="absolute left-7 top-[50px] h-[126px] w-[58px] rounded-[20px] border" style={{ borderColor: providerHero.panelBorder, background: 'rgba(255,255,255,0.06)' }} />
										<div className="absolute left-[42px] top-[70px] h-[86px] w-[28px] rounded-[14px]" style={{ background: `linear-gradient(180deg, ${providerHero.glow}, rgba(255,255,255,0.03))` }} />
										<div className="absolute right-7 top-[50px] h-[126px] w-[76px] rounded-[22px] border" style={{ borderColor: providerHero.panelBorder, background: 'rgba(255,255,255,0.05)', animation: 'xrayFramePulse 2.8s ease-in-out infinite' }} />
										{[0, 1, 2].map((lane) => (
											<div key={lane} className="absolute left-[52px] right-[66px]" style={{ top: `${82 + lane * 32}px` }}>
												<div className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full" style={{ background: providerHero.primary, boxShadow: `0 0 14px ${providerHero.glow}` }} />
												<div className="absolute left-[16px] right-[24px] top-1/2 h-px -translate-y-1/2" style={{ background: `linear-gradient(90deg, ${providerHero.primary}, ${providerHero.secondary}, rgba(255,255,255,0.18))` }} />
												<div className="absolute left-[24px] top-1/2 h-2.5 w-10 -translate-y-1/2 rounded-full blur-[1px]" style={{ background: `linear-gradient(90deg, transparent, ${providerHero.secondary}, rgba(255,255,255,0.55), transparent)`, animation: `${lane % 2 === 0 ? 'xrayPacket' : 'xrayPacketAlt'} ${2.4 + lane * 0.3}s linear infinite`, animationDelay: `${lane * 0.22}s` }} />
												<div className="absolute right-[8px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full" style={{ background: providerHero.secondary, animation: `xrayNodePulse ${1.6 + lane * 0.14}s ease-in-out infinite` }} />
											</div>
										))}
										<div className="absolute right-[43px] top-[76px] h-3 w-34 rounded-full" style={{ width: 44, background: `linear-gradient(90deg, ${providerHero.secondary}, ${providerHero.primary})`, opacity: 0.9 }} />
										<div className="absolute right-[43px] top-[108px] h-3 rounded-full" style={{ width: 30, background: `linear-gradient(90deg, ${providerHero.secondary}, ${providerHero.primary})`, opacity: 0.7 }} />
										<div className="absolute right-[43px] top-[140px] h-3 rounded-full" style={{ width: 20, background: `linear-gradient(90deg, ${providerHero.secondary}, ${providerHero.primary})`, opacity: 0.52 }} />
									</>
								) : (
									<div className="absolute inset-0 flex items-center justify-center">
										<div className="relative h-40 w-40" style={{ animation: 'heroFloat 3.4s ease-in-out infinite' }}>
											<div className="absolute inset-0 rounded-full border" style={{ borderColor: providerHero.panelBorder }} />
											<div className="absolute inset-[14px] rounded-full border" style={{ borderColor: providerHero.panelBorder }} />
											<div className="absolute inset-[28px] rounded-full border" style={{ borderColor: providerHero.panelBorder }} />
											<div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(from 90deg, transparent 0deg, transparent 294deg, ${providerHero.secondary} 326deg, rgba(255,255,255,0.78) 340deg, transparent 360deg)`, animation: 'radarSpin 5.8s linear infinite' }} />
											<div className="absolute inset-[34px] rounded-full" style={{ background: `radial-gradient(circle, rgba(255,255,255,0.95) 0%, ${providerHero.secondary} 36%, ${providerHero.primary} 100%)` }} />
											<div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: providerHero.panelBorder, animation: 'radarPulse 2.2s linear infinite' }} />
											<div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: providerHero.panelBorder, animation: 'radarPulse 2.2s linear infinite 1.1s' }} />
										</div>
									</div>
								)}
							</div>
						</div>
						</div>
					</div>

					<ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
						{progress.steps.map((step, index) => {
							const isActive = step.state === 'active';
							const isComplete = step.state === 'complete';
							const isLast = index === progress.steps.length - 1;
							const nodeColor = isActive || isComplete ? progress.accent : 'rgba(148,163,184,0.44)';

							return (
								<li
									key={step.key}
									className="relative rounded-2xl px-4 py-3 xl:min-h-[122px]"
									style={{
										background: isActive ? progress.accentSoft : isComplete ? 'rgba(139,92,246,0.08)' : 'rgba(124,58,237,0.05)',
										border: `1px solid ${isActive ? progress.accentBorder : isComplete ? 'rgba(139,92,246,0.18)' : 'rgba(124,58,237,0.1)'}`,
										animation: isActive ? 'activeCard 2.6s ease-in-out infinite' : undefined,
									}}
								>
									{isActive && (
										<>
											<span
												className="pointer-events-none absolute inset-0 rounded-2xl"
												style={{
													border: `1px solid ${progress.accentBorder}`,
													boxShadow: `0 0 0 1px ${progress.accentSoft}, 0 18px 40px -28px ${progress.accent}`,
													animation: 'activeOutline 2.4s ease-in-out infinite',
												}}
											/>
											<span className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
												<span
													className="absolute inset-y-0 left-[-28%] w-1/2"
													style={{
														background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 20%, rgba(255,255,255,0.34) 50%, rgba(255,255,255,0.04) 80%, transparent 100%)`,
														animation: 'cardSheen 2.9s linear infinite',
													}}
												/>
											</span>
										</>
									)}
									<div className="flex gap-3 xl:flex-col xl:items-start xl:gap-3">
										<div className="relative flex shrink-0 flex-col items-center pt-0.5 xl:w-full xl:flex-row xl:items-center xl:pt-0">
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
												<span
													className="relative mt-1 block h-10 w-px overflow-hidden rounded-full xl:mt-0 xl:ml-3 xl:h-px xl:w-auto xl:flex-1"
													style={{ background: isComplete ? 'rgba(139,92,246,0.22)' : 'rgba(124,58,237,0.18)' }}
												>
													{isActive && (
														<>
															<span
																className="absolute inset-x-0 top-0 h-8 rounded-full xl:hidden"
																style={{ background: progress.accent, animation: 'shimmerTrail 1.35s linear infinite' }}
															/>
															<span
																className="absolute inset-y-0 left-0 hidden w-12 rounded-full xl:block"
																style={{ background: progress.accent, animation: 'horizontalTrail 1.45s linear infinite' }}
															/>
														</>
													)}
												</span>
											)}
										</div>

										<div className="min-w-0 pt-0.5 xl:pt-0">
											<div className="flex flex-wrap items-center gap-2">
												<p className="text-sm font-semibold text-zinc-900 dark:text-white">{step.title}</p>
												{isActive && (
													<span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: progress.accent, background: progress.accentSoft }}>
														Live
													</span>
												)}
												{isComplete && <span className="text-[11px] font-medium text-violet-600 dark:text-violet-300">Done</span>}
											</div>
											{isActive ? (
												<p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{step.description}</p>
											) : (
												<p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{isComplete ? 'Completed' : 'Pending'}</p>
											)}
										</div>
									</div>
								</li>
							);
						})}
					</ol>

					<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
						<div className="rounded-2xl px-4 py-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Live backend signal</p>
								<span className="text-[11px] text-zinc-500">
									{activeStepLog?.output.length ? `${activeStepLog.output.length} update${activeStepLog.output.length === 1 ? '' : 's'} in this step` : 'Awaiting next update'}
								</span>
							</div>
							<p className="mt-2 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
								{latestOutput ?? 'The backend has not emitted a step message for this stage yet.'}
							</p>
							{activeStepLog?.started_at && (
								<p className="mt-2 text-xs text-zinc-500">
									Step started {timeAgo(activeStepLog.started_at)}
									{activeStepElapsed !== null ? ` · active for ${formatElapsed(activeStepElapsed)}` : ''}
								</p>
							)}
						</div>

						<div className="space-y-3">
							{runtimeWarning && (
								<div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.22)' }}>
									<p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#f59e0b' }}>Attention</p>
									<p className="mt-1 text-sm font-medium text-zinc-900 dark:text-white">{runtimeWarning.title}</p>
									<p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{runtimeWarning.detail}</p>
								</div>
							)}
							<div className="rounded-2xl px-4 py-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
								<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Live context</p>
								<div className="mt-2 space-y-2 text-sm leading-5 text-zinc-700 dark:text-zinc-300">
									<p><span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Path</span>{providerName}</p>
									<p><span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Started</span>{startedAt ? `${timeAgo(startedAt)} · ${fullDate(startedAt)}` : 'Waiting to start'}</p>
									{compactImage && <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400" title={image}>{compactImage}</p>}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="relative z-10 px-5 pb-5 text-xs text-zinc-500 md:px-7 md:pb-6">Results will appear automatically when the scan finishes.</div>
		</div>
	);
}

export function ScanStepTimeline({
	stepLogs,
	completedAt,
	status,
	externalStatus,
	scanProvider,
}: {
	stepLogs?: ScanStepLog[] | null;
	completedAt?: string | null;
	status?: string | null;
	externalStatus?: string | null;
	scanProvider?: string | null;
}) {
	const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
	const orderedLogs = orderStepLogs(stepLogs);
	if (orderedLogs.length === 0) {
		return null;
	}

	const finalTimestamp = completedAt ?? orderedLogs[orderedLogs.length - 1]?.completed_at ?? null;
	const firstStartedAt = orderedLogs[0]?.started_at ?? null;
	const totalDurationMs = firstStartedAt && finalTimestamp
		? Math.max(0, new Date(finalTimestamp).getTime() - new Date(firstStartedAt).getTime())
		: null;
	const providerName = providerLabel(scanProvider, orderedLogs);
	const totalOutputs = orderedLogs.reduce((count, stepLog) => count + stepLog.output.length, 0);
	const blockedByPolicy = isBlockedXrayPolicy(externalStatus, scanProvider);
	const recoveredBlockedSummary = blockedByPolicy && hasRecoveredBlockedSummary(orderedLogs);
	const effectiveStatus = effectiveTimelineStatus(status, externalStatus);
	const statusTone = timelineStatusTone(effectiveStatus);
	let slowestStep: { title: string; durationMs: number } | null = null;

	for (let index = 0; index < orderedLogs.length; index += 1) {
		const stepLog = orderedLogs[index];
		const resolvedEnd = resolveStepLogEnd(stepLog, orderedLogs[index + 1], completedAt);
		if (!resolvedEnd) {
			continue;
		}
		const durationMs = Math.max(0, new Date(resolvedEnd).getTime() - new Date(stepLog.started_at).getTime());
		if (!slowestStep || durationMs > slowestStep.durationMs) {
			slowestStep = { title: describeStep(stepLog.step).title, durationMs };
		}
	}

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
					<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
						{blockedByPolicy && recoveredBlockedSummary
							? 'Xray blocked the normal scan path, but JustScan still recovered artifact summary data and imported whatever findings the provider exposed.'
							: 'Each row is persisted by the backend, including timestamps and any step output that was produced.'}
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-xs">
					{effectiveStatus && (
						<span className="rounded-full px-3 py-1 font-semibold uppercase tracking-[0.18em]" style={{ color: statusTone.color, background: statusTone.background, border: `1px solid ${statusTone.border}` }}>
							{statusTone.label}
						</span>
					)}
					{totalDurationMs !== null && (
						<span className="rounded-full px-3 py-1 font-medium text-zinc-600 dark:text-zinc-300" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
							Total duration {formatDuration(totalDurationMs)}
						</span>
					)}
				</div>
			</div>

			<div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<div className="rounded-2xl px-4 py-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
					<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Total duration</p>
					<p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{totalDurationMs !== null ? formatDuration(totalDurationMs) : '—'}</p>
					<p className="mt-1 text-xs text-zinc-500">Across {orderedLogs.length} recorded steps</p>
				</div>
				<div className="rounded-2xl px-4 py-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
					<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Slowest step</p>
					<p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{slowestStep?.title ?? '—'}</p>
					<p className="mt-1 text-xs text-zinc-500">{slowestStep ? formatDuration(slowestStep.durationMs) : 'No completed duration yet'}</p>
				</div>
				<div className="rounded-2xl px-4 py-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
					<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Provider</p>
					<p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{providerName}</p>
					<p className="mt-1 text-xs text-zinc-500">{totalOutputs} backend update{totalOutputs === 1 ? '' : 's'} captured</p>
				</div>
				<div className="rounded-2xl px-4 py-3" style={{ background: 'var(--card-bg)', border: '1px solid var(--glass-border)' }}>
					<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Finished</p>
					<p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-white">{finalTimestamp ? timeAgo(finalTimestamp) : '—'}</p>
					<p className="mt-1 text-xs text-zinc-500">{finalTimestamp ? fullDate(finalTimestamp) : 'No completion time recorded'}</p>
				</div>
			</div>

			<ol className="mt-5 space-y-3">
				{orderedLogs.map((stepLog, index) => {
					const definition = describeStep(stepLog.step);
					const nextStep = orderedLogs[index + 1];
					const resolvedEnd = resolveStepLogEnd(stepLog, nextStep, completedAt);
					const durationMs = resolvedEnd
						? Math.max(0, new Date(resolvedEnd).getTime() - new Date(stepLog.started_at).getTime())
						: null;
					const isTerminal = stepLog.step === 'completed' || stepLog.step === 'failed' || stepLog.step === 'cancelled';
					const blockedTerminalRow = blockedByPolicy && stepLog.step === 'failed';
					const defaultExpanded = !resolvedEnd && index === orderedLogs.length - 1;
					const expanded = expandedRows[stepLog.id] ?? defaultExpanded;
					const outputPreview = latestStepOutput(stepLog);
					const rowTone = terminalRowTone(stepLog.step, blockedTerminalRow);
					const displayTitle = blockedTerminalRow ? 'Blocked by Xray policy' : definition.title;
					const displayDescription = blockedTerminalRow
						? recoveredBlockedSummary
							? 'Xray blocked the artifact before normal completion, but JustScan recovered the available artifact summary, policy details, and any importable findings.'
							: 'Xray blocked the artifact before the normal scan summary completed.'
						: definition.description;

					return (
						<li
							key={stepLog.id}
							className="rounded-2xl px-4 py-4"
							style={{
								background: 'var(--card-bg)',
								border: `1px solid ${isTerminal ? rowTone.border : 'var(--glass-border)'}`,
								animation: `timelineRise 380ms ease forwards`,
								animationDelay: `${index * 70}ms`,
								opacity: 0,
							}}
						>
							<div className="flex gap-3">
								<div className="relative flex shrink-0 flex-col items-center pt-0.5">
									<span
										className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
										style={{ background: isTerminal ? rowTone.bubble : '#8b5cf6', boxShadow: isTerminal ? rowTone.glow : 'none' }}
									>
										{index + 1}
									</span>
									{index < orderedLogs.length - 1 && (
										<span className="mt-1 block h-10 w-px rounded-full" style={{ background: 'rgba(124,58,237,0.12)' }} />
									)}
								</div>

									<div className="min-w-0 flex-1 space-y-3">
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
													<p className="text-sm font-semibold text-zinc-900 dark:text-white">{displayTitle}</p>
												{isTerminal && (
														<span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: rowTone.badgeColor, background: rowTone.badgeBackground }}>
															{blockedTerminalRow ? 'Blocked' : 'Final'}
													</span>
												)}
													{!resolvedEnd && (
														<span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.10)' }}>
															Active
														</span>
													)}
													{stepLog.output.length > 0 && (
														<span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-secondary)', background: 'var(--row-hover)' }}>
															{stepLog.output.length} update{stepLog.output.length === 1 ? '' : 's'}
														</span>
													)}
											</div>
												<p className="mt-1 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{displayDescription}</p>
												<p className="mt-2 text-sm leading-5 text-zinc-700 dark:text-zinc-300">
													{outputPreview ?? 'No backend output was recorded for this step.'}
												</p>
										</div>

											<div className="flex shrink-0 flex-col items-end gap-2 text-xs">
												<div className="flex flex-wrap justify-end gap-2">
											{durationMs !== null && (
												<span className="rounded-full px-2.5 py-1 font-medium text-zinc-700 dark:text-zinc-200" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
													{formatDuration(durationMs)}
												</span>
											)}
											<span className="rounded-full px-2.5 py-1 font-medium text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
												{timeAgo(stepLog.started_at)}
											</span>
												</div>
												<button
													type="button"
													onClick={() => setExpandedRows((previous) => ({
														...previous,
														[stepLog.id]: !(previous[stepLog.id] ?? defaultExpanded),
													}))}
													className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors"
													style={{ color: '#8b5cf6', background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.16)' }}
												>
													{expanded ? 'Hide details' : 'Show details'}
												</button>
										</div>
									</div>

										{expanded && (
											<>
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
											</>
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
