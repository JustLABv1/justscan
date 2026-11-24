'use client';

import { useToast } from '@/components/toast';
import { StatusAlert } from '@/components/ui/form-alert';
import { adminUpdateAuthSettings, getAdminSettings } from '@/lib/api/admin';
import { SettingsSection, SettingRow, Switch } from '@/components/ui';
import { useEffect, useState } from 'react';

interface LocalAuthPanelProps {
  hasEnabledOIDCProvider: boolean;
  providersLoading: boolean;
}

export function LocalAuthPanel({ hasEnabledOIDCProvider, providersLoading }: LocalAuthPanelProps) {
  const toast = useToast();
  const [localAuthEnabled, setLocalAuthEnabled] = useState(true);
  const [signInEnabled, setSignInEnabled] = useState(true);
  const [signUpEnabled, setSignUpEnabled] = useState(true);
  const [ssoOnly, setSsoOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then((settings) => {
        setLocalAuthEnabled(settings['auth.local_enabled'] !== 'false');
        setSignInEnabled(settings['auth.sign_in_enabled'] !== 'false');
        setSignUpEnabled(settings['auth.sign_up_enabled'] !== 'false');
        setSsoOnly(settings['auth.sso_only'] === 'true');
      })
      .catch(() => toast.error('Failed to load local authentication settings'))
      .finally(() => setLoading(false));
  }, [toast]);

  const canDisableLocalAuth = providersLoading || hasEnabledOIDCProvider;

  async function handleSave(key: string, value: boolean) {
    const next = {
      local_auth_enabled: localAuthEnabled,
      sign_in_enabled: signInEnabled,
      sign_up_enabled: signUpEnabled,
      sso_only: ssoOnly,
      [key]: value,
    };
    if ((!next.local_auth_enabled || next.sso_only) && !hasEnabledOIDCProvider) {
      toast.error('Enable an identity provider before disabling local authentication');
      return;
    }
    setSaving(true);
    try {
      await adminUpdateAuthSettings(next);
      setLocalAuthEnabled(next.local_auth_enabled);
      setSignInEnabled(next.sign_in_enabled);
      setSignUpEnabled(next.sign_up_enabled);
      setSsoOnly(next.sso_only);
      toast.success('Authentication settings updated');
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update authentication settings'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <SettingsSection
      title="Sign-in and sign-up controls"
      description="Control who can access JustScan and how new accounts are created."
    >
      <SettingRow
        label="Allow sign-in"
        description="Allow users to start a session."
        htmlFor="auth-sign_in_enabled"
      >
        <Switch
          id="auth-sign_in_enabled"
          aria-label="Allow sign-in"
          isSelected={signInEnabled}
          isDisabled={saving}
          onChange={(value) => void handleSave('sign_in_enabled', value)}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </SettingRow>
      <SettingRow
        label="Allow self-service sign-up"
        description="Allow visitors to create local accounts."
        htmlFor="auth-sign_up_enabled"
      >
        <Switch
          id="auth-sign_up_enabled"
          aria-label="Allow self-service sign-up"
          isSelected={signUpEnabled}
          isDisabled={saving}
          onChange={(value) => void handleSave('sign_up_enabled', value)}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </SettingRow>
      <SettingRow
        label="Enable local authentication"
        description="Allow username and password sign-in."
        htmlFor="auth-local_auth_enabled"
      >
        <Switch
          id="auth-local_auth_enabled"
          aria-label="Enable local authentication"
          isSelected={localAuthEnabled}
          isDisabled={saving || providersLoading || (!canDisableLocalAuth && localAuthEnabled)}
          onChange={(value) => void handleSave('local_auth_enabled', value)}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </SettingRow>
      <SettingRow
        label="Show SSO login only"
        description="Hide password fields and offer identity providers only."
        htmlFor="auth-sso_only"
      >
        <Switch
          id="auth-sso_only"
          aria-label="Show SSO login only"
          isSelected={ssoOnly}
          isDisabled={saving || providersLoading || (!canDisableLocalAuth && !ssoOnly)}
          onChange={(value) => void handleSave('sso_only', value)}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </SettingRow>
      {!providersLoading && !hasEnabledOIDCProvider && (
        <div className="p-4">
          <StatusAlert
            status="warning"
            title="An identity provider is required before password sign-in can be hidden"
            description="Enable an OIDC provider first to disable local authentication or show SSO login only."
          />
        </div>
      )}
    </SettingsSection>
  );
}
