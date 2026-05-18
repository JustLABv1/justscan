'use client';
import { Button, Card } from '@heroui/react';
import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Card className="surface-card rounded-2xl py-16 flex flex-col items-center gap-4 text-center px-6">
      <div
        className="size-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 12%, transparent)' }}
      >
        <span className="text-zinc-400">{icon}</span>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{title}</p>
        <p className="text-sm text-zinc-500 max-w-xs mx-auto leading-relaxed">{description}</p>
      </div>
      {action && (
        <Button
          onClick={action.onClick}
          className="mt-1"
          variant="tertiary"
        >
          {action.label}
        </Button>
      )}
    </Card>
  );
}
