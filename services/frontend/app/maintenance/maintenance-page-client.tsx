'use client';

import { Logo } from '@/components/logo';
import { Link } from '@heroui/react';
import { motion } from 'motion/react';

export function MaintenancePageClient({ message }: { message: string }) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-6 text-foreground">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(15,23,42,0.16),transparent_30%),linear-gradient(135deg,#f8fafc_0%,#eef2ff_45%,#f8fafc_100%)] dark:bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.13),transparent_30%),linear-gradient(135deg,#050505_0%,#111_50%,#050505_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:80px_80px] [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" />

      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
        className="relative z-10 mx-auto flex max-w-2xl flex-col items-center text-center"
      >
        <div className="relative mb-10">
          <div className="absolute inset-0 rounded-[2rem] bg-foreground/20 blur-2xl" />
          <div className="relative grid h-20 w-20 place-items-center rounded-[1.75rem] border border-divider/60 bg-content1/90 shadow-2xl shadow-foreground/10">
            <Logo size={44} />
          </div>
        </div>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-divider/70 bg-content1/45 px-4 py-2 text-sm text-foreground/60 backdrop-blur-xl">
          <span className="h-2 w-2 rounded-full bg-foreground shadow-[0_0_18px_rgba(255,255,255,0.75)] dark:shadow-[0_0_18px_rgba(255,255,255,0.75)]" />
          Maintenance
        </div>

        <h1 className="text-5xl font-semibold tracking-[-0.06em] md:text-7xl">
          JustScan is getting better.
        </h1>

        <p className="mt-6 max-w-xl text-base leading-7 text-foreground/68 md:text-lg">{message}</p>

        <Link
          href="/"
          className="mt-10 rounded-full border border-divider bg-foreground px-6 py-3 text-sm font-semibold text-background transition hover:opacity-90"
        >
          Try again
        </Link>
      </motion.section>
    </main>
  );
}
