'use client';

import {
  adminUpdateAuthSettings,
  adminUpdateScannerSettings,
  getAdminSettings,
  setPublicScanEnabled,
  updateAPILogRetention,
  updateRateLimit,
  updateRegisterRateLimit,
  updateXRayLogRetention,
} from '@/lib/api/admin';
import type { ScannerSettings } from '@/lib/api/types/registries';
import { Button, Card, Input, Link, Switch } from '@heroui/react';
import { useEffect, useState } from 'react';

function Banner({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <Card
      className={
        type === 'success'
          ? 'border border-success/30 bg-success/10'
          : 'border border-danger/30 bg-danger/10'
      }
    >
      <Card.Content>
        <p className={type === 'success' ? 'text-sm text-success' : 'text-sm text-danger'}>{text}</p>
      </Card.Content>
    </Card>
  );
}

function SettingRow({
  title,
  description,
  input,
  action,
}: {
  title: string;
  description: string;
  input: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-xl border border-divider/60 bg-content2/30 p-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <div className="lg:w-[190px]">{input}</div>
      <div>{action}</div>
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
    getAdminSettings()
      .then((s) => {
        setSettings({
          enable_trivy: s['scanner.enable_trivy'] !== 'false',
          enable_grype: s['scanner.enable_grype'] !== 'false',
          concurrency: parseInt(s['scanner.concurrency'] ?? '2', 10),
          timeout_seconds: parseInt(s['scanner.timeout_seconds'] ?? '300', 10),
          db_max_age_hours: parseInt(s['scanner.db_max_age_hours'] ?? '24', 10),
          enable_osv_java_augmentation: s['scanner.enable_osv_java_augmentation'] === 'true',
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await adminUpdateScannerSettings(settings);
      setSuccess('Scanner settings updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to update scanner settings'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Scanner Runtime</h2>
        <p className="text-sm text-zinc-500">Tune scanner engines and job execution behavior.</p>
      </div>

      {error && <Banner type="error" text={error} />}
      {success && <Banner type="success" text={success} />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Switch
          isSelected={settings.enable_trivy ?? true}
          onChange={(checked) => setSettings((p) => ({ ...p, enable_trivy: checked }))}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>Enable Trivy</Switch.Content>
        </Switch>
        <Switch
          isSelected={settings.enable_grype ?? true}
          onChange={(checked) => setSettings((p) => ({ ...p, enable_grype: checked }))}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>Enable Grype</Switch.Content>
        </Switch>
        <Switch
          isSelected={settings.enable_osv_java_augmentation ?? false}
          onChange={(checked) =>
            setSettings((p) => ({ ...p, enable_osv_java_augmentation: checked }))
          }
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>OSV Java Augmentation</Switch.Content>
        </Switch>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          type="number"
          min={1}
          max={32}
          placeholder="Concurrency"
          variant="secondary"
          value={String(settings.concurrency ?? 2)}
          onChange={(e) =>
            setSettings((p) => ({ ...p, concurrency: parseInt(e.target.value || '0', 10) }))
          }
        />
        <Input
          type="number"
          min={30}
          placeholder="Timeout (seconds)"
          variant="secondary"
          value={String(settings.timeout_seconds ?? 300)}
          onChange={(e) =>
            setSettings((p) => ({ ...p, timeout_seconds: parseInt(e.target.value || '0', 10) }))
          }
        />
        <Input
          type="number"
          min={1}
          placeholder="DB Max Age (hours)"
          variant="secondary"
          value={String(settings.db_max_age_hours ?? 24)}
          onChange={(e) =>
            setSettings((p) => ({ ...p, db_max_age_hours: parseInt(e.target.value || '0', 10) }))
          }
        />
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" onPress={handleSave} isDisabled={saving}>
          {saving ? 'Saving...' : 'Save Scanner Runtime'}
        </Button>
      </div>
    </Card>
  );
}

function AuthSettingsPanel() {
  const [localAuthEnabled, setLocalAuthEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getAdminSettings()
      .then((settings) => {
        setLocalAuthEnabled(settings['auth.local_enabled'] !== 'false');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await adminUpdateAuthSettings({ local_auth_enabled: localAuthEnabled });
      setSuccess('Authentication settings updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update auth settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Authentication</h2>
        <p className="text-sm text-zinc-500">Control available login methods.</p>
      </div>
      {error && <Banner type="error" text={error} />}
      {success && <Banner type="success" text={success} />}
      <Switch isSelected={localAuthEnabled} onChange={setLocalAuthEnabled}>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <Switch.Content>Enable local username/password authentication</Switch.Content>
      </Switch>
      <div className="flex justify-end">
        <Button variant="secondary" onPress={handleSave} isDisabled={saving}>
          {saving ? 'Saving...' : 'Save Authentication'}
        </Button>
      </div>
    </Card>
  );
}

export function SettingsTab() {
  const [publicScanEnabled, setPublicScanEnabledState] = useState<boolean | null>(null);
  const [rateLimit, setRateLimitState] = useState(5);
  const [rateLimitInput, setRateLimitInput] = useState('5');
  const [registerRateLimit, setRegisterRateLimitState] = useState(10);
  const [registerRateLimitInput, setRegisterRateLimitInput] = useState('10');
  const [apiLogRetention, setApiLogRetention] = useState(30);
  const [apiLogRetentionInput, setApiLogRetentionInput] = useState('30');
  const [xrayLogRetention, setXrayLogRetention] = useState(30);
  const [xrayLogRetentionInput, setXrayLogRetentionInput] = useState('30');

  const [savingPublic, setSavingPublic] = useState(false);
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
        const regRl = parseInt(settings['register_rate_limit'] ?? '10', 10);
        const apiRet = parseInt(settings['api_log_retention_days'] ?? '30', 10);
        const xrayRet = parseInt(settings['xray_log_retention_days'] ?? '30', 10);
        setRateLimitState(rl);
        setRateLimitInput(String(rl));
        setRegisterRateLimitState(regRl);
        setRegisterRateLimitInput(String(regRl));
        setApiLogRetention(apiRet);
        setApiLogRetentionInput(String(apiRet));
        setXrayLogRetention(xrayRet);
        setXrayLogRetentionInput(String(xrayRet));
      })
      .catch(() => setError('Failed to load settings'));
  }, []);

  async function handleTogglePublicScan(enabled: boolean) {
    setSavingPublic(true);
    setError('');
    setSuccess('');
    try {
      await setPublicScanEnabled(enabled);
      setPublicScanEnabledState(enabled);
      setSuccess(`Public scanning ${enabled ? 'enabled' : 'disabled'} successfully`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (toggleError: unknown) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update setting');
    } finally {
      setSavingPublic(false);
    }
  }

  async function handleSaveRateLimit() {
    const value = parseInt(rateLimitInput, 10);
    if (isNaN(value) || value < 1 || value > 1000) {
      setError('Rate limit must be between 1 and 1000');
      return;
    }
    setSavingRl(true);
    setError('');
    setSuccess('');
    try {
      await updateRateLimit(value);
      setRateLimitState(value);
      setSuccess('Rate limit updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update rate limit');
    } finally {
      setSavingRl(false);
    }
  }

  async function handleSaveRegisterRateLimit() {
    const value = parseInt(registerRateLimitInput, 10);
    if (isNaN(value) || value < 1 || value > 1000) {
      setError('Registration rate limit must be between 1 and 1000');
      return;
    }
    setSavingRegisterRl(true);
    setError('');
    setSuccess('');
    try {
      await updateRegisterRateLimit(value);
      setRegisterRateLimitState(value);
      setSuccess('Registration rate limit updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to update registration rate limit'
      );
    } finally {
      setSavingRegisterRl(false);
    }
  }

  async function handleSaveApiLogRetention() {
    const value = parseInt(apiLogRetentionInput, 10);
    if (isNaN(value) || value < 0) {
      setError('Retention must be 0 or more (0 = keep forever)');
      return;
    }
    setSavingApiRetention(true);
    setError('');
    setSuccess('');
    try {
      await updateAPILogRetention(value);
      setApiLogRetention(value);
      setSuccess('API log retention updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update API log retention');
    } finally {
      setSavingApiRetention(false);
    }
  }

  async function handleSaveXrayLogRetention() {
    const value = parseInt(xrayLogRetentionInput, 10);
    if (isNaN(value) || value < 0) {
      setError('Retention must be 0 or more (0 = keep forever)');
      return;
    }
    setSavingXrayRetention(true);
    setError('');
    setSuccess('');
    try {
      await updateXRayLogRetention(value);
      setXrayLogRetention(value);
      setSuccess('xRay log retention updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update xRay log retention');
    } finally {
      setSavingXrayRetention(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Banner type="error" text={error} />}
      {success && <Banner type="success" text={success} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Access & Exposure</h2>
            <p className="text-sm text-zinc-500">Public endpoints and throttling policies.</p>
          </div>

          <div className="rounded-xl border border-divider/60 bg-content2/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Public Scanning</p>
                <p className="text-xs text-zinc-500">
                  Allow unauthenticated users to scan at{' '}
                  <Link href="/scan" target="_blank" rel="noreferrer">
                    /scan
                  </Link>
                  .
                </p>
              </div>
              {publicScanEnabled === null ? (
                <p className="text-xs text-zinc-500">Loading...</p>
              ) : (
                <div className="flex items-center gap-2">
                  <span
                    className={
                      publicScanEnabled ? 'text-xs font-medium text-success' : 'text-xs font-medium text-danger'
                    }
                  >
                    {publicScanEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={savingPublic}
                    onPress={() => handleTogglePublicScan(!publicScanEnabled)}
                  >
                    {savingPublic ? 'Saving...' : publicScanEnabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <SettingRow
            title="Public Scan Rate Limit"
            description="Max public scans per IP per hour."
            input={
              <Input
                type="number"
                min={1}
                max={1000}
                placeholder="Per hour"
                variant="secondary"
                value={rateLimitInput}
                onChange={(e) => setRateLimitInput(e.target.value)}
              />
            }
            action={
              <Button
                size="sm"
                variant="secondary"
                onPress={handleSaveRateLimit}
                isDisabled={savingRl || rateLimitInput === String(rateLimit)}
              >
                {savingRl ? 'Saving...' : 'Save'}
              </Button>
            }
          />

          <SettingRow
            title="Registration Rate Limit"
            description="Max new accounts per IP per hour."
            input={
              <Input
                type="number"
                min={1}
                max={1000}
                placeholder="Per hour"
                variant="secondary"
                value={registerRateLimitInput}
                onChange={(e) => setRegisterRateLimitInput(e.target.value)}
              />
            }
            action={
              <Button
                size="sm"
                variant="secondary"
                onPress={handleSaveRegisterRateLimit}
                isDisabled={savingRegisterRl || registerRateLimitInput === String(registerRateLimit)}
              >
                {savingRegisterRl ? 'Saving...' : 'Save'}
              </Button>
            }
          />
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Data Retention</h2>
            <p className="text-sm text-zinc-500">Control operational log retention windows.</p>
          </div>

          <SettingRow
            title="API Log Retention"
            description="Days to keep API logs (0 = forever)."
            input={
              <Input
                type="number"
                min={0}
                placeholder="Days"
                variant="secondary"
                value={apiLogRetentionInput}
                onChange={(e) => setApiLogRetentionInput(e.target.value)}
              />
            }
            action={
              <Button
                size="sm"
                variant="secondary"
                onPress={handleSaveApiLogRetention}
                isDisabled={savingApiRetention || apiLogRetentionInput === String(apiLogRetention)}
              >
                {savingApiRetention ? 'Saving...' : 'Save'}
              </Button>
            }
          />

          <SettingRow
            title="xRay Log Retention"
            description="Days to keep xRay logs (0 = forever)."
            input={
              <Input
                type="number"
                min={0}
                placeholder="Days"
                variant="secondary"
                value={xrayLogRetentionInput}
                onChange={(e) => setXrayLogRetentionInput(e.target.value)}
              />
            }
            action={
              <Button
                size="sm"
                variant="secondary"
                onPress={handleSaveXrayLogRetention}
                isDisabled={savingXrayRetention || xrayLogRetentionInput === String(xrayLogRetention)}
              >
                {savingXrayRetention ? 'Saving...' : 'Save'}
              </Button>
            }
          />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ScannerSettingsPanel />
        <AuthSettingsPanel />
      </div>
    </div>
  );
}
