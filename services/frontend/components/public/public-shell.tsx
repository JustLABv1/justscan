'use client';

import LightRays from '@/components/LightRays';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface PublicShellProps {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
  contentClassName?: string;
  centered?: boolean;
  withRays?: boolean;
}

export function PublicShell({
  children,
  header,
  className,
  contentClassName,
  centered = false,
  withRays = false,
}: PublicShellProps) {
  return (
    <main
      className={cn('relative min-h-dvh overflow-hidden bg-background text-foreground', className)}
    >
      {withRays ? (
        <div className="pointer-events-none absolute inset-0 opacity-70">
          <LightRays
            raysOrigin="top-center"
            raysColor="#ffffff"
            raysSpeed={1}
            lightSpread={0.5}
            rayLength={3}
            followMouse={true}
            mouseInfluence={0.1}
            noiseAmount={0}
            distortion={0}
            className="custom-rays"
            pulsating={false}
            fadeDistance={1}
            saturation={1}
          />
        </div>
      ) : null}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--background) 88%, #eef4fa) 0%, var(--background) 38%, color-mix(in srgb, var(--background) 95%, #f7fafc) 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.42] dark:opacity-[0.28]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--accent) 24%, transparent) 1.15px, transparent 0), linear-gradient(180deg, color-mix(in srgb, var(--foreground) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--foreground) 3%, transparent) 1px, transparent 1px)',
          backgroundPosition: 'center top, center top, center top',
          backgroundSize: '24px 24px, 24px 24px, 24px 24px',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 16% 12%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 18%), radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 20%), radial-gradient(circle at 50% 100%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 22%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_45%)]" />

      {header ? <div className="relative z-10">{header}</div> : null}

      <div
        className={cn(
          'relative z-10 mx-auto w-full px-5 sm:px-8',
          centered
            ? 'flex min-h-dvh items-center justify-center py-10'
            : 'flex min-h-[calc(100dvh-4rem)] items-center py-10 sm:py-14',
          contentClassName
        )}
      >
        {children}
      </div>
    </main>
  );
}
