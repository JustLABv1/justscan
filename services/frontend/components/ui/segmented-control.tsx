'use client';

import { Tabs } from '@heroui/react';
import type { CSSProperties, ReactNode } from 'react';

type SegmentOption<T extends string> = {
  id: T;
  label: ReactNode;
};

type SegmentedControlProps<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
  itemClassName?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  getItemStyle?: (option: SegmentOption<T>, active: boolean) => CSSProperties | undefined;
};

function cx(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(' ');
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  itemClassName,
  size = 'md',
  ariaLabel,
  getItemStyle,
}: SegmentedControlProps<T>) {
  return (
    <Tabs
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
      className={cx('segmented-control-root', className)}
    >
      <Tabs.ListContainer>
        <Tabs.List aria-label={ariaLabel ?? 'Segmented control'} className="segmented-control">
          {options.map((option) => {
            const active = value === option.id;
            return (
              <Tabs.Tab
                key={option.id}
                id={option.id}
                className={cx('segmented-control-item', itemClassName)}
                data-active={active ? 'true' : 'false'}
                data-size={size}
                style={getItemStyle?.(option, active)}
              >
                {option.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            );
          })}
        </Tabs.List>
      </Tabs.ListContainer>
    </Tabs>
  );
}
