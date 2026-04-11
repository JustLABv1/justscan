'use client';

import { Alert } from '@heroui/react';
import type { ReactNode } from 'react';

type FormAlertProps = {
  title?: string;
  description: ReactNode;
  status?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
};

export function FormAlert({ title, description, status = 'danger' }: FormAlertProps) {
  return (
    <Alert className="rounded-xl" status={status}>
      <Alert.Indicator />
      <Alert.Content>
        {title ? <Alert.Title>{title}</Alert.Title> : null}
        <Alert.Description>{description}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}