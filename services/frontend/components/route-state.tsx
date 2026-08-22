'use client';

import { Alert, buttonVariants, Button, Card } from '@heroui/react';
import { AlertCircleIcon, ArrowLeft01Icon, RefreshIcon } from 'hugeicons-react';
import Link from 'next/link';

export function RouteLoadingState({
  title = 'Loading view',
  message = 'Fetching the latest data for this page.',
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div aria-label={title} className="p-6 max-w-5xl mx-auto">
      <Card className="surface-card rounded-3xl p-8 space-y-5">
        <div className="space-y-2">
          <div className="skeleton h-8 w-48 rounded-xl" />
          <div className="skeleton h-4 w-72 rounded-lg" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl p-5"
              style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
            >
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton h-8 w-20 rounded mt-3" />
              <div className="skeleton h-3 w-28 rounded mt-4" />
            </div>
          ))}
        </div>
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: 'var(--row-hover)', border: '1px solid var(--surface-border)' }}
        >
          <div className="skeleton h-4 w-40 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-5/6 rounded" />
          <p className="text-sm text-zinc-500">{message}</p>
        </div>
      </Card>
    </div>
  );
}

export function RouteErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <section className="px-4 py-6 sm:px-6">
      <Card className="bg-transparent relative mx-auto flex min-h-[calc(100dvh-10rem)] w-full max-w-5xl items-center justify-center overflow-hidden p-6 sm:p-10">
        <div className="relative z-10 w-full max-w-3xl duration-500 animate-in fade-in zoom-in-95 slide-in-from-bottom-2">
          <div className="rounded-[28px] border border-danger/25 bg-danger/10 p-5 backdrop-blur-sm sm:p-7">
            <div className="mb-5 flex items-center gap-4">
              <div className="grid size-14 place-items-center rounded-2xl border border-danger/35 bg-danger/20 text-danger shadow-[0_0_0_0_rgba(239,68,68,0.35)] animate-pulse sm:size-16">
                <AlertCircleIcon size={28} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-danger/80">
                  Incident detected
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-zinc-100 sm:text-3xl">{title}</h2>
              </div>
            </div>

            <Alert className="border border-danger/30 bg-danger/15 text-zinc-200" status="danger">
              <Alert.Indicator className="text-danger">
                <AlertCircleIcon size={18} />
              </Alert.Indicator>
              <Alert.Content>
                <Alert.Description className="text-zinc-300">{message}</Alert.Description>
              </Alert.Content>
            </Alert>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
              <Link
                href="/dashboard"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'inline-flex items-center gap-2',
                })}
              >
                <ArrowLeft01Icon size={15} />
                Back to dashboard
              </Link>
              <Button
                className="shadow-[0_0_32px_rgba(239,68,68,0.38)]"
                onClick={onRetry}
                variant="danger"
              >
                <RefreshIcon size={15} />
                Retry route
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
