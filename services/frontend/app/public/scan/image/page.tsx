'use client';
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
import { Button, Card, Chip, Input, Label, Select, ListBox } from '@/components/ui';
import { ArrowRight01Icon, Clock01Icon, IrisScanIcon, PackageIcon } from 'hugeicons-react';
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

function statusStyle(status: string): {
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

function HistoryRow({ record }: { record: PublicScanRecord }) {
  const router = useRouter();
  const st = statusStyle(record.status);
  const isActive = record.status === 'running' || record.status === 'pending';
  return (
    <div className="transition-colors hover:bg-muted/50">
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

        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Clock01Icon aria-hidden size={14} />
          <span>{timeAgo(record.created_at)}</span>
          <ArrowRight01Icon aria-hidden size={14} className="hidden sm:block" />
        </div>
      </button>
    </div>
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
    <Card className="gap-0 py-0">
      <Card.Header className="flex flex-row items-center justify-between gap-3 border-b p-4">
        <div>
          <Card.Title>Recent scans</Card.Title>
          <Card.Description>Saved on this device only.</Card.Description>
        </div>
        <Button onPress={onClear} size="sm" variant="tertiary">
          Clear history
        </Button>
      </Card.Header>
      <Card.Content className="divide-y p-0">
        {history.slice(0, HISTORY_DISPLAY_LIMIT).map((record) => (
          <HistoryRow key={record.id} record={record} />
        ))}
      </Card.Content>
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
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <Card className="gap-0 py-0">
            <Card.Header className="border-b p-5 sm:p-6">
              <Card.Title>New image scan</Card.Title>
              <Card.Description>Enter an image reference and choose its platform.</Card.Description>
            </Card.Header>
            <Card.Content className="p-5 sm:p-6">
              {isDisabled ? (
                <FormAlert title="Public scanning is unavailable" description={disabledMessage} />
              ) : (
                <form onSubmit={handleScan} className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="public-image-reference" className="text-sm font-medium">
                      Image reference
                    </label>
                    <Input
                      id="public-image-reference"
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="nginx:latest"
                      disabled={loading}
                      required
                      aria-describedby="public-image-hint"
                      variant="secondary"
                      className="w-full font-mono"
                    />
                    <p id="public-image-hint" className="text-xs text-muted-foreground">
                      Include a tag, such as ubuntu:22.04. Defaults to latest.
                    </p>
                  </div>
                  <Select
                    aria-label="Image platform"
                    value={selectedPlatformKey}
                    onChange={(value) =>
                      setPlatform(value === AUTO_PLATFORM_KEY ? '' : String(value ?? ''))
                    }
                    isDisabled={loading}
                  >
                    <Label>Platform</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {PLATFORMS.map((item) => (
                          <ListBox.Item
                            key={item.value || AUTO_PLATFORM_KEY}
                            id={item.value || AUTO_PLATFORM_KEY}
                          >
                            {item.label}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  {error ? <FormAlert title="Couldn’t start scan" description={error} /> : null}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                    <p className="text-xs text-muted-foreground">
                      {settings?.rate_limit_per_hour ?? 5} free scans per hour
                    </p>
                    <Button type="submit" isDisabled={loading || !input.trim()} isPending={loading}>
                      <IrisScanIcon size={16} aria-hidden />
                      {loading ? 'Starting scan…' : 'Scan image'}
                    </Button>
                  </div>
                </form>
              )}
            </Card.Content>
          </Card>
          <section aria-label="Recent public scans" className="min-w-0">
            {history.length > 0 ? (
              <HistoryDisclosure history={history} onClear={handleClearHistory} />
            ) : (
              <Card className="gap-0 py-0">
                <Card.Header className="border-b p-4">
                  <Card.Title>Recent scans</Card.Title>
                  <Card.Description>Saved on this device only.</Card.Description>
                </Card.Header>
                <Card.Content className="flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center">
                  <Clock01Icon size={24} aria-hidden className="mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium">No scans yet</p>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Start an image scan to see its status and findings here.
                  </p>
                </Card.Content>
              </Card>
            )}
          </section>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm">
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
