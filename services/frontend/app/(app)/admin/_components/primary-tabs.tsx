'use client';

import { ListBox, Modal, Select, useOverlayState } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon, Shield01Icon, Tag01Icon } from 'hugeicons-react';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
    adminUpdateAuthSettings,
    adminUpdateScannerSettings,
    createAdminUser,
    createAutoTagRule,
    deleteAdminToken,
    deleteAdminUser,
    deleteAutoTagRule,
    disableAdminUser,
    getAdminSettings,
    listAdminScans,
    listAdminTokens,
    listAdminUsers,
    listAuditLogs,
    listAutoTagRules,
    listNotificationChannels,
    setPublicScanEnabled,
    updateAdminToken,
    updateAdminUser,
    updateAPILogRetention,
    updateAutoTagRule,
    updateRateLimit,
    updateRegisterRateLimit,
    updateXRayLogRetention,
} from '@/lib/api/admin';
import { getScannerHealth } from '@/lib/api/dashboard';
import { listTags } from '@/lib/api/tags';
import type { AdminToken, AdminUser, AuditLog, AuditLogFilters } from '@/lib/api/types/admin';
import type { ScannerHealth } from '@/lib/api/types/dashboard';
import type { AutoTagRule, ScannerSettings } from '@/lib/api/types/registries';
import type { Tag } from '@/lib/api/types/scans';
import { APP_COPYRIGHT, APP_FRONTEND_VERSION } from '@/lib/build-info';
import { fullDate, timeAgo } from '@/lib/time';

import { escapeCsv, formatDbAge, inputCls, scannerTone, selectTriggerCls, toIsoOrUndefined, USER_AUTH_STYLE, userAuthLabel } from './utils';

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
        <button onClick={load} disabled={loading} className="btn-secondary" type="button">
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
          <input type="checkbox" checked={settings.enable_trivy ?? true} onChange={(e) => setSettings((previous) => ({ ...previous, enable_trivy: e.target.checked }))} className="rounded" />
          Enable Trivy
        </label>
        <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={settings.enable_grype ?? true} onChange={(e) => setSettings((previous) => ({ ...previous, enable_grype: e.target.checked }))} className="rounded" />
          Enable Grype
        </label>
        <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={settings.enable_osv_java_augmentation ?? false} onChange={(e) => setSettings((previous) => ({ ...previous, enable_osv_java_augmentation: e.target.checked }))} className="rounded" />
          OSV Java Augmentation
        </label>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Concurrency</label>
          <input type="number" min={1} max={32} value={settings.concurrency ?? 2} onChange={(e) => setSettings((previous) => ({ ...previous, concurrency: parseInt(e.target.value, 10) }))} className={inputCls + ' w-full'} />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Timeout (seconds)</label>
          <input type="number" min={30} value={settings.timeout_seconds ?? 300} onChange={(e) => setSettings((previous) => ({ ...previous, timeout_seconds: parseInt(e.target.value, 10) }))} className={inputCls + ' w-full'} />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">DB Max Age (hours)</label>
          <input type="number" min={1} value={settings.db_max_age_hours ?? 24} onChange={(e) => setSettings((previous) => ({ ...previous, db_max_age_hours: parseInt(e.target.value, 10) }))} className={inputCls + ' w-full'} />
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
    getAdminSettings().then((settings) => {
      setLocalAuthEnabledState(settings['auth.local_enabled'] !== 'false');
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

export function SettingsTab() {
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
      .then((settings) => {
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
    const value = parseInt(rateLimitInput, 10);
    if (isNaN(value) || value < 1 || value > 1000) { setError('Rate limit must be between 1 and 1000'); return; }
    setSavingRl(true); setError(''); setSuccess('');
    try {
      await updateRateLimit(value);
      setRateLimitState(value);
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
    const value = parseInt(apiLogRetentionInput, 10);
    if (isNaN(value) || value < 0) { setError('Retention must be 0 or more (0 = keep forever)'); return; }
    setSavingApiRetention(true); setError(''); setSuccess('');
    try {
      await updateAPILogRetention(value);
      setApiLogRetention(value);
      setSuccess('API log retention updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update API log retention');
    } finally {
      setSavingApiRetention(false);
    }
  }

  async function handleSaveXrayLogRetention() {
    const value = parseInt(xrayLogRetentionInput, 10);
    if (isNaN(value) || value < 0) { setError('Retention must be 0 or more (0 = keep forever)'); return; }
    setSavingXrayRetention(true); setError(''); setSuccess('');
    try {
      await updateXRayLogRetention(value);
      setXrayLogRetention(value);
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
            Allow unauthenticated users to scan Docker images at <a href="/scan" target="_blank" className="text-violet-500 hover:underline" rel="noreferrer">/scan</a>. Rate limited per IP and managed below.
          </p>
        </div>
        {publicScanEnabled === null ? (
          <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-700 border-t-violet-500 animate-spin" />
        ) : (
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: publicScanEnabled ? 'rgba(124,58,237,0.15)' : 'rgba(113,113,122,0.1)', border: publicScanEnabled ? '1px solid rgba(167,139,250,0.3)' : '1px solid rgba(113,113,122,0.2)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={publicScanEnabled ? '#a78bfa' : '#71717a'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  {publicScanEnabled ? <polyline points="9 12 11 14 15 10" /> : <><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></>}
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Public scanning is currently <span className={publicScanEnabled ? 'text-emerald-500' : 'text-red-400'}>{publicScanEnabled ? 'enabled' : 'disabled'}</span>
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{publicScanEnabled ? 'Anyone can scan images without an account' : 'Only authenticated users can scan images'}</p>
              </div>
            </div>
            <button onClick={() => handleTogglePublicScan(!publicScanEnabled)} disabled={saving} className="shrink-0 px-4 py-2 text-sm font-medium rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed" style={publicScanEnabled ? { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' } : { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa' }} type="button">
              {saving ? <span className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />Saving…</span> : publicScanEnabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Public Scan Rate Limit</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Maximum number of public scans allowed per IP address per hour.</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="number" min={1} max={1000} className={inputCls + ' max-w-[120px]'} value={rateLimitInput} onChange={(e) => setRateLimitInput(e.target.value)} />
          <span className="text-sm text-zinc-500">per IP / hour</span>
          <button onClick={handleSaveRateLimit} disabled={savingRl || rateLimitInput === String(rateLimit)} className="btn-primary inline-flex items-center gap-2" type="button">
            {savingRl && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}Save
          </button>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Registration Rate Limit</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Maximum number of new accounts allowed per IP address per hour.</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="number" min={1} max={1000} className={inputCls + ' max-w-[120px]'} value={registerRateLimitInput} onChange={(e) => setRegisterRateLimitInput(e.target.value)} />
          <span className="text-sm text-zinc-500">registrations per IP / hour</span>
          <button onClick={handleSaveRegisterRateLimit} disabled={savingRegisterRl || registerRateLimitInput === String(registerRateLimit)} className="btn-primary inline-flex items-center gap-2" type="button">
            {savingRegisterRl && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}Save
          </button>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">API Log Retention</h2>
          <p className="text-sm text-zinc-500 mt-0.5">How many days to keep API request logs. Set to 0 to retain indefinitely.</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="number" min={0} className={inputCls + ' max-w-[120px]'} value={apiLogRetentionInput} onChange={(e) => setApiLogRetentionInput(e.target.value)} />
          <span className="text-sm text-zinc-500">days (0 = forever)</span>
          <button onClick={handleSaveApiLogRetention} disabled={savingApiRetention || apiLogRetentionInput === String(apiLogRetention)} className="btn-primary inline-flex items-center gap-2" type="button">
            {savingApiRetention && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}Save
          </button>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">xRay Log Retention</h2>
          <p className="text-sm text-zinc-500 mt-0.5">How many days to keep Artifactory xRay request logs. Set to 0 to retain indefinitely.</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="number" min={0} className={inputCls + ' max-w-[120px]'} value={xrayLogRetentionInput} onChange={(e) => setXrayLogRetentionInput(e.target.value)} />
          <span className="text-sm text-zinc-500">days (0 = forever)</span>
          <button onClick={handleSaveXrayLogRetention} disabled={savingXrayRetention || xrayLogRetentionInput === String(xrayLogRetention)} className="btn-primary inline-flex items-center gap-2" type="button">
            {savingXrayRetention && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}Save
          </button>
        </div>
      </div>

      <ScannerSettingsPanel />
      <AuthSettingsPanel />
    </div>
  );
}

export function ScannerTab() {
  return (
    <div className="space-y-6">
      <ScannerHealthPanel />
    </div>
  );
}

export function OverviewTab() {
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
      {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171' }}>{error}</div>}
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
                  <Link key={item.label} href={item.href} className="rounded-xl px-4 py-3 transition-colors hover:bg-violet-500/5" style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}>
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
                  { href: '/admin/scanner', label: 'Inspect worker health', meta: `${summary.staleWorkers} stale worker${summary.staleWorkers === 1 ? '' : 's'}` },
                  { href: '/admin/notifications', label: 'Review channel routing', meta: `${summary.activeChannels} active delivery channel${summary.activeChannels === 1 ? '' : 's'}` },
                  { href: '/admin/settings', label: 'Check public-scan exposure', meta: summary.publicScanEnabled ? 'Public scanning enabled' : 'Public scanning disabled' },
                  { href: '/admin/audit', label: 'Review recent admin activity', meta: `${summary.recentAudit.length} recent audit event${summary.recentAudit.length === 1 ? '' : 's'}` },
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

export function UsersTab() {
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

  function openEdit(user: AdminUser) {
    setIsCreate(false);
    setEditingUser(user);
    setFormUsername(user.username); setFormEmail(user.email); setFormRole(user.role); setFormPassword(''); setFormError('');
    modal.open();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault(); setFormError(''); setSaving(true);
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

  async function handleDelete(user: AdminUser) {
    const ok = await confirm({ title: `Delete "${user.username}"?`, message: 'This will permanently remove the user and cannot be undone.', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    await deleteAdminUser(user.id).catch(() => {});
    load();
  }

  async function handleToggleDisable(user: AdminUser) {
    const newDisabled = !user.disabled;
    const ok = await confirm(newDisabled
      ? { title: `Disable "${user.username}"?`, message: 'The user will no longer be able to log in.', confirmLabel: 'Disable', variant: 'warning' }
      : { title: `Re-enable "${user.username}"?`, message: 'The user will regain access to their account.', confirmLabel: 'Enable', variant: 'default' });
    if (!ok) return;
    await disableAdminUser(user.id, newDisabled).catch(() => {});
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
        <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2" type="button">
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
              {users.map((user, index) => (
                <tr
                  key={user.id}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{user.username}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={USER_AUTH_STYLE[user.auth_type ?? 'local']}>
                      {userAuthLabel(user.auth_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {user.last_login_at ? (
                      <div className="space-y-0.5">
                        <p title={fullDate(user.last_login_at)}>{timeAgo(user.last_login_at)}</p>
                        <p className="text-[11px] text-zinc-400">via {userAuthLabel(user.last_login_method || user.auth_type).toLowerCase()}</p>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={user.role === 'admin'
                      ? { color: '#a78bfa', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)' }
                      : { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', border: '1px solid rgba(161,161,170,0.15)' }}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.disabled ? (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        Disabled
                      </span>
                    ) : (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#34d399', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(user.created_at)}>{timeAgo(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <RowActionsMenu
                        label={`Open actions for ${user.username}`}
                        items={[
                          { id: 'toggle', label: user.disabled ? 'Enable user' : 'Disable user', onAction: () => { void handleToggleDisable(user); } },
                          { id: 'edit', label: 'Edit user', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(user) },
                          { id: 'delete', label: 'Delete user', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(user); } },
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
                    <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Username</label>
                    <input className={inputCls} placeholder="username" value={formUsername} onChange={(event) => setFormUsername(event.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Email</label>
                    <input type="email" className={inputCls} placeholder="user@example.com" value={formEmail} onChange={(event) => setFormEmail(event.target.value)} required />
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
                    <Select selectedKey={formRole} onSelectionChange={(key) => setFormRole(String(key))}>
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
                    onChange={(event) => setFormPassword(event.target.value)}
                    placeholder={isCreate ? 'Password' : editingUser?.auth_type === 'oidc' ? 'Managed by OIDC' : '••••••••'}
                    required={isCreate}
                    type="password"
                    value={formPassword}
                  />
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={modal.close} type="button">Cancel</button>
                <button type="submit" form="user-form" disabled={saving} className="btn-primary inline-flex items-center gap-2">
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

export function TokensTab() {
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

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
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
                <tr
                  key={token.id}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">{token.description || <span className="italic text-zinc-400">No description</span>}</td>
                  <td className="px-4 py-3 text-xs uppercase tracking-[0.14em] text-zinc-500">{token.type}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{token.key.slice(0, 6)}••••••••{token.key.slice(-4)}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(token.expires_at)}>{timeAgo(token.expires_at)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={token.disabled
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
                <button className="btn-secondary" onClick={modal.close} type="button">Cancel</button>
                <button type="submit" form="token-form" disabled={saving} className="btn-primary inline-flex items-center gap-2">
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

export function AutoTagsTab() {
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
      const [nextRules, nextTags] = await Promise.all([listAutoTagRules(), listTags()]);
      setRules(nextRules);
      setTags(nextTags);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setIsCreate(true);
    setEditingRule(null);
    setFormPattern('');
    setFormTagId(tags[0]?.id ?? '');
    setFormError('');
    modal.open();
  }

  function openEdit(rule: AutoTagRule) {
    setIsCreate(false);
    setEditingRule(rule);
    setFormPattern(rule.pattern);
    setFormTagId(rule.tag_id);
    setFormError('');
    modal.open();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (isCreate) await createAutoTagRule(formPattern, formTagId);
      else if (editingRule) await updateAutoTagRule(editingRule.id, formPattern, formTagId);
      modal.close();
      await load();
    } catch (saveError: unknown) {
      setFormError(saveError instanceof Error ? saveError.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({
      title: 'Delete auto-tag rule?',
      message: 'The rule will no longer apply to new scans.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    await deleteAutoTagRule(id).catch(() => {});
    load();
  }

  const tagById = (id: string) => tags.find((tag) => tag.id === id);

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
        <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2" type="button">
          <PlusSignIcon size={15} /> Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="glass-panel rounded-2xl py-16 flex flex-col items-center gap-3">
          <p className="text-sm text-zinc-500">No auto-tag rules yet.</p>
          <p className="text-xs text-zinc-400">Use patterns like <code className="px-1 py-0.5 rounded font-mono" style={{ background: 'var(--row-hover)' }}>nginx/*</code> to match image names.</p>
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
              {rules.map((rule, index) => {
                const tag = rule.tag ?? tagById(rule.tag_id);
                return (
                  <tr
                    key={rule.id}
                    style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                    onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                    onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-4 py-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">{rule.pattern}</td>
                    <td className="px-4 py-3">
                      {tag ? (
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-full" style={{ background: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}44` }}>
                          {tag.name}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400 font-mono">{rule.tag_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500" title={fullDate(rule.created_at)}>{timeAgo(rule.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <RowActionsMenu
                          label={`Open actions for pattern ${rule.pattern}`}
                          items={[
                            { id: 'edit', label: 'Edit rule', icon: <PencilEdit01Icon size={15} />, onAction: () => openEdit(rule) },
                            { id: 'delete', label: 'Delete rule', icon: <Delete01Icon size={15} />, variant: 'danger', onAction: () => { void handleDelete(rule.id); } },
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
                    <div className="rounded-xl px-3 py-2.5 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                      {formError}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Pattern</label>
                    <input className={inputCls + ' font-mono'} placeholder="nginx/*" value={formPattern} onChange={(event) => setFormPattern(event.target.value)} required />
                    <p className="text-xs text-zinc-500">Use glob patterns to match image names. Examples: <code className="font-mono px-1 py-0.5 rounded" style={{ background: 'var(--row-hover)' }}>nginx/*</code> <code className="font-mono px-1 py-0.5 rounded" style={{ background: 'var(--row-hover)' }}>myrepo/api*</code> <code className="font-mono px-1 py-0.5 rounded" style={{ background: 'var(--row-hover)' }}>*/prod-*</code></p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Tag</label>
                    {tags.length === 0 ? (
                      <p className="text-sm text-zinc-500">No tags available. Create tags first.</p>
                    ) : (
                      <Select selectedKey={formTagId} onSelectionChange={(key) => setFormTagId(String(key))} isRequired>
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
                            {tags.map((tag) => (
                              <ListBox.Item key={tag.id} id={tag.id}>{tag.name}</ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    )}
                  </div>
                </form>
              </Modal.Body>
              <Modal.Footer className="px-6 py-4 flex gap-3 justify-end" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn-secondary" onClick={modal.close} type="button">Cancel</button>
                <button type="submit" form="autotag-form" disabled={saving || tags.length === 0} className="btn-primary inline-flex items-center gap-2">
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

export function AuditLogTab() {
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

  const load = useCallback(async (nextPage: number, activeFilters: AuditLogFilters) => {
    setLoading(true);
    try {
      const result = await listAuditLogs(nextPage, limit, activeFilters);
      setLogs(result.data ?? []);
      setTotal(result.total);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
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
          <button onClick={handleExport} disabled={exporting || total === 0} className="btn-primary inline-flex items-center gap-2" type="button">
            {exporting && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Export CSV
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setPage((previous) => Math.max(1, previous - 1))} disabled={page <= 1} className="btn-secondary" type="button">←</button>
          <span className="text-zinc-500">{page} / {totalPages}</span>
          <button onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))} disabled={page >= totalPages} className="btn-secondary" type="button">→</button>
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
              {logs.map((log, index) => (
                <tr
                  key={log.id}
                  style={{ borderTop: index > 0 ? '1px solid var(--row-divider)' : undefined }}
                  onMouseEnter={(event) => (event.currentTarget.style.background = 'var(--row-hover)')}
                  onMouseLeave={(event) => (event.currentTarget.style.background = 'transparent')}
                >
                  <td className="px-4 py-3 text-xs text-zinc-400 whitespace-nowrap" title={fullDate(log.created_at)}>{timeAgo(log.created_at)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300 font-medium">{log.username ?? log.user_id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500 uppercase tracking-[0.14em]">{log.role ?? 'n/a'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-md" style={{ background: 'rgba(124,58,237,0.1)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>
                      {log.operation}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500 max-w-xs truncate">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}