'use client';

import { ToggleButton, ToggleButtonGroup } from '@heroui/react';
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
    <ToggleButtonGroup
      selectedKeys={new Set([value])}
      selectionMode="single"
      disallowEmptySelection
      aria-label={ariaLabel ?? 'Segmented control'}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next != null) onChange(String(next) as T);
      }}
      className={cx('segmented-control-root', className)}
    >
      {options.map((option) => {
        const active = value === option.id;
        return (
          <ToggleButton
            key={option.id}
            id={option.id}
            aria-label={typeof option.label === 'string' ? option.label : undefined}
            className={cx('segmented-control-item', itemClassName)}
            data-active={active ? 'true' : 'false'}
            data-size={size}
            style={getItemStyle?.(option, active)}
            size={size}
            variant={active ? 'default' : 'ghost'}
          >
            {option.label}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
}
