'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
    addTagToScan,
    AdminScan,
    AdminToken,
    AdminUser,
    AuditLog,
    AuditLogFilters,
    AutoTagRule,
    cancelScan,
    createAdminUser,
    createAutoTagRule,
    createNotificationChannel,
    createShare,
    deleteAdminToken,
    deleteAdminUser,
    deleteAutoTagRule,
    deleteNotificationChannel,
    deleteShare,
    disableAdminUser,
    getAdminSettings,
    getScannerHealth,
    listAdminScans,
    listAdminTokens,
    listAdminUsers,
    listAuditLogs,
    listAutoTagRules,
    listNotificationChannels,
    listNotificationDeliveries,
    listOrgs,
    listTags,
    NotificationChannel,
    NotificationDelivery,
    Org,
    reScan,
    ScannerHealth,
    setPublicScanEnabled,
    Tag,
    testNotificationChannel,
    updateAdminToken,
    updateAdminUser,
    updateAutoTagRule,
    updateNotificationChannel,
    updateRateLimit,
    updateRegisterRateLimit,
} from '@/lib/api';
import { APP_COPYRIGHT, APP_FRONTEND_VERSION } from '@/lib/build-info';
import { fullDate, timeAgo } from '@/lib/time';
import { Input, Label, ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { ArrowDown01Icon, ArrowRight01Icon, Delete01Icon, Notification01Icon, PencilEdit01Icon, PlusSignIcon, Shield01Icon, Tag01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

const inputCls = nativeFieldClassName;
const selectTriggerCls = heroSelectTriggerClassName;

const USER_AUTH_LABEL: Record<string, string> = {
  local: 'Local',
  oidc: 'OIDC',
};

const USER_AUTH_STYLE: Record<string, React.CSSProperties> = {
  local: { color: '#60a5fa', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' },
  oidc: { color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' },
};

function userAuthLabel(authType?: string) {
  return USER_AUTH_LABEL[authType ?? 'local'] ?? (authType ? authType.toUpperCase() : 'Unknown');
}

type AdminTab = 'overview' | 'settings' | 'scanner' | 'users' | 'tokens' | 'autotags' | 'audit' | 'notifications' | 'scans';

const ADMIN_TABS: { value: AdminTab; label: string; href: string }[] = [
  { value: 'overview', label: 'Overview', href: '/admin' },
  { value: 'settings', label: 'Settings', href: '/admin/settings' },
  { value: 'scanner', label: 'Scanner', href: '/admin/scanner' },
  { value: 'users', label: 'Users', href: '/admin/users' },
  { value: 'tokens', label: 'Tokens', href: '/admin/tokens' },
  { value: 'autotags', label: 'Auto Tags', href: '/admin/autotags' },
  { value: 'audit', label: 'Audit Log', href: '/admin/audit' },
  { value: 'notifications', label: 'Notifications', href: '/admin/notifications' },
  { value: 'scans', label: 'Scans', href: '/admin/scans' },
];

function resolveAdminTab(pathname: string): AdminTab {
  const match = ADMIN_TABS.find((tab) => tab.href === '/admin' ? pathname === '/admin' : pathname.startsWith(tab.href));
  return match?.value ?? 'overview';
}

function toIsoOrUndefined(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function formatDbAge(hours?: number | null): string {
  if (hours == null || Number.isNaN(hours)) return 'Unknown';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function scannerTone(status: 'healthy' | 'stale' | 'error') {
  if (status === 'healthy') {
    return { color: '#34d399', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)' };
  }
  if (status === 'stale') {
    return { color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' };
  }
  return { color: '#f87171', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)' };
}

function ScannerHealthPanel() {
  const [health, setHealth] = useState<ScannerHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setHealth(await getScannerHealth());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load scanner health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Scanner Health</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Live worker cache status from the current backend instance.</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {health && (
        <>
          {!health.local_scanner_enabled ? (
            <div className="rounded-xl px-4 py-4 text-sm" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
              <p className="font-medium text-zinc-800 dark:text-zinc-100">Local scanner is disabled.</p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{health.message || 'This backend instance is running without the built-in local scanner.'}</p>
              <p className="mt-2 text-xs text-zinc-500">Grype augmentation: {health.grype_enabled ? 'enabled' : 'disabled'}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Healthy Workers', value: health.healthy_workers, color: '#34d399', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.18)' },
                  { label: 'Stale Workers', value: health.stale_workers, color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.18)' },
                  { label: 'Oldest Vuln DB Snapshot', value: formatDbAge(health.oldest_vuln_db_age_hours), color: '#60a5fa', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.18)' },
                  { label: 'Oldest Java DB Snapshot', value: formatDbAge(health.oldest_java_db_age_hours), color: '#a78bfa', bg: 'rgba(124,58,237,0.1)', border: 'rgba(124,58,237,0.18)' },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl p-4" style={{ background: item.bg, border: `1px solid ${item.border}` }}>
                    <p className="text-xs text-zinc-500 mb-1">{item.label}</p>
                    <p className="text-lg font-bold" style={{ color: item.color }}>{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl px-4 py-3 text-xs text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                Status is based on when each worker last downloaded its local DB copy. A worker is healthy if it downloaded within the last {health.max_allowed_age_hours}h.
              </div>

              <div className="space-y-2">
                {health.workers.map((worker) => {
                  const tone = scannerTone(worker.status);
                  return (
                    <div key={worker.worker_id} className="rounded-xl p-4 space-y-2" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.border}` }}>
                            Worker {worker.worker_id}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize" style={{ color: tone.color, background: tone.bg, border: `1px solid ${tone.border}` }}>
                            {worker.status}
                          </span>
                          <span className="text-xs text-zinc-500">Trivy {worker.trivy_version || 'unknown'}</span>
                        </div>
                        <span className="text-xs text-zinc-500" title={worker.cache_dir}>{worker.cache_dir}</span>
                      </div>
                      <div className="grid md:grid-cols-2 gap-3 text-xs">
                        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                          <p className="text-zinc-500 mb-1">Vulnerability DB</p>
                          <p className="text-zinc-700 dark:text-zinc-200">Snapshot age: {formatDbAge(worker.vuln_db_age_hours)}</p>
                          <p className="text-zinc-500 mt-1">Updated: {worker.vuln_db_updated_at ? fullDate(worker.vuln_db_updated_at) : 'Unknown'}</p>
                          <p className="text-zinc-500">Downloaded: {worker.vuln_db_downloaded_at ? fullDate(worker.vuln_db_downloaded_at) : 'Unknown'}</p>
                        </div>
                        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                          <p className="text-zinc-500 mb-1">Java DB</p>
                          <p className="text-zinc-700 dark:text-zinc-200">Snapshot age: {formatDbAge(worker.java_db_age_hours)}</p>
                          <p className="text-zinc-500 mt-1">Updated: {worker.java_db_updated_at ? fullDate(worker.java_db_updated_at) : 'Unknown'}</p>
                          <p className="text-zinc-500">Downloaded: {worker.java_db_downloaded_at ? fullDate(worker.java_db_downloaded_at) : 'Unknown'}</p>
                        </div>
                      </div>
                      {worker.error && <p className="text-xs" style={{ color: '#f87171' }}>{worker.error}</p>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────
function SettingsTab() {
  const [publicScanEnabled, setPublicScanEnabledState] = useState<boolean | null>(null);
  const [rateLimit, setRateLimitState] = useState<number>(5);
  const [rateLimitInput, setRateLimitInput] = useState('5');
  const [registerRateLimit, setRegisterRateLimitState] = useState<number>(10);
  const [registerRateLimitInput, setRegisterRateLimitInput] = useState('10');
  const [saving, setSaving] = useState(false);
  const [savingRl, setSavingRl] = useState(false);
  const [savingRegisterRl, setSavingRegisterRl] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getAdminSettings()
      .then(settings => {
        setPublicScanEnabledState(settings['public_scan_enabled'] !== 'false');
        const rl = parseInt(settings['public_scan_rate_limit'] ?? '5', 10);
        const registrationRl = parseInt(settings['register_rate_limit'] ?? '10', 10);
        setRateLimitState(rl);
        setRateLimitInput(String(rl));
        setRegisterRateLimitState(registrationRl);
        setRegisterRateLimitInput(String(registrationRl));
      })
      .catch(() => setError('Failed to load settings'));
  }, []);

  async function handleTogglePublicScan(enabled: boolean) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await setPublicScanEnabled(enabled);
      setPublicScanEnabledState(enabled);
      setSuccess(`Public scanning ${enabled ? 'enabled' : 'disabled'} successfully`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update setting');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRateLimit() {
    const v = parseInt(rateLimitInput, 10);
    if (isNaN(v) || v < 1 || v > 1000) { setError('Rate limit must be between 1 and 1000'); return; }
    setSavingRl(true); setError(''); setSuccess('');
    try {
      await updateRateLimit(v);
      setRateLimitState(v);
      setSuccess('Rate limit updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update rate limit');
    } finally {
      setSavingRl(false);
    }
  }

  async function handleSaveRegisterRateLimit() {
    const value = parseInt(registerRateLimitInput, 10);
    if (isNaN(value) || value < 1 || value > 1000) { setError('Registration rate limit must be between 1 and 1000'); return; }
    setSavingRegisterRl(true); setError(''); setSuccess('');
    try {
      await updateRegisterRateLimit(value);
      setRegisterRateLimitState(value);
      setSuccess('Registration rate limit updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update registration rate limit');
    } finally {
      setSavingRegisterRl(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)', color: '#34d399' }}>
          {success}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Public Scanning</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Allow unauthenticated users to scan Docker images at{' '}
            <a href="/scan" target="_blank" className="text-violet-500 hover:underline">/scan</a>.
            Rate limited per IP and managed below.
          </p>
        </div>

        {publicScanEnabled === null ? (
          <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
        ) : (
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: publicScanEnabled ? 'rgba(124,58,237,0.15)' : 'rgba(113,113,122,0.1)',
                  border: publicScanEnabled ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(113,113,122,0.2)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke={publicScanEnabled ? '#a78bfa' : '#71717a'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  {publicScanEnabled
                    ? <polyline points="9 12 11 14 15 10" />
                    : <><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></>}
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Public scanning is currently{' '}
                  <span className={publicScanEnabled ? 'text-emerald-500' : 'text-red-400'}>
                    {publicScanEnabled ? 'enabled' : 'disabled'}
                  </span>
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {publicScanEnabled
                    ? 'Anyone can scan images without an account'
                    : 'Only authenticated users can scan images'}
                </p>
              </div>
            </div>

            <button
              onClick={() => handleTogglePublicScan(!publicScanEnabled)}
              disabled={saving}
              className="shrink-0 px-4 py-2 text-sm font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={publicScanEnabled
                ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }
                : { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                  Saving…
                </span>
              ) : publicScanEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        )}
      </div>

      {/* Rate limit */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Public Scan Rate Limit</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Maximum number of public scans allowed per IP address per hour.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1} max={1000}
            className={inputCls + ' max-w-[120px]'}
            value={rateLimitInput}
            onChange={e => setRateLimitInput(e.target.value)}
          />
          <span className="text-sm text-zinc-500">per IP / hour</span>
          <button
            onClick={handleSaveRateLimit}
            disabled={savingRl || rateLimitInput === String(rateLimit)}
            className="btn-primary inline-flex items-center gap-2"
          >
            {savingRl && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Save
          </button>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Registration Rate Limit</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Maximum number of new accounts allowed per IP address per hour.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1} max={1000}
            className={inputCls + ' max-w-[120px]'}
            value={registerRateLimitInput}
            onChange={e => setRegisterRateLimitInput(e.target.value)}
          />
          <span className="text-sm text-zinc-500">registrations per IP / hour</span>
          <button
            onClick={handleSaveRegisterRateLimit}
            disabled={savingRegisterRl || registerRateLimitInput === String(registerRateLimit)}
            className="btn-primary inline-flex items-center gap-2"
          >
            {savingRegisterRl && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Scanner Tab ──────────────────────────────────────────────────────
function ScannerTab() {
  return (
    <div className="space-y-6">
      <ScannerHealthPanel />
    </div>
  );
}

function OverviewTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<{
    publicScanEnabled: boolean;
    userCount: number;
    tokenCount: number;
    activeChannels: number;
    runningScans: number;
    pendingScans: number;
    staleWorkers: number;
    recentAudit: AuditLog[];
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settings, users, tokens, channels, running, pending, scannerHealth, recentAudit] = await Promise.all([
        getAdminSettings(),
        listAdminUsers(),
        listAdminTokens(),
        listNotificationChannels(),
        listAdminScans(1, 1, undefined, 'running'),
        listAdminScans(1, 1, undefined, 'pending'),
        getScannerHealth().catch(() => null),
        listAuditLogs(1, 5),
      ]);

      setSummary({
        publicScanEnabled: settings.public_scan_enabled !== 'false',
        userCount: users.length,
        tokenCount: tokens.length,
        activeChannels: channels.filter((channel) => channel.enabled).length,
        runningScans: running.total ?? 0,
        pendingScans: pending.total ?? 0,
        staleWorkers: scannerHealth?.stale_workers ?? 0,
        recentAudit: recentAudit.data ?? [],
      });
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load admin overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {summary && (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
            <div className="glass-panel rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Operations Snapshot</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">Compact view of the current system posture.</p>
                </div>
                <Link href="/admin/scans" className="text-sm text-violet-500 hover:underline">Open scans</Link>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {[
                  { label: 'Public scanning', value: summary.publicScanEnabled ? 'Enabled' : 'Disabled', tone: summary.publicScanEnabled ? '#a78bfa' : '#f87171', href: '/admin/settings' },
                  { label: 'Users', value: String(summary.userCount), tone: '#60a5fa', href: '/admin/users' },
                  { label: 'Service tokens', value: String(summary.tokenCount), tone: '#34d399', href: '/admin/tokens' },
                  { label: 'Active channels', value: String(summary.activeChannels), tone: '#f59e0b', href: '/admin/notifications' },
                  { label: 'Running scans', value: String(summary.runningScans), tone: '#facc15', href: '/admin/scans' },
                  { label: 'Pending scans', value: String(summary.pendingScans), tone: '#94a3b8', href: '/admin/scans' },
                ].map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="rounded-xl px-4 py-3 transition-colors hover:bg-violet-500/5"
                    style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-zinc-500">{item.label}</span>
                      <span className="text-lg font-semibold" style={{ color: item.tone }}>{item.value}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Attention Queue</h2>
                <p className="text-sm text-zinc-500 mt-0.5">The admin flows that most likely need action.</p>
              </div>

              <div className="space-y-2">
                {[
                  {
                    href: '/admin/scanner',
                    label: 'Inspect worker health',
                    meta: `${summary.staleWorkers} stale worker${summary.staleWorkers === 1 ? '' : 's'}`,
                  },
                  {
                    href: '/admin/notifications',
                    label: 'Review channel routing',
                    meta: `${summary.activeChannels} active delivery channel${summary.activeChannels === 1 ? '' : 's'}`,
                  },
                  {
                    href: '/admin/settings',
                    label: 'Check public-scan exposure',
                    meta: summary.publicScanEnabled ? 'Public scanning enabled' : 'Public scanning disabled',
                  },
                  {
                    href: '/admin/audit',
                    label: 'Review recent admin activity',
                    meta: `${summary.recentAudit.length} recent audit event${summary.recentAudit.length === 1 ? '' : 's'}`,
                  },
                ].map((link) => (
                  <Link key={link.href} href={link.href} className="flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors hover:bg-violet-500/5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <div>
                      <p className="text-zinc-700 dark:text-zinc-200">{link.label}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{link.meta}</p>
                    </div>
                    <span className="text-violet-500">Open</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="glass-panel rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Recent Audit Activity</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">Latest high-level admin and system activity.</p>
                </div>
                <Link href="/admin/audit" className="text-sm text-violet-500 hover:underline">View all</Link>
              </div>

              {summary.recentAudit.length === 0 ? (
                <p className="text-sm text-zinc-500">No audit activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {summary.recentAudit.map((entry) => (
                    <div key={entry.id} className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{entry.operation}</p>
                          <p className="text-xs text-zinc-500 mt-1">{entry.username ?? entry.user_id}</p>
                        </div>
                        <span className="text-xs text-zinc-400 whitespace-nowrap">{timeAgo(entry.created_at)}</span>
                      </div>
                      <p className="text-sm text-zinc-500 mt-2 line-clamp-2">{entry.details || 'No details recorded.'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="glass-panel rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Control Surfaces</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">Shortcuts into the areas that influence system behavior most.</p>
                </div>
                <div className="space-y-2">
                  {[
                    { href: '/admin/settings', label: 'Review public scanning and rate limits' },
                    { href: '/admin/scanner', label: 'Inspect worker health and stale DBs' },
                    { href: '/admin/notifications', label: 'Test delivery channels and review history' },
                    { href: '/admin/scans', label: 'Manage cross-user scans and sharing' },
                  ].map((link) => (
                    <Link key={link.href} href={link.href} className="flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors hover:bg-violet-500/5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                      <span className="text-zinc-700 dark:text-zinc-200">{link.label}</span>
                      <span className="text-violet-500">Open</span>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="glass-panel rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-white">System & Legal</h2>
                  <p className="text-sm text-zinc-500 mt-0.5">Admin-only product metadata for this running frontend build.</p>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-xs text-zinc-500">Frontend version</p>
                    <p className="mt-1 font-semibold text-zinc-900 dark:text-white">v{APP_FRONTEND_VERSION}</p>
                  </div>
                  <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-xs text-zinc-500">Copyright</p>
                    <p className="mt-1 text-zinc-700 dark:text-zinc-200">{APP_COPYRIGHT}</p>
                  </div>
                  <div className="rounded-xl px-4 py-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                    <p className="text-xs text-zinc-500">Distribution</p>
                    <p className="mt-1 text-zinc-700 dark:text-zinc-200">JustScan self-hosted admin surface</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Users Tab ─────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('user');
  const [formPassword, setFormPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await listAdminUsers()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load users'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setIsCreate(true);
    setEditingUser(null);
    setFormUsername(''); setFormEmail(''); setFormRole('user'); setFormPassword(''); setFormError('');
    modal.open();
  }
  function openEdit(u: AdminUser) {
    setIsCreate(false);
    setEditingUser(u);
    setFormUsername(u.username); setFormEmail(u.email); setFormRole(u.role); setFormPassword(''); setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      if (isCreate) {
        await createAdminUser(formUsername, formEmail, formPassword, formRole);
      } else if (editingUser) {
        await updateAdminUser(editingUser.id, {
          username: formUsername,
          email: formEmail,
          role: formRole,
          ...(editingUser.auth_type !== 'oidc' && formPassword ? { password: formPassword } : {}),
        });
      }
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(u: AdminUser) {
    const ok = await confirm({
      title: `Delete "${u.username}"?`,
      message: 'This will permanently remove the user and cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteAdminUser(u.id).catch(() => {}); load();
  }
  async function handleToggleDisable(u: AdminUser) {
    const newDisabled = !u.disabled;
    const ok = await confirm(newDisabled
      ? {
          title: `Disable "${u.username}"?`,
          message: 'The user will no longer be able to log in.',
          confirmLabel: 'Disable',
          variant: 'warning',
        }
      : {
          title: `Re-enable "${u.username}"?`,
          message: 'The user will regain access to their account.',
          confirmLabel: 'Enable',
          variant: 'default',
        });
    if (!ok) return;
    await disableAdminUser(u.id, newDisabled).catch(() => {});
    load();
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="btn-primary inline-flex items-center gap-2"
          type="button"
        >
          <PlusSignIcon size={15} /> Add User
        </button>
      </div>

      {users.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No users found.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Username</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Auth</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Last Sign-in</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id}
                  style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{u.username}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={USER_AUTH_STYLE[u.auth_type ?? 'local']}>
                      {userAuthLabel(u.auth_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {u.last_login_at ? (
                      <div className="space-y-0.5">
                        <p title={fullDate(u.last_login_at)}>{timeAgo(u.last_login_at)}</p>
                        <p className="text-[11px] text-zinc-400">via {userAuthLabel(u.last_login_method || u.auth_type).toLowerCase()}</p>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                      style={u.role === 'admin'
                        ? { color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }
                        : { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.15)' }}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.disabled ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        Disabled
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(u.created_at)}>{timeAgo(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        label={`Open actions for ${u.username}`}
                        items={[
                          { id: 'toggle', label: u.disabled ? 'Enable user' : 'Disable user', onAction: () => { void handleToggleDisable(u); } },
                          { id: 'edit', label: 'Edit user', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(u) },
                          { id: 'delete', label: 'Delete user', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(u); } },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{isCreate ? 'Add User' : 'Edit User'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username</label>
                    <input className={inputCls} placeholder="username" value={formUsername} onChange={e => setFormUsername(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Email</label>
                    <input type="email" className={inputCls} placeholder="user@example.com" value={formEmail} onChange={e => setFormEmail(e.target.value)} required />
                  </div>
                  {!isCreate && editingUser ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Authentication</label>
                        <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                          <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={USER_AUTH_STYLE[editingUser.auth_type ?? 'local']}>
                            {userAuthLabel(editingUser.auth_type)}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Last Sign-in</label>
                        <div className="rounded-xl px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-200" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                          {editingUser.last_login_at ? fullDate(editingUser.last_login_at) : 'No successful sign-in recorded yet'}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Role</label>
                    <Select selectedKey={formRole} onSelectionChange={k => setFormRole(String(k))}>
                      <Select.Trigger className={selectTriggerCls}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-zinc-400 shrink-0"><Shield01Icon size={15} /></span>
                          <Select.Value />
                        </div>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="user">User</ListBox.Item>
                          <ListBox.Item id="admin">Admin</ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      Password{' '}
                      {!isCreate && editingUser?.auth_type !== 'oidc' ? <span className="text-zinc-400 dark:text-zinc-600 font-normal">(leave blank to keep unchanged)</span> : null}
                    </label>
                    <input type="password" className={inputCls}
                      placeholder={isCreate ? 'Password' : editingUser?.auth_type === 'oidc' ? 'Managed by OIDC' : '••••••••'}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      disabled={Boolean(editingUser?.auth_type === 'oidc')}
                      required={isCreate} />
                    {editingUser?.auth_type === 'oidc' ? <p className="text-xs text-zinc-500">Password changes are disabled for users currently authenticated through OIDC.</p> : null}
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={modal.close} type="button">
                  Cancel
                </button>
                <button type="submit" form="user-form" disabled={saving}
                  className="btn-primary inline-flex items-center gap-2">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {isCreate ? 'Create' : 'Save'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}

function TokensTab() {
  const [tokens, setTokens] = useState<AdminToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingToken, setEditingToken] = useState<AdminToken | null>(null);
  const [description, setDescription] = useState('');
  const [disabledReason, setDisabledReason] = useState('');
  const [saving, setSaving] = useState(false);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTokens(await listAdminTokens());
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(token: AdminToken) {
    setEditingToken(token);
    setDescription(token.description ?? '');
    setDisabledReason(token.disabled_reason ?? '');
    modal.open();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingToken) return;
    setSaving(true);
    try {
      await updateAdminToken(editingToken.id, {
        description,
        disabled: editingToken.disabled,
        disabled_reason: disabledReason,
      });
      modal.close();
      await load();
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update token');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(token: AdminToken) {
    const nextDisabled = !token.disabled;
    const confirmed = await confirm(nextDisabled
      ? {
          title: `Disable token "${token.description || token.id.slice(0, 8)}"?`,
          message: 'The token will stop working immediately.',
          confirmLabel: 'Disable',
          variant: 'warning',
        }
      : {
          title: `Re-enable token "${token.description || token.id.slice(0, 8)}"?`,
          message: 'The token will become valid again immediately.',
          confirmLabel: 'Enable',
          variant: 'default',
        });
    if (!confirmed) return;

    try {
      await updateAdminToken(token.id, {
        description: token.description,
        disabled: nextDisabled,
        disabled_reason: nextDisabled ? (token.disabled_reason || 'Disabled by admin') : '',
      });
      await load();
    } catch (toggleError: unknown) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update token');
    }
  }

  async function handleDelete(token: AdminToken) {
    const confirmed = await confirm({
      title: `Delete token "${token.description || token.id.slice(0, 8)}"?`,
      message: 'This cannot be undone. Any service using the token will stop authenticating.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      await deleteAdminToken(token.id);
      await load();
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete token');
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Service Tokens</h2>
        <p className="text-sm text-zinc-500 mt-1">Review token usage, rotate descriptions, disable compromised keys, and delete obsolete credentials.</p>
      </div>

      {tokens.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No tokens found.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Description</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Key</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Expires</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token, index) => (
                <tr key={token.id}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">{token.description || <span className="italic text-zinc-400">No description</span>}</td>
                  <td className="px-4 py-3 text-xs uppercase tracking-[0.14em] text-zinc-500">{token.type}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{token.key.slice(0, 6)}••••••••{token.key.slice(-4)}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(token.expires_at)}>{timeAgo(token.expires_at)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={token.disabled
                        ? { color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }
                        : { color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      {token.disabled ? 'Disabled' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        label={`Open actions for token ${token.description || token.id.slice(0, 8)}`}
                        items={[
                          { id: 'toggle', label: token.disabled ? 'Enable token' : 'Disable token', onAction: () => { void handleToggle(token); } },
                          { id: 'edit', label: 'Edit token', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(token) },
                          { id: 'delete', label: 'Delete token', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(token); } },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Edit Token</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="token-form" onSubmit={handleSave} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Description</label>
                    <input className={inputCls} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="CI token" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Disabled Reason</label>
                    <textarea className={inputCls} value={disabledReason} onChange={(event) => setDisabledReason(event.target.value)} placeholder="Why this token was disabled" rows={3} />
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={modal.close} type="button">
                  Cancel
                </button>
                <button type="submit" form="token-form" disabled={saving}
                  className="btn-primary inline-flex items-center gap-2">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Save
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}
function AutoTagsTab() {
  const [rules, setRules] = useState<AutoTagRule[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingRule, setEditingRule] = useState<AutoTagRule | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [formPattern, setFormPattern] = useState('');
  const [formTagId, setFormTagId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([listAutoTagRules(), listTags()]);
      setRules(r); setTags(t);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setIsCreate(true); setEditingRule(null);
    setFormPattern(''); setFormTagId(tags[0]?.id ?? ''); setFormError('');
    modal.open();
  }
  function openEdit(r: AutoTagRule) {
    setIsCreate(false); setEditingRule(r);
    setFormPattern(r.pattern); setFormTagId(r.tag_id); setFormError('');
    modal.open();
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      if (isCreate) await createAutoTagRule(formPattern, formTagId);
      else if (editingRule) await updateAutoTagRule(editingRule.id, formPattern, formTagId);
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete auto-tag rule?',
      message: 'The rule will no longer apply to new scans.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteAutoTagRule(id).catch(() => {}); load();
  }

  const tagById = (id: string) => tags.find(t => t.id === id);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Automatically apply tags to scans based on image name patterns.</p>
        <button
          onClick={openCreate}
          className="btn-primary inline-flex items-center gap-2"
          type="button"
        >
          <PlusSignIcon size={15} /> Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No auto-tag rules yet.</p>
          <p className="text-xs text-zinc-400">Use patterns like <code className="px-1 py-0.5 rounded font-mono" style={{background:'var(--row-hover)'}}>nginx/*</code> to match image names.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Pattern</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Tag</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => {
                const tag = r.tag ?? tagById(r.tag_id);
                return (
                  <tr key={r.id}
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">{r.pattern}</td>
                    <td className="px-4 py-3">
                      {tag ? (
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                          style={{ background: tag.color + '22', color: tag.color, border: `1px solid ${tag.color}44` }}>
                          {tag.name}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 font-mono">{r.tag_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(r.created_at)}>{timeAgo(r.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for pattern ${r.pattern}`}
                          items={[
                            { id: 'edit', label: 'Edit rule', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(r) },
                            { id: 'delete', label: 'Delete rule', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(r.id); } },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{isCreate ? 'Add Auto-Tag Rule' : 'Edit Auto-Tag Rule'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="autotag-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Pattern</label>
                    <input className={inputCls + ' font-mono'} placeholder="nginx/*" value={formPattern} onChange={e => setFormPattern(e.target.value)} required />
                    <p className="text-xs text-zinc-500">
                      Use glob patterns to match image names. Examples:{' '}
                      <code className="font-mono px-1 py-0.5 rounded" style={{background:'var(--row-hover)'}}>nginx/*</code>{' '}
                      <code className="font-mono px-1 py-0.5 rounded" style={{background:'var(--row-hover)'}}>myrepo/api*</code>{' '}
                      <code className="font-mono px-1 py-0.5 rounded" style={{background:'var(--row-hover)'}}>*/prod-*</code>
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                    {tags.length === 0 ? (
                      <p className="text-sm text-zinc-500">No tags available. Create tags first.</p>
                    ) : (
                      <Select selectedKey={formTagId} onSelectionChange={k => setFormTagId(String(k))} isRequired>
                        <Select.Trigger className={selectTriggerCls}>
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="text-zinc-400 shrink-0"><Tag01Icon size={15} /></span>
                            <Select.Value />
                          </div>
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="">Select a tag…</ListBox.Item>
                            {tags.map(t => (
                              <ListBox.Item key={t.id} id={t.id}>{t.name}</ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    )}
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={modal.close} type="button">
                  Cancel
                </button>
                <button type="submit" form="autotag-form" disabled={saving || tags.length === 0}
                  className="btn-primary inline-flex items-center gap-2">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {isCreate ? 'Create' : 'Save'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}

// ── Audit Log Tab ────────────────────────────────────────────────────
function AuditLogTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', user: '', operation: '', from: '', to: '' });
  const limit = 50;

  const requestFilters: AuditLogFilters = useMemo(() => ({
    q: filters.q || undefined,
    user: filters.user || undefined,
    operation: filters.operation || undefined,
    from: toIsoOrUndefined(filters.from),
    to: toIsoOrUndefined(filters.to),
  }), [filters.from, filters.operation, filters.q, filters.to, filters.user]);

  const load = useCallback(async (p: number, activeFilters: AuditLogFilters) => {
    setLoading(true);
    try {
      const r = await listAuditLogs(p, limit, activeFilters);
      setLogs(r.data ?? []);
      setTotal(r.total);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load audit logs'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page, requestFilters); }, [load, page, requestFilters]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function updateFilter<K extends keyof typeof filters>(key: K, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    setError('');
    try {
      const rows: AuditLog[] = [];
      let exportPage = 1;
      let exportTotal = 0;

      do {
        const result = await listAuditLogs(exportPage, 200, requestFilters);
        rows.push(...(result.data ?? []));
        exportTotal = result.total ?? 0;
        exportPage += 1;
      } while (rows.length < exportTotal);

      const csv = [
        ['created_at', 'username', 'email', 'role', 'operation', 'details'].join(','),
        ...rows.map((entry) => [
          escapeCsv(entry.created_at),
          escapeCsv(entry.username ?? entry.user_id),
          escapeCsv(entry.email ?? ''),
          escapeCsv(entry.role ?? ''),
          escapeCsv(entry.operation),
          escapeCsv(entry.details),
        ].join(',')),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `justscan-audit-${new Date().toISOString().slice(0, 19)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export audit logs');
    } finally {
      setExporting(false);
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <input className={inputCls} placeholder="Search details or operation" value={filters.q} onChange={(event) => updateFilter('q', event.target.value)} />
          <input className={inputCls} placeholder="User or email" value={filters.user} onChange={(event) => updateFilter('user', event.target.value)} />
          <input className={inputCls} placeholder="Operation" value={filters.operation} onChange={(event) => updateFilter('operation', event.target.value)} />
          <input type="datetime-local" className={inputCls} value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
          <input type="datetime-local" className={inputCls} value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">{total} total events</p>
          <button
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="btn-primary inline-flex items-center gap-2"
            type="button"
          >
            {exporting && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="btn-secondary"
            type="button">
            ←
          </button>
          <span className="text-zinc-500">{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="btn-secondary"
            type="button">
            →
          </button>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No audit log entries yet.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Operation</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={l.id}
                  style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td className="px-4 py-3 text-xs text-zinc-400 whitespace-nowrap" title={fullDate(l.created_at)}>
                    {timeAgo(l.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300 font-medium">
                    {l.username ?? l.user_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500 uppercase tracking-[0.14em]">{l.role ?? 'n/a'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md"
                      style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                      {l.operation}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 max-w-xs truncate">{l.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Notifications Tab ────────────────────────────────────────────────
const EVENT_OPTIONS = [
  { value: 'scan_complete', label: 'Scan Completed' },
  { value: 'scan_failed', label: 'Scan Failed' },
  { value: 'compliance_failed', label: 'Compliance Failed' },
];

const NOTIFICATION_TYPE_OPTIONS: Array<{ value: NotificationChannel['type']; label: string }> = [
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'teams', label: 'Microsoft Teams' },
  { value: 'email', label: 'Email (SMTP)' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'webhook', label: 'Generic Webhook' },
];

const SEVERITY_OPTIONS: Array<{ value: NotificationChannel['min_severity']; label: string }> = [
  { value: '', label: 'Any severity' },
  { value: 'LOW', label: 'Low or higher' },
  { value: 'MEDIUM', label: 'Medium or higher' },
  { value: 'HIGH', label: 'High or higher' },
  { value: 'CRITICAL', label: 'Critical only' },
];

function NotificationsTab() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deliveryHistory, setDeliveryHistory] = useState<Record<string, NotificationDelivery[]>>({});
  const [historyChannelId, setHistoryChannelId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [isCreate, setIsCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<NotificationChannel['type']>('discord');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formEvents, setFormEvents] = useState<string[]>(['scan_complete', 'scan_failed', 'compliance_failed']);
  const [formOrgIds, setFormOrgIds] = useState<string[]>([]);
  const [formImagePatterns, setFormImagePatterns] = useState('');
  const [formMinSeverity, setFormMinSeverity] = useState<NotificationChannel['min_severity']>('');
  const [formWebhookURL, setFormWebhookURL] = useState('');
  const [formSMTPHost, setFormSMTPHost] = useState('');
  const [formSMTPPort, setFormSMTPPort] = useState('587');
  const [formSMTPUser, setFormSMTPUser] = useState('');
  const [formSMTPPass, setFormSMTPPass] = useState('');
  const [formSMTPFrom, setFormSMTPFrom] = useState('');
  const [formSMTPTo, setFormSMTPTo] = useState('');
  const [formSMTPTLS, setFormSMTPTLS] = useState(false);
  const [formTelegramBotToken, setFormTelegramBotToken] = useState('');
  const [formTelegramChatId, setFormTelegramChatId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextChannels, nextOrgs] = await Promise.all([listNotificationChannels(), listOrgs()]);
      setChannels(nextChannels);
      setOrgs(nextOrgs);
    }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm(ch?: NotificationChannel) {
    setFormName(ch?.name ?? '');
    setFormType(ch?.type ?? 'discord');
    setFormEnabled(ch?.enabled ?? true);
    setFormEvents(ch?.events ?? ['scan_complete', 'scan_failed', 'compliance_failed']);
    setFormOrgIds(ch?.org_ids ?? []);
    setFormImagePatterns((ch?.image_patterns ?? []).join(', '));
    setFormMinSeverity(ch?.min_severity ?? '');
    setFormWebhookURL(ch?.config?.webhook_url ?? '');
    setFormSMTPHost(ch?.config?.smtp_host ?? '');
    setFormSMTPPort(String(ch?.config?.smtp_port ?? 587));
    setFormSMTPUser(ch?.config?.smtp_username ?? '');
    setFormSMTPPass('');
    setFormSMTPFrom(ch?.config?.smtp_from ?? '');
    setFormSMTPTo((ch?.config?.to_addresses ?? []).join(', '));
    setFormSMTPTLS(ch?.config?.smtp_tls ?? false);
    setFormTelegramBotToken('');
    setFormTelegramChatId(ch?.config?.telegram_chat_id ?? '');
    setFormError('');
  }

  function openCreate() {
    setIsCreate(true); setEditing(null); resetForm(); modal.open();
  }
  function openEdit(ch: NotificationChannel) {
    setIsCreate(false); setEditing(ch); resetForm(ch); modal.open();
  }

  function buildPayload(): Partial<NotificationChannel> {
    const config: NotificationChannel['config'] = {};
    if (formType === 'discord' || formType === 'webhook' || formType === 'slack' || formType === 'teams') {
      config.webhook_url = formWebhookURL;
    }
    if (formType === 'email') {
      config.smtp_host = formSMTPHost;
      config.smtp_port = parseInt(formSMTPPort, 10) || 587;
      config.smtp_username = formSMTPUser;
      if (formSMTPPass) config.smtp_password = formSMTPPass;
      config.smtp_from = formSMTPFrom;
      config.to_addresses = formSMTPTo.split(',').map(s => s.trim()).filter(Boolean);
      config.smtp_tls = formSMTPTLS;
    }
    if (formType === 'telegram') {
      if (formTelegramBotToken) config.telegram_bot_token = formTelegramBotToken;
      config.telegram_chat_id = formTelegramChatId;
    }

    return {
      name: formName,
      type: formType,
      enabled: formEnabled,
      events: formEvents,
      org_ids: formOrgIds,
      image_patterns: formImagePatterns.split(',').map((entry) => entry.trim()).filter(Boolean),
      min_severity: formMinSeverity,
      config,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setFormError(''); setSaving(true);
    try {
      const payload = buildPayload();
      if (isCreate) await createNotificationChannel(payload);
      else if (editing) await updateNotificationChannel(editing.id, payload);
      modal.close(); await load();
    } catch (err: unknown) { setFormError(err instanceof Error ? err.message : 'Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete(ch: NotificationChannel) {
    const ok = await confirm({
      title: `Delete "${ch.name}"?`,
      message: 'The notification channel will be permanently removed.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteNotificationChannel(ch.id).catch(() => {}); load();
  }

  async function handleToggleEnabled(ch: NotificationChannel) {
    const ok = await confirm(ch.enabled
      ? { title: `Disable "${ch.name}"?`, message: 'No notifications will be sent through this channel.', confirmLabel: 'Disable', variant: 'warning' }
      : { title: `Enable "${ch.name}"?`, message: 'Notifications will start being sent through this channel.', confirmLabel: 'Enable', variant: 'default' }
    );
    if (!ok) return;
    await updateNotificationChannel(ch.id, { enabled: !ch.enabled }).catch(() => {}); load();
  }

  async function handleTest(ch: NotificationChannel) {
    setFeedback(null);
    try {
      await testNotificationChannel(ch.id, ch.events[0]);
      setFeedback({ type: 'success', text: `Sent test notification through ${ch.name}.` });
      const history = await listNotificationDeliveries(ch.id, 8);
      setDeliveryHistory((previous) => ({ ...previous, [ch.id]: history }));
      setHistoryChannelId(ch.id);
    } catch (testError: unknown) {
      setFeedback({ type: 'error', text: testError instanceof Error ? testError.message : 'Failed to send test notification' });
    }
  }

  async function toggleHistory(ch: NotificationChannel) {
    if (historyChannelId === ch.id) {
      setHistoryChannelId(null);
      return;
    }

    setHistoryLoading(true);
    try {
      const history = await listNotificationDeliveries(ch.id, 8);
      setDeliveryHistory((previous) => ({ ...previous, [ch.id]: history }));
      setHistoryChannelId(ch.id);
    } catch (historyError: unknown) {
      setFeedback({ type: 'error', text: historyError instanceof Error ? historyError.message : 'Failed to load delivery history' });
    } finally {
      setHistoryLoading(false);
    }
  }

  function toggleEvent(ev: string) {
    setFormEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]);
  }

  function toggleOrg(orgId: string) {
    setFormOrgIds((previous) => previous.includes(orgId) ? previous.filter((current) => current !== orgId) : [...previous, orgId]);
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-xl px-4 py-3 text-sm" style={feedback.type === 'success'
          ? { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)', color: '#34d399' }
          : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {feedback.text}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Route scan and compliance events to Discord, Slack, Teams, email, Telegram, or a generic webhook with org, image, and severity filters.</p>
        <button
          onClick={openCreate}
          className="btn-primary inline-flex items-center gap-2"
          type="button"
        >
          <PlusSignIcon size={15} /> Add Channel
        </button>
      </div>

      {channels.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <Notification01Icon size={32} className="text-zinc-400 dark:text-zinc-600" />
          <p className="text-sm text-zinc-500">No notification channels configured.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Events</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Filters</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {channels.map((ch, i) => (
                <>
                  <tr key={ch.id}
                    style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{ch.name}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-md capitalize"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                        {ch.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(ch.events ?? []).map(ev => (
                          <span key={ev} className="text-xs px-1.5 py-0.5 rounded font-mono"
                            style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                            {ev}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      <div className="space-y-1">
                        <p>{(ch.org_ids ?? []).length > 0 ? `${ch.org_ids.length} org filter${ch.org_ids.length === 1 ? '' : 's'}` : 'All orgs'}</p>
                        <p>{(ch.image_patterns ?? []).length > 0 ? `${ch.image_patterns.length} image pattern${ch.image_patterns.length === 1 ? '' : 's'}` : 'All images'}</p>
                        <p>{ch.min_severity ? `${ch.min_severity}+ only` : 'Any severity'}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {ch.enabled ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>Active</span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#a1a1aa', background: 'rgba(161,161,170,0.1)', border: '1px solid rgba(161,161,170,0.2)' }}>Disabled</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for notification channel ${ch.name}`}
                          items={[
                            { id: 'test', label: 'Send test', icon: <Notification01Icon size={15} />, onAction: () => { void handleTest(ch); } },
                            { id: 'history', label: historyChannelId === ch.id ? 'Hide history' : 'Show history', onAction: () => { void toggleHistory(ch); } },
                            { id: 'toggle', label: ch.enabled ? 'Disable channel' : 'Enable channel', onAction: () => { void handleToggleEnabled(ch); } },
                            { id: 'edit', label: 'Edit channel', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(ch) },
                            { id: 'delete', label: 'Delete channel', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(ch); } },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                  {historyChannelId === ch.id && (
                    <tr key={`${ch.id}-history`}>
                      <td colSpan={6} className="px-4 pb-4 pt-0">
                        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Recent Delivery Attempts</p>
                            {historyLoading && <span className="text-xs text-zinc-500">Loading…</span>}
                          </div>

                          {historyLoading ? (
                            <div className="flex justify-center py-4">
                              <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
                            </div>
                          ) : (deliveryHistory[ch.id] ?? []).length === 0 ? (
                            <p className="text-sm text-zinc-500">No deliveries recorded yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {(deliveryHistory[ch.id] ?? []).map((delivery) => (
                                <div key={delivery.id} className="rounded-lg px-3 py-2.5" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>{delivery.event}</span>
                                      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                                        style={delivery.status === 'delivered'
                                          ? { color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }
                                          : { color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                        {delivery.status}
                                      </span>
                                      <span className="text-xs text-zinc-500 uppercase tracking-[0.14em]">{delivery.triggered_by}</span>
                                    </div>
                                    <span className="text-xs text-zinc-400">{timeAgo(delivery.created_at)}</span>
                                  </div>
                                  {(delivery.error || delivery.details) && (
                                    <p className="text-sm text-zinc-500 mt-2">{delivery.error || delivery.details}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={modal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">
                  {isCreate ? 'Add Notification Channel' : 'Edit Notification Channel'}
                </Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5 max-h-[70vh] overflow-y-auto">
                <form id="notif-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Name</label>
                    <input className={inputCls} placeholder="My Discord Channel" value={formName} onChange={e => setFormName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Type</label>
                    <Select selectedKey={formType} onSelectionChange={k => setFormType(k as typeof formType)}>
                      <Select.Trigger className={selectTriggerCls}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-zinc-400 shrink-0"><Notification01Icon size={15} /></span>
                          <Select.Value />
                        </div>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {NOTIFICATION_TYPE_OPTIONS.map((option) => (
                            <ListBox.Item key={option.value} id={option.value}>{option.label}</ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  {/* Type-specific fields */}
                  {(formType === 'discord' || formType === 'webhook' || formType === 'slack' || formType === 'teams') && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                        {formType === 'discord' ? 'Discord Webhook URL' : formType === 'slack' ? 'Slack Webhook URL' : formType === 'teams' ? 'Teams Webhook URL' : 'Webhook URL'}
                      </label>
                      <input className={inputCls} placeholder="https://hooks.example.com/..." value={formWebhookURL} onChange={e => setFormWebhookURL(e.target.value)} required />
                    </div>
                  )}

                  {formType === 'email' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">SMTP Host</label>
                          <input className={inputCls} placeholder="smtp.example.com" value={formSMTPHost} onChange={e => setFormSMTPHost(e.target.value)} required />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Port</label>
                          <input type="number" className={inputCls} placeholder="587" value={formSMTPPort} onChange={e => setFormSMTPPort(e.target.value)} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username</label>
                          <input className={inputCls} placeholder="user@example.com" value={formSMTPUser} onChange={e => setFormSMTPUser(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Password</label>
                          <input type="password" className={inputCls} placeholder={editing ? '(unchanged)' : 'Password'} value={formSMTPPass} onChange={e => setFormSMTPPass(e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">From Address</label>
                        <input className={inputCls} placeholder="noreply@example.com" value={formSMTPFrom} onChange={e => setFormSMTPFrom(e.target.value)} required />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">To Addresses</label>
                        <input className={inputCls} placeholder="ops@example.com, team@example.com" value={formSMTPTo} onChange={e => setFormSMTPTo(e.target.value)} required />
                        <p className="text-xs text-zinc-400">Comma-separated list of recipients</p>
                      </div>
                      <label className="flex items-center gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={formSMTPTLS} onChange={e => setFormSMTPTLS(e.target.checked)}
                          className="w-4 h-4 rounded accent-violet-500" />
                        <span className="text-sm text-zinc-600 dark:text-zinc-300">Use TLS (port 465)</span>
                      </label>
                    </>
                  )}

                  {formType === 'telegram' && (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Bot Token</label>
                          <input type="password" className={inputCls} placeholder={editing ? '(unchanged)' : 'Telegram bot token'} value={formTelegramBotToken} onChange={e => setFormTelegramBotToken(e.target.value)} required={!editing} />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Chat ID</label>
                          <input className={inputCls} placeholder="-1001234567890" value={formTelegramChatId} onChange={e => setFormTelegramChatId(e.target.value)} required />
                        </div>
                      </div>
                    </>
                  )}

                  {/* Events */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Trigger on Events</label>
                    <div className="space-y-2">
                      {EVENT_OPTIONS.map(ev => (
                        <label key={ev.value} className="flex items-center gap-2.5 cursor-pointer">
                          <input type="checkbox" checked={formEvents.includes(ev.value)} onChange={() => toggleEvent(ev.value)}
                            className="w-4 h-4 rounded accent-violet-500" />
                          <span className="text-sm text-zinc-600 dark:text-zinc-300">{ev.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Filter by Organizations</label>
                    {orgs.length === 0 ? (
                      <p className="text-sm text-zinc-500">No org filters configured. This channel will match all orgs.</p>
                    ) : (
                      <div className="grid gap-2 rounded-xl p-3" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
                        {orgs.map((org) => (
                          <label key={org.id} className="flex items-center gap-2.5 cursor-pointer">
                            <input type="checkbox" checked={formOrgIds.includes(org.id)} onChange={() => toggleOrg(org.id)} className="w-4 h-4 rounded accent-violet-500" />
                            <span className="text-sm text-zinc-600 dark:text-zinc-300">{org.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image Patterns</label>
                    <textarea className={inputCls} placeholder="nginx/*, ghcr.io/my-org/*" value={formImagePatterns} onChange={e => setFormImagePatterns(e.target.value)} rows={3} />
                    <p className="text-xs text-zinc-400">Comma-separated glob patterns. Leave empty to match all images.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Minimum Severity</label>
                    <Select selectedKey={formMinSeverity || '__any__'} onSelectionChange={(key) => setFormMinSeverity(key === '__any__' ? '' : key as NotificationChannel['min_severity'])}>
                      <Select.Trigger className={selectTriggerCls}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-zinc-400 shrink-0"><Shield01Icon size={15} /></span>
                          <Select.Value />
                        </div>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {SEVERITY_OPTIONS.map((option) => (
                            <ListBox.Item key={option.value || '__any__'} id={option.value || '__any__'}>{option.label}</ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={formEnabled} onChange={e => setFormEnabled(e.target.checked)}
                      className="w-4 h-4 rounded accent-violet-500" />
                    <span className="text-sm text-zinc-600 dark:text-zinc-300">Enabled</span>
                  </label>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={modal.close} type="button">
                  Cancel
                </button>
                <button type="submit" form="notif-form" disabled={saving}
                  className="btn-primary inline-flex items-center gap-2">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {isCreate ? 'Create' : 'Save'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}

// ── Scans Tab ─────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  completed: { bg: 'rgba(34,197,94,0.1)', color: '#4ade80', border: 'rgba(34,197,94,0.2)' },
  running:   { bg: 'rgba(234,179,8,0.1)',  color: '#facc15', border: 'rgba(234,179,8,0.2)'  },
  pending:   { bg: 'rgba(148,163,184,0.1)',color: '#94a3b8', border: 'rgba(148,163,184,0.2)'},
  failed:    { bg: 'rgba(239,68,68,0.1)',  color: '#f87171', border: 'rgba(239,68,68,0.2)'  },
};

function ScansTab() {
  const [scans, setScans] = useState<AdminScan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [imageFilter, setImageFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [tagScan, setTagScan] = useState<AdminScan | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const tagModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const limit = 50;

  const load = useCallback(async (p: number, img: string, st: string, owner: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await listAdminScans(p, limit, img || undefined, st || undefined, undefined, owner || undefined);
      setScans(r.data ?? []);
      setTotal(r.total);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load scans'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page, imageFilter, statusFilter, ownerFilter); }, [imageFilter, load, ownerFilter, page, statusFilter]);
  useEffect(() => {
    listTags().then(setAvailableTags).catch(() => setAvailableTags([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function handleImageChange(v: string) { setImageFilter(v); setPage(1); }
  function handleOwnerChange(v: string) { setOwnerFilter(v); setPage(1); }
  function handleStatusChange(v: string) { setStatusFilter(v); setPage(1); }

  function toggleExpand(imageName: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(imageName)) next.delete(imageName); else next.add(imageName);
      return next;
    });
  }

  // Group scans by image name, preserving insertion order
  const groups: { imageName: string; scans: AdminScan[] }[] = [];
  const seen = new Map<string, AdminScan[]>();
  for (const s of scans) {
    if (!seen.has(s.image_name)) {
      seen.set(s.image_name, []);
      groups.push({ imageName: s.image_name, scans: seen.get(s.image_name)! });
    }
    seen.get(s.image_name)!.push(s);
  }

  function openTagModal(scan: AdminScan) {
    setTagScan(scan);
    setSelectedTagId(availableTags[0]?.id ?? '');
    tagModal.open();
  }

  async function refreshCurrentPage() {
    await load(page, imageFilter, statusFilter, ownerFilter);
  }

  async function handleRescan(scan: AdminScan) {
    setActionLoadingId(`${scan.id}:rescan`);
    setFeedback(null);
    try {
      await reScan(scan.id);
      setFeedback({ type: 'success', text: `Queued a rescan for ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({ type: 'error', text: actionError instanceof Error ? actionError.message : 'Failed to queue rescan' });
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCancel(scan: AdminScan) {
    const ok = await confirm({
      title: `Cancel ${scan.image_name}:${scan.image_tag}?`,
      message: 'The running or pending scan will be marked as cancelled.',
      confirmLabel: 'Cancel Scan',
      variant: 'warning',
    });
    if (!ok) return;

    setActionLoadingId(`${scan.id}:cancel`);
    setFeedback(null);
    try {
      await cancelScan(scan.id);
      setFeedback({ type: 'success', text: `Cancelled ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({ type: 'error', text: actionError instanceof Error ? actionError.message : 'Failed to cancel scan' });
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCreateShare(scan: AdminScan) {
    setActionLoadingId(`${scan.id}:share`);
    setFeedback(null);
    try {
      const result = await createShare(scan.id, 'public');
      await copyToClipboard(`${window.location.origin}/shared/${result.share_token}`);
      setFeedback({ type: 'success', text: `Public share link copied for ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({ type: 'error', text: actionError instanceof Error ? actionError.message : 'Failed to create share link' });
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleCopyShare(scan: AdminScan) {
    if (!scan.share_token) return;
    try {
      await copyToClipboard(`${window.location.origin}/shared/${scan.share_token}`);
      setFeedback({ type: 'success', text: `Copied share link for ${scan.image_name}:${scan.image_tag}.` });
    } catch (copyError: unknown) {
      setFeedback({ type: 'error', text: copyError instanceof Error ? copyError.message : 'Failed to copy share link' });
    }
  }

  async function handleRevokeShare(scan: AdminScan) {
    const ok = await confirm({
      title: `Revoke share for ${scan.image_name}:${scan.image_tag}?`,
      message: 'The existing shared link will stop working immediately.',
      confirmLabel: 'Revoke Share',
      variant: 'danger',
    });
    if (!ok) return;

    setActionLoadingId(`${scan.id}:revoke`);
    setFeedback(null);
    try {
      await deleteShare(scan.id);
      setFeedback({ type: 'success', text: `Revoked share access for ${scan.image_name}:${scan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({ type: 'error', text: actionError instanceof Error ? actionError.message : 'Failed to revoke share link' });
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleAddTag(e: React.FormEvent) {
    e.preventDefault();
    if (!tagScan || !selectedTagId) return;

    setActionLoadingId(`${tagScan.id}:tag`);
    setFeedback(null);
    try {
      await addTagToScan(tagScan.id, selectedTagId);
      tagModal.close();
      setFeedback({ type: 'success', text: `Added a tag to ${tagScan.image_name}:${tagScan.image_tag}.` });
      await refreshCurrentPage();
    } catch (actionError: unknown) {
      setFeedback({ type: 'error', text: actionError instanceof Error ? actionError.message : 'Failed to add tag' });
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}
      {feedback && (
        <div className="rounded-xl px-4 py-3 text-sm" style={feedback.type === 'success'
          ? { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)', color: '#34d399' }
          : { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {feedback.text}
        </div>
      )}

      {/* Filters */}
      <div className="glass-panel rounded-2xl p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_220px_auto] items-end">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Image</Label>
            <Input
              className={inputCls}
              placeholder="Filter by image…"
              value={imageFilter}
              onChange={e => handleImageChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Owner</Label>
            <Input
              className={inputCls}
              placeholder="Filter by owner…"
              value={ownerFilter}
              onChange={e => handleOwnerChange(e.target.value)}
            />
          </div>
          <Select selectedKey={statusFilter || '__all__'} onSelectionChange={key => handleStatusChange(key === '__all__' ? '' : String(key))} className="w-full" placeholder="Filter by status">
            <Label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Status</Label>
            <Select.Trigger className={selectTriggerCls}>
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-zinc-400 shrink-0"><Shield01Icon size={15} /></span>
                <Select.Value />
              </div>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="__all__" textValue="All statuses">
                  All statuses
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="completed" textValue="Completed">
                  Completed
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="running" textValue="Running">
                  Running
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="pending" textValue="Pending">
                  Pending
                  <ListBox.ItemIndicator />
                </ListBox.Item>
                <ListBox.Item id="failed" textValue="Failed">
                  Failed
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <div className="flex justify-end">
            <p className="text-sm text-zinc-500 whitespace-nowrap">{total} total</p>
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end gap-2 text-sm">
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="btn-secondary"
          type="button">←</button>
        <span className="text-zinc-500">{page} / {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="btn-secondary"
          type="button">→</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No scans found.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="w-8 px-3 py-3" />
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Image</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }}>C</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }}>H</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }}>M</th>
                <th className="text-center px-3 py-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }}>L</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Owner</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Share</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, gi) => {
                const isOpen = expanded.has(group.imageName);
                const latest = group.scans[0];
                const sc = STATUS_COLORS[latest.status] ?? STATUS_COLORS.failed;
                return (
                  <>
                    {/* Image group header */}
                    <tr
                      key={group.imageName}
                      className="cursor-pointer transition-colors"
                      style={{ borderTop: gi > 0 ? '1px solid var(--row-divider)' : undefined }}
                      onClick={() => toggleExpand(group.imageName)}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td className="px-3 py-3.5 w-8">
                        <span
                          className="flex items-center justify-center w-5 h-5 rounded-md transition-all duration-150"
                          style={{ color: 'var(--text-muted)', background: isOpen ? 'rgba(124,58,237,0.12)' : undefined }}
                        >
                          {isOpen
                            ? <ArrowDown01Icon size={13} className="text-violet-400" />
                            : <ArrowRight01Icon size={13} />}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                            {group.imageName}
                          </span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-md font-medium"
                            style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
                          >
                            {group.scans.length} scan{group.scans.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-xs text-zinc-400">:{latest.image_tag}</span>
                          <span className="text-xs text-zinc-500" title={fullDate(latest.created_at)}>{timeAgo(latest.created_at)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                          style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                          {latest.status}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-red-400">{latest.critical_count || '—'}</td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-orange-400">{latest.high_count || '—'}</td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-yellow-400">{latest.medium_count || '—'}</td>
                      <td className="px-3 py-3.5 text-center font-mono text-xs text-blue-400">{latest.low_count || '—'}</td>
                      <td className="px-4 py-3.5 text-sm text-zinc-500 max-w-[160px] truncate" title={latest.owner_email || '—'}>
                        {latest.owner_email ? latest.owner_email : <span className="italic text-zinc-400">anonymous</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-zinc-500">{latest.share_token ? latest.share_visibility || 'shared' : 'private'}</td>
                      <td className="px-4 py-3.5 text-xs text-zinc-400 whitespace-nowrap">{timeAgo(latest.created_at)}</td>
                    </tr>

                    {/* Expanded child rows */}
                    {isOpen && (
                      <tr key={`${group.imageName}-children`}>
                        <td colSpan={10} className="p-0">
                          <div
                            className="mx-4 mb-3 rounded-xl overflow-hidden"
                            style={{ background: 'var(--row-hover)', border: '1px solid var(--border-subtle)' }}
                          >
                            <table className="w-full text-sm">
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Tag</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(239,68,68,0.7)' }}>C</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(249,115,22,0.7)' }}>H</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(234,179,8,0.7)' }}>M</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: 'rgba(59,130,246,0.7)' }}>L</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Owner</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Share</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Date</th>
                                  <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.scans.map((s, si) => {
                                  const csc = STATUS_COLORS[s.status] ?? STATUS_COLORS.failed;
                                  return (
                                    <tr
                                      key={s.id}
                                      className="cursor-pointer group/row transition-colors"
                                      style={{ borderTop: si > 0 ? '1px solid var(--row-divider)' : undefined }}
                                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.06)')}
                                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                      <td className="px-4 py-2.5">
                                        <Link
                                          href={`/scans/${s.id}`}
                                          onClick={e => e.stopPropagation()}
                                          className="flex items-center gap-2 group/link"
                                        >
                                          <span
                                            className="w-1 h-4 rounded-full shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity"
                                            style={{ background: 'linear-gradient(180deg,#a78bfa,#7c3aed)' }}
                                          />
                                          <span className="font-mono text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-violet-400 transition-colors">
                                            :{s.image_tag}
                                          </span>
                                        </Link>
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                                          style={{ background: csc.bg, color: csc.color, border: `1px solid ${csc.border}` }}>
                                          {s.status}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-red-400">{s.critical_count || '—'}</td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-orange-400">{s.high_count || '—'}</td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-yellow-400">{s.medium_count || '—'}</td>
                                      <td className="px-3 py-2.5 text-center font-mono text-xs text-blue-400">{s.low_count || '—'}</td>
                                      <td className="px-4 py-2.5 text-xs text-zinc-500 max-w-[160px] truncate" title={s.owner_email || '—'}>
                                        {s.owner_email ? s.owner_email : <span className="italic text-zinc-400">anonymous</span>}
                                      </td>
                                      <td className="px-4 py-2.5 text-xs text-zinc-500">{s.share_token ? s.share_visibility || 'shared' : 'private'}</td>
                                      <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap" title={fullDate(s.created_at)}>
                                        {timeAgo(s.created_at)}
                                      </td>
                                      <td className="px-4 py-2.5">
                                        <div className="flex items-center gap-1 flex-wrap" onClick={(event) => event.stopPropagation()}>
                                          <button onClick={(event) => { event.preventDefault(); void handleRescan(s); }}
                                            disabled={actionLoadingId === `${s.id}:rescan`}
                                            className="btn-primary-sm"
                                            type="button">
                                            Rescan
                                          </button>
                                          {(s.status === 'pending' || s.status === 'running') && (
                                            <button onClick={(event) => { event.preventDefault(); void handleCancel(s); }}
                                              disabled={actionLoadingId === `${s.id}:cancel`}
                                              className="btn-warning-sm"
                                              type="button">
                                              Cancel
                                            </button>
                                          )}
                                          {!s.share_token ? (
                                            <button onClick={(event) => { event.preventDefault(); void handleCreateShare(s); }}
                                              disabled={actionLoadingId === `${s.id}:share`}
                                              className="btn-secondary-sm"
                                              type="button">
                                              Share
                                            </button>
                                          ) : (
                                            <>
                                              <button onClick={(event) => { event.preventDefault(); void handleCopyShare(s); }}
                                                className="btn-secondary-sm"
                                                type="button">
                                                Copy Link
                                              </button>
                                              <button onClick={(event) => { event.preventDefault(); void handleRevokeShare(s); }}
                                                disabled={actionLoadingId === `${s.id}:revoke`}
                                                className="btn-danger-sm"
                                                type="button">
                                                Revoke
                                              </button>
                                            </>
                                          )}
                                          <button onClick={(event) => { event.preventDefault(); openTagModal(s); }}
                                            className="btn-secondary-sm"
                                            type="button">
                                            Add Tag
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal state={tagModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Add Tag</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="tag-form" onSubmit={handleAddTag} className="space-y-4">
                  <div>
                    <p className="text-sm text-zinc-500">Assign a tag to {tagScan ? `${tagScan.image_name}:${tagScan.image_tag}` : 'this scan'}.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                    <Select selectedKey={selectedTagId} onSelectionChange={(key) => setSelectedTagId(String(key))}>
                      <Select.Trigger className={selectTriggerCls}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-zinc-400 shrink-0"><Tag01Icon size={15} /></span>
                          <Select.Value />
                        </div>
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {availableTags.map((tag) => (
                            <ListBox.Item key={tag.id} id={tag.id}>{tag.name}</ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={tagModal.close} type="button">
                  Cancel
                </button>
                <button type="submit" form="tag-form" disabled={!selectedTagId || actionLoadingId === `${tagScan?.id}:tag`}
                  className="btn-primary inline-flex items-center gap-2">
                  {actionLoadingId === `${tagScan?.id}:tag` && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Add Tag
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────── ──────────────────────────────────────────────────────────────
export default function AdminPage() {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Admin</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage system configuration, users, service credentials, notifications, and cross-user scans.</p>
      </div>

      <div className="segmented-control flex-wrap">
        {ADMIN_TABS.map((tab) => (
          <Link key={tab.value} href={tab.href}
            className="segmented-control-item"
            data-active={activeTab === tab.value ? 'true' : 'false'}>
            {tab.label}
          </Link>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'scanner' && <ScannerTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'tokens' && <TokensTab />}
      {activeTab === 'autotags' && <AutoTagsTab />}
      {activeTab === 'audit' && <AuditLogTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'scans' && <ScansTab />}
    </div>
  );
}
