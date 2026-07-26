'use client';
import { PublicNavbar } from '@/components/public/public-navbar';
import { ScanDetailHeader } from '@/components/scans/scan-detail-header';
import { ScanFailureAlert } from '@/components/scans/scan-failure-alert';
import { SBOMWorkspace } from '@/components/scans/sbom-workspace';
import { VulnerabilitiesTable } from '@/components/scans/vulnerabilities-table';
import { FormField } from '@/components/ui/form-field';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type { Scan, Vulnerability } from '@/lib/api';
import {
  ApiError,
  getSharedScan,
  getSharedSBOM,
  getSharedSBOMComponent,
  getSharedSBOMGraph,
  getSharedVulnerabilityContextAnalysis,
  getToken,
  listScans,
  listSharedVulnerabilities,
  rescanShared,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { Button, Card, ListBox, Select, useOverlayState } from '@heroui/react';
import { CpuIcon, FileExportIcon, GitCompareIcon, Refresh01Icon } from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ScanningAnimation, ScanStepTimeline } from '../../../components/scans/scan-runtime';

const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: {
    label: 'Critical',
    color: 'text-red-500 dark:text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  HIGH: {
    label: 'High',
    color: 'text-orange-500 dark:text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
  MEDIUM: {
    label: 'Medium',
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
  },
  LOW: {
    label: 'Low',
    color: 'text-blue-500 dark:text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  UNKNOWN: {
    label: 'Unknown',
    color: 'text-zinc-500',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/20',
  },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEV_CONFIG[severity] ?? SEV_CONFIG.UNKNOWN;
  return (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}
    >
      {cfg.label}
    </span>
  );
}

function SourceBadge({ source }: { source?: string }) {
  const normalized = (source ?? '').trim().toLowerCase();
  const isOSV = normalized === 'osv.dev';
  const isXray = normalized === 'jfrog xray' || normalized === 'xray';
  const label = isOSV ? 'OSV.dev' : isXray ? 'Xray' : source?.trim() || 'Trivy';
  return (
    <span
      className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md shrink-0"
      style={
        isOSV
          ? {
              background: 'rgba(59,130,246,0.14)',
              color: '#60a5fa',
              border: '1px solid rgba(59,130,246,0.24)',
            }
          : isXray
            ? {
                background: 'rgba(245,158,11,0.12)',
                color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.22)',
              }
            : {
                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                color: 'color-mix(in srgb, var(--accent) 78%, white)',
                border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
              }
      }
      title={
        source ||
        (isOSV ? 'OSV supplemental finding' : isXray ? 'JFrog Xray finding' : 'Scanner finding')
      }
    >
      {label}
    </span>
  );
}

const LIMIT = 25;

type XrayWatchPolicyMatch = {
  watchName: string;
  watchID: string;
  policy: string;
  rule: string;
  isBlocking: boolean;
  isBuildFailed: boolean;
  failPullRequest: boolean;
};

function parseXrayWatchPolicyMatches(vulnerability: Vulnerability): XrayWatchPolicyMatch[] {
  const raw = vulnerability.xray_watch_policy_matches;
  if (!Array.isArray(raw)) {
    return [];
  }

  const results: XrayWatchPolicyMatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const row = item as Record<string, unknown>;
    const watchName = typeof row.watch_name === 'string' ? row.watch_name.trim() : '';
    const watchID = typeof row.watch_id === 'string' ? row.watch_id.trim() : '';
    const policy = typeof row.policy === 'string' ? row.policy.trim() : '';
    const rule = typeof row.rule === 'string' ? row.rule.trim() : '';
    const isBlocking = row.is_blocking === true;
    const isBuildFailed = row.is_build_failed === true;
    const failPullRequest = row.fail_pull_request === true;

    results.push({ watchName, watchID, policy, rule, isBlocking, isBuildFailed, failPullRequest });
  }

  const deduped = new Map<string, XrayWatchPolicyMatch>();
  for (const match of results) {
    const key = [
      match.watchName.toLowerCase(),
      match.watchID.toLowerCase(),
      match.policy.toLowerCase(),
      match.rule.toLowerCase(),
      match.isBlocking ? '1' : '0',
      match.isBuildFailed ? '1' : '0',
      match.failPullRequest ? '1' : '0',
    ].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, match);
    }
  }

  return Array.from(deduped.values());
}

function xrayWatchNames(vulnerability: Vulnerability): string[] {
  const names = [...(vulnerability.xray_watch_names ?? []), vulnerability.xray_watch_name ?? '']
    .map((name) => name.trim())
    .filter(Boolean);

  return Array.from(new Set(names));
}

function vulnerabilityHasXrayPolicy(vulnerability: Vulnerability): boolean {
  const policyMatches = parseXrayWatchPolicyMatches(vulnerability);
  return (
    policyMatches.length > 0 ||
    xrayWatchNames(vulnerability).length > 0 ||
    vulnerability.xray_is_blocking === true
  );
}

function prioritizeXrayPolicyVulnerabilities(vulnerabilities: Vulnerability[]): Vulnerability[] {
  return vulnerabilities
    .map((vulnerability, index) => ({ vulnerability, index }))
    .sort((left, right) => {
      const leftPriority = vulnerabilityHasXrayPolicy(left.vulnerability) ? 1 : 0;
      const rightPriority = vulnerabilityHasXrayPolicy(right.vulnerability) ? 1 : 0;
      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.vulnerability);
}

function buildPaginationItems(currentPage: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) {
    items.push('ellipsis');
  }
  for (let nextPage = start; nextPage <= end; nextPage += 1) {
    items.push(nextPage);
  }
  if (end < totalPages - 1) {
    items.push('ellipsis');
  }
  items.push(totalPages);
  return items;
}

type ResultTab = 'overview' | 'timeline' | 'sbom';

export default function SharedScanPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState('');
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState('');
  const [pkgInput, setPkgInput] = useState('');
  const [pkgFilter, setPkgFilter] = useState('');
  const [minCvss, setMinCvss] = useState(0);
  const [minCvssInput, setMinCvssInput] = useState('');
  const [hasFix, setHasFix] = useState(false);
  const [xrayPolicyFirst, setXrayPolicyFirst] = useState(false);
  const [sortBy, setSortBy] = useState('severity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [vulnLoading, setVulnLoading] = useState(false);
  const [reScanning, setReScanning] = useState(false);
  const [comparingPrev, setComparingPrev] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isLoggedIn] = useState(() => !!getToken());
  const [activeTab, setActiveTab] = useState<ResultTab>('overview');
  const vulnerabilityDetailsModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function fetchScan() {
      getSharedScan(token)
        .then((s) => {
          setScan(s);
          if (s.status === 'completed' || s.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            router.push(`/login?returnUrl=/shared/${token}`);
            return;
          }
          setError(e.message);
          if (pollRef.current) clearInterval(pollRef.current);
        });
    }
    fetchScan();
    pollRef.current = setInterval(fetchScan, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, router]);

  useEffect(() => {
    if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    pkgDebounceRef.current = setTimeout(() => {
      setPkgFilter(pkgInput);
      setPage(1);
    }, 400);
    return () => {
      if (pkgDebounceRef.current) clearTimeout(pkgDebounceRef.current);
    };
  }, [pkgInput]);

  useEffect(() => {
    return deferEffect(() => {
      if (
        !scan ||
        (scan.status !== 'completed' && scan.external_status !== 'blocked_by_xray_policy')
      )
        return;
      setVulnLoading(true);
      const shouldLoadAllPages = xrayPolicyFirst;
      const severity = severityFilter || undefined;
      const pkg = pkgFilter || undefined;
      const fix = hasFix || undefined;
      const cvss = minCvss || undefined;

      const request = shouldLoadAllPages
        ? (async () => {
            const pageSize = 100;
            let nextPage = 1;
            const all: Vulnerability[] = [];
            while (true) {
              const res = await listSharedVulnerabilities(
                token,
                nextPage,
                pageSize,
                severity,
                pkg,
                fix,
                cvss,
                sortBy,
                sortDir
              );
              const rows = res.data ?? [];
              all.push(...rows);
              if (all.length >= res.total || rows.length < pageSize) {
                break;
              }
              nextPage += 1;
            }
            const prioritized = prioritizeXrayPolicyVulnerabilities(all);
            const start = (page - 1) * LIMIT;
            const end = start + LIMIT;
            return { data: prioritized.slice(start, end), total: prioritized.length };
          })()
        : listSharedVulnerabilities(token, page, LIMIT, severity, pkg, fix, cvss, sortBy, sortDir);

      request
        .then((res) => {
          setVulns(res.data ?? []);
          setVulnTotal(res.total);
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            router.push(`/login?returnUrl=/shared/${token}`);
          }
        })
        .finally(() => setVulnLoading(false));
    });
  }, [
    token,
    scan,
    page,
    severityFilter,
    pkgFilter,
    minCvss,
    hasFix,
    xrayPolicyFirst,
    sortBy,
    sortDir,
    router,
  ]);

  async function handleRescan() {
    setReScanning(true);
    setActionError('');
    try {
      const result = await rescanShared(token);
      if (result.type === 'authenticated') {
        router.push(`/scans/details/${result.scan_id}`);
      } else {
        router.push(`/public/scan/${result.scan_id}`);
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to queue re-scan');
    } finally {
      setReScanning(false);
    }
  }

  async function handleComparePrev() {
    if (!scan) return;
    setComparingPrev(true);
    try {
      const res = await listScans(1, 5, scan.image_name);
      const prev = (res.data ?? []).find((s) => s.id !== scan.id);
      if (prev) router.push(`/scans/compare?a=${prev.id}&b=${scan.id}`);
    } catch {
      /* ignore */
    } finally {
      setComparingPrev(false);
    }
  }

  function openVulnerabilityDetails(vulnerability: Vulnerability) {
    setSelectedVulnerability(vulnerability);
    vulnerabilityDetailsModal.open();
  }

  function closeVulnerabilityDetails() {
    vulnerabilityDetailsModal.close();
    setSelectedVulnerability(null);
  }

  if (error)
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--app-bg)' }}
      >
        <div className="text-center space-y-3">
          <p className="text-red-500 dark:text-red-400 text-sm">{error}</p>
          <Link href="/" className="text-accent dark:text-accent text-sm hover:underline">
            ← Back to home
          </Link>
        </div>
      </div>
    );

  const isScanning = !scan || scan.status === 'pending' || scan.status === 'running';
  const isBlockedByXrayPolicy = scan?.external_status === 'blocked_by_xray_policy';
  const showResultTabs = Boolean(
    scan && !isScanning && (scan.status === 'completed' || scan.status === 'failed')
  );
  const showRecoveredOverview = Boolean(
    scan && (scan.status === 'completed' || isBlockedByXrayPolicy)
  );
  const totalPages = Math.max(1, Math.ceil(vulnTotal / LIMIT));
  const vulnPaginationItems = buildPaginationItems(page, totalPages);
  const imageName = scan ? `${scan.image_name}:${scan.image_tag}` : '…';

  return (
    <div className="min-h-screen" style={{ background: 'var(--app-bg)' }}>
      <div className="sticky top-0 z-20">
        <PublicNavbar
          isDark={isDark}
          isLoggedIn={isLoggedIn}
          onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
          homeHref="/public/scan/image"
        />
      </div>

      <main className="max-w-[1500px] mx-auto px-4 py-8 space-y-6">
        {actionError && (
          <div
            className="rounded-2xl px-4 py-3 text-sm"
            style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.18)',
              color: '#f87171',
            }}
          >
            {actionError}
          </div>
        )}

        <ScanDetailHeader
          badges={
            <>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                  color: 'color-mix(in srgb, var(--accent) 78%, white)',
                  border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
                }}
              >
                Shared scan
              </span>
              {scan?.share_visibility === 'authenticated' && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: 'rgba(234,179,8,0.1)',
                    color: '#facc15',
                    border: '1px solid rgba(234,179,8,0.2)',
                  }}
                >
                  Signed-in users only
                </span>
              )}
            </>
          }
          title={imageName}
          subtitle={scan?.image_digest ? <span>{scan.image_digest}</span> : undefined}
          meta={
            scan?.architecture ? (
              <p
                className="text-xs mt-1 flex items-center gap-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <CpuIcon size={12} />
                {scan.architecture} · {scan.os_family} {scan.os_name}
              </p>
            ) : undefined
          }
          actions={
            <div
              className="flex flex-wrap items-center gap-2"
              role="toolbar"
              aria-label="Shared scan actions"
            >
              {(scan?.status === 'completed' || isBlockedByXrayPolicy) && (
                <Button
                  className="btn-secondary"
                  onPress={() =>
                    window.open(`/reports/print?scans=${scan.id}`, '_blank', 'noopener,noreferrer')
                  }
                  variant="secondary"
                >
                  <FileExportIcon size={15} />
                  Export
                </Button>
              )}
              {(scan?.status === 'completed' || scan?.status === 'failed') && (
                <Button
                  className="btn-primary"
                  isDisabled={reScanning}
                  onPress={handleRescan}
                  variant="primary"
                >
                  {reScanning ? (
                    <span className="size-3.5 border-2 border-accent-400/30 border-t-accent-400 rounded-full animate-spin" />
                  ) : (
                    <Refresh01Icon size={15} />
                  )}
                  Re-scan
                </Button>
              )}
              {scan?.status === 'completed' && isLoggedIn && (
                <Button
                  className="btn-secondary"
                  isDisabled={comparingPrev}
                  onPress={handleComparePrev}
                  variant="secondary"
                >
                  {comparingPrev ? (
                    <span className="size-3.5 border-2 border-zinc-400/30 border-t-zinc-400 rounded-full animate-spin" />
                  ) : (
                    <GitCompareIcon size={15} />
                  )}
                  Compare
                </Button>
              )}
            </div>
          }
        />

        {isScanning && (
          <ScanningAnimation
            image={imageName}
            status={scan?.status ?? 'pending'}
            startedAt={scan?.started_at ?? null}
            scanProvider={scan?.scan_provider}
            xrayMode={scan?.xray_mode}
            currentStep={scan?.current_step ?? null}
            stepLogs={scan?.step_logs ?? null}
          />
        )}

        {showResultTabs && (
          <div className="w-full overflow-x-auto pb-1">
            <SegmentedControl
              ariaLabel="Result tabs"
              className="min-w-max"
              options={[
                { id: 'overview', label: showRecoveredOverview ? 'Overview' : 'Status' },
                {
                  id: 'timeline',
                  label: scan?.step_logs?.length
                    ? `Timeline (${scan.step_logs.length})`
                    : 'Timeline',
                },
                { id: 'sbom', label: 'Packages & SBOM' },
              ]}
              value={activeTab}
              onChange={setActiveTab}
            />
          </div>
        )}

        {scan?.status === 'failed' && activeTab === 'overview' && !isBlockedByXrayPolicy && (
          <ScanFailureAlert
            errorMessage={scan.error_message}
            imageReference={`${scan.image_name}:${scan.image_tag}`}
          />
        )}

        {isBlockedByXrayPolicy && activeTab === 'overview' && (
          <div
            className="rounded-2xl px-6 py-5"
            style={{
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.22)',
            }}
          >
            <p className="font-medium" style={{ color: '#f59e0b' }}>
              Blocked by Xray policy
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Xray blocked the normal scan path, but JustScan recovered any findings the provider
              still exposed. The results below reflect that recovered data.
            </p>
            {scan?.error_message && (
              <p
                className="text-sm mt-3 whitespace-pre-wrap break-all"
                style={{ color: 'var(--text-faint)' }}
              >
                {scan.error_message}
              </p>
            )}
          </div>
        )}

        {scan && !isScanning && activeTab === 'timeline' && (
          <ScanStepTimeline
            stepLogs={scan.step_logs}
            completedAt={scan.completed_at}
            status={scan.status}
            externalStatus={scan.external_status}
            scanProvider={scan.scan_provider}
            xrayMode={scan.xray_mode}
            xrayProviderScannedAt={scan.xray_provider_scanned_at}
          />
        )}

        {scan && !isScanning && activeTab === 'sbom' && (
          <SBOMWorkspace
            readOnly
            loadComponents={(query) => getSharedSBOM(token, query)}
            loadGraph={(focus) => getSharedSBOMGraph(token, focus)}
            loadComponent={(componentId) => getSharedSBOMComponent(token, componentId)}
            downloadHref={`/api/v1/shared/${token}/sbom/download`}
          />
        )}

        {scan && showRecoveredOverview && activeTab === 'overview' && (
          <>
            {/* Severity cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { ...SEV_CONFIG.CRITICAL, count: scan.critical_count },
                { ...SEV_CONFIG.HIGH, count: scan.high_count },
                { ...SEV_CONFIG.MEDIUM, count: scan.medium_count },
                { ...SEV_CONFIG.LOW, count: scan.low_count },
              ].map(({ label, count, color, border }) => (
                <Card
                  key={label}
                  className={`rounded-2xl border ${border} p-4 cursor-pointer transition-all hover:scale-105`}
                  variant="default"
                  onClick={() => {
                    setSeverityFilter((f) =>
                      f === label.toUpperCase() ? '' : label.toUpperCase()
                    );
                    setPage(1);
                  }}
                >
                  <Card.Content className="p-0">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                      {label}
                    </p>
                    <p className={`text-2xl font-bold ${color}`}>{count ?? 0}</p>
                  </Card.Content>
                </Card>
              ))}
            </div>

            {/* Vulnerabilities */}
            <Card className="overflow-hidden">
              <Card.Header className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Vulnerabilities
                    {vulnTotal > 0 && (
                      <span
                        className="text-sm font-normal ml-2"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {vulnTotal} found
                      </span>
                    )}
                  </h2>
                </div>
                <Card variant="secondary" className="flex flex-col gap-3 p-3">
                  <div className="w-full overflow-x-auto pb-1">
                    <SegmentedControl
                      ariaLabel="Severity filters"
                      className="min-w-max"
                      options={[
                        { id: '', label: 'All' },
                        { id: 'CRITICAL', label: 'Critical' },
                        { id: 'HIGH', label: 'High' },
                        { id: 'MEDIUM', label: 'Medium' },
                        { id: 'LOW', label: 'Low' },
                      ]}
                      value={severityFilter}
                      onChange={(next) => {
                        setSeverityFilter(next);
                        setPage(1);
                      }}
                      size="sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(220px,1fr)_160px_150px_150px_120px_auto_auto]">
                    <FormField
                      hideLabel
                      label="Filter by package"
                      type="text"
                      value={pkgInput}
                      onChange={(e) => setPkgInput(e.target.value)}
                      placeholder="Search package..."
                      className="w-full bg-surface"
                      containerClassName="w-full"
                    />
                    <Select
                      aria-label="Sort vulnerabilities by"
                      value={sortBy}
                      className="w-full"
                      onChange={(value) => {
                        if (value == null) {
                          return;
                        }
                        setSortBy(String(value));
                        setPage(1);
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="vuln_id">CVE ID</ListBox.Item>
                          <ListBox.Item id="pkg_name">Package</ListBox.Item>
                          <ListBox.Item id="severity">Severity</ListBox.Item>
                          <ListBox.Item id="cvss_score">CVSS</ListBox.Item>
                          <ListBox.Item id="installed_version">Installed</ListBox.Item>
                          <ListBox.Item id="fixed_version">Fixed In</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Select
                      aria-label="Sort direction"
                      value={sortDir}
                      className="w-full"
                      onChange={(value) => {
                        if (value == null) {
                          return;
                        }
                        setSortDir(String(value) as 'asc' | 'desc');
                        setPage(1);
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="asc">Ascending</ListBox.Item>
                          <ListBox.Item id="desc">Descending</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <FormField
                      hideLabel
                      label="Minimum CVSS"
                      type="number"
                      min={0}
                      max={10}
                      step={0.1}
                      value={minCvssInput}
                      onChange={(e) => {
                        setMinCvssInput(e.target.value);
                        const v = parseFloat(e.target.value);
                        setMinCvss(isNaN(v) ? 0 : v);
                        setPage(1);
                      }}
                      placeholder="Min CVSS"
                      className="w-full bg-surface"
                      containerClassName="w-full"
                    />
                    <Button
                      onPress={() => {
                        setHasFix(!hasFix);
                        setPage(1);
                      }}
                      className="w-full"
                      variant={hasFix ? 'primary' : 'secondary'}
                    >
                      Has Fix
                    </Button>
                    <Button
                      onPress={() => {
                        setXrayPolicyFirst(!xrayPolicyFirst);
                        setPage(1);
                      }}
                      className="w-full"
                      variant={xrayPolicyFirst ? 'primary' : 'secondary'}
                    >
                      Xray Policy First
                    </Button>
                  </div>
                </Card>
              </Card.Header>
              <VulnerabilitiesTable
                ariaLabel="Shared scan vulnerabilities"
                vulns={vulns}
                vulnLoading={vulnLoading}
                vulnTotal={vulnTotal}
                sortBy={
                  sortBy as
                    | 'vuln_id'
                    | 'pkg_name'
                    | 'installed_version'
                    | 'fixed_version'
                    | 'severity'
                    | 'cvss_score'
                }
                sortDir={sortDir}
                onSortChange={(key, direction) => {
                  setSortBy(key);
                  setSortDir(direction);
                  setPage(1);
                }}
                onOpenVulnerability={openVulnerabilityDetails}
                renderSeverityBadge={(severity) => <SeverityBadge severity={severity} />}
                renderSourceBadge={(source) => <SourceBadge source={source} />}
                renderXrayPolicyCell={(vulnerability) => {
                  const policyMatches = parseXrayWatchPolicyMatches(vulnerability);
                  const watchCount = xrayWatchNames(vulnerability).length;
                  const hasDetails =
                    policyMatches.length > 0 || watchCount > 0 || !!vulnerability.xray_is_blocking;
                  if (!hasDetails) {
                    return <span className="text-xs text-zinc-400">-</span>;
                  }

                  const total = policyMatches.length || watchCount;
                  const isBlocking =
                    vulnerability.xray_is_blocking ||
                    policyMatches.some(
                      (match) => match.isBlocking || match.isBuildFailed || match.failPullRequest
                    );

                  return (
                    <Button
                      onPress={() => openVulnerabilityDetails(vulnerability)}
                      className="inline-flex items-center gap-1.5"
                      variant={isBlocking ? 'danger-soft' : 'secondary'}
                    >
                      Details
                      <span
                        className={`font-semibold text-xs rounded-full px-1.5 py-0.5 ${
                          isBlocking
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-zinc-500/20 text-zinc-300 dark:text-zinc-200'
                        }`}
                      >
                        {total}
                      </span>
                    </Button>
                  );
                }}
                page={page}
                totalPages={totalPages}
                paginationItems={vulnPaginationItems}
                onPageChange={setPage}
                pageSize={LIMIT}
              />
            </Card>
          </>
        )}

        <VulnerabilityDetailsModal
          vulnerability={selectedVulnerability}
          state={vulnerabilityDetailsModal}
          onClose={closeVulnerabilityDetails}
          loadContextAnalysis={(vulnerability) =>
            getSharedVulnerabilityContextAnalysis(token, vulnerability.id)
          }
        />
      </main>
    </div>
  );
}
