import { Logo } from '@/components/logo';
import { Card } from '@/components/ui';
import type { ReactNode } from 'react';

type AuthCardProps = {
  title: string;
  subtitle: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({ title, subtitle, eyebrow, children, footer }: AuthCardProps) {
  return (
    <div className="auth-card-shell">
      <Card className="auth-card gap-0 py-0">
        <Card.Content className="auth-card-content p-6 sm:p-8">
          <div className="auth-card-heading">
            <div className="auth-card-brand">
              <Logo className="auth-card-brand-logo" size={40} />
            </div>
            <div className="auth-card-copy">
              {eyebrow ? <p className="auth-card-eyebrow">{eyebrow}</p> : null}
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
