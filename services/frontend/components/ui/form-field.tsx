'use client';

import { heroFieldClassName, joinClassNames } from '@/components/ui/form-styles';
import {
  fieldDescriptionClassName,
  fieldErrorClassName,
  fieldLabelClassName,
} from '@/components/ui/form-styles';
import { Description, FieldError, Input, Label, TextField } from '@heroui/react';
import type { ComponentProps } from 'react';
import { useId } from 'react';

type FormFieldProps = {
  label: string;
  description?: string;
  error?: string;
  hideLabel?: boolean;
  labelClassName?: string;
  containerClassName?: string;
  className?: string;
} & Omit<ComponentProps<typeof Input>, 'className'>;

export function FormField({
  label,
  description,
  error,
  hideLabel,
  labelClassName,
  id,
  disabled,
  name,
  readOnly,
  required,
  className,
  containerClassName,
  type,
  variant = 'secondary',
  ...props
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

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
      <Label
        className={joinClassNames(fieldLabelClassName, hideLabel ? 'sr-only' : '', labelClassName)}
        htmlFor={fieldId}
      >
        {label}
      </Label>
      <Input
        {...props}
        className={joinClassNames(
          heroFieldClassName,
          className,
        )}
        variant={variant}
        disabled={disabled}
        id={fieldId}
        name={name}
        readOnly={readOnly}
        required={required}
        type={type}
      />
      {description ? (
        <Description className={fieldDescriptionClassName}>
          {description}
        </Description>
      ) : null}
      {error ? <FieldError className={fieldErrorClassName}>{error}</FieldError> : null}
    </TextField>
  );
}
