'use client';

import { Logo } from '@/components/logo';
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
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-2xl"
          style={{
            background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
            boxShadow: '0 0 32px rgba(124,58,237,0.5),inset 0 1px 0 rgba(255,255,255,0.2)',
          }}
        >
          <Logo size={26} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 space-y-5 relative">
        <div
          className="absolute inset-x-0 top-0 h-px rounded-t-2xl pointer-events-none"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.3),transparent)' }}
        />
        {children}
      </div>

      {footer ? (
        <div className="text-center text-sm" style={{ color: 'var(--text-faint)' }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}