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
      <div className="space-y-3 text-center">
        <Logo size={60} className="mx-auto" />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-base font-medium text-foreground/70">{subtitle}</p>
        </div>
      </div>

      <Card className="surface-card relative rounded-3xl border border-divider/70 shadow-lg shadow-black/5">
        <Card.Content className="space-y-5 p-6">
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

      {footer ? <div className="text-center text-sm text-foreground/60">{footer}</div> : null}
    </div>
  );
}
