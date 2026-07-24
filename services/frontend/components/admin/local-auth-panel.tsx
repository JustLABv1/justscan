'use client';

import { useToast } from '@/components/toast';
import { StatusAlert } from '@/components/ui/form-alert';
import { adminUpdateAuthSettings, getAdminSettings } from '@/lib/api/admin';
import { Button, Card, Description, Label, Switch } from '@heroui/react';
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

  async function handleSave() {
    if ((!localAuthEnabled || ssoOnly) && !canDisableLocalAuth) {
      toast.error('Enable an identity provider before disabling local authentication');
      return;
    }
    setSaving(true);
    try {
      await adminUpdateAuthSettings({
        local_auth_enabled: localAuthEnabled,
        sign_in_enabled: signInEnabled,
        sign_up_enabled: signUpEnabled,
        sso_only: ssoOnly,
      });
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
    <Card>
      <Card.Header>
        <Card.Title>Sign-in and sign-up controls</Card.Title>
        <Card.Description>
          Control who can access JustScan and how new accounts are created.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div aria-label="Access controls" className="grid gap-3 sm:grid-cols-2" role="group">
          <Switch
            className="rounded-lg border border-divider p-3"
            isSelected={signInEnabled}
            isDisabled={saving}
            onChange={setSignInEnabled}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Label>Allow sign-in</Label>
            </Switch.Content>
            <Description className="mt-0.5 ms-12 block text-xs leading-4">
              Allow users to start a session.
            </Description>
          </Switch>
          <Switch
            className="rounded-lg border border-divider p-3"
            isSelected={signUpEnabled}
            isDisabled={saving}
            onChange={setSignUpEnabled}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Label>Allow self-service sign-up</Label>
            </Switch.Content>
            <Description className="mt-0.5 ms-12 block text-xs leading-4">
              Allow visitors to create local accounts.
            </Description>
          </Switch>
          <Switch
            className="rounded-lg border border-divider p-3"
            isSelected={localAuthEnabled}
            isDisabled={saving || (!canDisableLocalAuth && localAuthEnabled)}
            onChange={setLocalAuthEnabled}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Label>Enable local authentication</Label>
            </Switch.Content>
            <Description className="mt-0.5 ms-12 block text-xs leading-4">
              Allow username and password sign-in.
            </Description>
          </Switch>
          <Switch
            className="rounded-lg border border-divider p-3"
            isSelected={ssoOnly}
            isDisabled={saving || (!canDisableLocalAuth && !ssoOnly)}
            onChange={setSsoOnly}
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Label>Show SSO login only</Label>
            </Switch.Content>
            <Description className="mt-0.5 ms-12 block text-xs leading-4">
              Hide password fields and offer identity providers only.
            </Description>
          </Switch>
        </div>
        {!providersLoading && !hasEnabledOIDCProvider ? (
          <StatusAlert
            status="warning"
            title="An identity provider is required before password sign-in can be hidden"
            description="Enable an OIDC provider below first to disable local authentication or show SSO login only."
          />
        ) : null}
      </Card.Content>
      <Card.Footer className="justify-end border-t border-divider">
        <Button variant="primary" onPress={handleSave} isDisabled={saving}>
          {saving ? 'Saving...' : 'Save access controls'}
        </Button>
      </Card.Footer>
    </Card>
  );
}
