'use client';

import { useToast } from '@/components/toast';
import { Button, Input, SettingRow, SettingsSection, SettingUnit, Switch } from '@/components/ui';
import { adminUpdateScannerSettings, getAdminSettings } from '@/lib/api/admin';
import type { ScannerSettings } from '@/lib/api/types/registries';
import { useEffect, useState } from 'react';

type NumberKey = {
  [K in keyof ScannerSettings]-?: ScannerSettings[K] extends number | undefined ? K : never;
}[keyof ScannerSettings];
type BooleanKey = {
  [K in keyof ScannerSettings]-?: ScannerSettings[K] extends boolean | undefined ? K : never;
}[keyof ScannerSettings];

type NumberField = {
  key: NumberKey;
  label: string;
  description: string;
  unit: string;
  min: number;
};

const LOCAL_FIELDS: NumberField[] = [
  {
    key: 'concurrency',
    label: 'Concurrent workers',
    description: 'How many local scans run at the same time. Takes effect after a restart.',
    unit: 'workers',
    min: 1,
  },
  {
    key: 'timeout_seconds',
    label: 'Scan timeout',
    description: 'A local scanner command is stopped after this long.',
    unit: 'seconds',
    min: 30,
  },
  {
    key: 'db_max_age_hours',
    label: 'Maximum database age',
    description: 'Vulnerability databases older than this are reported as stale.',
    unit: 'hours',
    min: 1,
  },
];

const XRAY_FIELDS: NumberField[] = [
  {
    key: 'xray_concurrency',
    label: 'Slots per stage',
    description:
      'Preparation and result import each get this many parallel slots. Takes effect after a restart.',
    unit: 'slots',
    min: 1,
  },
  {
    key: 'xray_max_active',
    label: 'Maximum active scans',
    description:
      'Upper bound for Xray scans in progress, including ones waiting on Xray. Takes effect after a restart.',
    unit: 'scans',
    min: 1,
  },
  {
    key: 'xray_warmup_timeout_seconds',
    label: 'Preparation timeout',
    description:
      'Time allowed for resolving image metadata and warming the cache, retries included.',
    unit: 'seconds',
    min: 1,
  },
  {
    key: 'xray_provider_timeout_seconds',
    label: 'Wait timeout',
    description: 'Time allowed for each wait on an Xray artifact status or summary.',
    unit: 'seconds',
    min: 1,
  },
  {
    key: 'xray_timeout_seconds',
    label: 'Overall timeout',
    description: 'Time allowed from picking up the scan until its results are imported.',
    unit: 'seconds',
    min: 1,
  },
];

const ENGINE_SWITCHES: Array<{ key: BooleanKey; label: string; description: string }> = [
  {
    key: 'enable_trivy',
    label: 'Trivy',
    description: 'Scan images with the built-in Trivy scanner.',
  },
  {
    key: 'enable_grype',
    label: 'Grype',
    description: 'Offer Grype as an additional local scan engine.',
  },
  {
    key: 'enable_osv_java_augmentation',
    label: 'OSV Java augmentation',
    description: 'Look up Java packages in OSV.dev to add findings the scanner database misses.',
  },
];

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function NumberSettingsSection({
  title,
  description,
  fields,
  saved,
  onSaved,
}: {
  title: string;
  description: string;
  fields: NumberField[];
  saved: ScannerSettings;
  onSaved: (patch: Partial<ScannerSettings>) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const valueOf = (key: NumberKey) => draft[key] ?? String(saved[key] ?? '');
  const dirty = fields.some(
    (field) => draft[field.key] !== undefined && draft[field.key] !== String(saved[field.key] ?? '')
  );
  const invalid = fields.find((field) => {
    const parsed = parseInt(valueOf(field.key), 10);
    return Number.isNaN(parsed) || parsed < field.min;
  });

  async function handleSave() {
    if (invalid) {
      toast.error(`${invalid.label} must be at least ${invalid.min} ${invalid.unit}.`);
      return;
    }
    const patch: Partial<ScannerSettings> = {};
    for (const field of fields) {
      patch[field.key] = parseInt(valueOf(field.key), 10);
    }
    setSaving(true);
    try {
      await adminUpdateScannerSettings(patch);
      onSaved(patch);
      setDraft({});
      toast.success(`${title} settings saved`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update scanner settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title={title}
      description={description}
      footer={
        dirty ? (
          <>
            <Button variant="ghost" size="sm" onPress={() => setDraft({})} isDisabled={saving}>
              Discard
            </Button>
            <Button size="sm" onPress={handleSave} isDisabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        ) : null
      }
    >
      {fields.map((field) => {
        const id = `scanner-${field.key}`;
        return (
          <SettingRow
            key={field.key}
            label={field.label}
            description={field.description}
            htmlFor={id}
          >
            <Input
              id={id}
              type="number"
              min={field.min}
              inputMode="numeric"
              className="w-24 text-right tabular-nums"
              value={valueOf(field.key)}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
            <SettingUnit>{field.unit}</SettingUnit>
          </SettingRow>
        );
      })}
    </SettingsSection>
  );
}

export function ScannerRuntimePanel() {
  const toast = useToast();
  const [settings, setSettings] = useState<ScannerSettings>({});
  const [loading, setLoading] = useState(true);
  const [savingSwitch, setSavingSwitch] = useState<BooleanKey | null>(null);

  useEffect(() => {
    getAdminSettings()
      .then((current) => {
        setSettings({
          xray_concurrency: parseNumber(current['scanner.xray_concurrency'], 2),
          xray_max_active: parseNumber(current['scanner.xray_max_active'], 32),
          xray_warmup_timeout_seconds: parseNumber(
            current['scanner.xray_warmup_timeout_seconds'],
            600
          ),
          xray_provider_timeout_seconds: parseNumber(
            current['scanner.xray_provider_timeout_seconds'],
            900
          ),
          xray_timeout_seconds: parseNumber(current['scanner.xray_timeout_seconds'], 3600),

          enable_trivy: current['scanner.enable_trivy'] !== 'false',
          enable_grype: current['scanner.enable_grype'] !== 'false',
          concurrency: parseNumber(current['scanner.concurrency'], 2),
          timeout_seconds: parseNumber(current['scanner.timeout_seconds'], 300),
          db_max_age_hours: parseNumber(current['scanner.db_max_age_hours'], 24),
          enable_osv_java_augmentation: current['scanner.enable_osv_java_augmentation'] === 'true',
        });
      })
      .catch(() => toast.error('Failed to load scanner settings'))
      .finally(() => setLoading(false));
  }, [toast]);

  async function handleSwitch(key: BooleanKey, label: string, enabled: boolean) {
    const previous = settings[key];
    setSettings((current) => ({ ...current, [key]: enabled }));
    setSavingSwitch(key);
    try {
      await adminUpdateScannerSettings({ [key]: enabled });
      toast.success(`${label} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error: unknown) {
      setSettings((current) => ({ ...current, [key]: previous }));
      toast.error(error instanceof Error ? error.message : 'Failed to update scanner settings');
    } finally {
      setSavingSwitch(null);
    }
  }

  const applySaved = (patch: Partial<ScannerSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));

  if (loading) return null;

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Scan engines"
        description="Engines available for new scans. Changes save immediately."
      >
        {ENGINE_SWITCHES.map((engine) => (
          <SettingRow key={engine.key} label={engine.label} description={engine.description}>
            <Switch
              aria-label={engine.label}
              isSelected={settings[engine.key] ?? engine.key !== 'enable_osv_java_augmentation'}
              isDisabled={savingSwitch === engine.key}
              onChange={(checked) => void handleSwitch(engine.key, engine.label, checked)}
            >
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch>
          </SettingRow>
        ))}
      </SettingsSection>

      <NumberSettingsSection
        title="Local scanner"
        description="Throughput and database freshness for scans that run on this server."
        fields={LOCAL_FIELDS}
        saved={settings}
        onSaved={applySaved}
      />

      <NumberSettingsSection
        title="Artifactory Xray"
        description="Concurrency and time limits for scans delegated to Artifactory Xray."
        fields={XRAY_FIELDS}
        saved={settings}
        onSaved={applySaved}
      />
    </div>
  );
}
