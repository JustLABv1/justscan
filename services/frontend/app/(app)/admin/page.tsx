'use client';
import { getAdminSettings, setPublicScanEnabled } from '@/lib/api';
import { useEffect, useState } from 'react';

export default function AdminSettingsPage() {
  const [publicScanEnabled, setPublicScanEnabledState] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    getAdminSettings()
      .then(settings => {
        setPublicScanEnabledState(settings['public_scan_enabled'] !== 'false');
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

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Admin Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Manage system-wide configuration and feature flags.</p>
      </div>

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

      {/* Public Scan Feature */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Public Scanning</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Allow unauthenticated users to scan Docker images at{' '}
            <a href="/scan" target="_blank" className="text-violet-500 hover:underline">/scan</a>.
            Rate limited to 5 scans per hour per IP.
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
    </div>
  );
}
