'use client';

import * as React from 'react';
import { Checkbox as PanelCheckbox } from '@/components/panelui/checkbox';
import { cn } from '@/lib/utils';
import { AriaCheckbox, Label } from './primitives';

type ParentProps = { children?: React.ReactNode; className?: string };

export interface CheckboxProps {
  isSelected?: boolean;
  defaultSelected?: boolean;
  isIndeterminate?: boolean;
  isDisabled?: boolean;
  onChange?: (selected: boolean) => void;
  name?: string;
  value?: string;
  id?: string;
  className?: string;
  /** Kept for source compatibility. */
  variant?: string;
  slot?: string | null;
  'aria-label'?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}

/**
 * Checkbox built on PanelUI. Keeps the `Checkbox.Control`/`Checkbox.Content`
 * call shape: the control becomes PanelUI's box and everything else is its
 * label, wrapped in one clickable <label>. Checkboxes bound to a React Aria
 * collection (`slot="selection"`) keep the React Aria implementation.
 */
function CheckboxRoot(props: CheckboxProps) {
  if (props.slot || typeof props.children === 'function') {
    return <AriaCheckbox {...(props as any)} />;
  }
  return <PanelCheckboxAdapter {...props} />;
}

function PanelCheckboxAdapter({
  isSelected,
  defaultSelected,
  isIndeterminate,
  isDisabled,
  onChange,
  name,
  value,
  id,
  className,
  variant: _variant,
  slot: _slot,
  'aria-label': ariaLabel,
  children,
}: CheckboxProps) {
  const [inner, setInner] = React.useState(Boolean(defaultSelected));
  const checked = isSelected ?? inner;

  const slots: { content?: string } = {};

  const box = (
    <PanelCheckbox
      id={id}
      name={name}
      value={value}
      label={ariaLabel}
      checked={checked}
      indeterminate={isIndeterminate}
      disabled={isDisabled}
      onCheckedChange={(next) => {
        setInner(next);
        onChange?.(next);
      }}
    />
  );

  function render(node: React.ReactNode): React.ReactNode {
    return React.Children.map(node, (child) => {
      if (!React.isValidElement<ParentProps>(child)) return child;
      if (child.type === AriaCheckbox.Control) {
        return (
          <span key="box" className={cn('inline-flex shrink-0', child.props.className)}>
            {box}
          </span>
        );
      }
      if (child.type === AriaCheckbox.Content) {
        slots.content = child.props.className;
        return render(child.props.children);
      }
      // The wrapper is already a <label>; a nested one would toggle twice.
      if (child.type === Label) {
        return <span className={child.props.className}>{render(child.props.children)}</span>;
      }
      if (child.props.children === undefined) return child;
      return React.cloneElement(child, undefined, render(child.props.children));
    });
  }

  const body = render(children);

  return (
    <label
      data-selected={checked ? 'true' : undefined}
      data-disabled={isDisabled ? 'true' : undefined}
      className={cn(
        'group inline-flex cursor-pointer items-center gap-2 text-sm data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50',
        className,
        slots.content
      )}
    >
      {body}
    </label>
  );
}

export const Checkbox = Object.assign(CheckboxRoot, {
  Control: AriaCheckbox.Control,
  Indicator: AriaCheckbox.Indicator,
  Content: AriaCheckbox.Content,
});
