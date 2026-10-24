import { Description, Label, Radio, RadioGroup } from '@/components/ui';

import type { XrayMode } from '@/lib/api/types/registries';

interface XrayModeSelectorProps {
  value: XrayMode;
  onChange: (value: XrayMode) => void;
}

const radioCardClassName =
  'flex h-full items-start gap-3 rounded-lg border border-border bg-transparent p-4 transition-colors hover:bg-accent/40 data-[selected]:border-primary data-[selected]:bg-accent/50';

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
        <Radio className={radioCardClassName} value="limited">
          <Radio.Control className="mt-0.5">
            <Radio.Indicator />
          </Radio.Control>
          <Radio.Content>
            <span className="text-sm font-medium">Limited</span>
            <Description>
              Import the existing Xray result. No rescan is requested, so freshness cannot be
              verified.
            </Description>
          </Radio.Content>
        </Radio>
        <Radio className={radioCardClassName} value="full">
          <Radio.Control className="mt-0.5">
            <Radio.Indicator />
          </Radio.Control>
          <Radio.Content>
            <span className="text-sm font-medium">Full</span>
            <Description>
              Request a scan and verify that Xray advances the provider result. Requires Xray Read
              and Manage Xray Metadata; a denied request fails the scan.
            </Description>
          </Radio.Content>
        </Radio>
      </div>
    </RadioGroup>
  );
}
