'use client';

import { useToast } from '@/components/toast';
import {
  getAdminSettings,
  updateAPILogRetention,
  updateXRayLogRetention,
} from '@/lib/api/admin';
import { Button, Card, Input } from '@heroui/react';
import { useEffect, useState } from 'react';

function RetentionRow({
  title,
  value,
  onChange,
  onSave,
  saving,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-divider/60 bg-content2/30 p-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-zinc-500">Days to retain logs. Use 0 to keep them forever.</p>
      </div>
      <div className="flex gap-2">
        <Input aria-label={`${title} days`} type="number" min={0} variant="secondary" value={value} onChange={(event) => onChange(event.target.value)} className="w-28" />
        <Button size="sm" variant="secondary" onPress={onSave} isDisabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

export function TelemetryRetentionPanel() {
  const toast = useToast();
  const [apiDays, setApiDays] = useState('30');
  const [xrayDays, setXrayDays] = useState('30');
  const [saving, setSaving] = useState<'api' | 'xray' | null>(null);

  useEffect(() => {
    getAdminSettings()
      .then((settings) => {
        setApiDays(settings['api_log_retention_days'] ?? '30');
        setXrayDays(settings['xray_log_retention_days'] ?? '30');
      })
      .catch(() => toast.error('Failed to load telemetry retention settings'));
  }, [toast]);

  async function save(kind: 'api' | 'xray') {
    const rawValue = kind === 'api' ? apiDays : xrayDays;
    const days = parseInt(rawValue, 10);
    if (Number.isNaN(days) || days < 0) {
      toast.error('Retention must be 0 or more days');
      return;
    }
    setSaving(kind);
    try {
      if (kind === 'api') await updateAPILogRetention(days);
      else await updateXRayLogRetention(days);
      toast.success(`${kind === 'api' ? 'API' : 'xRay'} log retention updated`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update retention');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="space-y-4">
      <Card.Header>
        <Card.Title>Telemetry retention</Card.Title>
        <Card.Description>Manage log lifecycle next to the telemetry it affects.</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-3">
        <RetentionRow title="API request logs" value={apiDays} onChange={setApiDays} onSave={() => void save('api')} saving={saving === 'api'} />
        <RetentionRow title="xRay request logs" value={xrayDays} onChange={setXrayDays} onSave={() => void save('xray')} saving={saving === 'xray'} />
      </Card.Content>
    </Card>
  );
}
