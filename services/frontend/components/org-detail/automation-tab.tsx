import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import type {
  Org,
  OrgPolicy,
  VulnerabilityViewSettings,
  VulnerabilityViewSeverity,
  VulnerabilityViewSortBy,
} from '@/lib/api';
import { Button, Card, Chip, Input, Label, ListBox, Select, Switch } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';

import { RulePill } from './shared';

interface OrgAutomationTabProps {
  section: 'scan-settings' | 'policies';
  org: Org;
  inputClassName: string;
  canManageOrgSettings: boolean;
  newPattern: string;
  vulnerabilityViewSettings: VulnerabilityViewSettings;
  vulnerabilityViewSaving: boolean;
  onPatternChange: (value: string) => void;
  onAddPattern: () => void | Promise<void>;
  onRemovePattern: (pattern: string) => void | Promise<void>;
  onVulnerabilityViewSettingsChange: (settings: VulnerabilityViewSettings) => void;
  onSaveVulnerabilityViewSettings: () => void | Promise<void>;
  onCreatePolicy: () => void;
  onEditPolicy: (policy: OrgPolicy) => void;
  onDeletePolicy: (policyId: string) => void | Promise<void>;
}

const sortOptions: Array<{ id: VulnerabilityViewSortBy; label: string }> = [
  { id: 'severity', label: 'Severity' },
  { id: 'cvss_score', label: 'CVSS score' },
  { id: 'vuln_id', label: 'CVE ID' },
  { id: 'pkg_name', label: 'Package' },
  { id: 'installed_version', label: 'Installed version' },
  { id: 'fixed_version', label: 'Fixed version' },
];

const severityOptions: Array<{ id: VulnerabilityViewSeverity; label: string }> = [
  { id: '', label: 'All severities' },
  { id: 'CRITICAL', label: 'Critical' },
  { id: 'HIGH', label: 'High' },
  { id: 'MEDIUM', label: 'Medium' },
  { id: 'LOW', label: 'Low' },
  { id: 'UNKNOWN', label: 'Unknown' },
];

const selectTriggerCls = heroSelectTriggerClassName;

export function OrgAutomationTab({
  section,
  org,
  inputClassName,
  canManageOrgSettings,
  newPattern,
  vulnerabilityViewSettings,
  vulnerabilityViewSaving,
  onPatternChange,
  onAddPattern,
  onRemovePattern,
  onVulnerabilityViewSettingsChange,
  onSaveVulnerabilityViewSettings,
  onCreatePolicy,
  onEditPolicy,
  onDeletePolicy,
}: OrgAutomationTabProps) {
  function updateVulnerabilityViewSettings(patch: Partial<VulnerabilityViewSettings>) {
    onVulnerabilityViewSettingsChange({ ...vulnerabilityViewSettings, ...patch });
  }

  return (
    <div className="space-y-6">
      {section === 'scan-settings' && (
        <>
          <Card>
            <div
              className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
              style={{
                background:
                  'linear-gradient(90deg,transparent,color-mix(in srgb, var(--accent) 15%, transparent),transparent)',
              }}
            />
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Auto-route Unscoped Scans
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Scans created outside org scope that match these patterns are automatically assigned
                to this org. Use glob syntax:{' '}
                <code className="text-accent dark:text-accent">nginx:*</code>,{' '}
                <code className="text-accent dark:text-accent">docker.io/myapp:*</code>
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {(org.image_patterns ?? []).map((pattern, index) => (
                <Chip key={`${pattern}-${index}`} variant="soft" color="accent">
                  {pattern}
                  <button
                    onClick={() => void onRemovePattern(pattern)}
                    className="text-zinc-400 hover:text-red-400 transition-colors ml-0.5"
                    type="button"
                    disabled={!canManageOrgSettings}
                  >
                    ×
                  </button>
                </Chip>
              ))}
              {(org.image_patterns ?? []).length === 0 && (
                <p className="text-xs text-zinc-500">No patterns configured.</p>
              )}
            </div>

            <div className="flex gap-2">
              <Input
                type="text"
                value={newPattern}
                onChange={(event) => onPatternChange(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void onAddPattern()}
                placeholder="nginx:* or docker.io/myapp:*"
                className={`${inputClassName}`}
                disabled={!canManageOrgSettings}
              />
              <Button
                onClick={() => void onAddPattern()}
                isDisabled={!canManageOrgSettings || !newPattern.trim()}
              >
                Add
              </Button>
            </div>
          </Card>

          <Card>
            <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none" />
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                  Default vulnerability view
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Applies to organization scans unless a user saves their own scan view preference.
                </p>
              </div>
              <Button
                onClick={() => void onSaveVulnerabilityViewSettings()}
                isDisabled={!canManageOrgSettings || vulnerabilityViewSaving}
              >
                {vulnerabilityViewSaving ? 'Saving...' : 'Save defaults'}
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500">Sort by</label>
                <Select
                  value={vulnerabilityViewSettings.sort_by}
                  onChange={(value) =>
                    updateVulnerabilityViewSettings({
                      sort_by: String(value) as VulnerabilityViewSortBy,
                    })
                  }
                  isDisabled={!canManageOrgSettings}
                >
                  <Select.Trigger className={`${selectTriggerCls} bg-surface-secondary`}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {sortOptions.map((option) => (
                        <ListBox.Item key={option.id} id={option.id}>
                          {option.label}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500">Direction</label>
                <Select
                  value={vulnerabilityViewSettings.sort_dir}
                  onChange={(value) =>
                    updateVulnerabilityViewSettings({
                      sort_dir: String(value) === 'desc' ? 'desc' : 'asc',
                    })
                  }
                  isDisabled={!canManageOrgSettings}
                >
                  <Select.Trigger className={`${selectTriggerCls} bg-surface-secondary`}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="asc">Ascending</ListBox.Item>
                      <ListBox.Item id="desc">Descending</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500">Severity</label>
                <Select
                  value={vulnerabilityViewSettings.severity || '__all__'}
                  onChange={(value) =>
                    updateVulnerabilityViewSettings({
                      severity: String(
                        value === '__all__' ? '' : (value ?? '')
                      ) as VulnerabilityViewSeverity,
                    })
                  }
                  isDisabled={!canManageOrgSettings}
                >
                  <Select.Trigger className={`${selectTriggerCls} bg-surface-secondary`}>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {severityOptions.map((option) => (
                        <ListBox.Item key={option.id || '__all__'} id={option.id || '__all__'}>
                          {option.label}
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500">Min CVSS</label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={vulnerabilityViewSettings.min_cvss || ''}
                  placeholder="0"
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    updateVulnerabilityViewSettings({
                      min_cvss: Number.isFinite(value) ? value : 0,
                    });
                  }}
                  disabled={!canManageOrgSettings}
                  className={inputClassName + ' bg-surface-secondary'}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Switch
                isSelected={vulnerabilityViewSettings.has_fix}
                onChange={(value) => updateVulnerabilityViewSettings({ has_fix: value })}
                isDisabled={!canManageOrgSettings}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Only show vulnerabilities with a fix
                  </Label>
                </Switch.Content>
              </Switch>

              <Switch
                isSelected={vulnerabilityViewSettings.xray_policy_first}
                onChange={(value) => updateVulnerabilityViewSettings({ xray_policy_first: value })}
                isDisabled={!canManageOrgSettings}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Prioritize vulnerabilities with Xray policy matches
                  </Label>
                </Switch.Content>
              </Switch>

              <Switch
                isSelected={vulnerabilityViewSettings.policy_failed_only}
                onChange={(value) => updateVulnerabilityViewSettings({ policy_failed_only: value })}
                isDisabled={!canManageOrgSettings}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    Only show vulnerabilities that failed org policy
                  </Label>
                </Switch.Content>
              </Switch>
            </div>
          </Card>
        </>
      )}

      {section === 'policies' && (
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
                Compliance Policies
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Define the rules used to evaluate every scan assigned to this organization.
              </p>
            </div>
            <Button onClick={onCreatePolicy} isDisabled={!canManageOrgSettings}>
              <PlusSignIcon size={14} />
              Add Policy
            </Button>
          </div>

          {(org.policies ?? []).length === 0 ? (
            <div className="surface-card rounded-2xl p-6 text-center text-sm text-zinc-500">
              No policies yet. Add one to start evaluating compliance.
            </div>
          ) : (
            <div className="space-y-2">
              {(org.policies ?? []).map((policy) => (
                <Card key={policy.id} className="bg-surface-secondary">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {policy.name}
                      </p>
                      {policy.rules.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {policy.rules.map((rule, index) => (
                            <RulePill key={index} rule={rule} />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        onClick={() => onEditPolicy(policy)}
                        variant="secondary"
                        type="button"
                        isDisabled={!canManageOrgSettings}
                      >
                        <PencilEdit01Icon size={15} />
                      </Button>
                      <Button
                        onClick={() => void onDeletePolicy(policy.id)}
                        variant="danger-soft"
                        type="button"
                        isDisabled={!canManageOrgSettings}
                      >
                        <Delete01Icon size={15} />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
