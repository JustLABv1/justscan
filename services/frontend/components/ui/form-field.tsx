'use client';

import { heroFieldClassName, joinClassNames } from '@/components/ui/form-styles';
import { Description, FieldError, Input, Label, TextField } from '@heroui/react';
import type { ClipboardEvent, ComponentProps, KeyboardEvent } from 'react';
import { useId, useRef } from 'react';

type FormFieldProps = {
  label: string;
  description?: string;
  error?: string;
  containerClassName?: string;
  className?: string;
} & Omit<ComponentProps<typeof Input>, 'className'>;

export function FormField({
  label,
  description,
  error,
  id,
  disabled,
  name,
  onKeyDown,
  onPaste,
  readOnly,
  required,
  className,
  containerClassName,
  type,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement | null>(null);

  function insertTextAtSelection(text: string, target: HTMLInputElement | null) {
    if (!target) return;

    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const nextValue = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    if (valueSetter) {
      valueSetter.call(target, nextValue);
    } else {
      target.value = nextValue;
    }

    const nextCursor = start + text.length;
    target.setSelectionRange(nextCursor, nextCursor);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    onPaste?.(event);

    if (event.defaultPrevented || type !== 'password' || disabled || readOnly) {
      return;
    }

    const text = event.clipboardData.getData('text');
    if (!text) {
      return;
    }

    event.preventDefault();
    insertTextAtSelection(text, event.currentTarget);
  }

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);

    if (
      event.defaultPrevented ||
      type !== 'password' ||
      disabled ||
      readOnly ||
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== 'v' ||
      typeof navigator === 'undefined' ||
      !navigator.clipboard?.readText
    ) {
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }

      event.preventDefault();
      insertTextAtSelection(text, inputRef.current ?? event.currentTarget);
    } catch {
      return;
    }
  }

  return (
    <TextField
      className={containerClassName}
      isDisabled={disabled}
      isInvalid={Boolean(error)}
      isReadOnly={readOnly}
      isRequired={required}
      name={name}
      type={type}
    >
      <Label className="text-sm font-medium" htmlFor={fieldId} style={{ color: 'var(--text-secondary)' }}>
        {label}
      </Label>
      <Input
        {...props}
        className={joinClassNames(
          heroFieldClassName,
          className,
        )}
        disabled={disabled}
        id={fieldId}
        name={name}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        readOnly={readOnly}
        ref={inputRef}
        required={required}
        type={type}
      />
      {description ? (
        <Description className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {description}
        </Description>
      ) : null}
      {error ? (
        <FieldError className="text-xs font-medium" style={{ color: '#f87171' }}>
          {error}
        </FieldError>
      ) : null}
    </TextField>
  );
}