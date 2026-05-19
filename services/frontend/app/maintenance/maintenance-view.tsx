'use client';

import AuroraBlur from '@/components/react-bits/aurora-blur';
import { Button } from '@heroui/react';
import Link from 'next/link';

export function MaintenanceView({ message }: { message: string }) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0">
        <AuroraBlur
          brightness={0.76}
          className="h-full w-full"
          height="100%"
          layers={[
            { color: '#4fd1c5', speed: 0.2, intensity: 0.28 },
            { color: '#7dd3fc', speed: 0.12, intensity: 0.22 },
            { color: '#fbbf24', speed: 0.08, intensity: 0.08 },
            { color: '#ffffff', speed: 0.04, intensity: 0.06 },
          ]}
          noiseScale={3.2}
          opacity={0.86}
          saturation={0.72}
          skyLayers={[
            { color: '#061113', blend: 0.58 },
            { color: '#0f2929', blend: 0.42 },
          ]}
          speed={0.72}
          verticalFade={0.95}
          width="100%"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/35 to-background/65" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_44%,transparent_0,transparent_24rem,var(--background)_62rem)] opacity-70" />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="text-sm font-semibold tracking-[0.28em] text-foreground/70">
          JUSTSCAN
        </Link>
        <Link href="/login">
          <Button size="sm" variant="tertiary">
            Sign in
          </Button>
        </Link>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-5xl items-center px-5 pb-20 pt-10 sm:px-8">
        <div className="max-w-2xl">
          <div className="mb-7 h-px w-28 bg-warning" />
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.35em] text-warning">
            Maintenance Mode
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-[-0.06em] text-foreground sm:text-7xl lg:text-8xl">
            We&rsquo;ll be right back.
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-8 text-foreground/72 sm:text-xl sm:leading-9">
            {message}
          </p>
        </div>
      </section>
    </main>
  );
}
