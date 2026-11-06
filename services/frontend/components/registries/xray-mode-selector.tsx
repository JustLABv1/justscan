import { ChoiceCards } from '@/components/panelui/choice-cards';
import { ShieldCheck, ShieldHalf } from 'lucide-react';

import type { XrayMode } from '@/lib/api/types/registries';

interface XrayModeSelectorProps {
  value: XrayMode;
  onChange: (value: XrayMode) => void;
}

export function XrayModeSelector({ value, onChange }: XrayModeSelectorProps) {
  return (
    <div className="space-y-2">
      <div>
        <p id="xray-scan-mode-label" className="text-sm font-medium text-foreground">
          Xray scan mode
        </p>
        <p className="text-xs text-muted-foreground">
          Choose what this credential can do. The same credential is used for Artifactory pulls and
          Xray API requests.
        </p>
      </div>
      <ChoiceCards
        aria-labelledby="xray-scan-mode-label"
        value={value}
        onValueChange={(next) => onChange(next as XrayMode)}
        columns={2}
        aspect="5 / 2"
      >
        <ChoiceCards.Item value="limited">
          <ChoiceCards.Media>
            <ShieldHalf aria-hidden className="size-6" />
          </ChoiceCards.Media>
          <ChoiceCards.Label>Limited</ChoiceCards.Label>
          <ChoiceCards.Description>
            Import the existing Xray result. No rescan is requested, so freshness cannot be
            verified.
          </ChoiceCards.Description>
        </ChoiceCards.Item>
        <ChoiceCards.Item value="full">
          <ChoiceCards.Media>
            <ShieldCheck aria-hidden className="size-6" />
          </ChoiceCards.Media>
          <ChoiceCards.Label>Full</ChoiceCards.Label>
          <ChoiceCards.Description>
            Request a scan and verify that Xray advances the provider result. Requires Xray Read and
            Manage Xray Metadata; a denied request fails the scan.
          </ChoiceCards.Description>
        </ChoiceCards.Item>
      </ChoiceCards>
    </div>
  );
}
