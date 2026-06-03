'use client';

import { Alert } from '@heroui/react';
import type { ReactNode } from 'react';

type FormAlertProps = {
  title?: string;
  description: ReactNode;
  status?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
};

const ALERT_CLASS_NAMES: Record<NonNullable<FormAlertProps['status']>, string> = {
  default: 'rounded-2xl border border-divider/70',
  accent: 'rounded-2xl border border-accent/20 bg-accent/10',
  success: 'rounded-2xl border border-success/20 bg-success/10',
  warning: 'rounded-2xl border border-warning/20 bg-warning/10',
  danger: 'rounded-2xl border border-danger/20 bg-danger/10',
};

export function FormAlert({ title, description, status = 'danger' }: FormAlertProps) {
  return (
    <Alert className={ALERT_CLASS_NAMES[status]} status={status}>
      <Alert.Indicator />
      <Alert.Content>
        {title ? <Alert.Title>{title}</Alert.Title> : null}
        <Alert.Description>{description}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}
