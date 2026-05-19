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
  PublicScanRecord,
  timeAgo,
  updatePublicHistoryEntry,
} from '@/lib/publicScanHistory';
import {
  Button,
  Card,
  Chip,
  Input,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from '@heroui/react';
import { IrisScanIcon, PackageIcon } from 'hugeicons-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy link"
      className="shrink-0 flex items-center justify-center size-6 rounded-md transition-all opacity-0 group-hover:opacity-100 hover:!opacity-100"
      style={{
        color: copied ? '#34d399' : 'var(--text-muted)',
        background: 'var(--surface-bg)',
        border: '1px solid var(--surface-border)',
      }}
    >
      {copied ? (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const PLATFORMS = [
  { value: '', label: 'Auto (detect)' },
  { value: 'linux/amd64', label: 'linux/amd64' },
  { value: 'linux/arm64', label: 'linux/arm64' },
  { value: 'linux/arm/v7', label: 'linux/arm/v7' },
  { value: 'windows/amd64', label: 'windows/amd64' },
];
const AUTO_PLATFORM_KEY = '__auto_platform__';

function statusStyle(status: string): { color: string; dot: string } {
  switch (status) {
    case 'completed':
      return { color: 'text-emerald-600 dark:text-emerald-400', dot: 'bg-emerald-500' };
    case 'failed':
      return { color: 'text-red-500 dark:text-red-400', dot: 'bg-red-500' };
    case 'running':
      return { color: 'text-blue-500 dark:text-blue-400', dot: 'bg-blue-400' };
    default:
      return { color: 'text-zinc-500', dot: 'bg-zinc-400' };
  }
}

function HistoryRow({ record }: { record: PublicScanRecord }) {
  const router = useRouter();
  const st = statusStyle(record.status);
  const isActive = record.status === 'running' || record.status === 'pending';
  const scanUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/public/scan/${record.id}`
      : `/public/scan/${record.id}`;
  return (
    <Card
      tabIndex={0}
      onClick={() => router.push(`/public/scan/${record.id}`)}
      className="hover:bg-surface-secondary"
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-sm font-medium truncate">
          {record.image_name}:{record.image_tag}
        </p>
        {record.platform && (
          <Chip variant="soft" color="accent">
            {record.platform}
          </Chip>
        )}
      </div>
      <Card.Footer className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-xs font-medium shrink-0 ${st.color}`}>
            <span
              className={`size-1.5 rounded-full ${st.dot} ${isActive ? 'animate-pulse' : ''}`}
            />
            {record.status}
          </div>

          {record.status === 'completed' && (
            <div className="hidden sm:flex items-center gap-2 shrink-0 text-xs font-mono">
              {record.critical_count > 0 && (
                <span className="text-red-500 dark:text-red-400">{record.critical_count}C</span>
              )}
              {record.high_count > 0 && (
                <span className="text-orange-500 dark:text-orange-400">{record.high_count}H</span>
              )}
              {record.medium_count > 0 && (
                <span className="text-yellow-600 dark:text-yellow-400">{record.medium_count}M</span>
              )}
              {record.low_count > 0 && (
                <span className="text-blue-500 dark:text-blue-400">{record.low_count}L</span>
              )}
              {record.critical_count === 0 &&
                record.high_count === 0 &&
                record.medium_count === 0 &&
                record.low_count === 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">Clean</span>
                )}
            </div>
          )}
        </div>

        <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)' }}>
          {timeAgo(record.created_at)}
        </span>
      </Card.Footer>
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
    setHistory(getPublicHistory());
    inputRef.current?.focus();
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
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--app-bg)', color: 'var(--text-primary)' }}
    >
      {/* Animated background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <style>{`
          @keyframes gridDrift {
            0%   { background-position: 0 0; }
            100% { background-position: 40px 40px; }
          }
          @keyframes sweepBeam {
            0%   { transform: translateY(-100vh); opacity: 0; }
            5%   { opacity: 1; }
            95%  { opacity: 1; }
            100% { transform: translateY(100vh); opacity: 0; }
          }
        `}</style>
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 size-[600px] rounded-full"
          style={{
            background: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 65%)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 9%, transparent) 0%, transparent 65%)',
          }}
        />
        <div
          className="absolute bottom-0 right-1/4 size-[400px] rounded-full"
          style={{
            background: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 65%)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 5%, transparent) 0%, transparent 65%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: isDark
              ? 'radial-gradient(circle, color-mix(in srgb, var(--accent) 12%, transparent) 1px, transparent 1px)'
              : 'radial-gradient(circle, color-mix(in srgb, var(--accent) 7%, transparent) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            animation: 'gridDrift 14s linear infinite',
          }}
        />
        <div
          className="absolute inset-x-0 h-px"
          style={{
            background: isDark
              ? 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 35%, transparent), color-mix(in srgb, var(--accent) 45%, transparent), color-mix(in srgb, var(--accent) 35%, transparent), transparent)'
              : 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 18%, transparent), color-mix(in srgb, var(--accent) 25%, transparent), color-mix(in srgb, var(--accent) 18%, transparent), transparent)',
            animation: 'sweepBeam 9s ease-in-out infinite',
            animationDelay: '1.5s',
            top: 0,
          }}
        />
      </div>

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

      <main className="relative z-10 flex-1 flex flex-col items-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-8 my-auto">
          {/* Hero */}
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Logo size={48} className="text-white" />
            </div>
            <div>
              <h1
                className="text-3xl sm:text-4xl font-bold tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Scan any Docker image{' '}
                <span
                  style={{
                    background:
                      'linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, white), var(--accent))',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  instantly
                </span>
              </h1>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                No account needed · {settings?.rate_limit_per_hour ?? 5} free scans per hour
              </p>
            </div>
          </div>

          {/* Form */}
          {isDisabled ? (
            <div
              className="rounded-2xl px-6 py-5 text-center"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
              }}
            >
              <p className="text-red-500 dark:text-red-400 font-medium">
                Public scanning is temporarily disabled
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                {disabledMessage}
              </p>
            </div>
          ) : (
            <form onSubmit={handleScan} className="space-y-2">
              <div
                className="flex items-center gap-2 p-2 rounded-2xl"
                style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--surface-border)',
                  boxShadow: 'var(--surface-shadow)',
                }}
              >
                <IrisScanIcon size={28} />
                <Input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="nginx:latest  or  ubuntu:22.04"
                  disabled={loading}
                  aria-label="Docker image"
                  variant="secondary"
                  className="flex-1 text-base font-mono"
                />
                <Button type="submit" isDisabled={loading || !input.trim()} size="lg">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Starting…
                    </span>
                  ) : (
                    'Scan'
                  )}
                </Button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  Platform:
                </span>
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
            </form>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Your recent scans
                </h2>
                <Button onClick={handleClearHistory} variant="tertiary">
                  Clear history
                </Button>
              </div>
              <div
                className="rounded-2xl overflow-hidden space-y-px p-2"
                style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--surface-border)',
                }}
              >
                {history.map((record) => (
                  <HistoryRow key={record.id} record={record} />
                ))}
              </div>
              <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                Stored locally on this device · Sign in to keep scans permanently
              </p>
            </div>
          )}
        </div>
      </main>

      <footer
        className="relative z-10 text-center py-6 text-xs"
        style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}
      >
        JustScan · Self-hosted image vulnerability scanner
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
