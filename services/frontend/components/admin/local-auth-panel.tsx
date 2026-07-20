'use client';

import { useToast } from '@/components/toast';
import { StatusAlert } from '@/components/ui/form-alert';
import { adminUpdateAuthSettings, getAdminSettings } from '@/lib/api/admin';
import { Button, Card, Switch } from '@heroui/react';
import { useEffect, useState } from 'react';

interface LocalAuthPanelProps {
  hasEnabledOIDCProvider: boolean;
  providersLoading: boolean;
}

export function LocalAuthPanel({ hasEnabledOIDCProvider, providersLoading }: LocalAuthPanelProps) {
  const toast = useToast();
  const [localAuthEnabled, setLocalAuthEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then((settings) => setLocalAuthEnabled(settings['auth.local_enabled'] !== 'false'))
      .catch(() => toast.error('Failed to load local authentication settings'))
      .finally(() => setLoading(false));
  }, [toast]);

  const canDisableLocalAuth = providersLoading || hasEnabledOIDCProvider;

  async function handleSave() {
    if (!localAuthEnabled && !canDisableLocalAuth) {
      toast.error('Enable an identity provider before disabling local authentication');
      return;
    }
    setSaving(true);
    try {
      await adminUpdateAuthSettings({ local_auth_enabled: localAuthEnabled });
      toast.success('Authentication settings updated');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update authentication settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Card className="space-y-4">
      <Card.Header>
        <Card.Title>Sign-in methods</Card.Title>
        <Card.Description>Keep at least one sign-in route available for administrators.</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-4">
        <Switch
          isSelected={localAuthEnabled}
          isDisabled={saving || (!canDisableLocalAuth && localAuthEnabled)}
          onChange={setLocalAuthEnabled}
        >
          <Switch.Content>
            <Switch.Control><Switch.Thumb /></Switch.Control>
            Enable local username/password authentication
          </Switch.Content>
        </Switch>
        {!providersLoading && !hasEnabledOIDCProvider ? (
          <StatusAlert
            status="warning"
            title="An identity provider is required before local sign-in can be disabled"
            description="Enable an OIDC provider below first so administrators retain a way to sign in."
          />
        ) : null}
        <div className="flex justify-end">
          <Button variant="secondary" onPress={handleSave} isDisabled={saving}>
            {saving ? 'Saving...' : 'Save sign-in methods'}
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
