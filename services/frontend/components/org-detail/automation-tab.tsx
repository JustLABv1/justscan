import { heroSelectTriggerClassName } from '@/components/ui/form-styles';
import type { Org, OrgPolicy, VulnerabilityViewSettings, VulnerabilityViewSeverity, VulnerabilityViewSortBy } from '@/lib/api';
import { Label, ListBox, Select, Switch } from '@heroui/react';
import { Delete01Icon, PencilEdit01Icon, PlusSignIcon } from 'hugeicons-react';

import { RulePill } from './shared';

interface OrgAutomationTabProps {
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
      <div className="glass-panel relative rounded-2xl p-5 space-y-3">
        <div
          className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.15),transparent)' }}
        />
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Auto-assign Patterns</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Scans matching these patterns are automatically assigned to this org. Use glob syntax: <code className="text-violet-500 dark:text-violet-400">nginx:*</code>, <code className="text-violet-500 dark:text-violet-400">docker.io/myapp:*</code>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(org.image_patterns ?? []).map((pattern, index) => (
            <span
              key={`${pattern}-${index}`}
              className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg text-zinc-700 dark:text-zinc-200"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--glass-border)' }}
            >
              {pattern}
              <button onClick={() => void onRemovePattern(pattern)} className="text-zinc-400 hover:text-red-400 transition-colors ml-0.5" type="button">×</button>
            </span>
          ))}
          {(org.image_patterns ?? []).length === 0 && <p className="text-xs text-zinc-500">No patterns configured.</p>}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newPattern}
            onChange={(event) => onPatternChange(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void onAddPattern()}
            placeholder="nginx:* or docker.io/myapp:*"
            className={`${inputClassName} font-mono`}
          />
          <button onClick={() => void onAddPattern()} disabled={!newPattern.trim()} className="btn-primary" type="button">
            Add
          </button>
        </div>
      </div>

      <div className="glass-panel relative rounded-2xl p-5 space-y-4">
        <div
          className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(14,165,233,0.18),transparent)' }}
        />
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Default vulnerability view</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Applies to organization scans unless a user saves their own scan view preference.
            </p>
          </div>
          <button
            onClick={() => void onSaveVulnerabilityViewSettings()}
            disabled={!canManageOrgSettings || vulnerabilityViewSaving}
            className="btn-primary shrink-0 disabled:opacity-50"
            type="button"
          >
            {vulnerabilityViewSaving ? 'Saving...' : 'Save defaults'}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">Sort by</label>
            <Select
              value={vulnerabilityViewSettings.sort_by}
              onChange={value => updateVulnerabilityViewSettings({ sort_by: String(value) as VulnerabilityViewSortBy })}
              isDisabled={!canManageOrgSettings}
            >
              <Select.Trigger className={selectTriggerCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {sortOptions.map((option) => <ListBox.Item key={option.id} id={option.id}>{option.label}</ListBox.Item>)}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">Direction</label>
            <Select
              value={vulnerabilityViewSettings.sort_dir}
              onChange={value => updateVulnerabilityViewSettings({ sort_dir: String(value) === 'desc' ? 'desc' : 'asc' })}
              isDisabled={!canManageOrgSettings}
            >
              <Select.Trigger className={selectTriggerCls}>
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
              onChange={value => updateVulnerabilityViewSettings({ severity: String(value === '__all__' ? '' : value ?? '') as VulnerabilityViewSeverity })}
              isDisabled={!canManageOrgSettings}
            >
              <Select.Trigger className={selectTriggerCls}>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {severityOptions.map((option) => <ListBox.Item key={option.id || '__all__'} id={option.id || '__all__'}>{option.label}</ListBox.Item>)}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">Min CVSS</label>
            <input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={vulnerabilityViewSettings.min_cvss || ''}
              placeholder="0"
              onChange={(event) => {
                const value = Number.parseFloat(event.target.value);
                updateVulnerabilityViewSettings({ min_cvss: Number.isFinite(value) ? value : 0 });
              }}
              disabled={!canManageOrgSettings}
              className={inputClassName}
            />
          </div>
        </div>

        <Switch
          isSelected={vulnerabilityViewSettings.has_fix}
          onChange={value => updateVulnerabilityViewSettings({ has_fix: value })}
          isDisabled={!canManageOrgSettings}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <Label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Only show vulnerabilities with a fix</Label>
          </Switch.Content>
        </Switch>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Policies</h2>
          <button onClick={onCreatePolicy} className="btn-primary inline-flex items-center gap-2" type="button">
            <PlusSignIcon size={14} />
            Add Policy
          </button>
        </div>

        {(org.policies ?? []).length === 0 ? (
          <div className="glass-panel rounded-2xl p-6 text-center text-sm text-zinc-500">
            No policies yet. Add one to start evaluating compliance.
          </div>
        ) : (
          <div className="space-y-2">
            {(org.policies ?? []).map((policy) => (
              <div key={policy.id} className="glass-panel rounded-2xl p-4 flex items-start justify-between gap-4">
                <div className="space-y-2 min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{policy.name}</p>
                  {policy.rules.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {policy.rules.map((rule, index) => (
                        <RulePill key={index} rule={rule} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => onEditPolicy(policy)} className="text-zinc-400 dark:text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors p-1" title="Edit policy" type="button">
                    <PencilEdit01Icon size={15} />
                  </button>
                  <button onClick={() => void onDeletePolicy(policy.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-red-400 transition-colors p-1" title="Delete policy" type="button">
                    <Delete01Icon size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}