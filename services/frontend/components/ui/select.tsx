'use client';

import * as React from 'react';
import { Select as PanelSelect } from '@/components/panelui/select';
import { cn } from '@/lib/utils';
import { AriaSelect, ListBox } from './collections';
import { useOverlayPortal } from './overlay-portal';
import { Label } from './primitives';

type Key = string | number;

type ItemElement = React.ReactElement<{
  id?: Key;
  children?: React.ReactNode;
  isDisabled?: boolean;
  textValue?: string;
  className?: string;
}>;

type ParentProps = { children?: React.ReactNode; className?: string };

function isElementOf(
  node: React.ReactNode,
  type: unknown
): node is React.ReactElement<ParentProps> {
  return React.isValidElement(node) && node.type === type;
}

function collectItems(node: React.ReactNode, out: ItemElement[] = []) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement<ParentProps>(child)) return;
    if (child.type === ListBox.Item) {
      out.push(child as ItemElement);
      return;
    }
    collectItems(child.props.children, out);
  });
  return out;
}

function withoutItemIndicators(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement<ParentProps>(child)) return child;
    if (child.type === ListBox.ItemIndicator) return null;
    if (child.props.children === undefined) return child;
    return React.cloneElement(child, undefined, withoutItemIndicators(child.props.children));
  });
}

export interface SelectProps {
  value?: Key | Key[] | null;
  defaultValue?: Key | Key[] | null;
  onChange?: (key: any) => void; //
  isDisabled?: boolean;
  isRequired?: boolean;
  placeholder?: string;
  name?: string;
  id?: string;
  className?: string;
  /** Kept for source compatibility; the PanelUI trigger has one look. */
  variant?: string;
  selectionMode?: 'single' | 'multiple';
  'aria-label'?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}

/**
 * Select built on PanelUI. It keeps the call shape the app already uses
 * (`value`/`onChange`, `Select.Trigger`, `Select.Popover`, `ListBox.Item`) so
 * the options are read from the children and handed to PanelUI's `items`.
 * Multi-selects still use the React Aria implementation.
 */
function SelectRoot(props: SelectProps) {
  if (props.selectionMode === 'multiple') {
    return <AriaSelect {...(props as any)} />;
  }
  return <PanelSelectAdapter {...props} />;
}

function PanelSelectAdapter({
  value,
  defaultValue,
  onChange,
  isDisabled,
  isRequired,
  placeholder,
  name,
  id,
  className,
  variant: _variant,
  selectionMode: _selectionMode,
  'aria-label': ariaLabel,
  children,
}: SelectProps) {
  const portal = useOverlayPortal();
  const autoId = React.useId();
  const triggerId = id ?? autoId;

  const nodes = React.Children.toArray(children);
  const label = nodes.find((node) => isElementOf(node, Label));
  const trigger = nodes.find((node) => isElementOf(node, AriaSelect.Trigger));
  const popover = nodes.find((node) => isElementOf(node, AriaSelect.Popover));
  const rest = nodes.filter((node) => node !== label && node !== trigger && node !== popover);

  const itemElements = collectItems(popover ?? nodes);
  const originalKeys = new Map<string, Key>();
  const items = itemElements.map((element) => {
    const key = element.props.id ?? '';
    originalKeys.set(String(key), key);
    return {
      value: String(key),
      label: withoutItemIndicators(element.props.children),
      disabled: element.props.isDisabled,
    };
  });

  const known = (key: Key | Key[] | null | undefined) =>
    key !== null && key !== undefined && !Array.isArray(key) && originalKeys.has(String(key))
      ? String(key)
      : null;

  const valueProps =
    value !== undefined
      ? { value: known(value) }
      : defaultValue !== undefined
        ? { defaultValue: known(defaultValue) }
        : {};

  const triggerElement = trigger as React.ReactElement<ParentProps> | undefined;
  const triggerChildren = React.Children.toArray(triggerElement?.props.children).filter(
    (node) => !isElementOf(node, AriaSelect.Indicator)
  );
  const hasValue = triggerChildren.some((node) => isElementOf(node, AriaSelect.Value));
  const valueClassName = (
    triggerChildren.find((node) => isElementOf(node, AriaSelect.Value)) as
      React.ReactElement<ParentProps> | undefined
  )?.props.className;
  const labelElement = label as React.ReactElement<ParentProps> | undefined;
  const hiddenLabel =
    labelElement && /\bsr-only\b/.test(String(labelElement.props.className ?? ''));

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {labelElement && !hiddenLabel ? (
        <label htmlFor={triggerId} className={labelElement.props.className}>
          {labelElement.props.children}
        </label>
      ) : null}
      <PanelSelect
        {...valueProps}
        items={items}
        name={name}
        disabled={isDisabled}
        required={isRequired}
        onValueChange={(next) => {
          if (!onChange) return;
          onChange(next === null ? null : (originalKeys.get(String(next)) ?? next));
        }}
      >
        <PanelSelect.Trigger
          id={triggerId}
          aria-label={
            ariaLabel ??
            (hiddenLabel && typeof labelElement?.props.children === 'string'
              ? labelElement.props.children
              : undefined)
          }
          className={triggerElement?.props.className}
        >
          {hasValue ? (
            <PanelSelect.Value
              placeholder={placeholder ?? 'Select an item'}
              className={valueClassName}
            />
          ) : (
            triggerChildren
          )}
        </PanelSelect.Trigger>
        <PanelSelect.Content
          container={portal}
          className={(popover as React.ReactElement<ParentProps> | undefined)?.props.className}
        >
          {itemElements.map((element) => (
            <PanelSelect.Item
              key={String(element.props.id)}
              value={String(element.props.id ?? '')}
              disabled={element.props.isDisabled}
              className={element.props.className}
            >
              {withoutItemIndicators(element.props.children)}
            </PanelSelect.Item>
          ))}
        </PanelSelect.Content>
      </PanelSelect>
      {rest}
    </div>
  );
}

export const Select = Object.assign(SelectRoot, {
  Trigger: AriaSelect.Trigger,
  Value: AriaSelect.Value,
  Indicator: AriaSelect.Indicator,
  Popover: AriaSelect.Popover,
});
