'use client';

import { Logo } from '@/components/logo';
import { Card } from '@heroui/react';
import type { ReactNode } from 'react';

type AuthCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <Logo size={60} className="mx-auto" />
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h1>
          <p
            className="mt-1 text-base font-medium"
            style={{
              color: 'color-mix(in oklab,var(--text-primary) 88%,var(--text-muted))',
              textShadow: '0 1px 14px color-mix(in oklab,var(--background) 65%,transparent)',
            }}
          >
            {subtitle}
          </p>
        </div>
      </div>

      <Card className="surface-card rounded-2xl relative">
        <Card.Content className="p-6 space-y-5">
          <div
            className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
            style={{
              background:
                'linear-gradient(90deg,transparent,color-mix(in oklab,var(--accent) 35%,transparent),transparent)',
            }}
          />
          {children}
        </Card.Content>
      </Card>

      {footer ? (
        <div className="text-center text-sm" style={{ color: 'var(--text-faint)' }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
