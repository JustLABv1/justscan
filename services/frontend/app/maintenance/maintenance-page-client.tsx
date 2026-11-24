'use client';

import { Logo } from '@/components/logo';
import { PublicBackdrop } from '@/components/public/public-backdrop';
import { buttonVariants } from '@/components/ui';
import { StatusTag } from '@/components/ui/status-dot';
import { motion } from 'motion/react';
import Link from 'next/link';

export function MaintenancePageClient({ message }: { message: string }) {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-16 text-foreground sm:px-6">
      <PublicBackdrop />

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="relative mx-auto flex max-w-2xl flex-col items-center text-center"
      >
        <div className="mb-8 grid size-20 place-items-center rounded-xl border border-border bg-card shadow-lg shadow-foreground/5">
          <Logo size={44} />
        </div>

        <div className="mb-6 rounded-full border border-border bg-card px-3 py-1.5">
          <StatusTag tone="warning" className="text-sm">
            Scheduled maintenance
          </StatusTag>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
          JustScan is getting better.
        </h1>

        <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
          {message}
        </p>

        <Link href="/" className={buttonVariants({ size: 'lg', className: 'mt-10 px-5' })}>
          Try again
        </Link>
      </motion.section>
    </main>
  );
}
