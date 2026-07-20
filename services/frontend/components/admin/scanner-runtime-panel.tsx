'use client';

import { useToast } from '@/components/toast';
import { adminUpdateScannerSettings, getAdminSettings } from '@/lib/api/admin';
import type { ScannerSettings } from '@/lib/api/types/registries';
import { Button, Card, Description, Input, Label, Switch, TextField } from '@heroui/react';
import { useEffect, useState } from 'react';

export function ScannerRuntimePanel() {
  const toast = useToast();
  const [settings, setSettings] = useState<ScannerSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminSettings()
      .then((current) => {
        setSettings({
          enable_trivy: current['scanner.enable_trivy'] !== 'false',
          enable_grype: current['scanner.enable_grype'] !== 'false',
          concurrency: parseInt(current['scanner.concurrency'] ?? '2', 10),
          timeout_seconds: parseInt(current['scanner.timeout_seconds'] ?? '300', 10),
          db_max_age_hours: parseInt(current['scanner.db_max_age_hours'] ?? '24', 10),
          enable_osv_java_augmentation: current['scanner.enable_osv_java_augmentation'] === 'true',
        });
      })
      .catch(() => toast.error('Failed to load scanner settings'))
      .finally(() => setLoading(false));
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      await adminUpdateScannerSettings(settings);
      toast.success('Scanner settings updated');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update scanner settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Scanner runtime</h2>
        <p className="text-sm text-zinc-500">Tune engines, throughput, and database freshness.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Switch isSelected={settings.enable_trivy ?? true} onChange={(checked) => setSettings((current) => ({ ...current, enable_trivy: checked }))}>
          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>Enable Trivy</Switch.Content>
        </Switch>
        <Switch isSelected={settings.enable_grype ?? true} onChange={(checked) => setSettings((current) => ({ ...current, enable_grype: checked }))}>
          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>Enable Grype</Switch.Content>
        </Switch>
        <Switch isSelected={settings.enable_osv_java_augmentation ?? false} onChange={(checked) => setSettings((current) => ({ ...current, enable_osv_java_augmentation: checked }))}>
          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>OSV Java augmentation</Switch.Content>
        </Switch>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField>
          <Label>Concurrent workers</Label>
          <Input aria-label="Concurrent workers" type="number" min={1} variant="secondary" value={String(settings.concurrency ?? 2)} onChange={(event) => setSettings((current) => ({ ...current, concurrency: parseInt(event.target.value || '0', 10) }))} />
          <Description>Maximum scans processed at once.</Description>
        </TextField>
        <TextField>
          <Label>Scan timeout</Label>
          <Input aria-label="Scan timeout in seconds" type="number" min={30} variant="secondary" value={String(settings.timeout_seconds ?? 300)} onChange={(event) => setSettings((current) => ({ ...current, timeout_seconds: parseInt(event.target.value || '0', 10) }))} />
          <Description>Seconds before a scan is stopped.</Description>
        </TextField>
        <TextField>
          <Label>Maximum database age</Label>
          <Input aria-label="Maximum database age in hours" type="number" min={1} variant="secondary" value={String(settings.db_max_age_hours ?? 24)} onChange={(event) => setSettings((current) => ({ ...current, db_max_age_hours: parseInt(event.target.value || '0', 10) }))} />
          <Description>Hours before a database is considered stale.</Description>
        </TextField>
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" onPress={handleSave} isDisabled={saving}>
          {saving ? 'Saving...' : 'Save scanner runtime'}
        </Button>
      </div>
    </Card>
  );
}
