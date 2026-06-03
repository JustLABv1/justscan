'use client';

import { PublicShell } from '@/components/public/public-shell';
import { Button, Card, Chip } from '@heroui/react';
import Link from 'next/link';

export function MaintenanceView({ message }: { message: string }) {
  return (
    <PublicShell
      contentClassName="max-w-5xl"
      header={
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
      }
    >
      <Card className="surface-card w-full max-w-3xl rounded-[2rem] border border-divider/70 shadow-xl shadow-black/5">
        <Card.Content className="space-y-6 p-7 sm:p-10">
          <Chip color="warning" size="sm" variant="soft">
            Maintenance mode
          </Chip>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.05em] text-foreground sm:text-6xl">
              We&rsquo;ll be right back.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-foreground/68 sm:text-lg">
              {message}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/">
              <Button variant="secondary">Back to home</Button>
            </Link>
            <Link href="/login">
              <Button>Sign in</Button>
            </Link>
          </div>
        </Card.Content>
      </Card>
    </PublicShell>
  );
}
