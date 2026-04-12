'use client';

import { heroFieldClassName, joinClassNames } from '@/components/ui/form-styles';
import { Input, Label } from '@heroui/react';
import type { ComponentProps } from 'react';
import { useId } from 'react';

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
  required,
  className,
  containerClassName,
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={joinClassNames('space-y-1.5', containerClassName)}>
      <Label className="text-sm font-medium" htmlFor={fieldId} style={{ color: 'var(--text-secondary)' }}>
        {label}
        {required ? <span className="ml-1" style={{ color: '#f87171' }}>*</span> : null}
      </Label>
      <Input
        {...props}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={joinClassNames(
          heroFieldClassName,
          className,
        )}
        id={fieldId}
        required={required}
      />
      {description ? (
        <p className="text-xs" id={descriptionId} style={{ color: 'var(--text-faint)' }}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium" id={errorId} style={{ color: '#f87171' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}