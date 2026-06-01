'use client';
import { Logo } from '@/components/logo';
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
import {
  Button,
  Card,
  Chip,
  Disclosure,
  Input,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from '@heroui/react';
import {
  ArrowRight01Icon,
  Clock01Icon,
  IrisScanIcon,
  PackageIcon,
} from 'hugeicons-react';
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

function statusStyle(
  status: string
): { color: 'success' | 'danger' | 'accent' | 'warning'; label: string } {
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

function HistoryRow({ record }: { record: PublicScanRecord }) {
  const router = useRouter();
  const st = statusStyle(record.status);
  const isActive = record.status === 'running' || record.status === 'pending';
  return (
    <Card className="border border-divider/50 bg-background/55 transition-colors hover:border-accent/30 hover:bg-background/75">
      <button
        type="button"
        onClick={() => router.push(`/public/scan/${record.id}`)}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground">
              {record.image_name}:{record.image_tag}
            </p>
            {record.platform && (
              <Chip color="accent" size="sm" variant="soft">
                {record.platform}
              </Chip>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Chip color={st.color} size="sm" variant="soft">
              <span
                className={`mr-1.5 inline-block size-1.5 rounded-full bg-current ${
                  isActive ? 'animate-pulse' : ''
                }`}
              />
              {st.label}
            </Chip>

            {record.status === 'completed' && (
              <>
                {record.critical_count > 0 && (
                  <Chip color="danger" size="sm" variant="soft">
                    {record.critical_count} critical
                  </Chip>
                )}
                {record.high_count > 0 && (
                  <Chip color="warning" size="sm" variant="soft">
                    {record.high_count} high
                  </Chip>
                )}
                {record.medium_count > 0 && (
                  <Chip color="accent" size="sm" variant="soft">
                    {record.medium_count} medium
                  </Chip>
                )}
                {record.low_count > 0 && (
                  <Chip size="sm" variant="soft">
                    {record.low_count} low
                  </Chip>
                )}
                {record.critical_count === 0 &&
                  record.high_count === 0 &&
                  record.medium_count === 0 &&
                  record.low_count === 0 && (
                    <Chip color="success" size="sm" variant="soft">
                      Clean
                    </Chip>
                  )}
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
          <Clock01Icon aria-hidden size={14} />
          <span>{timeAgo(record.created_at)}</span>
          <ArrowRight01Icon aria-hidden size={14} className="hidden sm:block" />
        </div>
      </button>
    </Card>
  );
}

function HistoryDisclosure({
  history,
  onClear,
}: {
  history: PublicScanRecord[];
  onClear: () => void;
}) {
  return (
    <Card className="border border-divider/60 bg-surface/40 p-2 shadow-sm backdrop-blur">
      <Disclosure className="rounded-[1.5rem]">
        <Disclosure.Heading>
          <Disclosure.Trigger className="flex w-full items-center justify-between gap-4 rounded-[1.25rem] px-4 py-3 text-left transition-colors hover:bg-background/45">
            <div>
              <p className="text-sm font-semibold text-foreground">Recent scans on this device</p>
              <p className="mt-1 text-xs text-muted">
                {history.length} saved locally. Older and stale entries are cleaned up
                automatically.
              </p>
            </div>
            <Disclosure.Indicator />
          </Disclosure.Trigger>
        </Disclosure.Heading>
        <Disclosure.Content>
          <Disclosure.Body className="space-y-3 px-2 pb-2 pt-3">
            <div className="grid gap-3">
              {history.slice(0, HISTORY_DISPLAY_LIMIT).map((record) => (
                <HistoryRow key={record.id} record={record} />
              ))}
            </div>

            <div className="flex flex-col gap-3 rounded-[1.25rem] border border-divider/50 bg-background/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted">
                Local history is temporary. Sign in when you want permanent scan history and
                shared workflows.
              </p>
              <div className="flex items-center gap-2">
                <Link href="/login">
                  <Button size="sm" variant="secondary">
                    Sign in
                  </Button>
                </Link>
                <Button onPress={onClear} size="sm" variant="tertiary">
                  Clear history
                </Button>
              </div>
            </div>
          </Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>
    </Card>
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
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 92%, #07111b) 0%, var(--background) 42%, color-mix(in srgb, var(--background) 96%, #05070c) 100%)'
            : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 88%, #f4f8fd) 0%, var(--background) 42%, color-mix(in srgb, var(--background) 94%, #eef4fa) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55] dark:opacity-[0.42]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--accent) 34%, transparent) 1.15px, transparent 0), linear-gradient(180deg, color-mix(in srgb, var(--foreground) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 4%, transparent) 1px, transparent 1px)',
          backgroundPosition: 'center top, center top, center top',
          backgroundSize: '24px 24px, 24px 24px, 24px 24px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: isDark
            ? 'radial-gradient(circle at 50% 10%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 26%), radial-gradient(circle at 50% 54%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 24%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 22%)'
            : 'radial-gradient(circle at 50% 8%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 22%), radial-gradient(circle at 50% 54%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 20%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 18%)',
        }}
      />
      <section className="relative z-10 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, color-mix(in srgb, var(--background) 82%, #05111c) 0%, color-mix(in srgb, var(--background) 50%, transparent) 72%, transparent 100%)'
              : 'linear-gradient(180deg, color-mix(in srgb, var(--background) 76%, #edf7ff) 0%, color-mix(in srgb, var(--background) 44%, transparent) 72%, transparent 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-45"
          style={{
            background:
              'radial-gradient(circle at 64% 48%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 28%)',
          }}
        />

        <PublicNavbar
          isDark={isDark}
          isLoggedIn={isLoggedIn}
          onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
          alternateAction={{
            href: '/public/scan/helm',
            label: 'Scan Helm',
            icon: <PackageIcon size={16} />,
          }}
        />

        <main className="relative z-10 mx-auto flex min-h-[calc(100svh-76px)] max-w-5xl items-center px-6 pb-16 pt-8">
          <div className="w-full space-y-8">
            <div className="mx-auto max-w-2xl text-center">
              <div className="flex justify-center">
                <Logo size={40} />
              </div>

              <div className="mt-5">
                <Chip color="accent" variant="soft">
                  Public image scanning
                </Chip>
              </div>

              <div className="mt-5 space-y-4">
                <h1 className="text-4xl font-semibold leading-tight tracking-normal text-foreground sm:text-5xl">
                  Scan a Docker image instantly.
                </h1>
                <p className="mx-auto max-w-xl text-sm leading-7 text-muted sm:text-base">
                  No account needed. Start with a public scan now, then sign in later if you want
                  saved history, exports, and team workflows.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted">
                <span>{settings?.rate_limit_per_hour ?? 5} free scans per hour</span>
                <span>Platform-aware scanning</span>
                <span>Local recent history</span>
              </div>
            </div>

            <div className="mx-auto w-full max-w-3xl">
              <Card className="overflow-hidden rounded-[2rem] border border-divider/60 bg-surface/50 px-5 py-5 shadow-sm backdrop-blur sm:px-6 sm:py-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Scan Docker image</p>
                      <p className="mt-1 text-sm text-muted">
                        Fast public scans without the signup wall.
                      </p>
                    </div>
                    <Link href="/public/scan/helm" className="hidden sm:block">
                      <Button size="sm" variant="tertiary">
                        <PackageIcon size={16} />
                        Scan Helm
                      </Button>
                    </Link>
                  </div>

                  {isDisabled ? (
                    <div
                      className="rounded-[1.25rem] px-5 py-4"
                      style={{
                        background: 'rgba(239,68,68,0.08)',
                        border: '1px solid rgba(239,68,68,0.2)',
                      }}
                    >
                      <p className="font-medium text-red-500 dark:text-red-400">
                        Public scanning is temporarily disabled
                      </p>
                      <p className="mt-1 text-sm text-muted">{disabledMessage}</p>
                    </div>
                  ) : (
                    <form onSubmit={handleScan} className="space-y-4">
                      <div className="flex flex-col gap-3 rounded-[1.25rem] border border-divider/60 px-4 py-4 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-3 text-muted">
                          <IrisScanIcon size={20} />
                          <span className="text-xs font-medium uppercase tracking-[0.18em]">
                            Image
                          </span>
                        </div>
                        <Input
                          ref={inputRef}
                          type="text"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          placeholder="nginx:latest  or  ubuntu:22.04"
                          disabled={loading}
                          aria-label="Docker image"
                          variant="secondary"
                          className="flex-1 font-mono text-base"
                        />
                        <Button
                          type="submit"
                          isDisabled={loading || !input.trim()}
                          isPending={loading}
                          size="lg"
                        >
                          {loading ? 'Starting scan…' : 'Scan now'}
                        </Button>
                      </div>

                      <div className="space-y-2 border-t border-divider/50 pt-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                            Platform
                          </span>
                          <span className="text-xs text-muted">Optional</span>
                        </div>
                        <ToggleButtonGroup
                          selectionMode="single"
                          selectedKeys={[selectedPlatformKey]}
                          disallowEmptySelection
                          onSelectionChange={(keys) => {
                            const key = Array.from(keys)[0] as Key | undefined;
                            const next = key ? String(key) : AUTO_PLATFORM_KEY;
                            setPlatform(next === AUTO_PLATFORM_KEY ? '' : next);
                          }}
                          size="sm"
                          className="font-mono"
                        >
                          {PLATFORMS.map((p, i) => (
                            <ToggleButton
                              key={p.value || AUTO_PLATFORM_KEY}
                              id={p.value || AUTO_PLATFORM_KEY}
                              className="text-xs"
                            >
                              {i > 0 ? <ToggleButtonGroup.Separator /> : null}
                              {p.label}
                            </ToggleButton>
                          ))}
                        </ToggleButtonGroup>
                      </div>

                      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

                      <div className="flex flex-col gap-3 border-t border-divider/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-muted">
                          Sign in later if you want saved history, SBOM exports, and shared workflows.
                        </p>
                        <Link href="/login">
                          <Button size="sm" variant="secondary">
                            Sign in
                          </Button>
                        </Link>
                      </div>
                    </form>
                  )}

                  {history.length > 0 ? (
                    <div className="border-t border-divider/50 pt-4">
                      <HistoryDisclosure history={history} onClear={handleClearHistory} />
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>
          </div>
        </main>
      </section>

      <footer className="relative z-10 px-6 pb-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 rounded-[2rem] border border-divider/50 bg-surface/35 px-6 py-5 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>JustScan keeps the public path fast, then grows with you when scans need to be shared.</p>
          <Link href={isLoggedIn ? '/scans' : '/login'}>
            <Button variant="secondary">
              {isLoggedIn ? 'Open dashboard' : 'Create workspace'}
              <ArrowRight01Icon aria-hidden size={16} />
            </Button>
          </Link>
        </div>
      </footer>
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
