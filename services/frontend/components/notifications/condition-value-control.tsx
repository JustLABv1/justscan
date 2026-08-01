'use client';

import { FormField } from '@/components/ui/form-field';
import {
  fieldDescriptionClassName,
  fieldLabelClassName,
  heroFieldClassName,
  heroSelectTriggerClassName,
} from '@/components/ui/form-styles';
import type { ConditionOption, ConditionValue } from '@/components/notifications/condition-catalog';
import {
  allowsCustomConditionValue,
  conditionOptionLabel,
  getConditionDefinition,
  isMultiValueOperator,
  mergeConditionOptions,
  normalizeConditionValue,
} from '@/components/notifications/condition-catalog';
import { ComboBox, Input, Label, ListBox, Select, Tag, TagGroup } from '@heroui/react';
import type { Key } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';

type ConditionValueControlProps = {
  field: string;
  operator: string;
  value: ConditionValue;
  options: ConditionOption[];
  isLoading?: boolean;
  onChange: (value: ConditionValue) => void;
  onLookup: (query: string) => void;
};

const selectedLabelClassName = 'truncate text-sm';

function optionText(option: ConditionOption) {
  return option.legacy ? `⚠ ${option.label}` : option.label;
}

function OptionContent({ option }: { option: ConditionOption }) {
  return (
    <div className="min-w-0">
      <div className={option.legacy ? 'truncate text-warning' : 'truncate'}>
        {optionText(option)}
      </div>
      {option.description ? (
        <div className="truncate text-xs text-muted">{option.description}</div>
      ) : null}
    </div>
  );
}

function StaticConditionValueControl({
  field,
  operator,
  value,
  options,
  onChange,
}: Omit<ConditionValueControlProps, 'isLoading' | 'onLookup'>) {
  const definition = getConditionDefinition(field);
  const multi = isMultiValueOperator(operator);
  const normalizedValue = normalizeConditionValue(operator, value);
  const selectedValues = Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue];

  return (
    <Select
      aria-label={definition.label}
      selectionMode={multi ? 'multiple' : 'single'}
      value={multi ? selectedValues : (selectedValues[0] ?? '')}
      onChange={(nextValue) => {
        const values = Array.isArray(nextValue)
          ? nextValue.map(String)
          : nextValue == null
            ? []
            : [String(nextValue)];
        onChange(multi ? values : (values[0] ?? ''));
      }}
      variant="primary"
    >
      <Select.Trigger className={heroSelectTriggerClassName}>
        <span
          className={selectedValues.length > 0 ? selectedLabelClassName : 'truncate text-muted'}
        >
          {selectedValues.length > 0
            ? selectedValues.map((item) => conditionOptionLabel(field, item, options)).join(', ')
            : 'Select a value'}
        </span>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox selectionMode={multi ? 'multiple' : 'single'}>
          {options.map((option) => (
            <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
              <OptionContent option={option} />
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function NumericConditionValueControl({
  field,
  value,
  onChange,
}: Pick<ConditionValueControlProps, 'field' | 'value' | 'onChange'>) {
  const definition = getConditionDefinition(field);
  const stringValue = Array.isArray(value) ? (value[0] ?? '') : value;
  return (
    <FormField
      aria-label={definition.label}
      label={definition.label}
      hideLabel
      type="number"
      min={field === 'highest_cvss' ? 0 : 0}
      max={field === 'highest_cvss' ? 10 : undefined}
      step={field === 'highest_cvss' ? '0.1' : '1'}
      value={stringValue}
      onChange={(event) => onChange(event.target.value)}
      placeholder={definition.placeholder}
      description={definition.description}
      variant="primary"
    />
  );
}

function DynamicSingleValueControl({
  field,
  operator,
  value,
  options,
  isLoading,
  onChange,
  onLookup,
}: ConditionValueControlProps) {
  const definition = getConditionDefinition(field);
  const allowsCustom = allowsCustomConditionValue(field, operator);
  const stringValue = Array.isArray(value) ? (value[0] ?? '') : value;
  const selectedOption = options.find((option) => option.value === stringValue);
  const [inputValue, setInputValue] = useState(selectedOption?.label ?? stringValue);
  const displayInputValue =
    inputValue === stringValue ? (selectedOption?.label ?? stringValue) : inputValue;

  useEffect(() => {
    onLookup('');
  }, [onLookup]);

  return (
    <ComboBox
      aria-label={definition.label}
      allowsCustomValue={allowsCustom}
      allowsEmptyCollection
      inputValue={displayInputValue}
      selectedKey={stringValue || null}
      onInputChange={(nextInput) => {
        setInputValue(nextInput);
        onLookup(nextInput);
        if (allowsCustom) onChange(nextInput);
      }}
      onSelectionChange={(key) => {
        if (key == null) return;
        const selectedValue = String(key);
        const selected = options.find((option) => option.value === selectedValue);
        onChange(selectedValue);
        setInputValue(selected?.label ?? selectedValue);
      }}
    >
      <Label className={fieldLabelClassName}>{definition.label}</Label>
      <ComboBox.InputGroup>
        <Input className={heroFieldClassName} placeholder={definition.placeholder} />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      {definition.description ? (
        <div className={fieldDescriptionClassName}>
          {definition.description}
          {isLoading ? ' Loading suggestions…' : ''}
        </div>
      ) : isLoading ? (
        <div className={fieldDescriptionClassName}>Loading suggestions…</div>
      ) : null}
      <ComboBox.Popover>
        <ListBox
          renderEmptyState={() => (
            <div className="px-3 py-2 text-sm text-muted">No matching values.</div>
          )}
        >
          {options.map((option) => (
            <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
              <OptionContent option={option} />
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}

function DynamicMultiValueControl({
  field,
  operator,
  value,
  options,
  isLoading,
  onChange,
  onLookup,
}: ConditionValueControlProps) {
  const definition = getConditionDefinition(field);
  const allowsCustom = allowsCustomConditionValue(field, operator);
  const selectedValues = useMemo(() => {
    const normalizedValue = normalizeConditionValue(operator, value);
    return Array.isArray(normalizedValue) ? normalizedValue : [];
  }, [operator, value]);
  const tagItems = useMemo(
    () => selectedValues.map((selectedValue) => ({ id: selectedValue, value: selectedValue })),
    [selectedValues]
  );
  const [inputValue, setInputValue] = useState('');
  const availableOptions = useMemo(
    () => options.filter((option) => !selectedValues.includes(option.value)),
    [options, selectedValues]
  );

  useEffect(() => {
    onLookup('');
  }, [onLookup]);

  const addValue = (nextValue: string | Key | null) => {
    if (nextValue == null) return;
    const trimmed = String(nextValue).trim();
    if (!trimmed || selectedValues.includes(trimmed)) return;
    onChange([...selectedValues, trimmed]);
    setInputValue('');
    onLookup('');
  };

  return (
    <div className="space-y-2">
      <TagGroup
        aria-label={`${definition.label} selected values`}
        selectionMode="none"
        onRemove={(keys) => onChange(selectedValues.filter((item) => !keys.has(item)))}
      >
        <TagGroup.List
          items={tagItems}
          renderEmptyState={() => (
            <span className="text-xs text-muted">No values selected yet.</span>
          )}
          className="gap-1.5"
        >
          {(tagItem) => {
            const option = options.find((item) => item.value === tagItem.value);
            return (
              <Tag key={tagItem.id} id={tagItem.id} textValue={tagItem.value} variant="surface">
                {option?.legacy ? '⚠ ' : ''}
                {option?.label ?? tagItem.value}
              </Tag>
            );
          }}
        </TagGroup.List>
      </TagGroup>

      <ComboBox
        aria-label={`Add ${definition.label}`}
        allowsCustomValue={allowsCustom}
        allowsEmptyCollection
        inputValue={inputValue}
        selectedKey={null}
        onInputChange={(nextInput) => {
          setInputValue(nextInput);
          onLookup(nextInput);
        }}
        onSelectionChange={(key) => addValue(key)}
      >
        <Label className="sr-only">Add {definition.label}</Label>
        <ComboBox.InputGroup>
          <Input
            className={heroFieldClassName}
            placeholder={definition.placeholder ?? 'Search and add values'}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && allowsCustom && inputValue.trim()) {
                event.preventDefault();
                addValue(inputValue);
              }
            }}
          />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <div className={fieldDescriptionClassName}>
          {allowsCustom
            ? 'Choose a suggestion or press Enter to add a custom pattern.'
            : 'Choose one or more suggestions.'}
          {isLoading ? ' Loading suggestions…' : ''}
        </div>
        <ComboBox.Popover>
          <ListBox
            renderEmptyState={() => (
              <div className="px-3 py-2 text-sm text-muted">No matching values.</div>
            )}
          >
            {availableOptions.map((option) => (
              <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                <OptionContent option={option} />
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>
    </div>
  );
}

export function ConditionValueControl(props: ConditionValueControlProps) {
  const definition = getConditionDefinition(props.field);
  const options = mergeConditionOptions(props.field, props.options, props.value);

  if (definition.kind === 'numeric') {
    return <NumericConditionValueControl {...props} />;
  }
  if (
    definition.kind === 'enum' ||
    definition.kind === 'boolean' ||
    definition.kind === 'severity'
  ) {
    return <StaticConditionValueControl {...props} options={options} />;
  }
  if (isMultiValueOperator(props.operator)) {
    return <DynamicMultiValueControl {...props} options={options} />;
  }
  return <DynamicSingleValueControl {...props} options={options} />;
}
