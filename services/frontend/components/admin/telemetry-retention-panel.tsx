'use client';

import { useToast } from '@/components/toast';
import { getAdminSettings, updateAPILogRetention, updateXRayLogRetention } from '@/lib/api/admin';
import { Button, Input, SettingsSection, SettingRow, SettingUnit } from '@/components/ui';
import { useEffect, useState } from 'react';

export function TelemetryRetentionPanel() {
  const toast = useToast();
  const [apiDays, setApiDays] = useState('30');
  const [xrayDays, setXrayDays] = useState('30');
  const [saved, setSaved] = useState({ api: '30', xray: '30' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState<'api' | 'xray' | null>(null);

  useEffect(() => {
    getAdminSettings()
      .then((settings) => {
        setSaved({
          api: settings['api_log_retention_days'] ?? '30',
          xray: settings['xray_log_retention_days'] ?? '30',
        });
        setLoaded(true);
        setApiDays(settings['api_log_retention_days'] ?? '30');
        setXrayDays(settings['xray_log_retention_days'] ?? '30');
      })
      .catch(() => toast.error('Failed to load telemetry retention settings'));
  }, [toast]);

  async function save() {
    const values = { api: apiDays, xray: xrayDays };
    if (
      Object.values(values).some(
        (value) => !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))
      )
    ) {
      toast.error('Retention must be a whole number of 0 or more days');
      return;
    }
    setSaving('api');
    try {
      if (apiDays !== saved.api) {
        await updateAPILogRetention(Number(apiDays));
        setSaved((current) => ({ ...current, api: apiDays }));
      }
      if (xrayDays !== saved.xray) {
        await updateXRayLogRetention(Number(xrayDays));
        setSaved((current) => ({ ...current, xray: xrayDays }));
      }
      toast.success('Telemetry retention updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update retention');
    } finally {
      setSaving(null);
    }
  }

  return (
    <SettingsSection
      title="Telemetry retention"
      description="Choose how long request logs are kept. Use 0 to keep them forever."
      footer={
        loaded && (apiDays !== saved.api || xrayDays !== saved.xray) ? (
          <Button variant="primary" onPress={() => void save()} isDisabled={saving !== null}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        ) : undefined
      }
    >
      {(
        [
          { kind: 'api', title: 'API request logs', value: apiDays, set: setApiDays },
          {
            kind: 'xray',
            title: 'Artifactory Xray request logs',
            value: xrayDays,
            set: setXrayDays,
          },
        ] as const
      ).map((row) => (
        <SettingRow key={row.kind} label={row.title} htmlFor={`retention-${row.kind}`}>
          <Input
            id={`retention-${row.kind}`}
            type="number"
            min={0}
            step={1}
            value={row.value}
            disabled={!loaded || saving !== null}
            onChange={(event) => row.set(event.target.value)}
            className="w-28"
          />
          <SettingUnit>days</SettingUnit>
        </SettingRow>
      ))}
    </SettingsSection>
  );
}
