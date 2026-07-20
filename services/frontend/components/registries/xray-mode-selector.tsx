import { Description, Label, Radio, RadioGroup } from '@heroui/react';

import type { XrayMode } from '@/lib/api/types/registries';

interface XrayModeSelectorProps {
  value: XrayMode;
  onChange: (value: XrayMode) => void;
}

const radioCardClassName =
  'group min-h-32 items-start rounded-xl border border-surface-border !bg-[var(--field-background)] p-4 shadow-[var(--field-shadow)] transition-colors duration-150 hover:bg-surface-hovered data-[selected=true]:border-accent data-[selected=true]:bg-accent/10';

export function XrayModeSelector({ value, onChange }: XrayModeSelectorProps) {
  return (
    <RadioGroup
      value={value}
      variant="primary"
      onChange={(nextValue) => onChange(nextValue as XrayMode)}
    >
      <Label>Xray scan mode</Label>
      <Description>
        Choose what this credential can do. The same credential is used for Artifactory pulls and
        Xray API requests.
      </Description>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Radio
          className={radioCardClassName}
          value="limited"
        >
          <Radio.Control className="mt-0.5">
            <Radio.Indicator />
          </Radio.Control>
          <Radio.Content>
            <Label>Limited</Label>
            <Description>
              Import the existing Xray result. No rescan is requested, so freshness cannot be
              verified.
            </Description>
          </Radio.Content>
        </Radio>
        <Radio
          className={radioCardClassName}
          value="full"
        >
          <Radio.Control className="mt-0.5">
            <Radio.Indicator />
          </Radio.Control>
          <Radio.Content>
            <Label>Full</Label>
            <Description>
              Request and confirm a fresh scan. Requires Xray Read and Manage Xray Metadata; a
              denied request fails the scan.
            </Description>
          </Radio.Content>
        </Radio>
      </div>
    </RadioGroup>
  );
}
