'use client';
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot';
import { Select as PanelSelect } from '@/components/panelui/select';
import { PublicNavbar } from '@/components/public/public-navbar';
import {
  createPublicScan,
  getPublicScan,
  getPublicSettings,
  getToken,
  PublicSettings,
  Scan,
} from '@/lib/api';
import {
  addToPublicHistory,
  clearPublicHistory,
  getPublicHistory,
  markStalePublicHistoryEntries,
  PublicScanRecord,
  timeAgo,
  updatePublicHistoryEntry,
} from '@/lib/publicScanHistory';
import { Button } from '@/components/ui';
import { ArrowRight01Icon, IrisScanIcon, PackageIcon, Search01Icon } from 'hugeicons-react';
import { FormAlert } from '@/components/ui/form-alert';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const PLATFORMS = [
  { value: '', label: 'Auto (detect)' },
  { value: 'linux/amd64', label: 'linux/amd64' },
  { value: 'linux/arm64', label: 'linux/arm64' },
  { value: 'linux/arm/v7', label: 'linux/arm/v7' },
  { value: 'windows/amd64', label: 'windows/amd64' },
];
const AUTO_PLATFORM_KEY = '__auto_platform__';
const HISTORY_DISPLAY_LIMIT = 6;

const EXAMPLE_IMAGES = ['nginx:latest', 'ubuntu:22.04', 'python:3.12', 'node:22-alpine'];

function statusTone(status: string): StatusDotTone {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'running':
      return 'accent';
    default:
      return 'warning';
  }
}

function HistoryRow({ record }: { record: PublicScanRecord }) {
  const router = useRouter();
  const active = record.status === 'running' || record.status === 'pending';
  const findings = [
    record.critical_count > 0
      ? { text: `${record.critical_count} critical`, className: 'text-destructive' }
      : null,
    record.high_count > 0
      ? { text: `${record.high_count} high`, className: 'text-warning-foreground' }
      : null,
    record.medium_count > 0 ? { text: `${record.medium_count} medium`, className: '' } : null,
    record.low_count > 0 ? { text: `${record.low_count} low`, className: '' } : null,
  ].filter((item): item is { text: string; className: string } => item !== null);

  return (
    <li>
      <button
        type="button"
        onClick={() => router.push(`/public/scan/${record.id}`)}
        className="group flex w-full items-center gap-3 px-1 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 sm:px-3"
      >
        <StatusDot
          tone={statusTone(record.status)}
          className={active ? 'animate-pulse' : undefined}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-sm font-medium text-foreground">
            {record.image_name}:{record.image_tag}
            {record.platform ? (
              <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">
                {record.platform}
              </span>
            ) : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {record.status === 'completed' ? (
              findings.length > 0 ? (
                findings.map((item, index) => (
                  <span key={item.text} className={item.className}>
                    {index > 0 ? ' · ' : ''}
                    {item.text}
                  </span>
                ))
              ) : (
                <span className="text-success-foreground">No known vulnerabilities</span>
              )
            ) : record.status === 'failed' ? (
              'Scan failed'
            ) : record.status === 'running' ? (
              'Scanning…'
            ) : (
              'Queued'
            )}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(record.created_at)}</span>
        <ArrowRight01Icon
          aria-hidden
          size={14}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    </li>
  );
}

function HistoryList({ history, onClear }: { history: PublicScanRecord[]; onClear: () => void }) {
  return (
    <section aria-label="Recent public scans">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-medium">Recent scans</h2>
          <span className="text-xs text-muted-foreground">Saved on this device only</span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Clear history
        </button>
      </div>
      <ul className="divide-y divide-border">
        {history.slice(0, HISTORY_DISPLAY_LIMIT).map((record) => (
          <HistoryRow key={record.id} record={record} />
        ))}
      </ul>
    </section>
  );
}

export default function PublicImageScanPage() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [history, setHistory] = useState<PublicScanRecord[]>([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isDark = mounted && resolvedTheme === 'dark';

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setIsLoggedIn(!!getToken());
    getPublicSettings()
      .then(setSettings)
      .catch(() =>
        setSettings({ enabled: true, rate_limit_per_hour: 5, local_scan_available: true })
      );
    setHistory(markStalePublicHistoryEntries());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialHistory = getPublicHistory();
    const active = initialHistory.filter((s) => s.status === 'pending' || s.status === 'running');
    if (active.length === 0) return;

    Promise.all(
      active.map(async (record) => {
        try {
          const fresh = await getPublicScan(record.id);
          updatePublicHistoryEntry(record.id, {
            status: fresh.status,
            critical_count: fresh.critical_count,
            high_count: fresh.high_count,
            medium_count: fresh.medium_count,
            low_count: fresh.low_count,
            unknown_count: fresh.unknown_count,
          });
        } catch {
          /* ignore */
        }
      })
    ).then(() => {
      if (!cancelled) {
        setHistory(markStalePublicHistoryEntries());
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);

    const active = history.filter((s) => s.status === 'pending' || s.status === 'running');
    if (active.length === 0) return;

    pollRef.current = setInterval(async () => {
      let anyChange = false;
      await Promise.all(
        active.map(async (record) => {
          try {
            const fresh = await getPublicScan(record.id);
            if (fresh.status !== record.status) {
              updatePublicHistoryEntry(record.id, {
                status: fresh.status,
                critical_count: fresh.critical_count,
                high_count: fresh.high_count,
                medium_count: fresh.medium_count,
                low_count: fresh.low_count,
                unknown_count: fresh.unknown_count,
              });
              anyChange = true;
            }
          } catch {
            /* ignore */
          }
        })
      );
      if (anyChange) setHistory(getPublicHistory());
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [history]);

  async function handleScan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const trimmed = input.trim();
    if (!trimmed) return;
    const colonIdx = trimmed.lastIndexOf(':');
    let image = trimmed;
    let tag = 'latest';
    if (colonIdx > 0 && !trimmed.includes(':/')) {
      image = trimmed.slice(0, colonIdx);
      tag = trimmed.slice(colonIdx + 1) || 'latest';
    }
    setLoading(true);
    try {
      const scan = await createPublicScan(image, tag, platform || undefined);
      addToPublicHistory(scanToRecord(scan, platform));
      setHistory(getPublicHistory());
      router.push(`/public/scan/${scan.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
      setLoading(false);
    }
  }

  function handleClearHistory() {
    clearPublicHistory();
    setHistory([]);
  }

  const isDisabled =
    settings !== null && (!settings.enabled || settings.local_scan_available === false);
  const disabledMessage =
    settings?.disabled_reason ||
    'The administrator has disabled this feature. Please check back later.';
  const selectedPlatformKey = platform || AUTO_PLATFORM_KEY;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicNavbar
        title="Scan a container image"
        isDark={isDark}
        isLoggedIn={isLoggedIn}
        onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
        alternateAction={{
          href: '/public/scan/helm',
          label: 'Scan Helm',
          icon: <PackageIcon size={16} />,
          hideOnMobile: true,
        }}
      />
      <main className="mx-auto w-full max-w-2xl space-y-10 px-4 py-12 sm:py-20">
        <div className="space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Find vulnerabilities in any public image
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Enter an image and get its known vulnerabilities in a minute. No account needed.
            </p>
          </div>

          {isDisabled ? (
            <FormAlert title="Public scanning is unavailable" description={disabledMessage} />
          ) : (
            <form onSubmit={handleScan} className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl border border-input bg-background p-1.5 shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30 dark:bg-input/30">
                <Search01Icon
                  aria-hidden
                  size={18}
                  className="ml-2.5 shrink-0 text-muted-foreground"
                />
                <input
                  id="public-image-reference"
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="nginx:latest"
                  aria-label="Image reference"
                  aria-describedby="public-image-hint"
                  disabled={loading}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className="h-10 min-w-0 flex-1 bg-transparent px-1 font-mono text-base text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
                />
                <Button type="submit" isDisabled={loading || !input.trim()} isPending={loading}>
                  <IrisScanIcon size={16} aria-hidden />
                  {loading ? 'Starting…' : 'Scan'}
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span>Platform</span>
                  <PanelSelect
                    items={PLATFORMS.map((item) => ({
                      value: item.value || AUTO_PLATFORM_KEY,
                      label: item.label,
                    }))}
                    value={selectedPlatformKey}
                    onValueChange={(value) =>
                      setPlatform(value === AUTO_PLATFORM_KEY ? '' : String(value ?? ''))
                    }
                    disabled={loading}
                  >
                    <PanelSelect.Trigger variant="ghost" size="sm" aria-label="Image platform">
                      <PanelSelect.Value />
                    </PanelSelect.Trigger>
                    <PanelSelect.Content>
                      {PLATFORMS.map((item) => (
                        <PanelSelect.Item
                          key={item.value || AUTO_PLATFORM_KEY}
                          value={item.value || AUTO_PLATFORM_KEY}
                        >
                          {item.label}
                        </PanelSelect.Item>
                      ))}
                    </PanelSelect.Content>
                  </PanelSelect>
                </div>
                <p id="public-image-hint">
                  Include a tag, such as ubuntu:22.04, or it defaults to latest ·{' '}
                  {settings?.rate_limit_per_hour ?? 5} free scans per hour
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Try</span>
                {EXAMPLE_IMAGES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setInput(example);
                      inputRef.current?.focus();
                    }}
                    className="rounded-md border border-border px-2 py-1 font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>

              {error ? <FormAlert title="Couldn’t start scan" description={error} /> : null}
            </form>
          )}
        </div>

        {history.length > 0 ? <HistoryList history={history} onClear={handleClearHistory} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-sm">
          <p className="text-muted-foreground">Need saved history, exports, and team workflows?</p>
          <Link
            href={isLoggedIn ? '/scans' : '/login'}
            className="inline-flex items-center gap-1 font-medium hover:underline"
          >
            {isLoggedIn ? 'Open dashboard' : 'Sign in'}
            <ArrowRight01Icon size={14} aria-hidden />
          </Link>
        </div>
      </main>
    </div>
  );
}

function scanToRecord(scan: Scan, platform: string): PublicScanRecord {
  return {
    id: scan.id,
    image_name: scan.image_name,
    image_tag: scan.image_tag,
    platform: platform || undefined,
    status: scan.status,
    critical_count: scan.critical_count ?? 0,
    high_count: scan.high_count ?? 0,
    medium_count: scan.medium_count ?? 0,
    low_count: scan.low_count ?? 0,
    unknown_count: scan.unknown_count ?? 0,
    created_at: scan.created_at,
  };
}
