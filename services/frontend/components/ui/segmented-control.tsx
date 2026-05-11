'use client';

import { Button } from '@heroui/react';
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
    <div className={cx('segmented-control', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.id;
        return (
          <Button
            key={option.id}
            type="button"
            variant="secondary"
            onPress={() => onChange(option.id)}
            className={cx('segmented-control-item', itemClassName)}
            data-active={active ? 'true' : 'false'}
            data-size={size}
            style={getItemStyle?.(option, active)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
