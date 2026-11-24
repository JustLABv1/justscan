'use client';

import { useToast } from '@/components/toast';
import { StatusAlert } from '@/components/ui/form-alert';
import {
  adminUpdateMaintenanceSettings,
  getAdminSettings,
  setPublicScanEnabled,
  updateRateLimit,
  updateRegisterRateLimit,
} from '@/lib/api/admin';
import {
  Button,
  Input,
  Link,
  Modal,
  SettingRow,
  SettingsSection,
  SettingUnit,
  Switch,
  TextArea,
  useOverlayState,
} from '@/components/ui';
import { useEffect, useState } from 'react';

const DEFAULT_MAINTENANCE_MESSAGE =
  'JustScan is currently undergoing maintenance. Please check back shortly.';

export function SettingsTab() {
  const toast = useToast();
  const [publicScanEnabled, setPublicScanEnabledState] = useState<boolean | null>(null);
  const [rateLimit, setRateLimitState] = useState(5);
  const [rateLimitInput, setRateLimitInput] = useState('5');
  const [registerRateLimit, setRegisterRateLimitState] = useState(10);
  const [registerRateLimitInput, setRegisterRateLimitInput] = useState('10');
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(DEFAULT_MAINTENANCE_MESSAGE);
  const [maintenanceDraft, setMaintenanceDraft] = useState(DEFAULT_MAINTENANCE_MESSAGE);
  const maintenanceModal = useOverlayState();

  const [savingPublic, setSavingPublic] = useState(false);
  const [savingRateLimits, setSavingRateLimits] = useState(false);
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then((settings) => {
        setPublicScanEnabledState(settings['public_scan_enabled'] !== 'false');
        const rl = parseInt(settings['public_scan_rate_limit'] ?? '5', 10);
        const regRl = parseInt(settings['register_rate_limit'] ?? '10', 10);
        setRateLimitState(rl);
        setRateLimitInput(String(rl));
        setRegisterRateLimitState(regRl);
        setRegisterRateLimitInput(String(regRl));
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
      toast.success(`Public scanning ${enabled ? 'enabled' : 'disabled'}`);
    } catch (toggleError: unknown) {
      toast.error(toggleError instanceof Error ? toggleError.message : 'Failed to update setting');
    } finally {
      setSavingPublic(false);
    }
  }

  const rateLimitDirty = rateLimitInput !== String(rateLimit);
  const registerRateLimitDirty = registerRateLimitInput !== String(registerRateLimit);
  const rateLimitsDirty = rateLimitDirty || registerRateLimitDirty;

  async function handleSaveRateLimits() {
    const scanValue = parseInt(rateLimitInput, 10);
    const registerValue = parseInt(registerRateLimitInput, 10);
    if (rateLimitDirty && (isNaN(scanValue) || scanValue < 1 || scanValue > 1000)) {
      toast.error('Public scan limit must be between 1 and 1000');
      return;
    }
    if (
      registerRateLimitDirty &&
      (isNaN(registerValue) || registerValue < 1 || registerValue > 1000)
    ) {
      toast.error('Sign-up limit must be between 1 and 1000');
      return;
    }
    setSavingRateLimits(true);
    try {
      if (rateLimitDirty) {
        await updateRateLimit(scanValue);
        setRateLimitState(scanValue);
      }
      if (registerRateLimitDirty) {
        await updateRegisterRateLimit(registerValue);
        setRegisterRateLimitState(registerValue);
      }
      toast.success('Rate limits saved');
    } catch (saveError: unknown) {
      toast.error(saveError instanceof Error ? saveError.message : 'Failed to update rate limits');
    } finally {
      setSavingRateLimits(false);
    }
  }

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Public access"
        description="What people can do without signing in. Changes save immediately."
      >
        <SettingRow
          label="Public scanning"
          description={
            <>
              Anyone can scan public images at{' '}
              <Link href="/scan" target="_blank" rel="noreferrer">
                /scan
              </Link>{' '}
              without an account.
            </>
          }
        >
          <Switch
            aria-label="Public scanning"
            isDisabled={publicScanEnabled === null || savingPublic}
            isSelected={Boolean(publicScanEnabled)}
            onChange={(enabled) => void handleTogglePublicScan(enabled)}
          >
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Maintenance"
        description="Take JustScan offline for everyone except admins."
      >
        <SettingRow
          label="Maintenance mode"
          description="Non-admin users see the maintenance page instead of the app."
        >
          <Switch
            aria-label="Maintenance mode"
            isDisabled={savingMaintenance}
            isSelected={maintenanceEnabled}
            onChange={(enabled) => void handleToggleMaintenance(enabled)}
          >
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch>
        </SettingRow>
        <SettingRow
          label="Maintenance message"
          description={<span className="line-clamp-2">{maintenanceMessage}</span>}
        >
          <Button
            size="sm"
            variant="secondary"
            isDisabled={savingMaintenance}
            onPress={() => {
              setMaintenanceDraft(maintenanceMessage);
              maintenanceModal.open();
            }}
          >
            Edit message
          </Button>
        </SettingRow>
        {maintenanceEnabled ? (
          <div className="px-4 py-3">
            <StatusAlert status="warning" title="The maintenance page is active" />
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Rate limits"
        description="Requests allowed from one IP address per hour."
        footer={
          rateLimitsDirty ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={savingRateLimits}
                onPress={() => {
                  setRateLimitInput(String(rateLimit));
                  setRegisterRateLimitInput(String(registerRateLimit));
                }}
              >
                Discard
              </Button>
              <Button size="sm" isDisabled={savingRateLimits} onPress={handleSaveRateLimits}>
                {savingRateLimits ? 'Saving...' : 'Save changes'}
              </Button>
            </>
          ) : null
        }
      >
        <SettingRow
          label="Public scans"
          description="Scans one visitor can start without signing in."
          htmlFor="settings-public-scan-limit"
        >
          <Input
            id="settings-public-scan-limit"
            type="number"
            min={1}
            max={1000}
            inputMode="numeric"
            className="w-24 text-right tabular-nums"
            value={rateLimitInput}
            onChange={(e) => setRateLimitInput(e.target.value)}
          />
          <SettingUnit>per hour</SettingUnit>
        </SettingRow>
        <SettingRow
          label="Sign-ups"
          description="New accounts one visitor can create."
          htmlFor="settings-register-limit"
        >
          <Input
            id="settings-register-limit"
            type="number"
            min={1}
            max={1000}
            inputMode="numeric"
            className="w-24 text-right tabular-nums"
            value={registerRateLimitInput}
            onChange={(e) => setRegisterRateLimitInput(e.target.value)}
          />
          <SettingUnit>per hour</SettingUnit>
        </SettingRow>
      </SettingsSection>

      <Modal state={maintenanceModal}>
        <Modal.Backdrop isDismissable={false}>
          <Modal.Container size="md" placement="center">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Edit maintenance message</Modal.Heading>
                <p className="text-sm text-muted-foreground">
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
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
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
