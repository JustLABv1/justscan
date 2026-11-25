'use client';

import { ScanningAnimation, ScanStepTimeline } from '@/components/scans/scan-runtime';
import { ScanFailureAlert } from '@/components/scans/scan-failure-alert';
import { Alert, type DescriptionItem, Tabs } from '@/components/ui';
import { StatStrip, StatStripItem } from '@/components/ui/stat-strip';
import type { StatusDotTone } from '@/components/ui/status-dot';
import type { Scan, Vulnerability } from '@/lib/api';
import { pluralize } from '@/lib/labels';
import { type ReactNode, useState } from 'react';
import { FindingsView } from './findings-view';
import { ScanDetailsDisclosure, scanDetailItems } from './scan-details';
import type { FindingQueryState, FindingsState } from './use-public-findings';

export type SeverityTotals = { critical: number; high: number; medium: number; low: number };

export function severityTotals(
  scan: Pick<Scan, 'critical_count' | 'high_count' | 'medium_count' | 'low_count'>
): SeverityTotals {
  return {
    critical: scan.critical_count ?? 0,
    high: scan.high_count ?? 0,
    medium: scan.medium_count ?? 0,
    low: scan.low_count ?? 0,
  };
}

/** One plain-language sentence that sums up a scan's findings. */
export function scanVerdict(counts: SeverityTotals): { tone: StatusDotTone; text: string } {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  if (total === 0) {
    return { tone: 'success', text: 'No known vulnerabilities were found.' };
  }
  if (counts.critical > 0 || counts.high > 0) {
    const urgent = [
      counts.critical > 0 ? `${counts.critical.toLocaleString()} critical` : '',
      counts.high > 0 ? `${counts.high.toLocaleString()} high` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    return {
      tone: counts.critical > 0 ? 'danger' : 'warning',
      text: `${pluralize(total, 'vulnerability', 'vulnerabilities')} found. Fix the ${urgent} severity ${
        counts.critical + counts.high === 1 ? 'issue' : 'issues'
      } first.`,
    };
  }
  return {
    tone: 'accent',
    text: `${pluralize(total, 'vulnerability', 'vulnerabilities')} found, none of them critical or high.`,
  };
}

const VERDICT_TEXT: Record<StatusDotTone, string> = {
  danger: 'text-destructive',
  warning: 'text-warning-foreground',
  success: 'text-success-foreground',
  accent: 'text-foreground',
  neutral: 'text-foreground',
  muted: 'text-muted-foreground',
};

/** Verdict sentence followed by the four severity counts. */
export function SeveritySummary({
  counts,
  context,
  status,
}: {
  counts: SeverityTotals;
  /** Prefix for the verdict, e.g. "Across 6 images:". */
  context?: string;
  /** Small inline lifecycle status under the verdict. */
  status?: ReactNode;
}) {
  const verdict = scanVerdict(counts);
  return (
    <section aria-label="Summary" className="space-y-3">
      <div className="space-y-1">
        <p className={`text-base font-medium ${VERDICT_TEXT[verdict.tone]}`}>
          {context ? `${context} ` : ''}
          {context ? verdict.text.charAt(0).toLowerCase() + verdict.text.slice(1) : verdict.text}
        </p>
        {status ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">{status}</div>
        ) : null}
      </div>
      <StatStrip className="md:grid-cols-4 lg:grid-cols-4">
        <StatStripItem
          label="Critical"
          value={counts.critical.toLocaleString()}
          tone={counts.critical ? 'danger' : 'muted'}
        />
        <StatStripItem
          label="High"
          value={counts.high.toLocaleString()}
          tone={counts.high ? 'warning' : 'muted'}
        />
        <StatStripItem
          label="Medium"
          value={counts.medium.toLocaleString()}
          tone={counts.medium ? 'accent' : 'muted'}
        />
        <StatStripItem
          label="Low"
          value={counts.low.toLocaleString()}
          tone={counts.low ? 'neutral' : 'muted'}
        />
      </StatStrip>
    </section>
  );
}

export function isPolicyBlocked(scan?: Pick<Scan, 'external_status'> | null) {
  return scan?.external_status === 'blocked_by_xray_policy';
}

export function hasScanResults(scan?: Pick<Scan, 'status' | 'external_status'> | null) {
  return Boolean(scan && (scan.status === 'completed' || isPolicyBlocked(scan)));
}

/** Alert shown when a registry policy withheld part of the scan. */
export function PolicyWithheldAlert() {
  return (
    <Alert status="warning">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Some results were withheld by your registry’s security policy.</Alert.Title>
        <Alert.Description>
          The findings below are the ones the scanner could still report. The full list may be
          longer.
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

export type ResultTab = { id: string; label: string; content: ReactNode };

/**
 * The body of a public or shared image scan: progress while it runs, then a
 * verdict, severity counts, the findings list, the timeline, and a collapsed
 * "Scan details" panel.
 */
export function PublicScanResult({
  scan,
  queryState,
  findings,
  onOpenVulnerability,
  renderPolicy,
  enableCveSearch,
  enablePolicyFirst,
  extraTabs = [],
  failureActions,
  detailItems,
}: {
  scan: Scan | null;
  queryState: FindingQueryState;
  findings: FindingsState;
  onOpenVulnerability: (vulnerability: Vulnerability) => void;
  renderPolicy?: (vulnerability: Vulnerability) => ReactNode | null;
  enableCveSearch?: boolean;
  enablePolicyFirst?: boolean;
  extraTabs?: ResultTab[];
  failureActions?: ReactNode;
  detailItems?: DescriptionItem[];
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const isScanning = !scan || scan.status === 'pending' || scan.status === 'running';
  const blocked = isPolicyBlocked(scan);
  const showResults = hasScanResults(scan);
  const imageName = scan ? `${scan.image_name}:${scan.image_tag}` : '';

  if (isScanning) {
    return (
      <ScanningAnimation
        image={imageName || undefined}
        status={scan?.status ?? 'pending'}
        startedAt={scan?.started_at ?? null}
        scanProvider={scan?.scan_provider}
        xrayMode={scan?.xray_mode}
        currentStep={scan?.current_step ?? null}
        stepLogs={scan?.step_logs ?? null}
      />
    );
  }

  const counts = severityTotals(scan);
  const stepCount = scan.step_logs?.length ?? 0;
  const tabs: ResultTab[] = [
    {
      id: 'overview',
      label: showResults ? 'Vulnerabilities' : 'Status',
      content: showResults ? (
        <FindingsView
          label="Vulnerabilities"
          counts={counts}
          queryState={queryState}
          findings={findings}
          onOpen={onOpenVulnerability}
          renderPolicy={renderPolicy}
          enableCveSearch={enableCveSearch}
          enablePolicyFirst={enablePolicyFirst}
        />
      ) : null,
    },
    {
      id: 'timeline',
      label: stepCount ? `Timeline (${stepCount})` : 'Timeline',
      content: (
        <ScanStepTimeline
          stepLogs={scan.step_logs}
          completedAt={scan.completed_at}
          status={scan.status}
          externalStatus={scan.external_status}
          scanProvider={scan.scan_provider}
          xrayMode={scan.xray_mode}
          xrayProviderScannedAt={scan.xray_provider_scanned_at}
        />
      ),
    },
    ...extraTabs,
  ];
  const current = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="space-y-6">
      {scan.status === 'failed' && !blocked ? (
        <div className="space-y-3">
          <ScanFailureAlert errorMessage={scan.error_message} imageReference={imageName} />
          {failureActions}
        </div>
      ) : null}
      {blocked ? <PolicyWithheldAlert /> : null}
      {showResults ? <SeveritySummary counts={counts} /> : null}

      <Tabs selectedKey={current.id} onSelectionChange={(key) => setActiveTab(String(key))}>
        <Tabs.ListContainer className="-mx-1 overflow-x-auto px-1">
          <Tabs.List aria-label="Result views" className="min-w-max">
            {tabs.map((tab) => (
              <Tabs.Tab id={tab.id} key={tab.id}>
                {tab.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.id} id={tab.id} className="pt-2 outline-none">
            {tab.content}
          </Tabs.Panel>
        ))}
      </Tabs>

      <ScanDetailsDisclosure items={detailItems ?? scanDetailItems(scan)} />
    </div>
  );
}
