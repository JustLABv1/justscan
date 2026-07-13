'use client';

import { Button, ListBox, Select } from '@heroui/react';

type OrganizationOption = {
  id: string;
  name: string;
};

type OwnershipTransferProps = {
  ownerOrgId?: string | null;
  organizations: OrganizationOption[];
  selectedOrgId: string;
  onSelectedOrgIdChange: (value: string) => void;
  onTransfer: () => void;
  isSaving?: boolean;
  warning?: string;
};

export function OwnershipTransfer({
  ownerOrgId,
  organizations,
  selectedOrgId,
  onSelectedOrgIdChange,
  onTransfer,
  isSaving = false,
  warning,
}: OwnershipTransferProps) {
  if (!ownerOrgId) return null;

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <div>
        <h3 className="text-sm font-semibold">Transfer ownership</h3>
        <p className="mt-0.5 text-xs text-muted">
          The previous owner will keep shared access. Existing organization grants are unchanged.
        </p>
        {warning ? <p className="mt-1 text-xs text-warning">{warning}</p> : null}
      </div>
      {organizations.length === 0 ? (
        <p className="text-sm text-muted">No other organization is available for transfer.</p>
      ) : (
        <div className="flex items-center gap-2">
          <Select
            value={selectedOrgId || '__none__'}
            onChange={(value) =>
              onSelectedOrgIdChange(String(value === '__none__' ? '' : (value ?? '')))
            }
            className="flex-1"
            variant="secondary"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="__none__">Select a destination organization</ListBox.Item>
                {organizations.map((organization) => (
                  <ListBox.Item key={organization.id} id={organization.id}>
                    {organization.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <Button
            type="button"
            variant="danger"
            isDisabled={!selectedOrgId || isSaving}
            onPress={onTransfer}
          >
            Transfer
          </Button>
        </div>
      )}
    </section>
  );
}
