'use client';

import { Alert } from '@heroui/react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type StatusAlertProps = {
  title?: string;
  description?: ReactNode;
  status?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  action?: ReactNode;
  className?: string;
};

export function StatusAlert({
  title,
  description,
  status = 'default',
  action,
  className,
}: StatusAlertProps) {
  return (
    <Alert className={cn('rounded-2xl', className)} status={status}>
      <Alert.Indicator />
      <Alert.Content>
        {title ? <Alert.Title>{title}</Alert.Title> : null}
        {description ? <Alert.Description>{description}</Alert.Description> : null}
      </Alert.Content>
      {action}
    </Alert>
  );
}

export function FormAlert(props: StatusAlertProps) {
  return <StatusAlert status="danger" {...props} />;
}
