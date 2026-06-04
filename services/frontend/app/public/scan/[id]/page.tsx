'use client';
import { PublicNavbar } from '@/components/public/public-navbar';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatCard } from '@/components/ui/stat-card';
import { VulnerabilityDetailsModal } from '@/components/vulnerability-details-modal';
import type { Scan, Vulnerability } from '@/lib/api';
import {
  getPublicScan,
  getPublicVulnerabilityContextAnalysis,
  getToken,
  listPublicVulnerabilities,
  reScanPublic,
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
  useOverlayState,
} from '@heroui/react';
import { ArrowLeft01Icon, Bug02Icon, CpuIcon, FileExportIcon, Refresh01Icon } from 'hugeicons-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ScanningAnimation, ScanStepTimeline } from '../../../../components/scans/scan-runtime';

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
                color: 'color-mix(in srgb, var(--accent) 55%, white)',
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
      className="rounded-2xl border p-4"
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
  const [reScanning, setReScanning] = useState(false);
  const [isLoggedIn] = useState(() => !!getToken());
  const [activeTab, setActiveTab] = useState<ResultTab>('overview');
  const vulnerabilityDetailsModal = useOverlayState();
  const [selectedVulnerability, setSelectedVulnerability] = useState<Vulnerability | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pkgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function fetchScan() {
      getPublicScan(id)
        .then((s) => {
          setScan(s);
          setActionError('');
          if (s.status === 'completed' || s.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            updatePublicHistoryEntry(id, {
              status: s.status,
              critical_count: s.critical_count ?? 0,
              high_count: s.high_count ?? 0,
              medium_count: s.medium_count ?? 0,
              low_count: s.low_count ?? 0,
              unknown_count: s.unknown_count ?? 0,
            });
          }
        })
        .catch((e) => {
          setError(e.message);
          if (pollRef.current) clearInterval(pollRef.current);
        });
    }
    fetchScan();
    pollRef.current = setInterval(fetchScan, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
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
      setVulnLoading(true);
      const loadVulnerabilities = async () => {
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
          const res = await listPublicVulnerabilities(id, page, LIMIT, ...baseArgs);
          setVulns(res.data ?? []);
          setVulnTotal(res.total);
          return;
        }

        const PAGE_SIZE = 100;
        const first = await listPublicVulnerabilities(id, 1, PAGE_SIZE, ...baseArgs);
        const firstData = first.data ?? [];
        const allRows: Vulnerability[] = [...firstData];
        const total = Math.max(first.total ?? firstData.length, firstData.length);
        const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

        for (let currentPage = 2; currentPage <= maxPage; currentPage += 1) {
          const next = await listPublicVulnerabilities(id, currentPage, PAGE_SIZE, ...baseArgs);
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
        setVulnTotal(filtered.length);
        setVulns(filtered.slice(start, start + LIMIT));
      };

      loadVulnerabilities()
        .catch(() => {})
        .finally(() => setVulnLoading(false));
    });
  }, [id, scan, page, severityFilter, pkgFilter, cveFilter, minCvss, hasFix, sortBy, sortDir]);

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

  const selectTriggerCls = heroSelectTriggerClassName;

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
          <Link
            href="/public/scan/image"
            className="text-accent dark:text-accent text-sm hover:underline"
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

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 94%, #07111b) 0%, var(--background) 38%, color-mix(in srgb, var(--background) 97%, #05070c) 100%)'
            : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 90%, #f4f8fd) 0%, var(--background) 38%, color-mix(in srgb, var(--background) 95%, #eef4fa) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45] dark:opacity-[0.32]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--accent) 28%, transparent) 1.15px, transparent 0), linear-gradient(180deg, color-mix(in srgb, var(--foreground) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 3%, transparent) 1px, transparent 1px)',
          backgroundPosition: 'center top, center top, center top',
          backgroundSize: '24px 24px, 24px 24px, 24px 24px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(circle at 16% 12%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 20%), radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 22%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 24%)'
            : 'radial-gradient(circle at 16% 12%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 18%), radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 20%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 22%)',
        }}
      />

      <section className="relative z-10 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 84%, #05111c) 0%, color-mix(in srgb, var(--background) 52%, transparent) 70%, transparent 100%)'
              : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 78%, #edf7ff) 0%, color-mix(in srgb, var(--background) 46%, transparent) 70%, transparent 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            background:
              'radial-gradient(circle at 68% 24%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 24%)',
          }}
        />

        <div className="sticky top-0 z-20">
          <PublicNavbar
            isDark={isDark}
            isLoggedIn={isLoggedIn}
            onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
            homeHref="/public/scan/image"
          />
        </div>

        <main className="relative z-10 mx-auto w-full max-w-[1800px] px-6 pb-16 pt-8 lg:px-8">
          <div className="space-y-6">
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

            <Card className="overflow-hidden rounded-[2rem] border border-divider/60 bg-surface/40 p-5 shadow-sm backdrop-blur sm:p-6">
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip color="accent" size="sm" variant="soft">
                      Public image scan
                    </Chip>
                    <Chip color={statusTone.color} size="sm" variant="soft">
                      {statusTone.label}
                    </Chip>
                    <Chip size="sm" variant="secondary">
                      {providerLabel}
                    </Chip>
                  </div>
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
                        onPress={() =>
                          router.push(`/public/scan/helm/runs/${scan.helm_scan_run_id}`)
                        }
                        variant="secondary"
                      >
                        <ArrowLeft01Icon size={15} />
                        Back to Helm run
                      </Button>
                    )}
                    {(scan?.status === 'completed' || isBlockedByXrayPolicy) && (
                      <Button
                        className="btn-secondary"
                        onPress={() =>
                          window.open(`/reports/print?scans=${id}`, '_blank', 'noopener,noreferrer')
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
                          <span className="size-3.5 rounded-full border-2 border-accent-400/30 border-t-accent-400 animate-spin" />
                        ) : (
                          <Refresh01Icon size={15} />
                        )}
                        Re-scan
                      </Button>
                    )}
                  </div>
                </div>

                <div className="min-w-0 space-y-1.5">
                  <h1
                    className="break-words text-2xl font-semibold tracking-tight text-foreground sm:text-[2rem]"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {imageName}
                  </h1>
                  {scan?.image_digest ? (
                    <div
                      className="break-words font-mono text-xs text-muted"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {scan.image_digest}
                    </div>
                  ) : null}
                  {scan?.architecture ? (
                    <p
                      className="flex items-center gap-1 text-xs"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <CpuIcon size={12} />
                      {scan.architecture} · {scan.os_family} {scan.os_name}
                    </p>
                  ) : null}
                </div>
              </div>
            </Card>

            {isScanning && (
              <ScanningAnimation
                image={imageName}
                status={scan?.status ?? 'pending'}
                startedAt={scan?.started_at ?? null}
                scanProvider={scan?.scan_provider}
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
                  ]}
                  value={activeTab}
                  onChange={setActiveTab}
                />
              </div>
            )}

            {scan?.status === 'failed' && activeTab === 'overview' && !isBlockedByXrayPolicy && (
              <>
                <div
                  className="rounded-2xl px-6 py-5 text-center"
                  style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  <p className="text-red-500 dark:text-red-400 font-medium">Scan failed</p>
                  {scan.error_message && (
                    <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                      {scan.error_message}
                    </p>
                  )}
                  <Link
                    href="/public/scan/image"
                    className="inline-block mt-3 text-sm text-accent dark:text-accent hover:underline"
                  >
                    Try another image →
                  </Link>
                </div>
              </>
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
                    <button
                      key={label}
                      type="button"
                      className="w-full text-left transition-transform hover:scale-[1.01]"
                      onClick={() => {
                        setSeverityFilter((f) =>
                          f === label.toUpperCase() ? '' : label.toUpperCase()
                        );
                        setPage(1);
                      }}
                    >
                      <StatCard
                        label={label}
                        value={count ?? 0}
                        icon={<Bug02Icon size={16} />}
                        iconTone={
                          label === 'Critical'
                            ? 'danger'
                            : label === 'High'
                              ? 'warning'
                              : label === 'Medium'
                                ? 'accent'
                                : 'default'
                        }
                        hint={
                          severityFilter === label.toUpperCase()
                            ? 'Filter active'
                            : 'Click to filter the table'
                        }
                        className={`border ${border} bg-surface/50 shadow-sm backdrop-blur ${
                          severityFilter === label.toUpperCase()
                            ? 'ring-1 ring-accent/50'
                            : 'border-divider/60'
                        }`}
                        valueClassName={`text-2xl font-bold ${color}`}
                        hintStyle={{
                          color:
                            severityFilter === label.toUpperCase()
                              ? 'var(--accent)'
                              : 'var(--text-faint)',
                        }}
                      />
                    </button>
                  ))}
                </div>

                {/* Vulnerabilities */}
                <div className="space-y-3">
                  <div className="space-y-3">
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
                        <Select
                          value={severityFilter || '__all__'}
                          onChange={(value) => {
                            setSeverityFilter(String(value === '__all__' ? '' : (value ?? '')));
                            setPage(1);
                          }}
                        >
                          <Select.Trigger className={`${selectTriggerCls} h-11`}>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="__all__">All Severities</ListBox.Item>
                              <ListBox.Item id="CRITICAL">Critical</ListBox.Item>
                              <ListBox.Item id="HIGH">High</ListBox.Item>
                              <ListBox.Item id="MEDIUM">Medium</ListBox.Item>
                              <ListBox.Item id="LOW">Low</ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_150px_150px_120px_120px]">
                          <SearchField name="public-scan-vuln-search" className="w-full">
                            <SearchField.Group className="h-11">
                              <SearchField.SearchIcon />
                              <SearchField.Input
                                placeholder="Search package..."
                                value={pkgInput}
                                onChange={(event) => setPkgInput(event.target.value)}
                              />
                              <SearchField.ClearButton />
                            </SearchField.Group>
                          </SearchField>
                          <SearchField name="public-scan-vuln-cve-search" className="w-full">
                            <SearchField.Group className="h-11">
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
                            <Select.Trigger className={`${selectTriggerCls} h-11`}>
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
                              setSortDir(value === 'desc' ? 'desc' : 'asc');
                              setPage(1);
                            }}
                          >
                            <Select.Trigger className={`${selectTriggerCls} h-11`}>
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
                            className="w-full h-11"
                            containerClassName="w-full"
                          />
                          <Button
                            onPress={() => {
                              setHasFix(!hasFix);
                              setPage(1);
                            }}
                            className={`${hasFix ? 'btn-primary' : 'btn-secondary'} w-full h-11`}
                            variant={hasFix ? 'primary' : 'secondary'}
                          >
                            Has Fix
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Table */}
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                      background: 'var(--surface-bg)',
                      border: '1px solid var(--surface-border)',
                    }}
                  >
                    <Table>
                      <Table.ScrollContainer>
                        <Table.Content
                          aria-label="Public scan vulnerabilities"
                          className="min-w-[920px]"
                        >
                          <Table.Header>
                            {(
                              [
                                { label: 'CVE ID', key: 'vuln_id' },
                                { label: 'Package', key: 'pkg_name' },
                                { label: 'Installed', key: 'installed_version' },
                                { label: 'Fixed In', key: 'fixed_version' },
                                { label: 'Severity', key: 'severity' },
                                { label: 'CVSS', key: 'cvss_score' },
                              ] as { label: string; key: string }[]
                            ).map(({ label, key }) => {
                              const active = sortBy === key;
                              return (
                                <Table.Column key={key} isRowHeader={key === 'vuln_id'}>
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
                                      color: active ? 'var(--accent)' : 'var(--text-faint)',
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
                            {vulnLoading ? (
                              <Table.Row key="loading" id="loading">
                                <Table.Cell colSpan={6}>
                                  <div className="py-12 text-center">
                                    <div className="flex justify-center">
                                      <div
                                        className="size-6 rounded-full border-2 border-t-accent-500 animate-spin"
                                        style={{
                                          borderColor: 'var(--border-subtle)',
                                          borderTopColor: 'var(--accent)',
                                        }}
                                      />
                                    </div>
                                  </div>
                                </Table.Cell>
                              </Table.Row>
                            ) : vulns.length === 0 ? (
                              <Table.Row key="empty" id="empty">
                                <Table.Cell colSpan={6}>
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
                                    {v.vuln_id ? (
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <button
                                          type="button"
                                          onClick={() => openVulnerabilityDetails(v)}
                                          className="font-mono text-xs text-accent dark:text-accent hover:underline transition-colors"
                                        >
                                          {v.vuln_id}
                                        </button>
                                        <SourceBadge source={v.data_source} />
                                      </div>
                                    ) : (
                                      <span style={{ color: 'var(--text-faint)' }}>-</span>
                                    )}
                                  </Table.Cell>
                                  <Table.Cell
                                    className="font-mono text-xs"
                                    style={{ color: 'var(--text-secondary)' }}
                                  >
                                    {v.pkg_name}
                                  </Table.Cell>
                                  <Table.Cell
                                    className="font-mono text-xs"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    {v.installed_version}
                                  </Table.Cell>
                                  <Table.Cell className="font-mono text-xs text-emerald-600 dark:text-emerald-500">
                                    {v.fixed_version || (
                                      <span style={{ color: 'var(--text-faint)' }}>-</span>
                                    )}
                                  </Table.Cell>
                                  <Table.Cell>
                                    <SeverityBadge severity={v.severity} />
                                  </Table.Cell>
                                  <Table.Cell
                                    className="font-mono text-xs"
                                    style={{ color: 'var(--text-muted)' }}
                                  >
                                    {v.cvss_score ? v.cvss_score.toFixed(1) : '-'}
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
                    <div className="flex items-center justify-between">
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
                </div>

                {/* Sign-in CTA */}
                <div
                  className="rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 15%, transparent)',
                  }}
                >
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Want more features?
                    </p>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Sign in to track scans, add tags, suppress findings, and more.
                    </p>
                  </div>
                  <Link href="/login" className="btn-primary">
                    Sign in →
                  </Link>
                </div>
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
