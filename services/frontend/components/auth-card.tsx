'use client';

import { Logo } from '@/components/logo';
import { Card } from '@heroui/react';
import type { ReactNode } from 'react';

type AuthCardProps = {
  title: string;
  subtitle: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({
  title,
  subtitle,
  eyebrow = 'Secure access',
  children,
  footer,
}: AuthCardProps) {
  return (
    <div className="auth-card-shell">
      <Card className="auth-card surface-card">
        <Card.Content className="auth-card-content">
          <div className="auth-card-heading">
            <div className="auth-card-brand">
              <Logo className="auth-card-brand-logo" size={32} />
              <span className="auth-card-brand-name">JustScan</span>
            </div>
            <div className="auth-card-copy">
              <p className="auth-card-eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          <div className="auth-card-body">{children}</div>
        </Card.Content>
      </Card>

      {footer ? <div className="auth-card-footer">{footer}</div> : null}
    </div>
  );
}
