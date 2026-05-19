'use client';

import { useToast } from '@/components/toast';
import {
  adminUpdateAuthSettings,
  adminUpdateMaintenanceSettings,
  adminUpdateScannerSettings,
  getAdminSettings,
  setPublicScanEnabled,
  updateAPILogRetention,
  updateRateLimit,
  updateRegisterRateLimit,
  updateXRayLogRetention,
} from '@/lib/api/admin';
import type { ScannerSettings } from '@/lib/api/types/registries';
import { Button, Card, Input, Link, Modal, Switch, TextArea, useOverlayState } from '@heroui/react';
import { useEffect, useState } from 'react';

const DEFAULT_MAINTENANCE_MESSAGE =
  'JustScan is currently undergoing maintenance. Please check back shortly.';

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
  const toast = useToast();
  const [settings, setSettings] = useState<ScannerSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      .catch(() => {
        setLoading(false);
        toast.error('Failed to load scanner settings');
      });
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      await adminUpdateScannerSettings(settings);
      toast.success('Scanner settings updated');
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to update scanner settings');
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
  const toast = useToast();
  const [localAuthEnabled, setLocalAuthEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then((settings) => {
        setLocalAuthEnabled(settings['auth.local_enabled'] !== 'false');
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        toast.error('Failed to load authentication settings');
      });
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      await adminUpdateAuthSettings({ local_auth_enabled: localAuthEnabled });
      toast.success('Authentication settings updated');
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to update auth settings');
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
  const toast = useToast();
  const [publicScanEnabled, setPublicScanEnabledState] = useState<boolean | null>(null);
  const [rateLimit, setRateLimitState] = useState(5);
  const [rateLimitInput, setRateLimitInput] = useState('5');
  const [registerRateLimit, setRegisterRateLimitState] = useState(10);
  const [registerRateLimitInput, setRegisterRateLimitInput] = useState('10');
  const [apiLogRetention, setApiLogRetention] = useState(30);
  const [apiLogRetentionInput, setApiLogRetentionInput] = useState('30');
  const [xrayLogRetention, setXrayLogRetention] = useState(30);
  const [xrayLogRetentionInput, setXrayLogRetentionInput] = useState('30');
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(DEFAULT_MAINTENANCE_MESSAGE);
  const [maintenanceDraft, setMaintenanceDraft] = useState(DEFAULT_MAINTENANCE_MESSAGE);
  const maintenanceModal = useOverlayState();

  const [savingPublic, setSavingPublic] = useState(false);
  const [savingRl, setSavingRl] = useState(false);
  const [savingRegisterRl, setSavingRegisterRl] = useState(false);
  const [savingApiRetention, setSavingApiRetention] = useState(false);
  const [savingXrayRetention, setSavingXrayRetention] = useState(false);
  const [savingMaintenance, setSavingMaintenance] = useState(false);

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
        const nextMaintenanceEnabled = settings['maintenance.enabled'] === 'true';
        const nextMaintenanceMessage =
          settings['maintenance.message'] || DEFAULT_MAINTENANCE_MESSAGE;
        setMaintenanceEnabled(nextMaintenanceEnabled);
        setMaintenanceMessage(nextMaintenanceMessage);
        setMaintenanceDraft(nextMaintenanceMessage);
      })
      .catch(() => toast.error('Failed to load settings'));
  }, [toast]);

  async function saveMaintenance(nextEnabled: boolean, nextMessage: string) {
    const trimmed = nextMessage.trim();
    if (!trimmed) {
      toast.error('Maintenance message cannot be empty');
      return false;
    }
    if (trimmed.length > 500) {
      toast.error('Maintenance message must be 500 characters or fewer');
      return false;
    }

    setSavingMaintenance(true);
    try {
      const result = await adminUpdateMaintenanceSettings({
        enabled: nextEnabled,
        message: trimmed,
      });
      setMaintenanceEnabled(result.enabled);
      setMaintenanceMessage(result.message);
      setMaintenanceDraft(result.message);
      toast.success('Maintenance mode settings updated');
      return true;
    } catch (saveError: unknown) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update maintenance mode settings'
      );
      return false;
    } finally {
      setSavingMaintenance(false);
    }
  }

  async function handleToggleMaintenance(enabled: boolean) {
    await saveMaintenance(enabled, maintenanceMessage);
  }

  async function handleSaveMaintenanceMessage() {
    const ok = await saveMaintenance(maintenanceEnabled, maintenanceDraft);
    if (ok) maintenanceModal.close();
  }

  async function handleTogglePublicScan(enabled: boolean) {
    setSavingPublic(true);
    try {
      await setPublicScanEnabled(enabled);
      setPublicScanEnabledState(enabled);
      toast.success(`Public scanning ${enabled ? 'enabled' : 'disabled'} successfully`);
    } catch (toggleError: unknown) {
      toast.error(toggleError instanceof Error ? toggleError.message : 'Failed to update setting');
    } finally {
      setSavingPublic(false);
    }
  }

  async function handleSaveRateLimit() {
    const value = parseInt(rateLimitInput, 10);
    if (isNaN(value) || value < 1 || value > 1000) {
      toast.error('Rate limit must be between 1 and 1000');
      return;
    }
    setSavingRl(true);
    try {
      await updateRateLimit(value);
      setRateLimitState(value);
      toast.success('Rate limit updated');
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to update rate limit');
    } finally {
      setSavingRl(false);
    }
  }

  async function handleSaveRegisterRateLimit() {
    const value = parseInt(registerRateLimitInput, 10);
    if (isNaN(value) || value < 1 || value > 1000) {
      toast.error('Registration rate limit must be between 1 and 1000');
      return;
    }
    setSavingRegisterRl(true);
    try {
      await updateRegisterRateLimit(value);
      setRegisterRateLimitState(value);
      toast.success('Registration rate limit updated');
    } catch (saveError: unknown) {
      toast.error(
        saveError instanceof Error ? saveError.message : 'Failed to update registration rate limit'
      );
    } finally {
      setSavingRegisterRl(false);
    }
  }

  async function handleSaveApiLogRetention() {
    const value = parseInt(apiLogRetentionInput, 10);
    if (isNaN(value) || value < 0) {
      toast.error('Retention must be 0 or more (0 = keep forever)');
      return;
    }
    setSavingApiRetention(true);
    try {
      await updateAPILogRetention(value);
      setApiLogRetention(value);
      toast.success('API log retention updated');
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to update API log retention');
    } finally {
      setSavingApiRetention(false);
    }
  }

  async function handleSaveXrayLogRetention() {
    const value = parseInt(xrayLogRetentionInput, 10);
    if (isNaN(value) || value < 0) {
      toast.error('Retention must be 0 or more (0 = keep forever)');
      return;
    }
    setSavingXrayRetention(true);
    try {
      await updateXRayLogRetention(value);
      setXrayLogRetention(value);
      toast.success('xRay log retention updated');
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to update xRay log retention');
    } finally {
      setSavingXrayRetention(false);
    }
  }

  return (
    <div className="space-y-4">
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

          <div className="rounded-xl border border-divider/60 bg-content2/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Maintenance Mode</p>
                <p className="text-xs text-zinc-500">
                  Route non-admin users to the maintenance page.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={savingMaintenance}
                  onPress={() => {
                    setMaintenanceDraft(maintenanceMessage);
                    maintenanceModal.open();
                  }}
                >
                  Edit message
                </Button>
                <Switch
                  isDisabled={savingMaintenance}
                  isSelected={maintenanceEnabled}
                  onChange={handleToggleMaintenance}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>{maintenanceEnabled ? 'Enabled' : 'Disabled'}</Switch.Content>
                </Switch>
              </div>
            </div>
            {maintenanceEnabled ? (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
                Maintenance page is active.
              </div>
            ) : null}
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

      <Modal state={maintenanceModal}>
        <Modal.Backdrop isDismissable>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Edit Maintenance Message</Modal.Heading>
                <p className="text-sm text-zinc-500">
                  This plain-text message is shown on the public maintenance page.
                </p>
              </Modal.Header>
              <Modal.Body>
                <TextArea
                  aria-label="Maintenance message"
                  fullWidth
                  maxLength={500}
                  placeholder="Explain what users should know while the app is unavailable."
                  rows={5}
                  value={maintenanceDraft}
                  variant="secondary"
                  onChange={(event) => setMaintenanceDraft(event.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                  <span>Plain text only.</span>
                  <span>{maintenanceDraft.length}/500</span>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="tertiary"
                  onPress={() => {
                    setMaintenanceDraft(maintenanceMessage);
                    maintenanceModal.close();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  isDisabled={savingMaintenance || maintenanceDraft.trim() === maintenanceMessage}
                  onPress={handleSaveMaintenanceMessage}
                >
                  {savingMaintenance ? 'Saving...' : 'Save message'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
