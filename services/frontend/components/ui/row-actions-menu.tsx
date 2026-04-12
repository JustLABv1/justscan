'use client';

import { Button, Dropdown, Label } from '@heroui/react';
import { MoreVerticalIcon } from 'hugeicons-react';
import type { ReactNode } from 'react';

export type RowActionItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  onAction: () => void;
};

export function RowActionsMenu({ label, items }: { label: string; items: RowActionItem[] }) {
  return (
    <Dropdown>
      <Dropdown.Trigger>
        <Button aria-label={label} className="btn-icon-subtle" isIconOnly variant="secondary">
          <MoreVerticalIcon size={15} />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Popover className="min-w-[190px]">
        <Dropdown.Menu
          onAction={(key) => {
            const item = items.find((entry) => entry.id === key);
            if (item && !item.disabled) {
              item.onAction();
            }
          }}
        >
          {items.map((item) => (
            <Dropdown.Item key={item.id} id={item.id} isDisabled={item.disabled} textValue={item.label} variant={item.variant}>
              <div className="flex items-center gap-2">
                {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
                <Label>{item.label}</Label>
              </div>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}