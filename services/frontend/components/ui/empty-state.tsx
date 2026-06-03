'use client';
import { Button, Card, Chip } from '@heroui/react';
import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
  eyebrow?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  tone = 'accent',
  eyebrow,
  action,
}: EmptyStateProps) {
  return (
    <Card className="surface-card rounded-3xl border border-divider/70">
      <Card.Content className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-secondary text-foreground/56">
          {icon}
        </div>
        <div className="space-y-2">
          {eyebrow ? (
            <div className="flex justify-center">
              <Chip color={tone} size="sm" variant="soft">
                {eyebrow}
              </Chip>
            </div>
          ) : null}
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mx-auto max-w-xl text-sm leading-relaxed text-foreground/60">
            {description}
          </p>
        </div>
        {action ? (
          <Button className="mt-1" onPress={action.onClick} variant="secondary">
            {action.label}
          </Button>
        ) : null}
      </Card.Content>
    </Card>
  );
}
