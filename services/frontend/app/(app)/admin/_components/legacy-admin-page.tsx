'use client';
import { useConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { heroSelectTriggerClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  addTagToScan,
  adminCreateGlobalRegistry,
  adminCreateGroupMapping,
  adminCreateOIDCProvider,
  adminDeleteGlobalRegistry,
  adminDeleteGroupMapping,
  adminDeleteOIDCProvider,
  adminListGlobalRegistries,
  adminListGroupMappings,
  adminListOIDCProviders,
  AdminScan,
  adminSetDefaultRegistry,
  AdminToken,
  adminUnsetDefaultRegistry,
  adminUpdateAuthSettings,
  adminUpdateOIDCProvider,
  adminUpdateScannerSettings,
  AdminUser,
  APIRequestLog,
  APIRequestLogFilters,
  APIUsageStats,
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
  getAPIUsageStats,
  getScannerHealth,
  listAdminScans,
  listAdminTokens,
  listAdminUsers,
  listAPIRequestLogs,
  listAuditLogs,
  listAutoTagRules,
  listNotificationChannels,
  listNotificationDeliveries,
  listOrgs,
  listTags,
  listXRayRequestLogs,
  NotificationChannel,
  NotificationDelivery,
  OIDCGroupMapping,
  OIDCProviderAdmin,
  Org,
  Registry,
  RegistryWithHealth,
  reScan,
  ScannerCapabilities,
  ScannerHealth,
  ScannerSettings,
  setPublicScanEnabled,
  Tag,
  testNotificationChannel,
  updateAdminToken,
  updateAdminUser,
  updateAPILogRetention,
  updateAutoTagRule,
  updateNotificationChannel,
  updateRateLimit,
  updateRegisterRateLimit,
  updateXRayLogRetention,
  XRayRequestLog,
  XRayRequestLogFilters,
} from '@/lib/api';
import { APP_COPYRIGHT, APP_FRONTEND_VERSION } from '@/lib/build-info';
import { fullDate, timeAgo } from '@/lib/time';
import { Input, Label, ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { ArrowDown01Icon, ArrowRight01Icon, Delete01Icon, Notification01Icon, PencilEdit01Icon, PlusSignIcon, Shield01Icon, Tag01Icon } from 'hugeicons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminChrome } from './admin-chrome';
import { resolveAdminTab } from './admin-tabs';
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

function parseDelimitedList(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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
        <button onClick={load} disabled={loading} className="btn-secondary">
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
  const [apiLogRetention, setApiLogRetention] = useState<number>(30);
  const [apiLogRetentionInput, setApiLogRetentionInput] = useState('30');
  const [xrayLogRetention, setXrayLogRetention] = useState<number>(30);
  const [xrayLogRetentionInput, setXrayLogRetentionInput] = useState('30');
  const [saving, setSaving] = useState(false);
  const [savingRl, setSavingRl] = useState(false);
  const [savingRegisterRl, setSavingRegisterRl] = useState(false);
  const [savingApiRetention, setSavingApiRetention] = useState(false);
  const [savingXrayRetention, setSavingXrayRetention] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getAdminSettings()
      .then(settings => {
        setPublicScanEnabledState(settings['public_scan_enabled'] !== 'false');
        const rl = parseInt(settings['public_scan_rate_limit'] ?? '5', 10);
        const registrationRl = parseInt(settings['register_rate_limit'] ?? '10', 10);
        const apiRet = parseInt(settings['api_log_retention_days'] ?? '30', 10);
        const xrayRet = parseInt(settings['xray_log_retention_days'] ?? '30', 10);
        setRateLimitState(rl);
        setRateLimitInput(String(rl));
        setRegisterRateLimitState(registrationRl);
        setRegisterRateLimitInput(String(registrationRl));
        setApiLogRetention(apiRet);
        setApiLogRetentionInput(String(apiRet));
        setXrayLogRetention(xrayRet);
        setXrayLogRetentionInput(String(xrayRet));
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

  async function handleSaveApiLogRetention() {
    const v = parseInt(apiLogRetentionInput, 10);
    if (isNaN(v) || v < 0) { setError('Retention must be 0 or more (0 = keep forever)'); return; }
    setSavingApiRetention(true); setError(''); setSuccess('');
    try {
      await updateAPILogRetention(v);
      setApiLogRetention(v);
      setSuccess('API log retention updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update API log retention');
    } finally {
      setSavingApiRetention(false);
    }
  }

  async function handleSaveXrayLogRetention() {
    const v = parseInt(xrayLogRetentionInput, 10);
    if (isNaN(v) || v < 0) { setError('Retention must be 0 or more (0 = keep forever)'); return; }
    setSavingXrayRetention(true); setError(''); setSuccess('');
    try {
      await updateXRayLogRetention(v);
      setXrayLogRetention(v);
      setSuccess('xRay log retention updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update xRay log retention');
    } finally {
      setSavingXrayRetention(false);
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

      {/* API Log Retention */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">API Log Retention</h2>
          <p className="text-sm text-zinc-500 mt-0.5">How many days to keep API request logs. Set to 0 to retain indefinitely.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            className={inputCls + ' max-w-[120px]'}
            value={apiLogRetentionInput}
            onChange={e => setApiLogRetentionInput(e.target.value)}
          />
          <span className="text-sm text-zinc-500">days (0 = forever)</span>
          <button
            onClick={handleSaveApiLogRetention}
            disabled={savingApiRetention || apiLogRetentionInput === String(apiLogRetention)}
            className="btn-primary inline-flex items-center gap-2"
            type="button"
          >
            {savingApiRetention && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Save
          </button>
        </div>
      </div>

      {/* xRay Log Retention */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">xRay Log Retention</h2>
          <p className="text-sm text-zinc-500 mt-0.5">How many days to keep Artifactory xRay request logs. Set to 0 to retain indefinitely.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            className={inputCls + ' max-w-[120px]'}
            value={xrayLogRetentionInput}
            onChange={e => setXrayLogRetentionInput(e.target.value)}
          />
          <span className="text-sm text-zinc-500">days (0 = forever)</span>
          <button
            onClick={handleSaveXrayLogRetention}
            disabled={savingXrayRetention || xrayLogRetentionInput === String(xrayLogRetention)}
            className="btn-primary inline-flex items-center gap-2"
            type="button"
          >
            {savingXrayRetention && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Save
          </button>
        </div>
      </div>

      <ScannerSettingsPanel />
      <AuthSettingsPanel />
    </div>
  );
}

function ScannerSettingsPanel() {
  const [settings, setSettings] = useState<ScannerSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getAdminSettings().then((s) => {
      setSettings({
        enable_trivy: s['scanner.enable_trivy'] !== 'false',
        enable_grype: s['scanner.enable_grype'] !== 'false',
        concurrency: parseInt(s['scanner.concurrency'] ?? '2', 10),
        timeout_seconds: parseInt(s['scanner.timeout_seconds'] ?? '300', 10),
        db_max_age_hours: parseInt(s['scanner.db_max_age_hours'] ?? '24', 10),
        enable_osv_java_augmentation: s['scanner.enable_osv_java_augmentation'] === 'true',
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      await adminUpdateScannerSettings(settings);
      setSuccess('Scanner settings updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update scanner settings');
    } finally { setSaving(false); }
  };

  if (loading) return null;

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Scanner Settings</h2>
        <p className="text-sm text-zinc-500 mt-0.5">Configure runtime scanner behavior. These override config.yaml values.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={settings.enable_trivy ?? true} onChange={(e) => setSettings((s) => ({ ...s, enable_trivy: e.target.checked }))} className="rounded" />
          Enable Trivy
        </label>
        <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={settings.enable_grype ?? true} onChange={(e) => setSettings((s) => ({ ...s, enable_grype: e.target.checked }))} className="rounded" />
          Enable Grype
        </label>
        <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={settings.enable_osv_java_augmentation ?? false} onChange={(e) => setSettings((s) => ({ ...s, enable_osv_java_augmentation: e.target.checked }))} className="rounded" />
          OSV Java Augmentation
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Concurrency</label>
          <input type="number" min={1} max={32} value={settings.concurrency ?? 2} onChange={(e) => setSettings((s) => ({ ...s, concurrency: parseInt(e.target.value, 10) }))} className={inputCls + ' w-full'} />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Timeout (seconds)</label>
          <input type="number" min={30} value={settings.timeout_seconds ?? 300} onChange={(e) => setSettings((s) => ({ ...s, timeout_seconds: parseInt(e.target.value, 10) }))} className={inputCls + ' w-full'} />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">DB Max Age (hours)</label>
          <input type="number" min={1} value={settings.db_max_age_hours ?? 24} onChange={(e) => setSettings((s) => ({ ...s, db_max_age_hours: parseInt(e.target.value, 10) }))} className={inputCls + ' w-full'} />
        </div>
      </div>
      <button onClick={handleSave} disabled={saving} className="btn-primary inline-flex items-center gap-2" type="button">
        {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        Save Scanner Settings
      </button>
    </div>
  );
}

function AuthSettingsPanel() {
  const [localAuthEnabled, setLocalAuthEnabledState] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getAdminSettings().then((s) => {
      setLocalAuthEnabledState(s['auth.local_enabled'] !== 'false');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      await adminUpdateAuthSettings({ local_auth_enabled: localAuthEnabled });
      setSuccess('Auth settings updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update auth settings');
    } finally { setSaving(false); }
  };

  if (loading) return null;

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Authentication Settings</h2>
        <p className="text-sm text-zinc-500 mt-0.5">Control which sign-in methods are available to users.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}
      <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" checked={localAuthEnabled} onChange={(e) => setLocalAuthEnabledState(e.target.checked)} className="rounded" />
        Enable local username/password authentication
      </label>
      <button onClick={handleSave} disabled={saving} className="btn-primary inline-flex items-center gap-2" type="button">
        {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        Save Auth Settings
      </button>
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
                  <FormField
                    autoComplete={editingUser?.auth_type === 'oidc' ? 'off' : 'new-password'}
                    description={editingUser?.auth_type === 'oidc' ? 'Password changes are disabled for users currently authenticated through OIDC.' : (!isCreate ? 'Leave blank to keep unchanged.' : undefined)}
                    disabled={Boolean(editingUser?.auth_type === 'oidc')}
                    label="Password"
                    name="user-password"
                    onChange={e => setFormPassword(e.target.value)}
                    placeholder={isCreate ? 'Password' : editingUser?.auth_type === 'oidc' ? 'Managed by OIDC' : '••••••••'}
                    required={isCreate}
                    type="password"
                    value={formPassword}
                  />
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
                        <FormField
                          autoComplete="off"
                          label="Password"
                          name="smtp-password"
                          onChange={e => setFormSMTPPass(e.target.value)}
                          placeholder={editing ? '(unchanged)' : 'Password'}
                          type="password"
                          value={formSMTPPass}
                        />
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
                        <FormField
                          autoComplete="off"
                          label="Bot Token"
                          name="telegram-bot-token"
                          onChange={e => setFormTelegramBotToken(e.target.value)}
                          placeholder={editing ? '(unchanged)' : 'Telegram bot token'}
                          required={!editing}
                          type="password"
                          value={formTelegramBotToken}
                        />
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

// ── Insights Tab ─────────────────────────────────────────────────────
function statusColor(code: number): React.CSSProperties {
  if (code <= 0) return { color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' };
  if (code >= 500) return { color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' };
  if (code >= 400) return { color: '#fbbf24', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' };
  if (code >= 200) return { color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' };
  return { color: '#a1a1aa' };
}

function InsightsTab() {
  const [section, setSection] = useState<'api' | 'xray'>('api');

  // ── API request logs ──────────────────────────────────────────────
  const [apiLogs, setApiLogs] = useState<APIRequestLog[]>([]);
  const [apiTotal, setApiTotal] = useState(0);
  const [apiPage, setApiPage] = useState(1);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [apiFilters, setApiFilters] = useState<{ method: string; path: string; user: string; status: string; from: string; to: string }>({
    method: '', path: '', user: '', status: '', from: '', to: '',
  });
  const [stats, setStats] = useState<APIUsageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [apiExporting, setApiExporting] = useState(false);
  const limit = 50;

  const apiRequestFilters: APIRequestLogFilters = useMemo(() => ({
    method: apiFilters.method || undefined,
    path: apiFilters.path || undefined,
    user: apiFilters.user || undefined,
    status: apiFilters.status || undefined,
    from: toIsoOrUndefined(apiFilters.from),
    to: toIsoOrUndefined(apiFilters.to),
  }), [apiFilters]);

  const loadApiLogs = useCallback(async (p: number, f: APIRequestLogFilters) => {
    setApiLoading(true);
    setApiError('');
    try {
      const r = await listAPIRequestLogs(p, limit, f);
      setApiLogs(r.data ?? []);
      setApiTotal(r.total);
    } catch (e: unknown) { setApiError(e instanceof Error ? e.message : 'Failed to load API logs'); }
    finally { setApiLoading(false); }
  }, []);

  const loadStats = useCallback(async (from?: string, to?: string) => {
    setStatsLoading(true);
    try {
      setStats(await getAPIUsageStats(from, to));
    } catch { /* non-critical */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => {
    loadApiLogs(apiPage, apiRequestFilters);
  }, [loadApiLogs, apiPage, apiRequestFilters]);

  useEffect(() => {
    loadStats(toIsoOrUndefined(apiFilters.from), toIsoOrUndefined(apiFilters.to));
  }, [loadStats, apiFilters.from, apiFilters.to]);

  function updateApiFilter<K extends keyof typeof apiFilters>(key: K, value: string) {
    setApiFilters(prev => ({ ...prev, [key]: value }));
    setApiPage(1);
  }

  async function handleApiExport() {
    setApiExporting(true);
    setApiError('');
    try {
      const rows: APIRequestLog[] = [];
      let p = 1;
      let total = 0;
      do {
        const r = await listAPIRequestLogs(p, 500, apiRequestFilters);
        rows.push(...(r.data ?? []));
        total = r.total ?? 0;
        p++;
      } while (rows.length < total);

      const csv = [
        ['created_at', 'method', 'path', 'status_code', 'duration_ms', 'username', 'email'].join(','),
        ...rows.map(r => [
          escapeCsv(r.created_at), escapeCsv(r.method), escapeCsv(r.path),
          r.status_code, r.duration_ms,
          escapeCsv(r.username ?? r.user_id ?? ''), escapeCsv(r.email ?? ''),
        ].join(',')),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `justscan-api-logs-${new Date().toISOString().slice(0, 19)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setApiError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setApiExporting(false);
    }
  }

  // ── xRay request logs ─────────────────────────────────────────────
  const [xrayLogs, setXrayLogs] = useState<XRayRequestLog[]>([]);
  const [xrayTotal, setXrayTotal] = useState(0);
  const [xrayPage, setXrayPage] = useState(1);
  const [xrayLoading, setXrayLoading] = useState(true);
  const [xrayError, setXrayError] = useState('');
  const [xrayFilters, setXrayFilters] = useState<XRayRequestLogFilters & { from: string; to: string }>({
    scan_id: '', registry_id: '', endpoint: '', status: '', from: '', to: '',
  });
  const [xrayExporting, setXrayExporting] = useState(false);

  const xrayRequestFilters: XRayRequestLogFilters = useMemo(() => ({
    scan_id: xrayFilters.scan_id || undefined,
    registry_id: xrayFilters.registry_id || undefined,
    endpoint: xrayFilters.endpoint || undefined,
    status: xrayFilters.status || undefined,
    from: toIsoOrUndefined(xrayFilters.from),
    to: toIsoOrUndefined(xrayFilters.to),
  }), [xrayFilters]);

  const loadXrayLogs = useCallback(async (p: number, f: XRayRequestLogFilters) => {
    setXrayLoading(true);
    setXrayError('');
    try {
      const r = await listXRayRequestLogs(p, limit, f);
      setXrayLogs(r.data ?? []);
      setXrayTotal(r.total);
    } catch (e: unknown) { setXrayError(e instanceof Error ? e.message : 'Failed to load xRay logs'); }
    finally { setXrayLoading(false); }
  }, []);

  useEffect(() => {
    loadXrayLogs(xrayPage, xrayRequestFilters);
  }, [loadXrayLogs, xrayPage, xrayRequestFilters]);

  function updateXrayFilter<K extends keyof typeof xrayFilters>(key: K, value: string) {
    setXrayFilters(prev => ({ ...prev, [key]: value }));
    setXrayPage(1);
  }

  async function handleXrayExport() {
    setXrayExporting(true);
    setXrayError('');
    try {
      const rows: XRayRequestLog[] = [];
      let p = 1;
      let total = 0;
      do {
        const r = await listXRayRequestLogs(p, 500, xrayRequestFilters);
        rows.push(...(r.data ?? []));
        total = r.total ?? 0;
        p++;
      } while (rows.length < total);

      const csv = [
        ['created_at', 'scan_id', 'registry_id', 'method', 'endpoint', 'status_code', 'duration_ms', 'error'].join(','),
        ...rows.map(r => [
          escapeCsv(r.created_at), escapeCsv(r.scan_id ?? ''), escapeCsv(r.registry_id ?? ''),
          escapeCsv(r.method), escapeCsv(r.endpoint), r.status_code, r.duration_ms, escapeCsv(r.error ?? ''),
        ].join(',')),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `justscan-xray-logs-${new Date().toISOString().slice(0, 19)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setXrayError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setXrayExporting(false);
    }
  }

  const apiTotalPages = Math.max(1, Math.ceil(apiTotal / limit));
  const xrayTotalPages = Math.max(1, Math.ceil(xrayTotal / limit));

  return (
    <div className="space-y-4">
      {/* Section toggle */}
      <div className="segmented-control w-fit">
        <button type="button" className="segmented-control-item" data-active={section === 'api' ? 'true' : 'false'} onClick={() => setSection('api')}>
          API Requests
        </button>
        <button type="button" className="segmented-control-item" data-active={section === 'xray' ? 'true' : 'false'} onClick={() => setSection('xray')}>
          xRay Calls
        </button>
      </div>

      {/* ── API Requests section ─────────────────────────────────────── */}
      {section === 'api' && (
        <div className="space-y-4">
          {/* Stats cards */}
          {!statsLoading && stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Total Requests', value: stats.total_requests.toLocaleString(), color: '#60a5fa', bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.18)' },
                { label: 'Error Rate', value: stats.total_requests > 0 ? `${((stats.error_requests / stats.total_requests) * 100).toFixed(1)}%` : '0%', color: '#f87171', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.18)' },
                { label: 'Avg Duration', value: `${stats.avg_duration_ms.toFixed(0)} ms`, color: '#a78bfa', bg: 'rgba(124,58,237,0.1)', border: 'rgba(124,58,237,0.18)' },
                { label: 'p95 Duration', value: `${stats.p95_duration_ms.toFixed(0)} ms`, color: '#fbbf24', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.18)' },
              ].map(card => (
                <div key={card.label} className="rounded-xl p-4" style={{ background: card.bg, border: `1px solid ${card.border}` }}>
                  <p className="text-xs text-zinc-500 mb-1">{card.label}</p>
                  <p className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Top endpoints */}
          {!statsLoading && stats && stats.top_endpoints.length > 0 && (
            <div className="glass-panel rounded-2xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Top Endpoints</h3>
              <div className="space-y-1.5">
                {stats.top_endpoints.map((ep, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>{ep.method}</span>
                    <span className="flex-1 text-zinc-700 dark:text-zinc-300 truncate font-mono text-xs">{ep.path}</span>
                    <span className="text-zinc-500 text-xs shrink-0">{ep.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {apiError && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
              {apiError}
            </div>
          )}

          {/* Filters */}
          <div className="glass-panel rounded-2xl p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <select className={inputCls} value={apiFilters.method} onChange={e => updateApiFilter('method', e.target.value)}>
                <option value="">All methods</option>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input className={inputCls + ' xl:col-span-2'} placeholder="Path filter" value={apiFilters.path} onChange={e => updateApiFilter('path', e.target.value)} />
              <input className={inputCls} placeholder="User or email" value={apiFilters.user} onChange={e => updateApiFilter('user', e.target.value)} />
              <select className={inputCls} value={apiFilters.status} onChange={e => updateApiFilter('status', e.target.value)}>
                <option value="">All statuses</option>
                <option value="2xx">2xx Success</option>
                <option value="4xx">4xx Client Error</option>
                <option value="5xx">5xx Server Error</option>
                <option value="error">Any Error (4xx+)</option>
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input type="datetime-local" className={inputCls} value={apiFilters.from} onChange={e => updateApiFilter('from', e.target.value)} />
              <input type="datetime-local" className={inputCls} value={apiFilters.to} onChange={e => updateApiFilter('to', e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-500">{apiTotal.toLocaleString()} requests</p>
              <button onClick={handleApiExport} disabled={apiExporting || apiTotal === 0} className="btn-primary inline-flex items-center gap-2" type="button">
                {apiExporting && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Export CSV
              </button>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setApiPage(p => Math.max(1, p - 1))} disabled={apiPage <= 1} className="btn-secondary" type="button">←</button>
            <span className="text-zinc-500">{apiPage} / {apiTotalPages}</span>
            <button onClick={() => setApiPage(p => Math.min(apiTotalPages, p + 1))} disabled={apiPage >= apiTotalPages} className="btn-secondary" type="button">→</button>
          </div>

          {/* Table */}
          {apiLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
            </div>
          ) : apiLogs.length === 0 ? (
            <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
              <p className="text-sm text-zinc-500">No API request logs yet.</p>
            </div>
          ) : (
            <div className="glass-panel rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">User</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Method</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Path</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {apiLogs.map((log, i) => (
                    <tr key={log.id}
                      style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap" title={fullDate(log.created_at)}>
                        {timeAgo(log.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 max-w-[120px] truncate">
                        {log.username || log.email || (log.user_id ? log.user_id.slice(0, 8) : <span className="italic opacity-50">anon</span>)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                          {log.method}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-zinc-600 dark:text-zinc-300 max-w-xs truncate">{log.path}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono font-medium px-1.5 py-0.5 rounded-md" style={statusColor(log.status_code)}>
                          {log.status_code}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">{log.duration_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── xRay Calls section ──────────────────────────────────────── */}
      {section === 'xray' && (
        <div className="space-y-4">
          {xrayError && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
              {xrayError}
            </div>
          )}

          {/* Filters */}
          <div className="glass-panel rounded-2xl p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input className={inputCls} placeholder="Scan ID" value={xrayFilters.scan_id ?? ''} onChange={e => updateXrayFilter('scan_id', e.target.value)} />
              <input className={inputCls} placeholder="Endpoint path" value={xrayFilters.endpoint ?? ''} onChange={e => updateXrayFilter('endpoint', e.target.value)} />
              <select className={inputCls} value={xrayFilters.status ?? ''} onChange={e => updateXrayFilter('status', e.target.value)}>
                <option value="">All statuses</option>
                <option value="2xx">2xx Success</option>
                <option value="4xx">4xx Client Error</option>
                <option value="5xx">5xx Server Error</option>
                <option value="error">Any Error</option>
              </select>
              <input className={inputCls} placeholder="Registry ID" value={xrayFilters.registry_id ?? ''} onChange={e => updateXrayFilter('registry_id', e.target.value)} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <input type="datetime-local" className={inputCls} value={xrayFilters.from} onChange={e => updateXrayFilter('from', e.target.value)} />
              <input type="datetime-local" className={inputCls} value={xrayFilters.to} onChange={e => updateXrayFilter('to', e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-500">{xrayTotal.toLocaleString()} calls recorded</p>
              <button onClick={handleXrayExport} disabled={xrayExporting || xrayTotal === 0} className="btn-primary inline-flex items-center gap-2" type="button">
                {xrayExporting && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                Export CSV
              </button>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-2 text-sm">
            <button onClick={() => setXrayPage(p => Math.max(1, p - 1))} disabled={xrayPage <= 1} className="btn-secondary" type="button">←</button>
            <span className="text-zinc-500">{xrayPage} / {xrayTotalPages}</span>
            <button onClick={() => setXrayPage(p => Math.min(xrayTotalPages, p + 1))} disabled={xrayPage >= xrayTotalPages} className="btn-secondary" type="button">→</button>
          </div>

          {/* Table */}
          {xrayLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
            </div>
          ) : xrayLogs.length === 0 ? (
            <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
              <p className="text-sm text-zinc-500">No xRay request logs yet. Run a scan against an Artifactory Xray registry to populate.</p>
            </div>
          ) : (
            <div className="glass-panel rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Time</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Scan</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Method</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Endpoint</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Duration</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {xrayLogs.map((log, i) => (
                    <tr key={log.id}
                      style={{ borderTop: i > 0 ? '1px solid var(--row-divider)' : undefined }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--row-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td className="px-4 py-2.5 text-xs text-zinc-400 whitespace-nowrap" title={fullDate(log.created_at)}>
                        {timeAgo(log.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">
                        {log.scan_id ? (
                          <Link href={`/scans/${log.scan_id}`} className="text-violet-400 hover:underline font-mono">
                            {log.scan_id.slice(0, 8)}…
                          </Link>
                        ) : <span className="opacity-40 italic">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono font-medium px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                          {log.method}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs font-mono text-zinc-600 dark:text-zinc-300 max-w-xs truncate">{log.endpoint}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs font-mono font-medium px-1.5 py-0.5 rounded-md" style={statusColor(log.status_code)}>
                          {log.status_code <= 0 ? 'ERR' : log.status_code}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">{log.duration_ms} ms</td>
                      <td className="px-4 py-2.5 text-xs text-red-400 max-w-[200px] truncate" title={log.error}>{log.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Identity Providers Tab ─────────────────────────────────────────────────────
function IdentityProvidersTab() {
  const [providers, setProviders] = useState<OIDCProviderAdmin[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<OIDCProviderAdmin | null>(null);
  const [mappings, setMappings] = useState<OIDCGroupMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [mappingError, setMappingError] = useState('');
  const [editingProvider, setEditingProvider] = useState<OIDCProviderAdmin | null>(null);
  const [providerName, setProviderName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [buttonColor, setButtonColor] = useState('');
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [scopesInput, setScopesInput] = useState('openid, profile, email');
  const [adminGroupsInput, setAdminGroupsInput] = useState('');
  const [adminRolesInput, setAdminRolesInput] = useState('');
  const [groupsClaim, setGroupsClaim] = useState('groups');
  const [rolesClaim, setRolesClaim] = useState('roles');
  const [providerEnabled, setProviderEnabled] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [providerFormError, setProviderFormError] = useState('');
  const [providerSaving, setProviderSaving] = useState(false);
  const [mappingGroup, setMappingGroup] = useState('');
  const [mappingOrgId, setMappingOrgId] = useState('');
  const [mappingRole, setMappingRole] = useState<'viewer' | 'editor' | 'admin'>('viewer');
  const [mappingAutoCreate, setMappingAutoCreate] = useState(false);
  const [mappingRemoveOnUnsync, setMappingRemoveOnUnsync] = useState(true);
  const [mappingFormError, setMappingFormError] = useState('');
  const [mappingSaving, setMappingSaving] = useState(false);
  const providerModal = useOverlayState();
  const mappingModal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [providerData, orgData] = await Promise.all([adminListOIDCProviders(), listOrgs()]);
      setProviders(providerData);
      setOrgs(orgData);
      setSelectedProvider((current) => current ? providerData.find((provider) => provider.name === current.name) ?? null : current);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load identity provider settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMappings = useCallback(async (providerName: string) => {
    setMappingsLoading(true);
    setMappingError('');
    try {
      setMappings(await adminListGroupMappings(providerName));
    } catch (loadError: unknown) {
      setMappingError(loadError instanceof Error ? loadError.message : 'Failed to load group mappings');
    } finally {
      setMappingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProvider) {
      loadMappings(selectedProvider.name);
    }
  }, [selectedProvider, loadMappings]);

  function openCreateProvider() {
    setEditingProvider(null);
    setProviderName('');
    setDisplayName('');
    setButtonColor('');
    setIssuerUrl('');
    setClientId('');
    setClientSecret('');
    setRedirectUri('');
    setScopesInput('openid, profile, email');
    setAdminGroupsInput('');
    setAdminRolesInput('');
    setGroupsClaim('groups');
    setRolesClaim('roles');
    setProviderEnabled(true);
    setSortOrder(String(providers.length));
    setProviderFormError('');
    providerModal.open();
  }

  function openEditProvider(provider: OIDCProviderAdmin) {
    setEditingProvider(provider);
    setProviderName(provider.name);
    setDisplayName(provider.display_name);
    setButtonColor(provider.button_color ?? '');
    setIssuerUrl(provider.issuer_url);
    setClientId(provider.client_id);
    setClientSecret('');
    setRedirectUri(provider.redirect_uri);
    setScopesInput((provider.scopes ?? []).join(', '));
    setAdminGroupsInput((provider.admin_groups ?? []).join(', '));
    setAdminRolesInput((provider.admin_roles ?? []).join(', '));
    setGroupsClaim(provider.groups_claim || 'groups');
    setRolesClaim(provider.roles_claim || 'roles');
    setProviderEnabled(provider.enabled);
    setSortOrder(String(provider.sort_order ?? 0));
    setProviderFormError('');
    providerModal.open();
  }

  function openCreateMapping() {
    if (!selectedProvider) return;
    setMappingGroup('');
    setMappingOrgId(orgs[0]?.id ?? '');
    setMappingRole('viewer');
    setMappingAutoCreate(false);
    setMappingRemoveOnUnsync(true);
    setMappingFormError('');
    mappingModal.open();
  }

  async function handleProviderSubmit(event: React.FormEvent) {
    event.preventDefault();
    setProviderSaving(true);
    setProviderFormError('');
    try {
      const payload = {
        name: providerName.trim(),
        display_name: displayName.trim(),
        button_color: buttonColor.trim() || undefined,
        issuer_url: issuerUrl.trim(),
        client_id: clientId.trim(),
        ...(clientSecret.trim() ? { client_secret: clientSecret.trim() } : {}),
        redirect_uri: redirectUri.trim(),
        scopes: parseDelimitedList(scopesInput),
        admin_groups: parseDelimitedList(adminGroupsInput),
        admin_roles: parseDelimitedList(adminRolesInput),
        groups_claim: groupsClaim.trim() || 'groups',
        roles_claim: rolesClaim.trim() || 'roles',
        enabled: providerEnabled,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
      };

      if (editingProvider) {
        await adminUpdateOIDCProvider(editingProvider.name, payload);
      } else {
        if (!payload.name || !clientSecret.trim()) {
          throw new Error('Name and client secret are required when creating a provider');
        }
        await adminCreateOIDCProvider(payload);
      }

      providerModal.close();
      await load();
    } catch (saveError: unknown) {
      setProviderFormError(saveError instanceof Error ? saveError.message : 'Failed to save provider');
    } finally {
      setProviderSaving(false);
    }
  }

  async function handleMappingSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProvider) return;
    setMappingSaving(true);
    setMappingFormError('');
    try {
      await adminCreateGroupMapping(selectedProvider.name, {
        oidc_group: mappingGroup.trim(),
        org_id: mappingOrgId,
        role: mappingRole,
        auto_create_org: mappingAutoCreate,
        remove_on_unsync: mappingRemoveOnUnsync,
      });
      mappingModal.close();
      await loadMappings(selectedProvider.name);
    } catch (saveError: unknown) {
      setMappingFormError(saveError instanceof Error ? saveError.message : 'Failed to create mapping');
    } finally {
      setMappingSaving(false);
    }
  }

  async function handleDelete(name: string) {
    const ok = await confirm({
      title: 'Delete OIDC Provider',
      message: `Remove provider "${name}"? This will break any logins using this provider.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await adminDeleteOIDCProvider(name);
    if (selectedProvider?.name === name) setSelectedProvider(null);
    await load();
  }

  async function handleToggleEnabled(provider: OIDCProviderAdmin) {
    await adminUpdateOIDCProvider(provider.name, { enabled: !provider.enabled });
    await load();
  }

  async function handleDeleteMapping(providerName: string, mappingId: string) {
    const ok = await confirm({
      title: 'Delete Mapping',
      message: 'Remove this group to organization mapping?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await adminDeleteGroupMapping(providerName, mappingId);
    await loadMappings(providerName);
  }

  return (
    <div className="space-y-4">
      {confirmDialog}

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Identity Providers</h2>
          <p className="text-sm text-zinc-500 mt-1">Create, edit, and disable OIDC providers without leaving the admin UI.</p>
        </div>
        <button onClick={openCreateProvider} className="btn-primary inline-flex items-center gap-2" type="button">
          <PlusSignIcon size={15} /> Add Provider
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : providers.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No OIDC providers configured yet.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Provider</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Issuer</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Scopes</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {providers.map((provider, index) => (
                <tr
                  key={provider.name}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {provider.button_color ? (
                          <span className="w-2.5 h-2.5 rounded-full border border-white/30" style={{ background: provider.button_color }} />
                        ) : null}
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">{provider.display_name}</span>
                      </div>
                      <p className="text-xs font-mono text-zinc-500">{provider.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500 max-w-sm truncate">{provider.issuer_url}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{provider.scopes?.length ? provider.scopes.join(', ') : 'openid, profile, email'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={provider.enabled
                      ? { color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }
                      : { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.15)' }}>
                      {provider.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        label={`Open actions for provider ${provider.display_name}`}
                        items={[
                          { id: 'mappings', label: selectedProvider?.name === provider.name ? 'Hide mappings' : 'View mappings', icon: <ArrowRight01Icon size={15} />, onAction: () => setSelectedProvider(selectedProvider?.name === provider.name ? null : provider) },
                          { id: 'edit', label: 'Edit provider', icon: <PencilEdit01Icon size={15} />, onAction: () => openEditProvider(provider) },
                          { id: 'toggle', label: provider.enabled ? 'Disable provider' : 'Enable provider', onAction: () => { void handleToggleEnabled(provider); } },
                          { id: 'delete', label: 'Delete provider', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(provider.name); } },
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

      {selectedProvider ? (
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-base font-semibold text-zinc-900 dark:text-white">Group Mappings</h3>
              <p className="text-sm text-zinc-500 mt-1">Auto-assign users from <span className="font-mono">{selectedProvider.name}</span> into organizations based on group claims.</p>
            </div>
            <button onClick={openCreateMapping} className="btn-secondary inline-flex items-center gap-2" type="button" disabled={orgs.length === 0}>
              <PlusSignIcon size={15} /> Add Mapping
            </button>
          </div>

          {mappingError && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
              {mappingError}
            </div>
          )}

          {mappingsLoading ? (
            <p className="text-sm text-zinc-500">Loading mappings…</p>
          ) : mappings.length === 0 ? (
            <div className="rounded-xl px-4 py-6 text-sm text-zinc-500" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
              No mappings configured for this provider yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">OIDC Group</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Organization</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Role</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Behavior</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping, index) => (
                    <tr key={mapping.id} style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300">{mapping.oidc_group}</td>
                      <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">{mapping.org_name ?? mapping.org_id}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500 uppercase tracking-[0.14em]">{mapping.role}</td>
                      <td className="px-4 py-3 text-xs text-zinc-500">{mapping.auto_create_org ? 'Auto-create org if missing' : 'Require existing org'} · {mapping.remove_on_unsync ? 'Remove on unsync' : 'Keep manual membership'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <RowActionsMenu
                            label={`Open actions for mapping ${mapping.oidc_group}`}
                            items={[
                              { id: 'delete', label: 'Delete mapping', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDeleteMapping(selectedProvider.name, mapping.id); } },
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
        </div>
      ) : null}

      <Modal state={providerModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">{editingProvider ? 'Edit Identity Provider' : 'Add Identity Provider'}</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="oidc-provider-form" onSubmit={handleProviderSubmit} className="space-y-4">
                  {providerFormError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {providerFormError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Provider Name</label>
                      <input className={inputCls} placeholder="google-workspace" value={providerName} onChange={(event) => setProviderName(event.target.value)} required disabled={Boolean(editingProvider)} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Display Name</label>
                      <input className={inputCls} placeholder="Google Workspace" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Issuer URL</label>
                      <input className={inputCls} placeholder="https://accounts.google.com" value={issuerUrl} onChange={(event) => setIssuerUrl(event.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Redirect URI</label>
                      <input className={inputCls} placeholder="https://app.example.com/api/v1/auth/oidc/provider/callback" value={redirectUri} onChange={(event) => setRedirectUri(event.target.value)} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Client ID</label>
                      <input className={inputCls} value={clientId} onChange={(event) => setClientId(event.target.value)} required />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Client Secret</label>
                      <input type="password" className={inputCls} value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder={editingProvider ? 'Leave blank to keep existing secret' : ''} required={!editingProvider} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Scopes</label>
                      <input className={inputCls} value={scopesInput} onChange={(event) => setScopesInput(event.target.value)} placeholder="openid, profile, email" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Button Color</label>
                      <input className={inputCls} value={buttonColor} onChange={(event) => setButtonColor(event.target.value)} placeholder="#0f766e" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Admin Groups</label>
                      <input className={inputCls} value={adminGroupsInput} onChange={(event) => setAdminGroupsInput(event.target.value)} placeholder="admins, platform-owners" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Admin Roles</label>
                      <input className={inputCls} value={adminRolesInput} onChange={(event) => setAdminRolesInput(event.target.value)} placeholder="admin, superuser" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Groups Claim</label>
                      <input className={inputCls} value={groupsClaim} onChange={(event) => setGroupsClaim(event.target.value)} placeholder="groups" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Roles Claim</label>
                      <input className={inputCls} value={rolesClaim} onChange={(event) => setRolesClaim(event.target.value)} placeholder="roles" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Sort Order</label>
                      <input type="number" className={inputCls} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
                    </div>
                  </div>
                  <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                    <input type="checkbox" className="rounded" checked={providerEnabled} onChange={(event) => setProviderEnabled(event.target.checked)} />
                    Provider enabled
                  </label>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={providerModal.close} type="button">Cancel</button>
                <button type="submit" form="oidc-provider-form" disabled={providerSaving} className="btn-primary inline-flex items-center gap-2">
                  {providerSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  {editingProvider ? 'Save Provider' : 'Create Provider'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={mappingModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Add Group Mapping</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="oidc-mapping-form" onSubmit={handleMappingSubmit} className="space-y-4">
                  {mappingFormError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {mappingFormError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">OIDC Group</label>
                    <input className={inputCls} placeholder="platform-admins" value={mappingGroup} onChange={(event) => setMappingGroup(event.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Organization</label>
                    <select className={inputCls} value={mappingOrgId} onChange={(event) => setMappingOrgId(event.target.value)} required>
                      <option value="" disabled>Select an organization</option>
                      {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Role</label>
                    <select className={inputCls} value={mappingRole} onChange={(event) => setMappingRole(event.target.value as 'viewer' | 'editor' | 'admin')}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" className="rounded" checked={mappingAutoCreate} onChange={(event) => setMappingAutoCreate(event.target.checked)} />
                      Recreate the target org automatically if it is missing
                    </label>
                    <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" className="rounded" checked={mappingRemoveOnUnsync} onChange={(event) => setMappingRemoveOnUnsync(event.target.checked)} />
                      Remove membership when the group is no longer present
                    </label>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={mappingModal.close} type="button">Cancel</button>
                <button type="submit" form="oidc-mapping-form" disabled={mappingSaving} className="btn-primary inline-flex items-center gap-2">
                  {mappingSaving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Create Mapping
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

// ── Global Registries Tab ──────────────────────────────────────────────────────
function GlobalRegistriesTab() {
  const [registries, setRegistries] = useState<RegistryWithHealth[]>([]);
  const [capabilities, setCapabilities] = useState<ScannerCapabilities>({ enable_trivy: true, enable_grype: true, providers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [xrayUrl, setXrayUrl] = useState('');
  const [xrayArtifactoryId, setXrayArtifactoryId] = useState('default');
  const [authType, setAuthType] = useState<'none' | 'basic' | 'token' | 'aws_ecr'>('none');
  const [scanProvider, setScanProvider] = useState<'trivy' | 'artifactory_xray'>('trivy');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const modal = useOverlayState();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminListGlobalRegistries();
      setRegistries(response.data);
      setCapabilities(response.capabilities);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load global registries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setName('');
    setUrl('');
    setXrayUrl('');
    setXrayArtifactoryId('default');
    setAuthType('none');
    setScanProvider(capabilities.enable_trivy ? 'trivy' : 'artifactory_xray');
    setUsername('');
    setPassword('');
    setFormError('');
    modal.open();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      await adminCreateGlobalRegistry({
        name: name.trim(),
        url: url.trim(),
        xray_url: scanProvider === 'artifactory_xray' ? xrayUrl.trim() || undefined : undefined,
        xray_artifactory_id: scanProvider === 'artifactory_xray' ? xrayArtifactoryId.trim() || 'default' : undefined,
        auth_type: authType,
        scan_provider: scanProvider,
        username: username.trim(),
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      modal.close();
      await load();
    } catch (saveError: unknown) {
      setFormError(saveError instanceof Error ? saveError.message : 'Failed to create global registry');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, registryName: string) {
    const ok = await confirm({
      title: 'Delete Registry',
      message: `Remove global registry "${registryName}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await adminDeleteGlobalRegistry(id);
    await load();
  }

  async function handleSetDefault(registry: Registry) {
    if (registry.is_default) {
      await adminUnsetDefaultRegistry(registry.id);
    } else {
      await adminSetDefaultRegistry(registry.id);
    }
    await load();
  }

  return (
    <div className="space-y-4">
      {confirmDialog}

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>
          {error}
        </div>
      )}

      <div className="glass-panel rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Global Registries</h2>
          <p className="text-sm text-zinc-500 mt-1">Create platform-wide registries that every scan flow can see and optionally use by default.</p>
        </div>
        <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2" type="button">
          <PlusSignIcon size={15} /> Add Global Registry
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 rounded-full border-2 border-zinc-300 dark:border-zinc-800 border-t-violet-500 animate-spin" />
        </div>
      ) : registries.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No global registries configured yet.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--row-divider)' }}>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Registry</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Endpoint</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Provider</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Default</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {registries.map((registry, index) => (
                <tr
                  key={registry.id}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <p className="font-medium text-zinc-700 dark:text-zinc-200">{registry.name}</p>
                      <p className="text-xs text-zinc-500">Auth: {registry.auth_type}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-zinc-500 max-w-sm truncate">{registry.url}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{registry.scan_provider === 'artifactory_xray' ? 'Artifactory Xray' : 'Trivy'}</td>
                  <td className="px-4 py-3">
                    {registry.is_default ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }}>Default</span>
                    ) : (
                      <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        label={`Open actions for registry ${registry.name}`}
                        items={[
                          { id: 'default', label: registry.is_default ? 'Unset default' : 'Set as default', onAction: () => { void handleSetDefault(registry); } },
                          { id: 'delete', label: 'Delete registry', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(registry.id, registry.name); } },
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
          <Modal.Container size="lg" placement="center">
            <Modal.Dialog className="glass-modal rounded-2xl overflow-hidden">
              <Modal.Header className="px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <Modal.Heading className="text-zinc-900 dark:text-white font-semibold">Add Global Registry</Modal.Heading>
                <Modal.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Modal.Header>
              <Modal.Body className="px-6 py-5">
                <form id="global-registry-form" onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Name</label>
                      <input className={inputCls} value={name} onChange={(event) => setName(event.target.value)} placeholder="Production Registry" required />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Registry URL</label>
                      <input className={inputCls} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://registry.example.com" required />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Scan Provider</label>
                      <select className={inputCls} value={scanProvider} onChange={(event) => setScanProvider(event.target.value as 'trivy' | 'artifactory_xray')}>
                        {capabilities.enable_trivy ? <option value="trivy">Trivy</option> : null}
                        <option value="artifactory_xray">Artifactory Xray</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Authentication</label>
                      <select className={inputCls} value={authType} onChange={(event) => setAuthType(event.target.value as 'none' | 'basic' | 'token' | 'aws_ecr')}>
                        <option value="none">None</option>
                        <option value="basic">Basic</option>
                        <option value="token">Token</option>
                        <option value="aws_ecr">AWS ECR</option>
                      </select>
                    </div>
                  </div>
                  {scanProvider === 'artifactory_xray' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Xray URL</label>
                        <input className={inputCls} value={xrayUrl} onChange={(event) => setXrayUrl(event.target.value)} placeholder="https://xray.example.com" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Artifactory ID</label>
                        <input className={inputCls} value={xrayArtifactoryId} onChange={(event) => setXrayArtifactoryId(event.target.value)} placeholder="default" />
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username</label>
                      <input className={inputCls} value={username} onChange={(event) => setUsername(event.target.value)} placeholder={authType === 'token' ? 'optional token user' : 'registry user'} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Password or Token</label>
                      <input type="password" className={inputCls} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={authType === 'token' ? 'Access token' : 'Secret'} />
                    </div>
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={modal.close} type="button">Cancel</button>
                <button type="submit" form="global-registry-form" disabled={saving} className="btn-primary inline-flex items-center gap-2">
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                  Create Registry
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────── ──────────────────────────────────────────────────────────────
export default function AdminPage() {
  const pathname = usePathname();
  const activeTab = resolveAdminTab(pathname);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AdminChrome />

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'settings' && <SettingsTab />}
      {activeTab === 'scanner' && <ScannerTab />}
      {activeTab === 'identity' && <IdentityProvidersTab />}
      {activeTab === 'registries' && <GlobalRegistriesTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'tokens' && <TokensTab />}
      {activeTab === 'autotags' && <AutoTagsTab />}
      {activeTab === 'audit' && <AuditLogTab />}
      {activeTab === 'notifications' && <NotificationsTab />}
      {activeTab === 'scans' && <ScansTab />}
      {activeTab === 'insights' && <InsightsTab />}
    </div>
  );
}
