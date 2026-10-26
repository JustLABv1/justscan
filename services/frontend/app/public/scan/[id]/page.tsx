'use client';
import { PublicNavbar } from '@/components/public/public-navbar';
import { ScanFailureAlert } from '@/components/scans/scan-failure-alert';
import { FormField } from '@/components/ui/form-field';
import { fieldSelectTriggerClassName } from '@/components/ui/form-styles';
import { StatCard } from '@/components/ui/stat-card';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type { Scan, Vulnerability } from '@/lib/api';
import {
  getPublicScan,
  getPublicVulnerabilityContextAnalysis,
  getToken,
  listPublicVulnerabilities,
  reScanPublic,
  subscribeToAuth,
} from '@/lib/api';
import { deferEffect } from '@/lib/defer-effect';
import { updatePublicHistoryEntry } from '@/lib/publicScanHistory';
import { fullDate, timeAgo } from '@/lib/time';
import {
  Button,
  Card,
  Chip,
  ListBox,
  SearchField,
  Select,
  Table,
  Tabs,
  Popover,
  Label,
  Checkbox,
  useOverlayState,
} from '@/components/ui';
import {
  ArrowLeft01Icon,
  Bug02Icon,
  CpuIcon,
  FileExportIcon,
  Refresh01Icon,
} from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScanningAnimation, ScanStepTimeline } from '../../../../components/scans/scan-runtime';
import { isAbortError } from '@/lib/utils';

const SEV_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  CRITICAL: {
    label: 'Critical',
    color: 'text-destructive dark:text-destructive',
    bg: 'bg-destructive/10',
    border: 'border-destructive/20',
  },
  HIGH: {
    label: 'High',
    color: 'text-orange-500 dark:text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
  MEDIUM: {
    label: 'Medium',
    color: 'text-warning-foreground dark:text-warning-foreground',
    bg: 'bg-warning/10',
    border: 'border-warning/20',
  },
  LOW: {
    label: 'Low',
    color: 'text-info-foreground dark:text-info-foreground',
    bg: 'bg-info/10',
    border: 'border-info/20',
  },
  UNKNOWN: {
    label: 'Unknown',
    color: 'text-muted-foreground',
    bg: 'bg-muted/10',
    border: 'border-border/20',
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
      className="text-xs font-semibold px-1.5 py-0.5 rounded-md shrink-0"
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
                background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
                color: 'color-mix(in srgb, var(--primary) 55%, white)',
                border: '1px solid color-mix(in srgb, var(--primary) 22%, transparent)',
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

function ScannerDatabaseCard({
  label,
  updatedAt,
  downloadedAt,
}: {
  label: string;
  updatedAt?: string | null;
  downloadedAt?: string | null;
}) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: 'var(--surface-bg)', border: '1px solid var(--surface-border)' }}
    >
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p
        className="text-sm font-medium"
        style={{ color: 'var(--text-primary)' }}
        title={updatedAt ? fullDate(updatedAt) : ''}
      >
        {updatedAt ? `${timeAgo(updatedAt)} (${fullDate(updatedAt)})` : 'Unknown'}
      </p>
      <p
        className="text-xs mt-1"
        style={{ color: 'var(--text-faint)' }}
        title={downloadedAt ? fullDate(downloadedAt) : ''}
      >
        Downloaded {downloadedAt ? timeAgo(downloadedAt) : 'unknown'}
      </p>
    </div>
  );
}

const LIMIT = 25;

type ResultTab = 'overview' | 'timeline';

function publicScanStatusTone(status?: string | null): {
  color: 'success' | 'danger' | 'accent' | 'warning';
  label: string;
} {
  switch (status) {
    case 'completed':
      return { color: 'success', label: 'Completed' };
    case 'failed':
      return { color: 'danger', label: 'Failed' };
    case 'running':
      return { color: 'accent', label: 'Running' };
    default:
      return { color: 'warning', label: 'Queued' };
  }
}

function publicScanProviderLabel(scanProvider?: string | null): string {
  return scanProvider === 'artifactory_xray' ? 'Artifactory Xray' : 'Built-in scanner';
}

export default function PublicScanResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [vulnTotal, setVulnTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [severityFilter, setSeverityFilter] = useState('');
  const [pkgInput, setPkgInput] = useState('');
  const [pkgFilter, setPkgFilter] = useState('');
  const [cveInput, setCveInput] = useState('');
  const [cveFilter, setCveFilter] = useState('');
  const [minCvss, setMinCvss] = useState(0);
  const [minCvssInput, setMinCvssInput] = useState('');
  const [hasFix, setHasFix] = useState(false);
  const [sortBy, setSortBy] = useState('severity');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [vulnLoading, setVulnLoading] = useState(false);
  const [vulnError, setVulnError] = useState('');
  const [vulnRetryKey, setVulnRetryKey] = useState(0);
  const [reScanning, setReScanning] = useState(false);
  const isLoggedIn = useSyncExternalStore(
    subscribeToAuth,
    () => Boolean(getToken()),
    () => false
  );
  const [activeTab, setActiveTab] = useState<ResultTab>('overview');
  const vulnerabilityDetailsModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);
  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let terminal = false;
    let inFlight = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      terminal = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const poll = () => {
      if (stopped || controller.signal.aborted || inFlight || terminal) return;
      inFlight = true;

      void getPublicScan(id, { signal: controller.signal })
        .then((result) => {
          if (stopped) return;
          setError('');
          setScan(result);
          setActionError('');
          if (result.status === 'completed' || result.status === 'failed') {
            stopPolling();
            updatePublicHistoryEntry(id, {
              status: result.status,
              critical_count: result.critical_count ?? 0,
              high_count: result.high_count ?? 0,
              medium_count: result.medium_count ?? 0,
              low_count: result.low_count ?? 0,
              unknown_count: result.unknown_count ?? 0,
            });
          }
        })
        .catch((error: unknown) => {
          if (
            stopped ||
            controller.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            return;
          }
          stopPolling();
          setError(error instanceof Error ? error.message : 'Failed to load public scan.');
        })
        .finally(() => {
          inFlight = false;
        });
    };

    void poll();
    intervalId = setInterval(() => void poll(), 2500);

    return () => {
      stopped = true;
      controller.abort();
      stopPolling();
    };
  }, [id]);

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
    if (cveDebounceRef.current) clearTimeout(cveDebounceRef.current);
    cveDebounceRef.current = setTimeout(() => {
      setCveFilter(cveInput.trim().toUpperCase());
      setPage(1);
    }, 400);
    return () => {
      if (cveDebounceRef.current) clearTimeout(cveDebounceRef.current);
    };
  }, [cveInput]);

  useEffect(() => {
    return deferEffect(() => {
      if (
        !scan ||
        (scan.status !== 'completed' && scan.external_status !== 'blocked_by_xray_policy')
      )
        return;

      const controller = new AbortController();
      setVulnLoading(true);
      setVulnError('');
      const requestOptions = { signal: controller.signal };
      const loadVulnerabilities = async (): Promise<{
        data: Vulnerability[];
        total: number;
      } | null> => {
        const normalizedCveFilter = cveFilter.trim().toUpperCase();
        const baseArgs = [
          severityFilter || undefined,
          pkgFilter || undefined,
          hasFix || undefined,
          minCvss || undefined,
          sortBy,
          sortDir,
        ] as const;

        if (!normalizedCveFilter) {
          const res = await listPublicVulnerabilities(id, page, LIMIT, ...baseArgs, requestOptions);
          return controller.signal.aborted ? null : { data: res.data ?? [], total: res.total };
        }

        const PAGE_SIZE = 100;
        const first = await listPublicVulnerabilities(
          id,
          1,
          PAGE_SIZE,
          ...baseArgs,
          requestOptions
        );
        if (controller.signal.aborted) return null;
        const firstData = first.data ?? [];
        const allRows: Vulnerability[] = [...firstData];
        const total = Math.max(first.total ?? firstData.length, firstData.length);
        const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

        for (let currentPage = 2; currentPage <= maxPage; currentPage += 1) {
          const next = await listPublicVulnerabilities(
            id,
            currentPage,
            PAGE_SIZE,
            ...baseArgs,
            requestOptions
          );
          if (controller.signal.aborted) return null;
          const nextData = next.data ?? [];
          allRows.push(...nextData);
          if (nextData.length < PAGE_SIZE) {
            break;
          }
        }

        const filtered = allRows.filter((row) =>
          (row.vuln_id ?? '').toUpperCase().includes(normalizedCveFilter)
        );
        const start = (page - 1) * LIMIT;
        return {
          data: filtered.slice(start, start + LIMIT),
          total: filtered.length,
        };
      };

      loadVulnerabilities()
        .then((result) => {
          if (!result || controller.signal.aborted) return;
          setVulns(result.data);
          setVulnTotal(result.total);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || isAbortError(reason)) return;
          setVulnError(
            reason instanceof Error ? reason.message : 'Failed to load vulnerabilities.'
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setVulnLoading(false);
        });

      return () => controller.abort();
    });
  }, [
    id,
    scan,
    page,
    severityFilter,
    pkgFilter,
    cveFilter,
    minCvss,
    hasFix,
    sortBy,
    sortDir,
    vulnRetryKey,
  ]);

  async function handleRescan() {
    setReScanning(true);
    setActionError('');
    try {
      const newScan = await reScanPublic(id);
      router.push(`/public/scan/${newScan.id}`);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to queue re-scan');
    } finally {
      setReScanning(false);
    }
  }

  const selectTriggerCls = fieldSelectTriggerClassName;

  function openVulnerabilityDetails(vulnerability: Vulnerability) {
    setSelectedVulnerability(vulnerability);
    vulnerabilityDetailsModal.open();
  }

  function closeVulnerabilityDetails() {
    vulnerabilityDetailsModal.close();
    setSelectedVulnerability(null);
  }

  function retryVulnerabilities() {
    setVulnRetryKey((current) => current + 1);
  }

  if (error)
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--app-bg)' }}
      >
        <div className="text-center space-y-3">
          <p role="alert" className="text-destructive dark:text-destructive text-sm">
            {error}
          </p>
          <Link
            href="/public/scan/image"
            className="text-primary dark:text-primary text-sm hover:underline"
          >
            ← Try another scan
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
  const imageName = scan ? `${scan.image_name}:${scan.image_tag}` : '…';
  const statusTone = publicScanStatusTone(scan?.status);
  const providerLabel = publicScanProviderLabel(scan?.scan_provider);

  const pageActions = (
    <div
      className="flex flex-wrap items-center justify-start gap-2 lg:justify-end"
      role="toolbar"
      aria-label="Public scan actions"
    >
      <Button
        className="btn-secondary"
        onPress={() => router.push('/public/scan/image')}
        variant="secondary"
      >
        <ArrowLeft01Icon size={15} />
        New scan
      </Button>
      {scan?.helm_scan_run_id && (
        <Button
          className="btn-secondary"
          onPress={() => router.push(`/public/scan/helm/runs/${scan.helm_scan_run_id}`)}
          variant="secondary"
        >
          <ArrowLeft01Icon size={15} />
          Back to Helm run
        </Button>
      )}
      {(scan?.status === 'completed' || isBlockedByXrayPolicy) && (
        <Button
          className="btn-secondary"
          onPress={() => window.open(`/reports/print?scans=${id}`, '_blank', 'noopener,noreferrer')}
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
            <span className="size-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          ) : (
            <Refresh01Icon size={15} />
          )}
          Re-scan
        </Button>
      )}
    </div>
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <section>
        <div className="sticky top-0 z-20">
          <PublicNavbar
            isDark={isDark}
            isLoggedIn={isLoggedIn}
            onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
            homeHref="/public/scan/image"
            title={imageName}
            leadingActions={pageActions}
          />
        </div>

        <main className="relative z-10 mx-auto w-full max-w-screen-2xl px-4 pb-16 pt-8 sm:px-6">
          <div className="space-y-6">
            {actionError && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.18)',
                  color: '#f87171',
                }}
              >
                {actionError}
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <Chip color={statusTone.color} size="sm" variant="soft">
                {statusTone.label}
              </Chip>
              <span>{providerLabel}</span>
              {scan?.architecture ? (
                <span className="inline-flex items-center gap-1">
                  <CpuIcon size={12} />
                  {scan.architecture} · {scan.os_family} {scan.os_name}
                </span>
              ) : null}
              {scan?.image_digest ? (
                <code
                  className="min-w-0 max-w-full truncate sm:ml-auto sm:max-w-md"
                  title={scan.image_digest}
                >
                  {scan.image_digest}
                </code>
              ) : null}
            </div>

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

            {scan && showRecoveredOverview && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { ...SEV_CONFIG.CRITICAL, count: scan.critical_count },
                  { ...SEV_CONFIG.HIGH, count: scan.high_count },
                  { ...SEV_CONFIG.MEDIUM, count: scan.medium_count },
                  { ...SEV_CONFIG.LOW, count: scan.low_count },
                ].map(({ label, count }) => (
                  <StatCard
                    key={label}
                    label={label}
                    value={count ?? 0}
                    icon={<Bug02Icon size={16} />}
                    tone={
                      label === 'Critical'
                        ? 'danger'
                        : label === 'High' || label === 'Medium'
                          ? 'warning'
                          : 'default'
                    }
                    selected={severityFilter === label.toUpperCase()}
                    hint={severityFilter === label.toUpperCase() ? 'Filter active' : 'Findings'}
                    onPress={() => {
                      setSeverityFilter((current) =>
                        current === label.toUpperCase() ? '' : label.toUpperCase()
                      );
                      setActiveTab('overview');
                      setPage(1);
                    }}
                  />
                ))}
              </div>
            )}

            {showResultTabs && (
              <Tabs
                selectedKey={activeTab}
                onSelectionChange={(key) => setActiveTab(String(key) as 'overview' | 'timeline')}
                variant="primary"
              >
                <Tabs.ListContainer>
                  <Tabs.List aria-label="Result views">
                    <Tabs.Tab id="overview">
                      {showRecoveredOverview ? 'Vulnerabilities' : 'Status'}
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id="timeline">
                      Timeline{' '}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {scan?.step_logs?.length ?? 0}
                      </span>
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
                <Tabs.Panel id="overview" className="hidden" />
                <Tabs.Panel id="timeline" className="hidden" />
              </Tabs>
            )}

            {scan?.status === 'failed' && activeTab === 'overview' && !isBlockedByXrayPolicy && (
              <div className="space-y-3">
                <ScanFailureAlert
                  errorMessage={scan.error_message}
                  imageReference={`${scan.image_name}:${scan.image_tag}`}
                />
                <Link
                  href="/public/scan/image"
                  className="inline-block text-sm text-primary hover:underline"
                >
                  Try another image →
                </Link>
              </div>
            )}

            {isBlockedByXrayPolicy && activeTab === 'overview' && (
              <div
                className="rounded-xl px-6 py-5"
                style={{
                  background: 'rgba(245,158,11,0.10)',
                  border: '1px solid rgba(245,158,11,0.22)',
                }}
              >
                <p className="font-medium" style={{ color: '#f59e0b' }}>
                  Blocked by Xray policy
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                  Xray blocked the normal scan path, but JustScan recovered any findings the
                  provider still exposed. The results below reflect that recovered data.
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

            {scan && showRecoveredOverview && activeTab === 'overview' && (
              <>
                {/* Vulnerabilities */}
                <Card className="gap-0 overflow-hidden py-0">
                  <Card.Header className="space-y-3 border-b p-4">
                    <h2
                      className="text-base font-semibold"
                      style={{ color: 'var(--text-primary)' }}
                    >
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
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="w-full space-y-2">
                        <Tabs
                          selectedKey={severityFilter || 'all'}
                          onSelectionChange={(key) => {
                            setSeverityFilter(key === 'all' ? '' : String(key));
                            setPage(1);
                          }}
                          variant="secondary"
                        >
                          <Tabs.ListContainer className="overflow-x-auto">
                            <Tabs.List
                              aria-label="Filter findings by severity"
                              className="min-w-max"
                            >
                              {['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((key) => (
                                <Tabs.Tab id={key} key={key}>
                                  {key === 'all' ? 'All' : SEV_CONFIG[key].label}
                                  <Tabs.Indicator />
                                </Tabs.Tab>
                              ))}
                            </Tabs.List>
                          </Tabs.ListContainer>
                          {['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((key) => (
                            <Tabs.Panel key={key} id={key} className="hidden" />
                          ))}
                        </Tabs>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <SearchField
                            aria-label="Search packages"
                            name="public-scan-vuln-search"
                            className="w-full"
                          >
                            <SearchField.Group className="">
                              <SearchField.SearchIcon />
                              <SearchField.Input
                                placeholder="Search package..."
                                value={pkgInput}
                                onChange={(event) => setPkgInput(event.target.value)}
                              />
                              <SearchField.ClearButton />
                            </SearchField.Group>
                          </SearchField>
                          <Popover>
                            <Popover.Trigger>
                              <Button variant="outline">Filter & sort</Button>
                            </Popover.Trigger>
                            <Popover.Content
                              placement="bottom end"
                              className="w-[min(calc(100vw-2rem),34rem)]"
                            >
                              <Popover.Dialog className="space-y-4 p-4">
                                <p className="text-sm font-semibold">Filter & sort</p>
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <SearchField
                                    aria-label="Search CVE identifiers"
                                    name="public-scan-vuln-cve-search"
                                    className="w-full"
                                  >
                                    <SearchField.Group className="">
                                      <SearchField.SearchIcon />
                                      <SearchField.Input
                                        placeholder="Search CVE (e.g. CVE-2026-31789)..."
                                        value={cveInput}
                                        onChange={(event) => setCveInput(event.target.value)}
                                      />
                                      <SearchField.ClearButton />
                                    </SearchField.Group>
                                  </SearchField>
                                  <Select
                                    aria-label="Sort vulnerabilities by"
                                    value={sortBy}
                                    className="w-full"
                                    onChange={(value) => {
                                      setSortBy(String(value ?? 'severity'));
                                      setPage(1);
                                    }}
                                  >
                                    <Label>Sort by</Label>
                                    <Select.Trigger className={`${selectTriggerCls} `}>
                                      <Select.Value />
                                      <Select.Indicator />
                                    </Select.Trigger>
                                    <Select.Popover>
                                      <ListBox>
                                        <ListBox.Item id="vuln_id">CVE ID</ListBox.Item>
                                        <ListBox.Item id="pkg_name">Package</ListBox.Item>
                                        <ListBox.Item id="severity">Severity</ListBox.Item>
                                        <ListBox.Item id="cvss_score">CVSS</ListBox.Item>
                                        <ListBox.Item id="installed_version">
                                          Installed
                                        </ListBox.Item>
                                        <ListBox.Item id="fixed_version">Fixed In</ListBox.Item>
                                      </ListBox>
                                    </Select.Popover>
                                  </Select>
                                  <Select
                                    aria-label="Sort direction"
                                    value={sortDir}
                                    className="w-full"
                                    onChange={(value) => {
                                      setSortDir(value === 'desc' ? 'desc' : 'asc');
                                      setPage(1);
                                    }}
                                  >
                                    <Label>Direction</Label>
                                    <Select.Trigger className={`${selectTriggerCls} `}>
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
                                    className="w-full"
                                    containerClassName="w-full"
                                  />
                                  <Checkbox
                                    isSelected={hasFix}
                                    onChange={(value) => {
                                      setHasFix(value);
                                      setPage(1);
                                    }}
                                  >
                                    <Checkbox.Control>
                                      <Checkbox.Indicator />
                                    </Checkbox.Control>
                                    <span>Has a fix</span>
                                  </Checkbox>
                                </div>
                                <Button
                                  size="sm"
                                  variant="tertiary"
                                  onPress={() => {
                                    setPkgInput('');
                                    setCveInput('');
                                    setSeverityFilter('');
                                    setHasFix(false);
                                    setMinCvss(0);
                                    setMinCvssInput('');
                                    setSortBy('severity');
                                    setSortDir('asc');
                                    setPage(1);
                                  }}
                                >
                                  Clear filters
                                </Button>
                              </Popover.Dialog>
                            </Popover.Content>
                          </Popover>
                        </div>
                      </div>
                    </div>
                  </Card.Header>

                  {/* Table */}
                  {vulnError && vulns.length > 0 && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive dark:text-destructive"
                    >
                      <span>
                        Couldn&apos;t refresh vulnerabilities: {vulnError} Showing the last
                        successful results.
                      </span>
                      <Button
                        aria-label="Retry loading vulnerabilities"
                        onPress={retryVulnerabilities}
                        size="sm"
                        variant="secondary"
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                  <div className="max-w-full overflow-x-auto">
                    <Table>
                      <Table.ScrollContainer className="rounded-none border-0">
                        <Table.Content
                          aria-label="Public scan vulnerabilities"
                          aria-busy={vulnLoading}
                          className="min-w-[1000px] table-fixed [&_td]:px-3 [&_th]:px-3 [&_td]:py-3"
                        >
                          <Table.Header>
                            {(
                              [
                                { label: 'Finding', key: 'vuln_id' },
                                { label: 'Affected package', key: 'pkg_name' },
                                { label: 'Risk', key: 'severity' },
                                { label: 'Remediation', key: 'fixed_version' },
                              ] as { label: string; key: string }[]
                            ).map(({ label, key }) => {
                              const active = sortBy === key;
                              return (
                                <Table.Column
                                  key={key}
                                  isRowHeader={key === 'vuln_id'}
                                  className={
                                    key === 'vuln_id'
                                      ? 'w-[220px]'
                                      : key === 'severity'
                                        ? 'w-[180px]'
                                        : key === 'fixed_version'
                                          ? 'w-[220px]'
                                          : 'w-auto'
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (active) {
                                        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                                      } else {
                                        setSortBy(key);
                                        setSortDir('asc');
                                      }
                                      setPage(1);
                                    }}
                                    className="inline-flex items-center gap-1 cursor-pointer select-none"
                                    style={{
                                      color: active ? 'var(--primary)' : 'var(--text-faint)',
                                    }}
                                  >
                                    <span>{label}</span>
                                    {active && <span>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                                  </button>
                                </Table.Column>
                              );
                            })}
                          </Table.Header>
                          <Table.Body>
                            {vulnError && vulns.length === 0 ? (
                              <Table.Row key="error" id="error">
                                <Table.Cell colSpan={4}>
                                  <div
                                    role="alert"
                                    aria-live="assertive"
                                    className="flex flex-col items-center gap-3 py-12 text-center text-sm text-destructive dark:text-destructive"
                                  >
                                    <span>Couldn&apos;t load vulnerabilities: {vulnError}</span>
                                    <Button
                                      aria-label="Retry loading vulnerabilities"
                                      onPress={retryVulnerabilities}
                                      size="sm"
                                      variant="secondary"
                                    >
                                      Retry
                                    </Button>
                                  </div>
                                </Table.Cell>
                              </Table.Row>
                            ) : vulnLoading ? (
                              <Table.Row key="loading" id="loading">
                                <Table.Cell colSpan={4}>
                                  <div
                                    className="py-12 text-center"
                                    role="status"
                                    aria-live="polite"
                                  >
                                    <div className="flex justify-center">
                                      <div
                                        className="size-6 rounded-full border-2 border-t-primary animate-spin"
                                        style={{
                                          borderColor: 'var(--border-subtle)',
                                          borderTopColor: 'var(--primary)',
                                        }}
                                      />
                                    </div>
                                    <span className="sr-only">Loading vulnerabilities…</span>
                                  </div>
                                </Table.Cell>
                              </Table.Row>
                            ) : vulns.length === 0 ? (
                              <Table.Row key="empty" id="empty">
                                <Table.Cell colSpan={4}>
                                  <div
                                    className="py-12 text-center text-sm"
                                    style={{ color: 'var(--text-faint)' }}
                                  >
                                    {vulnTotal === 0
                                      ? 'No vulnerabilities found.'
                                      : 'No results match your filters.'}
                                  </div>
                                </Table.Cell>
                              </Table.Row>
                            ) : (
                              vulns.map((v) => (
                                <Table.Row
                                  key={v.id}
                                  id={v.id}
                                  className="hover:bg-[var(--row-hover)]"
                                >
                                  <Table.Cell>
                                    <Button
                                      variant="link"
                                      onPress={() => openVulnerabilityDetails(v)}
                                      className="h-auto max-w-full justify-start p-0 font-mono text-xs"
                                    >
                                      {v.vuln_id || 'Unknown finding'}
                                    </Button>
                                    <p
                                      className="mt-1 truncate text-xs text-muted-foreground"
                                      title={v.data_source}
                                    >
                                      {v.data_source || 'Unknown source'}
                                    </p>
                                  </Table.Cell>
                                  <Table.Cell>
                                    <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                                      {v.pkg_name}
                                    </p>
                                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                      {v.installed_version}
                                    </p>
                                  </Table.Cell>
                                  <Table.Cell>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <SeverityBadge severity={v.severity} />
                                      <span className="text-xs tabular-nums text-muted-foreground">
                                        {v.cvss_score
                                          ? `CVSS ${v.cvss_score.toFixed(1)}`
                                          : 'No CVSS'}
                                      </span>
                                    </div>
                                  </Table.Cell>
                                  <Table.Cell>
                                    <p
                                      className={`text-sm ${v.fixed_version ? 'text-success-foreground' : 'text-muted-foreground'}`}
                                    >
                                      {v.fixed_version ? 'Update available' : 'No fix available'}
                                    </p>
                                    {v.fixed_version ? (
                                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                        {v.fixed_version}
                                      </p>
                                    ) : null}
                                  </Table.Cell>
                                </Table.Row>
                              ))
                            )}
                          </Table.Body>
                        </Table.Content>
                      </Table.ScrollContainer>
                    </Table>
                  </div>

                  {totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
                      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {vulnTotal} total
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          isDisabled={page <= 1}
                          onPress={() => setPage((p) => p - 1)}
                          className="btn-secondary"
                          variant="secondary"
                        >
                          ← Prev
                        </Button>
                        <span className="text-sm px-2" style={{ color: 'var(--text-muted)' }}>
                          {page} / {totalPages}
                        </span>
                        <Button
                          isDisabled={page >= totalPages}
                          onPress={() => setPage((p) => p + 1)}
                          className="btn-secondary"
                          variant="secondary"
                        >
                          Next →
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </>
            )}

            <VulnerabilityDetailsModal
              vulnerability={selectedVulnerability}
              state={vulnerabilityDetailsModal}
              onClose={closeVulnerabilityDetails}
              loadContextAnalysis={(vulnerability) =>
                getPublicVulnerabilityContextAnalysis(id, vulnerability.id)
              }
            />
          </div>
        </main>
      </section>
    </div>
  );
}
