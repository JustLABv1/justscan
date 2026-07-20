import { Alert, Description, Label, Radio, RadioGroup } from '@heroui/react';

import type { XrayMode } from '@/lib/api/types/registries';

interface XrayModeSelectorProps {
  value: XrayMode;
  onChange: (value: XrayMode) => void;
}

export function XrayModeSelector({ value, onChange }: XrayModeSelectorProps) {
  return (
    <div className="space-y-3 rounded-xl border border-surface-border bg-surface-secondary p-4">
      <RadioGroup value={value} onChange={(nextValue) => onChange(nextValue as XrayMode)}>
        <Label>Xray access mode</Label>
        <Description>
          Select the least privileged mode that matches this credential. The same credential is
          used for Artifactory pulls and Xray API requests.
        </Description>
        <div className="mt-2 grid gap-3">
          <Radio value="limited">
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Radio.Content>
              <Label>Limited (recommended)</Label>
              <Description>
                Pull through Artifactory and import its existing Xray result. JustScan never
                requests a rescan. Remote images must be cacheable and the repository must be
                indexed by Xray.
              </Description>
            </Radio.Content>
          </Radio>
          <Radio value="full">
            <Radio.Control>
              <Radio.Indicator />
            </Radio.Control>
            <Radio.Content>
              <Label>Full</Label>
              <Description>
                Requests a fresh Xray scan before importing results. Requires Xray Read and
                Manage Xray Metadata permissions.
              </Description>
            </Radio.Content>
          </Radio>
        </div>
      </RadioGroup>
      {value === 'limited' ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Freshness cannot be verified</Alert.Title>
            <Alert.Description>
              A successful Limited scan confirms that Xray returned readable results, not that it
              performed a new scan for this request.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Full mode fails if rescan access is denied</Alert.Title>
            <Alert.Description>
              JustScan will not silently fall back to Limited mode when Xray rejects the fresh
              scan request.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );
}
